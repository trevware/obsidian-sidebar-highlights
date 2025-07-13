import { SearchToken } from '../utils/search-parser';

export class InlineSearchManager {
    private container: HTMLElement;
    private editableDiv: HTMLElement;
    private hiddenInput: HTMLInputElement;
    private tokens: SearchToken[] = [];
    private onInputChange: (value: string, tokens: SearchToken[]) => void;
    private onChipRemove: (token: SearchToken) => void;
    private suggestions: { tags: string[], collections: string[] };
    private dropdown: HTMLElement | null = null;

    constructor(
        container: HTMLElement,
        hiddenInput: HTMLInputElement,
        onInputChange: (value: string, tokens: SearchToken[]) => void,
        onChipRemove: (token: SearchToken) => void,
        suggestions: { tags: string[], collections: string[] }
    ) {
        this.container = container;
        this.hiddenInput = hiddenInput;
        this.onInputChange = onInputChange;
        this.onChipRemove = onChipRemove;
        this.suggestions = suggestions;
        
        this.createEditableDiv();
        this.setupEventListeners();
    }

    private createEditableDiv(): void {
        this.editableDiv = this.container.createDiv({
            cls: 'inline-search-editor'
        });
        this.editableDiv.setAttribute('contenteditable', 'true');
        this.editableDiv.setAttribute('data-placeholder', 'Search highlights, use #tag @collection...');
        
        // Hide the original input
        this.hiddenInput.style.display = 'none';
    }

    private setupEventListeners(): void {
        this.editableDiv.addEventListener('input', () => {
            this.handleInput();
        });

        this.editableDiv.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });

        this.editableDiv.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData?.getData('text/plain') || '';
            this.insertText(text);
        });

        // Handle focus events
        this.editableDiv.addEventListener('focus', () => {
            this.updateAutocomplete();
        });

        this.editableDiv.addEventListener('blur', () => {
            // Delay hiding dropdown to allow clicking
            window.setTimeout(() => this.hideDropdown(), 150);
        });
    }

    private handleInput(): void {
        const text = this.getPlainText();
        this.hiddenInput.value = text;
        
        // Parse tokens from current text
        this.parseAndRenderTokens();
        
        // Update autocomplete
        this.updateAutocomplete();
        
        // Notify parent
        this.onInputChange(text, this.tokens);
    }

    private handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Backspace') {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                if (range.collapsed && range.startOffset === 0) {
                    // At the beginning of an element, check if previous sibling is a chip
                    const prevElement = range.startContainer.previousSibling;
                    if (prevElement && (prevElement as HTMLElement).classList?.contains('inline-search-chip')) {
                        e.preventDefault();
                        this.removeChipElement(prevElement as HTMLElement);
                        return;
                    }
                }
            }
        }
        
        if (e.key === 'Enter') {
            e.preventDefault();
            this.hideDropdown();
        }

        if (e.key === 'ArrowDown' && this.dropdown) {
            e.preventDefault();
            this.navigateDropdown(1);
        }

        if (e.key === 'ArrowUp' && this.dropdown) {
            e.preventDefault();
            this.navigateDropdown(-1);
        }
    }

    private getPlainText(): string {
        // Extract plain text while preserving tokens
        let text = '';
        for (const node of Array.from(this.editableDiv.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent || '';
            } else if ((node as HTMLElement).classList?.contains('inline-search-chip')) {
                const token = (node as HTMLElement).dataset.token;
                if (token) {
                    text += token + ' ';
                }
            }
        }
        return text.trim();
    }

    private parseAndRenderTokens(): void {
        const text = this.getPlainText();
        const newTokens: SearchToken[] = [];
        
        // Simple token extraction (can be enhanced later)
        const tagMatches = text.match(/-?#[a-zA-Z0-9_-]+/g) || [];
        const collectionMatches = text.match(/-?@[a-zA-Z0-9_-]+/g) || [];
        
        tagMatches.forEach(match => {
            newTokens.push({
                type: 'tag',
                value: match.replace(/^-?#/, ''),
                exclude: match.startsWith('-')
            });
        });

        collectionMatches.forEach(match => {
            newTokens.push({
                type: 'collection',
                value: match.replace(/^-?@/, ''),
                exclude: match.startsWith('-')
            });
        });

        this.tokens = newTokens;
        this.renderTokensInline();
    }

    private renderTokensInline(): void {
        const text = this.editableDiv.textContent || '';
        
        // Preserve cursor position
        const selection = window.getSelection();
        const range = selection?.getRangeAt(0);
        const cursorOffset = range?.startOffset || 0;

        // Clear existing content safely
        this.editableDiv.empty();
        
        // Parse and create DOM elements safely without innerHTML
        this.parseAndCreateTokenElements(text);

        // Add click handlers to remove buttons
        this.editableDiv.querySelectorAll('.inline-search-chip-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const token = (e.target as HTMLElement).dataset.remove;
                if (token) {
                    this.removeToken(token);
                }
            });
        });

        // Restore cursor position (simplified)
        if (selection && this.editableDiv.childNodes.length > 0) {
            try {
                const newRange = document.createRange();
                const textNode = this.findTextNodeAtOffset(cursorOffset);
                if (textNode) {
                    newRange.setStart(textNode, Math.min(cursorOffset, textNode.textContent?.length || 0));
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                }
            } catch (e) {
                // Cursor positioning failed, place at end
                this.placeCursorAtEnd();
            }
        }
    }

    private parseAndCreateTokenElements(text: string): void {
        // Split text by token pattern and create elements safely
        const tokenPattern = /-?[#@][a-zA-Z0-9_-]+/g;
        let lastIndex = 0;
        let match;

        while ((match = tokenPattern.exec(text)) !== null) {
            // Add text before the token
            if (match.index > lastIndex) {
                const textBefore = text.substring(lastIndex, match.index);
                if (textBefore) {
                    this.editableDiv.appendChild(document.createTextNode(textBefore));
                }
            }

            // Create token chip element
            const tokenText = match[0];
            const isExclude = tokenText.startsWith('-');
            const symbol = tokenText.includes('#') ? '#' : '@';
            const type = symbol === '#' ? 'tag' : 'collection';
            const value = tokenText.replace(/^-?[#@]/, '');

            const chipSpan = document.createElement('span');
            chipSpan.className = `inline-search-chip inline-search-chip-${type}${isExclude ? ' inline-search-chip-exclude' : ''}`;
            chipSpan.setAttribute('data-token', tokenText);
            chipSpan.setAttribute('contenteditable', 'false');

            const iconSpan = document.createElement('span');
            iconSpan.className = 'inline-search-chip-icon';
            iconSpan.textContent = symbol;
            chipSpan.appendChild(iconSpan);

            const valueSpan = document.createElement('span');
            valueSpan.className = 'inline-search-chip-value';
            valueSpan.textContent = value;
            chipSpan.appendChild(valueSpan);

            const removeSpan = document.createElement('span');
            removeSpan.className = 'inline-search-chip-remove';
            removeSpan.textContent = '×';
            removeSpan.setAttribute('data-remove', tokenText);
            chipSpan.appendChild(removeSpan);

            this.editableDiv.appendChild(chipSpan);

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text after the last token
        if (lastIndex < text.length) {
            const remainingText = text.substring(lastIndex);
            if (remainingText) {
                this.editableDiv.appendChild(document.createTextNode(remainingText));
            }
        }
    }

    private findTextNodeAtOffset(offset: number): Text | null {
        let currentOffset = 0;
        for (const node of Array.from(this.editableDiv.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                const nodeLength = node.textContent?.length || 0;
                if (currentOffset + nodeLength >= offset) {
                    return node as Text;
                }
                currentOffset += nodeLength;
            }
        }
        return null;
    }

    private placeCursorAtEnd(): void {
        const selection = window.getSelection();
        if (selection) {
            const range = document.createRange();
            range.selectNodeContents(this.editableDiv);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    private removeToken(tokenText: string): void {
        const newText = this.editableDiv.textContent?.replace(tokenText, '') || '';
        this.editableDiv.textContent = newText;
        this.handleInput();
    }

    private removeChipElement(chipElement: HTMLElement): void {
        const token = chipElement.dataset.token;
        if (token) {
            this.removeToken(token);
        }
    }

    private insertText(text: string): void {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
            this.handleInput();
        }
    }

    private updateAutocomplete(): void {
        const text = this.editableDiv.textContent || '';
        const cursorPos = this.getCursorPosition();
        
        // Check for tag or collection typing
        const beforeCursor = text.substring(0, cursorPos);
        const tagMatch = beforeCursor.match(/-?#([a-zA-Z0-9_-]*)$/);
        const collectionMatch = beforeCursor.match(/-?@([a-zA-Z0-9_-]*)$/);

        if (tagMatch || collectionMatch) {
            this.showAutocomplete(tagMatch, collectionMatch);
        } else {
            this.hideDropdown();
        }
    }

    private getCursorPosition(): number {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            return selection.getRangeAt(0).startOffset;
        }
        return 0;
    }

    private showAutocomplete(tagMatch: RegExpMatchArray | null, collectionMatch: RegExpMatchArray | null): void {
        if (!this.dropdown) {
            this.dropdown = this.container.createDiv({
                cls: 'search-autocomplete-dropdown'
            });
        }

        this.dropdown.empty();

        const suggestions = tagMatch 
            ? this.suggestions.tags.filter(tag => tag.toLowerCase().includes((tagMatch[1] || '').toLowerCase()))
            : this.suggestions.collections.filter(col => col.toLowerCase().includes((collectionMatch![1] || '').toLowerCase()));

        suggestions.slice(0, 8).forEach(suggestion => {
            const item = this.dropdown!.createDiv({
                cls: 'search-autocomplete-item',
                text: suggestion
            });

            item.addEventListener('click', () => {
                const symbol = tagMatch ? (tagMatch[0].startsWith('-') ? '-#' : '#') 
                                       : (collectionMatch![0].startsWith('-') ? '-@' : '@');
                const fullToken = symbol + suggestion;
                
                // Replace partial token with full token
                const text = this.editableDiv.textContent || '';
                const cursorPos = this.getCursorPosition();
                const beforeCursor = text.substring(0, cursorPos);
                const afterCursor = text.substring(cursorPos);
                
                const pattern = tagMatch ? tagMatch[0] : collectionMatch![0];
                const newText = beforeCursor.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), fullToken) + afterCursor;
                
                this.editableDiv.textContent = newText;
                this.placeCursorAtEnd();
                this.handleInput();
                this.hideDropdown();
            });
        });

        this.dropdown.style.display = suggestions.length > 0 ? 'block' : 'none';
    }

    private navigateDropdown(direction: number): void {
        // Implementation for keyboard navigation in dropdown
        // Simplified for now
    }

    private hideDropdown(): void {
        if (this.dropdown) {
            this.dropdown.style.display = 'none';
        }
    }

    public updateSuggestions(suggestions: { tags: string[], collections: string[] }): void {
        this.suggestions = suggestions;
    }

    public setValue(value: string): void {
        this.editableDiv.textContent = value;
        this.handleInput();
    }

    public clear(): void {
        this.editableDiv.textContent = '';
        this.tokens = [];
        this.hiddenInput.value = '';
        this.hideDropdown();
    }
}