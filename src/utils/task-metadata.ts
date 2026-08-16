/**
 * Strip Tasks-plugin metadata from task text for display (issue #101).
 *
 * The Tasks plugin appends scheduling metadata to the task line in one of two
 * syntaxes, and both are noise when scanning a task list. This only affects what
 * the sidebar renders — the file is never modified, and `Task.text` keeps the
 * raw line so search, IDs and rewrites continue to see the real content.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 *
 * Matching is deliberately shape-aware rather than "delete everything after an
 * emoji": date signifiers must be followed by a date, priority signifiers carry
 * no value at all. A task that merely mentions an emoji in its prose keeps its
 * text intact.
 */

/** Signifiers that take a YYYY-MM-DD value: created, start, scheduled, due, done, cancelled. */
const DATE_SIGNIFIERS = '➕\u{1F6EB}⏳\u{1F4C5}✅❌';

/** Priority signifiers, which carry no value: highest, high, medium, low, lowest. */
const PRIORITY_SIGNIFIERS = '\u{1F53A}⏫\u{1F53C}\u{1F53D}⏬';

/** Signifiers followed by a single token: id, blocked by, on completion. */
const TOKEN_SIGNIFIERS = '\u{1F194}⛔\u{1F3C1}';

/** Recurrence, whose value is free text and runs to the end of the metadata. */
const RECURRENCE_SIGNIFIER = '\u{1F501}';

const ALL_SIGNIFIERS =
    DATE_SIGNIFIERS + PRIORITY_SIGNIFIERS + TOKEN_SIGNIFIERS + RECURRENCE_SIGNIFIER;

/** Inline-field keys the Tasks plugin writes in its Dataview-style format. */
const DATAVIEW_KEYS = [
    'due',
    'scheduled',
    'start',
    'created',
    'completion',
    'done',
    'cancelled',
    'repeat',
    'recurrence',
    'priority',
    'id',
    'dependsOn',
    'blockedBy',
    'onCompletion'
];

// [scheduled:: 2026-08-20] or (due:: 2026-08-21). Only the keys above, so a
// user's own inline fields survive.
const DATAVIEW_PATTERN = new RegExp(
    String.raw`\s*[\[(]\s*(?:${DATAVIEW_KEYS.join('|')})\s*::[^\])]*[\])]`,
    'gi'
);

const DATE_PATTERN = new RegExp(
    String.raw`\s*[${DATE_SIGNIFIERS}]\s*\d{4}-\d{2}-\d{2}`,
    'gu'
);

const PRIORITY_PATTERN = new RegExp(String.raw`\s*[${PRIORITY_SIGNIFIERS}]`, 'gu');

const TOKEN_PATTERN = new RegExp(String.raw`\s*[${TOKEN_SIGNIFIERS}]\s*\S+`, 'gu');

// Recurrence rules are free text ("every week"), so this runs until the next
// signifier or the end of the line.
const RECURRENCE_PATTERN = new RegExp(
    String.raw`\s*${RECURRENCE_SIGNIFIER}[^${ALL_SIGNIFIERS}]*`,
    'gu'
);

/**
 * Remove Tasks-plugin metadata from a task's text.
 * Returns the text unchanged when there is nothing to strip.
 */
export function stripTasksPluginMetadata(text: string): string {
    const stripped = text
        .replace(DATAVIEW_PATTERN, '')
        .replace(DATE_PATTERN, '')
        .replace(TOKEN_PATTERN, '')
        .replace(PRIORITY_PATTERN, '')
        .replace(RECURRENCE_PATTERN, '');

    // Collapse whitespace left behind by removals from the middle of a line.
    return stripped.replace(/\s{2,}/g, ' ').trim();
}
