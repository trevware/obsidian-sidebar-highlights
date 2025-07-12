import { setIcon } from 'obsidian';
import type { Highlight } from '../../main';
import type HighlightCommentsPlugin from '../../main';

export interface HighlightRenderOptions {
    searchTerm?: string;
    showFilename?: boolean;
    showTimestamp?: boolean;
    showHighlightActions?: boolean;
    isCommentsVisible?: boolean;
    onCommentToggle?: (highlightId: string) => void;
    onCollectionsMenu?: (event: MouseEvent, highlight: Highlight) => void;
    onColorChange?: (highlight: Highlight, color: string) => void;
    onHighlightClick?: (highlight: Highlight) => void;
    onAddComment?: (highlight: Highlight) => void;
    onCommentClick?: (highlight: Highlight, commentIndex: number) => void;
    onTagClick?: (tag: string) => void;
    onFileNameClick?: (filePath: string) => void;
}

export class HighlightRenderer {
    constructor(private plugin: HighlightCommentsPlugin) {}

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
        }
        
        if (this.plugin.selectedHighlightId === highlight.id) {
            item.classList.add('highlight-selected');
        }
    }

    private getColorClassName(color: string): string {
        const colorMap: Record<string, string> = {
            '#ffd700': 'highlight-color-yellow',
            '#ff6b6b': 'highlight-color-red', 
            '#4ecdc4': 'highlight-color-teal',
            '#45b7d1': 'highlight-color-blue',
            '#96ceb4': 'highlight-color-green'
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

        quoteEl.addEventListener('click', () => {
            options.onHighlightClick?.(highlight);
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
                options.onFileNameClick?.(highlight.filePath);
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
            const timestamp = new Date(highlight.createdAt);
            const timeString = timestamp.toLocaleString();
            
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
                        options.onCommentClick?.(highlight, index);
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
        
        // Escape HTML first (but keep apostrophes as normal characters)
        let escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        
        // Process markdown patterns safely
        const segments = this.parseMarkdownSegments(escaped);
        
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
                    const tagMatches = content.match(/#[\p{L}\p{N}\p{M}_-]+/gu);
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

    private createHoverColorPicker(item: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        // Don't create hover color picker for native comments
        if (highlight.isNativeComment) return;
        
        // Create a hover zone for the left border area
        const hoverZone = item.createDiv({ cls: 'highlight-border-hover-zone' });
        
        const hoverColorPicker = item.createDiv({ cls: 'hover-color-picker' });
        const colorOptionsContainer = hoverColorPicker.createDiv({ cls: 'hover-color-options' });
        const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4'];
        
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
