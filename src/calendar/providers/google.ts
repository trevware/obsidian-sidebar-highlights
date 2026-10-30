import type { CalendarEvent, Written } from '../plan';
import { localMs, localParts, nextDay, wallClock } from '../local-time';
import { failure, jsonOf, sendAuthed } from './http';
import type { HttpRequest, TokenSource } from './http';
import { ProviderError } from './types';
import type { CalendarProvider, EventDraft } from './types';

/**
 * Google Calendar. The plugin signs in with the narrowest scope Google has,
 * one that only reaches calendars the plugin itself made, so it can never
 * see the user's other calendars. Events take the task's calendar ID as
 * their own id, and keep what the plugin wrote in a private property.
 */

const API = 'https://www.googleapis.com/calendar/v3';
const WRITTEN_KEY = 'sidebarHighlightsWritten';
const NAME = 'Google Calendar';

interface GoogleTime {
    date?: string;
    dateTime?: string;
    timeZone?: string;
}

function readWritten(raw: unknown): Written | undefined {
    if (typeof raw !== 'string') return undefined;
    try {
        const parsed = JSON.parse(raw) as Partial<Written>;
        if (typeof parsed.rev !== 'number' || typeof parsed.date !== 'string' || typeof parsed.title !== 'string' || typeof parsed.path !== 'string') return undefined;
        return { rev: parsed.rev, date: parsed.date, time: parsed.time, title: parsed.title, path: parsed.path, at: Number(parsed.at) || 0 };
    } catch {
        return undefined;
    }
}

/** One event from Google as a day and time on this device's clock. */
export function fromGoogle(item: Record<string, unknown>): CalendarEvent | null {
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) return null;
    const cancelled = item.status === 'cancelled';
    const start = (item.start ?? {}) as GoogleTime;
    let when: { date: string; time?: string } | null = null;
    if (start.date) when = { date: start.date };
    else if (start.dateTime) when = localParts(Date.parse(start.dateTime));
    // A deleted event comes back with little more than its id.
    if (!when && !cancelled) return null;
    const props = ((item.extendedProperties ?? {}) as Record<string, Record<string, unknown>>).private ?? {};
    return {
        id,
        date: when?.date ?? '',
        time: when?.time,
        title: typeof item.summary === 'string' ? item.summary : '',
        written: readWritten(props[WRITTEN_KEY]),
        cancelled: cancelled || undefined
    };
}

/** An event as Google takes it. */
export function toGoogle(draft: EventDraft): Record<string, unknown> {
    let start: GoogleTime;
    let end: GoogleTime;
    if (draft.time) {
        const finish = localParts(localMs(draft.date, draft.time) + draft.minutes * 60_000);
        start = { dateTime: wallClock(draft.date, draft.time), timeZone: draft.timeZone };
        end = { dateTime: wallClock(finish.date, finish.time), timeZone: draft.timeZone };
    } else {
        start = { date: draft.date };
        end = { date: nextDay(draft.date) };
    }
    return {
        id: draft.id,
        summary: draft.title,
        description: draft.description,
        start,
        end,
        status: 'confirmed',
        transparency: draft.time ? 'opaque' : 'transparent',
        reminders: { useDefault: false, overrides: draft.time && draft.alert !== undefined ? [{ method: 'popup', minutes: draft.alert }] : [] },
        extendedProperties: { private: { [WRITTEN_KEY]: JSON.stringify(draft.written) } }
    };
}

export class GoogleCalendar implements CalendarProvider {
    constructor(private calendarId: string, private tokens: TokenSource, private request: HttpRequest) {}

    /** Makes the vault's calendar. Returns its id. */
    static async createCalendar(tokens: TokenSource, request: HttpRequest, name: string, timeZone: string): Promise<string> {
        const response = await sendAuthed(request, tokens, {
            url: `${API}/calendars`, method: 'POST', contentType: 'application/json', body: JSON.stringify({ summary: name, timeZone })
        });
        if (response.status >= 400) throw failure(NAME, response);
        const id = jsonOf(response).id;
        if (typeof id !== 'string') throw new ProviderError('other', `${NAME} didn't say which calendar it made.`);
        return id;
    }

    private events(): string {
        return `${API}/calendars/${encodeURIComponent(this.calendarId)}/events`;
    }

    async list(): Promise<CalendarEvent[]> {
        const events: CalendarEvent[] = [];
        let pageToken = '';
        do {
            const query = new URLSearchParams({ showDeleted: 'true', maxResults: '2500' });
            if (pageToken) query.set('pageToken', pageToken);
            const response = await sendAuthed(this.request, this.tokens, { url: `${this.events()}?${query.toString()}`, method: 'GET' });
            if (response.status === 404 || response.status === 410) throw new ProviderError('gone', 'The calendar is gone from Google Calendar.');
            if (response.status >= 400) throw failure(NAME, response);
            const json = jsonOf(response);
            for (const item of Array.isArray(json.items) ? json.items as Record<string, unknown>[] : []) {
                const event = fromGoogle(item);
                if (event) events.push(event);
            }
            pageToken = typeof json.nextPageToken === 'string' ? json.nextPageToken : '';
        } while (pageToken);
        return events;
    }

    async create(draft: EventDraft): Promise<void> {
        const response = await sendAuthed(this.request, this.tokens, {
            url: this.events(), method: 'POST', contentType: 'application/json', body: JSON.stringify(toGoogle(draft))
        });
        if (response.status === 404) throw new ProviderError('gone', 'The calendar is gone from Google Calendar.');
        if (response.status >= 400) throw failure(NAME, response);
    }

    async update(draft: EventDraft): Promise<void> {
        const response = await sendAuthed(this.request, this.tokens, {
            url: `${this.events()}/${draft.id}`, method: 'PUT', contentType: 'application/json', body: JSON.stringify(toGoogle(draft))
        });
        if (response.status === 404) return this.create(draft);
        if (response.status >= 400) throw failure(NAME, response);
    }

    async remove(id: string): Promise<void> {
        const response = await sendAuthed(this.request, this.tokens, { url: `${this.events()}/${id}`, method: 'DELETE' });
        if (response.status === 404 || response.status === 410) return;
        if (response.status >= 400) throw failure(NAME, response);
    }
}
