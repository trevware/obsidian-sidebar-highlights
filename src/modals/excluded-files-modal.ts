import { Modal, App, setIcon, Notice } from 'obsidian';
import { FileFolderSuggest } from '../utils/file-folder-suggest';
import { t } from '../i18n';
import type { FileFilter } from '../../main';

export class ExcludedFilesModal extends Modal {
    private fileFilters: FileFilter[];
    private fileFilterMode: 'exclude' | 'include';
    private onUpdate: (fileFilters: FileFilter[]) => void;
    private filterInput: HTMLInputElement;
    private fileFolderSuggest: FileFolderSuggest;

    constructor(
        app: App,
        fileFilters: FileFilter[],
        fileFilterMode: 'exclude' | 'include',
        onUpdate: (fileFilters: FileFilter[]) => void
    ) {
        super(app);
        this.fileFilters = [...fileFilters];
        this.fileFilterMode = fileFilterMode;
        this.onUpdate = onUpdate;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Clean up paths that no longer exist
        const initialCount = this.fileFilters.length;
        this.fileFilters = this.fileFilters.filter(filter => {
            const file = this.app.vault.getAbstractFileByPath(filter.path);
            return file !== null;
        });

        // If any paths were removed, update the settings
        if (this.fileFilters.length < initialCount) {
            const removedCount = initialCount - this.fileFilters.length;
            this.onUpdate(this.fileFilters);
            new Notice(t('modals.excludedFiles.removedNonExistent', {
                count: removedCount,
                paths: removedCount === 1 ? 'path' : 'paths'
            }));
        }

        // Set the modal title (appears in upper left corner)
        const titleEl = contentEl.createEl('div', { cls: 'modal-title', text: t('modals.excludedFiles.title') });
        titleEl.style.marginBottom = '20px';

        // Add divider after title (only if there are filters)
        if (this.fileFilters.length > 0) {
            const divider = contentEl.createDiv();
            divider.style.borderTop = '1px solid var(--background-modifier-border)';
            divider.style.marginBottom = '20px';
        }

        // Excluded files list (shown above filter input when files exist)
        this.renderExcludedFilesList(contentEl);

        // Filter section
        const filterSection = contentEl.createDiv({ cls: 'setting-item' });

        const filterInfo = filterSection.createDiv({ cls: 'setting-item-info' });
        filterInfo.createDiv({ cls: 'setting-item-name', text: t('modals.excludedFiles.filterLabel') });

        const filterControl = filterSection.createDiv({ cls: 'setting-item-control' });

        const inputContainer = filterControl.createDiv({ cls: 'excluded-files-input-container' });
        inputContainer.style.display = 'flex';
        inputContainer.style.gap = '8px';

        this.filterInput = inputContainer.createEl('input', {
            type: 'text',
            placeholder: t('modals.excludedFiles.filterPlaceholder')
        });
        this.filterInput.style.flex = '1';

        // Initialize the file/folder suggestion system with auto-add callback
        this.fileFolderSuggest = new FileFolderSuggest(this.app, this.filterInput, (path: string) => {
            // Auto-add when selecting from dropdown
            this.addFilter();
        });

        // Mode dropdown
        const modeDropdown = inputContainer.createEl('select');
        modeDropdown.style.minWidth = '100px';

        const excludeOption = modeDropdown.createEl('option', { value: 'exclude', text: t('modals.excludedFiles.exclude') });
        const includeOption = modeDropdown.createEl('option', { value: 'include', text: t('modals.excludedFiles.include') });

        modeDropdown.value = this.fileFilterMode;

        modeDropdown.addEventListener('change', () => {
            // Just update the mode for new additions (don't change existing filters)
            this.fileFilterMode = modeDropdown.value as 'exclude' | 'include';
        });

        const addButton = inputContainer.createEl('button', {
            text: t('modals.excludedFiles.add')
        });

        addButton.addEventListener('click', () => this.addFilter());

        this.filterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.addFilter();
            }
        });

        // Modal buttons
        this.renderModalButtons(contentEl);
    }

    private renderExcludedFilesList(containerEl: HTMLElement) {
        const existingList = containerEl.querySelector('.excluded-files-list');
        if (existingList) {
            existingList.remove();
        }

        if (this.fileFilters.length > 0) {
            // Find the filter section to insert the list before it
            const filterSection = containerEl.querySelector('.setting-item');
            const listContainer = containerEl.createDiv({ cls: 'excluded-files-list' });

            // Insert the list before the filter section
            if (filterSection) {
                containerEl.insertBefore(listContainer, filterSection);
            }

            // Group filters by mode
            const includedFilters = this.fileFilters.filter(f => f.mode === 'include');
            const excludedFilters = this.fileFilters.filter(f => f.mode === 'exclude');

            // Render included filters first
            if (includedFilters.length > 0) {
                const includeHeader = listContainer.createDiv({ cls: 'file-filter-header' });
                includeHeader.style.fontSize = 'var(--font-ui-small)';
                includeHeader.style.color = 'var(--text-muted)';
                includeHeader.style.fontWeight = '600';
                includeHeader.style.textTransform = 'uppercase';
                includeHeader.style.letterSpacing = '0.05em';
                includeHeader.style.marginTop = '8px';
                includeHeader.style.marginBottom = '8px';
                includeHeader.setText(t('modals.excludedFiles.included'));

                this.renderFilterItems(listContainer, includedFilters);
            }

            // Render excluded filters
            if (excludedFilters.length > 0) {
                const excludeHeader = listContainer.createDiv({ cls: 'file-filter-header' });
                excludeHeader.style.fontSize = 'var(--font-ui-small)';
                excludeHeader.style.color = 'var(--text-muted)';
                excludeHeader.style.fontWeight = '600';
                excludeHeader.style.textTransform = 'uppercase';
                excludeHeader.style.letterSpacing = '0.05em';
                excludeHeader.style.marginTop = includedFilters.length > 0 ? '16px' : '8px';
                excludeHeader.style.marginBottom = '8px';
                excludeHeader.setText(t('modals.excludedFiles.excluded'));

                this.renderFilterItems(listContainer, excludedFilters);
            }
        }
    }

    private renderFilterItems(container: HTMLElement, filters: FileFilter[]) {
        filters.forEach((filter) => {
            const itemEl = container.createDiv({ cls: 'setting-item excluded-file-item' });
            // Remove border/divider styling and reduce spacing
            itemEl.style.borderTop = 'none';
            itemEl.style.paddingTop = '4px';
            itemEl.style.paddingBottom = '4px';

            const itemInfo = itemEl.createDiv({ cls: 'setting-item-info' });
            itemInfo.createDiv({ cls: 'setting-item-name', text: filter.path });

            const itemControl = itemEl.createDiv({ cls: 'setting-item-control' });
            const removeBtn = itemControl.createEl('button', {
                cls: 'clickable-icon'
            });

            // Use standard X icon
            setIcon(removeBtn, 'x');

            removeBtn.addEventListener('click', () => {
                this.removeFilter(filter.path);
            });
        });
    }

    private renderModalButtons(containerEl: HTMLElement) {
        const buttonContainer = containerEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '8px';
        buttonContainer.style.marginTop = '20px';

        const cancelBtn = buttonContainer.createEl('button', { text: t('modals.excludedFiles.cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = buttonContainer.createEl('button', {
            text: t('modals.excludedFiles.save'),
            cls: 'mod-cta'
        });
        saveBtn.addEventListener('click', () => this.close());
    }

    private addFilter() {
        const value = this.filterInput.value.trim();
        if (!value) return;

        // Check if path already exists
        if (this.fileFilters.some(f => f.path === value)) {
            new Notice(t('modals.excludedFiles.alreadyExists', { path: value }));
            return;
        }

        this.fileFilters.push({
            path: value,
            mode: this.fileFilterMode
        });
        this.filterInput.value = '';
        this.refreshContent();
        this.onUpdate(this.fileFilters);
    }

    private removeFilter(path: string) {
        this.fileFilters = this.fileFilters.filter(f => f.path !== path);
        this.refreshContent();
        this.onUpdate(this.fileFilters);
    }

    private refreshContent() {
        // Re-render the list with updated badges
        this.renderExcludedFilesList(this.contentEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}