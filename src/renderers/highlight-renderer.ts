import { setIcon } from 'obsidian';
import type { Highlight } from '../../main';
import type HighlightCommentsPlugin from '../../main';

export interface HighlightRenderOptions {
    searchTerm?: string;
    showFilename?: boolean;
    isCommentsVisible?: boolean;
    isColorPickerVisible?: boolean;
    onCommentToggle?: (highlightId: string) => void;
    onCollectionsMenu?: (event: MouseEvent, highlight: Highlight) => void;
    onColorPickerToggle?: (highlightId: string) => void;
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
        this.createColorPickerSection(item, highlight, options);

        return item;
    }

    private applyHighlightStyling(item: HTMLElement, highlight: Highlight): void {
        const highlightColor = highlight.color || this.plugin.settings.highlightColor;
        item.style.setProperty('--highlight-border-color', highlightColor);
        
        if (this.plugin.selectedHighlightId === highlight.id) {
            item.style.setProperty('--highlight-selection-color', highlightColor);
            item.classList.add('highlight-selected');
        }
    }

    private createQuoteSection(item: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        const quoteEl = item.createDiv({ cls: 'highlight-quote' });
        const renderedText = this.renderMarkdown(highlight.text);
        quoteEl.innerHTML = renderedText;

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
        const actions = item.createDiv({ cls: 'highlight-actions' });
        const infoContainer = actions.createDiv();
        
        this.addFileNameInfo(infoContainer, highlight, options);
        this.addStatsInfo(infoContainer, highlight, options);
        this.addActionButtons(actions, highlight, options);
        this.addTimestamp(actions, highlight);
    }

    private addFileNameInfo(infoContainer: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        if (options.showFilename) {
            const fileName = highlight.filePath.split('/').pop()?.replace(/\.md$/, '') || highlight.filePath;
            const fileNameEl = infoContainer.createEl('small', {
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
        const infoLineContainer = infoContainer.createEl('small', { cls: 'highlight-info-line' });
        
        // Line number section
        this.createInfoItem(infoLineContainer, 'text', `${lineNumber}`, 'highlight-line-info');

        // Comment count section
        const validFootnoteCount = highlight.footnoteContents?.filter(c => c.trim() !== '').length || 0;
        const commentContainer = this.createInfoItem(
            infoLineContainer, 
            'message-square', 
            `${validFootnoteCount}`, 
            'highlight-line-info highlight-comment-stat clickable'
        );

        commentContainer.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onCommentToggle?.(highlight.id);
        });

        // Collection count section
        const collectionCount = this.plugin.collectionsManager.getHighlightCollectionCount(highlight.id);
        const collectionContainer = this.createInfoItem(
            infoLineContainer,
            'folder-open',
            `${collectionCount}`,
            'highlight-line-info highlight-collection-stat clickable'
        );

        collectionContainer.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onCollectionsMenu?.(event, highlight);
        });
    }

    private createInfoItem(container: HTMLElement, iconName: string, text: string, className: string): HTMLElement {
        const itemContainer = container.createDiv({ cls: className });
        
        const icon = itemContainer.createDiv({ cls: iconName === 'message-square' ? 'comment-icon' : 'line-icon' });
        setIcon(icon, iconName);
        
        itemContainer.createSpan({ text });
        
        return itemContainer;
    }

    private addActionButtons(actions: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        const buttonContainer = actions.createDiv({ cls: 'comment-buttons' });
    }

    private addTimestamp(actions: HTMLElement, highlight: Highlight): void {
        if (highlight.createdAt) {
            const timestamp = new Date(highlight.createdAt);
            const timeString = timestamp.toLocaleString();
            
            const timestampEl = actions.createEl('small', {
                cls: 'highlight-timestamp',
                text: timeString,
                attr: { title: `Created: ${timeString}` }
            });
        }
    }

    private createCommentsSection(item: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        if (!options.isCommentsVisible) return;

        const commentsContainer = item.createDiv({ cls: 'highlight-comments' });
        
        // Add existing comments
        const validFootnoteContents = highlight.footnoteContents?.filter(c => c.trim() !== '') || [];
        if (validFootnoteContents.length > 0) {
            validFootnoteContents.forEach((content, index) => {
                const commentDiv = commentsContainer.createDiv({ cls: 'highlight-comment' });
                const renderedComment = this.renderMarkdown(content);
                commentDiv.innerHTML = renderedComment;
                commentDiv.addEventListener('click', (event) => {
                    event.stopPropagation();
                    options.onCommentClick?.(highlight, index);
                });
            });
        }
        
        // Add "Add Comment" line
        this.createAddCommentLine(commentsContainer, highlight, options);
    }

    private createAddCommentLine(commentsContainer: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        const addCommentLine = commentsContainer.createDiv({
            cls: 'highlight-add-comment-line'
        });
        
        const plusIcon = addCommentLine.createDiv({ cls: 'highlight-add-comment-icon' });
        setIcon(plusIcon, 'plus');
        
        addCommentLine.createSpan({ text: 'Add Comment' });
        
        addCommentLine.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onAddComment?.(highlight);
        });
    }

    private createColorPickerSection(item: HTMLElement, highlight: Highlight, options: HighlightRenderOptions): void {
        if (!options.isColorPickerVisible) return;

        const colorPickerContainer = item.createDiv({ cls: 'highlight-color-picker' });
        const colorOptionsContainer = colorPickerContainer.createDiv({ cls: 'color-picker-options' });
        const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4'];
        
        colors.forEach(color => {
            const colorOption = colorOptionsContainer.createDiv({
                cls: 'color-option',
                attr: { 'data-color': color }
            });
            colorOption.addEventListener('click', (event) => {
                event.stopPropagation();
                options.onColorChange?.(highlight, color);
            });
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

    private renderMarkdown(text: string): string {
        let escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
        
        return escaped
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.*?)__/g, '<strong>$1</strong>')
            .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>')
            .replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>')
            .replace(/`([^`]+?)`/g, '<code>$1</code>')
            .replace(/~~(.*?)~~/g, '<del>$1</del>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    }

    private extractTagsFromHighlight(highlight: Highlight): string[] {
        const tags: string[] = [];
        
        if (highlight.footnoteContents) {
            for (const content of highlight.footnoteContents) {
                if (content.trim() !== '') {
                    const tagMatches = content.match(/#[\w-]+/g);
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
        let hoverTimeout: NodeJS.Timeout;
        
        const showColorPicker = () => {
            hoverTimeout = setTimeout(() => {
                hoverColorPicker.classList.add('visible');
            }, 500); // Longer delay as requested
        };

        const hideColorPicker = () => {
            clearTimeout(hoverTimeout);
            hoverColorPicker.classList.remove('visible');
        };

        // Hover zone events
        hoverZone.addEventListener('mouseenter', showColorPicker);
        hoverZone.addEventListener('mouseleave', hideColorPicker);
        
        // Color picker events (keep visible when hovering over the picker itself)
        hoverColorPicker.addEventListener('mouseenter', () => {
            clearTimeout(hoverTimeout);
            hoverColorPicker.classList.add('visible');
        });
        hoverColorPicker.addEventListener('mouseleave', hideColorPicker);
    }
}
