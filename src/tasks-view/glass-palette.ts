import { Platform, setIcon } from 'obsidian';
import { rank } from './fuzzy';
import type { MatchRange } from './fuzzy';

/**
 * One row the palette can show: a command, a list to go to, a note, or a task.
 */
export interface PaletteItem {
    id: string;
    label: string;
    section: string;
    icon?: string;
    /** Draws the left gutter itself, for a row that is a task and shows its checkbox. */
    paintIcon?: (el: HTMLElement) => void;
    /** Muted text after the label, such as a task's note and heading. */
    sublabel?: string;
    /** Right-hand text: a shortcut hint or a count. */
    detail?: string;
    /** Extra words to match on that the row never displays. */
    keywords?: string;
    /** A rule above this row, for grouping without a heading. */
    divider?: boolean;
    destructive?: boolean;
    /** Opens a second page instead of running. */
    stage?: PaletteStage;
    run?: () => void;
}

export interface PaletteStage {
    /** Shown as a chip in the input while the page is open. */
    title: string;
    placeholder: string;
    items: (query: string) => PaletteItem[];
    /**
     * The page reads the query itself (the date page parses "fri" into a day),
     * so its rows are shown as given instead of being ranked against it.
     */
    readsQuery?: boolean;
}

export interface PaletteSource {
    /** Placeholder for the root page. */
    placeholder: string;
    /** Rows for the root page, given what has been typed. */
    items: (query: string) => PaletteItem[];
    /** Section order; sections not listed go last in the order they appear. */
    sections: readonly string[];
    /** Called after the palette closes, to put focus back where it was. */
    onClose?: () => void;
}

interface Row {
    item: PaletteItem;
    ranges: MatchRange[];
}

const SECTION_LIMIT = 40;
const STAGE_LIMIT = 80;

/**
 * The Tasks tab's command palette, built on the same glass surface and
 * behaviour as Oriko's: one input that finds lists, notes and tasks and runs
 * commands on the highlighted or selected tasks, with a second page for the
 * commands that need an answer (which date, which priority, which status).
 *
 * It opens with no animation and closes on its own key, since a surface used
 * dozens of times a day should never make you wait for it.
 */
export class GlassPalette {
    private backdrop: HTMLElement | null = null;
    private panel: HTMLElement | null = null;
    private input: HTMLInputElement | null = null;
    private chipEl: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;
    private rows: Row[] = [];
    private rowEls: HTMLElement[] = [];
    private active = 0;
    private hoverArmed = false;
    private stage: PaletteStage | null = null;
    /** Backing out of a page returns to the row and query it was opened from. */
    private resume: { query: string; id: string } | null = null;
    /** The page was opened directly, so backing out of it closes the palette. */
    private direct = false;
    private onKey: ((event: KeyboardEvent) => void) | null = null;
    private source: PaletteSource | null = null;

    /**
     * The panel sits in `container`; the dim goes in `backdropHost`, which
     * can be wider (the whole tab, rail included), so it never stops at an
     * edge in the middle of the view.
     */
    constructor(private container: HTMLElement, private backdropHost: HTMLElement = container) {}

    get isOpen(): boolean {
        return this.panel !== null;
    }

    open(source: PaletteSource, stage?: PaletteStage): void {
        if (this.isOpen) this.close();
        this.source = source;

        this.backdrop = this.backdropHost.createDiv({ cls: 'sh-palette-backdrop' });
        this.backdrop.addEventListener('mousedown', (event) => {
            event.preventDefault();
            this.close();
        });

        this.panel = this.container.createDiv({ cls: 'sh-glass sh-palette' });
        const head = this.panel.createDiv({ cls: 'sh-palette-head' });
        setIcon(head.createDiv({ cls: 'sh-palette-search' }), 'search');
        this.chipEl = head.createDiv({ cls: 'sh-palette-chip' });
        this.input = head.createEl('input', { cls: 'sh-palette-input', type: 'text' });
        this.input.placeholder = source.placeholder;
        this.input.addEventListener('input', () => {
            this.active = 0;
            this.render();
        });

        this.listEl = this.panel.createDiv({ cls: 'sh-palette-list' });
        this.listEl.addEventListener('mousemove', (event) => {
            if (this.hoverArmed) return;
            this.hoverArmed = true;
            const target = event.target as HTMLElement | null;
            const row = this.rowEls.find(candidate => target && candidate.contains(target));
            if (row) this.hover(row);
        });

        // Keyboard hints, where there's a keyboard to use them.
        if (!Platform.isMobile) {
            const foot = this.panel.createDiv({ cls: 'sh-palette-foot' });
            hint(foot, '↑↓', 'navigate');
            hint(foot, '↵', 'select');
            hint(foot, 'esc', 'close');
        }

        this.onKey = (event: KeyboardEvent) => this.handleKey(event);
        document.addEventListener('keydown', this.onKey, true);

        if (stage) {
            this.direct = true;
            this.enterStage(stage);
        } else {
            this.render();
        }
        this.input.focus({ preventScroll: true });
    }

    close(): void {
        if (!this.isOpen) return;
        if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
        this.onKey = null;
        this.backdrop?.remove();
        this.panel?.remove();
        this.backdrop = null;
        this.panel = null;
        this.input = null;
        this.chipEl = null;
        this.listEl = null;
        this.rows = [];
        this.rowEls = [];
        this.stage = null;
        this.resume = null;
        this.direct = false;
        const onClose = this.source?.onClose;
        this.source = null;
        onClose?.();
    }

    private handleKey(event: KeyboardEvent): void {
        if (!this.isOpen) return;
        const mod = event.metaKey || event.ctrlKey;

        if (mod && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.close();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.stage && !this.direct) this.leaveStage();
            else this.close();
            return;
        }

        if (event.key === 'ArrowDown' || (event.ctrlKey && event.key.toLowerCase() === 'n')) {
            event.preventDefault();
            this.move(1);
            return;
        }

        if (event.key === 'ArrowUp' || (event.ctrlKey && event.key.toLowerCase() === 'p')) {
            event.preventDefault();
            this.move(-1);
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            const row = this.rows[this.active];
            if (row) this.choose(row.item);
            return;
        }

        const query = this.input?.value ?? '';
        if (event.key === 'ArrowRight' && this.input?.selectionStart === query.length) {
            const row = this.rows[this.active];
            if (row?.item.stage) {
                event.preventDefault();
                this.choose(row.item);
            }
            return;
        }

        if ((event.key === 'ArrowLeft' || event.key === 'Backspace') && this.stage && query === '') {
            event.preventDefault();
            if (this.direct) this.close();
            else this.leaveStage();
        }
    }

    private move(delta: number): void {
        if (this.rows.length === 0) return;
        this.active = (this.active + delta + this.rows.length) % this.rows.length;
        this.paintActive();
    }

    private choose(item: PaletteItem): void {
        if (item.stage) {
            this.resume = { query: this.input?.value ?? '', id: item.id };
            this.enterStage(item.stage);
            return;
        }
        // Closed first: several commands open something that wants the focus.
        this.close();
        item.run?.();
    }

    private enterStage(stage: PaletteStage): void {
        this.stage = stage;
        this.active = 0;
        if (this.input) {
            this.input.value = '';
            this.input.placeholder = stage.placeholder;
        }
        this.render();
        this.input?.focus({ preventScroll: true });
    }

    private leaveStage(): void {
        const resume = this.resume;
        this.stage = null;
        this.resume = null;
        if (this.input) {
            this.input.value = resume?.query ?? '';
            this.input.placeholder = this.source?.placeholder ?? '';
        }
        this.render();
        if (resume) {
            const index = this.rows.findIndex(row => row.item.id === resume.id);
            if (index !== -1) {
                this.active = index;
                this.paintActive();
            }
        }
        this.input?.focus({ preventScroll: true });
    }

    private collect(query: string): Row[] {
        if (this.stage) {
            // A page can be long (every note in the vault), so it shows the
            // best rows and lets the query narrow the rest.
            const items = this.stage.items(query);
            if (this.stage.readsQuery || query.trim() === '') return items.slice(0, STAGE_LIMIT).map(item => ({ item, ranges: [] }));
            return rank(query, items, item => ({ primary: item.label, secondary: item.keywords }))
                .slice(0, STAGE_LIMIT)
                .map(hit => ({ item: hit.item, ranges: hit.ranges }));
        }

        const items = this.source?.items(query) ?? [];
        if (query.trim() === '') return items.map(item => ({ item, ranges: [] }));

        const ranked = rank(query, items, item => ({
            primary: item.label,
            secondary: [item.sublabel, item.keywords].filter(Boolean).join(' ')
        }));

        // Grouped by section, each section ranked inside. Sections lead by their
        // best hit, so a task that contains the query outranks a command that
        // only scatters its letters; the source's order settles ties.
        const order = this.source?.sections ?? [];
        const sectionIndex = (section: string) => {
            const index = order.indexOf(section);
            return index === -1 ? order.length : index;
        };
        const best = new Map<string, number>();
        for (const hit of ranked) {
            best.set(hit.item.section, Math.max(best.get(hit.item.section) ?? -Infinity, hit.score));
        }
        const perSection = new Map<string, number>();
        return ranked
            .map((hit, i) => ({ hit, i }))
            .sort((a, b) =>
                (best.get(b.hit.item.section) ?? 0) - (best.get(a.hit.item.section) ?? 0) ||
                sectionIndex(a.hit.item.section) - sectionIndex(b.hit.item.section) ||
                a.i - b.i)
            .filter(({ hit }) => {
                const count = (perSection.get(hit.item.section) ?? 0) + 1;
                perSection.set(hit.item.section, count);
                return count <= SECTION_LIMIT;
            })
            .map(({ hit }) => ({ item: hit.item, ranges: hit.ranges }));
    }

    private render(): void {
        const list = this.listEl;
        if (!list) return;
        this.hoverArmed = false;
        list.empty();

        if (this.chipEl) {
            this.chipEl.empty();
            this.chipEl.toggleClass('is-visible', this.stage !== null);
            if (this.stage) this.chipEl.setText(this.stage.title);
        }

        this.rows = this.collect(this.input?.value ?? '');
        this.rowEls = [];

        if (this.rows.length === 0) {
            list.createDiv({ cls: 'sh-palette-empty', text: 'No matches' });
            return;
        }

        let section: string | null = null;
        for (const row of this.rows) {
            if (!this.stage && row.item.section !== section) {
                section = row.item.section;
                if (section) list.createDiv({ cls: 'sh-palette-section', text: section });
            }
            this.rowEls.push(this.paintRow(list, row));
        }

        if (this.active >= this.rows.length) this.active = this.rows.length - 1;
        this.paintActive();
    }

    private paintRow(list: HTMLElement, row: Row): HTMLElement {
        const { item } = row;
        if (item.divider && list.childElementCount > 0) list.createDiv({ cls: 'sh-palette-divider' });
        const el = list.createDiv({ cls: 'sh-palette-item' });
        if (item.destructive) el.addClass('is-destructive');

        const icon = el.createDiv({ cls: 'sh-palette-icon' });
        if (item.paintIcon) item.paintIcon(icon);
        else if (item.icon) setIcon(icon, item.icon);

        const text = el.createDiv({ cls: 'sh-palette-text' });
        paintLabel(text.createSpan({ cls: 'sh-palette-label' }), item.label, row.ranges);
        if (item.sublabel) text.createSpan({ cls: 'sh-palette-sublabel', text: item.sublabel });

        if (item.detail) el.createDiv({ cls: 'sh-palette-detail', text: item.detail });
        if (item.stage) setIcon(el.createDiv({ cls: 'sh-palette-arrow' }), 'chevron-right');

        el.addEventListener('mouseenter', () => {
            if (this.hoverArmed) this.hover(el);
        });
        el.addEventListener('mousedown', (event) => event.preventDefault());
        el.addEventListener('click', (event) => {
            event.stopPropagation();
            this.choose(item);
        });
        return el;
    }

    private hover(el: HTMLElement): void {
        const index = this.rowEls.indexOf(el);
        if (index === -1 || index === this.active) return;
        this.active = index;
        this.paintActive(false);
    }

    private paintActive(scroll = true): void {
        this.rowEls.forEach((el, index) => el.toggleClass('is-active', index === this.active));
        const row = this.rowEls[this.active];
        const list = this.listEl;
        if (!scroll || !row || !list) return;
        // Scroll the list only: scrollIntoView would also scroll the tab behind it.
        const top = row.offsetTop;
        const bottom = top + row.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
}

/** Writes a label with its matched runs marked. */
export function paintLabel(el: HTMLElement, label: string, ranges: MatchRange[]): void {
    if (ranges.length === 0) {
        el.setText(label);
        return;
    }
    let cursor = 0;
    for (const range of ranges) {
        if (range.start > cursor) el.createSpan({ text: label.slice(cursor, range.start) });
        el.createSpan({ cls: 'sh-palette-mark', text: label.slice(range.start, range.end) });
        cursor = range.end;
    }
    if (cursor < label.length) el.createSpan({ text: label.slice(cursor) });
}

export function hint(foot: HTMLElement, key: string, text: string): void {
    const item = foot.createDiv({ cls: 'sh-palette-hint' });
    item.createSpan({ cls: 'sh-key', text: key });
    item.createSpan({ text });
}
