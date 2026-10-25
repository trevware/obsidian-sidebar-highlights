/**
 * Rewriting a single task line in a note.
 *
 * Everything the Tasks tab changes in a note goes through these: the checkbox
 * state, the date, and finding the line again after the note may have moved
 * under it. Kept free of Obsidian imports so it can be unit tested directly.
 */

import { CHECKBOX_REGEX_WITH_PREFIX } from '../utils/task-status';

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
 * a sync tool appends. A date goes in front of it, so the marker stays last
 * on the line where the tool expects it. A link with words in its label is
 * part of the task's own text and is left where it is.
 */
const TRAILING_MARKER = /(\s*\[[^\p{L}\p{N}\s\]]{1,3}\]\([^)\s]+\))+\s*$/u;

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
}

/** The exact Markdown line quick add writes. */
export function buildTaskLine(task: NewTaskLine): string {
    const state = task.priority ? `!${task.priority}` : ' ';
    const text = task.date ? setDateInText(task.text.trim(), undefined, task.date) : task.text.trim();
    return `- [${state}] ${text}`;
}

/**
 * Where a new line goes in a note: the end of the named heading's section
 * (before the next heading at the same or a higher level), or the end of the
 * note when there is no heading or it cannot be found. Trailing blank lines
 * of the section are skipped so the task joins the list above it.
 */
export function insertionLine(lines: string[], heading?: string): number {
    const headingRegex = /^(#{1,6})\s+(.+?)\s*$/;

    let start = -1;
    let level = 0;
    if (heading) {
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(headingRegex);
            if (match && match[2].trim() === heading) {
                start = i;
                level = match[1].length;
                break;
            }
        }
    }

    let end = lines.length;
    if (start !== -1) {
        for (let i = start + 1; i < lines.length; i++) {
            const match = lines[i].match(headingRegex);
            if (match && match[1].length <= level) {
                end = i;
                break;
            }
        }
    }

    let insertAt = end;
    const floor = start === -1 ? 0 : start + 1;
    while (insertAt > floor && lines[insertAt - 1].trim() === '') insertAt--;
    return insertAt;
}
