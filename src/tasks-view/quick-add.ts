import { setIcon } from 'obsidian';
import { GlassMenu } from './glass-menu';
import type { GlassMenuItem } from './glass-menu';
import { parseQuickAdd } from './quick-parse';
import type { QuickParse } from './quick-parse';
import { buildTaskLine } from './task-line';
import { addDays, startOfWeek, weekday } from './dates';
import { hint } from './glass-palette';
import { t } from '../i18n';

export interface Destination {
    path: string;
    heading?: string;
}

export interface QuickAddPrefill {
    destination?: Destination;
    date?: string;
    priority?: 1 | 2 | 3;
}

export interface QuickAddHost {
    today: () => string;
    /** An ISO day in the vault's own date format, as it will be written. */
    formatDate: (iso: string) => string;
    /** An ISO day in words, for the chip: "Tomorrow", "Friday". */
    dateLabel: (iso: string) => string;
    destinationLabel: (destination: Destination) => string;
    defaultDestination: () => Destination | null;
    chooseDestination: (done: (destination: Destination) => void) => void;
    /** Writes the lines; resolves false when nothing could be written. */
    submit: (lines: string[], destination: Destination) => Promise<boolean>;
    onClose: () => void;
}

interface Draft {
    text: string;
    ignored: Set<string>;
    date?: string;
    priority?: 1 | 2 | 3;
    destination?: Destination;
}

/**
 * Quick add: one line on the glass surface that reads dates and priorities as
 * you type, Todoist style, and shows the exact Markdown line it will write
 * before it writes it, so there is never a doubt about what lands in the note.
 *
 * Recognised words are tinted in the field. A chip below names each one, and
 * its × turns the words back into plain text (as does Backspace right after
 * them). Dismissing keeps the draft for next time.
 */
export class QuickAdd {
    private panel: HTMLElement | null = null;
    private input: HTMLInputElement | null = null;
    private mirror: HTMLElement | null = null;
    private chips: HTMLElement | null = null;
    private preview: HTMLElement | null = null;
    private draft: Draft = { text: '', ignored: new Set() };
    private parsed: QuickParse = { title: '', tokens: [] };
    private onKey: ((event: KeyboardEvent) => void) | null = null;
    private busy = false;
    private menu: GlassMenu;

    constructor(private container: HTMLElement, private host: QuickAddHost) {
        this.menu = new GlassMenu(container);
    }

    /** Tucks the panel away while the note picker is up, keeping the draft and focus to return to. */
    setHidden(hidden: boolean): void {
        this.panel?.toggleClass('is-hidden', hidden);
        if (!hidden) this.input?.focus({ preventScroll: true });
    }

    get isOpen(): boolean {
        return this.panel !== null;
    }

    open(prefill: QuickAddPrefill = {}): void {
        if (this.isOpen) this.close(true);

        // A prefill (from a group's + button) starts fresh in that place; a
        // plain open picks up the draft that was left.
        if (prefill.destination || prefill.date || prefill.priority) {
            this.draft = { text: '', ignored: new Set(), ...prefill };
        }
        if (!this.draft.destination) this.draft.destination = this.host.defaultDestination() ?? undefined;

        this.panel = this.container.createDiv({ cls: 'sh-glass sh-quickadd' });
        const field = this.panel.createDiv({ cls: 'sh-quickadd-field' });
        this.mirror = field.createDiv({ cls: 'sh-quickadd-mirror' });
        this.input = field.createEl('input', { cls: 'sh-quickadd-input', type: 'text' });
        this.input.placeholder = t('tasksTab.quickAdd.placeholder');
        this.input.value = this.draft.text;
        this.input.addEventListener('input', () => {
            this.draft.text = this.input?.value ?? '';
            this.refresh();
        });
        this.input.addEventListener('scroll', () => this.syncScroll());
        this.input.addEventListener('paste', (event) => this.handlePaste(event));

        this.chips = this.panel.createDiv({ cls: 'sh-quickadd-chips' });
        this.preview = this.panel.createDiv({ cls: 'sh-quickadd-preview' });

        const foot = this.panel.createDiv({ cls: 'sh-palette-foot' });
        hint(foot, '↵', t('tasksTab.quickAdd.add'));
        hint(foot, '⌘↵', t('tasksTab.quickAdd.addAnother'));
        hint(foot, 'esc', t('tasksTab.quickAdd.close'));

        this.onKey = (event: KeyboardEvent) => this.handleKey(event);
        document.addEventListener('keydown', this.onKey, true);

        this.refresh();
        this.input.focus({ preventScroll: true });
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }

    /** `keepDraft` is false after a successful add, so the next open starts empty. */
    close(keepDraft = true): void {
        if (!this.isOpen) return;
        if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
        this.onKey = null;
        this.menu.close();
        this.panel?.remove();
        this.panel = null;
        this.input = null;
        this.mirror = null;
        this.chips = null;
        this.preview = null;
        if (!keepDraft) this.draft = { text: '', ignored: new Set(), destination: this.draft.destination };
        this.host.onClose();
    }

    private effectiveDate(): string | undefined {
        return this.parsed.date ?? this.draft.date;
    }

    private effectivePriority(): 1 | 2 | 3 | undefined {
        return this.parsed.priority ?? this.draft.priority;
    }

    private lineFor(parsed: QuickParse, fallback: Pick<Draft, 'date' | 'priority'>): string | null {
        // A line that is nothing but a date or a priority has no task in it.
        if (parsed.title === '') return null;
        const date = parsed.date ?? fallback.date;
        return buildTaskLine({
            text: parsed.title,
            priority: parsed.priority ?? fallback.priority,
            date: date ? this.host.formatDate(date) : undefined
        });
    }

    private refresh(): void {
        this.parsed = parseQuickAdd(this.draft.text, this.host.today(), this.draft.ignored);
        this.paintMirror();
        this.paintChips();
        this.paintPreview();
    }

    private paintMirror(): void {
        const mirror = this.mirror;
        if (!mirror) return;
        mirror.empty();
        const text = this.draft.text;
        let cursor = 0;
        for (const token of this.parsed.tokens) {
            if (token.start > cursor) mirror.createSpan({ text: text.slice(cursor, token.start) });
            mirror.createSpan({ cls: `sh-quickadd-token is-${token.kind}`, text: text.slice(token.start, token.end) });
            cursor = token.end;
        }
        if (cursor < text.length) mirror.createSpan({ text: text.slice(cursor) });
        this.syncScroll();
    }

    private syncScroll(): void {
        if (this.mirror && this.input) this.mirror.scrollLeft = this.input.scrollLeft;
    }

    private paintChips(): void {
        const chips = this.chips;
        if (!chips) return;
        chips.empty();

        const date = this.effectiveDate();
        const dateToken = this.parsed.tokens.find(token => token.kind === 'date');
        this.chip(chips, 'calendar', date ? this.host.dateLabel(date) : t('tasksTab.quickAdd.date'), !!date,
            (chip) => this.dateMenu(chip),
            date ? () => {
                if (dateToken) this.unparse(dateToken.text);
                else this.draft.date = undefined;
                this.refresh();
            } : undefined);

        const priority = this.effectivePriority();
        const priorityToken = this.parsed.tokens.find(token => token.kind === 'priority');
        const priorityChip = this.chip(chips, 'flag', priority ? `P${priority}` : t('tasksTab.quickAdd.priority'), !!priority,
            (chip) => this.priorityMenu(chip),
            priority ? () => {
                if (priorityToken) this.unparse(priorityToken.text);
                else this.draft.priority = undefined;
                this.refresh();
            } : undefined);
        if (priority) priorityChip.dataset.priority = String(priority);

        const destination = this.draft.destination;
        this.chip(chips, 'file-text', destination ? this.host.destinationLabel(destination) : t('tasksTab.quickAdd.chooseNote'), !!destination,
            () => this.host.chooseDestination((chosen) => {
                this.draft.destination = chosen;
                this.refresh();
                this.input?.focus({ preventScroll: true });
            }));
    }

    private chip(parent: HTMLElement, icon: string, label: string, set: boolean, onClick: (chip: HTMLElement) => void, onClear?: () => void): HTMLElement {
        const chip = parent.createEl('button', { cls: 'sh-chip' });
        chip.toggleClass('is-set', set);
        setIcon(chip.createSpan({ cls: 'sh-chip-icon' }), icon);
        chip.createSpan({ cls: 'sh-chip-label', text: label });
        chip.addEventListener('mousedown', (event) => event.preventDefault());
        chip.addEventListener('click', () => onClick(chip));
        if (onClear) {
            const clear = chip.createSpan({ cls: 'sh-chip-clear' });
            setIcon(clear, 'x');
            clear.addEventListener('click', (event) => {
                event.stopPropagation();
                onClear();
                this.input?.focus({ preventScroll: true });
            });
        }
        return chip;
    }

    private paintPreview(): void {
        const preview = this.preview;
        if (!preview) return;
        preview.empty();
        const line = this.lineFor(this.parsed, this.draft);
        preview.toggleClass('is-empty', line === null);
        preview.createEl('code', { text: line ?? buildTaskLine({ text: t('tasksTab.quickAdd.previewEmpty') }) });
    }

    private unparse(text: string): void {
        this.draft.ignored.add(text.toLowerCase());
    }

    /** Picking a chip value replaces a typed phrase for the same thing. */
    private removeToken(kind: 'date' | 'priority'): void {
        const token = this.parsed.tokens.find(candidate => candidate.kind === kind);
        if (!token || !this.input) return;
        const text = this.draft.text;
        this.draft.text = (text.slice(0, token.start) + text.slice(token.end)).replace(/\s{2,}/g, ' ');
        this.input.value = this.draft.text;
    }

    private dateMenu(chip: HTMLElement): void {
        const today = this.host.today();
        const saturday = weekday(today) === 6 ? today : addDays(today, (6 - weekday(today) + 7) % 7);
        const options: Array<[string, string | undefined, string]> = [
            [t('tasksTab.dates.today'), today, 'sun'],
            [t('tasksTab.dates.tomorrow'), addDays(today, 1), 'sunrise'],
            [t('tasksTab.dates.weekend'), saturday, 'sofa'],
            [t('tasksTab.dates.nextWeek'), addDays(startOfWeek(today), 7), 'calendar-range'],
            [t('tasksTab.dates.noDate'), undefined, 'calendar-x']
        ];
        const current = this.effectiveDate();
        const items: GlassMenuItem[] = options.map(([label, iso, icon], index) => ({
            label,
            icon,
            detail: iso && label !== this.host.dateLabel(iso) ? this.host.dateLabel(iso) : undefined,
            checked: current === iso,
            divider: index === options.length - 1,
            run: () => {
                this.removeToken('date');
                this.draft.date = iso;
                this.refresh();
            }
        }));
        this.menu.showBelow(chip, items, () => this.input?.focus({ preventScroll: true }));
    }

    private priorityMenu(chip: HTMLElement): void {
        const levels: Array<1 | 2 | 3 | undefined> = [1, 2, 3, undefined];
        const current = this.effectivePriority();
        const items: GlassMenuItem[] = levels.map(level => ({
            label: level ? t(`tasksTab.priority.p${level}`) : t('tasksTab.priority.none'),
            paintIcon: (el: HTMLElement) => {
                const flag = el.createDiv({ cls: 'sh-flag' });
                if (level) flag.dataset.priority = String(level);
                setIcon(flag, level ? 'flag' : 'flag-off');
            },
            detail: level ? `p${level}` : undefined,
            checked: current === level,
            divider: level === undefined,
            run: () => {
                this.removeToken('priority');
                this.draft.priority = level;
                this.refresh();
            }
        }));
        this.menu.showBelow(chip, items, () => this.input?.focus({ preventScroll: true }));
    }

    private handleKey(event: KeyboardEvent): void {
        if (!this.isOpen || !this.input) return;
        // A menu or the note picker is up over the panel and owns the keys.
        if (this.menu.isOpen || document.activeElement !== this.input) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close(true);
            return;
        }

        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            void this.submit(event.metaKey || event.ctrlKey);
            return;
        }

        // Backspace right after a recognised phrase turns it back into text,
        // the way TickTick lets you cancel a recognised date.
        if (event.key === 'Backspace' && this.input.selectionStart === this.input.selectionEnd) {
            const caret = this.input.selectionStart ?? 0;
            const token = this.parsed.tokens.find(candidate => candidate.end === caret);
            if (token) {
                event.preventDefault();
                this.unparse(token.text);
                this.refresh();
            }
        }
    }

    private async submit(keepOpen: boolean): Promise<void> {
        if (this.busy) return;
        const destination = this.draft.destination;
        const line = this.lineFor(this.parsed, this.draft);
        if (!line) return;
        if (!destination) {
            this.host.chooseDestination((chosen) => {
                this.draft.destination = chosen;
                this.refresh();
                this.input?.focus({ preventScroll: true });
            });
            return;
        }

        this.busy = true;
        const ok = await this.host.submit([line], destination);
        this.busy = false;
        if (!ok) return;

        if (keepOpen && this.input) {
            this.draft = { text: '', ignored: new Set(), destination, date: this.draft.date, priority: this.draft.priority };
            this.input.value = '';
            this.refresh();
            this.input.focus({ preventScroll: true });
        } else {
            this.close(false);
        }
    }

    /** Several pasted lines become one task each, every line read on its own. */
    private handlePaste(event: ClipboardEvent): void {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const pasted = text.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*+]\s+)?(?:\[.\]\s+)?/, '').trim()).filter(Boolean);
        if (pasted.length < 2) return;
        event.preventDefault();

        const destination = this.draft.destination;
        if (!destination) return;
        const today = this.host.today();
        const lines = pasted
            .map(entry => this.lineFor(parseQuickAdd(entry, today), this.draft))
            .filter((line): line is string => line !== null);
        void this.host.submit(lines, destination).then(ok => {
            if (ok) this.close(false);
        });
    }
}
