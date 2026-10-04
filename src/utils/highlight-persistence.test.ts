/**
 * Regression cover for issue #126: data.json conflicts between two synced vaults.
 *
 * The plugin used to rewrite data.json whenever a note's highlights changed in any
 * way, including when typing above a highlight merely moved its offsets. Two
 * devices editing different notes at the same time then both rewrote the file
 * between sync passes, and Syncthing kept one and set the other aside as a
 * conflict copy. Positions and comment text are read back from the note on every
 * load, so only what a restart cannot rebuild is worth a write.
 */

import { hasPersistentHighlightChanges, PersistedHighlight } from './highlight-persistence';

type TestHighlight = PersistedHighlight & {
    startOffset: number;
    endOffset: number;
    line: number;
    footnoteCount?: number;
    footnoteContents?: string[];
};

const base: TestHighlight[] = [
    { id: 'a', text: 'braking', type: 'highlight', isNativeComment: false, createdAt: 100, startOffset: 10540, endOffset: 10651, line: 255 },
    { id: 'b', text: 'note to self', type: 'comment', isNativeComment: true, createdAt: 200, startOffset: 11000, endOffset: 11016, line: 260, footnoteContents: ['note to self'], footnoteCount: 1 }
];

const shift = (highlights: TestHighlight[], by: number): TestHighlight[] =>
    highlights.map(h => ({ ...h, startOffset: h.startOffset + by, endOffset: h.endOffset + by }));

describe('hasPersistentHighlightChanges', () => {
    it('ignores highlights that only moved (the conflict in the issue)', () => {
        expect(hasPersistentHighlightChanges(base, shift(base, 2))).toBe(false);
    });

    it('ignores a highlight moving to another line', () => {
        const moved = base.map(h => ({ ...h, line: h.line + 3 }));
        expect(hasPersistentHighlightChanges(base, moved)).toBe(false);
    });

    it('ignores comment text, which is read back from the note', () => {
        const commented = base.map(h => h.id === 'a' ? { ...h, footnoteCount: 1, footnoteContents: ['why this matters'] } : h);
        expect(hasPersistentHighlightChanges(base, commented)).toBe(false);
    });

    it('treats a missing native-comment flag as false', () => {
        const legacy = base.map(h => h.id === 'a' ? { ...h, isNativeComment: undefined } : h);
        expect(hasPersistentHighlightChanges(legacy, base)).toBe(false);
    });

    it('reports a new highlight', () => {
        const added = [...base, { id: 'c', text: 'new', type: 'highlight' as const, isNativeComment: false, createdAt: 300, startOffset: 12000, endOffset: 12007, line: 270 }];
        expect(hasPersistentHighlightChanges(base, added)).toBe(true);
    });

    it('reports a removed highlight', () => {
        expect(hasPersistentHighlightChanges(base, base.slice(0, 1))).toBe(true);
    });

    it('reports a highlight whose id changed', () => {
        const reissued = base.map(h => h.id === 'a' ? { ...h, id: 'z' } : h);
        expect(hasPersistentHighlightChanges(base, reissued)).toBe(true);
    });

    it('reports edited highlight text', () => {
        const edited = base.map(h => h.id === 'a' ? { ...h, text: 'braking system' } : h);
        expect(hasPersistentHighlightChanges(base, edited)).toBe(true);
    });

    it('reports a colour change', () => {
        const recoloured = base.map(h => h.id === 'a' ? { ...h, color: '#ff0000' } : h);
        expect(hasPersistentHighlightChanges(base, recoloured)).toBe(true);
    });

    it('reports a changed creation time', () => {
        const retimed = base.map(h => h.id === 'b' ? { ...h, createdAt: 201 } : h);
        expect(hasPersistentHighlightChanges(base, retimed)).toBe(true);
    });

    it('treats a note with no highlights as unchanged', () => {
        expect(hasPersistentHighlightChanges([], [])).toBe(false);
    });
});
