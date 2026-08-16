/**
 * Tests for match-vs-excluded-range logic (issue #102).
 *
 * Cases are written as offsets against a literal string so the intent stays
 * readable, and cover both the reported bug and the phantom-highlight
 * regression that a containment-only fix would introduce.
 */

import { hasDelimiterInsideRanges } from './range-exclusion';

describe('hasDelimiterInsideRanges', () => {
    describe('the reported bug: highlights containing code', () => {
        it('should keep a highlight that encloses an inline code span', () => {
            // ==test `code` test==
            //         ^^^^^^ code at 7..13
            expect(hasDelimiterInsideRanges(0, 20, [{ start: 7, end: 13 }])).toBe(false);
        });

        it('should keep a highlight that ends right after an inline code span', () => {
            // ==test `test`==
            expect(hasDelimiterInsideRanges(0, 15, [{ start: 7, end: 13 }])).toBe(false);
        });

        it('should keep a multi-line match enclosing a fenced block', () => {
            expect(hasDelimiterInsideRanges(0, 100, [{ start: 20, end: 60 }])).toBe(false);
        });

        it('should keep a match enclosing several code spans', () => {
            expect(hasDelimiterInsideRanges(0, 50, [
                { start: 5, end: 10 },
                { start: 20, end: 30 }
            ])).toBe(false);
        });
    });

    describe('genuine exclusions', () => {
        it('should discard a highlight fully inside inline code', () => {
            // `==test==`  code 0..10, highlight 1..9
            expect(hasDelimiterInsideRanges(1, 9, [{ start: 0, end: 10 }])).toBe(true);
        });

        it('should discard a match whose opening delimiter is inside code', () => {
            // The phantom case: regex pairs a == inside code with one outside.
            expect(hasDelimiterInsideRanges(5, 30, [{ start: 0, end: 12 }])).toBe(true);
        });

        it('should discard a match whose closing delimiter is inside code', () => {
            expect(hasDelimiterInsideRanges(0, 15, [{ start: 10, end: 25 }])).toBe(true);
        });

        it('should discard a match identical to the excluded range', () => {
            expect(hasDelimiterInsideRanges(10, 20, [{ start: 10, end: 20 }])).toBe(true);
        });
    });

    describe('boundaries', () => {
        it('should keep a match ending exactly where a range starts', () => {
            expect(hasDelimiterInsideRanges(0, 10, [{ start: 10, end: 20 }])).toBe(false);
        });

        it('should keep a match starting exactly where a range ends', () => {
            expect(hasDelimiterInsideRanges(20, 30, [{ start: 10, end: 20 }])).toBe(false);
        });

        it('should keep a match that is entirely before any range', () => {
            expect(hasDelimiterInsideRanges(0, 5, [{ start: 10, end: 20 }])).toBe(false);
        });

        it('should keep a match when there are no ranges', () => {
            expect(hasDelimiterInsideRanges(0, 10, [])).toBe(false);
        });

        it('should check every range, not just the first', () => {
            expect(hasDelimiterInsideRanges(15, 25, [
                { start: 0, end: 5 },
                { start: 10, end: 20 }
            ])).toBe(true);
        });
    });
});
