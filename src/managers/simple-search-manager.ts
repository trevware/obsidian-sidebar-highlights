import { SearchParser, ParsedSearch, ASTNode, OperatorNode, FilterNode, TextNode } from '../utils/search-parser';

export class SimpleSearchManager {
    private input: HTMLInputElement;
    private container: HTMLElement;
    private dropdown: HTMLElement;
    private previewElement: HTMLElement;
    private suggestions: { tags: string[], collections: string[] };
    private onSearchChange: (query: string, parsed: ParsedSearch) => void;
    private currentSuggestions: string[] = [];
    private selectedIndex: number = -1;

    constructor(
        input: HTMLInputElement,
        container: HTMLElement,
        onSearchChange: (query: string, parsed: ParsedSearch) => void,
        suggestions: { tags: string[], collections: string[] }
    ) {
        this.input = input;
        this.container = container;
        this.onSearchChange = onSearchChange;
        this.suggestions = suggestions;
        
        this.createDropdown();
        this.createPreview();
        this.setupEventListeners();
    }

    private createDropdown(): void {
        this.dropdown = this.container.createDiv({
            cls: 'simple-search-dropdown'
        });
        this.dropdown.style.display = 'none';
    }

    private createPreview(): void {
        this.previewElement = this.container.createDiv({
            cls: 'simple-search-preview'
        });
        this.previewElement.style.display = 'none';
    }

    private setupEventListeners(): void {
        this.input.addEventListener('input', () => {
            this.handleInput();
        });

        this.input.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });

        this.input.addEventListener('focus', () => {
            this.updateAutocomplete();
        });

        this.input.addEventListener('blur', () => {
            // Delay hiding to allow clicking on suggestions
            window.setTimeout(() => this.hideDropdown(), 150);
        });
    }

    private handleInput(): void {
        const query = this.input.value;
        const parsed = SearchParser.parseQuery(query);
        
        this.updatePreview(parsed);
        this.updateAutocomplete();
        this.onSearchChange(query, parsed);
    }

    private handleKeydown(e: KeyboardEvent): void {
        if (this.dropdown.style.display === 'none') return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectNext();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.selectPrevious();
                break;
            case 'Enter':
                e.preventDefault();
                this.applySuggestion();
                break;
            case 'Escape':
                e.preventDefault();
                this.hideDropdown();
                break;
        }
    }

    private updateAutocomplete(): void {
        const value = this.input.value;
        const cursorPos = this.input.selectionStart || 0;
        
        // Get text up to cursor
        const textBeforeCursor = value.substring(0, cursorPos);
        
        // Check for tag or collection pattern at cursor
        const tagMatch = textBeforeCursor.match(/-?#([a-zA-Z0-9_-]*)$/);
        const collectionMatch = textBeforeCursor.match(/-?@([a-zA-Z0-9_-]*)$/);
        
        if (tagMatch) {
            this.showSuggestions('tag', tagMatch[1], tagMatch[0].startsWith('-'));
        } else if (collectionMatch) {
            this.showSuggestions('collection', collectionMatch[1], collectionMatch[0].startsWith('-'));
        } else {
            this.hideDropdown();
        }
    }

    private showSuggestions(type: 'tag' | 'collection', partial: string, isExclude: boolean): void {
        const sourceList = type === 'tag' ? this.suggestions.tags : this.suggestions.collections;
        
        this.currentSuggestions = sourceList.filter(item => 
            item.toLowerCase().includes(partial.toLowerCase())
        ).slice(0, 8);

        this.dropdown.empty();
        this.selectedIndex = -1;

        if (this.currentSuggestions.length === 0) {
            this.hideDropdown();
            return;
        }

        this.currentSuggestions.forEach((suggestion, index) => {
            const item = this.dropdown.createDiv({
                cls: 'simple-search-suggestion'
            });

            // Add icon and text
            const icon = item.createSpan({
                cls: 'simple-search-suggestion-icon',
                text: type === 'tag' ? '#' : '@'
            });
            
            if (isExclude) {
                icon.classList.add('exclude');
            }

            item.createSpan({
                cls: 'simple-search-suggestion-text',
                text: suggestion
            });

            item.addEventListener('click', () => {
                this.selectedIndex = index;
                this.applySuggestion();
            });

            item.addEventListener('mouseenter', () => {
                this.setSelected(index);
            });
        });

        this.dropdown.style.display = 'block';
    }

    private selectNext(): void {
        if (this.currentSuggestions.length === 0) return;
        this.setSelected((this.selectedIndex + 1) % this.currentSuggestions.length);
    }

    private selectPrevious(): void {
        if (this.currentSuggestions.length === 0) return;
        this.setSelected(this.selectedIndex <= 0 ? this.currentSuggestions.length - 1 : this.selectedIndex - 1);
    }

    private setSelected(index: number): void {
        // Remove previous selection
        const items = this.dropdown.querySelectorAll('.simple-search-suggestion');
        items.forEach(item => item.classList.remove('selected'));

        // Add new selection
        if (index >= 0 && index < items.length) {
            items[index].classList.add('selected');
            this.selectedIndex = index;
        }
    }

    private applySuggestion(): void {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.currentSuggestions.length) {
            return;
        }

        const suggestion = this.currentSuggestions[this.selectedIndex];
        const value = this.input.value;
        const cursorPos = this.input.selectionStart || 0;
        
        const textBeforeCursor = value.substring(0, cursorPos);
        const textAfterCursor = value.substring(cursorPos);
        
        // Find the pattern to replace
        const tagMatch = textBeforeCursor.match(/-?#([a-zA-Z0-9_-]*)$/);
        const collectionMatch = textBeforeCursor.match(/-?@([a-zA-Z0-9_-]*)$/);
        
        let newValue: string;
        let newCursorPos: number;
        
        if (tagMatch) {
            const prefix = tagMatch[0].startsWith('-') ? '-#' : '#';
            const replacement = prefix + suggestion + ' ';
            newValue = textBeforeCursor.replace(/-?#[a-zA-Z0-9_-]*$/, replacement) + textAfterCursor;
            newCursorPos = textBeforeCursor.replace(/-?#[a-zA-Z0-9_-]*$/, replacement).length;
        } else if (collectionMatch) {
            const prefix = collectionMatch[0].startsWith('-') ? '-@' : '@';
            const replacement = prefix + suggestion + ' ';
            newValue = textBeforeCursor.replace(/-?@[a-zA-Z0-9_-]*$/, replacement) + textAfterCursor;
            newCursorPos = textBeforeCursor.replace(/-?@[a-zA-Z0-9_-]*$/, replacement).length;
        } else {
            return;
        }

        this.input.value = newValue;
        this.input.setSelectionRange(newCursorPos, newCursorPos);
        this.hideDropdown();
        this.handleInput();
    }

    private hideDropdown(): void {
        this.dropdown.style.display = 'none';
        this.selectedIndex = -1;
    }

    private updatePreview(parsed: ParsedSearch): void {
        this.previewElement.empty();
        
        // Only show preview if there's text in the input
        if (!this.input.value.trim()) {
            this.previewElement.style.display = 'none';
            return;
        }

        this.previewElement.style.display = 'block';

        if (!parsed.ast) {
            this.previewElement.createSpan({
                cls: 'simple-search-preview-text',
                text: 'Use #tag @collection (-# to exclude)'
            });
            return;
        }

        const description = parsed.ast ? this.generateDescription(parsed.ast) : 'Invalid search query';
        
        this.previewElement.createSpan({
            cls: 'simple-search-preview-label',
            text: 'Matching: '
        });
        
        this.previewElement.createSpan({
            cls: 'simple-search-preview-logic',
            text: description
        });
    }

    private generateDescription(node: ASTNode | null): string {
        if (!node) {
            return 'Invalid';
        }
        
        // Extract all filters and text terms in a flattened way
        const filters: string[] = [];
        const textTerms: string[] = [];
        this.extractTerms(node, filters, textTerms);
        
        const parts: string[] = [];
        
        // Add filters
        if (filters.length > 0) {
            parts.push(filters.join(' '));
        }
        
        // Add text terms as a single phrase
        if (textTerms.length > 0) {
            parts.push(`"${textTerms.join(' ')}"`);
        }
        
        return parts.join(' AND ');
    }
    
    private extractTerms(node: ASTNode, filters: string[], textTerms: string[]): void {
        if (node.type === 'filter') {
            const filterNode = node as FilterNode;
            const prefix = filterNode.exclude ? '-' : '';
            const type = filterNode.filterType === 'tag' ? '#' : '@';
            filters.push(`${prefix}${type}${filterNode.value}`);
        } else if (node.type === 'text') {
            const textNode = node as TextNode;
            textTerms.push(textNode.value);
        } else if (node.type === 'operator') {
            const opNode = node as OperatorNode;
            this.extractTerms(opNode.left, filters, textTerms);
            this.extractTerms(opNode.right, filters, textTerms);
        }
    }

    public updateSuggestions(suggestions: { tags: string[], collections: string[] }): void {
        this.suggestions = suggestions;
        this.updateAutocomplete();
    }

    public clear(): void {
        this.input.value = '';
        this.hideDropdown();
        this.handleInput();
    }

    public setValue(value: string): void {
        this.input.value = value;
        this.handleInput();
    }
}