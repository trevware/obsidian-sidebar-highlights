import type { CalendarEvent, Written } from '../plan';

export type ProviderKind = 'google' | 'microsoft' | 'icloud' | 'caldav';

/**
 * The calendar a vault syncs to, kept in the plugin's settings so every
 * device writes to the same one. Sign-in secrets are never here: each
 * device keeps its own in Obsidian's keychain.
 */
export interface CalendarConnection {
    provider: ProviderKind;
    /** The account as the user knows it: an email address or user name. */
    account: string;
    /** The provider's id for the calendar: an id, or a CalDAV collection URL. */
    calendarId: string;
    calendarName: string;
    /** CalDAV only: the server the account is on. */
    server?: string;
    /** Just connected: tasks whose IDs came from an earlier calendar get new events in this one. */
    adopt?: boolean;
}

/** An event as the plugin writes it. */
export interface EventDraft {
    id: string;
    title: string;
    /** The note's name and a link that opens it. */
    description: string;
    /** The obsidian:// link that opens the task's note. */
    link: string;
    date: string;
    /** Absent for an all-day event. */
    time?: string;
    /** How long a timed event lasts. */
    minutes: number;
    /** Minutes before the start to alert; absent for none. */
    alert?: number;
    /** The device's time zone, IANA name. */
    timeZone: string;
    written: Written;
}

export class ProviderError extends Error {
    constructor(
        /** signed-out: sign in again; gone: the calendar was deleted; license: Power-Up isn't active; other: try later. */
        readonly kind: 'signed-out' | 'gone' | 'license' | 'other',
        message: string
    ) {
        super(message);
    }
}

/** One calendar account, as calendar sync uses it. */
export interface CalendarProvider {
    /** Every event in the vault's calendar, the plugin's own and any others. */
    list(): Promise<CalendarEvent[]>;
    /** Creates the event under the draft's id. */
    create(draft: EventDraft): Promise<void>;
    /** Replaces the event with this id, creating it if the calendar lost it. */
    update(draft: EventDraft): Promise<void>;
    /** Deletes the event; one already gone is fine. */
    remove(id: string): Promise<void>;
}
