/**
 * Events as iCalendar text, for iCloud and other CalDAV calendars.
 *
 * Writing: one VEVENT per file, named by the task's calendar ID, with times
 * in UTC (valid everywhere, and the calendar shows them in its own zone).
 * What the plugin wrote is kept on the event as an X- property, which
 * calendars carry along when the event is moved.
 *
 * Reading: whatever a calendar app wrote back after the user moved the
 * event, whether in UTC, in a named time zone, floating, or all-day, comes
 * out as a day and time on this device's clock. Kept free of Obsidian
 * imports so it can be unit tested directly.
 */

import type { CalendarEvent, Written } from './plan';
import type { EventDraft } from './providers/types';

export const WRITTEN_PROPERTY = 'X-SIDEBAR-HIGHLIGHTS-WRITTEN';
/** The query parameter on the event's link that carries a second copy of what was written. */
const SNAPSHOT_PARAM = 'sh';

/**
 * What was written, packed into the event's link: revision, day, time and
 * when, as `2.20261030T1500.mfx3k2`. Calendar apps keep an event's link
 * when the event is moved, and may drop properties they don't know, so the
 * link is the fallback. The title and note come from the event itself.
 */
export function packSnapshot(written: Written): string {
    const when = `${written.date.replace(/-/g, '')}${written.time ? `T${written.time.replace(':', '')}` : ''}`;
    return `${written.rev}.${when}.${Math.floor(written.at).toString(36)}`;
}

export function unpackSnapshot(packed: string, title: string, path: string): Written | undefined {
    const match = /^(\d{1,6})\.(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?\.([0-9a-z]{1,12})$/.exec(packed);
    if (!match) return undefined;
    return {
        rev: Number(match[1]),
        date: `${match[2]}-${match[3]}-${match[4]}`,
        time: match[5] ? `${match[5]}:${match[6]}` : undefined,
        title,
        path,
        at: parseInt(match[7], 36)
    };
}

function linkWithSnapshot(link: string, written: Written): string {
    return `${link}${link.includes('?') ? '&' : '?'}${SNAPSHOT_PARAM}=${packSnapshot(written)}`;
}

function snapshotFromLink(link: string, title: string): Written | undefined {
    const query = link.split('?')[1] ?? '';
    const params = new URLSearchParams(query);
    const packed = params.get(SNAPSHOT_PARAM);
    return packed ? unpackSnapshot(packed, title, params.get('file') ?? '') : undefined;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function escapeText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function unescapeText(text: string): string {
    return text.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** How many bytes a character takes in UTF-8. */
function utf8Width(char: string): number {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

/** Folds a content line at 75 octets, as iCalendar requires. */
function fold(line: string): string {
    const parts: string[] = [];
    let current = '';
    let size = 0;
    for (const char of line) {
        const width = utf8Width(char);
        // Continuation lines start with a space, which counts toward their 75.
        if (size + width > (parts.length ? 74 : 75)) {
            parts.push(current);
            current = '';
            size = 0;
        }
        current += char;
        size += width;
    }
    parts.push(current);
    return parts.join('\r\n ');
}

function utcStamp(ms: number): string {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function localMs(date: string, time: string): number {
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    return new Date(y, m - 1, d, h, min).getTime();
}

function compactDate(date: string): string {
    return date.replace(/-/g, '');
}

function nextDay(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

export function eventToIcs(draft: EventDraft, now: number): string {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Trevware//Sidebar Highlights and Tasks//EN',
        'BEGIN:VEVENT',
        `UID:${draft.id}`,
        `DTSTAMP:${utcStamp(now)}`,
        `SUMMARY:${escapeText(draft.title)}`
    ];
    if (draft.description) lines.push(`DESCRIPTION:${escapeText(draft.description)}`);
    lines.push(`URL:${linkWithSnapshot(draft.link, draft.written)}`);
    if (draft.time) {
        const start = localMs(draft.date, draft.time);
        lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(start + draft.minutes * 60_000)}`);
        if (draft.alert !== undefined) {
            lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(draft.title)}`, `TRIGGER:-PT${draft.alert}M`, 'END:VALARM');
        }
    } else {
        lines.push(`DTSTART;VALUE=DATE:${compactDate(draft.date)}`, `DTEND;VALUE=DATE:${nextDay(draft.date)}`, 'TRANSP:TRANSPARENT');
    }
    lines.push(`${WRITTEN_PROPERTY}:${escapeText(JSON.stringify(draft.written))}`, 'END:VEVENT', 'END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
}

interface Property {
    name: string;
    params: Record<string, string>;
    value: string;
}

function unfold(text: string): string[] {
    return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter(line => line.length > 0);
}

function parseProperty(line: string): Property | null {
    // The name and parameters end at the first colon outside a quoted parameter value.
    let quoted = false;
    let split = -1;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ':' && !quoted) {
            split = i;
            break;
        }
    }
    if (split === -1) return null;
    const [name, ...rawParams] = line.slice(0, split).split(';');
    const params: Record<string, string> = {};
    for (const param of rawParams) {
        const eq = param.indexOf('=');
        if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
    }
    return { name: name.toUpperCase(), params, value: line.slice(split + 1) };
}

/** The offset of a time zone from UTC at a moment, in milliseconds. */
function zoneOffset(zone: string, ms: number): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms;
}

/** A wall-clock time in a named zone, as a moment. */
function zonedMs(fields: number[], zone: string): number {
    const [y, m, d, h, min, s] = fields;
    const guess = Date.UTC(y, m - 1, d, h, min, s);
    let ms = guess - zoneOffset(zone, guess);
    ms = guess - zoneOffset(zone, ms);
    return ms;
}

/** A DTSTART as a day and a time on this device's clock, or a day alone for all-day events. */
function readStart(property: Property): { date: string; time?: string } | null {
    const value = property.value.trim();
    const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (dateOnly || property.params.VALUE === 'DATE') {
        const match = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
        return match ? { date: `${match[1]}-${match[2]}-${match[3]}` } : null;
    }
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
    if (!match) return null;
    const fields = match.slice(1, 7).map(Number);
    let ms: number;
    if (match[7] === 'Z') ms = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]);
    else if (property.params.TZID) {
        try {
            ms = zonedMs(fields, property.params.TZID);
        } catch {
            // A zone this device doesn't know (some servers invent names): read it as local.
            ms = new Date(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]).getTime();
        }
    } else ms = new Date(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]).getTime();
    const local = new Date(ms);
    return {
        date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
        time: `${pad(local.getHours())}:${pad(local.getMinutes())}`
    };
}

function readWritten(value: string): Written | undefined {
    try {
        const parsed = JSON.parse(unescapeText(value)) as Partial<Written>;
        if (typeof parsed.rev !== 'number' || typeof parsed.date !== 'string' || typeof parsed.title !== 'string' || typeof parsed.path !== 'string') return undefined;
        return { rev: parsed.rev, date: parsed.date, time: parsed.time, title: parsed.title, path: parsed.path, at: Number(parsed.at) || 0 };
    } catch {
        return undefined;
    }
}

/** The event in an iCalendar file, or null when it has none (or repeats, which the plugin never writes). */
export function icsToEvent(text: string): CalendarEvent | null {
    let inEvent = false;
    let depth = 0;
    const props: Property[] = [];
    for (const line of unfold(text)) {
        if (/^BEGIN:VEVENT$/i.test(line)) {
            if (inEvent) return null;
            inEvent = true;
            continue;
        }
        if (!inEvent) continue;
        if (/^END:VEVENT$/i.test(line)) break;
        // Skip the event's alarms and anything else nested in it.
        if (/^BEGIN:/i.test(line)) depth++;
        else if (/^END:/i.test(line)) depth--;
        else if (depth === 0) {
            const property = parseProperty(line);
            if (property) props.push(property);
        }
    }
    const get = (name: string) => props.find(property => property.name === name);
    const uid = get('UID')?.value.trim();
    const start = get('DTSTART');
    if (!uid || !start || get('RRULE')) return null;
    const when = readStart(start);
    if (!when) return null;
    const title = unescapeText(get('SUMMARY')?.value ?? '');
    const property = get(WRITTEN_PROPERTY);
    const link = get('URL')?.value.trim();
    const written = (property ? readWritten(property.value) : undefined) ?? (link ? snapshotFromLink(link, title) : undefined);
    return {
        id: uid,
        ...when,
        title,
        written,
        cancelled: get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED' || undefined
    };
}
