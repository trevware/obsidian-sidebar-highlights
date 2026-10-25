/**
 * Ranking for the Tasks palette, copied from Oriko's palette so the two
 * search the same way: a short list of commands, views and notes, plus every
 * task in the vault.
 *
 * Two tiers, and the gap between them is deliberate. A contiguous substring
 * always outranks a scattered subsequence, however well the scattered one
 * scores. Inside a tier, position decides: the front of a label beats the
 * middle of one, and the start of a word beats the middle of a word.
 */

export interface MatchRange {
    start: number;
    /** Exclusive, so text.slice(start, end) is the matched run. */
    end: number;
}

export interface Match {
    score: number;
    ranges: MatchRange[];
}

export interface SearchFields {
    /** What is displayed, and the only thing highlight ranges refer to. */
    primary: string;
    /**
     * Extra text to match on that is not displayed: a command's keywords, or a
     * clipping's description, domain and categories. A hit here is demoted
     * below every primary hit of the same kind and highlights nothing, since
     * its offsets mean nothing on screen.
     */
    secondary?: string;
}

export interface Ranked<T> {
    item: T;
    score: number;
    ranges: MatchRange[];
}

/** The floor for a contiguous hit, far above anything a subsequence scores. */
const SUBSTRING_TIER = 1000;
const PREFIX_BONUS = 100;
const WORD_START_BONUS = 50;
/** Points for landing early, worth less the further in the match starts. */
const EARLINESS = 50;

const CHAR_BASE = 1;
const CHAR_AT_START = 10;
const CHAR_AT_WORD_START = 6;
const CHAR_CONTIGUOUS = 4;
/** Capped, so one badly spread match cannot score arbitrarily far negative. */
const MAX_SPREAD_PENALTY = 30;

const SECONDARY_PENALTY = 500;
/** Paid to a phrase found whole, over the same words found scattered. */
const PHRASE_BONUS = 200;

const BOUNDARY = /[\s\-_/.,:;!?'"()[\]{}|#@+&]/;

/**
 * True at the front of a word, which is where a reader's eye goes. Counts
 * both punctuation boundaries and a camelCase hump, so "Grid" is findable
 * inside "Oriko".
 */
function isWordStart(text: string, index: number): boolean {
    if (index === 0) return true;
    const previous = text[index - 1];
    if (BOUNDARY.test(previous)) return true;
    const current = text[index];
    return (
        previous === previous.toLowerCase() &&
        previous !== previous.toUpperCase() &&
        current === current.toUpperCase() &&
        current !== current.toLowerCase()
    );
}

function positionScore(text: string, index: number): number {
    const placement =
        index === 0 ? PREFIX_BONUS : isWordStart(text, index) ? WORD_START_BONUS : 0;
    return SUBSTRING_TIER + placement + Math.max(0, EARLINESS - index);
}

/**
 * The best contiguous occurrence, not merely the first: "manga" in
 * "elboletaire/manga-downloader" should be found at the word start rather
 * than reported as whichever hit came earliest.
 */
function substringMatch(query: string, text: string, lower: string): Match | null {
    let best: Match | null = null;

    for (let index = lower.indexOf(query); index !== -1; index = lower.indexOf(query, index + 1)) {
        const score = positionScore(text, index);
        if (!best || score > best.score) {
            best = { score, ranges: [{ start: index, end: index + query.length }] };
        }
    }

    return best;
}

/** Adjacent positions become one range, so highlighting draws whole runs. */
function mergeRuns(positions: number[]): MatchRange[] {
    const ranges: MatchRange[] = [];

    for (const position of positions) {
        const last = ranges[ranges.length - 1];
        if (last && last.end === position) last.end = position + 1;
        else ranges.push({ start: position, end: position + 1 });
    }

    return ranges;
}

/** Greedy and leftmost, which always finds a subsequence if one exists. */
function subsequenceMatch(query: string, text: string, lower: string): Match | null {
    const positions: number[] = [];
    let cursor = 0;

    for (const char of query) {
        const found = lower.indexOf(char, cursor);
        if (found === -1) return null;
        positions.push(found);
        cursor = found + 1;
    }

    let score = 0;
    positions.forEach((position, i) => {
        score += CHAR_BASE;
        if (position === 0) score += CHAR_AT_START;
        else if (isWordStart(text, position)) score += CHAR_AT_WORD_START;
        else if (i > 0 && position === positions[i - 1] + 1) score += CHAR_CONTIGUOUS;
    });

    const span = positions[positions.length - 1] - positions[0] + 1;
    score -= Math.min(MAX_SPREAD_PENALTY, span - query.length);

    return { score, ranges: mergeRuns(positions) };
}

/**
 * Every word of the query present, none of them fuzzy, ranked highest when
 * they were found together.
 *
 * This is how the text you cannot see is matched: a clipping's description,
 * domain and categories, and a command's keywords. A subsequence is a
 * reasonable guess across a twenty-character label, and nonsense across a
 * paragraph, where the letters of "coffees on shelf" turn up in order in a
 * bag of coffee's roast notes. Anything found this way highlights nothing,
 * so there is no reason to track where the words landed.
 */
export function phraseMatch(query: string, text: string): Match | null {
    const needle = query.trim().toLowerCase();
    if (needle === '') return { score: 0, ranges: [] };

    const lower = text.toLowerCase();
    const whole = substringMatch(needle, text, lower);
    if (whole) return { score: whole.score + PHRASE_BONUS, ranges: [] };

    const terms = needle.split(/\s+/);
    if (terms.length < 2) return null;

    let total = 0;
    for (const term of terms) {
        const hit = substringMatch(term, text, lower);
        if (!hit) return null;
        total += hit.score;
    }

    // Averaged, so a long query does not outscore a short one for free.
    return { score: total / terms.length, ranges: [] };
}

/**
 * How well text answers query, or null if it does not. An empty query
 * matches everything at zero, which is what leaves the palette's opening
 * list in its natural order.
 */
export function fuzzyMatch(query: string, text: string): Match | null {
    const needle = query.trim().toLowerCase();
    if (needle === '') return { score: 0, ranges: [] };

    const lower = text.toLowerCase();
    return substringMatch(needle, text, lower) ?? subsequenceMatch(needle, text, lower);
}

/**
 * Scores every item and drops the misses. Ties keep the order they came in,
 * so the caller's own grouping (declaration order for commands, newest first
 * for clippings) survives a query that cannot separate two rows.
 */
export function rank<T>(
    query: string,
    items: readonly T[],
    fields: (item: T) => SearchFields
): Ranked<T>[] {
    const results: Ranked<T>[] = [];

    for (const item of items) {
        const { primary, secondary } = fields(item);
        const hit = fuzzyMatch(query, primary);
        if (hit) {
            results.push({ item, score: hit.score, ranges: hit.ranges });
            continue;
        }

        // No ranges: they would index into text the row does not show.
        const fallback = secondary ? phraseMatch(query, secondary) : null;
        if (fallback) results.push({ item, score: fallback.score - SECONDARY_PENALTY, ranges: [] });
    }

    // Array.sort is stable, so equal scores keep their input order.
    return results.sort((a, b) => b.score - a.score);
}
