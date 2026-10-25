import { TabVisibility, firstVisibleTab, tabIndex, visibleTabs } from './tab-order';

const ALL: TabVisibility = {
    showCurrentNoteTab: true,
    showCurrentFolderTab: true,
    showAllNotesTab: true,
    showCollectionsTab: true
};

const NONE: TabVisibility = {
    showCurrentNoteTab: false,
    showCurrentFolderTab: false,
    showAllNotesTab: false,
    showCollectionsTab: false
};

describe('visibleTabs', () => {
    it('orders tabs from the narrowest scope outward', () => {
        expect(visibleTabs(ALL)).toEqual(['current', 'folder', 'all', 'collections']);
    });

    it('omits hidden tabs', () => {
        expect(visibleTabs({ ...ALL, showCurrentFolderTab: false, showCollectionsTab: false }))
            .toEqual(['current', 'all']);
    });

    it('returns nothing when every tab is hidden', () => {
        expect(visibleTabs(NONE)).toEqual([]);
    });

    it('matches the shipped default, where the folder tab is opt-in', () => {
        expect(visibleTabs({ ...ALL, showCurrentFolderTab: false }))
            .toEqual(['current', 'all', 'collections']);
    });
});

describe('tabIndex', () => {
    it('indexes into the rendered tab bar, not the full list', () => {
        // Current note hidden, so the folder tab is rendered first
        const visibility = { ...ALL, showCurrentNoteTab: false };
        expect(tabIndex(visibility, 'folder')).toBe(0);
        expect(tabIndex(visibility, 'all')).toBe(1);
        expect(tabIndex(visibility, 'collections')).toBe(2);
    });

    it('shifts later tabs when an earlier one is added', () => {
        const without = { ...ALL, showCurrentFolderTab: false };
        expect(tabIndex(without, 'all')).toBe(1);
        expect(tabIndex(ALL, 'all')).toBe(2);
    });

    it('reports -1 for a hidden tab', () => {
        expect(tabIndex({ ...ALL, showCollectionsTab: false }, 'collections')).toBe(-1);
    });
});

describe('firstVisibleTab', () => {
    it('returns the leftmost rendered tab', () => {
        expect(firstVisibleTab(ALL)).toBe('current');
    });

    it('falls through the order as tabs are hidden', () => {
        expect(firstVisibleTab({ ...ALL, showCurrentNoteTab: false })).toBe('folder');
        expect(firstVisibleTab({ ...NONE, showAllNotesTab: true, showCollectionsTab: true })).toBe('all');
        expect(firstVisibleTab({ ...NONE, showCollectionsTab: true })).toBe('collections');
    });

    it('returns null when every tab is hidden', () => {
        expect(firstVisibleTab(NONE)).toBeNull();
    });
});
