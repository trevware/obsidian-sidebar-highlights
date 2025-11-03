import { Modal, App, setIcon, Notice } from 'obsidian';
import { FileFolderSuggest } from '../utils/file-folder-suggest';
import { t } from '../i18n';

export class ExcludedFilesModal extends Modal {
    private excludedFiles: string[];
    private onUpdate: (excludedFiles: string[]) => void;
    private filterInput: HTMLInputElement;
    private fileFolderSuggest: FileFolderSuggest;

    constructor(app: App, excludedFiles: string[], onUpdate: (excludedFiles: string[]) => void) {
        super(app);
        this.excludedFiles = [...excludedFiles];
        this.onUpdate = onUpdate;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Clean up paths that no longer exist
        const initialCount = this.excludedFiles.length;
        this.excludedFiles = this.excludedFiles.filter(path => {
            const file = this.app.vault.getAbstractFileByPath(path);
            return file !== null;
        });

        // If any paths were removed, update the settings
        if (this.excludedFiles.length < initialCount) {
            const removedCount = initialCount - this.excludedFiles.length;
            this.onUpdate(this.excludedFiles);
            new Notice(t('modals.excludedFiles.removedNonExistent', {
                count: removedCount,
                paths: removedCount === 1 ? 'path' : 'paths'
            }));
        }

        // Set the modal title (appears in upper left corner)
        const titleEl = contentEl.createEl('div', { cls: 'modal-title', text: t('modals.excludedFiles.title') });
        titleEl.style.marginBottom = '20px';

        // Add divider after title
        const divider = contentEl.createDiv();
        divider.style.borderTop = '1px solid var(--background-modifier-border)';
        divider.style.marginBottom = '20px';

        // Status message
        this.renderStatusMessage(contentEl);

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

        // Initialize the file/folder suggestion system
        this.fileFolderSuggest = new FileFolderSuggest(this.app, this.filterInput);

        const addButton = inputContainer.createEl('button', {
            text: t('modals.excludedFiles.add'),
            cls: 'mod-cta'
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

    private renderStatusMessage(containerEl: HTMLElement) {
        const existingMessage = containerEl.querySelector('.excluded-files-status');
        if (existingMessage) {
            existingMessage.remove();
        }

        const messageEl = containerEl.createDiv({ cls: 'excluded-files-status' });
        messageEl.style.marginTop = '20px';
        messageEl.style.color = 'var(--text-muted)';

        if (this.excludedFiles.length === 0) {
            messageEl.setText(t('modals.excludedFiles.noFilter'));
            messageEl.style.paddingBottom = '20px';
        } else {
            messageEl.setText(t('modals.excludedFiles.currentlyExcluded'));
            messageEl.style.paddingBottom = '10px';
        }
    }

    private renderExcludedFilesList(containerEl: HTMLElement) {
        const existingList = containerEl.querySelector('.excluded-files-list');
        if (existingList) {
            existingList.remove();
        }

        if (this.excludedFiles.length > 0) {
            // Find the filter section to insert the list before it
            const filterSection = containerEl.querySelector('.setting-item');
            const listContainer = containerEl.createDiv({ cls: 'excluded-files-list' });
            
            // Insert the list before the filter section
            if (filterSection) {
                containerEl.insertBefore(listContainer, filterSection);
            }
            
            this.excludedFiles.forEach((file) => {
                const itemEl = listContainer.createDiv({ cls: 'setting-item excluded-file-item' });
                
                const itemInfo = itemEl.createDiv({ cls: 'setting-item-info' });
                itemInfo.createDiv({ cls: 'setting-item-name', text: file });
                
                const itemControl = itemEl.createDiv({ cls: 'setting-item-control' });
                const removeBtn = itemControl.createEl('button', {
                    cls: 'clickable-icon'
                });
                
                // Use standard X icon
                setIcon(removeBtn, 'x');
                
                removeBtn.addEventListener('click', () => {
                    this.removeFilter(file);
                });
            });
        }
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
        if (value && !this.excludedFiles.includes(value)) {
            this.excludedFiles.push(value);
            this.filterInput.value = '';
            this.refreshContent();
            this.onUpdate(this.excludedFiles);
        }
    }

    private removeFilter(filter: string) {
        this.excludedFiles = this.excludedFiles.filter(f => f !== filter);
        this.refreshContent();
        this.onUpdate(this.excludedFiles);
    }

    private refreshContent() {
        // Find the status message and update it in place
        const statusEl = this.contentEl.querySelector('.excluded-files-status') as HTMLElement;
        if (statusEl) {
            if (this.excludedFiles.length === 0) {
                statusEl.setText(t('modals.excludedFiles.noFilter'));
                statusEl.style.paddingBottom = '20px';
            } else {
                statusEl.setText(t('modals.excludedFiles.currentlyExcluded'));
                statusEl.style.paddingBottom = '10px';
            }
        }
        
        // Update the excluded files list
        this.renderExcludedFilesList(this.contentEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}