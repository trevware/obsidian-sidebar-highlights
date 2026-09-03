import { headingForLine, headingGroupKey, compareDocumentOrder, NO_SECTION_KEY } from './heading-group';

const headings = [
    { heading: 'Intro', line: 2 },
    { heading: 'Body', line: 10 },
    { heading: 'Detail', line: 15 },
];

describe('headingForLine', () => {
    test('returns the nearest heading above the line', () => {
        expect(headingForLine(headings, 12)?.heading).toBe('Body');
    });

    test('a heading on the same line as the highlight counts', () => {
        expect(headingForLine(headings, 15)?.heading).toBe('Detail');
    });

    test('returns null before the first heading', () => {
        expect(headingForLine(headings, 1)).toBeNull();
    });

    test('returns null when the note has no headings', () => {
        expect(headingForLine([], 5)).toBeNull();
    });

    test('tolerates headings supplied out of order', () => {
        const shuffled = [headings[2], headings[0], headings[1]];
        expect(headingForLine(shuffled, 12)?.heading).toBe('Body');
    });
});

describe('headingGroupKey', () => {
    test('uses the bare heading text within a single note', () => {
        expect(headingGroupKey('Body', null)).toBe('Body');
    });

    test('falls back to the shared no-section key within a single note', () => {
        expect(headingGroupKey(null, null)).toBe(NO_SECTION_KEY);
    });

    test('prefixes the note name across notes', () => {
        expect(headingGroupKey('Body', 'My Note')).toBe('My Note › Body');
    });

    test('uses just the note name for highlights before any heading across notes', () => {
        expect(headingGroupKey(null, 'My Note')).toBe('My Note');
    });
});

describe('compareDocumentOrder', () => {
    test('orders groups in the same note by line', () => {
        expect(compareDocumentOrder({ file: 'a.md', line: 10 }, { file: 'a.md', line: 2 })).toBeGreaterThan(0);
    });

    test('puts the no-section group first in its note', () => {
        expect(compareDocumentOrder({ file: 'a.md', line: -1 }, { file: 'a.md', line: 0 })).toBeLessThan(0);
    });

    test('orders different notes by name before position', () => {
        expect(compareDocumentOrder({ file: 'b.md', line: 0 }, { file: 'a.md', line: 99 })).toBeGreaterThan(0);
    });
});
