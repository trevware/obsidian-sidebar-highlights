/**
 * Deciding whether a detected match should be discarded because it collides
 * with an excluded region (code blocks, inline code, markdown links, HTML
 * comments).
 *
 * Kept free of Obsidian imports so the rule can be unit tested directly.
 *
 * The rule is about the match's *delimiters*, not overlap (issue #102):
 *
 *   ==text `code` text==   the code sits inside the highlight  -> keep
 *   `==text==`             the highlight sits inside the code  -> discard
 *   `a == b` and ==real==  a delimiter lands inside the code   -> discard
 *
 * Testing for any overlap discarded the first case, which is what made
 * highlights containing inline code vanish. Testing for full containment fixes
 * that but stops discarding the third, where the regex pairs a `==` inside code
 * with one outside it and produces a phantom highlight. Checking the delimiters
 * handles all three: a match is excluded when either end falls inside an
 * excluded range, and kept when it merely encloses one.
 */

export interface ExcludedRange {
    start: number;
    end: number;
}

/**
 * True when either delimiter of [start, end) falls inside an excluded range.
 *
 * @param start Offset of the match's opening delimiter
 * @param end Offset just past the match's closing delimiter
 * @param ranges Excluded ranges, each [start, end)
 */
export function hasDelimiterInsideRanges(
    start: number,
    end: number,
    ranges: ExcludedRange[]
): boolean {
    return ranges.some(range =>
        // Opening delimiter starts within the range
        (start >= range.start && start < range.end) ||
        // Closing delimiter ends within the range
        (end > range.start && end <= range.end)
    );
}
