/**
 * The New note panel: a name, a folder, and where the note will land, on the
 * same glass surface as quick add. Kept apart from the Tasks tab so it can be
 * tested on its own.
 */

import { Platform, setIcon } from 'obsidian';
import { t } from '../i18n';
import { hint } from './glass-palette';
import { cleanNoteName, newNotePath } from './new-note';

export interface NewNoteHost {
    /** The folder a new note starts in, '' for none. */
    defaultFolder: () => string;
    /** Opens the folder picker over the hidden panel; '' picks no folder. */
    chooseFolder: (done: (folder: string) => void, current: string) => void;
    /** The note already at this path, in any capitalisation, if there is one. */
    existing: (path: string) => string | null;
    /** Makes the note; resolves its path, or null when it couldn't. */
    submit: (path: string) => Promise<string | null>;
    onClose: () => void;
    /** Once the panel has closed: the note to open, and whether it's new. */
    opened: (path: string, created: boolean) => void;
}

export class NewNotePanel {
    private panel: HTMLElement | null = null;
    private input: HTMLInputElement | null = null;
    private chips: HTMLElement | null = null;
    private preview: HTMLElement | null = null;
    private folder = '';
    private onKey: ((event: KeyboardEvent) => void) | null = null;
    private onPointer: ((event: PointerEvent) => void) | null = null;
    private busy = false;

    constructor(private container: HTMLElement, private host: NewNoteHost) {}

    get isOpen(): boolean {
        return this.panel !== null;
    }

    open(): void {
        if (this.isOpen) this.close();
        this.folder = this.host.defaultFolder();

        this.panel = this.container.createDiv({ cls: 'sh-glass sh-quickadd sh-newnote' });
        const field = this.panel.createDiv({ cls: 'sh-quickadd-field' });
        this.input = field.createEl('input', { cls: 'sh-quickadd-input', type: 'text' });
        this.input.placeholder = t('tasksTab.newNote.placeholder');
        this.input.addEventListener('input', () => this.paintPreview());
        this.chips = this.panel.createDiv({ cls: 'sh-quickadd-chips' });
        this.preview = this.panel.createDiv({ cls: 'sh-quickadd-preview' });

        const foot = this.panel.createDiv({ cls: 'sh-palette-foot' });
        if (Platform.isMobile) {
            foot.addClass('is-touch');
            const cancel = foot.createEl('button', { cls: 'sh-quickadd-button', text: t('tasksTab.quickAdd.cancelButton') });
            cancel.addEventListener('click', () => this.close());
            const create = foot.createEl('button', { cls: 'sh-quickadd-button mod-cta', text: t('tasksTab.newNote.createButton') });
            create.addEventListener('click', () => void this.submit());
        } else {
            hint(foot, '↵', t('tasksTab.newNote.create'));
            hint(foot, '/', t('tasksTab.newNote.folder'));
            hint(foot, 'esc', t('tasksTab.quickAdd.close'));
        }

        this.onKey = (event: KeyboardEvent) => this.handleKey(event);
        document.addEventListener('keydown', this.onKey, true);
        // A click outside puts it away, as in quick add.
        this.onPointer = (event: PointerEvent) => {
            if (!this.panel || this.panel.hasClass('is-hidden')) return;
            if (!this.panel.contains(event.target as Node)) this.close();
        };
        document.addEventListener('pointerdown', this.onPointer, true);
        this.panel.addEventListener('mousedown', (event) => {
            if (event.target !== this.input) event.preventDefault();
        });

        this.paintChips();
        this.paintPreview();
        this.input.focus({ preventScroll: true });
    }

    close(): void {
        if (!this.isOpen) return;
        if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
        if (this.onPointer) document.removeEventListener('pointerdown', this.onPointer, true);
        this.onKey = null;
        this.onPointer = null;
        this.panel?.remove();
        this.panel = null;
        this.input = null;
        this.chips = null;
        this.preview = null;
        this.host.onClose();
    }

    /** Tucks the panel away while the folder picker is up. */
    private setHidden(hidden: boolean): void {
        this.panel?.toggleClass('is-hidden', hidden);
        if (!hidden) this.input?.focus({ preventScroll: true });
    }

    private name(): string {
        return cleanNoteName(this.input?.value ?? '');
    }

    private paintChips(): void {
        const chips = this.chips;
        if (!chips) return;
        chips.empty();
        const set = this.folder !== '';
        const chip = chips.createEl('button', { cls: 'sh-chip' });
        chip.toggleClass('is-set', set);
        setIcon(chip.createSpan({ cls: 'sh-chip-icon' }), set ? 'folder' : 'folder-x');
        chip.createSpan({ cls: 'sh-chip-label', text: set ? this.folder.split('/').pop() ?? this.folder : t('tasksTab.newNote.noFolder') });
        if (set) chip.setAttr('aria-label', this.folder);
        chip.addEventListener('mousedown', (event) => event.preventDefault());
        chip.addEventListener('click', () => this.chooseFolder());
        if (set) {
            const clear = chip.createSpan({ cls: 'sh-chip-clear' });
            setIcon(clear, 'x');
            clear.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setFolder('');
            });
        }
    }

    private paintPreview(): void {
        const preview = this.preview;
        if (!preview) return;
        preview.empty();
        const name = this.name();
        preview.toggleClass('is-empty', name === '');
        const path = newNotePath(this.folder, name || t('tasksTab.newNote.placeholder'));
        const existing = name ? this.host.existing(path) : null;
        preview.createEl('code', { text: existing ?? path });
        if (existing) preview.createSpan({ cls: 'sh-newnote-exists', text: t('tasksTab.newNote.exists') });
    }

    private setFolder(folder: string): void {
        this.folder = folder;
        this.paintChips();
        this.paintPreview();
        this.input?.focus({ preventScroll: true });
    }

    private chooseFolder(): void {
        this.setHidden(true);
        this.host.chooseFolder((folder) => {
            this.setHidden(false);
            this.setFolder(folder);
        }, this.folder);
    }

    /** Called by the tab when the folder picker closes without a pick. */
    reveal(): void {
        this.setHidden(false);
    }

    private handleKey(event: KeyboardEvent): void {
        if (!this.isOpen || !this.input || this.panel?.hasClass('is-hidden')) return;
        const active = document.activeElement;
        const inTab = !active || active === document.body || this.container.contains(active);
        if (!inTab) return;
        const onChip = active instanceof HTMLButtonElement && this.panel?.contains(active) === true;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }
        if (event.key === 'Enter' && !event.isComposing && !onChip) {
            event.preventDefault();
            event.stopPropagation();
            void this.submit();
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            const stops: HTMLElement[] = [this.input, ...Array.from(this.panel?.querySelectorAll<HTMLElement>('button.sh-chip') ?? [])];
            const at = stops.findIndex(stop => stop === active);
            stops[at === -1 ? 0 : (at + 1) % stops.length].focus({ preventScroll: true });
            return;
        }
        // A slash can't go in a note's name, so it picks the folder, the way it picks the note in quick add.
        if (event.key === '/' && !event.metaKey && !event.ctrlKey && active === this.input) {
            event.preventDefault();
            this.chooseFolder();
        }
    }

    private async submit(): Promise<void> {
        const name = this.name();
        if (this.busy || !name) return;
        const path = newNotePath(this.folder, name);
        const existing = this.host.existing(path);
        if (existing) {
            this.close();
            this.host.opened(existing, false);
            return;
        }
        this.busy = true;
        let made: string | null = null;
        try {
            made = await this.host.submit(path);
        } finally {
            this.busy = false;
        }
        if (!made) return;
        this.close();
        this.host.opened(made, true);
    }
}
