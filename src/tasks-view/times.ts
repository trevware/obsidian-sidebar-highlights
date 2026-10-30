/**
 * A task's time of day, written right after its date.
 *
 * Times are wall-clock times with no time zone, kept as 24-hour `HH:mm`: a
 * task at 15:00 is at 15:00 wherever you are, the way an alarm clock is. How a
 * time is written into a note follows the Time format setting, and either
 * form is read. Kept free of Obsidian imports so it can be unit tested
 * directly.
 */

import { dateTimeFormat } from './formatters';

/** How times are written: 24-hour `15:00`, or 12-hour `3pm`. */
export type TimeFormat = 'HH:mm' | 'h:mma';

/**
 * One time as it may be written: `15:00`, `9:05`, `3pm`, `3:30 PM`, `9 a.m.`.
 * The hour needs a colon or an am/pm after it, so a bare number is never a
 * time. Its groups are the hour, the minutes and the meridiem's letter.
 */
export const TIME_SOURCE = String.raw`(?=\d{1,2}(?::\d{2}|\s?[ap](?:m|\.m\.)))(\d{1,2})(?::(\d{2}))?(?:\s?([ap])(?:m|\.m\.))?`;

/** The times offered to pick from, before any typed one. */
export const TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00'];

const WHOLE_TIME = new RegExp(`^${TIME_SOURCE}$`, 'iu');

/** A 24-hour time alone, without any am/pm after it. */
const COLON_SOURCE = String.raw`\d{1,2}:\d{2}`;

/** The end of a word: nothing after it, or something other than a letter, digit or colon. */
const WORD_EDGE = String.raw`(?![\p{L}\p{N}_:])`;

const pad = (n: number) => String(n).padStart(2, '0');

/** One time phrase as `HH:mm`, or undefined when it isn't a real time. */
export function parseTime(word: string): string | undefined {
    const phrase = word.trim().toLowerCase();
    if (phrase === 'noon') return '12:00';
    if (phrase === 'midnight') return '00:00';
    const match = phrase.match(WHOLE_TIME);
    if (!match) return undefined;
    let hour = Number(match[1]);
    const minutes = match[2] === undefined ? 0 : Number(match[2]);
    if (minutes > 59) return undefined;
    if (match[3]) {
        if (hour < 1 || hour > 12) return undefined;
        hour = hour % 12 + (match[3] === 'p' ? 12 : 0);
    } else if (hour > 23) {
        return undefined;
    }
    return `${pad(hour)}:${pad(minutes)}`;
}

/**
 * The time written right after a task's date, which ends at `from`: one
 * space, then a time, then the end of the word. Anything else after a date
 * is the task's own words.
 */
export function readTimeAfter(text: string, from: number): { time: string; text: string; end: number } | undefined {
    if (text[from] !== ' ' || !/\S/u.test(text[from + 1] ?? '')) return undefined;
    // The word edge sits inside the pattern, so "15:00 Amsterdam" falls back
    // to 15:00 instead of losing the time. A 24-hour time with a stray pm
    // after it ("14:00 PM standup") is read without the pm.
    for (const source of [TIME_SOURCE, COLON_SOURCE]) {
        const pattern = new RegExp(`${source}${WORD_EDGE}`, 'iuy');
        pattern.lastIndex = from + 1;
        const match = pattern.exec(text);
        const time = match ? parseTime(match[0]) : undefined;
        if (match && time) return { time, text: match[0], end: from + 1 + match[0].length };
    }
    return undefined;
}

/** A time as it's written into a note: `15:00`, or `3pm` and `3:30pm`. */
export function formatTime(time: string, format: TimeFormat): string {
    if (format === 'HH:mm') return time;
    const [hour, minutes] = time.split(':').map(Number);
    const suffix = hour < 12 ? 'am' : 'pm';
    return `${hour % 12 || 12}${minutes ? `:${pad(minutes)}` : ''}${suffix}`;
}

/** A time as a row shows it, in the reader's own locale: "15:00", "3 PM", "3:30 PM". */
export function displayTime(time: string, hour12: boolean, locale?: string): string {
    const [hour, minutes] = time.split(':').map(Number);
    const options: Intl.DateTimeFormatOptions = hour12
        ? { hour: 'numeric', ...(minutes ? { minute: '2-digit' } : {}), hourCycle: 'h12' }
        : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    return dateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(1970, 0, 1, hour, minutes)));
}
