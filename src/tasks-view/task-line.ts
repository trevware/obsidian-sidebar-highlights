/**
 * Rewriting a single task line in a note.
 *
 * Everything the Tasks tab changes in a note goes through these: the checkbox
 * state, the date, and finding the line again after the note may have moved
 * under it. Kept free of Obsidian imports so it can be unit tested directly.
 */

import { CHECKBOX_REGEX_WITH_PREFIX } from '../utils/task-status';
import { CALENDAR_ID_SOURCE } from '../calendar/ids';

export interface ParsedTaskLine {
    prefix: string;
    indent: string;
    state: string;
    text: string;
}

export function parseTaskLine(line: string): ParsedTaskLine | null {
    const match = line.match(CHECKBOX_REGEX_WITH_PREFIX);
    if (!match) return null;
    const [, prefix, indent, state, text] = match;
    return { prefix: prefix ?? '', indent, state, text };
}

export function formatTaskLine(parsed: ParsedTaskLine): string {
    return `${parsed.prefix}${parsed.indent}- [${parsed.state}] ${parsed.text}`;
}

/** Replace the checkbox state, keeping callout prefix, indent and text. */
export function withState(line: string, state: string): string | null {
    const parsed = parseTaskLine(line);
    if (!parsed) return null;
    return formatTaskLine({ ...parsed, state });
}

/** Replace the task text, keeping callout prefix, indent and state. */
export function withText(line: string, text: string): string | null {
    const parsed = parseTaskLine(line);
    if (!parsed) return null;
    return formatTaskLine({ ...parsed, text });
}

/**
 * A trailing link whose label is a single symbol, such as the `[↗](…)` marker
 * a sync tool appends, and the calendar ID calendar sync writes after it. A
 * date goes in front of them, so they stay last on the line where their
 * owners expect them. A link with words in its label is part of the task's
 * own text and is left where it is.
 */
const TRAILING_MARKER = new RegExp(String.raw`(\s*(?:\[[^\p{L}\p{N}\s\]]{1,3}\]\([^)\s]+\)|${CALENDAR_ID_SOURCE}))+\s*$`, 'u');

/**
 * Set, change or remove a task's date inside its text.
 *
 * An existing date is replaced where it stands, so a note that keeps its dates
 * in front of the text keeps them there. A new date goes at the end of the
 * text, before any trailing marker link.
 */
export function setDateInText(text: string, oldDateText: string | undefined, newDate: string | null): string {
    if (oldDateText && text.includes(oldDateText)) {
        if (newDate) return text.replace(oldDateText, newDate);
        return text.replace(oldDateText, '').replace(/\s{2,}/g, ' ').trim();
    }

    if (!newDate) return text;

    const marker = text.match(TRAILING_MARKER);
    if (marker && marker.index !== undefined && marker.index > 0) {
        const body = text.slice(0, marker.index).trimEnd();
        return `${body} ${newDate}${text.slice(marker.index)}`;
    }
    return `${text.trimEnd()} ${newDate}`;
}

/**
 * A task's text with its date and time set. `date` and `time` come already
 * formatted. A null date takes the time with it; an undefined time keeps the
 * one the task has, exactly as it was written, and a null time removes it.
 */
export function setDueInText(text: string, task: { dateText?: string; timeText?: string }, date: string | null, time?: string | null): string {
    if (date === null) return setDateInText(text, task.dateText, null);
    return setDateInText(text, task.dateText, dateTimeText(date, time === undefined ? task.timeText : time ?? undefined));
}

/** The marker links at the end of a task's text, with the space before them, or ''. */
function trailingMarker(text: string): string {
    const marker = text.match(TRAILING_MARKER);
    return marker && marker.index !== undefined && marker.index > 0 ? text.slice(marker.index) : '';
}

/**
 * A task's words as you'd edit them: its text without its date and without a
 * trailing marker link, both of which keep their places when the words are
 * saved with `withTitle`.
 */
export function editableTitle(text: string, dateText: string | undefined): string {
    const marker = trailingMarker(text);
    let body = text.slice(0, text.length - marker.length);
    if (dateText && body.includes(dateText)) body = body.replace(dateText, '');
    return body.replace(/\s+/g, ' ').trim();
}

/**
 * A task's text with new words. A date that led the text stays in front, any
 * other date follows the words, and a trailing marker link stays last.
 */
export function withTitle(text: string, dateText: string | undefined, title: string): string {
    const marker = trailingMarker(text);
    const body = text.slice(0, text.length - marker.length);
    const words = title.replace(/\s+/g, ' ').trim();
    if (!dateText || !body.includes(dateText)) return `${words}${marker}`;
    const leads = body.trimStart().startsWith(dateText);
    return `${leads ? `${dateText} ${words}` : `${words} ${dateText}`}${marker}`;
}

/**
 * Find a task's line again. The recorded line number is tried first, then the
 * nearest line carrying exactly the same task text, so an edit made after the
 * note shifted still lands on the right task. Returns -1 when the task is gone
 * or when its text no longer appears at all.
 */
export function locateTaskLine(lines: string[], lineNumber: number, text: string): number {
    const atRecorded = lines[lineNumber];
    if (atRecorded !== undefined && parseTaskLine(atRecorded)?.text === text) {
        return lineNumber;
    }

    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < lines.length; i++) {
        if (parseTaskLine(lines[i])?.text !== text) continue;
        const distance = Math.abs(i - lineNumber);
        if (distance < bestDistance) {
            best = i;
            bestDistance = distance;
        }
    }
    return best;
}

export interface NewTaskLine {
    text: string;
    priority?: 1 | 2 | 3;
    /** Already formatted in the vault's date format. */
    date?: string;
    /** Already formatted in the vault's time format; written right after the date. */
    time?: string;
}

/** A date with its time after it, as a task line carries them. */
export function dateTimeText(date: string, time?: string): string {
    return time ? `${date} ${time}` : date;
}

/** The exact Markdown line quick add writes. */
export function buildTaskLine(task: NewTaskLine): string {
    const state = task.priority ? `!${task.priority}` : ' ';
    const text = task.date ? setDateInText(task.text.trim(), undefined, dateTimeText(task.date, task.time)) : task.text.trim();
    return `- [${state}] ${text}`;
}

/**
 * Where a new line goes in a note. Under a heading it goes at the top of the
 * heading's own tasks, above the first one and above any subheading; a
 * heading with no tasks yet takes it at the end of its notes, above blank
 * lines, so it joins the list there. Without a heading, or when the heading
 * cannot be found, it goes at the end of the note. Of two headings with the
 * same name, `near` picks the one closest to that line.
 */
export function insertionLine(lines: string[], heading?: string, near?: number): number {
    const headingRegex = /^(#{1,6})\s+(.+?)\s*$/;

    let start = -1;
    if (heading) {
        lines.forEach((line, index) => {
            if (line.match(headingRegex)?.[2].trim() !== heading) return;
            if (start === -1 || (near !== undefined && Math.abs(index - near) < Math.abs(start - near))) start = index;
        });
    }

    let end = lines.length;
    if (start !== -1) {
        for (let i = start + 1; i < lines.length; i++) {
            if (headingRegex.test(lines[i])) {
                end = i;
                break;
            }
            const task = parseTaskLine(lines[i]);
            if (task && !task.prefix && task.indent === '') return i;
        }
    }

    let insertAt = end;
    const floor = start === -1 ? 0 : start + 1;
    while (insertAt > floor && lines[insertAt - 1].trim() === '') insertAt--;
    return insertAt;
}

function indentWidth(text: string): number {
    return (text.match(/^\s*/)?.[0] ?? '').replace(/\t/g, '    ').length;
}

/**
 * The end (exclusive) of a task's block: the task line plus everything
 * indented beneath it, its notes and its subtasks, the way deleting a task in
 * Todoist takes its subtasks with it. Blank lines inside the block go with it;
 * blank lines after it stay.
 */
export function taskBlockEnd(lines: string[], index: number): number {
    const parsed = parseTaskLine(lines[index] ?? '');
    if (!parsed) return index + 1;
    const prefix = parsed.prefix;
    const base = indentWidth(parsed.indent);

    let end = index + 1;
    for (let i = index + 1; i < lines.length; i++) {
        let line = lines[i];
        if (prefix && line.startsWith(prefix.trimEnd())) line = line.slice(prefix.trimEnd().length).replace(/^ /, '');
        if (line.trim() === '') continue;
        if (indentWidth(line) > base) end = i + 1;
        else break;
    }
    return end;
}

/**
 * One step of list indent in a note: a tab when the note indents its lists
 * with tabs, else its smallest run of spaces, and a tab for a note with no
 * indented lists yet, which is how Obsidian indents by default.
 */
function indentStep(lines: string[], taskIndent: string): string {
    if (taskIndent.includes('\t')) return '\t';
    let spaces = Infinity;
    for (const line of lines) {
        const lead = line.replace(/^>+ ?/, '').match(/^([ \t]+)(?:[-*+]|\d+[.)])\s/)?.[1];
        if (!lead) continue;
        if (lead.includes('\t')) return '\t';
        spaces = Math.min(spaces, lead.length);
    }
    return spaces === Infinity ? '\t' : ' '.repeat(spaces);
}

/**
 * New lines as subtasks of the task at `index`: placed after its notes and
 * its last subtask, indented like its other subtasks, or one step deeper than
 * the task when it has none, and inside the same callout. Returns where they
 * go and the lines as they'll be written, or null when `index` isn't a task.
 */
export function subtaskLines(lines: string[], index: number, newLines: readonly string[]): { at: number; lines: string[] } | null {
    const parsed = parseTaskLine(lines[index] ?? '');
    if (!parsed) return null;
    const at = taskBlockEnd(lines, index);
    const prefix = parsed.prefix.trimEnd();
    const base = indentWidth(parsed.indent);

    let indent: string | undefined;
    for (let i = index + 1; i < at && indent === undefined; i++) {
        let line = lines[i];
        if (prefix && line.startsWith(prefix)) line = line.slice(prefix.length).replace(/^ /, '');
        const lead = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s/)?.[1];
        if (lead !== undefined && indentWidth(lead) > base) indent = lead;
    }
    indent ??= parsed.indent + indentStep(lines, parsed.indent);

    return { at, lines: newLines.map(line => `${parsed.prefix}${indent}${line}`) };
}

/**
 * The lines of notes under a task: the indented lines straight after it, up
 * to its first subtask or the first line that isn't indented under it. This
 * is the same rule the scanner uses for a task's context, so what the card
 * shows and what it rewrites are the same lines. Returns [start, end).
 */
export function contextRange(lines: string[], index: number): [number, number] {
    const parsed = parseTaskLine(lines[index] ?? '');
    const start = index + 1;
    if (!parsed) return [start, start];
    const prefix = parsed.prefix.trimEnd();
    const base = indentWidth(parsed.indent);

    let end = start;
    for (let i = start; i < lines.length; i++) {
        let line = lines[i];
        if (prefix && line.startsWith(prefix)) line = line.slice(prefix.length).replace(/^ /, '');
        if (line.trim() === '') continue;
        if (parseTaskLine(line)) break;
        if (indentWidth(line) > base) end = i + 1;
        else break;
    }
    return [start, end];
}

/** A task's notes as plain Markdown, with the shared indent taken off. */
export function notesText(context: readonly string[]): string {
    const filled = context.filter(line => line.trim() !== '');
    if (filled.length === 0) return '';
    const indent = Math.min(...filled.map(line => line.match(/^\s*/)?.[0].length ?? 0));
    return context.map(line => line.slice(Math.min(indent, line.match(/^\s*/)?.[0].length ?? 0))).join('\n');
}

/**
 * The note lines to write under a task for some Markdown. Each line is
 * indented one step deeper than the task (matching notes already there when
 * there are some), and keeps the callout prefix the task line has.
 */
export function notesLines(lines: string[], index: number, markdown: string): string[] {
    const parsed = parseTaskLine(lines[index] ?? '');
    if (!parsed) return [];
    const [start, end] = contextRange(lines, index);
    const existing = lines.slice(start, end).find(line => line.trim() !== '');
    const prefix = parsed.prefix;
    let indent: string;
    if (existing) {
        const body = prefix && existing.startsWith(prefix.trimEnd()) ? existing.slice(prefix.trimEnd().length).replace(/^ /, '') : existing;
        indent = body.match(/^\s*/)?.[0] ?? '';
    } else {
        indent = parsed.indent + (parsed.indent.includes('\t') ? '\t' : '    ');
    }

    const text = markdown.replace(/\s+$/, '');
    if (text.trim() === '') return [];
    return text.split('\n').map(line => (line.trim() === '' ? (prefix ? prefix.trimEnd() : '') : `${prefix}${indent}${line}`));
}

