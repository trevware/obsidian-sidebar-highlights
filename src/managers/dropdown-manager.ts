import { setIcon } from 'obsidian';

export interface DropdownItem {
    id?: string;
    text: string;
    icon?: string;
    uncheckedIcon?: string;
    checked?: boolean;
    className?: string;
    separator?: boolean;
    heading?: boolean;
    expandable?: boolean;
    expanded?: boolean;
    children?: DropdownItem[];
    onClick?: () => void;
}

export interface DropdownOptions {
    className?: string;
    position: 'below' | 'above';
}

export class DropdownManager {
    private activeDropdown: HTMLElement | null = null;
    private secondaryPanel: HTMLElement | null = null;
    private documentClickHandlers: Array<(e: MouseEvent) => void> = [];
    private keydownHandlers: Array<(e: KeyboardEvent) => void> = [];
    private isOpen: boolean = false;
    private checkboxElements: Map<string, { element: HTMLElement, checkDiv: HTMLElement }> = new Map();
    private activeItems: DropdownItem[] = [];
    private expandedItemId: string | null = null;
    private triggerElement: HTMLElement | null = null;

    isDropdownOpen(): boolean {
        return this.isOpen;
    }

    closeActiveDropdown(): void {
        if (this.activeDropdown && this.activeDropdown.parentNode) {
            // Clean up CSS classes and custom properties
            this.activeDropdown.classList.remove('dropdown-constrained-height');
            this.activeDropdown.style.removeProperty('--dropdown-max-height');
            this.activeDropdown.style.removeProperty('--dropdown-top');
            this.activeDropdown.style.removeProperty('--dropdown-left');
            this.activeDropdown.parentNode.removeChild(this.activeDropdown);
        }
        if (this.secondaryPanel && this.secondaryPanel.parentNode) {
            this.secondaryPanel.parentNode.removeChild(this.secondaryPanel);
        }
        this.activeDropdown = null;
        this.secondaryPanel = null;
        this.triggerElement = null;
        this.isOpen = false;
        this.checkboxElements.clear();
        this.activeItems = [];
        this.expandedItemId = null;
        
        // Clean up event listeners
        this.documentClickHandlers.forEach(handler => {
            document.removeEventListener('click', handler);
        });
        this.documentClickHandlers = [];
        
        this.keydownHandlers.forEach(handler => {
            document.removeEventListener('keydown', handler);
        });
        this.keydownHandlers = [];
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

        this.triggerElement = triggerElement;
        const buttonRect = triggerElement.getBoundingClientRect();

        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = `menu highlights-dropdown-menu ${options.className || ''}`;
        dropdown.classList.add('dropdown-positioned');

        this.activeDropdown = dropdown;
        this.isOpen = true;
        this.activeItems = [...items]; // Store copy of items
        this.expandedItemId = null; // Reset expanded state

        // Render all items
        this.renderItems(dropdown, items, false);

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
        
        // Calculate positioning values
        let top: number;
        let left: number;
        
        // Determine optimal vertical position
        if (spaceBelow >= dropdownHeight + 8) {
            // Position below
            top = buttonRect.bottom + 4;
            dropdown.classList.add('dropdown-positioned-below');
        } else if (spaceAbove >= dropdownHeight + 8) {
            // Position above  
            top = buttonRect.top - dropdownHeight - 4;
            dropdown.classList.add('dropdown-positioned-above');
        } else {
            // Not enough space in either direction, choose the side with more space
            if (spaceBelow > spaceAbove) {
                // Position below but constrain height
                top = buttonRect.bottom + 4;
                dropdown.classList.add('dropdown-positioned-below-constrained');
                dropdown.style.setProperty('--dropdown-max-height', `${spaceBelow - 8}px`);
                dropdown.classList.add('dropdown-constrained-height');
            } else {
                // Position above but constrain height
                top = 8; // Leave 8px from top of viewport
                dropdown.classList.add('dropdown-positioned-above-constrained');
                dropdown.style.setProperty('--dropdown-max-height', `${buttonRect.top - 12}px`);
                dropdown.classList.add('dropdown-constrained-height');
            }
        }
        
        // Determine optimal horizontal position
        left = buttonRect.left;
        if (buttonRect.left + dropdownWidth > viewportWidth - 8) {
            // Dropdown would go off right edge, align right edge with button right edge
            left = Math.max(8, buttonRect.right - dropdownWidth);
        }
        dropdown.classList.add('dropdown-left-aligned');
        
        // Set final positioning values via CSS custom properties
        dropdown.style.setProperty('--dropdown-top', `${top}px`);
        dropdown.style.setProperty('--dropdown-left', `${left}px`);
        
        // Set up click outside handler
        const closeHandler = (e: MouseEvent) => {
            const isInsideDropdown = dropdown.contains(e.target as Node);
            const isInsideTrigger = triggerElement.contains(e.target as Node);
            const isInsideSecondary = this.secondaryPanel && this.secondaryPanel.contains(e.target as Node);

            if (!isInsideDropdown && !isInsideTrigger && !isInsideSecondary) {
                this.closeActiveDropdown();
            }
        };
        
        this.documentClickHandlers.push(closeHandler);
        window.setTimeout(() => {
            document.addEventListener('click', closeHandler);
        }, 100);
        
        // Set up ESC key handler
        const escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.closeActiveDropdown();
            }
        };

        this.keydownHandlers.push(escHandler);
        document.addEventListener('keydown', escHandler);

        // Add mouseleave handler to close secondary panel
        dropdown.addEventListener('mouseleave', (e: MouseEvent) => {
            // Give a delay to check if entering secondary panel
            setTimeout(() => {
                const relatedTarget = e.relatedTarget as Node;
                const isEnteringSecondary = this.secondaryPanel && this.secondaryPanel.contains(relatedTarget);
                if (!isEnteringSecondary) {
                    this.closeSecondaryPanel();
                }
            }, 100);
        });
    }

    private renderItems(container: HTMLElement, items: DropdownItem[], renderChildren: boolean, depth: number = 0, isSecondaryPanel: boolean = false): void {
        items.forEach((item, index) => {
            if (item.separator) {
                const element = document.createElement('div');
                element.className = 'menu-separator';
                container.appendChild(element);
                return;
            }

            if (item.heading) {
                const element = document.createElement('div');
                element.className = 'highlights-dropdown-heading';
                element.textContent = item.text;
                container.appendChild(element);
                return;
            }

            this.renderItem(container, item, index, depth, isSecondaryPanel);

            // Only render children inline if renderChildren is true (for secondary panel)
            if (renderChildren && item.children) {
                item.children.forEach((child, childIndex) => {
                    this.renderItem(container, child, childIndex, depth + 1, isSecondaryPanel);
                });
            }
        });
    }

    private renderItem(container: HTMLElement, item: DropdownItem, index: number, depth: number, isSecondaryPanel: boolean = false): void {
        const element = document.createElement('div');
        element.className = `menu-item ${item.className || 'highlights-dropdown-item'}`;

        if (depth > 0) {
            element.classList.add('dropdown-child-item');
        }

        // Handle expandable items
        if (item.expandable) {
            element.classList.add('dropdown-expandable-item');

            // Add item icon if provided
            if (item.icon) {
                const iconDiv = document.createElement('div');
                iconDiv.className = 'menu-item-icon';
                setIcon(iconDiv, item.icon);
                element.appendChild(iconDiv);
            }

            // Add label
            const label = document.createElement('span');
            label.textContent = item.text;
            element.appendChild(label);

            // Hover handlers for expandable items
            element.addEventListener('mouseenter', (e) => {
                if (item.children) {
                    this.showSecondaryPanel(item.children, element);
                    this.expandedItemId = item.id!;
                }
            });
        } else {
            // Regular item (non-expandable)
            if (item.checked !== undefined) {
                // Add checkbox for checkable items
                const checkDiv = document.createElement('div');
                checkDiv.className = 'highlights-dropdown-check';

                if (item.checked) {
                    setIcon(checkDiv, 'check');
                    element.classList.add('is-checked');
                } else if (item.uncheckedIcon) {
                    setIcon(checkDiv, item.uncheckedIcon);
                }
                element.appendChild(checkDiv);

                const itemKey = item.id || `item-${index}`;
                this.checkboxElements.set(itemKey, { element, checkDiv });
            } else if (item.icon) {
                const iconDiv = document.createElement('div');
                iconDiv.className = 'menu-item-icon';
                setIcon(iconDiv, item.icon);
                element.appendChild(iconDiv);
            }

            const label = document.createElement('span');
            label.textContent = item.text;
            element.appendChild(label);

            // Click handler for regular items
            element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (item.onClick) {
                    item.onClick();
                }

                if (item.checked !== undefined) {
                    const itemKey = item.id || `item-${index}`;
                    const newCheckedState = !item.checked;
                    item.checked = newCheckedState;
                    this.updateCheckboxState(itemKey, newCheckedState);

                    // Only auto-close if NOT in secondary panel
                    if (!isSecondaryPanel) {
                        this.checkShouldAutoClose();
                    }
                }
            });
        }

        container.appendChild(element);
    }


    private findItem(items: DropdownItem[], itemId: string): DropdownItem | null {
        for (const item of items) {
            if (item.id === itemId) {
                return item;
            }
            if (item.children) {
                const found = this.findItem(item.children, itemId);
                if (found) return found;
            }
        }
        return null;
    }

    private closeSecondaryPanel(): void {
        if (this.secondaryPanel && this.secondaryPanel.parentNode) {
            this.secondaryPanel.parentNode.removeChild(this.secondaryPanel);
        }
        this.secondaryPanel = null;
    }

    private showSecondaryPanel(children: DropdownItem[], hoveredElement: HTMLElement): void {
        if (!this.activeDropdown) return;

        // Create secondary panel if it doesn't exist
        if (!this.secondaryPanel) {
            const panel = document.createElement('div');
            panel.className = 'menu highlights-dropdown-menu highlights-dropdown-secondary';
            this.secondaryPanel = panel;
            document.body.appendChild(panel);

            // Add mouseenter/mouseleave handlers to keep panel open
            panel.addEventListener('mouseenter', () => {
                // Keep the panel open when hovering over it
            });

            panel.addEventListener('mouseleave', () => {
                // Close panel when mouse leaves
                this.closeSecondaryPanel();
            });
        }

        // Clear and re-render children
        this.secondaryPanel.empty();
        this.renderItems(this.secondaryPanel, children, true, 0, true);

        // Position the panel next to the main dropdown, aligned with hovered item
        const dropdownRect = this.activeDropdown.getBoundingClientRect();
        const hoveredRect = hoveredElement.getBoundingClientRect();

        // Determine if sidebar is on left or right
        const viewportWidth = window.innerWidth;
        const isOnLeft = dropdownRect.left < viewportWidth / 2;

        // Get panel dimensions after rendering
        const panelRect = this.secondaryPanel.getBoundingClientRect();

        let left: number;
        if (isOnLeft) {
            // Position to the right, slightly overlapping the main dropdown
            left = dropdownRect.right - 2;
        } else {
            // Position to the left, slightly overlapping the main dropdown
            left = dropdownRect.left - panelRect.width + 2;
        }

        // Position slightly above the hovered element (4px offset for visual hierarchy)
        const top = hoveredRect.top - 4;

        this.secondaryPanel.style.setProperty('--dropdown-top', `${top}px`);
        this.secondaryPanel.style.setProperty('--dropdown-left', `${left}px`);
    }

    private updateCheckboxState(itemKey: string, checked: boolean): void {
        const checkboxInfo = this.checkboxElements.get(itemKey);
        if (!checkboxInfo) return;

        const { element, checkDiv } = checkboxInfo;

        // Find the corresponding item to get its uncheckedIcon (search recursively)
        const item = this.findItemRecursive(this.activeItems, itemKey);

        if (checked) {
            setIcon(checkDiv, 'check');
            element.classList.add('is-checked');
        } else {
            checkDiv.empty(); // Clear the check icon
            element.classList.remove('is-checked');

            // Show unchecked icon if available
            if (item && item.uncheckedIcon) {
                setIcon(checkDiv, item.uncheckedIcon);
            }
        }
    }

    private findItemRecursive(items: DropdownItem[], itemKey: string): DropdownItem | null {
        for (const item of items) {
            const itemId = item.id || `item-${items.indexOf(item)}`;
            if (itemId === itemKey) {
                return item;
            }
            if (item.children) {
                const found = this.findItemRecursive(item.children, itemKey);
                if (found) return found;
            }
        }
        return null;
    }

    private checkShouldAutoClose(): void {
        // Check if any checkable items are still checked
        const hasCheckedItems = this.activeItems.some(item => 
            item.checked !== undefined && item.checked === true
        );
        
        // Close dropdown if no items are checked
        if (!hasCheckedItems) {
            window.setTimeout(() => {
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