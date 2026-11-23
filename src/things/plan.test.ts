import { joinFirstConnect } from './join';
import { EMPTY_STATE } from './model';
import type { Capabilities, Place, SyncedProject, SyncedTodo, ThingsArea, ThingsProject, ThingsSnapshot, ThingsState, ThingsTodo, TodoFields, VaultNote, VaultSnapshot, VaultTask } from './model';
import { planThingsSync } from './plan';
import type { ThingsPlan, ThingsStep, VaultStep } from './plan';

const NOW = Date.UTC(2026, 10, 22, 12, 0);
const SETTLE = 5 * 60 * 1000;
/** A note that has sat still long enough. */
const OLD = NOW - 2 * SETTLE;
/** A note edited half a minute ago. */
const FRESH = NOW - 30_000;
const caps: Capabilities = { headings: true, checklist: true, reminder: true, repeating: true, reorder: false };

const A = 'aaaaaaaa';
const B = 'bbbbbbbb';
const C = 'cccccccc';
const PLAN = 'Work/Plan.md';
const HOME = 'Work/Home.md';

function fields(title: string, over: Partial<TodoFields> = {}): TodoFields {
    return { title, notes: '', checklist: [], tags: [], status: 'open', someday: false, ...over };
}

/** A task line; `note()` puts it in its note. */
function line(title: string, over: Partial<VaultTask> & { f?: Partial<TodoFields> } = {}): VaultTask {
    const { f, ...rest } = over;
    return { path: '', line: 0, text: rest.id ? `${title} %%things:${rest.id}%%` : title, fields: fields(title, f), ...rest };
}

function note(path: string, tasks: VaultTask[], headings?: string[]): VaultNote {
    const slash = path.lastIndexOf('/');
    const placed = tasks.map((task, i) => ({ ...task, path, line: task.line || i + 2 }));
    const held = placed.map(t => t.heading).filter((h, i, all): h is string => h !== undefined && all.indexOf(h) === i);
    return { path, folder: slash < 0 ? '' : path.slice(0, slash), title: path.slice(slash + 1).replace(/\.md$/, ''), mtime: OLD, headings: headings ?? held, tasks: placed };
}

function todo(id: string, title: string, over: Partial<ThingsTodo> & { f?: Partial<TodoFields> } = {}): ThingsTodo {
    const { f, ...rest } = over;
    return { id, inbox: false, fields: fields(title, f), repeating: false, trashed: false, logged: false, ...rest };
}

function project(id: string, title: string, over: Partial<ThingsProject> = {}): ThingsProject {
    return { id, title, headings: [], status: 'open', trashed: false, ...over };
}

function synced(id: string, title: string, path: string, over: { heading?: string; f?: Partial<TodoFields> } = {}): SyncedTodo {
    return { id, place: over.heading === undefined ? { path } : { path, heading: over.heading }, fields: fields(title, over.f) };
}

function state(over: Partial<ThingsState> = {}): ThingsState {
    return { ...EMPTY_STATE, joined: true, areas: [], projects: [], todos: [], looseNotes: {}, ...over };
}

interface World {
    notes?: VaultNote[];
    areas?: ThingsArea[];
    projects?: ThingsProject[];
    todos?: ThingsTodo[];
    caps?: Partial<Capabilities>;
    state?: ThingsState;
    /** When notes last changed. Every note in `notes` exists and has sat still unless this says otherwise. */
    files?: Record<string, number>;
    /** Notes that no longer exist. */
    deleted?: string[];
    acceptMissing?: boolean;
    /** Folders (or notes) excluded from tasks in settings. */
    excluded?: string[];
}

const includedBy = (w: World) => (path: string) => !(w.excluded ?? []).some(out => path === out || path.startsWith(`${out}/`));

function snapshots(w: World): [VaultSnapshot, ThingsSnapshot] {
    return [
        { notes: w.notes ?? [], folders: [] },
        { areas: w.areas ?? [], projects: w.projects ?? [], todos: w.todos ?? [], capabilities: { ...caps, ...w.caps } }
    ];
}

/** Every note that exists, with when it last changed. */
function filesOf(w: World): Record<string, number> {
    const files: Record<string, number> = {};
    for (const n of w.notes ?? []) files[n.path] = OLD;
    Object.assign(files, w.files);
    for (const path of w.deleted ?? []) delete files[path];
    return files;
}

function plan(w: World): ThingsPlan {
    const files = filesOf(w);
    return planThingsSync(
        ...snapshots(w),
        w.state ?? state(),
        { now: NOW, settleMs: SETTLE, notes: { exists: path => path in files, mtime: path => files[path] ?? 0, included: includedBy(w) }, acceptMissing: w.acceptMissing }
    );
}

/** What joining by name records, before anything is planned. */
function joined(w: World): ThingsState {
    const files = filesOf(w);
    const included = includedBy(w);
    return joinFirstConnect(...snapshots(w), w.state ?? state(), path => path in files && included(path));
}

const where = (place: Place): string => place.heading === undefined ? place.path : `${place.path}#${place.heading}`;

function thingsLine(step: ThingsStep): string {
    switch (step.kind) {
        case 'createArea': return `createArea ${step.folder}`;
        case 'renameArea': return `renameArea ${step.id} ${step.folder}`;
        case 'createProject': return `createProject ${step.path} [${step.headings.join(', ')}]`;
        case 'swapProject': return `swapProject ${step.id} [${step.headings.join(', ')}] ${step.order.map(o => o.heading === undefined ? o.id : `${o.id}#${o.heading}`).join(' ')}`.trim();
        case 'updateProject': return `updateProject ${step.id}${step.title === undefined ? '' : ` title=${step.title}`}${step.folder === undefined ? '' : ` folder=${step.folder}`}`;
        case 'trashProject': return `trashProject ${step.id}`;
        case 'deleteArea': return `deleteArea ${step.id}`;
        case 'createTodo': return `createTodo ${step.task.fields.title}`;
        case 'updateTodo': return `updateTodo ${step.id} ${JSON.stringify(step.fields)}`;
        case 'moveTodo': return `moveTodo ${step.id} ${where(step.to)}`;
        case 'trashTodo': return `trashTodo ${step.id}`;
    }
}

function vaultLine(step: VaultStep): string {
    switch (step.kind) {
        case 'link': return `link ${step.id}`;
        case 'adopt': return `adopt ${step.task.fields.title} ${step.id}`;
        case 'unlink': return `unlink ${step.task.fields.title}`;
        case 'update': return `update ${step.task.fields.title} ${JSON.stringify(step.fields)}`;
        case 'move': return `move ${step.task.fields.title} ${where(step.to)}`;
        case 'add': return `add ${step.todo.fields.title} ${where(step.to)}`;
        case 'retire': return `retire ${step.task.fields.title}`;
        case 'createNote': return `createNote ${step.path} [${step.headings.join(', ')}] ${step.todos.map(t => t.fields.title).join(', ')}`.trim();
        case 'renameNote': return `renameNote ${step.from} ${step.to}`;
        case 'headings': return `headings ${step.path} ${step.from.join(',')} > ${step.to.join(',')}`;
    }
}

function show(result: ThingsPlan): string[] {
    if (!result.ok) throw new Error(`stopped: ${result.side} ${result.missing}`);
    return [...result.things.map(thingsLine), ...result.vault.map(vaultLine)];
}

function steps(result: ThingsPlan): { things: ThingsStep[]; vault: VaultStep[] } {
    if (!result.ok) throw new Error(`stopped: ${result.side} ${result.missing}`);
    return result;
}

// One synced note, Work/Plan.md, with "Call Mom" under Calls, as project proj1 in area1 (folder Work).
const WORK: ThingsArea = { id: 'area1', title: 'Work' };
const planSynced = (over: Partial<SyncedProject> = {}): SyncedProject => ({ id: 'proj1', path: PLAN, title: 'Plan', headings: ['Calls'], areaId: 'area1', ...over });
const homeSynced: SyncedProject = { id: 'proj2', path: HOME, title: 'Home', headings: [], areaId: 'area1' };
const mom = (over: Partial<VaultTask> & { f?: Partial<TodoFields> } = {}) => line('Call Mom', { id: A, heading: 'Calls', ...over });
const momTodo = (over: Partial<ThingsTodo> & { f?: Partial<TodoFields> } = {}) => todo(A, 'Call Mom', { projectId: 'proj1', areaId: 'area1', heading: 'Calls', ...over });
const planProject = (over: Partial<ThingsProject> = {}) => project('proj1', 'Plan', { areaId: 'area1', headings: ['Calls'], ...over });
const homeProject = project('proj2', 'Home', { areaId: 'area1' });
const syncedState = (over: Partial<ThingsState> = {}) => state({
    areas: [{ id: 'area1', folder: 'Work' }],
    projects: [planSynced()],
    todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls' })],
    ...over
});

function world(over: World = {}): World {
    return { notes: [note(PLAN, [mom()])], areas: [WORK], projects: [planProject()], todos: [momTodo()], state: syncedState(), ...over };
}

/** Plan.md and Home.md both synced; Call Mom in Plan.md under Calls. */
function twoNotes(over: World = {}): World {
    return world({
        projects: [planProject(), homeProject],
        state: syncedState({ projects: [planSynced(), homeSynced] }),
        ...over
    });
}

describe('planThingsSync: nothing to do', () => {
    it('plans nothing when neither side changed', () => {
        expect(show(plan(world()))).toEqual([]);
        expect(plan(world())).toMatchObject({ ok: true, counts: { toThings: 0, toVault: 0 } });
    });
});

describe('planThingsSync: fields', () => {
    it('sends a task reworded in the note to its to-do', () => {
        expect(show(plan(world({ notes: [note(PLAN, [line('Call Dad', { id: A, heading: 'Calls' })])] })))).toEqual([
            'updateTodo aaaaaaaa {"title":"Call Dad"}'
        ]);
    });
    it('brings a to-do completed in Things back to its line; logged means done, not gone', () => {
        expect(show(plan(world({ todos: [momTodo({ logged: true, f: { status: 'completed' } })] })))).toEqual([
            'update Call Mom {"status":"completed"}'
        ]);
    });
    it('lets the note win when both sides changed the same field', () => {
        const vaultSide = note(PLAN, [line('Call Dad', { id: A, heading: 'Calls' })]);
        expect(show(plan(world({ notes: [vaultSide], todos: [momTodo({ f: { title: 'Ring Mom' } })] })))).toEqual([
            'updateTodo aaaaaaaa {"title":"Call Dad"}'
        ]);
    });
    it('ignores a checklist Things can\'t show', () => {
        const ticked = [{ title: 'Flowers', done: true }];
        const st = syncedState({ todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls', f: { checklist: ticked } })] });
        const w = world({ notes: [note(PLAN, [mom({ f: { checklist: ticked } })])], state: st, todos: [momTodo()], caps: { checklist: false } });
        expect(show(plan(w))).toEqual([]);
    });
    it('keeps a repeating to-do\'s date and completion: Things\' own come back to the line', () => {
        const st = syncedState({ todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls', f: { when: '2026-11-23' } })] });
        const w = world({
            state: st,
            notes: [note(PLAN, [mom({ f: { when: '2026-11-25', status: 'completed' } })])],
            todos: [momTodo({ repeating: true, f: { when: '2026-11-23' } })]
        });
        expect(show(plan(w))).toEqual(['update Call Mom {"status":"open","when":"2026-11-23"}']);
    });
});

describe('planThingsSync: where a to-do sits', () => {
    it('moves the to-do when the task moved to another note', () => {
        const w = twoNotes({ notes: [note(HOME, [mom({ heading: undefined })])], files: { [PLAN]: OLD } });
        expect(show(plan(w))).toEqual(['moveTodo aaaaaaaa Work/Home.md']);
    });
    it('moves the task when the to-do moved to another project in Things', () => {
        const w = twoNotes({ notes: [note(PLAN, [mom()]), note(HOME, [line('Water plants', { id: B })])],
            todos: [momTodo({ projectId: 'proj2', heading: undefined }), todo(B, 'Water plants', { projectId: 'proj2' })],
            state: syncedState({ projects: [planSynced(), homeSynced], todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls' }), synced(B, 'Water plants', HOME)] }) });
        expect(show(plan(w))).toEqual(['move Call Mom Work/Home.md']);
    });
    it('takes the note\'s place when both sides moved it', () => {
        const other = project('proj3', 'Other', { areaId: 'area1' });
        const w = twoNotes({
            notes: [note(HOME, [mom({ heading: undefined })])], files: { [PLAN]: OLD, 'Work/Other.md': OLD },
            projects: [planProject(), homeProject, other],
            todos: [momTodo({ projectId: 'proj3', heading: undefined })],
            state: syncedState({ projects: [planSynced(), homeSynced, { id: 'proj3', path: 'Work/Other.md', title: 'Other', headings: [], areaId: 'area1' }] })
        });
        expect(show(plan(w))).toEqual(['moveTodo aaaaaaaa Work/Home.md']);
    });
    it('moves the task under another heading when Things can show headings, and not otherwise', () => {
        const both = ['Calls', 'Errands'];
        const w = world({
            notes: [note(PLAN, [mom(), line('Buy milk', { id: B, heading: 'Errands' })])],
            projects: [planProject({ headings: both })],
            todos: [momTodo({ heading: 'Errands' }), todo(B, 'Buy milk', { projectId: 'proj1', heading: 'Errands' })],
            state: syncedState({ projects: [planSynced({ headings: both })], todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls' }), synced(B, 'Buy milk', PLAN, { heading: 'Errands' })] })
        });
        expect(show(plan(w))).toEqual(['move Call Mom Work/Plan.md#Errands']);
        expect(show(plan({ ...w, caps: { headings: false } }))).toEqual([]);
    });
    it('holds a task moved between notes until it arrives, then moves its to-do once (Review Focus 3)', () => {
        // Round 1: the line left Plan.md half a minute ago and hasn't reached Home.md yet.
        expect(show(plan(twoNotes({ notes: [], files: { [PLAN]: FRESH, [HOME]: OLD } })))).toEqual([]);
        // Round 2: it arrived.
        expect(show(plan(twoNotes({ notes: [note(HOME, [mom({ heading: undefined })])], files: { [PLAN]: FRESH } })))).toEqual([
            'moveTodo aaaaaaaa Work/Home.md'
        ]);
    });
    it('makes the project first when the task moved into a note that has none', () => {
        const w = world({ notes: [note('Work/New.md', [mom({ heading: undefined })])], files: { [PLAN]: OLD } });
        expect(show(plan(w))).toEqual(['createProject Work/New.md []', 'moveTodo aaaaaaaa Work/New.md']);
    });
});

describe('planThingsSync: headings', () => {
    it('rebuilds the project when the note\'s headings changed, listing every to-do with its heading', () => {
        const w = world({
            notes: [note(PLAN, [mom(), line('Buy milk', { heading: 'Errands' })])],
            todos: [momTodo(), todo(C, 'Pay rent', { projectId: 'proj1' }), todo('dddddddd', 'Old report', { projectId: 'proj1', logged: true, f: { status: 'completed' } })]
        });
        expect(show(plan(w))).toEqual([
            'swapProject proj1 [Calls, Errands] aaaaaaaa#Calls cccccccc dddddddd',
            'createTodo Buy milk',
            'add Pay rent Work/Plan.md'
        ]);
    });
    it('brings a to-do on its way to another note across in the swap, so its own move takes it on', () => {
        const both = ['Calls', 'Errands'];
        const w = twoNotes({
            notes: [note(PLAN, [mom()]), note(HOME, [line('Buy milk', { id: B })])],
            projects: [planProject({ headings: both }), homeProject],
            todos: [momTodo(), todo(B, 'Buy milk', { projectId: 'proj1', heading: 'Errands' })],
            state: syncedState({
                projects: [planSynced({ headings: both }), homeSynced],
                todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls' }), synced(B, 'Buy milk', PLAN, { heading: 'Errands' })]
            })
        });
        expect(show(plan(w))).toEqual(['swapProject proj1 [Calls] aaaaaaaa#Calls bbbbbbbb', 'moveTodo bbbbbbbb Work/Home.md']);
    });
    it('writes headings added in Things into the note', () => {
        const w = world({
            projects: [planProject({ headings: ['Calls', 'Later'] })],
            todos: [momTodo(), todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Later' })]
        });
        expect(show(plan(w))).toEqual(['headings Work/Plan.md Calls > Calls,Later', 'add Pay rent Work/Plan.md#Later']);
    });
    it('ignores an empty heading added in Things', () => {
        expect(show(plan(world({ projects: [planProject({ headings: ['Calls', 'Someday'] })] })))).toEqual([]);
    });
    it('renames a heading renamed in Things without moving its tasks', () => {
        const w = world({ projects: [planProject({ headings: ['Phone'] })], todos: [momTodo({ heading: 'Phone' })] });
        expect(show(plan(w))).toEqual(['headings Work/Plan.md Calls > Phone']);
    });
    it('does nothing for a heading renamed in Things when Things can\'t show headings', () => {
        const w = world({ projects: [planProject({ headings: ['Phone'] })], todos: [momTodo({ heading: 'Phone' })], caps: { headings: false } });
        expect(show(plan(w))).toEqual([]);
    });
    it('rebuilds from the note when both sides changed headings', () => {
        const w = world({
            notes: [note(PLAN, [mom(), line('Buy milk', { heading: 'Errands' })])],
            projects: [planProject({ headings: ['Phone'] })],
            todos: [momTodo({ heading: 'Phone' })]
        });
        expect(show(plan(w))).toEqual(['swapProject proj1 [Calls, Errands] aaaaaaaa#Calls', 'createTodo Buy milk']);
    });
    it('brings back a heading Things removed while the note still has tasks under it', () => {
        const both = ['Calls', 'Errands'];
        const w = world({
            notes: [note(PLAN, [mom(), line('Buy milk', { heading: 'Errands' })])],
            projects: [planProject({ headings: ['Calls'] })],
            state: syncedState({ projects: [planSynced({ headings: both })] })
        });
        expect(show(plan(w))).toEqual(['swapProject proj1 [Calls, Errands] aaaaaaaa#Calls', 'createTodo Buy milk']);
    });
});

describe('planThingsSync: new on one side', () => {
    it('makes the area and project first for a task in a new note', () => {
        expect(show(plan({ notes: [note('Home/Chores.md', [line('Water plants', { heading: 'Garden' })])] }))).toEqual([
            'createArea Home', 'createProject Home/Chores.md [Garden]', 'createTodo Water plants'
        ]);
    });
    it('makes no area for a note at the top of the vault', () => {
        expect(show(plan({ notes: [note('Chores.md', [line('Water plants')])] }))).toEqual(['createProject Chores.md []', 'createTodo Water plants']);
    });
    it('sends tasks in the Things Inbox note and in an area\'s loose note without a project', () => {
        const st = syncedState({ looseNotes: { area1: 'Work/Work.md' } });
        const w = world({ state: st, notes: [note(PLAN, [mom()]), note('Things Inbox.md', [line('Call plumber')]), note('Work/Work.md', [line('File taxes')])] });
        expect(show(plan(w))).toEqual(['createTodo Call plumber', 'createTodo File taxes']);
    });
    it('adds a new to-do from Things under its heading', () => {
        const w = world({ todos: [momTodo(), todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Calls' })] });
        expect(show(plan(w))).toEqual(['add Pay rent Work/Plan.md#Calls']);
    });
    it('adds Inbox to-dos, and to-dos with no list, to the Things Inbox note, making it when missing', () => {
        const todos = [momTodo(), todo(C, 'Call plumber', { inbox: true }), todo('dddddddd', 'Book flights', { f: { when: '2026-11-22' } })];
        expect(show(plan(world({ todos, files: { 'Things Inbox.md': OLD } })))).toEqual([
            'add Call plumber Things Inbox.md', 'add Book flights Things Inbox.md'
        ]);
        expect(show(plan(world({ todos })))).toEqual(['createNote Things Inbox.md [] Call plumber, Book flights']);
    });
    it('adds an area\'s loose to-dos to its loose note, naming one when the area has none', () => {
        const w = world({ todos: [momTodo(), todo(C, 'File taxes', { areaId: 'area1' })] });
        expect(show(plan(w))).toEqual(['createNote Work/Work.md [] File taxes']);
        expect(steps(plan(w)).vault[0]).toMatchObject({ areaId: 'area1' });
        const st = syncedState({ looseNotes: { area1: 'Work/Loose.md' } });
        expect(show(plan(world({ ...w, state: st, files: { 'Work/Loose.md': OLD } })))).toEqual(['add File taxes Work/Loose.md']);
    });
    it('brings a new Things project in as a note with its to-dos and the headings that hold them', () => {
        const launch = project('proj9', 'Launch', { areaId: 'area1', headings: ['Prep', 'Empty', 'Go'] });
        const w = world({
            projects: [planProject(), launch],
            todos: [momTodo(), todo(C, 'Write copy', { projectId: 'proj9', heading: 'Go' }), todo('dddddddd', 'Pick date', { projectId: 'proj9', heading: 'Prep' })]
        });
        expect(show(plan(w))).toEqual(['createNote Work/Launch.md [Prep, Go] Write copy, Pick date']);
        expect(steps(plan(w)).vault[0]).toMatchObject({ projectId: 'proj9', areaId: 'area1', title: 'Launch' });
    });
    it('puts a project from a new area in that area\'s folder, numbering a name in use', () => {
        const errands: ThingsArea = { id: 'area7', title: 'Home/Errands' };
        const w = world({
            areas: [WORK, errands],
            projects: [planProject(), project('proj8', 'Groceries', { areaId: 'area7' }), project('proj9', 'Plan', { areaId: 'area1' })],
            files: { 'Home/Errands/Groceries.md': OLD }
        });
        expect(show(plan(w))).toEqual(['createNote Home/Errands/Groceries 2.md []', 'createNote Work/Plan 2.md []']);
        expect(steps(plan(w)).vault[0]).toMatchObject({ projectId: 'proj8', areaId: 'area7' });
    });
    it('never brings in repeating, completed, cancelled or trashed to-dos, or finished projects', () => {
        const w = world({
            projects: [planProject(), project('proj9', 'Done', { status: 'completed' }), project('projT', 'Gone', { trashed: true })],
            todos: [momTodo(), todo(C, 'Water plants', { projectId: 'proj1', repeating: true }),
                todo('dddddddd', 'Old', { projectId: 'proj1', logged: true, f: { status: 'completed' } }),
                todo('eeeeeeee', 'Dropped', { projectId: 'proj1', logged: true, f: { status: 'canceled' } }),
                todo('ffffffff', 'Binned', { projectId: 'proj1', trashed: true })]
        });
        expect(show(plan(w))).toEqual([]);
    });
});

describe('planThingsSync: gone from Things', () => {
    it('retires a line whose to-do was trashed or is missing', () => {
        expect(show(plan(world({ todos: [momTodo({ trashed: true })] })))).toEqual(['retire Call Mom']);
        expect(show(plan(world({ todos: [] })))).toEqual([]);
        expect(show(plan(world({ todos: [], state: syncedState({ absent: [A] }) })))).toEqual(['retire Call Mom']);
    });
    it('leaves a done line whose to-do is missing, since it may be in the Logbook', () => {
        const done = { status: 'completed' as const };
        const st = syncedState({ todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls', f: done })] });
        expect(show(plan(world({ state: st, notes: [note(PLAN, [mom({ f: done })])], todos: [] })))).toEqual([]);
    });
    it('retires each synced task of a project trashed in Things, leaving new tasks for a later round', () => {
        const w = world({
            notes: [note(PLAN, [mom(), line('Buy milk', { id: B, heading: 'Calls' }), line('Fresh idea', { heading: 'Calls' })])],
            projects: [planProject({ trashed: true })],
            todos: [momTodo(), todo(B, 'Buy milk', { projectId: 'proj1', heading: 'Calls' })],
            state: syncedState({ todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls' }), synced(B, 'Buy milk', PLAN, { heading: 'Calls' })] })
        });
        expect(show(plan(w))).toEqual(['retire Call Mom', 'retire Buy milk']);
    });
    it('never stops for the to-dos of a trashed project that Things no longer lists', () => {
        const ids = ['id0xxxxxx', 'id1xxxxxx', 'id2xxxxxx', 'id3xxxxxx', 'id4xxxxxx'];
        const w = world({
            notes: [note(PLAN, ids.map(id => line(`Task ${id}`, { id, heading: 'Calls' })))],
            projects: [planProject({ trashed: true })],
            todos: [],
            state: syncedState({ todos: ids.map(id => synced(id, `Task ${id}`, PLAN, { heading: 'Calls' })) })
        });
        expect(show(plan(w))).toEqual(ids.map(id => `retire Task ${id}`));
    });
});

describe('planThingsSync: gone from the vault', () => {
    it('trashes the to-do of a deleted line once its note has settled', () => {
        expect(show(plan(world({ notes: [], files: { [PLAN]: OLD } })))).toEqual(['trashTodo aaaaaaaa']);
        expect(show(plan(world({ notes: [], files: { [PLAN]: NOW - SETTLE } })))).toEqual(['trashTodo aaaaaaaa']);
    });
    it('waits while the note is still changing', () => {
        expect(show(plan(world({ notes: [], files: { [PLAN]: FRESH } })))).toEqual([]);
    });
    it('trashes a to-do at once when the note it was in is gone', () => {
        const st = syncedState({ todos: [synced(A, 'Call Mom', 'Things Inbox.md')] });
        expect(show(plan(world({ notes: [], state: st, files: { [PLAN]: OLD }, todos: [momTodo({ projectId: undefined, inbox: true })] })))).toEqual(['trashTodo aaaaaaaa']);
    });
    it('trashes the project of a deleted note, and its to-dos with it', () => {
        expect(show(plan(world({ notes: [], deleted: [PLAN] })))).toEqual(['trashProject proj1']);
    });
    it('keeps the project of a note that only lost its tasks', () => {
        const done = plan(world({ notes: [], files: { [PLAN]: OLD } }));
        expect(show(done)).not.toContain('trashProject proj1');
    });
    it('leaves a to-do that is gone from both sides', () => {
        expect(show(plan(world({ notes: [], files: { [PLAN]: OLD }, todos: [momTodo({ trashed: true })] })))).toEqual([]);
    });
    describe('areas', () => {
        const old: ThingsArea = { id: 'area2', title: 'Old' };
        const st = syncedState({ areas: [{ id: 'area1', folder: 'Work' }, { id: 'area2', folder: 'Old' }] });
        const holding = (over: World) => show(plan(world({ areas: [WORK, old], state: st, ...over })));

        it('deletes an area once its folder has no synced notes and Things holds nothing in it outside the Trash', () => {
            expect(holding({})).toEqual(['deleteArea area2']);
            expect(holding({ todos: [momTodo(), todo(C, 'Binned', { areaId: 'area2', trashed: true })] })).toEqual(['deleteArea area2']);
            expect(holding({ projects: [planProject(), project('proj5', 'Binned', { areaId: 'area2', trashed: true })] })).toEqual(['deleteArea area2']);
        });
        it('keeps an area that still holds an open project', () => {
            expect(holding({ projects: [planProject(), project('proj5', 'Still here', { areaId: 'area2' })] })).not.toContain('deleteArea area2');
        });
        it('keeps an area that still holds a completed or repeating to-do', () => {
            expect(holding({ todos: [momTodo(), todo(C, 'Loose end', { areaId: 'area2', logged: true, f: { status: 'completed' } })] })).toEqual([]);
            expect(holding({ todos: [momTodo(), todo(C, 'Water plants', { areaId: 'area2', repeating: true })] })).toEqual([]);
        });
        it('keeps an area that still holds a completed project', () => {
            expect(holding({ projects: [planProject(), project('proj5', 'Shipped', { areaId: 'area2', status: 'completed' })] })).toEqual([]);
        });
    });
});

describe('planThingsSync: renames', () => {
    it('renames the project when the note was renamed', () => {
        const w = world({ notes: [note('Work/Roadmap.md', [mom()])], state: syncedState({ projects: [planSynced({ path: 'Work/Roadmap.md' })], todos: [synced(A, 'Call Mom', 'Work/Roadmap.md', { heading: 'Calls' })] }) });
        expect(show(plan(w))).toEqual(['updateProject proj1 title=Roadmap']);
    });
    it('moves the project, making the area first, when the note moved to another folder', () => {
        const w = world({ notes: [note('Home/Plan.md', [mom()])], state: syncedState({ projects: [planSynced({ path: 'Home/Plan.md' })], todos: [synced(A, 'Call Mom', 'Home/Plan.md', { heading: 'Calls' })] }) });
        expect(show(plan(w))).toEqual(['createArea Home', 'updateProject proj1 folder=Home']);
    });
    it('renames the note when the project was renamed in Things', () => {
        expect(show(plan(world({ projects: [planProject({ title: 'Roadmap' })] })))).toEqual(['renameNote Work/Plan.md Work/Roadmap.md']);
    });
    it('keeps the note\'s name when both were renamed', () => {
        const w = world({
            notes: [note('Work/Q4.md', [mom()])], projects: [planProject({ title: 'Roadmap' })],
            state: syncedState({ projects: [planSynced({ path: 'Work/Q4.md' })], todos: [synced(A, 'Call Mom', 'Work/Q4.md', { heading: 'Calls' })] })
        });
        expect(show(plan(w))).toEqual(['updateProject proj1 title=Q4']);
    });
    it('sees a note named after a title with characters a file can\'t hold as unchanged', () => {
        const path = 'Work/Q3 plan.md';
        const w = world({
            notes: [note(path, [mom()])], projects: [planProject({ title: 'Q3: plan' })],
            state: syncedState({ projects: [planSynced({ path, title: 'Q3: plan' })], todos: [synced(A, 'Call Mom', path, { heading: 'Calls' })] })
        });
        expect(show(plan(w))).toEqual([]);
    });
    it('moves the note when the project moved to another synced area in Things', () => {
        const home: ThingsArea = { id: 'area2', title: 'Home' };
        const st = syncedState({ areas: [{ id: 'area1', folder: 'Work' }, { id: 'area2', folder: 'Home' }] });
        const result = plan(world({ areas: [WORK, home], state: st, projects: [planProject({ areaId: 'area2' })], files: { 'Home/Other.md': OLD } }));
        expect(show(result)).toEqual(['renameNote Work/Plan.md Home/Plan.md']);
        expect(steps(result).vault[0]).toMatchObject({ areaId: 'area2' });
    });
    it('moves the note into a new folder when the project moved to a new area in Things, numbering a name in use', () => {
        const fresh: ThingsArea = { id: 'area3', title: 'Home/Errands' };
        const result = plan(world({ areas: [WORK, fresh], projects: [planProject({ areaId: 'area3' })] }));
        expect(show(result)).toEqual(['renameNote Work/Plan.md Home/Errands/Plan.md']);
        expect(steps(result).vault[0]).toMatchObject({ kind: 'renameNote', areaId: 'area3' });
        expect(show(plan(world({ areas: [WORK, fresh], projects: [planProject({ areaId: 'area3' })], files: { 'Home/Errands/Plan.md': OLD } })))).toEqual([
            'renameNote Work/Plan.md Home/Errands/Plan 2.md'
        ]);
    });
    it('moves the note out of its folder when the project left every area in Things', () => {
        const result = plan(world({ projects: [planProject({ areaId: undefined })] }));
        expect(show(result)).toEqual(['renameNote Work/Plan.md Plan.md']);
        expect(steps(result).vault[0]).not.toHaveProperty('areaId');
    });
    it('moves the project back when Things put it in an area it doesn\'t list', () => {
        expect(show(plan(world({ projects: [planProject({ areaId: 'area9' })] })))).toEqual(['updateProject proj1 folder=Work']);
    });
    it('leaves synced areas and notes alone whose names a new note\'s file-safe name would change', () => {
        const CS = 'C#/C# notes.md';
        const MINE = 'My  Work/Plan.md';
        const w = world({
            notes: [note(PLAN, [mom()]), note(CS, [line('Tune', { id: B })]), note(MINE, [line('Ship', { id: C })])],
            areas: [WORK, { id: 'area4', title: 'C#' }, { id: 'area5', title: 'My  Work' }],
            projects: [planProject(), project('proj4', 'C# notes', { areaId: 'area4' }), project('proj5', 'Plan', { areaId: 'area5' })],
            todos: [momTodo(), todo(B, 'Tune', { projectId: 'proj4' }), todo(C, 'Ship', { projectId: 'proj5' })],
            state: syncedState({
                areas: [{ id: 'area1', folder: 'Work' }, { id: 'area4', folder: 'C#' }, { id: 'area5', folder: 'My  Work' }],
                projects: [planSynced(), { id: 'proj4', path: CS, title: 'C# notes', headings: [], areaId: 'area4' }, { id: 'proj5', path: MINE, title: 'Plan', headings: [], areaId: 'area5' }],
                todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls' }), synced(B, 'Tune', CS), synced(C, 'Ship', MINE)]
            })
        });
        expect(show(plan(w))).toEqual([]);
    });
    it('gives an area renamed in Things its folder\'s name back', () => {
        expect(show(plan(world({ areas: [{ id: 'area1', title: 'Job' }] })))).toEqual(['renameArea area1 Work']);
    });
});

describe('planThingsSync: copied lines (Review Focus 2)', () => {
    it('keeps the ID on the first line and gives the copy a to-do of its own', () => {
        const result = plan(world({ notes: [note(PLAN, [mom({ line: 3 }), mom({ line: 7 })])] }));
        expect(show(result)).toEqual(['createTodo Call Mom', 'unlink Call Mom']);
        const { things, vault } = steps(result);
        expect(things[0]).toMatchObject({ kind: 'createTodo', task: { line: 7 } });
        expect((things[0] as Extract<ThingsStep, { kind: 'createTodo' }>).task.id).toBeUndefined();
        expect(vault[0]).toMatchObject({ kind: 'unlink', task: { line: 7, id: A } });
    });
    it('keeps the ID on the line in the note first by path', () => {
        const w = world({ notes: [note(PLAN, [mom()]), note('Work/Archive.md', [mom({ heading: undefined, f: { status: 'completed' } })])] });
        const { vault } = steps(plan(w));
        expect(vault.find(s => s.kind === 'unlink')).toMatchObject({ task: { path: PLAN } });
    });
    it('only unlinks a copied line that is done', () => {
        const w = world({ notes: [note(PLAN, [mom(), mom({ line: 9, f: { status: 'completed' } })])] });
        expect(show(plan(w))).toEqual(['unlink Call Mom']);
    });
});

describe('planThingsSync: the guard', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `id${i}xxxxxx`);
    const many = (lines: number) => world({
        notes: [note(PLAN, ids.slice(0, lines).map(id => line(`Task ${id}`, { id, heading: 'Calls' })))],
        todos: ids.map(id => todo(id, `Task ${id}`, { projectId: 'proj1', heading: 'Calls' })),
        state: syncedState({ todos: ids.map(id => synced(id, `Task ${id}`, PLAN, { heading: 'Calls' })) })
    });

    it('stops when more than 3, and more than a quarter, of the synced to-dos vanish from Things', () => {
        // The second read in a row that misses them: the first only notes them as absent.
        const many10 = many(10);
        const w = { ...many10, state: { ...many10.state!, absent: many10.todos!.map(t => t.id) } };
        expect(plan({ ...w, todos: w.todos!.slice(4) })).toEqual({ ok: false, reason: 'emptied', side: 'things', missing: 4 });
        expect(show(plan({ ...w, todos: w.todos!.slice(3) }))).toEqual(['retire Task id0xxxxxx', 'retire Task id1xxxxxx', 'retire Task id2xxxxxx']);
    });
    it('stops when as many lines vanish from the vault at once', () => {
        expect(plan(many(6))).toEqual({ ok: false, reason: 'emptied', side: 'vault', missing: 4 });
        expect(show(plan(many(7)))).toEqual(['trashTodo id7xxxxxx', 'trashTodo id8xxxxxx', 'trashTodo id9xxxxxx']);
    });
    it('counts no line that is still settling', () => {
        expect(show(plan({ ...many(6), files: { [PLAN]: FRESH } }))).toEqual([]);
    });

    const twelve = Array.from({ length: 12 }, (_, i) => `t${String(i).padStart(2, '0')}xxxxxx`);
    const task = (id: string) => `Task ${id}`;
    it('counts a deleted note once, however many tasks it held', () => {
        const [kept, lost] = [twelve.slice(0, 7), twelve.slice(7)];
        const gone: SyncedProject = { id: 'projG', path: 'Work/Gone.md', title: 'Gone', headings: [], areaId: 'area1' };
        const w = world({
            notes: [note(PLAN, kept.map(id => line(task(id), { id, heading: 'Calls' })))],
            projects: [planProject(), project('projG', 'Gone', { areaId: 'area1' })],
            todos: [...kept.map(id => todo(id, task(id), { projectId: 'proj1', heading: 'Calls' })), ...lost.map(id => todo(id, task(id), { projectId: 'projG' }))],
            state: syncedState({
                projects: [planSynced(), gone],
                todos: [...kept.map(id => synced(id, task(id), PLAN, { heading: 'Calls' })), ...lost.map(id => synced(id, task(id), gone.path))]
            })
        });
        expect(show(plan(w))).toEqual(['trashProject projG']);
    });
    it('stops when 5 lines of 12 vanish across notes, unless the user confirmed it', () => {
        const [inPlan, inHome] = [twelve.slice(0, 6), twelve.slice(6)];
        const w = twoNotes({
            notes: [
                note(PLAN, inPlan.slice(0, 3).map(id => line(task(id), { id, heading: 'Calls' }))),
                note(HOME, inHome.slice(0, 4).map(id => line(task(id), { id })))
            ],
            todos: [...inPlan.map(id => todo(id, task(id), { projectId: 'proj1', heading: 'Calls' })), ...inHome.map(id => todo(id, task(id), { projectId: 'proj2' }))],
            state: syncedState({
                projects: [planSynced(), homeSynced],
                todos: [...inPlan.map(id => synced(id, task(id), PLAN, { heading: 'Calls' })), ...inHome.map(id => synced(id, task(id), HOME))]
            })
        });
        expect(plan(w)).toEqual({ ok: false, reason: 'emptied', side: 'vault', missing: 5 });
        expect(show(plan({ ...w, acceptMissing: true }))).toEqual(['t03xxxxxx', 't04xxxxxx', 't05xxxxxx', 't10xxxxxx', 't11xxxxxx'].map(id => `trashTodo ${id}`));
    });
    it('still checks the Things side when the user confirmed what vanished from the vault', () => {
        const many10 = many(10);
        const w = { ...many10, state: { ...many10.state!, absent: many10.todos!.map(t => t.id) } };
        expect(plan({ ...w, todos: w.todos!.slice(4), acceptMissing: true })).toEqual({ ok: false, reason: 'emptied', side: 'things', missing: 4 });
    });
});

describe('planThingsSync: order and counts', () => {
    it('orders Things steps areas, projects, to-dos, then trash, and vault steps notes first', () => {
        const w = world({
            notes: [note(PLAN, [line('Call Dad', { id: A, heading: 'Calls' })]), note('Home/Chores.md', [line('Water plants')]), note('Work/Gone.md', [line('Old', { id: B })])],
            projects: [planProject({ title: 'Roadmap' }), project('proj9', 'Launch', { areaId: 'area1' }), project('projX', 'Deleted', { areaId: 'area1' })],
            todos: [momTodo({ f: { status: 'completed' } }), todo(B, 'Old', { trashed: true }), todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Calls' })],
            state: syncedState({
                projects: [planSynced(), { id: 'projX', path: 'Work/Deleted.md', title: 'Deleted', headings: [], areaId: 'area1' }],
                todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls' }), synced(B, 'Old', 'Work/Gone.md')]
            })
        });
        expect(show(plan(w))).toEqual([
            'createArea Home',
            'createProject Home/Chores.md []',
            'createTodo Water plants',
            'updateTodo aaaaaaaa {"title":"Call Dad"}',
            'trashProject projX',
            'createNote Work/Launch.md []',
            'renameNote Work/Plan.md Work/Roadmap.md',
            'update Call Dad {"status":"completed"}',
            'add Pay rent Work/Plan.md#Calls',
            'retire Old'
        ]);
    });
    it('counts to-dos changed in Things and tasks changed in the vault', () => {
        const w = world({
            notes: [note(PLAN, [line('Call Dad', { id: A, heading: 'Calls' }), line('Buy milk', { heading: 'Calls' })])],
            todos: [momTodo({ f: { when: '2026-11-30' } }), todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Calls' }), todo('dddddddd', 'Call plumber', { inbox: true })]
        });
        expect(plan(w)).toMatchObject({ ok: true, counts: { toThings: 2, toVault: 3 } });
    });
});

describe('planThingsSync: first connect', () => {
    const fresh = (over: Partial<ThingsState> = {}) => state({ joined: false, ...over });
    const PEOPLE: ThingsArea = { id: 'area2', title: 'People' };
    const SAM = 'Work/People/Sam.md';
    const flowers = [{ title: 'Flowers', done: false }];
    const momLine = (over: Partial<VaultTask> & { f?: Partial<TodoFields> } = {}) => line('Call Mom', { heading: 'Calls', ...over });
    /** Never synced: Work/Plan.md has Call Mom under Calls, and Things has project Plan in area Work with a Call Mom of its own. */
    const meeting = (over: World = {}): World => ({
        notes: [note(PLAN, [momLine()])], areas: [WORK], projects: [planProject()], todos: [momTodo()], state: fresh(), ...over
    });
    type Adopt = Extract<VaultStep, { kind: 'adopt' }>;
    type Add = Extract<VaultStep, { kind: 'add' }>;

    it('joins the area, project and to-do that share names, and gives the line the to-do\'s ID', () => {
        const w = meeting();
        expect(show(plan(w))).toEqual(['adopt Call Mom aaaaaaaa']);
        const adopt = steps(plan(w)).vault[0] as Adopt;
        expect(adopt).toMatchObject({ kind: 'adopt', id: A, task: { path: PLAN, line: 2 } });
        expect(adopt.task.id).toBeUndefined();
        expect(joined(w)).toEqual(fresh({
            areas: [{ id: 'area1', folder: 'Work' }],
            projects: [{ id: 'proj1', path: PLAN, title: 'Plan', headings: ['Calls'], areaId: 'area1' }],
            todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls' })]
        }));
    });
    it('joins an area only to the folder its title names in full: "People" doesn\'t join Work/People', () => {
        const w = meeting({
            notes: [note(PLAN, [momLine()]), note(SAM, [line('Lunch')])],
            areas: [WORK, PEOPLE],
            projects: [planProject(), project('proj3', 'Team', { areaId: 'area2' })]
        });
        expect(joined(w).areas).toEqual([{ id: 'area1', folder: 'Work' }]);
        expect(show(plan(w))).toEqual([
            'createArea Work/People',
            'createProject Work/People/Sam.md []',
            'createTodo Lunch',
            'createNote People/Team.md []',
            'adopt Call Mom aaaaaaaa'
        ]);
    });
    it('joins an open project to the note with its title in its area\'s folder, or at the top for a project in no area', () => {
        const w = meeting({
            notes: [note(PLAN, [momLine()]), note('Chores.md', [line('Water plants')]), note('Work/Shipped.md', [line('Wrap up')])],
            areas: [WORK, PEOPLE],
            projects: [planProject(), project('proj4', 'Chores'), project('proj5', 'Plan', { areaId: 'area2' }), project('proj6', 'Shipped', { areaId: 'area1', status: 'completed' })]
        });
        expect(joined(w).projects).toEqual([
            { id: 'proj1', path: PLAN, title: 'Plan', headings: ['Calls'], areaId: 'area1' },
            { id: 'proj4', path: 'Chores.md', title: 'Chores', headings: [] }
        ]);
        expect(show(plan(w))).toEqual([
            'createProject Work/Shipped.md []',
            'createTodo Water plants',
            'createTodo Wrap up',
            'createNote People/Plan.md []',
            'adopt Call Mom aaaaaaaa'
        ]);
    });
    it('joins each open to-do to the first open line with its title, in line order', () => {
        const w = meeting({
            notes: [note(PLAN, [momLine(), momLine(), line('Buy milk', { heading: 'Calls' })])],
            todos: [momTodo(), todo(B, 'Call Mom', { projectId: 'proj1', heading: 'Calls' }), todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Calls' })]
        });
        expect(show(plan(w))).toEqual(['createTodo Buy milk', 'adopt Call Mom aaaaaaaa', 'adopt Call Mom bbbbbbbb', 'add Pay rent Work/Plan.md#Calls']);
        const adopts = steps(plan(w)).vault.filter((s): s is Adopt => s.kind === 'adopt');
        expect(adopts.map(s => [s.task.line, s.id])).toEqual([[2, A], [3, B]]);
    });
    it('never joins or sends a done or cancelled line', () => {
        const w = meeting({ notes: [note(PLAN, [momLine({ f: { status: 'completed' } }), line('Old', { heading: 'Calls', f: { status: 'canceled' } })])] });
        expect(show(plan(w))).toEqual(['add Call Mom Work/Plan.md#Calls']);
    });
    it('gives a joined to-do with no date the line\'s date', () => {
        expect(show(plan(meeting({ notes: [note(PLAN, [momLine({ f: { when: '2026-11-25' } })])] })))).toEqual([
            'updateTodo aaaaaaaa {"when":"2026-11-25"}',
            'adopt Call Mom aaaaaaaa'
        ]);
    });
    it('gives a line with no notes the joined to-do\'s notes', () => {
        expect(show(plan(meeting({ todos: [momTodo({ f: { notes: 'Ask about the trip' } })] })))).toEqual([
            'adopt Call Mom aaaaaaaa',
            'update Call Mom {"notes":"Ask about the trip"}'
        ]);
    });
    it('takes each field from the note when the note has it and from Things when it doesn\'t, and sends it to the other side', () => {
        const mixed = meeting({
            notes: [note(PLAN, [momLine({ f: { notes: 'Bring cake', tags: ['family'], when: '2026-11-25' } })])],
            todos: [momTodo({ f: { notes: 'Ask about the trip', checklist: flowers, when: '2026-11-30', reminder: '09:00' } })]
        });
        expect(show(plan(mixed))).toEqual([
            'updateTodo aaaaaaaa {"notes":"Bring cake","tags":["family"],"when":"2026-11-25"}',
            'adopt Call Mom aaaaaaaa',
            'update Call Mom {"checklist":[{"title":"Flowers","done":false}],"reminder":"09:00"}'
        ]);
        const fromThings = meeting({ todos: [momTodo({ f: { notes: 'Ask about the trip', checklist: flowers, tags: ['family'], when: '2026-11-30', reminder: '09:00' } })] });
        expect(show(plan(fromThings))).toEqual([
            'adopt Call Mom aaaaaaaa',
            'update Call Mom {"notes":"Ask about the trip","checklist":[{"title":"Flowers","done":false}],"tags":["family"],"when":"2026-11-30","reminder":"09:00"}'
        ]);
        const fromNote = meeting({ notes: [note(PLAN, [momLine({ f: { notes: 'Bring cake', checklist: flowers, tags: ['family'], when: '2026-11-25', reminder: '18:00' } })])] });
        expect(show(plan(fromNote))).toEqual([
            'updateTodo aaaaaaaa {"notes":"Bring cake","checklist":[{"title":"Flowers","done":false}],"tags":["family"],"when":"2026-11-25","reminder":"18:00"}',
            'adopt Call Mom aaaaaaaa'
        ]);
    });
    it('counts a line\'s #someday as its date, so the to-do goes to Someday', () => {
        const w = meeting({ notes: [note(PLAN, [momLine({ f: { someday: true } })])], todos: [momTodo({ f: { when: '2026-11-30' } })] });
        const update = steps(plan(w)).things[0];
        expect(update).toMatchObject({ kind: 'updateTodo', id: A, fields: { someday: true } });
        expect(Object.keys((update as Extract<ThingsStep, { kind: 'updateTodo' }>).fields)).toEqual(['when', 'someday']);
    });
    it('moves the to-do to the line\'s heading, and a Things heading holding only joined to-dos never reaches the note', () => {
        const w = meeting({ projects: [planProject({ headings: ['Calls', 'Later'] })], todos: [momTodo({ heading: 'Later' })] });
        expect(show(plan(w))).toEqual(['moveTodo aaaaaaaa Work/Plan.md#Calls', 'adopt Call Mom aaaaaaaa']);
        expect(show(plan(meeting({ todos: [momTodo({ heading: undefined })], caps: { headings: false } })))).toEqual([
            'moveTodo aaaaaaaa Work/Plan.md#Calls', 'adopt Call Mom aaaaaaaa'
        ]);
    });
    it('keeps the note\'s headings where Things has others, never reading the difference as a rename', () => {
        const w = meeting({
            notes: [note(PLAN, [line('Call Dad', { heading: 'Calls' })])],
            projects: [planProject({ headings: ['Phone'] })],
            todos: [todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Phone' })]
        });
        expect(show(plan(w))).toEqual(['swapProject proj1 [Calls, Phone] cccccccc#Phone', 'createTodo Call Dad', 'add Pay rent Work/Plan.md#Phone']);
    });
    describe('heading order', () => {
        const ordered = ['Calls', 'Errands', 'Later'];
        /** Plan.md has Calls then Errands; Things has them the other way round, plus Later holding a to-do the note doesn't have. */
        const reversed = meeting({
            notes: [note(PLAN, [momLine(), line('Buy milk', { heading: 'Errands' })])],
            projects: [planProject({ headings: ['Errands', 'Calls', 'Later'] })],
            todos: [momTodo(), todo(B, 'Buy milk', { projectId: 'proj1', heading: 'Errands' }), todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Later' })]
        });
        /** The round after the first: what the swap and the add left on both sides. */
        const nextRound = (first: World, headings: string[]): World => {
            const after = joined(first);
            const lines = [line('Call Mom', { id: A, heading: 'Calls' }), line('Buy milk', { id: B, heading: 'Errands' }), line('Pay rent', { id: C, heading: 'Later' })];
            const kept = lines.filter(l => headings.includes(l.heading!));
            return {
                notes: [note(PLAN, kept)],
                areas: [WORK],
                projects: [planProject({ headings })],
                todos: kept.map(l => todo(l.id!, l.fields.title, { projectId: 'proj1', areaId: 'area1', heading: l.heading })),
                state: { ...after, joined: true, todos: kept.map(l => synced(l.id!, l.fields.title, PLAN, { heading: l.heading })) }
            };
        };

        it('rebuilds once in the note\'s order, then Things\' headings holding to-dos that come in, and never reorders the note', () => {
            const result = plan(reversed);
            expect(show(result)).toEqual([
                'swapProject proj1 [Calls, Errands, Later] aaaaaaaa#Calls bbbbbbbb#Errands cccccccc#Later',
                'adopt Call Mom aaaaaaaa',
                'adopt Buy milk bbbbbbbb',
                'add Pay rent Work/Plan.md#Later'
            ]);
            expect(steps(result).vault.some(s => s.kind === 'headings')).toBe(false);
            expect(result).toMatchObject({ counts: { toThings: 0, toVault: 1 } });
            expect(joined(reversed).projects[0].headings).toEqual(ordered);
            expect(show(plan(nextRound(reversed, ordered)))).toEqual([]);
        });
        it('leaves Things alone when it already has the note\'s headings in order, adding its own after them', () => {
            const w = meeting({
                projects: [planProject({ headings: ['Calls', 'Later'] })],
                todos: [momTodo(), todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Later' })]
            });
            expect(show(plan(w))).toEqual(['adopt Call Mom aaaaaaaa', 'add Pay rent Work/Plan.md#Later']);
            expect(joined(w).projects[0].headings).toEqual(['Calls', 'Later']);
            expect(show(plan(nextRound(w, ['Calls', 'Later'])))).toEqual([]);
        });
    });
    it('never imports or joins a repeating to-do, or one in the Logbook or the Trash', () => {
        const w = meeting({
            notes: [note(PLAN, [momLine(), line('Water plants', { heading: 'Calls' }), line('Old report', { heading: 'Calls' })])],
            todos: [momTodo(),
                todo(C, 'Water plants', { projectId: 'proj1', heading: 'Calls', repeating: true }),
                todo('dddddddd', 'Old report', { projectId: 'proj1', heading: 'Calls', logged: true, f: { status: 'completed' } }),
                todo('eeeeeeee', 'Binned', { projectId: 'proj1', trashed: true }),
                todo('ffffffff', 'Weekly review', { projectId: 'proj1', repeating: true })]
        });
        expect(show(plan(w))).toEqual(['createTodo Water plants', 'createTodo Old report', 'adopt Call Mom aaaaaaaa']);
        expect(joined(w).todos.map(t => t.id)).toEqual([A]);
    });
    it('dates a to-do with a deadline and no When date by its deadline as it comes in', () => {
        const w = meeting({
            todos: [momTodo(),
                todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Calls', deadline: '2026-11-30' }),
                todo('dddddddd', 'File taxes', { projectId: 'proj1', heading: 'Calls', deadline: '2026-12-15', f: { when: '2026-12-01' } })]
        });
        const adds = steps(plan(w)).vault.filter((s): s is Add => s.kind === 'add');
        expect(adds.map(s => [s.todo.fields.title, s.todo.fields.when])).toEqual([['Pay rent', '2026-11-30'], ['File taxes', '2026-12-01']]);
        expect(show(plan(meeting({ todos: [momTodo({ deadline: '2026-11-28' })] })))).toEqual([
            'adopt Call Mom aaaaaaaa',
            'update Call Mom {"when":"2026-11-28"}'
        ]);
    });
    it('keeps a deadline-only to-do dated on later rounds', () => {
        const st = syncedState({ todos: [synced(A, 'Call Mom', PLAN, { heading: 'Calls', f: { when: '2026-11-28' } })] });
        const w = world({ state: st, notes: [note(PLAN, [mom({ f: { when: '2026-11-28' } })])], todos: [momTodo({ deadline: '2026-11-28' })] });
        expect(show(plan(w))).toEqual([]);
    });
    it('counts the to-dos going to Things and the tasks coming into the vault, not the joined ones', () => {
        const w = meeting({
            notes: [note(PLAN, [momLine({ f: { when: '2026-11-25' } }), line('Buy milk', { heading: 'Calls' }), line('Pay bills', { heading: 'Calls' })])],
            projects: [planProject(), project('proj9', 'Launch', { areaId: 'area1' })],
            todos: [momTodo({ f: { notes: 'Ask about the trip' } }),
                todo(C, 'Pay rent', { projectId: 'proj1', heading: 'Calls' }),
                todo('dddddddd', 'Call plumber', { inbox: true }),
                todo('eeeeeeee', 'Write copy', { projectId: 'proj9' })]
        });
        expect(plan(w)).toMatchObject({ ok: true, counts: { toThings: 2, toVault: 3 } });
    });
    it('joins the same pairs again from its own result, so the round and the planner can both join', () => {
        const w = meeting({ notes: [note(PLAN, [momLine({ f: { when: '2026-11-25' } }), line('Buy milk', { heading: 'Calls' })])], todos: [momTodo({ f: { notes: 'Ask' } })] });
        const once = joined(w);
        expect(once.joined).toBe(false);
        expect(once.todos).toHaveLength(1);
        expect(joinFirstConnect(...snapshots(w), once)).toEqual(once);
        expect(show(plan({ ...w, state: once }))).toEqual(show(plan(w)));
    });
    it('joins where the import would land, so names Things writes differently still join', () => {
        const w = meeting({
            notes: [note(PLAN, [momLine()]), note('Work/Launch v2.md', [line('Write copy')])],
            areas: [{ id: 'area1', title: 'Work ' }],
            projects: [planProject(), project('proj9', 'Launch: v2', { areaId: 'area1' })]
        });
        expect(joined(w).areas).toEqual([{ id: 'area1', folder: 'Work' }]);
        expect(joined(w).projects.map(p => [p.id, p.path])).toEqual([['proj1', PLAN], ['proj9', 'Work/Launch v2.md']]);
        expect(show(plan(w))).toEqual(['createTodo Write copy', 'adopt Call Mom aaaaaaaa']);
    });
    it('joins a project to its note when the note exists with no open tasks, and brings its to-dos into it', () => {
        const HOME_AREA: ThingsArea = { id: 'area3', title: 'Home' };
        const w = meeting({
            areas: [WORK, HOME_AREA],
            projects: [planProject(), project('proj7', 'Chores', { areaId: 'area1', headings: ['Later'] }), project('proj8', 'Groceries', { areaId: 'area3' })],
            todos: [momTodo(),
                todo(C, 'Pay rent', { projectId: 'proj7' }),
                todo('dddddddd', 'Call plumber', { projectId: 'proj7', heading: 'Later' }),
                todo('eeeeeeee', 'Buy eggs', { projectId: 'proj8' })],
            files: { 'Work/Chores.md': OLD, 'Home/Groceries.md': OLD }
        });
        const after = joined(w);
        expect(after.areas).toEqual([{ id: 'area1', folder: 'Work' }, { id: 'area3', folder: 'Home' }]);
        expect(after.projects.slice(1)).toEqual([
            { id: 'proj7', path: 'Work/Chores.md', title: 'Chores', headings: ['Later'], areaId: 'area1' },
            { id: 'proj8', path: 'Home/Groceries.md', title: 'Groceries', headings: [], areaId: 'area3' }
        ]);
        expect(show(plan(w))).toEqual([
            'adopt Call Mom aaaaaaaa',
            'add Pay rent Work/Chores.md',
            'add Call plumber Work/Chores.md#Later',
            'add Buy eggs Home/Groceries.md'
        ]);
        // The round after: the note holds what came in, under the heading recorded for it, and nothing changes.
        const next: World = {
            ...w,
            notes: [note(PLAN, [line('Call Mom', { id: A, heading: 'Calls' })]),
                note('Work/Chores.md', [line('Pay rent', { id: C }), line('Call plumber', { id: 'dddddddd', heading: 'Later' })]),
                note('Home/Groceries.md', [line('Buy eggs', { id: 'eeeeeeee' })])],
            state: { ...after, joined: true, todos: [...after.todos, synced(C, 'Pay rent', 'Work/Chores.md'), synced('dddddddd', 'Call plumber', 'Work/Chores.md', { heading: 'Later' }), synced('eeeeeeee', 'Buy eggs', 'Home/Groceries.md')] }
        };
        expect(show(plan(next))).toEqual([]);
    });
    it('keeps the to-do\'s own tags beside the status and priority the line\'s checkbox gives', () => {
        expect(show(plan(meeting({ notes: [note(PLAN, [momLine({ f: { tags: ['In Progress'] } })])], todos: [momTodo({ f: { tags: ['home'] } })] })))).toEqual([
            'updateTodo aaaaaaaa {"tags":["In Progress","home"]}',
            'adopt Call Mom aaaaaaaa',
            'update Call Mom {"tags":["In Progress","home"]}'
        ]);
        // A plain checkbox has no priority, so Things' Priority 1 goes and its own tag stays.
        expect(show(plan(meeting({ todos: [momTodo({ f: { tags: ['Priority 1', 'home'] } })] })))).toEqual([
            'updateTodo aaaaaaaa {"tags":["home"]}',
            'adopt Call Mom aaaaaaaa',
            'update Call Mom {"tags":["home"]}'
        ]);
    });
    it('finishes a first round that stopped partway, sending each side what it still lacks', () => {
        const first = meeting({ notes: [note(PLAN, [momLine({ f: { tags: ['In Progress'] } })])], todos: [momTodo({ f: { tags: ['home'] } })] });
        const after = joined(first);
        const both = ['In Progress', 'home'];
        const retry = (lineTags: string[], thingsTags: string[]) => show(plan({
            ...first, state: after,
            notes: [note(PLAN, [line('Call Mom', { id: A, heading: 'Calls', f: { tags: lineTags } })])],
            todos: [momTodo({ f: { tags: thingsTags } })]
        }));
        // The line was written and Things wasn't, then the other way round.
        expect(retry(both, ['home'])).toEqual(['updateTodo aaaaaaaa {"tags":["In Progress","home"]}']);
        expect(retry(['In Progress'], both)).toEqual(['update Call Mom {"tags":["In Progress","home"]}']);
    });
    it('pairs same-title to-dos with lines under the same heading first, then in line order', () => {
        const w = meeting({
            notes: [note(PLAN, [momLine(), momLine({ heading: 'Later' })])],
            projects: [planProject({ headings: ['Calls', 'Later'] })],
            todos: [momTodo({ heading: 'Later' }), todo(B, 'Call Mom', { projectId: 'proj1', heading: 'Calls' })]
        });
        expect(show(plan(w))).toEqual(['adopt Call Mom aaaaaaaa', 'adopt Call Mom bbbbbbbb']);
        const adopts = steps(plan(w)).vault.filter((s): s is Adopt => s.kind === 'adopt');
        expect(adopts.map(s => [s.task.line, s.id])).toEqual([[3, A], [2, B]]);
    });
    it('matches titles with the spaces around and between words evened out', () => {
        expect(show(plan(meeting({ todos: [momTodo({ f: { title: ' Call  Mom ' } })] })))).toEqual([
            'updateTodo aaaaaaaa {"title":"Call Mom"}',
            'adopt Call Mom aaaaaaaa'
        ]);
    });
    it('still joins names that match exactly where the file-safe form would differ', () => {
        const w = meeting({
            notes: [note(PLAN, [momLine()]), note('C#/Plan.md', [line('Tune')]), note('C#/C# notes.md', [line('Read')])],
            areas: [WORK, { id: 'area4', title: 'C#' }],
            projects: [planProject(), project('proj4', 'Plan', { areaId: 'area4' }), project('proj5', 'C#  notes', { areaId: 'area4' })],
            todos: [momTodo(), todo(B, 'Tune', { projectId: 'proj4' }), todo(C, 'Read', { projectId: 'proj5' })]
        });
        const after = joined(w);
        expect(after.areas).toEqual([{ id: 'area1', folder: 'Work' }, { id: 'area4', folder: 'C#' }]);
        expect(after.projects.map(p => [p.id, p.path])).toEqual([['proj1', PLAN], ['proj4', 'C#/Plan.md'], ['proj5', 'C#/C# notes.md']]);
        expect(show(plan(w))).toEqual(['adopt Call Mom aaaaaaaa', 'adopt Tune bbbbbbbb', 'adopt Read cccccccc']);
    });
});


describe('notes excluded from tasks', () => {
    const work: ThingsArea = { id: 'areaW', title: 'Work' };
    const nothing = (result: ThingsPlan) => {
        const { things, vault } = steps(result);
        return { things, vault };
    };

    it('leaves a Things project alone when its note would land in an excluded folder', () => {
        const p = plan({ areas: [work], projects: [project('projQ', 'Q4', { areaId: 'areaW' })], todos: [todo(A, 'Draft deck', { projectId: 'projQ' })], excluded: ['Work'] });
        expect(nothing(p)).toEqual({ things: [], vault: [] });
    });

    it('leaves the Things Inbox alone when the inbox note is excluded', () => {
        const p = plan({ todos: [todo(A, 'Buy milk', { inbox: true })], excluded: ['Things Inbox.md'] });
        expect(nothing(p)).toEqual({ things: [], vault: [] });
    });

    it('never trashes the to-dos of a synced note that became excluded', () => {
        const p = plan({
            projects: [project('projP', 'Plan', { areaId: 'areaW' })],
            areas: [work],
            todos: [todo(A, 'Call', { projectId: 'projP' }), todo(B, 'Email', { projectId: 'projP' })],
            files: { [PLAN]: OLD },
            excluded: ['Work'],
            state: state({ areas: [{ id: 'areaW', folder: 'Work' }], projects: [{ id: 'projP', path: PLAN, title: 'Plan', headings: [], areaId: 'areaW' }], todos: [synced(A, 'Call', PLAN), synced(B, 'Email', PLAN)] })
        });
        expect(nothing(p)).toEqual({ things: [], vault: [] });
    });

    it('never joins a project to an excluded note on first connect', () => {
        const w: World = { areas: [work], projects: [project('projP', 'Plan', { areaId: 'areaW' })], files: { [PLAN]: OLD }, excluded: ['Work'], state: state({ joined: false }) };
        expect(joined(w).projects).toEqual([]);
        expect(nothing(plan(w))).toEqual({ things: [], vault: [] });
    });
});

describe('a line whose ID the state has lost (another Mac took over, or the state file is gone)', () => {
    it('lets what Things changed since come into the note, never reopening a to-do done on the phone', () => {
        const p = plan({
            notes: [note(PLAN, [line('Call Mom', { id: A, f: { status: 'open', when: '2026-11-25' } })])],
            areas: [WORK],
            projects: [planProject({ headings: [] })],
            todos: [momTodo({ heading: undefined, f: { status: 'completed', when: '2026-11-26' } })],
            state: state({ joined: false })
        });
        const { things, vault } = steps(p);
        expect(things.filter(s => s.kind === 'updateTodo')).toEqual([]);
        expect(vault.map(vaultLine)).toEqual(['update Call Mom {"status":"completed","when":"2026-11-26"}']);
    });
});

describe('a line whose to-do the plugin itself trashed, or that a read missed once', () => {
    it('gives a line back its own to-do when the one it carries was trashed by sync (indented, then outdented)', () => {
        const p = plan({
            notes: [note(PLAN, [mom()])],
            areas: [WORK],
            projects: [planProject()],
            todos: [momTodo({ trashed: true })],
            state: syncedState({ todos: [], trashedBySync: [A] })
        });
        expect(steps(p).vault.map(vaultLine)).toEqual(['unlink Call Mom']);
        expect(steps(p).things.map(thingsLine)).toEqual(['createTodo Call Mom']);
    });

    it('waits a round before retiring a line whose to-do one read didn\'t find', () => {
        const w: World = { notes: [note(PLAN, [mom()])], areas: [WORK], projects: [planProject()], todos: [], state: syncedState() };
        const once = plan(w);
        expect(steps(once).vault.map(vaultLine)).toEqual([]);
        if (!once.ok) throw new Error('stopped');
        expect(once.absent).toEqual([A]);
        const twice = plan({ ...w, state: syncedState({ absent: [A] }) });
        expect(steps(twice).vault.map(vaultLine)).toEqual(['retire Call Mom']);
    });
});
