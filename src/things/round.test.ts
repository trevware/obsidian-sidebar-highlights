// The real moment, so dates in task text parse the way they do in Obsidian.
jest.mock('obsidian', () => ({ moment: jest.requireActual('moment') }), { virtual: true });

import type HighlightCommentsPlugin from '../../main';
import { TaskManager } from '../managers/task-manager';
import { insertionLine, locateTaskLine, taskBlockEnd } from '../tasks-view/task-line';
import { FakeThings, ThingsError } from './bridge';
import type { BridgeOp } from './bridge';
import { readThingsId } from './ids';
import { EMPTY_STATE } from './model';
import type { Capabilities, SyncedProject, ThingsSnapshot, ThingsState, VaultSnapshot } from './model';
import { applyThingsEdits } from './note-edits';
import { runThingsRound } from './round';
import type { ThingsRoundDeps, ThingsRoundResult } from './round';
import { vaultSnapshot } from './vault-snapshot';

const NOW = Date.UTC(2026, 10, 22, 12, 0);
const TOKEN = 'round-test-token';
const PLAN = 'Work/Plan.md';
const HOME = 'Work/Home.md';
const RETIRED = '\t- 2026-11-22: deleted in Things, no longer synced.';
const fmt = { date: (iso: string) => iso, time: (hhmm: string) => hhmm, today: '2026-11-22' };
const scanner = new TaskManager({ app: { vault: {} }, settings: { taskDateFormat: 'YYYY-MM-DD' } } as unknown as HighlightCommentsPlugin);

const ALL_ON: Capabilities = { headings: true, checklist: true, reminder: true, repeating: false, reorder: false };
const ALL_OFF: Capabilities = { headings: false, checklist: false, reminder: false, repeating: false, reorder: false };

/** FakeThings that remembers what each read asked about and can refuse chosen ops. */
class Things extends FakeThings {
    readonly asked: string[][] = [];
    trap?: (op: BridgeOp) => Error | undefined;

    async read(knownIds: string[]): Promise<ThingsSnapshot> {
        this.asked.push([...knownIds]);
        return super.read(knownIds);
    }

    async run(op: BridgeOp): Promise<string | null> {
        const error = this.trap?.(op);
        if (error) throw error;
        return super.run(op);
    }

    named(title: string): string {
        const found = [...this.todos.values()].filter(todo => todo.fields.title === title && !todo.trashed);
        if (found.length !== 1) throw new Error(`${found.length} to-dos named "${title}"`);
        return found[0].id;
    }

    live(): string[] {
        return [...this.todos.values()].filter(todo => !todo.trashed).map(todo => todo.fields.title).sort();
    }
}

interface Config { name: string; defer: boolean; caps: Capabilities }

/** A vault in memory and a Things, with the round's dependencies wired between them. */
class World {
    readonly now = NOW;
    readonly notes = new Map<string, { lines: string[]; mtime: number }>();
    readonly things = new Things(TOKEN);
    state: ThingsState = JSON.parse(JSON.stringify(EMPTY_STATE)) as ThingsState;
    /** Paths written through editNote, by round. */
    edited: string[] = [];
    /** Runs as a note is about to be edited: the user typing between the read and the write. */
    beforeEdit?: (path: string, lines: string[]) => void;
    private markers = 0;

    constructor(config: Config) {
        this.things.deferLinks = config.defer;
        this.things.capabilities = { ...config.caps };
    }

    write(path: string, ...lines: string[]): void {
        this.notes.set(path, { lines, mtime: this.now });
    }

    lines(path: string): string[] {
        const note = this.notes.get(path);
        if (!note) throw new Error(`No note ${path}`);
        return note.lines.filter((line, i, all) => i < all.length - 1 || line !== '');
    }

    /** The Things ID on the line with these words. */
    idOn(path: string, words: string): string {
        const line = this.lines(path).find(text => text.includes(words));
        const id = line && readThingsId(line);
        if (!id) throw new Error(`No ID on "${words}" in ${path}: ${JSON.stringify(this.lines(path))}`);
        return id;
    }

    project(path: string): SyncedProject {
        const found = this.state.projects.find(p => p.path === path);
        if (!found) throw new Error(`No project for ${path}`);
        return found;
    }

    snapshot(): VaultSnapshot {
        return vaultSnapshot([...this.notes].map(([path, note]) => ({ path, lines: note.lines, mtime: note.mtime })), {
            parse: (path, content) => scanner.tasksInContent(path, content, true, false),
            hideMetadata: false,
            dailyDate: () => undefined
        });
    }

    deps(over: Partial<ThingsRoundDeps> = {}): ThingsRoundDeps {
        const things = this.things;
        return {
            vault: this.snapshot(),
            state: this.state,
            bridge: things,
            token: TOKEN,
            now: this.now,
            fmt,
            notes: { exists: path => this.notes.has(path), mtime: path => this.notes.get(path)?.mtime ?? 0 },
            editNote: async (path, steps) => {
                this.edited.push(path);
                const note = this.notes.get(path);
                if (!note) return steps.length;
                this.beforeEdit?.(path, note.lines);
                const { lines, missed } = applyThingsEdits(note.lines, steps, fmt);
                if (lines.join('\n') !== note.lines.join('\n')) this.notes.set(path, { lines, mtime: this.now });
                return missed;
            },
            createNote: async (path, content) => {
                if (this.notes.has(path)) throw new Error(`${path} exists`);
                this.notes.set(path, { lines: content.split(/\r?\n/), mtime: this.now });
            },
            renameNote: async (from, to) => {
                const note = this.notes.get(from);
                if (!note || this.notes.has(to)) throw new Error(`Can't rename ${from} to ${to}`);
                this.notes.delete(from);
                this.notes.set(to, note);
            },
            moveTaskBlock: async (from, to) => {
                const source = this.notes.get(from.path);
                const target = this.notes.get(to.path);
                if (!source || !target) return false;
                const at = locateTaskLine(source.lines, from.line, from.text);
                if (at === -1) return false;
                const block = source.lines.slice(at, taskBlockEnd(source.lines, at));
                const lines = [...target.lines];
                if (to.heading !== undefined && !lines.some(line => line.replace(/^#{1,6}\s+/, '') === to.heading && line.startsWith('#'))) lines.push('', `## ${to.heading}`);
                lines.splice(insertionLine(lines, to.heading), 0, ...block);
                this.notes.set(from.path, { lines: [...source.lines.slice(0, at), ...source.lines.slice(at + block.length)], mtime: this.now });
                this.notes.set(to.path, { lines, mtime: this.now });
                return true;
            },
            newMarker: () => `sidebar-highlights-sync-${++this.markers}`,
            // Time passing while the round looks for a project: Things acts on the links it was sent.
            wait: async () => things.settleLinks(),
            ...over
        };
    }

    /** One round. Afterwards Things acts on the links it was sent, as it does before the next round. */
    async round(over: Partial<ThingsRoundDeps> = {}): Promise<ThingsRoundResult> {
        this.edited = [];
        const { result, state } = await runThingsRound(this.deps(over));
        this.state = state;
        this.things.settleLinks();
        // Each note's steps went in one write.
        expect(new Set(this.edited).size).toBe(this.edited.length);
        return result;
    }

    /** Everything a round could change: the notes, the state, and what Things was asked to do. */
    picture(): string {
        return JSON.stringify({ notes: [...this.notes].map(([path, note]) => [path, note.lines]), state: this.state, ops: this.changes(), links: this.things.links });
    }

    /** The notes and what Things was asked to do: everything but the state. */
    outside(): string {
        return JSON.stringify({ notes: [...this.notes].map(([path, note]) => [path, note.lines]), ops: this.changes(), links: this.things.links });
    }

    /** The ops that change Things, leaving out the ones that only ask it something. */
    changes(): unknown[] {
        return this.things.ops.filter(op => op.kind !== 'findProjectByNotes' && op.kind !== 'projectTodoIds');
    }

    /**
     * Quiet from here: one round that may only record what Things now shows
     * (a change sent by link counts once a read confirms it) and touches
     * neither the notes nor Things, then a round that changes nothing at all.
     */
    async settled(): Promise<void> {
        const outside = this.outside();
        const confirming = await this.round();
        expect(confirming).toEqual({ toThings: 0, toVault: 0, missed: 0 });
        expect(this.outside()).toBe(outside);
        const before = this.picture();
        const result = await this.round();
        expect(result).toEqual({ toThings: 0, toVault: 0, missed: 0 });
        expect(this.picture()).toBe(before);
    }
}

const CONFIGS: Config[] = [
    { name: 'links at once, every capability', defer: false, caps: ALL_ON },
    { name: 'links acted on later, every capability', defer: true, caps: ALL_ON },
    { name: 'links at once, no capabilities', defer: false, caps: ALL_OFF },
    { name: 'links acted on later, no capabilities', defer: true, caps: ALL_OFF }
];

describe.each(CONFIGS)('runThingsRound: $name', config => {
    let w: World;
    let t: Things;
    beforeEach(() => {
        w = new World(config);
        t = w.things;
    });

    /** A synced Work/Plan.md with these task lines, and the IDs they got. */
    async function synced(...tasks: string[]): Promise<string[]> {
        w.write(PLAN, '# Plan', ...tasks.map(task => `- [ ] ${task}`));
        const result = await w.round();
        expect(result.failed).toBeUndefined();
        return tasks.map(task => w.idOn(PLAN, task));
    }

    it('connects both ways on the first round, and the next round has nothing to do', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief', '', '## Later', '- [ ] Book venue 2026-11-25');
        w.write('Home/Errands.md', '# Errands', '- [ ] Buy milk #shop', '\t- [x] Check fridge', '\t- [ ] Make list');
        const work = t.addArea('Work');
        const plan = t.addProject({ title: 'Plan', areaId: work });
        const brief = t.addTodo({ title: 'Write brief', projectId: plan });
        const trip = t.addProject({ title: 'Trip', areaId: work, headings: ['Before'] });
        const pack = t.addTodo({ title: 'Pack bags', projectId: trip, heading: 'Before' });
        const taxes = t.addTodo({ title: 'File taxes', areaId: work });
        const passport = t.addTodo({ title: 'Renew passport' });

        const result = await w.round();
        expect(result.failed).toBeUndefined();
        expect(result.missed).toBe(0);
        expect(result).toMatchObject({ toThings: 2, toVault: 3 });
        expect(w.state.joined).toBe(true);

        // The line joined by name takes its to-do's ID; the new line gets a to-do with its date, under its heading.
        expect(w.lines(PLAN)[1]).toBe(`- [ ] Write brief %%things:${brief}%%`);
        const venue = w.idOn(PLAN, 'Book venue');
        const planNow = w.project(PLAN).id;
        expect(t.todos.get(brief)?.projectId).toBe(planNow);
        expect(t.todos.get(venue)).toMatchObject({ projectId: planNow, fields: { title: 'Book venue', when: '2026-11-25' } });
        expect(t.links).toContainEqual(expect.stringContaining(`list-id=${planNow}&heading=Later`));
        if (config.caps.headings) {
            // Things' project lacked the note's heading, so it was rebuilt with it.
            expect(planNow).not.toBe(plan);
            expect(t.projects.get(plan)?.trashed).toBe(true);
            expect(t.projects.get(planNow)).toMatchObject({ title: 'Plan', areaId: work, headings: ['Later'], trashed: false });
            expect(t.todos.get(venue)?.heading).toBe('Later');
        } else {
            expect(planNow).toBe(plan);
        }

        // A note with no project gets an area, a project and to-dos, tags by AppleScript and ticks by a json update.
        const milk = w.idOn('Home/Errands.md', 'Buy milk');
        const home = [...t.areas.values()].find(area => area.title === 'Home');
        const errands = [...t.projects.values()].find(p => p.title === 'Errands');
        expect(errands).toMatchObject({ areaId: home?.id, notes: '' });
        expect(t.ops).toContainEqual({ kind: 'makeTodo', name: 'Buy milk', notes: '', tags: ['shop'], projectId: errands?.id });
        expect(t.todos.get(milk)).toMatchObject({ projectId: errands?.id, fields: { tags: ['shop'], checklist: [{ title: 'Check fridge', done: true }, { title: 'Make list', done: false }] } });

        // What only Things had comes in: a new project's note, an area's loose note, the Inbox note.
        expect(w.lines('Work/Trip.md')).toEqual(config.caps.headings
            ? ['# Trip', '', '## Before', `- [ ] Pack bags %%things:${pack}%%`]
            : ['# Trip', `- [ ] Pack bags %%things:${pack}%%`]);
        expect(w.lines('Work/Work.md')).toEqual(['# Work', `- [ ] File taxes %%things:${taxes}%%`]);
        expect(w.lines('Things Inbox.md')).toEqual(['# Things Inbox', `- [ ] Renew passport %%things:${passport}%%`]);

        expect([...w.state.areas].sort((a, b) => a.folder.localeCompare(b.folder))).toEqual([{ id: home?.id, folder: 'Home' }, { id: work, folder: 'Work' }]);
        expect(w.state.looseNotes).toEqual({ [work]: 'Work/Work.md' });
        expect(w.state.projects.map(p => [p.path, p.id]).sort()).toEqual([['Home/Errands.md', errands?.id], [PLAN, planNow], ['Work/Trip.md', trip]]);
        expect(w.project('Work/Trip.md')).toMatchObject({ title: 'Trip', areaId: work, headings: config.caps.headings ? ['Before'] : [] });
        expect(w.state.todos.map(todo => todo.id).sort()).toEqual([brief, venue, milk, pack, taxes, passport].sort());
        await w.settled();
        // The heading counts once a read shows Things took it.
        expect(w.state.todos.find(todo => todo.id === venue)?.place).toEqual({ path: PLAN, heading: 'Later' });
    });

    it('rebuilds the project when the note gains a heading, and every to-do keeps its ID', async () => {
        const [brief, venue] = await synced('Write brief', 'Book venue');
        const old = w.project(PLAN);
        w.write(PLAN, '# Plan', `- [ ] Write brief %%things:${brief}%%`, '', '## Next', `- [ ] Book venue %%things:${venue}%%`, '- [ ] Call caterer');

        const result = await w.round();
        expect(result.failed).toBeUndefined();
        const now = w.project(PLAN);
        expect(now.id).not.toBe(old.id);
        expect(now.headings).toEqual(['Next']);
        expect(t.projects.get(old.id)?.trashed).toBe(true);
        expect(t.projects.get(now.id)).toMatchObject({ title: 'Plan', areaId: old.areaId, headings: ['Next'], notes: '', trashed: false });
        expect(t.todos.get(brief)).toMatchObject({ projectId: now.id, trashed: false });
        expect(t.todos.get(brief)?.heading).toBeUndefined();
        expect(t.todos.get(venue)).toMatchObject({ projectId: now.id, heading: 'Next', trashed: false });
        const caterer = w.idOn(PLAN, 'Call caterer');
        expect(t.todos.get(caterer)).toMatchObject({ projectId: now.id, heading: 'Next' });
        expect(w.lines(PLAN)).toEqual(['# Plan', `- [ ] Write brief %%things:${brief}%%`, '', '## Next', `- [ ] Book venue %%things:${venue}%%`, `- [ ] Call caterer %%things:${caterer}%%`]);

        await w.settled();
    });

    // Without headings in the read, a move between headings in Things can't be seen at all.
    (config.caps.headings ? it : it.skip)('moves the line, not the to-do back, when a move from Things missed the note during a swap', async () => {
        w.write(PLAN, '# Plan', '## A', '- [ ] Write brief', '## B', '- [ ] Book venue');
        await w.round();
        // A second round, so the state holds the headings Things now shows.
        await w.round();
        const brief = w.idOn(PLAN, 'Write brief');
        const venue = w.idOn(PLAN, 'Book venue');
        const todo = t.todos.get(brief);
        if (todo) todo.heading = 'B';
        w.write(PLAN, '# Plan', '## A', `- [ ] Write brief %%things:${brief}%%`, '## B', `- [ ] Book venue %%things:${venue}%%`, '## C', '- [ ] Call caterer');
        w.beforeEdit = (path, lines) => {
            lines[2] = `- [ ] Write brief soon %%things:${brief}%%`;
            w.beforeEdit = undefined;
        };

        const swapped = await w.round();
        expect(swapped.missed).toBe(1);
        expect(t.todos.get(brief)?.heading).toBe('B');
        expect(w.state.todos.find(synced => synced.id === brief)?.place).toEqual({ path: PLAN, heading: 'A' });

        await w.round();
        expect(t.todos.get(brief)).toMatchObject({ heading: 'B', fields: { title: 'Write brief soon' } });
        const lines = w.lines(PLAN);
        expect(lines.indexOf(`- [ ] Write brief soon %%things:${brief}%%`)).toBeGreaterThan(lines.indexOf('## B'));

        // Heading A holds nothing now, so the project is rebuilt without it once more.
        await w.round();
        expect(w.project(PLAN).headings).toEqual(['B', 'C']);
        expect(t.todos.get(brief)?.heading).toBe('B');
        await w.settled();
    });

    it('carries done to-dos across in a heading swap', async () => {
        const [brief] = await synced('Write brief');
        const old = w.project(PLAN).id;
        const logged = t.addTodo({ title: 'Old thing', projectId: old, status: 'completed' });
        w.write(PLAN, '# Plan', '## Now', `- [ ] Write brief %%things:${brief}%%`);

        await w.round();
        const now = w.project(PLAN).id;
        expect(now).not.toBe(old);
        expect(t.todos.get(logged)).toMatchObject({ projectId: now, trashed: false, fields: { status: 'completed' } });
        expect(t.todos.get(brief)).toMatchObject({ projectId: now, heading: 'Now' });
        expect(t.projects.get(old)?.trashed).toBe(true);
    });

    it('completes the old project instead of trashing it when its done to-dos won\'t move', async () => {
        const [brief] = await synced('Write brief');
        const old = w.project(PLAN).id;
        const logged = t.addTodo({ title: 'Old thing', projectId: old, status: 'completed' });
        t.trap = op => op.kind === 'moveTodo' && op.id === logged ? new ThingsError('other', "Can't move a to-do in the Logbook") : undefined;
        w.write(PLAN, '# Plan', '## Now', `- [ ] Write brief %%things:${brief}%%`);

        await w.round();
        const now = w.project(PLAN).id;
        expect(now).not.toBe(old);
        expect(t.todos.get(brief)?.projectId).toBe(now);
        expect(t.todos.get(logged)).toMatchObject({ projectId: old, trashed: false });
        expect(t.projects.get(old)).toMatchObject({ status: 'completed', trashed: false });
    });

    it('puts everything back when an open to-do won\'t move, and swaps on the next round', async () => {
        const [brief, venue] = await synced('Write brief', 'Book venue');
        const old = w.project(PLAN).id;
        t.trap = op => op.kind === 'moveTodo' && op.id === venue && op.projectId !== old ? new ThingsError('other', 'Things failed: moveTodo') : undefined;
        const lines = ['# Plan', `- [ ] Write brief %%things:${brief}%%`, '', '## Next', `- [ ] Book venue %%things:${venue}%%`];
        w.write(PLAN, ...lines);

        const result = await w.round();
        expect(result.failed).toMatchObject({ steps: 1, kind: 'other', halted: false });
        expect(w.project(PLAN).id).toBe(old);
        expect(t.projects.get(old)?.trashed).toBe(false);
        const built = [...t.projects.values()].filter(p => p.id !== old);
        expect(built).toHaveLength(1);
        expect(built[0].trashed).toBe(true);
        expect(t.todos.get(brief)).toMatchObject({ projectId: old, trashed: false });
        expect(t.todos.get(venue)).toMatchObject({ projectId: old, trashed: false });
        expect(w.lines(PLAN)).toEqual(lines);

        t.trap = undefined;
        const again = await w.round();
        expect(again.failed).toBeUndefined();
        const now = w.project(PLAN).id;
        expect(now).not.toBe(old);
        expect(t.projects.get(old)?.trashed).toBe(true);
        expect(t.todos.get(venue)).toMatchObject({ projectId: now, heading: 'Next' });
        await w.settled();
    });

    it('moves a to-do on to its new note after the swap of the note it left', async () => {
        w.write(HOME, '# Home', '- [ ] Water plants');
        const [brief, venue] = await synced('Write brief', 'Book venue');
        const water = w.idOn(HOME, 'Water plants');
        const old = w.project(PLAN).id;
        w.write(PLAN, '# Plan', '## Next', `- [ ] Book venue %%things:${venue}%%`);
        w.write(HOME, '# Home', `- [ ] Water plants %%things:${water}%%`, `- [ ] Write brief %%things:${brief}%%`);

        const result = await w.round();
        expect(result.failed).toBeUndefined();
        const now = w.project(PLAN).id;
        expect(now).not.toBe(old);
        expect(t.projects.get(old)?.trashed).toBe(true);
        expect(t.todos.get(brief)).toMatchObject({ projectId: w.project(HOME).id, trashed: false });
        expect(t.todos.get(venue)).toMatchObject({ projectId: now, heading: 'Next' });
        expect(t.ops.filter(op => op.kind === 'deleteTodo')).toEqual([]);
        await w.settled();
    });

    it('leaves a line without an ID when its to-do can\'t be made, and makes it next round', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief', '- [ ] Book venue');
        t.fail('makeTodo', new ThingsError('other', "Can't make that to-do"), true);

        const first = await w.round();
        expect(first.failed).toMatchObject({ steps: 1, kind: 'other', message: "Can't make that to-do", halted: false });
        expect(w.lines(PLAN)[1]).toBe('- [ ] Write brief');
        const venue = w.idOn(PLAN, 'Book venue');
        expect(w.state.todos.map(todo => todo.id)).toEqual([venue]);

        const second = await w.round();
        expect(second.failed).toBeUndefined();
        const brief = w.idOn(PLAN, 'Write brief');
        expect(t.live()).toEqual(['Book venue', 'Write brief']);
        expect(t.todos.get(brief)?.projectId).toBe(w.project(PLAN).id);
        await w.settled();
    });

    it('stops before writing anything when Things can\'t be read', async () => {
        const [brief] = await synced('Write brief');
        w.write(PLAN, '# Plan', `- [x] Write brief %%things:${brief}%%`, '- [ ] Book venue');
        const todo = t.todos.get(brief);
        if (todo) todo.fields.title = 'Write the brief';
        t.fail('read', new ThingsError('permission', 'Not authorized to send Apple events to Things. (-1743)'));
        const deps = w.deps();
        const state = JSON.stringify(deps.state);
        const before = w.picture();
        w.edited = [];

        await expect(runThingsRound(deps)).rejects.toMatchObject({ kind: 'permission' });
        expect(w.picture()).toBe(before);
        expect(JSON.stringify(deps.state)).toBe(state);
        expect(w.edited).toEqual([]);
    });

    it('changes nothing when too much vanished from one side, until the user confirms the vault side', async () => {
        const ids = await synced('One', 'Two', 'Three', 'Four', 'Five');
        for (const id of ids.slice(0, 4)) t.todos.delete(id);
        const before = w.picture();
        const things = await w.round();
        expect(things).toEqual({ toThings: 0, toVault: 0, missed: 0, stopped: { side: 'things', missing: 4 } });
        expect(w.picture()).toBe(before);

        const other = new World(config);
        w = other;
        t = other.things;
        await synced('One', 'Two', 'Three', 'Four', 'Five');
        w.notes.set(PLAN, { lines: ['# Plan', w.lines(PLAN)[5]], mtime: NOW - 10 * 60 * 1000 });
        expect(await w.round()).toMatchObject({ stopped: { side: 'vault', missing: 4 } });
        expect(t.live()).toHaveLength(5);

        const confirmed = await w.round({ acceptMissing: true });
        expect(confirmed.stopped).toBeUndefined();
        expect(t.live()).toEqual(['Five']);
        expect(w.state.todos.map(todo => todo.fields.title)).toEqual(['Five']);
    });

    it('stays unjoined while a joined line couldn\'t take its ID, then joins', async () => {
        const work = t.addArea('Work');
        const plan = t.addProject({ title: 'Plan', areaId: work });
        const brief = t.addTodo({ title: 'Write brief', projectId: plan });
        w.write(PLAN, '# Plan', '- [ ] Write brief');
        w.beforeEdit = (path, lines) => {
            lines[1] = '- [ ] Write brief #soon';
            w.beforeEdit = undefined;
        };

        const first = await w.round();
        expect(first.missed).toBe(1);
        expect(w.state.joined).toBe(false);
        expect(w.lines(PLAN)[1]).toBe('- [ ] Write brief #soon');

        await w.round();
        expect(w.state.joined).toBe(true);
        expect(w.lines(PLAN)[1]).toBe(`- [ ] Write brief #soon %%things:${brief}%%`);
        expect(t.live()).toEqual(['Write brief']);
        expect(t.todos.get(brief)?.fields.tags).toEqual(['soon']);
        await w.settled();
    });

    it('writes into a note under its new name when Things renamed its project this round', async () => {
        const [brief] = await synced('Write brief');
        const id = w.project(PLAN).id;
        const project = t.projects.get(id);
        if (project) project.title = 'Q4 Plan';
        const call = t.addTodo({ title: 'Call Sam', projectId: id });

        const result = await w.round();
        expect(result.failed).toBeUndefined();
        expect(w.notes.has(PLAN)).toBe(false);
        expect(w.lines('Work/Q4 Plan.md')).toEqual(['# Plan', `- [ ] Call Sam %%things:${call}%%`, `- [ ] Write brief %%things:${brief}%%`]);
        expect(w.project('Work/Q4 Plan.md')).toMatchObject({ id, title: 'Q4 Plan' });
        expect(w.state.todos.map(todo => todo.place.path)).toEqual(['Work/Q4 Plan.md', 'Work/Q4 Plan.md']);
        await w.settled();
    });

    it('records the new area when Things moves a project into one', async () => {
        w.write(HOME, '# Home', '- [ ] Water plants');
        await synced('Write brief');
        const id = w.project(PLAN).id;
        const errands = t.addArea('Errands');
        const project = t.projects.get(id);
        if (project) project.areaId = errands;

        await w.round();
        expect(w.notes.has('Errands/Plan.md')).toBe(true);
        expect(w.state.areas).toContainEqual({ id: errands, folder: 'Errands' });
        expect(w.project('Errands/Plan.md')).toMatchObject({ id, areaId: errands });
        await w.settled();
    });

    it('retires the lines of a project deleted in Things, then makes a new project for a new task', async () => {
        await synced('Write brief', 'Book venue');
        const old = w.project(PLAN).id;
        const project = t.projects.get(old);
        if (project) project.trashed = true;

        await w.round();
        expect(w.lines(PLAN)).toEqual(['# Plan', '- Write brief', RETIRED, '- Book venue', RETIRED]);
        expect(w.state.projects).toEqual([]);
        expect(w.state.todos).toEqual([]);

        w.write(PLAN, ...w.lines(PLAN), '- [ ] Call caterer');
        await w.round();
        const call = w.idOn(PLAN, 'Call caterer');
        const made = t.projects.get(t.todos.get(call)?.projectId ?? '');
        expect(made).toMatchObject({ title: 'Plan', trashed: false });
        expect(made?.id).not.toBe(old);
        expect(w.project(PLAN).id).toBe(made?.id);
    });

    it('asks Things only about to-dos that may still be open', async () => {
        const [brief, venue, caterer] = await synced('Write brief', 'Book venue', 'Call caterer');
        w.write(PLAN, '# Plan', `- [ ] Write brief %%things:${brief}%%`, `- [x] Book venue %%things:${venue}%%`, `- [x] Call caterer %%things:${caterer}%%`);
        await w.round();
        expect(t.todos.get(venue)?.fields.status).toBe('completed');

        w.write(PLAN, '# Plan', `- [ ] Write brief %%things:${brief}%%`, `- [ ] Book venue %%things:${venue}%%`, `- [x] Call caterer %%things:${caterer}%%`);
        await w.round();
        const asked = t.asked[t.asked.length - 1];
        expect(asked).toEqual(expect.arrayContaining([brief, venue, w.project(PLAN).id]));
        expect(asked).not.toContain(caterer);
        expect(t.todos.get(venue)?.fields.status).toBe('open');
        await w.settled();
    });

    it('finishes a to-do renamed and moved to another note in Things over two rounds', async () => {
        w.write(HOME, '# Home', '- [ ] Water plants');
        const [brief] = await synced('Write brief');
        const todo = t.todos.get(brief);
        if (todo) {
            todo.fields.title = 'Write the brief';
            todo.projectId = w.project(HOME).id;
        }

        const first = await w.round();
        expect(first.missed).toBe(1);
        expect(w.lines(PLAN)).toEqual(['# Plan', `- [ ] Write the brief %%things:${brief}%%`]);

        const second = await w.round();
        expect(second.missed).toBe(0);
        expect(w.lines(PLAN)).toEqual(['# Plan']);
        expect(w.lines(HOME)).toContain(`- [ ] Write the brief %%things:${brief}%%`);
        expect(t.live()).toEqual(['Water plants', 'Write the brief']);
        await w.settled();
    });

    it('stops when Things never makes the project a link asked for, keeping what it did make', async () => {
        w.write('Home/Errands.md', '# Errands', '- [ ] Buy milk');
        t.urlsEnabled = false;

        const result = await w.round();
        expect(result.failed).toMatchObject({ kind: 'urls-off', halted: true });
        expect(w.lines('Home/Errands.md')).toEqual(['# Errands', '- [ ] Buy milk']);
        const areas = [...t.areas.values()];
        expect(areas).toEqual([{ id: expect.any(String), title: 'Home' }]);
        expect(w.state.areas).toEqual([{ id: areas[0].id, folder: 'Home' }]);
        expect(w.state.projects).toEqual([]);
        expect(w.state.joined).toBe(false);

        t.urlsEnabled = true;
        const again = await w.round();
        expect(again.failed).toBeUndefined();
        expect([...t.areas.values()]).toHaveLength(1);
        const milk = w.idOn('Home/Errands.md', 'Buy milk');
        expect(t.projects.get(t.todos.get(milk)?.projectId ?? '')).toMatchObject({ title: 'Errands', areaId: areas[0].id, notes: '' });
        await w.settled();
    });

    it('writes only the IDs of to-dos already made when Things stops answering', async () => {
        const [brief] = await synced('Write brief');
        const todo = t.todos.get(brief);
        if (todo) todo.fields.title = 'Write the brief';
        w.write(PLAN, '# Plan', `- [ ] Write brief %%things:${brief}%%`, '- [ ] Book venue', '- [ ] Call caterer');
        t.trap = op => op.kind === 'makeTodo' && op.name === 'Call caterer' ? new ThingsError('timeout', 'Things took too long') : undefined;

        const result = await w.round();
        expect(result.failed).toMatchObject({ kind: 'timeout', message: 'Things took too long', halted: true });
        const venue = w.idOn(PLAN, 'Book venue');
        expect(w.lines(PLAN)).toEqual(['# Plan', `- [ ] Write brief %%things:${brief}%%`, `- [ ] Book venue %%things:${venue}%%`, '- [ ] Call caterer']);

        t.trap = undefined;
        await w.round();
        expect(w.lines(PLAN)[1]).toBe(`- [ ] Write the brief %%things:${brief}%%`);
        expect(t.live()).toEqual(['Book venue', 'Call caterer', 'Write the brief']);
        await w.settled();
    });

    it('sends ticks, a new day at the same time, and words both ways in one round', async () => {
        w.write(PLAN, '# Plan', '- [ ] Pack 2026-11-25 15:00', '\t- [ ] Socks', '\t- [ ] Shirts', '- [ ] Call Sam');
        await w.round();
        const pack = w.idOn(PLAN, 'Pack');
        const sam = w.idOn(PLAN, 'Call Sam');
        expect(t.todos.get(pack)?.fields).toMatchObject({ when: '2026-11-25', reminder: '15:00' });

        w.write(PLAN, '# Plan', `- [ ] Pack 2026-11-26 15:00 %%things:${pack}%%`, '\t- [x] Socks', '\t- [ ] Shirts', `- [ ] Call Sam %%things:${sam}%%`);
        const todo = t.todos.get(sam);
        if (todo) todo.fields = { ...todo.fields, title: 'Call Sam back', status: 'completed' };

        const result = await w.round();
        expect(result).toMatchObject({ toThings: 1, toVault: 1, missed: 0 });
        expect(t.todos.get(pack)?.fields).toMatchObject({ when: '2026-11-26', reminder: '15:00', checklist: [{ title: 'Socks', done: true }, { title: 'Shirts', done: false }] });
        expect(t.links).toContainEqual(expect.stringContaining('when=2026-11-26%4015%3A00'));
        expect(w.lines(PLAN)[4]).toBe(`- [x] Call Sam back %%things:${sam}%%`);
        await w.settled();
    });

    it('counts a link it can\'t build as a failed change and carries on', async () => {
        w.write(PLAN, '# Plan', '- [ ] Pack', '\t- [ ] Odd \uD800 item', '- [ ] Call Sam');

        const result = await w.round();
        expect(result.failed).toMatchObject({ kind: 'other', halted: false });
        const pack = w.idOn(PLAN, 'Pack');
        const sam = w.idOn(PLAN, 'Call Sam');
        expect(t.todos.get(pack)?.fields.title).toBe('Pack');
        expect(t.todos.get(sam)?.projectId).toBe(w.project(PLAN).id);
    });
});

describe.each(CONFIGS)('runThingsRound after review: $name', config => {
    let w: World;
    let t: Things;
    beforeEach(() => {
        w = new World(config);
        t = w.things;
    });

    const liveProjects = (title: string) => [...t.projects.values()].filter(project => project.title === title && !project.trashed);

    it('records a heading Things renamed, so the next round leaves the project alone', async () => {
        if (!config.caps.headings) return;
        w.write(PLAN, '# Plan', '## Later', '- [ ] Write brief');
        await w.round();
        await w.round();
        const brief = w.idOn(PLAN, 'Write brief');
        const id = w.project(PLAN).id;
        const project = t.projects.get(id);
        const todo = t.todos.get(brief);
        if (!project || !todo) throw new Error('missing');
        project.headings = ['Soon'];
        todo.heading = 'Soon';
        await w.round();
        expect(w.lines(PLAN)).toContain('## Soon');
        expect(w.project(PLAN).headings).toEqual(['Soon']);
        await w.settled();
        expect(w.project(PLAN).id).toBe(id);
    });

    it('keeps a note\'s date and subtasks when Things turns the link away', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief');
        await w.round();
        await w.round();
        const brief = w.idOn(PLAN, 'Write brief');
        w.write(PLAN, '# Plan', `- [ ] Write brief %%things:${brief}%%`, '- [ ] Book venue 2026-11-25', '\t- [ ] Call hall', '\t- [ ] Pay deposit');
        await w.round({ token: 'stale-token' });
        await w.round({ token: 'stale-token' });
        const lines = w.lines(PLAN);
        expect(lines.find(line => line.includes('Book venue'))).toMatch(/^- \[ \] Book venue 2026-11-25 %%things:\w+%%$/);
        expect(lines).toContain('\t- [ ] Call hall');
        expect(lines).toContain('\t- [ ] Pay deposit');
        // With the right token the date reaches Things, and then everything settles.
        await w.round();
        expect(t.todos.get(w.idOn(PLAN, 'Book venue'))?.fields.when).toBe('2026-11-25');
        await w.round();
        await w.settled();
    });

    it('says Things is turning changes away once a change sent by link hasn\'t shown for three rounds', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief');
        await w.round();
        await w.round();
        const brief = w.idOn(PLAN, 'Write brief');
        w.write(PLAN, '# Plan', `- [ ] Write brief 2026-11-25 %%things:${brief}%%`);
        const first = await w.round({ token: 'stale-token' });
        const second = await w.round({ token: 'stale-token' });
        const third = await w.round({ token: 'stale-token' });
        expect(first.failed).toBeUndefined();
        expect(second.failed).toBeUndefined();
        expect(third.failed).toMatchObject({ kind: 'urls-off', halted: false });
        await w.round();
        expect(t.todos.get(brief)?.fields.when).toBe('2026-11-25');
        await w.settled();
        expect(w.state.unconfirmed).toBeUndefined();
    });

    it('lets a move to another note win over the swap\'s heading link in the same round', async () => {
        w.write(HOME, '# Home', '- [ ] Water plants');
        w.write(PLAN, '# Plan', '## Next', '- [ ] Write brief', '- [ ] Book venue');
        await w.round();
        await w.round();
        const brief = w.idOn(PLAN, 'Write brief');
        const venue = w.idOn(PLAN, 'Book venue');
        const water = w.idOn(HOME, 'Water plants');
        w.write(PLAN, '# Plan', '## Next', `- [ ] Book venue %%things:${venue}%%`, '', '## Later', '- [ ] Call caterer');
        w.write(HOME, '# Home', `- [ ] Water plants %%things:${water}%%`, `- [ ] Write brief %%things:${brief}%%`);
        await w.round();
        expect(t.todos.get(brief)?.projectId).toBe(w.project(HOME).id);
        await w.round();
        expect(w.lines(HOME).some(line => line.includes('Write brief'))).toBe(true);
        expect(w.lines(PLAN).some(line => line.includes('Write brief'))).toBe(false);
        await w.settled();
    });

    it('puts a to-do back for good when a swap fails, even with its heading link still waiting', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief', '- [ ] Book venue');
        await w.round();
        await w.round();
        const brief = w.idOn(PLAN, 'Write brief');
        const venue = w.idOn(PLAN, 'Book venue');
        const old = w.project(PLAN).id;
        t.trap = op => (op.kind === 'moveTodo' && op.id === brief && op.projectId !== old ? new ThingsError('other', 'Things failed: moveTodo') : undefined);
        w.write(PLAN, '# Plan', '## Next', `- [ ] Book venue %%things:${venue}%%`, `- [ ] Write brief %%things:${brief}%%`);
        await w.round();
        const where = t.todos.get(venue);
        expect(where?.projectId).toBe(old);
        expect(t.projects.get(old)?.trashed).toBe(false);
        t.trap = undefined;
        await w.round();
        expect(w.lines(PLAN)).not.toContain(RETIRED);
        expect(w.lines(PLAN).some(line => line.startsWith('- [ ] Book venue'))).toBe(true);
    });

    it('adopts a project Things made late, so a note never gets a second one', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief');
        await w.round();
        await w.round();
        w.write('Home/Errands.md', '# Errands', '- [ ] Buy milk');
        await w.round({ wait: async () => {} });
        await w.round({ wait: async () => {} });
        await w.round();
        await w.round();
        expect(liveProjects('Errands')).toHaveLength(1);
        expect(liveProjects('Errands')[0].notes).toBe('');
        expect([...w.notes.keys()].filter(path => path.startsWith('Home/Errands'))).toEqual(['Home/Errands.md']);
        expect(w.project('Home/Errands.md').id).toBe(liveProjects('Errands')[0].id);
    });

    it('leaves no second project or note behind when Things stops answering mid-swap', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief', '- [ ] Book venue');
        await w.round();
        await w.round();
        const venue = w.idOn(PLAN, 'Book venue');
        const brief = w.idOn(PLAN, 'Write brief');
        let moves = 0;
        t.trap = op => (op.kind === 'moveTodo' && ++moves > 1 ? new ThingsError('timeout', 'Things took too long') : undefined);
        w.write(PLAN, '# Plan', '## Next', `- [ ] Book venue %%things:${venue}%%`, `- [ ] Write brief %%things:${brief}%%`);
        await w.round();
        t.trap = undefined;
        await w.round();
        await w.round();
        expect(liveProjects('Plan')).toHaveLength(1);
        expect([...w.notes.keys()].filter(path => path.startsWith('Work/Plan'))).toEqual([PLAN]);
        expect(t.todos.get(venue)?.projectId).toBe(w.project(PLAN).id);
        expect(t.todos.get(brief)?.projectId).toBe(w.project(PLAN).id);
    });

    it('carries the old project\'s tags, When and deadline over in a swap', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief');
        await w.round();
        await w.round();
        const brief = w.idOn(PLAN, 'Write brief');
        t.tags.add('Q4');
        const old = t.projects.get(w.project(PLAN).id);
        if (!old) throw new Error('missing');
        Object.assign(old, { tags: ['Q4'], when: '2026-12-01', deadline: '2026-12-15' });
        w.write(PLAN, '# Plan', '## Next', `- [ ] Write brief %%things:${brief}%%`);
        await w.round();
        expect(t.projects.get(w.project(PLAN).id)).toMatchObject({ tags: ['Q4'], when: '2026-12-01', deadline: '2026-12-15' });
    });

    it('carries the old project\'s notes over in a swap', async () => {
        w.write(PLAN, '# Plan', '- [ ] Write brief');
        await w.round();
        await w.round();
        const brief = w.idOn(PLAN, 'Write brief');
        const old = t.projects.get(w.project(PLAN).id);
        if (!old) throw new Error('missing');
        old.notes = 'Keep the receipts';
        w.write(PLAN, '# Plan', '## Next', `- [ ] Write brief %%things:${brief}%%`);
        await w.round();
        expect(t.projects.get(w.project(PLAN).id)?.notes).toBe('Keep the receipts');
    });
});

describe.each(CONFIGS)('runThingsRound keeps Things titles and tags whole: $name', config => {
    it('connects without rewriting a to-do\'s title or tags in Things', async () => {
        const w = new World(config);
        const t = w.things;
        for (const tag of ['@home', 'follow-up', 'Q&A', '2026']) t.tags.add(tag);
        const title = 'Email #design team about [[Q4]] 50% & more by 2026-11-30';
        const id = t.addTodo({ title, inbox: true, tags: ['@home', 'follow-up', 'Q&A', '2026'] });
        w.write(PLAN, '# Plan', '- [ ] Write brief');

        await w.round();
        await w.settled();
        expect(t.todos.get(id)?.fields.title).toBe(title);
        expect(t.todos.get(id)?.fields.tags).toEqual(['2026', '@home', 'Q&A', 'follow-up']);
        expect(w.lines('Things Inbox.md').some(line => line.includes('#home') && line.includes('#follow-up') && line.includes('#QA'))).toBe(true);
    });
});
