/**
 * Mapping between task lines and Things to-dos.
 *
 * A task line and a to-do are both reduced to `TodoFields` so the planner can
 * compare them. Status and priority have no field of their own in Things, so
 * they travel as tags (`In Progress`, `Question`, `Priority 1`..`3`) and the
 * checkbox they came from is rebuilt from those tags on the way back. A
 * line's `#someday` means Things' Someday and is never sent as a tag.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import type { Task } from '../../main';
import { contextRange, indentWidth, notesText, parseTaskLine } from '../tasks-view/task-line';
import { reminderTitle } from '../tasks-view/reminders';
import { checkboxStateToStatus } from '../utils/task-status';
import { stripThingsId } from './ids';
import type { ChecklistItem, ThingsSnapshot, TodoFields, TodoStatus, VaultSnapshot } from './model';

const STATUS_TAGS: Record<string, string> = { '/': 'In Progress', '?': 'Question' };
const PRIORITY_TAGS = ['Priority 1', 'Priority 2', 'Priority 3'];

/** A `#tag` on a line: after a space or the start, with a letter in it so `#1` stays words. */
const LINE_TAG = /(^|\s)#((?=[\p{L}\p{N}_/-]*[\p{L}_/-])[\p{L}\p{N}_/-]+)/gu;

/** A line's tag as Things writes it: hyphens become spaces. */
export function thingsTag(lineTagName: string): string {
    return lineTagName.replace(/^#/, '').replace(/-/g, ' ');
}

/**
 * A Things tag as a line can carry it: spaces become hyphens, and anything
 * a tag can't hold (`@`, `&`, punctuation) is left out, so `@home` is
 * `#home` on the line. `resolveTags` reads it back as `@home`. Empty when
 * nothing a tag can hold is left, or only digits are: a line can't carry it.
 */
export function lineTag(thingsTagName: string): string {
    const name = thingsTagName.replace(/^#/, '').trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_/-]/gu, '');
    return /[\p{L}_/-]/u.test(name) ? name : '';
}

/**
 * A line's tags as the Things tags they stand for: a tag Things has by that
 * name, else one Things has that a line writes the same way (`#home` for
 * `@home`, `#follow-up` for `follow-up`), else the name as it is. Sorted.
 */
export function resolveTags(tags: readonly string[], known: readonly string[]): string[] {
    const exact = new Set(known);
    const byLine = new Map<string, string>();
    for (const name of known) {
        const key = lineTag(name).toLowerCase();
        if (key && !byLine.has(key)) byLine.set(key, name);
    }
    const out = tags.map(tag => (exact.has(tag) ? tag : byLine.get(lineTag(tag).toLowerCase()) ?? tag));
    return [...new Set(out)].sort();
}

/**
 * The vault with each task's tags named as Things names them (`#home` read
 * back as `@home`), and with a synced to-do's tags that no line can hold
 * (only digits, say) kept from Things, so connecting never rewrites them.
 */
export function withThingsTags(vault: VaultSnapshot, things: ThingsSnapshot): VaultSnapshot {
    const known = [...new Set(things.todos.flatMap(todo => todo.fields.tags))];
    const byId = new Map(things.todos.map(todo => [todo.id, todo]));
    return {
        ...vault,
        notes: vault.notes.map(note => ({
            ...note,
            tasks: note.tasks.map(task => {
                const unheld = task.id === undefined ? [] : (byId.get(task.id)?.fields.tags ?? []).filter(tag => !lineTag(tag));
                const tags = resolveTags([...task.fields.tags, ...unheld], known);
                const same = tags.length === task.fields.tags.length && tags.every((tag, i) => tag === task.fields.tags[i]);
                return same ? task : { ...task, fields: { ...task.fields, tags } };
            })
        }))
    };
}

/**
 * A Things title made safe to write on a task line: a backslash goes in
 * front of anything a line would read as something else (a `#tag`, a
 * `[[link]]` or `[link](url)`, formatting, a `%%comment%%`, a date), so the
 * line shows the same words and reads back as the same title.
 */
export function escapeTitle(title: string): string {
    return title
        .replace(/[\\[\]*`]/g, ch => `\\${ch}`)
        .replace(/__|==|~~|%%/g, pair => `\\${pair[0]}\\${pair[1]}`)
        .replace(/(^|\s)#(?=[\p{L}\p{N}_/-])/gu, '$1\\#')
        .replace(/(\d)([-/.])(?=\d)/g, '$1\\$2');
}

/** A line's words with the backslashes `escapeTitle` put in taken out again. */
export function unescapeTitle(text: string): string {
    return text.replace(/\\([\\#[\]*`_=~%\-/.])/g, '$1');
}

/** Characters a backslash can keep literal, stood in for while a line's words are read. */
const SHIELD_BASE = 0xe000;
const shield = (text: string): string => text.replace(/\\([\\#[\]*`_=~%\-/.])/g, (_, ch: string) => String.fromCharCode(SHIELD_BASE + ch.charCodeAt(0)));
const unshield = (text: string): string => text.replace(/[\ue000-\ue07f]/g, ch => String.fromCharCode(ch.charCodeAt(0) - SHIELD_BASE));

/**
 * A line's words as Things' title: links and formatting reduced to the words
 * they show, tags taken out, and anything escaped with a backslash kept as
 * the character itself (set aside while the rest is read, so `\*\*` is two
 * asterisks and never bold).
 */
function lineTitle(text: string, dateText: string | undefined, hideMetadata: boolean): { title: string; tags: string[] } {
    const read = splitTags(reminderTitle(shield(text), dateText, hideMetadata));
    return { title: unshield(read.title), tags: read.tags };
}

function taskStatus(task: Task): TodoStatus {
    if (task.completed || task.status === 'done') return 'completed';
    if (task.status === 'cancelled') return 'canceled';
    return 'open';
}

const RESERVED = new Set([...Object.values(STATUS_TAGS), ...PRIORITY_TAGS].map(tag => tag.toLowerCase()));

/**
 * The words of a line with its `#tags` taken out, and the tags it had. A tag
 * that reads as a status or priority tag stays in the words, since Things
 * would turn it into the checkbox. A line of nothing but tags keeps their
 * words as its title, so a to-do is never untitled.
 */
function splitTags(title: string): { title: string; tags: string[] } {
    const tags: string[] = [];
    const words = title
        .replace(LINE_TAG, (whole, space: string, tag: string) => {
            if (RESERVED.has(thingsTag(tag).toLowerCase())) return whole;
            tags.push(tag);
            return space;
        })
        .replace(/\s+/g, ' ')
        .trim();
    return { title: words || tags.join(' '), tags };
}

/** Comments, `[[links]]` and `[links](urls)`: a `#` inside one is never a line's tag, since the title reads them away first. */
const TAGLESS = /%%.*?%%|\[\[[^\]]*\]\]|!?\[[^\]]*\]\([^)]*\)/g;

/** Where each comment and link in a line's words starts and ends. */
function taglessSpans(text: string): Array<[number, number]> {
    return [...text.matchAll(TAGLESS)].map(match => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
}

/**
 * Each `#tag` in a line's words, outside comments and links: where it starts
 * and ends, its name without the `#`, and whether it reads as a status or
 * priority tag, which stays part of the title.
 */
export function lineTagsIn(text: string): Array<{ start: number; end: number; name: string; reserved: boolean }> {
    const spans = taglessSpans(text);
    return [...text.matchAll(LINE_TAG)].flatMap(match => {
        const start = (match.index ?? 0) + match[1].length;
        if (spans.some(([from, to]) => start >= from && start < to)) return [];
        return [{ start, end: start + 1 + match[2].length, name: match[2], reserved: RESERVED.has(thingsTag(match[2]).toLowerCase()) }];
    });
}

/** Strips a callout prefix the way `contextRange` reads lines under a task in a callout. */
function withoutPrefix(line: string, prefix: string): string {
    return prefix && line.startsWith(prefix) ? line.slice(prefix.length).replace(/^ /, '') : line;
}

/** A task's notes as plain Markdown, without the callout prefix of a task in a callout. */
export function notesUnder(lines: string[], index: number): string {
    const prefix = parseTaskLine(lines[index] ?? '')?.prefix.trimEnd() ?? '';
    const [start, end] = contextRange(lines, index);
    return notesText(lines.slice(start, end).map(line => withoutPrefix(line, prefix)));
}

/**
 * The checkboxes under a task, after its notes, each with its line: direct
 * children and anything deeper, in line order.
 */
export function checklistLines(lines: string[], index: number): Array<{ line: number; item: ChecklistItem }> {
    const parsed = parseTaskLine(lines[index] ?? '');
    if (!parsed) return [];
    const prefix = parsed.prefix.trimEnd();
    const base = indentWidth(parsed.indent);
    const items: Array<{ line: number; item: ChecklistItem }> = [];
    for (let i = contextRange(lines, index)[1]; i < lines.length; i++) {
        const line = withoutPrefix(lines[i], prefix);
        if (line.trim() === '') continue;
        const child = parseTaskLine(line);
        if (child) {
            if (indentWidth(child.indent) <= base) break;
            const title = lineTitle(child.text, undefined, false).title;
            items.push({ line: i, item: { title, done: child.state.toLowerCase() === 'x' } });
        } else if (indentWidth(line) <= base) {
            break;
        }
    }
    return items;
}

/**
 * What a task line says, as a to-do would: its words without dates, IDs,
 * Markdown or `#tags`, the notes under it, its child checkboxes, and its
 * date and time (or the day of the daily note it sits in when it has none).
 */
export function fieldsFromTask(task: Task, lines: string[], opts: { hideMetadata: boolean; impliedWhen?: string }): TodoFields {
    const { title, tags: lineTags } = lineTitle(stripThingsId(task.text), task.dateText, opts.hideMetadata);
    const tags = new Set<string>();
    let someday = false;
    for (const tag of lineTags) {
        if (tag.toLowerCase() === 'someday') someday = true;
        else tags.add(thingsTag(tag));
    }
    const state = task.marker ?? '';
    if (STATUS_TAGS[state]) tags.add(STATUS_TAGS[state]);
    else if (checkboxStateToStatus(state) === 'in-progress') tags.add(STATUS_TAGS['/']);
    else if (task.status === 'question') tags.add(STATUS_TAGS['?']);
    if (task.priority) tags.add(PRIORITY_TAGS[task.priority - 1]);

    const fields: TodoFields = {
        title,
        notes: notesUnder(lines, task.lineNumber),
        checklist: checklistLines(lines, task.lineNumber).map(entry => entry.item),
        tags: [...tags].sort(),
        status: taskStatus(task),
        someday
    };
    const when = task.date ?? opts.impliedWhen;
    if (when) fields.when = when;
    if (task.date && task.time) fields.reminder = task.time;
    return fields;
}

/** The file-safe form of one name: no characters a path or a link can't hold. */
function fileSafe(name: string): string {
    return name
        .replace(/[\\/:*?"<>|#^[\]]/g, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '');
}

/** The Things area a vault folder stands for: the full path. The top of the vault is no area. */
export function areaName(folder: string): string {
    return folder;
}

/** The vault folder an area stands for. A `/` in the title nests folders, and each segment is made file-safe. */
export function folderFor(areaTitle: string): string {
    return areaTitle.split('/').map(fileSafe).filter(Boolean).join('/');
}

/** A new note's path for a title in a folder, numbered ` 2`, ` 3` when `taken` says the path is in use. */
export function noteName(title: string, taken: (path: string) => boolean, folder: string): string {
    const base = fileSafe(title) || 'Untitled';
    const at = (suffix: string): string => `${folder ? `${folder}/` : ''}${base}${suffix}.md`;
    if (!taken(at(''))) return at('');
    for (let n = 2; ; n++) {
        if (!taken(at(` ${n}`))) return at(` ${n}`);
    }
}

/** The title of the note holding an area's loose to-dos: the area's last segment, without `.md`. */
export function looseNoteName(areaTitle: string): string {
    const segments = folderFor(areaTitle).split('/').filter(Boolean);
    return segments[segments.length - 1] ?? 'Untitled';
}

/** The checkbox state a to-do's tags imply, and the tags left over for the line. A status tag wins over a priority tag. */
export function statusFromTags(tags: string[]): { state: string; tags: string[] } {
    const status = Object.entries(STATUS_TAGS).find(([, tag]) => tags.includes(tag));
    const priority = PRIORITY_TAGS.findIndex(tag => tags.includes(tag));
    const state = status ? status[0] : priority >= 0 ? `!${priority + 1}` : ' ';
    const reserved = new Set([...Object.values(STATUS_TAGS), ...PRIORITY_TAGS]);
    return { state, tags: tags.filter(tag => !reserved.has(tag)) };
}

const WORD = /[\p{L}\p{N}]/u;

/** Where `needle` first stands as whole words in `text`, outside any `[[link]]` or `[link](url)`, or -1. */
function findOutsideLinks(text: string, needle: string): number {
    const links = [...text.matchAll(/\[\[[^\]]*\]\]|!?\[[^\]]*\]\([^)]*\)/g)].map(m => [m.index!, m.index! + m[0].length]);
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
        const stop = at + needle.length;
        if (links.some(([from, to]) => at < to && stop > from)) continue;
        if (WORD.test(text[at - 1] ?? ' ') || WORD.test(text[stop] ?? ' ')) continue;
        return at;
    }
    return -1;
}

/**
 * A new title with the `[[links]]` and `[links](urls)` the old text had put
 * back. Things holds plain words, so a reworded to-do comes back without
 * them; a link whose display words still stand in the new title is wrapped
 * around them again. Other formatting (bold, code, highlights) isn't.
 */
export function relink(newTitle: string, oldText: string): string {
    let title = newTitle;
    for (const link of oldText.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]|!?\[([^\]]*)\]\([^)]*\)/g)) {
        const display = link[3] ?? link[2] ?? link[1];
        // A label with no words, like a sync tool's `[↗](…)` marker, stays where withTitle keeps it.
        if (!display || !WORD.test(display)) continue;
        const at = findOutsideLinks(title, display);
        if (at !== -1) title = `${title.slice(0, at)}${link[0]}${title.slice(at + display.length)}`;
    }
    return title;
}
