import { Platform, requestUrl } from 'obsidian';
import type { App, RequestUrlParam, RequestUrlResponse } from 'obsidian';

/**
 * Power-Up, the subscription that unlocks calendar sync here and hosted
 * Describe in Oriko. One license key covers both: Sidebar Highlights reads
 * it from the same keychain entry Oriko uses, and the two plugins share one
 * install id per device and vault, so using both takes one activation.
 *
 * The server checks the license, brokers Google and Outlook sign-in, and
 * refreshes their tokens. It never sees a task or a calendar's contents.
 */

export const PLUS_BASE = 'https://powerup.trevware.com';
/**
 * Calendar sync shows in settings once the server, Google's and Microsoft's
 * sign-in apps and Power-Up are live. Until then a vault can preview it
 * by setting the local storage key `sidebar-highlights-calendar-preview` to
 * "true" (from the developer console: app.saveLocalStorage(key, 'true')).
 */
export const CALENDAR_LAUNCHED = false;
export const CALENDAR_PREVIEW_KEY = 'sidebar-highlights-calendar-preview';

/** Whether calendar sync, and with it any call to the Power-Up server, is on in this vault. */
export function calendarAvailable(app: App): boolean {
    return CALENDAR_LAUNCHED || app.loadLocalStorage(CALENDAR_PREVIEW_KEY) === 'true';
}
/** Obsidian keychain id for the license key, shared with Oriko. */
export const LICENSE_SECRET = 'oriko-plus-license';
/** Obsidian local storage key for this device's install id, shared with Oriko. */
export const INSTALL_KEY = 'trevware-plus-install';
/** The key Oriko keeps the same id under, so a device Oriko activated is already activated here. */
const ORIKO_INSTALL_KEY = 'oriko-plus-install';
const FROM_SETTINGS = 'utm_source=sidebar-highlights&utm_medium=settings';
export const PLUS_CHECKOUT = `https://buy.polar.sh/polar_cl_pzcr2OMDKqtA0UBKHdiRqnI6h68WBHNIrLOst49JIJi?${FROM_SETTINGS}`;
export const PLUS_PAGE = `https://trevware.com/power-up/?${FROM_SETTINGS}`;
/** Where this device keeps when the server last said the license was active. */
const LAST_ACTIVE_KEY = 'sidebar-highlights-plus-active';
/** How long a license last seen active keeps calendar sync going while the server can't be reached. */
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** How long one answer from the server about the license is trusted. */
const STATUS_TTL_MS = 60 * 60 * 1000;

const KEY_SHAPE = /^(?:[A-Z0-9_]{1,32}-)?[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

export function looksLikeKey(key: string): boolean {
    return KEY_SHAPE.test(key.trim());
}

export type PlusState =
    /** No key entered. */
    | 'none'
    | 'active'
    /** Polar doesn't know the key. */
    | 'unknown'
    /** The subscription ended or was refunded. */
    | 'inactive'
    /** Five devices already use the key. */
    | 'device-limit'
    /** The server couldn't be reached, or isn't working. */
    | 'offline';

export interface PlusStatus {
    state: PlusState;
    message?: string;
}

export type CalendarSignInProvider = 'google' | 'microsoft';

export interface CalendarTokens {
    provider: CalendarSignInProvider;
    account: string;
    refreshToken: string;
    accessToken: string;
    /** When the access token stops working, in milliseconds. */
    expiresAt: number;
}

export class PlusError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) {
        super(message);
    }
}

type Request = (param: RequestUrlParam) => Promise<RequestUrlResponse>;

export class PlusClient {
    private cached: { status: PlusStatus; at: number } | null = null;

    constructor(private app: App, private request: Request = requestUrl) {}

    licenseKey(): string | null {
        return this.app.secretStorage.getSecret(LICENSE_SECRET)?.trim() || null;
    }

    setLicenseKey(key: string): void {
        this.app.secretStorage.setSecret(LICENSE_SECRET, key.trim());
        this.cached = null;
    }

    /** This device's install id, shared with Oriko, made the first time either plugin asks. */
    installId(): string {
        for (const key of [INSTALL_KEY, ORIKO_INSTALL_KEY]) {
            const saved: unknown = this.app.loadLocalStorage(key);
            if (typeof saved === 'string' && saved) {
                this.app.saveLocalStorage(INSTALL_KEY, saved);
                return saved;
            }
        }
        const id = crypto.randomUUID();
        this.app.saveLocalStorage(INSTALL_KEY, id);
        this.app.saveLocalStorage(ORIKO_INSTALL_KEY, id);
        return id;
    }

    private label(): string {
        const platform = Platform.isMacOS ? 'Mac' : Platform.isWin ? 'Windows' : Platform.isLinux ? 'Linux'
            : Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : 'Device';
        return `${platform} · ${this.app.vault.getName()}`.slice(0, 100);
    }

    /** One call to the server, read as JSON. Errors come back as PlusError. */
    private async call(method: 'GET' | 'POST', path: string, body?: unknown, withKey = true): Promise<{ status: number; json: Record<string, unknown> }> {
        const key = this.licenseKey();
        if (withKey && !key) throw new PlusError('license-unknown', 'Enter your Power-Up license key first.', 401);
        const headers: Record<string, string> = { 'X-Trevware-Install': this.installId() };
        if (withKey && key) headers.Authorization = `Bearer ${key}`;
        let response: RequestUrlResponse;
        try {
            response = await this.request({
                url: `${PLUS_BASE}${path}`,
                method,
                headers,
                contentType: body === undefined ? undefined : 'application/json',
                body: body === undefined ? undefined : JSON.stringify(body),
                throw: false
            });
        } catch (error) {
            throw new PlusError('offline', error instanceof Error ? error.message : String(error), 0);
        }
        let json: Record<string, unknown> = {};
        try {
            const parsed: unknown = response.json;
            if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
        } catch {
            // An answer that isn't JSON is read by its status alone.
        }
        if (response.status >= 400) {
            const code = typeof json.error === 'string' ? json.error : 'upstream';
            const message = typeof json.message === 'string' ? json.message : `Power-Up answered ${response.status}.`;
            throw new PlusError(code, message, response.status);
        }
        return { status: response.status, json };
    }

    /** A call that activates this device first when the server asks for it. */
    private async paid(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
        try {
            return await this.call(method, path, body);
        } catch (error) {
            if (!(error instanceof PlusError) || error.code !== 'not-activated') throw error;
            await this.call('POST', '/v1/activate', { key: this.licenseKey(), install: this.installId(), label: this.label() }, false);
            return this.call(method, path, body);
        }
    }

    /**
     * Whether Power-Up is active on this device, asked of the server at
     * most once an hour. While the server can't be reached, a license seen
     * active in the last week still counts.
     */
    async status(fresh = false): Promise<PlusStatus> {
        if (!this.licenseKey()) return { state: 'none' };
        if (!fresh && this.cached && Date.now() - this.cached.at < STATUS_TTL_MS) return this.cached.status;
        let status: PlusStatus;
        try {
            await this.paid('GET', '/v1/plus');
            status = { state: 'active' };
            this.app.saveLocalStorage(LAST_ACTIVE_KEY, String(Date.now()));
        } catch (error) {
            const code = error instanceof PlusError ? error.code : 'offline';
            const message = error instanceof Error ? error.message : String(error);
            if (code === 'license-unknown') status = { state: 'unknown', message };
            else if (code === 'license-inactive') status = { state: 'inactive', message };
            else if (code === 'device-limit') status = { state: 'device-limit', message };
            else {
                const last = Number(this.app.loadLocalStorage(LAST_ACTIVE_KEY));
                status = Number.isFinite(last) && Date.now() - last < OFFLINE_GRACE_MS ? { state: 'active' } : { state: 'offline', message };
            }
        }
        this.cached = { status, at: Date.now() };
        return status;
    }

    /** Starts a calendar sign-in: the page to open in the browser, and the ticket to collect the result with. */
    async beginSignIn(provider: CalendarSignInProvider): Promise<{ ticket: string; url: string }> {
        const { json } = await this.paid('POST', `/v1/calendar/${provider}/begin`, {});
        if (typeof json.ticket !== 'string' || typeof json.url !== 'string') throw new PlusError('upstream', 'Power-Up sent an unexpected answer.', 200);
        return { ticket: json.ticket, url: json.url };
    }

    /** The sign-in's tokens once the browser is done, or null while it isn't yet. */
    async claim(ticket: string): Promise<CalendarTokens | null> {
        const { status, json } = await this.paid('POST', '/v1/calendar/claim', { ticket });
        if (status === 202) return null;
        const provider = json.provider === 'google' || json.provider === 'microsoft' ? json.provider : null;
        if (!provider || typeof json.refreshToken !== 'string' || typeof json.accessToken !== 'string') {
            throw new PlusError('upstream', 'Power-Up sent an unexpected answer.', status);
        }
        return {
            provider,
            account: typeof json.account === 'string' ? json.account : '',
            refreshToken: json.refreshToken,
            accessToken: json.accessToken,
            expiresAt: Number(json.expiresAt) || Date.now() + 30 * 60 * 1000
        };
    }

    /** A fresh access token. Outlook may hand back a new refresh token with it. */
    async refresh(provider: CalendarSignInProvider, refreshToken: string): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> {
        const { json } = await this.paid('POST', `/v1/calendar/${provider}/token`, { refreshToken });
        if (typeof json.accessToken !== 'string') throw new PlusError('upstream', 'Power-Up sent an unexpected answer.', 200);
        return {
            accessToken: json.accessToken,
            expiresAt: Number(json.expiresAt) || Date.now() + 30 * 60 * 1000,
            refreshToken: typeof json.refreshToken === 'string' ? json.refreshToken : undefined
        };
    }

    /** Signs this device out of the provider. Best effort: disconnecting goes ahead either way. */
    async revoke(provider: CalendarSignInProvider, refreshToken: string): Promise<void> {
        try {
            await this.call('POST', `/v1/calendar/${provider}/revoke`, { refreshToken }, false);
        } catch {
            // Forgetting the token on this device is what disconnecting needs.
        }
    }
}
