/**
 * First connect: what already exists on both sides is joined by name before
 * the first round is planned, so connecting doesn't copy everything twice.
 * A name joins when it matches exactly, and also where Things' import would
 * land, so names made file-safe on the way in still join.
 *
 * - An area joins the folder its title names in full, exactly or made
 *   file-safe (`folderFor`): "Work/People" joins `Work/People`, "C#" joins
 *   `C#`, and "People" doesn't join `Work/People`. It also joins that folder
 *   when one of its projects would land on a note there that holds no open
 *   tasks.
 * - An open project joins the note in its area's folder (or at the top of
 *   the vault, for a project in no area) named exactly by its title, by that
 *   title with spaces evened out, or as its import would name it
 *   (`noteName`), whether that note has open tasks or none.
 * - In each joined project, an open to-do joins an open line with no ID and
 *   the same words (trimmed, spaces evened out): under the same heading
 *   first, then the first in line order. The planner gives that line the
 *   to-do's ID (its `adopt` step).
 * - A joined pair agrees on each field (`agreedFields`): the note's value
 *   when the note has one, Things' when it doesn't, and the line's place.
 *   Tags count without the status and priority tags, which always follow the
 *   line's checkbox. The planner sends each side what differs from that.
 * - A joined note's headings are its own, in its order, then the Things
 *   headings holding to-dos that come into it (`joinedHeadings`).
 *
 * The state records each joined to-do so that, if the first round stops
 * partway, the ordinary three-way merge finishes it: per field, the note's
 * value where it differs from the agreed one, Things' value where it doesn't,
 * and Things' place.
 *
 * Repeating to-dos and those in the Logbook or the Trash are never joined or
 * imported, and neither are done lines. Joining its own result joins the same
 * pairs again, so the round can start from it and the planner can join again.
 * `joined` stays false: the round sets it once a first round succeeds.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import { folderFor, noteName, statusFromTags } from './mapping';
import { differences } from './merge';
import type { Place, SyncedProject, ThingsProject, ThingsSnapshot, ThingsState, ThingsTodo, TodoFields, VaultNote, VaultSnapshot, VaultTask } from './model';

/** Whether a to-do from Things may come into the vault: open, and not repeating, logged or trashed. */
export function importable(todo: ThingsTodo): boolean {
    return !todo.trashed && !todo.logged && !todo.repeating && todo.fields.status === 'open';
}

/** A to-do with a Deadline and no When date takes the deadline as its date, unless it's in Someday. */
export function withDeadline(todo: ThingsTodo): ThingsTodo {
    if (todo.deadline === undefined || todo.fields.when !== undefined || todo.fields.someday) return todo;
    return { ...todo, fields: { ...todo.fields, when: todo.deadline } };
}

/** A title's words, trimmed and with runs of spaces as one. */
export const titleWords = (title: string): string => title.trim().replace(/\s+/g, ' ');

/** Tags split into the status and priority tags a checkbox stands for, and the rest. */
function splitTags(tags: string[]): { checkbox: string[]; own: string[] } {
    const own = statusFromTags(tags).tags;
    return { checkbox: tags.filter(tag => !own.includes(tag)), own };
}

/** The fields a joined pair agrees on: the note's where it has a value, Things' where it doesn't. */
export function agreedFields(vault: TodoFields, things: TodoFields): TodoFields {
    const dated = vault.when !== undefined || vault.someday;
    const line = splitTags(vault.tags);
    const own = line.own.length > 0 ? line.own : splitTags(things.tags).own;
    const fields: TodoFields = {
        // The words match, so the line's spelling of them stands.
        title: vault.title,
        notes: vault.notes.trim() !== '' ? vault.notes : things.notes,
        checklist: vault.checklist.length > 0 ? vault.checklist : things.checklist,
        tags: [...new Set([...own, ...line.checkbox])].sort(),
        status: vault.status,
        someday: dated ? vault.someday : things.someday
    };
    const when = dated ? vault.when : things.when;
    // Things' time stays on the agreed date when the line has no time of its own.
    const reminder = vault.reminder ?? (when === undefined ? undefined : things.reminder);
    if (when !== undefined) fields.when = when;
    if (reminder !== undefined) fields.reminder = reminder;
    return fields;
}

/** What the state records for a joined pair: the note's value where it differs from the agreed one, Things' where it doesn't. */
function lastWritten(vault: TodoFields, things: TodoFields): TodoFields {
    const written: TodoFields = { ...things, ...differences(agreedFields(vault, things), vault) };
    if (written.when === undefined) delete written.when;
    if (written.reminder === undefined) delete written.reminder;
    return written;
}

/** On first connect, the headings a joined note ends with: its own, in its order, then Things' headings holding to-dos that come into it. */
export function joinedHeadings(noteHeadings: readonly string[], project: ThingsProject, todos: readonly ThingsTodo[], incoming: (todo: ThingsTodo) => boolean): string[] {
    const holds = (heading: string) => todos.some(t => t.projectId === project.id && t.heading === heading && incoming(t));
    return [...noteHeadings, ...(project.headings ?? []).filter(h => !noteHeadings.includes(h) && holds(h))];
}

/**
 * The state with what joins by name recorded, and each line that takes a
 * joined to-do's ID. `exists` tells a note with no open tasks (left out of
 * the snapshot) from no note at all.
 */
export function joinByName(vault: VaultSnapshot, things: ThingsSnapshot, state: ThingsState, exists: (path: string) => boolean = () => false): { state: ThingsState; adopted: Map<VaultTask, string> } {
    const todos = things.todos.map(withDeadline);
    const areas = [...state.areas];
    const projects = [...state.projects];
    const synced = new Map(state.todos.map(t => [t.id, t]));
    const adopted = new Map<VaultTask, string>();
    const byPath = new Map(vault.notes.map(n => [n.path, n]));
    const isNote = (path: string) => byPath.has(path) || exists(path);
    const open = (project: ThingsProject) => !project.trashed && project.status === 'open';
    /** The notes a project would join in a folder, best first: its exact title, that title with spaces evened out, then where its import would land. */
    const notesFor = (project: ThingsProject, folder: string): string[] => {
        const exact = [project.title, titleWords(project.title)].filter(name => name !== '' && !name.includes('/'));
        return [...new Set([...exact.map(name => `${folder ? `${folder}/` : ''}${name}.md`), noteName(project.title, () => false, folder)])];
    };

    // An area joins the folder named exactly by its title, else the one its import would make.
    const folders = new Set([...vault.notes.map(n => n.folder), ...vault.folders].filter(Boolean));
    for (const area of things.areas) {
        if (areas.some(a => a.id === area.id)) continue;
        const lands = (folder: string) => things.projects.some(p => p.areaId === area.id && open(p) && notesFor(p, folder).some(isNote));
        const folder = [area.title, folderFor(area.title)].find(f => f !== '' && !areas.some(a => a.folder === f) && (folders.has(f) || lands(f)));
        if (folder !== undefined) areas.push({ id: area.id, folder });
    }

    const lists = new Set([state.inboxNote, ...Object.values(state.looseNotes)]);
    const joinedNow: Array<{ sp: SyncedProject; project: ThingsProject; note?: VaultNote }> = [];
    for (const project of things.projects) {
        if (!open(project) || projects.some(p => p.id === project.id)) continue;
        const folder = project.areaId === undefined ? '' : areas.find(a => a.id === project.areaId)?.folder;
        if (folder === undefined) continue;
        const path = notesFor(project, folder).find(p => isNote(p) && !lists.has(p) && !projects.some(sp => sp.path === p));
        if (path === undefined) continue;
        const sp: SyncedProject = { id: project.id, path, title: project.title, headings: [], ...(project.areaId === undefined ? {} : { areaId: project.areaId }) };
        projects.push(sp);
        joinedNow.push({ sp, project, note: byPath.get(path) });
    }

    const onLines = new Set(vault.notes.flatMap(n => n.tasks.map(t => t.id)));
    const live = new Set(things.projects.filter(p => !p.trashed).map(p => p.id));
    const paired = new Set<string>();
    for (const sp of projects) {
        const note = byPath.get(sp.path);
        if (!note || !live.has(sp.id)) continue;
        const lines = note.tasks.filter(t => t.id === undefined && t.fields.status === 'open').sort((a, b) => a.line - b.line);
        const candidates = todos.filter(t => t.projectId === sp.id && importable(t) && !onLines.has(t.id));
        const free = (todo: ThingsTodo) => lines.filter(t => !adopted.has(t) && titleWords(t.fields.title) === titleWords(todo.fields.title));
        const pair = (todo: ThingsTodo, task: VaultTask | undefined) => {
            if (!task || paired.has(todo.id)) return;
            paired.add(todo.id);
            adopted.set(task, todo.id);
            // Where Things has it, so the merge moves it to the line's place. A heading Things can't show is taken as none.
            const heading = things.capabilities.headings ? todo.heading : undefined;
            const place: Place = heading === undefined ? { path: note.path } : { path: note.path, heading };
            synced.set(todo.id, { id: todo.id, place, fields: lastWritten(task.fields, todo.fields) });
        };
        if (things.capabilities.headings) for (const todo of candidates) pair(todo, free(todo).find(t => t.heading === todo.heading));
        for (const todo of candidates) if (!paired.has(todo.id)) pair(todo, free(todo)[0]);
    }

    // A line that already carries an ID the state doesn't know (the state was
    // lost, or another Mac kept it): what the note has counts as last written,
    // so whatever Things changed since, on the phone say, comes into the note.
    const todoById = new Map(todos.map(todo => [todo.id, todo]));
    for (const note of vault.notes) {
        for (const task of note.tasks) {
            if (task.id === undefined || synced.has(task.id)) continue;
            const todo = todoById.get(task.id);
            if (!todo || todo.trashed) continue;
            const place: Place = task.heading === undefined ? { path: task.path } : { path: task.path, heading: task.heading };
            synced.set(task.id, { id: task.id, place, fields: JSON.parse(JSON.stringify(task.fields)) as TodoFields });
        }
    }

    // To-dos that come into a joined note are the importable ones nothing knows yet.
    const incoming = (todo: ThingsTodo) => importable(todo) && !synced.has(todo.id) && !onLines.has(todo.id);
    for (const { sp, project, note } of joinedNow) {
        const own = note?.headings ?? [];
        sp.headings = things.capabilities.headings ? joinedHeadings(own, project, todos, incoming) : [...own];
    }

    return { state: { ...state, areas, projects, todos: [...synced.values()] }, adopted };
}

/** The state with the areas, projects and to-dos that join by name recorded, `joined` still false. */
export function joinFirstConnect(vault: VaultSnapshot, things: ThingsSnapshot, state: ThingsState, exists?: (path: string) => boolean): ThingsState {
    return joinByName(vault, things, state, exists).state;
}
