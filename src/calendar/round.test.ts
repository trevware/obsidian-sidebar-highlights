import type { Task } from '../../main';
import { readCalendarRef } from './ids';
import { applyNoteEdits } from './note-edits';
import type { CalendarEvent, SyncOptions } from './plan';
import { SETTLE_MS } from './plan';
import type { CalendarProvider, EventDraft } from './providers/types';
import { RoundDeps, runRound, syncTasks } from './round';
import { parseTaskLine } from '../tasks-view/task-line';
import { readTimeAfter } from '../tasks-view/times';

/** A calendar in memory, standing in for Google, Outlook or CalDAV. */
class FakeCalendar implements CalendarProvider {
    events = new Map<string, CalendarEvent>();
    puts = 0;
    async list(): Promise<CalendarEvent[]> {
        return [...this.events.values()].map(event => ({ ...event }));
    }
    async put(draft: EventDraft): Promise<void> {
        this.puts++;
        this.events.set(draft.id, { id: draft.id, date: draft.date, time: draft.time, title: draft.title, written: draft.written });
    }
    async remove(id: string): Promise<void> {
        this.events.delete(id);
    }
    /** The user drags the event somewhere else in their calendar app. */
    move(id: string, date: string, time?: string): void {
        const event = this.events.get(id)!;
        this.events.set(id, { ...event, date, time });
    }
}

/** Reads tasks out of a note the way the plugin does, enough for these tests. */
function readTasks(path: string, lines: string[]): Task[] {
    const tasks: Task[] = [];
    lines.forEach((line, i) => {
        const parsed = parseTaskLine(line);
        if (!parsed) return;
        const match = parsed.text.match(/\d{4}-\d{2}-\d{2}/);
        const time = match ? readTimeAfter(parsed.text, match.index! + match[0].length) : undefined;
        tasks.push({
            id: `${path}:${i}`, text: parsed.text, completed: parsed.state === 'x', status: parsed.state === 'x' ? 'done' : 'todo',
            flagged: false, filePath: path, lineNumber: i, context: [], indentLevel: 0,
            date: match?.[0], dateText: match ? parsed.text.slice(match.index, time ? time.end : match.index! + 10) : undefined,
            time: time?.time, timeText: time?.text, marker: parsed.state
        } as Task);
    });
    return tasks;
}

const options: SyncOptions = { timedOnly: false, clearOnDelete: true };

/** One device: its own copy of the notes, sharing the calendar. */
class Device {
    notes = new Map<string, { lines: string[]; mtime: number }>();
    constructor(public calendar: FakeCalendar, public clock: { now: number }) {}

    write(path: string, lines: string[]): void {
        this.notes.set(path, { lines, mtime: this.clock.now });
    }

    lines(path: string): string[] {
        return this.notes.get(path)!.lines;
    }

    deps(): RoundDeps {
        const tasks = [...this.notes.entries()].flatMap(([path, note]) => readTasks(path, note.lines));
        return {
            tasks: syncTasks(tasks, true, 'Untitled'),
            provider: this.calendar,
            options,
            notes: { exists: (path) => this.notes.has(path), mtime: (path) => this.notes.get(path)?.mtime ?? 0 },
            now: this.clock.now,
            draft: (id, fields, written) => ({ id, ...fields, description: '', link: 'obsidian://open', minutes: 30, timeZone: 'UTC', written }),
            formatDate: (iso) => iso,
            formatTime: (time) => time,
            clearedNote: (date) => `2026-10-30: the calendar event was deleted, so the date ${date} was cleared.`,
            editNote: async (path, edits) => {
                const { lines, missed } = applyNoteEdits(this.lines(path), edits);
                this.write(path, lines);
                return missed;
            }
        };
    }

    round() {
        return runRound(this.deps());
    }
}

function setup() {
    const clock = { now: Date.UTC(2026, 9, 30, 12, 0) };
    const calendar = new FakeCalendar();
    const device = new Device(calendar, clock);
    device.write('Inbox.md', ['# Inbox', '- [ ] Call Mom 2026-10-30 15:00', '- [ ] Pay rent 2026-11-01', '- [ ] No date']);
    return { clock, calendar, device };
}

const idOf = (line: string) => readCalendarRef(line)!.id;

describe('runRound', () => {
    it('creates events and writes their ids into the note', async () => {
        const { calendar, device } = setup();
        expect(await device.round()).toMatchObject({ created: 2 });
        const lines = device.lines('Inbox.md');
        expect(lines[1]).toMatch(/^- \[ \] Call Mom 2026-10-30 15:00 %%cal:[0-9a-v]{12}%%$/);
        expect(calendar.events.get(idOf(lines[1]))).toMatchObject({ title: 'Call Mom', date: '2026-10-30', time: '15:00' });
        expect(calendar.events.get(idOf(lines[2]))).toMatchObject({ title: 'Pay rent', date: '2026-11-01', time: undefined });
    });

    it('settles: a second round changes nothing', async () => {
        const { calendar, device } = setup();
        await device.round();
        const puts = calendar.puts;
        expect(await device.round()).toEqual({ created: 0, updated: 0, pulled: 0, cleared: 0, removed: 0, missed: 0 });
        expect(calendar.puts).toBe(puts);
    });

    it('follows a re-dated task', async () => {
        const { calendar, device } = setup();
        await device.round();
        const lines = [...device.lines('Inbox.md')];
        lines[1] = lines[1].replace('2026-10-30 15:00', '2026-10-31 9:00');
        device.write('Inbox.md', lines);
        expect(await device.round()).toMatchObject({ updated: 1 });
        expect(calendar.events.get(idOf(lines[1]))).toMatchObject({ date: '2026-10-31', time: '09:00' });
    });

    it('takes a moved event into the note, then settles', async () => {
        const { calendar, device } = setup();
        await device.round();
        const id = idOf(device.lines('Inbox.md')[1]);
        calendar.move(id, '2026-11-02', '10:30');
        expect(await device.round()).toMatchObject({ pulled: 1 });
        expect(device.lines('Inbox.md')[1]).toBe(`- [ ] Call Mom 2026-11-02 10:30 %%cal:${id}:1%%`);
        expect(calendar.events.get(id)!.written).toMatchObject({ rev: 1, date: '2026-11-02', time: '10:30' });
        expect(await device.round()).toMatchObject({ pulled: 0, updated: 0 });
    });

    it('clears a task whose event was deleted, and notes why', async () => {
        const { calendar, device } = setup();
        await device.round();
        await calendar.remove(idOf(device.lines('Inbox.md')[1]));
        expect(await device.round()).toMatchObject({ cleared: 1 });
        expect(device.lines('Inbox.md').slice(1, 3)).toEqual([
            '- [ ] Call Mom',
            '\t- 2026-10-30: the calendar event was deleted, so the date 2026-10-30 15:00 was cleared.'
        ]);
        expect(await device.round()).toMatchObject({ created: 0, cleared: 0 });
    });

    it('removes the event of a completed task and takes its id off', async () => {
        const { calendar, device } = setup();
        await device.round();
        const lines = [...device.lines('Inbox.md')];
        const id = idOf(lines[2]);
        lines[2] = lines[2].replace('- [ ]', '- [x]');
        device.write('Inbox.md', lines);
        expect(await device.round()).toMatchObject({ removed: 1 });
        expect(calendar.events.has(id)).toBe(false);
        expect(device.lines('Inbox.md')[2]).toBe('- [x] Pay rent 2026-11-01');
    });

    it('removes the event of a deleted task once the note settles', async () => {
        const { clock, calendar, device } = setup();
        await device.round();
        const id = idOf(device.lines('Inbox.md')[2]);
        clock.now += 60_000;
        device.write('Inbox.md', device.lines('Inbox.md').filter((_, i) => i !== 2));
        expect(await device.round()).toMatchObject({ removed: 0 });
        clock.now += SETTLE_MS;
        expect(await device.round()).toMatchObject({ removed: 1 });
        expect(calendar.events.has(id)).toBe(false);
    });

    it('keeps a lagging second device from undoing a move made in the calendar', async () => {
        const { clock, calendar, device } = setup();
        await device.round();
        const phone = new Device(calendar, clock);
        phone.write('Inbox.md', [...device.lines('Inbox.md')]);
        const id = idOf(device.lines('Inbox.md')[1]);

        calendar.move(id, '2026-11-02', '10:30');
        await device.round();
        // The phone still has the old note when it runs.
        expect(await phone.round()).toMatchObject({ updated: 0, pulled: 0 });
        expect(calendar.events.get(id)).toMatchObject({ date: '2026-11-02', time: '10:30' });
    });
});
