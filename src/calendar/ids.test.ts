import { formatCalendarRef, isCalendarComment, newCalendarId, readCalendarRef, stripCalendarRef, withCalendarRef } from './ids';
import { editableTitle, setDueInText, withTitle } from '../tasks-view/task-line';

describe('calendar ids', () => {
    it('makes ids from Google\'s event-id alphabet', () => {
        for (let i = 0; i < 50; i++) expect(newCalendarId()).toMatch(/^[0-9a-v]{12}$/);
    });

    it('reads an id and its revision', () => {
        expect(readCalendarRef('Call Mom 2026-10-30 15:00 %%cal:0fq7k2m9vd3a%%')).toEqual({ id: '0fq7k2m9vd3a', rev: 0 });
        expect(readCalendarRef('Call Mom %%cal:0fq7k2m9vd3a:4%%')).toEqual({ id: '0fq7k2m9vd3a', rev: 4 });
        expect(readCalendarRef('Call Mom %%a private note%%')).toBeUndefined();
        expect(readCalendarRef('Call Mom %%cal:short%%')).toBeUndefined();
    });

    it('writes the id last on the line, replacing any old one', () => {
        expect(withCalendarRef('Call Mom 2026-10-30', { id: '0fq7k2m9vd3a', rev: 0 })).toBe('Call Mom 2026-10-30 %%cal:0fq7k2m9vd3a%%');
        expect(withCalendarRef('Call Mom %%cal:0fq7k2m9vd3a%% ', { id: '0fq7k2m9vd3a', rev: 2 })).toBe('Call Mom %%cal:0fq7k2m9vd3a:2%%');
        expect(withCalendarRef('Call Mom %%cal:0fq7k2m9vd3a:2%%', null)).toBe('Call Mom');
    });

    it('strips ids for showing and copying', () => {
        expect(stripCalendarRef('Call Mom 2026-10-30 %%cal:0fq7k2m9vd3a:3%%')).toBe('Call Mom 2026-10-30');
        expect(formatCalendarRef({ id: '0fq7k2m9vd3a', rev: 0 })).toBe('%%cal:0fq7k2m9vd3a%%');
    });

    it('tells a calendar id from a written comment', () => {
        expect(isCalendarComment('cal:0fq7k2m9vd3a')).toBe(true);
        expect(isCalendarComment('cal:0fq7k2m9vd3a:12')).toBe(true);
        expect(isCalendarComment('call the bank')).toBe(false);
    });
});

describe('task rewrites keep the calendar id last', () => {
    const text = 'Call Mom 2026-10-30 15:00 %%cal:0fq7k2m9vd3a%%';

    it('re-dating', () => {
        expect(setDueInText(text, { dateText: '2026-10-30 15:00', timeText: '15:00' }, '2026-11-02', null)).toBe('Call Mom 2026-11-02 %%cal:0fq7k2m9vd3a%%');
        expect(setDueInText('Call Mom %%cal:0fq7k2m9vd3a%%', {}, '2026-11-02', '9am')).toBe('Call Mom 2026-11-02 9am %%cal:0fq7k2m9vd3a%%');
    });

    it('renaming', () => {
        expect(editableTitle(text, '2026-10-30 15:00')).toBe('Call Mom');
        expect(withTitle(text, '2026-10-30 15:00', 'Call Dad')).toBe('Call Dad 2026-10-30 15:00 %%cal:0fq7k2m9vd3a%%');
    });

    it('behind a marker link', () => {
        const marked = 'Call Mom [↗](https://example.com/1) %%cal:0fq7k2m9vd3a%%';
        expect(setDueInText(marked, {}, '2026-11-02')).toBe('Call Mom 2026-11-02 [↗](https://example.com/1) %%cal:0fq7k2m9vd3a%%');
        expect(editableTitle(marked, undefined)).toBe('Call Mom');
    });
});
