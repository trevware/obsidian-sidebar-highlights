// The real moment, so dates in task text parse the way they do in Obsidian.
jest.mock('obsidian', () => ({ moment: jest.requireActual('moment') }), { virtual: true });

import type HighlightCommentsPlugin from '../../main';
import { TaskManager } from '../managers/task-manager';
import { parseTaskLine } from '../tasks-view/task-line';
import type { ThingsTodo, TodoFields, VaultTask } from './model';
import { applyThingsEdits, newNoteContent } from './note-edits';
import type { VaultStep } from './plan';
import { vaultSnapshot } from './vault-snapshot';

const PATH = 'Work/Plan.md';
const A = 'aaaaaaaa';
const B = 'bbbbbbbb';
const C = 'cccccccc';
const fmt = { date: (iso: string) => iso, time: (hhmm: string) => hhmm, today: '2026-11-22' };

const scanner = new TaskManager({ app: { vault: {} }, settings: { taskDateFormat: 'YYYY-MM-DD' } } as unknown as HighlightCommentsPlugin);

interface ReadOptions { daily?: string; hideMetadata?: boolean }

/** A note's tasks as Things sync reads them. */
function read(lines: string[], opts: ReadOptions = {}): VaultTask[] {
    const snapshot = vaultSnapshot([{ path: PATH, lines, mtime: 1 }], {
        parse: (path, content) => scanner.tasksInContent(path, content, true, false),
        hideMetadata: opts.hideMetadata ?? false,
        dailyDate: () => opts.daily
    });
    return snapshot.notes[0]?.tasks ?? [];
}

/** The task read from `lines` with this title. */
function task(lines: string[], title: string, opts: ReadOptions = {}): VaultTask {
    const found = read(lines, opts).find(t => t.fields.title === title);
    if (!found) throw new Error(`No task "${title}" in ${JSON.stringify(lines)}`);
    return found;
}

function todo(id: string, title: string, fields: Partial<TodoFields> = {}, over: Partial<ThingsTodo> = {}): ThingsTodo {
    return { id, inbox: false, repeating: false, trashed: false, logged: false, fields: { title, notes: '', checklist: [], tags: [], status: 'open', someday: false, ...fields }, ...over };
}

/** One update step on the task with this title, and the note after it. */
function updated(lines: string[], title: string, fields: Partial<TodoFields>, opts: ReadOptions = {}): string[] {
    const result = applyThingsEdits(lines, [{ kind: 'update', task: task(lines, title, opts), fields }], fmt);
    expect(result.missed).toBe(0);
    return result.lines;
}

describe('applyThingsEdits: IDs', () => {
    it('writes an ID after the words and date, before a calendar ID', () => {
        const lines = ['# Plan', '- [ ] Pay rent 2026-11-25 %%cal:0fq7k2m9vd3a%%', '- [ ] Call Mom'];
        const result = applyThingsEdits(lines, [
            { kind: 'link', task: task(lines, 'Pay rent'), id: A },
            { kind: 'adopt', task: task(lines, 'Call Mom'), id: B }
        ], fmt);
        expect(result).toEqual({
            lines: ['# Plan', `- [ ] Pay rent 2026-11-25 %%things:${A}%% %%cal:0fq7k2m9vd3a%%`, `- [ ] Call Mom %%things:${B}%%`],
            missed: 0
        });
    });

    it('takes an ID off and keeps a calendar ID', () => {
        const lines = [`- [ ] Pay rent %%things:${A}%% %%cal:0fq7k2m9vd3a%%`];
        const { lines: out } = applyThingsEdits(lines, [{ kind: 'unlink', task: task(lines, 'Pay rent') }], fmt);
        expect(out).toEqual(['- [ ] Pay rent %%cal:0fq7k2m9vd3a%%']);
    });

    it('adopts and updates one line in the same write', () => {
        const lines = ['- [ ] Call mom #home'];
        const read = task(lines, 'Call mom');
        const result = applyThingsEdits(lines, [
            { kind: 'adopt', task: read, id: A },
            { kind: 'update', task: read, fields: { title: 'Call Mom', tags: ['Errand', 'home'] } }
        ], fmt);
        expect(result).toEqual({ lines: [`- [ ] Call Mom #home #Errand %%things:${A}%%`], missed: 0 });
    });

    it('gives a copied line its own ID: unlink, then link, on one line', () => {
        const lines = [`- [ ] Pay rent %%things:${A}%%`, `- [ ] Pay rent %%things:${A}%%`];
        const copy = read(lines)[1];
        const { id: _id, ...unlinked } = copy;
        const result = applyThingsEdits(lines, [
            { kind: 'unlink', task: copy },
            { kind: 'link', task: unlinked, id: B }
        ], fmt);
        expect(result).toEqual({ lines: [`- [ ] Pay rent %%things:${A}%%`, `- [ ] Pay rent %%things:${B}%%`], missed: 0 });
    });
});

describe('applyThingsEdits: a note edited since the read', () => {
    it('skips a line whose text changed and counts it missed, and still finds one that moved', () => {
        const before = ['# Plan', '- [ ] Call Mom', '- [ ] Pay rent'];
        const callMom = task(before, 'Call Mom');
        const payRent = task(before, 'Pay rent');
        const now = ['# Plan', 'A new first line', '- [ ] Call Mom', '- [ ] Pay rent today'];
        const result = applyThingsEdits(now, [
            { kind: 'adopt', task: callMom, id: A },
            { kind: 'adopt', task: payRent, id: B },
            { kind: 'update', task: payRent, fields: { title: 'Pay the rent' } }
        ], fmt);
        expect(result).toEqual({ lines: ['# Plan', 'A new first line', `- [ ] Call Mom %%things:${A}%%`, '- [ ] Pay rent today'], missed: 2 });
    });

    it('never writes two tasks into one line', () => {
        const before = ['- [ ] Buy milk', '- [ ] Buy milk'];
        const [first, second] = read(before);
        const result = applyThingsEdits(['- [ ] Buy milk'], [
            { kind: 'adopt', task: first, id: A },
            { kind: 'adopt', task: second, id: B }
        ], fmt);
        expect(result).toEqual({ lines: [`- [ ] Buy milk %%things:${A}%%`], missed: 1 });
    });

    it('follows each task through lines added above it', () => {
        const lines = [`- [ ] Trip %%things:${A}%%`, '- [ ] Same', '- [ ] Same'];
        const [trip, , second] = read(lines);
        const result = applyThingsEdits(lines, [
            { kind: 'update', task: trip, fields: { notes: 'One\nTwo\nThree' } },
            { kind: 'adopt', task: second, id: B }
        ], fmt);
        expect(result.lines).toEqual([`- [ ] Trip %%things:${A}%%`, '    One', '    Two', '    Three', '- [ ] Same', `- [ ] Same %%things:${B}%%`]);
    });

    it('leaves notes or a checklist changed since the read alone', () => {
        const before = [`- [ ] Trip %%things:${A}%%`, '\tPack light', '\t- [ ] Book train'];
        const trip = task(before, 'Trip');
        const notesNow = [`- [ ] Trip %%things:${A}%%`, '\tPack light and a coat', '\t- [ ] Book train'];
        expect(applyThingsEdits(notesNow, [{ kind: 'update', task: trip, fields: { notes: 'From Things' } }], fmt)).toEqual({ lines: notesNow, missed: 1 });
        const listNow = [`- [ ] Trip %%things:${A}%%`, '\tPack light', '\t- [x] Book train'];
        expect(applyThingsEdits(listNow, [{ kind: 'update', task: trip, fields: { checklist: [{ title: 'Book a train', done: false }] } }], fmt)).toEqual({ lines: listNow, missed: 1 });
    });
});

describe('applyThingsEdits: update', () => {
    it('rewords a line, keeping its links, tags, comments, date and ID', () => {
        const lines = [`- [ ] Call [[Mom]] about trip #home %%ask about dates%% 2026-11-25 %%things:${A}%%`];
        const out = updated(lines, 'Call Mom about trip', { title: 'Call Mom about the trip' });
        expect(out).toEqual([`- [ ] Call [[Mom]] about the trip #home %%ask about dates%% 2026-11-25 %%things:${A}%%`]);
        expect(read(out)[0].fields).toMatchObject({ title: 'Call Mom about the trip', tags: ['home'], when: '2026-11-25' });
    });

    it('keeps Tasks plugin metadata that Things never saw', () => {
        const lines = [`- [ ] Water plants #home 🔁 every week %%things:${A}%%`];
        const out = updated(lines, 'Water plants', { title: 'Water the plants' }, { hideMetadata: true });
        expect(out).toEqual([`- [ ] Water the plants #home 🔁 every week %%things:${A}%%`]);
    });

    it('never takes a #tag from a comment or a link', () => {
        const lines = [`- [ ] Call Mom #home %%see #foo later%% %%things:${A}%%`];
        expect(updated(lines, 'Call Mom', { title: 'Call Mom today' })).toEqual([`- [ ] Call Mom today #home %%see #foo later%% %%things:${A}%%`]);
        const tagged = updated(lines, 'Call Mom', { tags: ['work'] });
        expect(tagged).toEqual([`- [ ] Call Mom %%see #foo later%% #work %%things:${A}%%`]);
        expect(read(tagged)[0].fields.tags).toEqual(['work']);
        const linked = [`- [ ] Read [notes](https://x.com/a #b) %%things:${A}%%`];
        expect(updated(linked, 'Read notes', { title: 'Read the notes' })).toEqual([`- [ ] Read the [notes](https://x.com/a #b) %%things:${A}%%`]);
    });

    it('keeps a Markdown link whose words are still in the new title', () => {
        const lines = [`- [ ] Read [the docs](https://example.com/a) and **fix** it %%things:${A}%%`];
        const out = updated(lines, 'Read the docs and fix it', { title: 'Read the docs and fix it today' });
        expect(out).toEqual([`- [ ] Read [the docs](https://example.com/a) and fix it today %%things:${A}%%`]);
        expect(read(out)[0].fields.title).toBe('Read the docs and fix it today');
    });

    it('writes a Things title with newlines on one line', () => {
        const lines = [`- [ ] Pay rent %%things:${A}%%`, '- [ ] Next'];
        expect(updated(lines, 'Pay rent', { title: 'Pay rent\nand bills\r\n' })).toEqual([`- [ ] Pay rent and bills %%things:${A}%%`, '- [ ] Next']);
    });

    it('sets the checkbox from the status and the status and priority tags', () => {
        const open = [`- [ ] Pay rent %%things:${A}%%`];
        expect(updated(open, 'Pay rent', { status: 'completed' })).toEqual([`- [x] Pay rent %%things:${A}%%`]);
        expect(updated(open, 'Pay rent', { status: 'canceled' })).toEqual([`- [-] Pay rent %%things:${A}%%`]);
        expect(updated(open, 'Pay rent', { tags: ['In Progress'] })).toEqual([`- [/] Pay rent %%things:${A}%%`]);
        expect(updated(open, 'Pay rent', { tags: ['Question'] })).toEqual([`- [?] Pay rent %%things:${A}%%`]);
        expect(updated(open, 'Pay rent', { tags: ['Priority 2'] })).toEqual([`- [!2] Pay rent %%things:${A}%%`]);
        expect(updated([`- [x] Pay rent %%things:${A}%%`], 'Pay rent', { status: 'open' })).toEqual(open);
        expect(updated([`- [/] Pay rent %%things:${A}%%`], 'Pay rent', { tags: [] })).toEqual(open);
    });

    it('keeps a checkbox whose meaning did not change', () => {
        const lines = [`- [>] Pay rent %%things:${A}%%`];
        expect(updated(lines, 'Pay rent', { tags: ['home'] })).toEqual([`- [>] Pay rent #home %%things:${A}%%`]);
    });

    it('replaces the line\'s tags with Things\' tags, leaving status and priority to the checkbox', () => {
        const lines = [`- [ ] Pay rent #home #bills 2026-11-25 %%things:${A}%%`];
        const out = updated(lines, 'Pay rent', { tags: ['Deep Work', 'Priority 1', 'bills'] });
        expect(out).toEqual([`- [!1] Pay rent #bills #Deep-Work 2026-11-25 %%things:${A}%%`]);
        expect(read(out)[0].fields.tags).toEqual(['Deep Work', 'Priority 1', 'bills']);
    });

    it('writes and removes #someday', () => {
        expect(updated([`- [ ] Learn piano %%things:${A}%%`], 'Learn piano', { someday: true })).toEqual([`- [ ] Learn piano #someday %%things:${A}%%`]);
        expect(updated([`- [ ] Learn piano #someday #music %%things:${A}%%`], 'Learn piano', { someday: false })).toEqual([`- [ ] Learn piano #music %%things:${A}%%`]);
    });

    it('sets, moves and clears the date and time', () => {
        expect(updated([`- [ ] Water plants %%things:${A}%%`], 'Water plants', { when: '2026-11-25' })).toEqual([`- [ ] Water plants 2026-11-25 %%things:${A}%%`]);
        const timed = [`- [ ] Call 2026-11-24 15:00 %%things:${A}%%`];
        expect(updated(timed, 'Call', { when: '2026-11-25' })).toEqual([`- [ ] Call 2026-11-25 15:00 %%things:${A}%%`]);
        expect(updated(timed, 'Call', { when: undefined })).toEqual([`- [ ] Call %%things:${A}%%`]);
        expect(updated(timed, 'Call', { reminder: undefined })).toEqual([`- [ ] Call 2026-11-24 %%things:${A}%%`]);
        expect(updated(timed, 'Call', { when: '2026-11-26', reminder: '08:00' })).toEqual([`- [ ] Call 2026-11-26 08:00 %%things:${A}%%`]);
        expect(updated([`- [ ] Call 2026-11-24 %%things:${A}%%`], 'Call', { reminder: '09:30' })).toEqual([`- [ ] Call 2026-11-24 09:30 %%things:${A}%%`]);
    });

    it('writes dates and times in the vault\'s formats', () => {
        const lines = [`- [ ] Call %%things:${A}%%`];
        const vault = { ...fmt, date: (iso: string) => iso.split('-').reverse().join('/'), time: (hhmm: string) => `${Number(hhmm.slice(0, 2)) % 12}pm` };
        const { lines: out } = applyThingsEdits(lines, [{ kind: 'update', task: task(lines, 'Call'), fields: { when: '2026-11-25', reminder: '15:00' } }], vault);
        expect(out).toEqual([`- [ ] Call 25/11/2026 3pm %%things:${A}%%`]);
    });

    it('leaves a daily note\'s own day unwritten unless a time needs it', () => {
        const lines = [`- [ ] Water plants %%things:${A}%%`];
        const daily = { daily: '2026-11-22' };
        expect(updated(lines, 'Water plants', { when: '2026-11-22' }, daily)).toEqual(lines);
        expect(updated(lines, 'Water plants', { when: '2026-11-23' }, daily)).toEqual([`- [ ] Water plants 2026-11-23 %%things:${A}%%`]);
        expect(updated(lines, 'Water plants', { reminder: '09:00' }, daily)).toEqual([`- [ ] Water plants 2026-11-22 09:00 %%things:${A}%%`]);
    });

    it('never writes a line that would stop being a task, nor its notes', () => {
        const lines = ['- [ ] Pay rent', '\tBy the 1st'];
        const result = applyThingsEdits(lines, [{ kind: 'update', task: task(lines, 'Pay rent'), fields: { title: '', notes: '' } }], fmt);
        expect(result).toEqual({ lines, missed: 1 });
    });

    it('writes a callout task\'s notes once, edit after edit', () => {
        let lines = [`> - [ ] Trip %%things:${A}%%`, '> \tPack light', '', '- [ ] Next'];
        lines = updated(lines, 'Trip', { notes: `${task(lines, 'Trip').fields.notes}\nBring snacks` });
        expect(lines).toEqual([`> - [ ] Trip %%things:${A}%%`, '> \tPack light', '> \tBring snacks', '', '- [ ] Next']);
        expect(task(lines, 'Trip').fields.notes).toBe('Pack light\nBring snacks');
        lines = updated(lines, 'Trip', { notes: `${task(lines, 'Trip').fields.notes}\nCharge phone` });
        expect(lines).toEqual([`> - [ ] Trip %%things:${A}%%`, '> \tPack light', '> \tBring snacks', '> \tCharge phone', '', '- [ ] Next']);
        expect(task(lines, 'Trip').fields.notes).toBe('Pack light\nBring snacks\nCharge phone');
    });

    it('replaces the notes under a task and leaves its checklist', () => {
        const lines = [`- [ ] Trip %%things:${A}%%`, '\tPack light', '\t- [ ] Book train', '- [ ] Next'];
        expect(updated(lines, 'Trip', { notes: 'Pack light\nBring snacks' })).toEqual([`- [ ] Trip %%things:${A}%%`, '\tPack light', '\tBring snacks', '\t- [ ] Book train', '- [ ] Next']);
        expect(updated(lines, 'Trip', { notes: '' })).toEqual([`- [ ] Trip %%things:${A}%%`, '\t- [ ] Book train', '- [ ] Next']);
        expect(updated([`- [ ] Trip %%things:${A}%%`, '- [ ] Next'], 'Trip', { notes: 'Pack light' })).toEqual([`- [ ] Trip %%things:${A}%%`, '    Pack light', '- [ ] Next']);
    });
});

describe('applyThingsEdits: checklist', () => {
    const trip = [`- [ ] Trip %%things:${A}%%`, '\t- [ ] Book train', '\t- [ ] Book hotel', '\t- [ ] Pack', '- [ ] Next'];
    const item = (title: string, done = false) => ({ title, done });

    it('ticks, renames and appends items in order', () => {
        const list = [item('Book train', true), item('Book a hotel'), item('Pack'), item('Buy snacks')];
        const out = updated(trip, 'Trip', { checklist: list });
        expect(out).toEqual([`- [ ] Trip %%things:${A}%%`, '\t- [x] Book train', '\t- [ ] Book a hotel', '\t- [ ] Pack', '\t- [ ] Buy snacks', '- [ ] Next']);
        expect(task(out, 'Trip').fields.checklist).toEqual(list);
    });

    it('keeps an item Things deleted as a plain bullet after the items that remain', () => {
        const out = updated(trip, 'Trip', { checklist: [item('Book train'), item('Pack')] });
        expect(out).toEqual([`- [ ] Trip %%things:${A}%%`, '\t- [ ] Book train', '\t- [ ] Pack', '\t- Book hotel', '- [ ] Next']);
        expect(task(out, 'Trip').fields.checklist).toEqual([item('Book train'), item('Pack')]);
        const added = updated(trip, 'Trip', { checklist: [item('Book train'), item('Pack'), item('Buy snacks')] });
        expect(added).toEqual([`- [ ] Trip %%things:${A}%%`, '\t- [ ] Book train', '\t- [ ] Pack', '\t- [ ] Buy snacks', '\t- Book hotel', '- [ ] Next']);
    });

    it('never turns a deleted first item into notes while other items remain', () => {
        const lines = [`- [ ] Trip %%things:${A}%%`, '\tPack light', '\t- [ ] Book hotel', '\t\tnear the station', '\t- [ ] Pack', '- [ ] Next'];
        const out = updated(lines, 'Trip', { checklist: [item('Pack')] });
        expect(out).toEqual([`- [ ] Trip %%things:${A}%%`, '\tPack light', '\t- [ ] Pack', '\t- Book hotel', '\t\tnear the station', '- [ ] Next']);
        expect(task(out, 'Trip').fields).toMatchObject({ notes: 'Pack light', checklist: [item('Pack')] });
    });

    it('keeps the only item Things deleted at the end of the task, where it reads as notes', () => {
        const lines = [`- [ ] Trip %%things:${A}%%`, '\t- [ ] Book hotel', '- [ ] Next'];
        const out = updated(lines, 'Trip', { checklist: [] });
        expect(out).toEqual([`- [ ] Trip %%things:${A}%%`, '\t- Book hotel', '- [ ] Next']);
        expect(task(out, 'Trip').fields).toMatchObject({ notes: '- Book hotel', checklist: [] });
    });

    it('puts an item Things added in the middle where Things has it', () => {
        const list = [item('Book train'), item('Buy tickets'), item('Book hotel'), item('Pack')];
        const out = updated(trip, 'Trip', { checklist: list });
        expect(out).toEqual([`- [ ] Trip %%things:${A}%%`, '\t- [ ] Book train', '\t- [ ] Buy tickets', '\t- [ ] Book hotel', '\t- [ ] Pack', '- [ ] Next']);
        expect(task(out, 'Trip').fields.checklist).toEqual(list);
    });

    it('writes a first checklist as subtasks, each on one line', () => {
        const out = updated([`- [ ] Trip %%things:${A}%%`, '- [ ] Next'], 'Trip', { checklist: [item('Pack\nbags'), item('Go', true)] });
        expect(out).toEqual([`- [ ] Trip %%things:${A}%%`, '\t- [ ] Pack bags', '\t- [x] Go', '- [ ] Next']);
    });
});

describe('applyThingsEdits: move within the note', () => {
    const plan = ['# Plan', `- [ ] Loose %%things:${A}%%`, '', '## Doing', `- [ ] Write spec %%things:${B}%%`, '', '## Done'];

    it('moves a task to the bottom of another heading', () => {
        const result = applyThingsEdits(plan, [{ kind: 'move', task: task(plan, 'Loose'), to: { path: PATH, heading: 'Doing' } }], fmt);
        expect(result).toEqual({ lines: ['# Plan', '', '## Doing', `- [ ] Write spec %%things:${B}%%`, `- [ ] Loose %%things:${A}%%`, '', '## Done'], missed: 0 });
    });

    it('moves a task to no heading, under the title', () => {
        const { lines } = applyThingsEdits(plan, [{ kind: 'move', task: task(plan, 'Write spec'), to: { path: PATH } }], fmt);
        expect(lines).toEqual(['# Plan', `- [ ] Loose %%things:${A}%%`, `- [ ] Write spec %%things:${B}%%`, '', '## Doing', '', '## Done']);
    });

    it('adds a heading the note lacks at the note\'s heading level', () => {
        const { lines } = applyThingsEdits(plan, [{ kind: 'move', task: task(plan, 'Loose'), to: { path: PATH, heading: 'Later' } }], fmt);
        expect(lines).toEqual(['# Plan', '', '## Doing', `- [ ] Write spec %%things:${B}%%`, '', '## Done', '', '## Later', `- [ ] Loose %%things:${A}%%`]);
    });

    it('leaves a move to another note to the round, and counts a task that cannot move', () => {
        expect(applyThingsEdits(plan, [{ kind: 'move', task: task(plan, 'Loose'), to: { path: 'Work/Other.md' } }], fmt)).toEqual({ lines: plan, missed: 0 });
        const callout = [`> - [ ] In a callout %%things:${A}%%`, '', '## Doing', '- [ ] Other'];
        expect(applyThingsEdits(callout, [{ kind: 'move', task: task(callout, 'In a callout'), to: { path: PATH, heading: 'Doing' } }], fmt)).toEqual({ lines: callout, missed: 1 });
        expect(applyThingsEdits(callout, [{ kind: 'move', task: task(callout, 'In a callout'), to: { path: PATH, heading: 'Later' } }], fmt)).toEqual({ lines: callout, missed: 1 });
    });

    it('treats a blank heading name as no heading, so the same move settles after one round', () => {
        let lines = plan;
        const rounds = [1, 2, 3].map(() => {
            const result = applyThingsEdits(lines, [{ kind: 'move', task: task(lines, 'Write spec'), to: { path: PATH, heading: '  ' } }], fmt);
            lines = result.lines;
            return result;
        });
        expect(rounds[0]).toEqual({ lines: ['# Plan', `- [ ] Loose %%things:${A}%%`, `- [ ] Write spec %%things:${B}%%`, '', '## Doing', '', '## Done'], missed: 0 });
        expect(rounds[1]).toEqual(rounds[0]);
        expect(rounds[2]).toEqual(rounds[0]);
    });

    it('counts a task already under the heading, in any case, as moved', () => {
        const lines = ['# Plan', '## doing', '- [ ] Other', `- [ ] Write spec %%things:${A}%%`];
        expect(applyThingsEdits(lines, [{ kind: 'move', task: task(lines, 'Write spec'), to: { path: PATH, heading: 'Doing' } }], fmt)).toEqual({ lines, missed: 0 });
    });
});

describe('applyThingsEdits: add', () => {
    it('adds a to-do at the top of its heading\'s tasks, with its ID, notes and checklist', () => {
        const lines = ['# Plan', '- [ ] Loose', '', '## Doing', '- [ ] Write spec'];
        const review = todo(A, 'Review PR', {
            notes: 'Check the tests', checklist: [{ title: 'Read diff', done: false }],
            tags: ['Priority 1', 'work'], when: '2026-11-25', reminder: '09:00'
        });
        const result = applyThingsEdits(lines, [{ kind: 'add', todo: review, to: { path: PATH, heading: 'Doing' } }], fmt);
        expect(result).toEqual({
            lines: ['# Plan', '- [ ] Loose', '', '## Doing', `- [!1] Review PR #work 2026-11-25 09:00 %%things:${A}%%`, '    Check the tests', '\t- [ ] Read diff', '- [ ] Write spec'],
            missed: 0
        });
        const back = task(result.lines, 'Review PR');
        expect(back).toMatchObject({ id: A, heading: 'Doing', fields: review.fields });
    });

    it('adds a heading the note lacks before the line, several in step order', () => {
        const lines = ['# Plan', '- [ ] Loose'];
        const { lines: out } = applyThingsEdits(lines, [
            { kind: 'add', todo: todo(A, 'First'), to: { path: PATH, heading: 'Phase 1' } },
            { kind: 'add', todo: todo(B, 'Second'), to: { path: PATH, heading: 'Phase 2' } },
            { kind: 'add', todo: todo(C, 'Third'), to: { path: PATH, heading: 'Phase 1' } }
        ], fmt);
        expect(out).toEqual(['# Plan', '- [ ] Loose', '', '## Phase 1', `- [ ] Third %%things:${C}%%`, `- [ ] First %%things:${A}%%`, '', '## Phase 2', `- [ ] Second %%things:${B}%%`]);
    });

    it('adds a to-do with no heading above the note\'s first section', () => {
        const titled = ['# Plan', '- [ ] Loose', '', '## Doing', '- [ ] Write spec'];
        const add = (lines: string[]) => applyThingsEdits(lines, [{ kind: 'add', todo: todo(A, 'New'), to: { path: PATH } }], fmt).lines;
        expect(add(titled)).toEqual(['# Plan', `- [ ] New %%things:${A}%%`, '- [ ] Loose', '', '## Doing', '- [ ] Write spec']);
        expect(add(['Intro', '', '## Doing', '- [ ] Write spec'])).toEqual(['Intro', `- [ ] New %%things:${A}%%`, '', '## Doing', '- [ ] Write spec']);
        expect(add(['- [ ] Old'])).toEqual(['- [ ] Old', `- [ ] New %%things:${A}%%`]);
    });

    it('uses a heading the note has in another case rather than adding one', () => {
        const lines = ['# Plan', '- [ ] Loose', '', '## doing', '- [ ] Write spec'];
        expect(applyThingsEdits(lines, [{ kind: 'add', todo: todo(A, 'New'), to: { path: PATH, heading: 'Doing' } }], fmt).lines)
            .toEqual(['# Plan', '- [ ] Loose', '', '## doing', `- [ ] New %%things:${A}%%`, '- [ ] Write spec']);
        expect(applyThingsEdits(lines, [{ kind: 'move', task: task(lines, 'Loose'), to: { path: PATH, heading: 'Doing' } }], fmt))
            .toEqual({ lines: ['# Plan', '', '## doing', '- [ ] Write spec', '- [ ] Loose'], missed: 0 });
    });

    it('adds nothing for a blank heading name', () => {
        const lines = ['# Plan', '- [ ] Loose'];
        expect(applyThingsEdits(lines, [{ kind: 'add', todo: todo(A, 'New'), to: { path: PATH, heading: ' ' } }], fmt).lines).toEqual(['# Plan', `- [ ] New %%things:${A}%%`, '- [ ] Loose']);
        const sections = ['# Plan', '## Design', '- [ ] a'];
        expect(applyThingsEdits(sections, [{ kind: 'headings', path: PATH, from: ['Design'], to: [' '] }], fmt).lines).toEqual(sections);
    });

    it('writes a Things title with newlines on one line', () => {
        const { lines } = applyThingsEdits([], [{ kind: 'add', todo: todo(A, 'Line one\nLine two', { checklist: [{ title: 'a\nb', done: false }] }), to: { path: PATH } }], fmt);
        expect(lines).toEqual([`- [ ] Line one Line two %%things:${A}%%`, '\t- [ ] a b']);
    });

    it('writes someday, status and tags the way the line reads them back', () => {
        const done = todo(A, 'Old idea', { status: 'completed', someday: true, tags: ['Deep Work'] });
        const { lines } = applyThingsEdits([], [{ kind: 'add', todo: done, to: { path: PATH } }], fmt);
        expect(lines).toEqual([`- [x] Old idea #Deep-Work #someday %%things:${A}%%`]);
        expect(task(lines, 'Old idea').fields).toEqual(done.fields);
    });
});

describe('applyThingsEdits: titles that break Markdown or URLs', () => {
    // `#1` has no letter so it stays words, and a link reads as the words it shows (mapping.test.ts reads this same line).
    const title = 'Fix #1 & 50% of [[A|b]] 🎉';
    const readsAs = 'Fix #1 & 50% of b 🎉';

    it('writes one on one line through add, and reads it back as the vault reads that text', () => {
        const { lines } = applyThingsEdits(['- [ ] Next'], [{ kind: 'add', todo: todo(A, title), to: { path: PATH } }], fmt);
        expect(lines).toEqual(['- [ ] Next', `- [ ] ${title} %%things:${A}%%`]);
        expect(task(lines, readsAs).fields).toMatchObject({ title: readsAs, tags: [] });
    });

    it('writes one on one line through update, and Things\' own words come back unchanged', () => {
        const lines = [`- [ ] Fix it %%things:${A}%%`, '- [ ] Next'];
        const literal = updated(lines, 'Fix it', { title });
        expect(literal).toEqual([`- [ ] ${title} %%things:${A}%%`, '- [ ] Next']);
        expect(task(literal, readsAs).fields).toMatchObject({ title: readsAs, tags: [] });
        const linked = [`- [ ] Fix #1 of [[A|b]] %%things:${A}%%`];
        const out = updated(linked, 'Fix #1 of b', { title: readsAs });
        expect(out).toEqual([`- [ ] ${title} %%things:${A}%%`]);
        expect(read(out)[0].fields.title).toBe(readsAs);
    });
});

describe('applyThingsEdits: retire', () => {
    it('makes the line a plain bullet with a dated note, keeping its notes, subtasks and calendar ID', () => {
        const lines = [`- [ ] Trip %%things:${A}%% %%cal:0fq7k2m9vd3a%%`, '\tPack light', '\t- [ ] Book train', '- [ ] Next'];
        const result = applyThingsEdits(lines, [{ kind: 'retire', task: task(lines, 'Trip') }], fmt);
        expect(result).toEqual({
            lines: ['- Trip %%cal:0fq7k2m9vd3a%%', '\tPack light', '\t- Book train', '\t- 2026-11-22: deleted in Things, no longer synced.', '- [ ] Next'],
            missed: 0
        });
    });

    it('makes every checkbox under a retired line a plain bullet, done or not, at any depth', () => {
        const lines = [`- [ ] Trip %%things:${A}%%`, '\t- [ ] Book hotel', '\t- [x] Book train', '\t\t- [ ] Pick a seat', '- [ ] Next'];
        const { lines: out } = applyThingsEdits(lines, [{ kind: 'retire', task: task(lines, 'Trip') }], fmt);
        expect(out).toEqual(['- Trip', '\t- Book hotel', '\t- Book train', '\t\t- Pick a seat', '\t- 2026-11-22: deleted in Things, no longer synced.', '- [ ] Next']);
        expect(out.slice(0, 5).filter(line => parseTaskLine(line))).toEqual([]);
        expect(read(out).map(t => t.fields.title)).toEqual(['Next']);
    });

    it('keeps a callout line in its callout', () => {
        const lines = [`> - [ ] Call Mom %%things:${A}%%`, '> More'];
        const { lines: out } = applyThingsEdits(lines, [{ kind: 'retire', task: task(lines, 'Call Mom') }], fmt);
        expect(out).toEqual(['> - Call Mom', '> \t- 2026-11-22: deleted in Things, no longer synced.', '> More']);
    });
});

describe('applyThingsEdits: headings', () => {
    const steps = (from: string[], to: string[]): VaultStep[] => [{ kind: 'headings', path: PATH, from, to }];

    it('renames a heading in place when the count is the same', () => {
        const lines = ['# Plan', '## Design', '- [ ] a', '## Build', '- [ ] b'];
        expect(applyThingsEdits(lines, steps(['Design', 'Build'], ['Design', 'Make']), fmt)).toEqual({
            lines: ['# Plan', '## Design', '- [ ] a', '## Make', '- [ ] b'],
            missed: 0
        });
    });

    it('renames a heading the note writes in another case', () => {
        const lines = ['# Plan', '## design', '- [ ] a'];
        expect(applyThingsEdits(lines, steps(['Design'], ['Research']), fmt).lines).toEqual(['# Plan', '## Research', '- [ ] a']);
    });

    it('reorders headings with their tasks rather than renaming them', () => {
        const lines = ['# Plan', '## Design', '- [ ] a', '## Build', '- [ ] b'];
        expect(applyThingsEdits(lines, steps(['Design', 'Build'], ['Build', 'Design']), fmt).lines).toEqual(['# Plan', '## Build', '- [ ] b', '## Design', '- [ ] a']);
    });

    it('adds a new heading where Things has it and keeps headings Things dropped', () => {
        const lines = ['# Plan', '', '## Design', '- [ ] a', '', '## Build', '- [ ] b', '', '## Test', '- [ ] c'];
        expect(applyThingsEdits(lines, steps(['Design', 'Build', 'Test'], ['Research', 'Build']), fmt).lines).toEqual([
            '# Plan', '', '## Design', '- [ ] a', '', '## Research', '', '## Build', '- [ ] b', '', '## Test', '- [ ] c'
        ]);
    });

    it('keeps following tasks after headings move', () => {
        const lines = ['# Plan', '## Design', '- [ ] Same', '## Build', '- [ ] Same'];
        const second = read(lines)[1];
        const { lines: out } = applyThingsEdits(lines, [...steps(['Design', 'Build'], ['Build', 'Design']), { kind: 'adopt', task: second, id: B }], fmt);
        expect(out).toEqual(['# Plan', '## Build', `- [ ] Same %%things:${B}%%`, '## Design', '- [ ] Same']);
    });
});

describe('newNoteContent', () => {
    it('writes the title, loose to-dos, then each heading with its to-dos', () => {
        const content = newNoteContent('Launch\nplan', ['Design', 'Build'], [
            todo(A, 'Ship it', {}, { heading: 'Build' }),
            todo(B, 'Decide scope'),
            todo(C, 'Sketch', { notes: 'Rough is fine', checklist: [{ title: 'Paper', done: true }] }, { heading: 'Design' })
        ], fmt);
        expect(content).toBe([
            '# Launch plan',
            `- [ ] Decide scope %%things:${B}%%`,
            '',
            '## Design',
            `- [ ] Sketch %%things:${C}%%`,
            '    Rough is fine',
            '\t- [x] Paper',
            '',
            '## Build',
            `- [ ] Ship it %%things:${A}%%`,
            ''
        ].join('\n'));
        expect(read(content.split('\n')).map(t => [t.fields.title, t.heading, t.id])).toEqual([
            ['Decide scope', undefined, B], ['Sketch', 'Design', C], ['Ship it', 'Build', A]
        ]);
    });

    it('writes each to-do exactly as an add would', () => {
        const sketch = todo(C, 'Sketch', { notes: 'Rough is fine', checklist: [{ title: 'Paper', done: true }] }, { heading: 'Design' });
        const added = applyThingsEdits(['# Launch plan'], [{ kind: 'add', todo: sketch, to: { path: PATH, heading: 'Design' } }], fmt).lines;
        expect(newNoteContent('Launch plan', ['Design'], [sketch], fmt)).toBe(`${added.join('\n')}\n`);
    });

    it('leaves out blank and repeated headings, so no to-do is written twice', () => {
        const content = newNoteContent('Plan', ['', 'Build', 'Build'], [todo(A, 'Loose', {}, { heading: '' }), todo(B, 'Ship', {}, { heading: 'Build' })], fmt);
        expect(content).toBe(`# Plan\n- [ ] Loose %%things:${A}%%\n\n## Build\n- [ ] Ship %%things:${B}%%\n`);
    });

    it('puts a to-do whose heading the note doesn\'t list under the title', () => {
        expect(newNoteContent('Plan', [], [todo(A, 'Stray', {}, { heading: 'Gone' })], fmt)).toBe(`# Plan\n- [ ] Stray %%things:${A}%%\n`);
    });
});
