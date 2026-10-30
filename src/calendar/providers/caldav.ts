import type { CalendarEvent } from '../plan';
import { eventToIcs, icsToEvent } from '../ics';
import { send } from './http';
import type { HttpRequest } from './http';
import { ProviderError } from './types';
import type { CalendarProvider, EventDraft } from './types';

/**
 * iCloud and any other CalDAV server. Sign-in is a user name and password
 * (for iCloud, an app-specific password), which stay on this device; the
 * Power-Up server never sees them or the calendar.
 *
 * Each event is a file named for the task's calendar ID. iCloud answers
 * some requests with links on a different host than the one asked, so every
 * link is read as a path on the calendar's own host.
 */

export const ICLOUD_SERVER = 'https://caldav.icloud.com/';
const DAV = 'DAV:';
const CALDAV = 'urn:ietf:params:xml:ns:caldav';

export interface CalDavLogin {
    username: string;
    password(): string | null;
}

function basic(login: CalDavLogin): string {
    const password = login.password();
    if (!password) throw new ProviderError('signed-out', 'Enter the password for this calendar on this device.');
    // UTF-8 bytes as a binary string, which is what btoa encodes.
    const binary = encodeURIComponent(`${login.username}:${password}`)
        .replace(/%([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return `Basic ${btoa(binary)}`;
}

function parseXml(text: string): Document {
    return new DOMParser().parseFromString(text, 'application/xml');
}

/** The first element with this name under `root`, in either namespace. */
function first(root: Document | Element, ns: string, name: string): Element | null {
    return root.getElementsByTagNameNS(ns, name)[0] ?? null;
}

/** A link from the server as a full URL on `base`'s host. */
export function onHost(base: string, href: string): string {
    const resolved = new URL(href, base);
    return `${new URL(base).origin}${resolved.pathname}`;
}

export class CalDavCalendar implements CalendarProvider {
    /** Each event's file by calendar ID, from the last listing. */
    private hrefs = new Map<string, string>();

    constructor(private collection: string, private login: CalDavLogin, private request: HttpRequest, private name = 'The calendar') {}

    private async dav(url: string, method: string, body?: string, headers: Record<string, string> = {}) {
        return send(this.request, {
            url, method, body,
            contentType: body === undefined ? undefined : method === 'PUT' ? 'text/calendar; charset=utf-8' : 'application/xml; charset=utf-8',
            headers: { Authorization: basic(this.login), ...headers }
        });
    }

    private refuse(status: number): ProviderError {
        if (status === 401 || status === 403) return new ProviderError('signed-out', `${this.name} refused the user name or password.`);
        return new ProviderError('other', `${this.name} answered ${status}.`);
    }

    /** The account's calendar home: where calendars are made. */
    static async home(server: string, login: CalDavLogin, request: HttpRequest): Promise<string> {
        const client = new CalDavCalendar(server, login, request);
        const principal = await client.property(server, DAV, 'current-user-principal');
        const home = await client.property(principal, CALDAV, 'calendar-home-set');
        return home.endsWith('/') ? home : `${home}/`;
    }

    /** A property's link, PROPFIND at depth 0, read as a URL. */
    private async property(url: string, ns: string, name: string): Promise<string> {
        const prefix = ns === DAV ? 'd' : 'c';
        const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV}"><d:prop><${prefix}:${name}/></d:prop></d:propfind>`;
        const response = await this.dav(url, 'PROPFIND', body, { Depth: '0' });
        if (response.status >= 400) throw this.refuse(response.status);
        const element = first(parseXml(response.text), ns, name);
        const href = element ? first(element, DAV, 'href')?.textContent?.trim() : undefined;
        if (!href) throw new ProviderError('other', `${this.name} didn't say where the calendars are.`);
        return onHost(url, href);
    }

    /** Makes the vault's calendar in `home`. Returns its URL. */
    static async createCalendar(home: string, login: CalDavLogin, request: HttpRequest, name: string): Promise<string> {
        const client = new CalDavCalendar(home, login, request);
        const url = `${home}${crypto.randomUUID()}/`;
        const escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const body = `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="${CALDAV}"><d:set><d:prop>`
            + `<d:displayname>${escaped}</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>`
            + '</d:prop></d:set></c:mkcalendar>';
        const response = await client.dav(url, 'MKCALENDAR', body);
        if (response.status >= 400) throw client.refuse(response.status);
        return url;
    }

    async list(): Promise<CalendarEvent[]> {
        const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV}">`
            + '<d:prop><d:getetag/><c:calendar-data/></d:prop>'
            + '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>';
        const response = await this.dav(this.collection, 'REPORT', body, { Depth: '1' });
        if (response.status === 404) throw new ProviderError('gone', 'The calendar is gone.');
        if (response.status >= 400) throw this.refuse(response.status);
        this.hrefs.clear();
        const events: CalendarEvent[] = [];
        for (const item of Array.from(parseXml(response.text).getElementsByTagNameNS(DAV, 'response'))) {
            const href = first(item, DAV, 'href')?.textContent?.trim();
            const data = first(item, CALDAV, 'calendar-data')?.textContent;
            if (!href || !data) continue;
            const event = icsToEvent(data);
            if (!event) continue;
            this.hrefs.set(event.id, onHost(this.collection, href));
            events.push(event);
        }
        return events;
    }

    private href(id: string): string {
        return this.hrefs.get(id) ?? `${this.collection}${id}.ics`;
    }

    async create(draft: EventDraft): Promise<void> {
        const url = `${this.collection}${draft.id}.ics`;
        const response = await this.dav(url, 'PUT', eventToIcs(draft, Date.now()), { 'If-None-Match': '*' });
        if (response.status === 404 || response.status === 409) throw new ProviderError('gone', 'The calendar is gone.');
        if (response.status >= 400) throw this.refuse(response.status);
        this.hrefs.set(draft.id, url);
    }

    async update(draft: EventDraft): Promise<void> {
        // No If-Match: iCloud reads `If-Match: *` backwards, and the round
        // already decided this event should look like the task.
        const response = await this.dav(this.href(draft.id), 'PUT', eventToIcs(draft, Date.now()));
        if (response.status === 404 || response.status === 409) throw new ProviderError('gone', 'The calendar is gone.');
        if (response.status >= 400) throw this.refuse(response.status);
    }

    async remove(id: string): Promise<void> {
        const response = await this.dav(this.href(id), 'DELETE');
        this.hrefs.delete(id);
        if (response.status === 404 || response.status === 410) return;
        if (response.status >= 400) throw this.refuse(response.status);
    }
}
