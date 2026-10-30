/**
 * Writing a sync round's results into a note: a new task's calendar ID, a
 * day and time taken from a moved event, and a date cleared because its
 * event was deleted, with a dated line under the task saying so.
 *
 * Each edit finds its task again by line and text, so a note that shifted
 * since it was read still gets the right line, and a task that changed in
 * the meantime is left alone until the next round. Kept free of Obsidian
 * imports so it can be unit tested directly.
 */

import { withCalendarRef } from './ids';
import type { CalendarRef } from './ids';
import { locateTaskLine, parseTaskLine, setDueInText, subtaskLines, withText } from '../tasks-view/task-line';

interface Located {
    line: number;
    /** The task's text when it was read. */
    text: string;
}

export type NoteEdit =
    /** Give the task this calendar ID, or take its ID off with null. */
    | (Located & { kind: 'ref'; ref: CalendarRef | null })
    /** Set the task's day and time, already written in the vault's formats, and its new revision. */
    | (Located & { kind: 'due'; dateText?: string; timeText?: string; date: string; time: string | null; ref: CalendarRef })
    /** Clear the task's date and time, take its ID off, and write `note` under it. */
    | (Located & { kind: 'clear'; dateText?: string; note: string });

/** The note with the edits made, and how many tasks couldn't be found. */
export function applyNoteEdits(lines: readonly string[], edits: readonly NoteEdit[]): { lines: string[]; missed: number } {
    const out = [...lines];
    let missed = 0;
    // From the bottom up, so a line added under one task never moves another.
    const found = edits
        .map(edit => ({ edit, index: locateTaskLine(out, edit.line, edit.text) }))
        .sort((a, b) => b.index - a.index);

    for (const { edit, index } of found) {
        if (index === -1) {
            missed++;
            continue;
        }
        const text = parseTaskLine(out[index])!.text;
        let next: string;
        if (edit.kind === 'ref') {
            next = withCalendarRef(text, edit.ref);
        } else if (edit.kind === 'due') {
            next = withCalendarRef(setDueInText(text, edit, edit.date, edit.time), edit.ref);
        } else {
            next = withCalendarRef(setDueInText(text, edit, null), null);
        }
        out[index] = withText(out[index], next) ?? out[index];
        if (edit.kind === 'clear') {
            const placed = subtaskLines(out, index, [`- ${edit.note}`]);
            if (placed) out.splice(placed.at, 0, ...placed.lines);
        }
    }
    return { lines: out, missed };
}
