/**
 * Calendar arithmetic on plain ISO day strings (YYYY-MM-DD).
 *
 * The Tasks tab only ever deals in whole days, so every date here is a day
 * label, never an instant. Working in UTC midnights keeps a daylight-saving
 * change from turning "tomorrow" into "today" for an hour. Kept free of
 * Obsidian imports so it can be unit tested directly.
 */

import { displayTime } from './times';

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
    const date = new Date(ms);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Today in the device's own time zone, as an ISO day. */
export function isoToday(now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
    return fromUtc(toUtc(iso) + days * DAY_MS);
}

/** The time on the device's own clock, as 24-hour HH:mm. */
export function nowTime(now: Date = new Date()): string {
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Whole days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
    return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 0 for Sunday through 6 for Saturday, matching Date.getDay(). */
export function weekday(iso: string): number {
    return new Date(toUtc(iso)).getUTCDay();
}

/** The Monday on or before a day, so weeks group the way a calendar shows them. */
export function startOfWeek(iso: string): string {
    const offset = (weekday(iso) + 6) % 7;
    return addDays(iso, -offset);
}

export function addMonths(iso: string, months: number): string {
    const date = new Date(toUtc(iso));
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
    // Clamp to the last day of the target month, so 31 January plus one is 28 February.
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    return fromUtc(target.getTime());
}

function format(iso: string, options: Intl.DateTimeFormatOptions, locale?: string): string {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(toUtc(iso)));
}

export function weekdayName(iso: string, style: 'long' | 'short' = 'long', locale?: string): string {
    return format(iso, { weekday: style }, locale);
}

export function monthName(iso: string, locale?: string): string {
    return format(iso, { month: 'long' }, locale);
}

/** "3 Nov", or "3 Nov 2027" when the day is not in the current year. */
export function shortDate(iso: string, today: string, locale?: string): string {
    const sameYear = iso.slice(0, 4) === today.slice(0, 4);
    return format(iso, sameYear
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', year: 'numeric' }, locale);
}

export type DateTone = 'overdue' | 'today' | 'soon' | 'later';

export interface DateLabel {
    text: string;
    tone: DateTone;
}

export interface DateWords {
    today: string;
    tomorrow: string;
    yesterday: string;
}

/**
 * The words a task row shows for its date. Neutral words, since the one date
 * a task carries can mean a start day or a deadline: Today, Tomorrow, a
 * weekday inside the coming week, and a short date beyond it.
 */
export function rowDateLabel(iso: string, today: string, words: DateWords, locale?: string): DateLabel {
    const diff = daysBetween(today, iso);
    if (diff === 0) return { text: words.today, tone: 'today' };
    if (diff === 1) return { text: words.tomorrow, tone: 'soon' };
    if (diff === -1) return { text: words.yesterday, tone: 'overdue' };
    if (diff < 0) return { text: shortDate(iso, today, locale), tone: 'overdue' };
    if (diff < 7) return { text: weekdayName(iso, 'long', locale), tone: 'soon' };
    return { text: shortDate(iso, today, locale), tone: 'later' };
}

export interface DueLabelOptions {
    today: string;
    /** The clock now, as 24-hour HH:mm. */
    now: string;
    words: DateWords;
    hour12: boolean;
    /** False inside a group that is itself the day, where only the time is worth showing. */
    showDay: boolean;
    locale?: string;
}

/**
 * A row's date with its time: "Today 15:00", "Fri 3 PM", or just "15:00"
 * inside the day's own group. A time today that has gone by reads as overdue,
 * while the task stays in Today.
 */
export function dueLabel(iso: string, time: string | undefined, options: DueLabelOptions): DateLabel {
    const { today, now, words, hour12, showDay, locale } = options;
    const day = rowDateLabel(iso, today, words, locale);
    if (!time) return day;
    const clock = displayTime(time, hour12, locale);
    return {
        text: showDay ? `${day.text} ${clock}` : clock,
        tone: iso === today && time < now ? 'overdue' : day.tone
    };
}
