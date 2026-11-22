/**
 * One round of Things sync, carried out: read Things, plan, make the Things
 * changes, write the notes, and hand back the state the next round starts
 * from. Everything it touches is passed in, so it runs against `FakeThings`
 * and notes in memory in tests.
 *
 * - A read that fails stops the round before anything is written, and the
 *   state stays as it was.
 * - On first connect the round joins by name first (join.ts), so what joins
 *   reaches the state, and `joined` is set once a round has written every
 *   joined line's ID.
 * - Things changes go in the planner's order. One that fails is counted and
 *   left for the next round, with anything that needed it (a to-do in a
 *   project that wasn't made). When Things stops answering, permission is
 *   gone, or links are turned away, the round stops there: no more Things
 *   changes, and the only note writes are the IDs of to-dos already made,
 *   so no to-do is left without its line.
 * - A project is made by a `json` link with a marker in its notes, found by
 *   that marker (looking a few times, since Things acts on a link after
 *   `open` returns), and its notes are cleared again. Never found means
 *   Things URLs are off.
 * - The heading swap (swap.ts) makes the new project, moves every to-do
 *   across under its heading, and puts the old project in the Trash.
 * - The notes: new notes first, then renames, then each note's steps in one
 *   write, then tasks carried to another note. Paths in the plan are the
 *   notes' paths as read, followed through this round's renames.
 * - The state takes only what went through. For each to-do, a field both
 *   sides now hold is recorded, and a field they still differ on keeps the
 *   value last written, so the next round's merge sees which side changed
 *   and finishes it. Where a to-do is follows its move when the move went
 *   through, and stays as recorded when it didn't.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import { SETTLE_MS } from '../calendar/plan';
import type { NoteInfo } from '../calendar/plan';
import { ThingsError } from './bridge';
import type { BridgeOp, ThingsBridge, ThingsErrorKind } from './bridge';
import { joinFirstConnect, withDeadline } from './join';
import { jsonCreateLink, updateLink, whenParam } from './links';
import { areaName } from './mapping';
import { differences } from './merge';
import type { Capabilities, ChecklistItem, Place, SyncedTodo, ThingsProject, ThingsSnapshot, ThingsState, ThingsTodo, TodoFields, VaultSnapshot, VaultTask } from './model';
import { newNoteContent } from './note-edits';
import type { ThingsFormats } from './note-edits';
import { planThingsSync } from './plan';
import type { ThingsStep, VaultStep } from './plan';
import { swapProject } from './swap';

export interface ThingsRoundDeps {
    vault: VaultSnapshot;
    state: ThingsState;
    bridge: ThingsBridge;
    token: string;
    now: number;
    fmt: ThingsFormats;
    /** Whether a note exists and when it last changed: the snapshot leaves out notes with no tasks. */
    notes: NoteInfo;
    /** The user confirmed what vanished from the vault: this round skips the vault side of the guard. */
    acceptMissing?: boolean;
    /** Writes the steps into one note; resolves to how many found no line to write to. */
    editNote(path: string, steps: VaultStep[]): Promise<number>;
    createNote(path: string, content: string): Promise<void>;
    renameNote(from: string, to: string): Promise<void>;
    /** Carries a task's line, with its notes and subtasks, to another note. False when the line wasn't found. */
    moveTaskBlock(from: VaultTask, to: Place): Promise<boolean>;
    /** A text no project's notes already hold, to find a project made by a link. */
    newMarker(): string;
    /** Waits between looks for a project a link made. Tests pass one that acts on the fake's links. */
    wait?: (ms: number) => Promise<void>;
}

export interface ThingsRoundResult {
    toThings: number;
    toVault: number;
    missed: number;
    stopped?: { side: 'things' | 'vault'; missing: number };
    /**
     * Things changes that didn't go through, each tried again next round, and
     * what Things said. `halted`: Things stopped answering, wouldn't let
     * Obsidian in, or turned links away, so the round stopped there.
     */
    failed?: { steps: number; kind: ThingsErrorKind; message: string; halted: boolean };
}

/** How long to wait before each further look for a project a link made. */
const FIND_WAITS_MS = [250, 500, 1000, 2000, 2000];
/** What Things said that means it won't take anything more this round. */
const HALTS: ReadonlySet<ThingsErrorKind> = new Set<ThingsErrorKind>(['permission', 'not-installed', 'urls-off', 'timeout']);

type StepOf<K extends ThingsStep['kind']> = Extract<ThingsStep, { kind: K }>;
type VaultStepOf<K extends VaultStep['kind']> = Extract<VaultStep, { kind: K }>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const at = (path: string, heading?: string): Place => heading === undefined ? { path } : { path, heading };
const samePlace = (a: Place, b: Place): boolean => a.path === b.path && a.heading === b.heading;
const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const pause = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));
/** A task line as the steps name it: its note, line and text as read. */
const lineKey = (task: VaultTask): string => `${task.path}\n${task.line}\n${task.text}`;

function put(fields: Partial<TodoFields>, key: keyof TodoFields, value: unknown): void {
    (fields as Record<string, unknown>)[key] = value;
}

/** Fields with a change laid over them. A key present with an `undefined` value clears that field. */
function withChange(fields: TodoFields, change: Partial<TodoFields>): TodoFields {
    const out = clone(fields);
    for (const key of Object.keys(change) as Array<keyof TodoFields>) {
        if (change[key] === undefined) delete (out as Partial<TodoFields>)[key];
        else put(out, key, clone(change[key]));
    }
    return out;
}

/** The checklist's titles for an `update` link, which leaves every item open. */
const checklistTitles = (items: readonly ChecklistItem[]): string => items.map(item => item.title).join('\n');

/** A `json` update setting a to-do's checklist with its ticks, which the `update` link can't. */
function checklistTicksLink(id: string, items: readonly ChecklistItem[], token: string): string {
    const list = items.map(item => ({ type: 'checklist-item', attributes: { title: item.title, completed: item.done } }));
    return jsonCreateLink([{ type: 'to-do', operation: 'update', id, attributes: { 'checklist-items': list } }], token);
}

/** The IDs the read should find even when done or trashed since: open to-dos the state or a line knows, and the synced projects. */
function knownIds(vault: VaultSnapshot, state: ThingsState): string[] {
    const ids = new Set<string>();
    for (const todo of state.todos) if (todo.fields.status === 'open') ids.add(todo.id);
    for (const note of vault.notes) for (const task of note.tasks) if (task.id !== undefined && task.fields.status === 'open') ids.add(task.id);
    for (const project of state.projects) ids.add(project.id);
    return [...ids];
}

export async function runThingsRound(deps: ThingsRoundDeps): Promise<{ result: ThingsRoundResult; state: ThingsState }> {
    const read = await deps.bridge.read(knownIds(deps.vault, deps.state));
    const things: ThingsSnapshot = { ...read, todos: read.todos.map(withDeadline) };
    const base = deps.state.joined ? deps.state : joinFirstConnect(deps.vault, things, deps.state, path => deps.notes.exists(path));
    const plan = planThingsSync(deps.vault, things, base, { now: deps.now, settleMs: SETTLE_MS, notes: deps.notes, acceptMissing: deps.acceptMissing });
    if (!plan.ok) return { result: { toThings: 0, toVault: 0, missed: 0, stopped: { side: plan.side, missing: plan.missing } }, state: deps.state };
    const round = new Round(deps, things, base, plan.things, plan.vault);
    await round.carryOutThings();
    await round.writeNotes();
    return round.finish();
}

/** One round's Things changes and note writes, and what each left behind. */
export class Round {
    readonly caps: Capabilities;
    /** The state as it ends the round. Areas and projects change as steps go through; to-dos are worked out at the end. */
    readonly next: ThingsState;
    readonly todoById: Map<string, ThingsTodo>;
    private readonly projectById: Map<string, ThingsProject>;
    private readonly liveAreas: Set<string>;
    private readonly firstConnect: boolean;
    /** Each project's headings as Things has them, as far as the plugin can tell. */
    readonly headingsIn = new Map<string, string[]>();
    /** Each project's title and area as Things has them now. */
    readonly projectNow = new Map<string, { title: string; areaId?: string }>();
    /** Projects made this round, by a new note's project or a swap. */
    readonly newProjects = new Set<string>();
    /** A heading Things renamed, by note: the planner's `vaultSide` names. */
    private readonly headingRenames = new Map<string, Map<string, string>>();

    // What went through in Things.
    private toThings = 0;
    private failedSteps = 0;
    private problem?: { kind: ThingsErrorKind; message: string };
    private halted = false;
    /** Fields Things took this round, by to-do. */
    private readonly sent = new Map<string, Partial<TodoFields>>();
    /** Where a to-do sits now after a move or swap that went through, as a vault place. */
    readonly placed = new Map<string, Place>();
    /** To-dos whose move didn't go through. */
    private readonly unplaced = new Set<string>();
    /** To-dos made this round, as the state records them. */
    private readonly made = new Map<string, SyncedTodo>();
    /** The `link` step for each to-do made, by note. */
    private readonly links = new Map<string, VaultStep[]>();
    private readonly trashed = new Set<string>();
    /** Projects holding a to-do that didn't move out: they stay out of the Trash. */
    private readonly holding = new Set<string>();

    // What went in the notes.
    private readonly renames = new Map<string, string>();
    /** Per note path: every step written, some missed, or nothing written. */
    private readonly written = new Map<string, 'all' | 'some' | 'none'>();
    private readonly carried = new Set<VaultStep>();
    private readonly added: SyncedTodo[] = [];
    private missed = 0;
    private toVault = 0;

    constructor(readonly deps: ThingsRoundDeps, things: ThingsSnapshot, readonly base: ThingsState, private readonly thingsSteps: ThingsStep[], private readonly vaultSteps: VaultStep[]) {
        this.caps = things.capabilities;
        this.next = clone(base);
        this.firstConnect = !base.joined;
        this.todoById = new Map(things.todos.map(todo => [todo.id, todo]));
        this.projectById = new Map(things.projects.map(project => [project.id, project]));
        this.liveAreas = new Set(things.areas.map(area => area.id));
        for (const project of things.projects) {
            this.projectNow.set(project.id, { title: project.title, ...(project.areaId === undefined ? {} : { areaId: project.areaId }) });
            if (this.caps.headings && project.headings) this.headingsIn.set(project.id, [...project.headings]);
        }
        for (const sp of base.projects) if (!this.headingsIn.has(sp.id)) this.headingsIn.set(sp.id, [...sp.headings]);
        for (const step of vaultSteps) {
            if (step.kind !== 'headings' || step.from.length !== step.to.length) continue;
            const differ = step.from.map((_, i) => i).filter(i => step.from[i] !== step.to[i]);
            if (differ.length === 1 && !step.from.includes(step.to[differ[0]])) this.headingRenames.set(step.path, new Map([[step.from[differ[0]], step.to[differ[0]]]]));
        }
    }

    // ── Talking to Things ────────────────────────────────────────────────

    run(op: BridgeOp): Promise<string | null> {
        return this.deps.bridge.run(op);
    }

    open(link: string): Promise<void> {
        return this.deps.bridge.open(link);
    }

    /** Whether Things said it won't take anything more this round. */
    halts(error: unknown): boolean {
        return error instanceof ThingsError && HALTS.has(error.kind);
    }

    /** A failed change: counted, and the round stops when Things won't take any more. */
    fail(error: unknown): void {
        this.failedSteps++;
        const kind = error instanceof ThingsError ? error.kind : 'other';
        const message = error instanceof Error ? error.message : String(error);
        if (HALTS.has(kind)) {
            if (!this.halted) this.problem = { kind, message };
            this.halted = true;
        } else {
            this.problem ??= { kind, message };
        }
    }

    async carryOutThings(): Promise<void> {
        const counted: ReadonlyArray<ThingsStep['kind']> = this.firstConnect ? ['createTodo'] : ['createTodo', 'updateTodo', 'moveTodo', 'trashTodo'];
        for (const step of this.thingsSteps) {
            let done = false;
            if (this.halted) {
                this.failedSteps++;
            } else {
                try {
                    done = await this.carryOut(step);
                    // Not done without an error: something it needed didn't go through.
                    if (!done) this.failedSteps++;
                } catch (error) {
                    this.fail(error);
                }
            }
            if (done && counted.includes(step.kind)) this.toThings++;
            if (!done) this.notMoved(step);
        }
    }

    private async carryOut(step: ThingsStep): Promise<boolean> {
        switch (step.kind) {
            case 'createArea': return this.createArea(step.folder);
            case 'renameArea':
                await this.run({ kind: 'renameArea', id: step.id, name: areaName(step.folder) });
                return true;
            case 'createProject': return this.createProject(step);
            case 'updateProject': return this.updateProject(step);
            case 'swapProject': return swapProject(this, step);
            case 'createTodo': return this.createTodo(step.task);
            case 'updateTodo': return this.updateTodo(step.id, step.fields);
            case 'moveTodo': return this.moveTodo(step.id, step.to);
            case 'trashTodo':
                await this.run({ kind: 'deleteTodo', id: step.id });
                this.trashed.add(step.id);
                return true;
            case 'trashProject':
                if (this.holding.has(step.id)) return false;
                await this.run({ kind: 'deleteProject', id: step.id });
                this.next.projects = this.next.projects.filter(sp => sp.id !== step.id);
                return true;
            case 'deleteArea':
                await this.run({ kind: 'deleteArea', id: step.id });
                this.next.areas = this.next.areas.filter(area => area.id !== step.id);
                delete this.next.looseNotes[step.id];
                this.liveAreas.delete(step.id);
                return true;
        }
    }

    /** A move that didn't go through leaves the to-do where the state has it, and its project out of the Trash. */
    private notMoved(step: ThingsStep): void {
        const ids = step.kind === 'moveTodo' ? [step.id] : step.kind === 'swapProject' ? step.order.map(entry => entry.id) : [];
        for (const id of ids) if (!this.placed.has(id)) this.unplaced.add(id);
        const from = step.kind === 'moveTodo' ? this.todoById.get(step.id)?.projectId : undefined;
        if (from !== undefined) this.holding.add(from);
    }

    /** The live area standing for a folder. */
    private areaFor(folder: string): string | undefined {
        return this.next.areas.find(area => area.folder === folder && this.liveAreas.has(area.id))?.id;
    }

    private async createArea(folder: string): Promise<boolean> {
        const id = await this.run({ kind: 'makeArea', name: areaName(folder) });
        if (!id) throw new ThingsError('other', `Things made no area for ${folder}`);
        this.next.areas = [...this.next.areas.filter(area => area.folder !== folder), { id, folder }];
        this.liveAreas.add(id);
        return true;
    }

    /** Makes a project with these headings through a `json` link and finds it by a marker in its notes. */
    async makeProject(title: string, headings: readonly string[], areaId?: string): Promise<string> {
        const marker = this.deps.newMarker();
        const attributes: Record<string, unknown> = { title, notes: marker, items: headings.map(heading => ({ type: 'heading', attributes: { title: heading } })) };
        if (areaId !== undefined) attributes['area-id'] = areaId;
        await this.open(jsonCreateLink([{ type: 'project', attributes }]));
        const id = await this.findProject(marker);
        if (!id) throw new ThingsError('urls-off', 'Things never made the project its link asked for, so Things URLs look turned off');
        try {
            await this.run({ kind: 'setProject', id, notes: '' });
        } catch (error) {
            // The marker stays in the project's notes; nothing else depends on it.
            this.fail(error);
        }
        return id;
    }

    private async findProject(marker: string): Promise<string | null> {
        const wait = this.deps.wait ?? pause;
        for (let tries = 0; ; tries++) {
            const id = await this.run({ kind: 'findProjectByNotes', marker });
            if (id) return id;
            if (tries === FIND_WAITS_MS.length) return null;
            await wait(FIND_WAITS_MS[tries]);
        }
    }

    private async createProject(step: StepOf<'createProject'>): Promise<boolean> {
        const areaId = step.folder ? this.areaFor(step.folder) : undefined;
        if (step.folder && areaId === undefined) return false;
        const id = await this.makeProject(step.title, step.headings, areaId);
        const area = areaId === undefined ? {} : { areaId };
        this.next.projects = [...this.next.projects.filter(sp => sp.path !== step.path), { id, path: step.path, title: step.title, headings: [...step.headings], ...area }];
        this.headingsIn.set(id, [...step.headings]);
        this.projectNow.set(id, { title: step.title, ...area });
        this.newProjects.add(id);
        return true;
    }

    private async updateProject(step: StepOf<'updateProject'>): Promise<boolean> {
        const op: Extract<BridgeOp, { kind: 'setProject' }> = { kind: 'setProject', id: step.id };
        let areaId: string | undefined;
        if (step.title !== undefined) op.name = step.title;
        if (step.folder !== undefined) {
            areaId = step.folder ? this.areaFor(step.folder) : undefined;
            if (step.folder && areaId === undefined) return false;
            op.areaId = areaId ?? '';
        }
        await this.run(op);
        const sp = this.next.projects.find(p => p.id === step.id);
        const now = this.projectNow.get(step.id) ?? { title: sp?.title ?? '' };
        if (step.title !== undefined) {
            now.title = step.title;
            if (sp) sp.title = step.title;
        }
        if (step.folder !== undefined) {
            if (areaId === undefined) delete now.areaId;
            else now.areaId = areaId;
            if (sp) {
                if (areaId === undefined) delete sp.areaId;
                else sp.areaId = areaId;
            }
        }
        this.projectNow.set(step.id, now);
        return true;
    }

    /** The list a note's to-dos go in: the Inbox, an area, or the note's project. Null when the note has no project. */
    private listFor(path: string): { projectId?: string; areaId?: string } | null {
        if (path === this.next.inboxNote) return {};
        const area = Object.keys(this.next.looseNotes).find(id => this.next.looseNotes[id] === path);
        if (area !== undefined) return { areaId: area };
        const sp = this.next.projects.find(p => p.path === path);
        return sp ? { projectId: sp.id } : null;
    }

    /** Where a to-do sent to this note and heading sits: under the heading only when its project has it. */
    private placeIn(path: string, heading: string | undefined): Place {
        const projectId = this.listFor(path)?.projectId;
        if (heading === undefined || projectId === undefined) return at(path);
        return this.headingsIn.get(projectId)?.includes(heading) ? at(path, heading) : at(path);
    }

    private async createTodo(task: VaultTask): Promise<boolean> {
        const list = this.listFor(task.path);
        if (!list) return false;
        const f = task.fields;
        const id = await this.run({ kind: 'makeTodo', name: f.title, notes: f.notes, tags: [...f.tags], ...list });
        if (!id) throw new ThingsError('other', `Things made no to-do for "${f.title}"`);
        // It exists now, so its line takes the ID whatever else goes wrong.
        const record: SyncedTodo = { id, place: at(task.path), fields: { title: f.title, notes: f.notes, checklist: [], tags: [...f.tags], status: 'open', someday: false } };
        this.made.set(id, record);
        this.links.set(task.path, [...(this.links.get(task.path) ?? []), { kind: 'link', task, id }]);
        try {
            const params: Record<string, string> = {};
            if (list.projectId !== undefined && task.heading !== undefined) {
                params['list-id'] = list.projectId;
                params.heading = task.heading;
            }
            if (f.checklist.length) params['checklist-items'] = checklistTitles(f.checklist);
            if (f.when !== undefined || f.someday) params.when = whenParam(f);
            if (Object.keys(params).length) await this.open(updateLink(id, params, this.deps.token));
            record.place = this.placeIn(task.path, task.heading);
            record.fields = { ...clone(f), checklist: f.checklist.map(item => ({ title: item.title, done: false })) };
            if (f.checklist.some(item => item.done)) await this.open(checklistTicksLink(id, f.checklist, this.deps.token));
            record.fields = clone(f);
        } catch (error) {
            this.fail(error);
        }
        return true;
    }

    /** The When, reminder and Someday a to-do ends with: the change where it has them, else Things' own. */
    private whenOf(id: string, change: Partial<TodoFields>): Pick<TodoFields, 'when' | 'reminder' | 'someday'> {
        const current = this.todoById.get(id)?.fields;
        const written = this.base.todos.find(todo => todo.id === id)?.fields;
        const pick = <K extends 'when' | 'reminder' | 'someday'>(key: K): TodoFields[K] | undefined => {
            if (key in change) return change[key];
            // A reminder this Things can't show is taken as the one last written.
            return key === 'reminder' && !this.caps.reminder ? written?.[key] : current?.[key];
        };
        return { when: pick('when'), reminder: pick('reminder'), someday: pick('someday') ?? false };
    }

    private async updateTodo(id: string, change: Partial<TodoFields>): Promise<boolean> {
        const sent = this.sent.get(id) ?? {};
        this.sent.set(id, sent);
        const take = (keys: ReadonlyArray<keyof TodoFields>) => { for (const key of keys) if (key in change) put(sent, key, change[key]); };

        const script: Extract<BridgeOp, { kind: 'setTodo' }> = { kind: 'setTodo', id };
        if ('title' in change) script.name = change.title ?? '';
        if ('notes' in change) script.notes = change.notes ?? '';
        if ('tags' in change) script.tags = [...(change.tags ?? [])];
        if (change.status !== undefined) script.status = change.status;
        if (Object.keys(script).length > 2) {
            await this.run(script);
            take(['title', 'notes', 'tags', 'status']);
        }

        const params: Record<string, string> = {};
        const dated = 'when' in change || 'reminder' in change || 'someday' in change;
        if (dated) params.when = whenParam(this.whenOf(id, change));
        const checklist = 'checklist' in change ? change.checklist ?? [] : undefined;
        if (checklist) params['checklist-items'] = checklistTitles(checklist);
        if (Object.keys(params).length) {
            await this.open(updateLink(id, params, this.deps.token));
            take(['when', 'reminder', 'someday']);
            if (checklist && !checklist.some(item => item.done)) take(['checklist']);
        }
        if (checklist?.some(item => item.done)) {
            await this.open(checklistTicksLink(id, checklist, this.deps.token));
            take(['checklist']);
        }
        return true;
    }

    private async moveTodo(id: string, to: Place): Promise<boolean> {
        const list = this.listFor(to.path);
        if (!list) return false;
        await this.run(list.projectId !== undefined ? { kind: 'moveTodo', id, projectId: list.projectId } : list.areaId !== undefined ? { kind: 'moveTodo', id, areaId: list.areaId } : { kind: 'moveTodo', id, inbox: true });
        this.placed.set(id, at(to.path));
        if (list.projectId !== undefined && to.heading !== undefined) {
            await this.open(updateLink(id, { 'list-id': list.projectId, heading: to.heading }, this.deps.token));
            this.placed.set(id, this.placeIn(to.path, to.heading));
        }
        return true;
    }

    // ── Writing the notes ────────────────────────────────────────────────

    private renamed(path: string): string {
        return this.renames.get(path) ?? path;
    }

    async writeNotes(): Promise<void> {
        // Stopped partway: only the IDs of to-dos already made, so each has its line.
        if (this.halted) {
            await this.edit(this.links);
            return;
        }
        for (const step of this.vaultSteps) {
            if (step.kind === 'createNote') await this.createNote(step);
            else if (step.kind === 'renameNote') await this.renameNote(step);
        }
        const byNote = new Map<string, VaultStep[]>();
        const across: Array<VaultStepOf<'move'>> = [];
        const add = (path: string, steps: VaultStep[]) => byNote.set(path, [...(byNote.get(path) ?? []), ...steps]);
        for (const step of this.vaultSteps) {
            if (step.kind === 'createNote' || step.kind === 'renameNote') continue;
            if (step.kind === 'move' && step.to.path !== step.task.path) across.push(step);
            else add(step.kind === 'add' ? step.to.path : step.kind === 'headings' ? step.path : step.task.path, [step]);
        }
        this.links.forEach((steps, path) => add(path, steps));
        await this.edit(byNote);

        // A task whose line this round rewrote has text the move can't find: the next round carries it.
        const rewritten = new Set<string>();
        byNote.forEach(steps => steps.forEach(step => { if ('task' in step && step.kind !== 'move') rewritten.add(lineKey(step.task)); }));
        for (const step of across) {
            let moved = false;
            if (!rewritten.has(lineKey(step.task))) {
                try {
                    moved = await this.deps.moveTaskBlock({ ...step.task, path: this.renamed(step.task.path) }, { ...step.to, path: this.renamed(step.to.path) });
                } catch {
                    moved = false;
                }
            }
            if (moved) this.carried.add(step);
            else this.missed++;
        }
    }

    private async edit(byNote: Map<string, VaultStep[]>): Promise<void> {
        for (const [path, steps] of byNote) {
            let missed: number;
            try {
                missed = await this.deps.editNote(this.renamed(path), steps);
            } catch {
                this.written.set(path, 'none');
                this.missed += steps.length;
                continue;
            }
            this.written.set(path, missed === 0 ? 'all' : 'some');
            this.missed += missed;
        }
    }

    private async createNote(step: VaultStepOf<'createNote'>): Promise<void> {
        try {
            await this.deps.createNote(step.path, newNoteContent(step.title, step.headings, step.todos, this.deps.fmt));
        } catch {
            this.missed += Math.max(1, step.todos.length);
            return;
        }
        this.toVault += step.todos.length;
        if (step.areaId !== undefined && !this.next.areas.some(area => area.id === step.areaId)) this.next.areas.push({ id: step.areaId, folder: folderOf(step.path) });
        if (step.projectId !== undefined) {
            this.next.projects.push({ id: step.projectId, path: step.path, title: step.title, headings: [...step.headings], ...(step.areaId === undefined ? {} : { areaId: step.areaId }) });
            this.newProjects.add(step.projectId);
        } else if (step.areaId !== undefined) {
            this.next.looseNotes[step.areaId] = step.path;
        }
        for (const todo of step.todos) {
            const heading = todo.heading !== undefined && step.headings.includes(todo.heading) ? todo.heading : undefined;
            this.added.push({ id: todo.id, place: at(step.path, heading), fields: clone(todo.fields) });
        }
    }

    private async renameNote(step: VaultStepOf<'renameNote'>): Promise<void> {
        try {
            await this.deps.renameNote(step.from, step.to);
        } catch {
            this.missed++;
            return;
        }
        this.renames.set(step.from, step.to);
        // The note now goes by its project's title and area in Things.
        const sp = this.next.projects.find(p => p.path === step.from);
        const now = sp && this.projectNow.get(sp.id);
        if (sp && now) {
            sp.title = now.title;
            if (now.areaId === undefined) delete sp.areaId;
            else sp.areaId = now.areaId;
        }
        if (step.areaId !== undefined && !this.next.areas.some(area => area.id === step.areaId)) this.next.areas.push({ id: step.areaId, folder: folderOf(step.to) });
    }

    /** Whether a note step was written. Stopped partway, only the round's own `link` steps were. */
    private landed(step: VaultStep): boolean {
        if (step.kind === 'move' && step.to.path !== step.task.path) return this.carried.has(step);
        if (this.halted && step.kind !== 'link') return false;
        const path = step.kind === 'add' ? step.to.path : step.kind === 'headings' ? step.path : 'task' in step ? step.task.path : undefined;
        return path !== undefined && this.written.get(path) === 'all';
    }

    // ── The state the next round starts from ─────────────────────────────

    finish(): { result: ThingsRoundResult; state: ThingsState } {
        const next = this.next;
        if (!next.joined) next.joined = !this.halted && this.vaultSteps.every(step => step.kind !== 'adopt' || this.landed(step));
        next.todos = this.todos();
        // A project gone from Things leaves the state once its lines are retired, so a new task in its note can make a new one.
        next.projects = next.projects.filter(sp => {
            const project = this.projectById.get(sp.id);
            if (this.newProjects.has(sp.id) || (project && !project.trashed)) return true;
            return this.vaultSteps.some(step => step.kind === 'retire' && step.task.path === sp.path && !this.landed(step));
        });
        if (this.renames.size) {
            for (const sp of next.projects) sp.path = this.renamed(sp.path);
            for (const todo of next.todos) todo.place = { ...todo.place, path: this.renamed(todo.place.path) };
            for (const area of Object.keys(next.looseNotes)) next.looseNotes[area] = this.renamed(next.looseNotes[area]);
        }

        const counted: ReadonlyArray<VaultStep['kind']> = this.firstConnect ? ['add'] : ['update', 'move', 'add', 'retire'];
        const toVault = this.toVault + this.vaultSteps.filter(step => counted.includes(step.kind) && this.landed(step)).length;
        const result: ThingsRoundResult = { toThings: this.toThings, toVault, missed: this.missed };
        if (this.failedSteps > 0) result.failed = { steps: this.failedSteps, kind: this.problem?.kind ?? 'other', message: this.problem?.message ?? '', halted: this.halted };
        return { result, state: next };
    }

    /** Whether a to-do is gone from Things: trashed, or in a project that is. */
    private gone(todo: ThingsTodo): boolean {
        if (todo.trashed) return true;
        if (todo.projectId === undefined) return false;
        const project = this.projectById.get(todo.projectId);
        return !project || project.trashed;
    }

    private todos(): SyncedTodo[] {
        const out = new Map<string, SyncedTodo>();
        const seen = new Set<string>();
        const old = new Map(this.base.todos.map(todo => [todo.id, todo]));
        const stepsOn = new Map<string, VaultStep[]>();
        for (const step of this.vaultSteps) if ('task' in step) stepsOn.set(lineKey(step.task), [...(stepsOn.get(lineKey(step.task)) ?? []), step]);

        // Each line with an ID, the first by path and line, and each line joined by name.
        const lines = this.deps.vault.notes.flatMap(note => note.tasks).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
        const lineById = new Map<string, VaultTask>();
        for (const task of lines) if (task.id !== undefined && !lineById.has(task.id)) lineById.set(task.id, task);
        for (const step of this.vaultSteps) if (step.kind === 'adopt') lineById.set(step.id, step.task);
        for (const [id, task] of lineById) {
            seen.add(id);
            const was = old.get(id);
            const steps = stepsOn.get(lineKey(task)) ?? [];
            // A retired or unlinked line no longer carries the ID.
            if (steps.some(step => (step.kind === 'retire' || step.kind === 'unlink') && this.landed(step))) continue;
            const todo = this.todoById.get(id);
            if (!todo || this.gone(todo)) {
                if (was) out.set(id, was);
                continue;
            }
            out.set(id, { id, place: this.placeOf(id, task, todo, steps, was), fields: this.fieldsOf(id, task, todo, steps, was) });
        }

        const landedAdds = this.vaultSteps.filter((step): step is VaultStepOf<'add'> => step.kind === 'add' && this.landed(step));
        for (const record of [...this.made.values(), ...this.added, ...landedAdds.map(step => ({ id: step.todo.id, place: step.to, fields: clone(step.todo.fields) }))]) {
            seen.add(record.id);
            out.set(record.id, { ...record, place: this.placed.get(record.id) ?? record.place });
        }

        // To-dos no line carries now: kept while they live in Things (on their way to another note, or waiting to settle).
        for (const was of this.base.todos) {
            if (seen.has(was.id) || this.trashed.has(was.id)) continue;
            const todo = this.todoById.get(was.id);
            if (todo ? this.gone(todo) : was.fields.status === 'open') continue;
            out.set(was.id, { ...was, place: this.placed.get(was.id) ?? was.place });
        }
        // In the order the state had them, new ones after, so a quiet round leaves the state file as it was.
        const kept = this.base.todos.filter(todo => out.has(todo.id)).map(todo => todo.id);
        const order = [...kept, ...[...out.keys()].filter(id => !old.has(id))];
        return order.map(id => out.get(id) as SyncedTodo);
    }

    /** A place in the vault, with a heading Things renamed under its new name and no heading in a list note (the planner's `vaultSide`). */
    private vaultSide(path: string, heading?: string): Place {
        const list = path === this.base.inboxNote || Object.values(this.base.looseNotes).includes(path);
        if (list || heading === undefined) return at(path);
        return at(path, this.headingRenames.get(path)?.get(heading) ?? heading);
    }

    /** Where Things has a to-do, as a vault place (the planner's `thingsPlace`). */
    private thingsSide(todo: ThingsTodo, was?: Place): Place | undefined {
        if (todo.projectId !== undefined) {
            const sp = this.base.projects.find(p => p.id === todo.projectId);
            if (!sp) return undefined;
            return at(sp.path, this.caps.headings ? todo.heading : was?.path === sp.path ? was.heading : undefined);
        }
        if (todo.areaId !== undefined && !todo.inbox) {
            const path = this.base.looseNotes[todo.areaId];
            return path === undefined ? undefined : at(path);
        }
        return at(this.base.inboxNote);
    }

    /**
     * Where a synced to-do is: where a move that went through put it, else
     * where both sides agree, else as recorded. A line Things moved that
     * didn't move in the note stays as recorded even when a swap placed the
     * to-do, so the next round moves the line rather than the to-do back.
     */
    private placeOf(id: string, task: VaultTask, todo: ThingsTodo, steps: VaultStep[], was?: SyncedTodo): Place {
        const prior = was && this.vaultSide(was.place.path, was.place.heading);
        const there = this.thingsSide(todo, prior);
        const kept = was?.place ?? there ?? at(task.path, task.heading);
        const move = steps.find((step): step is VaultStepOf<'move'> => step.kind === 'move');
        if (move) return this.landed(move) ? move.to : kept;
        const placed = this.placed.get(id);
        if (placed) return placed;
        if (this.unplaced.has(id)) return kept;
        const here = this.vaultSide(task.path, task.heading);
        return there && samePlace(here, there) ? here : kept;
    }

    /** A synced to-do's fields: each one both sides now hold, and the one last written where they still differ. */
    private fieldsOf(id: string, task: VaultTask, todo: ThingsTodo, steps: VaultStep[], was?: SyncedTodo): TodoFields {
        const written = was?.fields ?? todo.fields;
        // A field this Things can't show counts as the one last written, as in the merge.
        const theirs = clone(todo.fields);
        if (!this.caps.checklist) theirs.checklist = clone(written.checklist);
        if (!this.caps.reminder) {
            if (written.reminder === undefined) delete theirs.reminder;
            else theirs.reminder = written.reminder;
        }
        const things = withChange(theirs, this.sent.get(id) ?? {});
        const update = steps.find((step): step is VaultStepOf<'update'> => step.kind === 'update');
        const vault = update && this.landed(update) ? withChange(task.fields, update.fields) : task.fields;
        const fields = clone(vault);
        for (const key of Object.keys(differences(vault, things)) as Array<keyof TodoFields>) {
            if (written[key] === undefined) delete (fields as Partial<TodoFields>)[key];
            else put(fields, key, clone(written[key]));
        }
        return fields;
    }
}
