/**
 * Natural-language dates and priorities for quick add and the date picker.
 *
 * Quick add reads a typed line like "Call the dentist fri p1" and pulls out
 * the date and priority, the way Todoist's Quick Add does, so the words that
 * were recognised can be shown highlighted and clicked to turn them back into
 * plain text. Kept free of Obsidian imports so it can be unit tested directly.
 *
 * Chinese is read alongside English, whatever language Obsidian is in:
 * "明天下午3点给妈妈打电话 p2" is due tomorrow at 15:00 with priority 2.
 */

import { addDays, addMonths, startOfWeek, weekday } from './dates';
import { COLON_SOURCE, MERIDIEM_SOURCE, parseTime } from './times';

export type TokenKind = 'date' | 'priority' | 'time';

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
    /** A time of day as 24-hour HH:mm. Typed on its own it has no date here; quick add puts it on a day. */
    time?: string;
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

/** The last day of this month. */
function endOfMonth(today: string): string {
    const [year, month] = today.split('-').map(Number);
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** The next Monday to Friday after today. */
function nextWorkday(today: string): string {
    let day = addDays(today, 1);
    while (weekday(day) === 0 || weekday(day) === 6) day = addDays(day, 1);
    return day;
}

/** A day of this month, or of next month once it has passed. */
function dayOfMonth(today: string, day: number): string | undefined {
    const [year, month] = today.split('-').map(Number);
    const thisMonth = iso(year, month - 1, day);
    if (thisMonth && thisMonth >= today) return thisMonth;
    return month === 12 ? iso(year + 1, 0, day) : iso(year, month, day);
}

/** Early, mid and late in a month: the 5th, the 15th and the 25th. Todoist puts "mid January" on the 15th. */
const PART_OF_MONTH: Record<string, number> = { early: 5, mid: 15, late: 25, 上旬: 5, 中旬: 15, 下旬: 25 };

let slashDayFirst = false;

/** Whether a slash date both ways could read, like 3/4, is day first (4 March). Follows the vault's due date format. */
export function setSlashDayFirst(dayFirst: boolean): void {
    slashDayFirst = dayFirst;
}

/** 1/27, 27/1, 3/12/2027: whichever way the numbers allow, else the vault's order. */
function slashDate(m: RegExpExecArray, today: string): string | undefined {
    const first = Number(m[1]);
    const second = Number(m[2]);
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    const dayFirst = first > 12 ? true : second > 12 ? false : slashDayFirst;
    const [day, month] = dayFirst ? [first, second] : [second, first];
    if (month < 1 || month > 12 || day < 1) return undefined;
    return dayMonth(today, month - 1, day, year);
}

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
    } },
    { pattern: 'someday', resolve: (_m, today) => addMonths(today, 2) },
    { pattern: String.raw`(early|mid|late)[\s-]+${MONTH_WORD}`, resolve: (m, today) => {
        const month = monthIndex(m[2]);
        return month === undefined ? undefined : dayMonth(today, month, PART_OF_MONTH[m[1].toLowerCase()]);
    } },
    { pattern: String.raw`mid[\s-]?month`, resolve: (_m, today) => dayOfMonth(today, 15) },
    { pattern: String.raw`(?:eom|end\s+of\s+(?:the\s+)?month)`, resolve: (_m, today) => endOfMonth(today) },
    // Next week's Saturday, as "next fri" is next week's Friday.
    { pattern: String.raw`next\s+weekend`, resolve: (_m, today) => addDays(startOfWeek(today), 12) },
    { pattern: String.raw`next\s+(?:work|business)\s*day`, resolve: (_m, today) => nextWorkday(today) },
    { pattern: String.raw`\+\s*(\d{1,3})\s*${UNIT}`, resolve: (m, today) => addUnit(today, Number(m[1]), m[2].toLowerCase()) },
    { pattern: 'tonight', resolve: (_m, today) => today },
    // "this" only as the day of "this evening", whose time the evening gives.
    { pattern: String.raw`this(?=\s+(?:morning|afternoon|evening))`, resolve: (_m, today) => today },
    // Never inside a path like docs/1/2.
    { pattern: String.raw`(?<![\d/])(\d{4})/(\d{1,2})/(\d{1,2})(?![\d/])`, resolve: (m) => iso(Number(m[1]), Number(m[2]) - 1, Number(m[3])) },
    { pattern: String.raw`(?<![\d/])(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?(?![\d/])`, resolve: slashDate }
];

// ── Chinese ──

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** A number in figures or Chinese numerals up to 99: "3", "两", "十", "十五", "二十三". */
function cnNumber(text: string): number | undefined {
    if (/^\d+$/.test(text)) return Number(text);
    const tenAt = text.indexOf('十');
    if (tenAt === -1) return text.length === 1 ? CN_DIGITS[text] : undefined;
    if (tenAt > 1 || text.length - tenAt > 2) return undefined;
    const tens = tenAt === 0 ? 1 : CN_DIGITS[text[0]];
    const units = tenAt === text.length - 1 ? 0 : CN_DIGITS[text[tenAt + 1]];
    return tens === undefined || units === undefined ? undefined : tens * 10 + units;
}

const CN_NUM = String.raw`(\d{1,3}|[零〇一二两三四五六七八九十]{1,3})`;
const CN_WEEK = String.raw`(?:周|星期|礼拜)`;
const CN_WEEKDAY = String.raw`([一二三四五六日天])`;
const CN_WEEKDAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function cnUnit(unit: string): string {
    if (unit === '天' || unit === '日') return 'd';
    return unit.includes('月') ? 'm' : 'w';
}

DATE_RULES.push(
    { pattern: String.raw`(?:今天|今日|今晚|今早)`, resolve: (_m, today) => today },
    { pattern: String.raw`(?:明天|明日|明晚|明早)`, resolve: (_m, today) => addDays(today, 1) },
    { pattern: '后天', resolve: (_m, today) => addDays(today, 2) },
    { pattern: '大后天', resolve: (_m, today) => addDays(today, 3) },
    { pattern: String.raw`${CN_NUM}\s*(天|日|个?星期|个?礼拜|周|个月)\s*(?:之后|以后|后|之内|以内|内)`, resolve: (m, today) => {
        const count = cnNumber(m[1]);
        return count === undefined ? undefined : addUnit(today, count, cnUnit(m[2]));
    } },
    { pattern: String.raw`\+\s*${CN_NUM}\s*(天|日|个?星期|周|个月)`, resolve: (m, today) => {
        const count = cnNumber(m[1]);
        return count === undefined ? undefined : addUnit(today, count, cnUnit(m[2]));
    } },
    { pattern: String.raw`(?:月底|月末)`, resolve: (_m, today) => endOfMonth(today) },
    { pattern: String.raw`下\s*个?工作日`, resolve: (_m, today) => nextWorkday(today) },
    { pattern: String.raw`(?:某天|某一天|改天)`, resolve: (_m, today) => addMonths(today, 2) },
    { pattern: String.raw`(?:${CN_NUM}\s*月|(本|这个?|下个?)\s*月)\s*(上旬|中旬|下旬)`, resolve: (m, today) => {
        const day = PART_OF_MONTH[m[3]];
        const [year, month] = today.split('-').map(Number);
        if (m[1]) {
            const named = cnNumber(m[1]);
            return named === undefined || named < 1 || named > 12 ? undefined : dayMonth(today, named - 1, day);
        }
        if (m[2].startsWith('下')) return month === 12 ? iso(year + 1, 0, day) : iso(year, month, day);
        return iso(year, month - 1, day);
    } },
    { pattern: String.raw`(?:${CN_NUM}\s*)?月中(?!旬)`, resolve: (m, today) => {
        if (!m[1]) return dayOfMonth(today, 15);
        const named = cnNumber(m[1]);
        return named === undefined || named < 1 || named > 12 ? undefined : dayMonth(today, named - 1, 15);
    } },
    // Next week's Saturday, weeks starting on Monday as they do in China.
    { pattern: String.raw`下\s*个?周末`, resolve: (_m, today) => addDays(startOfWeek(today), 12) },
    { pattern: String.raw`下\s*个?${CN_WEEK}`, resolve: (_m, today) => addDays(startOfWeek(today), 7) },
    { pattern: String.raw`下\s*个?月`, resolve: (_m, today) => addMonths(today, 1) },
    { pattern: String.raw`(?:本|这个?)?周末`, resolve: (_m, today) => {
        const day = weekday(today);
        return day === 6 || day === 0 ? today : nextWeekday(today, 6);
    } },
    { pattern: String.raw`下\s*个?${CN_WEEK}${CN_WEEKDAY}`, resolve: (m, today) => weekdayNextWeek(today, CN_WEEKDAYS[m[1]]) },
    // This week's day, or next week's once it has gone by.
    { pattern: String.raw`(?:本|这个?)${CN_WEEK}${CN_WEEKDAY}`, resolve: (m, today) => {
        const day = addDays(startOfWeek(today), (CN_WEEKDAYS[m[1]] + 6) % 7);
        return day >= today ? day : nextWeekday(today, CN_WEEKDAYS[m[1]]);
    } },
    // Not 每周五, "every Friday", which is no one day.
    { pattern: String.raw`(?<!每)${CN_WEEK}${CN_WEEKDAY}`, resolve: (m, today) => nextWeekday(today, CN_WEEKDAYS[m[1]]) },
    { pattern: String.raw`(?:(\d{4})\s*年\s*)?${CN_NUM}\s*月\s*${CN_NUM}\s*(?:日|号)`, resolve: (m, today) => {
        const month = cnNumber(m[2]);
        const day = cnNumber(m[3]);
        if (month === undefined || day === undefined || month < 1 || month > 12) return undefined;
        return dayMonth(today, month - 1, day, m[1] ? Number(m[1]) : undefined);
    } },
    // In figures only, and never a building, a line or a room: 3号楼, 2号线.
    { pattern: String.raw`(\d{1,2})\s*(?:日|号)(?![楼线门室院号位栋层座床次])`, resolve: (m, today) => dayOfMonth(today, Number(m[1])) }
);

const CN_PERIOD = String.raw`(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上)`;
const CN_MINUTES = String.raw`(半|一刻|三刻|\d{1,2}(?:\s*分)?|[零〇一二三四五六七八九十]{1,3}\s*分)`;

/** A part of the day in English, at the same times as in Chinese. */
const EN_PARTS_OF_DAY: Record<string, string> = { morning: '09:00', afternoon: '15:00', evening: '19:00', night: '22:00' };

/**
 * A part of the day on its own, right after a day: 明天晚上, 周五下午. The
 * times are Todoist's for Chinese (早上 9点, 晚上 19点, 夜间 22点), except
 * 下午, which Todoist puts at noon; noon is 中午, so 下午 is mid-afternoon.
 */
const CN_PARTS_OF_DAY: Record<string, string> = {
    早上: '09:00', 早晨: '09:00', 上午: '09:00', 中午: '12:00', 下午: '15:00', 傍晚: '18:00', 晚上: '19:00', 夜间: '22:00', 夜里: '22:00'
};

/**
 * A Chinese time of day: 下午3点, 晚上8点半, 上午10点15分, 15点30. With no
 * period said, 1 to 6 o'clock is the afternoon (few tasks are at 3am) and
 * 7 to 12 is as written. `hint` is the part of day a 今晚 or 明早 just before
 * it gave.
 */
function cnTime(m: RegExpExecArray, hint?: string): string | undefined {
    let hour = cnNumber(m[2]);
    const period = m[1] ?? hint;
    const minutesText = m[3];
    // 一点 on its own is "a little", as in 多喝一点水.
    if (hour === undefined || hour > 24 || (m[2] === '一' && !period && !minutesText)) return undefined;
    let minutes = 0;
    if (minutesText === '半') minutes = 30;
    else if (minutesText === '一刻') minutes = 15;
    else if (minutesText === '三刻') minutes = 45;
    else if (minutesText) {
        const parsed = cnNumber(minutesText.replace(/\s*分$/u, ''));
        if (parsed === undefined || parsed > 59) return undefined;
        minutes = parsed;
    }
    if (period === '下午' || period === '傍晚' || period === '晚上') {
        if (hour < 12) hour += 12;
    } else if (period === '中午') {
        if (hour < 11) hour += 12;
    } else if (period === '凌晨') {
        if (hour === 12) hour = 0;
    } else if (!period && hour >= 1 && hour <= 6) {
        hour += 12;
    }
    if (hour === 24) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A colon time after a part of the day: 下午3:30 is 15:30, 上午9:30 stays 09:30. */
function cnColonTime(period: string, clock: string): string | undefined {
    const time = parseTime(clock);
    if (!time) return undefined;
    let hour = Number(time.slice(0, 2));
    if ((period === '下午' || period === '傍晚' || period === '晚上') && hour < 12) hour += 12;
    else if (period === '中午' && hour < 11) hour += 12;
    else if (period === '凌晨' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}${time.slice(2)}`;
}

/** Full-width letters, figures and colons, as a Chinese keyboard types them, read as their plain forms. One character for one, so every position still lines up. */
function halfWidth(text: string): string {
    return text.replace(/[\uFF01-\uFF5E]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)).replace(/\u3000/gu, ' ');
}

const PRIORITY_RULES: Array<{ pattern: string; level: (m: RegExpExecArray) => 1 | 2 | 3 }> = [
    { pattern: String.raw`p([123])`, level: (m) => Number(m[1]) as 1 | 2 | 3 },
    { pattern: String.raw`优先级\s*([123一二三])`, level: (m) => (cnNumber(m[1]) ?? Number(m[1])) as 1 | 2 | 3 },
    { pattern: String.raw`(高|中|低)\s*优先级`, level: (m) => ({ 高: 1, 中: 2, 低: 3 } as const)[m[1] as '高' | '中' | '低'] }
];

const AT = String.raw`(?:at|@)\s*`;
// Never the tail of something with a colon in it: "3:5pm" is not 5pm.
const NOT_AFTER_COLON = String.raw`(?<!:)`;

/**
 * Where a time may stand in quick add. One with am/pm, or noon and midnight,
 * reads anywhere, as date words do. A bare colon time needs "at" in front of
 * it or a date phrase right before it, so a verse like "John 3:16" stays words.
 */
const TIME_RULES: Array<{ pattern: string; afterDate?: boolean; resolve?: (m: RegExpExecArray, hint?: string) => string | undefined }> = [
    { pattern: String.raw`(?:${AT})?${NOT_AFTER_COLON}(${MERIDIEM_SOURCE}|noon|midnight)` },
    { pattern: String.raw`${AT}(${COLON_SOURCE})` },
    { pattern: String.raw`${NOT_AFTER_COLON}(${COLON_SOURCE})`, afterDate: true },
    // A part of the day with a colon time: 下午3:30.
    { pattern: String.raw`${CN_PERIOD}\s*(${COLON_SOURCE})`, resolve: (m) => cnColonTime(m[1], m[2]) },
    // Said with 点, so it reads anywhere, like a time with am or pm.
    { pattern: String.raw`(?:@\s*)?${CN_PERIOD}?\s*${CN_NUM}\s*[点时](?:\s*${CN_MINUTES})?`, resolve: (m, hint) => cnTime(m, hint) },
    { pattern: String.raw`in\s+the\s+(morning|afternoon|evening)`, resolve: (m) => EN_PARTS_OF_DAY[m[1].toLowerCase()] },
    // Only beside a day, so "good morning" stays words.
    { pattern: String.raw`(morning|afternoon|evening|night)`, afterDate: true, resolve: (m) => EN_PARTS_OF_DAY[m[1].toLowerCase()] },
    // Only beside a day, so 买下午茶 stays words.
    { pattern: String.raw`(早上|早晨|上午|中午|下午|傍晚|晚上|夜间|夜里)`, afterDate: true, resolve: (m) => CN_PARTS_OF_DAY[m[1]] }
];

// Word edges that understand letters beyond ASCII, so "fri" inside "Friedrich"
// or "tom" inside "tomato" is never read as a date. Chinese runs its words
// together, so a Chinese character is an edge, and a phrase that starts or
// ends with one needs no edge on that side: 明天给妈妈打电话, 今晚8点.
const EDGE_BEFORE = String.raw`(?:(?=\p{sc=Han})|(?<![\p{L}\p{N}_](?<!\p{sc=Han})))`;
const EDGE_AFTER = String.raw`(?:(?<=\p{sc=Han})|(?!(?!\p{sc=Han})[\p{L}\p{N}_]))`;

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
export interface QuickParseOptions {
    /**
     * Read a time only right beside the day it goes with. For pasted lines,
     * which arrive without the tint and the Backspace that let a typed
     * "the 3pm slot" be turned back into words.
     */
    timesNeedADate?: boolean;
}

export function parseQuickAdd(input: string, today: string, ignored: ReadonlySet<string> = new Set(), options: QuickParseOptions = {}): QuickParse {
    // Matched in plain forms; every token keeps the text as it was typed.
    const scan = halfWidth(input);
    const typed = (match: RegExpExecArray) => input.slice(match.index, match.index + match[0].length);
    const isIgnored = (text: string) => ignored.has(text.toLowerCase());
    // Nothing but spaces, or nothing at all, from the end of one to the start of the other.
    const touching = (first: { end: number }, second: { start: number }) => second.start >= first.end && /^\s*$/u.test(scan.slice(first.end, second.start));

    // Longest first at each position: "next fri" should beat "fri".
    const dateCandidates: Array<ParsedToken & { date: string }> = [];
    for (const rule of DATE_RULES) {
        for (const match of findAll(scan, rule.pattern)) {
            if (isIgnored(typed(match))) continue;
            const date = rule.resolve(match, today);
            if (!date) continue;
            dateCandidates.push({ kind: 'date', start: match.index, end: match.index + match[0].length, text: typed(match), date });
        }
    }
    dateCandidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.start - a.start);
    const dateTokens: typeof dateCandidates = [];
    for (const candidate of dateCandidates) {
        if (!dateTokens.some(kept => overlaps(kept, candidate))) dateTokens.push(candidate);
    }
    const dateToken = dateTokens.sort((a, b) => b.start - a.start)[0];

    // 今晚 and 明早 say the part of the day for a time right after them.
    const hint = dateToken && /晚$/u.test(dateToken.text) ? '晚上' : dateToken && /早$/u.test(dateToken.text) ? '早上' : undefined;

    // The last time wins, like the date.
    let timeToken: (ParsedToken & { time: string }) | undefined;
    for (const rule of TIME_RULES) {
        for (const match of findAll(scan, rule.pattern)) {
            const span = { start: match.index, end: match.index + match[0].length };
            if (isIgnored(typed(match)) || (dateToken && overlaps(dateToken, span))) continue;
            const besideDate = !!dateToken && (touching(dateToken, span) || touching(span, dateToken));
            if (rule.afterDate && !(dateToken && touching(dateToken, span))) continue;
            if (options.timesNeedADate && !besideDate) continue;
            const time = rule.resolve ? rule.resolve(match, dateToken && touching(dateToken, span) ? hint : undefined) : parseTime(match[1]);
            if (!time) continue;
            if (!timeToken || span.start > timeToken.start || (span.start === timeToken.start && span.end > timeToken.end)) {
                timeToken = { kind: 'time', ...span, text: typed(match), time };
            }
        }
    }

    // The last priority wins too.
    let priorityToken: (ParsedToken & { level: 1 | 2 | 3 }) | undefined;
    for (const rule of PRIORITY_RULES) {
        for (const match of findAll(scan, rule.pattern)) {
            const span = { start: match.index, end: match.index + match[0].length };
            if (isIgnored(typed(match)) || [dateToken, timeToken].some(token => token && overlaps(token, span))) continue;
            if (!priorityToken || span.start > priorityToken.start) priorityToken = { kind: 'priority', ...span, text: typed(match), level: rule.level(match) };
        }
    }

    const tokens: ParsedToken[] = [];
    if (dateToken) tokens.push({ kind: 'date', start: dateToken.start, end: dateToken.end, text: dateToken.text });
    if (timeToken) tokens.push({ kind: 'time', start: timeToken.start, end: timeToken.end, text: timeToken.text });
    if (priorityToken) tokens.push({ kind: 'priority', start: priorityToken.start, end: priorityToken.end, text: priorityToken.text });
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
        time: timeToken?.time,
        priority: priorityToken?.level,
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

/**
 * Read a whole query as a day, a time, or both, for the date page: "fri 3pm",
 * "15:00", or a day as `parseDateQuery` reads it.
 */
export function parseDateTimeQuery(query: string, today: string): { date?: string; time?: string } | undefined {
    const trimmed = query.trim();
    if (trimmed === '') return undefined;
    const time = parseTime(trimmed);
    if (time) return { time };
    const whole = parseQuickAdd(trimmed.toLowerCase(), today);
    if ((whole.date || whole.time) && whole.title === '') return { date: whole.date, time: whole.time };
    const date = parseDateQuery(trimmed, today);
    if (date) return { date };

    // A day the picker reads by its first letters ("we", "tom") with a time
    // at either end: "we 3pm", "3pm we", "nov 3 at 9am".
    const words = trimmed.split(/\s+/u);
    for (let n = 1; n <= 2 && n < words.length; n++) {
        for (const [timeWords, dayWords] of [[words.slice(-n), words.slice(0, -n)], [words.slice(0, n), words.slice(n)]]) {
            const time = parseTime(timeWords.join(' ').replace(/^(?:at|@)\s*/iu, ''));
            const day = time ? parseDateQuery(dayWords.join(' ').replace(/\s+(?:at|@)$/iu, ''), today) : undefined;
            if (time && day) return { date: day, time };
        }
    }
    return undefined;
}
