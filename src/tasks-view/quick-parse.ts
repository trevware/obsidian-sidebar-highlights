/**
 * Natural-language dates and priorities for quick add and the date picker.
 *
 * Quick add reads a typed line like "Call the dentist fri p1" and pulls out
 * the date and priority, the way Todoist's Quick Add does, so the words that
 * were recognised can be shown highlighted and clicked to turn them back into
 * plain text. Kept free of Obsidian imports so it can be unit tested directly.
 */

import { addDays, addMonths, startOfWeek, weekday } from './dates';

export type TokenKind = 'date' | 'priority';

export interface ParsedToken {
    kind: TokenKind;
    start: number;
    /** Exclusive. */
    end: number;
    text: string;
}

export interface QuickParse {
    /** The task text with every recognised token taken out. */
    title: string;
    date?: string;
    priority?: 1 | 2 | 3;
    tokens: ParsedToken[];
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function weekdayIndex(word: string): number | undefined {
    const lower = word.toLowerCase();
    const full = WEEKDAYS.indexOf(lower);
    if (full !== -1) return full;
    return WEEKDAY_SHORT[lower];
}

function monthIndex(word: string): number | undefined {
    const lower = word.toLowerCase();
    const full = MONTHS.indexOf(lower);
    if (full !== -1) return full;
    if (lower.length >= 3) {
        const short = MONTHS.findIndex(name => name.startsWith(lower) && (lower.length === 3 || lower === 'sept'));
        if (short !== -1) return short;
    }
    return undefined;
}

/** The next given weekday strictly after today. */
function nextWeekday(today: string, target: number): string {
    const diff = (target - weekday(today) + 7) % 7 || 7;
    return addDays(today, diff);
}

/** That weekday in the calendar week after this one. */
function weekdayNextWeek(today: string, target: number): string {
    const monday = addDays(startOfWeek(today), 7);
    return addDays(monday, (target + 6) % 7);
}

function iso(year: number, month: number, day: number): string | undefined {
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A day and month with no year: this year, or next year once it has passed. */
function dayMonth(today: string, month: number, day: number, year?: number): string | undefined {
    const thisYear = Number(today.slice(0, 4));
    if (year !== undefined) return iso(year, month, day);
    const candidate = iso(thisYear, month, day);
    if (candidate && candidate >= today) return candidate;
    return iso(thisYear + 1, month, day);
}

interface DateRule {
    pattern: string;
    resolve: (match: RegExpExecArray, today: string) => string | undefined;
}

const UNIT = String.raw`(d|days?|w|wks?|weeks?|m|mos?|months?)`;
const WEEKDAY_WORD = String.raw`(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)`;
const MONTH_WORD = String.raw`(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)`;

function addUnit(today: string, count: number, unit: string): string {
    if (unit.startsWith('d')) return addDays(today, count);
    if (unit.startsWith('w')) return addDays(today, count * 7);
    return addMonths(today, count);
}

const DATE_RULES: DateRule[] = [
    { pattern: String.raw`\d{4}-\d{2}-\d{2}`, resolve: (m) => {
        const [y, mo, d] = m[0].split('-').map(Number);
        return iso(y, mo - 1, d);
    } },
    { pattern: String.raw`(?:today|tod|td)`, resolve: (_m, today) => today },
    { pattern: String.raw`(?:tomorrow|tmrw?|tom|tm)`, resolve: (_m, today) => addDays(today, 1) },
    { pattern: String.raw`in\s+(\d{1,3})\s*${UNIT}`, resolve: (m, today) => addUnit(today, Number(m[1]), m[2].toLowerCase()) },
    { pattern: String.raw`next\s+week`, resolve: (_m, today) => addDays(startOfWeek(today), 7) },
    { pattern: String.raw`next\s+month`, resolve: (_m, today) => addMonths(today, 1) },
    { pattern: String.raw`(?:this\s+)?weekend`, resolve: (_m, today) => {
        const day = weekday(today);
        return day === 6 || day === 0 ? today : nextWeekday(today, 6);
    } },
    { pattern: String.raw`(?:eow|end\s+of\s+(?:the\s+)?week)`, resolve: (_m, today) => {
        const day = weekday(today);
        return day >= 1 && day <= 5 ? addDays(today, 5 - day) : nextWeekday(today, 5);
    } },
    { pattern: String.raw`next\s+${WEEKDAY_WORD}`, resolve: (m, today) => {
        const target = weekdayIndex(m[1]);
        return target === undefined ? undefined : weekdayNextWeek(today, target);
    } },
    { pattern: String.raw`(?:on\s+)?${WEEKDAY_WORD}`, resolve: (m, today) => {
        const target = weekdayIndex(m[1]);
        return target === undefined ? undefined : nextWeekday(today, target);
    } },
    { pattern: String.raw`${MONTH_WORD}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`, resolve: (m, today) => {
        const month = monthIndex(m[1]);
        return month === undefined ? undefined : dayMonth(today, month, Number(m[2]), m[3] ? Number(m[3]) : undefined);
    } },
    { pattern: String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH_WORD}(?:\s+(\d{4}))?`, resolve: (m, today) => {
        const month = monthIndex(m[2]);
        return month === undefined ? undefined : dayMonth(today, month, Number(m[1]), m[3] ? Number(m[3]) : undefined);
    } }
];

// Word edges that understand letters beyond ASCII, so "fri" inside "Friedrich"
// or "tom" inside "tomato" is never read as a date.
const EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const EDGE_AFTER = String.raw`(?![\p{L}\p{N}_])`;

function findAll(input: string, pattern: string): RegExpExecArray[] {
    const regex = new RegExp(`${EDGE_BEFORE}${pattern}${EDGE_AFTER}`, 'giu');
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
        matches.push(match);
        if (match[0].length === 0) regex.lastIndex++;
    }
    return matches;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
    return a.start < b.end && b.start < a.end;
}

/**
 * Read the date and priority out of a typed task line.
 *
 * The last date phrase wins, since a date is usually typed at the end.
 * `ignored` holds phrases the user clicked to turn back into text, matched
 * case-insensitively, so they stay plain for the rest of the draft.
 */
export function parseQuickAdd(input: string, today: string, ignored: ReadonlySet<string> = new Set()): QuickParse {
    const isIgnored = (text: string) => ignored.has(text.toLowerCase());

    // Longest first at each position: "next fri" should beat "fri".
    const dateCandidates: Array<ParsedToken & { date: string }> = [];
    for (const rule of DATE_RULES) {
        for (const match of findAll(input, rule.pattern)) {
            if (isIgnored(match[0])) continue;
            const date = rule.resolve(match, today);
            if (!date) continue;
            dateCandidates.push({ kind: 'date', start: match.index, end: match.index + match[0].length, text: match[0], date });
        }
    }
    dateCandidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.start - a.start);
    const dateTokens: typeof dateCandidates = [];
    for (const candidate of dateCandidates) {
        if (!dateTokens.some(kept => overlaps(kept, candidate))) dateTokens.push(candidate);
    }
    const dateToken = dateTokens.sort((a, b) => b.start - a.start)[0];

    const priorityMatches = findAll(input, String.raw`p([123])`)
        .filter(match => !isIgnored(match[0]))
        .filter(match => !dateToken || !overlaps(dateToken, { start: match.index, end: match.index + match[0].length }));
    const priorityMatch = priorityMatches[priorityMatches.length - 1];

    const tokens: ParsedToken[] = [];
    if (dateToken) tokens.push({ kind: 'date', start: dateToken.start, end: dateToken.end, text: dateToken.text });
    if (priorityMatch) {
        tokens.push({ kind: 'priority', start: priorityMatch.index, end: priorityMatch.index + priorityMatch[0].length, text: priorityMatch[0] });
    }
    tokens.sort((a, b) => a.start - b.start);

    let title = '';
    let cursor = 0;
    for (const token of tokens) {
        title += input.slice(cursor, token.start);
        cursor = token.end;
    }
    title += input.slice(cursor);
    title = title.replace(/\s{2,}/g, ' ').trim();

    return {
        title,
        date: dateToken?.date,
        priority: priorityMatch ? (Number(priorityMatch[1]) as 1 | 2 | 3) : undefined,
        tokens
    };
}

/**
 * Read a whole query as a date, for the date picker. More forgiving than
 * quick add: a weekday or month can be typed by its first letters ("we",
 * "nov 3"), the way Things' When field resolves "tom" as you type.
 */
export function parseDateQuery(query: string, today: string): string | undefined {
    const trimmed = query.trim().toLowerCase();
    if (trimmed === '') return undefined;

    const whole = parseQuickAdd(trimmed, today);
    if (whole.date && whole.title === '') return whole.date;

    if (/^\d{1,3}$/.test(trimmed)) return addDays(today, Number(trimmed));

    const prefix = trimmed.match(/^(next\s+)?([a-z]{2,})$/);
    if (prefix) {
        const day = WEEKDAYS.findIndex(name => name.startsWith(prefix[2]));
        if (day !== -1) return prefix[1] ? weekdayNextWeek(today, day) : nextWeekday(today, day);
        if (!prefix[1] && 'tomorrow'.startsWith(prefix[2])) return addDays(today, 1);
        if (!prefix[1] && 'today'.startsWith(prefix[2])) return today;
    }

    const monthDay = trimmed.match(/^([a-z]{3,})\s+(\d{1,2})$/);
    if (monthDay) {
        const month = MONTHS.findIndex(name => name.startsWith(monthDay[1]));
        if (month !== -1) return dayMonth(today, month, Number(monthDay[2]));
    }

    return undefined;
}
