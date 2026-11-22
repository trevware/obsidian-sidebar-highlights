/**
 * Things' `things:///` link commands, for the changes AppleScript can't make:
 * a project with headings (`json` create), a to-do under a heading, checklist
 * items, and a reminder on the When date. Commands that change an existing
 * item carry the user's Things URL token.
 *
 * Every value is percent-encoded with `encodeURIComponent`, so a title with
 * `#`, `&`, `%`, `[[`, a newline or an emoji arrives as typed, and every link
 * carries `reveal=false` so Things stays where it is.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import type { TodoFields } from './model';

const encode = encodeURIComponent;

/** A `json` command: create operations, and update operations when the token comes along. */
export function jsonCreateLink(items: object[], token?: string): string {
    const params = [`data=${encode(JSON.stringify(items))}`];
    if (token) params.push(`auth-token=${encode(token)}`);
    params.push('reveal=false');
    return `things:///json?${params.join('&')}`;
}

/** An `update` command for one to-do. An empty value clears that field in Things. */
export function updateLink(id: string, params: Record<string, string>, token: string): string {
    const parts = [`id=${encode(id)}`, `auth-token=${encode(token)}`];
    for (const key of Object.keys(params)) {
        if (key === 'id' || key === 'auth-token' || key === 'reveal') continue;
        parts.push(`${encode(key)}=${encode(params[key])}`);
    }
    parts.push('reveal=false');
    return `things:///update?${parts.join('&')}`;
}

/**
 * The `when` value for a to-do's fields. A date goes with its reminder
 * (`2026-11-23@15:00`) whenever the fields have one, since a date sent alone
 * takes the reminder off.
 */
export function whenParam(fields: Pick<TodoFields, 'when' | 'reminder' | 'someday'>): string {
    if (fields.someday) return 'someday';
    if (fields.when === undefined) return 'anytime';
    return fields.reminder === undefined ? fields.when : `${fields.when}@${fields.reminder}`;
}
