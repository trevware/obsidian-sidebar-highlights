import { ItemView, WorkspaceLeaf, MarkdownView, TFile, Menu, Notice, setIcon, setTooltip, Keymap, Modal, App, moment } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import type { Highlight, Collection, CommentPluginSettings, Task } from '../../main';
import { NewCollectionModal, EditCollectionModal } from '../modals/collection-modals';
import { DropdownManager, DropdownItem } from '../managers/dropdown-manager';
import { HighlightRenderer, HighlightRenderOptions } from '../renderers/highlight-renderer';
import { TaskRenderer, TaskRenderOptions } from '../renderers/task-renderer';
import { TaskManager } from '../managers/task-manager';
import { InlineFootnoteManager } from '../managers/inline-footnote-manager';
import { SearchParser, SearchToken, ParsedSearch, ASTNode, OperatorNode, FilterNode, TextNode } from '../utils/search-parser';
import { SimpleSearchManager } from '../managers/simple-search-manager';
import { STANDARD_FOOTNOTE_REGEX, FOOTNOTE_VALIDATION_REGEX } from '../utils/regex-patterns';
import { HtmlHighlightParser } from '../utils/html-highlight-parser';
import { DateSuggest } from '../utils/date-suggest';
import { t } from '../i18n';

const VIEW_TYPE_HIGHLIGHTS = 'highlights-sidebar';

export class HighlightsSidebarView extends ItemView {
    plugin: HighlightCommentsPlugin;
    private searchInputEl!: HTMLInputElement;
    private listContainerEl!: HTMLElement;
    private contentAreaEl!: HTMLElement;
    private highlightCommentsVisible: Map<string, boolean> = new Map();
    private groupingMode: 'none' | 'color' | 'comments-asc' | 'comments-desc' | 'tag' | 'parent' | 'collection' | 'filename' | 'date-created-asc' | 'date-created-desc' | 'date-asc' = 'none';
    private taskSecondaryGroupingMode: 'none' | 'tag' | 'date' | 'flagged' = 'none';
    private sortMode: 'none' | 'alphabetical-asc' | 'alphabetical-desc' = 'none';
    private commentsExpanded: boolean = false;
    private commentsToggleButton!: HTMLElement;
    private selectedTags: Set<string> = new Set();
    private selectedCollections: Set<string> = new Set();
    private selectedSpecialFilters: Set<string> = new Set(); // For task special filters (Flagged, Upcoming, etc.)
    private selectedHighlightIds: Set<string> = new Set(); // Multi-select for highlights
    private actionsButton: HTMLElement | null = null; // Actions menu button for multi-select
    private collectionNavButton: HTMLElement | null = null; // Collection navigation button
    private viewMode: 'current' | 'all' | 'collections' | 'tasks' = 'current';
    private currentCollectionId: string | null = null;
    private taskManager: TaskManager;
    private taskRenderer: TaskRenderer;
    private currentTasks: Task[] = [];
    private cachedAllTasks: Task[] | null = null; // Cache all scanned tasks
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

    // Pagination for tasks
    private currentTaskPage: number = 0;
    private totalTasks: Task[] = [];

    private isColorChanging: boolean = false;
    private searchExpanded: boolean = false;
    private isRenderingTasks: boolean = false; // Guard to prevent concurrent task renders
    private recentlyMovedTaskId: string | null = null; // Track task that was just moved for flash animation
    private searchButton!: HTMLElement;
    private simpleSearchManager!: SimpleSearchManager;
    private currentSearchTokens: SearchToken[] = [];
    private currentParsedSearch: ParsedSearch = { ast: null };
    private dropdownManager: DropdownManager = new DropdownManager();
    private highlightRenderer: HighlightRenderer;
    private savedScrollPosition: number = 0; // Store scroll position during rebuilds
    private showNativeComments: boolean = true; // Track native comments visibility
    private sortButton!: HTMLElement; // Store sort button reference for state updates
    private taskRefreshTimeout?: number; // Debounce timer for task auto-refresh
    private collapsedSections: Set<string> = new Set(); // Track collapsed task sections
    private fileTaskCache: Map<string, string[]> = new Map(); // Cache extracted tasks per file for comparison

    constructor(leaf: WorkspaceLeaf, plugin: HighlightCommentsPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.highlightRenderer = new HighlightRenderer(plugin);
        this.taskManager = new TaskManager(plugin);
        this.taskRenderer = new TaskRenderer(plugin);

        // Initialize tabSettings if it doesn't exist
        if (!this.plugin.settings.tabSettings) {
            this.plugin.settings.tabSettings = {};
        }

        // viewMode will be set when tabs are created in onOpen
        // Settings will be loaded via restoreTabSettings when appropriate

        // Load legacy settings as fallback (will be migrated to per-tab on first save)
        this.groupingMode = plugin.settings.groupingMode || 'none';
        this.sortMode = plugin.settings.sortMode || 'none';

        // Load task secondary grouping mode from settings
        this.taskSecondaryGroupingMode = plugin.settings.taskSecondaryGroupingMode || 'none';
        // Load native comments visibility from vault-specific localStorage
        this.showNativeComments = this.plugin.app.loadLocalStorage('sidebar-highlights-show-native-comments') !== 'false';
    }

    getViewType() { return VIEW_TYPE_HIGHLIGHTS; }
    getDisplayText() { return 'Highlights'; }
    getIcon() { return 'highlighter'; }

    /**
     * Get default settings for a specific tab
     */
    private getDefaultTabSettings(viewMode: 'current' | 'all' | 'collections' | 'tasks'): { groupingMode: typeof this.groupingMode, sortMode: typeof this.sortMode, commentsExpanded: boolean, searchExpanded: boolean } {
        // Tasks tab has different defaults
        if (viewMode === 'tasks') {
            return {
                groupingMode: 'none',
                sortMode: 'none',
                commentsExpanded: false,
                searchExpanded: false
            };
        }
        // Highlight tabs (current, all, collections)
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
            selectedSpecialFilters: Array.from(this.selectedSpecialFilters)
        };

        this.plugin.saveSettings();
    }

    /**
     * Restore tab settings when switching tabs
     */
    private restoreTabSettings(viewMode: 'current' | 'all' | 'collections' | 'tasks'): void {
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
            this.selectedSpecialFilters = new Set(tabSettings.selectedSpecialFilters || []);
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
            this.selectedSpecialFilters.clear();
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
            }

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

    public getViewMode(): 'current' | 'all' | 'collections' | 'tasks' {
        return this.viewMode;
    }

    /**
     * Extract task lines AND their context from content for comparison
     * Returns array of normalized task strings (including context lines)
     */
    private extractTaskLines(content: string): string[] {
        const lines = content.split('\n');
        const taskBlocks: string[] = [];
        let currentBlock: string[] = [];
        let inTaskBlock = false;
        let lastHeader: string | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const isTaskLine = /^[\s]*[-*]\s*\[[ xX-]\]/.test(line);
            const isHeader = /^#{1,6}\s+/.test(line);

            // Track the most recent header
            if (isHeader) {
                lastHeader = line.trim();
            }

            if (isTaskLine) {
                // Save previous block if exists
                if (currentBlock.length > 0) {
                    taskBlocks.push(currentBlock.join('\n'));
                }
                // Start new block with header (if any) + task
                currentBlock = [];
                if (lastHeader) {
                    currentBlock.push(lastHeader);
                }
                currentBlock.push(line.trim());
                inTaskBlock = true;
            } else if (inTaskBlock) {
                // Check if this is a context line (indented or starts with whitespace)
                const trimmedLine = line.trim();
                if (trimmedLine.length > 0 && (line.startsWith(' ') || line.startsWith('\t'))) {
                    // This is context for the current task
                    currentBlock.push(line.trim());
                } else if (trimmedLine.length === 0) {
                    // Empty line might still be part of context, but end block after it
                    inTaskBlock = false;
                } else {
                    // Non-indented, non-empty line - end the task block
                    inTaskBlock = false;
                }
            }
        }

        // Don't forget the last block
        if (currentBlock.length > 0) {
            taskBlocks.push(currentBlock.join('\n'));
        }

        return taskBlocks;
    }

    /**
     * Check if tasks have changed between old and new content
     */
    private haveTasksChanged(oldContent: string, newContent: string): boolean {
        const oldTasks = this.extractTaskLines(oldContent);
        const newTasks = this.extractTaskLines(newContent);

        // Quick length check
        if (oldTasks.length !== newTasks.length) {
            return true;
        }

        // Deep comparison - check if any task content changed
        for (let i = 0; i < oldTasks.length; i++) {
            if (oldTasks[i] !== newTasks[i]) {
                return true;
            }
        }

        return false;
    }

    async onOpen(skipInitialRender: boolean = false) {
        this.contentEl.empty();
        this.contentEl.classList.add('highlights-sidebar-content');

        // Only create the search container if toolbar is enabled
        if (this.plugin.settings.showToolbar) {
            const searchContainer = this.contentEl.createDiv({ cls: 'highlights-search-container' });
            
            // Replace search input with search button
            const searchButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            this.searchButton = searchButton;
            setIcon(searchButton, 'search');
            setTooltip(searchButton, t('toolbar.search'));
            searchButton.addEventListener('click', () => {
                this.toggleSearch();
            });

            const groupButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setIcon(groupButton, 'group');
            setTooltip(groupButton, t('toolbar.group'));
            this.updateGroupButtonState(groupButton);
            groupButton.addEventListener('click', (event) => {
                const menu = new Menu();
                const isTasksView = this.viewMode === 'tasks';

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.none'))
                        .setIcon('list')
                        .setChecked(this.groupingMode === 'none')
                        .onClick(() => {
                            this.groupingMode = 'none';
                            // Reset secondary grouping when primary grouping is disabled
                            if (this.taskSecondaryGroupingMode !== 'none') {
                                this.taskSecondaryGroupingMode = 'none';
                                this.saveTaskSecondaryGroupingModeToSettings();
                            }
                            this.updateGroupButtonState(groupButton);
                            this.updateSortButtonState(this.sortButton);
                            // COMMENTED OUT FOR NOW
                            /*
                            const secondaryGroupButton = this.contentEl.querySelector('.highlights-secondary-group-button') as HTMLElement;
                            if (secondaryGroupButton) {
                                this.updateSecondaryGroupButtonState(secondaryGroupButton);
                            }
                            */
                            this.saveGroupingModeToSettings();
                            // Use renderContent instead of renderFilteredList to handle all view modes
                            this.renderContent();
                        });
                });

                // Only show these grouping options for highlights, not tasks
                if (!isTasksView) {
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
                }

                menu.addSeparator();

                // Only show parent grouping for highlights
                if (!isTasksView) {
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
                }

                // Only show date grouping for tasks
                if (isTasksView) {
                    menu.addSeparator();

                    menu.addItem((item) => {
                        item
                            .setTitle(t('grouping.dueDate'))
                            .setIcon('calendar')
                            .setChecked(this.groupingMode === 'date-asc')
                            .onClick(() => {
                                this.groupingMode = 'date-asc';
                                this.updateGroupButtonState(groupButton);
                                this.updateSortButtonState(this.sortButton);
                                this.saveGroupingModeToSettings();
                                this.renderContent();
                            });
                    });

                    menu.addSeparator();
                }

                // Only show collection grouping for highlights
                if (!isTasksView) {
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
                }

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

            // Add secondary grouping button for tasks (positioned between group and sort buttons)
            // COMMENTED OUT FOR NOW
            /*
            const secondaryGroupButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button highlights-secondary-group-button'
            });
            setIcon(secondaryGroupButton, 'list-tree');
            setTooltip(secondaryGroupButton, t('toolbar.secondaryGroup'));
            this.updateSecondaryGroupButtonState(secondaryGroupButton);
            secondaryGroupButton.addEventListener('click', (event) => {
                const menu = new Menu();

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.none'))
                        .setIcon('list')
                        .setChecked(this.taskSecondaryGroupingMode === 'none')
                        .onClick(() => {
                            this.taskSecondaryGroupingMode = 'none';
                            this.updateSecondaryGroupButtonState(secondaryGroupButton);
                            this.saveTaskSecondaryGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.tag'))
                        .setIcon('hash')
                        .setChecked(this.taskSecondaryGroupingMode === 'tag')
                        .onClick(() => {
                            this.taskSecondaryGroupingMode = 'tag';
                            this.updateSecondaryGroupButtonState(secondaryGroupButton);
                            this.saveTaskSecondaryGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.date'))
                        .setIcon('calendar')
                        .setChecked(this.taskSecondaryGroupingMode === 'date')
                        .onClick(() => {
                            this.taskSecondaryGroupingMode = 'date';
                            this.updateSecondaryGroupButtonState(secondaryGroupButton);
                            this.saveTaskSecondaryGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle(t('grouping.flagged'))
                        .setIcon('flag')
                        .setChecked(this.taskSecondaryGroupingMode === 'flagged')
                        .onClick(() => {
                            this.taskSecondaryGroupingMode = 'flagged';
                            this.updateSecondaryGroupButtonState(secondaryGroupButton);
                            this.saveTaskSecondaryGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.showAtMouseEvent(event);
            });
            */

            // Add sort button (positioned after group button)
            this.sortButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
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

                menu.showAtMouseEvent(event);
            });

            // Add toggle native comments button (positioned after sort button)
            const nativeCommentsToggleButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setTooltip(nativeCommentsToggleButton, t('toolbar.toggleComments'));
            this.updateNativeCommentsToggleState(nativeCommentsToggleButton);
            nativeCommentsToggleButton.addEventListener('click', () => {
                this.toggleNativeCommentsVisibility();
                this.updateNativeCommentsToggleState(nativeCommentsToggleButton);
                this.renderContent();
            });

            this.commentsToggleButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setTooltip(this.commentsToggleButton, t('toolbar.toggleHighlightComments'));
            this.updateCommentsToggleIcon(this.commentsToggleButton);
            this.commentsToggleButton.addEventListener('click', () => {
                this.toggleAllComments();
                this.updateCommentsToggleIcon(this.commentsToggleButton);
                this.renderContent(); // Use renderContent instead of renderFilteredList
            });

            const resetColorsButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setTooltip(resetColorsButton, t('toolbar.revertColors'));
            setIcon(resetColorsButton, 'rotate-ccw');
            resetColorsButton.addEventListener('click', () => {
                this.resetAllColors();
            });

            const tagFilterButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button highlights-tag-filter-button'
            });
            setTooltip(tagFilterButton, t('toolbar.filter'));
            setIcon(tagFilterButton, 'list-filter');
            
            tagFilterButton.addEventListener('click', (event) => {
                this.showTagFilterMenu(event);
            });

            // Add collection navigation button (New Collection / Back to Collections)
            this.collectionNavButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
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
                cls: 'highlights-group-button'
            });
            setTooltip(this.actionsButton, t('toolbar.actions'));
            setIcon(this.actionsButton, 'ellipsis');
            this.actionsButton.style.display = 'none'; // Hidden by default

            this.actionsButton.addEventListener('click', (event) => {
                this.showActionsMenu(event);
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

        // Determine which tab should be active by default
        let defaultActive = false;

        let currentNoteTab: HTMLElement | null = null;
        if (this.plugin.settings.showCurrentNoteTab) {
            currentNoteTab = tabsContainer.createEl('button', {
                cls: 'highlights-tab' + (!defaultActive ? ' active' : '')
            });
            setIcon(currentNoteTab, 'file-text');
            setTooltip(currentNoteTab, t('tabs.currentNote'));
            if (!defaultActive) {
                this.viewMode = 'current';
                defaultActive = true;
            }
        }

        let allNotesTab: HTMLElement | null = null;
        if (this.plugin.settings.showAllNotesTab) {
            allNotesTab = tabsContainer.createEl('button', {
                cls: 'highlights-tab' + (!defaultActive ? ' active' : '')
            });
            setIcon(allNotesTab, 'files');
            setTooltip(allNotesTab, t('tabs.allNotes'));
            if (!defaultActive) {
                this.viewMode = 'all';
                defaultActive = true;
            }
        }

        let collectionsTab: HTMLElement | null = null;
        if (this.plugin.settings.showCollectionsTab) {
            collectionsTab = tabsContainer.createEl('button', {
                cls: 'highlights-tab' + (!defaultActive ? ' active' : '')
            });
            setIcon(collectionsTab, 'folder-open');
            setTooltip(collectionsTab, t('tabs.collections'));
            if (!defaultActive) {
                this.viewMode = 'collections';
                defaultActive = true;
            }
        }

        let tasksTab: HTMLElement | null = null;
        if (this.plugin.settings.showTasksTab) {
            tasksTab = tabsContainer.createEl('button', {
                cls: 'highlights-tab' + (!defaultActive ? ' active' : '')
            });
            setIcon(tasksTab, 'circle-check');
            setTooltip(tasksTab, t('tabs.tasks'));
            if (!defaultActive) {
                this.viewMode = 'tasks';
                defaultActive = true;
            }
        }

        // Add click handlers
        if (currentNoteTab) {
            currentNoteTab.addEventListener('click', () => {
                if (this.viewMode !== 'current') {
                    currentNoteTab!.classList.add('active');
                    if (allNotesTab) allNotesTab.classList.remove('active');
                    if (collectionsTab) collectionsTab.classList.remove('active');
                    if (tasksTab) tasksTab.classList.remove('active');
                    this.viewMode = 'current';
                    this.clearSelection(); // Clear multi-select when switching tabs
                    this.restoreTabSettings('current'); // Restore tab-specific settings (including filters)
                    this.updateContent(); // Content update instead of full rebuild
                }
            });
        }

        if (allNotesTab) {
            allNotesTab.addEventListener('click', () => {
                if (this.viewMode !== 'all') {
                    allNotesTab!.classList.add('active');
                    if (currentNoteTab) currentNoteTab.classList.remove('active');
                    if (collectionsTab) collectionsTab.classList.remove('active');
                    if (tasksTab) tasksTab.classList.remove('active');
                    this.viewMode = 'all';
                    this.clearSelection(); // Clear multi-select when switching tabs
                    this.restoreTabSettings('all'); // Restore tab-specific settings (including filters)
                    this.updateContent(); // Content update instead of full rebuild
                }
            });
        }

        if (collectionsTab) {
            collectionsTab.addEventListener('click', () => {
                if (this.viewMode !== 'collections') {
                    collectionsTab!.classList.add('active');
                    if (currentNoteTab) currentNoteTab.classList.remove('active');
                    if (allNotesTab) allNotesTab.classList.remove('active');
                    if (tasksTab) tasksTab.classList.remove('active');
                    this.viewMode = 'collections';
                    this.clearSelection(); // Clear multi-select when switching tabs
                    this.restoreTabSettings('collections'); // Restore tab-specific settings (including filters)
                    this.currentCollectionId = null;
                    this.updateContent(); // Content update instead of full rebuild
                }
            });
        }

        if (tasksTab) {
            tasksTab.addEventListener('click', () => {
                if (this.viewMode !== 'tasks') {
                    tasksTab!.classList.add('active');
                    if (currentNoteTab) currentNoteTab.classList.remove('active');
                    if (allNotesTab) allNotesTab.classList.remove('active');
                    if (collectionsTab) collectionsTab.classList.remove('active');
                    this.viewMode = 'tasks';
                    this.clearSelection(); // Clear multi-select when switching tabs
                    this.restoreTabSettings('tasks'); // Restore tab-specific settings (including filters)
                    this.updateContent(); // Content update instead of full rebuild
                }
            });
        }

        this.contentAreaEl = this.contentEl.createDiv({ cls: 'highlights-list-area' });
        this.listContainerEl = this.contentAreaEl.createDiv({ cls: 'highlights-list' });

        // Register vault events for task auto-updates
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (file instanceof TFile && this.viewMode === 'tasks') {
                    // Get current content
                    const newContent = await this.app.vault.cachedRead(file);

                    // Get previous content from cache (or read from file if not cached)
                    const cachedTasks = this.fileTaskCache.get(file.path);
                    const oldContent = cachedTasks ? cachedTasks.join('\n') : '';

                    // Check if tasks have actually changed
                    const tasksChanged = this.haveTasksChanged(oldContent, newContent);

                    if (tasksChanged) {
                        // Update cache with new task content
                        this.fileTaskCache.set(file.path, this.extractTaskLines(newContent));

                        // Debounce to avoid excessive re-renders
                        if (this.taskRefreshTimeout) {
                            window.clearTimeout(this.taskRefreshTimeout);
                        }
                        this.taskRefreshTimeout = window.setTimeout(async () => {
                            // Only re-scan the modified file, not all files
                            if (this.cachedAllTasks) {
                                // Remove old tasks from this file
                                this.cachedAllTasks = this.cachedAllTasks.filter(task => task.filePath !== file.path);

                                // Re-scan just this file for new tasks
                                const newFileTasks = await this.taskManager.scanFileForTasks(
                                    file,
                                    true, // Include completed tasks
                                    this.plugin.settings.showTaskContext
                                );

                                // Add the new tasks from this file
                                this.cachedAllTasks.push(...newFileTasks);
                            } else {
                                // No cache yet, clear it to trigger full scan
                                this.cachedAllTasks = null;
                            }

                            // Re-render with updated cache (no full rescan!)
                            this.renderContent();
                        }, 1000); // 1 second - consistent with highlight detection debounce
                    }
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (file instanceof TFile && this.viewMode === 'tasks') {
                    // Check if new file contains tasks
                    const content = await this.app.vault.cachedRead(file);
                    const tasks = this.extractTaskLines(content);

                    if (tasks.length > 0) {
                        // Initialize cache for this file
                        this.fileTaskCache.set(file.path, tasks);
                        this.cachedAllTasks = null;

                        // Debounce to avoid excessive re-renders during bulk operations
                        if (this.taskRefreshTimeout) {
                            window.clearTimeout(this.taskRefreshTimeout);
                        }
                        this.taskRefreshTimeout = window.setTimeout(() => {
                            this.renderContent();
                        }, 300);
                    }
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file instanceof TFile && this.viewMode === 'tasks') {
                    // Clear cache for deleted file
                    this.fileTaskCache.delete(file.path);
                    this.cachedAllTasks = null;

                    // Debounce to avoid excessive re-renders during bulk deletions
                    if (this.taskRefreshTimeout) {
                        window.clearTimeout(this.taskRefreshTimeout);
                    }
                    this.taskRefreshTimeout = window.setTimeout(() => {
                        this.renderContent();
                    }, 300);
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (file instanceof TFile && this.viewMode === 'tasks') {
                    // Update cache for renamed file
                    this.fileTaskCache.delete(oldPath);
                    // Re-extract tasks from the file with new path
                    const content = await this.app.vault.cachedRead(file);
                    this.fileTaskCache.set(file.path, this.extractTaskLines(content));
                    this.cachedAllTasks = null;

                    // Debounce to avoid excessive re-renders during bulk operations
                    if (this.taskRefreshTimeout) {
                        window.clearTimeout(this.taskRefreshTimeout);
                    }
                    this.taskRefreshTimeout = window.setTimeout(() => {
                        this.renderContent();
                    }, 300);
                }
            })
        );

        // Restore settings for the initial viewMode
        this.restoreTabSettings(this.viewMode);

        // Only render if not skipping initial render (e.g., when called from refresh)
        if (!skipInitialRender) {
            this.renderContent();
        }
    }

    async onClose() {
        // Clean up dropdown manager
        this.dropdownManager.cleanup();
        
        // Reset flags

        // Clear maps to free memory
        this.highlightCommentsVisible.clear();
        this.selectedTags.clear();
        this.selectedSpecialFilters.clear();
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
        
        // Update the tab state to show collections tab as active
        // Get tabs by their order since they don't have data-tab attributes
        const tabs = this.contentEl.querySelectorAll('.highlights-tab');
        if (tabs.length >= 3) {
            const currentNoteTab = tabs[0] as HTMLElement;  // First tab
            const allNotesTab = tabs[1] as HTMLElement;     // Second tab  
            const collectionsTab = tabs[2] as HTMLElement;  // Third tab
            
            // Remove active class from all tabs
            currentNoteTab.classList.remove('active');
            allNotesTab.classList.remove('active');
            collectionsTab.classList.remove('active');
            
            // Add active class to collections tab
            collectionsTab.classList.add('active');
        }

        // Clear any tag filters
        this.selectedTags.clear();
        this.selectedSpecialFilters.clear();

        // Render the collection detail view
        this.renderContent();
    }

    refresh() {
        this.selectedTags.clear();
        this.selectedSpecialFilters.clear();
        // Invalidate task cache on refresh (settings may have changed)
        this.cachedAllTasks = null;
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
        this.onOpen(true);

        // Restore the view mode and collection state after DOM recreation
        this.viewMode = currentViewMode;
        this.currentCollectionId = currentCollectionId;

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
            requestAnimationFrame(() => {
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
        // Get tabs by their order since they don't have data-tab attributes
        const tabs = this.contentEl.querySelectorAll('.highlights-tab');

        // Remove active class from all tabs
        tabs.forEach(tab => tab.classList.remove('active'));

        // Build a mapping of which tab index corresponds to which view mode
        // This accounts for hidden tabs (e.g., if only Tasks tab is shown, it's at index 0)
        let tabIndex = 0;
        const tabMapping: { [key: string]: number } = {};

        if (this.plugin.settings.showCurrentNoteTab) {
            tabMapping['current'] = tabIndex++;
        }
        if (this.plugin.settings.showAllNotesTab) {
            tabMapping['all'] = tabIndex++;
        }
        if (this.plugin.settings.showCollectionsTab) {
            tabMapping['collections'] = tabIndex++;
        }
        if (this.plugin.settings.showTasksTab) {
            tabMapping['tasks'] = tabIndex++;
        }

        // Add active class to the correct tab based on current view mode
        const activeTabIndex = tabMapping[this.viewMode];
        if (activeTabIndex !== undefined && tabs[activeTabIndex]) {
            tabs[activeTabIndex].classList.add('active');
        }
    }

    resetToFirstVisibleTab() {
        // Determine which tab should be first based on settings
        if (this.plugin.settings.showCurrentNoteTab) {
            this.viewMode = 'current';
        } else if (this.plugin.settings.showAllNotesTab) {
            this.viewMode = 'all';
        } else if (this.plugin.settings.showCollectionsTab) {
            this.viewMode = 'collections';
            this.currentCollectionId = null; // Reset to collections list view
        } else if (this.plugin.settings.showTasksTab) {
            this.viewMode = 'tasks';
        }
        // Note: Don't call updateTabStates() here - refresh() will do it after rebuilding the DOM
    }

    private captureScrollPosition(): void {
        if (this.contentAreaEl) {
            this.savedScrollPosition = this.contentAreaEl.scrollTop;
        }
    }

    private restoreScrollPosition(): void {
        if (this.contentAreaEl && !this.isHighlightFocusing && !this.isColorChanging) {
            // Use requestAnimationFrame to ensure DOM is updated before restoring scroll
            requestAnimationFrame(() => {
                this.contentAreaEl.scrollTop = this.savedScrollPosition;
            });
        }
    }

    private restoreSelectedHighlight() {
        if (!this.plugin.selectedHighlightId) {
            return;
        }

        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
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
        const tempContainer = document.createElement('div');
        const showFilename = this.viewMode === 'all';
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

    private renderContent() {
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
        } else if (this.viewMode === 'tasks') {
            this.enableSearchAndToolbar();
            this.renderTasksView();
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

            // Native comments count section (show when native comments are enabled)
            if (this.showNativeComments) {
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

    private async renderTasksView() {
        // Guard against concurrent renders (prevents task duplication when grouping is enabled)
        if (this.isRenderingTasks) {
            return;
        }
        this.isRenderingTasks = true;

        try {
            // Capture scroll position before DOM rebuild
            this.captureScrollPosition();

            // Preserve collapsed sections state from DOM before clearing
            this.preserveCollapsedSections();

            this.contentAreaEl.empty();

            // Create the standard list container
            this.listContainerEl = this.contentAreaEl.createDiv({
                cls: 'highlights-list tasks-container'
            });

            let allTasks: Task[];

            // Use cached tasks if available, otherwise scan
            if (this.cachedAllTasks !== null) {
                allTasks = this.cachedAllTasks;
            } else {
                // Show loading state only when actually scanning
                const loadingEl = this.listContainerEl.createDiv({ cls: 'task-loading' });
                loadingEl.textContent = t('emptyStates.loadingTasks');

                // Scan all tasks (always include completed for accurate progress calculation)
                allTasks = await this.taskManager.scanAllTasks(
                    true, // Always scan completed tasks for progress calculation
                    this.plugin.settings.showTaskContext // Show context based on settings
                );

                // Cache the scanned tasks
                this.cachedAllTasks = allTasks;

                // Populate task cache for each file with tasks
                // This provides baseline for future comparisons
                // Read actual file content to capture tasks with context
                this.fileTaskCache.clear();
                const uniqueFilePaths = new Set(allTasks.map(t => t.filePath));
                for (const filePath of uniqueFilePaths) {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        const content = await this.app.vault.cachedRead(file);
                        const taskBlocks = this.extractTaskLines(content);
                        this.fileTaskCache.set(filePath, taskBlocks);
                    }
                }

                // Remove loading state
                loadingEl.remove();
            }

            // Filter by completion status if needed
            let tasks = allTasks;
            if (!this.plugin.settings.showCompletedTasks) {
                tasks = allTasks.filter(task => !task.completed);
            }

            // Store tasks for later use
            this.currentTasks = tasks;

            // Filter tasks by search term if present
            const searchTerm = this.getSearchTerm();
            let filteredTasks = tasks;
            if (searchTerm && searchTerm.length > 0) {
                filteredTasks = tasks.filter(task =>
                    task.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    task.filePath.toLowerCase().includes(searchTerm.toLowerCase())
                );
            }

            // Filter tasks by selected tags if present
            if (this.selectedTags.size > 0) {
                filteredTasks = filteredTasks.filter(task => {
                    // Extract tags from task text using regex
                    const tagRegex = /#([a-zA-Z0-9_-]+)/g;
                    const taskTags: string[] = [];
                    let match;
                    while ((match = tagRegex.exec(task.text)) !== null) {
                        taskTags.push(match[1]);
                    }

                    // Check if any selected tag matches any task tag
                    return Array.from(this.selectedTags).some(selectedTag =>
                        taskTags.includes(selectedTag)
                    );
                });
            }

            // Filter tasks by selected special filters if present
            if (this.selectedSpecialFilters.size > 0) {
                filteredTasks = filteredTasks.filter(task => {
                    const today = moment().startOf('day');

                    // Check each selected special filter
                    return Array.from(this.selectedSpecialFilters).every(filterId => {
                        switch (filterId) {
                            case 'flagged':
                                return task.flagged;

                            case 'upcoming':
                                if (!task.date) return false;
                                const upcomingDate = moment(task.date, 'YYYY-MM-DD');
                                return upcomingDate.isAfter(today);

                            case 'completed':
                                return task.completed;

                            case 'incomplete':
                                return !task.completed;

                            case 'due-today':
                                if (!task.date) return false;
                                const dueTodayDate = moment(task.date, 'YYYY-MM-DD');
                                return dueTodayDate.isSame(today, 'day');

                            case 'overdue':
                                if (!task.date) return false;
                                const overdueDate = moment(task.date, 'YYYY-MM-DD');
                                return overdueDate.isBefore(today) && !task.completed;

                            case 'no-date':
                                return !task.date;

                            default:
                                return true;
                        }
                    });
                });
            }

            // Render tasks
            if (filteredTasks.length === 0) {
                const hasActiveFilters = (searchTerm && searchTerm.length > 0) || this.selectedTags.size > 0 || this.selectedSpecialFilters.size > 0;
                this.taskRenderer.createEmptyState(
                    this.listContainerEl,
                    hasActiveFilters ? t('emptyStates.noMatchingTasks') : t('emptyStates.noTasksAcrossAll')
                );
            } else {
                if (this.groupingMode === 'none') {
                    // Sort tasks
                    const sortedTasks = filteredTasks.sort((a, b) => {
                        // Apply alphabetical sorting if enabled
                        if (this.sortMode === 'alphabetical-asc' || this.sortMode === 'alphabetical-desc') {
                            const textA = a.text.toLowerCase();
                            const textB = b.text.toLowerCase();
                            const comparison = textA.localeCompare(textB);
                            return this.sortMode === 'alphabetical-asc' ? comparison : -comparison;
                        }

                        // Default: sort by file path, then by line number
                        if (a.filePath !== b.filePath) {
                            return a.filePath.localeCompare(b.filePath);
                        }
                        return a.lineNumber - b.lineNumber;
                    });

                    // Use pagination for performance
                    this.renderTasksWithPagination(sortedTasks, searchTerm);
                } else {
                    // Render grouped tasks (pass allTasks for progress calculation)
                    this.renderGroupedTasks(filteredTasks, searchTerm, allTasks);
                }
            }

            // Restore scroll position after DOM rebuild
            this.restoreScrollPosition();

            // Apply flash animation to recently moved task
            if (this.recentlyMovedTaskId) {
                this.applyTaskFlashAnimation(this.recentlyMovedTaskId);
                this.recentlyMovedTaskId = null;
            }
        } finally {
            // Always reset the guard flag, even if an error occurs
            this.isRenderingTasks = false;
        }
    }

    /**
     * Apply a brief flash animation to a task that was just moved
     */
    private applyTaskFlashAnimation(taskId: string) {
        // Wait for next frame to ensure DOM is ready
        requestAnimationFrame(() => {
            const taskElement = this.listContainerEl.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
            if (taskElement) {
                taskElement.addClass('task-flash');
                // Remove class after animation completes
                setTimeout(() => {
                    taskElement.removeClass('task-flash');
                }, 600); // Match CSS animation duration
            }
        });
    }

    private renderGroupedTasks(tasks: Task[], searchTerm?: string, allTasks?: Task[]) {
        const today = moment().startOf('day');

        // Helper function to determine group key for a task
        const getGroupKey = (task: Task): string => {
            if (this.groupingMode === 'date-asc') {
                // Group by due date
                if (task.date) {
                    const taskDate = moment(task.date, 'YYYY-MM-DD');
                    // Check if overdue (before today AND not completed)
                    if (taskDate.isBefore(today) && !task.completed) {
                        return 'OVERDUE'; // Special group key for overdue tasks
                    }

                    const daysFromToday = taskDate.diff(today, 'days');

                    // First 7 days (today through day 6): individual dates
                    if (daysFromToday >= 0 && daysFromToday <= 6) {
                        return task.date; // YYYY-MM-DD format
                    }

                    // Rest of current month
                    if (taskDate.year() === today.year() && taskDate.month() === today.month()) {
                        return `${taskDate.format('YYYY-MM')}-CURRENT-MONTH`;
                    }

                    // Next 4 months: group by month
                    const endOfFourMonths = moment(today).add(4, 'months').endOf('month');
                    if (taskDate.isSameOrBefore(endOfFourMonths, 'day')) {
                        return taskDate.format('YYYY-MM'); // Group by month
                    }

                    // Years thereafter: group by year
                    return taskDate.format('YYYY');
                } else {
                    return 'No Date';
                }
            } else if (this.groupingMode === 'filename') {
                // Extract filename from path (remove extension for cleaner display)
                const filename = task.filePath.split('/').pop() || task.filePath;
                return filename.replace(/\.md$/, ''); // Remove .md extension
            } else {
                // For other grouping modes that don't apply to tasks, fall back to none
                return 'All Tasks';
            }
        };

        // Group tasks for display (filtered by completion status setting)
        const groups = new Map<string, Task[]>();
        tasks.forEach(task => {
            const groupKey = getGroupKey(task);
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(task);
        });

        // Group ALL tasks for accurate progress calculation
        const allGroups = new Map<string, Task[]>();
        if (allTasks) {
            allTasks.forEach(task => {
                const groupKey = getGroupKey(task);
                if (!allGroups.has(groupKey)) {
                    allGroups.set(groupKey, []);
                }
                allGroups.get(groupKey)!.push(task);
            });
        }

        // Sort groups
        const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
            if (this.groupingMode === 'date-asc') {
                // Pin "OVERDUE" at the top
                if (a === 'OVERDUE' && b === 'OVERDUE') return 0;
                if (a === 'OVERDUE') return -1;
                if (b === 'OVERDUE') return 1;

                // Sort date groups chronologically, with "No Date" at the end
                if (a === 'No Date' && b === 'No Date') return 0;
                if (a === 'No Date') return 1;
                if (b === 'No Date') return -1;

                // Helper to get sort priority for date groups
                const getSortValue = (key: string): string => {
                    // Individual dates (YYYY-MM-DD) - use as is
                    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
                        return key;
                    }
                    // Current month remainder - extract month and append high day number
                    if (key.endsWith('-CURRENT-MONTH')) {
                        const monthKey = key.replace('-CURRENT-MONTH', '');
                        return `${monthKey}-32`; // Day 32 ensures it comes after individual dates
                    }
                    // Month groups (YYYY-MM) - append day 33 to sort after current month
                    if (/^\d{4}-\d{2}$/.test(key)) {
                        return `${key}-33`;
                    }
                    // Year groups (YYYY) - append month 13 and day 34 to sort after month groups
                    if (/^\d{4}$/.test(key)) {
                        return `${key}-13-34`;
                    }
                    return key;
                };

                // Sort dates chronologically (always ascending - today first)
                return getSortValue(a).localeCompare(getSortValue(b));
            } else if (this.groupingMode === 'filename') {
                // Sort filename groups alphabetically
                return a.localeCompare(b);
            } else {
                return a.localeCompare(b);
            }
        });

        // Render each group
        sortedGroups.forEach(([groupName, groupTasks]) => {
            // Create group header
            const groupHeader = this.listContainerEl.createDiv({ cls: 'highlight-group-header' });
            const headerContent = groupHeader.createEl('span');

            // Calculate completion percentage from ALL tasks in this group (not just filtered)
            const allGroupTasks = allGroups.has(groupName) ? allGroups.get(groupName)! : groupTasks;
            const completedCount = allGroupTasks.filter(t => t.completed).length;
            const totalCount = allGroupTasks.length;
            const percentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

            // Create progress circle (add BEFORE text so it appears on left)
            this.createTaskProgressCircle(headerContent, percentage, completedCount, totalCount);

            // Add group name text after progress circle
            headerContent.createSpan({ text: this.getGroupDisplayName(groupName) });

            // Add task count
            headerContent.createSpan({
                cls: 'tree-item-flair',
                text: totalCount.toString()
            });

            // Skip section grouping when grouping by date (reduces clutter)
            const skipSectionGrouping = this.groupingMode === 'date-asc';

            if (skipSectionGrouping) {
                // Render tasks directly without section grouping
                const sortedTasks = groupTasks.sort((a, b) => {
                    // Apply alphabetical sorting if enabled
                    if (this.sortMode === 'alphabetical-asc' || this.sortMode === 'alphabetical-desc') {
                        const textA = a.text.toLowerCase();
                        const textB = b.text.toLowerCase();
                        const comparison = textA.localeCompare(textB);
                        return this.sortMode === 'alphabetical-asc' ? comparison : -comparison;
                    }

                    // Default: sort by line number within same file
                    return a.lineNumber - b.lineNumber;
                });

                // Create wrapper container for consistent spacing
                const groupTasksContainer = this.listContainerEl.createDiv({ cls: 'task-group-container' });

                // Only hide date badge for individual day groups (YYYY-MM-DD format)
                // Show it for month/year groups so users can see the specific date
                const isIndividualDayGroup = /^\d{4}-\d{2}-\d{2}$/.test(groupName) || groupName === 'OVERDUE';

                sortedTasks.forEach(task => {
                    this.taskRenderer.createTaskItem(groupTasksContainer, task, {
                        searchTerm,
                        hideFilename: false, // Show filename when grouping by date
                        hideDateBadge: isIndividualDayGroup, // Only hide for Today/Tomorrow/named days
                        onTaskToggle: async (task, checkboxEl) => {
                            await this.handleTaskToggle(task, checkboxEl);
                        },
                        onTaskClick: (task, event) => {
                            this.handleTaskClick(task, event);
                        },
                        onFileNameClick: (filePath, event) => {
                            this.plugin.app.workspace.openLinkText(filePath, '');
                        },
                        onFlagToggle: async (task, event) => {
                            await this.handleFlagToggle(task, event);
                        },
                        onCalendarToggle: async (task) => {
                            await this.handleCalendarToggle(task);
                        }
                    });
                });
            } else {
                // First, group by section (markdown headers)
                const sectionGroups = new Map<string, Task[]>();
                groupTasks.forEach(task => {
                    const sectionKey = task.section || t('emptyStates.noSection');
                    if (!sectionGroups.has(sectionKey)) {
                        sectionGroups.set(sectionKey, []);
                    }
                    sectionGroups.get(sectionKey)!.push(task);
                });

            // Sort sections
            const sortedSections = Array.from(sectionGroups.entries()).sort(([a], [b]) => {
                // Put "No section" at the beginning
                if (a === t('emptyStates.noSection') && b === t('emptyStates.noSection')) return 0;
                if (a === t('emptyStates.noSection')) return -1;
                if (b === t('emptyStates.noSection')) return 1;
                return a.localeCompare(b);
            });

            // Render each section
            sortedSections.forEach(([sectionName, sectionTasks], sectionIndex) => {
                // Store reference to containers for this section (for collapse functionality)
                const sectionContainers: HTMLElement[] = [];

                // Show section header if not "No section"
                if (sectionName !== t('emptyStates.noSection')) {
                    const sectionId = `${groupName}::${sectionName}`;
                    const sectionPositionId = `${groupName}::__position__::${sectionIndex}`;
                    // Check both name-based and position-based collapsed state
                    const isCollapsed = this.collapsedSections.has(sectionId) || this.collapsedSections.has(sectionPositionId);

                    const sectionHeader = this.listContainerEl.createDiv({ cls: 'task-section-header' });
                    sectionHeader.setAttribute('data-section-id', sectionId);
                    sectionHeader.setAttribute('data-section-position-id', sectionPositionId);
                    sectionHeader.setAttribute('data-group-name', groupName);
                    if (isCollapsed) {
                        sectionHeader.addClass('collapsed');
                    }

                    // Add section name
                    const sectionText = sectionHeader.createSpan({ text: sectionName });

                    // Add ellipsis indicator for collapsed sections with items
                    const ellipsis = sectionHeader.createSpan({
                        cls: 'task-section-ellipsis',
                        text: '...'
                    });

                    // Add click handler to toggle collapse
                    sectionHeader.addEventListener('click', () => {
                        const nowCollapsed = this.collapsedSections.has(sectionId);
                        if (nowCollapsed) {
                            this.collapsedSections.delete(sectionId);
                            this.collapsedSections.delete(sectionPositionId);
                            sectionHeader.removeClass('collapsed');
                            sectionContainers.forEach(container => container.style.display = '');
                        } else {
                            this.collapsedSections.add(sectionId);
                            this.collapsedSections.add(sectionPositionId);
                            sectionHeader.addClass('collapsed');
                            sectionContainers.forEach(container => container.style.display = 'none');
                        }
                    });
                }

                // Check if section is collapsed
                const sectionId = `${groupName}::${sectionName}`;
                const sectionPositionId = `${groupName}::__position__::${sectionIndex}`;
                const isSectionCollapsed = sectionName !== t('emptyStates.noSection') && (this.collapsedSections.has(sectionId) || this.collapsedSections.has(sectionPositionId));

                // If secondary grouping is enabled, group tasks within this section by secondary key
                // COMMENTED OUT FOR NOW
                /*
                if (this.taskSecondaryGroupingMode !== 'none' && !isSectionCollapsed) {
                    const secondaryGroups = new Map<string, Task[]>();
                    sectionTasks.forEach(task => {
                        const secondaryKey = this.getSecondaryGroupKey(task);
                        if (!secondaryGroups.has(secondaryKey)) {
                            secondaryGroups.set(secondaryKey, []);
                        }
                        secondaryGroups.get(secondaryKey)!.push(task);
                    });

                    // Sort secondary groups
                    const sortedSecondaryGroups = this.sortSecondaryGroups(Array.from(secondaryGroups.entries()));

                    // Render each secondary group within this section
                    sortedSecondaryGroups.forEach(([secondaryGroupName, secondaryGroupTasks]) => {
                        const secondaryGroupId = `${groupName}::${sectionName}::${secondaryGroupName}`;
                        const isSecondaryCollapsed = this.collapsedSections.has(secondaryGroupId);

                        // Show secondary group header
                        const secondaryHeader = this.listContainerEl.createDiv({ cls: 'task-secondary-group-header' });

                        // Add chevron icon
                        const chevron = secondaryHeader.createDiv({ cls: 'task-section-chevron' });
                        setIcon(chevron, 'chevron-down');
                        if (isSecondaryCollapsed) {
                            chevron.addClass('collapsed');
                        }

                        // Add secondary group name
                        const headerText = secondaryHeader.createSpan({ text: secondaryGroupName });

                        // Sort tasks within secondary group
                        const sortedTasks = secondaryGroupTasks.sort((a, b) => {
                            // Apply alphabetical sorting if enabled
                            if (this.sortMode === 'alphabetical-asc' || this.sortMode === 'alphabetical-desc') {
                                const textA = a.text.toLowerCase();
                                const textB = b.text.toLowerCase();
                                const comparison = textA.localeCompare(textB);
                                return this.sortMode === 'alphabetical-asc' ? comparison : -comparison;
                            }

                            // Default: sort by line number within same file
                            return a.lineNumber - b.lineNumber;
                        });

                        // Create a wrapper container for tasks in this secondary group
                        const groupTasksContainer = this.listContainerEl.createDiv({ cls: 'task-group-container' });

                        // Hide container if secondary group is collapsed
                        if (isSecondaryCollapsed) {
                            groupTasksContainer.style.display = 'none';
                        }

                        // Add click handler to toggle collapse
                        secondaryHeader.addEventListener('click', () => {
                            const nowCollapsed = this.collapsedSections.has(secondaryGroupId);
                            if (nowCollapsed) {
                                this.collapsedSections.delete(secondaryGroupId);
                                chevron.removeClass('collapsed');
                                groupTasksContainer.style.display = '';
                            } else {
                                this.collapsedSections.add(secondaryGroupId);
                                chevron.addClass('collapsed');
                                groupTasksContainer.style.display = 'none';
                            }
                        });

                        // Add both header and container to section's containers array so they collapse together
                        if (sectionName !== t('emptyStates.noSection')) {
                            sectionContainers.push(secondaryHeader);
                            sectionContainers.push(groupTasksContainer);
                        }

                        // Render tasks in this secondary group
                        sortedTasks.forEach(task => {
                            this.taskRenderer.createTaskItem(groupTasksContainer, task, {
                                searchTerm,
                                hideFilename: true,
                                hideDateBadge: this.groupingMode === 'date-asc',
                                onTaskToggle: async (task, checkboxEl) => {
                                    await this.handleTaskToggle(task, checkboxEl);
                                },
                                onTaskClick: (task, event) => {
                                    this.handleTaskClick(task, event);
                                },
                                onFileNameClick: (filePath, event) => {
                                    this.plugin.app.workspace.openLinkText(filePath, '');
                                },
                                onFlagToggle: async (task) => {
                                    await this.handleFlagToggle(task);
                                },
                                onCalendarToggle: async (task) => {
                                    await this.handleCalendarToggle(task);
                                }
                            });
                        });
                    });
                }
                */
                // else {
                    // No secondary grouping - render tasks directly in this section
                    // Sort tasks within section
                    const sortedTasks = sectionTasks.sort((a, b) => {
                        // Apply alphabetical sorting if enabled
                        if (this.sortMode === 'alphabetical-asc' || this.sortMode === 'alphabetical-desc') {
                            const textA = a.text.toLowerCase();
                            const textB = b.text.toLowerCase();
                            const comparison = textA.localeCompare(textB);
                            return this.sortMode === 'alphabetical-asc' ? comparison : -comparison;
                        }

                        // Default: sort by line number within same file
                        return a.lineNumber - b.lineNumber;
                    });

                    // Create a wrapper container for tasks in this section
                    const groupTasksContainer = this.listContainerEl.createDiv({ cls: 'task-group-container' });

                    // Hide container if section is collapsed
                    if (isSectionCollapsed) {
                        groupTasksContainer.style.display = 'none';
                    }

                    // Add this container to section's containers array
                    if (sectionName !== t('emptyStates.noSection')) {
                        sectionContainers.push(groupTasksContainer);
                    }

                    // Render tasks in this section (show filenames for date grouping, hide for others)
                    sortedTasks.forEach(task => {
                        this.taskRenderer.createTaskItem(groupTasksContainer, task, {
                            searchTerm,
                            hideFilename: !(this.groupingMode === 'date-asc'), // Show filename when grouping by due date
                            hideDateBadge: this.groupingMode === 'date-asc', // Hide date badge when grouping by due date
                            onTaskToggle: async (task, checkboxEl) => {
                                await this.handleTaskToggle(task, checkboxEl);
                            },
                            onTaskClick: (task, event) => {
                                this.handleTaskClick(task, event);
                            },
                            onFileNameClick: (filePath, event) => {
                                this.plugin.app.workspace.openLinkText(filePath, '');
                            },
                            onFlagToggle: async (task) => {
                                await this.handleFlagToggle(task);
                            },
                            onCalendarToggle: async (task) => {
                                await this.handleCalendarToggle(task);
                            }
                        });
                    });
                // }
            });
            } // End else (section grouping)
        });
    }

    /**
     * Create a circular progress indicator for task groups
     */
    private createTaskProgressCircle(container: HTMLElement, percentage: number, completed: number, total: number): void {
        const progressContainer = container.createDiv({ cls: 'task-progress-circle-container' });

        // If 100% complete, show checkmark icon instead of circle
        if (percentage === 100 && total > 0) {
            setIcon(progressContainer, 'circle-check');
            progressContainer.addClass('task-progress-complete');
            progressContainer.setAttribute('aria-label', `${completed}/${total} tasks completed`);
            progressContainer.setAttribute('title', `${completed}/${total} tasks completed`);
            return;
        }

        // Create SVG circle
        const svg = progressContainer.createSvg('svg', {
            attr: {
                width: '20',
                height: '20',
                viewBox: '0 0 20 20'
            }
        });

        const radius = 7.5;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;

        // Background circle
        svg.createSvg('circle', {
            attr: {
                cx: '10',
                cy: '10',
                r: radius.toString(),
                fill: 'none',
                stroke: 'var(--interactive-accent)',
                'stroke-width': '2.5',
                opacity: '0.2'
            }
        });

        // Progress circle
        svg.createSvg('circle', {
            cls: 'task-progress-circle',
            attr: {
                cx: '10',
                cy: '10',
                r: radius.toString(),
                fill: 'none',
                stroke: 'var(--interactive-accent)',
                'stroke-width': '2.5',
                'stroke-dasharray': circumference.toString(),
                'stroke-dashoffset': offset.toString(),
                'stroke-linecap': 'round',
                transform: 'rotate(-90 10 10)'
            }
        });

        // Add tooltip with count
        progressContainer.setAttribute('aria-label', `${completed}/${total} tasks completed`);
        progressContainer.setAttribute('title', `${completed}/${total} tasks completed`);
    }

    /**
     * Preserve collapsed sections state before DOM rebuild
     * This allows sections to stay collapsed even if their names change
     */
    private preserveCollapsedSections(): void {
        if (!this.listContainerEl) return;

        // Get all currently collapsed section headers from DOM
        const collapsedHeaders = this.listContainerEl.querySelectorAll('.task-section-header.collapsed');

        // Build a map of group -> collapsed section names
        const collapsedByGroup = new Map<string, Set<string>>();

        collapsedHeaders.forEach((header) => {
            const groupName = header.getAttribute('data-group-name');
            const sectionId = header.getAttribute('data-section-id');
            const sectionPositionId = header.getAttribute('data-section-position-id');

            if (groupName) {
                if (!collapsedByGroup.has(groupName)) {
                    collapsedByGroup.set(groupName, new Set());
                }
                // Preserve both name-based and position-based IDs
                if (sectionId) {
                    collapsedByGroup.get(groupName)!.add(sectionId);
                }
                if (sectionPositionId) {
                    collapsedByGroup.get(groupName)!.add(sectionPositionId);
                }
            }
        });

        // Clear old collapsed sections for groups that will be re-rendered
        // and add the current ones from DOM
        collapsedByGroup.forEach((sectionIds, groupName) => {
            // Remove old entries for this group
            const toRemove: string[] = [];
            this.collapsedSections.forEach(id => {
                if (id.startsWith(groupName + '::')) {
                    toRemove.push(id);
                }
            });
            toRemove.forEach(id => this.collapsedSections.delete(id));

            // Add current collapsed sections from DOM
            sectionIds.forEach(id => this.collapsedSections.add(id));
        });
    }

    /**
     * Update the progress circle for a task's group immediately for smooth animation
     */
    private updateGroupProgressCircle(task: Task, newCompletedState: boolean): void {
        // Only update if we're in grouped mode
        if (this.groupingMode === 'none') return;

        const today = moment().startOf('day');

        // Find the group this task belongs to
        const getGroupKey = (task: Task): string => {
            if (this.groupingMode === 'date-asc') {
                // Group by due date
                if (task.date) {
                    const taskDate = moment(task.date, 'YYYY-MM-DD');
                    // Check if overdue (before today AND not completed)
                    if (taskDate.isBefore(today) && !task.completed) {
                        return 'OVERDUE'; // Special group key for overdue tasks
                    }

                    const daysFromToday = taskDate.diff(today, 'days');

                    // First 7 days (today through day 6): individual dates
                    if (daysFromToday >= 0 && daysFromToday <= 6) {
                        return task.date; // YYYY-MM-DD format
                    }

                    // Rest of current month
                    if (taskDate.year() === today.year() && taskDate.month() === today.month()) {
                        return `${taskDate.format('YYYY-MM')}-CURRENT-MONTH`;
                    }

                    // Next 4 months: group by month
                    const endOfFourMonths = moment(today).add(4, 'months').endOf('month');
                    if (taskDate.isSameOrBefore(endOfFourMonths, 'day')) {
                        return taskDate.format('YYYY-MM'); // Group by month
                    }

                    // Years thereafter: group by year
                    return taskDate.format('YYYY');
                } else {
                    return 'No Date';
                }
            } else if (this.groupingMode === 'filename') {
                const filename = task.filePath.split('/').pop() || task.filePath;
                return filename.replace(/\.md$/, '');
            } else {
                return 'All Tasks';
            }
        };

        const groupKey = getGroupKey(task);

        // Find all progress circles in the DOM
        const allHeaders = this.listContainerEl.querySelectorAll('.highlight-group-header');
        allHeaders.forEach((header) => {
            const headerText = header.querySelector('span')?.textContent;
            const groupDisplayName = this.getGroupDisplayName(groupKey);

            if (headerText && headerText.includes(groupDisplayName)) {
                // Found the right header, now find all tasks in this group
                const allTasksInGroup = this.currentTasks?.filter(t => getGroupKey(t) === groupKey) || [];

                // Calculate new completion
                let completedCount = allTasksInGroup.filter(t => t.completed).length;

                // Adjust for the task we just toggled (since currentTasks hasn't been updated yet)
                if (task.completed !== newCompletedState) {
                    completedCount += newCompletedState ? 1 : -1;
                }

                const totalCount = allTasksInGroup.length;
                const percentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

                const progressContainer = header.querySelector('.task-progress-circle-container') as HTMLElement;
                if (progressContainer) {
                    // Check if we need to switch between circle and checkmark
                    const isComplete = percentage === 100 && totalCount > 0;
                    const hasCheckmark = progressContainer.classList.contains('task-progress-complete');

                    if (isComplete && !hasCheckmark) {
                        // Switch to checkmark
                        progressContainer.empty();
                        setIcon(progressContainer, 'circle-check');
                        progressContainer.addClass('task-progress-complete');
                    } else if (!isComplete && hasCheckmark) {
                        // Switch back to progress circle
                        progressContainer.empty();
                        progressContainer.removeClass('task-progress-complete');

                        // Recreate SVG circle
                        const svg = progressContainer.createSvg('svg', {
                            attr: {
                                width: '20',
                                height: '20',
                                viewBox: '0 0 20 20'
                            }
                        });

                        const radius = 7.5;
                        const circumference = 2 * Math.PI * radius;
                        const offset = circumference - (percentage / 100) * circumference;

                        // Background circle
                        svg.createSvg('circle', {
                            attr: {
                                cx: '10',
                                cy: '10',
                                r: radius.toString(),
                                fill: 'none',
                                stroke: 'var(--interactive-accent)',
                                'stroke-width': '2.5',
                                opacity: '0.2'
                            }
                        });

                        // Progress circle
                        svg.createSvg('circle', {
                            cls: 'task-progress-circle',
                            attr: {
                                cx: '10',
                                cy: '10',
                                r: radius.toString(),
                                fill: 'none',
                                stroke: 'var(--interactive-accent)',
                                'stroke-width': '2.5',
                                'stroke-dasharray': circumference.toString(),
                                'stroke-dashoffset': offset.toString(),
                                'stroke-linecap': 'round',
                                transform: 'rotate(-90 10 10)'
                            }
                        });
                    } else if (!isComplete && !hasCheckmark) {
                        // Just update the existing progress circle
                        const progressCircle = progressContainer.querySelector('.task-progress-circle') as SVGCircleElement;
                        if (progressCircle) {
                            const radius = 7.5;
                            const circumference = 2 * Math.PI * radius;
                            const offset = circumference - (percentage / 100) * circumference;
                            progressCircle.setAttribute('stroke-dashoffset', offset.toString());
                        }
                    }

                    // Update tooltip
                    progressContainer.setAttribute('aria-label', `${completedCount}/${totalCount} tasks completed`);
                    progressContainer.setAttribute('title', `${completedCount}/${totalCount} tasks completed`);
                }
            }
        });
    }

    /**
     * Get the secondary group key for a task based on taskSecondaryGroupingMode
     * Note: This is only called when taskSecondaryGroupingMode !== 'none'
     */
    private getSecondaryGroupKey(task: Task): string {
        if (this.taskSecondaryGroupingMode === 'tag') {
            // Extract tags from task text
            const tagRegex = /#([a-zA-Z0-9_-]+)/g;
            const tags: string[] = [];
            let match;
            while ((match = tagRegex.exec(task.text)) !== null) {
                tags.push(`#${match[1]}`);
            }
            return tags.length > 0 ? tags[0] : t('emptyStates.noTags'); // Use first tag for grouping
        } else if (this.taskSecondaryGroupingMode === 'date') {
            if (!task.date) return t('emptyStates.noDate');

            const taskDate = moment(task.date, 'YYYY-MM-DD');
            const today = moment().startOf('day');

            if (taskDate.isBefore(today)) {
                return t('emptyStates.overdue');
            } else if (taskDate.isSame(today, 'day')) {
                return t('emptyStates.today');
            } else {
                return t('emptyStates.upcoming');
            }
        } else if (this.taskSecondaryGroupingMode === 'flagged') {
            return task.flagged ? t('emptyStates.flagged') : t('emptyStates.unflagged');
        }

        // This should never be reached since we check taskSecondaryGroupingMode !== 'none' before calling
        return '';
    }

    /**
     * Sort secondary groups based on taskSecondaryGroupingMode
     */
    private sortSecondaryGroups(groups: [string, Task[]][]): [string, Task[]][] {
        return groups.sort(([a], [b]) => {
            if (this.taskSecondaryGroupingMode === 'tag') {
                // Put "No Tags" at the end, otherwise alphabetical
                if (a === t('emptyStates.noTags') && b === t('emptyStates.noTags')) return 0;
                if (a === t('emptyStates.noTags')) return 1;
                if (b === t('emptyStates.noTags')) return -1;
                return a.localeCompare(b);
            } else if (this.taskSecondaryGroupingMode === 'date') {
                // Order: Overdue, Today, Upcoming, No Date
                const order = [t('emptyStates.overdue'), t('emptyStates.today'), t('emptyStates.upcoming'), t('emptyStates.noDate')];
                const indexA = order.indexOf(a);
                const indexB = order.indexOf(b);
                return indexA - indexB;
            } else if (this.taskSecondaryGroupingMode === 'flagged') {
                // Flagged first, then unflagged
                if (a === t('emptyStates.flagged')) return -1;
                if (b === t('emptyStates.flagged')) return 1;
                return 0;
            } else {
                // Default section sorting: "No section" at the end
                if (a === t('emptyStates.noSection') && b === t('emptyStates.noSection')) return 0;
                if (a === t('emptyStates.noSection')) return 1;
                if (b === t('emptyStates.noSection')) return -1;
                return a.localeCompare(b);
            }
        });
    }

    private async handleTaskToggle(task: Task, checkboxEl: HTMLElement) {
        // Optimistically update the checkbox icon immediately
        const newCompletedState = !task.completed;
        const isSubtask = task.indentLevel > 0;

        // Add animation class
        const animationClass = newCompletedState ? 'checking' : 'unchecking';
        checkboxEl.addClass(animationClass);

        // Update icon
        if (isSubtask) {
            setIcon(checkboxEl, newCompletedState ? 'circle-check' : 'circle');
        } else {
            setIcon(checkboxEl, newCompletedState ? 'square-check' : 'square');
        }

        // Remove animation class after animation completes
        const animationDuration = newCompletedState ? 600 : 400;
        setTimeout(() => {
            checkboxEl.removeClass(animationClass);
        }, animationDuration);

        // Update progress circle immediately for smooth animation
        this.updateGroupProgressCircle(task, newCompletedState);

        try {
            const updatedTask = await this.taskManager.toggleTaskCompletion(task);
            new Notice('Task updated');
            // Don't call renderTasksView() here - the file modification will trigger
            // a file change event which will call renderContent() automatically
        } catch (error) {
            console.error('[Task Toggle] ERROR', error);
            // Remove animation class and revert the checkbox on error
            checkboxEl.removeClass(animationClass);
            if (isSubtask) {
                setIcon(checkboxEl, task.completed ? 'circle-check' : 'circle');
            } else {
                setIcon(checkboxEl, task.completed ? 'square-check' : 'square');
            }
            // Revert progress circle on error
            this.updateGroupProgressCircle(task, task.completed);
            new Notice(`Failed to toggle task: ${error.message}`);
        }
    }

    private async handleFlagToggle(task: Task, event?: MouseEvent) {
        const menu = new Menu();

        // Priority 1 - Red/High
        menu.addItem((item) =>
            item
                .setTitle('Priority 1 (High)')
                .setIcon('flag')
                .onClick(async () => {
                    try {
                        // Optimistic UI update
                        this.updateTaskPriorityInCache(task, 1);
                        this.renderContent();

                        // Then update the file
                        await this.taskManager.setTaskPriority(task, 1);
                        new Notice('Priority set to 1 (High)');
                    } catch (error) {
                        new Notice(`Failed to set priority: ${error.message}`);
                        // Revert on error
                        this.cachedAllTasks = null;
                        this.renderContent();
                    }
                })
        );

        // Priority 2 - Yellow/Medium
        menu.addItem((item) =>
            item
                .setTitle('Priority 2 (Medium)')
                .setIcon('flag')
                .onClick(async () => {
                    try {
                        // Optimistic UI update
                        this.updateTaskPriorityInCache(task, 2);
                        this.renderContent();

                        // Then update the file
                        await this.taskManager.setTaskPriority(task, 2);
                        new Notice('Priority set to 2 (Medium)');
                    } catch (error) {
                        new Notice(`Failed to set priority: ${error.message}`);
                        // Revert on error
                        this.cachedAllTasks = null;
                        this.renderContent();
                    }
                })
        );

        // Priority 3 - Blue/Low
        menu.addItem((item) =>
            item
                .setTitle('Priority 3 (Low)')
                .setIcon('flag')
                .onClick(async () => {
                    try {
                        // Optimistic UI update
                        this.updateTaskPriorityInCache(task, 3);
                        this.renderContent();

                        // Then update the file
                        await this.taskManager.setTaskPriority(task, 3);
                        new Notice('Priority set to 3 (Low)');
                    } catch (error) {
                        new Notice(`Failed to set priority: ${error.message}`);
                        // Revert on error
                        this.cachedAllTasks = null;
                        this.renderContent();
                    }
                })
        );

        // Remove priority
        if (task.priority) {
            menu.addSeparator();
            menu.addItem((item) =>
                item
                    .setTitle('Remove priority')
                    .setIcon('flag-off')
                    .onClick(async () => {
                        try {
                            // Optimistic UI update
                            this.updateTaskPriorityInCache(task, null);
                            this.renderContent();

                            // Then update the file
                            await this.taskManager.setTaskPriority(task, null);
                            new Notice('Priority removed');
                        } catch (error) {
                            new Notice(`Failed to remove priority: ${error.message}`);
                            // Revert on error
                            this.cachedAllTasks = null;
                            this.renderContent();
                        }
                    })
            );
        }

        if (event) {
            menu.showAtMouseEvent(event);
        } else {
            menu.showAtPosition({ x: 0, y: 0 });
        }
    }

    /**
     * Update task priority in cache for optimistic UI updates
     */
    private updateTaskPriorityInCache(task: Task, priority: 1 | 2 | 3 | null) {
        if (this.cachedAllTasks) {
            const cachedTask = this.cachedAllTasks.find(t => t.id === task.id);
            if (cachedTask) {
                cachedTask.priority = priority ?? undefined;
                cachedTask.flagged = priority !== null;
            }
        }

        // Also update the task object reference directly
        task.priority = priority ?? undefined;
        task.flagged = priority !== null;
    }

    /**
     * Update task date in cache for optimistic UI updates
     */
    private updateTaskDateInCache(task: Task, newDate: string | null, dateText: string | null) {
        if (this.cachedAllTasks) {
            const cachedTask = this.cachedAllTasks.find(t => t.id === task.id);
            if (cachedTask) {
                // Save old date text before updating
                const oldDateText = cachedTask.dateText;

                // Update task text to reflect the change
                if (oldDateText && cachedTask.text.includes(oldDateText)) {
                    // Remove old date from text
                    cachedTask.text = cachedTask.text.replace(oldDateText, '').trim();
                }
                if (dateText && newDate) {
                    // Add new date to beginning of text
                    cachedTask.text = `${dateText} ${cachedTask.text}`.trim();
                }

                // Update date properties AFTER modifying text
                cachedTask.date = newDate ?? undefined;
                cachedTask.dateText = dateText ?? undefined;
            }
        }

        // Also update the task object reference directly
        const oldDateText = task.dateText;

        // Update task text
        if (oldDateText && task.text.includes(oldDateText)) {
            task.text = task.text.replace(oldDateText, '').trim();
        }
        if (dateText && newDate) {
            task.text = `${dateText} ${task.text}`.trim();
        }

        // Update date properties AFTER modifying text
        task.date = newDate ?? undefined;
        task.dateText = dateText ?? undefined;
    }

    private async handleCalendarToggle(task: Task) {
        const dateFormat = this.plugin.settings.taskDateFormat || 'YYYY-MM-DD';

        // If task already has a date, prompt to remove or update
        if (task.date) {
            const modal = new DateInputModal(
                this.plugin.app,
                dateFormat,
                task.dateText || '',
                async (newDate) => {
                    try {
                        // Parse date to ISO format for optimistic update
                        let isoDate: string | null = null;
                        if (newDate) {
                            const parsedDate = moment(newDate, dateFormat, true);
                            if (parsedDate.isValid()) {
                                isoDate = parsedDate.format('YYYY-MM-DD');
                            }
                        }

                        // Optimistic UI update
                        this.updateTaskDateInCache(task, isoDate, newDate);
                        this.recentlyMovedTaskId = task.id; // Mark for flash animation
                        this.renderContent();

                        // Then update the file
                        await this.taskManager.updateTaskDate(task, newDate);
                        new Notice(newDate ? 'Date updated' : 'Date removed');
                    } catch (error) {
                        new Notice(`Failed to update date: ${error.message}`);
                        // Revert on error
                        this.cachedAllTasks = null;
                        this.recentlyMovedTaskId = null;
                        this.renderContent();
                    }
                }
            );
            modal.open();
        } else {
            // No date, prompt to add one
            const modal = new DateInputModal(
                this.plugin.app,
                dateFormat,
                '',
                async (newDate) => {
                    if (newDate) {
                        try {
                            // Parse date to ISO format for optimistic update
                            const parsedDate = moment(newDate, dateFormat, true);
                            let isoDate: string | null = null;
                            if (parsedDate.isValid()) {
                                isoDate = parsedDate.format('YYYY-MM-DD');
                            }

                            // Optimistic UI update
                            this.updateTaskDateInCache(task, isoDate, newDate);
                            this.recentlyMovedTaskId = task.id; // Mark for flash animation
                            this.renderContent();

                            // Then update the file
                            await this.taskManager.updateTaskDate(task, newDate);
                            new Notice('Date added');
                        } catch (error) {
                            new Notice(`Failed to add date: ${error.message}`);
                            // Revert on error
                            this.cachedAllTasks = null;
                            this.recentlyMovedTaskId = null;
                            this.renderContent();
                        }
                    }
                }
            );
            modal.open();
        }
    }

    /**
     * Render tasks with pagination for performance
     * @param tasks Array of all tasks available
     * @param searchTerm Optional search term for highlighting
     */
    private renderTasksWithPagination(tasks: Task[], searchTerm?: string): void {
        this.totalTasks = tasks;

        // Only reset to first page if we have new data AND we're not preserving pagination
        // (e.g., when switching tabs or searching, but not when clicking tasks)
        if (!this.isPreservingPagination) {
            this.currentTaskPage = 0;
        }

        // Ensure current page is valid for the new data
        const maxPage = Math.max(0, Math.ceil(tasks.length / this.itemsPerPage) - 1);
        if (this.currentTaskPage > maxPage) {
            this.currentTaskPage = maxPage;
        }

        this.renderCurrentTaskPage(searchTerm);
        this.renderTaskPaginationControls();

        // Reset the flag after rendering
        this.isPreservingPagination = false;
    }

    /**
     * Render the current page of tasks
     */
    private renderCurrentTaskPage(searchTerm?: string): void {
        const startIndex = this.currentTaskPage * this.itemsPerPage;
        const endIndex = Math.min(startIndex + this.itemsPerPage, this.totalTasks.length);
        const pageTasks = this.totalTasks.slice(startIndex, endIndex);

        // Clear ALL content from the container (tasks AND pagination controls)
        this.listContainerEl.empty();

        // Render current page items first
        pageTasks.forEach(task => {
            this.taskRenderer.createTaskItem(this.listContainerEl, task, {
                searchTerm,
                onTaskToggle: async (task, checkboxEl) => {
                    await this.handleTaskToggle(task, checkboxEl);
                },
                onTaskClick: (task, event) => {
                    this.handleTaskClick(task, event);
                },
                onFileNameClick: (filePath, event) => {
                    this.plugin.app.workspace.openLinkText(filePath, '');
                },
                onFlagToggle: async (task) => {
                    await this.handleFlagToggle(task);
                },
                onCalendarToggle: async (task) => {
                    await this.handleCalendarToggle(task);
                }
            });
        });
    }

    /**
     * Render pagination controls at the bottom
     */
    private renderTaskPaginationControls(): void {
        // Remove existing pagination
        const existingPagination = this.listContainerEl.querySelector('.pagination-controls');
        if (existingPagination) {
            existingPagination.remove();
        }

        const totalPages = Math.ceil(this.totalTasks.length / this.itemsPerPage);

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
        prevButton.disabled = this.currentTaskPage === 0;
        // Add Lucide chevron-left icon using Obsidian's setIcon
        setIcon(prevButton, 'chevron-left');
        prevButton.addEventListener('click', () => {
            if (this.currentTaskPage > 0) {
                this.currentTaskPage--;
                this.renderCurrentTaskPage(this.getSearchTerm());
                this.renderTaskPaginationControls();
                // Ensure scroll to top happens after DOM updates
                requestAnimationFrame(() => {
                    this.contentAreaEl.scrollTop = 0;
                });
            }
        });

        // Page info
        const pageInfo = paginationContainer.createSpan({
            text: `${this.currentTaskPage + 1}/${totalPages}`,
            cls: 'pagination-info pagination-info-compact'
        });

        // Next button
        const nextButton = paginationContainer.createEl('button', {
            cls: 'clickable-icon'
        });
        nextButton.disabled = this.currentTaskPage >= totalPages - 1;
        // Add Lucide chevron-right icon using Obsidian's setIcon
        setIcon(nextButton, 'chevron-right');
        nextButton.addEventListener('click', () => {
            if (this.currentTaskPage < totalPages - 1) {
                this.currentTaskPage++;
                this.renderCurrentTaskPage(this.getSearchTerm());
                this.renderTaskPaginationControls();
                // Ensure scroll to top happens after DOM updates
                requestAnimationFrame(() => {
                    this.contentAreaEl.scrollTop = 0;
                });
            }
        });
    }

    private handleTaskClick(task: Task, event?: MouseEvent) {
        // Open the file and navigate to the task line
        const file = this.plugin.app.vault.getAbstractFileByPath(task.filePath);
        if (file instanceof TFile) {
            this.plugin.app.workspace.openLinkText(task.filePath, '', false).then(() => {
                // Get the active markdown view
                const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) {
                    const editor = activeView.editor;
                    const line = editor.getLine(task.lineNumber);

                    // Find the start of the task text (after checkbox)
                    const taskMatch = line.match(/^(\s*[-*]\s*\[[ xX-]\]\s*)/);
                    const taskTextStart = taskMatch ? taskMatch[1].length : 0;
                    const taskTextEnd = line.length;

                    // Select the task text (highlighting it)
                    editor.setSelection(
                        { line: task.lineNumber, ch: taskTextStart },
                        { line: task.lineNumber, ch: taskTextEnd }
                    );

                    // Scroll to the line
                    editor.scrollIntoView({
                        from: { line: task.lineNumber, ch: taskTextStart },
                        to: { line: task.lineNumber, ch: taskTextEnd }
                    }, true);
                }
            });
        }
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
                // Apply alphabetical sorting if enabled
                if (this.sortMode === 'alphabetical-asc' || this.sortMode === 'alphabetical-desc') {
                    const textA = a.text.toLowerCase();
                    const textB = b.text.toLowerCase();
                    const comparison = textA.localeCompare(textB);
                    return this.sortMode === 'alphabetical-asc' ? comparison : -comparison;
                }

                // Default: sort by file path, then by position in file
                if (a.filePath !== b.filePath) {
                    return a.filePath.localeCompare(b.filePath);
                }
                return a.startOffset - b.startOffset;
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
        } else if (this.viewMode === 'all') {
            // Get all highlights from all files
            allHighlights = [];
            for (const [filePath, highlights] of this.plugin.highlights) {
                allHighlights.push(...highlights);
            }
        } else {
            // Collections view is handled elsewhere
            return;
        }

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
            } else {
                message = searchTerm ? t('emptyStates.noMatchingAcrossAll') : t('emptyStates.noHighlightsAcrossAll');
            }
            this.highlightRenderer.createEmptyState(this.listContainerEl, message);
        } else {
            if (this.groupingMode === 'none') {
                // Sort highlights
                const sortedHighlights = filteredHighlights.sort((a, b) => {
                    // Apply alphabetical sorting if enabled
                    if (this.sortMode === 'alphabetical-asc' || this.sortMode === 'alphabetical-desc') {
                        const textA = a.text.toLowerCase();
                        const textB = b.text.toLowerCase();
                        const comparison = textA.localeCompare(textB);
                        return this.sortMode === 'alphabetical-asc' ? comparison : -comparison;
                    }

                    // Default: sort by file path, then by position in file
                    if (a.filePath !== b.filePath) {
                        return a.filePath.localeCompare(b.filePath);
                    }
                    return a.startOffset - b.startOffset;
                });
                
                // No grouping - use pagination for "All Notes" performance
                if (this.viewMode === 'all') {
                    this.renderHighlightsWithPagination(sortedHighlights, searchTerm);
                } else {
                    // Current file - render all items directly (small dataset)
                    sortedHighlights.forEach(highlight => {
                        this.createHighlightItem(this.listContainerEl, highlight, searchTerm, false);
                    });
                }
            } else {
                // Use pagination for grouped highlights in "All Notes" mode
                if (this.viewMode === 'all') {
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
                requestAnimationFrame(() => {
                    this.contentAreaEl.scrollTop = 0;
                });
            }
        });
        
        // Page info
        const pageInfo = paginationContainer.createSpan({
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
                requestAnimationFrame(() => {
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
            } else if (this.sortMode === 'alphabetical-asc' || this.sortMode === 'alphabetical-desc') {
                // Sort alphabetically by highlight text
                sortedHighlights = groupHighlights.sort((a, b) => {
                    const textA = a.text.toLowerCase();
                    const textB = b.text.toLowerCase();
                    const comparison = textA.localeCompare(textB);
                    return this.sortMode === 'alphabetical-asc' ? comparison : -comparison;
                });
            } else {
                sortedHighlights = groupHighlights.sort((a, b) => a.startOffset - b.startOffset);
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
        let renderedHighlightCount = 0;
        
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
                    this.renderGroupHeader(groupName, groupHighlights, groupColors);
                    
                    // Render the subset of highlights for this page (already sorted)
                    groupHighlightsToShow.forEach(highlight => {
                        this.createHighlightItem(this.listContainerEl, highlight, searchTerm, true);
                        renderedHighlightCount++;
                    });
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
    private renderGroupHeader(groupName: string, groupHighlights: Highlight[], groupColors?: Map<string, string>): void {
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

        // Native comments count section (show when native comments are enabled)
        if (this.showNativeComments) {
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
    }

    /**
     * Render a single group with its highlights (extracted from renderGroupedHighlights)
     */
    private renderSingleGroup(groupName: string, groupHighlights: Highlight[], searchTerm?: string, showFilename: boolean = false, groupColors?: Map<string, string>): void {
        // Render group header
        this.renderGroupHeader(groupName, groupHighlights, groupColors);

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
        sortedHighlights.forEach(highlight => {
            this.createHighlightItem(this.listContainerEl, highlight, searchTerm, showFilename);
        });
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
                requestAnimationFrame(() => {
                    this.contentAreaEl.scrollTop = 0;
                });
            }
        });
        
        // Page info
        const pageInfo = paginationContainer.createSpan({
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
                requestAnimationFrame(() => {
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

    private updateSecondaryGroupButtonState(button: HTMLElement) {
        const isTasksView = this.viewMode === 'tasks';
        const hasPrimaryGrouping = this.groupingMode !== 'none';

        // Disable button if not in tasks view or if no primary grouping
        if (!isTasksView || !hasPrimaryGrouping) {
            button.classList.add('disabled');
            button.classList.remove('active');
        } else {
            button.classList.remove('disabled');
            // Show active state if secondary grouping is enabled
            if (this.taskSecondaryGroupingMode === 'none') {
                button.classList.remove('active');
            } else {
                button.classList.add('active');
            }
        }
    }

    private saveTaskSecondaryGroupingModeToSettings() {
        this.plugin.settings.taskSecondaryGroupingMode = this.taskSecondaryGroupingMode;
        this.plugin.saveSettings();
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

        const selectedCount = this.selectedHighlightIds.size;
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
        // Check if date-based grouping is active (sorting doesn't apply)
        const isDateGrouping = this.groupingMode === 'date-created-asc' || this.groupingMode === 'date-created-desc';

        if (isDateGrouping) {
            // Disable button when sorting doesn't apply
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
                setTooltip(button, t('toolbar.sort'));
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
            onColorChange: (highlight, color) => {
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
                requestAnimationFrame(() => {
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
            },
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
                    this.focusHighlightInEditor(highlight, event);
                }
            },
            onAddComment: async (highlight) => {
                
                // Set flag to preserve pagination when adding comments
                this.isPreservingPagination = true;
                
                // First focus the highlight in editor and wait for file switch to complete
                await this.focusHighlightInEditor(highlight);
                // Then add the footnote with targeted update
                this.addFootnoteToHighlightWithTargetedUpdate(highlight);
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
                    this.focusFootnoteInEditor(highlight, originalIndex, event);
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
                this.plugin.app.workspace.openLinkText(filePath, filePath, Keymap.isModEvent(event));
            }
        };

        return this.highlightRenderer.createHighlightItem(container, highlight, options);
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
                setTimeout(() => {
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
                setTimeout(async () => {
                    await this.updateSingleHighlightFromEditor(highlight, file);
                }, 100);
            } else {
                new Notice('Could not insert inline footnote.');
            }
        } else {
            // Use standard footnote
            // Position cursor at the end of the highlight for the footnote command
            editor.setCursor(insertPos);
            editor.focus();

            (this.plugin.app as any).commands.executeCommandById('editor:insert-footnote');
            // Wait for the footnote command to complete
            setTimeout(async () => {
                await this.updateSingleHighlightFromEditor(highlight, file);
            }, 100);
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
                            } catch (e) {
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
        
        // Always clear ALL existing selections first to prevent multiple selections
        const allSelectedElements = this.containerEl.querySelectorAll('.selected, .highlight-selected');
        allSelectedElements.forEach(el => {
            el.classList.remove('selected', 'highlight-selected');
            // Clear any inline styles that might have been applied
            (el as HTMLElement).style.removeProperty('border-left-color');
            (el as HTMLElement).style.removeProperty('box-shadow');
        });
        
        // Update selection state
        const prevId = this.plugin.selectedHighlightId;
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
        
        let targetView: MarkdownView | null = null;
        const activeEditorView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

        if (activeEditorView && activeEditorView.file && activeEditorView.file.path === highlight.filePath) {
            targetView = activeEditorView;
        } else {
            const markdownLeaves = this.plugin.app.workspace.getLeavesOfType('markdown');
            for (const leaf of markdownLeaves) {
                if (leaf.view instanceof MarkdownView && leaf.view.file?.path === highlight.filePath) {
                    targetView = leaf.view as MarkdownView;
                    this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
                    break;
                }
            }
        }

        if (!targetView) {
            const fileToOpen = this.plugin.app.vault.getAbstractFileByPath(highlight.filePath);
            if (fileToOpen instanceof TFile) {
                const openResult = await this.plugin.app.workspace.openLinkText(highlight.filePath, highlight.filePath, event ? Keymap.isModEvent(event) : false);
                
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
            // Use requestAnimationFrame for smoother focus
            requestAnimationFrame(() => {
                this.performHighlightFocus(targetView!, highlight);
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
            requestAnimationFrame(() => {
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
        
        // Set cursor position first
        targetView.editor.setSelection(startPos, endPos);
        
        // Auto-unfold if setting is enabled
        if (this.plugin.settings.autoToggleFold) {
            try {
                (this.plugin.app as any).commands.executeCommandById('editor:toggle-fold');
            } catch (error) {
                console.warn('Failed to execute toggle fold command:', error);
            }
        }
        
        targetView.editor.scrollIntoView({ from: startPos, to: endPos }, true);
        targetView.editor.focus();
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
        let targetView: MarkdownView | null = null;
        const activeEditorView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

        if (activeEditorView && activeEditorView.file && activeEditorView.file.path === highlight.filePath) {
            targetView = activeEditorView;
        } else {
            const markdownLeaves = this.plugin.app.workspace.getLeavesOfType('markdown');
            for (const leaf of markdownLeaves) {
                if (leaf.view instanceof MarkdownView && leaf.view.file?.path === highlight.filePath) {
                    targetView = leaf.view as MarkdownView;
                    this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
                    break;
                }
            }
        }

        if (!targetView) {
            const fileToOpen = this.plugin.app.vault.getAbstractFileByPath(highlight.filePath);
            if (fileToOpen instanceof TFile) {
                await this.plugin.app.workspace.openLinkText(highlight.filePath, highlight.filePath, event ? Keymap.isModEvent(event) : false);
                // Wait for file to open and retry
                window.setTimeout(() => this.focusFootnoteInEditor(highlight, footnoteIndex, event), 200);
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

            // Native comments count section (show when native comments are enabled)
            if (this.showNativeComments) {
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
            } else if (this.sortMode === 'alphabetical-asc' || this.sortMode === 'alphabetical-desc') {
                // Sort alphabetically by highlight text
                sortedHighlights = groupHighlights.sort((a, b) => {
                    const textA = a.text.toLowerCase();
                    const textB = b.text.toLowerCase();
                    const comparison = textA.localeCompare(textB);
                    return this.sortMode === 'alphabetical-asc' ? comparison : -comparison;
                });
            } else {
                // For other grouping modes, sort by start offset (position in file)
                sortedHighlights = groupHighlights.sort((a, b) => a.startOffset - b.startOffset);
            }
            
            // Create highlights in this group
            sortedHighlights.forEach(highlight => {
                this.createHighlightItem(this.listContainerEl, highlight, searchTerm, showFilename);
            });
        });
    }

    private updateCommentsToggleIcon(button: HTMLElement) {
        button.empty();
        
        // Use global state to determine icon, not current view
        const anyExpanded = this.areCommentsGloballyExpanded();
        
        const iconName = anyExpanded ? 'chevrons-down-up' : 'chevrons-up-down';
        setIcon(button, iconName);
    }

    private toggleAllComments() {
        // Toggle ALL highlights across all files globally, not just current view
        const allHighlights: Highlight[] = [];
        for (const [, fileHighlights] of this.plugin.highlights) {
            allHighlights.push(...fileHighlights);
        }

        // Check if any comments are currently expanded globally
        const anyExpanded = this.areCommentsGloballyExpanded();

        // If any are expanded, collapse all. If none are expanded, expand all.
        const newState = !anyExpanded;

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
            this.plugin.saveSettings(); // Save changes to disk
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

        if (this.viewMode === 'current') {
            const highlights = this.plugin.getCurrentFileHighlights();
            highlights.forEach(highlight => {
                const tags = this.extractTagsFromHighlight(highlight);
                tags.forEach(tag => allTags.add(tag));
            });
        } else if (this.viewMode === 'all') {
            // Get tags from all highlights across all files
            for (const [filePath, highlights] of this.plugin.highlights) {
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
        } else if (this.viewMode === 'tasks') {
            // Get tags from task text using regex
            const tagRegex = /#([a-zA-Z0-9_-]+)/g;

            // We need to scan all tasks to get tags
            // Use the current tasks if available
            if (this.currentTasks) {
                this.currentTasks.forEach(task => {
                    let match;
                    const regex = new RegExp(tagRegex);
                    while ((match = regex.exec(task.text)) !== null) {
                        allTags.add(match[1]);
                    }
                });
            }
        }

        return Array.from(allTags).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }

    private getAllCollectionsInCurrentScope(): { id: string, name: string }[] {
        const allCollections = new Set<string>();
        let highlights: Highlight[] = [];
        
        if (this.viewMode === 'current') {
            highlights = this.plugin.getCurrentFileHighlights();
        } else if (this.viewMode === 'all') {
            // Get highlights from all files
            for (const [filePath, fileHighlights] of this.plugin.highlights) {
                highlights.push(...fileHighlights);
            }
        } else if (this.viewMode === 'collections' && this.currentCollectionId) {
            // Get highlights from current collection
            highlights = this.plugin.collectionsManager.getHighlightsInCollection(this.currentCollectionId);
        }
        
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

    /**
     * Get available special filters for tasks based on current task data
     * Only returns filters that are relevant (have matching tasks)
     */
    private getAvailableSpecialFilters(): Array<{id: string, label: string, icon: string}> {
        const filters: Array<{id: string, label: string, icon: string}> = [];

        // Only show special filters in tasks mode
        if (this.viewMode !== 'tasks' || !this.currentTasks) {
            return filters;
        }

        const today = moment().startOf('day');

        // Check if there are any flagged tasks
        const hasFlagged = this.currentTasks.some(task => task.flagged);
        if (hasFlagged) {
            filters.push({ id: 'flagged', label: t('filterMenu.flagged'), icon: 'flag' });
        }

        // Check if there are any tasks with future dates
        const hasUpcoming = this.currentTasks.some(task => {
            if (!task.date) return false;
            const taskDate = moment(task.date, 'YYYY-MM-DD');
            return taskDate.isAfter(today);
        });
        if (hasUpcoming) {
            filters.push({ id: 'upcoming', label: t('filterMenu.upcoming'), icon: 'calendar-arrow-up' });
        }

        // Check if there are any completed tasks
        const hasCompleted = this.currentTasks.some(task => task.completed);
        if (hasCompleted) {
            filters.push({ id: 'completed', label: t('filterMenu.completed'), icon: 'check-circle' });
        }

        // Check if there are any incomplete tasks
        const hasIncomplete = this.currentTasks.some(task => !task.completed);
        if (hasIncomplete) {
            filters.push({ id: 'incomplete', label: t('filterMenu.incomplete'), icon: 'circle' });
        }

        // Check if there are any tasks due today
        const hasDueToday = this.currentTasks.some(task => {
            if (!task.date) return false;
            const taskDate = moment(task.date, 'YYYY-MM-DD');
            return taskDate.isSame(today, 'day');
        });
        if (hasDueToday) {
            filters.push({ id: 'due-today', label: t('filterMenu.dueToday'), icon: 'calendar-check' });
        }

        // Check if there are any overdue tasks
        const hasOverdue = this.currentTasks.some(task => {
            if (!task.date) return false;
            const taskDate = moment(task.date, 'YYYY-MM-DD');
            return taskDate.isBefore(today) && !task.completed;
        });
        if (hasOverdue) {
            filters.push({ id: 'overdue', label: t('filterMenu.overdue'), icon: 'calendar-x' });
        }

        // Check if there are any tasks without dates
        const hasNoDate = this.currentTasks.some(task => !task.date);
        if (hasNoDate) {
            filters.push({ id: 'no-date', label: t('filterMenu.noDate'), icon: 'calendar-off' });
        }

        return filters;
    }

    private showTagFilterMenu(event: MouseEvent) {
        const availableTags = this.getAllTagsInFile();
        const availableCollections = this.getAllCollectionsInCurrentScope();
        const availableSpecialFilters = this.getAvailableSpecialFilters();

        if (availableTags.length === 0 && availableCollections.length === 0 && availableSpecialFilters.length === 0) {
            new Notice(t('emptyStates.noTagsOrFilters'));
            return;
        }

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
                    this.selectedSpecialFilters.clear();
                    this.saveCurrentTabSettings(); // Save filter state
                    this.renderContent();
                    this.showTagActive();

                    // Update all checkbox states to unchecked
                    const newStates: { [key: string]: boolean } = {};
                    availableTags.forEach(tag => {
                        newStates[`tag-${tag}`] = false;
                    });
                    sortedCollections.forEach(collection => {
                        newStates[`collection-${collection.id}`] = false;
                    });
                    availableSpecialFilters.forEach(filter => {
                        newStates[`special-${filter.id}`] = false;
                    });
                    this.dropdownManager.updateAllCheckboxStates(newStates);
                }
            }
        ];

        // Add special filters at the top (for tasks mode)
        if (availableSpecialFilters.length > 0) {
            items.push(...availableSpecialFilters.map(filter => ({
                id: `special-${filter.id}`,
                text: filter.label,
                uncheckedIcon: filter.icon,
                checked: this.selectedSpecialFilters.has(filter.id),
                onClick: () => {
                    if (this.selectedSpecialFilters.has(filter.id)) {
                        this.selectedSpecialFilters.delete(filter.id);
                    } else {
                        this.selectedSpecialFilters.add(filter.id);
                    }
                    this.saveCurrentTabSettings(); // Save filter state
                    this.renderContent();
                    this.showTagActive();
                }
            })));

            // Add separator after special filters if there are tags or collections
            if (availableTags.length > 0 || sortedCollections.length > 0) {
                items.push({
                    text: '',
                    separator: true
                });
            }
        }

        // Add tags if any exist
        if (availableTags.length > 0) {
            items.push(...availableTags.map(tag => ({
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
            })));
        }

        // Add separator if both tags and collections exist
        if (availableTags.length > 0 && sortedCollections.length > 0) {
            items.push({
                text: '',
                separator: true
            });
        }

        // Add collections if any exist
        if (sortedCollections.length > 0) {
            items.push(...sortedCollections.map(collection => ({
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
            })));
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

        // Enable toolbar buttons (except collection nav button which should always be enabled in collections view)
        const toolbarButtons = this.contentEl.querySelectorAll('.highlights-search-container button');
        toolbarButtons.forEach((button, index) => {
            const isCollectionNavButton = index === toolbarButtons.length - 1; // Last button
            const isNativeCommentsToggle = index === 2; // Native comments toggle is the 3rd button (index 2)
            const isCommentsToggle = index === 3; // Comments toggle is the 4th button (index 3)
            const isResetColors = index === 4; // Reset colors is the 5th button (index 4)

            if (this.viewMode === 'collections' && !this.currentCollectionId && !isCollectionNavButton && !isNativeCommentsToggle) {
                // In collections overview, disable all buttons except collection nav and native comments toggle
                button.classList.add('disabled');
            } else if (this.viewMode === 'tasks' && (isNativeCommentsToggle || isCommentsToggle || isResetColors)) {
                // In tasks view, disable comment and color buttons
                button.classList.add('disabled');
            } else {
                // Enable all other cases
                button.classList.remove('disabled');
            }
        });

        // Update collection nav button styling
        if (this.collectionNavButton) {
            this.updateCollectionNavButton(this.collectionNavButton);
        }

        // Update secondary group button state
        // COMMENTED OUT FOR NOW
        /*
        const secondaryGroupButton = this.contentEl.querySelector('.highlights-secondary-group-button') as HTMLElement;
        if (secondaryGroupButton) {
            this.updateSecondaryGroupButtonState(secondaryGroupButton);
        }
        */
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

        // Disable toolbar buttons except collection nav button
        const toolbarButtons = this.contentEl.querySelectorAll('.highlights-search-container button');
        toolbarButtons.forEach((button, index) => {
            const isCollectionNavButton = index === toolbarButtons.length - 1; // Last button
            
            if (!isCollectionNavButton) {
                button.classList.add('disabled');
            } else {
                // Keep collection nav button enabled and styled
                button.classList.remove('disabled');
            }
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
            if (this.selectedTags.size > 0 || this.selectedCollections.size > 0 || this.selectedSpecialFilters.size > 0) {
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
            this.plugin.saveSettings();
            this.plugin.refreshSidebar();
        }).open();
    }

    private updateNativeCommentsToggleState(button: HTMLElement) {
        if (this.showNativeComments) {
            setIcon(button, 'captions');
            button.classList.remove('active');
            setTooltip(button, t('toolbar.toggleComments'));
        } else {
            setIcon(button, 'captions-off');
            button.classList.add('active');
            setTooltip(button, t('toolbar.toggleComments'));
        }
    }

    // Animation methods for collection creation and deletion
    private animateCollectionCreation(collectionId: string) {
        // First refresh the sidebar to add the new collection to DOM
        this.plugin.refreshSidebar();
        
        // Wait for DOM update, then find and animate the new collection
        requestAnimationFrame(() => {
            const collectionCard = this.contentAreaEl.querySelector(`[data-collection-id="${collectionId}"]`) as HTMLElement;
            if (collectionCard) {
                // Start from scaled down state
                collectionCard.classList.add('preparing-animation');
                
                // Trigger animation on next frame
                requestAnimationFrame(() => {
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

    private toggleNativeCommentsVisibility() {
        this.showNativeComments = !this.showNativeComments;
        this.plugin.app.saveLocalStorage('sidebar-highlights-show-native-comments', this.showNativeComments.toString());
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
        for (const [filePath, highlights] of this.plugin.highlights) {
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

            // 4. Apply native comments filtering
            if (!this.showNativeComments && highlight.isNativeComment) {
                return false;
            }

            // 5. Apply minimum character count filtering (for highlights and native comments only)
            const minCharCount = this.plugin.settings.minimumCharacterCount;
            if (minCharCount > 0 && (highlight.type === 'highlight' || highlight.type === 'html' || highlight.isNativeComment)) {
                const textLength = highlight.text.length;
                if (textLength < minCharCount) {
                    return false;
                }
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
            return highlight.text.toLowerCase().includes(textNode.value.toLowerCase()) ||
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

/**
 * Modal for entering or editing a task date
 */
class DateInputModal extends Modal {
    private dateFormat: string;
    private currentDate: string;
    private onSubmit: (date: string | null) => void;
    private dateSuggest: DateSuggest;

    constructor(app: App, dateFormat: string, currentDate: string, onSubmit: (date: string | null) => void) {
        super(app);
        this.dateFormat = dateFormat;
        this.currentDate = currentDate;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Set the modal title (appears in upper left corner)
        const titleEl = contentEl.createEl('div', { cls: 'modal-title', text: t('modals.taskDate.title') });
        titleEl.style.marginBottom = '20px';

        // Date input field container
        const inputContainer = contentEl.createDiv({ cls: 'date-input-container' });

        const input = inputContainer.createEl('input', {
            type: 'text',
            placeholder: this.dateFormat,
            value: this.currentDate,
            cls: 'date-input-field'
        });

        // Initialize the date suggestion system
        this.dateSuggest = new DateSuggest(this.app, input, this.dateFormat);

        // Error message element (hidden by default)
        const errorEl = inputContainer.createDiv({ cls: 'date-input-error' });
        errorEl.style.display = 'none';

        // Focus the input
        input.focus();

        // Only trigger input event to show suggestions if there's no current date
        setTimeout(() => {
            if (!this.currentDate) {
                input.dispatchEvent(new Event('input'));
            }
            input.select();
        }, 50);

        // Natural language date parser
        const parseNaturalLanguage = (input: string): moment.Moment | null => {
            const normalized = input.toLowerCase().trim();

            // Absolute dates
            if (normalized === 'today') {
                return moment();
            }
            if (normalized === 'tomorrow') {
                return moment().add(1, 'day');
            }
            if (normalized === 'yesterday') {
                return moment().subtract(1, 'day');
            }

            // Relative dates: "2 weeks from now", "3 days ago", "1 month from now"
            const relativeRegex = /^(\d+)\s+(day|days|week|weeks|month|months|year|years)\s+(ago|from now)$/;
            const relativeMatch = normalized.match(relativeRegex);
            if (relativeMatch) {
                const amount = parseInt(relativeMatch[1]);
                const unit = relativeMatch[2].replace(/s$/, '') as moment.unitOfTime.DurationConstructor; // Remove plural 's'
                const direction = relativeMatch[3];

                if (direction === 'ago') {
                    return moment().subtract(amount, unit);
                } else {
                    return moment().add(amount, unit);
                }
            }

            // Named day references: "last Friday", "next Monday", "this Thursday"
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const namedDayRegex = /^(last|next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/;
            const namedDayMatch = normalized.match(namedDayRegex);
            if (namedDayMatch) {
                const direction = namedDayMatch[1];
                const dayName = namedDayMatch[2];
                const targetDay = dayNames.indexOf(dayName);
                const today = moment();
                const currentDay = today.day();

                if (direction === 'last') {
                    // Find the most recent occurrence of that day
                    const daysAgo = currentDay >= targetDay ? currentDay - targetDay : 7 - (targetDay - currentDay);
                    return moment().subtract(daysAgo === 0 ? 7 : daysAgo, 'days');
                } else if (direction === 'next') {
                    // Find the next occurrence of that day
                    const daysAhead = targetDay > currentDay ? targetDay - currentDay : 7 - (currentDay - targetDay);
                    return moment().add(daysAhead === 0 ? 7 : daysAhead, 'days');
                } else if (direction === 'this') {
                    // Find this week's occurrence of that day
                    if (targetDay >= currentDay) {
                        // If the target day is today or later this week
                        return moment().add(targetDay - currentDay, 'days');
                    } else {
                        // If the target day already passed this week, use next week's
                        return moment().add(7 + (targetDay - currentDay), 'days');
                    }
                }
            }

            return null;
        };

        // Validation function
        const validateDate = (dateStr: string): boolean => {
            if (!dateStr) {
                return true; // Empty is valid (will remove date)
            }

            // Try natural language parsing first
            const naturalDate = parseNaturalLanguage(dateStr);
            if (naturalDate && naturalDate.isValid()) {
                return true;
            }

            // Fall back to exact format parsing
            const parsedDate = moment(dateStr, this.dateFormat, true);
            return parsedDate.isValid();
        };

        // Show/hide error message
        const showError = (message: string) => {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            input.addClass('has-error');
        };

        const hideError = () => {
            errorEl.style.display = 'none';
            input.removeClass('has-error');
        };

        // Handle save action
        const handleSave = () => {
            const dateValue = input.value.trim();

            if (validateDate(dateValue)) {
                hideError();

                // Convert natural language to proper format if needed
                let finalDate: string | null = dateValue || null;
                if (dateValue) {
                    const naturalDate = parseNaturalLanguage(dateValue);
                    if (naturalDate && naturalDate.isValid()) {
                        // Convert to the expected format
                        finalDate = naturalDate.format(this.dateFormat);
                    }
                }

                this.onSubmit(finalDate);
                this.close();
            } else {
                showError(`Invalid date format. Please use ${this.dateFormat} or natural language (e.g., "today", "2 weeks from now")`);
            }
        };

        // Button container
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        // Save button
        const saveButton = buttonContainer.createEl('button', { text: 'Save', cls: 'mod-cta' });
        saveButton.addEventListener('click', handleSave);

        // Remove button (only if there's a current date)
        if (this.currentDate) {
            const removeButton = buttonContainer.createEl('button', { text: 'Remove Date', cls: 'mod-warning' });
            removeButton.addEventListener('click', () => {
                this.onSubmit(null);
                this.close();
            });
        }

        // Cancel button
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });

        // Handle Enter key (AbstractInputSuggest handles arrow keys automatically)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // Small delay to allow AbstractInputSuggest to handle selection first
                setTimeout(() => {
                    handleSave();
                }, 0);
            } else if (e.key === 'Escape') {
                this.close();
            }
        });

        // Clear error on input
        input.addEventListener('input', () => {
            hideError();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}