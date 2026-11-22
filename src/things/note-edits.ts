/**
 * Writing what Things changed into one note: IDs put on and taken off, a
 * to-do's fields, moves to another heading, new to-dos, lines Things deleted,
 * and the project's headings. Also the text of a new note made from a
 * project.
 *
 * Every step for one note in a round comes in one call and goes out in one
 * write. Each task is found again by the line and text it was read with,
 * a task still on its own line first so a nearer search never takes another
 * task's line, and is then followed through every edit made around it, so a
 * later step on the same task still finds it after an earlier one changed
 * it. A task whose line changed since the read, or whose notes or checklist
 * changed when the step rewrites them, is left alone and counted as missed,
 * for the next round to retry.
 *
 * Notes are the record, so nothing here takes out the user's words: a line
 * Things deleted becomes a plain bullet with a dated note under it, and so
 * do the checkboxes under it; a checklist item Things deleted becomes a
 * plain bullet; a heading Things dropped stays; and a rename from Things
 * keeps the tags, comments and Tasks plugin metadata Things never saw. Kept
 * free of Obsidian imports so it can be unit tested directly.
 */

import { renameHeading } from '../tasks-view/heading-edit';
import { addNotes, buildTaskLine, contextRange, editableTitle, insertionLine, locateTaskLine, notesLines, parseTaskLine, setDueInText, subtaskLines, taskBlockEnd, withState, withText, withTitle } from '../tasks-view/task-line';
import { addUnderNewHeading, bodyStart, moveHeading, moveTasks, newHeadingLevel, noteHeadings, titleOf, trimBack } from '../tasks-view/task-move';
import type { MovePlan, NoteHeading } from '../tasks-view/task-move';
import { tasksPluginMetadata } from '../utils/task-metadata';
import { withThingsId } from './ids';
import { checklistLines, lineTag, lineTagsIn, notesUnder, relink, statusFromTags, thingsTag } from './mapping';
import type { ChecklistItem, ThingsTodo, TodoFields, TodoStatus, VaultTask } from './model';
import type { VaultStep } from './plan';

export interface ThingsFormats {
    /** A YYYY-MM-DD day in the vault's task date format. */
    date(iso: string): string;
    /** An HH:mm time in the vault's time format. */
    time(hhmm: string): string;
    /** Today, already in the vault's task date format, for the note under a retired line. */
    today: string;
}

/** Things text on one line: a newline in a title would end the task there. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** A heading name from Things, on one line. A blank one is no heading: `## ` never reads back as one. */
function headingName(name: string | undefined): string | undefined {
    const line = name === undefined ? '' : oneLine(name);
    return line === '' ? undefined : line;
}

/** The checkbox for a status and tags: done, cancelled, or the status or priority the tags carry. */
function checkbox(status: TodoStatus, tags: readonly string[]): string {
    if (status === 'completed') return 'x';
    if (status === 'canceled') return '-';
    return statusFromTags([...tags]).state;
}

/** A checkbox line made a plain bullet, keeping its callout, indent and words. */
function plainBullet(line: string, text?: string): string {
    const parsed = parseTaskLine(line);
    return parsed ? `${parsed.prefix}${parsed.indent}${parsed.bullet} ${text ?? parsed.text}` : line;
}

/** A to-do's task line: title, tags and `#someday`, its date and time, and its ID last. */
function todoLine(todo: ThingsTodo, fmt: ThingsFormats): string {
    const f = todo.fields;
    const tags = statusFromTags([...f.tags]).tags.map(tag => `#${lineTag(tag)}`);
    const words = [oneLine(f.title), ...tags, ...(f.someday ? ['#someday'] : [])].filter(Boolean).join(' ');
    const built = buildTaskLine({ text: words, date: f.when ? fmt.date(f.when) : undefined, time: f.when && f.reminder ? fmt.time(f.reminder) : undefined });
    return `- [${checkbox(f.status, f.tags)}] ${withThingsId(parseTaskLine(built)?.text ?? '', todo.id).trim()}`;
}

const itemLine = (item: ChecklistItem): string => `- [${item.done ? 'x' : ' '}] ${oneLine(item.title)}`;

/** Writes a to-do into `lines` at `at`: its line, its notes, and its checklist as subtasks. */
function writeTodo(lines: string[], at: number, todo: ThingsTodo, fmt: ThingsFormats): void {
    lines.splice(at, 0, todoLine(todo, fmt));
    addNotes(lines, at, todo.fields.notes.replace(/\r\n?/g, '\n'));
    const placed = todo.fields.checklist.length ? subtaskLines(lines, at, todo.fields.checklist.map(itemLine)) : null;
    if (placed) lines.splice(placed.at, 0, ...placed.lines);
}

/** The text of a new note for a project: its title, its loose to-dos, then each heading with its to-dos. */
export function newNoteContent(title: string, headings: readonly string[], todos: readonly ThingsTodo[], fmt: ThingsFormats): string {
    const lines = [`# ${oneLine(title)}`];
    // Each heading once, so no to-do is written twice.
    const names = headings.map(headingName).filter((name, i, all): name is string => name !== undefined && all.indexOf(name) === i);
    const under = (todo: ThingsTodo) => {
        const name = headingName(todo.heading);
        return name !== undefined && names.includes(name) ? name : undefined;
    };
    for (const todo of todos) if (under(todo) === undefined) writeTodo(lines, lines.length, todo, fmt);
    for (const name of names) {
        lines.push('', `## ${name}`);
        for (const todo of todos) if (under(todo) === name) writeTodo(lines, lines.length, todo, fmt);
    }
    return `${lines.join('\n')}\n`;
}

/** The note with every step written in, and how many steps found no line to write to. */
export function applyThingsEdits(lines: readonly string[], steps: readonly VaultStep[], fmt: ThingsFormats): { lines: string[]; missed: number } {
    const note = new Note(lines, steps.flatMap(step => 'task' in step ? [step.task] : []));
    let missed = 0;
    for (const step of steps) if (!apply(note, step, fmt)) missed++;
    return { lines: note.lines, missed };
}

/** Carries out one step. False when its task couldn't be found or written. */
function apply(note: Note, step: VaultStep, fmt: ThingsFormats): boolean {
    switch (step.kind) {
        case 'link':
        case 'adopt':
            return note.retext(step.task, text => withThingsId(text, step.id));
        case 'unlink':
            return note.retext(step.task, text => withThingsId(text, null));
        case 'update':
            return update(note, step.task, step.fields, fmt);
        case 'move':
            // A move to another note is the round's: it carries the block across.
            return step.to.path !== step.task.path || move(note, step.task, step.to.heading);
        case 'add':
            add(note, step.todo, step.to.heading, fmt);
            return true;
        case 'retire':
            return retire(note, step.task, fmt.today);
        case 'headings':
            headings(note, step.from, step.to);
            return true;
        default:
            // createNote and renameNote are the round's.
            return true;
    }
}

/** Where a task is now and its text now, as the steps change the note. Line -1: not found. */
interface Spot { line: number; text: string }

const keyOf = (task: VaultTask): string => `${task.line}\n${task.text}`;

/** A note's own heading with this name, never its title; in another case when that's all it has, as `addUnderNewHeading` finds it. */
function ownHeading(lines: string[], name: string): NoteHeading | undefined {
    const all = noteHeadings(lines);
    const title = titleOf(all);
    const own = all.filter(heading => heading !== title);
    return own.find(heading => heading.title === name) ?? own.find(heading => heading.title.toLowerCase() === name.toLowerCase());
}

/** The lines that add a heading the note lacks, at its end at the level of its sections, or null when it has it. */
function headingAddition(lines: string[], name: string): { at: number; added: string[] } | null {
    if (ownHeading(lines, name)) return null;
    const result = addUnderNewHeading(lines, name, newHeadingLevel(noteHeadings(lines), undefined), 'bottom', []);
    return result.added.length ? { at: result.at, added: result.added } : null;
}

/** The note's lines as the steps change them, and where each step's task is. */
class Note {
    readonly lines: string[];
    private readonly spots = new Map<string, Spot>();

    constructor(lines: readonly string[], tasks: readonly VaultTask[]) {
        this.lines = [...lines];
        const taken = new Set<number>();
        // A task still on its own line first, so a nearer search never takes another task's line.
        for (const task of tasks) {
            if (this.spots.has(keyOf(task)) || parseTaskLine(this.lines[task.line] ?? '')?.text !== task.text) continue;
            this.spots.set(keyOf(task), { line: task.line, text: task.text });
            taken.add(task.line);
        }
        for (const task of tasks) {
            if (this.spots.has(keyOf(task))) continue;
            const found = locateTaskLine(this.lines, task.line, task.text);
            const free = found !== -1 && !taken.has(found);
            if (free) taken.add(found);
            this.spots.set(keyOf(task), { line: free ? found : -1, text: task.text });
        }
    }

    find(task: VaultTask): Spot | undefined {
        const spot = this.spots.get(keyOf(task));
        return spot && spot.line !== -1 ? spot : undefined;
    }

    /** A task's line replaced. One that is no longer a task can't take another step. */
    setLine(spot: Spot, line: string): void {
        this.lines[spot.line] = line;
        const parsed = parseTaskLine(line);
        if (parsed) spot.text = parsed.text;
        else spot.line = -1;
    }

    /** A task's text changed, keeping its checkbox, indent and callout. */
    retext(task: VaultTask, edit: (text: string) => string): boolean {
        const spot = this.find(task);
        if (!spot) return false;
        this.setLine(spot, withText(this.lines[spot.line], edit(spot.text)) ?? this.lines[spot.line]);
        return true;
    }

    /** `insert` in place of `remove` lines at `at`, following every task below. */
    splice(at: number, remove: number, insert: readonly string[]): void {
        this.lines.splice(at, remove, ...insert);
        const delta = insert.length - remove;
        for (const spot of this.spots.values()) {
            if (spot.line >= at + remove) spot.line += delta;
            else if (spot.line >= at && spot.line < at + remove) spot.line = -1;
        }
    }

    /** Lines written at `at` by `write`, following every task below. */
    grow(at: number, write: (lines: string[]) => void): void {
        const before = this.lines.length;
        write(this.lines);
        const delta = this.lines.length - before;
        for (const spot of this.spots.values()) if (spot.line >= at) spot.line += delta;
    }

    /** The note after a move, following every task to its new line. */
    take(plan: MovePlan): void {
        this.lines.splice(0, this.lines.length, ...plan.lines);
        for (const spot of this.spots.values()) if (spot.line !== -1) spot.line = plan.lineMap.get(spot.line) ?? -1;
    }

    heading(name: string): NoteHeading | undefined {
        return ownHeading(this.lines, name);
    }

    /** A heading the note lacks, added at its end at the level of the note's sections. */
    ensureHeading(name: string): void {
        const extra = headingAddition(this.lines, name);
        if (extra) this.splice(extra.at, 0, extra.added);
    }

    /** The heading a line sits under: the nearest above it that isn't the title. */
    headingAbove(line: number): string | undefined {
        const all = noteHeadings(this.lines);
        const title = titleOf(all);
        let found: string | undefined;
        for (const heading of all) {
            if (heading.line >= line) break;
            if (heading !== title) found = heading.title;
        }
        return found;
    }
}

/**
 * Pieces of a line Things never saw, so a rename from Things keeps them:
 * `#tags`, `%%comments%%` and Tasks plugin metadata that weren't part of the
 * old title, nor are in the new one.
 */
function unseen(words: string, oldTitle: string, newTitle: string): string[] {
    const metadata = tasksPluginMetadata(words);
    const marks = [
        ...lineTagsIn(words).filter(tag => !tag.reserved).map(tag => ({ at: tag.start, piece: words.slice(tag.start, tag.end) })),
        ...[...words.matchAll(/%%.*?%%/g)].map(match => ({ at: match.index ?? 0, piece: match[0] }))
    ].sort((a, b) => a.at - b.at).map(mark => mark.piece).filter(piece => !metadata.some(meta => meta.includes(piece)));
    return [...marks, ...metadata].filter(piece => !oldTitle.includes(piece) && !newTitle.includes(piece));
}

/** Words with the line's `#tags` that `drop` picks taken out. */
function cutTags(words: string, drop: (tag: ReturnType<typeof lineTagsIn>[number]) => boolean): string {
    let kept = '';
    let from = 0;
    for (const tag of lineTagsIn(words)) {
        if (!drop(tag)) continue;
        kept += words.slice(from, tag.start);
        from = tag.end;
    }
    return from === 0 ? words : `${kept}${words.slice(from)}`.replace(/\s+/g, ' ').trim();
}

const tagKey = (name: string): string => thingsTag(name).toLowerCase();

/** Words carrying Things' tags: ones Things dropped taken out, new ones added at the end. Status, priority and someday tags stay as they are. */
function withTags(words: string, tags: readonly string[]): string {
    const wanted = statusFromTags([...tags]).tags.map(lineTag);
    const keep = new Set(wanted.map(tagKey));
    const had = new Set<string>();
    const kept = cutTags(words, tag => {
        const key = tagKey(tag.name);
        if (tag.reserved || key === 'someday') return false;
        if (keep.has(key)) had.add(key);
        return !keep.has(key);
    });
    const added = wanted.filter((tag, i) => !had.has(tagKey(tag)) && wanted.findIndex(other => tagKey(other) === tagKey(tag)) === i);
    return [kept, ...added.map(tag => `#${tag}`)].filter(Boolean).join(' ');
}

function withSomeday(words: string, someday: boolean): string {
    const isSomeday = (tag: { name: string }) => tag.name.toLowerCase() === 'someday';
    if (!someday) return cutTags(words, isSomeday);
    return lineTagsIn(words).some(isSomeday) ? words : [words, '#someday'].filter(Boolean).join(' ');
}

/** A task's or checklist item's text with Things' title, its `[[links]]` put back and what Things never saw kept. */
function retitled(text: string, dateText: string | undefined, oldTitle: string, title: string): string {
    const next = oneLine(title);
    const words = editableTitle(text, dateText);
    return withTitle(text, dateText, [relink(next, text), ...unseen(words, oldTitle, next)].join(' '));
}

/** A task's text with the fields Things changed: title, tags, someday, date and time. */
function updatedText(text: string, task: VaultTask, f: Partial<TodoFields>, fmt: ThingsFormats): string {
    let next = f.title === undefined ? text : retitled(text, task.dateText, task.fields.title, f.title);
    if ('tags' in f || 'someday' in f) {
        const was = editableTitle(next, task.dateText);
        let words = was;
        if ('tags' in f) words = withTags(words, f.tags ?? []);
        if ('someday' in f) words = withSomeday(words, f.someday === true);
        if (words !== was) next = withTitle(next, task.dateText, words);
    }
    if ('when' in f || 'reminder' in f) {
        const when = 'when' in f ? f.when : task.fields.when;
        const time = 'reminder' in f ? (f.reminder ? fmt.time(f.reminder) : null) : undefined;
        if (when === undefined) next = setDueInText(next, task, null);
        // A daily note's own day stays unwritten, unless a time needs a day to sit on.
        else if (task.dateText || when !== task.impliedWhen || time) next = setDueInText(next, task, fmt.date(when), time);
    }
    return next;
}

const sameItems = (a: readonly ChecklistItem[], b: readonly ChecklistItem[]): boolean =>
    a.length === b.length && a.every((item, i) => item.title === b[i].title && item.done === b[i].done);

function update(note: Note, task: VaultTask, f: Partial<TodoFields>, fmt: ThingsFormats): boolean {
    const spot = note.find(task);
    if (!spot) return false;
    const lines = note.lines;
    const [start, end] = contextRange(lines, spot.line);
    // Notes or a checklist changed since the read are the user's until the next round.
    if ('notes' in f && notesUnder(lines, spot.line) !== task.fields.notes) return false;
    if ('checklist' in f && !sameItems(checklistLines(lines, spot.line).map(entry => entry.item), task.fields.checklist)) return false;

    let line = withText(lines[spot.line], updatedText(spot.text, task, f, fmt)) ?? lines[spot.line];
    if ('status' in f || 'tags' in f) {
        // Only a change of meaning rewrites the checkbox, so `[>]` stays while the to-do is open.
        const was = checkbox(task.fields.status, task.fields.tags);
        const now = checkbox(f.status ?? task.fields.status, 'tags' in f ? f.tags ?? [] : task.fields.tags);
        if (now !== was) line = withState(line, now) ?? line;
    }
    // Text that would no longer read as a task (nothing left after the checkbox) is never written.
    if (!parseTaskLine(line)) return false;
    note.setLine(spot, line);
    // The checklist sits below the notes, so it goes first and the notes' lines stay put.
    if ('checklist' in f) checklist(note, spot.line, f.checklist ?? []);
    if ('notes' in f) note.splice(start, end - start, notesLines(lines, spot.line, (f.notes ?? '').replace(/\r\n?/g, '\n')));
    return true;
}

/** Pairs of positions where two title lists agree, the longest run in order. */
function sameTitles(a: readonly string[], b: readonly string[]): Array<[number, number]> {
    const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const pairs: Array<[number, number]> = [];
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
        if (a[i] === b[j]) pairs.push([i++, j++]);
        else if (table[i + 1][j] >= table[i][j + 1]) i++;
        else j++;
    }
    return pairs;
}

/**
 * A task's checklist made Things' list. Items are matched by title, so one
 * Things added, renamed or deleted in the middle never shifts the others: an
 * item with the same title keeps its line, unmatched items between the same
 * neighbours are renamed in place in order, and a new one goes in after the
 * item before it. One Things deleted becomes a plain bullet with its words
 * and moves, with any notes under it, to the end of the task's block: after
 * the items that remain, so it never reads as the task's notes while there
 * are any. With none left it does, which keeps its words as the record.
 */
function checklist(note: Note, index: number, list: readonly ChecklistItem[]): void {
    const lines = note.lines;
    const children = checklistLines(lines, index);
    const before = children.map(entry => entry.item);
    const renames: Array<[number, number]> = [];
    const dropped: number[] = [];
    /** New items by the old item they follow, -1 for before the first. */
    const inserts = new Map<number, number[]>();
    let fromOld = 0;
    let fromNew = 0;
    for (const [oldAt, newAt] of [...sameTitles(before.map(item => item.title), list.map(item => item.title)), [before.length, list.length]]) {
        let after = fromOld - 1;
        for (let j = fromNew; j < newAt; j++) {
            const i = fromOld + (j - fromNew);
            if (i < oldAt) { renames.push([i, j]); after = i; } else inserts.set(after, [...(inserts.get(after) ?? []), j]);
        }
        for (let i = fromOld + (newAt - fromNew); i < oldAt; i++) dropped.push(i);
        if (oldAt < before.length) renames.push([oldAt, newAt]);
        fromOld = oldAt + 1;
        fromNew = newAt + 1;
    }

    // Every line that moves, read before any line changes. Applied from the
    // bottom; at one spot the deleted items go in first, so new ones land above them.
    const edits: Array<{ at: number; remove: number; insert: string[]; order: number }> = [...inserts].map(([after, items]) => {
        const ref = children[Math.max(after, 0)];
        const parsed = ref && parseTaskLine(lines[ref.line]);
        const made = items.map(j => itemLine(list[j]));
        const placed = !ref || !parsed
            ? subtaskLines(lines, index, made) ?? { at: lines.length, lines: [] }
            : { at: after === -1 ? ref.line : contextRange(lines, ref.line)[1], lines: made.map(line => `${parsed.prefix}${parsed.indent}${line}`) };
        return { at: placed.at, remove: 0, insert: placed.lines, order: 2 };
    });
    const moved: string[] = [];
    for (const i of dropped) {
        const [start, end] = [children[i].line, contextRange(lines, children[i].line)[1]];
        moved.push(plainBullet(lines[start]), ...lines.slice(start + 1, end));
        edits.push({ at: start, remove: end - start, insert: [], order: 1 });
    }
    if (moved.length) edits.push({ at: taskBlockEnd(lines, index), remove: 0, insert: moved, order: 0 });

    for (const [i, j] of renames) {
        const at = children[i].line;
        let line = lines[at];
        if (before[i].title !== list[j].title) line = withText(line, retitled(parseTaskLine(line)?.text ?? '', undefined, before[i].title, list[j].title)) ?? line;
        if (before[i].done !== list[j].done) line = withState(line, list[j].done ? 'x' : ' ') ?? line;
        lines[at] = line;
    }
    for (const edit of edits.sort((a, b) => b.at - a.at || a.order - b.order)) note.splice(edit.at, edit.remove, edit.insert);
}

/**
 * Moves a task under another heading of the same note, adding the heading
 * when the note lacks it. The move is worked out on the note as it would be
 * first, so one that can't happen (a task in a callout) adds nothing.
 */
function move(note: Note, task: VaultTask, heading: string | undefined): boolean {
    const spot = note.find(task);
    if (!spot) return false;
    const name = headingName(heading);
    if (note.headingAbove(spot.line) === (name === undefined ? undefined : note.heading(name)?.title ?? name)) return true;
    const extra = name === undefined ? null : headingAddition(note.lines, name);
    const lines = extra ? [...note.lines.slice(0, extra.at), ...extra.added, ...note.lines.slice(extra.at)] : note.lines;
    const into = name === undefined ? titleOf(noteHeadings(lines)) : ownHeading(lines, name);
    if (name !== undefined && !into) return false;
    const line = extra && spot.line >= extra.at ? spot.line + extra.added.length : spot.line;
    const plan = moveTasks(lines, [{ line, text: spot.text }], into ? { kind: 'heading', heading: into.title, line: into.line } : { kind: 'heading', heading: '' });
    if (!plan) return false;
    if (extra) note.splice(extra.at, 0, extra.added);
    note.take(plan);
    return true;
}

/** Where a new to-do goes: at the top of its heading's tasks, or, with no heading, at the top of the tasks above the first section. */
function placeFor(note: Note, heading: string | undefined): number {
    const lines = note.lines;
    if (heading !== undefined) {
        const found = note.heading(heading);
        return found ? insertionLine(lines, found.title, found.line) : insertionLine(lines);
    }
    const all = noteHeadings(lines);
    const title = titleOf(all);
    if (title) return insertionLine(lines, title.title, title.line);
    const first = all[0];
    if (!first) return insertionLine(lines);
    const floor = bodyStart(lines);
    for (let i = floor; i < first.line; i++) {
        const parsed = parseTaskLine(lines[i]);
        if (parsed && !parsed.prefix && parsed.indent === '') return i;
    }
    return trimBack(lines, first.line, floor);
}

function add(note: Note, todo: ThingsTodo, heading: string | undefined, fmt: ThingsFormats): void {
    const name = headingName(heading);
    if (name !== undefined) note.ensureHeading(name);
    const at = placeFor(note, name);
    note.grow(at, lines => writeTodo(lines, at, todo, fmt));
}

/**
 * A line whose to-do Things deleted: a plain bullet without its Things ID,
 * with a dated note under it. Every checkbox under it, its checklist at any
 * depth, becomes a plain bullet too, so nothing left there reads as a task
 * and comes back as a new to-do.
 */
function retire(note: Note, task: VaultTask, today: string): boolean {
    const spot = note.find(task);
    if (!spot) return false;
    const placed = subtaskLines(note.lines, spot.line, [`- ${today}: deleted in Things, no longer synced.`]);
    const end = taskBlockEnd(note.lines, spot.line);
    for (let i = spot.line + 1; i < end; i++) note.lines[i] = plainBullet(note.lines[i]);
    note.setLine(spot, plainBullet(note.lines[spot.line], withThingsId(spot.text, null)));
    if (placed) note.splice(placed.at, 0, placed.lines);
    return true;
}

/**
 * The note's headings made Things' list. With the same number of headings, a
 * name Things changed at a position, that neither list has elsewhere, is a
 * rename. Headings the note lacks are added, then the named ones are put in
 * Things' order. A heading Things dropped is never deleted.
 */
function headings(note: Note, from: readonly string[], to: readonly string[]): void {
    const named = to.map(headingName);
    if (from.length === named.length) {
        from.forEach((name, i) => {
            const next = named[i];
            if (next === undefined || name === next || named.includes(name) || from.includes(next)) return;
            const heading = note.heading(name);
            const edit = heading && renameHeading(note.lines, { line: heading.line, title: heading.title }, next);
            if (edit) note.lines.splice(0, note.lines.length, ...edit.lines);
        });
    }
    // A blank name is no heading, so it is neither added nor ordered.
    const names = named.filter((name): name is string => name !== undefined);
    for (const name of names) note.ensureHeading(name);
    // From the back, each heading goes just above the one after it when it isn't above it already.
    for (let i = names.length - 2; i >= 0; i--) {
        const heading = note.heading(names[i]);
        const next = note.heading(names[i + 1]);
        if (!heading || !next || heading.line < next.line) continue;
        const plan = moveHeading(note.lines, { line: heading.line, title: heading.title }, { kind: 'before', line: next.line, title: next.title });
        if (plan) note.take(plan);
    }
}
