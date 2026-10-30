/**
 * Deciding what one round of calendar sync does.
 *
 * Every dated open task has an event in the calendar the plugin keeps for
 * the vault. The task's line carries the event's ID (see ids.ts), and the
 * event carries what the plugin last wrote into it, so either side can tell
 * which one changed since the last round:
 *
 * - The task changed (reworded, re-dated, re-timed): the event follows.
 * - The event was moved in the calendar: the task takes its new day and time.
 * - Both changed: the note wins.
 * - The event was deleted in the calendar: the task's date and time are
 *   cleared, with a dated note under it saying why, unless the user turned
 *   that off, in which case the event comes back.
 * - The task was completed, cancelled, lost its date, or was removed from its
 *   note: its event goes.
 *
 * Nothing here touches a note or a calendar. It returns the steps, and the
 * caller carries them out. Kept free of Obsidian imports so it can be unit
 * tested directly.
 */

import type { CalendarRef } from './ids';

/** A task line, as sync sees it. Tasks with neither a date nor an ID never reach the planner. */
export interface SyncTask {
    path: string;
    line: number;
    /** The task's text as written, to find its line again. */
    text: string;
    ref?: CalendarRef;
    /** The task's words as the event shows them. */
    title: string;
    date?: string;
    time?: string;
    /** The date and time exactly as written in the line, to rewrite them in place. */
    dateText?: string;
    timeText?: string;
    /** Still to do: not done and not cancelled. */
    open: boolean;
}

/** What the plugin last wrote into an event, kept on the event itself. */
export interface Written {
    rev: number;
    date: string;
    time?: string;
    title: string;
    /** The note the task was in. */
    path: string;
    /** When it was written, in milliseconds. */
    at: number;
}

/** An event in the vault's calendar, in the device's own time. */
export interface CalendarEvent {
    id: string;
    date: string;
    /** Absent for an all-day event. */
    time?: string;
    title: string;
    /** Absent for an event the plugin didn't make, which it never touches. */
    written?: Written;
    /** Deleted in the calendar, where the calendar still lists deleted events. */
    cancelled?: boolean;
}

export interface SyncOptions {
    /** Only tasks with a time get an event. */
    timedOnly: boolean;
    /** An event deleted in the calendar clears its task's date and time; otherwise the event comes back. */
    clearOnDelete: boolean;
}

export interface NoteInfo {
    exists(path: string): boolean;
    /** When the note last changed, in milliseconds. */
    mtime(path: string): number;
}

export type SyncStep =
    /** A new event for a task with none (or whose event was deleted), then its ID written into the task's line. */
    | { kind: 'create'; task: SyncTask }
    /** The task's event brought in line with the task. */
    | { kind: 'update'; task: SyncTask; id: string; rev: number }
    /** The event's day and time written into the task, then the event marked as seen. */
    | { kind: 'pull'; task: SyncTask; event: CalendarEvent; rev: number }
    /** The event was deleted in the calendar: the task's date and time are cleared. */
    | { kind: 'clear'; task: SyncTask; event?: CalendarEvent }
    /** The ID taken off a task that no longer has an event. */
    | { kind: 'unlink'; task: SyncTask }
    /** An event deleted from the calendar. */
    | { kind: 'remove'; id: string };

export type SyncPlan =
    | { ok: true; steps: SyncStep[] }
    /** Too many events went missing at once to be the user's doing; nothing is changed. */
    | { ok: false; reason: 'calendar-emptied'; missing: number };

/**
 * Past this many, and this share of the synced tasks, events vanishing at
 * once mean the calendar was emptied or swapped, never that the user deleted
 * them one by one, so the round stops and no task is cleared.
 */
const MISSING_LIMIT = 3;
const MISSING_SHARE = 0.25;

/**
 * How long a note must sit unchanged before an event whose task left it is
 * removed. A task moved to another note leaves one note before it arrives in
 * the other, and on a second device the two can arrive minutes apart.
 */
export const SETTLE_MS = 5 * 60 * 1000;

export function eligible(task: SyncTask, options: SyncOptions): boolean {
    return task.open && Boolean(task.date) && (!options.timedOnly || Boolean(task.time));
}

function sameDue(a: { date?: string; time?: string }, b: { date?: string; time?: string }): boolean {
    return a.date === b.date && (a.time ?? '') === (b.time ?? '');
}

export function planSync(tasks: readonly SyncTask[], events: readonly CalendarEvent[], options: SyncOptions, notes: NoteInfo, now: number): SyncPlan {
    const steps: SyncStep[] = [];
    const byId = new Map<string, CalendarEvent>();
    for (const event of events) if (event.written) byId.set(event.id, event);

    // One line per ID: a copied line keeps the first, and the copy gets an event of its own.
    const ordered = [...tasks].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const claimed = new Set<string>();
    const seen: SyncTask[] = [];
    for (const task of ordered) {
        if (task.ref && claimed.has(task.ref.id)) {
            const copy = { ...task, ref: undefined };
            steps.push(eligible(copy, options) ? { kind: 'create', task } : { kind: 'unlink', task });
            continue;
        }
        if (task.ref) claimed.add(task.ref.id);
        seen.push(task);
    }

    const synced = seen.filter(task => task.ref);
    const missing = synced.filter(task => !byId.has(task.ref!.id) && eligible(task, options));
    if (missing.length > MISSING_LIMIT && missing.length > synced.length * MISSING_SHARE) {
        return { ok: false, reason: 'calendar-emptied', missing: missing.length };
    }

    for (const task of seen) {
        const wanted = eligible(task, options);
        if (!task.ref) {
            if (wanted) steps.push({ kind: 'create', task });
            continue;
        }
        const event = byId.get(task.ref.id);
        if (!event || event.cancelled) {
            if (!wanted) steps.push({ kind: 'unlink', task });
            else if (options.clearOnDelete) steps.push({ kind: 'clear', task, event });
            // Back under a new ID: Google never reuses a deleted event's.
            else steps.push({ kind: 'create', task });
            continue;
        }
        if (!wanted) {
            steps.push({ kind: 'remove', id: event.id }, { kind: 'unlink', task });
            continue;
        }
        const written = event.written!;
        // This device's copy of the note hasn't caught up with a change the
        // calendar made: leave it for the device that wrote it.
        if (task.ref.rev < written.rev) continue;

        const taskMoved = !sameDue(task, written);
        const eventMoved = !sameDue(event, written);
        if (eventMoved && !taskMoved) {
            steps.push({ kind: 'pull', task, event, rev: written.rev + 1 });
            continue;
        }
        const stale = taskMoved || eventMoved || task.title !== written.title || event.title !== task.title
            || task.path !== written.path || task.ref.rev > written.rev;
        if (stale) steps.push({ kind: 'update', task, id: event.id, rev: task.ref.rev });
    }

    // Events whose task is gone. Only when the task's note has changed since
    // the event was written and then sat still for a while, so a device whose
    // notes are still catching up never removes an event another device just
    // made, or one whose task is on its way to another note.
    for (const event of byId.values()) {
        if (claimed.has(event.id) || event.cancelled) continue;
        const written = event.written!;
        if (!notes.exists(written.path)) continue;
        const changed = notes.mtime(written.path);
        if (changed > written.at && now - changed >= SETTLE_MS) steps.push({ kind: 'remove', id: event.id });
    }

    return { ok: true, steps };
}
