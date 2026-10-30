/**
 * The calendar ID a synced task carries at the end of its line.
 *
 * Written as an Obsidian comment, `%%cal:0fq7k2m9vd3a%%`, so reading view
 * already hides it, and Sidebar Highlights hides it everywhere else. The ID
 * names the task's event in every calendar, so any device can find the event
 * from the line alone, and rewording a task keeps its event.
 *
 * After the ID may come a revision, `%%cal:0fq7k2m9vd3a:2%%`, bumped each
 * time a change made in the calendar is written into the note. The event
 * carries the revision it last saw, so a device whose copy of the note
 * hasn't caught up yet can tell, and leaves the event alone.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

/** Google's alphabet for event ids, which CalDAV and Outlook accept as plain text. */
const ALPHABET = '0123456789abcdefghijklmnopqrstuv';
const ID_LENGTH = 12;

/** One calendar ID comment, anywhere in a line. */
export const CALENDAR_ID_SOURCE = String.raw`%%cal:([0-9a-v]{${ID_LENGTH}})(?::(\d{1,6}))?%%`;

const ANYWHERE = new RegExp(CALENDAR_ID_SOURCE);
const EVERY = new RegExp(String.raw`[ \t]*${CALENDAR_ID_SOURCE}`, 'g');
/** A native comment's inner text that is a calendar ID, so the sidebar can skip it. */
const INNER = new RegExp(`^cal:[0-9a-v]{${ID_LENGTH}}(?::\\d{1,6})?$`);

export interface CalendarRef {
    id: string;
    /** How many times the calendar has changed this task. */
    rev: number;
}

export function newCalendarId(random: () => number = Math.random): string {
    let id = '';
    for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
    return id;
}

/** The calendar ID in a task's text, if it has one. */
export function readCalendarRef(text: string): CalendarRef | undefined {
    const match = text.match(ANYWHERE);
    return match ? { id: match[1], rev: match[2] ? Number(match[2]) : 0 } : undefined;
}

export function formatCalendarRef(ref: CalendarRef): string {
    return ref.rev ? `%%cal:${ref.id}:${ref.rev}%%` : `%%cal:${ref.id}%%`;
}

/** A task's text with no calendar ID in it, for showing, copying and titles. */
export function stripCalendarRef(text: string): string {
    return text.replace(EVERY, '');
}

/** A task's text carrying this calendar ID, always last on the line. */
export function withCalendarRef(text: string, ref: CalendarRef | null): string {
    const body = stripCalendarRef(text).trimEnd();
    return ref ? `${body} ${formatCalendarRef(ref)}` : body;
}

/** Whether a native comment's inner text is a calendar ID, which the Highlights sidebar never lists. */
export function isCalendarComment(inner: string): boolean {
    return INNER.test(inner.trim());
}
