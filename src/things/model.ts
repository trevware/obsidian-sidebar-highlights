/**
 * What Things sync passes around: a task line and a Things to-do both reduce
 * to the same `TodoFields`, so the planner can compare them without knowing
 * which side they came from.
 *
 * Kept free of Obsidian imports so it can be unit tested directly. The state
 * file is read and written by the controller, never by the planner.
 */

export type TodoStatus = 'open' | 'completed' | 'canceled';

export interface ChecklistItem { title: string; done: boolean }

/** What a to-do and a task line share. Tags sorted and unique, status and priority tags included. */
export interface TodoFields {
    title: string;
    notes: string;
    checklist: ChecklistItem[];
    tags: string[];
    status: TodoStatus;
    /** YYYY-MM-DD */
    when?: string;
    /** HH:mm */
    reminder?: string;
    someday: boolean;
}

/** Where a task sits in the vault. */
export interface Place { path: string; heading?: string }

export interface VaultTask extends Place {
    line: number;
    text: string;
    id?: string;
    fields: TodoFields;
    dateText?: string;
    timeText?: string;
    /** The daily note's date, for a task with no date of its own. */
    impliedWhen?: string;
}

export interface VaultNote { path: string; folder: string; title: string; headings: string[]; tasks: VaultTask[]; mtime: number }

export interface VaultSnapshot { notes: VaultNote[]; folders: string[] }

/** What the installed Things can do, so the planner never asks for what it can't. */
export interface Capabilities { headings: boolean; checklist: boolean; reminder: boolean; repeating: boolean; reorder: boolean }

export interface ThingsTodo {
    id: string;
    projectId?: string;
    areaId?: string;
    inbox: boolean;
    heading?: string;
    fields: TodoFields;
    deadline?: string;
    repeating: boolean;
    trashed: boolean;
    logged: boolean;
}

export interface ThingsProject { id: string; title: string; areaId?: string; headings?: string[]; status: TodoStatus; trashed: boolean; notes?: string }

export interface ThingsArea { id: string; title: string }

export interface ThingsSnapshot { areas: ThingsArea[]; projects: ThingsProject[]; todos: ThingsTodo[]; capabilities: Capabilities }

/** A to-do as the last round left it, to tell which side changed since. */
export interface SyncedTodo { id: string; place: Place; fields: TodoFields }

export interface SyncedProject { id: string; path: string; title: string; headings: string[]; areaId?: string }

export interface SyncedArea { id: string; folder: string }

export interface ThingsState {
    version: 1;
    joined: boolean;
    areas: SyncedArea[];
    projects: SyncedProject[];
    todos: SyncedTodo[];
    /** Notes standing in for Things lists that aren't projects: the Inbox, and each area's loose to-dos. */
    inboxNote: string;
    looseNotes: Record<string /* areaId */, string /* path */>;
    /**
     * Projects asked for by a link and not yet recorded: Things may act on a
     * link after the round gave up looking, and a swap may stop part way.
     * The next round looks for each first, so a note never gets a second
     * project. `swapOf` is the project a swap was replacing; `id` is set once
     * the project was found.
     */
    pending?: PendingProject[];
}

export interface PendingProject { marker: string; path: string; at: number; headings?: string[]; swapOf?: string; id?: string }

export const EMPTY_STATE: ThingsState = {
    version: 1,
    joined: false,
    areas: [],
    projects: [],
    todos: [],
    inboxNote: 'Things Inbox.md',
    looseNotes: {}
};

/** The Mac this vault syncs with Things from, kept in settings. */
export interface ThingsConnection { device: { install: string; name: string }; connectedAt: number }
