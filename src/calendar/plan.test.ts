import { CalendarEvent, NoteInfo, SETTLE_MS, SyncOptions, SyncTask, Written, planSync } from './plan';

const NOW = Date.UTC(2026, 9, 30, 20, 0);
const options: SyncOptions = { timedOnly: false, clearOnDelete: true };

function task(over: Partial<SyncTask> = {}): SyncTask {
    return { path: 'Inbox.md', line: 2, text: 'Call Mom', title: 'Call Mom', date: '2026-10-30', time: '15:00', open: true, ...over };
}

function written(over: Partial<Written> = {}): Written {
    return { rev: 0, date: '2026-10-30', time: '15:00', title: 'Call Mom', path: 'Inbox.md', at: NOW - 60_000, ...over };
}

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
    return { id: 'aaaaaaaaaaaa', date: '2026-10-30', time: '15:00', title: 'Call Mom', written: written(), ...over };
}

const synced = (over: Partial<SyncTask> = {}) => task({ ref: { id: 'aaaaaaaaaaaa', rev: 0 }, ...over });

function notes(mtimes: Record<string, number> = {}): NoteInfo {
    return { exists: (path) => path in mtimes, mtime: (path) => mtimes[path] ?? 0 };
}

function steps(tasks: SyncTask[], events: CalendarEvent[], opts = options, info = notes({ 'Inbox.md': NOW - 120_000 })) {
    const plan = planSync(tasks, events, opts, info, NOW);
    if (!plan.ok) throw new Error(plan.reason);
    return plan.steps.map(step => step.kind === 'remove' ? `remove ${step.id}` : `${step.kind} ${step.task.title}`);
}

describe('planSync: new tasks', () => {
    it('creates an event for a dated open task', () => {
        expect(steps([task()], [])).toEqual(['create Call Mom']);
    });
    it('makes all-day events for tasks with only a date, unless only timed tasks sync', () => {
        expect(steps([task({ time: undefined })], [])).toEqual(['create Call Mom']);
        expect(steps([task({ time: undefined })], [], { ...options, timedOnly: true })).toEqual([]);
    });
    it('skips done tasks and tasks without a date', () => {
        expect(steps([task({ open: false }), task({ date: undefined })], [])).toEqual([]);
    });
});

describe('planSync: changes in the note', () => {
    it('does nothing when nothing changed', () => {
        expect(steps([synced()], [event()])).toEqual([]);
    });
    it('updates the event when the task is re-dated, re-timed, reworded or moved to another note', () => {
        expect(steps([synced({ date: '2026-11-02' })], [event()])).toEqual(['update Call Mom']);
        expect(steps([synced({ time: '16:30' })], [event()])).toEqual(['update Call Mom']);
        expect(steps([synced({ title: 'Call Dad' })], [event()])).toEqual(['update Call Dad']);
        expect(steps([synced({ path: 'Projects/Family.md' })], [event()])).toEqual(['update Call Mom']);
    });
    it('puts the title back when the event was renamed in the calendar', () => {
        expect(steps([synced()], [event({ title: 'Renamed' })])).toEqual(['update Call Mom']);
    });
    it('removes the event and the id when the task is done, loses its date, or loses its time with timed-only on', () => {
        expect(steps([synced({ open: false })], [event()])).toEqual(['remove aaaaaaaaaaaa', 'unlink Call Mom']);
        expect(steps([synced({ date: undefined, time: undefined })], [event()])).toEqual(['remove aaaaaaaaaaaa', 'unlink Call Mom']);
        expect(steps([synced({ time: undefined })], [event()], { ...options, timedOnly: true })).toEqual(['remove aaaaaaaaaaaa', 'unlink Call Mom']);
    });
});

describe('planSync: changes in the calendar', () => {
    it('pulls a moved event into the task and bumps the revision', () => {
        const plan = planSync([synced()], [event({ date: '2026-11-03', time: '09:30' })], options, notes(), NOW);
        expect(plan).toEqual({ ok: true, steps: [expect.objectContaining({ kind: 'pull', rev: 1 })] });
    });
    it('pulls an event turned all-day', () => {
        expect(steps([synced()], [event({ time: undefined })])).toEqual(['pull Call Mom']);
    });
    it('lets the note win when both moved', () => {
        expect(steps([synced({ date: '2026-11-01' })], [event({ date: '2026-11-03' })])).toEqual(['update Call Mom']);
    });
    it('leaves the event alone while this device\'s note is behind the calendar', () => {
        const ahead = event({ date: '2026-11-03', written: written({ rev: 2, date: '2026-11-03' }) });
        expect(steps([synced({ ref: { id: 'aaaaaaaaaaaa', rev: 1 } })], [ahead])).toEqual([]);
    });
    it('records a newer revision from the note', () => {
        expect(steps([synced({ ref: { id: 'aaaaaaaaaaaa', rev: 2 } })], [event({ written: written({ rev: 1 }) })])).toEqual(['update Call Mom']);
    });
});

describe('planSync: deleted events', () => {
    it('clears the task when its event was deleted', () => {
        expect(steps([synced()], [])).toEqual(['clear Call Mom']);
        expect(steps([synced()], [event({ cancelled: true })])).toEqual(['clear Call Mom']);
    });
    it('brings the event back when clearing is off', () => {
        expect(steps([synced()], [], { ...options, clearOnDelete: false })).toEqual(['update Call Mom']);
    });
    it('only unlinks a done task whose event is gone', () => {
        expect(steps([synced({ open: false })], [])).toEqual(['unlink Call Mom']);
    });
    it('stops when too many events vanish at once', () => {
        const tasks = ['a', 'b', 'c', 'd', 'e'].map((c, i) => synced({ line: i, title: c, ref: { id: c.repeat(12), rev: 0 } }));
        expect(planSync(tasks, [], options, notes(), NOW)).toEqual({ ok: false, reason: 'calendar-emptied', missing: 5 });
    });
});

describe('planSync: events whose task is gone', () => {
    const orphan = event({ id: 'bbbbbbbbbbbb', written: written({ at: NOW - 2 * SETTLE_MS }) });
    it('removes the event once the note changed after it and has settled', () => {
        expect(steps([], [orphan], options, notes({ 'Inbox.md': NOW - SETTLE_MS }))).toEqual(['remove bbbbbbbbbbbb']);
    });
    it('waits while the note is still settling, or is older than the event', () => {
        expect(steps([], [orphan], options, notes({ 'Inbox.md': NOW - 30_000 }))).toEqual([]);
        expect(steps([], [orphan], options, notes({ 'Inbox.md': NOW - 3_600_000 }))).toEqual([]);
    });
    it('keeps events whose note this device doesn\'t have', () => {
        expect(steps([], [orphan], options, notes({}))).toEqual([]);
    });
    it('never touches events the plugin didn\'t make', () => {
        expect(steps([], [event({ written: undefined })], options, notes({ 'Inbox.md': NOW - SETTLE_MS }))).toEqual([]);
    });
});

describe('planSync: copied lines', () => {
    it('gives a copied task its own event', () => {
        const first = synced({ line: 2 });
        const copy = synced({ line: 5, title: 'Call Mom copy' });
        expect(steps([copy, first], [event()])).toEqual(['create Call Mom copy']);
    });
});
