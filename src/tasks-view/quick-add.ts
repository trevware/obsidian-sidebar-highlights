import { Platform, setIcon } from 'obsidian';
import { GlassMenu } from './glass-menu';
import type { GlassMenuItem } from './glass-menu';
import { parseQuickAdd } from './quick-parse';
import type { QuickParse } from './quick-parse';
import { buildTaskLine } from './task-line';
import { capitalizeFirst, capitalizeTyped } from './capitalize';
import { addDays, startOfWeek, weekday } from './dates';
import { hint } from './glass-palette';
import { t } from '../i18n';

export interface Destination {
    path: string;
    heading?: string;
    /** Which of two headings with the same name. */
    headingLine?: number;
    /** A task to add under, as a subtask. */
    parent?: { line: number; text: string; title: string };
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
    /** The day a new task starts on in the list on screen: today, in Today. */
    defaultDate: () => string | undefined;
    chooseDestination: (done: (destination: Destination) => void) => void;
    /** Writes the lines; resolves false when nothing could be written. */
    submit: (lines: string[], destination: Destination) => Promise<boolean>;
    /** Whether a task's first word gets a capital letter. */
    capitalize: () => boolean;
    onClose: () => void;
}

/**
 * The Markdown line for what was typed, or null when it's nothing but a date
 * or a priority. A date or priority picked from a chip fills in for one that
 * wasn't typed.
 */
export function taskLineFor(
    parsed: QuickParse,
    host: Pick<QuickAddHost, 'formatDate' | 'capitalize'>,
    fallback: { date?: string; priority?: 1 | 2 | 3 } = {}
): string | null {
    if (parsed.title === '') return null;
    const date = parsed.date ?? fallback.date;
    return buildTaskLine({
        text: host.capitalize() ? capitalizeFirst(parsed.title) : parsed.title,
        priority: parsed.priority ?? fallback.priority,
        date: date ? host.formatDate(date) : undefined
    });
}

/** Pasted text as one entry per line, without list bullets or checkboxes. */
export function pastedEntries(text: string): string[] {
    return text.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*+]\s+)?(?:\[.\]\s+)?/, '').trim()).filter(Boolean);
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
    private onPointer: ((event: PointerEvent) => void) | null = null;
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
        // An empty draft goes where it's opened from; one with words in it
        // keeps the note picked for them.
        if (!this.draft.destination || (!prefill.destination && this.draft.text.trim() === '')) {
            this.draft.destination = this.host.defaultDestination() ?? undefined;
        }
        // An empty draft takes the list's day the same way, so a task added
        // in Today is due today and stays in sight.
        if (!prefill.date && this.draft.text.trim() === '') this.draft.date = this.host.defaultDate();

        this.panel = this.container.createDiv({ cls: 'sh-glass sh-quickadd' });
        const field = this.panel.createDiv({ cls: 'sh-quickadd-field' });
        this.mirror = field.createDiv({ cls: 'sh-quickadd-mirror' });
        this.input = field.createEl('input', { cls: 'sh-quickadd-input', type: 'text' });
        this.input.placeholder = t('tasksTab.quickAdd.placeholder');
        if (this.host.capitalize()) this.input.setAttr('autocapitalize', 'sentences');
        this.input.value = this.draft.text;
        this.input.addEventListener('input', (event) => {
            if (!this.input) return;
            if (this.host.capitalize() && !(event as InputEvent).isComposing) capitalizeTyped(this.input);
            this.draft.text = this.input.value;
            this.refresh();
        });
        this.input.addEventListener('scroll', () => this.syncScroll());
        this.input.addEventListener('paste', (event) => this.handlePaste(event));

        this.chips = this.panel.createDiv({ cls: 'sh-quickadd-chips' });
        this.preview = this.panel.createDiv({ cls: 'sh-quickadd-preview' });

        const foot = this.panel.createDiv({ cls: 'sh-palette-foot' });
        if (Platform.isMobile) {
            // No Escape or ⌘ on a phone's keyboard, so the footer becomes the
            // two buttons that matter.
            foot.addClass('is-touch');
            const cancel = foot.createEl('button', { cls: 'sh-quickadd-button', text: t('tasksTab.quickAdd.cancelButton') });
            cancel.addEventListener('click', () => this.close(true));
            const add = foot.createEl('button', { cls: 'sh-quickadd-button mod-cta', text: t('tasksTab.quickAdd.addButton') });
            add.addEventListener('click', () => void this.submit(false));
        } else {
            hint(foot, '↵', t('tasksTab.quickAdd.add'));
            hint(foot, '⌘↵', t('tasksTab.quickAdd.addAnother'));
            hint(foot, '/', t('tasksTab.quickAdd.note'));
            hint(foot, 'esc', t('tasksTab.quickAdd.close'));
        }

        this.onKey = (event: KeyboardEvent) => this.handleKey(event);
        document.addEventListener('keydown', this.onKey, true);
        // A click outside puts it away, the way Escape does; a click on the
        // panel itself keeps the cursor in the field.
        this.onPointer = (event: PointerEvent) => {
            if (!this.panel || this.menu.isOpen || this.panel.hasClass('is-hidden')) return;
            if (!this.panel.contains(event.target as Node)) this.close(true);
        };
        document.addEventListener('pointerdown', this.onPointer, true);
        this.panel.addEventListener('mousedown', (event) => {
            if (event.target !== this.input) event.preventDefault();
        });

        this.refresh();
        this.input.focus({ preventScroll: true });
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }

    /** `keepDraft` is false after a successful add, so the next open starts empty. */
    close(keepDraft = true): void {
        if (!this.isOpen) return;
        if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
        if (this.onPointer) document.removeEventListener('pointerdown', this.onPointer, true);
        this.onKey = null;
        this.onPointer = null;
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
        return taskLineFor(parsed, this.host, fallback);
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
            () => this.chooseNote());
    }

    private chooseNote(): void {
        this.host.chooseDestination((chosen) => {
            this.draft.destination = chosen;
            this.refresh();
            this.input?.focus({ preventScroll: true });
        });
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
        if (this.menu.isOpen || this.panel?.hasClass('is-hidden')) return;

        // Escape and Enter work wherever the cursor went in the tab, even
        // after something took it out of the field, and typing goes back
        // into the field. Another field in the tab keeps its own keys.
        const active = document.activeElement;
        const inTab = !active || active === document.body || this.container.contains(active);
        const otherField = active !== this.input && active instanceof HTMLElement
            && active.closest('input, textarea, [contenteditable="true"]') !== null;
        // A chip has focus: Enter and Space press it, as on any button.
        const onChip = active instanceof HTMLButtonElement && this.panel?.contains(active) === true;
        if (event.key === 'Tab' && inTab && !otherField) {
            event.preventDefault();
            event.stopPropagation();
            this.cycleFocus(active, event.shiftKey);
            return;
        }
        if (event.key === 'Escape' && inTab) {
            event.preventDefault();
            event.stopPropagation();
            this.close(true);
            return;
        }
        if (event.key === 'Enter' && !event.isComposing && inTab && !otherField && !onChip) {
            event.preventDefault();
            event.stopPropagation();
            void this.submit(event.metaKey || event.ctrlKey);
            return;
        }
        if (active !== this.input) {
            const typing = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
            if (typing && event.key !== ' ' && inTab && !otherField) this.input.focus({ preventScroll: true });
            return;
        }

        // A slash starting a word picks the note, the way Todoist's # picks a project.
        if (event.key === '/' && !event.metaKey && !event.ctrlKey && this.input.selectionStart === this.input.selectionEnd) {
            const before = this.input.value.slice(0, this.input.selectionStart ?? 0);
            if (before === '' || /\s$/.test(before)) {
                event.preventDefault();
                this.chooseNote();
                return;
            }
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

    /** Tab and Shift-Tab go round the field and the chips, and stay in the panel. */
    private cycleFocus(active: Element | null, back: boolean): void {
        if (!this.input || !this.panel) return;
        const stops: HTMLElement[] = [this.input, ...Array.from(this.panel.querySelectorAll<HTMLElement>('button.sh-chip'))];
        const at = stops.findIndex(stop => stop === active);
        const next = at === -1 ? 0 : (at + (back ? -1 : 1) + stops.length) % stops.length;
        stops[next].focus({ preventScroll: true });
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

        // A save that fails leaves the draft in place to try again, and never
        // leaves quick add stuck ignoring Enter.
        this.busy = true;
        let ok = false;
        try {
            ok = await this.host.submit([line], destination);
        } catch (error) {
            console.error('Sidebar Highlights: adding the task failed', error);
        } finally {
            this.busy = false;
        }
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
        const pasted = pastedEntries(text);
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
