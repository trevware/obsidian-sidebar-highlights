/**
 * The bridge to Things: the only way Things sync reaches the app. It reads
 * Things into a snapshot and carries out writes, through JXA scripts
 * (`jxa.ts`) and `things:///` links (`links.ts`). `ScriptBridge` runs them on
 * the Mac through a `Runner` (`bridge-runner.ts`); `FakeThings` is an
 * in-memory Things for tests, which applies the same ops and understands the
 * same links, so the round's tests and the link format can't drift apart.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import { CHANGED_DURING_READ, parseRead, readScript, writeScript } from './jxa';
import type { Capabilities, ChecklistItem, ThingsArea, ThingsSnapshot, ThingsTodo, TodoFields, TodoStatus } from './model';

/** One AppleScript-side change. Headings, checklists and reminders go through links instead. */
export type BridgeOp =
    | { kind: 'makeArea'; name: string } | { kind: 'renameArea'; id: string; name: string }
    /** Lands in the project, else the area, else the Inbox. */
    | { kind: 'makeTodo'; name: string; notes: string; tags: string[]; projectId?: string; areaId?: string }
    /** `when`: a date, `someday`, or null (or `anytime`) for no date. A date with a reminder needs the update link. */
    | { kind: 'setTodo'; id: string; name?: string; notes?: string; tags?: string[]; status?: TodoStatus; when?: string | null }
    | { kind: 'moveTodo'; id: string; projectId?: string; areaId?: string; inbox?: boolean }
    | { kind: 'deleteTodo'; id: string } | { kind: 'deleteProject'; id: string } | { kind: 'deleteArea'; id: string }
    /** An empty `areaId` takes the project out of its area. */
    | { kind: 'setProject'; id: string; name?: string; areaId?: string; notes?: string; status?: TodoStatus }
    | { kind: 'findProjectByNotes'; marker: string }
    /** A JSON array of every to-do ID in the project, done and cancelled too (the Logbook's), none trashed: what a heading swap moves. */
    | { kind: 'projectTodoIds'; id: string };

export interface ThingsBridge {
    /** `knownIds`: the to-do and project IDs the round still cares about, found even when done or trashed since. */
    read(knownIds: string[]): Promise<ThingsSnapshot>;
    /** The ID an op made or found (for `projectTodoIds`, its JSON array), else null. */
    run(op: BridgeOp): Promise<string | null>;
    /** A things:/// link, Things kept in the background. */
    open(link: string): Promise<void>;
    isRunning(): Promise<boolean>;
}

/** What runs scripts and links on the Mac. */
export interface Runner { jxa(script: string, timeoutMs: number): Promise<string>; open(url: string): Promise<void>; running(): Promise<boolean> }

/**
 * permission: macOS hasn't let Obsidian control Things; not-installed: no
 * Things on this Mac; urls-off: Things turned links away (raised by the round
 * when a link's change never shows, since `open` can't tell); timeout: Things
 * didn't answer in time; other: anything else, with what was said.
 */
export type ThingsErrorKind = 'permission' | 'not-installed' | 'urls-off' | 'timeout' | 'other';

export class ThingsError extends Error {
    constructor(readonly kind: ThingsErrorKind, message: string) {
        super(message);
        this.name = 'ThingsError';
    }
}

/** A failed osascript, open or pgrep run, from its error and what it printed to stderr. */
export function thingsErrorFrom(error: unknown, stderr = ''): ThingsError {
    if (error instanceof ThingsError) return error;
    const failure = (typeof error === 'object' && error !== null ? error : {}) as { message?: unknown; killed?: unknown; signal?: unknown };
    const message = typeof failure.message === 'string' ? failure.message : String(error);
    const said = (stderr.trim() || message).replace(/^execution error:\s*/, '');
    const all = `${stderr}\n${message}`;
    if (/-1743\b|not authori[sz]ed to send apple events/i.test(all)) return new ThingsError('permission', said);
    if (failure.killed === true || failure.signal === 'SIGTERM' || /-1712\b|timed out/i.test(all)) return new ThingsError('timeout', said);
    // Not -2700 alone: JXA reports every uncaught error in a script with it.
    if (/-10814\b|application can.t be found|no application knows how to open|unable to find application/i.test(all)) return new ThingsError('not-installed', said);
    return new ThingsError('other', said);
}

/** A read of a few hundred to-dos, with time to spare for a slow Mac. */
export const READ_TIMEOUT_MS = 60_000;
export const WRITE_TIMEOUT_MS = 20_000;

/** Things on this Mac, through osascript and links. */
export class ScriptBridge implements ThingsBridge {
    constructor(private readonly runner: Runner) {}

    /** Reads again once when Things changed during the read. */
    async read(knownIds: string[]): Promise<ThingsSnapshot> {
        const script = readScript(knownIds);
        const once = () => this.call(() => this.runner.jxa(script, READ_TIMEOUT_MS));
        const output = await once().catch((error: unknown) => {
            if (error instanceof ThingsError && error.message.includes(CHANGED_DURING_READ)) return once();
            throw error;
        });
        try {
            return parseRead(output);
        } catch (error) {
            throw new ThingsError('other', error instanceof Error ? error.message : String(error));
        }
    }

    async run(op: BridgeOp): Promise<string | null> {
        const output = (await this.call(() => this.runner.jxa(writeScript(op), WRITE_TIMEOUT_MS))).trim();
        return output === '' ? null : output;
    }

    open(link: string): Promise<void> {
        return this.call(() => this.runner.open(link));
    }

    isRunning(): Promise<boolean> {
        return this.runner.running();
    }

    private async call<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await work();
        } catch (error) {
            throw thingsErrorFrom(error);
        }
    }
}

// ---------------------------------------------------------------------------
// FakeThings

type FakeCall = 'read' | 'open' | 'running' | BridgeOp['kind'];
export type FakeTodo = Omit<ThingsTodo, 'logged'>;
export interface FakeProject { id: string; title: string; notes: string; areaId?: string; headings: string[]; status: TodoStatus; trashed: boolean; tags?: string[]; when?: string; deadline?: string }
type Attributes = Record<string, unknown>;

const TODO_ATTRIBUTES = ['title', 'notes', 'when', 'deadline', 'tags', 'checklist-items', 'list-id', 'heading', 'completed', 'canceled'];
/** Things takes tags, When and Deadline on a project too; the fake doesn't keep them. */
const PROJECT_ATTRIBUTES = ['title', 'notes', 'area-id', 'items', 'completed', 'canceled', 'tags', 'when', 'deadline'];
const UPDATE_PARAMS = ['id', 'auth-token', 'reveal', ...TODO_ATTRIBUTES];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ALL_CAPABILITIES: Capabilities = { headings: true, checklist: true, reminder: true, repeating: false, reorder: false };
const sortedTags = (names: string[]): string[] => [...new Set(names.map(name => name.trim()).filter(name => name !== ''))].sort();
const missing = (what: string): ThingsError => new ThingsError('other', `Can't get ${what}. (-1728)`);
const flag = (attributes: Attributes, key: string): boolean => attributes[key] === true || attributes[key] === 'true';
/** A link or json value as text: absent is empty. */
const textOf = (value: unknown): string => typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);

/** `canceled` wins over `completed`; either set false reopens. */
function statusFrom(attributes: Attributes, current: TodoStatus): TodoStatus {
    if (flag(attributes, 'canceled')) return 'canceled';
    if ('completed' in attributes) return flag(attributes, 'completed') ? 'completed' : 'open';
    return 'canceled' in attributes ? 'open' : current;
}

/** A `when` value, as links send it. A date alone takes any reminder off. */
function setWhen(fields: TodoFields, value: string): void {
    delete fields.when;
    delete fields.reminder;
    fields.someday = false;
    if (value === '' || value === 'anytime') return;
    if (value === 'someday') { fields.someday = true; return; }
    const match = /^(\d{4}-\d{2}-\d{2})(?:@(\d{1,2}):(\d{2}))?$/.exec(value);
    if (!match) throw new Error(`FakeThings: can't read when=${value}`);
    fields.when = match[1];
    if (match[2] !== undefined) fields.reminder = `${`0${match[2]}`.slice(-2)}:${match[3]}`;
}

/** Checklist items: newline-separated titles from an update link, or checklist-item objects from json. */
function checklistFrom(value: unknown): ChecklistItem[] {
    if (!Array.isArray(value)) return String(value).split('\n').filter(title => title !== '').map(title => ({ title, done: false }));
    return value.map(item => {
        const attributes = ((item as Attributes).attributes ?? {}) as Attributes;
        return { title: String(attributes.title), done: attributes.completed === true };
    });
}

/**
 * An in-memory Things for the round's tests: areas, projects with headings
 * (set only at creation, as in Things), to-dos with their fields and heading,
 * the Inbox, the Trash and the Logbook (done to-dos). Reads report done and
 * trashed to-dos only when asked for by ID, as the real read does. Links
 * behave as Things' docs say: a missing heading or tag is skipped, and a link
 * with the wrong token, or any link while URLs are off, is refused and
 * recorded. Anything Things has no attribute for throws, so a builder typo
 * fails a test instead of passing silently. `fail` makes chosen calls throw.
 * With `deferLinks`, links wait in `pending` until `settleLinks()`, as real
 * Things acts on a link after `open` returns. `capabilities` sets what reads
 * report, and a read leaves out what they hide, as the real read does.
 */
export class FakeThings implements ThingsBridge {
    readonly areas = new Map<string, ThingsArea>();
    readonly projects = new Map<string, FakeProject>();
    readonly todos = new Map<string, FakeTodo>();
    /** Tags Things has: AppleScript makes missing ones, links skip them. */
    readonly tags = new Set<string>();
    /** The ops Things carried out, in order. */
    readonly ops: BridgeOp[] = [];
    readonly links: string[] = [];
    /** Links Things turned away: URLs off, the wrong token, or an item it can't find. */
    readonly refused: string[] = [];
    running = true;
    urlsEnabled = true;
    /** Holds links in `pending` until `settleLinks()`. */
    deferLinks = false;
    readonly pending: string[] = [];
    capabilities: Capabilities = { ...ALL_CAPABILITIES };
    private made = 0;
    private failures: Array<{ on: FakeCall; error: Error; once: boolean }> = [];

    constructor(readonly token = 'fake-token') {}

    /** Makes every call of this kind throw until `heal()`, or only the next one with `once`. */
    fail(on: FakeCall, error: Error = new ThingsError('other', `Things failed: ${on}`), once = false): void {
        this.failures.push({ on, error, once });
    }

    heal(): void {
        this.failures = [];
    }

    addArea(title: string): string {
        const id = this.newId('Area');
        this.areas.set(id, { id, title });
        return id;
    }

    addProject(project: Partial<Omit<FakeProject, 'id'>> & { title: string }): string {
        const id = this.newId('Proj');
        this.projects.set(id, { notes: '', headings: [], status: 'open', trashed: false, ...project, id });
        return id;
    }

    /** A to-do with no project or area sits in the Inbox unless `inbox` says otherwise. */
    addTodo(todo: Partial<Omit<FakeTodo, 'id' | 'fields'>> & Partial<TodoFields> & { title: string }): string {
        const id = this.newId('Todo');
        const { title, notes = '', checklist = [], tags = [], status = 'open', when, reminder, someday = false, ...place } = todo;
        const fields: TodoFields = { title, notes, checklist, tags: sortedTags(tags), status, someday };
        if (when !== undefined) fields.when = when;
        if (reminder !== undefined) fields.reminder = reminder;
        fields.tags.forEach(tag => this.tags.add(tag));
        this.todos.set(id, { inbox: !place.projectId && !place.areaId, trashed: false, repeating: false, ...clone(place), id, fields });
        return id;
    }

    async read(knownIds: string[]): Promise<ThingsSnapshot> {
        this.check('read');
        const known = new Set(knownIds);
        const listed = (todo: FakeTodo) => !todo.trashed && todo.fields.status === 'open' && this.projects.get(todo.projectId ?? '')?.trashed !== true;
        const caps = this.capabilities;
        const todo = (t: FakeTodo): ThingsTodo => {
            const fields = { ...t.fields, checklist: caps.checklist ? t.fields.checklist : [], reminder: caps.reminder ? t.fields.reminder : undefined };
            return { ...t, heading: caps.headings ? t.heading : undefined, fields, logged: t.fields.status !== 'open' };
        };
        return clone({
            areas: [...this.areas.values()],
            projects: [...this.projects.values()].map(p => ({ id: p.id, title: p.title, areaId: p.areaId, headings: caps.headings ? p.headings : undefined, status: p.status, trashed: p.trashed, notes: p.notes, ...(p.tags?.length ? { tags: [...p.tags] } : {}), ...(p.when ? { when: p.when } : {}), ...(p.deadline ? { deadline: p.deadline } : {}) })),
            todos: [...this.todos.values()].filter(t => listed(t) || known.has(t.id)).map(todo),
            capabilities: caps
        });
    }

    async run(op: BridgeOp): Promise<string | null> {
        writeScript(op);
        this.check(op.kind);
        const result = this.apply(op);
        this.ops.push(clone(op));
        return result;
    }

    async open(link: string): Promise<void> {
        this.check('open');
        this.links.push(link);
        if (this.deferLinks) this.pending.push(link);
        else this.carryOut(link);
    }

    /** Carries out the links held while `deferLinks` is on, in order. */
    settleLinks(): void {
        for (const link of this.pending.splice(0)) this.carryOut(link);
    }

    private carryOut(link: string): void {
        const url = new URL(link);
        const command = url.pathname.replace(/^\/+/, '');
        if (url.protocol !== 'things:' || (command !== 'json' && command !== 'update')) throw new Error(`FakeThings: Things has no command ${link}`);
        if (!this.urlsEnabled) { this.refused.push(link); return; }
        if (command === 'update') { this.update(link, url.searchParams); return; }
        const items = JSON.parse(url.searchParams.get('data') ?? '[]') as Attributes[];
        if (items.some(item => item.operation === 'update') && url.searchParams.get('auth-token') !== this.token) { this.refused.push(link); return; }
        for (const item of items) this.jsonItem(item, link);
    }

    async isRunning(): Promise<boolean> {
        this.check('running');
        return this.running;
    }

    private check(on: FakeCall): void {
        const at = this.failures.findIndex(failure => failure.on === on);
        if (at === -1) return;
        const { error, once } = this.failures[at];
        if (once) this.failures.splice(at, 1);
        throw error;
    }

    private newId(kind: string): string {
        this.made++;
        return `Fake${kind}${`00000${this.made}`.slice(-6)}`;
    }

    private todo(id: string): FakeTodo {
        const todo = this.todos.get(id);
        if (!todo) throw missing(`to do id "${id}"`);
        return todo;
    }

    private project(id: string): FakeProject {
        const project = this.projects.get(id);
        if (!project) throw missing(`project id "${id}"`);
        return project;
    }

    private area(id: string): ThingsArea {
        const area = this.areas.get(id);
        if (!area) throw missing(`area id "${id}"`);
        return area;
    }

    /** Into a project or an area, at no heading. An ID Things doesn't have is skipped. */
    private place(todo: FakeTodo, listId: string): void {
        if (!this.projects.has(listId) && !this.areas.has(listId)) return;
        delete todo.projectId;
        delete todo.areaId;
        delete todo.heading;
        todo.inbox = false;
        if (this.projects.has(listId)) todo.projectId = listId;
        else todo.areaId = listId;
    }

    private apply(op: BridgeOp): string | null {
        switch (op.kind) {
            case 'makeArea': return this.addArea(op.name);
            case 'renameArea': this.area(op.id).title = op.name; return null;
            case 'makeTodo': {
                if (op.projectId && !this.projects.has(op.projectId)) throw new ThingsError('other', `Project ${op.projectId} is gone from Things`);
                if (!op.projectId && op.areaId && !this.areas.has(op.areaId)) throw new ThingsError('other', `Area ${op.areaId} is gone from Things`);
                const id = this.addTodo({ title: op.name, notes: op.notes, tags: op.tags });
                const target = op.projectId || op.areaId;
                if (target) this.place(this.todo(id), target);
                return id;
            }
            case 'setTodo': {
                const fields = this.todo(op.id).fields;
                if (op.name !== undefined) fields.title = op.name;
                if (op.notes !== undefined) fields.notes = op.notes;
                if (op.tags !== undefined) { fields.tags = sortedTags(op.tags); fields.tags.forEach(tag => this.tags.add(tag)); }
                if (op.when !== undefined) setWhen(fields, op.when ?? 'anytime');
                if (op.status !== undefined) fields.status = op.status;
                return null;
            }
            case 'moveTodo': {
                const todo = this.todo(op.id);
                if (op.projectId) this.place(todo, this.project(op.projectId).id);
                else if (op.areaId) this.place(todo, this.area(op.areaId).id);
                else if (op.inbox) { delete todo.projectId; delete todo.areaId; delete todo.heading; todo.inbox = true; }
                return null;
            }
            case 'deleteTodo': this.todo(op.id).trashed = true; return null;
            case 'deleteProject': this.project(op.id).trashed = true; return null;
            case 'deleteArea': {
                this.area(op.id);
                this.areas.delete(op.id);
                for (const item of [...this.projects.values(), ...this.todos.values()]) if (item.areaId === op.id) item.trashed = true;
                return null;
            }
            case 'setProject': {
                const project = this.project(op.id);
                if (op.name !== undefined) project.title = op.name;
                if (op.notes !== undefined) project.notes = op.notes;
                if (op.areaId) project.areaId = this.area(op.areaId).id;
                else if (op.areaId === '') delete project.areaId;
                if (op.status !== undefined) project.status = op.status;
                return null;
            }
            case 'findProjectByNotes': {
                for (const project of this.projects.values()) if (project.notes.includes(op.marker)) return project.id;
                return null;
            }
            case 'projectTodoIds': {
                const id = this.project(op.id).id;
                return JSON.stringify([...this.todos.values()].filter(t => t.projectId === id && !t.trashed).map(t => t.id));
            }
        }
    }

    private allowed(attributes: Attributes, keys: string[], what: string): void {
        for (const key of Object.keys(attributes)) if (!keys.includes(key)) throw new Error(`FakeThings: Things has no ${what} attribute ${key}`);
    }

    private update(link: string, params: URLSearchParams): void {
        const attributes: Attributes = {};
        params.forEach((value, key) => {
            if (!UPDATE_PARAMS.includes(key)) throw new Error(`FakeThings: Things has no update parameter ${key}`);
            if (key !== 'id' && key !== 'auth-token' && key !== 'reveal') attributes[key] = value;
        });
        const todo = this.todos.get(params.get('id') ?? '');
        if (params.get('auth-token') !== this.token || !todo || todo.trashed) { this.refused.push(link); return; }
        this.applyTo(todo, attributes);
    }

    private jsonItem(item: Attributes, link: string): void {
        const attributes = (item.attributes ?? {}) as Attributes;
        const update = item.operation === 'update';
        if (item.type === 'to-do') {
            if (!update) { this.createTodo(attributes); return; }
            const todo = this.todos.get(String(item.id));
            if (todo) this.applyTo(todo, attributes);
            else this.refused.push(link);
        } else if (item.type === 'project') {
            if (update) this.updateProject(String(item.id), attributes, link);
            else this.createProject(attributes);
        } else {
            throw new Error(`FakeThings: Things has no item type ${String(item.type)}`);
        }
    }

    /** Applies to-do attributes: the list first, then the heading in it, then the fields. */
    private applyTo(todo: FakeTodo, attributes: Attributes): void {
        this.allowed(attributes, TODO_ATTRIBUTES, 'to-do');
        const text = (key: string) => String(attributes[key]);
        const fields = todo.fields;
        if ('list-id' in attributes) this.place(todo, text('list-id'));
        if ('heading' in attributes && this.projects.get(todo.projectId ?? '')?.headings.includes(text('heading'))) todo.heading = text('heading');
        if ('title' in attributes) fields.title = text('title');
        if ('notes' in attributes) fields.notes = text('notes');
        if ('when' in attributes) setWhen(fields, text('when'));
        if ('deadline' in attributes) {
            if (text('deadline') === '') delete todo.deadline;
            else todo.deadline = text('deadline');
        }
        if ('tags' in attributes) {
            const names = Array.isArray(attributes.tags) ? attributes.tags.map(String) : text('tags').split(',');
            fields.tags = sortedTags(names).filter(tag => this.tags.has(tag));
        }
        if ('checklist-items' in attributes) fields.checklist = checklistFrom(attributes['checklist-items']);
        fields.status = statusFrom(attributes, fields.status);
    }

    /** A new to-do; inside a new project's items it lands under the heading before it, and any list-id is ignored. */
    private createTodo(attributes: Attributes, projectId?: string, heading?: string): void {
        const todo = this.todo(this.addTodo({ title: '' }));
        if (projectId === undefined) { this.applyTo(todo, attributes); return; }
        const own = { ...attributes };
        delete own['list-id'];
        this.place(todo, projectId);
        if (heading !== undefined) todo.heading = heading;
        this.applyTo(todo, own);
    }

    private createProject(attributes: Attributes): void {
        this.allowed(attributes, PROJECT_ATTRIBUTES, 'project');
        const items = (attributes.items ?? []) as Attributes[];
        const titleOf = (item: Attributes) => String(((item.attributes ?? {}) as Attributes).title);
        const areaId = textOf(attributes['area-id']);
        const id = this.addProject({
            title: textOf(attributes.title),
            notes: textOf(attributes.notes),
            headings: items.filter(item => item.type === 'heading').map(titleOf),
            status: statusFrom(attributes, 'open'),
            ...(this.areas.has(areaId) ? { areaId } : {}),
            ...('tags' in attributes ? { tags: sortedTags(Array.isArray(attributes.tags) ? attributes.tags.map(String) : textOf(attributes.tags).split(',')).filter(tag => this.tags.has(tag)) } : {}),
            ...(textOf(attributes.when) ? { when: textOf(attributes.when) } : {}),
            ...(textOf(attributes.deadline) ? { deadline: textOf(attributes.deadline) } : {})
        });
        let heading: string | undefined;
        for (const item of items) {
            if (item.type === 'heading') heading = titleOf(item);
            else if (item.type === 'to-do') this.createTodo((item.attributes ?? {}) as Attributes, id, heading);
            else throw new Error(`FakeThings: a project can't hold ${String(item.type)}`);
        }
    }

    private updateProject(id: string, attributes: Attributes, link: string): void {
        if ('items' in attributes) throw new Error("FakeThings: Things can't add a heading or to-do to an existing project");
        this.allowed(attributes, PROJECT_ATTRIBUTES, 'project');
        const project = this.projects.get(id);
        if (!project) { this.refused.push(link); return; }
        if ('title' in attributes) project.title = String(attributes.title);
        if ('notes' in attributes) project.notes = String(attributes.notes);
        const areaId = textOf(attributes['area-id']);
        if (this.areas.has(areaId)) project.areaId = areaId;
        project.status = statusFrom(attributes, project.status);
    }
}
