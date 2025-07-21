// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import { HighlightsSidebarView } from './src/views/sidebar-view';
import { InlineFootnoteManager } from './src/managers/inline-footnote-manager';
import { ExcludedFilesModal } from './src/modals/excluded-files-modal';

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
}

export interface Collection {
    id: string;
    name: string;
    description?: string; // Add optional description field
    highlightIds: string[];
    createdAt: number;
}

export interface CommentPluginSettings {
    settingsVersion: string; // Track settings schema version for migration
    highlightColor: string;
    sidebarPosition: 'left' | 'right';
    highlights: { [filePath: string]: Highlight[] };
    collections: { [id: string]: Collection }; // Add collections to settings
    groupingMode: 'none' | 'color' | 'comments-asc' | 'comments-desc' | 'tag' | 'parent' | 'collection' | 'filename' | 'date-created-asc' | 'date-created-desc'; // Add grouping mode persistence
    showFilenames: boolean; // Show note titles in All Notes and Collections
    showTimestamps: boolean; // Show note timestamps
    showHighlightActions: boolean; // Show highlight actions area (filename, stats, buttons)
    showToolbar: boolean; // Show/hide the toolbar container
    useInlineFootnotes: boolean; // Use inline footnotes by default when adding comments
    selectTextOnCommentClick: boolean; // Select comment text when clicking comments instead of just positioning
    excludeExcalidraw: boolean; // Exclude .excalidraw files from highlight detection
    excludedFiles: string[]; // Array of file/folder paths to exclude from highlight detection
    dateFormat: string; // Moment.js format string for timestamp display
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
}

const DEFAULT_SETTINGS: CommentPluginSettings = {
    settingsVersion: '1.14.0', // Current settings schema version
    highlightColor: '#ffd700',
    sidebarPosition: 'right',
    highlights: {},
    collections: {}, // Initialize empty collections
    groupingMode: 'none', // Default grouping mode
    showFilenames: true, // Show filenames by default
    showTimestamps: true, // Show timestamps by default
    showHighlightActions: true, // Show highlight actions by default
    showToolbar: true, // Show toolbar by default
    useInlineFootnotes: false, // Use standard footnotes by default
    selectTextOnCommentClick: false, // Position to highlight by default
    excludeExcalidraw: true, // Exclude .excalidraw files by default
    excludedFiles: [], // Empty array by default
    dateFormat: 'YYYY-MM-DD HH:mm', // Default date format
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
    }
}

const VIEW_TYPE_HIGHLIGHTS = 'highlights-sidebar';

export default class HighlightCommentsPlugin extends Plugin {
    settings: CommentPluginSettings;
    highlights: Map<string, Highlight[]> = new Map();
    collections: Map<string, Collection> = new Map();
    collectionsManager: CollectionsManager;
    inlineFootnoteManager: InlineFootnoteManager;
    private sidebarView: HighlightsSidebarView | null = null;
    private detectHighlightsTimeout: number | null = null;
    public selectedHighlightId: string | null = null;
    public collectionCommands: Set<string> = new Set(); // Track registered collection commands

    async onload() {
        await this.loadSettings();
        
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

        this.addRibbonIcon('highlighter', 'Open highlights', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'create-highlight',
            name: 'Create highlight from selection',
            editorCallback: (editor: Editor) => {
                this.createHighlight(editor);
            }
        });

        this.addCommand({
            id: 'open-highlights-sidebar',
            name: 'Toggle',
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
        // Cleanup is mostly automatic due to using registerEvent() and addCommand()
        // But we can explicitly clean up the sidebar view if needed
        
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
            // Normal load - add settingsVersion if missing but preserve all data
            this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
            if (!this.settings.settingsVersion) {
                this.settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
                await this.saveSettings(); // Save the version for future use
            }
        }
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
        
        // Apply theme color class to body
        this.applyHighlightTheme();
        
        // Add dynamic custom color styles
        this.updateCustomColorStyles();
        
        document.head.appendChild(style);
    }

    updateStyles() {
        // Update theme color class when settings change
        this.applyHighlightTheme();
        // Update custom color styles
        this.updateCustomColorStyles();
    }

    removeStyles() {
        const style = document.getElementById('highlight-comments-plugin-styles');
        if (style) {
            style.remove();
        }
        
        // Clean up custom color styles
        const customStyle = document.getElementById('highlight-comments-custom-colors');
        if (customStyle) {
            customStyle.remove();
        }
        
        // Clean up theme classes
        this.removeHighlightTheme();
    }

    private applyHighlightTheme() {
        // Remove any existing theme classes
        this.removeHighlightTheme();
        
        // Apply new theme class
        const themeClass = this.getHighlightThemeClass(this.settings.highlightColor);
        document.body.classList.add(themeClass);
    }

    private removeHighlightTheme() {
        const themeClasses = [
            'theme-highlight-default',
            'theme-highlight-yellow', 
            'theme-highlight-red',
            'theme-highlight-teal',
            'theme-highlight-blue',
            'theme-highlight-green'
        ];
        
        themeClasses.forEach(className => {
            document.body.classList.remove(className);
        });
    }

    private getHighlightThemeClass(color: string): string {
        const colorMap: Record<string, string> = {
            [this.settings.customColors.yellow]: 'theme-highlight-yellow',
            [this.settings.customColors.red]: 'theme-highlight-red', 
            [this.settings.customColors.teal]: 'theme-highlight-teal',
            [this.settings.customColors.blue]: 'theme-highlight-blue',
            [this.settings.customColors.green]: 'theme-highlight-green'
        };
        
        return colorMap[color] || 'theme-highlight-default';
    }

    private updateCustomColorStyles() {
        // Remove existing custom color styles
        const existingCustomStyle = document.getElementById('highlight-comments-custom-colors');
        if (existingCustomStyle) {
            existingCustomStyle.remove();
        }

        // Create new custom color styles
        const customStyle = document.createElement('style');
        customStyle.id = 'highlight-comments-custom-colors';
        
        const css = `
            /* Dynamic hover color options */
            .hover-color-option[data-color="${this.settings.customColors.yellow}"] { background-color: ${this.settings.customColors.yellow} !important; }
            .hover-color-option[data-color="${this.settings.customColors.red}"] { background-color: ${this.settings.customColors.red} !important; }
            .hover-color-option[data-color="${this.settings.customColors.teal}"] { background-color: ${this.settings.customColors.teal} !important; }
            .hover-color-option[data-color="${this.settings.customColors.blue}"] { background-color: ${this.settings.customColors.blue} !important; }
            .hover-color-option[data-color="${this.settings.customColors.green}"] { background-color: ${this.settings.customColors.green} !important; }
            
            /* Dynamic group color squares */
            .group-color-square[data-color="${this.settings.customColors.yellow}"] { background-color: ${this.settings.customColors.yellow} !important; }
            .group-color-square[data-color="${this.settings.customColors.red}"] { background-color: ${this.settings.customColors.red} !important; }
            .group-color-square[data-color="${this.settings.customColors.teal}"] { background-color: ${this.settings.customColors.teal} !important; }
            .group-color-square[data-color="${this.settings.customColors.blue}"] { background-color: ${this.settings.customColors.blue} !important; }
            .group-color-square[data-color="${this.settings.customColors.green}"] { background-color: ${this.settings.customColors.green} !important; }
            
            /* Dynamic highlight theme colors */
            body.theme-highlight-yellow .cm-highlight { background-color: ${this.settings.customColors.yellow}66 !important; }
            body.theme-highlight-red .cm-highlight { background-color: ${this.settings.customColors.red}66 !important; }
            body.theme-highlight-teal .cm-highlight { background-color: ${this.settings.customColors.teal}66 !important; }
            body.theme-highlight-blue .cm-highlight { background-color: ${this.settings.customColors.blue}66 !important; }
            body.theme-highlight-green .cm-highlight { background-color: ${this.settings.customColors.green}66 !important; }
            
            /* Dynamic highlight card border colors */
            .highlight-item-card.highlight-color-yellow { border-left-color: ${this.settings.customColors.yellow} !important; }
            .highlight-item-card.highlight-color-red { border-left-color: ${this.settings.customColors.red} !important; }
            .highlight-item-card.highlight-color-teal { border-left-color: ${this.settings.customColors.teal} !important; }
            .highlight-item-card.highlight-color-blue { border-left-color: ${this.settings.customColors.blue} !important; }
            .highlight-item-card.highlight-color-green { border-left-color: ${this.settings.customColors.green} !important; }
            
            /* Dynamic highlight card selection colors */
            .highlight-item-card.highlight-color-yellow.highlight-selected { box-shadow: 0 0 0 1.5px ${this.settings.customColors.yellow}, var(--shadow-s) !important; }
            .highlight-item-card.highlight-color-red.highlight-selected { box-shadow: 0 0 0 1.5px ${this.settings.customColors.red}, var(--shadow-s) !important; }
            .highlight-item-card.highlight-color-teal.highlight-selected { box-shadow: 0 0 0 1.5px ${this.settings.customColors.teal}, var(--shadow-s) !important; }
            .highlight-item-card.highlight-color-blue.highlight-selected { box-shadow: 0 0 0 1.5px ${this.settings.customColors.blue}, var(--shadow-s) !important; }
            .highlight-item-card.highlight-color-green.highlight-selected { box-shadow: 0 0 0 1.5px ${this.settings.customColors.green}, var(--shadow-s) !important; }
        `;
        
        customStyle.textContent = css;
        document.head.appendChild(customStyle);
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
                backupCreatedAt: Date.now()
            };
            
            const backupPath = `.obsidian/plugins/sidebar-highlights/${filename}`;
            await this.app.vault.adapter.write(
                backupPath,
                JSON.stringify(criticalData, null, 2)
            );
            
            // Only show notice for important backups (not routine ones)
            if (reason === 'migration' || reason === 'manual') {
                new Notice(`Settings backup created: ${filename}`);
            }
        } catch (error) {
            console.error('Failed to create backup:', error);
            new Notice('Warning: Could not create settings backup');
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
                
                console.log('Collection validation results:', {
                    totalBrokenReferences,
                    collectionsWithIssues,
                    message: 'Some highlight references were lost during migration, likely due to file changes. Automatic cleanup completed.'
                });
                
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
                name: `Go to ${collection.name}`,
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
        }, 1000);
    }

    async detectMarkdownHighlights(editor: Editor, view: MarkdownView) {
        const file = view.file;
        if (!file) return;
        const content = editor.getValue();
        this.detectAndStoreMarkdownHighlights(content, file);
    }

    async scanAllFilesForHighlights() {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        // Filter files based on shouldProcessFile logic
        const processableFiles = markdownFiles.filter(file => this.shouldProcessFile(file));
        const existingFilePaths = new Set(processableFiles.map(file => file.path));
        let hasChanges = false;
        
        // First, clean up highlights for files that no longer exist
        for (const filePath of this.highlights.keys()) {
            if (!existingFilePaths.has(filePath)) {
                this.highlights.delete(filePath);
                hasChanges = true;
            }
        }
        
        // Clean up orphaned highlight IDs from collections
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
        
        // Now scan existing files for highlights
        for (const file of processableFiles) {
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
        
        // Save settings and refresh sidebar only once after scanning all files
        if (hasChanges) {
            await this.saveSettings();
            this.refreshSidebar();
        }
    }

    private parseHtmlColor(colorValue: string): string | null {
        // Normalize the color value
        const color = colorValue.trim().toLowerCase();
        
        // Named colors to hex mapping
        const namedColors: { [key: string]: string } = {
            'yellow': '#ffff00',
            'red': '#ff0000',
            'green': '#008000',
            'blue': '#0000ff',
            'orange': '#ffa500',
            'purple': '#800080',
            'pink': '#ffc0cb',
            'cyan': '#00ffff',
            'magenta': '#ff00ff',
            'lime': '#00ff00',
            'brown': '#a52a2a',
            'gray': '#808080',
            'grey': '#808080',
            'black': '#000000',
            'white': '#ffffff'
        };
        
        // Check if it's a named color
        if (namedColors[color]) {
            return namedColors[color];
        }
        
        // Check if it's already a hex color
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
            // Convert 3-digit hex to 6-digit
            if (color.length === 4) {
                return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
            }
            return color;
        }
        
        // Return null for unsupported color formats
        return null;
    }

    detectAndStoreMarkdownHighlights(content: string, file: TFile, shouldRefresh: boolean = true) {
        const markdownHighlightRegex = /==([^=](?:[^=]|=[^=])*?)==/g;
        const commentHighlightRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;
        
        // HTML highlight patterns
        const spanBackgroundRegex = /<span\s+style=["'][^"']*background:\s*([^;"']+)[^"']*["'][^>]*>(.*?)<\/span>/gi;
        const fontColorRegex = /<font\s+color=["']([^"']+)["'][^>]*>(.*?)<\/font>/gi;
        const markTagRegex = /<mark[^>]*>(.*?)<\/mark>/gi;
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

        // Process all highlight types
        const allMatches: Array<{match: RegExpExecArray, type: 'highlight' | 'comment' | 'html', color?: string}> = [];
        
        // Find all highlight matches
        let match;
        while ((match = markdownHighlightRegex.exec(content)) !== null) {
            // Skip if match is inside a code block
            if (!this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                // Skip if this highlight is surrounded by additional equals signs (e.g., =====text===== )
                const beforeMatch = content.charAt(match.index - 1);
                const afterMatch = content.charAt(match.index + match[0].length);
                if (beforeMatch === '=' || afterMatch === '=') {
                    continue;
                }
                allMatches.push({match, type: 'highlight'});
            }
        }
        
        // Find all comment matches
        while ((match = commentHighlightRegex.exec(content)) !== null) {
            // Skip if match is inside a code block
            if (!this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                // Skip if this comment is surrounded by additional percent signs (e.g., %%%%%text%%%%% )
                const beforeMatch = content.charAt(match.index - 1);
                const afterMatch = content.charAt(match.index + match[0].length);
                if (beforeMatch === '%' || afterMatch === '%') {
                    continue;
                }
                allMatches.push({match, type: 'comment'});
            }
        }
        
        // Find HTML span background matches
        while ((match = spanBackgroundRegex.exec(content)) !== null) {
            if (!this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                const color = this.parseHtmlColor(match[1]);
                if (color) {
                    // Create a modified match array with the text content
                    const modifiedMatch: RegExpExecArray = Object.assign([], match);
                    modifiedMatch[1] = match[2]; // Use the text content, not the color
                    allMatches.push({match: modifiedMatch, type: 'html', color});
                }
            }
        }
        
        // Find HTML font color matches
        while ((match = fontColorRegex.exec(content)) !== null) {
            if (!this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                const color = this.parseHtmlColor(match[1]);
                if (color) {
                    // Create a modified match array with the text content
                    const modifiedMatch: RegExpExecArray = Object.assign([], match);
                    modifiedMatch[1] = match[2]; // Use the text content, not the color
                    allMatches.push({match: modifiedMatch, type: 'html', color});
                }
            }
        }
        
        // Find HTML mark tag matches
        while ((match = markTagRegex.exec(content)) !== null) {
            if (!this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                // Create a modified match array with the text content
                const modifiedMatch: RegExpExecArray = Object.assign([], match);
                modifiedMatch[1] = match[1]; // Use the text content
                allMatches.push({match: modifiedMatch, type: 'html', color: '#ffff00'}); // Default yellow for <mark>
            }
        }
        
        // Sort matches by position in content
        allMatches.sort((a, b) => a.match.index - b.match.index);

        allMatches.forEach(({match, type, color}) => {
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
                const standardFootnoteRegex = /(\s*\[\^(\w+)\])(?!:)/g;
                let match_sf;
                let lastValidPosition = 0;
                
                while ((match_sf = standardFootnoteRegex.exec(afterHighlight)) !== null) {
                    // Check if this standard footnote is in a valid position
                    const precedingText = afterHighlight.substring(lastValidPosition, match_sf.index);
                    const isValid = /^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*\s*$/.test(precedingText);
                    
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
                    createdAt: existingHighlight.createdAt || Date.now()
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
                    color: type === 'html' ? color : undefined
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
            // New or deleted highlights require full refresh
            this.refreshSidebar();
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
        const footnoteRegex = /^\[\^(\w+)\]:\s*(.+)$/gm;
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

    private shouldProcessFile(file: TFile): boolean {
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
        if (!this.settings.excludedFiles || this.settings.excludedFiles.length === 0) {
            return false;
        }

        const normalizedFilePath = filePath.replace(/\\/g, '/');
        
        for (const excludedPath of this.settings.excludedFiles) {
            const normalizedExcludedPath = excludedPath.replace(/\\/g, '/');
            
            // Exact file match
            if (normalizedFilePath === normalizedExcludedPath) {
                return true;
            }
            
            // Folder match - check if file is inside excluded folder
            if (normalizedFilePath.startsWith(normalizedExcludedPath + '/')) {
                return true;
            }
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
    private getCodeBlockRanges(content: string): Array<{start: number, end: number}> {
        const ranges: Array<{start: number, end: number}> = [];
        
        // Find fenced code blocks (``` or ~~~ with optional language)
        const fencedCodeRegex = /^(```|~~~).*?\n([\s\S]*?)\n\1\s*$/gm;
        let match;
        while ((match = fencedCodeRegex.exec(content)) !== null) {
            ranges.push({
                start: match.index,
                end: match.index + match[0].length
            });
        }
        
        // Find inline code blocks (`code`)
        const inlineCodeRegex = /`([^`\n]+?)`/g;
        while ((match = inlineCodeRegex.exec(content)) !== null) {
            ranges.push({
                start: match.index,
                end: match.index + match[0].length
            });
        }
        
        return ranges;
    }

    /**
     * Check if a range is inside any of the provided code block ranges
     */
    private isInsideCodeBlock(start: number, end: number, codeBlockRanges: Array<{start: number, end: number}>): boolean {
        return codeBlockRanges.some(range => start >= range.start && end <= range.end);
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
        new Setting(containerEl).setHeading().setName('Display');

        new Setting(containerEl)
            .setName('Show note titles in all notes and collections')
            .setDesc('Display the filename/note title below highlights when viewing All Notes or Collections.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showFilenames)
                .onChange(async (value) => {
                    this.plugin.settings.showFilenames = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName('Show note timestamps')
            .setDesc('Display creation timestamps for highlights.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTimestamps)
                .onChange(async (value) => {
                    this.plugin.settings.showTimestamps = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName('Show highlight actions')
            .setDesc('Display the actions area below each highlight (filename, stats, and buttons).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showHighlightActions)
                .onChange(async (value) => {
                    this.plugin.settings.showHighlightActions = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName('Show toolbar')
            .setDesc('Display the toolbar with search, grouping, and other action buttons.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showToolbar)
                .onChange(async (value) => {
                    this.plugin.settings.showToolbar = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        new Setting(containerEl)
            .setName('Date format')
            .setDesc('Format string for timestamps using moment.js syntax (e.g., YYYY-MM-DD HH:mm, MMM DD YYYY, DD/MM/YYYY h:mm A)')
            .addMomentFormat(format => format
                .setValue(this.plugin.settings.dateFormat)
                .setPlaceholder('YYYY-MM-DD HH:mm')
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        // STYLING SECTION
        new Setting(containerEl).setHeading().setName('Styling');

        const yellowSetting = new Setting(containerEl)
            .setName(`Highlight color: ${this.plugin.settings.customColors.yellow.toUpperCase()}`)
            .setDesc('Customize the first highlight color.')
            .addColorPicker(colorPicker => colorPicker
                .setValue(this.plugin.settings.customColors.yellow)
                .onChange(async (value) => {
                    this.plugin.settings.customColors.yellow = value;
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    yellowSetting.setName(`Highlight color: ${value.toUpperCase()}`);
                }))
            .addButton(button => button
                .setButtonText('Reset')
                .setTooltip('Reset to default yellow (#ffd700)')
                .onClick(async () => {
                    this.plugin.settings.customColors.yellow = '#ffd700';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    yellowSetting.setName(`Highlight color: ${this.plugin.settings.customColors.yellow.toUpperCase()}`);
                    this.display(); // Refresh settings display
                }));

        new Setting(containerEl)
            .setName('Highlight name')
            .setDesc('Optional: Add a custom name for this color to use in Group By Color instead of the hex code.')
            .addText(text => text
                .setPlaceholder('e.g., "Important", "Research"')
                .setValue(this.plugin.settings.customColorNames.yellow)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.yellow = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        const redSetting = new Setting(containerEl)
            .setName(`Highlight color: ${this.plugin.settings.customColors.red.toUpperCase()}`)
            .setDesc('Customize the second highlight color.')
            .addColorPicker(colorPicker => colorPicker
                .setValue(this.plugin.settings.customColors.red)
                .onChange(async (value) => {
                    this.plugin.settings.customColors.red = value;
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    redSetting.setName(`Highlight color: ${value.toUpperCase()}`);
                }))
            .addButton(button => button
                .setButtonText('Reset')
                .setTooltip('Reset to default red (#ff6b6b)')
                .onClick(async () => {
                    this.plugin.settings.customColors.red = '#ff6b6b';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    redSetting.setName(`Highlight color: ${this.plugin.settings.customColors.red.toUpperCase()}`);
                    this.display(); // Refresh settings display
                }));

        new Setting(containerEl)
            .setName('Highlight name')
            .setDesc('Optional: Add a custom name for this color to use in Group By Color instead of the hex code.')
            .addText(text => text
                .setPlaceholder('e.g., "Important", "Research"')
                .setValue(this.plugin.settings.customColorNames.red)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.red = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        const tealSetting = new Setting(containerEl)
            .setName(`Highlight color: ${this.plugin.settings.customColors.teal.toUpperCase()}`)
            .setDesc('Customize the third highlight color.')
            .addColorPicker(colorPicker => colorPicker
                .setValue(this.plugin.settings.customColors.teal)
                .onChange(async (value) => {
                    this.plugin.settings.customColors.teal = value;
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    tealSetting.setName(`Highlight color: ${value.toUpperCase()}`);
                }))
            .addButton(button => button
                .setButtonText('Reset')
                .setTooltip('Reset to default teal (#4ecdc4)')
                .onClick(async () => {
                    this.plugin.settings.customColors.teal = '#4ecdc4';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    tealSetting.setName(`Highlight color: ${this.plugin.settings.customColors.teal.toUpperCase()}`);
                    this.display(); // Refresh settings display
                }));

        new Setting(containerEl)
            .setName('Highlight name')
            .setDesc('Optional: Add a custom name for this color to use in Group By Color instead of the hex code.')
            .addText(text => text
                .setPlaceholder('e.g., "Important", "Research"')
                .setValue(this.plugin.settings.customColorNames.teal)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.teal = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        const blueSetting = new Setting(containerEl)
            .setName(`Highlight color: ${this.plugin.settings.customColors.blue.toUpperCase()}`)
            .setDesc('Customize the fourth highlight color.')
            .addColorPicker(colorPicker => colorPicker
                .setValue(this.plugin.settings.customColors.blue)
                .onChange(async (value) => {
                    this.plugin.settings.customColors.blue = value;
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    blueSetting.setName(`Highlight color: ${value.toUpperCase()}`);
                }))
            .addButton(button => button
                .setButtonText('Reset')
                .setTooltip('Reset to default blue (#45b7d1)')
                .onClick(async () => {
                    this.plugin.settings.customColors.blue = '#45b7d1';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    blueSetting.setName(`Highlight color: ${this.plugin.settings.customColors.blue.toUpperCase()}`);
                    this.display(); // Refresh settings display
                }));

        new Setting(containerEl)
            .setName('Highlight name')
            .setDesc('Optional: Add a custom name for this color to use in Group By Color instead of the hex code.')
            .addText(text => text
                .setPlaceholder('e.g., "Important", "Research"')
                .setValue(this.plugin.settings.customColorNames.blue)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.blue = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        const greenSetting = new Setting(containerEl)
            .setName(`Highlight color: ${this.plugin.settings.customColors.green.toUpperCase()}`)
            .setDesc('Customize the fifth highlight color.')
            .addColorPicker(colorPicker => colorPicker
                .setValue(this.plugin.settings.customColors.green)
                .onChange(async (value) => {
                    this.plugin.settings.customColors.green = value;
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    greenSetting.setName(`Highlight color: ${value.toUpperCase()}`);
                }))
            .addButton(button => button
                .setButtonText('Reset')
                .setTooltip('Reset to default green (#96ceb4)')
                .onClick(async () => {
                    this.plugin.settings.customColors.green = '#96ceb4';
                    await this.plugin.saveSettings();
                    this.updateColorMappings();
                    greenSetting.setName(`Highlight color: ${this.plugin.settings.customColors.green.toUpperCase()}`);
                    this.display(); // Refresh settings display
                }));

        new Setting(containerEl)
            .setName('Highlight name')
            .setDesc('Optional: Add a custom name for this color to use in Group By Color instead of the hex code.')
            .addText(text => text
                .setPlaceholder('e.g., "Important", "Research"')
                .setValue(this.plugin.settings.customColorNames.green)
                .onChange(async (value) => {
                    this.plugin.settings.customColorNames.green = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshSidebar();
                }));

        // COMMENTS SECTION
        new Setting(containerEl).setHeading().setName('Comments');

        new Setting(containerEl)
            .setName('Use inline footnotes by default')
            .setDesc('When adding comments via the sidebar, use inline footnotes (^[comment]) instead of standard footnotes ([^ref]: comment).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useInlineFootnotes)
                .onChange(async (value) => {
                    this.plugin.settings.useInlineFootnotes = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Select text on click')
            .setDesc('When clicking a comment, select the comment instead of positioning the cursor in front of it.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.selectTextOnCommentClick)
                .onChange(async (value) => {
                    this.plugin.settings.selectTextOnCommentClick = value;
                    await this.plugin.saveSettings();
                }));

        // FILTERS SECTION
        new Setting(containerEl).setHeading().setName('Filters');

        new Setting(containerEl)
            .setName('Exclude Excalidraw files')
            .setDesc('Skip .excalidraw files when scanning for highlights. This prevents highlights from being detected in Excalidraw drawing files.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.excludeExcalidraw)
                .onChange(async (value) => {
                    this.plugin.settings.excludeExcalidraw = value;
                    await this.plugin.saveSettings();
                    // Refresh highlights to apply the new exclusion setting
                    this.plugin.scanAllFilesForHighlights();
                }));

        new Setting(containerEl)
            .setName('Excluded files')
            .setDesc('Excluded files or folders will be hidden from Sidebar Highlights')
            .addButton(button => {
                button.setButtonText('Manage')
                    .onClick(() => {
                        const modal = new ExcludedFilesModal(
                            this.app,
                            this.plugin.settings.excludedFiles,
                            async (excludedFiles) => {
                                this.plugin.settings.excludedFiles = excludedFiles;
                                await this.plugin.saveSettings();
                                // Re-scan all files to apply new exclusions
                                this.plugin.scanAllFilesForHighlights();
                            }
                        );
                        modal.open();
                    });
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