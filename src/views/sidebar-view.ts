import { ItemView, WorkspaceLeaf, MarkdownView, TFile, Menu, Notice, setIcon, setTooltip, Keymap } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import type { Highlight, Collection, CommentPluginSettings } from '../../main';
import { NewCollectionModal, EditCollectionModal } from '../modals/collection-modals';
import { DropdownManager, DropdownItem } from '../managers/dropdown-manager';
import { HighlightRenderer, HighlightRenderOptions } from '../renderers/highlight-renderer';
import { InlineFootnoteManager } from '../managers/inline-footnote-manager';
import { SearchParser, SearchToken, ParsedSearch, ASTNode, OperatorNode, FilterNode, TextNode } from '../utils/search-parser';
import { SimpleSearchManager } from '../managers/simple-search-manager';

const VIEW_TYPE_HIGHLIGHTS = 'highlights-sidebar';

export class HighlightsSidebarView extends ItemView {
    plugin: HighlightCommentsPlugin;
    private searchInputEl!: HTMLInputElement;
    private listContainerEl!: HTMLElement;
    private contentAreaEl!: HTMLElement;
    private highlightCommentsVisible: Map<string, boolean> = new Map();
    private groupingMode: 'none' | 'color' | 'comments-asc' | 'comments-desc' | 'tag' | 'parent' | 'collection' | 'filename' | 'date-created-asc' | 'date-created-desc' = 'none';
    private commentsExpanded: boolean = false;
    private commentsToggleButton!: HTMLElement;
    private selectedTags: Set<string> = new Set();
    private selectedCollections: Set<string> = new Set();
    private viewMode: 'current' | 'all' | 'collections' = 'current';
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
    private showNativeComments: boolean = true; // Track native comments visibility

    constructor(leaf: WorkspaceLeaf, plugin: HighlightCommentsPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.highlightRenderer = new HighlightRenderer(plugin);
        // Load grouping mode from settings
        this.groupingMode = plugin.settings.groupingMode || 'none';
        // Load native comments visibility from vault-specific localStorage
        this.showNativeComments = this.plugin.app.loadLocalStorage('sidebar-highlights-show-native-comments') !== 'false';
    }

    getViewType() { return VIEW_TYPE_HIGHLIGHTS; }
    getDisplayText() { return 'Highlights'; }
    getIcon() { return 'highlighter'; }

    async onOpen() {
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
            setTooltip(searchButton, 'Search');
            searchButton.addEventListener('click', () => {
                this.toggleSearch();
            });

            const groupButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setIcon(groupButton, 'group');
            setTooltip(groupButton, 'Group highlights');
            this.updateGroupButtonState(groupButton);
            groupButton.addEventListener('click', (event) => {
                const menu = new Menu();
                
                menu.addItem((item) => {
                    item
                        .setTitle('None')
                        .setIcon('list')
                        .setChecked(this.groupingMode === 'none')
                        .onClick(() => {
                            this.groupingMode = 'none';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            // Use renderContent instead of renderFilteredList to handle all view modes
                            this.renderContent();
                        });
                });

                menu.addSeparator();
                
                menu.addItem((item) => {
                    item
                        .setTitle('Color')
                        .setIcon('palette')
                        .setChecked(this.groupingMode === 'color')
                        .onClick(() => {
                            this.groupingMode = 'color';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle('Highlight comments ↑')
                        .setIcon('sort-asc')
                        .setChecked(this.groupingMode === 'comments-asc')
                        .onClick(() => {
                            this.groupingMode = 'comments-asc';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle('Highlight comments ↓')
                        .setIcon('sort-desc')
                        .setChecked(this.groupingMode === 'comments-desc')
                        .onClick(() => {
                            this.groupingMode = 'comments-desc';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle('Date created ↑')
                        .setIcon('calendar')
                        .setChecked(this.groupingMode === 'date-created-asc')
                        .onClick(() => {
                            this.groupingMode = 'date-created-asc';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle('Date created ↓')
                        .setIcon('calendar')
                        .setChecked(this.groupingMode === 'date-created-desc')
                        .onClick(() => {
                            this.groupingMode = 'date-created-desc';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item
                        .setTitle('Parent')
                        .setIcon('folder')
                        .setChecked(this.groupingMode === 'parent')
                        .onClick(() => {
                            this.groupingMode = 'parent';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle('Collection')
                        .setIcon('folder-open')
                        .setChecked(this.groupingMode === 'collection')
                        .onClick(() => {
                            this.groupingMode = 'collection';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle('Filename')
                        .setIcon('file-text')
                        .setChecked(this.groupingMode === 'filename')
                        .onClick(() => {
                            this.groupingMode = 'filename';
                            this.updateGroupButtonState(groupButton);
                            this.saveGroupingModeToSettings();
                            this.renderContent();
                        });
                });

                menu.showAtMouseEvent(event);
            });

            // Add toggle native comments button (positioned after group button)
            const nativeCommentsToggleButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setTooltip(nativeCommentsToggleButton, 'Toggle native comments');
            this.updateNativeCommentsToggleState(nativeCommentsToggleButton);
            nativeCommentsToggleButton.addEventListener('click', () => {
                this.toggleNativeCommentsVisibility();
                this.updateNativeCommentsToggleState(nativeCommentsToggleButton);
                this.renderContent();
            });

            const commentsToggleButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setTooltip(commentsToggleButton, 'Toggle highlight comments');
            this.commentsToggleButton = commentsToggleButton;
            this.updateCommentsToggleIcon(commentsToggleButton);
            commentsToggleButton.addEventListener('click', () => {
                this.toggleAllComments();
                this.updateCommentsToggleIcon(commentsToggleButton);
                this.renderContent(); // Use renderContent instead of renderFilteredList
            });

            const resetColorsButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setTooltip(resetColorsButton, 'Revert highlight colors');
            setIcon(resetColorsButton, 'rotate-ccw');
            resetColorsButton.addEventListener('click', () => {
                this.resetAllColors();
            });

            const tagFilterButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button highlights-tag-filter-button'
            });
            setTooltip(tagFilterButton, 'Filter');
            setIcon(tagFilterButton, 'list-filter');
            
            tagFilterButton.addEventListener('click', (event) => {
                this.showTagFilterMenu(event);
            });

            // Add collection navigation button (New Collection / Back to Collections)
            const collectionNavButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setTooltip(collectionNavButton, 'Collection Navigation');
            this.updateCollectionNavButton(collectionNavButton);
            
            collectionNavButton.addEventListener('click', () => {
                if (this.viewMode === 'collections' && this.currentCollectionId) {
                    // Back to collections
                    this.currentCollectionId = null;
                    this.renderContent();
                } else {
                    // New collection
                    this.showNewCollectionDialog();
                }
            });

            // Create search input container (initially hidden)
            const searchInputContainer = this.contentEl.createDiv({ 
                cls: 'highlights-search-input-container hidden'
            });
            
            // Create the search input
            this.searchInputEl = searchInputContainer.createEl('input', {
                type: 'text',
                placeholder: 'Search highlights, use #tag @collection (-# to exclude)...',
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
        
        const currentNoteTab = tabsContainer.createEl('button', {
            cls: 'highlights-tab active'
        });
        setIcon(currentNoteTab, 'file-text');
        setTooltip(currentNoteTab, 'Current note');
        
        const allNotesTab = tabsContainer.createEl('button', {
            cls: 'highlights-tab'
        });
        setIcon(allNotesTab, 'files');
        setTooltip(allNotesTab, 'All notes');

        const collectionsTab = tabsContainer.createEl('button', {
            cls: 'highlights-tab'
        });
        setIcon(collectionsTab, 'folder-open');
        setTooltip(collectionsTab, 'Collections');

        // Add click handlers
        currentNoteTab.addEventListener('click', () => {
            if (this.viewMode !== 'current') {
                currentNoteTab.classList.add('active');
                allNotesTab.classList.remove('active');
                collectionsTab.classList.remove('active');
                this.viewMode = 'current';
                this.selectedTags.clear();
                this.selectedCollections.clear();
                this.updateContent(); // Content update instead of full rebuild
            }
        });

        allNotesTab.addEventListener('click', () => {
            if (this.viewMode !== 'all') {
                allNotesTab.classList.add('active');
                currentNoteTab.classList.remove('active');
                collectionsTab.classList.remove('active');
                this.viewMode = 'all';
                this.selectedTags.clear();
                this.selectedCollections.clear();
                this.updateContent(); // Content update instead of full rebuild
            }
        });

        collectionsTab.addEventListener('click', () => {
            if (this.viewMode !== 'collections') {
                collectionsTab.classList.add('active');
                currentNoteTab.classList.remove('active');
                allNotesTab.classList.remove('active');
                this.viewMode = 'collections';
                this.currentCollectionId = null;
                this.selectedTags.clear();
                this.selectedCollections.clear();
                this.updateContent(); // Content update instead of full rebuild
            }
        });

        this.contentAreaEl = this.contentEl.createDiv({ cls: 'highlights-list-area' });
        this.listContainerEl = this.contentAreaEl.createDiv({ cls: 'highlights-list' });

        this.renderContent();
    }

    async onClose() {
        // Clean up dropdown manager
        this.dropdownManager.cleanup();
        
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
        
        this.onOpen();
        
        // Restore the view mode and collection state after DOM recreation
        this.viewMode = currentViewMode;
        this.currentCollectionId = currentCollectionId;
        
        // Update the tab states to reflect the current view mode
        this.updateTabStates();
        
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
        if (tabs.length >= 3) {
            const currentNoteTab = tabs[0] as HTMLElement;  // First tab
            const allNotesTab = tabs[1] as HTMLElement;     // Second tab  
            const collectionsTab = tabs[2] as HTMLElement;  // Third tab
            
            // Remove active class from all tabs
            currentNoteTab.classList.remove('active');
            allNotesTab.classList.remove('active');
            collectionsTab.classList.remove('active');
            
            // Add active class to the correct tab based on current view mode
            switch (this.viewMode) {
                case 'current':
                    currentNoteTab.classList.add('active');
                    break;
                case 'all':
                    allNotesTab.classList.add('active');
                    break;
                case 'collections':
                    collectionsTab.classList.add('active');
                    break;
            }
        }
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
        } else {
            this.enableSearchAndToolbar();
            this.renderFilteredList();
        }
        
        // Update the collection navigation button when view changes
        const collectionNavButton = this.contentEl.querySelector('.highlights-search-container button:last-of-type') as HTMLElement;
        if (collectionNavButton) {
            this.updateCollectionNavButton(collectionNavButton);
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
        container.createEl('p', { 
            text: 'No collections.'
        });
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
                description.textContent = 'No description';
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
        container.createEl('p', { 
            text: 'No highlights in collection.'
        });
    }

    private renderCollectionHighlights(highlights: Highlight[]) {
        // Apply all filtering (smart search + existing filters)
        const searchTerm = this.searchInputEl?.value.toLowerCase().trim() || '';
        let filteredHighlights = this.applyAllFilters(highlights);

        if (filteredHighlights.length === 0) {
            const message = searchTerm ? 'No matching highlights in collection.' : 'No highlights in collection.';
            this.listContainerEl.createEl('p', { text: message });
            return;
        }

        // Apply grouping if enabled
        if (this.groupingMode === 'none') {
            const sortedHighlights = filteredHighlights.sort((a, b) => {
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
                this.listContainerEl.createEl('p', { text: 'No file open.' });
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
                    message = 'PDF highlights are not supported.';
                } else {
                    message = searchTerm ? 'No matching highlights.' : 'No highlights in this file.';
                }
            } else {
                message = searchTerm ? 'No matching highlights across all files.' : 'No highlights found across all files.';
            }
            this.listContainerEl.createEl('p', { text: message });
        } else {
            if (this.groupingMode === 'none') {
                // Sort by file path first, then by offset within file
                const sortedHighlights = filteredHighlights.sort((a, b) => {
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
        headerText.textContent = groupName;
        
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
        this.plugin.settings.groupingMode = this.groupingMode;
        this.plugin.saveSettings();
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
            isCommentsVisible: this.highlightCommentsVisible.get(highlight.id) || false,
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
                this.focusHighlightInEditor(highlight, event);
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
        const lines = content.split('\n');
        
        // Find the line containing this highlight
        let targetLine = -1;
        let insertPos: { line: number; ch: number } | null = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (highlight.isNativeComment) {
                if (line.includes(`%%${highlight.text}%%`)) {
                    targetLine = i;
                    const highlightEndIndex = line.indexOf(`%%${highlight.text}%%`) + `%%${highlight.text}%%`.length;
                    // Find the end of any existing footnotes after the highlight
                    const afterHighlight = line.substring(highlightEndIndex);
                    const footnoteEndMatch = afterHighlight.match(/^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*/);
                    const footnoteEndLength = footnoteEndMatch ? footnoteEndMatch[0].length : 0;
                    insertPos = { line: i, ch: highlightEndIndex + footnoteEndLength };
                    break;
                }
            } else {
                if (line.includes(`==${highlight.text}==`)) {
                    targetLine = i;
                    const highlightEndIndex = line.indexOf(`==${highlight.text}==`) + `==${highlight.text}==`.length;
                    // Find the end of any existing footnotes after the highlight
                    const afterHighlight = line.substring(highlightEndIndex);
                    const footnoteEndMatch = afterHighlight.match(/^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*/);
                    const footnoteEndLength = footnoteEndMatch ? footnoteEndMatch[0].length : 0;
                    insertPos = { line: i, ch: highlightEndIndex + footnoteEndLength };
                    break;
                }
            }
        }

        if (!insertPos) {
            new Notice('Could not find the highlight in the editor. It might have been modified.');
            return;
        }

        // Position cursor at the end of the highlight
        editor.setCursor(insertPos);
        editor.focus();

        // Add the footnote
        if (this.plugin.settings.useInlineFootnotes) {
            // Use inline footnote
            const success = this.plugin.inlineFootnoteManager.insertInlineFootnote(editor, highlight, '');
            if (success) {
                // Wait a brief moment for the editor content to update
                setTimeout(async () => {
                    await this.updateSingleHighlightFromEditor(highlight, file);
                }, 50);
            } else {
                new Notice('Could not insert inline footnote.');
            }
        } else {
            // Use standard footnote
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
                const standardFootnoteRegex = /(\s*\[\^(\w+)\])(?!:)/g;
                let stdMatch;
                let lastValidPosition = 0;
                
                while ((stdMatch = standardFootnoteRegex.exec(afterHighlight)) !== null) {
                    // Check if this standard footnote is in a valid position
                    const precedingText = afterHighlight.substring(lastValidPosition, stdMatch.index);
                    const isValid = /^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*\s*$/.test(precedingText);
                    
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
        
        // Use different regex pattern based on whether it's a native comment or regular highlight
        const regexPattern = highlight.isNativeComment 
            ? `%%${this.escapeRegex(highlight.text)}%%`
            : `==${this.escapeRegex(highlight.text)}==`;
        const regex = new RegExp(regexPattern, 'g');
        const matches: { index: number, length: number }[] = [];
        let matchResult;
        while ((matchResult = regex.exec(content)) !== null) {
            matches.push({ index: matchResult.index, length: matchResult[0].length });
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
        // A small tolerance, though for both ==text== and %%text%% it should ideally be exact or very close.
        if (!foundMatch || minDistance > 5) {
            // Using best guess for highlight position
        }

        const startPos = targetView.editor.offsetToPos(targetMatchInfo.index + 2);
        const endPos = targetView.editor.offsetToPos(targetMatchInfo.index + targetMatchInfo.length - 2);
        
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
            // Use different regex pattern based on whether it's a native comment or regular highlight
            const regexPattern = highlight.isNativeComment 
                ? `%%${escapedText}%%`
                : `==${escapedText}==`;
            const highlightRegex = new RegExp(regexPattern, 'g');
            let match;
            let bestMatch: { index: number, length: number } | null = null;
            let minDistance = Infinity;

            while ((match = highlightRegex.exec(content)) !== null) {
                const distance = Math.abs(match.index - highlight.startOffset);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = { index: match.index, length: match[0].length };
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
            
            // Get standard footnotes
            const standardFootnoteRegex = /(\s*\[\^(\w+)\])/g;
            let match_sf;
            let lastValidPosition = 0;
            
            while ((match_sf = standardFootnoteRegex.exec(afterHighlight)) !== null) {
                // Check if this standard footnote is in a valid position
                const precedingText = afterHighlight.substring(lastValidPosition, match_sf.index);
                const isValid = /^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*\s*$/.test(precedingText);
                
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
                // For inline footnotes, focus on the footnote content directly
                // Find the position of the ^ character (skip any leading spaces)
                const footnoteText = content.substring(targetFootnote.startIndex, targetFootnote.endIndex);
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
        // Update the highlight color
        this.plugin.updateHighlight(highlight.id, { color: color }, highlight.filePath);
    }

    private getColorName(hex: string): string {
        const colorMap: { [key: string]: string } = {
            [this.plugin.settings.customColors.yellow]: 'Yellow',
            [this.plugin.settings.customColors.red]: 'Red', 
            [this.plugin.settings.customColors.teal]: 'Turquoise',
            [this.plugin.settings.customColors.blue]: 'Blue',
            [this.plugin.settings.customColors.green]: 'Green'
        };
        return colorMap[hex] || hex;
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
            headerText.textContent = groupName;
            
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
        
        // Get highlights based on current view mode
        let highlightsToConsider: Highlight[];
        if (this.viewMode === 'current') {
            highlightsToConsider = this.plugin.getCurrentFileHighlights();
        } else if (this.viewMode === 'all') {
            // Get all highlights from all files
            highlightsToConsider = [];
            for (const [, fileHighlights] of this.plugin.highlights) {
                highlightsToConsider.push(...fileHighlights);
            }
        } else if (this.viewMode === 'collections' && this.currentCollectionId) {
            // Get highlights from current collection
            highlightsToConsider = this.plugin.collectionsManager.getHighlightsInCollection(this.currentCollectionId);
        } else {
            highlightsToConsider = [];
        }
        
        // Check if any comments are currently expanded
        const anyExpanded = highlightsToConsider.some(highlight => {
            // Only check for footnote comments on regular highlights, not native comments
            if (highlight.isNativeComment) return false;
            const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
            return validFootnoteCount > 0 && this.highlightCommentsVisible.get(highlight.id);
        });
        
        const iconName = anyExpanded ? 'chevrons-down-up' : 'chevrons-up-down';
        setIcon(button, iconName);
    }

    private toggleAllComments() {
        // Get highlights based on current view mode
        let highlightsToToggle: Highlight[];
        if (this.viewMode === 'current') {
            highlightsToToggle = this.plugin.getCurrentFileHighlights();
        } else if (this.viewMode === 'all') {
            // Get all highlights from all files
            highlightsToToggle = [];
            for (const [, fileHighlights] of this.plugin.highlights) {
                highlightsToToggle.push(...fileHighlights);
            }
        } else if (this.viewMode === 'collections' && this.currentCollectionId) {
            // Get highlights from current collection
            highlightsToToggle = this.plugin.collectionsManager.getHighlightsInCollection(this.currentCollectionId);
        } else {
            highlightsToToggle = [];
        }
        
        // Check if any comments are currently expanded
        const anyExpanded = highlightsToToggle.some(highlight => {
            // Only check for footnote comments on regular highlights, not native comments
            if (highlight.isNativeComment) return false;
            const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
            return validFootnoteCount > 0 && this.highlightCommentsVisible.get(highlight.id);
        });
        
        // If any are expanded, collapse all. If none are expanded, expand all.
        const newState = !anyExpanded;
        
        highlightsToToggle.forEach(highlight => {
            // Only toggle footnote comments for regular highlights, not native comments
            if (highlight.isNativeComment) return;
            const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
            if (validFootnoteCount > 0) {
                this.highlightCommentsVisible.set(highlight.id, newState);
            }
        });
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
                    // Extract hashtags from footnote content (including unicode characters)
                    const tagMatches = content.match(/#[\p{L}\p{N}\p{M}_-]+/gu);
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

    private showTagFilterMenu(event: MouseEvent) {
        const availableTags = this.getAllTagsInFile();
        const availableCollections = this.getAllCollectionsInCurrentScope();
        
        if (availableTags.length === 0 && availableCollections.length === 0) {
            new Notice('No tags or collections found');
            return;
        }

        // Sort collections alphabetically with locale-aware sorting
        const sortedCollections = availableCollections.sort((a, b) => 
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );
        
        const items: DropdownItem[] = [
            {
                text: 'Clear',
                icon: 'x',
                className: 'highlights-dropdown-clear',
                onClick: () => {
                    this.selectedTags.clear();
                this.selectedCollections.clear();
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
                    this.dropdownManager.updateAllCheckboxStates(newStates);
                }
            }
        ];

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
                text: 'Clear',
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
                text: 'New collection',
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
                text: 'No collections available',
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
            setTooltip(button, 'Back to Collections');
            button.classList.add('active', 'collection-nav-back');
        } else {
            // Show new collection button with normal styling
            setIcon(button, 'folder-plus');
            setTooltip(button, 'New collection');
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
            searchInputContainer.classList.remove('hidden');
            this.searchButton.classList.add('active');
            setIcon(this.searchButton, 'x');
            setTooltip(this.searchButton, 'Close search');
            // Focus the search input
            window.setTimeout(() => this.searchInputEl.focus(), 100);
        } else {
            searchInputContainer.classList.add('hidden');
            this.searchButton.classList.remove('active');
            setIcon(this.searchButton, 'search');
            setTooltip(this.searchButton, 'Search highlights');
            // Clear search when closing
            this.simpleSearchManager?.clear();
            this.currentSearchTokens = [];
            this.currentParsedSearch = { ast: null };
            this.renderContent();
        }
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
            
            if (this.viewMode === 'collections' && !this.currentCollectionId && !isCollectionNavButton && !isNativeCommentsToggle) {
                // In collections overview, disable all buttons except collection nav and native comments toggle
                button.classList.add('disabled');
            } else {
                // Enable all other cases
                button.classList.remove('disabled');
            }
        });
        
        // Update collection nav button styling
        const collectionNavButton = this.contentEl.querySelector('.highlights-search-container button:last-of-type') as HTMLElement;
        if (collectionNavButton) {
            this.updateCollectionNavButton(collectionNavButton);
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
        const collectionNavButton = this.contentEl.querySelector('.highlights-search-container button:last-of-type') as HTMLElement;
        if (collectionNavButton) {
            this.updateCollectionNavButton(collectionNavButton);
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
            if (this.selectedTags.size > 0 || this.selectedCollections.size > 0) {
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
                .setTitle('Edit')
                .setIcon('edit')
                .onClick(() => {
                    this.showEditCollectionDialog(collection);
                });
        });
        
        menu.addItem((item) => {
            item
                .setTitle('Delete')
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
            setTooltip(button, 'Toggle native comments');
        } else {
            setIcon(button, 'captions-off');
            button.classList.add('active');
            setTooltip(button, 'Toggle native comments');
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