import { countHighlights, describeSegments, visibleSegments } from './status-bar-counts';

const highlight = (filePath: string) => ({ filePath, isNativeComment: false });
const comment = (filePath: string) => ({ filePath, isNativeComment: true });

describe('countHighlights', () => {
    it('counts highlights and native comments separately', () => {
        const counts = countHighlights([highlight('a.md'), highlight('a.md'), comment('a.md')], false);
        expect(counts.highlights).toBe(2);
        expect(counts.nativeComments).toBe(1);
    });

    it('counts the distinct notes the rows come from when asked', () => {
        const counts = countHighlights([highlight('a.md'), comment('a.md'), highlight('b.md')], true);
        expect(counts.files).toBe(2);
    });

    it('leaves the note count out when not asked', () => {
        const counts = countHighlights([highlight('a.md'), highlight('b.md')], false);
        expect(counts.files).toBeUndefined();
    });
});

describe('visibleSegments', () => {
    it('drops counts of zero', () => {
        const segments = visibleSegments({ highlights: 3, nativeComments: 0, files: 1 });
        expect(segments.map(s => s.kind)).toEqual(['highlights', 'files']);
    });

    it('returns nothing when there is nothing to count', () => {
        expect(visibleSegments({ highlights: 0, nativeComments: 0 })).toEqual([]);
        expect(visibleSegments({})).toEqual([]);
    });

    it('keeps the same order whatever order the counts arrive in', () => {
        const segments = visibleSegments({ files: 2, collections: 3, nativeComments: 4, highlights: 5 });
        expect(segments.map(s => s.kind)).toEqual(['highlights', 'nativeComments', 'files', 'collections']);
    });

    it('carries each count through', () => {
        expect(visibleSegments({ highlights: 12, nativeComments: 3 })).toEqual([
            { kind: 'highlights', count: 12 },
            { kind: 'nativeComments', count: 3 },
        ]);
    });
});

describe('describeSegments', () => {
    const translate = (key: string, vars?: Record<string, unknown>) => `${key}:${String(vars?.count)}`;

    it('uses the singular wording for a count of one', () => {
        expect(describeSegments([{ kind: 'highlights', count: 1 }], translate)).toBe('statusBar.highlight:1');
    });

    it('uses the plural wording for any other count', () => {
        expect(describeSegments([{ kind: 'nativeComments', count: 3 }], translate)).toBe('statusBar.nativeComments:3');
    });

    it('joins the segments into one line', () => {
        const text = describeSegments([{ kind: 'highlights', count: 2 }, { kind: 'files', count: 1 }], translate);
        expect(text).toBe('statusBar.highlights:2, statusBar.file:1');
    });
});
