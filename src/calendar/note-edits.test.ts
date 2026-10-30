import { applyNoteEdits } from './note-edits';

const note = [
    '# Inbox',
    '',
    '- [ ] Call Mom 2026-10-30 15:00',
    '\t- ask about the trip',
    '- [ ] Pay rent 2026-11-01 %%cal:0fq7k2m9vd3a%%',
    '- [ ] Undated'
];

describe('applyNoteEdits', () => {
    it('writes a new calendar id last on the line', () => {
        const { lines } = applyNoteEdits(note, [{ kind: 'ref', line: 2, text: 'Call Mom 2026-10-30 15:00', ref: { id: 'aaaaaaaaaaaa', rev: 0 } }]);
        expect(lines[2]).toBe('- [ ] Call Mom 2026-10-30 15:00 %%cal:aaaaaaaaaaaa%%');
    });

    it('takes an id off', () => {
        const { lines } = applyNoteEdits(note, [{ kind: 'ref', line: 4, text: 'Pay rent 2026-11-01 %%cal:0fq7k2m9vd3a%%', ref: null }]);
        expect(lines[4]).toBe('- [ ] Pay rent 2026-11-01');
    });

    it('takes a moved event\'s day and time, bumping the revision', () => {
        const { lines } = applyNoteEdits(note, [{
            kind: 'due', line: 4, text: 'Pay rent 2026-11-01 %%cal:0fq7k2m9vd3a%%', dateText: '2026-11-01',
            date: '2026-11-03', time: '09:30', ref: { id: '0fq7k2m9vd3a', rev: 1 }
        }]);
        expect(lines[4]).toBe('- [ ] Pay rent 2026-11-03 09:30 %%cal:0fq7k2m9vd3a:1%%');
    });

    it('drops the time when the event became all-day', () => {
        const { lines } = applyNoteEdits(['- [ ] Call 2026-10-30 15:00 %%cal:0fq7k2m9vd3a%%'], [{
            kind: 'due', line: 0, text: 'Call 2026-10-30 15:00 %%cal:0fq7k2m9vd3a%%', dateText: '2026-10-30 15:00', timeText: '15:00',
            date: '2026-10-31', time: null, ref: { id: '0fq7k2m9vd3a', rev: 1 }
        }]);
        expect(lines[0]).toBe('- [ ] Call 2026-10-31 %%cal:0fq7k2m9vd3a:1%%');
    });

    it('clears a date and notes why under the task, after its notes', () => {
        const withId = note.map((line, i) => i === 2 ? `${line} %%cal:aaaaaaaaaaaa%%` : line);
        const { lines } = applyNoteEdits(withId, [{
            kind: 'clear', line: 2, text: 'Call Mom 2026-10-30 15:00 %%cal:aaaaaaaaaaaa%%', dateText: '2026-10-30 15:00',
            note: '2026-10-30: the calendar event was deleted, so the date 2026-10-30 15:00 was cleared.'
        }]);
        expect(lines.slice(2, 6)).toEqual([
            '- [ ] Call Mom',
            '\t- ask about the trip',
            '\t- 2026-10-30: the calendar event was deleted, so the date 2026-10-30 15:00 was cleared.',
            '- [ ] Pay rent 2026-11-01 %%cal:0fq7k2m9vd3a%%'
        ]);
    });

    it('finds a task that moved, and skips one that changed', () => {
        const shifted = ['New first line', ...note];
        const { lines, missed } = applyNoteEdits(shifted, [
            { kind: 'ref', line: 2, text: 'Call Mom 2026-10-30 15:00', ref: { id: 'aaaaaaaaaaaa', rev: 0 } },
            { kind: 'ref', line: 6, text: 'Undated but different', ref: { id: 'bbbbbbbbbbbb', rev: 0 } }
        ]);
        expect(lines[3]).toBe('- [ ] Call Mom 2026-10-30 15:00 %%cal:aaaaaaaaaaaa%%');
        expect(missed).toBe(1);
    });

    it('keeps several edits in one note straight', () => {
        const { lines } = applyNoteEdits(note, [
            { kind: 'clear', line: 4, text: 'Pay rent 2026-11-01 %%cal:0fq7k2m9vd3a%%', dateText: '2026-11-01', note: 'cleared' },
            { kind: 'ref', line: 2, text: 'Call Mom 2026-10-30 15:00', ref: { id: 'aaaaaaaaaaaa', rev: 0 } }
        ]);
        expect(lines).toEqual([
            '# Inbox', '',
            '- [ ] Call Mom 2026-10-30 15:00 %%cal:aaaaaaaaaaaa%%',
            '\t- ask about the trip',
            '- [ ] Pay rent',
            '\t- cleared',
            '- [ ] Undated'
        ]);
    });
});
