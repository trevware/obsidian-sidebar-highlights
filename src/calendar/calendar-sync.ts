import { Notice, TFile, moment, requestUrl } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import type { TaskIndex } from '../managers/task-index';
import { PlusClient, PlusError, calendarAvailable } from '../plus/plus-client';
import type { CalendarSignInProvider } from '../plus/plus-client';
import { applyNoteEdits } from './note-edits';
import type { NoteEdit } from './note-edits';
import { runRound, syncTasks } from './round';
import type { RoundResult } from './round';
import { deviceZone } from './local-time';
import { GoogleCalendar } from './providers/google';
import { OutlookCalendar } from './providers/microsoft';
import { CalDavCalendar, ICLOUD_SERVER } from './providers/caldav';
import type { HttpRequest, TokenSource } from './providers/http';
import { ProviderError } from './providers/types';
import type { CalendarConnection, CalendarProvider, ProviderKind } from './providers/types';
import { formatTime } from '../tasks-view/times';
import { t } from '../i18n';

/** This device's sign-in for the vault's calendar: a refresh token, or a CalDAV password. */
const SECRET = 'sidebar-highlights-calendar';
/** How long after tasks change a round runs, so a burst of edits is one round. */
const SETTLE_MS = 5_000;
/** How often a round runs to pick up changes made in the calendar. */
const EVERY_MS = 5 * 60_000;
/** How long a sign-in in the browser is waited for. */
const SIGN_IN_MS = 10 * 60_000;

export interface SyncStatus {
    state: 'off' | 'idle' | 'syncing' | 'problem';
    message?: string;
    /** When the last round finished, in milliseconds. */
    at?: number;
    result?: RoundResult;
}

/** Hands out access tokens for Google and Outlook, refreshed through Power-Up. */
class PlusTokens implements TokenSource {
    private token: { value: string; expiresAt: number } | null = null;

    constructor(private provider: CalendarSignInProvider, private plus: PlusClient, private secrets: { get(): string | null; set(value: string): void }) {}

    seed(value: string, expiresAt: number): void {
        this.token = { value, expiresAt };
    }

    async access(force = false): Promise<string> {
        if (!force && this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
        const refresh = this.secrets.get();
        if (!refresh) throw new ProviderError('signed-out', t('calendar.errors.signInHere'));
        try {
            const fresh = await this.plus.refresh(this.provider, refresh);
            if (fresh.refreshToken) this.secrets.set(fresh.refreshToken);
            this.token = { value: fresh.accessToken, expiresAt: fresh.expiresAt };
            return fresh.accessToken;
        } catch (error) {
            if (error instanceof PlusError) {
                if (error.code === 'calendar-signed-out') throw new ProviderError('signed-out', t('calendar.errors.signedOut'));
                if (['license-unknown', 'license-inactive', 'device-limit'].includes(error.code)) throw new ProviderError('license', error.message);
            }
            throw new ProviderError('other', error instanceof Error ? error.message : String(error));
        }
    }
}

/**
 * Keeps the vault's calendar in step with its tasks: a round when the plugin
 * starts, a few seconds after tasks change, every five minutes, and when
 * Obsidian comes back to the front. Also connects and disconnects calendars.
 */
export class CalendarSync {
    readonly plus: PlusClient;
    private status: SyncStatus = { state: 'off' };
    private listeners = new Set<() => void>();
    private timer: number | null = null;
    private running: Promise<void> | null = null;
    private again = false;
    private unsubscribe: (() => void) | null = null;
    private tokens: PlusTokens | null = null;
    /** The tasks as sync last saw them, so an index change that touches no dated task skips a round. */
    private lastSignature = '';
    private pendingTicket: { ticket: string; provider: CalendarSignInProvider; done: (ok: boolean) => void } | null = null;
    private request: HttpRequest = requestUrl;

    constructor(private plugin: HighlightCommentsPlugin, private index: TaskIndex) {
        this.plus = new PlusClient(plugin.app);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    start(): void {
        this.unsubscribe = this.index.onChange(() => this.changed());
        this.plugin.registerInterval(window.setInterval(() => this.schedule(0), EVERY_MS));
        this.plugin.registerDomEvent(window, 'focus', () => this.schedule(0));
        this.plugin.registerObsidianProtocolHandler('sidebar-highlights-calendar', (params) => {
            if (this.pendingTicket && params.ticket === this.pendingTicket.ticket) void this.claim();
        });
        this.schedule(0);
    }

    stop(): void {
        this.unsubscribe?.();
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
        this.pendingTicket?.done(false);
        this.pendingTicket = null;
    }

    connection(): CalendarConnection | null {
        return this.plugin.settings.calendar;
    }

    /** Whether this device has signed in to the vault's calendar. */
    signedInHere(): boolean {
        return Boolean(this.secret());
    }

    getStatus(): SyncStatus {
        return this.status;
    }

    onStatus(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private setStatus(status: SyncStatus): void {
        this.status = status;
        for (const listener of [...this.listeners]) listener();
    }

    /** A setting sync depends on changed: run a round soon. */
    settingsChanged(): void {
        this.lastSignature = '';
        this.schedule(SETTLE_MS);
    }

    private changed(): void {
        if (this.signature() !== this.lastSignature) this.schedule(SETTLE_MS);
    }

    private signature(): string {
        return this.index.tasks()
            .map(task => `${task.filePath}\u0000${task.lineNumber}\u0000${task.status}\u0000${task.text}`)
            .join('\n');
    }

    private schedule(delay: number): void {
        if (!calendarAvailable(this.plugin.app) || !this.connection() || !this.signedInHere()) {
            if (this.status.state !== 'off' && !this.connection()) this.setStatus({ state: 'off' });
            return;
        }
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            this.timer = null;
            void this.syncNow();
        }, delay);
    }

    // ── A round ─────────────────────────────────────────────────────────

    /** Runs a round now, or once the one running finishes. */
    syncNow(): Promise<void> {
        if (this.running) {
            this.again = true;
            return this.running;
        }
        this.running = this.round().finally(() => {
            this.running = null;
            if (this.again) {
                this.again = false;
                this.schedule(0);
            }
        });
        return this.running;
    }

    private async round(): Promise<void> {
        const connection = this.connection();
        if (!connection || !this.signedInHere()) return;
        // Every note must have been read, or tasks not read yet would look deleted.
        await this.index.whenReady();
        if (!this.index.isReady()) return;
        const plus = await this.plugin.refreshPlusStatus();
        if (plus.state !== 'active') {
            this.setStatus({ state: 'problem', message: plus.message ?? t('calendar.errors.noPlus'), at: this.status.at });
            return;
        }
        this.setStatus({ ...this.status, state: 'syncing' });
        try {
            const settings = this.plugin.settings;
            const result = await runRound({
                tasks: syncTasks(this.index.tasks(), settings.hideTasksPluginMetadata, t('reminders.untitled')),
                provider: this.provider(connection),
                options: { timedOnly: settings.calendarTimedOnly, clearOnDelete: settings.calendarClearOnDelete, adopt: connection.adopt },
                notes: {
                    exists: (path) => this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile,
                    mtime: (path) => {
                        const file = this.plugin.app.vault.getAbstractFileByPath(path);
                        return file instanceof TFile ? file.stat.mtime : 0;
                    }
                },
                now: Date.now(),
                draft: (id, fields, written) => {
                    const link = `obsidian://open?vault=${encodeURIComponent(this.plugin.app.vault.getName())}&file=${encodeURIComponent(fields.path)}`;
                    return {
                        id, title: fields.title, date: fields.date, time: fields.time,
                        description: `${noteName(fields.path)}\n${link}`, link,
                        minutes: settings.calendarEventMinutes,
                        alert: fields.time ? settings.taskReminderLead : undefined,
                        timeZone: deviceZone(),
                        written
                    };
                },
                formatDate: (iso) => moment(iso, 'YYYY-MM-DD').format(settings.taskDateFormat || 'YYYY-MM-DD'),
                formatTime: (time) => formatTime(time, settings.taskTimeFormat),
                clearedNote: (date) => t('calendar.clearedNote', { today: moment().format(settings.taskDateFormat || 'YYYY-MM-DD'), date }),
                editNote: (path, edits) => this.editNote(path, edits)
            });
            if (result.stopped) {
                this.setStatus({ state: 'problem', message: t('calendar.errors.emptied', { count: result.stopped.missing }), at: Date.now() });
                return;
            }
            if (connection.adopt) {
                this.plugin.settings.calendar = { ...connection, adopt: false };
                await this.plugin.saveSettings();
            }
            // Taken after the round's own note writes, so they don't set off another round.
            this.lastSignature = this.signature();
            this.setStatus({ state: 'idle', at: Date.now(), result });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof ProviderError && error.kind === 'gone') {
                this.setStatus({ state: 'problem', message: t('calendar.errors.gone') });
            } else {
                this.setStatus({ state: 'problem', message, at: this.status.at });
            }
        }
    }

    private async editNote(path: string, edits: NoteEdit[]): Promise<number> {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return edits.length;
        let missed = 0;
        const written = await this.plugin.app.vault.process(file, (content) => {
            const result = applyNoteEdits(content.split('\n'), edits);
            missed = result.missed;
            return result.lines.join('\n');
        });
        // The next round must see the IDs just written, or it would make their events again.
        this.index.noteWritten(path, written);
        return missed;
    }

    // ── Providers and secrets ───────────────────────────────────────────

    private secret(): string | null {
        return this.plugin.app.secretStorage.getSecret(SECRET)?.trim() || null;
    }

    private setSecret(value: string): void {
        this.plugin.app.secretStorage.setSecret(SECRET, value);
    }

    private tokensFor(provider: CalendarSignInProvider): PlusTokens {
        if (!this.tokens) this.tokens = new PlusTokens(provider, this.plus, { get: () => this.secret(), set: (value) => this.setSecret(value) });
        return this.tokens;
    }

    private provider(connection: CalendarConnection): CalendarProvider {
        switch (connection.provider) {
            case 'google':
                return new GoogleCalendar(connection.calendarId, this.tokensFor('google'), this.request);
            case 'microsoft':
                return new OutlookCalendar(connection.calendarId, this.tokensFor('microsoft'), this.request);
            default:
                return new CalDavCalendar(connection.calendarId, { username: connection.account, password: () => this.secret() }, this.request, providerName(connection.provider));
        }
    }

    private calendarName(): string {
        return t('calendar.calendarName', { vault: this.plugin.app.vault.getName() });
    }

    /** Saves the connection; a calendar this vault hasn't used yet adopts any old IDs. */
    private async connected(connection: CalendarConnection): Promise<void> {
        const previous = this.plugin.settings.calendar;
        const same = previous?.provider === connection.provider && previous.calendarId === connection.calendarId;
        this.plugin.settings.calendar = { ...connection, adopt: same ? previous?.adopt : true };
        await this.plugin.saveSettings();
        this.lastSignature = '';
        this.setStatus({ state: 'idle' });
        // The task index may have been idle with nothing wanting it.
        this.plugin.taskSettingsChanged();
        void this.syncNow();
    }

    // ── Connecting ──────────────────────────────────────────────────────

    /**
     * Signs in to Google or Outlook in the browser. The server hands the
     * tokens back once: the done page links back to Obsidian, and this polls
     * for them too, in case that link never fires.
     */
    async connectOAuth(provider: CalendarSignInProvider): Promise<boolean> {
        const { ticket, url } = await this.plus.beginSignIn(provider);
        window.open(url, '_external');
        return new Promise<boolean>((resolve) => {
            this.pendingTicket?.done(false);
            const deadline = Date.now() + SIGN_IN_MS;
            let timer = 0;
            const done = (ok: boolean) => {
                window.clearInterval(timer);
                if (this.pendingTicket?.ticket === ticket) this.pendingTicket = null;
                resolve(ok);
            };
            this.pendingTicket = { ticket, provider, done };
            timer = window.setInterval(() => {
                if (Date.now() > deadline) done(false);
                else void this.claim();
            }, 2_000);
        });
    }

    private claiming = false;

    private async claim(): Promise<void> {
        const pending = this.pendingTicket;
        if (!pending || this.claiming) return;
        this.claiming = true;
        try {
            const tokens = await this.plus.claim(pending.ticket);
            if (!tokens) return;
            this.setSecret(tokens.refreshToken);
            this.tokens = null;
            const source = this.tokensFor(pending.provider);
            source.seed(tokens.accessToken, tokens.expiresAt);
            const previous = this.connection();
            let calendarId = previous?.provider === pending.provider ? previous.calendarId : '';
            if (!calendarId) {
                calendarId = pending.provider === 'google'
                    ? await GoogleCalendar.createCalendar(source, this.request, this.calendarName(), deviceZone())
                    : await OutlookCalendar.createCalendar(source, this.request, this.calendarName());
            }
            await this.connected({
                provider: pending.provider,
                account: tokens.account || previous?.account || '',
                calendarId,
                calendarName: previous?.provider === pending.provider ? previous.calendarName : this.calendarName()
            });
            pending.done(true);
        } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
            pending.done(false);
        } finally {
            this.claiming = false;
        }
    }

    /** Connects iCloud or another CalDAV server with a user name and password. */
    async connectCalDav(kind: 'icloud' | 'caldav', server: string, username: string, password: string): Promise<void> {
        const base = kind === 'icloud' ? ICLOUD_SERVER : server.endsWith('/') ? server : `${server}/`;
        const login = { username, password: () => password };
        const previous = this.connection();
        const reuse = previous?.provider === kind && previous.account === username && (kind === 'icloud' || previous.server === base);
        let calendarId = reuse ? previous.calendarId : '';
        if (!calendarId) {
            const home = await CalDavCalendar.home(base, login, this.request);
            calendarId = await CalDavCalendar.createCalendar(home, login, this.request, this.calendarName());
        }
        this.setSecret(password);
        await this.connected({
            provider: kind,
            account: username,
            calendarId,
            calendarName: reuse ? previous.calendarName : this.calendarName(),
            server: kind === 'caldav' ? base : undefined
        });
    }

    /**
     * Stops syncing: this device signs out and the vault forgets the
     * calendar. The calendar and its events stay where they are, and no task
     * changes.
     */
    async disconnect(): Promise<void> {
        const connection = this.connection();
        const secret = this.secret();
        if (connection && secret && (connection.provider === 'google' || connection.provider === 'microsoft')) {
            await this.plus.revoke(connection.provider, secret);
        }
        this.setSecret('');
        this.tokens = null;
        this.plugin.settings.calendar = null;
        await this.plugin.saveSettings();
        this.plugin.taskSettingsChanged();
        this.setStatus({ state: 'off' });
    }
}

function noteName(path: string): string {
    return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

export function providerName(kind: ProviderKind): string {
    return t(`calendar.providers.${kind}`);
}
