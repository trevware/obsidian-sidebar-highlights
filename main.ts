// main.ts
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile, WorkspaceLeaf, ItemView, Menu, debounce, setIcon } from 'obsidian';
import { HighlightsSidebarView } from './src/views/sidebar-view';
import { InlineFootnoteManager } from './src/managers/inline-footnote-manager';

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

interface CommentPluginSettings {
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
}

const DEFAULT_SETTINGS: CommentPluginSettings = {
    highlightColor: '#ffd700',
    sidebarPosition: 'right',
    highlights: {},
    collections: {}, // Initialize empty collections
    groupingMode: 'none', // Default grouping mode
    showFilenames: true, // Show filenames by default
    showTimestamps: true, // Show timestamps by default
    showHighlightActions: true, // Show highlight actions by default
    showToolbar: true, // Show toolbar by default
    useInlineFootnotes: false // Use standard footnotes by default
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
        this.app.workspace.onLayoutReady(async () => {
            // Fix any duplicate timestamps from previous versions
            await this.fixDuplicateTimestamps();
            
            this.scanAllFilesForHighlights();
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
        
        // Apply theme color class to body
        this.applyHighlightTheme();
        
        document.head.appendChild(style);
    }

    updateStyles() {
        // Update theme color class when settings change
        this.applyHighlightTheme();
    }

    removeStyles() {
        const style = document.getElementById('highlight-comments-plugin-styles');
        if (style) {
            style.remove();
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
            '#ffd700': 'theme-highlight-yellow',
            '#ff6b6b': 'theme-highlight-red', 
            '#4ecdc4': 'theme-highlight-teal',
            '#45b7d1': 'theme-highlight-blue',
            '#96ceb4': 'theme-highlight-green'
        };
        
        return colorMap[color] || 'theme-highlight-default';
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
            this.refreshSidebar(); 
        }
    }

    async loadHighlightsFromFile(file: TFile) {
        // Clear any selection from previous file
        this.selectedHighlightId = null;
        
        // Skip parsing PDF files
        if (file.extension === 'pdf') {
            // Clear any existing highlights for this file and refresh sidebar
            this.highlights.delete(file.path);
            this.refreshSidebar();
            return;
        }
        
        const content = await this.app.vault.read(file);
        // detectAndStoreMarkdownHighlights will call refreshSidebar if changes are detected
        this.detectAndStoreMarkdownHighlights(content, file);
        // Always refresh sidebar when file changes, even if no highlights detected
        this.refreshSidebar();
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

    private async scanAllFilesForHighlights() {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const existingFilePaths = new Set(markdownFiles.map(file => file.path));
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

    detectAndStoreMarkdownHighlights(content: string, file: TFile, shouldRefresh: boolean = true) {
        const markdownHighlightRegex = /==(.*?)==/g;
        const commentHighlightRegex = /%%(.*?)%%/g;
        const newHighlights: Highlight[] = [];
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

        // Get code block ranges to exclude highlights within them
        const codeBlockRanges = this.getCodeBlockRanges(content);

        // Process both highlight types
        const allMatches: Array<{match: RegExpExecArray, type: 'highlight' | 'comment'}> = [];
        
        // Find all highlight matches
        let match;
        while ((match = markdownHighlightRegex.exec(content)) !== null) {
            // Skip if match is inside a code block
            if (!this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                allMatches.push({match, type: 'highlight'});
            }
        }
        
        // Find all comment matches
        while ((match = commentHighlightRegex.exec(content)) !== null) {
            // Skip if match is inside a code block
            if (!this.isInsideCodeBlock(match.index, match.index + match[0].length, codeBlockRanges)) {
                allMatches.push({match, type: 'comment'});
            }
        }
        
        // Sort matches by position in content
        allMatches.sort((a, b) => a.match.index - b.match.index);

        allMatches.forEach(({match, type}) => {
            const [, highlightText] = match;
            const entry = existingByTextAndOrder.get(highlightText);
            let existingHighlight: Highlight | undefined = undefined;

            if (entry && entry.count < entry.highlights.length) {
                existingHighlight = entry.highlights[entry.count];
                entry.count++;
            }
            
            // Calculate line number from offset
            const lineNumber = content.substring(0, match.index).split('\n').length - 1;
            
            let footnoteContents: string[] = [];
            let footnoteCount = 0;
            
            if (type === 'highlight') {
                // For highlights, extract footnotes in the order they appear in the text
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
                const standardFootnoteRegex = /(\s*\[\^(\w+)\])/g;
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
            } else {
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
                    // Preserve existing createdAt timestamp if it exists
                    createdAt: existingHighlight.createdAt || Date.now()
                });
            } else {
                // For new highlights, create a unique timestamp to avoid duplicates
                // Add a small offset based on the match index to ensure uniqueness
                const uniqueTimestamp = Date.now() + (match.index % 1000);
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
                    isNativeComment: type === 'comment'
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

        containerEl.createEl('h2', { text: 'Comment behaviour' });

        new Setting(containerEl)
            .setName('Use inline footnotes by default')
            .setDesc('When adding comments via the sidebar, use inline footnotes (^[comment]) instead of standard footnotes ([^ref]: comment).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useInlineFootnotes)
                .onChange(async (value) => {
                    this.plugin.settings.useInlineFootnotes = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: 'Display' });

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