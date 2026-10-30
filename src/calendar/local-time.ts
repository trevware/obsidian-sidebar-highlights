/**
 * Days and times on this device's clock, which is how tasks carry them.
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** A task's day and time as a moment. */
export function localMs(date: string, time = '00:00'): number {
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    return new Date(y, m - 1, d, h, min).getTime();
}

/** A moment as a day and a time on this device's clock. */
export function localParts(ms: number): { date: string; time: string } {
    const d = new Date(ms);
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** The day after, as an ISO day. */
export function nextDay(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** A local wall-clock time as written without an offset: `2026-10-30T15:00:00`. */
export function wallClock(date: string, time: string): string {
    return `${date}T${time}:00`;
}

/** The device's time zone, IANA name. */
export function deviceZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}
