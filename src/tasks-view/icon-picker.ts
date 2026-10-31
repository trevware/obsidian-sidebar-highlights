/**
 * Choosing an icon for a note: the palette's glass panel and search box over
 * a grid of icons, in categories until you type, then every Lucide icon that
 * matches. Arrow keys move through the grid, ↵ picks, Esc closes.
 */

import { Platform, setIcon } from 'obsidian';
import { hint } from './glass-palette';
import { iconSections } from './icon-sets';
import { t } from '../i18n';

interface Cell {
    el: HTMLElement;
    icon: string;
}

export class IconPicker {
    private backdrop: HTMLElement | null = null;
    private panel: HTMLElement | null = null;
    private input: HTMLInputElement | null = null;
    private body: HTMLElement | null = null;
    private cells: Cell[] = [];
    private active = 0;
    private current: string | undefined;
    private done: ((icon: string | null) => void) | null = null;
    private onClosed: (() => void) | undefined;
    private onKey: ((event: KeyboardEvent) => void) | null = null;

    /**
     * The panel sits in `container`, the dim in `backdropHost`, the same as
     * the palette's. `available` lists the Lucide icons this Obsidian has.
     */
    constructor(private container: HTMLElement, private backdropHost: HTMLElement, private available: () => string[]) {}

    get isOpen(): boolean {
        return this.panel !== null;
    }

    /**
     * Opens the picker for something named `title`. `done` gets the icon
     * picked, or null for Remove icon, which shows when there's a `current`
     * one.
     */
    open(title: string, current: string | undefined, done: (icon: string | null) => void, onClosed?: () => void): void {
        if (this.isOpen) this.close();
        this.current = current;
        this.done = done;
        this.onClosed = onClosed;

        this.backdrop = this.backdropHost.createDiv({ cls: 'sh-palette-backdrop' });
        this.backdrop.addEventListener('mousedown', (event) => {
            event.preventDefault();
            this.close();
        });

        this.panel = this.container.createDiv({ cls: 'sh-glass sh-palette sh-icon-picker' });
        const head = this.panel.createDiv({ cls: 'sh-palette-head' });
        setIcon(head.createDiv({ cls: 'sh-palette-search' }), 'search');
        head.createDiv({ cls: 'sh-palette-chip is-visible', text: title });
        this.input = head.createEl('input', { cls: 'sh-palette-input', type: 'text' });
        this.input.placeholder = t('tasksTab.iconPicker.placeholder');
        this.input.addEventListener('input', () => this.render());
        if (current) {
            const remove = head.createEl('button', { cls: 'sh-link-button sh-icon-remove', text: t('tasksTab.iconPicker.remove') });
            remove.addEventListener('click', () => this.choose(null));
        }

        this.body = this.panel.createDiv({ cls: 'sh-palette-list sh-icon-picker-body' });

        if (!Platform.isMobile) {
            const foot = this.panel.createDiv({ cls: 'sh-palette-foot' });
            hint(foot, '↑↓←→', 'navigate');
            hint(foot, '↵', 'choose');
            hint(foot, 'esc', 'close');
        }

        this.onKey = (event: KeyboardEvent) => this.handleKey(event);
        document.addEventListener('keydown', this.onKey, true);
        this.render();
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
        this.body = null;
        this.cells = [];
        this.done = null;
        const onClosed = this.onClosed;
        this.onClosed = undefined;
        onClosed?.();
    }

    private render(): void {
        const body = this.body;
        if (!body) return;
        body.empty();
        this.cells = [];
        const query = this.input?.value ?? '';
        const sections = iconSections(query, this.available());
        if (sections.length === 0) {
            body.createDiv({ cls: 'sh-palette-empty', text: t('tasksTab.iconPicker.empty') });
            return;
        }
        for (const section of sections) {
            if (section.title) body.createDiv({ cls: 'sh-palette-section', text: section.title });
            const grid = body.createDiv({ cls: 'sh-icon-grid' });
            for (const icon of section.icons) {
                const el = grid.createEl('button', { cls: 'sh-icon-cell' });
                setIcon(el, icon);
                el.setAttr('aria-label', icon.replace(/-/g, ' '));
                if (icon === this.current) el.addClass('is-current');
                const index = this.cells.length;
                el.addEventListener('click', () => this.choose(icon));
                el.addEventListener('mousemove', () => {
                    if (this.active !== index) this.paint(index, false);
                });
                this.cells.push({ el, icon });
            }
        }
        // Browsing starts on the note's own icon; a search starts on the best match.
        const own = query.trim() === '' ? this.cells.findIndex(cell => cell.icon === this.current) : -1;
        this.paint(own === -1 ? 0 : own, true);
    }

    private paint(index: number, reveal: boolean): void {
        this.cells[this.active]?.el.removeClass('is-active');
        this.active = index;
        const cell = this.cells[index];
        if (!cell) return;
        cell.el.addClass('is-active');
        if (reveal) cell.el.scrollIntoView({ block: 'nearest' });
    }

    /** How many icons fit across the grid the active icon is in. */
    private columns(): number {
        const grid = this.cells[this.active]?.el.parentElement;
        if (!grid) return 1;
        return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    }

    private handleKey(event: KeyboardEvent): void {
        if (!this.isOpen) return;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -this.columns(), ArrowDown: this.columns() }[event.key];
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            const cell = this.cells[this.active];
            if (cell) this.choose(cell.icon);
        } else if (step !== undefined && this.cells.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            this.paint(Math.min(this.cells.length - 1, Math.max(0, this.active + step)), true);
        }
    }

    private choose(icon: string | null): void {
        const done = this.done;
        this.close();
        done?.(icon);
    }
}
