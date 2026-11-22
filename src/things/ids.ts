/**
 * The Things ID a synced task carries at the end of its line.
 *
 * Written as an Obsidian comment, `%%things:4FdDY8gKGP5sh5Ry4FLzGg%%`, so
 * reading view already hides it, and Sidebar Highlights hides it everywhere
 * else. The ID names the task's to-do in Things, so the line alone finds its
 * to-do and rewording a task keeps it. It sits after the task's text and
 * before any calendar ID.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

/** One Things ID comment, anywhere in a line. Things' own IDs are alphanumeric, usually 22 characters. */
export const THINGS_ID_SOURCE = String.raw`%%things:([A-Za-z0-9]{8,40})%%`;

const ANYWHERE = new RegExp(THINGS_ID_SOURCE);
const EVERY = new RegExp(String.raw`[ \t]*${THINGS_ID_SOURCE}`, 'g');
/** A native comment's inner text that is a Things ID, so the sidebar can skip it. */
const INNER = /^things:[A-Za-z0-9]{8,40}$/;
const CALENDAR_ID = /[ \t]*%%cal:[0-9a-v]{12}(?::\d{1,6})?%%/;

/** The Things ID in a task's text, if it has one. */
export function readThingsId(text: string): string | undefined {
    return text.match(ANYWHERE)?.[1];
}

/** A task's text with no Things ID in it, for showing, copying and titles. */
export function stripThingsId(text: string): string {
    return text.replace(EVERY, '');
}

/** A task's text carrying this Things ID, after the words and before any calendar ID. */
export function withThingsId(text: string, id: string | null): string {
    const body = stripThingsId(text);
    if (!id) return body.trimEnd();
    const calendar = body.match(CALENDAR_ID);
    if (calendar && calendar.index !== undefined) {
        return `${body.slice(0, calendar.index).trimEnd()} %%things:${id}%%${body.slice(calendar.index)}`;
    }
    return `${body.trimEnd()} %%things:${id}%%`;
}

/** Whether a native comment's inner text is a Things ID, which the Highlights sidebar never lists. */
export function isThingsComment(inner: string): boolean {
    return INNER.test(inner.trim());
}
