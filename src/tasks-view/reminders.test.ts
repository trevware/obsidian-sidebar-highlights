import { LONGEST_WAIT, Reminder, TimedTask, dueBetween, nextWait, reminderAt, reminderTitle, remindersFor } from './reminders';

const at = (date: string, time: string) => reminderAt(date, time, 0);

const task = (date: string, time: string, text = 'Call Mom'): TimedTask => ({ path: 'Inbox.md', line: 0, text, date, time });

describe('reminderAt', () => {
    it('is the task\'s day and time on the device clock', () => {
        expect(new Date(at('2026-10-30', '15:00'))).toEqual(new Date(2026, 9, 30, 15, 0));
    });
    it('takes the lead off, across midnight when it has to', () => {
        expect(new Date(reminderAt('2026-10-30', '15:00', 10))).toEqual(new Date(2026, 9, 30, 14, 50));
        expect(new Date(reminderAt('2026-10-31', '00:15', 30))).toEqual(new Date(2026, 9, 30, 23, 45));
    });
});

describe('remindersFor', () => {
    it('puts the earliest first', () => {
        const reminders = remindersFor([task('2026-10-31', '09:00', 'b'), task('2026-10-30', '15:00', 'a')], 0);
        expect(reminders.map(reminder => reminder.text)).toEqual(['a', 'b']);
    });
});

describe('dueBetween', () => {
    const reminders: Reminder[] = remindersFor([
        task('2026-10-30', '09:00', 'morning'),
        task('2026-10-30', '15:00', 'afternoon'),
        task('2026-10-29', '20:00', 'yesterday')
    ], 0);

    it('shows a reminder whose time came since the last look', () => {
        const due = dueBetween(reminders, at('2026-10-30', '14:59'), at('2026-10-30', '15:00'));
        expect(due.map(reminder => reminder.text)).toEqual(['afternoon']);
    });
    it('never shows one twice', () => {
        expect(dueBetween(reminders, at('2026-10-30', '15:00'), at('2026-10-30', '15:01'))).toEqual([]);
    });
    it('catches up on today\'s reminders missed while Obsidian was closed', () => {
        const due = dueBetween(reminders, at('2026-10-29', '18:00'), at('2026-10-30', '16:00'));
        expect(due.map(reminder => reminder.text)).toEqual(['morning', 'afternoon']);
    });
    it('drops one whose day has ended', () => {
        const due = dueBetween(reminders, at('2026-10-29', '18:00'), at('2026-10-30', '08:00'));
        expect(due).toEqual([]);
    });
    it('keeps a reminder set off the evening before its task', () => {
        const early = remindersFor([task('2026-10-31', '00:15')], 30);
        expect(dueBetween(early, at('2026-10-30', '23:44'), at('2026-10-30', '23:45'))).toHaveLength(1);
    });
});

describe('nextWait', () => {
    const reminders = remindersFor([task('2026-10-30', '15:00')], 0);

    it('waits until the next reminder', () => {
        expect(nextWait(reminders, at('2026-10-30', '15:00') - 5_000)).toBe(5_000);
    });
    it('looks again within a minute, so waking from sleep catches up', () => {
        expect(nextWait(reminders, at('2026-10-30', '09:00'))).toBe(LONGEST_WAIT);
        expect(nextWait([], at('2026-10-30', '09:00'))).toBe(LONGEST_WAIT);
    });
    it('skips reminders already gone by', () => {
        expect(nextWait(reminders, at('2026-10-30', '16:00'))).toBe(LONGEST_WAIT);
    });
});

describe('reminderTitle', () => {
    it('drops the date and time and a trailing marker link', () => {
        expect(reminderTitle('Call Mom 2026-10-30 15:00 [↗](https://example.com/1)', '2026-10-30 15:00', true)).toBe('Call Mom');
    });
    it('reduces links and formatting to the words they show', () => {
        expect(reminderTitle('Send **draft** to [[Sarah Chen|Sarah]] about [[Q3 plan]] and [the doc](https://x.y) `now` 2026-10-30 15:00', '2026-10-30 15:00', true))
            .toBe('Send draft to Sarah about Q3 plan and the doc now');
        expect(reminderTitle('Read *chapter one* ==today== %%private%% 2026-10-30 9am', '2026-10-30 9am', true)).toBe('Read chapter one today');
    });
    it('hides Tasks plugin metadata when that setting is on', () => {
        expect(reminderTitle('Pay rent 🔁 every month 2026-10-30 15:00', '2026-10-30 15:00', true)).toBe('Pay rent');
        expect(reminderTitle('Pay rent 🔁 every month 2026-10-30 15:00', '2026-10-30 15:00', false)).toBe('Pay rent 🔁 every month');
    });
    it('leaves snake_case and lone asterisks alone', () => {
        expect(reminderTitle('Rename user_id to 5 * 3 2026-10-30 15:00', '2026-10-30 15:00', true)).toBe('Rename user_id to 5 * 3');
    });
});
