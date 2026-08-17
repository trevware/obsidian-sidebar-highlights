import { matchesTypeFilter, migrateLegacyTypeFilter } from './type-filter';

describe('matchesTypeFilter', () => {
    const highlight = false; // isNativeComment
    const comment = true;

    it('shows everything by default', () => {
        expect(matchesTypeFilter(highlight, 'all')).toBe(true);
        expect(matchesTypeFilter(comment, 'all')).toBe(true);
    });

    it('drops native comments when showing highlights only', () => {
        expect(matchesTypeFilter(highlight, 'highlights')).toBe(true);
        expect(matchesTypeFilter(comment, 'highlights')).toBe(false);
    });

    it('drops highlights when showing comments only', () => {
        expect(matchesTypeFilter(highlight, 'comments')).toBe(false);
        expect(matchesTypeFilter(comment, 'comments')).toBe(true);
    });

    it('treats a missing isNativeComment flag as a highlight', () => {
        expect(matchesTypeFilter(undefined, 'highlights')).toBe(true);
        expect(matchesTypeFilter(undefined, 'comments')).toBe(false);
    });
});

describe('migrateLegacyTypeFilter', () => {
    it('keeps a user who had hidden native comments on highlights only', () => {
        // The legacy key stored the string 'false' to mean "comments hidden"
        expect(migrateLegacyTypeFilter('false')).toBe('highlights');
    });

    it('shows everything for a user who had them visible', () => {
        expect(migrateLegacyTypeFilter('true')).toBe('all');
    });

    it('defaults to showing everything when nothing was stored', () => {
        expect(migrateLegacyTypeFilter(null)).toBe('all');
        expect(migrateLegacyTypeFilter('')).toBe('all');
    });
});
