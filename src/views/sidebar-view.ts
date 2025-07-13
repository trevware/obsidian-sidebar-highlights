import { ItemView, WorkspaceLeaf, MarkdownView, TFile, Menu, Notice, debounce, setIcon, Modal, Setting, App, setTooltip } from 'obsidian';
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
    private tagDropdownOpen: boolean = false;
    private collectionsDropdownOpen: boolean = false;
    private viewMode: 'current' | 'all' | 'collections' = 'current';
    private currentCollectionId: string | null = null;
    private searchExpanded: boolean = false;
    private searchButton!: HTMLElement;
    private simpleSearchManager!: SimpleSearchManager;
    private currentSearchTokens: SearchToken[] = [];
    private currentParsedSearch: ParsedSearch = { ast: null };
    private dropdownManager: DropdownManager = new DropdownManager();
    private highlightRenderer: HighlightRenderer;
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
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
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
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
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
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle('Highlight comments ↓')
                        .setIcon('sort-desc')
                        .setChecked(this.groupingMode === 'comments-desc')
                        .onClick(() => {
                            this.groupingMode = 'comments-desc';
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
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
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle('Date created ↓')
                        .setIcon('calendar')
                        .setChecked(this.groupingMode === 'date-created-desc')
                        .onClick(() => {
                            this.groupingMode = 'date-created-desc';
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
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
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle('Collection')
                        .setIcon('folder-open')
                        .setChecked(this.groupingMode === 'collection')
                        .onClick(() => {
                            this.groupingMode = 'collection';
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
                        });
                });

                menu.addItem((item) => {
                    item
                        .setTitle('Filename')
                        .setIcon('file-text')
                        .setChecked(this.groupingMode === 'filename')
                        .onClick(() => {
                            this.groupingMode = 'filename';
                            this.saveGroupingModeToSettings();
                            this.conditionalRefresh({ highlights: true, toolbar: true });
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
                this.conditionalRefresh({ highlights: true, toolbar: true });
            });

            const commentsToggleButton = searchContainer.createEl('button', {
                cls: 'highlights-group-button'
            });
            setTooltip(commentsToggleButton, 'Toggle highlight comments');
            this.commentsToggleButton = commentsToggleButton;
            this.updateCommentsToggleIcon(commentsToggleButton);
            commentsToggleButton.addEventListener('click', () => {
                this.toggleAllComments();
                this.conditionalRefresh({ highlights: true, toolbar: true });
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
                    this.conditionalRefresh({ structure: true, toolbar: true });
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
                this.viewMode = 'current';
                this.selectedTags.clear();
                this.selectedCollections.clear();
                this.conditionalRefresh({ structure: true });
            }
        });

        allNotesTab.addEventListener('click', () => {
            if (this.viewMode !== 'all') {
                this.viewMode = 'all';
                this.selectedTags.clear();
                this.selectedCollections.clear();
                this.conditionalRefresh({ structure: true });
            }
        });

        collectionsTab.addEventListener('click', () => {
            if (this.viewMode !== 'collections') {
                this.viewMode = 'collections';
                this.currentCollectionId = null;
                this.selectedTags.clear();
                this.selectedCollections.clear();
                this.conditionalRefresh({ structure: true });
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
        this.tagDropdownOpen = false;
        this.collectionsDropdownOpen = false;
        
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
        
        // Clear any tag filters
        this.selectedTags.clear();
        
        // Use conditional refresh for structure change
        this.conditionalRefresh({ structure: true, toolbar: true });
    }

    refresh() {
        // Use conditional update instead of full DOM rebuild
        this.conditionalRefresh({ highlights: true, toolbar: true });
    }
    
    // Conditional refresh system - only updates what actually changed
    private conditionalRefresh(changes: {
        highlights?: boolean;
        toolbar?: boolean;
        tabs?: boolean;
        structure?: boolean; // For major structural changes like view mode switches
    }) {
        // If structure changed, do a full rebuild
        if (changes.structure) {
            this.renderContent();
            // Always update tabs after structure changes since view mode may have changed
            this.updateTabStates();
            return;
        }
        
        // Update toolbar if needed
        if (changes.toolbar) {
            this.updateToolbar();
        }
        
        // Update tabs if needed  
        if (changes.tabs) {
            this.updateTabStates();
        }
        
        // Update highlights list if needed
        if (changes.highlights) {
            this.updateHighlightsList();
        }
    }
    
    // Update just the highlights list content without rebuilding DOM structure
    private updateHighlightsList() {
        if (!this.listContainerEl) {
            // Structure doesn't exist, need full rebuild
            this.conditionalRefresh({ structure: true });
            return;
        }
        
        // Preserve scroll position during updates
        const scrollTop = this.contentAreaEl?.scrollTop || 0;
        
        // Clear just the list container content
        this.listContainerEl.empty();
        
        // Render highlights based on current view mode
        this.renderHighlightsContent();
        
        // Restore scroll position
        if (this.contentAreaEl) {
            this.contentAreaEl.scrollTop = scrollTop;
        }
        
        this.showTagActive();
        
        // Ensure selected highlight styling is maintained after DOM updates
        this.restoreSelectedHighlight();
    }
    
    // Render highlights content into existing container
    private renderHighlightsContent() {
        if (!this.listContainerEl) return;
        
        if (this.viewMode === 'collections') {
            if (this.currentCollectionId) {
                this.renderCollectionHighlightsContent();
            } else {
                this.renderCollectionsContent();
            }
        } else {
            this.renderFilteredHighlightsContent();
        }
        
        // Ensure selected highlight styling is maintained after rendering
        if (this.plugin.selectedHighlightId) {
            this.restoreSelectedHighlight();
        }
    }
    
    // Render highlights without clearing contentAreaEl
    private renderFilteredHighlightsContent() {
        if (!this.listContainerEl) return;
        
        const searchTerm = this.searchInputEl ? this.searchInputEl.value.toLowerCase().trim() : '';
        let allHighlights: Highlight[];
        
        if (this.viewMode === 'current') {
            const file = this.plugin.app.workspace.getActiveFile();
            if (!file) {
                this.listContainerEl.createEl('p', { text: 'No file open.' });
                return;
            }
            allHighlights = this.plugin.getCurrentFileHighlights();
        } else {
            // Get all highlights from all files
            allHighlights = [];
            for (const [filePath, highlights] of this.plugin.highlights) {
                allHighlights.push(...highlights);
            }
        }

        const filteredHighlights = this.applyAllFilters(allHighlights);

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
            return;
        }

        if (this.groupingMode === 'none') {
            const sortedHighlights = filteredHighlights.sort((a, b) => {
                if (a.filePath !== b.filePath) {
                    return a.filePath.localeCompare(b.filePath);
                }
                return a.startOffset - b.startOffset;
            });
            
            sortedHighlights.forEach(highlight => {
                this.createHighlightItem(this.listContainerEl, highlight, searchTerm, this.viewMode === 'all');
            });
        } else {
            this.renderGroupedHighlights(filteredHighlights, searchTerm, this.viewMode === 'all');
        }
    }
    
    // Render collections content without clearing contentAreaEl
    private renderCollectionsContent() {
        if (!this.listContainerEl) return;
        
        const collections = this.plugin.collectionsManager.getAllCollections();
        
        if (collections.length === 0) {
            this.listContainerEl.createEl('p', { text: 'No collections.' });
        } else {
            this.renderCollectionsGrid(this.listContainerEl, collections);
        }
    }
    
    // Render collection highlights content without clearing contentAreaEl
    private renderCollectionHighlightsContent() {
        if (!this.listContainerEl || !this.currentCollectionId) return;
        
        const collection = this.plugin.collectionsManager.getCollection(this.currentCollectionId);
        if (!collection) {
            new Notice('Collection not found');
            this.currentCollectionId = null;
            this.conditionalRefresh({ structure: true });
            return;
        }

        const highlights = this.plugin.collectionsManager.getHighlightsInCollection(this.currentCollectionId);
        
        if (highlights.length === 0) {
            this.listContainerEl.createEl('p', { text: 'No highlights in collection.' });
            return;
        }

        const searchTerm = this.searchInputEl?.value.toLowerCase().trim() || '';
        const filteredHighlights = this.applyAllFilters(highlights);

        if (filteredHighlights.length === 0) {
            const message = searchTerm ? 'No matching highlights in collection.' : 'No highlights in collection.';
            this.listContainerEl.createEl('p', { text: message });
            return;
        }

        if (this.groupingMode === 'none') {
            const sortedHighlights = filteredHighlights.sort((a, b) => {
                if (a.filePath !== b.filePath) {
                    return a.filePath.localeCompare(b.filePath);
                }
                return a.startOffset - b.startOffset;
            });
            
            sortedHighlights.forEach(highlight => {
                this.createHighlightItem(this.listContainerEl, highlight, searchTerm, true);
            });
        } else {
            this.renderGroupedHighlights(filteredHighlights, searchTerm, true);
        }
    }
    
    // Update toolbar state without rebuilding
    private updateToolbar() {
        if (!this.plugin.settings.showToolbar) return;
        
        // Update button states
        const searchContainer = this.contentEl.querySelector('.highlights-search-container');
        if (searchContainer) {
            // Update group button state
            const groupButton = searchContainer.querySelector('.highlights-group-button:nth-child(2)') as HTMLElement;
            if (groupButton) {
                this.updateGroupButtonState(groupButton);
            }
            
            // Update comments toggle button
            if (this.commentsToggleButton) {
                this.updateCommentsToggleIcon(this.commentsToggleButton);
            }
            
            // Update native comments toggle
            const nativeCommentsButton = searchContainer.querySelector('.highlights-group-button:nth-child(3)') as HTMLElement;
            if (nativeCommentsButton) {
                this.updateNativeCommentsToggleState(nativeCommentsButton);
            }
            
            // Update collection nav button
            const collectionNavButton = searchContainer.querySelector('.highlights-group-button:last-of-type') as HTMLElement;
            if (collectionNavButton) {
                this.updateCollectionNavButton(collectionNavButton);
            }
        }
    }
    
    // Update tab states without rebuilding
    private updateTabStates() {
        const tabs = this.contentEl.querySelectorAll('.highlights-tab');
        if (tabs.length >= 3) {
            const currentNoteTab = tabs[0] as HTMLElement;
            const allNotesTab = tabs[1] as HTMLElement;
            const collectionsTab = tabs[2] as HTMLElement;
            
            // Remove active class from all
            [currentNoteTab, allNotesTab, collectionsTab].forEach(tab => tab.classList.remove('active'));
            
            // Add active class to current view
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
    
    // Method for forcing full rebuild when structure changes (settings, etc.)
    refreshStructure() {
        // Preserve current view mode and collection state
        const currentViewMode = this.viewMode;
        const currentCollectionId = this.currentCollectionId;
        
        this.onOpen();
        
        // Restore the view mode and collection state after DOM recreation
        this.viewMode = currentViewMode;
        this.currentCollectionId = currentCollectionId;
        
        // Update the tab states to reflect the current view mode
        this.updateTabStates();
        
        // Restore selected highlight styling after DOM rebuild
        this.restoreSelectedHighlight();
    }

    private restoreSelectedHighlight() {
        if (!this.plugin.selectedHighlightId) {
            return;
        }
        
        // Use a small delay to ensure DOM is stable after updates
        window.setTimeout(() => {
            const selectedEl = this.containerEl.querySelector(`[data-highlight-id="${this.plugin.selectedHighlightId}"]`) as HTMLElement;
            if (selectedEl) {
                selectedEl.classList.add('selected');
                
                // Find the highlight data to apply correct styling
                const selectedHighlight = this.getHighlightById(this.plugin.selectedHighlightId!);
                if (selectedHighlight) {
                    selectedEl.classList.add('highlight-selected');
                    
                    // Apply the correct border color and box-shadow
                    const highlightColor = selectedHighlight.color || this.plugin.settings.highlightColor;
                    selectedEl.style.borderLeftColor = highlightColor;
                    if (!selectedHighlight.isNativeComment) {
                        selectedEl.style.boxShadow = `0 0 0 1.5px ${highlightColor}, var(--shadow-s)`;
                    }
                }
            }
        }, 50);
    }

    private renderContent() {
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
    }

    private renderCollectionsView() {
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
                this.conditionalRefresh({ structure: true, toolbar: true });
            });
        });
    }

    private renderCollectionDetailView(collectionId: string) {
        const collection = this.plugin.collectionsManager.getCollection(collectionId);
        if (!collection) {
            new Notice('Collection not found');
            this.currentCollectionId = null;
            this.conditionalRefresh({ structure: true });
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
                
                // No grouping - just show individual highlights with filenames when in all notes mode
                sortedHighlights.forEach(highlight => {
                    this.createHighlightItem(this.listContainerEl, highlight, searchTerm, this.viewMode === 'all');
                });
            } else {
                this.renderGroupedHighlights(filteredHighlights, searchTerm, this.viewMode === 'all');
            }
        }
        this.showTagActive();
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
            onCommentToggle: (highlightId) => {
                const currentVisibility = this.highlightCommentsVisible.get(highlightId) || false;
                this.highlightCommentsVisible.set(highlightId, !currentVisibility);
                this.rerenderCurrentView();
            },
            onCollectionsMenu: (event, highlight) => {
                this.showCollectionsMenu(event, highlight);
            },
            onColorChange: (highlight, color) => {
                this.changeHighlightColor(highlight, color);
                this.conditionalRefresh({ highlights: true });
                
                // Ensure the selected highlight styling is correct after color change
                requestAnimationFrame(() => {
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
                });
            },
            onHighlightClick: (highlight) => {
                this.focusHighlightInEditor(highlight);
            },
            onAddComment: (highlight) => {
                this.addFootnoteToHighlight(highlight);
            },
            onCommentClick: (highlight, commentIndex) => {
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
                    this.focusFootnoteInEditor(highlight, originalIndex);
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
            onFileNameClick: (filePath) => {
                this.plugin.app.workspace.openLinkText(filePath, filePath, false);
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
        
        // Ensure selected highlight styling is maintained after rerender
        if (this.plugin.selectedHighlightId) {
            this.restoreSelectedHighlight();
        }
    }

    private addFootnoteToHighlight(highlight: Highlight) {
        // First, focus the highlight in the editor
        this.focusHighlightInEditor(highlight);
        
        // Wait a bit for the focus to complete, then add footnote
        window.setTimeout(() => {
            const activeEditorView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeEditorView || !activeEditorView.editor || activeEditorView.file?.path !== highlight.filePath) {
                // Ensure the editor is for the correct file, especially after focusHighlightInEditor might open a new one
                const correctView = this.plugin.app.workspace.getLeavesOfType('markdown')
                    .map(leaf => leaf.view as MarkdownView)
                    .find(view => view.file?.path === highlight.filePath);
                
                if (!correctView || !correctView.editor) {
                    new Notice('Could not access the editor for the target file.');
                    return;
                }
                // If we found the correct view, proceed with its editor (though focusHighlightInEditor should handle activation)
                // This check is more of a safeguard.
            }

            // Re-fetch active editor view as focusHighlightInEditor might have changed it
            const currentEditorView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!currentEditorView || !currentEditorView.editor || currentEditorView.file?.path !== highlight.filePath) {
                 new Notice('Editor for the highlight\'s file is not active.');
                 return;
            }
            const editor = currentEditorView.editor;
            const content = editor.getValue();
            const escapedText = this.escapeRegex(highlight.text);
            
            // Look for existing footnotes after this highlight
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

            if (bestMatch) {
                let insertOffset = bestMatch.index + bestMatch.length;
                
                // Check for existing footnotes after the highlight (no spaces between footnotes)
                const afterHighlight = content.substring(insertOffset);
                const footnoteMatches = afterHighlight.match(/^(\[\^\w+\])+/);
                
                if (footnoteMatches) {
                    // If there are existing footnotes, position cursor after them
                    insertOffset += footnoteMatches[0].length;
                    // Update footnote count
                    const footnoteCount = (footnoteMatches[0].match(/\[\^\w+\]/g) || []).length;
                    highlight.footnoteCount = footnoteCount + 1;
                } else {
                    // First footnote for this highlight
                    highlight.footnoteCount = 1;
                }

                const insertPos = editor.offsetToPos(insertOffset);
                editor.setCursor(insertPos);
                editor.focus();
                
                // Check user preference for footnote type
                if (this.plugin.settings.useInlineFootnotes) {
                    // Use inline footnote manager
                    const success = this.plugin.inlineFootnoteManager.insertInlineFootnote(editor, highlight, 'New comment');
                    if (success) {
                        // Update the highlight in storage and refresh sidebar
                        this.plugin.updateHighlight(highlight.id, { footnoteCount: highlight.footnoteCount }, highlight.filePath);
                    } else {
                        new Notice('Could not insert inline footnote.');
                    }
                } else {
                    // Use Obsidian's built-in Insert Footnote command
                    (this.plugin.app as any).commands.executeCommandById('editor:insert-footnote');
                    
                    // Update the highlight in storage and refresh sidebar
                    this.plugin.updateHighlight(highlight.id, { footnoteCount: highlight.footnoteCount }, highlight.filePath);
                }
            } else {
                new Notice('Could not find the highlight in the editor. It might have been modified.');
            }
        }, 150);
    }

    async focusHighlightInEditor(highlight: Highlight) {
        // Always clear ALL existing selections first to prevent multiple selections
        const allSelectedElements = this.containerEl.querySelectorAll('.selected, .highlight-selected');
        allSelectedElements.forEach(el => {
            el.classList.remove('selected', 'highlight-selected');
            // Clear any inline styles that might have been applied
            (el as HTMLElement).style.removeProperty('box-shadow');
        });
        
        // Set the selection ID but defer visual styling until after potential file operations
        this.plugin.selectedHighlightId = highlight.id;
        
        // Enhanced helper function to apply selection styling with retries
        const applySelectionStyling = (maxRetries = 5, delay = 100) => {
            const tryApplySelection = (attempt = 0) => {
                const targetEl = this.containerEl.querySelector(`[data-highlight-id="${highlight.id}"]`) as HTMLElement;
                if (targetEl) {
                    targetEl.classList.add('selected');
                    // Find the highlight in the correct file
                    const fileHighlights = this.plugin.highlights.get(highlight.filePath);
                    const targetHighlight = fileHighlights?.find(h => h.id === highlight.id);
                    if (targetHighlight) {
                        targetEl.classList.add('highlight-selected');
                        
                        // Update border color and box-shadow to reflect current color
                        const highlightColor = targetHighlight.color || this.plugin.settings.highlightColor;
                        targetEl.style.borderLeftColor = highlightColor;
                        if (!targetHighlight.isNativeComment) {
                            targetEl.style.boxShadow = `0 0 0 1.5px ${highlightColor}, var(--shadow-s)`;
                        }
                    }
                } else if (attempt < maxRetries) {
                    // Element not found yet, retry after delay
                    window.setTimeout(() => tryApplySelection(attempt + 1), delay);
                }
            };
            tryApplySelection();
        };
        
        // Check if we need to switch files
        const activeEditorView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        const needsFileSwitch = !activeEditorView || activeEditorView.file?.path !== highlight.filePath;
        
        let targetView: MarkdownView | null = null;

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
                const openResult = this.plugin.app.workspace.openLinkText(highlight.filePath, highlight.filePath, false);
                // Use a more reliable approach for file opening with enhanced retry logic
                const checkAndFocus = (attempt = 0) => {
                    const newActiveView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                    if (newActiveView && newActiveView.file?.path === highlight.filePath) {
                        this.performHighlightFocus(newActiveView, highlight);
                        // Apply selection styling after file switch is complete with longer delay for DOM updates
                        window.setTimeout(() => applySelectionStyling(), 150);
                    } else if (attempt < 10) {
                        // Retry if file isn't ready yet, with exponential backoff
                        window.setTimeout(() => checkAndFocus(attempt + 1), Math.min(50 * Math.pow(1.2, attempt), 200));
                    }
                };
                window.setTimeout(() => checkAndFocus(), 100);
                return;
            }
        }

        if (targetView) {
            // Use requestAnimationFrame for smoother focus and ensure styling is applied after DOM updates
            requestAnimationFrame(() => {
                this.performHighlightFocus(targetView!, highlight);
                // Apply selection styling with a small delay to ensure DOM is stable
                window.setTimeout(() => applySelectionStyling(), 50);
            });
        } else if (!needsFileSwitch) {
            // Same file but no targetView found - still apply styling with retry logic
            applySelectionStyling();
        }
    }

    private performHighlightFocus(targetView: MarkdownView, highlight: Highlight) {
        if (!targetView || !targetView.editor) {
            return;
        }

        // Selection is now handled in focusHighlightInEditor, so we just handle the editor focus

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

    private async focusFootnoteInEditor(highlight: Highlight, footnoteIndex: number) {
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
                await this.plugin.app.workspace.openLinkText(highlight.filePath, highlight.filePath, false);
                // Wait for file to open and retry
                window.setTimeout(() => this.focusFootnoteInEditor(highlight, footnoteIndex), 200);
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
                
                // Scroll to and position cursor right before the ^ character
                editor.scrollIntoView({ from: footnoteStartPos, to: footnoteStartPos }, true);
                editor.setCursor(footnoteStartPos);
                editor.focus();
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

                // Scroll to and position cursor at the footnote definition
                editor.scrollIntoView({ from: footnoteDefStartPos, to: footnoteDefStartPos }, true);
                editor.setCursor(footnoteDefStartPos);
                editor.focus();
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
            this.conditionalRefresh({ highlights: true }); // Update highlights list only
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
                    this.conditionalRefresh({ highlights: true });
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
                    this.conditionalRefresh({ highlights: true });
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
                    this.conditionalRefresh({ highlights: true });
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
                        this.conditionalRefresh({ highlights: true });
                    }
                    // Refresh sidebar if we're grouping by collection
                    if (this.groupingMode === 'collection') {
                        this.conditionalRefresh({ highlights: true });
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
                            this.conditionalRefresh({ highlights: true });
                        }
                        // Refresh sidebar if we're grouping by collection
                        if (this.groupingMode === 'collection') {
                            this.conditionalRefresh({ highlights: true });
                        }
                    } else {
                        this.plugin.collectionsManager.addHighlightToCollection(collection.id, highlight.id);
                        this.updateHighlightCollectionCount(highlight);
                        // Refresh sidebar if we're grouping by collection
                        if (this.groupingMode === 'collection') {
                            this.conditionalRefresh({ highlights: true });
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
            this.conditionalRefresh({ highlights: true });
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
        this.conditionalRefresh({ highlights: true });
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

    private onChipClick(token: SearchToken): void {
        // Optional: Could implement editing or additional actions for chips
    }

    private removeTokenFromQuery(query: string, tokenToRemove: SearchToken): string {
        // This is a simplified approach - in practice, you might want more sophisticated parsing
        const prefix = tokenToRemove.exclude ? '-' : '';
        const symbol = tokenToRemove.type === 'tag' ? '#' : tokenToRemove.type === 'collection' ? '@' : '';
        const tokenString = prefix + symbol + tokenToRemove.value;
        
        return query.replace(new RegExp('\\s*' + tokenString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'g'), ' ').trim();
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