/**
 * Matching a freshly detected highlight to the one stored for it, so it keeps its
 * id (and with it, its collections and creation time).
 *
 * Since issue #126 the stored positions are no longer rewritten each time typing
 * moves a highlight, so they can lag the note by many edits. A highlight whose text
 * appears once is found by text alone, but highlights sharing a text used to be
 * matched only by position, and lost their ids once they had moved more than 50
 * characters. They are now taken in order.
 */

import { findExistingHighlight, MatchableHighlight } from './highlight-matching';

const h = (id: string, text: string, startOffset: number, isNativeComment = false): MatchableHighlight => ({
    id,
    text,
    startOffset,
    endOffset: startOffset + text.length + 4,
    isNativeComment
});

describe('findExistingHighlight', () => {
    it('prefers an exact position match', () => {
        const existing = [h('a', 'term', 100), h('b', 'term', 120)];
        expect(findExistingHighlight(existing, new Set(), 'term', 120, 128, false)?.id).toBe('b');
    });

    it('matches a highlight that moved a little', () => {
        const existing = [h('a', 'term', 100)];
        expect(findExistingHighlight(existing, new Set(), 'term', 130, 138, false)?.id).toBe('a');
    });

    it('matches a highlight with unique text that moved a long way', () => {
        const existing = [h('a', 'term', 100)];
        expect(findExistingHighlight(existing, new Set(), 'term', 5000, 5008, false)?.id).toBe('a');
    });

    it('keeps ids for repeated text that moved a long way, in order', () => {
        const existing = [h('a', 'term', 100), h('b', 'term', 300)];
        const used = new Set<string>();

        // Two hundred characters were typed above both.
        const first = findExistingHighlight(existing, used, 'term', 900, 908, false);
        const second = findExistingHighlight(existing, used, 'term', 1100, 1108, false);

        expect(first?.id).toBe('a');
        expect(second?.id).toBe('b');
    });

    it('takes repeated text in stored order even when stored out of order', () => {
        const existing = [h('b', 'term', 300), h('a', 'term', 100)];
        const used = new Set<string>();

        expect(findExistingHighlight(existing, used, 'term', 900, 908, false)?.id).toBe('a');
        expect(findExistingHighlight(existing, used, 'term', 1100, 1108, false)?.id).toBe('b');
    });

    it('never hands out the same highlight twice', () => {
        const existing = [h('a', 'term', 100)];
        const used = new Set<string>();

        expect(findExistingHighlight(existing, used, 'term', 100, 108, false)?.id).toBe('a');
        expect(findExistingHighlight(existing, used, 'term', 900, 908, false)).toBeUndefined();
    });

    it('keeps highlights and native comments apart', () => {
        const existing = [h('a', 'term', 100, true)];
        expect(findExistingHighlight(existing, new Set(), 'term', 100, 108, false)).toBeUndefined();
    });

    it('does not match different text', () => {
        const existing = [h('a', 'term', 100)];
        expect(findExistingHighlight(existing, new Set(), 'terms', 100, 109, false)).toBeUndefined();
    });
});
