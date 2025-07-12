import { SearchToken } from '../utils/search-parser';

export class SearchChipManager {
    private container: HTMLElement;
    private onChipRemove: (token: SearchToken) => void;
    private onChipClick?: (token: SearchToken) => void;

    constructor(
        container: HTMLElement, 
        onChipRemove: (token: SearchToken) => void,
        onChipClick?: (token: SearchToken) => void
    ) {
        this.container = container;
        this.onChipRemove = onChipRemove;
        this.onChipClick = onChipClick;
    }

    renderChips(tokens: SearchToken[]): void {
        this.clearChips();
        
        const groups: { [key: number]: SearchToken[] } = {};
        const ungrouped: SearchToken[] = [];

        // Separate grouped and ungrouped tokens
        tokens.forEach(token => {
            if (token.group !== undefined) {
                if (!groups[token.group]) {
                    groups[token.group] = [];
                }
                groups[token.group].push(token);
            } else {
                ungrouped.push(token);
            }
        });

        // Render grouped chips
        Object.entries(groups).forEach(([groupIndex, groupTokens]) => {
            this.renderChipGroup(groupTokens, parseInt(groupIndex));
        });

        // Render ungrouped chips
        ungrouped.forEach(token => {
            this.renderSingleChip(token);
        });
    }

    private renderChipGroup(tokens: SearchToken[], groupIndex: number): void {
        const groupContainer = this.container.createDiv({
            cls: 'search-chip-group'
        });

        const groupLabel = groupContainer.createSpan({
            cls: 'search-chip-group-label',
            text: '('
        });

        tokens.forEach((token, index) => {
            this.renderSingleChip(token, groupContainer);
            
            // Add OR indicator between tokens in group
            if (index < tokens.length - 1) {
                groupContainer.createSpan({
                    cls: 'search-chip-or-indicator',
                    text: 'OR'
                });
            }
        });

        groupContainer.createSpan({
            cls: 'search-chip-group-label',
            text: ')'
        });
    }

    private renderSingleChip(token: SearchToken, container?: HTMLElement): void {
        const chipContainer = container || this.container;
        
        const chip = chipContainer.createDiv({
            cls: this.getChipClasses(token)
        });

        // Add icon based on token type
        const icon = chip.createSpan({
            cls: 'search-chip-icon'
        });
        
        if (token.type === 'tag') {
            icon.textContent = '#';
        } else if (token.type === 'collection') {
            icon.textContent = '@';
        } else {
            icon.textContent = '"';
        }

        // Add token value
        const value = chip.createSpan({
            cls: 'search-chip-value',
            text: token.value
        });

        // Add remove button
        const removeBtn = chip.createSpan({
            cls: 'search-chip-remove'
        });
        removeBtn.textContent = '×';
        
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onChipRemove(token);
        });

        // Add click handler for the entire chip
        if (this.onChipClick) {
            chip.addEventListener('click', () => {
                this.onChipClick!(token);
            });
        }

        // Add tooltip
        chip.setAttribute('title', this.getChipTooltip(token));
    }

    private getChipClasses(token: SearchToken): string {
        const baseClasses = ['search-chip'];
        
        // Add type class
        baseClasses.push(`search-chip-${token.type}`);
        
        // Add exclude class if needed
        if (token.exclude) {
            baseClasses.push('search-chip-exclude');
        }

        // Add grouped class if needed
        if (token.group !== undefined) {
            baseClasses.push('search-chip-grouped');
        }

        return baseClasses.join(' ');
    }

    private getChipTooltip(token: SearchToken): string {
        const action = token.exclude ? 'Exclude' : 'Include';
        const type = token.type === 'tag' ? 'tag' : 
                    token.type === 'collection' ? 'collection' : 'text';
        
        return `${action} ${type}: ${token.value}`;
    }

    private clearChips(): void {
        this.container.empty();
    }

    addAutocompleteSuggestions(
        input: HTMLInputElement, 
        suggestions: { tags: string[], collections: string[] }
    ): void {
        const dropdown = this.createAutocompleteDropdown();
        
        input.addEventListener('input', () => {
            this.updateAutocompleteSuggestions(input, dropdown, suggestions);
        });

        input.addEventListener('blur', () => {
            // Delay hiding to allow clicking on suggestions
            window.setTimeout(() => dropdown.style.display = 'none', 150);
        });

        input.addEventListener('focus', () => {
            this.updateAutocompleteSuggestions(input, dropdown, suggestions);
        });
    }

    private createAutocompleteDropdown(): HTMLElement {
        // Create dropdown relative to the input container parent
        const inputContainer = this.container.parentElement;
        if (!inputContainer) throw new Error('Container parent not found');
        
        const dropdown = inputContainer.createDiv({
            cls: 'search-autocomplete-dropdown'
        });
        dropdown.style.display = 'none';
        return dropdown;
    }

    private updateAutocompleteSuggestions(
        input: HTMLInputElement,
        dropdown: HTMLElement,
        suggestions: { tags: string[], collections: string[] }
    ): void {
        const value = input.value;
        const cursorPos = input.selectionStart || 0;
        
        // Get current word being typed
        const beforeCursor = value.substring(0, cursorPos);
        const afterCursor = value.substring(cursorPos);
        
        // Check if we're typing a tag or collection
        const tagMatch = beforeCursor.match(/-?#([a-zA-Z0-9_-]*)$/);
        const collectionMatch = beforeCursor.match(/-?@([a-zA-Z0-9_-]*)$/);
        
        dropdown.empty();
        
        if (tagMatch) {
            const prefix = tagMatch[0];
            const partial = tagMatch[1];
            const filtered = suggestions.tags.filter(tag => 
                tag.toLowerCase().includes(partial.toLowerCase())
            );
            
            this.renderSuggestions(dropdown, filtered, prefix, partial, input, beforeCursor, afterCursor);
        } else if (collectionMatch) {
            const prefix = collectionMatch[0];
            const partial = collectionMatch[1];
            const filtered = suggestions.collections.filter(collection => 
                collection.toLowerCase().includes(partial.toLowerCase())
            );
            
            this.renderSuggestions(dropdown, filtered, prefix, partial, input, beforeCursor, afterCursor);
        }
        
        dropdown.style.display = dropdown.children.length > 0 ? 'block' : 'none';
    }

    private renderSuggestions(
        dropdown: HTMLElement,
        suggestions: string[],
        prefix: string,
        partial: string,
        input: HTMLInputElement,
        beforeCursor: string,
        afterCursor: string
    ): void {
        suggestions.slice(0, 8).forEach(suggestion => {
            const item = dropdown.createDiv({
                cls: 'search-autocomplete-item',
                text: suggestion
            });
            
            item.addEventListener('click', () => {
                const symbol = prefix.startsWith('-@') ? '-@' : prefix.startsWith('@') ? '@' : 
                              prefix.startsWith('-#') ? '-#' : '#';
                const fullToken = symbol + suggestion;
                
                const newValue = beforeCursor.replace(
                    new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
                    fullToken
                ) + afterCursor;
                
                input.value = newValue;
                input.dispatchEvent(new Event('input'));
                dropdown.style.display = 'none';
                input.focus();
            });
        });
    }
}