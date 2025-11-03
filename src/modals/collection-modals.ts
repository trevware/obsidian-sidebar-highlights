import { Modal, Setting, App, Notice } from 'obsidian';
import type { Collection } from '../../main';
import { t } from '../i18n';

export class NewCollectionModal extends Modal {
    private nameInput: HTMLInputElement;
    private descriptionInput: HTMLInputElement;
    private onSubmit: (name: string, description: string) => void;

    constructor(app: App, onSubmit: (name: string, description: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        const titleEl = contentEl.createEl('div', { cls: 'modal-title', text: t('modals.collection.createTitle') });
        titleEl.style.marginBottom = '20px';

        new Setting(contentEl)
            .setName(t('modals.collection.nameLabel'))
            .setDesc(t('modals.collection.nameDesc'))
            .addText(text => {
                this.nameInput = text.inputEl;
                text.setPlaceholder(t('modals.collection.namePlaceholder'))
                    .onChange(value => {
                        // Enable/disable submit based on name presence
                        const submitBtn = contentEl.querySelector('.mod-cta') as HTMLButtonElement;
                        if (submitBtn) {
                            submitBtn.disabled = !value.trim();
                        }
                    });
                // Focus the name input
                window.setTimeout(() => text.inputEl.focus(), 100);
            });

        new Setting(contentEl)
            .setName(t('modals.collection.descLabel'))
            .setDesc(t('modals.collection.descDesc'))
            .addText(text => {
                this.descriptionInput = text.inputEl;
                text.setPlaceholder(t('modals.collection.descPlaceholder'));
            });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('modals.collection.cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = buttonContainer.createEl('button', {
            text: t('modals.collection.create'),
            cls: 'mod-cta'
        });
        submitBtn.disabled = true; // Start disabled
        submitBtn.addEventListener('click', () => this.handleSubmit());

        // Handle Enter key
        contentEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.handleSubmit();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    private handleSubmit() {
        const name = this.nameInput.value.trim();
        const description = this.descriptionInput.value.trim();

        if (!name) {
            new Notice(t('modals.collection.nameRequired'));
            this.nameInput.focus();
            return;
        }

        this.onSubmit(name, description);
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class EditCollectionModal extends Modal {
    private nameInput: HTMLInputElement;
    private descriptionInput: HTMLInputElement;
    private onSubmit: (name: string, description: string) => void;
    private collection: Collection;

    constructor(app: App, collection: Collection, onSubmit: (name: string, description: string) => void) {
        super(app);
        this.collection = collection;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        const titleEl = contentEl.createEl('div', { cls: 'modal-title', text: t('modals.collection.editTitle') });
        titleEl.style.marginBottom = '20px';

        new Setting(contentEl)
            .setName(t('modals.collection.nameLabel'))
            .setDesc(t('modals.collection.nameDesc'))
            .addText(text => {
                this.nameInput = text.inputEl;
                text.setPlaceholder(t('modals.collection.namePlaceholder'))
                    .setValue(this.collection.name)
                    .onChange(value => {
                        // Enable/disable submit based on name presence
                        const submitBtn = contentEl.querySelector('.mod-cta') as HTMLButtonElement;
                        if (submitBtn) {
                            submitBtn.disabled = !value.trim();
                        }
                    });
                // Focus the name input
                window.setTimeout(() => {
                    text.inputEl.focus();
                    text.inputEl.select();
                }, 100);
            });

        new Setting(contentEl)
            .setName(t('modals.collection.descLabel'))
            .setDesc(t('modals.collection.descDesc'))
            .addText(text => {
                this.descriptionInput = text.inputEl;
                text.setPlaceholder(t('modals.collection.descPlaceholder'))
                    .setValue(this.collection.description || '');
            });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: t('modals.collection.cancel') });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = buttonContainer.createEl('button', {
            text: t('modals.collection.save'),
            cls: 'mod-cta'
        });
        submitBtn.addEventListener('click', () => this.handleSubmit());

        // Handle Enter key
        contentEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.handleSubmit();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    private handleSubmit() {
        const name = this.nameInput.value.trim();
        const description = this.descriptionInput.value.trim();

        if (!name) {
            new Notice(t('modals.collection.nameRequired'));
            this.nameInput.focus();
            return;
        }

        this.onSubmit(name, description);
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
