/**
 * The JXA programs that read Things and make its AppleScript-side changes,
 * and the reading of what they print.
 *
 * Every script takes its inputs from one JSON literal on its first line, so
 * user text (quotes, a backslash, a newline, `${`) is data and never code.
 * The read asks each list for one property at a time across all its to-dos,
 * so a few hundred to-dos read in one osascript call; only the hidden
 * experimental JSON is asked for one to-do at a time. Each list is read
 * twice over and must match, so Things changing mid-read stops the read
 * rather than pairing one to-do's ID with another's title.
 *
 * Things' dictionary has no headings, checklist items or reminder times. Its
 * hidden `_private_experimental_ json` property may carry them, and
 * `EXPERIMENTAL` is the one place that says where to look. A capability is on
 * only when every to-do read came with that JSON and it carried the field.
 * Repeating to-dos aren't told apart until the JSON is confirmed to say so.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import type { BridgeOp } from './bridge';
import type { ChecklistItem, ThingsProject, ThingsSnapshot, ThingsTodo, TodoFields, TodoStatus } from './model';

/** Things' built-in lists, by the IDs its dictionary answers to. */
export const LISTS = {
    inbox: 'TMInboxListSource',
    today: 'TMTodayListSource',
    anytime: 'TMNextListSource',
    upcoming: 'TMCalendarListSource',
    someday: 'TMSomedayListSource',
    logbook: 'TMLogbookListSource',
    trash: 'TMTrashListSource'
} as const;

/** Every list an open to-do can sit in: all but the Logbook and the Trash. */
const OPEN_LISTS = [LISTS.inbox, LISTS.today, LISTS.anytime, LISTS.upcoming, LISTS.someday];

/**
 * Where the experimental JSON is, and where in it each field might be. The
 * feasibility rerun confirms these and narrows them, here and nowhere else.
 */
export const EXPERIMENTAL = {
    /** JXA spellings tried for the hidden `_private_experimental_ json` property, in order. */
    property: ['_private_experimental_Json', '_privateExperimentalJson', 'privateExperimentalJson', '_private_experimental_json'],
    /** On a to-do: its heading's title, or an object with one. */
    heading: ['heading', 'headingTitle'],
    /** On a to-do: its checklist, as titles or objects with a title and a done mark. */
    checklist: ['checklistItems', 'checklist', 'checklist-items'],
    /** On a to-do: its reminder time. */
    reminder: ['reminder', 'reminderTime'],
    /** On a project: its headings, in order. Absent, the planner takes Things' headings as unchanged. */
    projectHeadings: ['headings']
} as const;

/** A script's inputs as one JSON literal on its first line. Line and paragraph separators are escaped, which older JavaScript reads as line ends. */
function withInput(input: unknown, body: string): string {
    const json = JSON.stringify(input).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `const input = ${json};\n${body}`;
}

const READ = `function run() {
    const app = Application('Things3');
    const attempt = f => { try { return f(); } catch (e) { return undefined; } };
    const pad = n => ('0' + n).slice(-2);
    const day = d => d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : null;
    const changed = () => new Error('Things changed during the read');
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    let spelling = null;
    const experimental = item => {
        for (const name of spelling ? [spelling] : input.spellings) {
            const text = attempt(() => item[name]());
            if (typeof text === 'string') { spelling = name; return text; }
        }
        return null;
    };
    const bulk = (items, keys) => {
        const ids = items.id();
        const values = {};
        if (!ids.length) return { ids, values };
        for (const key of keys) {
            values[key] = items[key]();
            if (values[key].length !== ids.length) throw changed();
        }
        if (!same(ids, items.id())) throw changed();
        return { ids, values };
    };
    const list = id => app.lists.byId(id);
    const trash = new Set(list(input.lists.trash).toDos.id());
    const projectOf = new Map();
    const areaOf = new Map();
    const areaRead = bulk(app.areas, ['name']);
    const areas = areaRead.ids.map((id, i) => {
        for (const todo of app.areas.byId(id).toDos.id()) areaOf.set(todo, id);
        return { id, name: areaRead.values.name[i] };
    });
    const projects = new Map();
    const addProject = (spec, id, name, status) => {
        const record = { id, name, status, area: null, json: null };
        projects.set(id, record);
        if (status !== 'open' || trash.has(id)) return;
        const area = spec.area();
        record.area = area ? area.id() : null;
        record.json = experimental(spec);
        for (const todo of spec.toDos.id()) projectOf.set(todo, id);
    };
    const projectRead = bulk(app.projects, ['name', 'status']);
    projectRead.ids.forEach((id, i) => addProject(app.projects.byId(id), id, projectRead.values.name[i], projectRead.values.status[i]));
    const todos = new Map();
    const inbox = [];
    const someday = [];
    for (const listId of input.open) {
        const items = list(listId).toDos;
        const read = bulk(items, ['name', 'notes', 'status', 'tagNames', 'activationDate', 'dueDate']);
        const v = read.values;
        const kinds = read.ids.length ? attempt(() => items.class()) || [] : [];
        read.ids.forEach((id, i) => {
            if (listId === input.lists.inbox) inbox.push(id);
            if (listId === input.lists.someday) someday.push(id);
            if (todos.has(id) || projects.has(id) || kinds[i] === 'project') return;
            const project = projectOf.get(id) || null;
            todos.set(id, {
                id, name: v.name[i], notes: v.notes[i], status: v.status[i], tags: v.tagNames[i],
                when: day(v.activationDate[i]), deadline: day(v.dueDate[i]),
                project, area: project ? null : areaOf.get(id) || null, json: experimental(items.byId(id))
            });
        });
    }
    const sources = [app, list(input.lists.logbook), list(input.lists.trash)];
    for (const id of input.known) {
        if (todos.has(id) || projects.has(id)) continue;
        const spec = sources.map(source => source.toDos.byId(id)).find(s => s.exists());
        if (!spec) continue;
        const name = spec.name();
        const status = spec.status();
        if (attempt(() => spec.class()) === 'project') { addProject(spec, id, name, status); continue; }
        const project = spec.project();
        const projectId = project ? project.id() : null;
        if (projectId && !projects.has(projectId)) addProject(project, projectId, project.name(), project.status());
        const area = projectId ? null : spec.area();
        todos.set(id, {
            id, name, notes: spec.notes(), status, tags: spec.tagNames(),
            when: day(spec.activationDate()), deadline: day(spec.dueDate()),
            project: projectId, area: area ? area.id() : null, byId: true, json: experimental(spec)
        });
    }
    return JSON.stringify({ areas, projects: Array.from(projects.values()), todos: Array.from(todos.values()), inbox, someday, trash: Array.from(trash), spelling });
}`;

/**
 * One JXA program that prints everything a round needs: areas, projects
 * (open, done and trashed), the to-dos in every list but the Logbook and the
 * Trash, which of them sit in the Inbox and in Someday, the Trash's IDs, and
 * each of `knownIds` the lists didn't hold, looked up by ID (a to-do done or
 * trashed since the last round, or a project). An ID Things no longer has is
 * left out. Pass only IDs whose to-do may still matter (open in the state or
 * on a line): each one missing from the lists costs a lookup of its own.
 */
export function readScript(knownIds: string[]): string {
    return withInput({ known: [...new Set(knownIds)], open: OPEN_LISTS, lists: LISTS, spellings: EXPERIMENTAL.property }, READ);
}

const WRITES: Record<BridgeOp['kind'], string> = {
    makeArea: `return app.make({ new: 'area', withProperties: { name: op.name } }).id();`,
    renameArea: `app.areas.byId(op.id).name = op.name;`,
    makeTodo: `const id = app.make({ new: 'toDo', withProperties: { name: op.name, notes: op.notes, tagNames: op.tags.join(', ') } }).id();
    const todo = app.toDos.byId(id);
    if (op.projectId) todo.project = app.projects.byId(op.projectId);
    else if (op.areaId) todo.area = app.areas.byId(op.areaId);
    return id;`,
    setTodo: `const todo = app.toDos.byId(op.id);
    if ('name' in op) todo.name = op.name;
    if ('notes' in op) todo.notes = op.notes;
    if ('tags' in op) todo.tagNames = op.tags.join(', ');
    if ('when' in op) {
        if (op.when === null || op.when === 'anytime') app.move(todo, { to: app.lists.byId(lists.anytime) });
        else if (op.when === 'someday') app.move(todo, { to: app.lists.byId(lists.someday) });
        else app.schedule(todo, { for: day(op.when) });
    }
    if ('status' in op) todo.status = op.status;`,
    moveTodo: `const todo = app.toDos.byId(op.id);
    if (op.projectId) todo.project = app.projects.byId(op.projectId);
    else if (op.areaId) app.move(todo, { to: app.areas.byId(op.areaId) });
    else if (op.inbox) app.move(todo, { to: app.lists.byId(lists.inbox) });`,
    deleteTodo: `app.delete(app.toDos.byId(op.id));`,
    deleteProject: `app.delete(app.projects.byId(op.id));`,
    deleteArea: `app.delete(app.areas.byId(op.id));`,
    setProject: `const project = app.projects.byId(op.id);
    if ('name' in op) project.name = op.name;
    if ('notes' in op) project.notes = op.notes;
    if ('areaId' in op) project.area = op.areaId ? app.areas.byId(op.areaId) : null;
    if ('status' in op) project.status = op.status;`,
    findProjectByNotes: `const ids = app.projects.id();
    const notes = app.projects.notes();
    const at = notes.findIndex(text => typeof text === 'string' && text.indexOf(op.marker) !== -1);
    return at === -1 || ids.length !== notes.length ? '' : ids[at];`
};

/** A When value AppleScript can set: a date, Someday, or none (Anytime). A reminder needs the update link. */
const SCRIPT_WHEN = /^(?:\d{4}-\d{2}-\d{2}|someday|anytime)$/;

/**
 * One JXA program for an op. It prints the ID an op made or found, or
 * nothing. `setTodo`'s `when` is a date, `someday`, or null or `anytime` for
 * no date; `setProject`'s empty `areaId` takes the project out of its area.
 */
export function writeScript(op: BridgeOp): string {
    if (op.kind === 'setTodo' && typeof op.when === 'string' && !SCRIPT_WHEN.test(op.when)) {
        throw new Error(`AppleScript can't set When to "${op.when}"; a reminder needs the update link`);
    }
    const body = `function run() {
    const app = Application('Things3');
    const op = input.op;
    const lists = input.lists;
    const day = text => { const parts = text.split('-').map(Number); return new Date(parts[0], parts[1] - 1, parts[2]); };
    ${WRITES[op.kind]}
    return '';
}`;
    return withInput({ op, lists: LISTS }, body);
}

// ---------------------------------------------------------------------------
// Reading what the read script printed.

type Data = Record<string, unknown>;
const STATUSES: readonly string[] = ['open', 'completed', 'canceled'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function unreadable(what: string): never {
    throw new Error(`Things sent back a read that can't be used: ${what}`);
}
const isData = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
const dataOf = (value: unknown, what: string): Data => isData(value) ? value : unreadable(what);
const listOf = (value: unknown, what: string): unknown[] => Array.isArray(value) ? value : unreadable(what);
const textOf = (value: unknown, what: string): string => typeof value === 'string' ? value : unreadable(what);
const optionalText = (value: unknown, what: string): string => value === null || value === undefined ? '' : textOf(value, what);
const idOf = (value: unknown, what: string): string | undefined => value === null || value === undefined || value === '' ? undefined : textOf(value, what);
const dayOf = (value: unknown, what: string): string | undefined => {
    if (value === null || value === undefined) return undefined;
    return DAY.test(textOf(value, what)) ? value as string : unreadable(what);
};
const statusOf = (value: unknown, what: string): TodoStatus => STATUSES.includes(value as string) ? value as TodoStatus : unreadable(what);
const idSet = (value: unknown, what: string): Set<string> => new Set(listOf(value, what).map(id => textOf(id, what)));

/** The experimental JSON as an object, its `attributes` (the link format's nesting) spread in; undefined when missing or unreadable. */
function experimentalOf(json: unknown): Data | undefined {
    if (typeof json !== 'string') return undefined;
    let value: unknown;
    try { value = JSON.parse(json); } catch { return undefined; }
    if (!isData(value)) return undefined;
    return isData(value.attributes) ? { ...value, ...value.attributes } : value;
}

const carried = (data: Data, keys: readonly string[]): boolean => keys.some(key => key in data);
function first(data: Data | undefined, keys: readonly string[]): unknown {
    if (!data) return undefined;
    for (const key of keys) if (data[key] !== null && data[key] !== undefined) return data[key];
    return undefined;
}

/** A title, from a string or an object carrying one. */
function titleOf(value: unknown): string | undefined {
    if (typeof value === 'string') return value === '' ? undefined : value;
    if (!isData(value)) return undefined;
    return titleOf(isData(value.attributes) ? value.attributes : value.title ?? value.name);
}

function checklistOf(value: unknown): ChecklistItem[] {
    if (!Array.isArray(value)) return [];
    const items: ChecklistItem[] = [];
    for (const entry of value) {
        const title = titleOf(entry);
        if (title === undefined) continue;
        const data = isData(entry) ? { ...entry, ...(isData(entry.attributes) ? entry.attributes : {}) } : {};
        const done = data.completed === true || data.done === true || ['completed', 'canceled', 2, 3].includes(data.status as string);
        items.push({ title, done });
    }
    return items;
}

const pad = (n: number): string => `0${n}`.slice(-2);

/** A time of day as HH:mm: from "15:00" or a date-time string, seconds since midnight, or Things' packed hour << 26 | minute << 20. */
function reminderOf(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        const packed = value >= 1 << 20;
        const hour = packed ? (value >> 26) & 31 : Math.floor(value / 3600);
        const minute = packed ? (value >> 20) & 63 : Math.floor((value % 3600) / 60);
        return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : undefined;
    }
    if (typeof value !== 'string') return undefined;
    const match = /(?:^|[T\s@])(\d{1,2}):(\d{2})/.exec(value);
    return match && Number(match[1]) < 24 ? `${pad(Number(match[1]))}:${match[2]}` : undefined;
}

/** A project's headings from its experimental JSON: titles, or objects with one (skipping items that aren't headings). */
function headingsOf(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const titles: string[] = [];
    for (const entry of value) {
        if (isData(entry) && typeof entry.type === 'string' && entry.type !== 'heading') continue;
        const title = titleOf(entry);
        if (title !== undefined) titles.push(title);
    }
    return titles;
}

/** "Errands, Home" as sorted, unique tag names. */
const tagsOf = (names: string): string[] => [...new Set(names.split(',').map(name => name.trim()).filter(name => name !== ''))].sort();

interface Lists { inbox: Set<string>; someday: Set<string>; trash: Set<string> }

function todoOf(raw: Data, data: Data | undefined, lists: Lists): ThingsTodo {
    const id = textOf(raw.id, 'a to-do without an ID');
    const what = `to-do ${id}`;
    const status = statusOf(raw.status, what);
    const someday = lists.someday.has(id);
    const fields: TodoFields = {
        title: textOf(raw.name, what),
        notes: optionalText(raw.notes, what),
        checklist: checklistOf(first(data, EXPERIMENTAL.checklist)),
        tags: tagsOf(optionalText(raw.tags, what)),
        status,
        someday
    };
    const when = someday ? undefined : dayOf(raw.when, what);
    if (when !== undefined) {
        fields.when = when;
        const reminder = reminderOf(first(data, EXPERIMENTAL.reminder));
        if (reminder !== undefined) fields.reminder = reminder;
    }
    const todo: ThingsTodo = { id, inbox: lists.inbox.has(id), fields, repeating: false, trashed: lists.trash.has(id), logged: raw.byId === true && status !== 'open' };
    const projectId = idOf(raw.project, what);
    const areaId = idOf(raw.area, what);
    if (projectId !== undefined) {
        todo.projectId = projectId;
        const heading = titleOf(first(data, EXPERIMENTAL.heading));
        if (heading !== undefined) todo.heading = heading;
    } else if (areaId !== undefined) {
        todo.areaId = areaId;
    }
    const deadline = dayOf(raw.deadline, what);
    if (deadline !== undefined) todo.deadline = deadline;
    return todo;
}

function projectOf(raw: Data, trash: Set<string>): ThingsProject {
    const id = textOf(raw.id, 'a project without an ID');
    const what = `project ${id}`;
    const project: ThingsProject = { id, title: textOf(raw.name, what), status: statusOf(raw.status, what), trashed: trash.has(id) };
    const areaId = idOf(raw.area, what);
    if (areaId !== undefined) project.areaId = areaId;
    const headings = headingsOf(first(experimentalOf(raw.json), EXPERIMENTAL.projectHeadings));
    if (headings !== undefined) project.headings = headings;
    return project;
}

/** What the read script printed, as a snapshot. Throws when it isn't a read, so nothing is planned from a guess. */
export function parseRead(output: string): ThingsSnapshot {
    let parsed: unknown;
    try { parsed = JSON.parse(output); } catch { return unreadable('not JSON'); }
    const raw = dataOf(parsed, 'not an object');
    const lists: Lists = { inbox: idSet(raw.inbox, 'inbox'), someday: idSet(raw.someday, 'someday'), trash: idSet(raw.trash, 'trash') };
    const areas = listOf(raw.areas, 'areas').map(value => {
        const area = dataOf(value, 'an area');
        return { id: textOf(area.id, 'an area without an ID'), title: textOf(area.name, 'an area without a name') };
    });
    const projects = listOf(raw.projects, 'projects').map(value => projectOf(dataOf(value, 'a project'), lists.trash));
    const read = listOf(raw.todos, 'to-dos').map(value => {
        const todo = dataOf(value, 'a to-do');
        return { todo, data: experimentalOf(todo.json) };
    });
    // A field counts only when every to-do came with the JSON: a to-do without
    // it would otherwise read as having lost its heading, checklist or reminder.
    const every = read.length > 0 && read.every(r => r.data !== undefined);
    const has = (keys: readonly string[]) => every && read.some(r => r.data !== undefined && carried(r.data, keys));
    return {
        areas,
        projects,
        todos: read.map(r => todoOf(r.todo, r.data, lists)),
        capabilities: { headings: has(EXPERIMENTAL.heading), checklist: has(EXPERIMENTAL.checklist), reminder: has(EXPERIMENTAL.reminder), repeating: false, reorder: false }
    };
}
