/**
 * The state Things sync keeps between rounds (`things-state.json` in the
 * plugin's folder): reading it back, starting fresh, and following notes and
 * folders the user renames, so a renamed note keeps its project.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import { EMPTY_STATE } from './model';
import type { ThingsState } from './model';

/** A new empty state, never the shared `EMPTY_STATE` itself. */
export function freshState(): ThingsState {
    return JSON.parse(JSON.stringify(EMPTY_STATE)) as ThingsState;
}

/** The saved state, or a fresh one when there is none or it isn't a state this version wrote. */
export function parseState(text: string | null): ThingsState {
    if (!text) return freshState();
    try {
        const value = JSON.parse(text) as Partial<ThingsState> | null;
        if (
            value && !Array.isArray(value) && value.version === 1
            && Array.isArray(value.areas) && Array.isArray(value.projects) && Array.isArray(value.todos)
            && typeof value.inboxNote === 'string' && value.looseNotes && typeof value.looseNotes === 'object'
        ) {
            return { ...freshState(), ...value };
        }
    } catch {
        // A broken file starts over; the IDs on the lines join everything up again.
    }
    return freshState();
}

/**
 * The state with a note (or, with `folder`, a folder and everything in it)
 * renamed from one path to another. A folder only matches whole path parts,
 * so renaming `Work` leaves `Workshop` alone.
 */
export function renameInState(state: ThingsState, from: string, to: string, folder: boolean): ThingsState {
    const move = (path: string): string => {
        if (path === from) return to;
        if (folder && path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
        return path;
    };
    const next = JSON.parse(JSON.stringify(state)) as ThingsState;
    next.areas = next.areas.map(area => ({ ...area, folder: folder ? move(area.folder) : area.folder }));
    next.projects = next.projects.map(project => ({ ...project, path: move(project.path) }));
    next.todos = next.todos.map(todo => ({ ...todo, place: { ...todo.place, path: move(todo.place.path) } }));
    next.inboxNote = move(next.inboxNote);
    next.looseNotes = Object.fromEntries(Object.entries(next.looseNotes).map(([area, path]) => [area, move(path)]));
    return next;
}
