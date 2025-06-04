// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile, WorkspaceLeaf, ItemView, Menu, debounce, setIcon } from 'obsidian';
import { HighlightsSidebarView } from './src/views/sidebar-view';

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
}

export interface Collection {
    id: string;
    name: string;
    description?: string; // Add optional description field
    highlightIds: string[];
    createdAt: number;
}

interface CommentPluginSettings {
    highlightColor: string;
    sidebarPosition: 'left' | 'right';
    autoOpenSidebar: boolean;
    highlights: { [filePath: string]: Highlight[] };
    collections: { [id: string]: Collection }; // Add collections to settings
    groupingMode: 'none' | 'color' | 'comments-asc' | 'comments-desc' | 'tag' | 'parent' | 'collection' | 'filename' | 'date-created-asc' | 'date-created-desc'; // Add grouping mode persistence
}

const DEFAULT_SETTINGS: CommentPluginSettings = {
    highlightColor: '#ffd700',
    sidebarPosition: 'right',
    autoOpenSidebar: true,
    highlights: {},
    collections: {}, // Initialize empty collections
    groupingMode: 'none' // Default grouping mode
}

const VIEW_TYPE_HIGHLIGHTS = 'highlights-sidebar';

export default class HighlightCommentsPlugin extends Plugin {
    settings: CommentPluginSettings;
    highlights: Map<string, Highlight[]> = new Map();
    collections: Map<string, Collection> = new Map();
    collectionsManager: CollectionsManager;
    private sidebarView: HighlightsSidebarView | null = null;
    private detectHighlightsTimeout: NodeJS.Timeout | null = null;
    public selectedHighlightId: string | null = null;
    private collectionCommands: Set<string> = new Set(); // Track registered collection commands
    public deletedCollectionNames: Map<string, string> = new Map(); // Track names of deleted collections

    async onload() {
        await this.loadSettings();
        
        this.highlights = new Map(Object.entries(this.settings.highlights || {}));
        this.collections = new Map(Object.entries(this.settings.collections || {}));
        this.collectionsManager = new CollectionsManager(this);
        
        this.registerView(
            VIEW_TYPE_HIGHLIGHTS,
            (leaf) => {
                this.sidebarView = new HighlightsSidebarView(leaf, this);
                return this.sidebarView;
            }
        );

        this.addRibbonIcon('highlighter', 'Open Highlights', () => {
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
                    this.highlights.clear();
                    this.selectedHighlightId = null;
                    this.refreshSidebar();
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

        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.handleFileCreate(file);
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.handleFileRename(file, oldPath);
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.handleFileDelete(file);
                }
            })
        );

        this.addSettingTab(new HighlightSettingTab(this.app, this));
        this.addStyles();

        // Register collection commands
        this.registerCollectionCommands();

        // Scan all files for highlights after workspace is ready
        this.app.workspace.onLayoutReady(() => {
            this.scanAllFilesForHighlights();
            
            if (this.settings.autoOpenSidebar) {
                this.activateView();
            }
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
        console.log('Highlight Comments plugin unloaded');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
        
        // Set CSS custom property for highlight color
        document.documentElement.style.setProperty('--highlight-color', this.settings.highlightColor);
        
        document.head.appendChild(style);
    }

    updateStyles() {
        // Update CSS custom property when settings change
        document.documentElement.style.setProperty('--highlight-color', this.settings.highlightColor);
    }

    removeStyles() {
        const style = document.getElementById('highlight-comments-plugin-styles');
        if (style) {
            style.remove();
        }
        // Clean up CSS custom property
        document.documentElement.style.removeProperty('--highlight-color');
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

        if (this.settings.autoOpenSidebar) {
            const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HIGHLIGHTS);
            if (leaves.length === 0) { // Only activate if not already open/visible
                this.activateView();
            }
        }
    }

    refreshSidebar() {
        if (this.sidebarView) {
            this.sidebarView.refresh();
        }
    }

    // Register dynamic commands for collections
    public registerCollectionCommands() {
        // Register commands for all existing collections
        for (const collection of this.collections.values()) {
            const commandId = `go-to-collection-${collection.id}`;
            
            // Always register/re-register to update the name if it changed
            this.addCommand({
                id: commandId,
                name: `Go to ${collection.name}`,
                callback: () => {
                    this.goToCollection(collection.id);
                }
            });
            
            this.collectionCommands.add(commandId);
        }
    }

    // Update commands for deleted collections to show "(deleted)" in the name
    public updateDeletedCollectionCommands() {
        // Get all currently existing collection IDs
        const existingCollectionIds = new Set(Array.from(this.collections.keys()));
        
        // Find commands for collections that no longer exist
        const deletedCommands = Array.from(this.collectionCommands).filter(commandId => {
            const collectionId = commandId.replace('go-to-collection-', '');
            return !existingCollectionIds.has(collectionId);
        });

        // Re-register deleted collection commands with updated names
        for (const commandId of deletedCommands) {
            const collectionId = commandId.replace('go-to-collection-', '');
            const deletedCollectionName = this.deletedCollectionNames.get(collectionId) || 'Collection';
            
            this.addCommand({
                id: commandId,
                name: `Go to ${deletedCollectionName} (deleted)`,
                callback: () => {
                    new Notice(`Collection "${deletedCollectionName}" has been deleted`);
                }
            });
        }
    }

    // Unregister all collection commands
    private unregisterCollectionCommands() {
        // Note: Obsidian doesn't provide a direct way to unregister commands
        // Commands are automatically cleaned up when the plugin is unloaded
        // We'll track them and they'll be replaced when registerCollectionCommands is called
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
            console.error(`Cannot update highlight ${highlightId}: File path "${determinedFilePath}" invalid or highlight list not found.`);
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
            this.refreshSidebar(); 
        } else {
            console.warn(`Highlight ${highlightId} not found in file ${determinedFilePath} for update.`);
        }
    }

    async loadHighlightsFromFile(file: TFile) {
        const content = await this.app.vault.read(file);
        // Clear any selection from previous file
        this.selectedHighlightId = null;
        // detectAndStoreMarkdownHighlights will call refreshSidebar if changes are detected
        this.detectAndStoreMarkdownHighlights(content, file);
        // Always refresh sidebar when file changes, even if no highlights detected
        this.refreshSidebar();
    }

    debounceDetectMarkdownHighlights(editor: Editor, view: MarkdownView) {
        if (this.detectHighlightsTimeout) {
            clearTimeout(this.detectHighlightsTimeout);
        }
        this.detectHighlightsTimeout = setTimeout(() => {
            this.detectMarkdownHighlights(editor, view);
        }, 1000);
    }

    async detectMarkdownHighlights(editor: Editor, view: MarkdownView) {
        const file = view.file;
        if (!file) return;
        const content = editor.getValue();
        this.detectAndStoreMarkdownHighlights(content, file);
    }

    private async scanAllFilesForHighlights() {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const existingFilePaths = new Set(markdownFiles.map(file => file.path));
        let hasChanges = false;
        
        // First, clean up highlights for files that no longer exist
        for (const filePath of this.highlights.keys()) {
            if (!existingFilePaths.has(filePath)) {
                console.log(`Cleaning up highlights for deleted file: ${filePath}`);
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
                console.log(`Removing orphaned highlight ${highlightId} from collection ${collection.name}`);
                return false; // Remove this highlight ID
            });
            
            if (collection.highlightIds.length !== originalLength) {
                hasChanges = true;
            }
        }
        
        // Now scan existing files for highlights
        for (const file of markdownFiles) {
            try {
                const content = await this.app.vault.read(file);
                const oldHighlights = this.highlights.get(file.path) || [];
                this.detectAndStoreMarkdownHighlights(content, file, false); // Don't refresh sidebar for each file
                const newHighlights = this.highlights.get(file.path) || [];
                
                // Check if any highlights were found or changed (more thorough than just count)
                const oldHighlightsJSON = JSON.stringify(oldHighlights.map(h => ({id: h.id, text: h.text, start: h.startOffset, end: h.endOffset, footnotes: h.footnoteCount})));
                const newHighlightsJSON = JSON.stringify(newHighlights.map(h => ({id: h.id, text: h.text, start: h.startOffset, end: h.endOffset, footnotes: h.footnoteCount})));
                
                if (oldHighlightsJSON !== newHighlightsJSON) {
                    hasChanges = true;
                    if (newHighlights.length > oldHighlights.length) {
                        console.log(`Found ${newHighlights.length - oldHighlights.length} new highlights in ${file.path}`);
                    }
                }
            } catch (error) {
                console.warn(`Failed to scan file ${file.path} for highlights:`, error);
            }
        }
        
        // Save settings and refresh sidebar only once after scanning all files
        if (hasChanges) {
            console.log('Highlights changed during scan, saving settings and refreshing sidebar');
            await this.saveSettings();
            this.refreshSidebar();
        }
    }

    detectAndStoreMarkdownHighlights(content: string, file: TFile, shouldRefresh: boolean = true) {
        const markdownHighlightRegex = /==(.*?)==/g;
        const newHighlights: Highlight[] = [];
        let match;
        const existingHighlightsForFile = this.highlights.get(file.path) || [];
        const existingByTextAndOrder = new Map<string, {highlights: Highlight[], count: number}>();
        
        existingHighlightsForFile.forEach(h => {
            if (!existingByTextAndOrder.has(h.text)) {
                existingByTextAndOrder.set(h.text, {highlights: [], count: 0});
            }
            existingByTextAndOrder.get(h.text)!.highlights.push(h);
        });

        // Extract all footnotes from the content
        const footnoteMap = this.extractFootnotes(content);

        while ((match = markdownHighlightRegex.exec(content)) !== null) {
            const [, highlightText] = match;
            const entry = existingByTextAndOrder.get(highlightText);
            let existingHighlight: Highlight | undefined = undefined;

            if (entry && entry.count < entry.highlights.length) {
                existingHighlight = entry.highlights[entry.count];
                entry.count++;
            }
            
            // Calculate line number from offset
            const lineNumber = content.substring(0, match.index).split('\n').length - 1;
            
            // Count footnotes immediately after the highlight (no spaces between footnotes)
            const afterHighlight = content.substring(match.index + match[0].length);
            const footnoteMatches = afterHighlight.match(/^(\[\^\w+\])+/);
            
            // Extract footnote contents and filter out empty ones
            let footnoteContents: string[] = [];
            if (footnoteMatches) {
                const footnoteRefs = footnoteMatches[0].match(/\[\^(\w+)\]/g) || [];
                footnoteRefs.forEach(ref => {
                    const key = ref.slice(2, -1); // Remove [^ and ]
                    if (footnoteMap.has(key)) {
                        const fnContent = footnoteMap.get(key)!.trim();
                        if (fnContent) { // Only add non-empty content
                            footnoteContents.push(fnContent);
                        }
                    }
                });
            }
            const footnoteCount = footnoteContents.length; // Count only non-empty footnotes
            
            if (existingHighlight) {
                newHighlights.push({
                    ...existingHighlight,
                    line: lineNumber,
                    startOffset: match.index,
                    endOffset: match.index + match[0].length,
                    filePath: file.path, // ensure filePath is current
                    footnoteCount: footnoteCount,
                    footnoteContents: footnoteContents
                });
            } else {
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
                    createdAt: Date.now()
                });
            }
        }

        // Check for actual changes before updating and refreshing
        const oldHighlightsJSON = JSON.stringify(existingHighlightsForFile.map(h => ({id: h.id, start: h.startOffset, end: h.endOffset, text: h.text, footnotes: h.footnoteCount, contents: h.footnoteContents?.filter(c => c.trim() !== ''), color: h.color})));
        const newHighlightsJSON = JSON.stringify(newHighlights.map(h => ({id: h.id, start: h.startOffset, end: h.endOffset, text: h.text, footnotes: h.footnoteCount, contents: h.footnoteContents?.filter(c => c.trim() !== ''), color: h.color})));

        if (oldHighlightsJSON !== newHighlightsJSON) {
            this.highlights.set(file.path, newHighlights);
            if (shouldRefresh) {
                this.saveSettings(); // Save to disk after detecting changes
                this.refreshSidebar();
            }
        }
    }


    private extractFootnotes(content: string): Map<string, string> {
        const footnoteMap = new Map<string, string>();
        const footnoteRegex = /^\[\^(\w+)\]:\s*(.+)$/gm;
        let match;
        
        while ((match = footnoteRegex.exec(content)) !== null) {
            const [, key, content] = match;
            footnoteMap.set(key, content.trim());
        }
        
        return footnoteMap;
    }

    private async handleFileCreate(file: TFile) {
        console.log(`New file created: ${file.path}`);
        
        try {
            // Read the content of the newly created file
            const content = await this.app.vault.read(file);
            
            // Scan for existing highlights in the new file
            this.detectAndStoreMarkdownHighlights(content, file, false); // Don't refresh sidebar for each scan
            
            // Get the highlights found
            const highlights = this.highlights.get(file.path);
            if (highlights && highlights.length > 0) {
                console.log(`Found ${highlights.length} existing highlights in newly created file: ${file.path}`);
                
                // Save settings and refresh sidebar since we found highlights
                await this.saveSettings();
                this.refreshSidebar();
            }
        } catch (error) {
            console.warn(`Failed to scan newly created file ${file.path} for highlights:`, error);
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
        console.log(`File deleted: ${file.path}`);
        
        // Remove highlights for the deleted file
        if (this.highlights.has(file.path)) {
            console.log(`Removing ${this.highlights.get(file.path)?.length || 0} highlights for deleted file: ${file.path}`);
            
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
                    console.log(`Removed ${originalLength - collection.highlightIds.length} highlights from collection: ${collection.name}`);
                    collectionsModified = true;
                }
            }
            
            this.saveSettings();
            this.refreshSidebar();
            
            if (collectionsModified) {
                console.log('Collections were modified due to file deletion');
            }
        } else {
            console.log(`No highlights found for deleted file: ${file.path}`);
        }
    }

    getCurrentFileHighlights(): Highlight[] {
        const file = this.app.workspace.getActiveFile();
        return file ? this.highlights.get(file.path) || [] : [];
    }

    generateId(): string {
        return Math.random().toString(36).substr(2, 9);
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
        containerEl.createEl('h2', { text: 'Highlights Sidebar' });

        containerEl.createEl('p', { 
            text: 'This plugin has no options to configure.',
            attr: { style: 'color: var(--text-muted); margin-top: 16px;' }
        });
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
        // Store the collection name before deleting it
        const collection = this.plugin.collections.get(collectionId);
        if (collection) {
            this.plugin.deletedCollectionNames.set(collectionId, collection.name);
        }
        
        this.plugin.collections.delete(collectionId);
        this.plugin.saveSettings();
        
        // Update dynamic commands to mark deleted collections
        this.plugin.updateDeletedCollectionCommands();
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

    getCollectionStats(collectionId: string): { highlightCount: number; fileCount: number } {
        const collection = this.plugin.collections.get(collectionId);
        if (!collection) return { highlightCount: 0, fileCount: 0 };

        const uniqueFiles = new Set<string>();
        let highlightCount = 0;

        for (const highlightId of collection.highlightIds) {
            // Find the highlight across all files
            for (const [filePath, highlights] of this.plugin.highlights) {
                const highlight = highlights.find(h => h.id === highlightId);
                if (highlight) {
                    uniqueFiles.add(filePath);
                    highlightCount++;
                    break; // Found the highlight, no need to check other files
                }
            }
        }

        return {
            highlightCount,
            fileCount: uniqueFiles.size
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
}

export { CollectionsManager };