import { CalDavCalendar, ICLOUD_SERVER, onHost } from './caldav';
import { fakeHttp, fakeTokens } from './fake-http';
import { GoogleCalendar, fromGoogle, toGoogle } from './google';
import { ID_PROPERTY, OutlookCalendar, WRITTEN_PROPERTY, fromGraph, toGraph } from './microsoft';
import { ProviderError } from './types';
import type { EventDraft } from './types';
import { eventToIcs } from '../ics';

const written = { rev: 1, date: '2026-10-30', time: '15:00', title: 'Call Mom', path: 'Inbox.md', at: 1 };
const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
    id: '0fq7k2m9vd3a', title: 'Call Mom', description: 'Inbox', link: 'obsidian://open?vault=V&file=Inbox.md',
    date: '2026-10-30', time: '23:45', minutes: 30, alert: 10, timeZone: 'America/Toronto', written, ...over
});

describe('Google Calendar', () => {
    it('writes timed events in the device zone, crossing midnight, with one alert', () => {
        expect(toGoogle(draft())).toMatchObject({
            id: '0fq7k2m9vd3a',
            start: { dateTime: '2026-10-30T23:45:00', timeZone: 'America/Toronto' },
            end: { dateTime: '2026-10-31T00:15:00', timeZone: 'America/Toronto' },
            reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
            extendedProperties: { private: { sidebarHighlightsWritten: JSON.stringify(written) } }
        });
    });

    it('writes all-day events without alerts', () => {
        expect(toGoogle(draft({ time: undefined }))).toMatchObject({
            start: { date: '2026-10-30' }, end: { date: '2026-10-31' }, transparency: 'transparent', reminders: { overrides: [] }
        });
    });

    it('reads events, including deleted ones that come back bare', () => {
        const at = new Date(2026, 10, 2, 9, 30);
        expect(fromGoogle({ id: 'abc', summary: 'Moved', start: { dateTime: at.toISOString() }, extendedProperties: { private: { sidebarHighlightsWritten: JSON.stringify(written) } } }))
            .toEqual({ id: 'abc', date: '2026-11-02', time: '09:30', title: 'Moved', written, cancelled: undefined });
        expect(fromGoogle({ id: 'gone', status: 'cancelled' })).toMatchObject({ id: 'gone', cancelled: true, written: undefined });
        expect(fromGoogle({ id: 'x', start: { date: '2026-10-30' } })).toMatchObject({ date: '2026-10-30', time: undefined });
    });

    it('lists every page, and refreshes a token Google turned down', async () => {
        const http = fakeHttp([
            { method: 'GET', url: '/events?', status: 401 },
            { method: 'GET', url: /events\?(?!.*pageToken)/, json: { items: [{ id: 'a', start: { date: '2026-10-30' } }], nextPageToken: 'p2' } },
            { method: 'GET', url: 'pageToken=p2', json: { items: [{ id: 'b', start: { date: '2026-10-31' } }] } }
        ]);
        const tokens = fakeTokens();
        const events = await new GoogleCalendar('cal@group', tokens, http).list();
        expect(events.map(e => e.id)).toEqual(['a', 'b']);
        expect(tokens.refreshed).toBe(1);
        expect(http.calls[0].url).toContain('/calendars/cal%40group/events?showDeleted=true');
    });

    it('creates an event the calendar lost while updating it, and says when the calendar is gone', async () => {
        const http = fakeHttp([
            { method: 'PUT', url: '/events/0fq7k2m9vd3a', status: 404 },
            { method: 'POST', url: '/events', json: { id: '0fq7k2m9vd3a' } },
            { method: 'GET', url: '/events?', status: 404 }
        ]);
        const google = new GoogleCalendar('cal', fakeTokens(), http);
        await google.update(draft());
        expect(http.calls.map(c => c.method)).toEqual(['PUT', 'POST']);
        await expect(google.list()).rejects.toMatchObject({ kind: 'gone' });
    });
});

describe('Outlook', () => {
    const item = (over: Record<string, unknown> = {}) => ({
        id: 'AAMk1', subject: 'Call Mom', isAllDay: false, start: { dateTime: '2026-10-30T19:00:00.0000000' },
        singleValueExtendedProperties: [{ id: ID_PROPERTY, value: '0fq7k2m9vd3a' }, { id: WRITTEN_PROPERTY, value: JSON.stringify(written) }],
        ...over
    });

    it('reads UTC times onto the device clock, and skips events the plugin didn\'t make', () => {
        const local = new Date(Date.UTC(2026, 9, 30, 19, 0));
        const hhmm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
        expect(fromGraph(item())).toMatchObject({ graphId: 'AAMk1', event: { id: '0fq7k2m9vd3a', time: hhmm, written } });
        const allDay = fromGraph(item({ isAllDay: true, start: { dateTime: '2026-10-31T00:00:00.0000000' } }))!.event;
        expect([allDay.date, allDay.time]).toEqual(['2026-10-31', undefined]);
        expect(fromGraph(item({ singleValueExtendedProperties: [] }))).toBeNull();
    });

    it('writes UTC times, a reminder, and both properties', () => {
        const body = toGraph(draft({ time: '15:00' }));
        const start = new Date(2026, 9, 30, 15, 0);
        expect(body).toMatchObject({
            isAllDay: false, isReminderOn: true, reminderMinutesBeforeStart: 10,
            start: { dateTime: start.toISOString().slice(0, 16) + ':00', timeZone: 'UTC' },
            singleValueExtendedProperties: [{ id: ID_PROPERTY, value: '0fq7k2m9vd3a' }, { id: WRITTEN_PROPERTY, value: JSON.stringify(written) }]
        });
        expect(toGraph(draft({ time: undefined }))).toMatchObject({ isAllDay: true, start: { dateTime: '2026-10-30T00:00:00' }, end: { dateTime: '2026-10-31T00:00:00' } });
    });

    it('updates by the Outlook id from the last listing, and looks one up otherwise', async () => {
        const http = fakeHttp([
            { method: 'GET', url: '/calendars/cal/events?$select=id,subject', json: { value: [item()] } },
            { method: 'PATCH', url: '/me/events/AAMk1', json: {} },
            { method: 'GET', url: '$filter=', json: { value: [{ id: 'AAMk2' }] } },
            { method: 'DELETE', url: '/me/events/AAMk2', status: 204 }
        ]);
        const outlook = new OutlookCalendar('cal', fakeTokens(), http);
        await outlook.list();
        await outlook.update(draft());
        await outlook.remove('otherid00000');
        expect(http.calls.map(c => c.method)).toEqual(['GET', 'PATCH', 'GET', 'DELETE']);
        expect(http.calls[0].headers?.Prefer).toContain('ImmutableId');
    });
});

describe('CalDAV and iCloud', () => {
    const login = { username: 'me@icloud.com', password: () => 'abcd-efgh-ijkl-mnop' };

    it('reads every link onto the calendar\'s own host', () => {
        expect(onHost('https://p49-caldav.icloud.com:443/123/calendars/x/', 'https://caldav.icloud.com/123/calendars/x/a.ics'))
            .toBe('https://p49-caldav.icloud.com/123/calendars/x/a.ics');
        expect(onHost('https://dav.example.com/cal/', '/cal/a.ics')).toBe('https://dav.example.com/cal/a.ics');
    });

    it('finds the calendar home through the principal', async () => {
        const http = fakeHttp([
            { method: 'PROPFIND', url: 'https://caldav.icloud.com/', text: '<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>' },
            { method: 'PROPFIND', url: '/123/principal/', text: '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>https://p49-caldav.icloud.com:443/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>' }
        ]);
        expect(await CalDavCalendar.home(ICLOUD_SERVER, login, http)).toBe('https://caldav.icloud.com/123/calendars/');
        expect(http.calls[0].headers?.Authorization).toBe(`Basic ${btoa('me@icloud.com:abcd-efgh-ijkl-mnop')}`);
        expect(http.calls[0].headers?.Depth).toBe('0');
    });

    it('lists events from a calendar query and writes new ones only where none exists', async () => {
        const ics = eventToIcs(draft(), 1).replace(/&/g, '&amp;');
        const http = fakeHttp([
            { method: 'REPORT', url: '/cal/', text: `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/cal/</d:href></d:response><d:response><d:href>/cal/0fq7k2m9vd3a.ics</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag><c:calendar-data>${ics}</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>` },
            { method: 'PUT', url: '/cal/1111aaaa2222.ics', status: 201 },
            { method: 'DELETE', url: '/cal/0fq7k2m9vd3a.ics', status: 204 }
        ]);
        const cal = new CalDavCalendar('https://dav.example.com/cal/', login, http);
        const events = await cal.list();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ id: '0fq7k2m9vd3a', title: 'Call Mom', written });
        await cal.create(draft({ id: '1111aaaa2222' }));
        await cal.remove('0fq7k2m9vd3a');
        expect(http.calls[1].headers?.['If-None-Match']).toBe('*');
        expect(http.calls[1].contentType).toContain('text/calendar');
    });

    it('says when the password is refused', async () => {
        const http = fakeHttp([{ method: 'REPORT', url: '/cal/', status: 401 }]);
        await expect(new CalDavCalendar('https://dav.example.com/cal/', login, http).list()).rejects.toBeInstanceOf(ProviderError);
    });
});
