/**
 * The sidebar's tab bar, as data.
 *
 * Tabs are individually hideable, so a tab's position in the rendered bar is not
 * fixed — hiding Current note shifts everything after it left by one. Several
 * places need that mapping (marking the active tab, falling back when the active
 * tab is hidden), and each one re-deriving it by hand is how indices drift apart.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

/** Tabs in render order: narrowest scope first, widening outward. */
export type TabId = 'current' | 'folder' | 'all' | 'collections' | 'tasks';

export interface TabVisibility {
    showCurrentNoteTab: boolean;
    showCurrentFolderTab: boolean;
    showAllNotesTab: boolean;
    showCollectionsTab: boolean;
    showTasksTab: boolean;
}

const TAB_ORDER: ReadonlyArray<{ id: TabId; setting: keyof TabVisibility }> = [
    { id: 'current', setting: 'showCurrentNoteTab' },
    { id: 'folder', setting: 'showCurrentFolderTab' },
    { id: 'all', setting: 'showAllNotesTab' },
    { id: 'collections', setting: 'showCollectionsTab' },
    { id: 'tasks', setting: 'showTasksTab' }
];

/** The tabs actually rendered, in the order they appear. */
export function visibleTabs(visibility: TabVisibility): TabId[] {
    return TAB_ORDER.filter(tab => visibility[tab.setting]).map(tab => tab.id);
}

/** A tab's position in the rendered tab bar, or -1 when it is hidden. */
export function tabIndex(visibility: TabVisibility, tab: TabId): number {
    return visibleTabs(visibility).indexOf(tab);
}

/** The leftmost rendered tab, or null when every tab is hidden. */
export function firstVisibleTab(visibility: TabVisibility): TabId | null {
    return visibleTabs(visibility)[0] ?? null;
}
