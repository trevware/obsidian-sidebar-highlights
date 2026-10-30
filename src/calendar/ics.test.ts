import { eventToIcs, icsToEvent, WRITTEN_PROPERTY } from './ics';
import type { EventDraft } from './providers/types';

const NOW = Date.UTC(2026, 9, 30, 12, 0);

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
    id: '0fq7k2m9vd3a',
    title: 'Call Mom, then; the bank\\',
    description: 'Inbox\nobsidian://open?vault=Aegis&file=Inbox.md',
    link: 'obsidian://open?vault=Aegis&file=Inbox.md',
    date: '2026-10-30',
    time: '15:00',
    minutes: 30,
    alert: 10,
    timeZone: 'UTC',
    written: { rev: 1, date: '2026-10-30', time: '15:00', title: 'Call Mom', path: 'Inbox.md', at: NOW },
    ...over
});

describe('eventToIcs', () => {
    it('writes a timed event in UTC with an alert and the written snapshot', () => {
        const ics = eventToIcs(draft(), NOW);
        const start = new Date(2026, 9, 30, 15, 0);
        const stamp = start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        expect(ics).toContain(`DTSTART:${stamp}`);
        expect(ics).toContain('TRIGGER:-PT10M');
        expect(ics).toContain('SUMMARY:Call Mom\\, then\\; the bank\\\\');
        expect(ics).toContain(`${WRITTEN_PROPERTY}:`);
        expect(ics.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75)).toBe(true);
    });

    it('writes an all-day event with no alert', () => {
        const ics = eventToIcs(draft({ time: undefined, alert: 10 }), NOW);
        expect(ics).toContain('DTSTART;VALUE=DATE:20261030');
        expect(ics).toContain('DTEND;VALUE=DATE:20261031');
        expect(ics).not.toContain('VALARM');
    });
});

describe('icsToEvent', () => {
    it('reads back what it wrote', () => {
        expect(icsToEvent(eventToIcs(draft(), NOW))).toEqual({
            id: '0fq7k2m9vd3a', date: '2026-10-30', time: '15:00', title: 'Call Mom, then; the bank\\',
            written: draft().written, cancelled: undefined
        });
        const allDay = icsToEvent(eventToIcs(draft({ time: undefined }), NOW))!;
        expect(allDay.date).toBe('2026-10-30');
        expect(allDay.time).toBeUndefined();
    });

    it('reads a move made in a calendar app, in a named time zone', () => {
        const moved = [
            'BEGIN:VCALENDAR', 'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'END:VTIMEZONE', 'BEGIN:VEVENT',
            'UID:0fq7k2m9vd3a', 'DTSTART;TZID="Asia/Tokyo":20261102T093000', 'SUMMARY:Call Mom',
            'BEGIN:VALARM', 'TRIGGER:-PT10M', 'DTSTART:19700101T000000', 'END:VALARM',
            `${WRITTEN_PROPERTY}:{"rev":0\\,"date":"2026-10-30"\\,"time":"15:00"\\,"title":"Call Mom"\\,"path":"Inbox.md"\\,"at":1}`,
            'END:VEVENT', 'END:VCALENDAR'
        ].join('\r\n');
        const event = icsToEvent(moved)!;
        const local = new Date(Date.UTC(2026, 10, 2, 0, 30));
        expect(event.date).toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`);
        expect(event.time).toBe(`${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`);
        expect(event.written).toMatchObject({ rev: 0, date: '2026-10-30', path: 'Inbox.md' });
    });

    it('falls back to the copy in the link when a calendar app dropped the property', () => {
        const ics = eventToIcs(draft(), NOW).split('\r\n').filter(line => !line.startsWith(WRITTEN_PROPERTY) && !line.startsWith(' ')).join('\r\n');
        expect(icsToEvent(ics)!.written).toEqual({ rev: 1, date: '2026-10-30', time: '15:00', title: 'Call Mom, then; the bank\\', path: 'Inbox.md', at: NOW });
    });

    it('reads floating and folded lines, and marks cancelled events', () => {
        const text = 'BEGIN:VEVENT\r\nUID:abc\r\nDTSTART:20261030T150000\r\nSUMMARY:A very long title that the server\r\n  folded\r\nSTATUS:CANCELLED\r\nEND:VEVENT';
        expect(icsToEvent(text)).toMatchObject({ id: 'abc', date: '2026-10-30', time: '15:00', title: 'A very long title that the server folded', cancelled: true });
    });

    it('skips repeating events and files without one', () => {
        expect(icsToEvent('BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261030T150000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT')).toBeNull();
        expect(icsToEvent('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBeNull();
    });
});
