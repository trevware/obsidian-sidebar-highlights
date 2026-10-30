import type { CalendarEvent, Written } from '../plan';
import { localMs, localParts, nextDay } from '../local-time';
import { failure, jsonOf, sendAuthed } from './http';
import type { HttpRequest, TokenSource } from './http';
import { ProviderError } from './types';
import type { CalendarProvider, EventDraft } from './types';

/**
 * Outlook, through Microsoft Graph. Outlook picks its own event ids, so the
 * task's calendar ID and what the plugin wrote ride along as two extended
 * properties, and the Outlook id is looked up from them. Times go to Graph
 * in UTC and come back in UTC, which sidesteps Windows time zone names.
 */

const API = 'https://graph.microsoft.com/v1.0';
const NAME = 'Outlook';
/** One GUID for the plugin's properties, so they never clash with another app's. */
const SET = '{6f1c7e0a-3b52-4f8e-9d2b-5a7c1e4b9d10}';
export const ID_PROPERTY = `String ${SET} Name SidebarHighlightsId`;
export const WRITTEN_PROPERTY = `String ${SET} Name SidebarHighlightsWritten`;
/** Ids that stay put when an event moves between folders, and every time in UTC. */
const PREFER = 'IdType="ImmutableId", outlook.timezone="UTC"';

const pad = (n: number) => String(n).padStart(2, '0');

function utcWall(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
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

/** One Graph event, as the plugin sees it, with its Outlook id; null for events the plugin didn't make. */
export function fromGraph(item: Record<string, unknown>): { event: CalendarEvent; graphId: string } | null {
    const graphId = typeof item.id === 'string' ? item.id : '';
    const props = Array.isArray(item.singleValueExtendedProperties) ? item.singleValueExtendedProperties as Array<{ id?: string; value?: string }> : [];
    const prop = (name: string) => props.find(p => p.id?.toLowerCase() === name.toLowerCase())?.value;
    const id = prop(ID_PROPERTY);
    const start = (item.start ?? {}) as { dateTime?: string };
    if (!graphId || !id || !start.dateTime) return null;
    let when: { date: string; time?: string };
    if (item.isAllDay === true) when = { date: start.dateTime.slice(0, 10) };
    else when = localParts(Date.parse(`${start.dateTime.replace(/\.\d+$/, '')}Z`));
    return {
        graphId,
        event: { id, ...when, title: typeof item.subject === 'string' ? item.subject : '', written: readWritten(prop(WRITTEN_PROPERTY)) }
    };
}

/** An event as Graph takes it. */
export function toGraph(draft: EventDraft): Record<string, unknown> {
    let times: Record<string, unknown>;
    if (draft.time) {
        const start = localMs(draft.date, draft.time);
        times = {
            isAllDay: false,
            start: { dateTime: utcWall(start), timeZone: 'UTC' },
            end: { dateTime: utcWall(start + draft.minutes * 60_000), timeZone: 'UTC' },
            showAs: 'busy',
            isReminderOn: draft.alert !== undefined,
            reminderMinutesBeforeStart: draft.alert ?? 0
        };
    } else {
        times = {
            isAllDay: true,
            start: { dateTime: `${draft.date}T00:00:00`, timeZone: 'UTC' },
            end: { dateTime: `${nextDay(draft.date)}T00:00:00`, timeZone: 'UTC' },
            showAs: 'free',
            isReminderOn: false
        };
    }
    return {
        subject: draft.title,
        body: { contentType: 'text', content: draft.description },
        ...times,
        singleValueExtendedProperties: [
            { id: ID_PROPERTY, value: draft.id },
            { id: WRITTEN_PROPERTY, value: JSON.stringify(draft.written) }
        ]
    };
}

export class OutlookCalendar implements CalendarProvider {
    /** Outlook ids by calendar ID, from the last listing. */
    private graphIds = new Map<string, string>();

    constructor(private calendarId: string, private tokens: TokenSource, private request: HttpRequest) {}

    static async createCalendar(tokens: TokenSource, request: HttpRequest, name: string): Promise<string> {
        const response = await sendAuthed(request, tokens, {
            url: `${API}/me/calendars`, method: 'POST', contentType: 'application/json',
            headers: { Prefer: PREFER }, body: JSON.stringify({ name })
        });
        if (response.status >= 400) throw failure(NAME, response);
        const id = jsonOf(response).id;
        if (typeof id !== 'string') throw new ProviderError('other', `${NAME} didn't say which calendar it made.`);
        return id;
    }

    private calendar(): string {
        return `${API}/me/calendars/${encodeURIComponent(this.calendarId)}`;
    }

    private call(url: string, method: string, body?: unknown) {
        return sendAuthed(this.request, this.tokens, {
            url, method, headers: { Prefer: PREFER },
            contentType: body === undefined ? undefined : 'application/json',
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    }

    async list(): Promise<CalendarEvent[]> {
        const events: CalendarEvent[] = [];
        this.graphIds.clear();
        const expand = `singleValueExtendedProperties($filter=id eq '${ID_PROPERTY}' or id eq '${WRITTEN_PROPERTY}')`;
        let url: string | null = `${this.calendar()}/events?$select=id,subject,start,end,isAllDay&$top=200&$expand=${encodeURIComponent(expand)}`;
        while (url) {
            const response = await this.call(url, 'GET');
            if (response.status === 404) throw new ProviderError('gone', 'The calendar is gone from Outlook.');
            if (response.status >= 400) throw failure(NAME, response);
            const json = jsonOf(response);
            for (const item of Array.isArray(json.value) ? json.value as Record<string, unknown>[] : []) {
                const found = fromGraph(item);
                if (!found) continue;
                this.graphIds.set(found.event.id, found.graphId);
                events.push(found.event);
            }
            url = typeof json['@odata.nextLink'] === 'string' ? json['@odata.nextLink'] : null;
        }
        return events;
    }

    /** The Outlook id for a calendar ID: from the last listing, or looked up by its property. */
    private async graphId(id: string): Promise<string | null> {
        const known = this.graphIds.get(id);
        if (known) return known;
        const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${ID_PROPERTY}' and ep/value eq '${id}')`;
        const response = await this.call(`${this.calendar()}/events?$select=id&$filter=${encodeURIComponent(filter)}`, 'GET');
        if (response.status >= 400) throw failure(NAME, response);
        const value = jsonOf(response).value;
        const first = Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) : undefined;
        return typeof first?.id === 'string' ? first.id : null;
    }

    async create(draft: EventDraft): Promise<void> {
        // The calendar ID doubles as Graph's retry key, so a create sent twice makes one event.
        const response = await this.call(`${this.calendar()}/events`, 'POST', { ...toGraph(draft), transactionId: draft.id });
        if (response.status === 404) throw new ProviderError('gone', 'The calendar is gone from Outlook.');
        if (response.status >= 400) throw failure(NAME, response);
        const graphId = jsonOf(response).id;
        if (typeof graphId === 'string') this.graphIds.set(draft.id, graphId);
    }

    async update(draft: EventDraft): Promise<void> {
        const graphId = await this.graphId(draft.id);
        if (!graphId) return this.create(draft);
        const response = await this.call(`${API}/me/events/${encodeURIComponent(graphId)}`, 'PATCH', toGraph(draft));
        if (response.status === 404) {
            this.graphIds.delete(draft.id);
            return this.create(draft);
        }
        if (response.status >= 400) throw failure(NAME, response);
    }

    async remove(id: string): Promise<void> {
        const graphId = await this.graphId(id);
        if (!graphId) return;
        const response = await this.call(`${API}/me/events/${encodeURIComponent(graphId)}`, 'DELETE');
        this.graphIds.delete(id);
        if (response.status === 404) return;
        if (response.status >= 400) throw failure(NAME, response);
    }
}
