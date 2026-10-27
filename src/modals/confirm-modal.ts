import { App, Modal } from 'obsidian';

export interface ConfirmOptions {
    title: string;
    message: string;
    /** The button that goes ahead. */
    confirm: string;
    cancel: string;
    /** Shows the button that goes ahead in red, for something that can't be undone. */
    destructive?: boolean;
}

/** Asks a yes-or-no question. Resolves true only when the person chooses to go ahead. */
export function confirmAction(app: App, options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => new ConfirmModal(app, options, resolve).open());
}

class ConfirmModal extends Modal {
    private confirmed = false;

    constructor(app: App, private readonly options: ConfirmOptions, private readonly resolve: (confirmed: boolean) => void) {
        super(app);
    }

    onOpen() {
        this.titleEl.setText(this.options.title);
        this.contentEl.createEl('p', { text: this.options.message });
        const buttons = this.contentEl.createDiv({ cls: 'modal-button-container sh-modal-buttons' });
        buttons.createEl('button', { text: this.options.cancel }).addEventListener('click', () => this.close());
        const confirm = buttons.createEl('button', {
            text: this.options.confirm,
            cls: this.options.destructive ? 'mod-warning' : 'mod-cta'
        });
        confirm.addEventListener('click', () => {
            this.confirmed = true;
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
        this.resolve(this.confirmed);
    }
}
