import { setIcon, TFile, Menu, Notice, moment } from 'obsidian';
import type { Highlight } from '../../main';
import type HighlightCommentsPlugin from '../../main';

export interface HighlightRenderOptions {
    searchTerm?: string;
    showFilename?: boolean;
    showTimestamp?: boolean;
    showHighlightActions?: boolean;
    isCommentsVisible?: boolean;
    dateFormat?: string;
    onCommentToggle?: (highlightId: string) => void;
    onCollectionsMenu?: (event: MouseEvent, highlight: Highlight) => void;
    onColorChange?: (highlight: Highlight, color: string) => void;
    onHighlightClick?: (highlight: Highlight, event?: MouseEvent) => void;
    onAddComment?: (highlight: Highlight) => void;
    onCommentClick?: (highlight: Highlight, commentIndex: number, event?: MouseEvent) => void;
    onTagClick?: (tag: string) => void;
    onFileNameClick?: (filePath: string, event: MouseEvent) => void;
}

export class HighlightRenderer {
    constructor(private plugin: HighlightCommentsPlugin) {}

    private createFileContextMenu(file: TFile): Menu {
        const menu = new Menu();
        
        // Add only our custom navigation options
        menu.addItem((item) => {
            item.setTitle('Open in new tab')
                .setIcon('lucide-plus')
                .onClick(() => {
                    this.plugin.app.workspace.openLinkText(file.path, '', 'tab');
                });
        });
        
        menu.addItem((item) => {
            item.setTitle('Open to the right')
                .setIcon('lucide-separator-vertical')
                .onClick(() => {
                    this.plugin.app.workspace.openLinkText(file.path, '', 'split');
                });
        });
        
        menu.addSeparator();
        
        return menu;
    }

    createHighlightItem(
        container: HTMLElement, 
        highlight: Highlight, 
        options: HighlightRenderOptions = {}
    ): HTMLElement {
        const item = container.createDiv({
            cls: `highlight-item-card${this.plugin.selectedHighlightId === highlight.id ? ' selected' : ''}`,
            attr: { 'data-highlight-id': highlight.id }
        });

        this.applyHighlightStyling(item, highlight);
        this.createHoverColorPicker(item, highlight, options);
        this.createQuoteSection(item, highlight, options);
        this.createActionsSection(item, highlight, options);
        this.createCommentsSection(item, highlight, options);

        return item;
    }

    private applyHighlightStyling(item: HTMLElement, highlight: Highlight): void {
        if (highlight.isNativeComment) {
            // Native comments get special styling
            item.classList.add('highlight-native-comment');
        } else {
            // Regular highlights get color styling
            const highlightColor = highlight.color || this.plugin.settings.highlightColor;
            const colorClass = this.getColorClassName(highlightColor);
            
            // Apply color class for border styling
            item.classList.add(colorClass);
            
            // For custom colors, use CSS custom property
            if (colorClass === 'highlight-color-default') {
                item.classList.remove('highlight-color-default');
                item.classList.add('highlight-color-custom');
                item.style.setProperty('--highlight-color', highlightColor);
            }
        }
        
        if (this.plugin.selectedHighlightId === highlight.id) {
            item.classList.add('highlight-selected');
        }
    }

    private getColorClassName(color: string): string {
        const colorMap: Record<string, string> = {
            [this.plugin.settings.customColors.yellow]: 'highlight-color-yellow',
            [this.plugin.settings.customColors.red]: 'highlight-color-red', 
            [this.plugin.settings.customColors.teal]: 'highlight-color-teal',
            [this.plugin.settings.customColors.blue]: 'highlight-color-blue',
            [this.plugin.settings.customColors.green]: 'highlight-color-green'
        };
        
        return colorMap[color] || 'highlight-color-default';
    }

    private createQuoteSection(item: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        const quoteEl = item.createDiv({ cls: 'highlight-quote' });
        this.renderMarkdownToElement(quoteEl, highlight.text);

        if (options.searchTerm && options.searchTerm.length > 0) {
            this.highlightSearchMatches(quoteEl, options.searchTerm);
        }

        this.addTagsToQuote(quoteEl, highlight, options);

        quoteEl.addEventListener('click', (event) => {
            options.onHighlightClick?.(highlight, event);
        });


        // Add hover for highlight preview
        quoteEl.addEventListener('mouseover', (event) => {
            this.plugin.app.workspace.trigger('hover-link', {
                event,
                source: 'sidebar-highlights',
                hoverParent: quoteEl,
                targetEl: quoteEl,
                linktext: highlight.filePath,
                state: { scroll: highlight.startOffset }
            });
        });
    }

    private addTagsToQuote(quoteEl: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        const tags = this.extractTagsFromHighlight(highlight);
        if (tags.length > 0) {
            const tagsContainer = quoteEl.createDiv({ cls: 'highlight-tags' });
            tags.forEach(tag => {
                const tagEl = tagsContainer.createEl('span', {
                    cls: 'highlight-tag',
                    text: tag
                });
                tagEl.addEventListener('click', (event) => {
                    event.stopPropagation();
                    options.onTagClick?.(tag);
                });
            });
        }
    }

    private createActionsSection(item: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        // Only create actions section if showHighlightActions is true (default to true if not specified)
        if (options.showHighlightActions === false) return;
        
        // Create actions section
        const actions = item.createDiv({ cls: 'highlight-actions' });
        
        // Create filename section inside actions (below border-top)
        this.addFileNameInfo(actions, highlight, options);
        
        // Create info container for stats and timestamp
        const infoContainer = actions.createDiv({ cls: 'highlight-info-container' });
        this.addStatsInfo(infoContainer, highlight, options);
        
        // Add action buttons
        this.addActionButtons(actions, highlight, options);
    }

    private addFileNameInfo(actions: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        if (options.showFilename) {
            const fileName = highlight.filePath.split('/').pop()?.replace(/\.md$/, '') || highlight.filePath;
            const fileNameEl = actions.createEl('small', {
                cls: 'highlight-filename',
                text: fileName,
                attr: { title: highlight.filePath }
            });
            
            fileNameEl.addEventListener('click', (event) => {
                event.stopPropagation();
                options.onFileNameClick?.(highlight.filePath, event);
            });

            // Add context menu for file operations
            fileNameEl.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const file = this.plugin.app.vault.getAbstractFileByPath(highlight.filePath);
                if (file instanceof TFile) {
                    const menu = this.createFileContextMenu(file);
                    this.plugin.app.workspace.trigger('file-menu', menu, file, 'sidebar-highlights');
                    menu.showAtMouseEvent(event);
                }
            });

            // Add hover for link preview
            fileNameEl.addEventListener('mouseover', (event) => {
                this.plugin.app.workspace.trigger('hover-link', {
                    event,
                    source: 'sidebar-highlights',
                    hoverParent: fileNameEl,
                    targetEl: fileNameEl,
                    linktext: highlight.filePath
                });
            });
        }
    }

    private addStatsInfo(infoContainer: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        const lineNumber = highlight.line >= 0 ? highlight.line + 1 : 'Unknown';
        const infoLineContainer = infoContainer.createDiv({ cls: 'highlight-info-line' });
        
        // Create left section for stats
        const statsSection = infoLineContainer.createDiv({ cls: 'highlight-stats-section' });
        
        // Line number section
        this.createInfoItem(statsSection, 'text', `${lineNumber}`, 'highlight-line-info');

        // Comment count section - don't show comment count for native comments since they ARE the comment
        const validFootnoteCount = highlight.isNativeComment ? 0 : (highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0);
        const commentStatClass = highlight.isNativeComment 
            ? 'highlight-line-info highlight-comment-stat disabled'
            : 'highlight-line-info highlight-comment-stat clickable';
        
        const commentContainer = this.createInfoItem(
            statsSection, 
            'message-square', 
            `${validFootnoteCount}`, 
            commentStatClass
        );

        // Only add click handler for regular highlights, not native comments
        if (!highlight.isNativeComment) {
            commentContainer.addEventListener('click', (event) => {
                event.stopPropagation();
                options.onCommentToggle?.(highlight.id);
            });
        }

        // Collection count section
        const collectionCount = this.plugin.collectionsManager.getHighlightCollectionCount(highlight.id);
        const collectionContainer = this.createInfoItem(
            statsSection,
            'folder-open',
            `${collectionCount}`,
            'highlight-line-info highlight-collection-stat clickable'
        );

        collectionContainer.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onCollectionsMenu?.(event, highlight);
        });

        // Create completely separate timestamp section
        this.addTimestampToInfoLine(infoLineContainer, highlight, options);
    }

    private createInfoItem(container: HTMLElement, iconName: string, text: string, className: string): HTMLElement {
        const itemContainer = container.createDiv({ cls: className });
        
        const icon = itemContainer.createDiv({ cls: iconName === 'message-square' ? 'comment-icon' : 'line-icon' });
        setIcon(icon, iconName);
        
        itemContainer.createSpan({ text });
        
        return itemContainer;
    }

    private addTimestampToInfoLine(infoLineContainer: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        if (options.showTimestamp && highlight.createdAt) {
            const timestamp = moment(highlight.createdAt);
            const timeString = options.dateFormat ? timestamp.format(options.dateFormat) : timestamp.format('YYYY-MM-DD HH:mm');
            
            // Create a separate timestamp container div
            const timestampContainer = infoLineContainer.createDiv({ cls: 'highlight-timestamp-container' });
            const timestampEl = timestampContainer.createDiv({
                cls: 'highlight-timestamp-info',
                text: timeString,
                attr: { title: `Created: ${timeString}` }
            });
        }
    }

    private addActionButtons(actions: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        const buttonContainer = actions.createDiv({ cls: 'comment-buttons' });
    }

    private createCommentsSection(item: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        if (!options.isCommentsVisible) return;

        const commentsContainer = item.createDiv({ cls: 'highlight-comments' });
        
        // For native comments, don't show footnote comments since they don't have footnotes
        // Only show footnote comments for regular highlights
        if (!highlight.isNativeComment) {
            const validFootnoteContents = highlight.footnoteContents?.filter(c => c.trim() !== '') || [];
            if (validFootnoteContents.length > 0) {
                validFootnoteContents.forEach((content, index) => {
                    const commentDiv = commentsContainer.createDiv({ cls: 'highlight-comment' });
                    this.renderMarkdownToElement(commentDiv, content);
                    commentDiv.addEventListener('click', (event) => {
                        event.stopPropagation();
                        options.onCommentClick?.(highlight, index, event);
                    });


                });
            }
        }

        // Add "Add Comment" line for all highlights (regular and native comments)
        // For native comments, it will be disabled/greyed out
        this.createAddCommentLine(commentsContainer, highlight, options);
    }

    private createAddCommentLine(commentsContainer: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        const addCommentLine = commentsContainer.createDiv({
            cls: 'highlight-add-comment-line'
        });
        
        const plusIcon = addCommentLine.createDiv({ cls: 'highlight-add-comment-icon' });
        setIcon(plusIcon, 'plus');
        
        addCommentLine.createSpan({ text: 'Add comment' });
        
        // Add click handler for all highlights (native comments and regular highlights)
        addCommentLine.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onAddComment?.(highlight);
        });
    }


    private highlightSearchMatches(element: HTMLElement, searchTerm: string): void {
        if (!searchTerm) return;
        const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedSearchTerm, 'gi');
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
        let node;
        const nodesToProcess: Text[] = [];
        
        while (node = walker.nextNode()) {
            if (node.nodeValue && node.nodeValue.trim() !== '' && 
                !(node.parentElement && node.parentElement.classList.contains('search-term-highlight'))) {
                nodesToProcess.push(node as Text);
            }
        }
        
        nodesToProcess.forEach(textNode => {
            const text = textNode.nodeValue!;
            const newNodes: Node[] = [];
            let lastIndex = 0;
            let match;
            
            while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    newNodes.push(document.createTextNode(text.substring(lastIndex, match.index)));
                }
                const span = document.createElement('span');
                span.className = 'search-term-highlight';
                span.textContent = match[0];
                newNodes.push(span);
                lastIndex = regex.lastIndex;
            }
            
            if (lastIndex < text.length) {
                newNodes.push(document.createTextNode(text.substring(lastIndex)));
            }
            
            if (newNodes.length > 0 && textNode.parentNode) {
                newNodes.forEach(newNode => textNode.parentNode!.insertBefore(newNode, textNode));
                textNode.parentNode!.removeChild(textNode);
            }
        });
    }



    // Safe DOM-based rendering method to replace innerHTML usage
    private renderMarkdownToElement(element: HTMLElement, text: string): void {
        element.empty(); // Clear existing content
        
        // Process markdown patterns safely (no HTML escaping needed since textContent handles it)
        const segments = this.parseMarkdownSegments(text);
        
        for (const segment of segments) {
            if (segment.type === 'text') {
                element.appendText(segment.content || '');
            } else if (segment.type === 'strong') {
                const strongEl = element.createEl('strong');
                strongEl.textContent = segment.content || '';
            } else if (segment.type === 'em') {
                const emEl = element.createEl('em');
                emEl.textContent = segment.content || '';
            } else if (segment.type === 'code') {
                const codeEl = element.createEl('code');
                codeEl.textContent = segment.content || '';
            } else if (segment.type === 'del') {
                const delEl = element.createEl('del');
                delEl.textContent = segment.content || '';
            } else if (segment.type === 'link') {
                const linkEl = element.createEl('a');
                linkEl.textContent = segment.text || '';
                linkEl.href = segment.url || '';
                linkEl.target = '_blank';
            }
        }
    }

    private parseMarkdownSegments(text: string): Array<{type: string, content?: string, text?: string, url?: string}> {
        const segments: Array<{type: string, content?: string, text?: string, url?: string}> = [];
        
        // Process patterns in order of precedence using iOS-compatible approach
        const patterns = [
            { regex: /\*\*(.*?)\*\*/g, type: 'strong' },
            { regex: /__(.*?)__/g, type: 'strong' },
            { regex: /~~(.*?)~~/g, type: 'del' },
            { regex: /`([^`]+?)`/g, type: 'code' },
            { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' }
        ];
        
        const matches: Array<{start: number, end: number, type: string, content?: string, text?: string, url?: string}> = [];
        
        // Find all matches for non-italic patterns
        for (const pattern of patterns) {
            let match;
            pattern.regex.lastIndex = 0;
            while ((match = pattern.regex.exec(text)) !== null) {
                if (pattern.type === 'link') {
                    matches.push({
                        start: match.index,
                        end: match.index + match[0].length,
                        type: pattern.type,
                        text: match[1],
                        url: match[2]
                    });
                } else {
                    matches.push({
                        start: match.index,
                        end: match.index + match[0].length,
                        type: pattern.type,
                        content: match[1]
                    });
                }
            }
        }
        
        // Add italic matches using manual parsing for iOS compatibility
        this.findItalicMatches(text, matches);
        
        // Sort matches by position and remove overlaps
        matches.sort((a, b) => a.start - b.start);
        const nonOverlapping: Array<{start: number, end: number, type: string, content?: string, text?: string, url?: string}> = [];
        for (const match of matches) {
            if (!nonOverlapping.some(existing => 
                (match.start >= existing.start && match.start < existing.end) ||
                (match.end > existing.start && match.end <= existing.end)
            )) {
                nonOverlapping.push(match);
            }
        }
        
        // Build segments
        let pos = 0;
        for (const match of nonOverlapping) {
            // Add text before match
            if (pos < match.start) {
                segments.push({
                    type: 'text',
                    content: text.substring(pos, match.start)
                });
            }
            
            // Add the match
            segments.push(match);
            pos = match.end;
        }
        
        // Add remaining text
        if (pos < text.length) {
            segments.push({
                type: 'text',
                content: text.substring(pos)
            });
        }
        
        return segments;
    }
    
    private findItalicMatches(text: string, matches: Array<{start: number, end: number, type: string, content?: string, text?: string, url?: string}>): void {
        // Find single asterisk italic patterns manually
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '*' && (i === 0 || text[i-1] !== '*') && (i === text.length - 1 || text[i+1] !== '*')) {
                // Find closing asterisk
                for (let j = i + 1; j < text.length; j++) {
                    if (text[j] === '*' && (j === text.length - 1 || text[j+1] !== '*') && (j === 0 || text[j-1] !== '*')) {
                        const content = text.substring(i + 1, j);
                        if (content.length > 0 && content.indexOf('*') === -1) {
                            matches.push({
                                start: i,
                                end: j + 1,
                                type: 'em',
                                content: content
                            });
                            i = j; // Skip past this match
                            break;
                        }
                    }
                }
            }
        }
        
        // Find single underscore italic patterns manually
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '_' && (i === 0 || text[i-1] !== '_') && (i === text.length - 1 || text[i+1] !== '_')) {
                // Find closing underscore
                for (let j = i + 1; j < text.length; j++) {
                    if (text[j] === '_' && (j === text.length - 1 || text[j+1] !== '_') && (j === 0 || text[j-1] !== '_')) {
                        const content = text.substring(i + 1, j);
                        if (content.length > 0 && content.indexOf('_') === -1) {
                            matches.push({
                                start: i,
                                end: j + 1,
                                type: 'em',
                                content: content
                            });
                            i = j; // Skip past this match
                            break;
                        }
                    }
                }
            }
        }
    }

    private extractTagsFromHighlight(highlight: Highlight): string[] {
        const tags: string[] = [];
        
        if (highlight.footnoteContents) {
            for (const content of highlight.footnoteContents) {
                if (content.trim() !== '') {
                    const tagMatches = content.match(/#[\p{L}\p{N}\p{M}_/-]+/gu);
                    if (tagMatches) {
                        tagMatches.forEach(tag => {
                            const tagName = tag.substring(1);
                            if (!tags.includes(tagName)) {
                                tags.push(tagName);
                            }
                        });
                    }
                }
            }
        }
        
        return tags;
    }

    private isColorChangeable(highlight: Highlight): boolean {
        // Only allow color changes for regular markdown highlights (==text==)
        // Don't allow for native comments (%%text%%) or HTML highlights (<font>, <span>, <mark>)
        return !highlight.isNativeComment && !this.isHtmlHighlight(highlight);
    }

    private isHtmlHighlight(highlight: Highlight): boolean {
        // HTML highlights are identified by their type property
        return highlight.type === 'html';
    }

    private createHoverColorPicker(item: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        // Don't create hover color picker for native comments or HTML highlights
        if (!this.isColorChangeable(highlight)) return;
        
        // Create a hover zone for the left border area
        const hoverZone = item.createDiv({ cls: 'highlight-border-hover-zone' });
        
        const hoverColorPicker = item.createDiv({ cls: 'hover-color-picker' });
        const colorOptionsContainer = hoverColorPicker.createDiv({ cls: 'hover-color-options' });
        const colors = [
            this.plugin.settings.customColors.yellow,
            this.plugin.settings.customColors.red,
            this.plugin.settings.customColors.teal,
            this.plugin.settings.customColors.blue,
            this.plugin.settings.customColors.green
        ];
        
        colors.forEach((color, index) => {
            const colorOption = colorOptionsContainer.createDiv({
                cls: 'hover-color-option',
                attr: { 
                    'data-color': color,
                    'style': `--option-index: ${index}`
                }
            });
            colorOption.addEventListener('click', (event) => {
                event.stopPropagation();
                options.onColorChange?.(highlight, color);
            });
        });

        // Add hover events only to the left border hover zone
        let hoverTimeout: number;
        
        const showColorPicker = () => {
            hoverTimeout = window.setTimeout(() => {
                hoverColorPicker.classList.add('visible');
            }, 500); // Longer delay as requested
        };

        const hideColorPicker = () => {
            window.clearTimeout(hoverTimeout);
            hoverColorPicker.classList.remove('visible');
        };

        // Hover zone events
        hoverZone.addEventListener('mouseenter', showColorPicker);
        hoverZone.addEventListener('mouseleave', hideColorPicker);
        
        // Color picker events (keep visible when hovering over the picker itself)
        hoverColorPicker.addEventListener('mouseenter', () => {
            window.clearTimeout(hoverTimeout);
            hoverColorPicker.classList.add('visible');
        });
        hoverColorPicker.addEventListener('mouseleave', hideColorPicker);
    }
}
