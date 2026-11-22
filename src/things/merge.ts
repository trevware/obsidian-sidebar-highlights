/**
 * Merging one to-do's fields three ways.
 *
 * Each field is compared with what the last round wrote. A field only the
 * note changed goes to Things, a field only Things changed comes back to the
 * note, and a field both changed takes the note's value, since the note is
 * the record. A field this copy of Things can't show the plugin (checklist
 * items, a reminder time) counts as unchanged on the Things side, so the
 * empty value read for it never wipes the note's.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import type { Capabilities, TodoFields } from './model';

const KEYS = ['title', 'notes', 'checklist', 'tags', 'status', 'when', 'reminder', 'someday'] as const;

/** Whether two field values match: lists item by item, objects key by key, and absent the same as undefined. */
function same(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
        const left = a as Record<string, unknown>;
        const right = b as Record<string, unknown>;
        return [...Object.keys(left), ...Object.keys(right)].every(key => same(left[key], right[key]));
    }
    return (a ?? undefined) === (b ?? undefined);
}

function put(target: Partial<TodoFields>, key: keyof TodoFields, value: unknown): void {
    (target as Record<string, unknown>)[key] = value;
}

/**
 * The fields where `from` differs from `to`, with `to`'s values: what brings
 * one side to agreed values. A key present with an `undefined` value clears
 * that field.
 */
export function differences(from: TodoFields, to: TodoFields): Partial<TodoFields> {
    const out: Partial<TodoFields> = {};
    for (const key of KEYS) if (!same(from[key], to[key])) put(out, key, to[key]);
    return out;
}

/**
 * What each side needs from the other, and the fields both will hold after.
 * A key present with an `undefined` value clears that field (a date or
 * reminder taken off).
 */
export function mergeFields(vault: TodoFields, things: TodoFields, written: TodoFields, caps: Capabilities): { toThings: Partial<TodoFields>; toVault: Partial<TodoFields>; merged: TodoFields } {
    const toThings: Partial<TodoFields> = {};
    const toVault: Partial<TodoFields> = {};
    const merged: TodoFields = { ...written };
    for (const key of KEYS) {
        const hidden = (key === 'checklist' && !caps.checklist) || (key === 'reminder' && !caps.reminder);
        const theirs = hidden ? written[key] : things[key];
        if (!same(vault[key], written[key])) {
            if (!same(vault[key], theirs)) put(toThings, key, vault[key]);
            put(merged, key, vault[key]);
        } else if (!same(theirs, written[key])) {
            put(toVault, key, theirs);
            put(merged, key, theirs);
        }
    }
    if (merged.when === undefined) delete merged.when;
    if (merged.reminder === undefined) delete merged.reminder;
    return { toThings, toVault, merged };
}
