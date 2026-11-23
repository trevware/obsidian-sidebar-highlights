import { FakeThings, READ_TIMEOUT_MS, ScriptBridge, ThingsError, thingsErrorFrom } from './bridge';
import type { Runner } from './bridge';
import { readScript, writeScript } from './jxa';
import { jsonCreateLink, updateLink, whenParam } from './links';

const failed = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { code: 1 }, extra);

describe('thingsErrorFrom', () => {
    it('reads a refused Apple event as missing permission', () => {
        const error = thingsErrorFrom(failed('Command failed: osascript'), 'execution error: Error: Error: Not authorized to send Apple events to Things3. (-1743)');
        expect(error).toBeInstanceOf(ThingsError);
        expect(error.kind).toBe('permission');
    });

    it('reads a missing app as not installed', () => {
        expect(thingsErrorFrom(failed('Command failed'), "execution error: Error: Application can't be found. (-2700)").kind).toBe('not-installed');
        expect(thingsErrorFrom(failed('Command failed'), 'No application knows how to open URL things:///update (Error -10814)').kind).toBe('not-installed');
    });

    it('reads a killed run or an Apple event timeout as a timeout', () => {
        expect(thingsErrorFrom(failed('Command failed', { killed: true, signal: 'SIGTERM', code: null })).kind).toBe('timeout');
        expect(thingsErrorFrom(failed('Command failed'), 'execution error: Error: AppleEvent timed out. (-1712)').kind).toBe('timeout');
    });

    it('reads an error thrown inside a script as other, not as a missing app', () => {
        const changed = thingsErrorFrom(failed('Command failed'), 'execution error: Error: Error: Things changed during the read (-2700)\n');
        expect(changed.kind).toBe('other');
        expect(changed.message).toContain('Things changed during the read');
        const typeError = thingsErrorFrom(failed('Command failed'), "execution error: TypeError: undefined is not an object (evaluating 'item.name') (-2700)\n");
        expect(typeError.kind).toBe('other');
        expect(typeError.message).toContain('TypeError: undefined is not an object');
    });

    it('keeps what osascript said about anything else', () => {
        const error = thingsErrorFrom(failed('Command failed'), "execution error: Error: Error: Can't get object. (-1728)\n");
        expect(error.kind).toBe('other');
        expect(error.message).toContain("Can't get object");
    });

    it('passes a ThingsError through', () => {
        const error = new ThingsError('urls-off', 'Things URLs are off');
        expect(thingsErrorFrom(error)).toBe(error);
    });
});

/** A runner answering each script with the next output in turn, the last one from then on. */
function runner(...outputs: Array<string | Error>): Runner & { scripts: Array<{ script: string; timeoutMs: number }>; opened: string[] } {
    const scripts: Array<{ script: string; timeoutMs: number }> = [];
    const opened: string[] = [];
    return {
        scripts,
        opened,
        async jxa(script, timeoutMs) {
            scripts.push({ script, timeoutMs });
            const output = outputs[Math.min(scripts.length, outputs.length) - 1];
            if (output instanceof Error) throw output;
            return output;
        },
        async open(url) { opened.push(url); },
        async running() { return true; }
    };
}

const EMPTY_READ = JSON.stringify({ areas: [], projects: [], todos: [], inbox: [], someday: [], trash: [] });

describe('ScriptBridge', () => {
    it('reads Things with one script and parses what it prints', async () => {
        const r = runner(`${EMPTY_READ}\n`);
        const snapshot = await new ScriptBridge(r).read(['TodoDone01']);
        expect(r.scripts).toEqual([{ script: readScript(['TodoDone01']), timeoutMs: READ_TIMEOUT_MS }]);
        expect(snapshot).toEqual({ areas: [], projects: [], todos: [], capabilities: { headings: false, checklist: false, reminder: false, repeating: false, reorder: false } });
    });

    it('reads again once when Things changed during the read', async () => {
        const changed = thingsErrorFrom(failed('Command failed'), 'execution error: Error: Error: Things changed during the read (-2700)');
        const r = runner(changed, EMPTY_READ);
        await expect(new ScriptBridge(r).read([])).resolves.toMatchObject({ todos: [] });
        expect(r.scripts).toHaveLength(2);
        const twice = runner(changed);
        await expect(new ScriptBridge(twice).read([])).rejects.toBe(changed);
        expect(twice.scripts).toHaveLength(2);
        const other = runner(new ThingsError('other', 'TypeError'));
        await expect(new ScriptBridge(other).read([])).rejects.toMatchObject({ message: 'TypeError' });
        expect(other.scripts).toHaveLength(1);
    });

    it('turns output it cannot read into a ThingsError', async () => {
        await expect(new ScriptBridge(runner('garbage')).read([])).rejects.toMatchObject({ kind: 'other' });
    });

    it('passes the runner\'s ThingsError through', async () => {
        const denied = new ThingsError('permission', 'Not authorized');
        await expect(new ScriptBridge(runner(denied)).read([])).rejects.toBe(denied);
        await expect(new ScriptBridge(runner(denied)).run({ kind: 'deleteTodo', id: 'TodoPlan01' })).rejects.toBe(denied);
    });

    it('returns the ID an op made or found, and null for none', async () => {
        const op = { kind: 'makeArea', name: 'Work' } as const;
        const r = runner('AreaNew001\n');
        expect(await new ScriptBridge(r).run(op)).toBe('AreaNew001');
        expect(r.scripts[0].script).toBe(writeScript(op));
        expect(await new ScriptBridge(runner('\n')).run({ kind: 'findProjectByNotes', marker: 'm' })).toBeNull();
    });

    it('opens links and asks whether Things is running through the runner', async () => {
        const r = runner('');
        const bridge = new ScriptBridge(r);
        await bridge.open('things:///update?id=x');
        expect(r.opened).toEqual(['things:///update?id=x']);
        expect(await bridge.isRunning()).toBe(true);
    });
});

describe('FakeThings', () => {
    const TOKEN = 'tok';

    /** A project made the way the round makes one: a json create link with a marker in its notes, then found by it. */
    async function project(things: FakeThings, headings: string[], extra: object[] = []): Promise<string> {
        const items = [...headings.map(title => ({ type: 'heading', attributes: { title } })), ...extra];
        await things.open(jsonCreateLink([{ type: 'project', attributes: { title: 'Q4 plan', notes: 'marker-1', items } }]));
        const id = await things.run({ kind: 'findProjectByNotes', marker: 'marker-1' });
        if (id === null) throw new Error('No project');
        return id;
    }

    it('applies makeTodo and an update link with heading=, and reports the to-do under that heading', async () => {
        const things = new FakeThings(TOKEN);
        const projectId = await project(things, ['This week', 'Next week']);
        const id = await things.run({ kind: 'makeTodo', name: 'Draft', notes: '', tags: [], projectId });
        await things.open(updateLink(id ?? '', { heading: 'Next week' }, TOKEN));
        const snapshot = await things.read([]);
        expect(snapshot.projects).toEqual([{ id: projectId, title: 'Q4 plan', headings: ['This week', 'Next week'], status: 'open', trashed: false, notes: 'marker-1' }]);
        expect(snapshot.todos).toEqual([expect.objectContaining({ id, projectId, heading: 'Next week', inbox: false })]);
        expect(snapshot.capabilities).toEqual({ headings: true, checklist: true, reminder: true, repeating: false, reorder: false });
    });

    it('ignores a heading the project lacks, and a link with the wrong token, as Things does', async () => {
        const things = new FakeThings(TOKEN);
        const projectId = await project(things, ['This week']);
        const id = await things.run({ kind: 'makeTodo', name: 'Draft', notes: '', tags: [], projectId }) ?? '';
        await things.open(updateLink(id, { heading: 'Someday maybe' }, TOKEN));
        const wrong = updateLink(id, { title: 'Changed' }, 'nope');
        await things.open(wrong);
        expect(things.todos.get(id)?.heading).toBeUndefined();
        expect(things.todos.get(id)?.fields.title).toBe('Draft');
        expect(things.refused).toEqual([wrong]);
    });

    it('places to-dos made inside a new project under the heading before them', async () => {
        const things = new FakeThings(TOKEN);
        const projectId = await project(things, [], [
            { type: 'to-do', attributes: { title: 'Loose' } },
            { type: 'heading', attributes: { title: 'Later' } },
            { type: 'to-do', attributes: { title: 'Under later', when: '2026-11-23@09:30' } }
        ]);
        const todos = (await things.read([])).todos;
        expect(things.projects.get(projectId)?.headings).toEqual(['Later']);
        expect(todos.map(t => [t.fields.title, t.projectId, t.heading, t.fields.reminder])).toEqual([
            ['Loose', projectId, undefined, undefined],
            ['Under later', projectId, 'Later', '09:30']
        ]);
    });

    it('applies a link\'s when, checklist, tags and status, and skips tags Things lacks', async () => {
        const things = new FakeThings(TOKEN);
        things.tags.add('Errands');
        const id = things.addTodo({ title: 'Call', when: '2026-11-22', reminder: '15:00' });
        await things.open(updateLink(id, {
            when: whenParam({ someday: false, when: '2026-11-25', reminder: '15:00' }),
            'checklist-items': 'Dial\nTalk',
            tags: 'Errands, Unknown',
            completed: 'true'
        }, TOKEN));
        expect(things.todos.get(id)?.fields).toEqual({
            title: 'Call', notes: '', tags: ['Errands'], status: 'completed', someday: false, when: '2026-11-25', reminder: '15:00',
            checklist: [{ title: 'Dial', done: false }, { title: 'Talk', done: false }]
        });
        await things.open(updateLink(id, { when: '2026-11-26', canceled: 'true', completed: 'true' }, TOKEN));
        expect(things.todos.get(id)?.fields).toMatchObject({ when: '2026-11-26', status: 'canceled' });
        expect(things.todos.get(id)?.fields.reminder).toBeUndefined();
        await things.open(updateLink(id, { when: 'someday', completed: 'false' }, TOKEN));
        expect(things.todos.get(id)?.fields).toMatchObject({ someday: true, status: 'open' });
        expect(things.todos.get(id)?.fields.when).toBeUndefined();
    });

    it('updates checklist items with their ticks through a json update', async () => {
        const things = new FakeThings(TOKEN);
        const id = things.addTodo({ title: 'Pack' });
        const items = [{ type: 'checklist-item', attributes: { title: 'Socks', completed: true } }];
        await things.open(jsonCreateLink([{ type: 'to-do', operation: 'update', id, attributes: { 'checklist-items': items } }], TOKEN));
        expect(things.todos.get(id)?.fields.checklist).toEqual([{ title: 'Socks', done: true }]);
    });

    it('makes tags through AppleScript, which links cannot', async () => {
        const things = new FakeThings(TOKEN);
        const id = await things.run({ kind: 'makeTodo', name: 'Call', notes: 'n', tags: ['Home', 'Errands', 'Home'] }) ?? '';
        expect(things.todos.get(id)).toMatchObject({ inbox: true, fields: { title: 'Call', notes: 'n', tags: ['Errands', 'Home'] } });
        expect([...things.tags].sort()).toEqual(['Errands', 'Home']);
    });

    it('carries out moves, field changes and deletes', async () => {
        const things = new FakeThings(TOKEN);
        const areaId = await things.run({ kind: 'makeArea', name: 'Work' }) ?? '';
        const projectId = things.addProject({ title: 'Plan', headings: ['Now'] });
        const id = things.addTodo({ title: 'Call', projectId, heading: 'Now' });
        await things.run({ kind: 'setTodo', id, name: 'Call Mom', when: '2026-11-24', status: 'completed', tags: ['Home'] });
        expect(things.todos.get(id)?.fields).toMatchObject({ title: 'Call Mom', when: '2026-11-24', status: 'completed', tags: ['Home'] });
        await things.run({ kind: 'moveTodo', id, areaId });
        expect(things.todos.get(id)).toMatchObject({ areaId, inbox: false });
        expect(things.todos.get(id)?.projectId ?? things.todos.get(id)?.heading).toBeUndefined();
        await things.run({ kind: 'setProject', id: projectId, name: 'Plan B', areaId, status: 'completed' });
        expect(things.projects.get(projectId)).toMatchObject({ title: 'Plan B', areaId, status: 'completed' });
        await things.run({ kind: 'setProject', id: projectId, areaId: '' });
        expect(things.projects.get(projectId)?.areaId).toBeUndefined();
        await things.run({ kind: 'deleteTodo', id });
        await things.run({ kind: 'deleteProject', id: projectId });
        expect(things.todos.get(id)?.trashed).toBe(true);
        expect(things.projects.get(projectId)?.trashed).toBe(true);
        await expect(things.run({ kind: 'deleteTodo', id: 'TodoNone01' })).rejects.toBeInstanceOf(ThingsError);
        expect(things.ops.map(op => op.kind)).toEqual(['makeArea', 'setTodo', 'moveTodo', 'setProject', 'setProject', 'deleteTodo', 'deleteProject']);
    });

    it('reports done and trashed to-dos only when asked for by ID, like the real read', async () => {
        const things = new FakeThings(TOKEN);
        const open = things.addTodo({ title: 'Open' });
        const done = things.addTodo({ title: 'Done', status: 'completed' });
        const trashed = things.addTodo({ title: 'Trashed', trashed: true });
        expect((await things.read([])).todos.map(t => t.id)).toEqual([open]);
        const all = (await things.read([done, trashed, 'TodoGone01'])).todos;
        expect(all.map(t => [t.id, t.logged, t.trashed])).toEqual([[open, false, false], [done, true, false], [trashed, false, true]]);
    });

    it('fails a chosen call on demand, once or until healed', async () => {
        const things = new FakeThings(TOKEN);
        things.fail('read', new ThingsError('permission', 'denied'), true);
        await expect(things.read([])).rejects.toMatchObject({ kind: 'permission' });
        await expect(things.read([])).resolves.toBeDefined();
        things.fail('makeTodo');
        await expect(things.run({ kind: 'makeTodo', name: 'A', notes: '', tags: [] })).rejects.toBeInstanceOf(ThingsError);
        await expect(things.run({ kind: 'makeTodo', name: 'A', notes: '', tags: [] })).rejects.toBeInstanceOf(ThingsError);
        expect(things.todos.size).toBe(0);
        things.heal();
        await expect(things.run({ kind: 'makeTodo', name: 'A', notes: '', tags: [] })).resolves.toMatch(/^[A-Za-z0-9]{8,40}$/);
    });

    it('refuses every link while Things URLs are off', async () => {
        const things = new FakeThings(TOKEN);
        things.urlsEnabled = false;
        const link = jsonCreateLink([{ type: 'project', attributes: { title: 'P', notes: 'marker-2' } }]);
        await things.open(link);
        expect(things.refused).toEqual([link]);
        expect(await things.run({ kind: 'findProjectByNotes', marker: 'marker-2' })).toBeNull();
    });

    it('turns down what Things has no attribute for, so the link format cannot drift', async () => {
        const things = new FakeThings(TOKEN);
        const id = things.addTodo({ title: 'Call' });
        await expect(things.open(updateLink(id, { headingTitle: 'x' }, TOKEN))).rejects.toThrow(/headingTitle/);
        await expect(things.open(jsonCreateLink([{ type: 'project', attributes: { title: 'P', areaId: 'x' } }]))).rejects.toThrow(/areaId/);
        const projectId = things.addProject({ title: 'P' });
        const headings = jsonCreateLink([{ type: 'project', operation: 'update', id: projectId, attributes: { items: [{ type: 'heading', attributes: { title: 'New' } }] } }], TOKEN);
        await expect(things.open(headings)).rejects.toThrow(/heading/);
        await expect(things.run({ kind: 'setTodo', id, when: '2026-11-23@15:00' })).rejects.toThrow(/link/);
    });

    it('can hold links until they settle, as Things acts after open returns', async () => {
        const things = new FakeThings(TOKEN);
        things.deferLinks = true;
        const id = things.addTodo({ title: 'Call' });
        await things.open(jsonCreateLink([{ type: 'project', attributes: { title: 'P', notes: 'marker-3' } }]));
        await things.open(updateLink(id, { title: 'Call Mom' }, TOKEN));
        expect(await things.run({ kind: 'findProjectByNotes', marker: 'marker-3' })).toBeNull();
        expect((await things.read([])).todos.map(t => t.fields.title)).toEqual(['Call']);
        expect(things.links).toHaveLength(2);
        things.settleLinks();
        expect(await things.run({ kind: 'findProjectByNotes', marker: 'marker-3' })).toMatch(/^FakeProj/);
        expect(things.todos.get(id)?.fields.title).toBe('Call Mom');
        things.settleLinks();
        expect(things.projects.size).toBe(1);
    });

    it('reads with the capabilities it is given, leaving out what they hide', async () => {
        const things = new FakeThings(TOKEN);
        const projectId = things.addProject({ title: 'Plan', headings: ['Now'] });
        things.addTodo({ title: 'Call', projectId, heading: 'Now', when: '2026-11-23', reminder: '15:00', checklist: [{ title: 'Dial', done: false }] });
        things.capabilities = { headings: false, checklist: false, reminder: false, repeating: false, reorder: false };
        const snapshot = await things.read([]);
        expect(snapshot.capabilities).toEqual(things.capabilities);
        expect(snapshot.projects[0].headings).toBeUndefined();
        expect(snapshot.todos[0].heading).toBeUndefined();
        expect(snapshot.todos[0].fields).toMatchObject({ when: '2026-11-23', checklist: [] });
        expect(snapshot.todos[0].fields.reminder).toBeUndefined();
    });

    it('makes nothing when a to-do\'s project or area is gone, so no stray to-do lands in the Inbox', async () => {
        const things = new FakeThings(TOKEN);
        await expect(things.run({ kind: 'makeTodo', name: 'A', notes: '', tags: [], projectId: 'ProjGone01' })).rejects.toThrow(/ProjGone01 is gone from Things/);
        await expect(things.run({ kind: 'makeTodo', name: 'A', notes: '', tags: [], areaId: 'AreaGone01' })).rejects.toMatchObject({ kind: 'other' });
        expect(things.todos.size).toBe(0);
    });

    it('lists every to-do in a project, done and cancelled too, but not the trashed', async () => {
        const things = new FakeThings(TOKEN);
        const projectId = things.addProject({ title: 'Plan' });
        const open = things.addTodo({ title: 'Open', projectId });
        const done = things.addTodo({ title: 'Done', projectId, status: 'completed' });
        const dropped = things.addTodo({ title: 'Dropped', projectId, status: 'canceled' });
        things.addTodo({ title: 'Binned', projectId, trashed: true });
        things.addTodo({ title: 'Elsewhere' });
        const ids = await things.run({ kind: 'projectTodoIds', id: projectId });
        expect(JSON.parse(ids ?? '')).toEqual([open, done, dropped]);
        await expect(things.run({ kind: 'projectTodoIds', id: 'ProjGone01' })).rejects.toBeInstanceOf(ThingsError);
    });
});
