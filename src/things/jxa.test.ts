import type { BridgeOp } from './bridge';
import { CHANGED_DURING_READ, EXPERIMENTAL, LISTS, parseRead, readScript, writeScript } from './jxa';
import type { ThingsSnapshot, TodoFields } from './model';

/** A name carrying everything that could break out of a script: quotes, a backslash, a newline, `${`, a line separator. */
const NASTY = 'Say "hi" \\ to ${Mom}\nthen `run()` \u2028 🎯';

/** A script's inputs, read from the JSON literal on its first line. */
function inputOf(script: string): unknown {
    const [first] = script.split('\n');
    expect(first.startsWith('const input = ')).toBe(true);
    return JSON.parse(first.slice('const input = '.length, -1));
}

/** A to-do as the read script prints it, recorded by hand from the documented properties. */
function raw(id: string, name: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return { id, name, notes: '', status: 'open', tags: '', when: null, deadline: null, project: null, area: null, json: null, ...over };
}

const SAMPLE = {
    areas: [{ id: 'AreaWork01', name: 'Work' }],
    projects: [
        { id: 'ProjQ4Plan', name: 'Q4 plan', status: 'open', area: 'AreaWork01', json: null },
        { id: 'ProjDone01', name: 'Old launch', status: 'completed', area: null, json: null },
        { id: 'ProjTrash1', name: 'Scrapped', status: 'open', area: null, json: null }
    ],
    todos: [
        raw('TodoInbox1', 'Call Mom 🎯'),
        raw('TodoPlan01', 'Draft #1 & 50%', { notes: 'First\nSecond', tags: 'Priority 1, Errands, Errands', when: '2026-11-23', deadline: '2026-11-30', project: 'ProjQ4Plan' }),
        raw('TodoArea01', 'Renew passport', { area: 'AreaWork01', deadline: '2026-12-01' }),
        raw('TodoSome01', 'Learn piano', { area: 'AreaWork01' }),
        raw('TodoDone01', 'Ship it', { status: 'completed', when: '2026-11-20', project: 'ProjDone01', byId: true }),
        raw('TodoTrash1', 'Old idea', { byId: true })
    ],
    inbox: ['TodoInbox1'],
    someday: ['TodoSome01'],
    trash: ['ProjTrash1', 'TodoTrash1'],
    spelling: null
};

const OPEN: Omit<TodoFields, 'title'> = { notes: '', checklist: [], tags: [], status: 'open', someday: false };

const EXPECTED: ThingsSnapshot = {
    areas: [{ id: 'AreaWork01', title: 'Work' }],
    projects: [
        { id: 'ProjQ4Plan', title: 'Q4 plan', areaId: 'AreaWork01', status: 'open', trashed: false },
        { id: 'ProjDone01', title: 'Old launch', status: 'completed', trashed: false },
        { id: 'ProjTrash1', title: 'Scrapped', status: 'open', trashed: true }
    ],
    todos: [
        { id: 'TodoInbox1', inbox: true, fields: { ...OPEN, title: 'Call Mom 🎯' }, repeating: false, trashed: false, logged: false },
        {
            id: 'TodoPlan01', projectId: 'ProjQ4Plan', inbox: false, deadline: '2026-11-30', repeating: false, trashed: false, logged: false,
            fields: { ...OPEN, title: 'Draft #1 & 50%', notes: 'First\nSecond', tags: ['Errands', 'Priority 1'], when: '2026-11-23' }
        },
        { id: 'TodoArea01', areaId: 'AreaWork01', inbox: false, deadline: '2026-12-01', fields: { ...OPEN, title: 'Renew passport' }, repeating: false, trashed: false, logged: false },
        { id: 'TodoSome01', areaId: 'AreaWork01', inbox: false, fields: { ...OPEN, title: 'Learn piano', someday: true }, repeating: false, trashed: false, logged: false },
        {
            id: 'TodoDone01', projectId: 'ProjDone01', inbox: false, repeating: false, trashed: false, logged: true,
            fields: { ...OPEN, title: 'Ship it', status: 'completed', when: '2026-11-20' }
        },
        { id: 'TodoTrash1', inbox: false, fields: { ...OPEN, title: 'Old idea' }, repeating: false, trashed: true, logged: false }
    ],
    capabilities: { headings: false, checklist: false, reminder: false, repeating: false, reorder: false }
};

/** The same read, with experimental JSON on every to-do and the project's headings. */
function withExperimental(): typeof SAMPLE {
    const none = JSON.stringify({ heading: null, checklistItems: [], reminderTime: null });
    const plan = JSON.stringify({
        heading: 'Next week',
        checklistItems: [{ title: 'Outline', completed: true }, { title: 'Review', completed: false }],
        reminderTime: '15:00'
    });
    const sample = JSON.parse(JSON.stringify(SAMPLE)) as typeof SAMPLE;
    sample.todos.forEach(t => { t.json = t.id === 'TodoPlan01' ? plan : none; });
    (sample.projects[0] as Record<string, unknown>).json = JSON.stringify({ headings: ['This week', 'Next week'] });
    return sample;
}

describe('parseRead', () => {
    it('reads the documented properties, with every experimental capability off', () => {
        expect(parseRead(JSON.stringify(SAMPLE))).toEqual(EXPECTED);
    });

    it('turns on headings, checklist and reminder only when the experimental JSON carries them', () => {
        const snapshot = parseRead(JSON.stringify(withExperimental()));
        expect(snapshot.capabilities).toEqual({ headings: true, checklist: true, reminder: true, repeating: false, reorder: false });
        const plan = snapshot.todos.find(t => t.id === 'TodoPlan01');
        expect(plan?.heading).toBe('Next week');
        expect(plan?.fields.checklist).toEqual([{ title: 'Outline', done: true }, { title: 'Review', done: false }]);
        expect(plan?.fields.reminder).toBe('15:00');
        expect(plan?.repeating).toBe(false);
        expect(snapshot.projects[0].headings).toEqual(['This week', 'Next week']);
        expect(snapshot.todos.find(t => t.id === 'TodoInbox1')?.heading).toBeUndefined();
    });

    it('keeps the capabilities off when any to-do came back without experimental JSON', () => {
        const sample = withExperimental();
        sample.todos[0].json = null;
        expect(parseRead(JSON.stringify(sample)).capabilities).toEqual(EXPECTED.capabilities);
    });

    it('keeps the capabilities off when the experimental JSON is unreadable', () => {
        const sample = withExperimental();
        sample.todos.forEach(t => { t.json = '{"heading": '; });
        expect(parseRead(JSON.stringify(sample)).capabilities).toEqual(EXPECTED.capabilities);
    });

    it('finds the fields under the field names the rerun might find', () => {
        const sample = withExperimental();
        sample.todos.forEach(t => {
            t.json = JSON.stringify({ attributes: { headingTitle: { title: 'Later' }, checklist: ['Pack'], reminder: '2026-11-23T08:30:00' } });
        });
        const plan = parseRead(JSON.stringify(sample)).todos.find(t => t.id === 'TodoPlan01');
        expect(plan?.heading).toBe('Later');
        expect(plan?.fields.checklist).toEqual([{ title: 'Pack', done: false }]);
        expect(plan?.fields.reminder).toBe('08:30');
    });

    it('keeps a reminder only on a dated to-do', () => {
        const sample = withExperimental();
        sample.todos.forEach(t => { t.json = JSON.stringify({ heading: null, checklistItems: [], reminderTime: '15:00' }); });
        const snapshot = parseRead(JSON.stringify(sample));
        expect(snapshot.todos.find(t => t.id === 'TodoPlan01')?.fields.reminder).toBe('15:00');
        expect(snapshot.todos.find(t => t.id === 'TodoInbox1')?.fields.reminder).toBeUndefined();
    });

    it('names the experimental fields in one place', () => {
        expect(EXPERIMENTAL.heading).toContain('heading');
        expect(EXPERIMENTAL.checklist).toContain('checklistItems');
        expect(EXPERIMENTAL.reminder).toContain('reminderTime');
        expect(EXPERIMENTAL.nested).toBe('attributes');
        expect(EXPERIMENTAL.title).toContain('title');
        expect(EXPERIMENTAL.checklistItem.done).toContain('completed');
    });

    it('keeps a capability off when a value it carried is unusable, and leaves that field unread', () => {
        const sample = withExperimental();
        const plan = sample.todos.find(t => t.id === 'TodoPlan01');
        if (!plan) throw new Error('No plan');
        plan.json = JSON.stringify({ heading: 'Next week', checklistItems: 3, reminderTime: true });
        const snapshot = parseRead(JSON.stringify(sample));
        expect(snapshot.capabilities).toEqual({ headings: true, checklist: false, reminder: false, repeating: false, reorder: false });
        const read = snapshot.todos.find(t => t.id === 'TodoPlan01');
        expect(read?.heading).toBe('Next week');
        expect(read?.fields.checklist).toEqual([]);
        expect(read?.fields.reminder).toBeUndefined();
    });

    it('keeps the checklist off when an item has no title, and headings off when a heading is no title', () => {
        const sample = withExperimental();
        sample.todos[1].json = JSON.stringify({ heading: 5, checklistItems: [{ title: 'Ok' }, { completed: true }], reminderTime: null });
        const snapshot = parseRead(JSON.stringify(sample));
        expect(snapshot.capabilities).toMatchObject({ headings: false, checklist: false, reminder: true });
        expect(snapshot.todos.some(t => t.heading !== undefined)).toBe(false);
        expect(snapshot.projects[0].headings).toBeUndefined();
    });

    it('reads a to-do with no name as untitled, so one odd to-do never stops a round', () => {
        const sample = { ...SAMPLE, todos: [{ ...raw('TodoBlank1', ''), name: null }] };
        expect(parseRead(JSON.stringify(sample)).todos[0].fields.title).toBe('');
    });

    it('turns down output it cannot read rather than guess', () => {
        expect(() => parseRead('execution error')).toThrow();
        expect(() => parseRead(JSON.stringify({ ...SAMPLE, todos: [raw('TodoBad001', 'x', { status: 'someday' })] }))).toThrow();
        expect(() => parseRead(JSON.stringify({ ...SAMPLE, inbox: undefined }))).toThrow();
    });
});

// ---------------------------------------------------------------------------
// The read script, run against a model of Things' scripting objects as JXA
// shows them: collections answer property calls in bulk, `byId` makes an
// element specifier, a missing value comes back as null.

interface Item { id: string; name: string; status?: string; notes?: string; tags?: string; when?: Date; due?: Date; kind?: 'toDo' | 'project'; project?: string; area?: string; json?: string }
interface World { areas: Array<{ id: string; name: string }>; items: Item[]; lists: Record<string, string[]>; spelling?: string; noWhose?: boolean }

type Spec = Record<string, unknown>;

function mockThings(world: World, calls: string[]): (name: string) => Spec {
    const byId = new Map(world.items.map(item => [item.id, item]));
    const read: Record<string, (item: Item) => unknown> = {
        id: i => i.id, name: i => i.name, notes: i => i.notes ?? '', status: i => i.status ?? 'open', tagNames: i => i.tags ?? '',
        activationDate: i => i.when ?? null, dueDate: i => i.due ?? null, class: i => i.kind ?? 'toDo'
    };
    const area = (id: string): Spec => ({ id: () => id, toDos: collection(() => world.items.filter(i => i.area === id && !i.project && i.kind !== 'project')) });
    function element(item: Item | undefined): Spec {
        const need = (): Item => { if (!item) throw new Error("Can't get object."); return item; };
        const spec: Spec = { exists: () => item !== undefined };
        for (const key of Object.keys(read)) spec[key] = () => { calls.push(`element ${key}`); return read[key](need()); };
        spec[world.spelling ?? '_private_experimental_Json'] = () => {
            calls.push('json');
            if (need().json === undefined) throw new Error('No json.');
            return need().json;
        };
        spec.project = () => { const i = need(); return i.project ? element(byId.get(i.project)) : null; };
        spec.area = () => { const i = need(); return i.area ? area(i.area) : null; };
        // A project lists its open to-dos; its done ones are in the Logbook.
        spec.toDos = collection(() => world.items.filter(i => i.project === item?.id && (i.status ?? 'open') === 'open'));
        return spec;
    }
    function collection(items: () => Item[]): Spec {
        const spec: Spec = { byId: (id: string) => element(items().find(i => i.id === id)) };
        for (const key of Object.keys(read)) spec[key] = () => { calls.push(`bulk ${key}`); return items().map(read[key]); };
        spec.project = () => items().map(i => i.project ? element(byId.get(i.project)) : null);
        spec.whose = (filter: { _match: [unknown, string] }) => {
            if (world.noWhose) throw new Error("Can't filter.");
            expect(filter._match[0]).toBe('project.id');
            return collection(() => items().filter(i => i.project === filter._match[1]));
        };
        return spec;
    }
    const projects = () => world.items.filter(i => i.kind === 'project');
    const app: Spec = {
        lists: { byId: (id: string) => ({ toDos: collection(() => (world.lists[id] ?? []).map(i => byId.get(i)).filter((i): i is Item => i !== undefined)) }) },
        toDos: collection(() => world.items),
        projects: collection(projects),
        areas: { id: () => world.areas.map(a => a.id), name: () => world.areas.map(a => a.name), byId: area }
    };
    return name => { expect(name).toBe('Things3'); return app; };
}

function runRead(world: World, known: string[], calls: string[] = []): ThingsSnapshot {
    const script = readScript(known);
    const output = new Function('Application', `${script}\nreturn run();`)(mockThings(world, calls)) as string;
    return parseRead(output);
}

const json = (heading: string | null) => JSON.stringify({ heading, checklistItems: [], reminderTime: null });

function world(open = 2): World {
    const extra = Array.from({ length: open }, (_, n): Item => ({ id: `TodoMore${String(n).padStart(2, '0')}`, name: `More ${n}`, project: 'ProjQ4Plan', json: json(null) }));
    return {
        areas: [{ id: 'AreaWork01', name: 'Work' }],
        items: [
            { id: 'ProjQ4Plan', name: 'Q4 plan', kind: 'project', area: 'AreaWork01', json: JSON.stringify({ headings: ['Next week'] }) },
            { id: 'ProjDone01', name: 'Old launch', kind: 'project', status: 'completed' },
            { id: 'TodoInbox1', name: NASTY, json: json(null) },
            { id: 'TodoPlan01', name: 'Draft', project: 'ProjQ4Plan', when: new Date(2026, 10, 23), due: new Date(2026, 10, 30), tags: 'Errands', json: json('Next week') },
            { id: 'TodoSome01', name: 'Learn piano', area: 'AreaWork01', json: json(null) },
            { id: 'TodoDone01', name: 'Ship it', status: 'completed', project: 'ProjDone01', json: json(null) },
            { id: 'TodoTrash1', name: 'Old idea', json: json(null) },
            ...extra
        ],
        lists: {
            [LISTS.inbox]: ['TodoInbox1'],
            [LISTS.today]: ['TodoPlan01', 'ProjQ4Plan'],
            [LISTS.anytime]: ['TodoPlan01', ...extra.map(i => i.id)],
            [LISTS.someday]: ['TodoSome01'],
            [LISTS.logbook]: ['TodoDone01', 'ProjDone01'],
            [LISTS.trash]: ['TodoTrash1']
        }
    };
}

describe('readScript', () => {
    it('takes its known IDs from one JSON literal and compiles', () => {
        const script = readScript(['TodoDone01', 'TodoDone01', 'TodoGone01']);
        expect(inputOf(script)).toMatchObject({ known: ['TodoDone01', 'TodoGone01'], changed: CHANGED_DURING_READ });
        expect(() => new Function(script)).not.toThrow();
    });

    it('reads open lists, areas, projects and the known to-dos gone from them', () => {
        const snapshot = runRead(world(0), ['TodoDone01', 'TodoTrash1', 'TodoGone01', 'TodoPlan01']);
        expect(snapshot.areas).toEqual([{ id: 'AreaWork01', title: 'Work' }]);
        expect(snapshot.projects).toEqual([
            { id: 'ProjQ4Plan', title: 'Q4 plan', areaId: 'AreaWork01', headings: ['Next week'], status: 'open', trashed: false },
            { id: 'ProjDone01', title: 'Old launch', status: 'completed', trashed: false }
        ]);
        const byId = new Map(snapshot.todos.map(t => [t.id, t]));
        expect([...byId.keys()].sort()).toEqual(['TodoDone01', 'TodoInbox1', 'TodoPlan01', 'TodoSome01', 'TodoTrash1']);
        expect(byId.get('TodoInbox1')).toMatchObject({ inbox: true, fields: { title: NASTY } });
        expect(byId.get('TodoPlan01')).toMatchObject({ projectId: 'ProjQ4Plan', heading: 'Next week', deadline: '2026-11-30', fields: { when: '2026-11-23', tags: ['Errands'] } });
        expect(byId.get('TodoSome01')).toMatchObject({ areaId: 'AreaWork01', fields: { someday: true } });
        expect(byId.get('TodoDone01')).toMatchObject({ projectId: 'ProjDone01', logged: true, trashed: false, fields: { status: 'completed' } });
        expect(byId.get('TodoTrash1')).toMatchObject({ trashed: true, logged: false });
        expect(snapshot.capabilities).toEqual({ headings: true, checklist: true, reminder: true, repeating: false, reorder: false });
    });

    it('reads a project Things shows only by its ID, as a project', () => {
        const w = world(0);
        w.items.push({ id: 'ProjAway01', name: 'Away', kind: 'project', status: 'canceled' });
        const snapshot = runRead(w, ['ProjAway01']);
        expect(snapshot.projects).toContainEqual({ id: 'ProjAway01', title: 'Away', status: 'canceled', trashed: false });
        expect(snapshot.todos.some(t => t.id === 'ProjAway01')).toBe(false);
    });

    it('reads open to-dos in bulk: only the experimental JSON is asked for one to-do at a time', () => {
        const count = (open: number) => {
            const calls: string[] = [];
            runRead(world(open), ['TodoDone01'], calls);
            return { element: calls.filter(c => c.startsWith('element')).length, json: calls.filter(c => c === 'json').length };
        };
        const few = count(2);
        const many = count(40);
        expect(many.element).toBe(few.element);
        expect(many.json - few.json).toBe(38);
    });

    it('tries each spelling of the experimental property', () => {
        const w = world(0);
        w.spelling = EXPERIMENTAL.property[EXPERIMENTAL.property.length - 1];
        expect(runRead(w, []).capabilities.headings).toBe(true);
    });

    it('turns every capability off when Things has no experimental JSON', () => {
        const w = world(0);
        w.spelling = 'somethingElse';
        const snapshot = runRead(w, []);
        expect(snapshot.capabilities).toEqual({ headings: false, checklist: false, reminder: false, repeating: false, reorder: false });
        expect(snapshot.todos.find(t => t.id === 'TodoPlan01')?.heading).toBeUndefined();
    });

    it.each([
        ['adds a to-do', (ids: string[]) => [...ids, 'TodoSome01']],
        ['reorders a list', (ids: string[]) => [...ids].reverse()]
    ])('stops when Things %s between two bulk calls', (_change, change) => {
        const w = world(2);
        const app = mockThings(w, []);
        const lists = app('Things3').lists as { byId: (id: string) => { toDos: Spec } };
        const byId = lists.byId;
        lists.byId = (id: string) => {
            const list = byId(id);
            const name = list.toDos.name as () => unknown[];
            list.toDos.name = () => { if (id === LISTS.anytime) w.lists[id] = change(w.lists[id]); return name(); };
            return list;
        };
        expect(() => new Function('Application', `${readScript([])}\nreturn run();`)(app)).toThrow(/changed/);
    });
});

// ---------------------------------------------------------------------------
// Write scripts, run against a proxy that records every call and set.

const PATH = Symbol('path');

function recorder(answers: Record<string, unknown> = {}): { Application: (name: string) => unknown; log: string[] } {
    const log: string[] = [];
    const show = (value: unknown): string => {
        if (value === null || typeof value !== 'object' && typeof value !== 'function') return JSON.stringify(value);
        const path = (value as Record<symbol, string>)[PATH];
        if (path !== undefined) return path;
        if (value instanceof Date) return `Date(${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()})`;
        return `{${Object.keys(value).map(key => `${key}: ${show((value as Record<string, unknown>)[key])}`).join(', ')}}`;
    };
    const spec = (path: string): unknown => new Proxy(function () { /* a callable specifier */ }, {
        get: (_target, key) => {
            if (key === PATH) return path;
            if (key === 'byId') return (id: unknown) => spec(`${path}.byId(${typeof id === 'string' ? id : show(id)})`);
            if (typeof key === 'symbol') return undefined;
            return spec(`${path}.${key}`);
        },
        set: (_target, key, value) => { log.push(`${path}.${String(key)} = ${show(value)}`); return true; },
        apply: (_target, _this, args: unknown[]) => {
            const call = `${path}(${args.map(show).join(', ')})`;
            log.push(call);
            return call in answers ? answers[call] : spec(call);
        }
    });
    return { Application: name => spec(`Application(${name})`), log };
}

function runWrite(op: BridgeOp, answers: Record<string, unknown> = {}): { result: unknown; log: string[] } {
    const { Application, log } = recorder(answers);
    const result: unknown = new Function('Application', `${writeScript(op)}\nreturn run();`)(Application);
    return { result, log };
}

const APP = 'Application(Things3)';

describe('writeScript', () => {
    it('carries user text as data: a name with quotes, a backslash, a newline and ${ round-trips', () => {
        const op: BridgeOp = { kind: 'makeTodo', name: NASTY, notes: NASTY, tags: [NASTY], projectId: 'ProjQ4Plan' };
        const script = writeScript(op);
        expect(inputOf(script)).toEqual({ op, lists: LISTS });
        expect(new Function(`${script}\nreturn input;`)()).toEqual({ op, lists: LISTS });
        expect(script.split('\n').slice(1).join('\n')).not.toContain('Mom');
    });

    it('makes a to-do, then puts it in its project by ID', () => {
        const made = `${APP}.make({new: "toDo", withProperties: {name: "Call", notes: "", tagNames: "Errands, Home"}})`;
        const exists = `${APP}.projects.byId(ProjQ4Plan).exists()`;
        const { result, log } = runWrite(
            { kind: 'makeTodo', name: 'Call', notes: '', tags: ['Errands', 'Home'], projectId: 'ProjQ4Plan' },
            { [`${made}.id()`]: 'TodoNew001', [exists]: true }
        );
        expect(result).toBe('TodoNew001');
        expect(log).toEqual([exists, made, `${made}.id()`, `${APP}.toDos.byId(TodoNew001).project = ${APP}.projects.byId(ProjQ4Plan)`]);
    });

    it.each([
        ['project', { projectId: 'ProjGone01' }, `${APP}.projects.byId(ProjGone01).exists()`],
        ['area', { areaId: 'AreaGone01' }, `${APP}.areas.byId(AreaGone01).exists()`]
    ])('makes nothing when the to-do\'s %s is gone, so no stray to-do lands in the Inbox', (_what, target, exists) => {
        const { Application, log } = recorder({ [exists]: false });
        const script = writeScript({ kind: 'makeTodo', name: 'Call', notes: '', tags: [], ...target });
        expect(() => new Function('Application', `${script}\nreturn run();`)(Application)).toThrow(/Gone01 is gone from Things/);
        expect(log).toEqual([exists]);
    });

    it('makes a to-do in an area, or leaves it in the Inbox', () => {
        expect(runWrite({ kind: 'makeTodo', name: 'A', notes: '', tags: [], areaId: 'AreaWork01' }).log.pop()).toMatch(/\.area = .*areas\.byId\(AreaWork01\)$/);
        expect(runWrite({ kind: 'makeTodo', name: 'A', notes: '', tags: [] }).log.pop()).toMatch(/\.id\(\)$/);
    });

    it('sets a to-do\'s fields, dates through schedule and lists', () => {
        const todo = `${APP}.toDos.byId(TodoPlan01)`;
        expect(runWrite({ kind: 'setTodo', id: 'TodoPlan01', name: 'New', notes: 'N', tags: ['A', 'B'], status: 'completed', when: '2026-11-23' }).log).toEqual([
            `${todo}.name = "New"`, `${todo}.notes = "N"`, `${todo}.tagNames = "A, B"`,
            `${APP}.schedule(${todo}, {for: Date(2026-11-23)})`, `${todo}.status = "completed"`
        ]);
        expect(runWrite({ kind: 'setTodo', id: 'TodoPlan01', when: null }).log).toEqual([`${APP}.move(${todo}, {to: ${APP}.lists.byId(${LISTS.anytime})})`]);
        expect(runWrite({ kind: 'setTodo', id: 'TodoPlan01', when: 'someday' }).log).toEqual([`${APP}.move(${todo}, {to: ${APP}.lists.byId(${LISTS.someday})})`]);
        expect(runWrite({ kind: 'setTodo', id: 'TodoPlan01', status: 'canceled' }).log).toEqual([`${todo}.status = "canceled"`]);
    });

    it('leaves a reminder to the update link, which can set one', () => {
        expect(() => writeScript({ kind: 'setTodo', id: 'TodoPlan01', when: '2026-11-23@15:00' })).toThrow(/link/);
        expect(() => writeScript({ kind: 'setTodo', id: 'TodoPlan01', when: 'tomorrow' })).toThrow();
    });

    it('moves a to-do to a project, an area or the Inbox', () => {
        const todo = `${APP}.toDos.byId(TodoPlan01)`;
        expect(runWrite({ kind: 'moveTodo', id: 'TodoPlan01', projectId: 'ProjQ4Plan' }).log).toEqual([`${todo}.project = ${APP}.projects.byId(ProjQ4Plan)`]);
        expect(runWrite({ kind: 'moveTodo', id: 'TodoPlan01', areaId: 'AreaWork01' }).log).toEqual([`${APP}.move(${todo}, {to: ${APP}.areas.byId(AreaWork01)})`]);
        expect(runWrite({ kind: 'moveTodo', id: 'TodoPlan01', inbox: true }).log).toEqual([`${APP}.move(${todo}, {to: ${APP}.lists.byId(${LISTS.inbox})})`]);
    });

    it('deletes to-dos, projects and areas', () => {
        expect(runWrite({ kind: 'deleteTodo', id: 'TodoPlan01' }).log).toEqual([`${APP}.delete(${APP}.toDos.byId(TodoPlan01))`]);
        expect(runWrite({ kind: 'deleteProject', id: 'ProjQ4Plan' }).log).toEqual([`${APP}.delete(${APP}.projects.byId(ProjQ4Plan))`]);
        expect(runWrite({ kind: 'deleteArea', id: 'AreaWork01' }).log).toEqual([`${APP}.delete(${APP}.areas.byId(AreaWork01))`]);
    });

    it('makes and renames areas', () => {
        const made = `${APP}.make({new: "area", withProperties: {name: "Work/People"}})`;
        expect(runWrite({ kind: 'makeArea', name: 'Work/People' }, { [`${made}.id()`]: 'AreaNew001' }).result).toBe('AreaNew001');
        expect(runWrite({ kind: 'renameArea', id: 'AreaWork01', name: 'Home' }).log).toEqual([`${APP}.areas.byId(AreaWork01).name = "Home"`]);
    });

    it('changes a project, and takes it out of its area with an empty area ID', () => {
        const project = `${APP}.projects.byId(ProjQ4Plan)`;
        expect(runWrite({ kind: 'setProject', id: 'ProjQ4Plan', name: 'Q5', notes: '', areaId: 'AreaWork01', status: 'completed' }).log).toEqual([
            `${project}.name = "Q5"`, `${project}.notes = ""`, `${project}.area = ${APP}.areas.byId(AreaWork01)`, `${project}.status = "completed"`
        ]);
        expect(runWrite({ kind: 'setProject', id: 'ProjQ4Plan', areaId: '' }).log).toEqual([`${project}.area = null`]);
    });

    it('finds a project by the marker in its notes', () => {
        const answers = { [`${APP}.projects.id()`]: ['ProjA00001', 'ProjB00001'], [`${APP}.projects.notes()`]: ['', 'Notes\nsync-marker-42'] };
        expect(runWrite({ kind: 'findProjectByNotes', marker: 'sync-marker-42' }, answers).result).toBe('ProjB00001');
        expect(runWrite({ kind: 'findProjectByNotes', marker: 'other' }, answers).result).toBe('');
    });
});

describe('projectTodoIds script', () => {
    /** JXA's ObjectSpecifier(), as far as the script uses it. */
    const objectSpecifier = () => ({ project: { id: 'project.id' } });

    function swapWorld(): World {
        const w = world(0);
        w.items.push(
            { id: 'TodoDone02', name: 'Shipped', status: 'completed', project: 'ProjQ4Plan' },
            { id: 'TodoGone02', name: 'Dropped', status: 'canceled', project: 'ProjQ4Plan' },
            { id: 'TodoTrash2', name: 'Binned', project: 'ProjQ4Plan' },
            { id: 'TodoLoose2', name: 'Loose', status: 'completed' }
        );
        w.lists[LISTS.logbook] = [...w.lists[LISTS.logbook], 'TodoDone02', 'TodoGone02', 'TodoLoose2'];
        w.lists[LISTS.trash] = [...w.lists[LISTS.trash], 'TodoTrash2'];
        return w;
    }

    function idsIn(w: World): string[] {
        const script = writeScript({ kind: 'projectTodoIds', id: 'ProjQ4Plan' });
        const output = new Function('Application', 'ObjectSpecifier', `${script}\nreturn run();`)(mockThings(w, []), objectSpecifier) as string;
        return (JSON.parse(output) as string[]).sort();
    }

    it('lists a project\'s to-dos with its done and cancelled ones from the Logbook, and none from the Trash', () => {
        expect(idsIn(swapWorld())).toEqual(['TodoDone02', 'TodoGone02', 'TodoPlan01']);
    });

    it('looks through the Logbook one to-do at a time when Things can\'t filter it by project', () => {
        const w = swapWorld();
        w.noWhose = true;
        expect(idsIn(w)).toEqual(['TodoDone02', 'TodoGone02', 'TodoPlan01']);
    });
});
