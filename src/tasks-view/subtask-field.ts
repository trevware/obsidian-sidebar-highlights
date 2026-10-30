import { setIcon } from 'obsidian';
import { pastedEntries, taskLineFor } from './quick-add';
import type { QuickAddHost } from './quick-add';
import { parseQuickAdd } from './quick-parse';
import type { QuickParse } from './quick-parse';
import { capitalizeTyped } from './capitalize';
import { t } from '../i18n';

export interface SubtaskFieldHost extends Pick<QuickAddHost, 'today' | 'formatDate' | 'capitalize'> {
    /** Writes the lines under the task; resolves false when nothing could be written. */
    submit: (lines: string[]) => Promise<boolean>;
    /** The field closed: with a key (Escape, or ↵ on an empty field), or by clicking away. */
    onClose: (byKey: boolean) => void;
}

/**
 * A field in the open card for typing subtasks. Dates and priorities are read
 * as you type and tinted, as in quick add, and Backspace right after one turns
 * it back into words. ↵ adds the subtask and leaves the field ready for the
 * next, Escape closes it, and clicking away adds what was typed.
 *
 * The field outlives a redraw of the list: the card it sits in is rebuilt
 * after every add, and takes the same field back with its text and focus.
 */
export class SubtaskField {
    readonly el: HTMLElement;
    private input: HTMLInputElement;
    private mirror: HTMLElement;
    private ignored = new Set<string>();
    private parsed: QuickParse = { title: '', tokens: [] };
    private busy = false;
    private closed = false;

    constructor(readonly key: string, private host: SubtaskFieldHost) {
        this.el = createDiv({ cls: 'sh-card-subtask' });
        setIcon(this.el.createSpan({ cls: 'sh-card-subtask-icon' }), 'corner-down-right');
        const field = this.el.createDiv({ cls: 'sh-card-subtask-field' });
        this.mirror = field.createDiv({ cls: 'sh-card-subtask-mirror' });
        this.input = field.createEl('input', { cls: 'sh-card-subtask-input', type: 'text' });
        this.input.placeholder = t('tasksTab.card.subtaskPlaceholder');
        this.input.spellcheck = true;
        if (host.capitalize()) this.input.setAttr('autocapitalize', 'sentences');

        this.input.addEventListener('input', (event) => {
            if (host.capitalize() && !(event as InputEvent).isComposing) capitalizeTyped(this.input);
            this.refresh();
        });
        this.input.addEventListener('scroll', () => this.syncScroll());
        this.input.addEventListener('paste', (event) => this.handlePaste(event));
        this.input.addEventListener('keydown', (event) => this.handleBackspace(event));
        this.input.addEventListener('focus', () => window.addEventListener('keydown', this.onWindowKey, true));
        this.input.addEventListener('blur', () => {
            window.removeEventListener('keydown', this.onWindowKey, true);
            // A redraw takes the field off the page (blurring it on the way)
            // and puts it back in the new card with focus, so a blur only
            // counts once the field is still on the page without it.
            window.setTimeout(() => {
                if (this.closed || document.activeElement === this.input || !this.input.isConnected) return;
                void this.commit();
            }, 0);
        });
    }

    focus(): void {
        if (!this.closed) this.input.focus({ preventScroll: true });
    }

    /** Adds what was typed, if anything, and closes. */
    async commit(): Promise<void> {
        if (this.closed) return;
        const lines = this.lines();
        this.close(false);
        if (lines.length > 0) await this.host.submit(lines);
    }

    close(byKey: boolean): void {
        if (this.closed) return;
        this.closed = true;
        window.removeEventListener('keydown', this.onWindowKey, true);
        this.el.remove();
        this.host.onClose(byKey);
    }

    // Caught at the window, where Obsidian's own hotkeys listen, so Enter and
    // Escape reach the field first.
    private onWindowKey = (event: KeyboardEvent) => {
        if (document.activeElement !== this.input || event.isComposing) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.close(true);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopImmediatePropagation();
            void this.submit();
        }
    };

    private lines(): string[] {
        const line = taskLineFor(this.parsed, this.host);
        return line ? [line] : [];
    }

    private async submit(): Promise<void> {
        if (this.busy) return;
        const lines = this.lines();
        if (lines.length === 0) {
            this.close(true);
            return;
        }
        // Cleared straight away, so the next subtask can be typed while this
        // one is written; it comes back if the write fails.
        const typed = this.input.value;
        const ignored = new Set(this.ignored);
        this.input.value = '';
        this.ignored.clear();
        this.refresh();

        this.busy = true;
        let ok = false;
        try {
            ok = await this.host.submit(lines);
        } catch (error) {
            console.error('Sidebar Highlights: adding the subtask failed', error);
        } finally {
            this.busy = false;
        }
        if (!ok && this.input.value === '') {
            this.input.value = typed;
            this.ignored = ignored;
            this.refresh();
        }
    }

    private refresh(): void {
        this.parsed = parseQuickAdd(this.input.value, this.host.today(), this.ignored);
        const text = this.input.value;
        this.mirror.empty();
        let cursor = 0;
        for (const token of this.parsed.tokens) {
            if (token.start > cursor) this.mirror.createSpan({ text: text.slice(cursor, token.start) });
            this.mirror.createSpan({ cls: `sh-quickadd-token is-${token.kind}`, text: text.slice(token.start, token.end) });
            cursor = token.end;
        }
        if (cursor < text.length) this.mirror.createSpan({ text: text.slice(cursor) });
        this.syncScroll();
    }

    private syncScroll(): void {
        this.mirror.scrollLeft = this.input.scrollLeft;
    }

    /** Backspace right after a recognised phrase turns it back into words. */
    private handleBackspace(event: KeyboardEvent): void {
        if (event.key !== 'Backspace' || this.input.selectionStart !== this.input.selectionEnd) return;
        const caret = this.input.selectionStart ?? 0;
        const token = this.parsed.tokens.find(candidate => candidate.end === caret);
        if (!token) return;
        event.preventDefault();
        this.ignored.add(token.text.toLowerCase());
        this.refresh();
    }

    /** Several pasted lines become one subtask each. */
    private handlePaste(event: ClipboardEvent): void {
        const pasted = pastedEntries(event.clipboardData?.getData('text/plain') ?? '');
        if (pasted.length < 2) return;
        event.preventDefault();
        const today = this.host.today();
        const lines = pasted
            .map(entry => taskLineFor(parseQuickAdd(entry, today), this.host))
            .filter((line): line is string => line !== null);
        if (lines.length > 0) void this.host.submit(lines);
    }
}
