/**
 * One round of calendar sync, carried out: plan it, change the calendar,
 * then write what the notes need. Everything it touches is passed in, so it
 * runs against a fake calendar and fake notes in tests. Kept free of
 * Obsidian imports.
 */

import type { Task } from '../../main';
import { newCalendarId, readCalendarRef } from './ids';
import type { NoteEdit } from './note-edits';
import { planSync } from './plan';
import type { CalendarEvent, NoteInfo, SyncOptions, SyncTask, Written } from './plan';
import type { CalendarProvider, EventDraft } from './providers/types';
import { reminderTitle } from '../tasks-view/reminders';

export interface RoundDeps {
    tasks: readonly SyncTask[];
    provider: CalendarProvider;
    options: SyncOptions;
    notes: NoteInfo;
    now: number;
    /** The event to write for a task's words, day and time. */
    draft(id: string, fields: { title: string; date: string; time?: string; path: string }, written: Written): EventDraft;
    /** A day and a time as the vault writes them. */
    formatDate(iso: string): string;
    formatTime(time: string): string;
    /** The line written under a task whose date was cleared. */
    clearedNote(dateText: string): string;
    /** Makes edits in one note; resolves to how many tasks couldn't be found. */
    editNote(path: string, edits: NoteEdit[]): Promise<number>;
    newId?: () => string;
}

export interface RoundResult {
    created: number;
    updated: number;
    pulled: number;
    cleared: number;
    removed: number;
    /** Tasks that changed before their note could be written; the next round picks them up. */
    missed: number;
    /** The calendar looked emptied, so nothing was changed. */
    stopped?: { missing: number };
}

/** The tasks sync looks at: those with a date or a calendar ID. */
export function syncTasks(tasks: readonly Task[], hideMetadata: boolean, untitled: string): SyncTask[] {
    const out: SyncTask[] = [];
    for (const task of tasks) {
        const ref = readCalendarRef(task.text);
        if (!task.date && !ref) continue;
        out.push({
            path: task.filePath,
            line: task.lineNumber,
            text: task.text,
            ref,
            title: reminderTitle(task.text, task.dateText, hideMetadata) || untitled,
            date: task.date,
            time: task.time,
            dateText: task.dateText,
            timeText: task.timeText,
            open: task.status !== 'done' && task.status !== 'cancelled'
        });
    }
    return out;
}

export async function runRound(deps: RoundDeps): Promise<RoundResult> {
    const result: RoundResult = { created: 0, updated: 0, pulled: 0, cleared: 0, removed: 0, missed: 0 };
    const events: CalendarEvent[] = await deps.provider.list();
    const plan = planSync(deps.tasks, events, deps.options, deps.notes, deps.now);
    if (!plan.ok) return { ...result, stopped: { missing: plan.missing } };

    const newId = deps.newId ?? (() => newCalendarId());
    const edits = new Map<string, NoteEdit[]>();
    const edit = (path: string, change: NoteEdit) => edits.set(path, [...(edits.get(path) ?? []), change]);
    /** Events to mark as seen once the note took the calendar's change. */
    const afterPull: Array<{ path: string; text: string; draft: EventDraft }> = [];

    const written = (task: SyncTask, rev: number, date: string, time?: string): Written => (
        { rev, date, time, title: task.title, path: task.path, at: deps.now }
    );

    for (const step of plan.steps) {
        switch (step.kind) {
            case 'create': {
                const { task } = step;
                const id = newId();
                await deps.provider.create(deps.draft(id, { ...task, date: task.date! }, written(task, 0, task.date!, task.time)));
                edit(task.path, { kind: 'ref', line: task.line, text: task.text, ref: { id, rev: 0 } });
                result.created++;
                break;
            }
            case 'update': {
                const { task } = step;
                await deps.provider.update(deps.draft(step.id, { ...task, date: task.date! }, written(task, step.rev, task.date!, task.time)));
                result.updated++;
                break;
            }
            case 'pull': {
                const { task, event, rev } = step;
                edit(task.path, {
                    kind: 'due', line: task.line, text: task.text, dateText: task.dateText, timeText: task.timeText,
                    date: deps.formatDate(event.date), time: event.time ? deps.formatTime(event.time) : null,
                    ref: { id: event.id, rev }
                });
                afterPull.push({
                    path: task.path,
                    text: task.text,
                    draft: deps.draft(event.id, { ...task, date: event.date, time: event.time }, written(task, rev, event.date, event.time))
                });
                result.pulled++;
                break;
            }
            case 'clear': {
                const { task } = step;
                edit(task.path, { kind: 'clear', line: task.line, text: task.text, dateText: task.dateText, note: deps.clearedNote(task.dateText ?? task.date ?? '') });
                result.cleared++;
                break;
            }
            case 'unlink': {
                const { task } = step;
                edit(task.path, { kind: 'ref', line: task.line, text: task.text, ref: null });
                break;
            }
            case 'remove':
                await deps.provider.remove(step.id);
                result.removed++;
                break;
        }
    }

    const missedIn = new Map<string, number>();
    for (const [path, changes] of edits) {
        const missed = await deps.editNote(path, changes);
        missedIn.set(path, missed);
        result.missed += missed;
    }
    // A pull whose note couldn't be written leaves the event as it is; the
    // next round sees the same move and tries again.
    for (const pull of afterPull) {
        if (!missedIn.get(pull.path)) await deps.provider.update(pull.draft);
    }
    return result;
}
