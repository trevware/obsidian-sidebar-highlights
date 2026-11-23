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
 *   folder has no synced notes left and Things holds nothing in it outside
 *   the Trash.
 * - On first connect (`joined` false), what already exists on both sides is
 *   joined by name first (join.ts). Each joined line takes its to-do's ID
 *   (`adopt`), and both sides go to the fields the pair agrees on. The note
 *   wins on headings: its own in its order, then Things' headings holding
 *   to-dos that come in, with one swap when Things has anything else and
 *   never a headings step into the note. `counts` is what the user confirms:
 *   the to-dos made in Things and the tasks written into notes, leaving out
 *   joined pairs.
 * - A to-do with a Deadline and no When date is dated by its deadline, every
 *   round, so the date it brings to the line stays put.
 * - A note renamed or moved renames or moves its project, a project renamed or
 *   moved to another area in Things renames or moves its note (into a new
 *   folder for a new area), and when both changed the note's name wins. An
 *   area renamed in Things gets its folder's name back.
 * - Past the guard (more than 3, and more than a quarter, of the synced
 *   to-dos vanishing from one side at once), nothing is planned at all. A
 *   deleted note counts once, and a project trashed in Things not at all,
 *   since each is one deliberate act. Once the user confirms what vanished
 *   from the vault, `acceptMissing` lets that one round past the vault side.
 *
 * Nothing here touches a note or Things. It returns the steps in the order
 * the round carries them out, and the round keeps the state. Paths in every
 * step are the notes' paths as read, before this round's renames. Kept free of
 * Obsidian imports so it can be unit tested directly.
 */

import { MISSING_LIMIT, MISSING_SHARE } from '../calendar/plan';
import type { NoteInfo } from '../calendar/plan';
import { agreedFields, importable, joinByName, joinedHeadings, titleWords, withDeadline } from './join';
import { areaName, folderFor, looseNoteName, noteName } from './mapping';
import { differences, mergeFields } from './merge';
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
    /** First connect: a line joined by name to a to-do takes its ID. The task is as read, without the ID. */
    | { kind: 'adopt'; task: VaultTask; id: string }
    | { kind: 'unlink'; task: VaultTask }
    | { kind: 'update'; task: VaultTask; fields: Partial<TodoFields> }
    | { kind: 'move'; task: VaultTask; to: Place }
    | { kind: 'add'; todo: ThingsTodo; to: Place }
    | { kind: 'retire'; task: VaultTask }
    /** A note for a new project (`projectId`), an area's loose to-dos (`areaId` alone) or the Inbox. `areaId` names the area its folder stands for. */
    | { kind: 'createNote'; path: string; title: string; headings: string[]; todos: ThingsTodo[]; projectId?: string; areaId?: string }
    /** `areaId` is the area Things moved the note's project into, so the round can record a new area's folder. */
    | { kind: 'renameNote'; from: string; to: string; areaId?: string }
    | { kind: 'headings'; path: string; from: string[]; to: string[] };

export type ThingsPlan =
    /** `counts`: on first connect, the to-dos made in Things and the tasks written into notes; after that, the to-dos and tasks changed. */
    | { ok: true; things: ThingsStep[]; vault: VaultStep[]; counts: { toThings: number; toVault: number } }
    /** Too many synced to-dos vanished from one side at once to be the user's doing; nothing is changed. */
    | { ok: false; reason: 'emptied'; side: 'things' | 'vault'; missing: number };

/**
 * Whether a note exists and when it changed, and whether it's one sync reads
 * at all: a note excluded from tasks in settings is never written to,
 * joined, or counted as deleted. Without `included`, every note is.
 */
export interface ThingsNoteInfo extends NoteInfo {
    included?: (path: string) => boolean;
}

export interface ThingsPlanOptions {
    now: number;
    settleMs: number;
    notes: ThingsNoteInfo;
    /** The user confirmed what vanished from the vault: this round skips the vault side of the guard. */
    acceptMissing?: boolean;
}

type CreateNote = Extract<VaultStep, { kind: 'createNote' }>;

/** Areas before the projects in them, projects before their to-dos, and trash last, so nothing still being moved out goes with it. */
const THINGS_ORDER: ReadonlyArray<ThingsStep['kind']> = ['createArea', 'renameArea', 'createProject', 'updateProject', 'swapProject', 'createTodo', 'updateTodo', 'moveTodo', 'trashTodo', 'trashProject', 'deleteArea'];
/** Notes before the task steps that write into them, and a joined line's ID before anything else changes the line. */
const VAULT_ORDER: ReadonlyArray<VaultStep['kind']> = ['createNote', 'renameNote', 'headings', 'adopt', 'unlink', 'update', 'move', 'add', 'retire', 'link'];

function byKind<T extends { kind: string }>(steps: T[], order: readonly string[]): T[] {
    return [...steps].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
const at = (path: string, heading?: string): Place => heading === undefined ? { path } : { path, heading };
const samePlace = (a: Place, b: Place): boolean => a.path === b.path && a.heading === b.heading;
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, i) => item === b[i]);
const withoutId = (task: VaultTask): VaultTask => { const copy = { ...task }; delete copy.id; return copy; };

/** Whether a note's file name still stands for a project title: the title as is, with spaces evened out, or made file-safe, maybe numbered. */
function namedAfter(base: string, title: string): boolean {
    const stems = [title, titleWords(title), noteName(title, () => false, '').replace(/\.md$/, '')];
    return stems.some(stem => base === stem || (base.startsWith(`${stem} `) && /^\d+$/.test(base.slice(stem.length + 1))));
}

/** A synced note's headings as each side has them, a heading renamed only in Things, and the headings a swap rebuilds the project with. */
interface NoteHeadings { note: VaultNote; id: string; written: string[]; things: string[]; vaultChanged: boolean; thingsChanged: boolean; renamed: Map<string, string>; target: string[] }

export function planThingsSync(vault: VaultSnapshot, things: ThingsSnapshot, state: ThingsState, opts: ThingsPlanOptions): ThingsPlan {
    const dated: ThingsSnapshot = { ...things, todos: things.todos.map(withDeadline) };
    if (state.joined) return planRound(vault, dated, state, new Map(), opts);
    const included = (path: string) => opts.notes.included?.(path) ?? true;
    const first = joinByName(vault, dated, state, path => opts.notes.exists(path) && included(path));
    return planRound(vault, dated, first.state, first.adopted, opts);
}

/** One round from `state`, with `adopted` the lines joined by name to a to-do this round. */
function planRound(vault: VaultSnapshot, things: ThingsSnapshot, state: ThingsState, adopted: ReadonlyMap<VaultTask, string>, opts: ThingsPlanOptions): ThingsPlan {
    const caps = things.capabilities;
    const firstConnect = !state.joined;
    const files = opts.notes;
    const included = (path: string) => files.included?.(path) ?? true;
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
    // A line joined by name stands for its to-do as if it carried the ID.
    adopted.forEach((id, task) => lineById.set(id, task));
    const known = (todo: ThingsTodo) => syncedById.has(todo.id) || lineById.has(todo.id);

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
        // A project whose note would land where sync doesn't read stays in Things alone.
        if (!included(path)) continue;
        reserved.add(path);
        projectPath.set(project.id, path);
        newNotes.set(path, { kind: 'createNote', path, title: project.title, headings: [], todos: [], projectId: project.id, ...(area ? { areaId: area.id } : {}) });
    }
    const looseNamed = new Map<string, string>();
    const loosePath = (areaId: string): string | undefined => {
        const path = state.looseNotes[areaId] ?? looseNamed.get(areaId);
        if (path !== undefined) return included(path) ? path : undefined;
        const area = areaById.get(areaId);
        if (!area) return undefined;
        const folder = stateFolder(areaId) ?? folderFor(area.title);
        const named = noteName(looseNoteName(areaName(folder)), taken, folder);
        if (!included(named)) return undefined;
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
    const canTake = (path: string) => included(path) && (files.exists(path) || isListNote(path) || newNotes.has(path));
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
        return included(state.inboxNote) ? at(state.inboxNote) : undefined;
    };

    // Each synced note's headings, three ways. Things' count when they were
    // written last round or hold a to-do the vault has or will have, so an
    // empty heading made in Things never changes the note.
    const headingsOf = new Map<string, NoteHeadings>();
    for (const note of vault.notes) {
        const sp = projectByPath.get(note.path);
        const project = sp && projectById.get(sp.id);
        if (!sp || !live(project) || isListNote(note.path)) continue;
        if (firstConnect) {
            // The note wins: its headings in its order, then Things' headings
            // holding to-dos that come in. One swap when Things has anything
            // else, and never a headings step into the note.
            const target = caps.headings ? joinedHeadings(note.headings, project, things.todos, t => importable(t) && !known(t)) : note.headings;
            const has = caps.headings && project.headings ? project.headings.filter(h => target.includes(h)) : target;
            headingsOf.set(note.path, { note, id: sp.id, written: target, things: target, vaultChanged: !sameList(has, target), thingsChanged: false, renamed: new Map(), target });
            continue;
        }
        const holds = (heading: string) => things.todos.some(t => t.projectId === project.id && t.heading === heading && !t.trashed && (known(t) || importable(t)));
        const seen = caps.headings && project.headings ? project.headings.filter(h => sp.headings.includes(h) || holds(h)) : sp.headings;
        const vaultChanged = !sameList(note.headings, sp.headings);
        const thingsChanged = !sameList(seen, sp.headings);
        const renamed = new Map<string, string>();
        if (!vaultChanged && thingsChanged && seen.length === sp.headings.length) {
            const differ = sp.headings.map((_, i) => i).filter(i => seen[i] !== sp.headings[i]);
            if (differ.length === 1 && !sp.headings.includes(seen[differ[0]])) renamed.set(sp.headings[differ[0]], seen[differ[0]]);
        }
        headingsOf.set(note.path, { note, id: sp.id, written: sp.headings, things: seen, vaultChanged, thingsChanged, renamed, target: note.headings });
    }
    /** The headings a note ends this round with. */
    const targetOf = (path: string) => headingsOf.get(path)?.target ?? noteByPath.get(path)?.headings ?? [];
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
    for (const task of lines) if (task.id === undefined && !adopted.has(task)) createTodo(task);
    adopted.forEach((id, task) => vaultSteps.push({ kind: 'adopt', task, id }));

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

        // A line joined by name this round: both sides go to the agreed fields.
        // A line whose ID Things knows and the state doesn't: the note wins.
        const agreed = adopted.has(task) ? agreedFields(task.fields, todo.fields) : undefined;
        const { toThings, toVault } = agreed
            ? { toThings: differences(todo.fields, agreed), toVault: differences(task.fields, agreed) }
            : mergeFields(task.fields, todo.fields, synced?.fields ?? todo.fields, caps);
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
            const lost = swapping(here.path) && there.path === here.path && there.heading !== undefined && !targetOf(here.path).includes(there.heading);
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

    // Notes deleted from the vault, then lines. For the guard, each line
    // gone from a note still there counts, and a deleted note counts once.
    const trashing = new Set<string>();
    const deleted = new Set<string>();
    for (const sp of state.projects) {
        if (files.exists(sp.path) || !included(sp.path) || !live(projectById.get(sp.id))) continue;
        if (state.projects.some(other => other !== sp && other.id === sp.id && files.exists(other.path))) continue;
        trashing.add(sp.id);
        deleted.add(sp.path);
        thingsSteps.push({ kind: 'trashProject', id: sp.id });
    }
    let linesGone = 0;
    for (const synced of state.todos) {
        const todo = todoById.get(synced.id);
        if (lineById.has(synced.id) || !todo || gone(todo)) continue;
        const path = synced.place.path;
        // A note sync no longer reads (excluded since) isn't a note whose lines were deleted.
        if (!included(path)) continue;
        if (!files.exists(path)) deleted.add(path);
        else if (opts.now - files.mtime(path) >= opts.settleMs) linesGone++;
        else continue;
        if (todo.projectId === undefined || !trashing.has(todo.projectId)) thingsSteps.push({ kind: 'trashTodo', id: synced.id });
    }
    const goneFromVault = linesGone + deleted.size;

    // Renames and moves of synced notes and projects.
    for (const sp of state.projects) {
        const project = projectById.get(sp.id);
        if (!files.exists(sp.path) || !included(sp.path) || !live(project)) continue;
        const folder = folderOf(sp.path);
        const base = baseOf(sp.path);
        const wasFolder = sp.areaId === undefined ? '' : stateFolder(sp.areaId) ?? folder;
        // The folder of the area Things has it in, or undefined for an area the vault has no folder for yet.
        const area = project.areaId === undefined ? undefined : areaById.get(project.areaId);
        const thingsFolder = project.areaId === undefined ? '' : area ? stateFolder(area.id) : undefined;
        const change: { title?: string; folder?: string } = {};
        let movedTo: string | undefined;
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
            // A new area's folder comes with the note; an area Things doesn't list can't be followed.
            const target = thingsFolder ?? (area ? folderFor(area.title) : undefined);
            if (target === undefined) change.folder = folder;
            else { to = target; movedTo = area?.id; }
        }
        if (change.title !== undefined || change.folder !== undefined) thingsSteps.push({ kind: 'updateProject', id: sp.id, ...change });
        if (title === base && to === folder) continue;
        const path = noteName(title, other => other !== sp.path && taken(other), to);
        if (path === sp.path) continue;
        reserved.add(path);
        vaultSteps.push({ kind: 'renameNote', from: sp.path, to: path, ...(movedTo === undefined ? {} : { areaId: movedTo }) });
    }

    // Areas renamed in Things get their folder's name back.
    for (const area of state.areas) {
        const current = areaById.get(area.id);
        // An area keeps a folder's exact name, or one that makes the same folder.
        if (current && area.folder && current.title !== areaName(area.folder) && folderFor(current.title) !== area.folder) thingsSteps.push({ kind: 'renameArea', id: area.id, folder: area.folder });
    }

    // Headings: the swap, or Things' headings written into the note.
    const orderOf = (plan: NoteHeadings) => {
        const { note, id, target } = plan;
        const entry = (todoId: string, heading?: string) => heading !== undefined && target.includes(heading) ? { id: todoId, heading } : { id: todoId };
        const order: Array<{ id: string; heading?: string }> = [];
        const listed = new Set<string>();
        finals.forEach((place, todoId) => {
            if (place.path !== note.path) return;
            order.push(entry(todoId, place.heading));
            listed.add(todoId);
        });
        // Everything else still in the old project comes across too, so the
        // old one is empty when it goes to the Trash. A to-do on its way to
        // another note comes at its current heading, and its own moveTodo,
        // after the swap, takes it on.
        for (const todo of things.todos) {
            if (todo.projectId !== id || todo.trashed || listed.has(todo.id)) continue;
            order.push(entry(todo.id, thingsPlace(todo, syncedById.get(todo.id)?.place)?.heading));
        }
        return order;
    };
    for (const plan of headingsOf.values()) {
        const { note } = plan;
        const dropped = plan.written.filter(h => !plan.things.includes(h) && !plan.renamed.has(h));
        const stays = dropped.some(h => note.tasks.some(t => t.heading === h && !leaving.has(t)));
        if (plan.vaultChanged || (plan.thingsChanged && stays)) {
            thingsSteps.push({ kind: 'swapProject', path: note.path, id: plan.id, headings: plan.target, order: orderOf(plan) });
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

    // An area whose folder has no synced notes left and holds nothing in Things
    // outside the Trash: a repeating to-do or a finished project keeps it.
    for (const area of state.areas) {
        if (!areaById.has(area.id)) continue;
        const inFolder = (path: string) => folderOf(path) === area.folder;
        const loose = state.looseNotes[area.id];
        const used = vault.notes.some(n => n.folder === area.folder)
            || state.projects.some(sp => inFolder(sp.path) && files.exists(sp.path))
            || [...newNotes.keys()].some(inFolder)
            || (loose !== undefined && files.exists(loose));
        const holds = things.projects.some(p => p.areaId === area.id && live(p))
            || things.todos.some(t => t.areaId === area.id && !gone(t));
        if (!used && !holds) thingsSteps.push({ kind: 'deleteArea', id: area.id });
    }

    const tripped = (missing: number) => missing > MISSING_LIMIT && missing > state.todos.length * MISSING_SHARE;
    if (tripped(goneFromThings)) return { ok: false, reason: 'emptied', side: 'things', missing: goneFromThings };
    if (!opts.acceptMissing && tripped(goneFromVault)) return { ok: false, reason: 'emptied', side: 'vault', missing: goneFromVault };

    const allVault: VaultStep[] = [...newNotes.values(), ...vaultSteps];
    const toThingsKinds: ReadonlyArray<ThingsStep['kind']> = firstConnect ? ['createTodo'] : ['createTodo', 'updateTodo', 'moveTodo', 'trashTodo'];
    const toVaultKinds: ReadonlyArray<VaultStep['kind']> = firstConnect ? ['add'] : ['update', 'move', 'add', 'retire'];
    const toThings = thingsSteps.filter(s => toThingsKinds.includes(s.kind)).length;
    const toVault = allVault.reduce((sum, s) => sum + (s.kind === 'createNote' ? s.todos.length : toVaultKinds.includes(s.kind) ? 1 : 0), 0);
    return { ok: true, things: byKind(thingsSteps, THINGS_ORDER), vault: byKind(allVault, VAULT_ORDER), counts: { toThings, toVault } };
}
