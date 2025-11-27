// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import { HighlightsSidebarView } from './src/views/sidebar-view';
import { InlineFootnoteManager } from './src/managers/inline-footnote-manager';
import { ExcludedFilesModal } from './src/modals/excluded-files-modal';
import { BackupSelectorModal } from './src/modals/backup-selector-modal';
import { STANDARD_FOOTNOTE_REGEX, FOOTNOTE_VALIDATION_REGEX } from './src/utils/regex-patterns';
import { HtmlHighlightParser } from './src/utils/html-highlight-parser';
import { i18n, t } from './src/i18n';

export interface Highlight {
    id: string;
    text: string;
    tags: string[];
    line: number;
    startOffset: number;
    endOffset: number;
    filePath: string;
    footnoteCount?: number;
    footnoteContents?: string[];
    color?: string;
    collectionIds?: string[]; // Add collection support
    createdAt?: number; // Timestamp when highlight was created
    isNativeComment?: boolean; // True if this is a native comment (%% %) rather than highlight (== ==)
    type?: 'highlight' | 'comment' | 'html' | 'custom'; // Type of highlight for proper identification
    fullMatch?: string; // Full matched text with delimiters (for custom patterns)
}

export interface Collection {
    id: string;
    name: string;
    description?: string; // Add optional description field
    highlightIds: string[];
    createdAt: number;
}

export interface FileFilter {
    path: string;
    mode: 'exclude' | 'include';
}

export interface Task {
    id: string;
    text: string;
    completed: boolean;
    flagged: boolean; // Task is flagged with [!] (deprecated - use priority instead)
    priority?: 1 | 2 | 3; // Priority level: 1 (red/high), 2 (yellow/medium), 3 (blue/low)
    filePath: string;
    lineNumber: number;
    context: string[]; // Indented text lines below the task
    indentLevel: number; // Indentation level for nested tasks
    section?: string; // Markdown header above the task (if any)
    date?: string; // Date extracted from task text in ISO format (YYYY-MM-DD)
    dateText?: string; // Original date text from task (to strip from display)
}

export interface CustomPattern {
    name: string;
    pattern: string;
    type: 'highlight' | 'comment';
}

export interface DisplayMode {
    id: string;
    name: string;
    // Display settings
    showFilenames: boolean;
    showTimestamps: boolean;
    showHighlightActions: boolean;
    showToolbar: boolean;
    autoToggleFold: boolean;
    dateFormat: string;
    minimumCharacterCount: number;
    // Views settings
    showCurrentNoteTab: boolean;
    showAllNotesTab: boolean;
    showCollectionsTab: boolean;
    showTasksTab: boolean;
}

export interface TabSettings {
    groupingMode: 'none' | 'color' | 'comments-asc' | 'comments-desc' | 'tag' | 'parent' | 'collection' | 'filename' | 'date-created-asc' | 'date-created-desc' | 'date-asc';
    sortMode: 'none' | 'alphabetical-asc' | 'alphabetical-desc' | 'priority' | 'date-asc' | 'date-desc';
    commentsExpanded: boolean;
    searchExpanded: boolean;
    selectedTags?: string[]; // Selected tag filters for this tab
    selectedCollections?: string[]; // Selected collection filters for this tab
    selectedSpecialFilters?: string[]; // Selected special filters (Flagged, Upcoming, etc.) for this tab
}

export interface CommentPluginSettings {
    settingsVersion: string; // Track settings schema version for migration
    highlightColor: string;
    sidebarPosition: 'left' | 'right';
    highlights: { [filePath: string]: Highlight[] };
    collections: { [id: string]: Collection }; // Add collections to settings
    groupingMode: 'none' | 'color' | 'comments-asc' | 'comments-desc' | 'tag' | 'parent' | 'collection' | 'filename' | 'date-created-asc' | 'date-created-desc' | 'date-asc'; // Add grouping mode persistence (legacy - kept for backwards compatibility)
    taskSecondaryGroupingMode: 'none' | 'tag' | 'date' | 'flagged'; // Secondary grouping for tasks (nested within primary groups)
    sortMode: 'none' | 'alphabetical-asc' | 'alphabetical-desc' | 'priority' | 'date-asc' | 'date-desc'; // Add sort mode for A-Z and Z-A sorting (legacy - kept for backwards compatibility)
    tabSettings: { [key in 'current' | 'all' | 'collections' | 'tasks']?: TabSettings }; // Per-tab settings storage
    showFilenames: boolean; // Show note titles in All Notes and Collections
    showTimestamps: boolean; // Show note timestamps
    showHighlightActions: boolean; // Show highlight actions area (filename, stats, buttons)
    showToolbar: boolean; // Show/hide the toolbar container
    autoToggleFold: boolean; // Automatically unfold content when focusing highlights from the sidebar
    useInlineFootnotes: boolean; // Use inline footnotes by default when adding comments
    selectTextOnCommentClick: boolean; // Select comment text when clicking comments instead of just positioning
    excludeExcalidraw: boolean; // Exclude .excalidraw files from highlight detection
    excludedFiles: string[]; // Legacy: Array of file/folder paths (kept for backward compatibility)
    fileFilters: FileFilter[]; // New: Array of file/folder filters with individual modes
    fileFilterMode: 'exclude' | 'include'; // Mode for adding new file filters in the modal
    dateFormat: string; // Moment.js format string for timestamp display
    minimumCharacterCount: number; // Minimum character count to display highlights and native comments in sidebar
    highlightFontSize: number; // Font size for highlight text
    detailsFontSize: number; // Font size for details (buttons, filename, etc.)
    commentFontSize: number; // Font size for comment text
    highlightFontWeight: number; // Font weight for highlight text
    taskFontWeight: number; // Font weight for task text
    detectHtmlComments: boolean; // Detect HTML comments (<!-- -->)
    detectAdjacentNativeComments: boolean; // Detect native comments (%% %%) adjacent to highlights as comments for those highlights
    customPatterns: CustomPattern[]; // User-defined custom highlight/comment patterns
    customColors: {
        yellow: string;
        red: string;
        teal: string;
        blue: string;
        green: string;
    };
    customColorNames: {
        yellow: string;
        red: string;
        teal: string;
        blue: string;
        green: string;
    };
    showCurrentNoteTab: boolean; // Show/hide Current Note tab
    showAllNotesTab: boolean; // Show/hide All Notes tab
    showCollectionsTab: boolean; // Show/hide Collections tab
    showTasksTab: boolean; // Show/hide Tasks tab
    showCompletedTasks: boolean; // Include completed tasks (- [x])
    showTaskContext: boolean; // Show indented text below tasks as context
    taskDateFormat: string; // Date format for parsing dates in tasks (e.g., YYYY-MM-DD)
    showCurrentNoteTasksSection: boolean; // Show current note's tasks section at top of Task tab
    showOnlyCurrentNoteTasks: boolean; // When enabled, only show current note tasks (hide main task list)
    displayModes: DisplayMode[]; // Saved display mode configurations
    currentDisplayModeId: string | null; // Currently active display mode ID
}

const DEFAULT_SETTINGS: CommentPluginSettings = {
    settingsVersion: '1.14.0', // Current settings schema version
    highlightColor: '#ffd700',
    sidebarPosition: 'right',
    highlights: {},
    collections: {}, // Initialize empty collections
    groupingMode: 'none', // Default grouping mode (legacy)
    taskSecondaryGroupingMode: 'none', // Default task secondary grouping mode
    sortMode: 'none', // Default sort mode (legacy)
    tabSettings: {}, // Initialize empty per-tab settings
    showFilenames: true, // Show filenames by default
    showTimestamps: true, // Show timestamps by default
    showHighlightActions: true, // Show highlight actions by default
    showToolbar: true, // Show toolbar by default
    autoToggleFold: false, // Do not auto-toggle fold by default
    useInlineFootnotes: false, // Use standard footnotes by default
    selectTextOnCommentClick: false, // Position to highlight by default
    excludeExcalidraw: true, // Exclude .excalidraw files by default
    excludedFiles: [], // Legacy: Empty array by default
    fileFilters: [], // New: Empty array by default
    fileFilterMode: 'exclude', // Default to exclude mode (backwards compatible)
    dateFormat: 'YYYY-MM-DD HH:mm', // Default date format
    minimumCharacterCount: 0, // Default minimum character count (0 = show all)
    highlightFontSize: 11, // Default highlight text font size
    detailsFontSize: 11, // Default details font size
    commentFontSize: 11, // Default comment text font size
    highlightFontWeight: 400, // Default highlight text font weight (normal)
    taskFontWeight: 400, // Default task text font weight (normal)
    detectHtmlComments: false, // Do not detect HTML comments by default
    detectAdjacentNativeComments: true, // Detect adjacent native comments by default (new behavior)
    customPatterns: [], // Empty array by default
    customColors: {
        yellow: '#ffd700',
        red: '#ff6b6b',
        teal: '#4ecdc4',
        blue: '#45b7d1',
        green: '#96ceb4'
    },
    customColorNames: {
        yellow: '',
        red: '',
        teal: '',
        blue: '',
        green: ''
    },
    showCurrentNoteTab: true, // Show Current Note tab by default
    showAllNotesTab: true, // Show All Notes tab by default
    showCollectionsTab: true, // Show Collections tab by default
    showTasksTab: false, // Tasks tab hidden by default (enable in Settings > Views)
    showCompletedTasks: true, // Show completed tasks by default
    showTaskContext: true, // Show task context by default
    taskDateFormat: 'YYYY-MM-DD', // Default task date format
    showCurrentNoteTasksSection: true, // Show current note tasks section by default
    showOnlyCurrentNoteTasks: false, // Show all tasks by default
    displayModes: [], // Empty array by default
    currentDisplayModeId: null // No active display mode by default
}

const VIEW_TYPE_HIGHLIGHTS = 'highlights-sidebar';

export default class HighlightCommentsPlugin extends Plugin {
    settings: CommentPluginSettings;
    highlights: Map<string, Highlight[]> = new Map();
    collections: Map<string, Collection> = new Map();
    collectionsManager: CollectionsManager;
    inlineFootnoteManager: InlineFootnoteManager;
    private sidebarView: HighlightsSidebarView | null = null;
    private ribbonIconEl: HTMLElement | null = null;
    private detectHighlightsTimeout: number | null = null;
    public selectedHighlightId: string | null = null;
    public collectionCommands: Set<string> = new Set(); // Track registered collection commands
    private isScanningFiles: boolean = false; // Prevent concurrent scans

    async onload() {
        await this.loadSettings();

        // Initialize i18n system
        try {
            await i18n.init();
        } catch (error) {
            console.error('Failed to initialize i18n, plugin will continue with English defaults:', error);
        }

        // Migrate any existing backup files to the backups folder
        await this.migrateBackupFilesToFolder();

        this.highlights = new Map(Object.entries(this.settings.highlights || {}));
        this.collections = new Map(Object.entries(this.settings.collections || {}));
        this.collectionsManager = new CollectionsManager(this);
        this.inlineFootnoteManager = new InlineFootnoteManager();
        
        // Register hover source for link previews
        // Note: registerHoverLinkSource may not be available in all Obsidian versions
        if ('registerHoverLinkSource' in this.app.workspace) {
            (this.app.workspace as any).registerHoverLinkSource('sidebar-highlights', {
                display: 'Sidebar Highlights',
                defaultMod: true
            });
        }
        
        this.registerView(
            VIEW_TYPE_HIGHLIGHTS,
            (leaf) => {
                this.sidebarView = new HighlightsSidebarView(leaf, this);
                return this.sidebarView;
            }
        );

        this.ribbonIconEl = this.addRibbonIcon('highlighter', 'Open highlights', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'create-highlight',
            name: t('commands.createHighlight'),
            editorCallback: (editor: Editor) => {
                this.createHighlight(editor);
            }
        });

        this.addCommand({
            id: 'open-highlights-sidebar',
            name: t('commands.toggle'),
            callback: () => {
                this.toggleView();
            }
        });

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (editor.getSelection()) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Create highlight')
                            .setIcon('highlighter')
                            .onClick(() => {
                                this.createHighlight(editor);
                            });
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file) {
                    this.loadHighlightsFromFile(file);
                } else {
                    // Clear selection but preserve highlights when no file is active
                    this.selectedHighlightId = null;
                    if (this.sidebarView) {
                        this.sidebarView.updateContent(); // Content update instead of full refresh
                    }
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('editor-change', (editor, view) => {
                if (view instanceof MarkdownView) {
                    this.debounceDetectMarkdownHighlights(editor, view);
                }
            })
        );


        this.addSettingTab(new HighlightSettingTab(this.app, this));
        this.addStyles();

        // Register collection commands
        this.registerCollectionCommands();

        // Register display mode commands
        this.registerDisplayModeCommands();

        // Register all vault events after workspace is ready to avoid processing during initialization
        this.app.workspace.onLayoutReady(async () => {
            // Fix any duplicate timestamps from previous versions
            await this.fixDuplicateTimestamps();

            this.scanAllFilesForHighlights();

            // Ensure custom color styles are applied on load
            this.updateCustomColorStyles();

            // Register vault events after layout is ready
            this.registerEvent(
                this.app.vault.on('create', (file) => {
                    if (file instanceof TFile && this.shouldProcessFile(file)) {
                        this.handleFileCreate(file);
                    }
                })
            );

            this.registerEvent(
                this.app.vault.on('rename', (file, oldPath) => {
                    if (file instanceof TFile && this.shouldProcessFile(file)) {
                        this.handleFileRename(file, oldPath);
                    }
                })
            );

            this.registerEvent(
                this.app.vault.on('delete', (file) => {
                    if (file instanceof TFile && this.shouldProcessFile(file)) {
                        this.handleFileDelete(file);
                    }
                })
            );
        });
    }

    onunload() {
        // Remove ribbon icon
        if (this.ribbonIconEl) {
            this.ribbonIconEl.remove();
            this.ribbonIconEl = null;
        }

        // Cleanup is mostly automatic due to using registerEvent() and addCommand()
        // The sidebar view's onClose() method will handle its own cleanup
        // Obsidian automatically handles:
        // - Registered events (this.registerEvent)
        // - Registered commands (this.addCommand)
        // - Settings tab removal
        // - View unregistration
        
        // Only manual cleanup needed is for any direct DOM listeners or intervals
        // which we don't currently have in the main plugin file
    }

    async loadSettings() {
        const loadedData = await this.loadData();

        // For safety, only migrate if we detect a genuine old version
        // If data exists but has no settingsVersion, assume it's 1.14.0 (current) to prevent data loss
        if (loadedData &&
            loadedData.settingsVersion &&
            loadedData.settingsVersion !== DEFAULT_SETTINGS.settingsVersion) {
            // Only migrate if we have an explicit older version
            await this.migrateSettings(loadedData);
        } else {
            // Safe merge - only use defaults for truly missing optional fields
            // Preserve existing collections/highlights even if other fields are missing
            this.settings = this.safeMergeSettings(loadedData);
            if (!this.settings.settingsVersion) {
                this.settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
                await this.saveSettings(); // Save the version for future use
            }
        }

        // Migrate old excludedFiles format to new fileFilters format
        if (this.settings.excludedFiles && this.settings.excludedFiles.length > 0 &&
            (!this.settings.fileFilters || this.settings.fileFilters.length === 0)) {
            // Convert old string[] to FileFilter[]
            this.settings.fileFilters = this.settings.excludedFiles.map(path => ({
                path,
                mode: 'exclude' as const
            }));
            this.settings.excludedFiles = []; // Clear old format
            await this.saveSettings();
        }
    }

    safeMergeSettings(loadedData: any): CommentPluginSettings {
        // Start with defaults
        const merged = { ...DEFAULT_SETTINGS };

        if (!loadedData) {
            return merged;
        }

        // Merge all loaded data, but ensure critical data is preserved
        Object.assign(merged, loadedData);

        // Explicitly preserve critical data structures even if they appear in defaults
        // This prevents the Object.assign vulnerability where undefined fields get default empty objects
        if (loadedData.collections !== undefined) {
            merged.collections = loadedData.collections;
        }
        if (loadedData.highlights !== undefined) {
            merged.highlights = loadedData.highlights;
        }
        if (loadedData.customColorNames !== undefined) {
            merged.customColorNames = loadedData.customColorNames;
        }

        return merged;
    }

    async saveSettings() {
        // Save highlights and collections to settings before saving
        this.settings.highlights = Object.fromEntries(this.highlights);
        this.settings.collections = Object.fromEntries(this.collections);
        await this.saveData(this.settings);
        this.updateStyles();
    }

    addStyles() {
        const style = document.createElement('style');
        style.id = 'highlight-comments-plugin-styles';

        // Add dynamic custom color styles for sidebar
        this.updateCustomColorStyles();

        document.head.appendChild(style);
    }

    updateStyles() {
        // Update custom color styles for sidebar
        this.updateCustomColorStyles();
    }

    removeStyles() {
        const style = document.getElementById('highlight-comments-plugin-styles');
        if (style) {
            style.remove();
        }

        // Clean up CSS custom properties
        document.body.style.removeProperty('--sh-highlight-yellow');
        document.body.style.removeProperty('--sh-highlight-red');
        document.body.style.removeProperty('--sh-highlight-teal');
        document.body.style.removeProperty('--sh-highlight-blue');
        document.body.style.removeProperty('--sh-highlight-green');
        document.body.style.removeProperty('--sh-quote-font-size');
        document.body.style.removeProperty('--sh-details-font-size');
        document.body.style.removeProperty('--sh-comment-font-size');
        document.body.style.removeProperty('--sh-highlight-font-weight');
        document.body.style.removeProperty('--sh-task-font-weight');
    }

    private updateCustomColorStyles() {
        // Set CSS custom properties on document body instead of injecting dynamic styles
        // This allows CSS snippets to override these values and avoids !important cascades

        // Set color custom properties
        document.body.style.setProperty('--sh-highlight-yellow', this.settings.customColors.yellow);
        document.body.style.setProperty('--sh-highlight-red', this.settings.customColors.red);
        document.body.style.setProperty('--sh-highlight-teal', this.settings.customColors.teal);
        document.body.style.setProperty('--sh-highlight-blue', this.settings.customColors.blue);
        document.body.style.setProperty('--sh-highlight-green', this.settings.customColors.green);

        // Set font size custom properties
        document.body.style.setProperty('--sh-quote-font-size', `${this.settings.highlightFontSize}px`);
        document.body.style.setProperty('--sh-details-font-size', `${this.settings.detailsFontSize}px`);
        document.body.style.setProperty('--sh-comment-font-size', `${this.settings.commentFontSize}px`);

        // Set font weight custom properties
        document.body.style.setProperty('--sh-highlight-font-weight', `${this.settings.highlightFontWeight}`);
        document.body.style.setProperty('--sh-task-font-weight', `${this.settings.taskFontWeight}`);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_HIGHLIGHTS);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = this.settings.sidebarPosition === 'left' 
                ? workspace.getLeftLeaf(false)
                : workspace.getRightLeaf(false);
            await leaf?.setViewState({ type: VIEW_TYPE_HIGHLIGHTS, active: true });
        }
        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async toggleView() {
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_HIGHLIGHTS);

        if (leaves.length > 0) {
            // Sidebar is open, close it
            leaves.forEach(leaf => leaf.detach());
        } else {
            // Sidebar is closed, open it
            await this.activateView();
        }
    }

    async createHighlight(editor: Editor) {
        const selection = editor.getSelection();
        if (!selection) {
            new Notice('Please select some text first');
            return;
        }
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice('No active file');
            return;
        }

        const fromCursor = editor.getCursor('from');
        const toCursor = editor.getCursor('to');
        const fromOffset = editor.posToOffset(fromCursor);
        const toOffset = editor.posToOffset(toCursor);
        const highlightId = this.generateId();
        
        const highlight: Highlight = {
            id: highlightId,
            text: selection,
            tags: [],
            line: fromCursor.line,
            startOffset: fromOffset,
            endOffset: toOffset,
            filePath: file.path,
            createdAt: Date.now(),
        };

        const fileHighlights = this.highlights.get(file.path) || [];
        fileHighlights.push(highlight);
        this.highlights.set(file.path, fileHighlights);

        const highlightedText = `==${selection}==`;
        editor.replaceSelection(highlightedText);
        this.refreshSidebar();
        new Notice('Highlight created');
    }

    refreshSidebar() {
        if (this.sidebarView) {
            this.sidebarView.refresh();
        }
    }

    // Display Mode methods
    createDisplayModeFromCurrent(name: string): DisplayMode {
        return {
            id: Date.now().toString(),
            name: name,
            // Capture current Display settings
            showFilenames: this.settings.showFilenames,
            showTimestamps: this.settings.showTimestamps,
            showHighlightActions: this.settings.showHighlightActions,
            showToolbar: this.settings.showToolbar,
            autoToggleFold: this.settings.autoToggleFold,
            dateFormat: this.settings.dateFormat,
            minimumCharacterCount: this.settings.minimumCharacterCount,
            // Capture current Views settings
            showCurrentNoteTab: this.settings.showCurrentNoteTab,
            showAllNotesTab: this.settings.showAllNotesTab,
            showCollectionsTab: this.settings.showCollectionsTab,
            showTasksTab: this.settings.showTasksTab
        };
    }

    async applyDisplayMode(displayMode: DisplayMode) {
        // Apply Display settings
        this.settings.showFilenames = displayMode.showFilenames;
        this.settings.showTimestamps = displayMode.showTimestamps;
        this.settings.showHighlightActions = displayMode.showHighlightActions;
        this.settings.showToolbar = displayMode.showToolbar;
        this.settings.autoToggleFold = displayMode.autoToggleFold;
        this.settings.dateFormat = displayMode.dateFormat;
        this.settings.minimumCharacterCount = displayMode.minimumCharacterCount;
        // Apply Views settings
        this.settings.showCurrentNoteTab = displayMode.showCurrentNoteTab;
        this.settings.showAllNotesTab = displayMode.showAllNotesTab;
        this.settings.showCollectionsTab = displayMode.showCollectionsTab;
        this.settings.showTasksTab = displayMode.showTasksTab;

        // Mark this mode as active
        this.settings.currentDisplayModeId = displayMode.id;

        await this.saveSettings();

        // Reset view mode to first visible tab if current tab is hidden
        if (this.sidebarView) {
            this.sidebarView.resetToFirstVisibleTab();
        }

        this.refreshSidebar();
    }

    async updateDisplayMode(displayMode: DisplayMode) {
        // Update the display mode with current settings
        displayMode.showFilenames = this.settings.showFilenames;
        displayMode.showTimestamps = this.settings.showTimestamps;
        displayMode.showHighlightActions = this.settings.showHighlightActions;
        displayMode.showToolbar = this.settings.showToolbar;
        displayMode.autoToggleFold = this.settings.autoToggleFold;
        displayMode.dateFormat = this.settings.dateFormat;
        displayMode.minimumCharacterCount = this.settings.minimumCharacterCount;
        displayMode.showCurrentNoteTab = this.settings.showCurrentNoteTab;
        displayMode.showAllNotesTab = this.settings.showAllNotesTab;
        displayMode.showCollectionsTab = this.settings.showCollectionsTab;
        displayMode.showTasksTab = this.settings.showTasksTab;

        // Keep this mode as active
        this.settings.currentDisplayModeId = displayMode.id;

        await this.saveSettings();
    }

    registerDisplayModeCommands() {
        // Register a command for each display mode
        this.settings.displayModes.forEach(mode => {
            this.addCommand({
                id: `apply-display-mode-${mode.id}`,
                name: t('commands.applyDisplayMode', { name: mode.name }),
                callback: () => {
                    this.applyDisplayMode(mode);
                    new Notice(t('notices.displayModeApplied', { name: mode.name }));
                }
            });
        });
    }

    async reloadAllSettings() {
        // Reload settings from disk to get latest external changes
        await this.loadSettings();
        
        // Update collections map with the reloaded data
        this.collections = new Map(Object.entries(this.settings.collections || {}));
        
        // Update highlights map with the reloaded data
        this.highlights = new Map(Object.entries(this.settings.highlights || {}));
        
        // Re-register collection commands with updated data
        this.registerCollectionCommands();
        
        // Update styles to reflect any color changes
        this.updateStyles();
        
        // Refresh sidebar to reflect changes
        this.refreshSidebar();
    }

    async createBackup(reason: string) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `data-backup-${reason}-${timestamp}.json`;

            const criticalData = {
                settingsVersion: this.settings.settingsVersion,
                collections: this.settings.collections,
                customColorNames: this.settings.customColorNames,
                highlights: this.settings.highlights,
                backupReason: reason,
                originalTimestamp: timestamp,
                backupCreatedAt: Date.now(),
                retentionManaged: true // Mark new backups as subject to retention policy
            };

            // Ensure backups folder exists
            const backupsDir = '.obsidian/plugins/sidebar-highlights/backups';
            try {
                await this.app.vault.adapter.mkdir(backupsDir);
            } catch (e) {
                // Folder might already exist, that's ok
            }

            const backupPath = `${backupsDir}/${filename}`;
            await this.app.vault.adapter.write(
                backupPath,
                JSON.stringify(criticalData, null, 2)
            );

            // Only show notice for important backups (not routine ones)
            if (reason === 'migration' || reason === 'manual') {
                new Notice(`Settings backup created: ${filename}`);
            }

            // Clean up old backups (only retention-managed ones)
            await this.cleanupOldBackups();
        } catch (error) {
            console.error('Failed to create backup:', error);
            new Notice('Warning: Could not create settings backup');
        }
    }

    async listBackups(): Promise<Array<{ path: string; filename: string; data: any }>> {
        try {
            const backupsDir = '.obsidian/plugins/sidebar-highlights/backups';
            const files = await this.app.vault.adapter.list(backupsDir);

            const backups: Array<{ path: string; filename: string; data: any }> = [];

            for (const file of files.files) {
                if (file.endsWith('.json') && file.includes('data-backup-')) {
                    try {
                        const content = await this.app.vault.adapter.read(file);
                        const data = JSON.parse(content);
                        backups.push({
                            path: file,
                            filename: file.split('/').pop() || file,
                            data
                        });
                    } catch (e) {
                        console.error(`Failed to read backup ${file}:`, e);
                    }
                }
            }

            // Sort by creation time, newest first
            backups.sort((a, b) => {
                const timeA = a.data.backupCreatedAt || 0;
                const timeB = b.data.backupCreatedAt || 0;
                return timeB - timeA;
            });

            return backups;
        } catch (error) {
            console.error('Failed to list backups:', error);
            return [];
        }
    }

    async findBackupWithCollections(): Promise<{ path: string; filename: string; data: any } | null> {
        const backups = await this.listBackups();

        for (const backup of backups) {
            if (backup.data.collections &&
                typeof backup.data.collections === 'object' &&
                Object.keys(backup.data.collections).length > 0) {
                return backup;
            }
        }

        return null;
    }

    async restoreFromBackup(backupPath: string): Promise<{ success: boolean; orphanedCount?: number; recoveredCount?: number }> {
        const log: string[] = [];
        const logLine = (msg: string) => {
            log.push(`[${new Date().toISOString()}] ${msg}`);
        };

        const startTime = Date.now();

        try {
            logLine(`=== BACKUP RESTORATION STARTED ===`);
            logLine(`Start time: ${new Date().toISOString()}`);

            // Log environment information
            logLine(`\n--- ENVIRONMENT ---`);
            logLine(`Plugin version: ${this.manifest.version}`);
            logLine(`Obsidian version: ${(this.app as any).appVersion || 'unknown'}`);
            logLine(`Platform: ${(this.app as any).isMobile ? 'mobile' : 'desktop'}`);

            // Extract just the filename from the path for privacy
            const backupFileName = backupPath.split('/').pop() || 'unknown';
            logLine(`\n--- BACKUP FILE ---`);
            logLine(`Backup file: ${backupFileName}`);

            const content = await this.app.vault.adapter.read(backupPath);
            logLine(`Backup file size: ${content.length} bytes`);

            const backupData = JSON.parse(content);
            logLine(`✓ Backup file read and parsed successfully`);

            // Log backup metadata
            logLine(`Backup version: ${backupData.settingsVersion || 'unknown'}`);
            logLine(`Backup reason: ${backupData.backupReason || 'unknown'}`);
            logLine(`Backup timestamp: ${backupData.originalTimestamp || backupData.backupCreatedAt || 'unknown'}`);

            // Log current state before restoration
            logLine(`\n--- CURRENT STATE BEFORE RESTORATION ---`);
            const currentHighlightsCount = Array.from(this.highlights.values()).reduce((sum, arr) => sum + arr.length, 0);
            const currentCollectionsCount = this.collections.size;
            logLine(`Current highlights in memory: ${currentHighlightsCount}`);
            logLine(`Current collections in memory: ${currentCollectionsCount}`);
            logLine(`Current files with highlights: ${this.highlights.size}`);

            // Restore collections
            logLine(`\n--- RESTORING COLLECTIONS ---`);
            const collectionsCount = backupData.collections ? Object.keys(backupData.collections).length : 0;
            logLine(`Collections in backup: ${collectionsCount}`);
            if (backupData.collections) {
                this.settings.collections = backupData.collections;
                this.collections = new Map(Object.entries(backupData.collections));

                // Log collection details (redacted names for privacy)
                let collectionIndex = 0;
                for (const [collectionId, collection] of this.collections) {
                    collectionIndex++;
                    logLine(`  Collection #${collectionIndex} (ID: ${collectionId}): ${collection.highlightIds.length} highlight IDs`);
                }
                logLine(`✓ Collections restored`);
            }

            if (backupData.customColorNames) {
                this.settings.customColorNames = backupData.customColorNames;
                logLine(`✓ Custom color names restored`);
            }

            // Collect all highlight IDs that are referenced in collections
            const collectionHighlightIds = new Set<string>();
            if (backupData.collections) {
                for (const collectionId in backupData.collections) {
                    const collection = backupData.collections[collectionId];
                    for (const highlightId of collection.highlightIds) {
                        collectionHighlightIds.add(highlightId);
                    }
                }
            }
            logLine(`\nHighlight IDs referenced in collections: ${collectionHighlightIds.size}`);
            logLine(`Collection highlight IDs: ${Array.from(collectionHighlightIds).join(', ')}`);

            // Restore highlights from backup by validating them against current markdown
            // ONLY restore highlights that are referenced in collections
            logLine(`\n--- RESTORING HIGHLIGHTS ---`);
            logLine(`NOTE: File filtering is bypassed for collection restoration`);
            logLine(`Collections are restored regardless of excluded files settings`);

            let recoveredCount = 0;
            let orphanedCount = 0;
            const filesInBackup = backupData.highlights ? Object.keys(backupData.highlights).length : 0;
            const totalHighlightsInBackup = backupData.highlights
                ? Object.values(backupData.highlights).reduce((sum: number, arr: any[]) => sum + arr.length, 0)
                : 0;
            logLine(`Files with highlights in backup: ${filesInBackup}`);
            logLine(`Total highlights in backup: ${totalHighlightsInBackup}`);
            logLine(`Collection highlights to restore: ${collectionHighlightIds.size}`);

            if (backupData.highlights && collectionHighlightIds.size > 0) {
                const restoredHighlights = new Map<string, Highlight[]>();

                let fileIndex = 0;
                for (const filePath in backupData.highlights) {
                    const fileStartTime = Date.now();
                    fileIndex++;
                    const fileHighlights = backupData.highlights[filePath];

                    // Filter to only highlights that are in collections
                    const collectionHighlightsInFile = fileHighlights.filter((h: Highlight) => collectionHighlightIds.has(h.id));

                    if (collectionHighlightsInFile.length === 0) {
                        logLine(`\n--- Skipping file #${fileIndex}: [REDACTED] ---`);
                        logLine(`  No collection highlights in this file (${fileHighlights.length} total highlights skipped)`);
                        continue;
                    }
                    logLine(`\n--- Processing file #${fileIndex}: [REDACTED] ---`);
                    logLine(`  Collection highlights in this file: ${collectionHighlightsInFile.length} (${fileHighlights.length} total in backup)`);

                    // IMPORTANT: Collections restoration bypasses file filtering
                    // We restore collection highlights regardless of excluded files settings
                    // This ensures users don't lose collection data due to filter configurations

                    // Check if file still exists
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (!file || !(file instanceof TFile)) {
                        // File no longer exists - all highlights are orphaned
                        logLine(`  ✗ File does not exist - marking ${collectionHighlightsInFile.length} collection highlights as orphaned`);
                        orphanedCount += collectionHighlightsInFile.length;
                        continue;
                    }
                    logLine(`  ✓ File exists`);

                    // Check if file would normally be filtered (for logging purposes only)
                    const wouldBeFiltered = !this.shouldProcessFile(file);
                    if (wouldBeFiltered) {
                        logLine(`  ℹ File would normally be filtered, but processing anyway for collection restoration`);
                    }

                    // Read current file content
                    let fileContent: string;
                    try {
                        fileContent = await this.app.vault.read(file);
                        logLine(`  ✓ File content read (${fileContent.length} characters)`);
                    } catch (error) {
                        logLine(`  ✗ Failed to read file: ${error}`);
                        console.error(`Failed to read file #${fileIndex}:`, error);
                        orphanedCount += collectionHighlightsInFile.length;
                        continue;
                    }

                    const validHighlights: Highlight[] = [];

                    for (const backupHighlight of collectionHighlightsInFile) {
                        logLine(`\n  Validating highlight ID: ${backupHighlight.id}`);
                        logLine(`    Text length: ${backupHighlight.text.length} characters`);
                        logLine(`    Text preview: [REDACTED]`);
                        logLine(`    Type: ${backupHighlight.type || 'highlight'}`);
                        logLine(`    Native comment: ${backupHighlight.isNativeComment || false}`);
                        logLine(`    Line number: ${backupHighlight.line}`);
                        logLine(`    Start offset: ${backupHighlight.startOffset}`);
                        logLine(`    End offset: ${backupHighlight.endOffset}`);

                        // Log text characteristics
                        const hasNewlines = backupHighlight.text.includes('\n');
                        const newlineCount = (backupHighlight.text.match(/\n/g) || []).length;
                        const startsWithWhitespace = /^\s/.test(backupHighlight.text);
                        const endsWithWhitespace = /\s$/.test(backupHighlight.text);
                        logLine(`    Contains newlines: ${hasNewlines} (${newlineCount} newline(s))`);
                        logLine(`    Starts with whitespace: ${startsWithWhitespace}`);
                        logLine(`    Ends with whitespace: ${endsWithWhitespace}`);

                        // Log if there are special characters that might affect regex
                        const hasSpecialChars = /[.*+?^${}()|[\]\\]/.test(backupHighlight.text);
                        logLine(`    Contains regex special chars: ${hasSpecialChars}`);

                        // Check if text exists in file
                        const textExists = fileContent.includes(backupHighlight.text);
                        logLine(`    Text exists in file: ${textExists}`);

                        if (!textExists) {
                            orphanedCount++;
                            logLine(`    ✗ ORPHANED - Exact text not found in file`);
                            logLine(`    Reason: The highlight text does not appear anywhere in the current file content`);
                            logLine(`    Possible causes: Text was edited, deleted, or moved to another file`);
                            continue;
                        }

                        // Check pattern matching
                        let patternFound = false;
                        let searchPattern = '';

                        if (backupHighlight.isNativeComment) {
                            searchPattern = `%%\\s*${this.escapeRegex(backupHighlight.text)}\\s*%%`;
                            const commentPattern = new RegExp(searchPattern);
                            patternFound = commentPattern.test(fileContent);
                            logLine(`    Checking native comment pattern: ${patternFound}`);
                            logLine(`    Pattern: ${searchPattern}`);
                        } else {
                            searchPattern = `==\\s*${this.escapeRegex(backupHighlight.text)}\\s*==`;
                            const highlightPattern = new RegExp(searchPattern);
                            patternFound = highlightPattern.test(fileContent);
                            logLine(`    Checking highlight pattern: ${patternFound}`);
                            logLine(`    Pattern: ${searchPattern}`);
                        }

                        if (patternFound) {
                            validHighlights.push(backupHighlight);
                            recoveredCount++;
                            logLine(`    ✓ RECOVERED - Highlight pattern matched successfully`);
                        } else {
                            orphanedCount++;
                            logLine(`    ✗ ORPHANED - Text exists but pattern not matched`);
                            logLine(`    Reason: Text found in file but not wrapped with expected delimiters`);
                            if (backupHighlight.isNativeComment) {
                                logLine(`    Expected: Text wrapped with %% %% (native comment)`);
                            } else {
                                logLine(`    Expected: Text wrapped with == == (highlight)`);
                            }
                            logLine(`    Possible causes: User removed highlight markers, or whitespace/newline differences`);
                        }
                    }

                    if (validHighlights.length > 0) {
                        restoredHighlights.set(filePath, validHighlights);
                        logLine(`  Summary: ${validHighlights.length}/${collectionHighlightsInFile.length} collection highlights restored from this file`);
                    } else {
                        logLine(`  Summary: 0/${collectionHighlightsInFile.length} collection highlights restored from this file`);
                    }

                    const fileElapsedTime = Date.now() - fileStartTime;
                    logLine(`  Processing time: ${fileElapsedTime}ms`);
                }

                // Set the restored highlights
                this.highlights = restoredHighlights;
                this.settings.highlights = Object.fromEntries(restoredHighlights);
                logLine(`\n✓ Highlight restoration complete`);
                logLine(`  Total recovered: ${recoveredCount}`);
                logLine(`  Total orphaned: ${orphanedCount}`);
            }

            // Now clean up collection references to orphaned highlights
            if (backupData.collections) {
                logLine(`\n--- Cleaning up collection references ---`);
                const validHighlightIds = new Set<string>();
                for (const highlights of this.highlights.values()) {
                    for (const highlight of highlights) {
                        validHighlightIds.add(highlight.id);
                    }
                }
                logLine(`Valid highlight IDs after restoration: ${validHighlightIds.size}`);

                let cleanupCollectionIndex = 0;
                for (const [collectionId, collection] of this.collections) {
                    cleanupCollectionIndex++;
                    const originalCount = collection.highlightIds.length;
                    collection.highlightIds = collection.highlightIds.filter(id => {
                        const isValid = validHighlightIds.has(id);
                        if (!isValid) {
                            logLine(`  Removing orphaned highlight ID "${id}" from collection #${cleanupCollectionIndex}`);
                        }
                        return isValid;
                    });
                    const finalCount = collection.highlightIds.length;
                    this.collections.set(collectionId, collection);
                    logLine(`  Collection #${cleanupCollectionIndex}: ${originalCount} → ${finalCount} highlights`);
                }

                this.settings.collections = Object.fromEntries(this.collections);
                logLine(`✓ Collection cleanup complete`);
            }

            // Save restored settings
            await this.saveSettings();
            logLine(`✓ Settings saved`);

            // Refresh the sidebar to show restored data
            this.refreshSidebar();
            logLine(`✓ Sidebar refreshed`);

            // Calculate and log final statistics
            const totalElapsedTime = Date.now() - startTime;
            const finalHighlightsCount = Array.from(this.highlights.values()).reduce((sum, arr) => sum + arr.length, 0);
            const finalCollectionsCount = this.collections.size;
            const finalFilesWithHighlights = this.highlights.size;

            logLine(`\n=== BACKUP RESTORATION COMPLETED SUCCESSFULLY ===`);
            logLine(`Total elapsed time: ${totalElapsedTime}ms (${(totalElapsedTime / 1000).toFixed(2)}s)`);
            logLine(`\n--- FINAL STATISTICS ---`);
            logLine(`Collections restored: ${collectionsCount}`);
            logLine(`Highlights attempted: ${collectionHighlightIds.size}`);
            logLine(`Highlights recovered: ${recoveredCount}`);
            logLine(`Highlights orphaned: ${orphanedCount}`);
            logLine(`Success rate: ${collectionHighlightIds.size > 0 ? ((recoveredCount / collectionHighlightIds.size) * 100).toFixed(1) : 0}%`);
            logLine(`\n--- FINAL STATE ---`);
            logLine(`Total highlights in memory: ${finalHighlightsCount}`);
            logLine(`Total collections: ${finalCollectionsCount}`);
            logLine(`Files with highlights: ${finalFilesWithHighlights}`);

            // Validation checks
            logLine(`\n--- VALIDATION CHECKS ---`);
            const emptyCollections = Array.from(this.collections.values()).filter(c => c.highlightIds.length === 0);
            logLine(`Empty collections: ${emptyCollections.length}`);

            // Check for ID consistency
            const allHighlightIds = new Set<string>();
            for (const highlights of this.highlights.values()) {
                for (const highlight of highlights) {
                    allHighlightIds.add(highlight.id);
                }
            }

            let brokenReferences = 0;
            for (const collection of this.collections.values()) {
                for (const highlightId of collection.highlightIds) {
                    if (!allHighlightIds.has(highlightId)) {
                        brokenReferences++;
                        logLine(`WARNING: Collection contains invalid highlight ID: ${highlightId}`);
                    }
                }
            }
            logLine(`Broken collection references: ${brokenReferences}`);
            logLine(`Validation status: ${brokenReferences === 0 ? '✓ PASSED' : '✗ FAILED'}`);

            // Write log to file
            await this.writeRestoreLog(log.join('\n'));

            return { success: true, orphanedCount, recoveredCount };
        } catch (error) {
            const totalElapsedTime = Date.now() - startTime;
            logLine(`\n✗✗✗ RESTORATION FAILED ✗✗✗`);
            logLine(`Failed at: ${new Date().toISOString()}`);
            logLine(`Time before failure: ${totalElapsedTime}ms`);
            logLine(`Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            logLine(`Error message: ${error}`);
            if (error instanceof Error) {
                logLine(`Error name: ${error.name}`);
                logLine(`Stack trace:\n${error.stack}`);
            }

            // Log partial restoration state if available
            try {
                const partialHighlightsCount = Array.from(this.highlights.values()).reduce((sum, arr) => sum + arr.length, 0);
                logLine(`\n--- PARTIAL STATE AT FAILURE ---`);
                logLine(`Highlights in memory: ${partialHighlightsCount}`);
                logLine(`Collections in memory: ${this.collections.size}`);
            } catch (stateError) {
                logLine(`Could not retrieve partial state: ${stateError}`);
            }

            console.error('Failed to restore from backup:', error);

            // Write log to file even on failure
            await this.writeRestoreLog(log.join('\n'));

            return { success: false };
        }
    }

    async writeRestoreLog(logContent: string): Promise<void> {
        try {
            const logPath = `${this.manifest.dir}/restore-log.txt`;
            await this.app.vault.adapter.write(logPath, logContent);
        } catch (error) {
            console.error('Failed to write restore log:', error);
        }
    }

    async getRestoreLog(): Promise<string | null> {
        try {
            const logPath = `${this.manifest.dir}/restore-log.txt`;
            const exists = await this.app.vault.adapter.exists(logPath);
            if (!exists) {
                return null;
            }
            return await this.app.vault.adapter.read(logPath);
        } catch (error) {
            console.error('Failed to read restore log:', error);
            return null;
        }
    }

    validateHighlightInFile(highlight: Highlight, fileContent: string): boolean {
        // Check if the exact text still exists in the file
        const textExists = fileContent.includes(highlight.text);
        if (!textExists) {
            return false;
        }

        // For native comments, check if it's in a comment block
        if (highlight.isNativeComment) {
            const commentPattern = new RegExp(`%%\\s*${this.escapeRegex(highlight.text)}\\s*%%`);
            return commentPattern.test(fileContent);
        }

        // For regular highlights, check if it's still highlighted
        const highlightPattern = new RegExp(`==\\s*${this.escapeRegex(highlight.text)}\\s*==`);
        return highlightPattern.test(fileContent);
    }

    escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    countOrphanedReferences(): number {
        // Build a set of all valid highlight IDs that exist in markdown files
        const validHighlightIds = new Set<string>();
        for (const [filePath, highlights] of this.highlights) {
            for (const highlight of highlights) {
                validHighlightIds.add(highlight.id);
            }
        }

        let orphanedCount = 0;

        // Count orphaned references in each collection
        for (const [collectionId, collection] of this.collections) {
            for (const id of collection.highlightIds) {
                const isValid = validHighlightIds.has(id);
                if (!isValid) {
                    orphanedCount++;
                }
            }
        }

        return orphanedCount;
    }

    cleanupOrphanedReferences(): number {
        // Build a set of all valid highlight IDs that exist in markdown files
        const validHighlightIds = new Set<string>();
        for (const [filePath, highlights] of this.highlights) {
            for (const highlight of highlights) {
                validHighlightIds.add(highlight.id);
            }
        }

        let orphanedCount = 0;

        // Clean up each collection
        for (const [collectionId, collection] of this.collections) {
            // Filter out highlight IDs that don't exist anymore
            collection.highlightIds = collection.highlightIds.filter(id => {
                const isValid = validHighlightIds.has(id);
                if (!isValid) {
                    orphanedCount++;
                }
                return isValid;
            });

            // Update the collection in the map
            this.collections.set(collectionId, collection);
        }

        return orphanedCount;
    }

    countHighlightsInCollections(collections: { [id: string]: Collection }): number {
        // Count unique highlight IDs across all collections
        const uniqueHighlightIds = new Set<string>();

        for (const collectionId in collections) {
            const collection = collections[collectionId];
            if (collection.highlightIds) {
                for (const highlightId of collection.highlightIds) {
                    uniqueHighlightIds.add(highlightId);
                }
            }
        }

        return uniqueHighlightIds.size;
    }

    async cleanupOldBackups(): Promise<void> {
        try {
            const backups = await this.listBackups();

            // Separate backups: only automatic backups are subject to retention
            const automaticBackups = backups.filter(b =>
                b.data.retentionManaged === true &&
                b.data.backupReason !== 'manual'
            );

            // Only delete automatic backups if we have more than 20
            if (automaticBackups.length > 20) {
                // Keep the 20 most recent, delete the rest
                const toDelete = automaticBackups.slice(20);

                for (const backup of toDelete) {
                    try {
                        await this.app.vault.adapter.remove(backup.path);
                        console.log(`Deleted old backup: ${backup.filename}`);
                    } catch (e) {
                        console.error(`Failed to delete backup ${backup.filename}:`, e);
                    }
                }
            }

            // Never delete manual backups or legacy backups
            // This protects all manual backups and existing backups created before this update
        } catch (error) {
            console.error('Failed to cleanup old backups:', error);
        }
    }


    async migrateBackupFilesToFolder() {
        try {
            const pluginDir = '.obsidian/plugins/sidebar-highlights';
            const backupsDir = `${pluginDir}/backups`;

            // Ensure backups folder exists
            try {
                await this.app.vault.adapter.mkdir(backupsDir);
            } catch (e) {
                // Folder might already exist, that's ok
            }

            // List all files in the plugin directory
            const files = await this.app.vault.adapter.list(pluginDir);

            // Find all backup files in the root
            const backupFiles = files.files.filter(file =>
                file.includes('data-backup-') && file.endsWith('.json') &&
                !file.includes('/backups/')
            );

            if (backupFiles.length === 0) {
                return; // No backups to migrate
            }

            // Move each backup file to the backups folder
            let migratedCount = 0;
            for (const oldPath of backupFiles) {
                try {
                    const filename = oldPath.split('/').pop();
                    const newPath = `${backupsDir}/${filename}`;

                    // Read the old file
                    const content = await this.app.vault.adapter.read(oldPath);

                    // Write to new location
                    await this.app.vault.adapter.write(newPath, content);

                    // Delete old file
                    await this.app.vault.adapter.remove(oldPath);

                    migratedCount++;
                } catch (error) {
                    console.error(`Failed to migrate backup file ${oldPath}:`, error);
                }
            }
        } catch (error) {
            console.error('Failed to migrate backup files:', error);
        }
    }

    async migrateSettings(oldSettings: any) {
        try {
            // Always backup before migration
            await this.createBackup('migration');
            
            const oldVersion = oldSettings.settingsVersion || '1.13.0';
            const newVersion = DEFAULT_SETTINGS.settingsVersion;
            
            if (oldVersion !== newVersion) {
                new Notice(`Migrating settings from ${oldVersion} to ${newVersion}...`);
            }
            
            // Preserve critical user data
            const userCollections = oldSettings.collections || {};
            const userColorNames = oldSettings.customColorNames || {};
            const userHighlights = oldSettings.highlights || {};
            
            // Start with fresh defaults for new version
            this.settings = { ...DEFAULT_SETTINGS };
            
            // Merge user data with new defaults
            this.settings.collections = userCollections;
            this.settings.customColorNames = {
                ...DEFAULT_SETTINGS.customColorNames,
                ...userColorNames // User overrides take precedence
            };
            this.settings.highlights = userHighlights;
            
            // Preserve other user preferences that exist in both versions
            if (oldSettings.highlightColor !== undefined) {
                this.settings.highlightColor = oldSettings.highlightColor;
            }
            if (oldSettings.sidebarPosition !== undefined) {
                this.settings.sidebarPosition = oldSettings.sidebarPosition;
            }
            if (oldSettings.groupingMode !== undefined) {
                this.settings.groupingMode = oldSettings.groupingMode;
            }
            if (oldSettings.showFilenames !== undefined) {
                this.settings.showFilenames = oldSettings.showFilenames;
            }
            if (oldSettings.showTimestamps !== undefined) {
                this.settings.showTimestamps = oldSettings.showTimestamps;
            }
            if (oldSettings.showHighlightActions !== undefined) {
                this.settings.showHighlightActions = oldSettings.showHighlightActions;
            }
            if (oldSettings.showToolbar !== undefined) {
                this.settings.showToolbar = oldSettings.showToolbar;
            }
            if (oldSettings.useInlineFootnotes !== undefined) {
                this.settings.useInlineFootnotes = oldSettings.useInlineFootnotes;
            }
            if (oldSettings.selectTextOnCommentClick !== undefined) {
                this.settings.selectTextOnCommentClick = oldSettings.selectTextOnCommentClick;
            }
            if (oldSettings.excludeExcalidraw !== undefined) {
                this.settings.excludeExcalidraw = oldSettings.excludeExcalidraw;
            }
            if (oldSettings.excludedFiles !== undefined) {
                this.settings.excludedFiles = oldSettings.excludedFiles;
            }
            if (oldSettings.dateFormat !== undefined) {
                this.settings.dateFormat = oldSettings.dateFormat;
            }
            if (oldSettings.customColors !== undefined) {
                this.settings.customColors = {
                    ...DEFAULT_SETTINGS.customColors,
                    ...oldSettings.customColors
                };
            }
            
            // Update version to current
            this.settings.settingsVersion = newVersion;
            
            // Update internal Maps to match migrated settings
            this.collections = new Map(Object.entries(this.settings.collections || {}));
            this.highlights = new Map(Object.entries(this.settings.highlights || {}));
            
            // Save migrated settings
            await this.saveSettings();
            
            if (oldVersion !== newVersion) {
                new Notice(`Settings successfully migrated to ${newVersion}`);
                
                // Validate collection references after migration
                await this.validateCollectionReferences();
            }
        } catch (error) {
            console.error('Migration failed:', error);
            new Notice('Error during settings migration. Please check console for details.');
        }
    }

    async validateCollectionReferences() {
        try {
            const allHighlightIds = new Set<string>();
            
            // Collect all existing highlight IDs
            for (const highlights of this.highlights.values()) {
                highlights.forEach(h => allHighlightIds.add(h.id));
            }
            
            let totalBrokenReferences = 0;
            const collectionsWithIssues: Array<{name: string, brokenCount: number, totalCount: number}> = [];
            
            // Check each collection for broken references
            for (const collection of this.collections.values()) {
                const brokenReferences = collection.highlightIds.filter(id => !allHighlightIds.has(id));
                
                if (brokenReferences.length > 0) {
                    totalBrokenReferences += brokenReferences.length;
                    collectionsWithIssues.push({
                        name: collection.name,
                        brokenCount: brokenReferences.length,
                        totalCount: collection.highlightIds.length
                    });
                    
                    // Remove broken references automatically
                    collection.highlightIds = collection.highlightIds.filter(id => allHighlightIds.has(id));
                }
            }
            
            // Report results to user
            if (totalBrokenReferences > 0) {
                const issuesSummary = collectionsWithIssues
                    .map(c => `• ${c.name}: ${c.brokenCount}/${c.totalCount} references`)
                    .join('\n');
                
                new Notice(
                    `Migration complete, but ${totalBrokenReferences} highlight reference(s) couldn't be restored:\n\n${issuesSummary}\n\nBroken references have been cleaned up. You may need to manually re-add some highlights to these collections.`,
                    8000 // Show notice for 8 seconds
                );
                
                // Save the cleaned-up collections
                await this.saveSettings();
            } else {
                new Notice('Migration successful! All collections and highlights preserved.', 3000);
            }
        } catch (error) {
            console.error('Collection validation failed:', error);
            new Notice('Warning: Could not validate collection references after migration.');
        }
    }

    // Implement onExternalSettingsChange to reload all settings when they change externally
    async onExternalSettingsChange() {
        try {
            // Create backup before any changes
            await this.createBackup('external-sync');
            
            // Load external settings
            const externalSettings = await this.loadData();
            
            // Only migrate if we have an explicit older version
            if (externalSettings && 
                externalSettings.settingsVersion && 
                externalSettings.settingsVersion !== DEFAULT_SETTINGS.settingsVersion) {
                // Migration needed for explicit older version
                await this.migrateSettings(externalSettings);
            } else {
                // Safe to reload normally (either no version or current version)
                await this.reloadAllSettings();
            }
        } catch (error) {
            console.error('Error handling external settings change:', error);
            // Fallback to normal reload
            await this.reloadAllSettings();
        }
    }

    // Register dynamic commands for collections
    public registerCollectionCommands() {
        // Register commands for all existing collections
        for (const collection of this.collections.values()) {
            const goToId = `go-to-collection-${collection.id}`;
            
            // Always register/re-register to update the name if it changed
            this.addCommand({
                id: goToId,
                name: t('commands.goToCollection', { name: collection.name }),
                callback: () => {
                    this.goToCollection(collection.id);
                }
            });
            
            this.collectionCommands.add(goToId);
        }
    }


    // Unregister all collection commands
    private unregisterCollectionCommands() {
        // Remove all tracked collection commands
        for (const commandId of this.collectionCommands) {
            this.removeCommand(commandId);
        }
        this.collectionCommands.clear();
    }

    // Navigate to a specific collection in the sidebar
    private async goToCollection(collectionId: string) {
        // First, make sure the sidebar is open
        await this.activateView();
        
        // Then navigate to the collection
        if (this.sidebarView) {
            this.sidebarView.navigateToCollection(collectionId);
        }
    }

    updateHighlight(highlightId: string, updates: Partial<Highlight>, filePath?: string) {
        let determinedFilePath = filePath;
        let fileHighlightsList: Highlight[] | undefined;
    
        if (determinedFilePath) {
            fileHighlightsList = this.highlights.get(determinedFilePath);
        } else {
            // If no filePath is provided, attempt to find the highlight by ID across all files.
            // This assumes highlight IDs are globally unique if filePath is omitted.
            for (const [path, highlightsInFile] of this.highlights) {
                if (highlightsInFile.some(h => h.id === highlightId)) {
                    determinedFilePath = path;
                    fileHighlightsList = highlightsInFile;
                    break;
                }
            }
        }
    
        // If still no path after searching, and filePath was not initially provided,
        // fallback to active file to maintain some compatibility if a caller truly doesn't know the path.
        if (!determinedFilePath && !filePath) {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                determinedFilePath = activeFile.path;
                fileHighlightsList = this.highlights.get(determinedFilePath);
            }
        }
        
        if (!determinedFilePath || !fileHighlightsList) {
            return;
        }
    
        const highlightIndex = fileHighlightsList.findIndex(h => h.id === highlightId);
        
        if (highlightIndex !== -1) {
            const updatedHighlight = { ...fileHighlightsList[highlightIndex], ...updates };
            // Create a new array for the highlights of the specific file to ensure reactivity
            const newFileHighlightsList = [...fileHighlightsList];
            newFileHighlightsList[highlightIndex] = updatedHighlight;
            
            this.highlights.set(determinedFilePath, newFileHighlightsList);
            this.saveSettings(); 
            
            // Update individual item instead of full refresh to preserve scroll position
            if (this.sidebarView) {
                this.sidebarView.updateItem(highlightId);
            }
        }
    }

    async loadHighlightsFromFile(file: TFile) {
        // Only clear selection if it's not for a highlight-initiated file switch
        // (if selectedHighlightId exists and matches a highlight in the target file, preserve it)
        if (this.selectedHighlightId) {
            const targetFileHighlights = this.highlights.get(file.path) || [];
            const selectedHighlightInTargetFile = targetFileHighlights.find(h => h.id === this.selectedHighlightId);
            if (!selectedHighlightInTargetFile) {
                // Selection is not in target file, clear it
                this.selectedHighlightId = null;
            }
            // If selection IS in target file, preserve it for restoration
        } else {
            // No selection to preserve
            this.selectedHighlightId = null;
        }
        
        // Skip parsing files that shouldn't be processed
        if (!this.shouldProcessFile(file)) {
            // Clear any existing highlights for this file and update content
            this.highlights.delete(file.path);
            if (this.sidebarView) {
                this.sidebarView.updateContent(); // Content update instead of full refresh
            }
            return;
        }
        
        // Check if this is an Excalidraw file (deeper check)
        if (await this.isExcalidrawFile(file)) {
            // Clear any existing highlights for this file and update content
            this.highlights.delete(file.path);
            if (this.sidebarView) {
                this.sidebarView.updateContent(); // Content update instead of full refresh
            }
            return;
        }
        
        const content = await this.app.vault.read(file);
        // detectAndStoreMarkdownHighlights will call refreshSidebar if changes are detected
        this.detectAndStoreMarkdownHighlights(content, file);
        // Always update content when file changes, even if no highlights detected
        if (this.sidebarView) {
            this.sidebarView.updateContent(); // Content update instead of full refresh
        }
    }

    debounceDetectMarkdownHighlights(editor: Editor, view: MarkdownView) {
        if (this.detectHighlightsTimeout) {
            window.clearTimeout(this.detectHighlightsTimeout);
        }
        this.detectHighlightsTimeout = window.setTimeout(() => {
            this.detectMarkdownHighlights(editor, view);
        }, 1000); // 1 second
    }

    async detectMarkdownHighlights(editor: Editor, view: MarkdownView) {
        const file = view.file;
        if (!file) return;
        const content = editor.getValue();
        this.detectAndStoreMarkdownHighlights(content, file);
    }

    async scanAllFilesForHighlights() {
        // Prevent concurrent scans - if already scanning, skip this call
        if (this.isScanningFiles) {
            console.log('Scan already in progress, skipping concurrent scan request');
            return;
        }

        this.isScanningFiles = true;

        try {
            const markdownFiles = this.app.vault.getMarkdownFiles();

            // TWO-TIER SCANNING LOGIC:
            // 1. Scan all non-filtered files (normal behavior)
            const normallyProcessableFiles = markdownFiles.filter(file => this.shouldProcessFile(file));

            // 2. Additionally scan filtered files that contain collection highlights
            // This ensures collection highlights are always up-to-date regardless of filtering
            const filesWithCollections = this.getFilesWithCollectionHighlights();
            const filteredFilesWithCollections = markdownFiles.filter(file =>
                !this.shouldProcessFile(file) && // File is filtered
                filesWithCollections.has(file.path) // But contains collection highlights
            );

            // Combine both sets: normal files + filtered files with collections
            const allFilesToProcess = [...normallyProcessableFiles, ...filteredFilesWithCollections];
            const existingFilePaths = new Set(allFilesToProcess.map(file => file.path));
            let hasChanges = false;

        // First, clean up highlights for files that no longer exist OR no longer have collections
        for (const filePath of this.highlights.keys()) {
            if (!existingFilePaths.has(filePath)) {
                // Only delete if file doesn't exist OR (file is filtered AND has no collection highlights)
                const file = this.app.vault.getAbstractFileByPath(filePath);
                const shouldDelete = !file || !filesWithCollections.has(filePath);

                if (shouldDelete) {
                    this.highlights.delete(filePath);
                    hasChanges = true;
                }
            }
        }

        // Scan existing files for highlights FIRST, then clean up orphaned references
        // This ensures we clean based on the current state of highlights in markdown files
        for (const file of allFilesToProcess) {
            try {
                // Check if this is an Excalidraw file (deeper check)
                if (await this.isExcalidrawFile(file)) {
                    // Remove any existing highlights for Excalidraw files
                    if (this.highlights.has(file.path)) {
                        this.highlights.delete(file.path);
                        hasChanges = true;
                    }
                    continue;
                }
                
                const content = await this.app.vault.read(file);
                const oldHighlights = this.highlights.get(file.path) || [];
                this.detectAndStoreMarkdownHighlights(content, file, false); // Don't refresh sidebar for each file
                const newHighlights = this.highlights.get(file.path) || [];
                
                // Check if any highlights were found or changed (more thorough than just count)
                const oldHighlightsJSON = JSON.stringify(oldHighlights.map(h => ({id: h.id, text: h.text, start: h.startOffset, end: h.endOffset, footnotes: h.footnoteCount})));
                const newHighlightsJSON = JSON.stringify(newHighlights.map(h => ({id: h.id, text: h.text, start: h.startOffset, end: h.endOffset, footnotes: h.footnoteCount})));
                
                if (oldHighlightsJSON !== newHighlightsJSON) {
                    hasChanges = true;
                }
            } catch (error) {
                // Continue on error
            }
        }

        // NOW clean up orphaned highlight IDs from collections
        // This happens AFTER scanning so we clean based on the current state of highlights
        for (const collection of this.collections.values()) {
            const originalLength = collection.highlightIds.length;
            collection.highlightIds = collection.highlightIds.filter(highlightId => {
                // Check if this highlight still exists in any file
                for (const [filePath, fileHighlights] of this.highlights) {
                    if (fileHighlights.some(h => h.id === highlightId)) {
                        return true; // Keep this highlight ID
                    }
                }
                return false; // Remove this highlight ID
            });

            if (collection.highlightIds.length !== originalLength) {
                hasChanges = true;
            }
        }

            // Save settings and refresh sidebar only once after scanning all files
            if (hasChanges) {
                await this.saveSettings();
                this.refreshSidebar();
            }
        } finally {
            // Always reset the scanning flag, even if an error occurred
            this.isScanningFiles = false;
        }
    }

    detectAndStoreMarkdownHighlights(content: string, file: TFile, shouldRefresh: boolean = true) {
        // Support multi-paragraph highlights by allowing newlines
        const markdownHighlightRegex = /==((?:[^=]|=[^=])+?)==/g;
        const commentHighlightRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;

        const newHighlights: Highlight[] = [];
        const existingHighlightsForFile = this.highlights.get(file.path) || [];
        const usedExistingHighlights = new Set<string>(); // Track which highlights we've already matched
        
        // Create a more robust matching system that considers text, position, and type
        const findExistingHighlight = (text: string, startOffset: number, endOffset: number, isComment: boolean): Highlight | undefined => {
            // First, try exact position match
            let exactMatch = existingHighlightsForFile.find(h => 
                !usedExistingHighlights.has(h.id) &&
                h.text === text && 
                h.startOffset === startOffset && 
                h.endOffset === endOffset &&
                h.isNativeComment === isComment
            );
            if (exactMatch) {
                usedExistingHighlights.add(exactMatch.id);
                return exactMatch;
            }
            
            // If no exact match, try fuzzy position match (within 50 characters)
            let fuzzyMatch = existingHighlightsForFile.find(h => 
                !usedExistingHighlights.has(h.id) &&
                h.text === text && 
                Math.abs(h.startOffset - startOffset) <= 50 &&
                h.isNativeComment === isComment
            );
            if (fuzzyMatch) {
                usedExistingHighlights.add(fuzzyMatch.id);
                return fuzzyMatch;
            }
            
            // If still no match, try text-only match for highlights that might have moved significantly
            let textMatch = existingHighlightsForFile.find(h => 
                !usedExistingHighlights.has(h.id) &&
                h.text === text && 
                h.isNativeComment === isComment &&
                !existingHighlightsForFile.some(other => 
                    other !== h && other.text === text && other.isNativeComment === isComment
                ) // Only if it's the only highlight with this text
            );
            if (textMatch) {
                usedExistingHighlights.add(textMatch.id);
                return textMatch;
            }
            
            return undefined;
        };

        // Extract all footnotes from the content
        const footnoteMap = this.extractFootnotes(content);

        // Get code block ranges to exclude highlights within them
        const codeBlockRanges = this.getCodeBlockRanges(content);

        // Get markdown link ranges to exclude highlights within URLs
        const markdownLinkRanges = this.getMarkdownLinkRanges(content);

        // Process all highlight types
        const allMatches: Array<{match: RegExpExecArray, type: 'highlight' | 'comment' | 'html', color?: string, isCustomPattern?: boolean}> = [];

        // Find all highlight matches
        let match;
        while ((match = markdownHighlightRegex.exec(content)) !== null) {
            // Skip if match is inside a code block
            if (this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                continue;
            }

            // Skip if highlight delimiters are inside a markdown link URL
            if (this.isHighlightDelimiterInLink(match.index, match.index + match[0].length, content, markdownLinkRanges)) {
                continue;
            }

            // Skip if this highlight is surrounded by additional equals signs (e.g., =====text===== )
            const beforeMatch = content.charAt(match.index - 1);
            const afterMatch = content.charAt(match.index + match[0].length);
            if (beforeMatch === '=' || afterMatch === '=') {
                continue;
            }

            allMatches.push({match, type: 'highlight'});
        }
        
        // Find all comment matches
        while ((match = commentHighlightRegex.exec(content)) !== null) {
            // Skip if match is inside a code block
            if (this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                continue;
            }

            // Skip if comment delimiters are inside a markdown link URL
            if (this.isHighlightDelimiterInLink(match.index, match.index + match[0].length, content, markdownLinkRanges)) {
                continue;
            }

            // Skip if this comment is surrounded by additional percent signs (e.g., %%%%%text%%%%% )
            const beforeMatch = content.charAt(match.index - 1);
            const afterMatch = content.charAt(match.index + match[0].length);
            if (beforeMatch === '%' || afterMatch === '%') {
                continue;
            }

            allMatches.push({match, type: 'comment'});
        }

        // Find HTML comments if enabled and track their ranges
        const htmlCommentRanges: Array<{start: number, end: number}> = [];
        if (this.settings.detectHtmlComments) {
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            while ((match = htmlCommentRegex.exec(content)) !== null) {
                // Skip if match is inside a code block
                if (this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                    continue;
                }

                // Skip if comment delimiters are inside a markdown link URL
                if (this.isHighlightDelimiterInLink(match.index, match.index + match[0].length, content, markdownLinkRanges)) {
                    continue;
                }

                allMatches.push({match, type: 'comment'});
                // Track HTML comment range to exclude from custom pattern detection
                htmlCommentRanges.push({
                    start: match.index,
                    end: match.index + match[0].length
                });
            }
        }

        // Find custom pattern matches
        this.settings.customPatterns.forEach(customPattern => {
            try {
                const customRegex = new RegExp(customPattern.pattern, 'g');
                let matchCount = 0;
                const maxMatches = 1000; // Safety limit to prevent infinite loops

                while ((match = customRegex.exec(content)) !== null) {
                    matchCount++;

                    // Safety check: if we've found too many matches, bail out
                    if (matchCount > maxMatches) {
                        console.error(`Custom pattern "${customPattern.name}" exceeded match limit. Pattern may be too broad.`);
                        new Notice(`Custom pattern "${customPattern.name}" is causing performance issues and has been skipped.`, 8000);
                        break;
                    }

                    // Prevent infinite loops on zero-length matches
                    if (match.index === customRegex.lastIndex) {
                        customRegex.lastIndex++;
                    }

                    // Skip if match is inside a code block, markdown link, or HTML comment
                    if (!this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges) &&
                        !this.isInsideCodeBlock(match.index, match.index + match[0].length, markdownLinkRanges) &&
                        !this.isInsideCodeBlock(match.index, match.index + match[0].length, htmlCommentRanges)) {
                        allMatches.push({
                            match,
                            type: customPattern.type === 'comment' ? 'comment' : 'highlight',
                            isCustomPattern: true
                        });
                    }
                }
            } catch (e) {
                console.error(`Invalid custom pattern "${customPattern.name}":`, e);
                new Notice(`Custom pattern "${customPattern.name}" caused an error and has been skipped.`, 5000);
            }
        });

        // Find HTML highlights using HTML parser
        // Combine code block and markdown link ranges to exclude both
        const excludedRanges = [...codeBlockRanges, ...markdownLinkRanges];
        const htmlHighlights = HtmlHighlightParser.parseHighlights(content, excludedRanges);
        htmlHighlights.forEach(htmlMatch => {
            // Create a RegExpExecArray-like object for compatibility with existing code
            const modifiedMatch: any = [htmlMatch.fullMatch, htmlMatch.text];
            modifiedMatch.index = htmlMatch.startOffset;
            modifiedMatch.input = content;
            allMatches.push({match: modifiedMatch, type: 'html', color: htmlMatch.color});
        });
        
        // Sort matches by position in content
        allMatches.sort((a, b) => a.match.index - b.match.index);

        // Pre-process to handle adjacent highlight + comment patterns
        // When a comment follows a highlight with only footnotes/whitespace between
        // (e.g., ==text==^[note]<!-- comment --> or ==text==%% comment %%),
        // store the comment to be added as a footnote to the highlight
        const adjacentComments = new Map<number, { text: string, position: number }>(); // Maps highlight index to comment info

        for (let i = 0; i < allMatches.length - 1; i++) {
            const current = allMatches[i];
            const next = allMatches[i + 1];

            // Check if current is a highlight (not a comment) and next is any type of comment
            if ((current.type === 'highlight' || current.type === 'html') && next.type === 'comment') {
                const highlightEnd = current.match.index + current.match[0].length;
                const commentStart = next.match.index;

                // Check if comment follows highlight with only footnotes/whitespace between
                const betweenText = content.substring(highlightEnd, commentStart);

                // Calculate footnote length - if the between text is ONLY footnotes and whitespace,
                // calculateFootnoteLength should return the full length
                const footnoteLength = InlineFootnoteManager.calculateFootnoteLength(betweenText);
                const afterFootnotes = betweenText.substring(footnoteLength);

                // If after removing footnotes, we only have whitespace AND no blank lines, this is adjacent
                // A blank line (two or more newlines with optional whitespace between) breaks adjacency
                const hasBlankLine = /\n\s*\n/.test(afterFootnotes);
                if (/^\s*$/.test(afterFootnotes) && !hasBlankLine) {
                    // Check if this is a native comment (%% %%)
                    const isNativeComment = next.match[0].startsWith('%%') && next.match[0].endsWith('%%');

                    // Apply adjacency logic for both native and HTML comments based on the setting
                    const shouldApplyAdjacency = this.settings.detectAdjacentNativeComments;

                    if (shouldApplyAdjacency) {
                        // This is a comment adjacent to a highlight (HTML, native, or custom)
                        // It may be after inline footnotes like ==text==^[note]<!-- comment -->
                        // Store both the text and the actual position of the comment
                        adjacentComments.set(i, {
                            text: next.match[1].trim(),
                            position: commentStart // Use the comment's actual position for sorting
                        });
                        // Mark the comment for skipping in main loop
                        allMatches[i + 1] = { ...next, type: 'comment' as any, skip: true } as any;
                    }
                }
            }
        }

        allMatches.forEach(({match, type, color, skip, isCustomPattern}: any, index) => {
            // Skip matches that were merged as adjacent comments
            if (skip) return;
            const [, highlightText] = match;
            
            // Skip empty or whitespace-only highlights
            if (!highlightText || highlightText.trim() === '') {
                return;
            }
            
            // Find existing highlight using improved matching
            const existingHighlight = findExistingHighlight(
                highlightText, 
                match.index, 
                match.index + match[0].length, 
                type === 'comment'
            );
            
            // Calculate line number from offset
            const lineNumber = content.substring(0, match.index).split('\n').length - 1;
            
            let footnoteContents: string[] = [];
            let footnoteCount = 0;
            
            if (type === 'highlight' || type === 'html') {
                // For regular and HTML highlights, extract footnotes in the order they appear in the text
                const afterHighlight = content.substring(match.index + match[0].length);
                
                // Find all footnotes (both standard and inline) in order
                const allFootnotes: Array<{type: 'standard' | 'inline', index: number, content: string}> = [];
                
                // First, get all inline footnotes with their positions
                const inlineFootnotes = this.inlineFootnoteManager.extractInlineFootnotes(content, match.index + match[0].length);
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
                // Use negative lookahead to avoid matching footnote definitions [^key]: content
                const standardFootnoteRegex = new RegExp(STANDARD_FOOTNOTE_REGEX);
                let match_sf;
                let lastValidPosition = 0;

                while ((match_sf = standardFootnoteRegex.exec(afterHighlight)) !== null) {
                    // Check if this standard footnote is in a valid position
                    const precedingText = afterHighlight.substring(lastValidPosition, match_sf.index);
                    const isValid = FOOTNOTE_VALIDATION_REGEX.test(precedingText);
                    
                    if (match_sf.index === lastValidPosition || isValid) {
                        const key = match_sf[2]; // The key inside [^key]
                        if (footnoteMap.has(key)) {
                            const fnContent = footnoteMap.get(key)!.trim();
                            if (fnContent) { // Only add non-empty content
                                allFootnotes.push({
                                    type: 'standard',
                                    index: match.index + match[0].length + match_sf.index,
                                    content: fnContent
                                });
                            }
                        }
                        lastValidPosition = match_sf.index + match_sf[0].length;
                    } else {
                        // Stop if we encounter a footnote that's not in the valid sequence
                        break;
                    }
                }

                // Add adjacent comment if present
                if (adjacentComments.has(index)) {
                    const adjacentComment = adjacentComments.get(index)!;
                    allFootnotes.push({
                        type: 'inline' as 'inline',
                        index: adjacentComment.position, // Use the actual position for correct sorting
                        content: adjacentComment.text
                    });
                }

                // Sort footnotes by their position in the text
                allFootnotes.sort((a, b) => a.index - b.index);

                // Extract content in the correct order
                footnoteContents = allFootnotes.map(f => f.content);
                footnoteCount = footnoteContents.length;
                
            } else if (type === 'comment') {
                // For comments, the text itself IS the comment content
                footnoteContents = [highlightText];
                footnoteCount = 1;
            }
            
            if (existingHighlight) {
                newHighlights.push({
                    ...existingHighlight,
                    line: lineNumber,
                    startOffset: match.index,
                    endOffset: match.index + match[0].length,
                    filePath: file.path, // ensure filePath is current
                    footnoteCount: footnoteCount,
                    footnoteContents: footnoteContents,
                    isNativeComment: type === 'comment',
                    // Update color for HTML highlights, preserve existing for others
                    color: type === 'html' ? color : existingHighlight.color,
                    // Preserve existing createdAt timestamp if it exists
                    createdAt: existingHighlight.createdAt || Date.now(),
                    // Store the type for proper identification
                    type: isCustomPattern ? 'custom' : type,
                    // Store full match for custom patterns
                    fullMatch: isCustomPattern ? match[0] : undefined
                });
            } else {
                // For new highlights, use file modification time to preserve historical context
                // Add a small offset based on the match index to ensure uniqueness
                const uniqueTimestamp = file.stat.mtime + (match.index % 1000);
                newHighlights.push({
                    id: this.generateId(),
                    text: highlightText,
                    tags: [],
                    line: lineNumber,
                    startOffset: match.index,
                    endOffset: match.index + match[0].length,
                    filePath: file.path,
                    footnoteCount: footnoteCount,
                    footnoteContents: footnoteContents,
                    createdAt: uniqueTimestamp,
                    isNativeComment: type === 'comment',
                    // Set color for HTML highlights
                    color: type === 'html' ? color : undefined,
                    // Store the type for proper identification
                    type: isCustomPattern ? 'custom' : type,
                    // Store full match for custom patterns
                    fullMatch: isCustomPattern ? match[0] : undefined
                });
            }
        });

        // Check for actual changes before updating and refreshing
        const oldHighlightsJSON = JSON.stringify(existingHighlightsForFile.map(h => ({id: h.id, start: h.startOffset, end: h.endOffset, text: h.text, footnotes: h.footnoteCount, contents: h.footnoteContents?.filter(c => c.trim() !== ''), color: h.color, isNativeComment: h.isNativeComment})));
        const newHighlightsJSON = JSON.stringify(newHighlights.map(h => ({id: h.id, start: h.startOffset, end: h.endOffset, text: h.text, footnotes: h.footnoteCount, contents: h.footnoteContents?.filter(c => c.trim() !== ''), color: h.color, isNativeComment: h.isNativeComment})));

        if (oldHighlightsJSON !== newHighlightsJSON) {
            this.highlights.set(file.path, newHighlights);
            if (shouldRefresh) {
                this.saveSettings(); // Save to disk after detecting changes
                this.smartUpdateSidebar(existingHighlightsForFile, newHighlights);
            }
        }
    }

    /**
     * Smart sidebar update: use targeted updates when possible, full refresh only when necessary
     */
    private smartUpdateSidebar(oldHighlights: Highlight[], newHighlights: Highlight[]): void {
        if (!this.sidebarView) {
            return;
        }

        // Skip refresh if we're in a tab that doesn't display highlights
        // Tasks and Collections tabs don't show highlights, so no need to refresh UI
        const viewMode = this.sidebarView.getViewMode();

        if (viewMode === 'tasks' || viewMode === 'collections') {
            // Data is still updated in storage, but UI doesn't refresh
            // This prevents unnecessary flashing when working in these tabs
            return;
        }

        // Create maps for quick lookup
        const oldByID = new Map<string, Highlight>();
        const newByID = new Map<string, Highlight>();
        
        oldHighlights.forEach(h => oldByID.set(h.id, h));
        newHighlights.forEach(h => newByID.set(h.id, h));

        // Check for structural changes (new or deleted highlights)
        const oldIDs = new Set(oldByID.keys());
        const newIDs = new Set(newByID.keys());
        const hasStructuralChanges = oldIDs.size !== newIDs.size || 
                                   [...oldIDs].some(id => !newIDs.has(id)) ||
                                   [...newIDs].some(id => !oldIDs.has(id));

        if (hasStructuralChanges) {
            // New or deleted highlights - use updateContent() instead of full refresh
            // This avoids clearing task cache and rebuilding entire DOM
            this.sidebarView.updateContent();
        } else {
            // Only content changes - use targeted updates
            for (const [id, newHighlight] of newByID) {
                const oldHighlight = oldByID.get(id);
                if (oldHighlight) {
                    // Compare highlights to see if this one changed
                    const oldJSON = JSON.stringify({
                        text: oldHighlight.text, 
                        footnotes: oldHighlight.footnoteCount, 
                        contents: oldHighlight.footnoteContents?.filter(c => c.trim() !== ''), 
                        color: oldHighlight.color,
                        isNativeComment: oldHighlight.isNativeComment
                    });
                    const newJSON = JSON.stringify({
                        text: newHighlight.text, 
                        footnotes: newHighlight.footnoteCount, 
                        contents: newHighlight.footnoteContents?.filter(c => c.trim() !== ''), 
                        color: newHighlight.color,
                        isNativeComment: newHighlight.isNativeComment
                    });
                    
                    if (oldJSON !== newJSON) {
                        // This highlight changed - update just this item
                        this.sidebarView.updateItem(id);
                    }
                }
            }
        }
    }


    extractFootnotes(content: string): Map<string, string> {
        const footnoteMap = new Map<string, string>();
        const footnoteRegex = /^\[\^(\w+)\]:\s*(.+(?:(?:\n+\s*$)*\n(?:  |\t).+))$/gm;
        let match;
        
        while ((match = footnoteRegex.exec(content)) !== null) {
            const [, key, footnoteContent] = match;
            footnoteMap.set(key, footnoteContent.trim());
        }
        
        return footnoteMap;
    }

    private async handleFileCreate(file: TFile) {
        try {
            // Read the content of the newly created file
            const content = await this.app.vault.read(file);
            
            // Scan for existing highlights in the new file
            this.detectAndStoreMarkdownHighlights(content, file, false); // Don't refresh sidebar for each scan
            
            // Get the highlights found
            const highlights = this.highlights.get(file.path);
            if (highlights && highlights.length > 0) {
                // Save settings and refresh sidebar since we found highlights
                await this.saveSettings();
                this.refreshSidebar();
            }
        } catch (error) {
            // Continue on error
        }
    }

    async handleFileRename(file: TFile, oldPath: string) {
        const oldHighlights = this.highlights.get(oldPath);
        if (oldHighlights && oldHighlights.length > 0) {
            // Update file paths in highlights
            const updatedHighlights = oldHighlights.map(highlight => ({
                ...highlight,
                filePath: file.path
            }));
            
            // Remove old path and add new path
            this.highlights.delete(oldPath);
            this.highlights.set(file.path, updatedHighlights);
            
            // Save settings and refresh sidebar
            await this.saveSettings();
            this.refreshSidebar();
        }
    }

    private handleFileDelete(file: TFile) {
        // Remove highlights for the deleted file
        if (this.highlights.has(file.path)) {
            
            // Get the highlight IDs that will be removed
            const deletedHighlightIds = new Set(
                (this.highlights.get(file.path) || []).map(h => h.id)
            );
            
            // Remove the file's highlights
            this.highlights.delete(file.path);
            
            // Clean up collection references to these specific highlights
            let collectionsModified = false;
            for (const collection of this.collections.values()) {
                const originalLength = collection.highlightIds.length;
                collection.highlightIds = collection.highlightIds.filter(
                    highlightId => !deletedHighlightIds.has(highlightId)
                );
                
                if (collection.highlightIds.length !== originalLength) {
                    collectionsModified = true;
                }
            }
            
            this.saveSettings();
            this.refreshSidebar();
        }
    }

    getCurrentFileHighlights(): Highlight[] {
        const file = this.app.workspace.getActiveFile();
        return file ? this.highlights.get(file.path) || [] : [];
    }

    generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }

    /**
     * Get set of file paths that contain highlights referenced in collections
     * These files need to be scanned even if they're filtered
     */
    private getFilesWithCollectionHighlights(): Set<string> {
        const filesWithCollectionHighlights = new Set<string>();

        // Get all highlight IDs that are in collections
        for (const collection of this.collections.values()) {
            for (const highlightId of collection.highlightIds) {
                // Find which file contains this highlight
                for (const [filePath, fileHighlights] of this.highlights) {
                    if (fileHighlights.some(h => h.id === highlightId)) {
                        filesWithCollectionHighlights.add(filePath);
                        break;
                    }
                }
            }
        }

        return filesWithCollectionHighlights;
    }

    /**
     * Check if a highlight ID is referenced in any collection
     */
    private isHighlightInCollection(highlightId: string): boolean {
        for (const collection of this.collections.values()) {
            if (collection.highlightIds.includes(highlightId)) {
                return true;
            }
        }
        return false;
    }

    shouldProcessFile(file: TFile): boolean {
        if (file.extension !== 'md') {
            return false;
        }
        
        if (this.settings.excludeExcalidraw) {
            // Check for .excalidraw extension in the filename
            if (file.name.endsWith('.excalidraw.md')) {
                return false;
            }
        }
        
        // Check if file is excluded
        if (this.isFileExcluded(file.path)) {
            return false;
        }
        
        return true;
    }

    private isFileExcluded(filePath: string): boolean {
        const filters = this.settings.fileFilters;

        if (!filters || filters.length === 0) {
            return false; // No filters = process all files
        }

        const normalizedFilePath = filePath.replace(/\\/g, '/');

        // Check each filter - each has its own mode
        let hasIncludeFilters = false;
        let matchesIncludeFilter = false;
        let matchesExcludeFilter = false;

        for (const filter of filters) {
            const normalizedFilterPath = filter.path.replace(/\\/g, '/');

            // Check if file matches this filter
            const matches =
                normalizedFilePath === normalizedFilterPath ||
                normalizedFilePath.startsWith(normalizedFilterPath + '/');

            if (matches) {
                if (filter.mode === 'include') {
                    matchesIncludeFilter = true;
                } else {
                    matchesExcludeFilter = true;
                }
            }

            if (filter.mode === 'include') {
                hasIncludeFilters = true;
            }
        }

        // KEY FIX: If file matches an include filter, it should NOT be excluded
        // (even if it also matches an exclude filter)
        // This allows more specific include filters to override broader exclude filters
        if (matchesIncludeFilter) {
            return false;
        }

        // If there are any include filters, file must match at least one to be processed
        if (hasIncludeFilters && !matchesIncludeFilter) {
            return true; // Excluded because not in any include filter
        }

        // If file matches an exclude filter, it's excluded
        if (matchesExcludeFilter) {
            return true;
        }

        return false;
    }

    private async isExcalidrawFile(file: TFile): Promise<boolean> {
        if (!this.settings.excludeExcalidraw) {
            return false;
        }
        
        // Check filename first (fast check)
        if (file.name.endsWith('.excalidraw.md')) {
            return true;
        }
        
        // Check frontmatter for Excalidraw indicators
        try {
            const content = await this.app.vault.read(file);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
                const frontmatter = frontmatterMatch[1];
                // Check for excalidraw-plugin: parsed
                if (/excalidraw-plugin:\s*parsed/i.test(frontmatter)) {
                    return true;
                }
                // Check for tags containing excalidraw
                if (/tags:\s*\[.*excalidraw.*\]/i.test(frontmatter)) {
                    return true;
                }
            }
        } catch (error) {
            // If we can't read the file, don't exclude it
        }
        
        return false;
    }

    /**
     * Fix duplicate timestamps in existing highlights by assigning unique timestamps
     * while preserving the relative order within each file
     */
    async fixDuplicateTimestamps(): Promise<void> {
        let hasChanges = false;
        
        for (const [filePath, highlights] of this.highlights) {
            const timestampCounts = new Map<number, Highlight[]>();
            
            // Group highlights by timestamp to find duplicates
            highlights.forEach(highlight => {
                if (highlight.createdAt) {
                    if (!timestampCounts.has(highlight.createdAt)) {
                        timestampCounts.set(highlight.createdAt, []);
                    }
                    timestampCounts.get(highlight.createdAt)!.push(highlight);
                }
            });
            
            // Fix duplicates
            for (const [timestamp, duplicates] of timestampCounts) {
                if (duplicates.length > 1) {
                    // Sort by start offset to maintain document order
                    duplicates.sort((a, b) => a.startOffset - b.startOffset);
                    
                    // Assign unique timestamps, keeping the first one and incrementing others
                    duplicates.forEach((highlight, index) => {
                        if (index > 0) {
                            // Add milliseconds based on position to ensure uniqueness
                            highlight.createdAt = timestamp + index;
                            hasChanges = true;
                        }
                    });
                }
            }
        }
        
        if (hasChanges) {
            await this.saveSettings();
            this.refreshSidebar();
        }
    }

    /**
     * Get ranges of code blocks (both inline and fenced) in the content
     */
    public getCodeBlockRanges(content: string): Array<{start: number, end: number}> {
        const ranges: Array<{start: number, end: number}> = [];

        // Find fenced code blocks (``` and ~~~ with optional language)
        // Track all opening markers and their types
        const lines = content.split('\n');
        let currentBlockStart: number | null = null;
        let currentBlockType: 'backtick' | 'wave' | null = null;
        let currentPos = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineStart = currentPos;
            const lineEnd = currentPos + line.length;

            // Check for code block markers at start of line
            if (line.match(/^```/)) {
                if (currentBlockType === 'backtick') {
                    // Closing marker - end the block
                    ranges.push({
                        start: currentBlockStart!,
                        end: lineEnd
                    });
                    currentBlockStart = null;
                    currentBlockType = null;
                } else if (currentBlockStart === null) {
                    // Opening marker
                    currentBlockStart = lineStart;
                    currentBlockType = 'backtick';
                }
            } else if (line.match(/^~~~/)) {
                if (currentBlockType === 'wave') {
                    // Closing marker - end the block
                    ranges.push({
                        start: currentBlockStart!,
                        end: lineEnd
                    });
                    currentBlockStart = null;
                    currentBlockType = null;
                } else if (currentBlockStart === null) {
                    // Opening marker
                    currentBlockStart = lineStart;
                    currentBlockType = 'wave';
                }
            }

            currentPos = lineEnd + 1; // +1 for the newline character
        }

        // Handle unclosed code blocks - extend to end of file
        if (currentBlockStart !== null) {
            ranges.push({
                start: currentBlockStart,
                end: content.length
            });
        }

        // Find inline code blocks (`code`)
        const inlineCodeRegex = /`([^`\n]+?)`/g;
        let inlineMatch;
        while ((inlineMatch = inlineCodeRegex.exec(content)) !== null) {
            ranges.push({
                start: inlineMatch.index,
                end: inlineMatch.index + inlineMatch[0].length
            });
        }

        return ranges;
    }

    /**
     * Get ranges of markdown links [text](url) to exclude highlights within URLs
     */
    private getMarkdownLinkRanges(content: string): Array<{start: number, end: number}> {
        const ranges: Array<{start: number, end: number}> = [];

        // Match markdown links: [text](url)
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
            ranges.push({
                start: match.index,
                end: match.index + match[0].length
            });
        }

        return ranges;
    }

    /**
     * Check if a range overlaps with any of the provided code block ranges
     * Returns true if the range is fully inside, partially overlaps, or spans across a code block
     */
    private isInsideCodeBlock(start: number, end: number, codeBlockRanges: Array<{start: number, end: number}>): boolean {
        return codeBlockRanges.some(range => {
            // Check for any overlap: ranges overlap if start < range.end AND end > range.start
            return start < range.end && end > range.start;
        });
    }

    /**
     * Check if a highlight's delimiters (== or %%) are inside a markdown link
     * This prevents matching highlights whose markers are in URLs, but allows highlights that contain links
     * Returns true only if the START or END delimiters are inside a link's URL portion
     */
    private isHighlightDelimiterInLink(highlightStart: number, highlightEnd: number, content: string, linkRanges: Array<{start: number, end: number}>): boolean {
        // Check if the opening delimiter (first 2 chars) or closing delimiter (last 2 chars)
        // are inside a markdown link's URL portion
        for (const linkRange of linkRanges) {
            // Get the link text to find where the URL starts: [text](url)
            const linkText = content.substring(linkRange.start, linkRange.end);
            const urlStartOffset = linkText.indexOf('](') + 2; // +2 to skip "]("
            const urlStart = linkRange.start + urlStartOffset;
            const urlEnd = linkRange.end - 1; // -1 to exclude the closing ")"

            // Check if opening delimiter is in URL
            const openDelimEnd = highlightStart + 2;
            if (highlightStart >= urlStart && openDelimEnd <= urlEnd) {
                return true;
            }

            // Check if closing delimiter is in URL
            const closeDelimStart = highlightEnd - 2;
            if (closeDelimStart >= urlStart && highlightEnd <= urlEnd) {
                return true;
            }
        }

        return false;
    }
}

class CustomPatternModal extends Modal {
    pattern: CustomPattern | null;
    onSubmit: (pattern: CustomPattern) => void;
    nameInput: HTMLInputElement;
    patternInput: HTMLInputElement;
    typeSelect: HTMLSelectElement;

    constructor(app: App, pattern: CustomPattern | null, onSubmit: (pattern: CustomPattern) => void) {
        super(app);
        this.pattern = pattern;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Set the modal title (appears in upper left corner)
        const titleEl = contentEl.createEl('div', { cls: 'modal-title', text: this.pattern ? t('modals.customPattern.editTitle') : t('modals.customPattern.addTitle') });
        titleEl.style.marginBottom = '20px';

        // Name input (Setting component adds divider automatically)
        new Setting(contentEl)
            .setName(t('modals.customPattern.nameLabel'))
            .setDesc(t('modals.customPattern.nameDesc'))
            .addText(text => {
                this.nameInput = text.inputEl;
                text.setValue(this.pattern?.name || '')
                    .setPlaceholder(t('modals.customPattern.namePlaceholder'));
            });

        // Pattern input
        const patternDesc = document.createDocumentFragment();
        patternDesc.append(
            t('modals.customPattern.patternDesc'),
            document.createElement('br'),
            document.createElement('code'),
        );
        patternDesc.lastChild!.textContent = '//(.+)//';
        patternDesc.append(' or ');
        const code2 = document.createElement('code');
        code2.textContent = '\\[\\[(.+?)\\]\\]';
        patternDesc.append(code2);

        new Setting(contentEl)
            .setName(t('modals.customPattern.patternLabel'))
            .setDesc(patternDesc)
            .addText(text => {
                this.patternInput = text.inputEl;
                text.setValue(this.pattern?.pattern || '')
                    .setPlaceholder(t('modals.customPattern.patternPlaceholder'))
                    .then(textComponent => {
                        textComponent.inputEl.style.width = '100%';
                        textComponent.inputEl.style.fontFamily = 'monospace';
                    });
            });

        // Type select
        new Setting(contentEl)
            .setName(t('modals.customPattern.typeLabel'))
            .setDesc(t('modals.customPattern.typeDesc'))
            .addDropdown(dropdown => {
                this.typeSelect = dropdown.selectEl;
                dropdown.addOption('highlight', t('modals.customPattern.typeHighlight'))
                    .addOption('comment', t('modals.customPattern.typeComment'))
                    .setValue(this.pattern?.type || 'highlight');
            });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '20px';

        const cancelButton = buttonContainer.createEl('button', { text: t('modals.customPattern.cancel') });
        cancelButton.addEventListener('click', () => this.close());

        const submitButton = buttonContainer.createEl('button', { text: t('modals.customPattern.save'), cls: 'mod-cta' });
        submitButton.addEventListener('click', () => {
            const name = this.nameInput.value.trim();
            const pattern = this.patternInput.value.trim();
            const type = this.typeSelect.value as 'highlight' | 'comment';

            if (!name) {
                new Notice(t('modals.customPattern.nameRequired'));
                return;
            }

            if (!pattern) {
                new Notice(t('modals.customPattern.patternRequired'));
                return;
            }

            // Test if pattern is valid regex
            let regex: RegExp;
            try {
                regex = new RegExp(pattern, 'g');
            } catch (e) {
                new Notice(t('modals.customPattern.invalidRegex') + ': ' + e.message);
                return;
            }

            // Check if pattern has a capturing group
            if (!pattern.includes('(') || !pattern.includes(')')) {
                new Notice(t('modals.customPattern.capturingGroupRequired'));
                return;
            }

            // Warn about potentially conflicting patterns
            const builtInPatterns = [
                { pattern: /==/, name: 'markdown highlights (==)' },
                { pattern: /%%/, name: 'native comments (%%)' },
                { pattern: /<!--/, name: 'HTML comments' }
            ];

            for (const builtIn of builtInPatterns) {
                if (builtIn.pattern.test(pattern)) {
                    new Notice(t('modals.customPattern.conflictWarning', { name: builtIn.name }), 5000);
                }
            }

            // Test pattern for catastrophic backtracking
            // Run pattern against a test string with timeout
            const testString = 'Test text with ==highlights== and %% comments %% and more text to test the pattern.';
            const startTime = Date.now();
            const maxTime = 100; // 100ms timeout

            try {
                let matchCount = 0;
                let match;
                const testRegex = new RegExp(pattern, 'g');

                while ((match = testRegex.exec(testString)) !== null && matchCount < 100) {
                    matchCount++;
                    // Check if we've exceeded time limit
                    if (Date.now() - startTime > maxTime) {
                        new Notice('Pattern is too slow and may cause performance issues. Please simplify your pattern.', 8000);
                        return;
                    }
                    // Prevent infinite loops on zero-length matches
                    if (match.index === testRegex.lastIndex) {
                        testRegex.lastIndex++;
                    }
                }

                if (matchCount >= 100) {
                    new Notice('Pattern matches too frequently and may cause performance issues.', 8000);
                    return;
                }
            } catch (e) {
                new Notice('Pattern test failed: ' + e.message);
                return;
            }

            this.onSubmit({ name, pattern, type });
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class DisplayModeNameModal extends Modal {
    onSubmit: (name: string) => void;
    nameInput: HTMLInputElement;
    currentName: string;

    constructor(app: App, onSubmit: (name: string) => void, currentName: string = '') {
        super(app);
        this.onSubmit = onSubmit;
        this.currentName = currentName;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Set the modal title (appears in upper left corner)
        const titleEl = contentEl.createEl('div', { cls: 'modal-title', text: this.currentName ? t('modals.displayMode.renameTitle') : t('modals.displayMode.createTitle') });
        titleEl.style.marginBottom = '20px';

        new Setting(contentEl)
            .setName(t('modals.displayMode.nameLabel'))
            .setDesc(t('modals.displayMode.nameDesc'))
            .addText(text => {
                this.nameInput = text.inputEl;
                text.setValue(this.currentName)
                    .setPlaceholder(t('modals.displayMode.namePlaceholder'));
                // Focus the name input
                window.setTimeout(() => {
                    text.inputEl.focus();
                    if (this.currentName) {
                        text.inputEl.select();
                    }
                }, 100);
            });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '20px';

        const cancelButton = buttonContainer.createEl('button', { text: t('modals.displayMode.cancel') });
        cancelButton.addEventListener('click', () => this.close());

        const submitButton = buttonContainer.createEl('button', { text: t('modals.displayMode.save'), cls: 'mod-cta' });
        submitButton.addEventListener('click', () => {
            const name = this.nameInput.value.trim();
            if (!name) {
                new Notice(t('modals.displayMode.nameRequired'));
                this.nameInput.focus();
                return;
            }
            this.onSubmit(name);
            this.close();
        });

        // Handle Enter key
        contentEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                submitButton.click();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class HighlightSettingTab extends PluginSettingTab {
    plugin: HighlightCommentsPlugin;

    constructor(app: App, plugin: HighlightCommentsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // DISPLAY SECTION
        new Setting(containerEl).setHeading().setName(t('settings.display.heading'));

        new Setting(containerEl)
            .setName(t('settings.display.showTitles.name'))
            .setDesc(t('settings.display.showTitles.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showFilenames)
                .onChange(async (value) => {
                    this.plugin.settings.showFilenames = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.display.showTimestamps.name'))
            .setDesc(t('settings.display.showTimestamps.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTimestamps)
                .onChange(async (value) => {
                    this.plugin.settings.showTimestamps = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.display.showActions.name'))
            .setDesc(t('settings.display.showActions.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showHighlightActions)
                .onChange(async (value) => {
                    this.plugin.settings.showHighlightActions = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.display.showToolbar.name'))
            .setDesc(t('settings.display.showToolbar.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showToolbar)
                .onChange(async (value) => {
                    this.plugin.settings.showToolbar = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.display.autoUnfold.name'))
            .setDesc(t('settings.display.autoUnfold.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoToggleFold)
                .onChange(async (value) => {
                    this.plugin.settings.autoToggleFold = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.display.dateFormat.name'))
            .setDesc(t('settings.display.dateFormat.desc'))
            .addMomentFormat(format => format
                .setValue(this.plugin.settings.dateFormat)
                .setPlaceholder(t('settings.display.dateFormat.placeholder'))
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.display.minimumCharCount.name'))
            .setDesc(t('settings.display.minimumCharCount.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.display.minimumCharCount.placeholder'))
                .setValue(this.plugin.settings.minimumCharacterCount.toString())
                .onChange(async (value) => {
                    const numValue = parseInt(value) || 0;
                    this.plugin.settings.minimumCharacterCount = Math.max(0, numValue);
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        // VIEWS SECTION
        new Setting(containerEl).setHeading().setName(t('settings.views.heading'));

        new Setting(containerEl)
            .setName(t('settings.views.showCurrentNoteTab.name'))
            .setDesc(t('settings.views.showCurrentNoteTab.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showCurrentNoteTab)
                .onChange(async (value) => {
                    this.plugin.settings.showCurrentNoteTab = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.views.showAllNotesTab.name'))
            .setDesc(t('settings.views.showAllNotesTab.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showAllNotesTab)
                .onChange(async (value) => {
                    this.plugin.settings.showAllNotesTab = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.views.showCollectionsTab.name'))
            .setDesc(t('settings.views.showCollectionsTab.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showCollectionsTab)
                .onChange(async (value) => {
                    this.plugin.settings.showCollectionsTab = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.views.showTasksTab.name'))
            .setDesc(t('settings.views.showTasksTab.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTasksTab)
                .onChange(async (value) => {
                    this.plugin.settings.showTasksTab = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        // DISPLAY MODES SECTION
        new Setting(containerEl).setHeading().setName(t('settings.displayModes.heading'));

        // Save Current Display Settings button
        new Setting(containerEl)
            .setName(t('settings.displayModes.saveCurrentLabel'))
            .setDesc(t('settings.displayModes.saveCurrentDesc'))
            .addButton(button => button
                .setButtonText(t('settings.displayModes.saveButton'))
                .setCta()
                .onClick(() => {
                    const modal = new DisplayModeNameModal(this.app, (name) => {
                        const displayMode = this.plugin.createDisplayModeFromCurrent(name);
                        this.plugin.settings.displayModes.push(displayMode);
                        this.plugin.saveSettings();
                        this.plugin.registerDisplayModeCommands();
                        this.display();  // Refresh settings to show new display mode
                        new Notice(t('notices.displayModeSaved', { name: name }));
                    });
                    modal.open();
                }));

        // List existing display modes
        const displayModesContainer = containerEl.createDiv();
        this.renderDisplayModes(displayModesContainer);

        // TYPOGRAPHY SECTION
        new Setting(containerEl).setHeading().setName(t('settings.typography.heading'));

        new Setting(containerEl)
            .setName(t('settings.typography.highlightTextSize.name'))
            .setDesc(t('settings.typography.highlightTextSize.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.typography.highlightTextSize.placeholder'))
                .setValue(this.plugin.settings.highlightFontSize.toString())
                .onChange(async (value) => {
                    const fontSize = parseInt(value);
                    if (!isNaN(fontSize) && fontSize >= 8 && fontSize <= 32) {
                        this.plugin.settings.highlightFontSize = fontSize;
                        await this.plugin.saveSettings();
                        this.plugin.updateStyles();
                        this.plugin.refreshSidebar();
                    }
                }));

        new Setting(containerEl)
            .setName(t('settings.typography.detailsTextSize.name'))
            .setDesc(t('settings.typography.detailsTextSize.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.typography.detailsTextSize.placeholder'))
                .setValue(this.plugin.settings.detailsFontSize.toString())
                .onChange(async (value) => {
                    const fontSize = parseInt(value);
                    if (!isNaN(fontSize) && fontSize >= 8 && fontSize <= 24) {
                        this.plugin.settings.detailsFontSize = fontSize;
                        await this.plugin.saveSettings();
                        this.plugin.updateStyles();
                        this.plugin.refreshSidebar();
                    }
                }));

        new Setting(containerEl)
            .setName(t('settings.typography.commentTextSize.name'))
            .setDesc(t('settings.typography.commentTextSize.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.typography.commentTextSize.placeholder'))
                .setValue(this.plugin.settings.commentFontSize.toString())
                .onChange(async (value) => {
                    const fontSize = parseInt(value);
                    if (!isNaN(fontSize) && fontSize >= 8 && fontSize <= 24) {
                        this.plugin.settings.commentFontSize = fontSize;
                        await this.plugin.saveSettings();
                        this.plugin.updateStyles();
                        this.plugin.refreshSidebar();
                    }
                }));

        new Setting(containerEl)
            .setName(t('settings.typography.highlightTextWeight.name'))
            .setDesc(t('settings.typography.highlightTextWeight.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('300', t('settings.typography.fontWeight.light'))
                .addOption('400', t('settings.typography.fontWeight.normal'))
                .addOption('500', t('settings.typography.fontWeight.medium'))
                .addOption('600', t('settings.typography.fontWeight.semiBold'))
                .addOption('700', t('settings.typography.fontWeight.bold'))
                .setValue(this.plugin.settings.highlightFontWeight.toString())
                .onChange(async (value) => {
                    this.plugin.settings.highlightFontWeight = parseInt(value);
                    await this.plugin.saveSettings();
                    this.plugin.updateStyles();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.typography.taskTextWeight.name'))
            .setDesc(t('settings.typography.taskTextWeight.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('300', t('settings.typography.fontWeight.light'))
                .addOption('400', t('settings.typography.fontWeight.normal'))
                .addOption('500', t('settings.typography.fontWeight.medium'))
                .addOption('600', t('settings.typography.fontWeight.semiBold'))
                .addOption('700', t('settings.typography.fontWeight.bold'))
                .setValue(this.plugin.settings.taskFontWeight.toString())
                .onChange(async (value) => {
                    this.plugin.settings.taskFontWeight = parseInt(value);
                    await this.plugin.saveSettings();
                    this.plugin.updateStyles();
                    this.plugin.refreshSidebar();
                }));

        // STYLING SECTION
        new Setting(containerEl).setHeading().setName(t('settings.styling.heading'));

        // Colors subsection
        new Setting(containerEl).setName(t('settings.colors.heading')).setHeading();

        let yellowNameSetting: Setting;
        let yellowColorPicker: any; // Store reference to color picker

        const yellowSetting = new Setting(containerEl)
            .setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.yellow.toUpperCase() }))
            .setDesc(t('settings.colors.customizeFirst'))
            .addColorPicker(colorPicker => {
                yellowColorPicker = colorPicker; // Store reference
                return colorPicker
                    .setValue(this.plugin.settings.customColors.yellow)
                    .onChange(async (value) => {
                        this.plugin.settings.customColors.yellow = value;
                        await this.plugin.saveSettings();
                        this.updateColorMappings();
                        yellowSetting.setName(t('settings.colors.highlightColor', { color: value.toUpperCase() }));
                        yellowNameSetting?.setName(t('settings.colorNames.nameFor', { color: value.toUpperCase() }));
                    });
            })
            .addButton(button => button
                .setButtonText(t('settings.colors.reset'))
                .setTooltip(t('settings.colors.resetToYellow'))
                .onClick(async () => {
                    this.plugin.settings.customColors.yellow = '#ffd700';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    yellowSetting.setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.yellow.toUpperCase() }));
                    yellowColorPicker?.setValue('#ffd700'); // Update color picker value
                    yellowNameSetting?.setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.yellow.toUpperCase() }));
                }));

        let redNameSetting: Setting;
        let redColorPicker: any; // Store reference to color picker

        const redSetting = new Setting(containerEl)
            .setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.red.toUpperCase() }))
            .setDesc(t('settings.colors.customizeSecond'))
            .addColorPicker(colorPicker => {
                redColorPicker = colorPicker; // Store reference
                return colorPicker
                    .setValue(this.plugin.settings.customColors.red)
                    .onChange(async (value) => {
                        this.plugin.settings.customColors.red = value;
                        await this.plugin.saveSettings();
                        this.updateColorMappings();
                        redSetting.setName(t('settings.colors.highlightColor', { color: value.toUpperCase() }));
                        redNameSetting?.setName(t('settings.colorNames.nameFor', { color: value.toUpperCase() }));
                    });
            })
            .addButton(button => button
                .setButtonText(t('settings.colors.reset'))
                .setTooltip(t('settings.colors.resetToRed'))
                .onClick(async () => {
                    this.plugin.settings.customColors.red = '#ff6b6b';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    redSetting.setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.red.toUpperCase() }));
                    redColorPicker?.setValue('#ff6b6b'); // Update color picker value
                    redNameSetting?.setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.red.toUpperCase() }));
                }));

        let tealNameSetting: Setting;
        let tealColorPicker: any; // Store reference to color picker

        const tealSetting = new Setting(containerEl)
            .setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.teal.toUpperCase() }))
            .setDesc(t('settings.colors.customizeThird'))
            .addColorPicker(colorPicker => {
                tealColorPicker = colorPicker; // Store reference
                return colorPicker
                    .setValue(this.plugin.settings.customColors.teal)
                    .onChange(async (value) => {
                        this.plugin.settings.customColors.teal = value;
                        await this.plugin.saveSettings();
                        this.updateColorMappings();
                        tealSetting.setName(t('settings.colors.highlightColor', { color: value.toUpperCase() }));
                        tealNameSetting?.setName(t('settings.colorNames.nameFor', { color: value.toUpperCase() }));
                    });
            })
            .addButton(button => button
                .setButtonText(t('settings.colors.reset'))
                .setTooltip(t('settings.colors.resetToTeal'))
                .onClick(async () => {
                    this.plugin.settings.customColors.teal = '#4ecdc4';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    tealSetting.setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.teal.toUpperCase() }));
                    tealColorPicker?.setValue('#4ecdc4'); // Update color picker value
                    tealNameSetting?.setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.teal.toUpperCase() }));
                }));

        let blueNameSetting: Setting;
        let blueColorPicker: any; // Store reference to color picker

        const blueSetting = new Setting(containerEl)
            .setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.blue.toUpperCase() }))
            .setDesc(t('settings.colors.customizeFourth'))
            .addColorPicker(colorPicker => {
                blueColorPicker = colorPicker; // Store reference
                return colorPicker
                    .setValue(this.plugin.settings.customColors.blue)
                    .onChange(async (value) => {
                        this.plugin.settings.customColors.blue = value;
                        await this.plugin.saveSettings();
                        this.updateColorMappings();
                        blueSetting.setName(t('settings.colors.highlightColor', { color: value.toUpperCase() }));
                        blueNameSetting?.setName(t('settings.colorNames.nameFor', { color: value.toUpperCase() }));
                    });
            })
            .addButton(button => button
                .setButtonText(t('settings.colors.reset'))
                .setTooltip(t('settings.colors.resetToBlue'))
                .onClick(async () => {
                    this.plugin.settings.customColors.blue = '#45b7d1';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    blueSetting.setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.blue.toUpperCase() }));
                    blueColorPicker?.setValue('#45b7d1'); // Update color picker value
                    blueNameSetting?.setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.blue.toUpperCase() }));
                }));

        let greenNameSetting: Setting;
        let greenColorPicker: any; // Store reference to color picker

        const greenSetting = new Setting(containerEl)
            .setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.green.toUpperCase() }))
            .setDesc(t('settings.colors.customizeFifth'))
            .addColorPicker(colorPicker => {
                greenColorPicker = colorPicker; // Store reference
                return colorPicker
                    .setValue(this.plugin.settings.customColors.green)
                    .onChange(async (value) => {
                        this.plugin.settings.customColors.green = value;
                        await this.plugin.saveSettings();
                        this.updateColorMappings();
                        greenSetting.setName(t('settings.colors.highlightColor', { color: value.toUpperCase() }));
                        greenNameSetting?.setName(t('settings.colorNames.nameFor', { color: value.toUpperCase() }));
                    });
            })
            .addButton(button => button
                .setButtonText(t('settings.colors.reset'))
                .setTooltip(t('settings.colors.resetToGreen'))
                .onClick(async () => {
                    this.plugin.settings.customColors.green = '#96ceb4';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    greenSetting.setName(t('settings.colors.highlightColor', { color: this.plugin.settings.customColors.green.toUpperCase() }));
                    greenColorPicker?.setValue('#96ceb4'); // Update color picker value
                    greenNameSetting?.setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.green.toUpperCase() }));
                }));

        // Color names subsection
        new Setting(containerEl).setName(t('settings.colorNames.heading')).setHeading();

        yellowNameSetting = new Setting(containerEl)
            .setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.yellow.toUpperCase() }))
            .setDesc(t('settings.colorNames.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.colorNames.placeholder'))
                .setValue(this.plugin.settings.customColorNames.yellow)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.yellow = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        redNameSetting = new Setting(containerEl)
            .setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.red.toUpperCase() }))
            .setDesc(t('settings.colorNames.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.colorNames.placeholder'))
                .setValue(this.plugin.settings.customColorNames.red)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.red = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        tealNameSetting = new Setting(containerEl)
            .setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.teal.toUpperCase() }))
            .setDesc(t('settings.colorNames.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.colorNames.placeholder'))
                .setValue(this.plugin.settings.customColorNames.teal)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.teal = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        blueNameSetting = new Setting(containerEl)
            .setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.blue.toUpperCase() }))
            .setDesc(t('settings.colorNames.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.colorNames.placeholder'))
                .setValue(this.plugin.settings.customColorNames.blue)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.blue = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        greenNameSetting = new Setting(containerEl)
            .setName(t('settings.colorNames.nameFor', { color: this.plugin.settings.customColors.green.toUpperCase() }))
            .setDesc(t('settings.colorNames.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.colorNames.placeholder'))
                .setValue(this.plugin.settings.customColorNames.green)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.green = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        // COMMENTS SECTION
        new Setting(containerEl).setHeading().setName(t('settings.comments.heading'));

        new Setting(containerEl)
            .setName(t('settings.comments.useInlineFootnotes.name'))
            .setDesc(t('settings.comments.useInlineFootnotes.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useInlineFootnotes)
                .onChange(async (value) => {
                    this.plugin.settings.useInlineFootnotes = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.comments.selectTextOnClick.name'))
            .setDesc(t('settings.comments.selectTextOnClick.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.selectTextOnCommentClick)
                .onChange(async (value) => {
                    this.plugin.settings.selectTextOnCommentClick = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('settings.detection.detectHtmlComments.name'))
            .setDesc(t('settings.detection.detectHtmlComments.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.detectHtmlComments)
                .onChange(async (value) => {
                    this.plugin.settings.detectHtmlComments = value;
                    await this.plugin.saveSettings();
                    // Re-scan all files to apply new detection setting
                    this.plugin.scanAllFilesForHighlights();
                }));

        new Setting(containerEl)
            .setName(t('settings.detection.detectAdjacentNativeComments.name'))
            .setDesc(t('settings.detection.detectAdjacentNativeComments.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.detectAdjacentNativeComments)
                .onChange(async (value) => {
                    this.plugin.settings.detectAdjacentNativeComments = value;
                    await this.plugin.saveSettings();
                    // Re-scan all files to apply new detection setting
                    this.plugin.scanAllFilesForHighlights();
                }));

        // CUSTOM PATTERNS SECTION
        // Create heading with experimental badge
        const customPatternsHeadingName = document.createDocumentFragment();
        customPatternsHeadingName.append(t('settings.detection.customPatterns.heading') + ' ');
        const headingBadge = document.createElement('span');
        headingBadge.textContent = t('settings.detection.customPatterns.experimental');
        headingBadge.style.fontSize = '0.8em';
        headingBadge.style.padding = '2px 6px';
        headingBadge.style.borderRadius = '3px';
        headingBadge.style.backgroundColor = 'var(--interactive-accent)';
        headingBadge.style.color = 'var(--text-on-accent)';
        headingBadge.style.fontWeight = '500';
        headingBadge.style.marginLeft = '6px';
        customPatternsHeadingName.appendChild(headingBadge);

        new Setting(containerEl).setHeading().setName(customPatternsHeadingName as any);

        // Custom patterns description
        const customPatternsDesc = document.createDocumentFragment();
        customPatternsDesc.append(
            t('settings.detection.customPatterns.desc'),
            document.createElement('br'),
            t('settings.detection.customPatterns.examples'),
            document.createElement('code'),
        );
        customPatternsDesc.lastChild!.textContent = '//(.+)//';
        customPatternsDesc.append(' ' + t('settings.detection.customPatterns.forRegexMark') + ' ');
        const code2 = document.createElement('code');
        code2.textContent = '\\[\\[(.+?)\\]\\]';
        customPatternsDesc.append(code2);
        customPatternsDesc.append(' ' + t('settings.detection.customPatterns.forWikilinks'));

        const customPatternsSetting = new Setting(containerEl)
            .setDesc(customPatternsDesc);

        // Container for custom pattern list
        const patternsContainer = containerEl.createDiv('custom-patterns-container');

        const renderPatterns = () => {
            patternsContainer.empty();

            this.plugin.settings.customPatterns.forEach((pattern, index) => {
                const patternSetting = new Setting(patternsContainer)
                    .setName(pattern.name || `Pattern ${index + 1}`)
                    .setDesc(`Type: ${pattern.type} | Pattern: ${pattern.pattern}`)
                    .addButton(button => button
                        .setButtonText(t('settings.detection.customPatterns.editButton'))
                        .onClick(() => {
                            new CustomPatternModal(this.app, pattern, async (edited) => {
                                this.plugin.settings.customPatterns[index] = edited;
                                await this.plugin.saveSettings();
                                renderPatterns();
                                this.plugin.scanAllFilesForHighlights();
                            }).open();
                        }))
                    .addButton(button => button
                        .setButtonText(t('settings.detection.customPatterns.deleteButton'))
                        .setWarning()
                        .onClick(async () => {
                            this.plugin.settings.customPatterns.splice(index, 1);
                            await this.plugin.saveSettings();
                            renderPatterns();
                            this.plugin.scanAllFilesForHighlights();
                        }));
            });

            // Add new pattern button
            new Setting(patternsContainer)
                .addButton(button => button
                    .setButtonText(t('settings.detection.customPatterns.addButton'))
                    .setCta()
                    .onClick(() => {
                        new CustomPatternModal(this.app, null, async (newPattern) => {
                            this.plugin.settings.customPatterns.push(newPattern);
                            await this.plugin.saveSettings();
                            renderPatterns();
                            this.plugin.scanAllFilesForHighlights();
                        }).open();
                    }));
        };

        renderPatterns();

        // FILTERS SECTION
        new Setting(containerEl).setHeading().setName(t('settings.filters.heading'));

        new Setting(containerEl)
            .setName(t('settings.filters.excludeExcalidraw.name'))
            .setDesc(t('settings.filters.excludeExcalidraw.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.excludeExcalidraw)
                .onChange(async (value) => {
                    this.plugin.settings.excludeExcalidraw = value;
                    await this.plugin.saveSettings();
                    // Refresh highlights to apply the new exclusion setting
                    this.plugin.scanAllFilesForHighlights();
                }));

        new Setting(containerEl)
            .setName(t('settings.filters.excludedFiles.name'))
            .setDesc(t('settings.filters.excludedFiles.desc'))
            .addButton(button => {
                button.setButtonText(t('settings.filters.excludedFiles.manageButton'))
                    .onClick(() => {
                        const modal = new ExcludedFilesModal(
                            this.app,
                            this.plugin.settings.fileFilters,
                            this.plugin.settings.fileFilterMode,
                            async (fileFilters) => {
                                this.plugin.settings.fileFilters = fileFilters;
                                await this.plugin.saveSettings();
                                // Re-scan all files to apply new exclusions
                                this.plugin.scanAllFilesForHighlights();
                                // Refresh sidebar to update tasks from newly included/excluded files
                                // (invalidates task cache and re-renders)
                                this.plugin.refreshSidebar();
                            }
                        );
                        modal.open();
                    });
            });

        // ========== TASKS TAB SETTINGS ==========

        new Setting(containerEl).setHeading().setName(t('settings.tasks.heading'));

        new Setting(containerEl)
            .setName(t('settings.tasks.showTaskContext.name'))
            .setDesc(t('settings.tasks.showTaskContext.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTaskContext)
                .onChange(async (value) => {
                    this.plugin.settings.showTaskContext = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName(t('settings.tasks.showCompletedTasks.name'))
            .setDesc(t('settings.tasks.showCompletedTasks.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showCompletedTasks)
                .onChange(async (value) => {
                    this.plugin.settings.showCompletedTasks = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        const currentNoteSectionSetting = new Setting(containerEl)
            .setName(t('settings.tasks.showCurrentNoteSection.name'))
            .setDesc(t('settings.tasks.showCurrentNoteSection.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showCurrentNoteTasksSection)
                .onChange(async (value) => {
                    this.plugin.settings.showCurrentNoteTasksSection = value;
                    await this.plugin.saveSettings();
                    // Update the disabled state and opacity of the "only current note" setting
                    onlyCurrentNoteTasksSetting.setDisabled(!value);
                    onlyCurrentNoteTasksSetting.settingEl.style.opacity = value ? '1' : '0.5';
                    // If disabling current note section, also disable "only current note"
                    if (!value && this.plugin.settings.showOnlyCurrentNoteTasks) {
                        this.plugin.settings.showOnlyCurrentNoteTasks = false;
                        await this.plugin.saveSettings();
                    }
                    this.plugin.refreshSidebar();
                }));

        const onlyCurrentNoteTasksSetting = new Setting(containerEl)
            .setName(t('settings.tasks.showOnlyCurrentNoteTasks.name'))
            .setDesc(t('settings.tasks.showOnlyCurrentNoteTasks.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showOnlyCurrentNoteTasks)
                .setDisabled(!this.plugin.settings.showCurrentNoteTasksSection)
                .onChange(async (value) => {
                    this.plugin.settings.showOnlyCurrentNoteTasks = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        // Set initial opacity based on disabled state
        onlyCurrentNoteTasksSetting.settingEl.style.opacity = this.plugin.settings.showCurrentNoteTasksSection ? '1' : '0.5';

        new Setting(containerEl)
            .setName(t('settings.tasks.taskDateFormat.name'))
            .setDesc(t('settings.tasks.taskDateFormat.desc'))
            .addText(text => text
                .setPlaceholder(t('settings.tasks.taskDateFormat.placeholder'))
                .setValue(this.plugin.settings.taskDateFormat)
                .onChange(async (value) => {
                    this.plugin.settings.taskDateFormat = value || 'YYYY-MM-DD';
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        // BACKUP & RESTORE SECTION
        new Setting(containerEl).setHeading().setName(t('settings.backupRestore.heading'));

        // Restore from backup setting with two buttons
        const restoreSetting = new Setting(containerEl)
            .setName(t('settings.backupRestore.restoreLatest.name'))
            .setDesc(t('settings.backupRestore.restoreLatest.desc'));

        // Helper function to restore from backup
        const performRestore = async (backupPath: string, collectionsCount: number, highlightsCount: number) => {
            const result = await this.plugin.restoreFromBackup(backupPath);
            if (result.success) {
                const recoveredCount = result.recoveredCount || 0;
                const orphanedCount = result.orphanedCount || 0;

                let message = t('settings.backupRestore.restoreSuccess', {
                    collections: collectionsCount.toString(),
                    highlights: recoveredCount.toString()
                });

                if (orphanedCount > 0) {
                    message += ` ${t('settings.backupRestore.orphanedCleaned', {
                        count: orphanedCount.toString()
                    })}`;
                }
                new Notice(message);
                // Refresh settings display to show restored data
                this.display();
            } else {
                new Notice(t('settings.backupRestore.restoreFailed'));
            }
        };

        // "Restore latest" button (CTA)
        restoreSetting.addButton(button => button
            .setButtonText(t('settings.backupRestore.restoreLatest.button'))
            .setCta()
            .onClick(async () => {
                const backups = await this.plugin.listBackups();
                if (backups.length === 0) {
                    new Notice(t('settings.backupRestore.noBackups'));
                    return;
                }

                const latestBackup = backups[0];
                const collectionsCount = Object.keys(latestBackup.data.collections || {}).length;
                const highlightsCount = this.plugin.countHighlightsInCollections(latestBackup.data.collections || {});

                if (collectionsCount === 0 && highlightsCount === 0) {
                    new Notice(t('settings.backupRestore.emptyBackup'));
                    return;
                }

                // Show confirmation with backup info
                const date = latestBackup.data.backupCreatedAt
                    ? new Date(latestBackup.data.backupCreatedAt).toLocaleString()
                    : t('settings.backupRestore.unknownDate');

                const message = t('settings.backupRestore.confirmRestore', {
                    collections: collectionsCount.toString(),
                    highlights: highlightsCount.toString(),
                    date
                });

                // Create a simple confirmation modal
                const modal = new Modal(this.app);
                modal.titleEl.setText(t('settings.backupRestore.confirmTitle'));
                modal.contentEl.createEl('p', { text: message });

                const buttonContainer = modal.contentEl.createDiv({ cls: 'modal-button-container' });
                buttonContainer.style.marginTop = '20px';
                buttonContainer.style.display = 'flex';
                buttonContainer.style.justifyContent = 'flex-end';
                buttonContainer.style.gap = '10px';

                const cancelBtn = buttonContainer.createEl('button', { text: t('settings.backupRestore.cancel') });
                cancelBtn.addEventListener('click', () => modal.close());

                const restoreBtn = buttonContainer.createEl('button', {
                    text: t('settings.backupRestore.restore'),
                    cls: 'mod-cta'
                });
                restoreBtn.addEventListener('click', async () => {
                    modal.close();
                    await performRestore(latestBackup.path, collectionsCount, highlightsCount);
                });

                modal.open();
            }));

        // "Choose" button
        restoreSetting.addButton(button => button
            .setButtonText(t('settings.backupRestore.choose.button'))
            .onClick(async () => {
                const backups = await this.plugin.listBackups();
                if (backups.length === 0) {
                    new Notice(t('settings.backupRestore.noBackups'));
                    return;
                }

                const modal = new BackupSelectorModal(
                    this.app,
                    backups,
                    this.plugin.countHighlightsInCollections.bind(this.plugin),
                    async (backupPath: string, collectionsCount: number, highlightsCount: number) => {
                        // Show confirmation before restoring
                        const backupToRestore = backups.find(b => b.path === backupPath);
                        if (!backupToRestore) return;

                        const date = backupToRestore.data.backupCreatedAt
                            ? new Date(backupToRestore.data.backupCreatedAt).toLocaleString()
                            : t('settings.backupRestore.unknownDate');

                        const message = t('settings.backupRestore.confirmRestore', {
                            collections: collectionsCount.toString(),
                            highlights: highlightsCount.toString(),
                            date
                        });

                        // Create confirmation modal
                        const confirmModal = new Modal(this.app);
                        confirmModal.titleEl.setText(t('settings.backupRestore.confirmTitle'));
                        confirmModal.contentEl.createEl('p', { text: message });

                        const buttonContainer = confirmModal.contentEl.createDiv({ cls: 'modal-button-container' });
                        buttonContainer.style.marginTop = '20px';
                        buttonContainer.style.display = 'flex';
                        buttonContainer.style.justifyContent = 'flex-end';
                        buttonContainer.style.gap = '10px';

                        const cancelBtn = buttonContainer.createEl('button', { text: t('settings.backupRestore.cancel') });
                        cancelBtn.addEventListener('click', () => confirmModal.close());

                        const restoreBtn = buttonContainer.createEl('button', {
                            text: t('settings.backupRestore.restore'),
                            cls: 'mod-cta'
                        });
                        restoreBtn.addEventListener('click', async () => {
                            confirmModal.close();
                            await performRestore(backupPath, collectionsCount, highlightsCount);
                        });

                        confirmModal.open();
                    }
                );

                modal.open();
            }));

        new Setting(containerEl)
            .setName(t('settings.backupRestore.createManual.name'))
            .setDesc(t('settings.backupRestore.createManual.desc'))
            .addButton(button => button
                .setButtonText(t('settings.backupRestore.createManual.button'))
                .onClick(async () => {
                    await this.plugin.createBackup('manual');
                    new Notice(t('settings.backupRestore.manualBackupCreated'));
                }));

        new Setting(containerEl)
            .setName('Activity log')
            .setDesc('Copy recent restore activity for debugging.')
            .addButton(button => button
                .setButtonText('Copy')
                .onClick(async () => {
                    const log = await this.plugin.getRestoreLog();
                    if (!log) {
                        new Notice('No restore log found. Perform a backup restoration first.');
                        return;
                    }
                    await navigator.clipboard.writeText(log);
                    new Notice('Restore log copied to clipboard!');
                }));
    }

    private renderDisplayModes(container: HTMLElement) {
        container.empty();

        if (this.plugin.settings.displayModes.length === 0) {
            container.createEl('p', {
                text: t('settings.displayModes.noModes'),
                cls: 'setting-item-description'
            });
            return;
        }

        this.plugin.settings.displayModes.forEach((mode, index) => {
            const isActive = this.plugin.settings.currentDisplayModeId === mode.id;

            new Setting(container)
                .setName(mode.name)
                .addButton(button => {
                    button.setButtonText(isActive ? t('settings.displayModes.appliedButton') : t('settings.displayModes.applyButton'))
                        .onClick(async () => {
                            await this.plugin.applyDisplayMode(mode);
                            new Notice(t('notices.displayModeApplied', { name: mode.name }));
                            this.display(); // Refresh settings to update toggles and button states
                        });

                    // Add active class to button if this is the current mode
                    if (isActive) {
                        button.buttonEl.addClass('mod-cta');
                    }

                    return button;
                })
                .addButton(button => button
                    .setButtonText(t('settings.displayModes.updateButton'))
                    .setTooltip(t('settings.displayModes.updateTooltip'))
                    .onClick(async () => {
                        await this.plugin.updateDisplayMode(mode);
                        new Notice(t('notices.displayModeUpdated', { name: mode.name }));
                        this.display(); // Refresh settings
                    }))
                .addButton(button => button
                    .setButtonText(t('settings.displayModes.renameButton'))
                    .onClick(() => {
                        const modal = new DisplayModeNameModal(this.app, (newName) => {
                            mode.name = newName;
                            this.plugin.saveSettings();
                            this.plugin.registerDisplayModeCommands();
                            this.renderDisplayModes(container);
                            new Notice(t('notices.displayModeRenamed', { name: newName }));
                        }, mode.name);
                        modal.open();
                    }))
                .addButton(button => button
                    .setButtonText(t('settings.displayModes.deleteButton'))
                    .setWarning()
                    .onClick(() => {
                        this.plugin.settings.displayModes.splice(index, 1);
                        // Clear current mode if we're deleting it
                        if (this.plugin.settings.currentDisplayModeId === mode.id) {
                            this.plugin.settings.currentDisplayModeId = null;
                        }
                        this.plugin.saveSettings();
                        this.plugin.registerDisplayModeCommands();
                        this.renderDisplayModes(container);
                        new Notice(t('notices.displayModeDeleted', { name: mode.name }));
                    }));
        });
    }

    private updateColorMappings(): void {
        // Refresh the sidebar to apply new colors
        this.plugin.refreshSidebar();
        // Update theme classes if needed
        this.plugin.updateStyles();
    }
}

class CollectionsManager {
    private plugin: HighlightCommentsPlugin;

    constructor(plugin: HighlightCommentsPlugin) {
        this.plugin = plugin;
    }

    createCollection(name: string, description?: string): Collection {
        const collection: Collection = {
            id: this.plugin.generateId(),
            name,
            description,
            highlightIds: [],
            createdAt: Date.now()
        };
        
        this.plugin.collections.set(collection.id, collection);
        this.plugin.saveSettings();
        
        // Update dynamic commands after creating collection
        this.plugin.registerCollectionCommands();
        
        return collection;
    }

    deleteCollection(collectionId: string) {
        // Remove the command for this collection
        const goToId = `go-to-collection-${collectionId}`;
        if (this.plugin.collectionCommands.has(goToId)) {
            this.plugin.removeCommand(goToId);
            this.plugin.collectionCommands.delete(goToId);
        }
        
        this.plugin.collections.delete(collectionId);
        this.plugin.saveSettings();
    }

    async deleteCollectionWithConfirmation(collectionId: string): Promise<boolean> {
        const collection = this.plugin.collections.get(collectionId);
        if (!collection) return false;

        const confirmed = confirm(`Are you sure you want to delete "${collection.name}"?`);
        if (confirmed) {
            this.deleteCollection(collectionId);
            return true;
        }
        return false;
    }

    addHighlightToCollection(collectionId: string, highlightId: string) {
        const collection = this.plugin.collections.get(collectionId);
        if (collection && !collection.highlightIds.includes(highlightId)) {
            collection.highlightIds.push(highlightId);
            this.plugin.saveSettings();
        }
    }

    removeHighlightFromCollection(collectionId: string, highlightId: string) {
        const collection = this.plugin.collections.get(collectionId);
        if (collection) {
            collection.highlightIds = collection.highlightIds.filter(id => id !== highlightId);
            this.plugin.saveSettings();
        }
    }

    getAllCollections(): Collection[] {
        return Array.from(this.plugin.collections.values());
    }

    getCollection(collectionId: string): Collection | undefined {
        return this.plugin.collections.get(collectionId);
    }

    getCollectionStats(collectionId: string): { highlightCount: number; fileCount: number; nativeCommentsCount: number } {
        const collection = this.plugin.collections.get(collectionId);
        if (!collection) return { highlightCount: 0, fileCount: 0, nativeCommentsCount: 0 };

        const uniqueFiles = new Set<string>();
        let highlightCount = 0;
        let nativeCommentsCount = 0;

        for (const highlightId of collection.highlightIds) {
            // Find the highlight across all files
            for (const [filePath, highlights] of this.plugin.highlights) {
                const highlight = highlights.find(h => h.id === highlightId);
                if (highlight) {
                    uniqueFiles.add(filePath);
                    if (highlight.isNativeComment) {
                        nativeCommentsCount++;
                    } else {
                        highlightCount++;
                    }
                    break; // Found the highlight, no need to check other files
                }
            }
        }

        return {
            highlightCount,
            fileCount: uniqueFiles.size,
            nativeCommentsCount
        };
    }

    getHighlightsInCollection(collectionId: string): Highlight[] {
        const collection = this.plugin.collections.get(collectionId);
        if (!collection) return [];

        const highlights: Highlight[] = [];
        for (const highlightId of collection.highlightIds) {
            // Find the highlight across all files
            for (const [filePath, fileHighlights] of this.plugin.highlights) {
                const highlight = fileHighlights.find(h => h.id === highlightId);
                if (highlight) {
                    highlights.push(highlight);
                    break; // Found the highlight, no need to check other files
                }
            }
        }

        return highlights;
    }

    getHighlightCollectionCount(highlightId: string): number {
        let collectionCount = 0;
        for (const collection of this.plugin.collections.values()) {
            if (collection.highlightIds.includes(highlightId)) {
                collectionCount++;
            }
        }
        return collectionCount;
    }

    getCollectionsForHighlight(highlightId: string): Collection[] {
        const collections: Collection[] = [];
        for (const collection of this.plugin.collections.values()) {
            if (collection.highlightIds.includes(highlightId)) {
                collections.push(collection);
            }
        }
        return collections;
    }
}

export { CollectionsManager };