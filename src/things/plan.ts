/**
 * Deciding what one round of Things sync does.
 *
 * Both sides are compared with what the last round left them (the state), so
 * each side's changes since then can be told apart:
 *
 * - A line and its to-do share an ID. A field only one side changed is copied
 *   to the other, and a field both changed takes the note's value (merge.ts).
 *   Where the to-do sits (note and heading, project and heading) merges the
 *   same way. A copied line leaves the ID with the first line by path and
 *   line, and the copy gets a to-do of its own.
 * - A line with no ID gets a new to-do: in its note's project (made first,
 *   with its area, when missing), in the Inbox for the Things Inbox note, or
 *   in the area for an area's loose note. An open to-do the vault doesn't
 *   have comes into its project's note, the Things Inbox note (also home to
 *   to-dos in no list), or its area's loose note. A new project comes in as a
 *   new note in its area's folder, carrying its to-dos. Repeating to-dos and
 *   the Logbook stay in Things.
 * - When a note's headings change, its project is rebuilt (the heading swap,
 *   since Things can't add a heading to a project). Headings changed only in
 *   Things are written into the note, unless Things dropped one the note
 *   still has tasks under: the swap brings it back.
 * - A to-do deleted in Things, or in a project deleted there, retires its
 *   line. A line deleted in the note trashes its to-do once the note it was in
 *   is gone or has sat still for `settleMs`, so a task on its way to another
 *   note is never trashed before it arrives. A deleted note trashes its
 *   project; a note that only lost its tasks keeps it. An area goes once its
 *   folder has no synced notes left and Things holds nothing open in it.
 * - A note renamed or moved renames or moves its project, a project renamed or
 *   moved to a synced area in Things renames or moves its note, and when both
 *   changed the note's name wins. An area renamed in Things gets its folder's
 *   name back.
 * - Past the guard (more than 3, and more than a quarter, of the synced
 *   to-dos vanishing from one side at once), nothing is planned at all.
 *
 * Nothing here touches a note or Things. It returns the steps in the order
 * the round carries them out, and the round keeps the state. Paths in every
 * step are the notes' paths as read, before this round's renames. Kept free of
 * Obsidian imports so it can be unit tested directly.
 */

import { MISSING_LIMIT, MISSING_SHARE } from '../calendar/plan';
import type { NoteInfo } from '../calendar/plan';
import { areaName, folderFor, looseNoteName, noteName } from './mapping';
import { mergeFields } from './merge';
import type { Place, ThingsProject, ThingsSnapshot, ThingsState, ThingsTodo, TodoFields, VaultNote, VaultSnapshot, VaultTask } from './model';

export type ThingsStep =
    | { kind: 'createArea'; folder: string }
    | { kind: 'renameArea'; id: string; folder: string }
    | { kind: 'createProject'; path: string; title: string; folder: string; headings: string[] }
    /** `order` lists every to-do that belongs in the rebuilt project, with its heading, so the round can place each one. */
    | { kind: 'swapProject'; path: string; id: string; headings: string[]; order: Array<{ id: string; heading?: string }> }
    | { kind: 'updateProject'; id: string; title?: string; folder?: string }
    | { kind: 'trashProject'; id: string }
    | { kind: 'deleteArea'; id: string }
    | { kind: 'createTodo'; task: VaultTask }
    /** A key present with an `undefined` value clears that field. */
    | { kind: 'updateTodo'; id: string; fields: Partial<TodoFields> }
    | { kind: 'moveTodo'; id: string; to: Place }
    | { kind: 'trashTodo'; id: string };

export type VaultStep =
    /** Made by the round once the to-do exists, never by the planner. */
    | { kind: 'link'; task: VaultTask; id: string }
    | { kind: 'unlink'; task: VaultTask }
    | { kind: 'update'; task: VaultTask; fields: Partial<TodoFields> }
    | { kind: 'move'; task: VaultTask; to: Place }
    | { kind: 'add'; todo: ThingsTodo; to: Place }
    | { kind: 'retire'; task: VaultTask }
    /** A note for a new project (`projectId`), an area's loose to-dos (`areaId` alone) or the Inbox. `areaId` names the area its folder stands for. */
    | { kind: 'createNote'; path: string; title: string; headings: string[]; todos: ThingsTodo[]; projectId?: string; areaId?: string }
    | { kind: 'renameNote'; from: string; to: string }
    | { kind: 'headings'; path: string; from: string[]; to: string[] };

export type ThingsPlan =
    | { ok: true; things: ThingsStep[]; vault: VaultStep[]; counts: { toThings: number; toVault: number } }
    /** Too many synced to-dos vanished from one side at once to be the user's doing; nothing is changed. */
    | { ok: false; reason: 'emptied'; side: 'things' | 'vault'; missing: number };

export interface ThingsPlanOptions { now: number; settleMs: number; notes: NoteInfo }

type CreateNote = Extract<VaultStep, { kind: 'createNote' }>;

/** Areas before the projects in them, projects before their to-dos, and trash last, so nothing still being moved out goes with it. */
const THINGS_ORDER: ReadonlyArray<ThingsStep['kind']> = ['createArea', 'renameArea', 'createProject', 'updateProject', 'swapProject', 'createTodo', 'updateTodo', 'moveTodo', 'trashTodo', 'trashProject', 'deleteArea'];
/** Notes before the task steps that write into them. */
const VAULT_ORDER: ReadonlyArray<VaultStep['kind']> = ['createNote', 'renameNote', 'headings', 'unlink', 'update', 'move', 'add', 'retire', 'link'];

function byKind<T extends { kind: string }>(steps: T[], order: readonly string[]): T[] {
    return [...steps].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
const at = (path: string, heading?: string): Place => heading === undefined ? { path } : { path, heading };
const samePlace = (a: Place, b: Place): boolean => a.path === b.path && a.heading === b.heading;
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, i) => item === b[i]);
const withoutId = (task: VaultTask): VaultTask => { const copy = { ...task }; delete copy.id; return copy; };

/** Whether a note's file name still stands for a project title: the title made file-safe, maybe numbered. */
function namedAfter(base: string, title: string): boolean {
    const stem = noteName(title, () => false, '').replace(/\.md$/, '');
    return base === stem || (base.startsWith(`${stem} `) && /^\d+$/.test(base.slice(stem.length + 1)));
}

/** A synced note's headings as each side has them, and a heading renamed only in Things. */
interface NoteHeadings { note: VaultNote; id: string; written: string[]; things: string[]; vaultChanged: boolean; thingsChanged: boolean; renamed: Map<string, string> }

export function planThingsSync(vault: VaultSnapshot, things: ThingsSnapshot, state: ThingsState, opts: ThingsPlanOptions): ThingsPlan {
    const caps = things.capabilities;
    const files = opts.notes;
    const thingsSteps: ThingsStep[] = [];
    const vaultSteps: VaultStep[] = [];

    const todoById = new Map(things.todos.map(t => [t.id, t]));
    const projectById = new Map(things.projects.map(p => [p.id, p]));
    const areaById = new Map(things.areas.map(a => [a.id, a]));
    const syncedById = new Map(state.todos.map(t => [t.id, t]));
    const projectByPath = new Map(state.projects.map(p => [p.path, p]));
    const noteByPath = new Map(vault.notes.map(n => [n.path, n]));
    const looseAreaByPath = new Map(Object.keys(state.looseNotes).map(area => [state.looseNotes[area], area]));
    const isListNote = (path: string) => path === state.inboxNote || looseAreaByPath.has(path);
    const live = (project: ThingsProject | undefined): project is ThingsProject => project !== undefined && !project.trashed;
    const gone = (todo: ThingsTodo) => todo.trashed || (todo.projectId !== undefined && !live(projectById.get(todo.projectId)));
    const stateFolder = (areaId: string) => state.areas.find(a => a.id === areaId)?.folder;
    const goneNotes = new Set(state.projects.filter(sp => !live(projectById.get(sp.id))).map(sp => sp.path));
    const trashedNote = (path: string) => { const sp = projectByPath.get(path); return sp !== undefined && projectById.get(sp.id)?.trashed === true; };

    // One line per ID: the first by path and line keeps it.
    const lines = vault.notes.flatMap(n => n.tasks).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const lineById = new Map<string, VaultTask>();
    const copies: VaultTask[] = [];
    for (const task of lines) {
        if (task.id === undefined) continue;
        if (lineById.has(task.id)) copies.push(task);
        else lineById.set(task.id, task);
    }
    const known = (todo: ThingsTodo) => syncedById.has(todo.id) || lineById.has(todo.id);
    const importable = (todo: ThingsTodo) => !todo.trashed && !todo.logged && !todo.repeating && todo.fields.status === 'open';

    // New notes, named so they never take a path in use or one named this round.
    const reserved = new Set<string>();
    const taken = (path: string) => reserved.has(path) || files.exists(path);
    const newNotes = new Map<string, CreateNote>();
    const noteHeadings = new Map<string, Set<string>>();
    const projectPath = new Map(state.projects.map(sp => [sp.id, sp.path]));
    for (const project of things.projects) {
        if (!live(project) || project.status !== 'open' || projectPath.has(project.id)) continue;
        const area = project.areaId === undefined ? undefined : areaById.get(project.areaId);
        const folder = area ? stateFolder(area.id) ?? folderFor(area.title) : '';
        const path = noteName(project.title, taken, folder);
        reserved.add(path);
        projectPath.set(project.id, path);
        newNotes.set(path, { kind: 'createNote', path, title: project.title, headings: [], todos: [], projectId: project.id, ...(area ? { areaId: area.id } : {}) });
    }
    const looseNamed = new Map<string, string>();
    const loosePath = (areaId: string): string | undefined => {
        const path = state.looseNotes[areaId] ?? looseNamed.get(areaId);
        if (path !== undefined) return path;
        const area = areaById.get(areaId);
        if (!area) return undefined;
        const folder = stateFolder(areaId) ?? folderFor(area.title);
        const named = noteName(looseNoteName(areaName(folder)), taken, folder);
        reserved.add(named);
        looseNamed.set(areaId, named);
        looseAreaByPath.set(named, areaId);
        return named;
    };
    /** Plans the note at `path` when it doesn't exist yet (the Inbox note or a loose note). */
    const needNote = (path: string): void => {
        if (newNotes.has(path) || files.exists(path)) return;
        const areaId = looseAreaByPath.get(path);
        newNotes.set(path, { kind: 'createNote', path, title: baseOf(path), headings: [], todos: [], ...(areaId === undefined ? {} : { areaId }) });
    };
    /** Whether a to-do from Things can land in this note: one that exists, a list note, or one made this round. */
    const canTake = (path: string) => files.exists(path) || isListNote(path) || newNotes.has(path);
    const wantHeading = (place: Place) => {
        if (place.heading === undefined || !newNotes.has(place.path)) return;
        const set = noteHeadings.get(place.path) ?? new Set<string>();
        noteHeadings.set(place.path, set.add(place.heading));
    };

    /** Where a to-do sits in Things, as a vault place. A heading Things can't show is taken as unchanged. */
    const thingsPlace = (todo: ThingsTodo, was?: Place): Place | undefined => {
        if (todo.projectId !== undefined) {
            const path = projectPath.get(todo.projectId);
            if (path === undefined) return undefined;
            return at(path, caps.headings ? todo.heading : was?.path === path ? was.heading : undefined);
        }
        if (todo.areaId !== undefined && !todo.inbox) {
            const path = loosePath(todo.areaId);
            return path === undefined ? undefined : at(path);
        }
        return at(state.inboxNote);
    };

    // Each synced note's headings, three ways. Things' count when they were
    // written last round or hold a to-do the vault has or will have, so an
    // empty heading made in Things never changes the note.
    const headingsOf = new Map<string, NoteHeadings>();
    for (const note of vault.notes) {
        const sp = projectByPath.get(note.path);
        const project = sp && projectById.get(sp.id);
        if (!sp || !live(project) || isListNote(note.path)) continue;
        const holds = (heading: string) => things.todos.some(t => t.projectId === project.id && t.heading === heading && !t.trashed && (known(t) || importable(t)));
        const seen = caps.headings && project.headings ? project.headings.filter(h => sp.headings.includes(h) || holds(h)) : sp.headings;
        const vaultChanged = !sameList(note.headings, sp.headings);
        const thingsChanged = !sameList(seen, sp.headings);
        const renamed = new Map<string, string>();
        if (!vaultChanged && thingsChanged && seen.length === sp.headings.length) {
            const differ = sp.headings.map((_, i) => i).filter(i => seen[i] !== sp.headings[i]);
            if (differ.length === 1 && !sp.headings.includes(seen[differ[0]])) renamed.set(sp.headings[differ[0]], seen[differ[0]]);
        }
        headingsOf.set(note.path, { note, id: sp.id, written: sp.headings, things: seen, vaultChanged, thingsChanged, renamed });
    }
    const swapping = (path: string) => headingsOf.get(path)?.vaultChanged === true;
    /** A place in the vault, with the heading Things renamed under its new name and no heading in a list note. */
    const vaultSide = (path: string, heading?: string): Place => {
        if (isListNote(path) || heading === undefined) return at(path);
        return at(path, headingsOf.get(path)?.renamed.get(heading) ?? heading);
    };

    // A note's project, made first when it has none. False while the note's project was just deleted in Things.
    const areasMade = new Set<string>();
    const ensureArea = (folder: string): void => {
        if (!folder || areasMade.has(folder) || state.areas.some(a => a.folder === folder && areaById.has(a.id))) return;
        areasMade.add(folder);
        thingsSteps.push({ kind: 'createArea', folder });
    };
    const projectsMade = new Set<string>();
    const ready = (path: string): boolean => {
        if (isListNote(path)) return true;
        if (projectByPath.has(path)) return !goneNotes.has(path);
        const note = noteByPath.get(path);
        if (!note) return false;
        if (!projectsMade.has(path)) {
            projectsMade.add(path);
            ensureArea(note.folder);
            thingsSteps.push({ kind: 'createProject', path, title: note.title, folder: note.folder, headings: note.headings });
        }
        return true;
    };
    const createTodo = (task: VaultTask): void => {
        if (task.fields.status === 'open' && ready(task.path)) thingsSteps.push({ kind: 'createTodo', task });
    };

    // Lines with no ID, and copies of another line's.
    for (const task of copies) {
        vaultSteps.push({ kind: 'unlink', task });
        createTodo(withoutId(task));
    }
    for (const task of lines) if (task.id === undefined) createTodo(task);

    // Lines with an ID: fields and place, or retired when the to-do is gone.
    const finals = new Map<string, Place>();
    const leaving = new Set<VaultTask>();
    let goneFromThings = 0;
    const retire = (task: VaultTask) => { vaultSteps.push({ kind: 'retire', task }); leaving.add(task); };
    for (const [id, task] of lineById) {
        const synced = syncedById.get(id);
        const todo = todoById.get(id);
        if (!todo) {
            // Missing from Things. One last synced as done may only be out of
            // the Logbook's reach, so its line stays; reopened, it starts over.
            // One in a project the user trashed went with it, and never counts
            // toward the guard.
            if (synced?.fields.status === 'open') { retire(task); if (!trashedNote(synced.place.path)) goneFromThings++; }
            else if (task.fields.status === 'open') { vaultSteps.push({ kind: 'unlink', task }); createTodo(withoutId(task)); }
            continue;
        }
        if (gone(todo)) { retire(task); continue; }

        // A line whose ID Things knows and the state doesn't: the note wins.
        const { toThings, toVault } = mergeFields(task.fields, todo.fields, synced?.fields ?? todo.fields, caps);
        if (todo.repeating) {
            // Things won't let anything else complete or re-date a repeating to-do: its own values stand.
            if ('status' in toThings) { delete toThings.status; if (task.fields.status !== todo.fields.status) toVault.status = todo.fields.status; }
            if ('when' in toThings) { delete toThings.when; if (task.fields.when !== todo.fields.when) toVault.when = todo.fields.when; }
        }
        if (Object.keys(toThings).length) thingsSteps.push({ kind: 'updateTodo', id, fields: toThings });
        if (Object.keys(toVault).length) vaultSteps.push({ kind: 'update', task, fields: toVault });

        const here = vaultSide(task.path, task.heading);
        const prior = synced?.place ?? thingsPlace(todo);
        const was = prior && vaultSide(prior.path, prior.heading);
        const there = thingsPlace(todo, was);
        let final = here;
        if (was && there) {
            // A heading moved to in Things that a rebuilt note no longer has gives way to the note.
            const lost = swapping(here.path) && there.path === here.path && there.heading !== undefined && !noteByPath.get(here.path)?.headings.includes(there.heading);
            if (!samePlace(here, was) && !samePlace(here, there)) {
                // The swap places to-dos in a note being rebuilt.
                if (!swapping(here.path) && ready(here.path)) thingsSteps.push({ kind: 'moveTodo', id, to: here });
            } else if (samePlace(here, was) && !samePlace(there, was) && !lost && canTake(there.path)) {
                final = there;
                leaving.add(task);
                needNote(there.path);
                wantHeading(there);
                vaultSteps.push({ kind: 'move', task, to: there });
            }
        }
        finals.set(id, final);
    }

    // To-dos only Things has.
    for (const todo of things.todos) {
        if (known(todo) || !importable(todo) || gone(todo)) continue;
        const to = thingsPlace(todo);
        // In a note deleted this round, it goes to the Trash with its project.
        if (!to || !canTake(to.path)) continue;
        needNote(to.path);
        const made = newNotes.get(to.path);
        if (made) { made.todos.push(todo); wantHeading(to); }
        else vaultSteps.push({ kind: 'add', todo, to });
    }

    // Notes deleted from the vault, then lines.
    const trashing = new Set<string>();
    for (const sp of state.projects) {
        if (files.exists(sp.path) || !live(projectById.get(sp.id))) continue;
        if (state.projects.some(other => other !== sp && other.id === sp.id && files.exists(other.path))) continue;
        trashing.add(sp.id);
        thingsSteps.push({ kind: 'trashProject', id: sp.id });
    }
    let goneFromVault = 0;
    for (const synced of state.todos) {
        const todo = todoById.get(synced.id);
        if (lineById.has(synced.id) || !todo || gone(todo)) continue;
        const path = synced.place.path;
        if (files.exists(path) && opts.now - files.mtime(path) < opts.settleMs) continue;
        goneFromVault++;
        if (todo.projectId === undefined || !trashing.has(todo.projectId)) thingsSteps.push({ kind: 'trashTodo', id: synced.id });
    }

    // Renames and moves of synced notes and projects.
    for (const sp of state.projects) {
        const project = projectById.get(sp.id);
        if (!files.exists(sp.path) || !live(project)) continue;
        const folder = folderOf(sp.path);
        const base = baseOf(sp.path);
        const wasFolder = sp.areaId === undefined ? '' : stateFolder(sp.areaId) ?? folder;
        // The folder of the area Things has it in, or undefined for an area the vault has no folder for.
        const thingsFolder = project.areaId === undefined ? '' : areaById.has(project.areaId) ? stateFolder(project.areaId) : undefined;
        const change: { title?: string; folder?: string } = {};
        let title = base;
        let to = folder;
        if (!namedAfter(base, sp.title)) {
            if (!namedAfter(base, project.title)) change.title = base;
        } else if (project.title !== sp.title) {
            title = project.title;
        }
        if (folder !== wasFolder) {
            if (thingsFolder !== folder) { ensureArea(folder); change.folder = folder; }
        } else if ((project.areaId ?? '') !== (sp.areaId ?? '')) {
            if (thingsFolder === undefined) change.folder = folder;
            else to = thingsFolder;
        }
        if (change.title !== undefined || change.folder !== undefined) thingsSteps.push({ kind: 'updateProject', id: sp.id, ...change });
        if (title === base && to === folder) continue;
        const path = noteName(title, other => other !== sp.path && taken(other), to);
        if (path === sp.path) continue;
        reserved.add(path);
        vaultSteps.push({ kind: 'renameNote', from: sp.path, to: path });
    }

    // Areas renamed in Things get their folder's name back.
    for (const area of state.areas) {
        const current = areaById.get(area.id);
        if (current && area.folder && current.title !== areaName(area.folder)) thingsSteps.push({ kind: 'renameArea', id: area.id, folder: area.folder });
    }

    // Headings: the swap, or Things' headings written into the note.
    const orderOf = (plan: NoteHeadings) => {
        const { note, id } = plan;
        const entry = (todoId: string, heading?: string) => heading !== undefined && note.headings.includes(heading) ? { id: todoId, heading } : { id: todoId };
        const order: Array<{ id: string; heading?: string }> = [];
        finals.forEach((place, todoId) => { if (place.path === note.path) order.push(entry(todoId, place.heading)); });
        for (const todo of things.todos) {
            if (todo.projectId !== id || todo.trashed || lineById.has(todo.id)) continue;
            order.push(entry(todo.id, thingsPlace(todo, syncedById.get(todo.id)?.place)?.heading));
        }
        return order;
    };
    for (const plan of headingsOf.values()) {
        const { note } = plan;
        const dropped = plan.written.filter(h => !plan.things.includes(h) && !plan.renamed.has(h));
        const stays = dropped.some(h => note.tasks.some(t => t.heading === h && !leaving.has(t)));
        if (plan.vaultChanged || (plan.thingsChanged && stays)) {
            thingsSteps.push({ kind: 'swapProject', path: note.path, id: plan.id, headings: note.headings, order: orderOf(plan) });
        } else if (plan.thingsChanged) {
            vaultSteps.push({ kind: 'headings', path: note.path, from: note.headings, to: plan.things });
        }
    }

    // A new project's note takes the headings that hold its to-dos, in Things' order.
    newNotes.forEach(made => {
        const raw = made.projectId === undefined ? undefined : projectById.get(made.projectId)?.headings;
        const used = noteHeadings.get(made.path);
        if (caps.headings && raw && used) made.headings = raw.filter(h => used.has(h));
    });

    // An area whose folder has no synced notes left and holds nothing open in Things.
    for (const area of state.areas) {
        if (!areaById.has(area.id)) continue;
        const inFolder = (path: string) => folderOf(path) === area.folder;
        const loose = state.looseNotes[area.id];
        const used = vault.notes.some(n => n.folder === area.folder)
            || state.projects.some(sp => inFolder(sp.path) && files.exists(sp.path))
            || [...newNotes.keys()].some(inFolder)
            || (loose !== undefined && files.exists(loose));
        const holds = things.projects.some(p => p.areaId === area.id && live(p) && p.status === 'open')
            || things.todos.some(t => t.areaId === area.id && t.projectId === undefined && importable(t));
        if (!used && !holds) thingsSteps.push({ kind: 'deleteArea', id: area.id });
    }

    const tripped = (missing: number) => missing > MISSING_LIMIT && missing > state.todos.length * MISSING_SHARE;
    if (tripped(goneFromThings)) return { ok: false, reason: 'emptied', side: 'things', missing: goneFromThings };
    if (tripped(goneFromVault)) return { ok: false, reason: 'emptied', side: 'vault', missing: goneFromVault };

    const allVault: VaultStep[] = [...newNotes.values(), ...vaultSteps];
    const toThings = thingsSteps.filter(s => s.kind === 'createTodo' || s.kind === 'updateTodo' || s.kind === 'moveTodo' || s.kind === 'trashTodo').length;
    const toVault = allVault.reduce((sum, s) => sum + (s.kind === 'createNote' ? s.todos.length : s.kind === 'update' || s.kind === 'move' || s.kind === 'add' || s.kind === 'retire' ? 1 : 0), 0);
    return { ok: true, things: byKind(thingsSteps, THINGS_ORDER), vault: byKind(allVault, VAULT_ORDER), counts: { toThings, toVault } };
}
