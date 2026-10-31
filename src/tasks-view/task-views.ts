/**
 * What the Tasks tab shows: which tasks belong to each list in the rail, and
 * how a list breaks into groups and sections.
 *
 * The lists follow Things (Today, Upcoming, Anytime, Logbook) plus the two
 * statuses this plugin adds, and every note with open tasks can be opened as
 * its own list, the way a Things project is. Notes play the part of projects
 * and their headings the part of sections. Kept free of Obsidian imports so it
 * can be unit tested directly.
 */

import type { Task } from '../../main';
import { addDays, daysBetween, monthName, shortDate, startOfWeek, weekdayName } from './dates';
import { isResolvedStatus, normalizeVisibleNesting } from '../utils/task-status';

export type SmartListId = 'today' | 'upcoming' | 'anytime' | 'in-progress' | 'questions' | 'logbook';

export type ListRef =
    | { kind: 'smart'; id: SmartListId }
    /** `follow` is This note: the note shown is whichever one is open. */
    | { kind: 'note'; path: string; follow?: boolean };

export type GroupMode = 'auto' | 'note' | 'date' | 'priority' | 'none';
export type SortMode = 'file' | 'priority' | 'date' | 'alpha';

export interface DisplayOptions {
    group: GroupMode;
    sort: SortMode;
    showCompleted: boolean;
    /** With completed tasks shown, list them after the open ones. The note is never reordered. */
    completedLast: boolean;
    showContext: boolean;
}

export const DEFAULT_DISPLAY: DisplayOptions = {
    group: 'auto',
    sort: 'file',
    showCompleted: false,
    completedLast: true,
    showContext: true
};

export const SMART_LISTS: SmartListId[] = ['today', 'upcoming', 'anytime', 'in-progress', 'questions', 'logbook'];

export function sameList(a: ListRef, b: ListRef): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'smart') return a.id === (b as typeof a).id;
    const note = b as typeof a;
    // This note is one list whatever note it shows, and never the same list
    // as that note picked by hand.
    if (Boolean(a.follow) !== Boolean(note.follow)) return false;
    return a.follow === true || a.path === note.path;
}

/** Where This note goes when a file opens, or null when it stays where it is. */
export function followNote(list: ListRef, path: string | null): ListRef | null {
    if (list.kind !== 'note' || !list.follow) return null;
    if (!path || !path.endsWith('.md') || path === list.path) return null;
    return { kind: 'note', path, follow: true };
}

/** This note only makes sense beside a note, so away from the sidebar it hands over to Today. */
export function outsideSidebar(list: ListRef): ListRef {
    return list.kind === 'note' && list.follow ? { kind: 'smart', id: 'today' } : list;
}

export function listKey(ref: ListRef): string {
    return ref.kind === 'smart' ? `smart:${ref.id}` : `note:${ref.path}`;
}

export function statusOf(task: Task): Task['status'] {
    return task.status ?? (task.completed ? 'done' : 'todo');
}

export function isOpenTask(task: Task): boolean {
    return !isResolvedStatus(statusOf(task));
}

/** A key that survives the task's text changing, as long as it stays on its line. */
export function taskKey(task: Pick<Task, 'filePath' | 'lineNumber'>): string {
    return `${task.filePath}:${task.lineNumber}`;
}

/**
 * A list's own Display defaults. Today and Upcoming put the most important
 * task of each day first; everything else keeps the note's order.
 */
export function listDefaults(ref: ListRef): DisplayOptions {
    const byDay = ref.kind === 'smart' && (ref.id === 'today' || ref.id === 'upcoming');
    return byDay ? { ...DEFAULT_DISPLAY, sort: 'priority' } : DEFAULT_DISPLAY;
}

/** Due by today, or written in today's daily note without a date of its own. */
function dueToday(task: Task, today: string, dailyNote?: string | null): boolean {
    if (task.date) return task.date <= today;
    return !!dailyNote && task.filePath === dailyNote;
}

/**
 * The tasks a list holds. `lingering` keeps just-completed tasks in place for
 * a moment, so a tick is seen landing before the row leaves. `dailyNote` is
 * today's daily note, whose undated tasks count as today's.
 */
export function tasksForList(
    all: readonly Task[],
    ref: ListRef,
    today: string,
    display: DisplayOptions,
    lingering: ReadonlySet<string> = new Set(),
    dailyNote?: string | null
): Task[] {
    const keep = (task: Task, test: boolean) => test || lingering.has(taskKey(task));

    if (ref.kind === 'note') {
        return all.filter(task => task.filePath === ref.path && keep(task, display.showCompleted || isOpenTask(task)));
    }

    switch (ref.id) {
        case 'today':
            return all.filter(task => keep(task, isOpenTask(task) && dueToday(task, today, dailyNote)));
        case 'upcoming':
            return all.filter(task => keep(task, isOpenTask(task) && !!task.date && task.date > today));
        case 'anytime':
            return all.filter(task => keep(task, isOpenTask(task)));
        case 'in-progress':
            return all.filter(task => keep(task, statusOf(task) === 'in-progress'));
        case 'questions':
            return all.filter(task => keep(task, statusOf(task) === 'question'));
        case 'logbook':
            return all.filter(task => !isOpenTask(task));
    }
}

export interface ListCounts {
    today: number;
    overdue: number;
    upcoming: number;
    anytime: number;
    inProgress: number;
    questions: number;
}

export function listCounts(all: readonly Task[], today: string, dailyNote?: string | null): ListCounts {
    const counts: ListCounts = { today: 0, overdue: 0, upcoming: 0, anytime: 0, inProgress: 0, questions: 0 };
    for (const task of all) {
        if (!isOpenTask(task)) continue;
        counts.anytime++;
        const status = statusOf(task);
        if (status === 'in-progress') counts.inProgress++;
        if (status === 'question') counts.questions++;
        if (task.date) {
            if (task.date < today) counts.overdue++;
            if (task.date <= today) counts.today++;
            else counts.upcoming++;
        } else if (dueToday(task, today, dailyNote)) {
            counts.today++;
        }
    }
    return counts;
}

export interface TaskSection {
    key: string;
    /** A heading in the note, or '' for tasks above the first heading. */
    title: string;
    /** The heading's line, which tells apart two headings with the same name. */
    line?: number;
    tasks: Task[];
}

export type GroupKind = 'overdue' | 'date' | 'note' | 'heading' | 'priority' | 'flat';

/** Where a task added from a group's + button goes, and what it starts with. */
export interface AddTarget {
    path?: string;
    heading?: string;
    /** Which of two headings with the same name. */
    headingLine?: number;
    date?: string;
    priority?: 1 | 2 | 3;
}

export interface TaskGroup {
    key: string;
    kind: GroupKind;
    title: string;
    subtitle?: string;
    sections: TaskSection[];
    count: number;
    add?: AddTarget;
}

export interface GroupLabels {
    overdue: string;
    today: string;
    tomorrow: string;
    noDate: string;
    noPriority: string;
    priority: (level: 1 | 2 | 3) => string;
    weekOf: (date: string) => string;
}

export interface NoteInfo {
    basename: (path: string) => string;
    folder: (path: string) => string;
    /** Last modified time, used to list the notes you've been working in first. */
    mtime: (path: string) => number;
}

function compareFileOrder(a: Task, b: Task): number {
    return a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber;
}

function comparePriority(a: Task, b: Task): number {
    return (a.priority ?? 9) - (b.priority ?? 9);
}

/** By day, and within a day timed tasks first, earliest first. */
function compareDate(a: Task, b: Task): number {
    return (a.date ?? '9999').localeCompare(b.date ?? '9999') || compareTime(a, b);
}

function compareTime(a: Task, b: Task): number {
    return (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time ?? '').localeCompare(b.time ?? '');
}

function sortTasks(tasks: Task[], sort: SortMode): Task[] {
    const sorted = [...tasks];
    switch (sort) {
        case 'priority':
            return sorted.sort((a, b) => comparePriority(a, b) || compareDate(a, b) || compareFileOrder(a, b));
        case 'date':
            return sorted.sort((a, b) => compareDate(a, b) || comparePriority(a, b) || compareFileOrder(a, b));
        case 'alpha':
            return sorted.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }) || compareFileOrder(a, b));
        default:
            return sorted.sort(compareFileOrder);
    }
}

/** Says whether a task has finished, for moving it after the open ones. */
type Settle = (task: Task) => boolean;

/**
 * Moves finished tasks after the open ones, keeping each group's own order.
 * A family moves as one: a task goes with the top-level task it sits under,
 * so a done subtask stays with an open parent, and a done parent takes its
 * subtasks along.
 */
export function completedLast(tasks: readonly Task[], isFinished: Settle): Task[] {
    const open: Task[] = [];
    const done: Task[] = [];
    let bucket = open;
    for (const task of tasks) {
        if (task.indentLevel === 0) bucket = isFinished(task) ? done : open;
        bucket.push(task);
    }
    return [...open, ...done];
}

/**
 * Sorted and nested for display. A family sorts as one, by its top task,
 * and its subtasks stay under it in the note's order.
 */
function arrange(tasks: Task[], sort: SortMode, settle?: Settle): Task[] {
    const nested = normalizeVisibleNesting([...tasks].sort(compareFileOrder));
    const families = new Map<Task, Task[]>();
    let family: Task[] | null = null;
    for (const task of nested) {
        if (task.indentLevel === 0 || !family) {
            family = [task];
            families.set(task, family);
        } else {
            family.push(task);
        }
    }
    const laidOut = sortTasks([...families.keys()], sort).flatMap(head => families.get(head) ?? [head]);
    return settle ? completedLast(laidOut, settle) : laidOut;
}

function single(key: string, tasks: Task[], sort: SortMode, settle?: Settle): TaskSection[] {
    return [{ key, title: '', tasks: arrange(tasks, sort, settle) }];
}

/** Splits a note's tasks by heading, in the order the headings appear. */
/**
 * A note's tasks under their headings, each heading once and in the note's
 * order. Two headings with the same name stay apart: the first keeps the
 * plain key (so folds saved before still apply), and later ones number on.
 */
function byHeading(path: string, tasks: Task[], sort: SortMode, settle?: Settle): TaskSection[] {
    const sections = new Map<string, { title: string; line?: number; tasks: Task[] }>();
    for (const task of [...tasks].sort(compareFileOrder)) {
        const title = task.section ?? '';
        const line = task.section === undefined ? undefined : task.sectionLine;
        const id = line === undefined ? `title:${title}` : `line:${line}`;
        const section = sections.get(id);
        if (section) section.tasks.push(task);
        else sections.set(id, { title, line, tasks: [task] });
    }
    const seen = new Map<string, number>();
    return [...sections.values()].map(section => {
        const count = (seen.get(section.title) ?? 0) + 1;
        seen.set(section.title, count);
        return {
            key: count === 1 ? `${path}#${section.title}` : `${path}#${section.title}#${count}`,
            title: section.title,
            line: section.line,
            tasks: arrange(section.tasks, sort, settle)
        };
    });
}

function countOf(sections: TaskSection[]): number {
    return sections.reduce((sum, section) => sum + section.tasks.length, 0);
}

interface DateBucket {
    key: string;
    title: string;
    subtitle?: string;
    start: string;
}

/**
 * The group a future date falls in: each of the next six days on its own,
 * then weeks for the rest of the month ahead, then months, then years.
 */
export function upcomingBucket(iso: string, today: string, labels: GroupLabels, locale?: string): DateBucket {
    const diff = daysBetween(today, iso);
    if (diff <= 0) return { key: 'today', title: labels.today, start: today };
    if (diff < 7) {
        return {
            key: `day:${iso}`,
            title: diff === 1 ? labels.tomorrow : weekdayName(iso, 'long', locale),
            subtitle: shortDate(iso, today, locale),
            start: iso
        };
    }
    if (diff < 35) {
        const monday = startOfWeek(iso);
        return { key: `week:${monday}`, title: labels.weekOf(shortDate(monday, today, locale)), start: monday };
    }
    const sameYear = iso.slice(0, 4) === today.slice(0, 4);
    const monthsAhead = (Number(iso.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(iso.slice(5, 7)) - Number(today.slice(5, 7));
    if (monthsAhead < 12) {
        const first = `${iso.slice(0, 7)}-01`;
        const title = monthName(first, locale) + (sameYear ? '' : ` ${iso.slice(0, 4)}`);
        return { key: `month:${iso.slice(0, 7)}`, title, start: first };
    }
    return { key: `year:${iso.slice(0, 4)}`, title: iso.slice(0, 4), start: `${iso.slice(0, 4)}-01-01` };
}

/** The grouping a list uses when Display is left on its default. */
export function resolveGroupMode(ref: ListRef, mode: GroupMode): Exclude<GroupMode, 'auto'> | 'heading' {
    if (mode !== 'auto') return mode;
    if (ref.kind === 'note') return 'heading';
    switch (ref.id) {
        case 'today':
        case 'upcoming':
            return 'date';
        default:
            return 'note';
    }
}

export function buildGroups(
    tasks: readonly Task[],
    ref: ListRef,
    today: string,
    display: DisplayOptions,
    labels: GroupLabels,
    notes: NoteInfo,
    locale?: string,
    lingering: ReadonlySet<string> = new Set(),
    dailyNote?: string | null
): TaskGroup[] {
    const mode = resolveGroupMode(ref, display.group);
    const notePath = ref.kind === 'note' ? ref.path : undefined;
    // A task ticked a moment ago holds its place until it's done lingering.
    const settle: Settle | undefined = display.showCompleted && display.completedLast
        ? (task) => !isOpenTask(task) && !lingering.has(taskKey(task))
        : undefined;

    if (mode === 'heading' && notePath) {
        return byHeading(notePath, [...tasks], display.sort, settle).map(section => ({
            key: section.key,
            kind: 'heading',
            title: section.title,
            sections: [{ ...section, title: '' }],
            count: section.tasks.length,
            add: { path: notePath, heading: section.title || undefined, headingLine: section.line }
        }));
    }

    if (mode === 'note' || mode === 'heading') {
        const byNote = new Map<string, Task[]>();
        for (const task of tasks) {
            const list = byNote.get(task.filePath);
            if (list) list.push(task);
            else byNote.set(task.filePath, [task]);
        }
        return [...byNote.entries()]
            .sort(([a], [b]) => notes.mtime(b) - notes.mtime(a) || a.localeCompare(b))
            .map(([path, list]) => {
                const sections = byHeading(path, list, display.sort, settle);
                return {
                    key: `note:${path}`,
                    kind: 'note' as const,
                    title: notes.basename(path),
                    subtitle: notes.folder(path) || undefined,
                    sections,
                    count: countOf(sections),
                    add: { path }
                };
            });
    }

    if (mode === 'priority') {
        const levels: Array<1 | 2 | 3 | undefined> = [1, 2, 3, undefined];
        return levels
            .map(level => {
                const list = tasks.filter(task => task.priority === level);
                const key = `priority:${level ?? 'none'}`;
                return {
                    key,
                    kind: 'priority' as const,
                    title: level ? labels.priority(level) : labels.noPriority,
                    sections: single(key, list, display.sort, settle),
                    count: list.length,
                    add: { path: notePath, priority: level }
                };
            })
            .filter(group => group.count > 0);
    }

    if (mode === 'date') {
        const fromDaily = (task: Task) => !task.date && !!dailyNote && task.filePath === dailyNote;
        const overdue = tasks.filter(task => task.date && task.date < today);
        const dueToday = tasks.filter(task => task.date === today || fromDaily(task));
        const future = tasks.filter(task => task.date && task.date > today);
        const undated = tasks.filter(task => !task.date && !fromDaily(task));

        const groups: TaskGroup[] = [];
        if (overdue.length > 0) {
            groups.push({
                key: 'overdue', kind: 'overdue', title: labels.overdue,
                sections: single('overdue', overdue, display.sort === 'file' ? 'date' : display.sort),
                count: overdue.length
            });
        }
        if (dueToday.length > 0 || (ref.kind === 'smart' && ref.id === 'today')) {
            groups.push({
                key: 'today', kind: 'date', title: labels.today, subtitle: shortDate(today, today, locale),
                sections: single('today', dueToday, display.sort, settle), count: dueToday.length,
                add: { path: notePath, date: today }
            });
        }

        const buckets = new Map<string, { bucket: DateBucket; tasks: Task[] }>();
        for (const task of [...future].sort((a, b) => (a.date as string).localeCompare(b.date as string))) {
            const bucket = upcomingBucket(task.date as string, today, labels, locale);
            const entry = buckets.get(bucket.key);
            if (entry) entry.tasks.push(task);
            else buckets.set(bucket.key, { bucket, tasks: [task] });
        }
        for (const { bucket, tasks: list } of buckets.values()) {
            // Days keep the chosen order inside them; wider buckets read better
            // by date, with priority breaking ties.
            const wide = !bucket.key.startsWith('day:');
            const sort = wide && (display.sort === 'file' || display.sort === 'priority') ? 'date' : display.sort;
            groups.push({
                key: bucket.key, kind: 'date', title: bucket.title, subtitle: bucket.subtitle,
                sections: single(bucket.key, list, sort, settle), count: list.length,
                add: { path: notePath, date: bucket.start }
            });
        }

        if (undated.length > 0) {
            groups.push({
                key: 'no-date', kind: 'date', title: labels.noDate,
                sections: single('no-date', undated, display.sort, settle), count: undated.length,
                add: { path: notePath }
            });
        }
        return groups;
    }

    return [{ key: 'all', kind: 'flat', title: '', sections: single('all', [...tasks], display.sort, settle), count: tasks.length, add: { path: notePath } }];
}

export interface RailNote {
    path: string;
    name: string;
    open: number;
}

export interface RailArea {
    folder: string;
    notes: RailNote[];
}

function openCounts(all: readonly Task[]): Map<string, number> {
    const open = new Map<string, number>();
    for (const task of all) {
        if (!isOpenTask(task)) continue;
        open.set(task.filePath, (open.get(task.filePath) ?? 0) + 1);
    }
    return open;
}

/**
 * Notes with open tasks for the rail, collected under their folders the way
 * Things collects projects under areas. Folders sort by name and notes by
 * name inside them, so a note stays where you last saw it. Pinned notes,
 * listed in `leaveOut`, show in their own section instead.
 */
export function railAreas(all: readonly Task[], notes: NoteInfo, leaveOut: ReadonlySet<string> = new Set()): RailArea[] {
    const open = openCounts(all);

    const areas = new Map<string, RailNote[]>();
    for (const [path, count] of open) {
        if (leaveOut.has(path)) continue;
        const folder = notes.folder(path);
        const list = areas.get(folder);
        const note = { path, name: notes.basename(path), open: count };
        if (list) list.push(note);
        else areas.set(folder, [note]);
    }

    return [...areas.entries()]
        .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
        .map(([folder, list]) => ({
            folder,
            notes: list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        }));
}

/**
 * The rail's pinned notes, in the order they were pinned, each with its
 * open count. A pinned note stays even with nothing open; one that no longer
 * exists is left out.
 */
export function railPinned(pins: readonly string[], all: readonly Task[], notes: NoteInfo, exists: (path: string) => boolean): RailNote[] {
    const open = openCounts(all);
    return pins.filter(exists).map(path => ({ path, name: notes.basename(path), open: open.get(path) ?? 0 }));
}

/** The pins with a note added at the end, or taken out when it's already pinned. */
export function togglePin(pins: readonly string[], path: string): string[] {
    return pins.includes(path) ? pins.filter(pin => pin !== path) : [...pins, path];
}

/** The pins with one moved in front of another, or to the end when `before` is null. */
export function movePin(pins: readonly string[], path: string, before: string | null): string[] {
    if (!pins.includes(path) || path === before) return [...pins];
    const rest = pins.filter(pin => pin !== path);
    const at = before === null ? -1 : rest.indexOf(before);
    return at === -1 ? [...rest, path] : [...rest.slice(0, at), path, ...rest.slice(at)];
}

/** The note icons after a note moved from `from` to `to`, or null when it had none. */
export function renamedIcons(icons: Readonly<Record<string, string>>, from: string, to: string): Record<string, string> | null {
    if (!(from in icons)) return null;
    const next: Record<string, string> = {};
    for (const [path, icon] of Object.entries(icons)) next[path === from ? to : path] = icon;
    return next;
}

/** The pins after a note moved from `from` to `to`, or null when it wasn't pinned. */
export function renamedPins(pins: readonly string[], from: string, to: string): string[] | null {
    return pins.includes(from) ? pins.map(pin => (pin === from ? to : pin)) : null;
}

/** "Note › Heading", shown on a row whenever its group isn't already that note. */
export function breadcrumbFor(task: Task, groupKind: GroupKind, notes: NoteInfo): string | undefined {
    if (groupKind === 'note' || groupKind === 'heading') return undefined;
    const name = notes.basename(task.filePath);
    return task.section ? `${name} › ${task.section}` : name;
}

/** Sub-task progress for a row: how many of a task's direct children are done. */
export function childProgress(all: readonly Task[]): Map<string, { done: number; total: number }> {
    const progress = new Map<string, { done: number; total: number }>();
    for (const task of all) {
        if (task.parentLine === undefined) continue;
        const key = `${task.filePath}:${task.parentLine}`;
        const entry = progress.get(key) ?? { done: 0, total: 0 };
        entry.total++;
        if (!isOpenTask(task)) entry.done++;
        progress.set(key, entry);
    }
    return progress;
}

/** The day after a date, used by the "nudge a day" keys. */
export function nudge(iso: string | undefined, today: string, days: number): string {
    return addDays(iso ?? today, days);
}
