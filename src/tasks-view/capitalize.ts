/**
 * Title Case for tasks, for Settings → Tasks → Capitalize tasks.
 *
 * Every word starts with a capital, except the short articles, conjunctions
 * and prepositions, which stay small unless they open the task, follow a
 * colon or end it. Leading emphasis and quotes are stepped over. Links, tags,
 * code, web addresses, file names, and words that already mix cases (iPhone,
 * eBay) or are written in capitals (USB) are left as written.
 */

/** The small words: short articles, conjunctions and prepositions. */
const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'v', 'via', 'vs']);

/** Spans that are never recased: wikilinks, Markdown links, code and tags, finished or still being typed. */
const PROTECTED = /\[\[[^\]]*(?:\]\]|\]?$)|`[^`]*(?:`|$)|\[[^\]]*\]\([^)]*(?:\)|$)|#[^\s#]+/gu;

/** What may come before a word's first letter: emphasis, quotes, brackets. */
const LEAD = /^[*_~=("'“‘]*/u;

/** A word that ends a clause, so the next one opens a new one. */
const CLAUSE_END = /[:?!—–]$|^[-—–]$/u;

interface Word {
    start: number;
    end: number;
    text: string;
}

export interface TitleCaseOptions {
    /** The whole task: its last word is capitalized even when small. */
    final?: boolean;
    /** Where the word being typed ends. It's capitalized, but a small one is only made small once it's finished. */
    typing?: number;
}

/** Each match of `pattern` in `text`, as where it starts and ends. */
function spans(text: string, pattern: RegExp): Word[] {
    return Array.from(text.matchAll(pattern), match => {
        const start = match.index ?? 0;
        return { start, end: start + match[0].length, text: match[0] };
    });
}

export function titleCase(text: string, options: TitleCaseOptions = {}): string {
    const shielded = spans(text, PROTECTED);
    const isShielded = (at: number) => shielded.some(span => at >= span.start && at < span.end);
    const words = spans(text, /\S+/gu);

    let result = '';
    let cursor = 0;
    let lastWithLetters = -1;
    words.forEach((word, i) => { if (/\p{L}/u.test(word.text)) lastWithLetters = i; });

    words.forEach((word, i) => {
        const lead = word.text.match(LEAD)?.[0] ?? '';
        const at = word.start + lead.length;
        if (isShielded(word.start) || isShielded(at)) return;
        const body = word.text.slice(lead.length);
        if (!/^\p{L}/u.test(body) || isPlain(body)) return;

        const opens = i === 0 || CLAUSE_END.test(words[i - 1].text);
        const closes = options.final === true && i === lastWithLetters;
        const typing = options.typing === word.end;
        const parts = body.split('-');
        const recased = parts.map((part, p) => {
            const core = part.match(/^[\p{L}\p{N}'’]*/u)?.[0] ?? '';
            const small = MINOR.has(core.toLowerCase()) && !(p === 0 && opens) && !(p === parts.length - 1 && (closes || typing));
            return recase(part, small);
        }).join('-');
        if (recased === body) return;
        result += text.slice(cursor, at) + recased;
        cursor = at + body.length;
    });
    return result + text.slice(cursor);
}

/** A web address, an email, a path or a file name: not words to recase. */
function isPlain(body: string): boolean {
    return /:\/\/|@|\/|\\/u.test(body) || /^www\./iu.test(body) || /\.\p{L}/u.test(body);
}

/**
 * One word, or one part of a hyphenated word: capitalized, or made small.
 * A part that mixes cases or is in capitals is kept, as is a letter whose
 * capital would change the word's length.
 */
function recase(part: string, small: boolean): string {
    const letter = part.match(/^\p{L}/u)?.[0];
    if (!letter) return part;
    const rest = part.slice(letter.length);
    if (/\p{Lu}/u.test(rest)) return part;
    const cased = small ? letter.toLowerCase() : letter.toUpperCase();
    if (cased.length !== letter.length) return part;
    return cased + rest;
}

/** The letter each field had before it was capitalized for you, while that capital stands. */
const raised = new WeakMap<HTMLInputElement | HTMLTextAreaElement, { at: number; letter: string }>();

/**
 * Title cases a field as it's typed. The word being typed gets its capital
 * with its first letter, and is judged again with every key as it was typed,
 * so one that turns out to be an iPhone or a web address goes back to how it
 * was written. A small word becomes small once the space after it is typed.
 * The caret stays put.
 */
export function titleCaseTyped(field: HTMLInputElement | HTMLTextAreaElement): void {
    const value = field.value;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    const typing = start === end && /\S$/u.test(value.slice(0, start)) && !/^\S/u.test(value.slice(start)) ? start : undefined;
    const wordStart = typing === undefined ? -1 : value.slice(0, typing).search(/\S+$/u);
    const firstLetter = wordStart === -1 ? -1 : wordStart + (value.slice(wordStart).match(LEAD)?.[0].length ?? 0);

    // The word being typed, as it was typed: a capital given to it is taken back first.
    const given = raised.get(field);
    const typed = given && given.at === firstLetter && value.startsWith(given.letter.toUpperCase(), firstLetter)
        ? value.slice(0, firstLetter) + given.letter + value.slice(firstLetter + given.letter.length)
        : value;
    const next = titleCase(typed, { typing });
    const letter = typed.slice(firstLetter, firstLetter + 1);
    if (firstLetter !== -1 && next.slice(firstLetter, firstLetter + 1) !== letter) raised.set(field, { at: firstLetter, letter });
    else raised.delete(field);
    if (next === value) return;
    field.value = next;
    field.setSelectionRange(start, end);
}
