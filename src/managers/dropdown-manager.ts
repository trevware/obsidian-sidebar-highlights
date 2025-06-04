import { setIcon } from 'obsidian';

export interface DropdownItem {
    id?: string;
    text: string;
    icon?: string;
    checked?: boolean;
    className?: string;
    onClick: () => void;
}

export interface DropdownOptions {
    className?: string;
    position: 'below' | 'above';
}

export class DropdownManager {
    private activeDropdown: HTMLElement | null = null;
    private documentClickHandlers: Array<(e: MouseEvent) => void> = [];
    private isOpen: boolean = false;
    private checkboxElements: Map<string, { element: HTMLElement, checkDiv: HTMLElement }> = new Map();
    private activeItems: DropdownItem[] = [];

    isDropdownOpen(): boolean {
        return this.isOpen;
    }

    closeActiveDropdown(): void {
        if (this.activeDropdown && this.activeDropdown.parentNode) {
            this.activeDropdown.parentNode.removeChild(this.activeDropdown);
        }
        this.activeDropdown = null;
        this.isOpen = false;
        this.checkboxElements.clear();
        this.activeItems = [];
        
        // Clean up event listeners
        this.documentClickHandlers.forEach(handler => {
            document.removeEventListener('click', handler);
        });
        this.documentClickHandlers = [];
    }

    showDropdown(
        triggerElement: HTMLElement, 
        items: DropdownItem[], 
        options: DropdownOptions = { position: 'below' }
    ): void {
        // Close existing dropdown if open
        if (this.isOpen) {
            this.closeActiveDropdown();
            return;
        }

        const buttonRect = triggerElement.getBoundingClientRect();

        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = `menu highlights-dropdown-menu ${options.className || ''}`;
        dropdown.classList.add('dropdown-positioned');
        
        this.activeDropdown = dropdown;
        this.isOpen = true;
        this.activeItems = [...items]; // Store copy of items

        // Add items
        items.forEach((item, index) => {
            const element = document.createElement('div');
            element.className = `menu-item ${item.className || 'highlights-dropdown-item'}`;
            
            if (item.checked !== undefined) {
                // Add checkbox for checkable items
                const checkDiv = document.createElement('div');
                checkDiv.className = 'highlights-dropdown-check';
                
                if (item.checked) {
                    setIcon(checkDiv, 'check');
                    element.classList.add('is-checked');
                }
                element.appendChild(checkDiv);
                
                // Store reference for updates - use index if no ID
                const itemKey = item.id || `item-${index}`;
                this.checkboxElements.set(itemKey, { element, checkDiv });
            } else if (item.icon) {
                // Add icon for non-checkable items
                const iconDiv = document.createElement('div');
                iconDiv.className = 'menu-item-icon';
                setIcon(iconDiv, item.icon);
                element.appendChild(iconDiv);
            }
            
            const label = document.createElement('span');
            label.textContent = item.text;
            element.appendChild(label);
            
            element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Call the original onClick
                item.onClick();
                
                // Update checkbox state if this is a checkable item
                if (item.checked !== undefined) {
                    const itemKey = item.id || `item-${index}`;
                    const newCheckedState = !item.checked;
                    
                    // Update the stored item state
                    this.activeItems[index].checked = newCheckedState;
                    
                    // Update visual state
                    this.updateCheckboxState(itemKey, newCheckedState);
                    
                    // Check if we should close the dropdown
                    this.checkShouldAutoClose();
                }
            });
            
            dropdown.appendChild(element);
        });

        // Add to document temporarily to measure
        document.body.appendChild(dropdown);
        
        // Get dropdown dimensions
        const dropdownRect = dropdown.getBoundingClientRect();
        const dropdownHeight = dropdownRect.height;
        const dropdownWidth = dropdownRect.width;
        
        // Calculate available space
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const spaceBelow = viewportHeight - buttonRect.bottom;
        const spaceAbove = buttonRect.top;
        
        // Determine optimal position
        let top: number;
        let left: number;
        
        // Check if dropdown fits below the button (with 8px buffer)
        if (spaceBelow >= dropdownHeight + 8) {
            // Position below
            top = buttonRect.bottom + 4;
        } else if (spaceAbove >= dropdownHeight + 8) {
            // Position above
            top = buttonRect.top - dropdownHeight - 4;
        } else {
            // Not enough space in either direction, choose the side with more space
            if (spaceBelow > spaceAbove) {
                // Position below but constrain height
                top = buttonRect.bottom + 4;
                dropdown.style.maxHeight = `${spaceBelow - 8}px`;
                dropdown.style.overflowY = 'auto';
            } else {
                // Position above but constrain height
                top = 8; // Leave 8px from top of viewport
                dropdown.style.maxHeight = `${buttonRect.top - 12}px`;
                dropdown.style.overflowY = 'auto';
            }
        }
        
        // Check horizontal positioning
        left = buttonRect.left;
        if (left + dropdownWidth > viewportWidth - 8) {
            // Dropdown would go off right edge, align right edge with button right edge
            left = Math.max(8, buttonRect.right - dropdownWidth);
        }
        
        // Position dropdown
        dropdown.style.setProperty('--dropdown-left', `${left}px`);
        dropdown.style.setProperty('--dropdown-top', `${top}px`);
        dropdown.style.setProperty('--dropdown-right', `${buttonRect.right}px`);
        dropdown.style.setProperty('--dropdown-button-top', `${buttonRect.top}px`);
        
        // Set up click outside handler
        const closeHandler = (e: MouseEvent) => {
            if (!dropdown.contains(e.target as Node) && !triggerElement.contains(e.target as Node)) {
                this.closeActiveDropdown();
            }
        };
        
        this.documentClickHandlers.push(closeHandler);
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
        }, 100);
    }

    private updateCheckboxState(itemKey: string, checked: boolean): void {
        const checkboxInfo = this.checkboxElements.get(itemKey);
        if (!checkboxInfo) return;
        
        const { element, checkDiv } = checkboxInfo;
        
        if (checked) {
            setIcon(checkDiv, 'check');
            element.classList.add('is-checked');
        } else {
            checkDiv.innerHTML = '';
            element.classList.remove('is-checked');
        }
    }

    private checkShouldAutoClose(): void {
        // Check if any checkable items are still checked
        const hasCheckedItems = this.activeItems.some(item => 
            item.checked !== undefined && item.checked === true
        );
        
        // Close dropdown if no items are checked
        if (!hasCheckedItems) {
            setTimeout(() => {
                this.closeActiveDropdown();
            }, 100);
        }
    }

    updateAllCheckboxStates(newStates: { [key: string]: boolean }): void {
        // Update stored item states
        this.activeItems.forEach((item, index) => {
            if (item.checked !== undefined) {
                const itemKey = item.id || `item-${index}`;
                if (newStates.hasOwnProperty(itemKey)) {
                    item.checked = newStates[itemKey];
                    this.updateCheckboxState(itemKey, newStates[itemKey]);
                }
            }
        });
        
        // Check if dropdown should close
        this.checkShouldAutoClose();
    }

    cleanup(): void {
        this.closeActiveDropdown();
    }
}
