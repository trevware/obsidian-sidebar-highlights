import { Modal, Setting, App, Notice } from 'obsidian';
import type { Collection } from '../../main';

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

        contentEl.createEl('h3', { text: 'Create a New Collection' });

        new Setting(contentEl)
            .setName('Collection Name')
            .setDesc('The name of your collection (Required)')
            .addText(text => {
                this.nameInput = text.inputEl;
                text.setPlaceholder('Important Highlights')
                    .onChange(value => {
                        // Enable/disable submit based on name presence
                        const submitBtn = contentEl.querySelector('.mod-cta') as HTMLButtonElement;
                        if (submitBtn) {
                            submitBtn.disabled = !value.trim();
                        }
                    });
                // Focus the name input
                setTimeout(() => text.inputEl.focus(), 100);
            });

        new Setting(contentEl)
            .setName('Collection Description')
            .setDesc('Provide more context about the collection (Optional)')
            .addText(text => {
                this.descriptionInput = text.inputEl;
                text.setPlaceholder('Research, etc.');
            });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = buttonContainer.createEl('button', { 
            text: 'Create Collection',
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
            new Notice('Collection name is required');
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

        contentEl.createEl('h3', { text: 'Edit Collection' });

        new Setting(contentEl)
            .setName('Collection Name')
            .setDesc('The name of your collection (Required)')
            .addText(text => {
                this.nameInput = text.inputEl;
                text.setPlaceholder('Important Highlights')
                    .setValue(this.collection.name)
                    .onChange(value => {
                        // Enable/disable submit based on name presence
                        const submitBtn = contentEl.querySelector('.mod-cta') as HTMLButtonElement;
                        if (submitBtn) {
                            submitBtn.disabled = !value.trim();
                        }
                    });
                // Focus the name input
                setTimeout(() => {
                    text.inputEl.focus();
                    text.inputEl.select();
                }, 100);
            });

        new Setting(contentEl)
            .setName('Collection Description')
            .setDesc('Provide more context about the collection (Optional)')
            .addText(text => {
                this.descriptionInput = text.inputEl;
                text.setPlaceholder('Research, etc.')
                    .setValue(this.collection.description || '');
            });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = buttonContainer.createEl('button', { 
            text: 'Save Changes',
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
            new Notice('Collection name is required');
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
