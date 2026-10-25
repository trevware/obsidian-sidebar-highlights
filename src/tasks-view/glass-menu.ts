import { setIcon } from 'obsidian';

export interface GlassMenuItem {
    label: string;
    icon?: string;
    /** Draws the icon gutter itself, for a row that shows a task glyph or a flag. */
    paintIcon?: (el: HTMLElement) => void;
    checked?: boolean;
    /** Right-hand text, such as a shortcut. */
    detail?: string;
    destructive?: boolean;
    /** A rule above this row. */
    divider?: boolean;
    run: () => void;
}

/**
 * A small menu on the glass surface, for the places Obsidian's own Menu would
 * otherwise show (a row's right-click, the quick add chips), so every popup in
 * the Tasks tab is the same material as Oriko's. Arrow keys move, Enter picks,
 * Escape or a click outside closes.
 */
export class GlassMenu {
    private el: HTMLElement | null = null;
    private rows: HTMLElement[] = [];
    private items: GlassMenuItem[] = [];
    private active = -1;
    private onKey: ((event: KeyboardEvent) => void) | null = null;
    private onDown: ((event: MouseEvent) => void) | null = null;
    private onClosed: (() => void) | null = null;

    constructor(private container: HTMLElement) {}

    get isOpen(): boolean {
        return this.el !== null;
    }

    /** Opens at a pointer position (a right-click). */
    showAtEvent(event: MouseEvent, items: GlassMenuItem[], onClosed?: () => void): void {
        const host = this.container.getBoundingClientRect();
        this.open(items, onClosed);
        this.place(event.clientX - host.left, event.clientY - host.top);
    }

    /** Opens under an element (a chip or a button). */
    showBelow(anchor: HTMLElement, items: GlassMenuItem[], onClosed?: () => void): void {
        const host = this.container.getBoundingClientRect();
        const rect = anchor.getBoundingClientRect();
        this.open(items, onClosed);
        this.place(rect.left - host.left, rect.bottom - host.top + 6);
    }

    close(): void {
        if (!this.el) return;
        if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
        if (this.onDown) document.removeEventListener('mousedown', this.onDown, true);
        this.onKey = null;
        this.onDown = null;
        this.el.remove();
        this.el = null;
        this.rows = [];
        const closed = this.onClosed;
        this.onClosed = null;
        closed?.();
    }

    private open(items: GlassMenuItem[], onClosed?: () => void): void {
        this.close();
        this.items = items;
        this.onClosed = onClosed ?? null;
        this.active = -1;

        const el = this.container.createDiv({ cls: 'sh-glass sh-menu' });
        this.el = el;
        const iconless = !items.some(item => item.icon || item.paintIcon || item.checked !== undefined);
        el.toggleClass('is-iconless', iconless);

        items.forEach((item, index) => {
            if (item.divider && index > 0) el.createDiv({ cls: 'sh-menu-divider' });
            const row = el.createDiv({ cls: 'sh-menu-item' });
            if (item.destructive) row.addClass('is-destructive');
            const icon = row.createDiv({ cls: 'sh-menu-check' });
            if (item.paintIcon) item.paintIcon(icon);
            else if (item.icon) setIcon(icon, item.icon);
            else if (item.checked) setIcon(icon, 'check');
            if (item.checked) row.addClass('is-checked');
            row.createDiv({ cls: 'sh-menu-label', text: item.label });
            if (item.detail) row.createDiv({ cls: 'sh-menu-detail', text: item.detail });
            row.addEventListener('mouseenter', () => this.paint(index));
            row.addEventListener('mousedown', (event) => event.preventDefault());
            row.addEventListener('click', (event) => {
                event.stopPropagation();
                this.choose(index);
            });
            this.rows.push(row);
        });

        this.onKey = (event: KeyboardEvent) => {
            if (!this.el) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.close();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                const delta = event.key === 'ArrowDown' ? 1 : -1;
                const count = this.rows.length;
                this.paint(this.active === -1 ? (delta > 0 ? 0 : count - 1) : (this.active + delta + count) % count);
            } else if (event.key === 'Enter' && this.active !== -1) {
                event.preventDefault();
                event.stopPropagation();
                this.choose(this.active);
            }
        };
        document.addEventListener('keydown', this.onKey, true);

        this.onDown = (event: MouseEvent) => {
            if (this.el && !this.el.contains(event.target as Node)) this.close();
        };
        // Next tick, so the click that opened the menu doesn't also close it.
        window.setTimeout(() => {
            if (this.onDown) document.addEventListener('mousedown', this.onDown, true);
        });
    }

    /** Kept inside the pane, flipping up or left when it would run off an edge. */
    private place(x: number, y: number): void {
        const el = this.el;
        if (!el) return;
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const maxX = this.container.clientWidth - width - 8;
        const maxY = this.container.clientHeight - height - 8;
        const left = Math.max(8, Math.min(x, maxX));
        const top = y > maxY ? Math.max(8, y - height - 12) : y;
        el.setCssProps({ left: `${left}px`, top: `${top}px` });
    }

    private paint(index: number): void {
        this.active = index;
        this.rows.forEach((row, i) => row.toggleClass('is-active', i === index));
    }

    private choose(index: number): void {
        const item = this.items[index];
        this.close();
        item?.run();
    }
}
