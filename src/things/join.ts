/**
 * First connect: what already exists on both sides is joined by name before
 * the first round is planned, so connecting doesn't copy everything twice.
 *
 * - An area joins the folder its title names in full: "Work/People" joins
 *   `Work/People`, and "People" doesn't.
 * - An open project joins the note with its title in the folder its area
 *   joined, or at the top of the vault for a project in no area.
 * - In each joined project, an open to-do joins the first open line in the
 *   note with the same title and no ID yet, in line order. The planner gives
 *   that line the to-do's ID (its `adopt` step).
 * - A joined pair agrees on each field: the note's value when the note has
 *   one (notes, checklist, tags, a date or `#someday`, a time), and Things'
 *   when it doesn't. The to-do takes the line's place. The state records the
 *   losing side's value for each field and Things' place, so the planner's
 *   three-way merge sees the winning side as the one that changed and
 *   carries its value across. Recording the agreed value itself would make
 *   the note look unchanged and bring Things' value over the note's.
 *
 * Repeating to-dos and those in the Logbook or the Trash are never joined or
 * imported, and neither are done lines. Joining its own result joins the same
 * pairs again, so the round can start from it and the planner can join again.
 * `joined` stays false: the round sets it once a first round succeeds.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import type { Place, ThingsSnapshot, ThingsState, ThingsTodo, TodoFields, VaultSnapshot, VaultTask } from './model';

/** Whether a to-do from Things may come into the vault: open, and not repeating, logged or trashed. */
export function importable(todo: ThingsTodo): boolean {
    return !todo.trashed && !todo.logged && !todo.repeating && todo.fields.status === 'open';
}

/** A to-do with a Deadline and no When date takes the deadline as its date, unless it's in Someday. */
export function withDeadline(todo: ThingsTodo): ThingsTodo {
    if (todo.deadline === undefined || todo.fields.when !== undefined || todo.fields.someday) return todo;
    return { ...todo, fields: { ...todo.fields, when: todo.deadline } };
}

/** For each field of a joined pair, the losing side's value: Things' where the note has a value, the note's where it doesn't. */
function joinedFields(vault: TodoFields, things: TodoFields): TodoFields {
    const losing = <K extends keyof TodoFields>(key: K, noteWins: boolean): TodoFields[K] => noteWins ? things[key] : vault[key];
    const dated = vault.when !== undefined || vault.someday;
    const when = dated ? vault.when : things.when;
    // Titles are equal and both are open, so either side's will do for those.
    const fields: TodoFields = {
        title: vault.title,
        notes: losing('notes', vault.notes.trim() !== ''),
        checklist: losing('checklist', vault.checklist.length > 0),
        tags: losing('tags', vault.tags.length > 0),
        status: vault.status,
        someday: losing('someday', dated)
    };
    const lastWhen = losing('when', dated);
    // Things' time stays when the agreed date has room for it and the line has no time of its own.
    const lastReminder = losing('reminder', vault.reminder !== undefined || when === undefined);
    if (lastWhen !== undefined) fields.when = lastWhen;
    if (lastReminder !== undefined) fields.reminder = lastReminder;
    return fields;
}

/** The state with what joins by name recorded, and each line that takes a joined to-do's ID. */
export function joinByName(vault: VaultSnapshot, things: ThingsSnapshot, state: ThingsState): { state: ThingsState; adopted: Map<VaultTask, string> } {
    const areas = [...state.areas];
    const projects = [...state.projects];
    const todos = new Map(state.todos.map(t => [t.id, t]));
    const adopted = new Map<VaultTask, string>();

    const folders = new Set([...vault.notes.map(n => n.folder), ...vault.folders].filter(Boolean));
    for (const area of things.areas) {
        if (!folders.has(area.title) || areas.some(a => a.id === area.id || a.folder === area.title)) continue;
        areas.push({ id: area.id, folder: area.title });
    }

    const lists = new Set([state.inboxNote, ...Object.values(state.looseNotes)]);
    for (const project of things.projects) {
        if (project.trashed || project.status !== 'open' || projects.some(p => p.id === project.id)) continue;
        const folder = project.areaId === undefined ? '' : areas.find(a => a.id === project.areaId)?.folder;
        if (folder === undefined) continue;
        const note = vault.notes.find(n => n.folder === folder && n.title === project.title && !lists.has(n.path) && !projects.some(p => p.path === n.path));
        if (!note) continue;
        projects.push({ id: project.id, path: note.path, title: project.title, headings: note.headings, ...(project.areaId === undefined ? {} : { areaId: project.areaId }) });
    }

    const onLines = new Set(vault.notes.flatMap(n => n.tasks.map(t => t.id)));
    const live = new Set(things.projects.filter(p => !p.trashed).map(p => p.id));
    for (const sp of projects) {
        const note = vault.notes.find(n => n.path === sp.path);
        if (!note || !live.has(sp.id)) continue;
        const open = note.tasks.filter(t => t.id === undefined && t.fields.status === 'open').sort((a, b) => a.line - b.line);
        for (const raw of things.todos) {
            if (raw.projectId !== sp.id || !importable(raw) || onLines.has(raw.id)) continue;
            const todo = withDeadline(raw);
            const task = open.find(t => !adopted.has(t) && t.fields.title === todo.fields.title);
            if (!task) continue;
            adopted.set(task, todo.id);
            // Where Things has it, so the merge moves it to the line's place. A heading Things can't show is taken as none.
            const heading = things.capabilities.headings ? todo.heading : undefined;
            const place: Place = heading === undefined ? { path: note.path } : { path: note.path, heading };
            todos.set(todo.id, { id: todo.id, place, fields: joinedFields(task.fields, todo.fields) });
        }
    }

    return { state: { ...state, areas, projects, todos: [...todos.values()] }, adopted };
}

/** The state with the areas, projects and to-dos that join by name recorded, `joined` still false. */
export function joinFirstConnect(vault: VaultSnapshot, things: ThingsSnapshot, state: ThingsState): ThingsState {
    return joinByName(vault, things, state).state;
}
