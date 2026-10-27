import { ItemView, WorkspaceLeaf, MarkdownView, TFile, Menu, MenuItem, Notice, Platform, addIcon, setIcon, setTooltip, Keymap, App, moment } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import type { Highlight, Collection } from '../../main';
import { NewCollectionModal, EditCollectionModal } from '../modals/collection-modals';
import { DropdownManager, DropdownItem } from '../managers/dropdown-manager';
import { HighlightRenderer, HighlightRenderOptions } from '../renderers/highlight-renderer';
import { InlineFootnoteManager } from '../managers/inline-footnote-manager';
import { SearchParser, SearchToken, ParsedSearch, ASTNode, OperatorNode, FilterNode, TextNode } from '../utils/search-parser';
import { SimpleSearchManager } from '../managers/simple-search-manager';
import { STANDARD_FOOTNOTE_REGEX, FOOTNOTE_VALIDATION_REGEX } from '../utils/regex-patterns';
import { compareHighlights, SortFallback, SortMode } from '../utils/sort-order';
import { isCommentsToggleOn, nextCommentsToggleState } from '../utils/comments-toggle';
import { isInFolder, parentFolderPath } from '../utils/folder-scope';
import { headingForLine, headingGroupKey, compareDocumentOrder, DocumentPosition } from '../utils/heading-group';
import { firstVisibleTab, tabIndex, visibleTabs } from '../utils/tab-order';
import { HighlightTypeFilter, matchesTypeFilter, migrateLegacyTypeFilter } from '../utils/type-filter';
import { colorLabel, resolveHighlightColor } from '../utils/color-labels';
import { highlightDisplayText, noteColorLabel, noteColorName } from '../utils/note-colors';
import { meetsMinimumCharacterCount } from '../utils/minimum-length';
import { countHighlights, StatusBarCounts } from '../utils/status-bar-counts';
import {
    CopyFormat,
    formatHighlightForCopy,
    joinHighlightEntries
} from '../utils/copy-format';
import { HtmlHighlightParser } from '../utils/html-highlight-parser';
import { t } from '../i18n';

// Private Obsidian APIs used by the sidebar (not part of the public typings).
interface PrivateCommandsApi {
    commands: { executeCommandById: (id: string) => void };
}

// The CodeMirror 6 EditorView behind an Obsidian markdown editor.
interface CodeMirrorEditorView {
    state: { doc: { lineAt(pos: number): { number: number } } };
    scrollDOM: HTMLElement;
    posAtCoords(coords: { x: number; y: number }): number | null;
}

const VIEW_TYPE_HIGHLIGHTS = 'highlights-sidebar';

/**
 * Group key for the current-note tasks section. A constant rather than the file
 * name, so its collapsed state is a preference about the section itself.
 */

export class HighlightsSidebarView extends ItemView {
    plugin: HighlightCommentsPlugin;
    private searchInputEl!: HTMLInputElement;
    private listContainerEl!: HTMLElement;
    private contentAreaEl!: HTMLElement;
    private highlightCommentsVisible: Map<string, boolean> = new Map();
    private groupingMode: 'none' | 'color' | 'comments-asc' | 'comments-desc' | 'tag' | 'parent' | 'collection' | 'filename' | 'heading' | 'date-created-asc' | 'date-created-desc' | 'date-asc' = 'none';
    private sortMode: SortMode = 'none';
    /** Per-render cache of note creation times; null means the file was not resolvable. */
    private noteCreatedCache: Map<string, number | null> = new Map();
    private commentsExpanded: boolean = false;
    private commentsToggleButton!: HTMLElement;
    private selectedTags: Set<string> = new Set();
    private selectedCollections: Set<string> = new Set();
    private selectedHighlightIds: Set<string> = new Set(); // Multi-select for highlights
    private actionsButton: HTMLElement | null = null; // Actions menu button for multi-select
    private collectionNavButton: HTMLElement | null = null; // Collection navigation button
    private viewMode: 'current' | 'folder' | 'all' | 'collections' = 'current';
    private currentCollectionId: string | null = null;
    private preservedScrollTop: number = 0;
    private isHighlightFocusing: boolean = false;
    
    // Pagination for "All Notes" performance
    private currentPage: number = 0;
    private itemsPerPage: number = 100;
    private totalHighlights: Highlight[] = [];
    private isPreservingPagination: boolean = false;
    
    // Pagination for grouped highlights
    private currentGroupPage: number = 0;
    private totalGroups: [string, Highlight[]][] = [];

    private isColorChanging: boolean = false;
    private searchExpanded: boolean = false;
    private searchButton!: HTMLElement;
    private simpleSearchManager!: SimpleSearchManager;
    private currentSearchTokens: SearchToken[] = [];
    private currentParsedSearch: ParsedSearch = { ast: null };
    private dropdownManager: DropdownManager = new DropdownManager();
    private highlightRenderer: HighlightRenderer;
    private savedScrollPosition: number = 0; // Store scroll position during rebuilds
    private typeFilter: HighlightTypeFilter = 'all'; // Show highlights, native comments, or both
    private selectedColors: Set<string> = new Set(); // Colour filter, per tab like the others
    private sortButton!: HTMLElement; // Store sort button reference for state updates
    /** Collapsed highlight groups, persisted in settings. */
    private collapsedGroups: Set<string> = new Set();

    // Current folder tab: the button itself (its tooltip names the folder in view),
    // and whether it reaches into subfolders as well
    private currentFolderTab: HTMLElement | null = null;
    private folderScopeRecursive: boolean = false;

    // Follow-editor-scroll: scroll the sidebar to track the editor's visible position
    private followEditorScroll: boolean = false;
    private editorScrollCleanup: (() => void) | null = null;
    private followScrollDebounce: number | null = null;
    private followScrollSelectedId: string | null = null;
    private lastManualSidebarScrollAt: number = 0;
    private sidebarManualScrollCleanup: (() => void) | null = null;
    // The MarkdownView our scroll listener is currently bound to. Tracked
    // separately from "active leaf" so the listener stays attached when the
    // user clicks the sidebar (which would otherwise change the active leaf
    // away from the editor and detach the listener).
    private attachedMarkdownView: MarkdownView | null = null;
    private static FOLLOW_SCROLL_PAUSE_MS = 2000;

    constructor(leaf: WorkspaceLeaf, plugin: HighlightCommentsPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.highlightRenderer = new HighlightRenderer(plugin);

        // Initialize tabSettings if it doesn't exist
        if (!this.plugin.settings.tabSettings) {
            this.plugin.settings.tabSettings = {};
        }

        // viewMode will be set when tabs are created in onOpen
        // Settings will be loaded via restoreTabSettings when appropriate

        // Load legacy settings as fallback (will be migrated to per-tab on first save)
        this.groupingMode = plugin.settings.groupingMode || 'none';
        this.sortMode = plugin.settings.sortMode || 'none';

        // Restore which highlight groups were left collapsed
        this.collapsedGroups = new Set(plugin.settings.collapsedGroups || []);

        // Load the type filter from vault-specific localStorage, honouring the state
        // stored by versions that only had a native-comments on/off toggle
        const storedTypeFilter = this.plugin.app.loadLocalStorage('sidebar-highlights-type-filter');
        this.typeFilter = (storedTypeFilter === 'all' || storedTypeFilter === 'highlights' || storedTypeFilter === 'comments')
            ? storedTypeFilter
            : migrateLegacyTypeFilter(this.plugin.app.loadLocalStorage('sidebar-highlights-show-native-comments'));
        // Load follow-editor-scroll state from vault-specific localStorage
        this.followEditorScroll = this.plugin.app.loadLocalStorage('sidebar-highlights-follow-editor-scroll') === 'true';
        // Load the Current folder tab's subfolder depth from vault-specific localStorage
        this.folderScopeRecursive = this.plugin.app.loadLocalStorage('sidebar-highlights-folder-scope-recursive') === 'true';
    }

    getViewType() { return VIEW_TYPE_HIGHLIGHTS; }
    getDisplayText() { return 'Highlights'; }
    getIcon() { return 'highlighter'; }

    /**
     * Get default settings for a specific tab
     */
    private getDefaultTabSettings(viewMode: 'current' | 'folder' | 'all' | 'collections'): { groupingMode: typeof this.groupingMode, sortMode: typeof this.sortMode, commentsExpanded: boolean, searchExpanded: boolean } {
        return {
            groupingMode: 'none',
            sortMode: 'none',
            commentsExpanded: false,
            searchExpanded: false
        };
    }

    /**
     * Save current tab settings
     */
    private saveCurrentTabSettings(): void {
        if (!this.plugin.settings.tabSettings) {
            this.plugin.settings.tabSettings = {};
        }

        this.plugin.settings.tabSettings[this.viewMode] = {
            groupingMode: this.groupingMode,
            sortMode: this.sortMode,
            commentsExpanded: this.commentsExpanded,
            searchExpanded: this.searchExpanded,
            selectedTags: Array.from(this.selectedTags),
            selectedCollections: Array.from(this.selectedCollections),
            selectedColors: Array.from(this.selectedColors)
        };

        void this.plugin.saveSettings();
    }

    /**
     * Restore tab settings when switching tabs
     */
    private restoreTabSettings(viewMode: 'current' | 'folder' | 'all' | 'collections'): void {
        const tabSettings = this.plugin.settings.tabSettings?.[viewMode];

        if (tabSettings) {
            // Restore saved settings for this tab
            this.groupingMode = tabSettings.groupingMode;
            this.sortMode = tabSettings.sortMode;
            this.commentsExpanded = tabSettings.commentsExpanded;
            this.searchExpanded = tabSettings.searchExpanded ?? false;

            // Restore filter selections
            this.selectedTags = new Set(tabSettings.selectedTags || []);
            this.selectedCollections = new Set(tabSettings.selectedCollections || []);
            this.selectedColors = new Set(tabSettings.selectedColors || []);

            // Sync highlightCommentsVisible map with commentsExpanded state
            if (this.commentsExpanded) {
                this.expandAllCommentsInMap();
            } else {
                this.collapseAllCommentsInMap();
            }
        } else {
            // Use defaults for this tab type
            const defaults = this.getDefaultTabSettings(viewMode);
            this.groupingMode = defaults.groupingMode;
            this.sortMode = defaults.sortMode;
            this.commentsExpanded = defaults.commentsExpanded;
            this.searchExpanded = defaults.searchExpanded;

            // Clear filters for new tabs
            this.selectedTags.clear();
            this.selectedCollections.clear();
            this.selectedColors.clear();

            // Sync highlightCommentsVisible map with default state (always collapsed)
            this.collapseAllCommentsInMap();
        }

        // The old Tasks tab's sorts may still be saved, and don't apply to highlights
        if (this.sortMode === 'priority' || this.sortMode === 'date-asc' || this.sortMode === 'date-desc') {
            this.sortMode = 'none';
        }

        // Update UI button states if they exist
        if (this.contentEl) {
            const groupButton = this.contentEl.querySelector('.highlights-group-button') as HTMLElement;
            if (groupButton) {
                this.updateGroupButtonState(groupButton);
            }

            if (this.sortButton) {
                this.updateSortButtonState(this.sortButton);
            }

            if (this.commentsToggleButton) {
                if (this.commentsExpanded) {
                    this.commentsToggleButton.classList.add('active');
                } else {
                    this.commentsToggleButton.classList.remove('active');
                }
                // Update the icon to match the restored state
                this.updateCommentsToggleIcon(this.commentsToggleButton);
            }

            // Update filter button state based on restored filters
            this.showTagActive();

            // Update search button and input container state
            const searchInputContainer = this.contentEl.querySelector('.highlights-search-input-container') as HTMLElement;
            if (this.searchButton && searchInputContainer) {
                if (this.searchExpanded) {
                    searchInputContainer.classList.remove('sh-hidden');
                    this.searchButton.classList.add('active');
                    setIcon(this.searchButton, 'x');
                    setTooltip(this.searchButton, t('toolbar.closeSearch'));
                } else {
                    searchInputContainer.classList.add('sh-hidden');
                    this.searchButton.classList.remove('active');
                    setIcon(this.searchButton, 'search');
                    setTooltip(this.searchButton, t('toolbar.search'));
                }
            }
        }
    }

    public getViewMode(): 'current' | 'folder' | 'all' | 'collections' {
        return this.viewMode;
    }

    async onOpen(skipInitialRender: boolean = false) {
        this.contentEl.empty();
        this.contentEl.classList.add('highlights-sidebar-content');

        // Only create the search container if toolbar is enabled
        if (this.plugin.settings.showToolbar) {
            const searchContainer = this.contentEl.createDiv({ cls: 'highlights-search-container' });
            
            // Replace search input with search button
            const searchButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button',
                attr: { 'data-action': 'search' }
            });
            this.searchButton = searchButton;
            setIcon(searchButton, 'search');
            setTooltip(searchButton, t('toolbar.search'));
            searchButton.addEventListener('click', () => {
                this.toggleSearch();
            });

            const groupButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button',
                attr: { 'data-action': 'group' }
            });
            setIcon(groupButton, 'group');
            setTooltip(groupButton, t('toolbar.group'));
            this.updateGroupButtonState(groupButton);
            groupButton.addEventListener('click', (event) => {
                const menu = new Menu();

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.none'))
                        .setIcon('list')
                        .setChecked(this.groupingMode === 'none')
                        .onClick(() => {
                            this.groupingMode = 'none';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            // Use renderContent instead of renderFilteredList to handle all view modes
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.color'))
                        .setIcon('palette')
                        .setChecked(this.groupingMode === 'color')
                        .onClick(() => {
                            this.groupingMode = 'color';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.commentsAsc'))
                        .setIcon('sort-asc')
                        .setChecked(this.groupingMode === 'comments-asc')
                        .onClick(() => {
                            this.groupingMode = 'comments-asc';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.commentsDesc'))
                        .setIcon('sort-desc')
                        .setChecked(this.groupingMode === 'comments-desc')
                        .onClick(() => {
                            this.groupingMode = 'comments-desc';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.dateAsc'))
                        .setIcon('calendar')
                        .setChecked(this.groupingMode === 'date-created-asc')
                        .onClick(() => {
                            this.groupingMode = 'date-created-asc';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.dateDesc'))
                        .setIcon('calendar')
                        .setChecked(this.groupingMode === 'date-created-desc')
                        .onClick(() => {
                            this.groupingMode = 'date-created-desc';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.parent'))
                        .setIcon('folder')
                        .setChecked(this.groupingMode === 'parent')
                        .onClick(() => {
                            this.groupingMode = 'parent';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });


                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.collection'))
                        .setIcon('folder-open')
                        .setChecked(this.groupingMode === 'collection')
                        .onClick(() => {
                            this.groupingMode = 'collection';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.heading'))
                        .setIcon('heading')
                        .setChecked(this.groupingMode === 'heading')
                        .onClick(() => {
                            this.groupingMode = 'heading';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.filename'))
                        .setIcon('file-text')
                        .setChecked(this.groupingMode === 'filename')
                        .onClick(() => {
                            this.groupingMode = 'filename';
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.showAtMouseEvent(event);
            });

            // Add sort button (positioned after group button)
            this.sortButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button',
                attr: { 'data-action': 'sort' }
            });
            setIcon(this.sortButton, 'arrow-up-down');
            setTooltip(this.sortButton, t('toolbar.sort'));
            this.updateSortButtonState(this.sortButton);
            this.sortButton.addEventListener('click', (event) => {
                const menu = new Menu();

                menu.addItem((item) => {
                    item
                        .setTitle(t('sorting.none'))
                        .setIcon('list')
                        .setChecked(this.sortMode === 'none')
                        .onClick(() => {
                            this.sortMode = 'none';
                            this.updateSortButtonState(this.sortButton);
                            this.saveSortModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle(t('sorting.aToZ'))
                        .setIcon('sort-asc')
                        .setChecked(this.sortMode === 'alphabetical-asc')
                        .onClick(() => {
                            this.sortMode = 'alphabetical-asc';
                            this.updateSortButtonState(this.sortButton);
                            this.saveSortModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle(t('sorting.zToA'))
                        .setIcon('sort-desc')
                        .setChecked(this.sortMode === 'alphabetical-desc')
                        .onClick(() => {
                            this.sortMode = 'alphabetical-desc';
                            this.updateSortButtonState(this.sortButton);
                            this.saveSortModeToSettings();
                            this.renderContent();
                        });
                });

                // Source-note sorting: available in every tab, since a list drawn
                // from several notes is hard to read in raw file-path order.
                menu.addSeparator();

                const addSortItem = (title: string, icon: string, mode: SortMode) => {
                    menu.addItem((item) => {
                        item
                            .setTitle(title)
                            .setIcon(icon)
                            .setChecked(this.sortMode === mode)
                            .onClick(() => {
                                this.sortMode = mode;
                                this.updateSortButtonState(this.sortButton);
                                this.saveSortModeToSettings();
                                this.renderContent();
                            });
                    });
                };

                addSortItem(t('sorting.noteTitleAsc'), 'file-text', 'note-title-asc');
                addSortItem(t('sorting.noteTitleDesc'), 'file-text', 'note-title-desc');

                menu.addSeparator();

                addSortItem(t('sorting.noteCreatedNewest'), 'calendar', 'note-created-desc');
                addSortItem(t('sorting.noteCreatedOldest'), 'calendar', 'note-created-asc');

                menu.addSeparator();
                addSortItem(t('sorting.createdNewest'), 'clock', 'created-desc');
                addSortItem(t('sorting.createdOldest'), 'clock', 'created-asc');


                menu.showAtMouseEvent(event);
            });

            this.commentsToggleButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button',
                attr: { 'data-action': 'comments' }
            });
            setTooltip(this.commentsToggleButton, t('toolbar.toggleHighlightComments'));
            this.updateCommentsToggleIcon(this.commentsToggleButton);
            this.commentsToggleButton.addEventListener('click', () => {
                this.toggleAllComments();
                this.updateCommentsToggleIcon(this.commentsToggleButton);

                // Update active state to match commentsExpanded
                if (this.commentsExpanded) {
                    this.commentsToggleButton.classList.add('active');
                } else {
                    this.commentsToggleButton.classList.remove('active');
                }

                this.renderContent(); // Use renderContent instead of renderFilteredList
            });

            const tagFilterButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button highlights-tag-filter-button',
                attr: { 'data-action': 'filter' }
            });
            setTooltip(tagFilterButton, t('toolbar.filter'));
            setIcon(tagFilterButton, 'list-filter');
            
            tagFilterButton.addEventListener('click', (event) => {
                this.showTagFilterMenu(event);
            });

            // Add collection navigation button (New Collection / Back to Collections)
            this.collectionNavButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button',
                attr: { 'data-action': 'collection-nav' }
            });
            setTooltip(this.collectionNavButton, 'Collection Navigation');
            this.updateCollectionNavButton(this.collectionNavButton);

            this.collectionNavButton.addEventListener('click', () => {
                if (this.viewMode === 'collections' && this.currentCollectionId) {
                    // Back to collections
                    this.currentCollectionId = null;
                    this.renderContent();
                } else {
                    // New collection
                    this.showNewCollectionDialog();
                }
            });

            // Add Actions button for multi-select (initially hidden)
            this.actionsButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button',
                attr: { 'data-action': 'actions' }
            });
            setTooltip(this.actionsButton, t('toolbar.actions'));
            setIcon(this.actionsButton, 'ellipsis');
            this.actionsButton.style.display = 'none'; // Hidden by default

            this.actionsButton.addEventListener('click', (event) => {
                this.showActionsMenu(event);
            });

            // Overflow ("more") menu — secondary actions, parked at the far right
            // of the toolbar. Holds follow-scroll, revert colors, copy visible.
            const overflowMenuButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button highlights-overflow-button',
                attr: { 'data-action': 'overflow' }
            });
            setTooltip(overflowMenuButton, t('toolbar.moreActions'));
            setIcon(overflowMenuButton, 'ellipsis-vertical');
            overflowMenuButton.addEventListener('click', (event) => {
                this.showOverflowMenu(event);
            });

            // Create search input container (initially hidden)
            const searchInputContainer = this.contentEl.createDiv({
                cls: 'highlights-search-input-container sh-hidden'
            });
            
            // Create the search input
            this.searchInputEl = searchInputContainer.createEl('input', {
                type: 'text',
                placeholder: t('toolbar.searchPlaceholder'),
                cls: 'highlights-search-input'
            });
            
            // Initialize simple search manager
            this.simpleSearchManager = new SimpleSearchManager(
                this.searchInputEl,
                searchInputContainer,
                (query, parsed) => this.handleSearchInput(query, parsed),
                {
                    tags: this.getAvailableTags(),
                    collections: this.getAvailableCollections()
                }
            );
        }

        // Add tabs container
        const tabsContainer = this.contentEl.createDiv({ cls: 'highlights-tabs-container' });

        // Tabs render in a fixed order, minus any hidden in settings. Building them
        // from that one list keeps creation, the active-tab mapping and the fallback
        // tab from drifting apart as tabs are added.
        const order = visibleTabs(this.plugin.settings);
        if (order.length > 0 && !order.includes(this.viewMode)) {
            this.viewMode = order[0];
        }

        this.currentFolderTab = null;
        order.forEach(tabId => {
            const tabEl = tabsContainer.createEl('button', {
                cls: 'highlights-tab' + (tabId === this.viewMode ? ' active' : '')
            });

            switch (tabId) {
                case 'current':
                    setIcon(tabEl, 'file-text');
                    setTooltip(tabEl, t('tabs.currentNote'));
                    break;
                case 'folder':
                    setIcon(tabEl, 'folder-closed');
                    this.currentFolderTab = tabEl;
                    this.updateCurrentFolderTabTooltip();
                    break;
                case 'all':
                    setIcon(tabEl, 'files');
                    setTooltip(tabEl, t('tabs.allNotes'));
                    break;
                case 'collections':
                    setIcon(tabEl, 'folder-open');
                    setTooltip(tabEl, t('tabs.collections'));
                    break;
            }

            tabEl.addEventListener('click', () => {
                if (this.viewMode === tabId) return;

                this.viewMode = tabId;
                this.clearSelection(); // Clear multi-select when switching tabs
                this.restoreTabSettings(tabId); // Restore tab-specific settings (including filters)
                if (tabId === 'collections') {
                    this.currentCollectionId = null;
                }
                this.updateTabStates();
                this.updateContent(); // Content update instead of full rebuild
            });
        });

        this.contentAreaEl = this.contentEl.createDiv({ cls: 'highlights-list-area' });
        this.listContainerEl = this.contentAreaEl.createDiv({ cls: 'highlights-list' });

        // Re-evaluate the follow-editor-scroll target whenever the active leaf
        // changes or the workspace layout changes. attachEditorScrollListener
        // is idempotent and target-aware, so this just no-ops if the same
        // markdown view is still the right target (e.g. when the user clicks
        // the sidebar — the editor stays attached even though the sidebar is
        // now the "active" leaf).
        const reevaluateFollowScroll = () => {
            if (!this.followEditorScroll) return;
            window.setTimeout(() => {
                this.attachEditorScrollListener();
                this.syncSidebarToEditorScroll();
            }, 50);
        };
        this.registerEvent(this.app.workspace.on('active-leaf-change', reevaluateFollowScroll));
        this.registerEvent(this.app.workspace.on('layout-change', reevaluateFollowScroll));

        // Restore settings for the initial viewMode
        this.restoreTabSettings(this.viewMode);

        // Only render if not skipping initial render (e.g., when called from refresh)
        if (!skipInitialRender) {
            this.renderContent();
        }

        // If follow-editor-scroll was previously on, attach the scroll listener now
        if (this.followEditorScroll) {
            window.setTimeout(() => {
                this.attachEditorScrollListener();
                this.syncSidebarToEditorScroll();
            }, 50);
        }
    }

    async onClose() {
        // Stop the plugin tracking this panel, so a closed view no longer
        // receives updates and the panels still open keep receiving theirs.
        this.plugin.releaseSidebarView(this);

        // Clean up dropdown manager
        this.dropdownManager.cleanup();

        // Clean up editor scroll listener
        this.detachEditorScrollListener();

        // Reset flags

        // Clear maps to free memory
        this.highlightCommentsVisible.clear();
        this.selectedTags.clear();
    }

    // Navigate to a specific collection (called from command palette)
    navigateToCollection(collectionId: string) {
        // Verify the collection exists
        const collection = this.plugin.collectionsManager.getCollection(collectionId);
        if (!collection) {
            new Notice('Collection not found');
            return;
        }

        // Switch to collections view mode and set the specific collection
        this.viewMode = 'collections';
        this.currentCollectionId = collectionId;
        
        // Mark the collections tab active. Positions shift with hidden tabs, so this
        // goes through the shared mapping rather than assuming a fixed index.
        this.updateTabStates();

        // Clear any tag filters
        this.selectedTags.clear();

        // Render the collection detail view
        this.renderContent();
    }

    refresh() {
        this.selectedTags.clear();
        // When toolbar setting changes, we need to rebuild the entire view structure
        // because onOpen() conditionally creates toolbar elements

        // Preserve current view mode and collection state
        const currentViewMode = this.viewMode;
        const currentCollectionId = this.currentCollectionId;

        // If we're in the middle of highlighting focus or color change, preserve that scroll position instead
        const shouldUseHighlightScroll = this.isHighlightFocusing || this.isColorChanging;
        const highlightScrollPosition = this.preservedScrollTop;
        
        // Capture current scroll position before rebuild (unless we're highlighting)
        if (!shouldUseHighlightScroll) {
            this.captureScrollPosition();
        }

        // Skip initial render in onOpen - we'll render after restoring state
        void this.onOpen(true);

        // Restore the view mode and collection state after DOM recreation
        this.viewMode = currentViewMode;
        this.currentCollectionId = currentCollectionId;

        // That tab may have just been hidden in settings - fall back rather than
        // rendering a view with no tab to match it
        if (tabIndex(this.plugin.settings, this.viewMode) === -1) {
            this.resetToFirstVisibleTab();
        }

        // Restore tab settings (grouping, sorting, etc.) for the correct viewMode
        // This is needed because onOpen() called restoreTabSettings with the old viewMode
        this.restoreTabSettings(this.viewMode);

        // Update the tab states to reflect the current view mode
        this.updateTabStates();

        // Now render content with the correct restored viewMode and settings
        this.renderContent();

        // Restore selected highlight styling after DOM rebuild
        this.restoreSelectedHighlight();
        
        // Restore appropriate scroll position after full rebuild
        if (shouldUseHighlightScroll) {
            // Use the preserved highlight scroll position
            window.requestAnimationFrame(() => {
                if (this.contentAreaEl) {
                    this.contentAreaEl.scrollTop = highlightScrollPosition;
                }
            });
        } else {
            // Use normal scroll restoration
            this.restoreScrollPosition();
        }
    }

    private updateTabStates() {
        // Tabs have no data-tab attributes, so they are addressed by their rendered
        // position - which shifts as tabs are hidden. tabIndex() owns that mapping.
        const tabs = this.contentEl.querySelectorAll('.highlights-tab');

        // Remove active class from all tabs
        tabs.forEach(tab => tab.classList.remove('active'));

        const activeTabIndex = tabIndex(this.plugin.settings, this.viewMode);
        if (activeTabIndex !== -1 && tabs[activeTabIndex]) {
            tabs[activeTabIndex].classList.add('active');
        }
    }

    resetToFirstVisibleTab() {
        // Determine which tab should be first based on settings
        const first = firstVisibleTab(this.plugin.settings);
        if (first) {
            this.viewMode = first;
            if (first === 'collections') {
                this.currentCollectionId = null; // Reset to collections list view
            }
        }
        // Note: Don't call updateTabStates() here - refresh() will do it after rebuilding the DOM
    }

    /** Name the folder in view on the tab itself, so "current folder" means something. */
    private updateCurrentFolderTabTooltip() {
        if (!this.currentFolderTab) return;
        const folder = this.getCurrentFolderLabel();
        setTooltip(this.currentFolderTab, folder === null
            ? t('tabs.currentFolder')
            : t('tabs.currentFolderNamed', { folder }));
    }

    private captureScrollPosition(): void {
        if (this.contentAreaEl) {
            this.savedScrollPosition = this.contentAreaEl.scrollTop;
        }
    }

    private restoreScrollPosition(): void {
        if (this.contentAreaEl && !this.isHighlightFocusing && !this.isColorChanging) {
            // Use requestAnimationFrame to ensure DOM is updated before restoring scroll
            window.requestAnimationFrame(() => {
                this.contentAreaEl.scrollTop = this.savedScrollPosition;
            });
        }
    }

    private restoreSelectedHighlight() {
        if (!this.plugin.selectedHighlightId) {
            return;
        }

        // Use requestAnimationFrame to ensure DOM is ready
        window.requestAnimationFrame(() => {
            // Clear all existing selections first to prevent multiples
            const allSelectedElements = this.containerEl.querySelectorAll('.selected, .highlight-selected');
            allSelectedElements.forEach(el => {
                el.classList.remove('selected', 'highlight-selected');
                // Clear any inline styles that might have been applied
                (el as HTMLElement).style.removeProperty('border-left-color');
                (el as HTMLElement).style.removeProperty('box-shadow');
            });
            
            const selectedEl = this.containerEl.querySelector(`[data-highlight-id="${this.plugin.selectedHighlightId}"]`) as HTMLElement;
            if (selectedEl) {
                selectedEl.classList.add('selected');
                
                // Find the highlight data to apply correct styling
                const selectedHighlight = this.plugin.selectedHighlightId ? this.getHighlightById(this.plugin.selectedHighlightId) : null;
                if (selectedHighlight) {
                    selectedEl.classList.add('highlight-selected');
                    this.applyHighlightColorStyling(selectedEl, selectedHighlight);
                }
            }
        });
    }

    private applyHighlightColorStyling(element: HTMLElement, highlight: Highlight) {
        const highlightColor = highlight.color || this.plugin.settings.highlightColor;
        element.style.borderLeftColor = highlightColor;
        if (!highlight.isNativeComment) {
            element.style.boxShadow = `0 0 0 1.5px ${highlightColor}, var(--shadow-s)`;
        }
    }

    // === MINIMAL-REFRESH ARCHITECTURE ===
    
    /**
     * Content-only update: repopulate highlight list without rebuilding structure
     * Use for: file switches, search changes, bulk content updates
     */
    public updateContent() {
        // Simplified: just use renderContent() which handles all view modes properly with consistent grouping
        // The performance benefit of the old populate methods was minimal compared to the maintenance burden
        this.renderContent();
    }


    /**
     * Update a single highlight item in-place without refreshing the entire sidebar
     * This preserves scroll position and visual state
     */
    public updateItem(highlightId: string) {
        const existingElement = this.containerEl.querySelector(`[data-highlight-id="${highlightId}"]`) as HTMLElement;
        if (!existingElement) {
            // Item not visible or doesn't exist, ignore silently
            return;
        }

        // Find updated highlight data
        const updatedHighlight = this.getHighlightById(highlightId);
        if (!updatedHighlight) {
            // Highlight was deleted, remove element
            existingElement.remove();
            return;
        }

        // Create new element with updated data
        const tempContainer = createDiv();
        const showFilename = this.viewMode === 'all' || this.viewMode === 'folder';
        this.createHighlightItem(tempContainer, updatedHighlight, this.getSearchTerm(), showFilename);
        
        // Replace existing element with updated one
        const newElement = tempContainer.firstElementChild as HTMLElement;
        if (newElement) {
            existingElement.parentNode?.replaceChild(newElement, existingElement);
            
            // Restore selection if this was the selected item
            if (this.plugin.selectedHighlightId === highlightId) {
                newElement.classList.add('selected');
                newElement.classList.add('highlight-selected');
                this.applyHighlightColorStyling(newElement, updatedHighlight);
            }
        }
    }

    private getSearchTerm(): string {
        const searchInput = this.containerEl.querySelector('.highlights-search-input') as HTMLInputElement;
        return searchInput?.value || '';
    }

    /**
     * Stable key for a highlight group's collapsed state.
     *
     * Scoped by tab and grouping mode so collapsing "Yellow" under colour
     * grouping does not also collapse a tag of the same name, and so each tab
     * keeps its own state.
     */
    private getHighlightGroupId(groupName: string): string {
        return `${this.viewMode}::${this.groupingMode}::${groupName}`;
    }

    /**
     * Make a group header collapse everything rendered beneath it.
     *
     * Applies the initial state, wires the click, and persists the change. The
     * collapsed set is read at render time, so the state survives re-renders
     * from sorting, filtering and edits.
     *
     * @param bodyElements Siblings that make up the group's body. Highlights use
     *   a single wrapper; task groups render several (a tasks container, plus a
     *   section header and container per section), so this takes a list.
     *
     * Hiding is done with a class rather than inline display, because task
     * sections collapse themselves via inline display. Using different
     * mechanisms lets the two compose: expanding a group restores its sections
     * to whatever state they were in rather than blanket-revealing them.
     */
    private makeGroupCollapsible(
        groupHeader: HTMLElement,
        bodyElements: HTMLElement[],
        groupName: string
    ) {
        const groupId = this.getHighlightGroupId(groupName);
        groupHeader.addClass('highlight-group-collapsible');
        groupHeader.setAttribute('data-group-id', groupId);

        // A leading chevron that rotates when collapsed, matching Sidebar RSS.
        // Always visible, so the group reads as collapsible before it is clicked —
        // unlike an indicator that only appears once already collapsed.
        const headerRow = groupHeader.querySelector('span') ?? groupHeader;
        const chevron = createDiv({ cls: 'highlight-group-chevron' });
        setIcon(chevron, 'chevron-down');
        headerRow.insertBefore(chevron, headerRow.firstChild);

        const apply = (collapsed: boolean) => {
            groupHeader.toggleClass('collapsed', collapsed);
            bodyElements.forEach(el => el.toggleClass('group-collapsed', collapsed));
        };

        apply(this.collapsedGroups.has(groupId));

        groupHeader.addEventListener('click', () => void (async () => {
            const collapsed = !this.collapsedGroups.has(groupId);
            if (collapsed) {
                this.collapsedGroups.add(groupId);
            } else {
                this.collapsedGroups.delete(groupId);
            }
            apply(collapsed);

            this.plugin.settings.collapsedGroups = Array.from(this.collapsedGroups);
            await this.plugin.saveSettings();
        })());
    }

    private renderContent() {
        // Note times are cached only for the duration of a render pass
        this.noteCreatedCache.clear();
        // The active note may have moved to another folder since the last render
        this.updateCurrentFolderTabTooltip();
        // Capture scroll position before DOM rebuild
        this.captureScrollPosition();

        if (this.viewMode === 'collections') {
            if (this.currentCollectionId) {
                this.enableSearchAndToolbar();
                this.renderCollectionDetailView(this.currentCollectionId);
            } else {
                this.disableSearchAndToolbar();
                this.renderCollectionsView();
            }
        } else {
            this.enableSearchAndToolbar();
            this.renderFilteredList();
        }

        // Update the collection navigation button when view changes
        if (this.collectionNavButton) {
            this.updateCollectionNavButton(this.collectionNavButton);
        }

        // Restore scroll position after DOM rebuild
        this.restoreScrollPosition();

        this.plugin.requestStatusBarUpdate();
    }

    private renderCollectionsView() {
        // Capture scroll position before DOM rebuild
        this.captureScrollPosition();
        
        this.contentAreaEl.empty();
        
        // Create the standard list container (same structure as other views)
        this.listContainerEl = this.contentAreaEl.createDiv({ 
            cls: 'highlights-list collections-container'
        });
        
        // Collections grid or empty state
        const collections = this.plugin.collectionsManager.getAllCollections();
        
        if (collections.length === 0) {
            this.renderEmptyCollectionsState(this.listContainerEl);
        } else {
            this.renderCollectionsGrid(this.listContainerEl, collections);
        }
        
        // Restore scroll position after DOM rebuild
        this.restoreScrollPosition();
    }

    private renderEmptyCollectionsState(container: HTMLElement) {
        this.highlightRenderer.createEmptyState(container, t('emptyStates.noCollectionsYet'));
    }

    private renderCollectionsGrid(container: HTMLElement, collections: Collection[]) {
        const grid = container.createDiv({ cls: 'collections-grid' });
        
        collections.forEach(collection => {
            const card = grid.createDiv({ cls: 'collection-card' });
            // Add data attribute for animation targeting
            card.setAttribute('data-collection-id', collection.id);
            
            // Menu button
            const menuBtn = card.createDiv({ cls: 'collection-menu-btn' });
            setIcon(menuBtn, 'ellipsis-vertical');
            menuBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.showCollectionMenu(event, collection);
            });
            
            const name = card.createDiv({ cls: 'collection-name' });
            name.textContent = collection.name;
            
            // Always add description div
            const description = card.createDiv({ cls: 'collection-description' });
            if (collection.description && collection.description.trim()) {
                description.textContent = collection.description;
            } else {
                description.textContent = t('emptyStates.noDescription');
                description.classList.add('collection-description-empty');
            }
            
            // Add styled info section similar to highlights
            const infoContainer = card.createDiv({ cls: 'collection-stats' });
            const collectionStats = this.plugin.collectionsManager.getCollectionStats(collection.id);
            
            const infoLineContainer = infoContainer.createEl('small', { cls: 'collection-info-line' });
            
            // Highlights count section
            const highlightsContainer = infoLineContainer.createDiv({
                cls: 'highlight-line-info'
            });
            
            const highlightsIcon = highlightsContainer.createDiv({ cls: 'line-icon' });
            setIcon(highlightsIcon, 'highlighter');
            
            highlightsContainer.createSpan({ text: `${collectionStats.highlightCount}` });

            // Native comments count section (show when native comments are on screen)
            if (this.typeFilter !== 'highlights') {
                const nativeCommentsContainer = infoLineContainer.createDiv({
                    cls: 'highlight-line-info'
                });
                
                const nativeCommentsIcon = nativeCommentsContainer.createDiv({ cls: 'line-icon' });
                setIcon(nativeCommentsIcon, 'captions');
                
                nativeCommentsContainer.createSpan({ text: `${collectionStats.nativeCommentsCount}` });
            }

            // Files count section
            const filesContainer = infoLineContainer.createDiv({
                cls: 'highlight-line-info'
            });
            
            const filesIcon = filesContainer.createDiv({ cls: 'line-icon' });
            setIcon(filesIcon, 'file-text');
            
            filesContainer.createSpan({ text: `${collectionStats.fileCount}` });
            
            card.addEventListener('click', () => {
                this.currentCollectionId = collection.id;
                this.renderContent();
            });
        });
    }

    /**
     * Find a markdown view already showing this file, preferring the active one.
     *
     * `getLeavesOfType` walks every leaf — main area, popout windows and the
     * left/right sidebars — so a note open in a side panel is reused instead of
     * being opened a second time in the main area.
     *
     * @param activate Focus the leaf when one is found elsewhere in the workspace
     * @returns The matching view, or null when the file is not open anywhere
     */
    private findOpenMarkdownView(filePath: string, activate: boolean): MarkdownView | null {
        const active = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (active && active.file?.path === filePath) {
            return active;
        }

        for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === filePath) {
                if (activate) {
                    this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
                }
                return leaf.view;
            }
        }

        return null;
    }

    /**
     * Open a note from the sidebar, reusing a view that already has it open —
     * including one in a left or right sidebar — instead of opening a second
     * copy in the main area.
     *
     * A modifier-click still opens a new tab or split, since that is an explicit
     * request for one.
     */
    private openNoteReusingLeaf(filePath: string, event?: MouseEvent) {
        if (event && Keymap.isModEvent(event)) {
            void this.plugin.app.workspace.openLinkText(filePath, filePath, Keymap.isModEvent(event));
            return;
        }

        if (this.findOpenMarkdownView(filePath, true)) {
            return;
        }

        void this.plugin.app.workspace.openLinkText(filePath, filePath, false);
    }

    private renderCollectionDetailView(collectionId: string) {
        // Capture scroll position before DOM rebuild
        this.captureScrollPosition();
        
        const collection = this.plugin.collectionsManager.getCollection(collectionId);
        if (!collection) {
            new Notice('Collection not found');
            this.currentCollectionId = null;
            this.renderContent();
            return;
        }

        // Reset to normal list area structure for highlights (same as other views)
        this.contentAreaEl.empty();
        
        // Create the standard list container (same structure as other views)
        this.listContainerEl = this.contentAreaEl.createDiv({ cls: 'highlights-list' });
        
        // Get highlights in this collection
        const highlights = this.plugin.collectionsManager.getHighlightsInCollection(collectionId);
        
        if (highlights.length === 0) {
            this.renderEmptyCollectionState(this.listContainerEl, collection);
        } else {
            this.renderCollectionHighlights(highlights);
        }

        // Update filter button state
        this.showTagActive();

        // Restore scroll position after DOM rebuild
        this.restoreScrollPosition();
    }

    private renderEmptyCollectionState(container: HTMLElement, collection: Collection) {
        this.highlightRenderer.createEmptyState(container, t('emptyStates.noHighlightsInCollection'));
    }

    private renderCollectionHighlights(highlights: Highlight[]) {
        // Apply all filtering (smart search + existing filters)
        const searchTerm = this.searchInputEl?.value.toLowerCase().trim() || '';
        let filteredHighlights = this.applyAllFilters(highlights);

        if (filteredHighlights.length === 0) {
            const message = searchTerm ? t('emptyStates.noMatchingInCollection') : t('emptyStates.noHighlightsInCollection');
            this.highlightRenderer.createEmptyState(this.listContainerEl, message);
            return;
        }

        // Apply grouping if enabled
        if (this.groupingMode === 'none') {
            const sortedHighlights = filteredHighlights.sort((a, b) => {
                return this.compareHighlightsBySortMode(a, b, 'path-then-position');
            });

            sortedHighlights.forEach(highlight => {
                this.createHighlightItem(this.listContainerEl, highlight, searchTerm, true); // true for showFilename
            });
        } else {
            this.renderGroupedHighlights(filteredHighlights, searchTerm, true); // true for showFilename
        }
    }

    private renderFilteredList() {
        if (!this.contentAreaEl || !this.listContainerEl) {
            return;
        }

        // Capture scroll position before DOM rebuild
        this.captureScrollPosition();

        // Reset to normal list area structure for highlights
        this.contentAreaEl.empty();
        this.listContainerEl = this.contentAreaEl.createDiv({ cls: 'highlights-list' });

        // Get search term - if no search input (toolbar disabled), use empty string
        const searchTerm = this.searchInputEl ? this.searchInputEl.value.toLowerCase().trim() : '';

        this.listContainerEl.empty();

        let allHighlights: Highlight[];

        if (this.viewMode === 'current') {
            const file = this.plugin.app.workspace.getActiveFile();
            if (!file) {
                this.highlightRenderer.createEmptyState(this.listContainerEl, t('emptyStates.noFileOpen'));
                this.restoreScrollPosition();
                this.showTagActive();
                return;
            }
            allHighlights = this.plugin.getCurrentFileHighlights();
        } else if (this.viewMode === 'folder') {
            allHighlights = this.getFolderHighlights();
        } else if (this.viewMode === 'all') {
            // Get all highlights from all files
            allHighlights = [];
            for (const highlights of this.plugin.highlights.values()) {
                allHighlights.push(...highlights);
            }
        } else {
            // Collections view is handled elsewhere
            return;
        }


        // VIEW-LEVEL FILTERING: Filter out highlights from excluded files
        // This only applies to 'current' and 'all' views, NOT collections
        // Collections should show ALL highlights regardless of file filtering
        allHighlights = allHighlights.filter(highlight => {
            const file = this.plugin.app.vault.getAbstractFileByPath(highlight.filePath);
            if (!file || !(file instanceof TFile)) {
                return false; // File doesn't exist
            }
            // Check if file should be processed (not filtered)
            return this.plugin.shouldProcessFile(file);
        });

        let filteredHighlights = this.applyAllFilters(allHighlights);

        if (filteredHighlights.length === 0) {
            let message: string;
            if (this.viewMode === 'current') {
                const file = this.plugin.app.workspace.getActiveFile();
                if (file && file.extension === 'pdf') {
                    message = t('emptyStates.pdfNotSupported');
                } else {
                    message = searchTerm ? t('emptyStates.noMatching') : t('emptyStates.noHighlightsInFile');
                }
            } else if (this.viewMode === 'folder') {
                const folder = this.getCurrentFolderLabel();
                if (folder === null) {
                    message = t('emptyStates.noFileOpen');
                } else {
                    message = searchTerm
                        ? t('emptyStates.noMatchingInFolder', { folder })
                        : t('emptyStates.noHighlightsInFolder', { folder });
                }
            } else {
                message = searchTerm ? t('emptyStates.noMatchingAcrossAll') : t('emptyStates.noHighlightsAcrossAll');
            }
            this.highlightRenderer.createEmptyState(this.listContainerEl, message);
        } else {
            if (this.groupingMode === 'none') {
                // Sort highlights
                const sortedHighlights = filteredHighlights.sort((a, b) => {
                    return this.compareHighlightsBySortMode(a, b, 'path-then-position');
                });
                
                // No grouping - use pagination for "All Notes" performance.
                // The folder tab can span a whole project tree, so it paginates too.
                if (this.viewMode === 'all' || this.viewMode === 'folder') {
                    this.renderHighlightsWithPagination(sortedHighlights, searchTerm);
                } else {
                    // Current file - render all items directly (small dataset)
                    sortedHighlights.forEach(highlight => {
                        this.createHighlightItem(this.listContainerEl, highlight, searchTerm, false);
                    });
                }
            } else {
                // Use pagination for grouped highlights in "All Notes" mode
                if (this.viewMode === 'all' || this.viewMode === 'folder') {
                    this.renderGroupedHighlightsWithPagination(filteredHighlights, searchTerm);
                } else {
                    // Current file - render all groups directly (small dataset)
                    this.renderGroupedHighlights(filteredHighlights, searchTerm, false);
                }
            }
        }
        this.showTagActive();

        // Restore scroll position after DOM rebuild
        this.restoreScrollPosition();

        this.plugin.requestStatusBarUpdate();
    }

    /**
     * Render highlights with pagination for "All Notes" performance
     * @param highlights Array of all highlights available
     * @param searchTerm Optional search term for highlighting
     */
    private renderHighlightsWithPagination(highlights: Highlight[], searchTerm?: string): void {
        this.totalHighlights = highlights;
        
        // Only reset to first page if we have new data AND we're not preserving pagination
        // (e.g., when switching tabs or searching, but not when clicking highlights)
        if (!this.isPreservingPagination) {
            this.currentPage = 0;
        }
        
        // Ensure current page is valid for the new data
        const maxPage = Math.max(0, Math.ceil(highlights.length / this.itemsPerPage) - 1);
        if (this.currentPage > maxPage) {
            this.currentPage = maxPage;
        }
        
        this.renderCurrentPage(searchTerm);
        this.renderPaginationControls();
        
        // Reset the flag after rendering
        this.isPreservingPagination = false;
    }
    
    /**
     * Render the current page of highlights
     */
    private renderCurrentPage(searchTerm?: string): void {
        const startIndex = this.currentPage * this.itemsPerPage;
        const endIndex = Math.min(startIndex + this.itemsPerPage, this.totalHighlights.length);
        const pageHighlights = this.totalHighlights.slice(startIndex, endIndex);
        
        // Clear ALL content from the container (highlights AND pagination controls)
        this.listContainerEl.empty();
        
        // Render current page items first
        pageHighlights.forEach(highlight => {
            this.createHighlightItem(this.listContainerEl, highlight, searchTerm, true);
        });
    }
    
    /**
     * Render pagination controls at the bottom
     */
    private renderPaginationControls(): void {
        // Remove existing pagination
        const existingPagination = this.listContainerEl.querySelector('.pagination-controls');
        if (existingPagination) {
            existingPagination.remove();
        }
        
        const totalPages = Math.ceil(this.totalHighlights.length / this.itemsPerPage);
        
        // Only show pagination if we have more than one page
        if (totalPages <= 1) {
            return;
        }
        
        const paginationContainer = this.listContainerEl.createDiv({
            cls: 'pagination-controls'
        });
        
        // Previous button
        const prevButton = paginationContainer.createEl('button', {
            cls: 'clickable-icon'
        });
        prevButton.disabled = this.currentPage === 0;
        // Add Lucide chevron-left icon using Obsidian's setIcon
        setIcon(prevButton, 'chevron-left');
        prevButton.addEventListener('click', () => {
            if (this.currentPage > 0) {
                this.currentPage--;
                this.renderCurrentPage(this.getSearchTerm());
                this.renderPaginationControls();
                // Ensure scroll to top happens after DOM updates
                window.requestAnimationFrame(() => {
                    this.contentAreaEl.scrollTop = 0;
                });
            }
        });
        
        // Page info
        paginationContainer.createSpan({
            text: `${this.currentPage + 1}/${totalPages}`,
            cls: 'pagination-info pagination-info-compact'
        });
        
        // Next button
        const nextButton = paginationContainer.createEl('button', {
            cls: 'clickable-icon'
        });
        nextButton.disabled = this.currentPage >= totalPages - 1;
        // Add Lucide chevron-right icon using Obsidian's setIcon
        setIcon(nextButton, 'chevron-right');
        nextButton.addEventListener('click', () => {
            if (this.currentPage < totalPages - 1) {
                this.currentPage++;
                this.renderCurrentPage(this.getSearchTerm());
                this.renderPaginationControls();
                // Ensure scroll to top happens after DOM updates
                window.requestAnimationFrame(() => {
                    this.contentAreaEl.scrollTop = 0;
                });
            }
        });
    }

    /**
     * Render grouped highlights with pagination for "All Notes" performance
     * @param highlights Array of all highlights available
     * @param searchTerm Optional search term for highlighting
     */
    private renderGroupedHighlightsWithPagination(highlights: Highlight[], searchTerm?: string): void {
        // First, process highlights into groups (same logic as renderGroupedHighlights)
        const groups = new Map<string, Highlight[]>();
        const groupColors = new Map<string, string>();
        const groupPositions = new Map<string, DocumentPosition>();
        const multiNote = new Set(highlights.map(h => h.filePath)).size > 1;

        // Group highlights based on grouping mode (same grouping logic)
        highlights.forEach(highlight => {
            let groupKey: string;
            
            if (this.groupingMode === 'color') {
                const color = highlight.color || this.plugin.settings.highlightColor;
                groupKey = color;
                groupColors.set(groupKey, color);
            } else if (this.groupingMode === 'comments-asc' || this.groupingMode === 'comments-desc') {
                const commentCount = highlight.isNativeComment ? 0 : (highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0);
                groupKey = commentCount === 0 ? 'No Comments' : 
                          commentCount === 1 ? '1 Comment' : 
                          `${commentCount} Comments`;
            } else if (this.groupingMode === 'parent') {
                const pathParts = highlight.filePath.split('/');
                if (pathParts.length > 1) {
                    groupKey = pathParts[pathParts.length - 2];
                } else {
                    groupKey = 'Root';
                }
            } else if (this.groupingMode === 'collection') {
                const collections = this.plugin.collectionsManager.getAllCollections()
                    .filter(collection => collection.highlightIds.includes(highlight.id));
                
                if (collections.length === 0) {
                    groupKey = 'No Collections';
                } else if (collections.length === 1) {
                    groupKey = collections[0].name;
                } else {
                    groupKey = collections.map(c => c.name).sort().join(', ');
                }
            } else if (this.groupingMode === 'filename') {
                const filename = highlight.filePath.split('/').pop() || highlight.filePath;
                groupKey = filename.replace(/\.md$/, '');
            } else if (this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc') {
                if (highlight.createdAt) {
                    const date = new Date(highlight.createdAt);
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    groupKey = `${year}-${month}-${day}`;
                } else {
                    groupKey = 'No Date';
                }
            } else if (this.groupingMode === 'heading') {
                const group = this.headingGroupFor(highlight, multiNote);
                groupKey = group.key;
                groupPositions.set(groupKey, group.position);
            } else {
                groupKey = 'Default';
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(highlight);
        });

        // Sort groups and sort highlights within each group
        const sortedGroups = Array.from(groups.entries()).map(([groupName, groupHighlights]) => {
            // Sort highlights within the group
            let sortedHighlights: Highlight[];
            if (this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc') {
                sortedHighlights = groupHighlights.sort((a, b) => {
                    const timeA = a.createdAt || 0;
                    const timeB = b.createdAt || 0;

                    if (this.groupingMode === 'date-created-asc') {
                        return timeA - timeB; // Earlier times first
                    } else {
                        return timeB - timeA; // Later times first
                    }
                });
            } else {
                // Within a group the file is already implied, so ties fall back
                // to position rather than path.
                sortedHighlights = groupHighlights.sort(
                    (a, b) => this.compareHighlightsBySortMode(a, b, 'position')
                );
            }
            return [groupName, sortedHighlights] as [string, Highlight[]];
        }).sort(([a], [b]) => {
            if (this.groupingMode === 'comments-asc' || this.groupingMode === 'comments-desc') {
                if (a === 'No Comments' && b === 'No Comments') return 0;
                if (a === 'No Comments') return this.groupingMode === 'comments-asc' ? -1 : 1;
                if (b === 'No Comments') return this.groupingMode === 'comments-asc' ? 1 : -1;
                
                const aNum = parseInt(a.split(' ')[0]) || 0;
                const bNum = parseInt(b.split(' ')[0]) || 0;
                
                return this.groupingMode === 'comments-asc' ? aNum - bNum : bNum - aNum;
            } else if (this.groupingMode === 'tag') {
                if (a === 'No Tags' && b === 'No Tags') return 0;
                if (a === 'No Tags') return 1;
                if (b === 'No Tags') return -1;
                return a.localeCompare(b);
            } else if (this.groupingMode === 'parent') {
                if (a === 'Root' && b === 'Root') return 0;
                if (a === 'Root') return -1;
                if (b === 'Root') return 1;
                return a.localeCompare(b);
            } else if (this.groupingMode === 'collection') {
                if (a === 'No Collections' && b === 'No Collections') return 0;
                if (a === 'No Collections') return 1;
                if (b === 'No Collections') return -1;
                return a.localeCompare(b);
            } else if (this.groupingMode === 'heading') {
                // Reading order: the note's position, never alphabetical
                return compareDocumentOrder(groupPositions.get(a)!, groupPositions.get(b)!);
            } else if (this.groupingMode === 'filename') {
                return a.localeCompare(b);
            } else if (this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc') {
                if (a === 'No Date' && b === 'No Date') return 0;
                if (a === 'No Date') return 1;
                if (b === 'No Date') return -1;
                
                const dateA = new Date(a);
                const dateB = new Date(b);
                
                if (this.groupingMode === 'date-created-asc') {
                    return dateA.getTime() - dateB.getTime();
                } else {
                    return dateB.getTime() - dateA.getTime();
                }
            }
            return a.localeCompare(b);
        });

        this.totalGroups = sortedGroups;
        
        // Only reset to first page if we have new data AND we're not preserving pagination
        if (!this.isPreservingPagination) {
            this.currentGroupPage = 0;
        }
        
        // Calculate total highlights across all groups
        const totalHighlightCount = sortedGroups.reduce((sum, [, highlights]) => sum + highlights.length, 0);
        const maxPage = Math.max(0, Math.ceil(totalHighlightCount / this.itemsPerPage) - 1);
        if (this.currentGroupPage > maxPage) {
            this.currentGroupPage = maxPage;
        }
        
        this.renderCurrentGroupPage(searchTerm, groupColors);
        this.renderGroupPaginationControls();
        
        // Reset the flag after rendering
        this.isPreservingPagination = false;
    }

    /**
     * Render the current page of groups (limited by highlight count, not group count)
     */
    private renderCurrentGroupPage(searchTerm?: string, groupColors?: Map<string, string>): void {
        const startHighlightIndex = this.currentGroupPage * this.itemsPerPage;
        const endHighlightIndex = startHighlightIndex + this.itemsPerPage;
        
        // Clear ALL content from the container
        this.listContainerEl.empty();
        
        let currentHighlightIndex = 0;
        
        // Iterate through groups and render highlights until we reach our limit
        for (const [groupName, groupHighlights] of this.totalGroups) {
            const groupSize = groupHighlights.length;
            
            // Check if this group intersects with our page range
            if (currentHighlightIndex + groupSize > startHighlightIndex && 
                currentHighlightIndex < endHighlightIndex) {
                
                // Determine which highlights from this group to show
                const groupStartOffset = Math.max(0, startHighlightIndex - currentHighlightIndex);
                const groupEndOffset = Math.min(groupSize, endHighlightIndex - currentHighlightIndex);
                const groupHighlightsToShow = groupHighlights.slice(groupStartOffset, groupEndOffset);
                
                // Only render the group if we have highlights to show
                if (groupHighlightsToShow.length > 0) {
                    // Render group header
                    const groupHeader = this.renderGroupHeader(groupName, groupHighlights, groupColors);

                    // Items live in their own container so the header can hide them as a unit
                    const itemsContainer = this.listContainerEl.createDiv({ cls: 'highlight-group-items' });

                    // Render the subset of highlights for this page (already sorted)
                    groupHighlightsToShow.forEach(highlight => {
                        this.createHighlightItem(itemsContainer, highlight, searchTerm, true);
                    });

                    this.makeGroupCollapsible(groupHeader, [itemsContainer], groupName);
                }
            }
            
            currentHighlightIndex += groupSize;
            
            // Stop if we've rendered enough highlights or gone past our range
            if (currentHighlightIndex >= endHighlightIndex) {
                break;
            }
        }
    }

    /**
     * Render just the group header with stats
     */
    private renderGroupHeader(groupName: string, groupHighlights: Highlight[], groupColors?: Map<string, string>): HTMLElement {
        // Create group header
        const groupHeader = this.listContainerEl.createDiv({ cls: 'highlight-group-header' });
        
        // Create header text container for name and icons
        const headerTextContainer = groupHeader.createSpan();
        
        // Add color square if grouping by color
        if (this.groupingMode === 'color' && groupColors?.has(groupName)) {
            const color = groupColors.get(groupName)!;
            const colorSquare = headerTextContainer.createDiv({ 
                cls: 'group-color-square',
                attr: { 'data-color': color }
            });
            colorSquare.style.backgroundColor = color;
        }
        
        // Add tag icon if grouping by tag
        if (this.groupingMode === 'tag') {
            const tagIcon = headerTextContainer.createDiv({ cls: 'group-tag-icon' });
            setIcon(tagIcon, 'tag');
        }
        
        const headerText = headerTextContainer.createSpan();
        headerText.textContent = this.getGroupDisplayName(groupName);
        
        // Add collection-style stats underneath the group header
        const statsContainer = groupHeader.createDiv({ cls: 'collection-stats' });
        const infoLineContainer = statsContainer.createEl('small', { cls: 'collection-info-line' });
        
        // Calculate file count for this group
        const uniqueFiles = new Set(groupHighlights.map(h => h.filePath));
        const fileCount = uniqueFiles.size;
        
        // Calculate native comments count for this group
        const nativeCommentsCount = groupHighlights.filter(h => h.isNativeComment).length;
        
        // Highlights count section (excluding native comments)
        const regularHighlightsCount = groupHighlights.filter(h => !h.isNativeComment).length;
        const highlightsContainer = infoLineContainer.createDiv({
            cls: 'highlight-line-info'
        });
        
        const highlightsIcon = highlightsContainer.createDiv({ cls: 'line-icon' });
        setIcon(highlightsIcon, 'highlighter');
        
        highlightsContainer.createSpan({ text: `${regularHighlightsCount}` });

        // Native comments count section (show when native comments are on screen)
        if (this.typeFilter !== 'highlights') {
            const nativeCommentsContainer = infoLineContainer.createDiv({
                cls: 'highlight-line-info'
            });
            
            const nativeCommentsIcon = nativeCommentsContainer.createDiv({ cls: 'line-icon' });
            setIcon(nativeCommentsIcon, 'captions');
            
            nativeCommentsContainer.createSpan({ text: `${nativeCommentsCount}` });
        }

        // Files count section
        const filesContainer = infoLineContainer.createDiv({
            cls: 'highlight-line-info'
        });
        
        const filesIcon = filesContainer.createDiv({ cls: 'line-icon' });
        setIcon(filesIcon, 'files');
        
        filesContainer.createSpan({ text: `${fileCount}` });

        return groupHeader;
    }

    /**
     * Render a single group with its highlights (extracted from renderGroupedHighlights)
     */
    private renderSingleGroup(groupName: string, groupHighlights: Highlight[], searchTerm?: string, showFilename: boolean = false, groupColors?: Map<string, string>): void {
        // Render group header
        const groupHeader = this.renderGroupHeader(groupName, groupHighlights, groupColors);

        // Sort highlights within the group
        let sortedHighlights: Highlight[];
        if (this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc') {
            sortedHighlights = groupHighlights.sort((a, b) => {
                const timeA = a.createdAt || 0;
                const timeB = b.createdAt || 0;
                
                if (this.groupingMode === 'date-created-asc') {
                    return timeA - timeB; // Earlier times first
                } else {
                    return timeB - timeA; // Later times first
                }
            });
        } else {
            sortedHighlights = groupHighlights.sort((a, b) => a.startOffset - b.startOffset);
        }
        
        // Create highlights in this group
        // Items live in their own container so the header can hide them as a unit
        const itemsContainer = this.listContainerEl.createDiv({ cls: 'highlight-group-items' });
        sortedHighlights.forEach(highlight => {
            this.createHighlightItem(itemsContainer, highlight, searchTerm, showFilename);
        });

        this.makeGroupCollapsible(groupHeader, [itemsContainer], groupName);
    }

    /**
     * Render pagination controls for groups
     */
    private renderGroupPaginationControls(): void {
        // Remove existing pagination
        const existingPagination = this.listContainerEl.querySelector('.pagination-controls');
        if (existingPagination) {
            existingPagination.remove();
        }
        
        // Calculate total highlights across all groups
        const totalHighlightCount = this.totalGroups.reduce((sum, [, highlights]) => sum + highlights.length, 0);
        const totalPages = Math.ceil(totalHighlightCount / this.itemsPerPage);
        
        // Only show pagination if we have more than one page
        if (totalPages <= 1) {
            return;
        }
        
        const paginationContainer = this.listContainerEl.createDiv({
            cls: 'pagination-controls'
        });
        
        // Previous button
        const prevButton = paginationContainer.createEl('button', {
            cls: 'clickable-icon'
        });
        prevButton.disabled = this.currentGroupPage === 0;
        // Add Lucide chevron-left icon using Obsidian's setIcon
        setIcon(prevButton, 'chevron-left');
        prevButton.addEventListener('click', () => {
            if (this.currentGroupPage > 0) {
                this.currentGroupPage--;
                this.renderCurrentGroupPage(this.getSearchTerm());
                this.renderGroupPaginationControls();
                // Ensure scroll to top happens after DOM updates
                window.requestAnimationFrame(() => {
                    this.contentAreaEl.scrollTop = 0;
                });
            }
        });
        
        // Page info
        paginationContainer.createSpan({
            text: `${this.currentGroupPage + 1}/${totalPages}`,
            cls: 'pagination-info pagination-info-compact'
        });
        
        // Next button
        const nextButton = paginationContainer.createEl('button', {
            cls: 'clickable-icon'
        });
        nextButton.disabled = this.currentGroupPage >= totalPages - 1;
        // Add Lucide chevron-right icon using Obsidian's setIcon
        setIcon(nextButton, 'chevron-right');
        nextButton.addEventListener('click', () => {
            if (this.currentGroupPage < totalPages - 1) {
                this.currentGroupPage++;
                this.renderCurrentGroupPage(this.getSearchTerm());
                this.renderGroupPaginationControls();
                // Ensure scroll to top happens after DOM updates
                window.requestAnimationFrame(() => {
                    this.contentAreaEl.scrollTop = 0;
                });
            }
        });
    }

    private updateGroupButtonState(button: HTMLElement) {
        if (this.groupingMode === 'none') {
            button.classList.remove('active');
        } else {
            button.classList.add('active');
        }
    }

    private saveGroupingModeToSettings() {
        // Save to per-tab settings
        this.saveCurrentTabSettings();
        // Also save to legacy settings for backwards compatibility
        this.plugin.settings.groupingMode = this.groupingMode;
    }

    /**
     * Update Actions button visibility based on selected highlights
     */
    private updateActionsButtonVisibility() {
        if (!this.actionsButton) return;

        if (this.selectedHighlightIds.size > 0) {
            this.actionsButton.style.display = '';
        } else {
            this.actionsButton.style.display = 'none';
        }
    }

    /**
     * Update visual selection state for a specific highlight
     */
    private updateHighlightSelectionVisual(highlightId: string) {
        const highlightEl = this.containerEl.querySelector(`[data-highlight-id="${highlightId}"]`) as HTMLElement;
        if (!highlightEl) return;

        if (this.selectedHighlightIds.has(highlightId)) {
            // Add selection styling
            highlightEl.classList.add('selected', 'highlight-selected');
            const highlight = this.getHighlightById(highlightId);
            if (highlight) {
                const highlightColor = highlight.color || this.plugin.settings.highlightColor;
                if (!highlight.isNativeComment) {
                    highlightEl.style.boxShadow = `0 0 0 1.5px ${highlightColor}, var(--shadow-s)`;
                }
            }
        } else {
            // Remove selection styling
            highlightEl.classList.remove('selected', 'highlight-selected');
            highlightEl.style.boxShadow = '';
        }
    }

    /**
     * Clear all selected highlights
     */
    private clearSelection() {
        this.selectedHighlightIds.clear();

        // Remove visual selection from all highlights
        const selectedEls = this.containerEl.querySelectorAll('.highlight-selected');
        selectedEls.forEach((el: HTMLElement) => {
            el.classList.remove('selected', 'highlight-selected');
            el.style.boxShadow = '';
        });

        this.updateActionsButtonVisibility();
    }

    /**
     * Add all selected highlights to a collection
     */
    private addSelectedHighlightsToCollection(collectionId: string) {
        this.selectedHighlightIds.forEach(highlightId => {
            this.plugin.collectionsManager.addHighlightToCollection(collectionId, highlightId);
        });
        this.dropdownManager.closeActiveDropdown();
        this.clearSelection();
        this.renderContent();
    }

    /**
     * Remove all selected highlights from a collection
     */
    private removeSelectedHighlightsFromCollection(collectionId: string) {
        this.selectedHighlightIds.forEach(highlightId => {
            this.plugin.collectionsManager.removeHighlightFromCollection(collectionId, highlightId);
        });
        this.dropdownManager.closeActiveDropdown();
        this.clearSelection();
        this.renderContent();
    }

    /**
     * Show Actions menu for multi-selected highlights
     */
    private showActionsMenu(event: MouseEvent) {
        if (this.selectedHighlightIds.size === 0) return;

        const allCollections = this.plugin.collectionsManager.getAllCollections();

        // Create menu items
        const menuItems: DropdownItem[] = [];

        // Add to Collection - shows collection picker (disabled if no collections)
        menuItems.push({
            text: t('actions.moveToCollection'),
            icon: 'folder-plus',
            className: allCollections.length === 0 ? 'highlights-dropdown-item disabled' : undefined,
            onClick: () => {
                // Don't execute if no collections
                if (allCollections.length === 0) return;
                // Close current dropdown first
                this.dropdownManager.closeActiveDropdown();
                // Show collection picker
                this.showCollectionPickerForAdd(event);
            }
        });

        // Remove from Collection - only show collections that contain at least one selected highlight
        const collectionsWithSelected = allCollections.filter(collection => {
            return Array.from(this.selectedHighlightIds).some(highlightId =>
                collection.highlightIds.includes(highlightId)
            );
        });

        if (collectionsWithSelected.length > 0) {
            menuItems.push({
                text: t('actions.removeFromCollection'),
                icon: 'folder-minus',
                onClick: () => {
                    // Close current dropdown first
                    this.dropdownManager.closeActiveDropdown();
                    // Show collection picker for removal
                    this.showCollectionPickerForRemove(event, collectionsWithSelected);
                }
            });
        }

        menuItems.push({
            text: '',
            separator: true
        });

        // Clear Selection
        menuItems.push({
            text: t('actions.clearSelection'),
            icon: 'x',
            onClick: () => {
                this.clearSelection();
                this.dropdownManager.closeActiveDropdown();
            }
        });

        // Show dropdown
        const targetEl = event.target as HTMLElement;
        this.dropdownManager.showDropdown(targetEl, menuItems);
    }

    /**
     * Show collection picker for adding selected highlights
     */
    private showCollectionPickerForAdd(event: MouseEvent) {
        const allCollections = this.plugin.collectionsManager.getAllCollections();

        const items: DropdownItem[] = allCollections.map(collection => ({
            text: collection.name,
            icon: 'folder',
            onClick: () => {
                this.addSelectedHighlightsToCollection(collection.id);
            }
        }));

        const targetEl = event.target as HTMLElement;
        this.dropdownManager.showDropdown(targetEl, items);
    }

    /**
     * Show collection picker for removing selected highlights
     */
    private showCollectionPickerForRemove(event: MouseEvent, collections: Collection[]) {
        const items: DropdownItem[] = collections.map(collection => ({
            text: collection.name,
            icon: 'folder',
            onClick: () => {
                this.removeSelectedHighlightsFromCollection(collection.id);
            }
        }));

        const targetEl = event.target as HTMLElement;
        this.dropdownManager.showDropdown(targetEl, items);
    }

    private updateSortButtonState(button: HTMLElement) {
        // Check if date-based grouping is active (sorting doesn't apply for highlights)
        const isDateGrouping = this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc';

        // Keep icon consistent
        setIcon(button, 'arrow-up-down');

        if (isDateGrouping) {
            // Disable button when sorting doesn't apply (highlights only)
            (button as HTMLButtonElement).disabled = true;
            button.classList.remove('active');
            setTooltip(button, t('toolbar.sort'));
        } else {
            // Normal sorting state
            (button as HTMLButtonElement).disabled = false;
            if (this.sortMode === 'none') {
                button.classList.remove('active');
                setTooltip(button, t('toolbar.sort'));
            } else {
                button.classList.add('active');
                // Set tooltip based on current sort mode
                switch (this.sortMode) {
                    case 'alphabetical-asc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.aToZ')}`);
                        break;
                    case 'alphabetical-desc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.zToA')}`);
                        break;
                    case 'priority':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.priority')}`);
                        break;
                    case 'date-asc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.dateEarliestFirst')}`);
                        break;
                    case 'date-desc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.dateLatestFirst')}`);
                        break;
                    case 'note-title-asc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.noteTitleAsc')}`);
                        break;
                    case 'note-title-desc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.noteTitleDesc')}`);
                        break;
                    case 'note-created-desc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.noteCreatedNewest')}`);
                        break;
                    case 'note-created-asc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.noteCreatedOldest')}`);
                        break;
                    case 'created-desc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.createdNewest')}`);
                        break;
                    case 'created-asc':
                        setTooltip(button, `${t('toolbar.sort')}: ${t('sorting.createdOldest')}`);
                        break;
                    default:
                        setTooltip(button, t('toolbar.sort'));
                }
            }
        }
    }

    private saveSortModeToSettings() {
        // Save to per-tab settings
        this.saveCurrentTabSettings();
        // Also save to legacy settings for backwards compatibility
        this.plugin.settings.sortMode = this.sortMode;
    }

    private createHighlightItem(container: HTMLElement, highlight: Highlight, searchTerm?: string, showFilename: boolean = false) {
        // Extract text search terms from current tokens for highlighting
        const textSearchTerms = this.currentSearchTokens
            .filter(token => token.type === 'text' && !token.exclude)
            .map(token => token.value)
            .join(' ');
        const effectiveSearchTerm = textSearchTerms || searchTerm;
        const options: HighlightRenderOptions = {
            searchTerm: effectiveSearchTerm,
            showFilename: this.plugin.settings.showFilenames && showFilename,
            showTimestamp: this.plugin.settings.showTimestamps,
            showHighlightActions: this.plugin.settings.showHighlightActions,
            isCommentsVisible: this.getHighlightCommentsVisibility(highlight),
            dateFormat: this.plugin.settings.dateFormat,
            onCommentToggle: (highlightId) => {
                const currentVisibility = this.highlightCommentsVisible.get(highlightId) || false;
                this.highlightCommentsVisible.set(highlightId, !currentVisibility);
                this.rerenderCurrentView();
            },
            onCollectionsMenu: (event, highlight) => {
                this.showCollectionsMenu(event, highlight);
            },
            onColorChange: (highlight, color) => this.applyColorChange(highlight, color),
            onHighlightClick: (highlight, event) => {
                // Check if CMD/CTRL key is held for multi-select
                if (event && (event.metaKey || event.ctrlKey)) {
                    // Toggle selection
                    if (this.selectedHighlightIds.has(highlight.id)) {
                        this.selectedHighlightIds.delete(highlight.id);
                    } else {
                        this.selectedHighlightIds.add(highlight.id);
                    }
                    // Update visual selection state
                    this.updateHighlightSelectionVisual(highlight.id);
                    // Update Actions button visibility
                    this.updateActionsButtonVisibility();
                } else {
                    // Normal click - focus in editor
                    void this.focusHighlightInEditor(highlight, event);
                }
            },
            onAddComment: async (highlight) => {
                
                // Set flag to preserve pagination when adding comments
                this.isPreservingPagination = true;
                
                // First focus the highlight in editor and wait for file switch to complete
                await this.focusHighlightInEditor(highlight);
                // Then add the footnote with targeted update
                void this.addFootnoteToHighlightWithTargetedUpdate(highlight);
            },
            onCommentClick: (highlight, commentIndex, event) => {
                // Find the original index in highlight.footnoteContents
                let originalIndex = -1;
                let validIndexCounter = 0;
                for(let i = 0; i < (highlight.footnoteContents?.length || 0); i++) {
                    if (highlight.footnoteContents![i].trim() !== '') {
                        if (validIndexCounter === commentIndex) {
                            originalIndex = i;
                            break;
                        }
                        validIndexCounter++;
                    }
                }
                if (originalIndex !== -1) {
                    void this.focusFootnoteInEditor(highlight, originalIndex, event);
                }
            },
            onTagClick: (tag) => {
                if (this.selectedTags.has(tag)) {
                    this.selectedTags.delete(tag);
                } else {
                    this.selectedTags.add(tag);
                }
                this.saveCurrentTabSettings(); // Save filter state
                this.renderFilteredList();
                this.showTagActive();
            },
            onFileNameClick: (filePath, event) => {
                // Set flag to preserve pagination when clicking filenames
                this.isPreservingPagination = true;
                this.openNoteReusingLeaf(filePath, event);
            },
            onContextMenu: (highlight, event) => {
                this.showHighlightContextMenu(highlight, event);
            }
        };

        return this.highlightRenderer.createHighlightItem(container, highlight, options);
    }

    /**
     * Right-click context menu for a highlight item in the sidebar.
     * Offers: remove highlight, remove comments, remove both.
     */
    private applyColorChange(highlight: Highlight, color: string) {
        // Store current scroll position and set flag to prevent other scroll restorations
        this.preservedScrollTop = this.contentAreaEl.scrollTop;
        this.isColorChanging = true;
        
        // Safety timeout to clear flag in case something goes wrong
        window.setTimeout(() => {
            this.isColorChanging = false;
        }, 2000);
        
        this.changeHighlightColor(highlight, color);
        this.rerenderCurrentView();
        
        // Restore scroll position after DOM rebuild and clear flag
        window.requestAnimationFrame(() => {
            if (this.contentAreaEl && this.isColorChanging) {
                this.contentAreaEl.scrollTop = this.preservedScrollTop;
                this.isColorChanging = false;
                
                // Ensure the selected highlight styling is correct after color group change
                if (this.plugin.selectedHighlightId) {
                    const selectedEl = this.containerEl.querySelector(`[data-highlight-id="${this.plugin.selectedHighlightId}"]`) as HTMLElement;
                    if (selectedEl) {
                        // Find the highlight data to get the updated color
                        const selectedHighlight = this.getHighlightById(this.plugin.selectedHighlightId);
                        if (selectedHighlight) {
                            const highlightColor = selectedHighlight.color || this.plugin.settings.highlightColor;
                            selectedEl.style.borderLeftColor = highlightColor;
                            if (!selectedHighlight.isNativeComment) {
                                selectedEl.style.boxShadow = `0 0 0 1.5px ${highlightColor}, var(--shadow-s)`;
                            }
                        }
                    }
                }
            }
        });
    }

    private showHighlightContextMenu(highlight: Highlight, event: MouseEvent) {
        const menu = new Menu();

        // A phone has no hover to reveal the colour picker, so the colours live
        // in this menu there, reached with a press and hold.
        if (Platform.isMobile && highlight.type !== 'html' && !noteColorName(highlight.color)) {
            const current = resolveHighlightColor(highlight.color, this.plugin.settings.highlightColor);
            for (const [slot, hex] of Object.entries(this.plugin.settings.customColors)) {
                // A swatch of the colour itself, registered fresh each time so it
                // follows any change in Settings.
                addIcon(`sh-swatch-${slot}`, `<circle cx="50" cy="50" r="34" fill="${hex}"/>`);
                menu.addItem((item) => item
                    .setTitle(colorLabel(hex, this.plugin.settings))
                    .setIcon(`sh-swatch-${slot}`)
                    .setChecked(resolveHighlightColor(hex, hex) === current)
                    .setSection('color')
                    .onClick(() => this.applyColorChange(highlight, hex)));
            }
        }

        const hasComments = !highlight.isNativeComment
            && !!highlight.footnoteContents
            && highlight.footnoteContents.length > 0;

        // When the setting is on, removing a highlight takes its comments with it.
        // The label changes to match, so the menu never understates what it deletes.
        const removeTakesComments = this.plugin.settings.removeCommentsWithHighlight;

        menu.addItem((item) => {
            item
                .setTitle(removeTakesComments && hasComments
                    ? t('contextMenu.removeHighlightAndComments')
                    : t('contextMenu.removeHighlight'))
                .setIcon('eraser')
                .onClick(async () => {
                    const ok = await this.plugin.removeHighlightFromSource(
                        highlight,
                        removeTakesComments ? 'remove-both' : 'remove-highlight'
                    );
                    if (ok) {
                        new Notice(removeTakesComments && hasComments
                            ? t('notices.highlightAndCommentsRemoved')
                            : t('notices.highlightRemoved'));
                    }
                });
        });

        menu.addItem((item) => {
            item
                .setTitle(t('contextMenu.removeComments'))
                .setIcon('message-square-off')
                .setDisabled(!hasComments)
                .onClick(async () => {
                    const ok = await this.plugin.removeHighlightFromSource(highlight, 'remove-comments');
                    if (ok) {
                        new Notice(t('notices.commentsRemoved'));
                    }
                });
        });

        // Redundant once the first item already removes both.
        if (!removeTakesComments) {
            menu.addItem((item) => {
                item
                    .setTitle(t('contextMenu.removeHighlightAndComments'))
                    .setIcon('trash-2')
                    .setDisabled(!hasComments)
                    .onClick(async () => {
                        const ok = await this.plugin.removeHighlightFromSource(highlight, 'remove-both');
                        if (ok) {
                            new Notice(t('notices.highlightAndCommentsRemoved'));
                        }
                    });
            });
        }

        menu.showAtMouseEvent(event);
    }

    private rerenderCurrentView(): void {
        if (this.viewMode === 'collections' && this.currentCollectionId) {
            this.renderCollectionDetailView(this.currentCollectionId);
        } else {
            this.renderFilteredList();
        }
    }


    private async addFootnoteToHighlightWithTargetedUpdate(highlight: Highlight) {
        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const editor = activeView.editor;
        const file = activeView.file;
        if (!file) return;

        // Find the highlight in the editor content
        const content = editor.getValue();
        let insertPos: { line: number; ch: number } | null = null;

        // For multi-paragraph highlights, we need to search the full content, not line-by-line
        if (highlight.type === 'custom' && highlight.fullMatch) {
            // Custom pattern highlight - use the full match text to find it
            const escapedText = this.escapeRegex(highlight.fullMatch);
            const customPatternRegex = new RegExp(escapedText, 'g');

            let bestMatch: { index: number, length: number } | null = null;
            let minDistance = Infinity;
            let match;

            while ((match = customPatternRegex.exec(content)) !== null) {
                const distance = Math.abs(match.index - highlight.startOffset);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = { index: match.index, length: match[0].length };
                }
            }

            if (bestMatch) {
                const highlightEndOffset = bestMatch.index + bestMatch.length;
                const highlightEndPos = editor.offsetToPos(highlightEndOffset);

                // Get the line at the end position
                const line = editor.getLine(highlightEndPos.line);
                const afterHighlight = line.substring(highlightEndPos.ch);
                const footnoteEndMatch = afterHighlight.match(/^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\]))*/);
                let footnoteEndLength = footnoteEndMatch ? footnoteEndMatch[0].length : 0;

                // If there are footnotes and content continues after them, don't include trailing whitespace
                if (footnoteEndLength > 0 && afterHighlight.length > footnoteEndLength) {
                    const afterFootnotes = afterHighlight.substring(footnoteEndLength);
                    if (afterFootnotes.match(/^\S/)) {
                        // footnoteEndLength is already correct
                    } else {
                        const whitespaceMatch = afterFootnotes.match(/^(\s+)/);
                        if (whitespaceMatch) {
                            const afterWhitespace = afterFootnotes.substring(whitespaceMatch[0].length);
                            if (afterWhitespace.length === 0) {
                                footnoteEndLength += whitespaceMatch[0].length;
                            }
                        }
                    }
                } else if (footnoteEndLength > 0) {
                    const trailingWhitespaceMatch = afterHighlight.substring(footnoteEndLength).match(/^\s+/);
                    if (trailingWhitespaceMatch) {
                        footnoteEndLength += trailingWhitespaceMatch[0].length;
                    }
                }

                insertPos = { line: highlightEndPos.line, ch: highlightEndPos.ch + footnoteEndLength };
            }
        } else if (highlight.isNativeComment) {
            // Use regex to find the highlight in the full content
            const escapedText = this.escapeRegex(highlight.text);
            const nativeCommentPattern = `%%${escapedText}%%`;
            const nativeCommentRegex = new RegExp(nativeCommentPattern, 'g');

            let bestMatch: { index: number, length: number } | null = null;
            let minDistance = Infinity;
            let match;

            while ((match = nativeCommentRegex.exec(content)) !== null) {
                const distance = Math.abs(match.index - highlight.startOffset);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = { index: match.index, length: match[0].length };
                }
            }

            if (bestMatch) {
                const highlightEndOffset = bestMatch.index + bestMatch.length;
                const highlightEndPos = editor.offsetToPos(highlightEndOffset);

                // Get the line at the end position
                const line = editor.getLine(highlightEndPos.line);
                const afterHighlight = line.substring(highlightEndPos.ch);
                const footnoteEndMatch = afterHighlight.match(/^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\]))*/);
                let footnoteEndLength = footnoteEndMatch ? footnoteEndMatch[0].length : 0;

                // If there are footnotes and content continues after them, don't include trailing whitespace
                if (footnoteEndLength > 0 && afterHighlight.length > footnoteEndLength) {
                    const afterFootnotes = afterHighlight.substring(footnoteEndLength);
                    if (afterFootnotes.match(/^\S/)) {
                        // footnoteEndLength is already correct
                    } else {
                        const whitespaceMatch = afterFootnotes.match(/^(\s+)/);
                        if (whitespaceMatch) {
                            const afterWhitespace = afterFootnotes.substring(whitespaceMatch[0].length);
                            if (afterWhitespace.length === 0) {
                                footnoteEndLength += whitespaceMatch[0].length;
                            }
                        }
                    }
                } else if (footnoteEndLength > 0) {
                    const trailingWhitespaceMatch = afterHighlight.substring(footnoteEndLength).match(/^\s+/);
                    if (trailingWhitespaceMatch) {
                        footnoteEndLength += trailingWhitespaceMatch[0].length;
                    }
                }

                insertPos = { line: highlightEndPos.line, ch: highlightEndPos.ch + footnoteEndLength };
            }
        } else if (this.isHtmlHighlight(highlight)) {
            // HTML highlight handling
            const codeBlockRanges = this.plugin.getCodeBlockRanges(content);
            const htmlHighlight = HtmlHighlightParser.findHighlightAtOffset(
                content,
                highlight.text,
                highlight.startOffset,
                codeBlockRanges
            );

            if (htmlHighlight) {
                const highlightEndOffset = htmlHighlight.endOffset;
                const highlightEndPos = editor.offsetToPos(highlightEndOffset);

                // Get the line at the end position
                const line = editor.getLine(highlightEndPos.line);
                const afterHighlight = line.substring(highlightEndPos.ch);
                const footnoteEndMatch = afterHighlight.match(/^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\]))*/);
                let footnoteEndLength = footnoteEndMatch ? footnoteEndMatch[0].length : 0;

                // If there are footnotes and content continues after them, don't include trailing whitespace
                if (footnoteEndLength > 0 && afterHighlight.length > footnoteEndLength) {
                    const afterFootnotes = afterHighlight.substring(footnoteEndLength);
                    if (afterFootnotes.match(/^\S/)) {
                        // footnoteEndLength is already correct
                    } else {
                        const whitespaceMatch = afterFootnotes.match(/^(\s+)/);
                        if (whitespaceMatch) {
                            const afterWhitespace = afterFootnotes.substring(whitespaceMatch[0].length);
                            if (afterWhitespace.length === 0) {
                                footnoteEndLength += whitespaceMatch[0].length;
                            }
                        }
                    }
                } else if (footnoteEndLength > 0) {
                    const trailingWhitespaceMatch = afterHighlight.substring(footnoteEndLength).match(/^\s+/);
                    if (trailingWhitespaceMatch) {
                        footnoteEndLength += trailingWhitespaceMatch[0].length;
                    }
                }

                insertPos = { line: highlightEndPos.line, ch: highlightEndPos.ch + footnoteEndLength };
            }
        } else {
            // Regular markdown highlight - use regex to find in full content
            const escapedText = this.escapeRegex(highlight.text);
            const markdownHighlightPattern = `==${escapedText}==`;
            const markdownHighlightRegex = new RegExp(markdownHighlightPattern, 'g');

            let bestMatch: { index: number, length: number } | null = null;
            let minDistance = Infinity;
            let match;

            while ((match = markdownHighlightRegex.exec(content)) !== null) {
                const distance = Math.abs(match.index - highlight.startOffset);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = { index: match.index, length: match[0].length };
                }
            }

            if (bestMatch) {
                const highlightEndOffset = bestMatch.index + bestMatch.length;
                const highlightEndPos = editor.offsetToPos(highlightEndOffset);

                // Get the line at the end position
                const line = editor.getLine(highlightEndPos.line);
                const afterHighlight = line.substring(highlightEndPos.ch);
                const footnoteEndMatch = afterHighlight.match(/^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\]))*/);
                let footnoteEndLength = footnoteEndMatch ? footnoteEndMatch[0].length : 0;

                // If there are footnotes and content continues after them, don't include trailing whitespace
                if (footnoteEndLength > 0 && afterHighlight.length > footnoteEndLength) {
                    const afterFootnotes = afterHighlight.substring(footnoteEndLength);
                    if (afterFootnotes.match(/^\S/)) {
                        // footnoteEndLength is already correct
                    } else {
                        const whitespaceMatch = afterFootnotes.match(/^(\s+)/);
                        if (whitespaceMatch) {
                            const afterWhitespace = afterFootnotes.substring(whitespaceMatch[0].length);
                            if (afterWhitespace.length === 0) {
                                footnoteEndLength += whitespaceMatch[0].length;
                            }
                        }
                    }
                } else if (footnoteEndLength > 0) {
                    const trailingWhitespaceMatch = afterHighlight.substring(footnoteEndLength).match(/^\s+/);
                    if (trailingWhitespaceMatch) {
                        footnoteEndLength += trailingWhitespaceMatch[0].length;
                    }
                }

                insertPos = { line: highlightEndPos.line, ch: highlightEndPos.ch + footnoteEndLength };
            }
        }

        if (!insertPos) {
            new Notice('Could not find the highlight in the editor. It might have been modified.');
            return;
        }

        // Add the footnote
        if (this.plugin.settings.useInlineFootnotes) {
            // Use inline footnote
            const result = this.plugin.inlineFootnoteManager.insertInlineFootnote(editor, highlight, '');
            if (result.success && result.insertPos) {
                // Position cursor inside the brackets after a delay for editor to process
                window.setTimeout(() => {
                    if (result.contentLength > 0) {
                        // Select the footnote content for easy editing
                        const contentStartCh = result.insertPos!.ch + 2; // After "^["
                        const contentEndCh = contentStartCh + result.contentLength;
                        editor.setSelection(
                            { line: result.insertPos!.line, ch: contentStartCh },
                            { line: result.insertPos!.line, ch: contentEndCh }
                        );
                    } else {
                        // Position cursor between the brackets: ^[|]
                        const cursorPos = {
                            line: result.insertPos!.line,
                            ch: result.insertPos!.ch + 2 // After "^["
                        };
                        editor.setCursor(cursorPos);
                    }
                    editor.focus();
                }, 50);

                // Update highlight data after positioning cursor
                window.setTimeout(() => void (async () => {
                    await this.updateSingleHighlightFromEditor(highlight, file);
                })(), 100);
            } else {
                new Notice('Could not insert inline footnote.');
            }
        } else {
            // Use standard footnote
            // Position cursor at the end of the highlight for the footnote command
            editor.setCursor(insertPos);
            editor.focus();

            (this.plugin.app as App & PrivateCommandsApi).commands.executeCommandById('editor:insert-footnote');
            // Wait for the footnote command to complete
            window.setTimeout(() => void (async () => {
                await this.updateSingleHighlightFromEditor(highlight, file);
            })(), 100);
        }
    }

    private async updateSingleHighlightFromEditor(highlight: Highlight, file: TFile) {
        // Re-parse just this highlight from the current editor content
        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const content = activeView.editor.getValue();
        
        // Extract footnotes
        const footnoteMap = this.plugin.extractFootnotes(content);
        
        // Find the updated highlight in content
        const updatedHighlight = this.findAndParseHighlight(content, highlight, footnoteMap);
        
        if (updatedHighlight) {
            // Update in memory storage
            const fileHighlights = this.plugin.highlights.get(file.path) || [];
            const index = fileHighlights.findIndex(h => h.id === highlight.id);
            if (index !== -1) {
                fileHighlights[index] = updatedHighlight;
                this.plugin.highlights.set(file.path, fileHighlights);
                await this.plugin.saveSettings();
                
                // Update just this item in the sidebar
                this.updateItem(highlight.id);
            }
        }
    }

    private findAndParseHighlight(content: string, originalHighlight: Highlight, footnoteMap: Map<string, string>): Highlight | null {
        // This is a simplified version - we're looking for the same highlight text and updating its footnotes
        const regex = originalHighlight.isNativeComment ? 
            new RegExp(`%%${this.escapeRegex(originalHighlight.text)}%%`, 'g') :
            new RegExp(`==${this.escapeRegex(originalHighlight.text)}==`, 'g');
        
        let match;
        while ((match = regex.exec(content)) !== null) {
            // Check if this is likely the same highlight (same position roughly)
            if (Math.abs(match.index - originalHighlight.startOffset) < 100) { // Within 100 characters
                // Parse footnotes for this highlight using same logic as main parsing
                const afterHighlight = content.slice(match.index + match[0].length);
                
                // Find all footnotes (both standard and inline) in order
                const allFootnotes: Array<{type: 'standard' | 'inline', index: number, content: string}> = [];
                
                // First, get all inline footnotes with their positions
                const inlineFootnotes = this.plugin.inlineFootnoteManager.extractInlineFootnotes(content, match.index + match[0].length);
                inlineFootnotes.forEach(footnote => {
                    if (footnote.content.trim()) {
                        allFootnotes.push({
                            type: 'inline',
                            index: footnote.startIndex,
                            content: footnote.content.trim()
                        });
                    }
                });
                
                // Then, get all standard footnotes with their positions (using same validation logic)
                const standardFootnoteRegex = new RegExp(STANDARD_FOOTNOTE_REGEX);
                let stdMatch;
                let lastValidPosition = 0;

                while ((stdMatch = standardFootnoteRegex.exec(afterHighlight)) !== null) {
                    // Check if this standard footnote is in a valid position
                    const precedingText = afterHighlight.substring(lastValidPosition, stdMatch.index);
                    const isValid = FOOTNOTE_VALIDATION_REGEX.test(precedingText);
                    
                    if (stdMatch.index === lastValidPosition || isValid) {
                        const key = stdMatch[2]; // The key inside [^key]
                        if (footnoteMap.has(key)) {
                            const fnContent = footnoteMap.get(key)!.trim();
                            if (fnContent) { // Only add non-empty content
                                allFootnotes.push({
                                    type: 'standard',
                                    index: match.index + match[0].length + stdMatch.index,
                                    content: fnContent
                                });
                            }
                        }
                        lastValidPosition = stdMatch.index + stdMatch[0].length;
                    } else {
                        // Stop if we encounter a footnote that's not in the valid sequence
                        break;
                    }
                }
                
                // Check for adjacent comment after the highlight and its footnotes
                // Calculate where footnotes end
                const highlightEnd = match.index + match[0].length;
                const afterHighlightFull = content.substring(highlightEnd);
                const footnoteLength = InlineFootnoteManager.calculateFootnoteLength(afterHighlightFull);
                const afterFootnotes = afterHighlightFull.substring(footnoteLength);

                // Only check for adjacent comments if there are no blank lines
                // A blank line (two or more newlines with optional whitespace between) breaks adjacency
                const hasBlankLine = /\n\s*\n/.test(afterFootnotes);

                // Check for adjacent native comment (%% %%) only if no blank lines
                if (!hasBlankLine) {
                    const nativeCommentMatch = afterFootnotes.match(/^\s*(%%([^%](?:[^%]|%[^%])*?)%%)/);
                    if (nativeCommentMatch) {
                        const commentText = nativeCommentMatch[2];
                        const commentPosition = highlightEnd + footnoteLength + nativeCommentMatch.index!;
                        if (commentText.trim()) {
                            allFootnotes.push({
                                type: 'inline',
                                index: commentPosition,
                                content: commentText.trim()
                            });
                        }
                    }

                    // Check for adjacent HTML comment (<!-- -->)
                    if (this.plugin.settings.detectHtmlComments) {
                        const htmlCommentMatch = afterFootnotes.match(/^\s*(<!--([^]*?)-->)/);
                        if (htmlCommentMatch) {
                            const commentText = htmlCommentMatch[2];
                            const commentPosition = highlightEnd + footnoteLength + htmlCommentMatch.index!;
                            if (commentText.trim()) {
                                allFootnotes.push({
                                    type: 'inline',
                                    index: commentPosition,
                                    content: commentText.trim()
                                });
                            }
                        }
                    }

                    // Check for adjacent custom pattern comments
                    for (const customPattern of this.plugin.settings.customPatterns) {
                        if (customPattern.type === 'comment') {
                            try {
                                const customRegex = new RegExp('^\\s*(' + customPattern.pattern + ')');
                                const customMatch = afterFootnotes.match(customRegex);
                                if (customMatch && customMatch[2]) { // customMatch[2] should be the captured group
                                    const commentText = customMatch[2];
                                    const commentPosition = highlightEnd + footnoteLength + customMatch.index!;
                                    if (commentText.trim()) {
                                        allFootnotes.push({
                                            type: 'inline',
                                            index: commentPosition,
                                            content: commentText.trim()
                                        });
                                    }
                                }
                            } catch {
                                // Skip invalid custom patterns
                            }
                        }
                    }
                }

                // Sort footnotes by their position in the text
                allFootnotes.sort((a, b) => a.index - b.index);

                // Extract content in the correct order
                const footnoteContents = allFootnotes.map(f => f.content);
                const footnoteCount = footnoteContents.length;

                // Return updated highlight
                return {
                    ...originalHighlight,
                    footnoteCount,
                    footnoteContents,
                    startOffset: match.index,
                    endOffset: match.index + match[0].length
                };
            }
        }
        
        return null;
    }

    async focusHighlightInEditor(highlight: Highlight, event?: MouseEvent) {

        // Set flag to preserve pagination when clicking highlights (especially from other pages)
        this.isPreservingPagination = true;

        // The user explicitly clicked this highlight — suppress follow-editor-scroll
        // sync for the pause window so the resulting editor scroll doesn't snap
        // selection back to a different "closer to middle" highlight (especially
        // near the top/bottom of the file where the click target can't be centered).
        if (this.followEditorScroll) {
            this.lastManualSidebarScrollAt = Date.now();
            // Treat this highlight as the current follow-scroll anchor so a later
            // resumed sync doesn't immediately clear its visual selection.
            this.followScrollSelectedId = highlight.id;
        }

        // Always clear ALL existing selections first to prevent multiple selections
        const allSelectedElements = this.containerEl.querySelectorAll('.selected, .highlight-selected');
        allSelectedElements.forEach(el => {
            el.classList.remove('selected', 'highlight-selected');
            // Clear any inline styles that might have been applied
            (el as HTMLElement).style.removeProperty('border-left-color');
            (el as HTMLElement).style.removeProperty('box-shadow');
        });
        
        // Update selection state
        this.plugin.selectedHighlightId = highlight.id;
        
        const newEl = this.containerEl.querySelector(`[data-highlight-id="${highlight.id}"]`) as HTMLElement;
        if (newEl) {
            newEl.classList.add('selected');
            // Find the highlight in the correct file (not just current file)
            const fileHighlights = this.plugin.highlights.get(highlight.filePath);
            const newHighlight = fileHighlights?.find(h => h.id === highlight.id);
            if (newHighlight) {
                newEl.classList.add('highlight-selected');
                
                // Update border color and box-shadow to reflect current color
                const highlightColor = newHighlight.color || this.plugin.settings.highlightColor;
                newEl.style.borderLeftColor = highlightColor;
                if (!newHighlight.isNativeComment) {
                    newEl.style.boxShadow = `0 0 0 1.5px ${highlightColor}, var(--shadow-s)`;
                }
            }
        }
        
        // Prevent multiple simultaneous highlight focusing operations for file operations
        if (this.isHighlightFocusing) {
            return;
        }
        
        // Store current scroll position and set flag to prevent other scroll restorations
        this.preservedScrollTop = this.contentAreaEl.scrollTop;
        this.isHighlightFocusing = true;
        
        // Safety timeout to clear flag in case something goes wrong
        window.setTimeout(() => {
            this.isHighlightFocusing = false;
        }, 2000);
        
        // Reuses a view already showing this file, including one in a sidebar.
        let targetView: MarkdownView | null = this.findOpenMarkdownView(highlight.filePath, true);

        if (!targetView) {
            const fileToOpen = this.plugin.app.vault.getAbstractFileByPath(highlight.filePath);
            if (fileToOpen instanceof TFile) {
                await this.plugin.app.workspace.openLinkText(highlight.filePath, highlight.filePath, event ? Keymap.isModEvent(event) : false);
                
                // Wait for the file to be properly opened and active
                return new Promise<void>((resolve) => {
                    const checkAndFocus = () => {
                        const newActiveView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                        if (newActiveView && newActiveView.file?.path === highlight.filePath) {
                            this.performHighlightFocus(newActiveView, highlight);
                            resolve(); // Resolve the promise when file is ready
                        } else {
                            // Retry if file isn't ready yet
                            window.setTimeout(checkAndFocus, 50);
                        }
                    };
                    window.setTimeout(checkAndFocus, 100);
                });
            }
        }

        if (targetView) {
            const view = targetView;
            // Use requestAnimationFrame for smoother focus
            window.requestAnimationFrame(() => {
                this.performHighlightFocus(view, highlight);
            });
        }
    }

    private isHtmlHighlight(highlight: Highlight): boolean {
        // HTML highlights are identified by their type property
        return highlight.type === 'html';
    }

    private performHighlightFocus(targetView: MarkdownView, highlight: Highlight) {
        if (!targetView || !targetView.editor) {
            return;
        }

        // Selection is now handled in focusHighlightInEditor, so we just handle the editor focus

        // Only restore scroll position if we haven't already done it in refresh()
        // (refresh() handles scroll restoration during file switches)
        const needsScrollRestore = this.contentAreaEl.scrollTop !== this.preservedScrollTop;
        
        if (needsScrollRestore) {
            // Use requestAnimationFrame to restore scroll position after any potential DOM updates
            window.requestAnimationFrame(() => {
                this.contentAreaEl.scrollTop = this.preservedScrollTop;
                // Clear the flag after restoration is complete
                this.isHighlightFocusing = false;
            });
        } else {
            // Scroll position already correct (handled by refresh), just clear the flag
            this.isHighlightFocusing = false;
        }

        const content = targetView.editor.getValue();

        let matches: { index: number, length: number, tagStartLength: number, tagEndLength: number }[] = [];

        if (highlight.type === 'custom' && highlight.fullMatch) {
            // Custom pattern highlight - use the full match directly
            const regexPattern = this.escapeRegex(highlight.fullMatch);
            const regex = new RegExp(regexPattern, 'g');
            let matchResult;
            while ((matchResult = regex.exec(content)) !== null) {
                const fullMatch = matchResult[0];
                const textStart = fullMatch.indexOf(highlight.text);
                matches.push({
                    index: matchResult.index,
                    length: fullMatch.length,
                    tagStartLength: textStart >= 0 ? textStart : 0,
                    tagEndLength: textStart >= 0 ? fullMatch.length - textStart - highlight.text.length : 0
                });
            }
        } else if (highlight.isNativeComment) {
            // Try HTML comment pattern first
            let htmlCommentPattern = `<!--\\s*${this.escapeRegex(highlight.text)}\\s*-->`;
            let htmlCommentRegex = new RegExp(htmlCommentPattern, 'g');
            let matchResult;

            while ((matchResult = htmlCommentRegex.exec(content)) !== null) {
                const fullMatch = matchResult[0];
                const textStart = fullMatch.indexOf(highlight.text);
                matches.push({
                    index: matchResult.index,
                    length: fullMatch.length,
                    tagStartLength: textStart, // <!-- and whitespace
                    tagEndLength: fullMatch.length - textStart - highlight.text.length // whitespace and -->
                });
            }

            // If no HTML comment matches, try native comment pattern
            if (matches.length === 0) {
                const regexPattern = `%%${this.escapeRegex(highlight.text)}%%`;
                const regex = new RegExp(regexPattern, 'g');
                while ((matchResult = regex.exec(content)) !== null) {
                    matches.push({
                        index: matchResult.index,
                        length: matchResult[0].length,
                        tagStartLength: 2, // %%
                        tagEndLength: 2    // %%
                    });
                }
            }

            // If still no matches, try custom comment patterns
            if (matches.length === 0) {
                for (const customPattern of this.plugin.settings.customPatterns) {
                    if (customPattern.type !== 'comment') continue;

                    try {
                        const customRegex = new RegExp(customPattern.pattern, 'g');
                        while ((matchResult = customRegex.exec(content)) !== null) {
                            const fullMatch = matchResult[0];
                            const capturedText = matchResult[1] || '';
                            if (capturedText === highlight.text) {
                                const textStart = fullMatch.indexOf(capturedText);
                                matches.push({
                                    index: matchResult.index,
                                    length: fullMatch.length,
                                    tagStartLength: textStart,
                                    tagEndLength: fullMatch.length - textStart - capturedText.length
                                });
                            }
                        }
                    } catch (e) {
                        console.error(`Error matching custom pattern "${customPattern.name}":`, e);
                    }

                    // If we found matches with this pattern, stop looking
                    if (matches.length > 0) break;
                }
            }
        } else if (this.isHtmlHighlight(highlight)) {
            // Use HTML parser to find highlights
            const codeBlockRanges = this.plugin.getCodeBlockRanges(content);
            const htmlHighlight = HtmlHighlightParser.findHighlightAtOffset(
                content,
                highlight.text,
                highlight.startOffset,
                codeBlockRanges
            );

            if (htmlHighlight) {
                const fullMatch = htmlHighlight.fullMatch;
                const textStartIndex = fullMatch.lastIndexOf(highlight.text);
                const tagStartLength = textStartIndex;
                const tagEndLength = fullMatch.length - textStartIndex - highlight.text.length;

                matches.push({
                    index: htmlHighlight.startOffset,
                    length: htmlHighlight.endOffset - htmlHighlight.startOffset,
                    tagStartLength,
                    tagEndLength
                });
            }
        } else {
            // Regular markdown highlight pattern
            const regexPattern = `==${this.escapeRegex(highlight.text)}==`;
            const regex = new RegExp(regexPattern, 'g');
            let matchResult;
            while ((matchResult = regex.exec(content)) !== null) {
                matches.push({
                    index: matchResult.index,
                    length: matchResult[0].length,
                    tagStartLength: 2, // ==
                    tagEndLength: 2    // ==
                });
            }

            // If no markdown matches found, try custom patterns
            if (matches.length === 0) {
                for (const customPattern of this.plugin.settings.customPatterns) {
                    if (customPattern.type !== 'highlight') continue;

                    try {
                        const customRegex = new RegExp(customPattern.pattern, 'g');
                        while ((matchResult = customRegex.exec(content)) !== null) {
                            const fullMatch = matchResult[0];
                            const capturedText = matchResult[1] || '';
                            if (capturedText === highlight.text) {
                                const textStart = fullMatch.indexOf(capturedText);
                                matches.push({
                                    index: matchResult.index,
                                    length: fullMatch.length,
                                    tagStartLength: textStart,
                                    tagEndLength: fullMatch.length - textStart - capturedText.length
                                });
                            }
                        }
                    } catch (e) {
                        console.error(`Error matching custom pattern "${customPattern.name}":`, e);
                    }

                    // If we found matches with this pattern, stop looking
                    if (matches.length > 0) break;
                }
            }
        }

        if (matches.length === 0) return;

        let targetMatchInfo = matches[0];
        let minDistance = Infinity;
        let foundMatch = false;

        for (const m of matches) {
            const distance = Math.abs(m.index - highlight.startOffset);
            if (distance < minDistance) {
                minDistance = distance;
                targetMatchInfo = m;
                foundMatch = true;
            }
        }
        // A small tolerance for finding the closest match
        if (!foundMatch || minDistance > 50) {
            // Using best guess for highlight position
        }

        const startPos = targetView.editor.offsetToPos(targetMatchInfo.index + targetMatchInfo.tagStartLength);
        const endPos = targetView.editor.offsetToPos(targetMatchInfo.index + targetMatchInfo.length - targetMatchInfo.tagEndLength);

        // Reading View has no visible editor, so the CodeMirror calls below would
        // operate on an offscreen instance and appear to do nothing. offsetToPos
        // still resolves, so scroll the rendered view to the resolved line instead.
        if (targetView.getMode() === 'preview') {
            this.scrollPreviewToLine(targetView, startPos.line);
            return;
        }

        // Set cursor position first
        targetView.editor.setSelection(startPos, endPos);

        // Auto-unfold if setting is enabled
        if (this.plugin.settings.autoToggleFold) {
            try {
                (this.plugin.app as App & PrivateCommandsApi).commands.executeCommandById('editor:toggle-fold');
            } catch (error) {
                console.warn('Failed to execute toggle fold command:', error);
            }
        }

        targetView.editor.scrollIntoView({ from: startPos, to: endPos }, true);
        targetView.editor.focus();
    }

    /**
     * Scroll a Reading View to a line. Uses setEphemeralState — the same mechanism
     * Obsidian uses for internal link navigation — and falls back to the preview
     * view's own scroll if that is unavailable.
     *
     * Scrolling is line-level: Reading View exposes no API for selecting rendered
     * text, so the target is brought into view but not visually marked.
     */
    private scrollPreviewToLine(targetView: MarkdownView, line: number): void {
        try {
            targetView.setEphemeralState({ line });
        } catch (error) {
            console.warn('Failed to scroll preview via ephemeral state:', error);
            try {
                targetView.previewMode?.applyScroll(line);
            } catch (fallbackError) {
                console.warn('Failed to scroll preview:', fallbackError);
            }
        }

        this.centerPreviewScroll(targetView);
    }

    /**
     * Bring the just-scrolled line toward the middle of the Reading View.
     *
     * Both preview scroll APIs (setEphemeralState and applyScroll) are line-based
     * and place the target at the top of the viewport — there is no centred
     * variant to match the editor's scrollIntoView(range, true). The target sits
     * at the top immediately after the scroll, so shifting up by half a viewport
     * centres it. Runs in a frame so it lands after Obsidian's own scroll rather
     * than being overwritten by it, and before paint so there is no visible jump.
     */
    private centerPreviewScroll(targetView: MarkdownView): void {
        window.requestAnimationFrame(() => {
            try {
                const scroller = this.findPreviewScroller(targetView);
                if (!scroller) {
                    return;
                }

                const maxScroll = scroller.scrollHeight - scroller.clientHeight;
                if (maxScroll <= 0) {
                    return; // Content fits; nothing to centre
                }

                // Clamping means targets near either end settle short of centre,
                // which is also how the editor behaves at the edges of a document.
                const centered = scroller.scrollTop - scroller.clientHeight / 2;
                scroller.scrollTop = Math.max(0, Math.min(maxScroll, centered));
            } catch (error) {
                console.warn('Failed to centre preview scroll:', error);
            }
        });
    }

    /** Locate the scrollable element behind a Reading View. */
    private findPreviewScroller(targetView: MarkdownView): HTMLElement | null {
        const root = targetView.previewMode?.containerEl ?? targetView.containerEl;
        if (!root) {
            return null;
        }

        const isScrollable = (el: HTMLElement | null): boolean =>
            !!el && el.scrollHeight > el.clientHeight;

        if (isScrollable(root)) {
            return root;
        }

        // Obsidian nests the scroller inside the reading view container; the exact
        // depth has changed across versions, so probe rather than assume.
        for (const selector of ['.markdown-preview-view', '.markdown-reading-view']) {
            const candidate = root.querySelector(selector);
            if (candidate instanceof HTMLElement && isScrollable(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    focusHighlight(highlightId: string) {
        const item = this.containerEl.querySelector(`[data-highlight-id="${highlightId}"]`) as HTMLElement;
        if (item) {
            // Item found but no action needed to preserve manual scroll position
        }
    }

    private escapeRegex(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private async focusFootnoteInEditor(highlight: Highlight, footnoteIndex: number, event?: MouseEvent) {
        // First, ensure the correct file is open
        // Reuses a view already showing this file, including one in a sidebar.
        let targetView: MarkdownView | null = this.findOpenMarkdownView(highlight.filePath, true);

        if (!targetView) {
            const fileToOpen = this.plugin.app.vault.getAbstractFileByPath(highlight.filePath);
            if (fileToOpen instanceof TFile) {
                await this.plugin.app.workspace.openLinkText(highlight.filePath, highlight.filePath, event ? Keymap.isModEvent(event) : false);
                // Wait for file to open and retry
                window.setTimeout(() => void this.focusFootnoteInEditor(highlight, footnoteIndex, event), 200);
                return;
            }
        }

        window.setTimeout(() => {
            const currentView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!currentView || !currentView.editor) {
                new Notice('Could not access the editor.');
                return;
            }

            const editor = currentView.editor;
            const content = editor.getValue();
            
            // Find the highlight in the content
            const escapedText = this.escapeRegex(highlight.text);
            let bestMatch: { index: number, length: number } | null = null;
            let minDistance = Infinity;

            if (highlight.type === 'custom' && highlight.fullMatch) {
                // Custom pattern - use the full match text
                const regexPattern = this.escapeRegex(highlight.fullMatch);
                const highlightRegex = new RegExp(regexPattern, 'g');
                let match;
                while ((match = highlightRegex.exec(content)) !== null) {
                    const distance = Math.abs(match.index - highlight.startOffset);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestMatch = { index: match.index, length: match[0].length };
                    }
                }
            } else if (highlight.isNativeComment) {
                // Native comment pattern
                const regexPattern = `%%${escapedText}%%`;
                const highlightRegex = new RegExp(regexPattern, 'g');
                let match;
                while ((match = highlightRegex.exec(content)) !== null) {
                    const distance = Math.abs(match.index - highlight.startOffset);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestMatch = { index: match.index, length: match[0].length };
                    }
                }
            } else if (this.isHtmlHighlight(highlight)) {
                // Use HTML parser for distance-based matching
                const codeBlockRanges = this.plugin.getCodeBlockRanges(content);
                const htmlHighlight = HtmlHighlightParser.findHighlightAtOffset(
                    content,
                    highlight.text,
                    highlight.startOffset,
                    codeBlockRanges
                );

                if (htmlHighlight) {
                    bestMatch = {
                        index: htmlHighlight.startOffset,
                        length: htmlHighlight.endOffset - htmlHighlight.startOffset
                    };
                    minDistance = 0; // Found exact match
                }
            } else {
                // Regular markdown highlight pattern
                const regexPattern = `==${escapedText}==`;
                const highlightRegex = new RegExp(regexPattern, 'g');
                let match;
                while ((match = highlightRegex.exec(content)) !== null) {
                    const distance = Math.abs(match.index - highlight.startOffset);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestMatch = { index: match.index, length: match[0].length };
                    }
                }
            }

            if (!bestMatch) {
                new Notice('Could not find the highlight in the editor.');
                return;
            }

            // Reading View has no visible editor, so every positioning branch below
            // would scroll an offscreen CodeMirror. Scroll the rendered view to the
            // highlight's line instead — footnote-level precision needs an editor.
            if (currentView.getMode() === 'preview') {
                this.scrollPreviewToLine(currentView, editor.offsetToPos(bestMatch.index).line);
                return;
            }

            // Find footnotes after the highlight using inline footnote manager
            const inlineFootnoteManager = new InlineFootnoteManager();
            const afterHighlight = content.substring(bestMatch.index + bestMatch.length);
            
            // Get all footnotes (both standard and inline) in order
            const allFootnotes: Array<{type: 'standard' | 'inline', content: string, startIndex: number, endIndex: number}> = [];
            
            // Get inline footnotes
            const inlineFootnotes = inlineFootnoteManager.extractInlineFootnotes(content, bestMatch.index + bestMatch.length);
            inlineFootnotes.forEach(footnote => {
                allFootnotes.push({
                    type: 'inline',
                    content: footnote.content,
                    startIndex: footnote.startIndex,
                    endIndex: footnote.endIndex
                });
            });

            // Get adjacent HTML comments (stored as plain text in footnoteContents)
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            let htmlMatch;
            while ((htmlMatch = htmlCommentRegex.exec(afterHighlight)) !== null) {
                // Adjacent comments are stored with trimmed content
                const trimmedContent = htmlMatch[1].trim();
                allFootnotes.push({
                    type: 'inline',
                    content: trimmedContent,
                    startIndex: bestMatch.index + bestMatch.length + htmlMatch.index,
                    endIndex: bestMatch.index + bestMatch.length + htmlMatch.index + htmlMatch[0].length
                });
            }

            // Get adjacent native comments (stored as plain text in footnoteContents)
            const nativeCommentRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;
            let nativeMatch;
            while ((nativeMatch = nativeCommentRegex.exec(afterHighlight)) !== null) {
                // Adjacent comments are stored with trimmed content
                const trimmedContent = nativeMatch[1].trim();
                allFootnotes.push({
                    type: 'inline',
                    content: trimmedContent,
                    startIndex: bestMatch.index + bestMatch.length + nativeMatch.index,
                    endIndex: bestMatch.index + bestMatch.length + nativeMatch.index + nativeMatch[0].length
                });
            }

            // Get adjacent custom pattern comments (stored as plain text in footnoteContents)
            for (const customPattern of this.plugin.settings.customPatterns) {
                if (customPattern.type === 'comment') {
                    try {
                        const customRegex = new RegExp(customPattern.pattern, 'g');
                        let customMatch;

                        while ((customMatch = customRegex.exec(afterHighlight)) !== null) {
                            // Custom patterns store the first capture group, trimmed
                            const capturedText = customMatch[1];
                            if (capturedText && capturedText.trim()) {
                                allFootnotes.push({
                                    type: 'inline',
                                    content: capturedText.trim(),
                                    startIndex: bestMatch.index + bestMatch.length + customMatch.index,
                                    endIndex: bestMatch.index + bestMatch.length + customMatch.index + customMatch[0].length
                                });
                            }
                        }
                    } catch (e) {
                        // Skip invalid patterns
                        console.error(`Error processing custom pattern "${customPattern.name}":`, e);
                    }
                }
            }

            // Get standard footnotes
            const standardFootnoteRegex = new RegExp(STANDARD_FOOTNOTE_REGEX);
            let match_sf;
            let lastValidPosition = 0;

            while ((match_sf = standardFootnoteRegex.exec(afterHighlight)) !== null) {
                // Check if this standard footnote is in a valid position
                const precedingText = afterHighlight.substring(lastValidPosition, match_sf.index);
                const isValid = FOOTNOTE_VALIDATION_REGEX.test(precedingText);
                
                if (match_sf.index === lastValidPosition || isValid) {
                    allFootnotes.push({
                        type: 'standard',
                        content: match_sf[2], // The key without [^ and ]
                        startIndex: bestMatch.index + bestMatch.length + match_sf.index,
                        endIndex: bestMatch.index + bestMatch.length + match_sf.index + match_sf[0].length
                    });
                    lastValidPosition = match_sf.index + match_sf[0].length;
                } else {
                    // Stop if we encounter a footnote that's not in the valid sequence
                    break;
                }
            }
            
            // Sort footnotes by their position
            allFootnotes.sort((a, b) => a.startIndex - b.startIndex);
            
            if (allFootnotes.length === 0) {
                new Notice('No footnotes found for this highlight.');
                return;
            }
            
            if (footnoteIndex >= allFootnotes.length) {
                new Notice('Footnote index out of range.');
                return;
            }
            
            const targetFootnote = allFootnotes[footnoteIndex];
            
            if (targetFootnote.type === 'inline') {
                // For inline footnotes and adjacent comments, focus on the content directly
                const footnoteText = content.substring(targetFootnote.startIndex, targetFootnote.endIndex);

                // Check if this is an adjacent HTML comment
                if (footnoteText.startsWith('<!--') && footnoteText.endsWith('-->')) {
                    // Adjacent HTML comment: <!-- content -->
                    const commentStart = targetFootnote.startIndex;
                    const commentStartPos = editor.offsetToPos(commentStart);

                    if (this.plugin.settings.selectTextOnCommentClick) {
                        // Select the content inside <!-- -->
                        const contentStart = targetFootnote.startIndex + 4; // skip <!--
                        const contentEnd = targetFootnote.endIndex - 3; // skip -->
                        const selectionStart = editor.offsetToPos(contentStart);
                        const selectionEnd = editor.offsetToPos(contentEnd);

                        // Scroll to and select the comment text
                        editor.scrollIntoView({ from: selectionStart, to: selectionEnd }, true);
                        editor.setSelection(selectionStart, selectionEnd);
                        editor.focus();
                    } else {
                        // Scroll to and position cursor at the start of the comment
                        editor.scrollIntoView({ from: commentStartPos, to: commentStartPos }, true);
                        editor.setCursor(commentStartPos);
                        editor.focus();
                    }
                } else if (footnoteText.startsWith('%%') && footnoteText.endsWith('%%')) {
                    // Adjacent native comment: %% content %%
                    const commentStart = targetFootnote.startIndex;
                    const commentStartPos = editor.offsetToPos(commentStart);

                    if (this.plugin.settings.selectTextOnCommentClick) {
                        // Select the content inside %% %%
                        const contentStart = targetFootnote.startIndex + 2; // skip %%
                        const contentEnd = targetFootnote.endIndex - 2; // skip %%
                        const selectionStart = editor.offsetToPos(contentStart);
                        const selectionEnd = editor.offsetToPos(contentEnd);

                        // Scroll to and select the comment text
                        editor.scrollIntoView({ from: selectionStart, to: selectionEnd }, true);
                        editor.setSelection(selectionStart, selectionEnd);
                        editor.focus();
                    } else {
                        // Scroll to and position cursor at the start of the comment
                        editor.scrollIntoView({ from: commentStartPos, to: commentStartPos }, true);
                        editor.setCursor(commentStartPos);
                        editor.focus();
                    }
                } else {
                    // Check if this is a custom pattern comment
                    let isCustomPattern = false;
                    for (const customPattern of this.plugin.settings.customPatterns) {
                        if (customPattern.type === 'comment') {
                            try {
                                const customRegex = new RegExp(customPattern.pattern);
                                const customMatch = customRegex.exec(footnoteText);

                                if (customMatch && customMatch[1]) {
                                    // This is a custom pattern comment
                                    isCustomPattern = true;
                                    const commentStart = targetFootnote.startIndex;
                                    const commentStartPos = editor.offsetToPos(commentStart);

                                    if (this.plugin.settings.selectTextOnCommentClick) {
                                        // Find where the captured group starts in the full match
                                        // The captured group is customMatch[1]
                                        const captureStart = footnoteText.indexOf(customMatch[1]);
                                        const captureEnd = captureStart + customMatch[1].length;

                                        const contentStart = targetFootnote.startIndex + captureStart;
                                        const contentEnd = targetFootnote.startIndex + captureEnd;
                                        const selectionStart = editor.offsetToPos(contentStart);
                                        const selectionEnd = editor.offsetToPos(contentEnd);

                                        // Scroll to and select the comment text
                                        editor.scrollIntoView({ from: selectionStart, to: selectionEnd }, true);
                                        editor.setSelection(selectionStart, selectionEnd);
                                        editor.focus();
                                    } else {
                                        // Scroll to and position cursor at the start of the comment
                                        editor.scrollIntoView({ from: commentStartPos, to: commentStartPos }, true);
                                        editor.setCursor(commentStartPos);
                                        editor.focus();
                                    }
                                    break;
                                }
                            } catch (e) {
                                // Skip invalid patterns
                                console.error(`Error matching custom pattern "${customPattern.name}":`, e);
                            }
                        }
                    }

                    if (!isCustomPattern) {
                        // Regular inline footnote: ^[content]
                        // Find the position of the ^ character (skip any leading spaces)
                        const caretIndex = footnoteText.indexOf('^');
                        const caretPosition = targetFootnote.startIndex + caretIndex;
                        const footnoteStartPos = editor.offsetToPos(caretPosition);

                        if (this.plugin.settings.selectTextOnCommentClick) {
                            // Select the content inside ^[content]
                            const contentStart = targetFootnote.startIndex + footnoteText.indexOf('[') + 1;
                            const contentEnd = targetFootnote.startIndex + footnoteText.lastIndexOf(']');
                            const selectionStart = editor.offsetToPos(contentStart);
                            const selectionEnd = editor.offsetToPos(contentEnd);

                            // Scroll to and select the comment text
                            editor.scrollIntoView({ from: selectionStart, to: selectionEnd }, true);
                            editor.setSelection(selectionStart, selectionEnd);
                            editor.focus();
                        } else {
                            // Scroll to and position cursor right before the ^ character
                            editor.scrollIntoView({ from: footnoteStartPos, to: footnoteStartPos }, true);
                            editor.setCursor(footnoteStartPos);
                            editor.focus();
                        }
                    }
                }
            } else {
                // For standard footnotes, find the footnote definition
                const footnoteKey = targetFootnote.content;
                const footnoteDefRegex = new RegExp(`^\\[\\^${this.escapeRegex(footnoteKey)}\\]:\\s*(.+)$`, 'm');
                const footnoteDefMatch = content.match(footnoteDefRegex);

                if (!footnoteDefMatch) {
                    new Notice('Could not find footnote definition.');
                    return;
                }

                // Calculate position of footnote definition
                const footnoteDefIndex = content.indexOf(footnoteDefMatch[0]);
                const footnoteDefStartPos = editor.offsetToPos(footnoteDefIndex);

                if (this.plugin.settings.selectTextOnCommentClick) {
                    // Select the content after the colon and space
                    const definitionContent = footnoteDefMatch[1];
                    const contentStartIndex = footnoteDefIndex + footnoteDefMatch[0].indexOf(definitionContent);
                    const contentEndIndex = contentStartIndex + definitionContent.length;
                    const selectionStart = editor.offsetToPos(contentStartIndex);
                    const selectionEnd = editor.offsetToPos(contentEndIndex);
                    
                    // Scroll to and select the comment text
                    editor.scrollIntoView({ from: selectionStart, to: selectionEnd }, true);
                    editor.setSelection(selectionStart, selectionEnd);
                    editor.focus();
                } else {
                    // Scroll to and position cursor at the footnote definition
                    editor.scrollIntoView({ from: footnoteDefStartPos, to: footnoteDefStartPos }, true);
                    editor.setCursor(footnoteDefStartPos);
                    editor.focus();
                }
            }

        }, 150);
    }

    private changeHighlightColor(highlight: Highlight, color: string) {
        // Update the highlight color (use undefined for empty string to clear the color)
        this.plugin.updateHighlight(highlight.id, { color: color || undefined }, highlight.filePath);
    }

    private getColorName(hex: string): string {
        // Obsidian's own colours (==🔵text==) are named with their emoji
        const noteColor = noteColorName(hex);
        if (noteColor) {
            return noteColorLabel(noteColor);
        }

        // Check if user has defined custom names
        const customNames = this.plugin.settings.customColorNames;
        const colors = this.plugin.settings.customColors;

        // Use custom names if they exist and are not empty
        if (hex === colors.yellow && customNames.yellow.trim()) {
            return customNames.yellow.trim();
        }
        if (hex === colors.red && customNames.red.trim()) {
            return customNames.red.trim();
        }
        if (hex === colors.teal && customNames.teal.trim()) {
            return customNames.teal.trim();
        }
        if (hex === colors.blue && customNames.blue.trim()) {
            return customNames.blue.trim();
        }
        if (hex === colors.green && customNames.green.trim()) {
            return customNames.green.trim();
        }

        // Fall back to hex code
        return hex;
    }

    /**
     * Group key and reading-order position for a highlight when grouping by heading.
     * Uses the metadata cache so headings inside code blocks are already excluded.
     * Across several notes the key carries the note name so identical headings stay apart.
     */
    private headingGroupFor(highlight: Highlight, multiNote: boolean): { key: string; position: DocumentPosition } {
        const file = this.plugin.app.vault.getAbstractFileByPath(highlight.filePath);
        const cached = file instanceof TFile ? (this.plugin.app.metadataCache.getFileCache(file)?.headings ?? []) : [];
        const heading = headingForLine(cached.map(h => ({ heading: h.heading, line: h.position.start.line })), highlight.line);
        const noteName = multiNote ? (highlight.filePath.split('/').pop() || highlight.filePath).replace(/\.md$/, '') : null;
        return {
            key: headingGroupKey(heading?.heading ?? null, noteName),
            position: { file: highlight.filePath, line: heading?.line ?? -1 }
        };
    }

    private getGroupDisplayName(groupKey: string): string {
        // Translate special group keys to localized display names
        switch (groupKey) {
            case 'No Comments':
                return t('emptyStates.noComments');
            case 'No Tags':
                return t('emptyStates.noTags');
            case 'Root':
                return t('emptyStates.root');
            case 'No Collections':
                return t('emptyStates.noCollections');
            case 'No Date':
                return t('emptyStates.noDate');
            case 'No section':
                return t('emptyStates.noSection');
            case 'All Tasks':
                return t('emptyStates.allTasks');
            case 'Default':
                return t('emptyStates.default');
            case 'OVERDUE':
                return t('emptyStates.overdue');
            default:
                // For color groups, use getColorName
                if (this.groupingMode === 'color') {
                    return this.getColorName(groupKey);
                }
                // For date groups, show descriptive labels based on distance from today
                if (this.groupingMode === 'date-asc' ||
                    this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc') {

                    // Handle current month remainder
                    if (groupKey.endsWith('-CURRENT-MONTH')) {
                        const monthKey = groupKey.replace('-CURRENT-MONTH', '');
                        const monthDate = moment(monthKey, 'YYYY-MM');
                        const today = moment().startOf('day');
                        const startDay = today.date() + 7; // Start from day 7 onwards
                        const endDay = monthDate.endOf('month').date();
                        return `${monthDate.format('MMMM')} ${startDay}-${endDay}`;
                    }

                    // Handle month groups (YYYY-MM format)
                    if (/^\d{4}-\d{2}$/.test(groupKey)) {
                        const monthDate = moment(groupKey, 'YYYY-MM');
                        return monthDate.format('MMMM');
                    }

                    // Handle year groups (YYYY format)
                    if (/^\d{4}$/.test(groupKey)) {
                        return groupKey;
                    }

                    // Check if groupKey is in YYYY-MM-DD format (individual dates)
                    if (/^\d{4}-\d{2}-\d{2}$/.test(groupKey)) {
                        const groupDate = moment(groupKey, 'YYYY-MM-DD');
                        const today = moment().startOf('day');

                        const daysFromToday = groupDate.diff(today, 'days');

                        // Today
                        if (daysFromToday === 0) {
                            return t('emptyStates.today');
                        }
                        // Tomorrow
                        if (daysFromToday === 1) {
                            return t('dateSuggestions.tomorrow');
                        }
                        // Days 2-6: show day name
                        if (daysFromToday >= 2 && daysFromToday <= 6) {
                            return groupDate.format('dddd'); // Full day name
                        }

                        // Fallback to date format
                        return groupDate.format('MMM DD');
                    }
                }
                // Return the key as-is for other cases (filenames, etc.)
                return groupKey;
        }
    }

    private renderGroupedHighlights(highlights: Highlight[], searchTerm?: string, showFilename: boolean = false) {
        const groups = new Map<string, Highlight[]>();
        const groupColors = new Map<string, string>(); // Track the actual hex color for each group
        const groupPositions = new Map<string, DocumentPosition>();
        const multiNote = new Set(highlights.map(h => h.filePath)).size > 1;

        // Group highlights based on grouping mode
        highlights.forEach(highlight => {
            let groupKey: string;
            
            if (this.groupingMode === 'color') {
                const color = highlight.color || this.plugin.settings.highlightColor;
                groupKey = color; // Use hex code directly instead of color name
                groupColors.set(groupKey, color); // Store the hex color
            } else if (this.groupingMode === 'comments-asc' || this.groupingMode === 'comments-desc') {
                // For comment grouping, only count footnote comments from regular highlights (not native comments)
                const commentCount = highlight.isNativeComment ? 0 : (highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0);
                groupKey = commentCount === 0 ? 'No Comments' : 
                          commentCount === 1 ? '1 Comment' : 
                          `${commentCount} Comments`;
            } else if (this.groupingMode === 'parent') {
                const pathParts = highlight.filePath.split('/');
                if (pathParts.length > 1) {
                    groupKey = pathParts[pathParts.length - 2]; // Parent folder name
                } else {
                    groupKey = 'Root';
                }
            } else if (this.groupingMode === 'collection') {
                // Find which collections this highlight belongs to
                const collections = this.plugin.collectionsManager.getAllCollections()
                    .filter(collection => collection.highlightIds.includes(highlight.id));
                
                if (collections.length === 0) {
                    groupKey = 'No Collections';
                } else if (collections.length === 1) {
                    groupKey = collections[0].name;
                } else {
                    // If highlight is in multiple collections, create a combined group name
                    groupKey = collections.map(c => c.name).sort().join(', ');
                }
            } else if (this.groupingMode === 'filename') {
                // Extract filename from path (remove extension for cleaner display)
                const filename = highlight.filePath.split('/').pop() || highlight.filePath;
                groupKey = filename.replace(/\.md$/, ''); // Remove .md extension
            } else if (this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc') {
                // Group by date created
                if (highlight.createdAt) {
                    const date = new Date(highlight.createdAt);
                    // Format as YYYY-MM-DD for grouping using local timezone
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    groupKey = `${year}-${month}-${day}`;
                } else {
                    groupKey = 'No Date';
                }
            } else if (this.groupingMode === 'heading') {
                const group = this.headingGroupFor(highlight, multiNote);
                groupKey = group.key;
                groupPositions.set(groupKey, group.position);
            } else {
                groupKey = 'Default';
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(highlight);
        });

        // Sort groups and render them
        const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
            if (this.groupingMode === 'comments-asc' || this.groupingMode === 'comments-desc') {
                // Sort comment groups by count
                if (a === 'No Comments' && b === 'No Comments') return 0;
                if (a === 'No Comments') return this.groupingMode === 'comments-asc' ? -1 : 1;
                if (b === 'No Comments') return this.groupingMode === 'comments-asc' ? 1 : -1;
                
                const aNum = parseInt(a.split(' ')[0]) || 0;
                const bNum = parseInt(b.split(' ')[0]) || 0;
                
                return this.groupingMode === 'comments-asc' ? aNum - bNum : bNum - aNum;
            } else if (this.groupingMode === 'tag') {
                // Sort tag groups alphabetically, with "No Tags" at the end
                if (a === 'No Tags' && b === 'No Tags') return 0;
                if (a === 'No Tags') return 1;
                if (b === 'No Tags') return -1;
                return a.localeCompare(b);
            } else if (this.groupingMode === 'parent') {
                // Sort parent folder groups alphabetically, with "Root" at the beginning
                if (a === 'Root' && b === 'Root') return 0;
                if (a === 'Root') return -1;
                if (b === 'Root') return 1;
                return a.localeCompare(b);
            } else if (this.groupingMode === 'collection') {
                // Sort collection groups alphabetically, with "No Collections" at the end
                if (a === 'No Collections' && b === 'No Collections') return 0;
                if (a === 'No Collections') return 1;
                if (b === 'No Collections') return -1;
                return a.localeCompare(b);
            } else if (this.groupingMode === 'heading') {
                // Reading order: the note's position, never alphabetical
                return compareDocumentOrder(groupPositions.get(a)!, groupPositions.get(b)!);
            } else if (this.groupingMode === 'filename') {
                // Sort filename groups alphabetically
                return a.localeCompare(b);
            } else if (this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc') {
                // Sort date groups
                if (a === 'No Date' && b === 'No Date') return 0;
                if (a === 'No Date') return 1; // Always put "No Date" at the end
                if (b === 'No Date') return -1;
                
                // Compare dates
                const dateA = new Date(a);
                const dateB = new Date(b);
                
                if (this.groupingMode === 'date-created-asc') {
                    return dateA.getTime() - dateB.getTime();
                } else {
                    return dateB.getTime() - dateA.getTime();
                }
            }
            return a.localeCompare(b);
        });

        sortedGroups.forEach(([groupName, groupHighlights]) => {
            // Create group header
            const groupHeader = this.listContainerEl.createDiv({ cls: 'highlight-group-header' });
            
            // Create header text container for name and icons
            const headerTextContainer = groupHeader.createSpan();
            
            // Add color square if grouping by color
            if (this.groupingMode === 'color' && groupColors.has(groupName)) {
                const color = groupColors.get(groupName)!;
                const colorSquare = headerTextContainer.createDiv({ 
                    cls: 'group-color-square',
                    attr: { 'data-color': color }
                });
                // Set the color directly via style to ensure it always shows
                colorSquare.style.backgroundColor = color;
            }
            
            // Add tag icon if grouping by tag
            if (this.groupingMode === 'tag') {
                const tagIcon = headerTextContainer.createDiv({ cls: 'group-tag-icon' });
                setIcon(tagIcon, 'tag');
            }
            
            const headerText = headerTextContainer.createSpan();
            headerText.textContent = this.getGroupDisplayName(groupName);

            // Add collection-style stats underneath the group header
            const statsContainer = groupHeader.createDiv({ cls: 'collection-stats' });
            const infoLineContainer = statsContainer.createEl('small', { cls: 'collection-info-line' });
            
            // Calculate file count for this group
            const uniqueFiles = new Set(groupHighlights.map(h => h.filePath));
            const fileCount = uniqueFiles.size;
            
            // Calculate native comments count for this group
            const nativeCommentsCount = groupHighlights.filter(h => h.isNativeComment).length;
            
            // Highlights count section (excluding native comments)
            const regularHighlightsCount = groupHighlights.filter(h => !h.isNativeComment).length;
            const highlightsContainer = infoLineContainer.createDiv({
                cls: 'highlight-line-info'
            });
            
            const highlightsIcon = highlightsContainer.createDiv({ cls: 'line-icon' });
            setIcon(highlightsIcon, 'highlighter');
            
            highlightsContainer.createSpan({ text: `${regularHighlightsCount}` });

            // Native comments count section (show when native comments are on screen)
            if (this.typeFilter !== 'highlights') {
                const nativeCommentsContainer = infoLineContainer.createDiv({
                    cls: 'highlight-line-info'
                });
                
                const nativeCommentsIcon = nativeCommentsContainer.createDiv({ cls: 'line-icon' });
                setIcon(nativeCommentsIcon, 'captions');
                
                nativeCommentsContainer.createSpan({ text: `${nativeCommentsCount}` });
            }

            // Files count section
            const filesContainer = infoLineContainer.createDiv({
                cls: 'highlight-line-info'
            });
            
            const filesIcon = filesContainer.createDiv({ cls: 'line-icon' });
            setIcon(filesIcon, 'file-text');
            
            filesContainer.createSpan({ text: `${fileCount}` });

            // Sort highlights within each group to ensure consistent order
            let sortedHighlights: Highlight[];
            if (this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc') {
                // For date grouping, sort by creation time within the same day
                sortedHighlights = groupHighlights.sort((a, b) => {
                    const timeA = a.createdAt || 0;
                    const timeB = b.createdAt || 0;

                    if (this.groupingMode === 'date-created-asc') {
                        return timeA - timeB; // Earlier times first
                    } else {
                        return timeB - timeA; // Later times first
                    }
                });
            } else {
                // Within a group the file is already implied, so ties fall back
                // to position rather than path.
                sortedHighlights = groupHighlights.sort(
                    (a, b) => this.compareHighlightsBySortMode(a, b, 'position')
                );
            }
            
            // Items live in their own container so the header can hide them as a unit
            const itemsContainer = this.listContainerEl.createDiv({ cls: 'highlight-group-items' });
            sortedHighlights.forEach(highlight => {
                this.createHighlightItem(itemsContainer, highlight, searchTerm, showFilename);
            });

            this.makeGroupCollapsible(groupHeader, [itemsContainer], groupName);
        });
    }

    private updateCommentsToggleIcon(button: HTMLElement) {
        button.empty();

        // Use global state to determine icon, not current view
        const expanded = isCommentsToggleOn(this.commentsExpanded, this.areCommentsGloballyExpanded(), this.hasToggleableComments());

        const iconName = expanded ? 'chevrons-down-up' : 'chevrons-up-down';
        setIcon(button, iconName);
    }

    /**
     * Expand all comments in the highlightCommentsVisible map
     * Used when restoring commentsExpanded state from settings
     */
    private expandAllCommentsInMap() {
        const allHighlights: Highlight[] = [];
        for (const [, fileHighlights] of this.plugin.highlights) {
            allHighlights.push(...fileHighlights);
        }

        allHighlights.forEach(highlight => {
            // Only expand footnote comments for regular highlights, not native comments
            if (highlight.isNativeComment) return;
            const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
            if (validFootnoteCount > 0) {
                this.highlightCommentsVisible.set(highlight.id, true);
            }
        });
    }

    /**
     * Collapse all comments in the highlightCommentsVisible map
     * Used when restoring commentsExpanded state from settings
     */
    private collapseAllCommentsInMap() {
        const allHighlights: Highlight[] = [];
        for (const [, fileHighlights] of this.plugin.highlights) {
            allHighlights.push(...fileHighlights);
        }

        allHighlights.forEach(highlight => {
            // Only collapse footnote comments for regular highlights, not native comments
            if (highlight.isNativeComment) return;
            const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
            if (validFootnoteCount > 0) {
                this.highlightCommentsVisible.set(highlight.id, false);
            }
        });
    }

    private toggleAllComments() {
        // Toggle ALL highlights across all files globally, not just current view
        const allHighlights: Highlight[] = [];
        for (const [, fileHighlights] of this.plugin.highlights) {
            allHighlights.push(...fileHighlights);
        }

        // If any are expanded, collapse all. If none are expanded, expand all.
        // With nothing expandable in the vault the button flips its own state instead,
        // so it can still be switched off.
        const newState = nextCommentsToggleState(this.commentsExpanded, this.areCommentsGloballyExpanded(), this.hasToggleableComments());

        allHighlights.forEach(highlight => {
            // Only toggle footnote comments for regular highlights, not native comments
            if (highlight.isNativeComment) return;
            const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
            if (validFootnoteCount > 0) {
                this.highlightCommentsVisible.set(highlight.id, newState);
            }
        });

        // Update commentsExpanded state and save to settings
        this.commentsExpanded = newState;
        this.saveCurrentTabSettings();
    }

    private areCommentsGloballyExpanded(): boolean {
        // Check ALL highlights across all files globally, not just current view
        const allHighlights: Highlight[] = [];
        for (const [, fileHighlights] of this.plugin.highlights) {
            allHighlights.push(...fileHighlights);
        }
        
        // Check if any comments are currently expanded globally
        return allHighlights.some(highlight => {
            // Only check for footnote comments on regular highlights, not native comments
            if (highlight.isNativeComment) return false;
            const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
            return validFootnoteCount > 0 && this.highlightCommentsVisible.get(highlight.id);
        });
    }

    /**
     * Whether any highlight in the vault could show comments at all. When nothing can,
     * areCommentsGloballyExpanded() is stuck at false and cannot drive the toolbar toggle.
     */
    private hasToggleableComments(): boolean {
        for (const [, fileHighlights] of this.plugin.highlights) {
            for (const highlight of fileHighlights) {
                // Native comments are the comment, so they have nothing to expand
                if (highlight.isNativeComment) continue;
                const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
                if (validFootnoteCount > 0) return true;
            }
        }
        return false;
    }

    private getHighlightCommentsVisibility(highlight: Highlight): boolean {
        // If we already have a stored state for this highlight, use it
        const storedVisibility = this.highlightCommentsVisible.get(highlight.id);
        if (storedVisibility !== undefined) {
            return storedVisibility;
        }
        
        // For new highlights with footnotes, inherit the current global state
        if (!highlight.isNativeComment) {
            const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
            if (validFootnoteCount > 0) {
                const globalState = this.areCommentsGloballyExpanded();
                // Store this state so it persists
                this.highlightCommentsVisible.set(highlight.id, globalState);
                return globalState;
            }
        }
        
        // Default to false for highlights without footnotes or native comments
        return false;
    }

    private resetAllColors() {
        // Get highlights based on current view mode
        let highlightsToReset: Highlight[];
        if (this.viewMode === 'current') {
            highlightsToReset = this.plugin.getCurrentFileHighlights();
        } else if (this.viewMode === 'folder') {
            highlightsToReset = this.getFolderHighlights();
        } else if (this.viewMode === 'all') {
            // Get all highlights from all files
            highlightsToReset = [];
            for (const [, fileHighlights] of this.plugin.highlights) {
                highlightsToReset.push(...fileHighlights);
            }
        } else if (this.viewMode === 'collections' && this.currentCollectionId) {
            // Get highlights from current collection
            highlightsToReset = this.plugin.collectionsManager.getHighlightsInCollection(this.currentCollectionId);
        } else {
            highlightsToReset = [];
        }
        
        let hasChanges = false;
        
        highlightsToReset.forEach(highlight => {
            if (highlight.color) {
                // Find the actual file path for the highlight to update it correctly
                const fileHighlights = this.plugin.highlights.get(highlight.filePath);
                if (fileHighlights) {
                    const targetHighlight = fileHighlights.find(h => h.id === highlight.id);
                    if (targetHighlight && targetHighlight.color) {
                        // Create a new object for the update to ensure reactivity if needed
                        const updatedHighlight = { ...targetHighlight, color: undefined };
                        // Update in the main plugin's highlights map
                        const index = fileHighlights.indexOf(targetHighlight);
                        fileHighlights[index] = updatedHighlight;
                        this.plugin.highlights.set(highlight.filePath, [...fileHighlights]);
                        hasChanges = true;
                    }
                }
            }
        });
        
        if (hasChanges) {
            void this.plugin.saveSettings(); // Save changes to disk
            this.renderContent(); // Use renderContent instead of renderFilteredList
        }
    }

    private extractTagsFromHighlight(highlight: Highlight): string[] {
        const tags: string[] = [];
        
        if (highlight.footnoteContents) {
            // Process footnotes in order and collect tags
            for (const content of highlight.footnoteContents) {
                if (content.trim() !== '') {
                    // Extract hashtags from footnote content (including unicode characters and nested paths)
                    const tagMatches = content.match(/#[\p{L}\p{N}\p{M}_/-]+/gu);
                    if (tagMatches) {
                        tagMatches.forEach(tag => {
                            const tagName = tag.substring(1); // Remove the # symbol
                            if (!tags.includes(tagName)) {
                                tags.push(tagName);
                            }
                        });
                    }
                }
            }
        }
        
        return tags; // Return in order found, first tag will be at index 0
    }

    private getAllTagsInFile(): string[] {
        const allTags = new Set<string>();

        if (this.viewMode === 'current' || this.viewMode === 'folder') {
            const highlights = this.viewMode === 'folder'
                ? this.getFolderHighlights()
                : this.plugin.getCurrentFileHighlights();
            highlights.forEach(highlight => {
                const tags = this.extractTagsFromHighlight(highlight);
                tags.forEach(tag => allTags.add(tag));
            });
        } else if (this.viewMode === 'all') {
            // Get tags from all highlights across all files
            for (const highlights of this.plugin.highlights.values()) {
                highlights.forEach(highlight => {
                    const tags = this.extractTagsFromHighlight(highlight);
                    tags.forEach(tag => allTags.add(tag));
                });
            }
        } else if (this.viewMode === 'collections' && this.currentCollectionId) {
            // Get tags from highlights in current collection
            const highlights = this.plugin.collectionsManager.getHighlightsInCollection(this.currentCollectionId);
            highlights.forEach(highlight => {
                const tags = this.extractTagsFromHighlight(highlight);
                tags.forEach(tag => allTags.add(tag));
            });
        }

        return Array.from(allTags).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }

    /** The highlights this tab draws from, before any filter is applied. */
    private getScopeHighlights(): Highlight[] {
        if (this.viewMode === 'current') {
            return this.plugin.getCurrentFileHighlights();
        }
        if (this.viewMode === 'folder') {
            return this.getFolderHighlights();
        }
        if (this.viewMode === 'all') {
            const highlights: Highlight[] = [];
            for (const [, fileHighlights] of this.plugin.highlights) {
                highlights.push(...fileHighlights);
            }
            return highlights;
        }
        if (this.viewMode === 'collections' && this.currentCollectionId) {
            return this.plugin.collectionsManager.getHighlightsInCollection(this.currentCollectionId);
        }
        return [];
    }

    private getAllCollectionsInCurrentScope(): { id: string, name: string }[] {
        const allCollections = new Set<string>();
        const highlights: Highlight[] = this.getScopeHighlights();
        
        // Get all collections that contain these highlights
        highlights.forEach(highlight => {
            const highlightCollections = this.plugin.collectionsManager.getCollectionsForHighlight(highlight.id);
            highlightCollections.forEach(collection => {
                allCollections.add(collection.id);
            });
        });
        
        // Convert to collection objects
        const collections = this.plugin.collectionsManager.getAllCollections();
        return collections.filter(collection => allCollections.has(collection.id));
    }

    private showTagFilterMenu(event: MouseEvent) {
        const availableTags = this.getAllTagsInFile();
        const availableCollections = this.getAllCollectionsInCurrentScope();

        // Sort collections alphabetically with locale-aware sorting
        const sortedCollections = availableCollections.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        const items: DropdownItem[] = [
            {
                text: t('filterMenu.clear'),
                icon: 'x',
                className: 'highlights-dropdown-clear',
                onClick: () => {
                    this.selectedTags.clear();
                    this.selectedCollections.clear();
                    this.selectedColors.clear();
                    this.setTypeFilter('all');
                    this.saveCurrentTabSettings();
                    this.renderContent();
                    this.showTagActive();
                }
            }
        ];

        // Add Tags category (if tags exist)
        if (availableTags.length > 0) {
            items.push({
                id: 'category-tags',
                text: 'Tags',
                icon: 'tag',
                expandable: true,
                expanded: false,
                children: availableTags.map(tag => ({
                    id: `tag-${tag}`,
                    text: `#${tag}`,
                    uncheckedIcon: 'tag',
                    checked: this.selectedTags.has(tag),
                    onClick: () => {
                        if (this.selectedTags.has(tag)) {
                            this.selectedTags.delete(tag);
                        } else {
                            this.selectedTags.add(tag);
                        }
                        this.renderContent();
                        this.showTagActive();
                    }
                }))
            });
        }

        // Add Type category. Unlike the others this is a single choice, and it mirrors
        // the toolbar button rather than holding its own state.
        const typeOptions: Array<{ id: HighlightTypeFilter, labelKey: string, icon: string }> = [
            { id: 'all', labelKey: 'filterMenu.type.all', icon: 'captions' },
            { id: 'highlights', labelKey: 'filterMenu.type.highlightsOnly', icon: 'highlighter' },
            { id: 'comments', labelKey: 'filterMenu.type.commentsOnly', icon: 'message-square' }
        ];
        items.push({
            id: 'category-type',
            text: t('filterMenu.type.heading'),
            icon: 'shapes',
            expandable: true,
            expanded: false,
            children: typeOptions.map(option => ({
                id: `type-${option.id}`,
                text: t(option.labelKey),
                uncheckedIcon: option.icon,
                checked: this.typeFilter === option.id,
                radioGroup: 'type',
                onClick: () => {
                    this.setTypeFilter(option.id);
                    this.renderContent();
                    this.showTagActive();
                }
            }))
        });

        // Add Colours category (only colours actually present in this view)
        const availableColors = this.getAvailableColors();
        if (availableColors.length > 1) {
            items.push({
                id: 'category-colors',
                text: t('filterMenu.colors'),
                icon: 'palette',
                expandable: true,
                expanded: false,
                children: availableColors.map(color => ({
                    id: `color-${color}`,
                    text: this.getColorLabel(color),
                    uncheckedIcon: 'circle',
                    checked: this.selectedColors.has(color),
                    onClick: () => {
                        if (this.selectedColors.has(color)) {
                            this.selectedColors.delete(color);
                        } else {
                            this.selectedColors.add(color);
                        }
                        this.saveCurrentTabSettings();
                        this.renderContent();
                        this.showTagActive();
                    }
                }))
            });
        }

        // Add Collections category (if collections exist)
        if (sortedCollections.length > 0) {
            items.push({
                id: 'category-collections',
                text: 'Collections',
                icon: 'folder-open',
                expandable: true,
                expanded: false,
                children: sortedCollections.map(collection => ({
                    id: `collection-${collection.id}`,
                    text: collection.name,
                    uncheckedIcon: 'folder-open',
                    checked: this.selectedCollections.has(collection.name),
                    onClick: () => {
                        if (this.selectedCollections.has(collection.name)) {
                            this.selectedCollections.delete(collection.name);
                        } else {
                            this.selectedCollections.add(collection.name);
                        }
                        this.renderContent();
                        this.showTagActive();
                    }
                }))
            });
        }

        this.dropdownManager.showDropdown(
            event.currentTarget as HTMLElement,
            items
        );
    }

    private showCollectionsMenu(event: MouseEvent, highlight: Highlight) {
        const availableCollections = this.plugin.collectionsManager.getAllCollections();
        
        const items: DropdownItem[] = [
            {
                text: t('filterMenu.clear'),
                icon: 'x',
                className: 'highlights-dropdown-clear',
                onClick: () => {
                    // Remove highlight from all collections
                    availableCollections.forEach(collection => {
                        this.plugin.collectionsManager.removeHighlightFromCollection(collection.id, highlight.id);
                    });
                    this.updateHighlightCollectionCount(highlight);
                    if (this.viewMode === 'collections') {
                        this.renderContent();
                    }
                    // Refresh sidebar if we're grouping by collection
                    if (this.groupingMode === 'collection') {
                        this.renderContent();
                    }
                    
                    // Update all checkbox states to unchecked
                    const newStates: { [key: string]: boolean } = {};
                    availableCollections.forEach(collection => {
                        newStates[`collection-${collection.id}`] = false;
                    });
                    this.dropdownManager.updateAllCheckboxStates(newStates);
                }
            },
            {
                text: t('toolbar.newCollection'),
                icon: 'plus',
                className: 'highlights-dropdown-clear',
                onClick: () => {
                    this.showNewCollectionDialog(highlight.id);
                }
            }
        ];

        // Add existing collections
        if (availableCollections.length > 0) {
            items.push(...availableCollections.map(collection => ({
                id: `collection-${collection.id}`,
                text: collection.name,
                uncheckedIcon: 'folder-open',
                checked: collection.highlightIds.includes(highlight.id),
                onClick: () => {
                    const isInCollection = collection.highlightIds.includes(highlight.id);
                    
                    if (isInCollection) {
                        this.plugin.collectionsManager.removeHighlightFromCollection(collection.id, highlight.id);
                        this.updateHighlightCollectionCount(highlight);
                        if (this.viewMode === 'collections' && this.currentCollectionId === collection.id) {
                            this.renderContent();
                        }
                        // Refresh sidebar if we're grouping by collection
                        if (this.groupingMode === 'collection') {
                            this.renderContent();
                        }
                    } else {
                        this.plugin.collectionsManager.addHighlightToCollection(collection.id, highlight.id);
                        this.updateHighlightCollectionCount(highlight);
                        // Refresh sidebar if we're grouping by collection
                        if (this.groupingMode === 'collection') {
                            this.renderContent();
                        }
                    }
                }
            })));
        } else {
            items.push({
                text: t('emptyStates.noCollectionsAvailable'),
                className: 'highlights-dropdown-empty',
                onClick: () => {}
            });
        }

        this.dropdownManager.showDropdown(
            event.currentTarget as HTMLElement,
            items
        );
    }

    private updateCollectionNavButton(button: HTMLElement) {
        button.empty();
        
        if (this.viewMode === 'collections' && this.currentCollectionId) {
            // Show back button with accent color
            setIcon(button, 'arrow-left');
            setTooltip(button, t('toolbar.backToCollections'));
            button.classList.add('active', 'collection-nav-back');
        } else {
            // Show new collection button with normal styling
            setIcon(button, 'folder-plus');
            setTooltip(button, t('toolbar.newCollection'));
            button.classList.remove('active', 'collection-nav-back');
        }
    }

    private toggleSearch() {
        // Only proceed if toolbar is enabled
        if (!this.plugin.settings.showToolbar) return;

        this.searchExpanded = !this.searchExpanded;
        const searchInputContainer = this.contentEl.querySelector('.highlights-search-input-container') as HTMLElement;

        if (!searchInputContainer) return;

        if (this.searchExpanded) {
            searchInputContainer.classList.remove('sh-hidden');
            this.searchButton.classList.add('active');
            setIcon(this.searchButton, 'x');
            setTooltip(this.searchButton, t('toolbar.closeSearch'));
            // Focus the search input
            window.setTimeout(() => this.searchInputEl.focus(), 100);
        } else {
            searchInputContainer.classList.add('sh-hidden');
            this.searchButton.classList.remove('active');
            setIcon(this.searchButton, 'search');
            setTooltip(this.searchButton, t('toolbar.search'));
            // Clear search when closing
            this.simpleSearchManager?.clear();
            this.currentSearchTokens = [];
            this.currentParsedSearch = { ast: null };
            this.renderContent();
        }

        // Save the search state for this tab
        this.saveCurrentTabSettings();
    }

    /** Apply a disabled rule across the toolbar, addressing buttons by their data-action role. */
    private setToolbarButtonsDisabled(shouldDisable: (button: Element) => boolean) {
        const toolbarButtons = this.contentEl.querySelectorAll('.highlights-search-container button');
        toolbarButtons.forEach(button => {
            button.classList.toggle('disabled', shouldDisable(button));
        });
    }

    private enableSearchAndToolbar() {
        // Only proceed if toolbar is enabled
        if (!this.plugin.settings.showToolbar) return;

        // Enable search button and input
        if (this.searchButton) {
            this.searchButton.classList.remove('disabled');
        }

        if (this.searchInputEl) {
            this.searchInputEl.classList.remove('disabled');
        }

        this.setToolbarButtonsDisabled(() => false);

        // Update collection nav button styling
        if (this.collectionNavButton) {
            this.updateCollectionNavButton(this.collectionNavButton);
        }
    }

    private disableSearchAndToolbar() {
        // Only proceed if toolbar is enabled
        if (!this.plugin.settings.showToolbar) return;
        
        // Disable search button and input
        if (this.searchButton) {
            this.searchButton.classList.add('disabled');
        }
        
        if (this.searchInputEl) {
            this.searchInputEl.classList.add('disabled');
        }

        // Disable toolbar buttons except collection nav, which is how a collection gets
        // created from here, and the overflow menu, whose actions still apply.
        this.setToolbarButtonsDisabled(button => {
            const action = button.getAttribute('data-action');
            return action !== 'collection-nav' && action !== 'overflow';
        });
        
        // Update collection nav button styling
        if (this.collectionNavButton) {
            this.updateCollectionNavButton(this.collectionNavButton);
        }
    }

    private updateHighlightCollectionCount(highlight: Highlight) {
        // Find the highlight item in the DOM
        const highlightItem = this.containerEl.querySelector(`[data-highlight-id="${highlight.id}"]`);
        if (!highlightItem) return;
        
        // Find the collection count element within this highlight item
        const collectionCountElement = highlightItem.querySelector('.highlight-line-info:last-child span');
        if (collectionCountElement) {
            const newCount = this.plugin.collectionsManager.getHighlightCollectionCount(highlight.id);
            collectionCountElement.textContent = `${newCount}`;
        }
    }

    private showTagActive() {
        // Only proceed if toolbar is enabled
        if (!this.plugin.settings.showToolbar) return;

        const tagFilterButton = this.contentEl.querySelector('.highlights-tag-filter-button') as HTMLElement;
        if (tagFilterButton) {
            if (this.selectedTags.size > 0 || this.selectedCollections.size > 0
                || this.selectedColors.size > 0 || this.typeFilter !== 'all') {
                tagFilterButton.classList.add('active');
            } else {
                tagFilterButton.classList.remove('active');
            }
        }
    }

    private showNewCollectionDialog(highlightId?: string) {
        new NewCollectionModal(this.plugin.app, (name: string, description: string) => {
            const collection = this.plugin.collectionsManager.createCollection(name, description);
            
            // If a highlight ID was provided, automatically add it to the new collection
            if (highlightId) {
                this.plugin.collectionsManager.addHighlightToCollection(collection.id, highlightId);
            }
            
            // Animate the new collection
            this.animateCollectionCreation(collection.id);
        }).open();
    }

    private showCollectionMenu(event: MouseEvent, collection: Collection) {
        const menu = new Menu();

        menu.addItem((item) => {
            item
                .setTitle(t('contextMenu.edit'))
                .setIcon('edit')
                .onClick(() => {
                    this.showEditCollectionDialog(collection);
                });
        });

        menu.addItem((item) => {
            item
                .setTitle(t('contextMenu.delete'))
                .setIcon('trash')
                .onClick(async () => {
                    await this.animateCollectionDeletion(collection.id);
                });
        });
        
        menu.showAtMouseEvent(event);
    }

    private showEditCollectionDialog(collection: Collection) {
        new EditCollectionModal(this.plugin.app, collection, (name: string, description: string) => {
            // Update collection properties
            collection.name = name;
            collection.description = description;
            void this.plugin.saveSettings();
            this.plugin.refreshSidebar();
        }).open();
    }

    // Animation methods for collection creation and deletion
    private animateCollectionCreation(collectionId: string) {
        // First refresh the sidebar to add the new collection to DOM
        this.plugin.refreshSidebar();
        
        // Wait for DOM update, then find and animate the new collection
        window.requestAnimationFrame(() => {
            const collectionCard = this.contentAreaEl.querySelector(`[data-collection-id="${collectionId}"]`) as HTMLElement;
            if (collectionCard) {
                // Start from scaled down state
                collectionCard.classList.add('preparing-animation');
                
                // Trigger animation on next frame
                window.requestAnimationFrame(() => {
                    collectionCard.classList.remove('preparing-animation');
                    collectionCard.classList.add('animating-in');
                    
                    // Clean up animation class after animation completes
                    window.setTimeout(() => {
                        collectionCard.classList.remove('animating-in');
                    }, 400); // Match animation duration
                });
            }
        });
    }

    private async animateCollectionDeletion(collectionId: string): Promise<boolean> {
        const collectionCard = this.contentAreaEl.querySelector(`[data-collection-id="${collectionId}"]`) as HTMLElement;
        if (!collectionCard) {
            // If card not found, proceed with normal deletion
            return await this.plugin.collectionsManager.deleteCollectionWithConfirmation(collectionId);
        }

        // Get collection reference before deletion
        const collection = this.plugin.collectionsManager.getCollection(collectionId);
        if (!collection) return false;

        const confirmed = confirm(`Are you sure you want to delete "${collection.name}"?`);
        if (!confirmed) return false;

        // Start deletion animation
        collectionCard.classList.add('animating-out');

        // Wait for animation to complete, then delete
        return new Promise((resolve) => {
            window.setTimeout(() => {
                // Perform actual deletion
                this.plugin.collectionsManager.deleteCollection(collectionId);
                this.plugin.refreshSidebar();
                resolve(true);
            }, 220); // Match animation duration (200ms + small buffer)
        });
    }

    private setTypeFilter(filter: HighlightTypeFilter) {
        this.typeFilter = filter;
        this.plugin.app.saveLocalStorage('sidebar-highlights-type-filter', filter);
    }

    /**
     * Every colour present in the current tab's highlights, so the filter offers only
     * real choices. Deliberately reads the unfiltered scope: if it read what is on
     * screen, picking one colour would drop every other colour out of the menu.
     */
    private getAvailableColors(): string[] {
        const colors = new Set<string>();
        this.getScopeHighlights().forEach(highlight => {
            colors.add(resolveHighlightColor(highlight.color, this.plugin.settings.highlightColor));
        });
        return Array.from(colors).sort((a, b) =>
            this.getColorLabel(a).localeCompare(this.getColorLabel(b), undefined, { numeric: true, sensitivity: 'base' })
        );
    }

    private getColorLabel(color: string): string {
        return colorLabel(color, this.plugin.settings);
    }

    private toggleFollowEditorScroll() {
        this.followEditorScroll = !this.followEditorScroll;
        this.plugin.app.saveLocalStorage('sidebar-highlights-follow-editor-scroll', this.followEditorScroll.toString());

        if (this.followEditorScroll) {
            this.attachEditorScrollListener();
            // Sync once immediately so the user sees feedback right away
            this.syncSidebarToEditorScroll();
        } else {
            this.detachEditorScrollListener();
            this.clearFollowScrollSelection();
        }
    }

    /** The folder the Current folder tab is showing: the active note's own folder. */
    private getCurrentFolderPath(): string | null {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        return activeFile ? parentFolderPath(activeFile.path) : null;
    }

    /** The folder path as shown to the user, naming the vault root rather than showing nothing. */
    private getCurrentFolderLabel(): string | null {
        const folder = this.getCurrentFolderPath();
        if (folder === null) return null;
        return folder === '' ? t('emptyStates.root') : folder;
    }

    /**
     * Every highlight in the active note's folder. The folder is always derived from
     * the active note, so the tab follows the user around the vault with nothing to
     * pick or remember.
     */
    private getFolderHighlights(): Highlight[] {
        const folder = this.getCurrentFolderPath();
        if (folder === null) return [];

        const scoped: Highlight[] = [];
        for (const [filePath, fileHighlights] of this.plugin.highlights) {
            if (isInFolder(filePath, folder, this.folderScopeRecursive)) {
                scoped.push(...fileHighlights);
            }
        }
        return scoped;
    }

    private toggleFolderScopeRecursive() {
        this.folderScopeRecursive = !this.folderScopeRecursive;
        this.plugin.app.saveLocalStorage('sidebar-highlights-folder-scope-recursive', this.folderScopeRecursive.toString());
        this.renderContent();
    }

    /**
     * Show the toolbar overflow menu (secondary actions).
     */
    private showOverflowMenu(event: MouseEvent) {
        const menu = new Menu();

        // Subfolder depth, only meaningful on the tab that shows a folder
        if (this.viewMode === 'folder') {
            menu.addItem((item) => {
                item
                    .setTitle(t('toolbar.includeSubfolders'))
                    .setIcon('folder-tree')
                    .setChecked(this.folderScopeRecursive)
                    .onClick(() => {
                        this.toggleFolderScopeRecursive();
                    });
            });

            menu.addSeparator();
        }

        // Toggle Follow editor scroll
        menu.addItem((item) => {
            item
                .setTitle(t('toolbar.toggleFollowEditorScroll'))
                .setIcon('scan-eye')
                .setChecked(this.followEditorScroll)
                .onClick(() => {
                    this.toggleFollowEditorScroll();
                });
        });

        menu.addSeparator();

        // Copy all visible results (highlights, or tasks in the Tasks tab)
        this.addCopyVisibleMenuItems(menu);

        // Revert highlight colors
        menu.addItem((item) => {
            item
                .setTitle(t('toolbar.revertColors'))
                .setIcon('rotate-ccw')
                .onClick(() => {
                    this.resetAllColors();
                });
        });

        menu.showAtMouseEvent(event);
    }

    /**
     * Get the highlights currently rendered in the sidebar (post-filter).
     * Mirrors the same source-set + filter pipeline as renderFilteredList,
     * but without grouping/sorting/pagination.
     */
    private getCurrentlyVisibleHighlights(): Highlight[] {
        let source: Highlight[] = [];

        if (this.viewMode === 'current') {
            const file = this.plugin.app.workspace.getActiveFile();
            if (!file) return [];
            source = this.plugin.getCurrentFileHighlights() || [];
        } else if (this.viewMode === 'folder') {
            source = this.getFolderHighlights();
        } else if (this.viewMode === 'all') {
            for (const [, highlights] of this.plugin.highlights) {
                source.push(...highlights);
            }
        } else if (this.viewMode === 'collections') {
            // Inside a specific collection, show only its highlights;
            // the collections-grid view itself has no highlights to copy.
            if (!this.currentCollectionId) return [];
            const collection = this.plugin.collectionsManager.getCollection(this.currentCollectionId);
            if (!collection) return [];
            for (const id of collection.highlightIds) {
                const h = this.getHighlightById(id);
                if (h) source.push(h);
            }
        }

        // Apply view-level file exclusion (matches renderFilteredList behavior),
        // except for the collections view, which intentionally bypasses file filtering.
        if (this.viewMode !== 'collections') {
            source = source.filter(h => {
                const file = this.plugin.app.vault.getAbstractFileByPath(h.filePath);
                if (!file || !(file instanceof TFile)) return false;
                return this.plugin.shouldProcessFile(file);
            });
        }

        return this.applyAllFilters(source);
    }

    /**
     * Creation time of a note, in epoch milliseconds, or undefined when the file
     * cannot be resolved. Cached per render pass because sorting a large vault
     * would otherwise hit the vault once per comparison.
     */
    private getNoteCreated = (filePath: string): number | undefined => {
        const cached = this.noteCreatedCache.get(filePath);
        if (cached !== undefined) {
            return cached ?? undefined;
        }

        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        const ctime = file instanceof TFile ? file.stat.ctime : null;
        this.noteCreatedCache.set(filePath, ctime);
        return ctime ?? undefined;
    };

    private compareHighlightsBySortMode(a: Highlight, b: Highlight, fallback: SortFallback): number {
        return compareHighlights(a, b, this.sortMode, {
            fallback,
            getNoteCreated: this.getNoteCreated
        });
    }

    /**
     * What this panel's tab is showing, after search and filters, for the
     * status bar counter (issue #129).
     */
    public getStatusBarCounts(): StatusBarCounts {
        if (this.viewMode === 'collections' && !this.currentCollectionId) {
            return { collections: this.plugin.collectionsManager.getAllCollections().length };
        }
        // Tabs that span several notes also count the notes, like their group headers
        return countHighlights(this.getCurrentlyVisibleHighlights(), this.viewMode !== 'current');
    }

    /**
     * Add the "copy visible results" entry, with a format submenu.
     *
     * Obsidian supports submenus at runtime but `setSubmenu` is absent from the
     * published typings, so it is probed rather than assumed; without it the
     * three formats are added as flat items so the feature still works.
     */
    private addCopyVisibleMenuItems(menu: Menu) {
        const count = this.getCurrentlyVisibleHighlights().length;
        const title = t('toolbar.copyVisibleHighlights', { count });

        const formats: Array<{ format: CopyFormat; label: string; icon: string }> = [
            { format: 'with-syntax', label: t('toolbar.copyFormat.withSyntax'), icon: 'code' },
            { format: 'plain', label: t('toolbar.copyFormat.plain'), icon: 'type' },
            { format: 'list', label: t('toolbar.copyFormat.list'), icon: 'list' }
        ];

        const copy = (format: CopyFormat) => void this.copyVisibleHighlightsToClipboard(format);

        let usedSubmenu = false;

        menu.addItem((item) => {
            item.setTitle(title).setIcon('copy').setDisabled(count === 0);

            const submenuCapable = item as MenuItem & { setSubmenu?: () => Menu };
            if (typeof submenuCapable.setSubmenu !== 'function') {
                return;
            }

            try {
                const submenu = submenuCapable.setSubmenu();
                for (const { format, label, icon } of formats) {
                    submenu.addItem((sub) =>
                        sub.setTitle(label).setIcon(icon).onClick(() => copy(format))
                    );
                }
                usedSubmenu = true;
            } catch (error) {
                console.warn('Failed to build copy submenu, falling back to flat items:', error);
            }
        });

        if (usedSubmenu) {
            return;
        }

        for (const { format, label, icon } of formats) {
            menu.addItem((item) =>
                item
                    .setTitle(`${title} — ${label}`)
                    .setIcon(icon)
                    .setDisabled(count === 0)
                    .onClick(() => copy(format))
            );
        }
    }

    /**
     * Copy all currently-visible (post-filter) highlights to the clipboard.
     * Notifies the user of the count.
     */
    private async copyVisibleHighlightsToClipboard(format: CopyFormat) {
        const visible = this.getCurrentlyVisibleHighlights();
        if (visible.length === 0) {
            new Notice(t('notices.noHighlightsToCopy'));
            return;
        }

        // Sort by file path then position so the output reflects document order.
        const ordered = [...visible].sort((a, b) => {
            if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
            return a.startOffset - b.startOffset;
        });

        const text = joinHighlightEntries(
            ordered.map(h => formatHighlightForCopy(h, format)),
            format
        );

        await this.writeToClipboard(text, visible.length);
    }

    /**
     * Write text to the clipboard, falling back to a hidden textarea when the
     * async clipboard API is unavailable or blocked.
     */
    private async writeToClipboard(text: string, count: number) {
        try {
            await navigator.clipboard.writeText(text);
            new Notice(t('notices.copiedHighlights', { count }));
            return;
        } catch {
            // Fall through to the textarea approach below.
        }

        const textArea = createEl('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            new Notice(t('notices.copiedHighlights', { count }));
        } catch {
            new Notice(t('notices.copyFailed'));
        }
        document.body.removeChild(textArea);
    }

    /**
     * Find the markdown view that follow-scroll should track. Tries the active
     * leaf first; if that's not a markdown view (e.g. focus is on the sidebar),
     * falls back to scanning open leaves for the one whose file matches
     * `getActiveFile()`. Returns null only when no markdown editor is open at
     * all (or when reading mode has no editor instance).
     */
    private getTargetMarkdownView(): MarkdownView | null {
        // Prefer the truly-active markdown view.
        const active = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (active && active.editor) return active;

        // Fall back: find a markdown leaf showing the workspace's "active file".
        // (`getActiveFile()` reflects the most recently active markdown file
        // even when focus is on the sidebar.)
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) return null;

        const leaves = this.plugin.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.editor && view.file?.path === activeFile.path) {
                return view;
            }
        }

        // Last resort: any markdown view at all.
        for (const leaf of leaves) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.editor) {
                return view;
            }
        }

        return null;
    }

    /**
     * Get the visible line range of the target markdown editor: the top,
     * middle, and bottom lines (0-based) currently in the scroll viewport.
     * Returns null in reading mode or when no editor is available.
     */
    private getEditorVisibleLineRange(): { top: number; middle: number; bottom: number } | null {
        const targetView = this.getTargetMarkdownView();
        if (!targetView || !targetView.editor) return null;

        const cm = (targetView.editor as unknown as { cm?: CodeMirrorEditorView }).cm;
        if (!cm || !cm.state || !cm.scrollDOM) return null;

        try {
            const rect = cm.scrollDOM.getBoundingClientRect();
            const middleY = (rect.top + rect.bottom) / 2;
            const x = rect.left + 1;

            const topPos = cm.posAtCoords({ x, y: rect.top + 1 });
            const middlePos = cm.posAtCoords({ x, y: middleY });
            const bottomPos = cm.posAtCoords({ x, y: rect.bottom - 1 });

            if (topPos == null || middlePos == null || bottomPos == null) return null;

            // CM6 line numbers are 1-based; highlight.line is 0-based.
            const topLine = cm.state.doc.lineAt(topPos).number - 1;
            const middleLine = cm.state.doc.lineAt(middlePos).number - 1;
            const bottomLine = cm.state.doc.lineAt(bottomPos).number - 1;

            return {
                top: Math.min(topLine, bottomLine),
                middle: middleLine,
                bottom: Math.max(topLine, bottomLine),
            };
        } catch {
            return null;
        }
    }

    /**
     * Find the highlight that best represents the editor's current visible
     * area, then center it in the sidebar with smooth scrolling and apply the
     * selected styling. Only runs in 'current' note mode.
     *
     * Match preference:
     *   1. If any highlights are inside the visible viewport, pick the one
     *      whose line is closest to the editor's middle visible line.
     *   2. Otherwise, fall back to the highlight closest by absolute line
     *      distance to the middle.
     */
    private syncSidebarToEditorScroll() {
        if (!this.followEditorScroll) return;
        if (this.viewMode !== 'current' && this.viewMode !== 'folder') return;
        if (!this.contentAreaEl) return;

        // Pause sync briefly after the user has scrolled the sidebar by hand,
        // so we don't yank them back while they're browsing.
        if (Date.now() - this.lastManualSidebarScrollAt < HighlightsSidebarView.FOLLOW_SCROLL_PAUSE_MS) {
            return;
        }

        const range = this.getEditorVisibleLineRange();
        if (!range) return;

        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) return;

        const fileHighlights = this.plugin.highlights.get(activeFile.path);
        if (!fileHighlights || fileHighlights.length === 0) return;

        // First pass: find the highlight in the visible range closest to the middle.
        let target: Highlight | null = null;
        let minDistance = Infinity;
        for (const h of fileHighlights) {
            if (h.line < range.top || h.line > range.bottom) continue;
            const distance = Math.abs(h.line - range.middle);
            if (distance < minDistance) {
                minDistance = distance;
                target = h;
            }
        }

        // Second pass (fallback): nothing in the viewport — pick absolute closest.
        if (!target) {
            minDistance = Infinity;
            for (const h of fileHighlights) {
                const distance = Math.abs(h.line - range.middle);
                if (distance < minDistance) {
                    minDistance = distance;
                    target = h;
                }
            }
        }
        if (!target) return;

        // If we're already on this highlight, nothing to do.
        if (this.followScrollSelectedId === target.id) return;

        const targetEl = this.containerEl.querySelector<HTMLElement>(
            `[data-highlight-id="${target.id}"]`
        );
        if (!targetEl) return;

        // Apply selected styling, clearing any previous follow-scroll selection.
        this.applyFollowScrollSelection(target, targetEl);

        // Smooth-scroll the sidebar so the target is centered vertically.
        const containerRect = this.contentAreaEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const targetCenter = targetRect.top + targetRect.height / 2;
        const containerCenter = containerRect.top + containerRect.height / 2;
        const delta = targetCenter - containerCenter;

        this.contentAreaEl.scrollTo({
            top: this.contentAreaEl.scrollTop + delta,
            behavior: 'smooth'
        });
    }

    /**
     * Apply the 'selected' visual styling to a highlight item, clearing any
     * previous follow-scroll selection. Mirrors the click-selection styling.
     */
    private applyFollowScrollSelection(highlight: Highlight, targetEl: HTMLElement) {
        // Clear previous follow-scroll selection (if any) and any other selected items
        const previouslySelected = this.containerEl.querySelectorAll('.selected, .highlight-selected');
        previouslySelected.forEach(el => {
            el.classList.remove('selected', 'highlight-selected');
            (el as HTMLElement).style.removeProperty('border-left-color');
            (el as HTMLElement).style.removeProperty('box-shadow');
        });

        // Apply selected styling to the new target
        targetEl.classList.add('selected', 'highlight-selected');
        const highlightColor = highlight.color || this.plugin.settings.highlightColor;
        targetEl.style.borderLeftColor = highlightColor;
        if (!highlight.isNativeComment) {
            targetEl.style.boxShadow = `0 0 0 1.5px ${highlightColor}, var(--shadow-s)`;
        }

        this.followScrollSelectedId = highlight.id;
    }

    /**
     * Clear follow-scroll selected styling (used when toggling the feature off).
     */
    private clearFollowScrollSelection() {
        if (!this.followScrollSelectedId) return;
        const el = this.containerEl.querySelector<HTMLElement>(
            `[data-highlight-id="${this.followScrollSelectedId}"]`
        );
        if (el) {
            el.classList.remove('selected', 'highlight-selected');
            el.style.removeProperty('border-left-color');
            el.style.removeProperty('box-shadow');
        }
        this.followScrollSelectedId = null;
    }

    /**
     * Attach a scroll listener to the target markdown editor's CodeMirror
     * scroll container. Debounced so we don't thrash during fast scrolls.
     *
     * This is idempotent and target-aware: if we're already attached to the
     * correct view, it does nothing. If the user switches to a different
     * markdown file, it swaps the listener. If the user clicks the sidebar
     * (no markdown view is "active" anymore but we still have a target via
     * the fallback in getTargetMarkdownView), the listener stays attached to
     * the same editor — so scrolling the editor still works without focus.
     */
    private attachEditorScrollListener() {
        if (!this.followEditorScroll) {
            this.detachEditorScrollListener();
            return;
        }

        const targetView = this.getTargetMarkdownView();

        // No target → tear down whatever we have.
        if (!targetView || !targetView.editor) {
            this.detachEditorScrollListener();
            return;
        }

        // Already attached to this exact view? Nothing to do.
        if (this.attachedMarkdownView === targetView && this.editorScrollCleanup) {
            return;
        }

        // Different target — detach the old listener (but keep the manual-scroll
        // tracker on the sidebar; that doesn't depend on the editor).
        if (this.editorScrollCleanup) {
            this.editorScrollCleanup();
            this.editorScrollCleanup = null;
        }
        this.attachedMarkdownView = null;

        const cm = (targetView.editor as unknown as { cm?: CodeMirrorEditorView }).cm;
        if (!cm || !cm.scrollDOM) return;

        const scrollEl = cm.scrollDOM;

        const onScroll = () => {
            if (this.followScrollDebounce != null) {
                window.clearTimeout(this.followScrollDebounce);
            }
            this.followScrollDebounce = window.setTimeout(() => {
                this.followScrollDebounce = null;
                this.syncSidebarToEditorScroll();
            }, 80);
        };

        scrollEl.addEventListener('scroll', onScroll, { passive: true });

        this.editorScrollCleanup = () => {
            scrollEl.removeEventListener('scroll', onScroll);
        };
        this.attachedMarkdownView = targetView;

        // Also start tracking manual sidebar scroll, so we can pause sync when
        // the user is browsing the sidebar by hand. (Idempotent — re-attaches
        // cleanly each time.)
        this.attachSidebarManualScrollTracker();
    }

    private detachEditorScrollListener() {
        if (this.editorScrollCleanup) {
            this.editorScrollCleanup();
            this.editorScrollCleanup = null;
        }
        this.attachedMarkdownView = null;
        if (this.followScrollDebounce != null) {
            window.clearTimeout(this.followScrollDebounce);
            this.followScrollDebounce = null;
        }
        this.detachSidebarManualScrollTracker();
    }

    /**
     * Track wheel/touch input on the sidebar's scroll container so we can
     * detect when the user is manually scrolling and pause auto-sync.
     */
    private attachSidebarManualScrollTracker() {
        this.detachSidebarManualScrollTracker();
        if (!this.contentAreaEl) return;

        const markManual = () => {
            this.lastManualSidebarScrollAt = Date.now();
        };

        this.contentAreaEl.addEventListener('wheel', markManual, { passive: true });
        this.contentAreaEl.addEventListener('touchstart', markManual, { passive: true });

        this.sidebarManualScrollCleanup = () => {
            this.contentAreaEl.removeEventListener('wheel', markManual);
            this.contentAreaEl.removeEventListener('touchstart', markManual);
        };
    }

    private detachSidebarManualScrollTracker() {
        if (this.sidebarManualScrollCleanup) {
            this.sidebarManualScrollCleanup();
            this.sidebarManualScrollCleanup = null;
        }
    }

    private handleSearchInput(query: string, parsed: ParsedSearch): void {
        this.currentParsedSearch = parsed;
        this.currentSearchTokens = SearchParser.getTokensFromQuery(query);
        this.renderContent();
    }

    private removeSearchToken(token: SearchToken): void {
        // Update the suggestions when tags/collections change
        this.simpleSearchManager.updateSuggestions({
            tags: this.getAvailableTags(),
            collections: this.getAvailableCollections()
        });
    }

    private getHighlightById(highlightId: string): Highlight | null {
        for (const highlights of this.plugin.highlights.values()) {
            const highlight = highlights.find(h => h.id === highlightId);
            if (highlight) {
                return highlight;
            }
        }
        return null;
    }


    private getAvailableTags(): string[] {
        const tags = new Set<string>();
        for (const highlights of this.plugin.highlights.values()) {
            for (const highlight of highlights) {
                const extractedTags = this.extractTagsFromHighlight(highlight);
                extractedTags.forEach(tag => tags.add(tag));
            }
        }
        return Array.from(tags).sort();
    }

    private getAvailableCollections(): string[] {
        return this.plugin.collectionsManager.getAllCollections().map(c => c.name).sort();
    }


    private applyAllFilters(highlights: Highlight[]): Highlight[] {
        return highlights.filter(highlight => {
            // 1. Apply smart search filtering
            const smartSearchMatch = this.passesSmartSearchFilter(highlight);
            if (!smartSearchMatch) return false;

            // 2. Apply existing tag filter dropdown (AND with smart search)
            if (this.selectedTags.size > 0) {
                const highlightTags = this.extractTagsFromHighlight(highlight);
                const tagFilterMatch = Array.from(this.selectedTags).some(selectedTag => 
                    highlightTags.includes(selectedTag)
                );
                if (!tagFilterMatch) return false;
            }

            // 3. Apply existing collection filter dropdown (AND with smart search) 
            if (this.selectedCollections.size > 0) {
                const highlightCollections = this.plugin.collectionsManager.getCollectionsForHighlight(highlight.id);
                const collectionFilterMatch = Array.from(this.selectedCollections).some(selectedCollection => 
                    highlightCollections.some(collection => collection.name === selectedCollection)
                );
                if (!collectionFilterMatch) return false;
            }

            // 4. Apply the colour filter dropdown (AND with smart search)
            if (this.selectedColors.size > 0) {
                const color = resolveHighlightColor(highlight.color, this.plugin.settings.highlightColor);
                if (!this.selectedColors.has(color)) return false;
            }

            // 5. Apply the type filter (highlights, native comments, or both)
            if (!matchesTypeFilter(highlight.isNativeComment, this.typeFilter)) {
                return false;
            }

            // 5. Apply minimum character count filtering (for highlights and native comments only)
            if (!meetsMinimumCharacterCount(highlight, this.plugin.settings.minimumCharacterCount)) {
                return false;
            }

            return true;
        });
    }

    private passesSmartSearchFilter(highlight: Highlight): boolean {
        if (!this.currentParsedSearch.ast) {
            return true;
        }

        return this.evaluateASTNode(this.currentParsedSearch.ast, highlight);
    }

    private evaluateASTNode(node: ASTNode, highlight: Highlight): boolean {
        if (node.type === 'filter') {
            const filterNode = node as FilterNode;
            const matches = this.highlightMatchesFilter(highlight, filterNode);
            return filterNode.exclude ? !matches : matches;
        } else if (node.type === 'text') {
            const textNode = node as TextNode;
            return highlightDisplayText(highlight).toLowerCase().includes(textNode.value.toLowerCase()) ||
                   highlight.filePath.toLowerCase().replace(/\.md$/, '').includes(textNode.value.toLowerCase());
        } else if (node.type === 'operator') {
            const opNode = node as OperatorNode;
            
            const leftResult = this.evaluateASTNode(opNode.left, highlight);
            const rightResult = this.evaluateASTNode(opNode.right, highlight);
            
            return opNode.operator === 'AND' 
                ? leftResult && rightResult 
                : leftResult || rightResult;
        }
        return false;
    }

    private isConsecutiveTextNodes(opNode: OperatorNode): boolean {
        // Check if this AND operation connects only text nodes (directly or through other AND operations)
        return this.containsOnlyTextNodes(opNode.left) && this.containsOnlyTextNodes(opNode.right);
    }

    private containsOnlyTextNodes(node: ASTNode): boolean {
        if (node.type === 'text') {
            return true;
        } else if (node.type === 'operator') {
            const opNode = node as OperatorNode;
            return opNode.operator === 'AND' && 
                   this.containsOnlyTextNodes(opNode.left) && 
                   this.containsOnlyTextNodes(opNode.right);
        }
        return false;
    }

    private extractConsecutiveText(node: ASTNode): string {
        if (node.type === 'text') {
            const textNode = node as TextNode;
            return textNode.value;
        } else if (node.type === 'operator') {
            const opNode = node as OperatorNode;
            const leftText = this.extractConsecutiveText(opNode.left);
            const rightText = this.extractConsecutiveText(opNode.right);
            return `${leftText} ${rightText}`;
        }
        return '';
    }

    private highlightMatchesFilter(highlight: Highlight, filterNode: FilterNode): boolean {
        if (filterNode.filterType === 'tag') {
            const extractedTags = this.extractTagsFromHighlight(highlight);
            return extractedTags.includes(filterNode.value);
        } else if (filterNode.filterType === 'collection') {
            const highlightCollections = this.plugin.collectionsManager.getCollectionsForHighlight(highlight.id);
            const collectionNames = highlightCollections.map(collection => collection.name);
            return collectionNames.includes(filterNode.value);
        }
        return false;
    }
}
