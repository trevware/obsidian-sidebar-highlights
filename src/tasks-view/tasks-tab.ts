import {
    Component,
    ItemView,
    MarkdownRenderer,
    MarkdownView,
    Notice,
    TFile,
    WorkspaceLeaf,
    getIcon,
    moment,
    setIcon,
    setTooltip
} from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import type { Task, TaskStatus } from '../../main';
import { TaskManager } from '../managers/task-manager';
import { TaskRenderer } from '../renderers/task-renderer';
import { statusToCheckboxState } from '../utils/task-status';
import { SQUIRCLE_PATH } from '../utils/squircle-icon';
import { t } from '../i18n';
import { addDays, isoToday, rowDateLabel, startOfWeek, weekday } from './dates';
import type { DateLabel } from './dates';
import {
    DEFAULT_DISPLAY,
    SMART_LISTS,
    breadcrumbFor,
    buildGroups,
    childProgress,
    isOpenTask,
    listCounts,
    listKey,
    railAreas,
    sameList,
    statusOf,
    taskKey,
    tasksForList
} from './task-views';
import type { AddTarget, DisplayOptions, GroupLabels, GroupMode, ListRef, NoteInfo, SmartListId, SortMode, TaskGroup } from './task-views';
import { notesText, parseTaskLine, setDateInText, withState } from './task-line';
import { parseDateQuery } from './quick-parse';
import { TaskWriter } from './task-writer';
import type { LineChange } from './task-writer';
import { GlassPalette } from './glass-palette';
import type { PaletteItem, PaletteStage } from './glass-palette';
import { QuickAdd } from './quick-add';
import { GlassMenu } from './glass-menu';
import { MARKER_DEFS, markerDef } from './markers';
import { EASE, arrive, capture, collapse, flip, motionAllowed } from './motion';
import type { GlassMenuItem } from './glass-menu';
import type { Destination, QuickAddPrefill } from './quick-add';

export const VIEW_TYPE_TASKS = 'sidebar-highlights-tasks';

const STORAGE = {
    list: 'sidebar-highlights-tasks-list',
    display: 'sidebar-highlights-tasks-display',
    collapsed: 'sidebar-highlights-tasks-collapsed',
    rail: 'sidebar-highlights-tasks-rail',
    destination: 'sidebar-highlights-tasks-destination'
};

/** How long a just-completed task stays in place before it leaves its list. */
const LINGER_MS = 1200;
/** Rows drawn before a list asks to show more, so a big Logbook stays quick. */
const ROW_CAP = 300;
/** Lists longer than this redraw without the glide, which would cost more than it shows. */
const FLIP_LIMIT = 120;
/** Below this width the rail tucks away behind a button. */
const NARROW_PX = 760;

const SMART_ICONS: Record<SmartListId, string> = {
    today: 'sun',
    upcoming: 'calendar-range',
    anytime: 'list-todo',
    'in-progress': 'circle-dot',
    questions: 'circle-help',
    logbook: 'circle-check'
};

/** The status lists wear their own status mark, so the rail and the rows speak one language. */
const STATUS_LISTS: Partial<Record<SmartListId, TaskStatus>> = {
    'in-progress': 'in-progress',
    questions: 'question',
    logbook: 'done'
};

function paintListIcon(el: HTMLElement, id: SmartListId): void {
    const status = STATUS_LISTS[id];
    if (status) paintGlyph(el.createDiv({ cls: 'sh-task-glyph is-icon' }), { status, priority: undefined });
    else setIcon(el, SMART_ICONS[id]);
}

interface UndoEntry {
    label: string;
    undo: () => Promise<void>;
}

/**
 * Tasks as a full tab, organised the way Things and Todoist organise a day:
 * a rail of lists on the left (Today, Upcoming, Anytime, the two statuses,
 * Logbook, then every note with open tasks under its folder), and one calm
 * column of tasks on the right.
 *
 * The floating controls (the top bar, the palette, quick add, the selection
 * bar, menus and toasts) are glass, the same surface as Oriko's, so they read
 * as one system. Task rows themselves stay solid and themed: glass belongs on
 * what floats over content, never on the content.
 *
 * The keyboard model follows Linear and Todoist: J/K move a highlight, X
 * selects, single letters act on the highlight or the selection, and ⌘K or /
 * opens the palette for everything else.
 */
export class TasksTabView extends ItemView {
    private plugin: HighlightCommentsPlugin;
    private taskManager: TaskManager;
    private renderer: TaskRenderer;
    private writer: TaskWriter;

    private allTasks: Task[] = [];
    private loaded = false;
    private list: ListRef = { kind: 'smart', id: 'today' };
    private displayByList: Record<string, DisplayOptions> = {};
    private collapsed = new Set<string>();
    private highlightKey: string | null = null;
    private anchorKey: string | null = null;
    private selected = new Set<string>();
    private expandedKey: string | null = null;
    private lingering = new Set<string>();
    /** Rows whose checkbox just changed, so the new glyph plays its pop once. */
    private justChanged = new Set<string>();
    /** Rows already repainted ahead of a write, which shouldn't pop twice. */
    private previewed = new Set<string>();
    private rowCap = ROW_CAP;
    private order: Task[] = [];
    private orderIndex = new Map<string, number>();
    /** The row element and task for every drawn row, by task key. */
    private rowEls = new Map<string, HTMLElement>();
    private rowTasks = new Map<string, Task>();
    private paintedHighlight: string | null = null;
    private paintedSelection = new Set<string>();
    /** A change arrived while the tab was in the background. */
    private dirty = false;
    /** Bumped whenever the task data changes, so derived views know to rebuild. */
    private dataVersion = 0;
    private railSignature = '';
    private progressCache: { version: number; map: Map<string, { done: number; total: number }> } | null = null;
    private titleCache = new Map<string, DocumentFragment>();
    private actionsEl!: HTMLElement;
    private actionsKey: string | null = null;
    private hoveredRow: HTMLElement | null = null;
    private undoStack: UndoEntry[] = [];
    private railHidden = false;
    private narrow = false;
    private pendingG = 0;

    private shell!: HTMLElement;
    private rail!: HTMLElement;
    private main!: HTMLElement;
    private scroller!: HTMLElement;
    private column!: HTMLElement;
    private topbar!: HTMLElement;
    private bulkbar!: HTMLElement;
    private toastEl: HTMLElement | null = null;
    private toastTimer: number | null = null;
    private menuEl: HTMLElement | null = null;
    private menuCleanup: (() => void) | null = null;
    private cardComponent: Component | null = null;
    private palette!: GlassPalette;
    private quickAdd!: QuickAdd;
    private glassMenu!: GlassMenu;
    private refreshTimers = new Map<string, number>();
    private resizer: ResizeObserver | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HighlightCommentsPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.taskManager = new TaskManager(plugin);
        this.renderer = new TaskRenderer(plugin);
        this.writer = new TaskWriter(plugin.app);
    }

    getViewType(): string {
        return VIEW_TYPE_TASKS;
    }

    getDisplayText(): string {
        return t('tasksTab.title');
    }

    getIcon(): string {
        return 'list-checks';
    }

    async onOpen(): Promise<void> {
        this.restoreState();

        const root = this.contentEl;
        root.empty();
        root.addClass('sh-tasks-view');

        this.shell = root.createDiv({ cls: 'sh-tasks-shell' });
        this.rail = this.shell.createDiv({ cls: 'sh-tasks-rail' });
        this.main = this.shell.createDiv({ cls: 'sh-tasks-main' });
        this.scroller = this.main.createDiv({ cls: 'sh-tasks-scroll' });
        this.scroller.setAttr('tabindex', '-1');
        this.column = this.scroller.createDiv({ cls: 'sh-tasks-column' });
        this.topbar = this.main.createDiv({ cls: 'sh-tasks-topbar' });
        this.bulkbar = this.main.createDiv({ cls: 'sh-glass sh-bulkbar' });

        this.palette = new GlassPalette(this.main);
        this.glassMenu = new GlassMenu(this.main);
        this.quickAdd = new QuickAdd(this.main, {
            today: () => isoToday(),
            formatDate: (iso) => this.formatDate(iso),
            dateLabel: (iso) => this.dateLabel(iso).text,
            destinationLabel: (destination) => this.destinationLabel(destination),
            defaultDestination: () => this.defaultDestination(),
            chooseDestination: (done) => this.pickDestination(done),
            submit: (lines, destination) => this.addLines(lines, destination),
            onClose: () => this.focusList()
        });

        // Every click in the list goes through one handler, so rows carry no
        // listeners of their own.
        this.actionsEl = this.buildActions();
        this.scroller.addEventListener('click', (event) => this.onListClick(event));
        this.column.addEventListener('dblclick', (event) => this.onListDoubleClick(event));
        this.column.addEventListener('contextmenu', (event) => this.onListContextMenu(event));
        this.column.addEventListener('mouseover', (event) => {
            const row = (event.target as HTMLElement).closest<HTMLElement>('.sh-task-row');
            if (row) this.moveActions(row);
        });
        // Off the list, the buttons go back to the highlighted row, or away.
        this.column.addEventListener('mouseleave', () => {
            const highlighted = this.highlightKey ? this.rowEls.get(this.highlightKey) : undefined;
            if (highlighted) this.moveActions(highlighted);
            else this.hideActions();
        });

        // Clicking anywhere outside an open card closes it. Surfaces the card
        // opens (the palette, menus, quick add) don't count as outside.
        root.addEventListener('mousedown', (event) => {
            if (!this.expandedKey) return;
            const target = event.target as HTMLElement;
            if (target.closest('.sh-task-row.is-expanded, .sh-palette, .sh-palette-backdrop, .sh-menu, .sh-quickadd, .sh-bulkbar, .sh-toast')) return;
            this.setExpanded(null);
            this.paintSelection();
        });

        // Row icons are drawn by CSS from Obsidian's own icons, so a row holds
        // no SVG of its own for them.
        const icons: Record<string, string> = { calendar: 'calendar', progress: 'list-checks', context: 'align-left', note: 'file-text' };
        const serializer = new XMLSerializer();
        const props: Record<string, string> = {};
        for (const [name, id] of Object.entries(icons)) {
            const svg = getIcon(id);
            if (svg) props[`--sh-icon-${name}`] = `url("data:image/svg+xml;utf8,${encodeURIComponent(serializer.serializeToString(svg))}")`;
        }
        root.setCssProps(props);

        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            if (this.dirty && this.contentEl.isShown()) this.render();
        }));

        this.registerDomEvent(document, 'keydown', (event) => this.handleKey(event), true);

        this.resizer = new ResizeObserver(() => this.applyWidth());
        this.resizer.observe(this.shell);

        this.registerEvent(this.app.vault.on('modify', (file) => this.scheduleRefresh(file.path)));
        this.registerEvent(this.app.vault.on('create', (file) => this.scheduleRefresh(file.path)));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            this.allTasks = this.allTasks.filter(task => task.filePath !== file.path);
            this.dataVersion++;
            this.render();
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            this.allTasks = this.allTasks.filter(task => task.filePath !== oldPath);
            this.dataVersion++;
            if (this.list.kind === 'note' && this.list.path === oldPath) this.list = { kind: 'note', path: file.path };
            this.scheduleRefresh(file.path);
        }));

        this.renderTopbar();
        this.applyWidth();
        this.render();

        this.allTasks = await this.taskManager.scanAllTasks(true, true);
        this.dataVersion++;
        this.loaded = true;
        this.render();
        this.focusList();
    }

    async onClose(): Promise<void> {
        this.palette?.close();
        this.glassMenu?.close();
        this.quickAdd?.close(true);
        this.closeMenu();
        this.resizer?.disconnect();
        this.cardComponent?.unload();
        for (const timer of this.refreshTimers.values()) window.clearTimeout(timer);
        if (this.toastTimer) window.clearTimeout(this.toastTimer);
    }

    // ── Public entry points for commands ────────────────────────────────

    togglePalette(): void {
        if (this.palette.isOpen) this.palette.close();
        else this.openPalette();
    }

    openQuickAdd(prefill: QuickAddPrefill = {}): void {
        this.palette.close();
        this.closeMenu();
        this.quickAdd.open(prefill);
    }

    hasTargets(): boolean {
        return this.targets().length > 0;
    }

    // ── State ───────────────────────────────────────────────────────────

    private readJson<T>(key: string, fallback: T): T {
        try {
            const raw: unknown = this.app.loadLocalStorage(key);
            if (typeof raw !== 'string' || raw === '') return fallback;
            return JSON.parse(raw) as T;
        } catch {
            return fallback;
        }
    }

    private writeJson(key: string, value: unknown): void {
        try {
            this.app.saveLocalStorage(key, JSON.stringify(value));
        } catch {
            // Storage is a convenience: losing it only forgets a view setting.
        }
    }

    private restoreState(): void {
        const list = this.readJson<ListRef | null>(STORAGE.list, null);
        if (list && (list.kind === 'note' || SMART_LISTS.includes(list.id))) this.list = list;
        this.displayByList = this.readJson<Record<string, DisplayOptions>>(STORAGE.display, {});
        this.collapsed = new Set(this.readJson<string[]>(STORAGE.collapsed, []));
        this.railHidden = this.readJson<boolean>(STORAGE.rail, false);
    }

    private display(): DisplayOptions {
        return { ...DEFAULT_DISPLAY, ...(this.displayByList[listKey(this.list)] ?? {}) };
    }

    private setDisplay(patch: Partial<DisplayOptions>): void {
        const key = listKey(this.list);
        this.displayByList[key] = { ...this.display(), ...patch };
        this.writeJson(STORAGE.display, this.displayByList);
        this.render(true);
    }

    private isDisplayChanged(): boolean {
        const display = this.display();
        return (Object.keys(DEFAULT_DISPLAY) as Array<keyof DisplayOptions>)
            .some(key => display[key] !== DEFAULT_DISPLAY[key]);
    }

    private setList(ref: ListRef): void {
        if (sameList(ref, this.list)) {
            this.scroller.scrollTop = 0;
            return;
        }
        this.list = ref;
        this.writeJson(STORAGE.list, ref);
        this.selected.clear();
        this.expandedKey = null;
        this.highlightKey = null;
        this.rowCap = ROW_CAP;
        if (this.narrow) this.railHidden = true;
        this.render();
        this.scroller.scrollTop = 0;
        arrive(this.column);
        this.focusList();
    }

    // ── Data ────────────────────────────────────────────────────────────

    private scheduleRefresh(path: string): void {
        if (!path.endsWith('.md')) return;
        const existing = this.refreshTimers.get(path);
        if (existing) window.clearTimeout(existing);
        this.refreshTimers.set(path, window.setTimeout(() => {
            this.refreshTimers.delete(path);
            // Our own writes were already read back, so their echo changes nothing.
            void this.refreshFile(path).then((changed) => {
                if (changed) this.render();
            });
        }, 250));
    }

    /** Re-reads one note's tasks. Returns whether anything about them changed. */
    private async refreshFile(path: string): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(path);
        const mine = this.allTasks.filter(task => task.filePath === path);
        const others = this.allTasks.filter(task => task.filePath !== path);
        const fresh = file instanceof TFile && this.taskManager.shouldProcessFile(file)
            ? await this.taskManager.scanFileForTasks(file, true, true)
            : [];
        const signature = (tasks: Task[]) => tasks
            .map(task => `${task.lineNumber}\u0001${task.marker}\u0001${task.indentLevel}\u0001${task.section}\u0001${task.text}\u0001${task.context.join('\u0002')}`)
            .join('\u0003');
        if (signature(mine) === signature(fresh)) return false;
        this.allTasks = [...others, ...fresh];
        this.dataVersion++;
        return true;
    }

    private async refreshFiles(paths: Iterable<string>): Promise<boolean> {
        let changed = false;
        for (const path of new Set(paths)) changed = (await this.refreshFile(path)) || changed;
        return changed;
    }

    private noteInfo: NoteInfo = {
        basename: (path) => {
            const name = path.split('/').pop() ?? path;
            return name.replace(/\.md$/, '');
        },
        folder: (path) => path.split('/').slice(0, -1).join('/'),
        mtime: (path) => {
            const file = this.app.vault.getAbstractFileByPath(path);
            return file instanceof TFile ? file.stat.mtime : 0;
        }
    };

    private groupLabels(): GroupLabels {
        return {
            overdue: t('tasksTab.groups.overdue'),
            today: t('tasksTab.dates.today'),
            tomorrow: t('tasksTab.dates.tomorrow'),
            noDate: t('tasksTab.dates.noDate'),
            noPriority: t('tasksTab.priority.none'),
            priority: (level) => t(`tasksTab.priority.p${level}`),
            weekOf: (date) => t('tasksTab.groups.weekOf', { date })
        };
    }

    private dateLabel(iso: string): DateLabel {
        return rowDateLabel(iso, isoToday(), {
            today: t('tasksTab.dates.today'),
            tomorrow: t('tasksTab.dates.tomorrow'),
            yesterday: t('tasksTab.dates.yesterday')
        });
    }

    private formatDate(iso: string): string {
        return moment(iso, 'YYYY-MM-DD').format(this.plugin.settings.taskDateFormat || 'YYYY-MM-DD');
    }

    private listTitle(ref: ListRef): string {
        if (ref.kind === 'note') return this.noteInfo.basename(ref.path);
        return t(`tasksTab.lists.${ref.id}`);
    }

    private findTask(key: string | null): Task | undefined {
        if (!key) return undefined;
        return this.order.find(task => taskKey(task) === key) ?? this.allTasks.find(task => taskKey(task) === key);
    }

    /** The tasks a command acts on: the selection, or else the highlighted row. */
    private targets(): Task[] {
        if (this.selected.size > 0) {
            return this.order.filter(task => this.selected.has(taskKey(task)));
        }
        const highlighted = this.findTask(this.highlightKey);
        return highlighted ? [highlighted] : [];
    }

    // ── Layout ──────────────────────────────────────────────────────────

    private applyWidth(): void {
        const narrow = this.shell.clientWidth > 0 && this.shell.clientWidth < NARROW_PX;
        if (narrow !== this.narrow) {
            this.narrow = narrow;
            if (narrow) this.railHidden = true;
            else this.railHidden = this.readJson<boolean>(STORAGE.rail, false);
        }
        this.shell.toggleClass('is-narrow', this.narrow);
        this.shell.toggleClass('is-rail-hidden', this.railHidden);
    }

    private toggleRail(): void {
        this.railHidden = !this.railHidden;
        if (!this.narrow) this.writeJson(STORAGE.rail, this.railHidden);
        this.shell.toggleClass('is-rail-hidden', this.railHidden);
    }

    private focusList(): void {
        // The column takes focus so the view's keys work straight away, and
        // never scrolls to do it.
        this.scroller?.focus({ preventScroll: true });
    }

    private renderTopbar(): void {
        const bar = this.topbar;
        bar.empty();
        const left = bar.createDiv({ cls: 'sh-glass sh-topbar-group sh-topbar-left' });
        this.barButton(left, 'panel-left', t('tasksTab.actions.toggleSidebar'), () => this.toggleRail());

        const right = bar.createDiv({ cls: 'sh-glass sh-topbar-group' });
        this.barButton(right, 'search', `${t('tasksTab.actions.search')} (⌘K)`, () => this.openPalette());
        this.barButton(right, 'plus', `${t('tasksTab.actions.addTask')} (Q)`, () => this.openQuickAdd());
        const display = this.barButton(right, 'sliders-horizontal', `${t('tasksTab.actions.display')} (⇧V)`, (event) => this.openDisplayMenu(event.currentTarget as HTMLElement));
        display.addClass('sh-display-button');
    }

    private barButton(parent: HTMLElement, icon: string, tooltip: string, onClick: (event: MouseEvent) => void): HTMLElement {
        const button = parent.createEl('button', { cls: 'sh-bar-button' });
        setIcon(button, icon);
        setTooltip(button, tooltip, { placement: 'bottom' });
        button.setAttr('aria-label', tooltip);
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick(event);
        });
        return button;
    }

    // ── Rendering ───────────────────────────────────────────────────────

    /**
     * Rebuilds the list, and the rail when what it shows has changed.
     *
     * Only data changes come through here. Moving the highlight, selecting,
     * and opening or closing a card patch the one or two rows involved in
     * place, so they cost the same on a note with ten tasks as on one with a
     * thousand. With `animate`, a short list glides its rows to their new
     * places; a long one redraws without motion, since measuring hundreds of
     * rows twice costs more than the motion is worth.
     */
    private render(animate = false): void {
        if (!this.column) return;
        // A tab in the background redraws when it comes back to the front.
        if (!this.contentEl.isShown()) {
            this.dirty = true;
            return;
        }
        this.dirty = false;
        const today = isoToday();
        const before = animate && this.rowEls.size <= FLIP_LIMIT && motionAllowed() ? capture(this.column) : null;
        this.renderRail(today);
        this.renderMain(today);
        this.paintSelection(true);
        this.topbar.querySelector('.sh-display-button')?.toggleClass('has-changes', this.isDisplayChanged());
        if (before && this.rowEls.size <= FLIP_LIMIT) flip(this.column, before);
        this.justChanged.clear();
    }

    private renderRail(today: string): void {
        // The rail only changes with the data, the list, or a fold.
        const signature = `${this.dataVersion}|${listKey(this.list)}|${this.loaded}|${today}|${[...this.collapsed].filter(key => key.startsWith('area:')).join(',')}`;
        if (signature === this.railSignature) return;
        this.railSignature = signature;

        const rail = this.rail;
        const scrollTop = rail.scrollTop;
        const oldIndicator = rail.querySelector<HTMLElement>('.sh-rail-indicator');
        const from = oldIndicator ? { top: oldIndicator.offsetTop, height: oldIndicator.offsetHeight } : null;
        rail.empty();
        const indicator = rail.createDiv({ cls: 'sh-rail-indicator' });
        const counts = listCounts(this.allTasks, today);

        const lists = rail.createDiv({ cls: 'sh-rail-lists' });
        const countFor: Partial<Record<SmartListId, number>> = {
            today: counts.today,
            'in-progress': counts.inProgress,
            questions: counts.questions
        };

        SMART_LISTS.forEach((id, index) => {
            if (index === 3 || index === 5) lists.createDiv({ cls: 'sh-rail-gap' });
            const ref: ListRef = { kind: 'smart', id };
            const row = lists.createDiv({ cls: `sh-rail-item is-${id}` });
            row.toggleClass('is-active', sameList(ref, this.list));
            paintListIcon(row.createDiv({ cls: 'sh-rail-icon' }), id);
            row.createDiv({ cls: 'sh-rail-label', text: t(`tasksTab.lists.${id}`) });
            const count = this.loaded ? countFor[id] : undefined;
            if (count) {
                const badge = row.createDiv({ cls: 'sh-rail-count', text: String(count) });
                if (id === 'today' && counts.overdue > 0) {
                    badge.addClass('is-alert');
                    setTooltip(badge, t('tasksTab.rail.overdue', { count: counts.overdue }), { placement: 'right' });
                }
            }
            row.addEventListener('click', () => this.setList(ref));
        });

        const areas = railAreas(this.allTasks, this.noteInfo);
        if (areas.length > 0) rail.createDiv({ cls: 'sh-rail-divider' });

        for (const area of areas) {
            const areaKey = `area:${area.folder}`;
            const collapsed = this.collapsed.has(areaKey);
            const header = rail.createDiv({ cls: 'sh-rail-area' });
            header.toggleClass('is-collapsed', collapsed);
            setIcon(header.createDiv({ cls: 'sh-rail-chevron' }), 'chevron-down');
            header.createDiv({ cls: 'sh-rail-area-label', text: area.folder || t('tasksTab.rail.vaultRoot') });
            header.addEventListener('click', () => {
                if (collapsed) this.collapsed.delete(areaKey);
                else this.collapsed.add(areaKey);
                this.writeJson(STORAGE.collapsed, [...this.collapsed]);
                this.renderRail(isoToday());
            });
            if (collapsed) continue;

            for (const note of area.notes) {
                const ref: ListRef = { kind: 'note', path: note.path };
                const row = rail.createDiv({ cls: 'sh-rail-item is-note' });
                row.toggleClass('is-active', sameList(ref, this.list));
                row.createDiv({ cls: 'sh-rail-icon is-note' });
                row.createDiv({ cls: 'sh-rail-label', text: note.name });
                row.createDiv({ cls: 'sh-rail-count is-quiet', text: String(note.open) });
                row.setAttr('aria-label', note.path);
                row.addEventListener('click', () => this.setList(ref));
            }
        }

        rail.scrollTop = scrollTop;
        this.placeIndicator(indicator, from);
    }

    /** Slides the rail's highlight from the old list to the new one. */
    private placeIndicator(indicator: HTMLElement, from: { top: number; height: number } | null): void {
        const active = this.rail.querySelector<HTMLElement>('.sh-rail-item.is-active');
        if (!active) {
            indicator.addClass('is-hidden');
            return;
        }
        const to = { top: active.offsetTop, height: active.offsetHeight };
        indicator.setCssProps({ top: `${to.top}px`, height: `${to.height}px` });
        if (from && motionAllowed() && (from.top !== to.top || from.height !== to.height)) {
            indicator.animate(
                [{ top: `${from.top}px`, height: `${from.height}px` }, { top: `${to.top}px`, height: `${to.height}px` }],
                { duration: 260, easing: EASE }
            );
        }
    }

    private progress(): Map<string, { done: number; total: number }> {
        if (this.progressCache?.version !== this.dataVersion) {
            this.progressCache = { version: this.dataVersion, map: childProgress(this.allTasks) };
        }
        return this.progressCache.map;
    }

    private renderMain(today: string): void {
        const scrollTop = this.scroller.scrollTop;
        this.cardComponent?.unload();
        this.cardComponent = null;

        const column = this.column;
        column.empty();
        this.order = [];
        this.orderIndex = new Map();
        this.rowEls = new Map();
        this.rowTasks = new Map();
        this.hoveredRow = null;
        this.actionsKey = null;
        this.actionsEl.removeClass('is-visible');

        const display = this.display();
        const tasks = tasksForList(this.allTasks, this.list, today, display, this.lingering);
        const groups = buildGroups(tasks, this.list, today, display, this.groupLabels(), this.noteInfo);

        this.renderHeader(column, today);

        if (!this.loaded) {
            column.createDiv({ cls: 'sh-tasks-empty', text: t('tasksTab.empty.loading') });
            return;
        }

        if (tasks.length === 0) {
            const empty = column.createDiv({ cls: 'sh-tasks-empty' });
            const icon = empty.createDiv({ cls: 'sh-tasks-empty-icon' });
            if (this.list.kind === 'smart') paintListIcon(icon, this.list.id);
            else setIcon(icon, 'check');
            empty.createDiv({ text: t(`tasksTab.empty.${this.list.kind === 'smart' ? this.list.id : 'note'}`) });
            return;
        }

        const progress = this.progress();
        let drawn = 0;
        let hidden = 0;

        for (const group of groups) {
            const groupEl = column.createDiv({ cls: `sh-group is-${group.kind}` });
            const collapseKey = `${listKey(this.list)}|${group.key}`;
            const collapsed = this.collapsed.has(collapseKey);
            if (group.title) this.renderGroupHeader(groupEl, group, collapseKey, collapsed);
            if (collapsed) continue;
            if (group.count === 0 && group.add) this.renderAddRow(groupEl, group.add);

            for (const section of group.sections) {
                if (section.title) {
                    const heading = groupEl.createDiv({ cls: 'sh-section-title', text: section.title });
                    heading.setAttr('role', 'heading');
                }
                for (const task of section.tasks) {
                    if (drawn >= this.rowCap) {
                        hidden++;
                        continue;
                    }
                    this.renderRow(groupEl, task, group, progress, display);
                    this.orderIndex.set(taskKey(task), this.order.length);
                    this.order.push(task);
                    drawn++;
                }
            }
        }

        if (hidden > 0) {
            const more = column.createEl('button', { cls: 'sh-show-more', text: t('tasksTab.showMore', { count: hidden }) });
            more.addEventListener('click', () => {
                this.rowCap += ROW_CAP;
                this.render();
            });
        }

        if (this.highlightKey && !this.rowEls.has(this.highlightKey)) this.highlightKey = null;
        for (const key of [...this.selected]) {
            if (!this.rowEls.has(key)) this.selected.delete(key);
        }
        if (this.expandedKey) {
            const row = this.rowEls.get(this.expandedKey);
            const task = this.rowTasks.get(this.expandedKey);
            if (row && task) this.expandRow(row, task, false);
            else this.expandedKey = null;
        }

        this.scroller.scrollTop = scrollTop;
    }

    private renderHeader(column: HTMLElement, today: string): void {
        const header = column.createDiv({ cls: 'sh-tasks-header' });

        // One quiet line above the title that says where you are: the date on
        // Today, the folder (and a way into the note) on a note.
        const eyebrow = header.createDiv({ cls: 'sh-tasks-eyebrow' });
        if (this.list.kind === 'note') {
            const path = this.list.path;
            eyebrow.createSpan({ text: this.noteInfo.folder(path) || t('tasksTab.rail.vaultRoot') });
            const open = eyebrow.createEl('button', { cls: 'sh-link-button', text: t('tasksTab.actions.openNote') });
            open.addEventListener('click', () => void this.openPath(path));
        } else if (this.list.id === 'today') {
            eyebrow.setText(moment(today, 'YYYY-MM-DD').format('dddd, D MMMM'));
        }
        if (eyebrow.childElementCount === 0 && eyebrow.textContent === '') eyebrow.remove();

        header.createEl('h1', { cls: 'sh-tasks-title', text: this.listTitle(this.list) });
    }

    /**
     * A group's header, as plain as a heading: the name, a quiet subtitle and
     * count, and the group's actions at the far end. Clicking the name folds
     * the group.
     */
    private renderGroupHeader(groupEl: HTMLElement, group: TaskGroup, collapseKey: string, collapsed: boolean): void {
        const header = groupEl.createDiv({ cls: 'sh-group-header' });
        header.dataset.flip = `group:${group.key}`;
        header.toggleClass('is-collapsed', collapsed);
        if (group.kind === 'priority') {
            const level = group.key.split(':')[1];
            if (level !== 'none') header.dataset.priority = level;
        }

        const label = header.createDiv({ cls: 'sh-group-label' });
        label.createDiv({ cls: 'sh-group-title', text: group.title });
        if (group.subtitle) label.createDiv({ cls: 'sh-group-subtitle', text: group.subtitle });
        if (group.count > 0) label.createDiv({ cls: 'sh-group-count', text: String(group.count) });
        if (collapsed) setIcon(label.createDiv({ cls: 'sh-group-chevron' }), 'chevron-right');

        label.addEventListener('click', () => {
            if (collapsed) this.collapsed.delete(collapseKey);
            else this.collapsed.add(collapseKey);
            this.writeJson(STORAGE.collapsed, [...this.collapsed]);
            this.render(true);
        });

        const actions = header.createDiv({ cls: 'sh-group-actions' });
        if (group.kind === 'overdue') {
            const reschedule = actions.createEl('button', { cls: 'sh-link-button is-alert', text: t('tasksTab.actions.reschedule') });
            reschedule.addEventListener('click', (event) => {
                event.stopPropagation();
                const tasks = group.sections.flatMap(section => section.tasks);
                this.openPalette(this.dateStage(tasks));
            });
        }
        if (group.kind === 'note') {
            const open = actions.createEl('button', { cls: 'sh-task-action is-hover' });
            setIcon(open, 'arrow-right');
            open.setAttr('aria-label', t('tasksTab.actions.showNote'));
            open.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setList({ kind: 'note', path: group.key.slice('note:'.length) });
            });
        }
        if (group.add) {
            const add = actions.createEl('button', { cls: 'sh-task-action is-hover' });
            setIcon(add, 'plus');
            add.setAttr('aria-label', t('tasksTab.actions.addHere'));
            const target = group.add;
            add.addEventListener('click', (event) => {
                event.stopPropagation();
                this.openQuickAdd(this.prefillFor(target));
            });
        }
    }

    /** An empty group invites a task instead of showing a zero. */
    private renderAddRow(groupEl: HTMLElement, target: AddTarget): void {
        const row = groupEl.createDiv({ cls: 'sh-add-row' });
        row.dataset.flip = `add:${JSON.stringify(target)}`;
        paintEmptyGlyph(row.createDiv({ cls: 'sh-add-glyph' }));
        row.createDiv({ cls: 'sh-add-label', text: t('tasksTab.actions.addHere') });
        row.addEventListener('click', () => this.openQuickAdd(this.prefillFor(target)));
    }

    private prefillFor(target: AddTarget): QuickAddPrefill {
        const destination = target.path
            ? { path: target.path, heading: target.heading }
            : this.defaultDestination() ?? undefined;
        return { destination, date: target.date, priority: target.priority };
    }

    /**
     * One row. Kept as light as a row can be: no listeners (the list handles
     * every click in one place), no tooltips, icons drawn by CSS, a glyph
     * cloned from a template, and a title cloned from the last time that
     * text was drawn. The hover buttons are one shared set that moves to
     * whichever row is under the pointer.
     */
    private renderRow(parent: HTMLElement, task: Task, group: TaskGroup, progress: Map<string, { done: number; total: number }>, display: DisplayOptions): void {
        const key = taskKey(task);
        const row = parent.createDiv({ cls: 'sh-task-row' });
        row.dataset.key = key;
        row.dataset.flip = `task:${key}`;
        if (task.indentLevel > 0) row.setCssProps({ '--sh-indent': String(task.indentLevel) });
        if (!isOpenTask(task)) row.addClass('is-resolved');
        if (this.lingering.has(key)) row.addClass('is-lingering');

        const line = row.createDiv({ cls: 'sh-task-line' });
        const glyph = line.createEl('button', { cls: 'sh-task-glyph' });
        paintGlyph(glyph, task);
        if (this.justChanged.has(key)) glyph.addClass('is-just-changed');

        const body = line.createDiv({ cls: 'sh-task-body' });
        this.paintTitle(body.createDiv({ cls: 'sh-task-title task-text-content' }), task);

        const datesShared = group.kind === 'date' && (group.key === 'today' || group.key.startsWith('day:'));
        const kids = progress.get(key);
        const crumb = breadcrumbFor(task, group.kind, this.noteInfo);
        const contextHint = task.context.length > 0 && !display.showContext;
        if ((task.date && !datesShared) || kids || crumb || contextHint) {
            const meta = body.createDiv({ cls: 'sh-task-meta' });
            if (task.date && !datesShared) {
                const label = this.dateLabel(task.date);
                meta.createSpan({ cls: `sh-meta-date is-${label.tone}`, text: label.text });
            }
            if (kids) meta.createSpan({ cls: 'sh-meta-item is-progress', text: `${kids.done}/${kids.total}` });
            if (contextHint) meta.createSpan({ cls: 'sh-meta-item is-context' });
            if (crumb) meta.createSpan({ cls: 'sh-meta-crumb', text: crumb });
        }

        if (display.showContext && task.context.length > 0) this.renderContextPreview(row, task);

        this.rowEls.set(key, row);
        this.rowTasks.set(key, task);
    }

    private renderContextPreview(row: HTMLElement, task: Task): void {
        const preview = row.createDiv({ cls: 'sh-task-context' });
        preview.setText(task.context.map(line => line.trim().replace(/^[-*+]\s+(\[.\]\s+)?/, '')).join(' · '));
    }

    /** A task's title, drawn once per distinct text and cloned after that. */
    private paintTitle(el: HTMLElement, task: Task): void {
        const cacheKey = `${this.plugin.settings.hideTasksPluginMetadata ? 1 : 0}\u0000${task.dateText ?? ''}\u0000${task.text}`;
        let template = this.titleCache.get(cacheKey);
        if (!template) {
            const scratch = createDiv();
            this.renderer.renderTaskText(scratch, task);
            template = createFragment();
            template.append(...Array.from(scratch.childNodes));
            if (this.titleCache.size > 5000) this.titleCache.clear();
            this.titleCache.set(cacheKey, template);
        }
        el.appendChild(template.cloneNode(true));
    }

    /** The one set of hover buttons, moved onto whichever row wants them. */
    /**
     * Puts the shared hover buttons over a row. They live in the list itself,
     * above the rows, because a row clips whatever overflows it (that clipping
     * is what lets rows off screen skip drawing), and the pill is taller than
     * a one-line row.
     */
    private moveActions(row: HTMLElement): void {
        const key = row.dataset.key ?? null;
        if (row.hasClass('is-expanded')) {
            this.hideActions();
            return;
        }
        if (this.actionsEl.parentElement !== this.column) this.column.appendChild(this.actionsEl);
        if (this.actionsKey !== key) {
            this.hoveredRow?.removeClass('is-hovered');
            this.hoveredRow = row;
            row.addClass('is-hovered');
            this.actionsKey = key;
        }
        this.actionsEl.setCssProps({ top: `${row.offsetTop}px` });
        this.actionsEl.addClass('is-visible');
    }

    private hideActions(): void {
        this.actionsEl.removeClass('is-visible');
        this.hoveredRow?.removeClass('is-hovered');
        this.hoveredRow = null;
        this.actionsKey = null;
    }

    private buildActions(): HTMLElement {
        const actions = createDiv({ cls: 'sh-task-actions' });
        const button = (icon: string, label: string, run: (task: Task, event: MouseEvent) => void) => {
            const el = actions.createEl('button', { cls: 'sh-task-action' });
            setIcon(el, icon);
            setTooltip(el, label);
            el.addEventListener('click', (event) => {
                event.stopPropagation();
                const task = this.actionsKey ? this.rowTasks.get(this.actionsKey) : undefined;
                if (task) run(task, event);
            });
        };
        button('calendar', t('tasksTab.actions.setDate'), (task) => this.openPalette(this.dateStage([task])));
        button('arrow-up-right', t('tasksTab.actions.openInNote'), (task) => void this.openTask(task));
        button('more-horizontal', t('tasksTab.actions.more'), (task, event) => this.showRowMenu(task, event));
        return actions;
    }

    /** Every click in the list, handled in one place. */
    private onListClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;

        const link = target.closest<HTMLElement>('a.internal-link');
        if (link) {
            const href = link.dataset.href ?? link.getAttr('href') ?? '';
            if (href && !/^https?:/.test(href)) {
                event.preventDefault();
                const row = link.closest<HTMLElement>('.sh-task-row');
                const source = row ? this.rowTasks.get(row.dataset.key ?? '')?.filePath ?? '' : '';
                void this.app.workspace.openLinkText(href, source, event.metaKey || event.ctrlKey);
            }
            return;
        }
        if (target.closest('a, .sh-task-card, .sh-task-actions')) return;

        const row = target.closest<HTMLElement>('.sh-task-row');
        if (!row) {
            if (target === this.column || target === this.scroller) {
                this.selected.clear();
                this.paintSelection();
            }
            return;
        }
        const key = row.dataset.key ?? '';
        const task = this.rowTasks.get(key);
        if (!task) return;

        if (target.closest('.sh-task-glyph')) {
            this.highlightKey = key;
            if (event.altKey) void this.setStatus([task], 'cancelled');
            else void this.toggleComplete([task]);
            return;
        }

        if (target.closest('.sh-meta-crumb')) {
            this.setList({ kind: 'note', path: task.filePath });
            this.highlightKey = key;
            this.paintSelection();
            return;
        }

        this.clickRow(task, event);
    }

    private onListDoubleClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (target.closest('a, button, .sh-task-card')) return;
        const row = target.closest<HTMLElement>('.sh-task-row');
        const task = row ? this.rowTasks.get(row.dataset.key ?? '') : undefined;
        if (task) this.toggleExpanded(task);
    }

    private onListContextMenu(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (target.closest('.sh-task-card textarea')) return;
        const row = target.closest<HTMLElement>('.sh-task-row');
        const key = row?.dataset.key ?? '';
        const task = this.rowTasks.get(key);
        if (!task) return;
        event.preventDefault();
        if (!this.selected.has(key)) {
            this.selected.clear();
            this.highlightKey = key;
            this.paintSelection();
        }
        this.showRowMenu(task, event);
    }

    /**
     * The open card: the task's notes, rendered by Obsidian (so every bit of
     * Markdown works) and editable in place, then its fields.
     */
    private renderCard(row: HTMLElement, task: Task): HTMLElement {
        const card = row.createDiv({ cls: 'sh-task-card' });
        const notes = card.createDiv({ cls: 'sh-card-notes' });
        this.paintNotes(notes, task);

        const fields = card.createDiv({ cls: 'sh-card-fields' });
        const date = task.date ? this.dateLabel(task.date) : null;
        this.cardField(fields, 'calendar', date ? date.text : t('tasksTab.actions.addDate'), date?.tone, () => this.openPalette(this.dateStage([task])));
        this.cardField(fields, 'flag', task.priority ? `P${task.priority}` : t('tasksTab.quickAdd.priority'), undefined, () => this.openPalette(this.priorityStage([task])))
            .dataset.priority = task.priority ? String(task.priority) : '';
        this.cardField(fields, 'circle-dot', this.statusLabel(task), undefined, () => this.openPalette(this.statusStage([task])));

        const where = card.createDiv({ cls: 'sh-card-where' });
        setIcon(where.createSpan({ cls: 'sh-meta-icon' }), 'file-text');
        const crumb = task.section ? `${this.noteInfo.basename(task.filePath)} › ${task.section}` : this.noteInfo.basename(task.filePath);
        const link = where.createEl('a', { cls: 'sh-card-link', text: crumb });
        link.addEventListener('click', (event) => {
            event.preventDefault();
            void this.openTask(task);
        });
        where.createSpan({ cls: 'sh-key-hint', text: '↵' });
        return card;
    }

    /** The notes as rendered Markdown; a click (not on a link) edits them. */
    private paintNotes(notes: HTMLElement, task: Task): void {
        notes.empty();
        notes.removeClass('is-editing');
        this.cardComponent?.unload();
        this.cardComponent = null;

        const markdown = notesText(task.context);
        if (markdown.trim() === '') {
            notes.createDiv({ cls: 'sh-card-empty', text: t('tasksTab.card.addNotes') });
        } else {
            const body = notes.createDiv({ cls: 'sh-card-context markdown-rendered' });
            this.cardComponent = new Component();
            this.cardComponent.load();
            void MarkdownRenderer.render(this.app, markdown, body, task.filePath, this.cardComponent);
        }

        notes.onclick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('a, input, button, .sh-card-editor')) return;
            this.editNotes(notes, task);
        };
    }

    /**
     * Notes edited as plain Markdown. Enter continues a list, Tab and
     * Shift-Tab indent, ⌘B and ⌘I wrap the selection, and ⌘↵, Escape or
     * clicking away saves.
     */
    private editNotes(notes: HTMLElement, task: Task): void {
        if (notes.hasClass('is-editing')) return;
        notes.empty();
        notes.addClass('is-editing');
        this.cardComponent?.unload();
        this.cardComponent = null;

        const original = notesText(task.context);
        const editor = notes.createEl('textarea', { cls: 'sh-card-editor' });
        editor.value = original;
        editor.placeholder = t('tasksTab.card.notesPlaceholder');
        editor.spellcheck = true;
        const fit = () => {
            editor.setCssProps({ height: 'auto' });
            editor.setCssProps({ height: `${editor.scrollHeight}px` });
        };

        let done = false;
        const finish = async () => {
            if (done) return;
            done = true;
            const markdown = editor.value;
            if (markdown.replace(/\s+$/, '') === original.replace(/\s+$/, '')) {
                this.paintNotes(notes, task);
                return;
            }
            await this.saveNotes(task, markdown);
        };

        editor.addEventListener('input', fit);
        editor.addEventListener('blur', () => void finish());
        editor.addEventListener('keydown', (event) => {
            const mod = event.metaKey || event.ctrlKey;
            if (event.key === 'Escape' || (mod && event.key === 'Enter')) {
                event.preventDefault();
                event.stopPropagation();
                void finish().then(() => this.focusList());
                return;
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && continueList(editor)) {
                event.preventDefault();
                fit();
                return;
            }
            if (event.key === 'Tab') {
                event.preventDefault();
                indentSelection(editor, event.shiftKey);
                fit();
                return;
            }
            if (mod && (event.key === 'b' || event.key === 'i')) {
                event.preventDefault();
                wrapSelection(editor, event.key === 'b' ? '**' : '*');
            }
        });

        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
        fit();
    }

    private async saveNotes(task: Task, markdown: string): Promise<void> {
        const change = await this.writer.setNotes(task, markdown);
        await this.refreshFile(task.filePath);
        this.render();
        if (!change) return;
        const label = t('tasksTab.notices.notesSaved', { task: truncate(this.plainText(task), 40) });
        this.undoStack.push({
            label,
            undo: async () => {
                await this.writer.undoRange(change);
                await this.refreshFile(change.path);
                this.render();
            }
        });
    }

    private cardField(parent: HTMLElement, icon: string, label: string, tone: string | undefined, run: () => void): HTMLElement {
        const button = parent.createEl('button', { cls: 'sh-chip' });
        if (tone) button.addClass(`is-${tone}`);
        setIcon(button.createSpan({ cls: 'sh-chip-icon' }), icon);
        button.createSpan({ cls: 'sh-chip-label', text: label });
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            run();
        });
        return button;
    }

    // ── Selection and highlight ─────────────────────────────────────────

    private clickRow(task: Task, event: MouseEvent): void {
        const key = taskKey(task);
        if (event.metaKey || event.ctrlKey) {
            if (this.selected.has(key)) this.selected.delete(key);
            else this.selected.add(key);
            this.anchorKey = key;
        } else if (event.shiftKey && this.anchorKey) {
            this.selectRange(this.anchorKey, key);
        } else {
            this.selected.clear();
            this.anchorKey = key;
        }
        this.highlightKey = key;
        this.paintSelection();
        this.focusList();
    }

    private selectRange(fromKey: string, toKey: string): void {
        const from = this.orderIndex.get(fromKey);
        const to = this.orderIndex.get(toKey);
        if (from === undefined || to === undefined) return;
        const [start, end] = from < to ? [from, to] : [to, from];
        for (let i = start; i <= end; i++) this.selected.add(taskKey(this.order[i]));
    }

    /**
     * Repaints the highlight and the selection by touching only the rows
     * whose state changed. `fresh` is for right after a rebuild, when no row
     * carries any state yet.
     */
    private paintSelection(fresh = false): void {
        if (fresh) {
            this.paintedHighlight = null;
            this.paintedSelection = new Set();
        }
        if (this.paintedHighlight !== this.highlightKey) {
            if (this.paintedHighlight) this.rowEls.get(this.paintedHighlight)?.removeClass('is-highlighted');
            const row = this.highlightKey ? this.rowEls.get(this.highlightKey) : undefined;
            if (row) {
                row.addClass('is-highlighted');
                this.moveActions(row);
            }
            this.paintedHighlight = this.highlightKey;
        }
        for (const key of this.paintedSelection) {
            if (!this.selected.has(key)) this.rowEls.get(key)?.removeClass('is-selected');
        }
        for (const key of this.selected) {
            if (!this.paintedSelection.has(key)) this.rowEls.get(key)?.addClass('is-selected');
        }
        this.paintedSelection = new Set(this.selected);
        this.column?.toggleClass('has-expanded', this.expandedKey !== null && this.rowEls.has(this.expandedKey));
        this.renderBulkbar();
    }

    private moveHighlight(delta: number, extend: boolean): void {
        if (this.order.length === 0) return;
        const current = this.highlightKey ? this.orderIndex.get(this.highlightKey) ?? -1 : -1;
        const next = current === -1 ? (delta > 0 ? 0 : this.order.length - 1) : Math.max(0, Math.min(this.order.length - 1, current + delta));
        const nextKey = taskKey(this.order[next]);

        if (extend) {
            if (!this.anchorKey) this.anchorKey = this.highlightKey ?? nextKey;
            this.selected.clear();
            this.selectRange(this.anchorKey, nextKey);
        } else {
            this.anchorKey = nextKey;
        }

        this.highlightKey = nextKey;
        // The card follows the highlight, the way Todoist's ▲▼ step through tasks.
        if (this.expandedKey !== null && !extend) this.setExpanded(nextKey);
        this.paintSelection();
        this.scrollToRow(nextKey);
    }

    private scrollToRow(key: string): void {
        const row = this.rowEls.get(key);
        if (!row) return;
        const scroller = this.scroller;
        const top = row.offsetTop - 72;
        const bottom = row.offsetTop + row.offsetHeight + 96;
        if (top < scroller.scrollTop) scroller.scrollTop = top;
        else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight;
    }

    private toggleExpanded(task?: Task): void {
        const target = task ?? this.findTask(this.highlightKey);
        if (!target) return;
        const key = taskKey(target);
        this.highlightKey = key;
        this.setExpanded(this.expandedKey === key ? null : key);
        this.paintSelection();
        this.scrollToRow(key);
    }

    /**
     * Opens one row into its card and closes the last, in place. Nothing
     * else in the list is touched, so this is instant on any page.
     */
    private setExpanded(key: string | null): void {
        if (this.expandedKey === key) return;
        const previous = this.expandedKey ? this.rowEls.get(this.expandedKey) : undefined;
        const previousTask = this.expandedKey ? this.rowTasks.get(this.expandedKey) : undefined;
        if (previous && previousTask) this.collapseRow(previous, previousTask);
        this.expandedKey = key;
        const row = key ? this.rowEls.get(key) : undefined;
        const task = key ? this.rowTasks.get(key) : undefined;
        if (row && task) this.expandRow(row, task, true);
        this.column.toggleClass('has-expanded', row !== undefined);
    }

    private expandRow(row: HTMLElement, task: Task, animate: boolean): void {
        if (this.actionsKey === row.dataset.key) this.hideActions();
        row.addClass('is-expanded');
        row.querySelector('.sh-task-context')?.remove();
        const card = this.renderCard(row, task);
        if (animate && motionAllowed()) {
            card.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: EASE });
            row.animate([{ transform: 'scale(0.99)' }, { transform: 'none' }], { duration: 200, easing: EASE });
        }
    }

    private collapseRow(row: HTMLElement, task: Task): void {
        // A note still being edited saves as the card closes.
        const editor = row.querySelector<HTMLTextAreaElement>('.sh-card-editor');
        if (editor) editor.blur();
        row.removeClass('is-expanded');
        row.querySelector('.sh-task-card')?.remove();
        this.cardComponent?.unload();
        this.cardComponent = null;
        if (this.display().showContext && task.context.length > 0) this.renderContextPreview(row, task);
    }

    // ── Keyboard ────────────────────────────────────────────────────────

    private handleKey(event: KeyboardEvent): void {
        if (this.app.workspace.getActiveViewOfType(TasksTabView) !== this) return;
        if (this.palette.isOpen || this.quickAdd.isOpen || this.glassMenu.isOpen) return;
        if (event.isComposing) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
        // A modal or a native menu is up and owns the keys.
        if (document.body.querySelector('.modal-container, .menu')) return;

        const mod = event.metaKey || event.ctrlKey;
        const key = event.key;
        const lower = key.length === 1 ? key.toLowerCase() : key;
        const consume = () => {
            event.preventDefault();
            event.stopPropagation();
        };

        if (this.menuEl) {
            if (key === 'Escape') {
                consume();
                this.closeMenu();
            }
            return;
        }

        // G then a letter: go to a list, Todoist style.
        if (this.pendingG && Date.now() - this.pendingG < 1200 && !mod) {
            this.pendingG = 0;
            const lists: Record<string, SmartListId> = { t: 'today', u: 'upcoming', a: 'anytime', i: 'in-progress', q: 'questions', d: 'logbook' };
            const id = lists[lower];
            if (id) {
                consume();
                this.setList({ kind: 'smart', id });
            }
            return;
        }

        if (mod && lower === 'k' && !event.shiftKey && !event.altKey) {
            if (event.defaultPrevented) return;
            consume();
            this.togglePalette();
            return;
        }

        if (mod && lower === 'a' && !event.shiftKey) {
            consume();
            for (const task of this.order) this.selected.add(taskKey(task));
            this.paintSelection();
            return;
        }

        if (mod && lower === 'z' && !event.altKey) {
            consume();
            void this.undo();
            return;
        }

        if (mod && key === 'Backspace') {
            if (!this.hasTargets()) return;
            consume();
            this.deleteTasks(this.targets());
            return;
        }

        if (mod && key === 'Enter') {
            const task = this.findTask(this.highlightKey);
            if (task) {
                consume();
                void this.openTask(task, true);
            }
            return;
        }

        // Things' date nudges: ctrl ] and [ move the date a day, with shift a week.
        if (event.ctrlKey && !event.metaKey && (event.code === 'BracketRight' || event.code === 'BracketLeft')) {
            const tasks = this.targets();
            if (tasks.length === 0) return;
            consume();
            const days = (event.code === 'BracketRight' ? 1 : -1) * (event.shiftKey ? 7 : 1);
            void this.nudgeDates(tasks, days);
            return;
        }

        if (mod) return;

        switch (true) {
            case key === 'ArrowDown' || (lower === 'j' && !event.shiftKey):
                consume();
                this.moveHighlight(1, event.shiftKey);
                return;
            case key === 'ArrowUp' || (lower === 'k' && !event.shiftKey):
                consume();
                this.moveHighlight(-1, event.shiftKey);
                return;
            case key === 'J':
                consume();
                this.moveHighlight(1, true);
                return;
            case key === 'K':
                consume();
                this.moveHighlight(-1, true);
                return;
            case key === 'Delete':
                if (!this.hasTargets()) return;
                consume();
                this.deleteTasks(this.targets());
                return;
            case key === 'Escape':
                if (this.expandedKey) {
                    consume();
                    this.setExpanded(null);
                    this.paintSelection();
                } else if (this.selected.size > 0) {
                    consume();
                    this.selected.clear();
                    this.paintSelection();
                }
                return;
            case key === ' ':
                consume();
                this.toggleExpanded();
                return;
            case key === 'Enter': {
                const task = this.findTask(this.highlightKey);
                if (task) {
                    consume();
                    void this.openTask(task);
                }
                return;
            }
            case lower === 'x': {
                const highlighted = this.highlightKey;
                if (!highlighted) return;
                consume();
                if (this.selected.has(highlighted)) this.selected.delete(highlighted);
                else this.selected.add(highlighted);
                this.anchorKey = highlighted;
                this.paintSelection();
                return;
            }
            case event.code === 'KeyE' && event.altKey:
                if (!this.hasTargets()) return;
                consume();
                void this.setStatus(this.targets(), 'cancelled');
                return;
            case lower === 'e':
                if (!this.hasTargets()) return;
                consume();
                void this.toggleComplete(this.targets());
                return;
            case key === 'T':
                if (!this.hasTargets()) return;
                consume();
                void this.setDates(this.targets(), null);
                return;
            case lower === 't':
                if (!this.hasTargets()) return;
                consume();
                this.openPalette(this.dateStage(this.targets()));
                return;
            case key === '1' || key === '2' || key === '3':
                if (!this.hasTargets()) return;
                consume();
                void this.setPriority(this.targets(), Number(key) as 1 | 2 | 3);
                return;
            case key === '0':
                if (!this.hasTargets()) return;
                consume();
                void this.setPriority(this.targets(), null);
                return;
            case lower === 's':
                if (!this.hasTargets()) return;
                consume();
                this.openPalette(this.statusStage(this.targets()));
                return;
            case lower === 'q' || lower === 'n':
                consume();
                this.openQuickAdd();
                return;
            case key === '/':
                consume();
                this.openPalette();
                return;
            case key === '?':
                consume();
                this.openPalette(this.shortcutsStage());
                return;
            case key === 'V':
                consume();
                this.openDisplayMenu(this.topbar.querySelector<HTMLElement>('.sh-display-button') ?? this.topbar);
                return;
            case lower === 'g' && !event.shiftKey:
                consume();
                this.pendingG = Date.now();
                return;
            case key === '[' && !event.ctrlKey:
                consume();
                this.toggleRail();
                return;
        }
    }

    // ── Writing ─────────────────────────────────────────────────────────

    private async write(tasks: Task[], label: string, transform: (line: string, task: Task) => string | null, linger = false): Promise<void> {
        if (tasks.length === 0) return;
        const result = await this.writer.apply(tasks, transform);
        if (result.missed.length > 0) {
            new Notice(t('tasksTab.notices.missed', { count: result.missed.length }));
        }
        if (result.changes.length === 0) {
            await this.refreshFiles(tasks.map(task => task.filePath));
            this.render(true);
            return;
        }

        const keys = result.changes.map(change => `${change.path}:${change.line}`);
        for (const key of keys) {
            if (!this.previewed.has(key)) this.justChanged.add(key);
        }
        this.previewed.clear();

        if (linger) {
            for (const key of keys) this.lingering.add(key);
            window.setTimeout(() => this.releaseLingering(keys), LINGER_MS);
        }

        await this.refreshFiles(result.changes.map(change => change.path));
        this.render(true);
        this.pushUndo(label, result.changes);
    }

    /**
     * Deletes tasks from their notes, each with the notes and subtasks
     * indented under it. The rows fold away first, and Undo puts the lines
     * back where they were.
     */
    private deleteTasks(tasks: Task[]): void {
        if (tasks.length === 0) return;
        const label = this.countLabel('deleted', tasks);
        const rows = tasks
            .map(task => this.column.querySelector<HTMLElement>(`.sh-task-row[data-key="${CSS.escape(taskKey(task))}"]`))
            .filter((row): row is HTMLElement => row !== null);
        collapse(rows, () => void this.removeAndRecord(tasks, label));
    }

    private async removeAndRecord(tasks: Task[], label: string): Promise<void> {
        const { removed, missed } = await this.writer.removeTasks(tasks);
        if (missed.length > 0) new Notice(t('tasksTab.notices.missed', { count: missed.length }));
        const paths = [...removed.map(block => block.path), ...missed.map(task => task.filePath)];
        for (const task of tasks) this.selected.delete(taskKey(task));
        if (tasks.some(task => taskKey(task) === this.expandedKey)) this.expandedKey = null;
        await this.refreshFiles(paths);
        this.render(true);
        if (removed.length === 0) return;
        this.undoStack.push({
            label,
            undo: async () => {
                await this.writer.restoreBlocks(removed);
                await this.refreshFiles(removed.map(block => block.path));
                this.render(true);
            }
        });
        this.toast(label, true);
    }

    /** A completed row folds away, then the rows below glide up into its place. */
    private releaseLingering(keys: string[]): void {
        const leaving = keys
            .map(key => this.column.querySelector<HTMLElement>(`.sh-task-row[data-key="${CSS.escape(key)}"]`))
            .filter((row): row is HTMLElement => row !== null);
        collapse(leaving, () => {
            for (const key of keys) this.lingering.delete(key);
            this.render(true);
        });
    }

    private pushUndo(label: string, changes: LineChange[]): void {
        this.undoStack.push({
            label,
            undo: async () => {
                await this.writer.undo(changes);
                for (const change of changes) this.justChanged.add(`${change.path}:${change.line}`);
                await this.refreshFiles(changes.map(change => change.path));
                this.render(true);
            }
        });
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.toast(label, true);
    }

    private async undo(): Promise<void> {
        const entry = this.undoStack.pop();
        if (!entry) {
            this.toast(t('tasksTab.notices.nothingToUndo'), false);
            return;
        }
        await entry.undo();
        this.toast(t('tasksTab.notices.undone', { label: entry.label }), false);
    }

    private countLabel(key: string, tasks: Task[]): string {
        if (tasks.length === 1) return t(`tasksTab.notices.${key}One`, { task: truncate(this.plainText(tasks[0]), 40) });
        return t(`tasksTab.notices.${key}Many`, { count: tasks.length });
    }

    private plainText(task: Task): string {
        const text = task.dateText ? task.text.replace(task.dateText, '') : task.text;
        return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s{2,}/g, ' ').trim();
    }

    private async toggleComplete(tasks: Task[]): Promise<void> {
        const allDone = tasks.every(task => statusOf(task) === 'done');
        const state = allDone ? ' ' : 'x';
        // The tick shows at once; the note is written right behind it.
        this.previewStatus(tasks, allDone ? 'todo' : 'done');
        await this.write(tasks, this.countLabel(allDone ? 'reopened' : 'completed', tasks), line => withState(line, state), !allDone);
    }

    /** Repaints just these rows' checkboxes ahead of the write, with the pop. */
    private previewStatus(tasks: Task[], status: TaskStatus): void {
        for (const task of tasks) {
            const key = taskKey(task);
            const row = this.rowEls.get(key);
            const glyph = row?.querySelector<HTMLElement>('.sh-task-glyph');
            if (!row || !glyph) continue;
            glyph.empty();
            delete glyph.dataset.priority;
            delete glyph.dataset.marker;
            delete glyph.dataset.tone;
            paintGlyph(glyph, { status, priority: undefined });
            glyph.removeClass('is-just-changed');
            void glyph.offsetWidth;
            glyph.addClass('is-just-changed');
            row.toggleClass('is-resolved', status === 'done' || status === 'cancelled');
            this.previewed.add(key);
        }
    }

    private async setStatus(tasks: Task[], status: TaskStatus): Promise<void> {
        const state = statusToCheckboxState(status);
        const resolves = status === 'done' || status === 'cancelled';
        await this.write(tasks, this.countLabel(status === 'cancelled' ? 'cancelled' : 'statusSet', tasks), line => withState(line, state), resolves);
    }

    /** Sets an alternate checkbox such as [>] or [*]. Like a status, it replaces any priority. */
    private async setMarker(tasks: Task[], char: string): Promise<void> {
        await this.write(tasks, this.countLabel('statusSet', tasks), line => withState(line, char));
    }

    private async setPriority(tasks: Task[], level: 1 | 2 | 3 | null): Promise<void> {
        await this.write(tasks, this.countLabel('prioritySet', tasks), (line) => {
            const parsed = parseTaskLine(line);
            if (!parsed) return null;
            // Status and priority share the brackets, so a priority replaces a status.
            if (level) return withState(line, `!${level}`);
            return parsed.state.startsWith('!') ? withState(line, ' ') : line;
        });
    }

    private async setDates(tasks: Task[], iso: string | null): Promise<void> {
        const formatted = iso ? this.formatDate(iso) : null;
        await this.write(tasks, this.countLabel(iso ? 'dateSet' : 'dateRemoved', tasks), (line, task) => {
            const parsed = parseTaskLine(line);
            if (!parsed) return null;
            return `${parsed.prefix}${parsed.indent}- [${parsed.state}] ${setDateInText(parsed.text, task.dateText, formatted)}`;
        });
    }

    private async nudgeDates(tasks: Task[], days: number): Promise<void> {
        const today = isoToday();
        await this.write(tasks, this.countLabel('dateSet', tasks), (line, task) => {
            const parsed = parseTaskLine(line);
            if (!parsed) return null;
            const next = this.formatDate(addDays(task.date ?? today, days));
            return `${parsed.prefix}${parsed.indent}- [${parsed.state}] ${setDateInText(parsed.text, task.dateText, next)}`;
        });
    }

    private async copyTasks(tasks: Task[]): Promise<void> {
        const lines = tasks.map(task => {
            const state = task.priority ? `!${task.priority}` : task.marker ?? statusToCheckboxState(statusOf(task));
            return `- [${state}] ${task.text}`;
        });
        await navigator.clipboard.writeText(lines.join('\n'));
        this.toast(this.countLabel('copied', tasks), false);
    }

    private async addLines(lines: string[], destination: Destination): Promise<boolean> {
        const at = await this.writer.insert(destination.path, destination.heading, lines);
        if (at === -1) {
            new Notice(t('tasksTab.notices.noteMissing'));
            return false;
        }
        this.writeJson(STORAGE.destination, destination);
        await this.refreshFile(destination.path);
        this.highlightKey = `${destination.path}:${at}`;
        this.render(true);
        this.scrollToRow(this.highlightKey);

        const label = lines.length === 1
            ? t('tasksTab.notices.addedOne', { note: this.destinationLabel(destination) })
            : t('tasksTab.notices.addedMany', { count: lines.length, note: this.destinationLabel(destination) });
        this.undoStack.push({
            label,
            undo: async () => {
                await this.writer.remove(destination.path, at, lines);
                await this.refreshFile(destination.path);
                this.render(true);
            }
        });
        this.toast(label, true);
        return true;
    }

    // ── Opening notes ───────────────────────────────────────────────────

    private async openPath(path: string, line?: number, split = false): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;

        let leaf: WorkspaceLeaf | null = null;
        if (!split) {
            leaf = this.app.workspace.getLeavesOfType('markdown')
                .find(candidate => (candidate.view as MarkdownView).file?.path === path) ?? null;
        }
        if (!leaf) leaf = split ? this.app.workspace.getLeaf('split', 'vertical') : this.app.workspace.getLeaf('tab');

        await leaf.openFile(file, { active: true });
        this.app.workspace.setActiveLeaf(leaf, { focus: true });

        const view = leaf.view;
        if (line === undefined || !(view instanceof MarkdownView)) return;
        if (view.getMode() === 'preview') {
            view.setEphemeralState({ line });
            return;
        }
        const editor = view.editor;
        const safeLine = Math.min(line, editor.lineCount() - 1);
        const ch = editor.getLine(safeLine).length;
        editor.setCursor({ line: safeLine, ch });
        editor.scrollIntoView({ from: { line: safeLine, ch: 0 }, to: { line: safeLine, ch } }, true);
    }

    private async openTask(task: Task, split = false): Promise<void> {
        await this.openPath(task.filePath, task.lineNumber, split);
    }

    // ── Quick add destinations ──────────────────────────────────────────

    private destinationLabel(destination: Destination): string {
        const name = this.noteInfo.basename(destination.path);
        return destination.heading ? `${name} › ${destination.heading}` : name;
    }

    private defaultDestination(): Destination | null {
        if (this.list.kind === 'note') return { path: this.list.path };
        const exists = (path: string) => this.app.vault.getAbstractFileByPath(path) instanceof TFile;
        const remembered = this.readJson<Destination | null>(STORAGE.destination, null);
        if (remembered && exists(remembered.path)) return remembered;
        const recent = this.app.workspace.getLastOpenFiles().find(path => path.endsWith('.md') && exists(path));
        return recent ? { path: recent } : null;
    }

    /** Notes with tasks first, each followed by its headings, then every other note. */
    private destinationChoices(): Destination[] {
        const withTasks = [...new Set(this.allTasks.map(task => task.filePath))];
        const choices: Destination[] = [];
        for (const path of withTasks) {
            choices.push({ path });
            const file = this.app.vault.getAbstractFileByPath(path);
            const headings = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.headings ?? [] : [];
            for (const heading of headings) choices.push({ path, heading: heading.heading });
        }
        const seen = new Set(withTasks);
        for (const file of this.app.vault.getMarkdownFiles()) {
            if (!seen.has(file.path) && this.taskManager.shouldProcessFile(file)) choices.push({ path: file.path });
        }
        return choices;
    }

    /** The note picker for quick add: a palette page over the hidden panel. */
    private pickDestination(done: (destination: Destination) => void): void {
        this.quickAdd.setHidden(true);
        const choices = this.destinationChoices();
        this.palette.open({
            placeholder: '',
            sections: [],
            items: () => [],
            onClose: () => this.quickAdd.setHidden(false)
        }, {
            title: t('tasksTab.quickAdd.addTo'),
            placeholder: t('tasksTab.quickAdd.destinationPlaceholder'),
            items: () => choices.map(choice => {
                const name = this.noteInfo.basename(choice.path);
                return {
                    id: `dest:${choice.path}#${choice.heading ?? ''}`,
                    section: '',
                    icon: choice.heading ? 'heading' : 'file-text',
                    label: choice.heading ?? name,
                    sublabel: choice.heading ? name : this.noteInfo.folder(choice.path) || undefined,
                    keywords: `${name} ${choice.heading ?? ''}`,
                    run: () => done(choice)
                };
            })
        });
    }

    // ── Palette ─────────────────────────────────────────────────────────

    private openPalette(stage?: PaletteStage): void {
        this.closeMenu();
        const sections = {
            selection: t('tasksTab.palette.selection'),
            lists: t('tasksTab.palette.lists'),
            actions: t('tasksTab.palette.actions'),
            notes: t('tasksTab.palette.notes'),
            tasks: t('tasksTab.palette.tasks')
        };
        this.palette.open({
            placeholder: t('tasksTab.palette.placeholder'),
            sections: [sections.selection, sections.lists, sections.actions, sections.notes, sections.tasks],
            items: (query) => this.paletteItems(query, sections),
            onClose: () => this.focusList()
        }, stage);
    }

    private paletteItems(query: string, sections: Record<'selection' | 'lists' | 'actions' | 'notes' | 'tasks', string>): PaletteItem[] {
        const items: PaletteItem[] = [];
        const targets = this.targets();

        if (targets.length > 0) {
            const allDone = targets.every(task => statusOf(task) === 'done');
            const scope = targets.length > 1 ? ` (${targets.length})` : '';
            items.push(
                { id: 'complete', section: sections.selection, icon: allDone ? 'rotate-ccw' : 'check', label: (allDone ? t('tasksTab.actions.reopen') : t('tasksTab.actions.complete')) + scope, detail: 'E', run: () => void this.toggleComplete(targets) },
                { id: 'date', section: sections.selection, icon: 'calendar', label: t('tasksTab.actions.setDate') + scope, detail: 'T', stage: this.dateStage(targets), keywords: 'schedule reschedule due when' },
                { id: 'priority', section: sections.selection, icon: 'flag', label: t('tasksTab.actions.setPriority') + scope, detail: '1–3', stage: this.priorityStage(targets) },
                { id: 'status', section: sections.selection, icon: 'circle-dot', label: t('tasksTab.actions.setStatus') + scope, detail: 'S', stage: this.statusStage(targets), keywords: 'in progress question cancel' },
                { id: 'cancel', section: sections.selection, icon: 'circle-slash', label: t('tasksTab.actions.cancel') + scope, detail: '⌥E', run: () => void this.setStatus(targets, 'cancelled') },
                { id: 'copy', section: sections.selection, icon: 'copy', label: t('tasksTab.actions.copy') + scope, run: () => void this.copyTasks(targets), keywords: 'markdown clipboard' },
                { id: 'delete', section: sections.selection, icon: 'trash-2', label: t('tasksTab.actions.delete') + scope, detail: '⌘⌫', destructive: true, keywords: 'remove', run: () => this.deleteTasks(targets) }
            );
            if (targets.some(task => task.date)) {
                items.push({ id: 'remove-date', section: sections.selection, icon: 'calendar-x', label: t('tasksTab.actions.removeDate') + scope, detail: '⇧T', run: () => void this.setDates(targets, null) });
            }
            if (targets.length === 1) {
                const task = targets[0];
                items.push(
                    { id: 'open', section: sections.selection, icon: 'arrow-up-right', label: t('tasksTab.actions.openInNote'), detail: '↵', run: () => void this.openTask(task) },
                    { id: 'open-split', section: sections.selection, icon: 'columns-2', label: t('tasksTab.actions.openToSide'), detail: '⌘↵', run: () => void this.openTask(task, true) }
                );
            }
        }

        const counts = listCounts(this.allTasks, isoToday());
        const hints: Record<SmartListId, string> = { today: 'G T', upcoming: 'G U', anytime: 'G A', 'in-progress': 'G I', questions: 'G Q', logbook: 'G D' };
        const countOf: Partial<Record<SmartListId, number>> = { today: counts.today, upcoming: counts.upcoming, anytime: counts.anytime, 'in-progress': counts.inProgress, questions: counts.questions };
        for (const id of SMART_LISTS) {
            items.push({
                id: `list:${id}`,
                section: sections.lists,
                paintIcon: (el) => paintListIcon(el, id),
                label: t(`tasksTab.lists.${id}`),
                sublabel: countOf[id] ? String(countOf[id]) : undefined,
                detail: hints[id],
                run: () => this.setList({ kind: 'smart', id })
            });
        }

        items.push(
            { id: 'add', section: sections.actions, icon: 'plus', label: t('tasksTab.actions.addTask'), detail: 'Q', keywords: 'new create quick capture', run: () => this.openQuickAdd() },
            { id: 'display', section: sections.actions, icon: 'sliders-horizontal', label: t('tasksTab.actions.display'), detail: '⇧V', keywords: 'group sort view options', run: () => this.openDisplayMenu(this.topbar.querySelector<HTMLElement>('.sh-display-button') ?? this.topbar) },
            { id: 'rail', section: sections.actions, icon: 'panel-left', label: t('tasksTab.actions.toggleSidebar'), detail: '[', run: () => this.toggleRail() },
            { id: 'shortcuts', section: sections.actions, icon: 'keyboard', label: t('tasksTab.actions.shortcuts'), detail: '?', stage: this.shortcutsStage() }
        );
        if (this.undoStack.length > 0) {
            const last = this.undoStack[this.undoStack.length - 1];
            items.push({ id: 'undo', section: sections.actions, icon: 'undo-2', label: t('tasksTab.actions.undo'), sublabel: last.label, detail: '⌘Z', run: () => void this.undo() });
        }

        if (query.trim() === '') return items;

        for (const area of railAreas(this.allTasks, this.noteInfo)) {
            for (const note of area.notes) {
                items.push({
                    id: `note:${note.path}`,
                    section: sections.notes,
                    icon: 'file-text',
                    label: note.name,
                    sublabel: area.folder || undefined,
                    detail: String(note.open),
                    run: () => this.setList({ kind: 'note', path: note.path })
                });
            }
        }

        const taskItems = [...this.allTasks].sort((a, b) => Number(isOpenTask(b)) - Number(isOpenTask(a)));
        for (const task of taskItems) {
            items.push({
                id: `task:${taskKey(task)}`,
                section: sections.tasks,
                label: this.plainText(task),
                sublabel: breadcrumbFor(task, 'flat', this.noteInfo),
                paintIcon: (el) => paintGlyph(el.createDiv({ cls: 'sh-task-glyph is-small' }), task),
                run: () => this.revealTask(task)
            });
        }
        return items;
    }

    /** Shows a task found from the palette: in this list if it's here, otherwise in its note. */
    private revealTask(task: Task): void {
        const key = taskKey(task);
        if (!this.order.some(candidate => taskKey(candidate) === key)) {
            this.list = { kind: 'note', path: task.filePath };
            this.writeJson(STORAGE.list, this.list);
            if (!isOpenTask(task)) this.setDisplayQuiet({ showCompleted: true });
        }
        this.selected.clear();
        this.highlightKey = key;
        this.expandedKey = key;
        this.render();
        this.scrollToRow(key);
    }

    private setDisplayQuiet(patch: Partial<DisplayOptions>): void {
        this.displayByList[listKey(this.list)] = { ...this.display(), ...patch };
        this.writeJson(STORAGE.display, this.displayByList);
    }

    private dateStage(tasks: Task[]): PaletteStage {
        const today = isoToday();
        const saturday = weekday(today) === 6 ? today : addDays(today, (6 - weekday(today) + 7) % 7);
        const presets: Array<[string, string]> = [
            [t('tasksTab.dates.today'), today],
            [t('tasksTab.dates.tomorrow'), addDays(today, 1)],
            [t('tasksTab.dates.weekend'), saturday],
            [t('tasksTab.dates.nextWeek'), addDays(startOfWeek(today), 7)],
            [t('tasksTab.dates.twoWeeks'), addDays(today, 14)]
        ];
        const scope = tasks.length > 1 ? ` · ${tasks.length}` : '';
        return {
            title: t('tasksTab.actions.setDate') + scope,
            placeholder: t('tasksTab.palette.datePlaceholder'),
            readsQuery: true,
            items: (query) => {
                const rows: PaletteItem[] = [];
                const parsed = parseDateQuery(query, today);
                if (parsed) {
                    rows.push({ id: `date:${parsed}`, section: '', icon: 'calendar-check', label: this.dateLabel(parsed).text, sublabel: this.formatDate(parsed), run: () => void this.setDates(tasks, parsed) });
                }
                const needle = query.trim().toLowerCase();
                for (const [label, iso] of presets) {
                    if (iso === parsed) continue;
                    if (needle && !label.toLowerCase().includes(needle)) continue;
                    rows.push({ id: `date:${label}`, section: '', icon: 'calendar', label, sublabel: this.dateLabel(iso).text === label ? this.formatDate(iso) : this.dateLabel(iso).text, run: () => void this.setDates(tasks, iso) });
                }
                if (tasks.some(task => task.date) && (!needle || t('tasksTab.dates.noDate').toLowerCase().includes(needle))) {
                    rows.push({ id: 'date:none', section: '', icon: 'calendar-x', label: t('tasksTab.dates.noDate'), divider: true, run: () => void this.setDates(tasks, null) });
                }
                return rows;
            }
        };
    }

    private priorityStage(tasks: Task[]): PaletteStage {
        return {
            title: t('tasksTab.actions.setPriority'),
            placeholder: t('tasksTab.palette.priorityPlaceholder'),
            items: () => {
                const levels: Array<1 | 2 | 3> = [1, 2, 3];
                const rows: PaletteItem[] = levels.map(level => ({
                    id: `p${level}`,
                    section: '',
                    label: t(`tasksTab.priority.p${level}`),
                    detail: String(level),
                    paintIcon: (el: HTMLElement) => {
                        const flag = el.createDiv({ cls: 'sh-flag' });
                        flag.dataset.priority = String(level);
                        setIcon(flag, 'flag');
                    },
                    run: () => void this.setPriority(tasks, level)
                }));
                rows.push({ id: 'p0', section: '', icon: 'flag-off', label: t('tasksTab.priority.none'), detail: '0', run: () => void this.setPriority(tasks, null) });
                return rows;
            }
        };
    }

    private statusStage(tasks: Task[]): PaletteStage {
        const statuses: TaskStatus[] = ['todo', 'in-progress', 'question', 'done', 'cancelled'];
        return {
            title: t('tasksTab.actions.setStatus'),
            placeholder: t('tasksTab.palette.statusPlaceholder'),
            items: () => [
                ...statuses.map(status => ({
                    id: `status:${status}`,
                    section: '',
                    label: t(`tasksTab.status.${status}`),
                    paintIcon: (el: HTMLElement) => paintGlyph(el.createDiv({ cls: 'sh-task-glyph is-small' }), { status, priority: undefined }),
                    run: () => void this.setStatus(tasks, status)
                })),
                ...MARKER_DEFS.map((def, index) => ({
                    id: `marker:${def.id}`,
                    section: '',
                    label: t(`tasksTab.markers.${def.id}`),
                    detail: `[${def.char}]`,
                    divider: index === 0,
                    paintIcon: (el: HTMLElement) => paintGlyph(el.createDiv({ cls: 'sh-task-glyph is-small' }), { status: 'todo', priority: undefined, marker: def.char }),
                    run: () => void this.setMarker(tasks, def.char)
                }))
            ]
        };
    }

    /** What a task's status reads as, naming its alternate marker when it has one. */
    private statusLabel(task: Task): string {
        const marker = statusOf(task) === 'todo' && !task.priority ? markerDef(task.marker) : undefined;
        return marker ? t(`tasksTab.markers.${marker.id}`) : t(`tasksTab.status.${statusOf(task)}`);
    }

    private shortcutsStage(): PaletteStage {
        const rows: Array<[string, string]> = [
            ['J / K', 'moveHighlight'],
            ['X', 'select'],
            ['⇧J / ⇧K', 'extendSelection'],
            ['Space', 'expand'],
            ['↵', 'openInNote'],
            ['⌘↵', 'openToSide'],
            ['E', 'complete'],
            ['⌥E', 'cancel'],
            ['⌘⌫', 'delete'],
            ['T', 'setDate'],
            ['⇧T', 'removeDate'],
            ['⌃] / ⌃[', 'nudgeDate'],
            ['1 2 3 / 0', 'setPriority'],
            ['S', 'setStatus'],
            ['Q', 'addTask'],
            ['⌘K  /', 'search'],
            ['G then T U A I Q D', 'goTo'],
            ['⇧V', 'display'],
            ['[', 'toggleSidebar'],
            ['⌘Z', 'undo'],
            ['Esc', 'escape']
        ];
        return {
            title: t('tasksTab.actions.shortcuts'),
            placeholder: t('tasksTab.palette.shortcutsPlaceholder'),
            items: () => rows.map(([keys, action]) => ({
                id: `key:${action}`,
                section: '',
                icon: 'keyboard',
                label: t(`tasksTab.shortcuts.${action}`),
                detail: keys
            }))
        };
    }

    // ── Context menu ────────────────────────────────────────────────────

    private showRowMenu(task: Task, event: MouseEvent): void {
        const tasks = this.selected.has(taskKey(task)) ? this.targets() : [task];
        const allDone = tasks.every(candidate => statusOf(candidate) === 'done');
        const items: GlassMenuItem[] = [
            { label: allDone ? t('tasksTab.actions.reopen') : t('tasksTab.actions.complete'), icon: allDone ? 'rotate-ccw' : 'check', detail: 'E', run: () => void this.toggleComplete(tasks) },
            { label: t('tasksTab.actions.setDate'), icon: 'calendar', detail: 'T', run: () => this.openPalette(this.dateStage(tasks)) },
            { label: t('tasksTab.actions.setPriority'), icon: 'flag', detail: '1–3', run: () => this.openPalette(this.priorityStage(tasks)) },
            { label: t('tasksTab.actions.setStatus'), icon: 'circle-dot', detail: 'S', run: () => this.openPalette(this.statusStage(tasks)) }
        ];
        if (tasks.length === 1) {
            items.push(
                { label: t('tasksTab.actions.openInNote'), icon: 'arrow-up-right', detail: '↵', divider: true, run: () => void this.openTask(task) },
                { label: t('tasksTab.actions.openToSide'), icon: 'columns-2', detail: '⌘↵', run: () => void this.openTask(task, true) }
            );
        }
        items.push(
            { label: t('tasksTab.actions.copy'), icon: 'copy', divider: tasks.length > 1, run: () => void this.copyTasks(tasks) },
            { label: t('tasksTab.actions.cancel'), icon: 'circle-slash', detail: '⌥E', divider: true, run: () => void this.setStatus(tasks, 'cancelled') },
            { label: t('tasksTab.actions.delete'), icon: 'trash-2', detail: '⌘⌫', destructive: true, run: () => this.deleteTasks(tasks) }
        );
        this.closeMenu();
        this.glassMenu.showAtEvent(event, items, () => this.focusList());
    }

    // ── Display menu (glass) ────────────────────────────────────────────

    private openDisplayMenu(anchor: HTMLElement): void {
        if (this.menuEl) {
            this.closeMenu();
            return;
        }
        this.palette.close();

        const menu = this.main.createDiv({ cls: 'sh-glass sh-menu' });
        this.menuEl = menu;
        const place = () => {
            const host = this.main.getBoundingClientRect();
            const rect = anchor.getBoundingClientRect();
            menu.setCssProps({
                top: `${rect.bottom - host.top + 8}px`,
                right: `${Math.max(12, host.right - rect.right)}px`
            });
        };
        place();

        const paint = () => {
            menu.empty();
            const display = this.display();
            const groups: Array<[GroupMode, string]> = [
                ['auto', t('tasksTab.display.groupAuto')],
                ['note', t('tasksTab.display.groupNote')],
                ['date', t('tasksTab.display.groupDate')],
                ['priority', t('tasksTab.display.groupPriority')],
                ['none', t('tasksTab.display.groupNone')]
            ];
            const sorts: Array<[SortMode, string]> = [
                ['file', t('tasksTab.display.sortFile')],
                ['date', t('tasksTab.display.sortDate')],
                ['priority', t('tasksTab.display.sortPriority')],
                ['alpha', t('tasksTab.display.sortAlpha')]
            ];

            menu.createDiv({ cls: 'sh-menu-section', text: t('tasksTab.display.groupBy') });
            for (const [mode, label] of groups) this.menuRow(menu, label, display.group === mode, () => this.setDisplay({ group: mode }), paint);
            menu.createDiv({ cls: 'sh-menu-section', text: t('tasksTab.display.sortBy') });
            for (const [mode, label] of sorts) this.menuRow(menu, label, display.sort === mode, () => this.setDisplay({ sort: mode }), paint);
            menu.createDiv({ cls: 'sh-menu-divider' });
            if (!(this.list.kind === 'smart' && this.list.id === 'logbook')) {
                this.menuToggle(menu, t('tasksTab.display.showCompleted'), display.showCompleted, () => this.setDisplay({ showCompleted: !display.showCompleted }), paint);
            }
            this.menuToggle(menu, t('tasksTab.display.showContext'), display.showContext, () => this.setDisplay({ showContext: !display.showContext }), paint);
            if (this.isDisplayChanged()) {
                menu.createDiv({ cls: 'sh-menu-divider' });
                const reset = menu.createDiv({ cls: 'sh-menu-item is-quiet' });
                reset.createDiv({ cls: 'sh-menu-label', text: t('tasksTab.display.reset') });
                reset.addEventListener('click', () => {
                    delete this.displayByList[listKey(this.list)];
                    this.writeJson(STORAGE.display, this.displayByList);
                    this.render();
                    paint();
                });
            }
        };
        paint();

        const outside = (event: MouseEvent) => {
            if (!menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) this.closeMenu();
        };
        window.setTimeout(() => document.addEventListener('mousedown', outside, true));
        this.menuCleanup = () => document.removeEventListener('mousedown', outside, true);
    }

    private menuRow(menu: HTMLElement, label: string, checked: boolean, run: () => void, repaint: () => void): void {
        const row = menu.createDiv({ cls: 'sh-menu-item' });
        const check = row.createDiv({ cls: 'sh-menu-check' });
        if (checked) setIcon(check, 'check');
        row.createDiv({ cls: 'sh-menu-label', text: label });
        row.addEventListener('click', () => {
            run();
            repaint();
        });
    }

    private menuToggle(menu: HTMLElement, label: string, on: boolean, run: () => void, repaint: () => void): void {
        const row = menu.createDiv({ cls: 'sh-menu-item' });
        row.createDiv({ cls: 'sh-menu-label', text: label });
        const toggle = row.createDiv({ cls: 'sh-menu-toggle' });
        toggle.toggleClass('is-on', on);
        row.addEventListener('click', () => {
            run();
            repaint();
        });
    }

    private closeMenu(): void {
        this.menuCleanup?.();
        this.menuCleanup = null;
        this.menuEl?.remove();
        this.menuEl = null;
    }

    // ── Bulk bar and toast ──────────────────────────────────────────────

    private renderBulkbar(): void {
        const bar = this.bulkbar;
        if (!bar) return;
        const count = this.selected.size;
        bar.toggleClass('is-visible', count > 0);
        this.main.toggleClass('has-bulkbar', count > 0);
        if (count === 0) {
            bar.empty();
            return;
        }
        bar.empty();
        const clear = bar.createEl('button', { cls: 'sh-bar-button' });
        setIcon(clear, 'x');
        setTooltip(clear, t('tasksTab.bulk.clear'), { placement: 'top' });
        clear.addEventListener('click', () => {
            this.selected.clear();
            this.paintSelection();
        });
        bar.createDiv({ cls: 'sh-bulk-count', text: t('tasksTab.bulk.selected', { count }) });
        bar.createDiv({ cls: 'sh-bar-divider' });

        const targets = () => this.targets();
        const allDone = targets().every(task => statusOf(task) === 'done');
        const complete = this.bulkButton(bar, allDone ? 'rotate-ccw' : 'check', allDone ? t('tasksTab.actions.reopen') : t('tasksTab.actions.complete'), 'E', () => void this.toggleComplete(targets()));
        complete.addClass('is-primary');
        this.bulkButton(bar, 'calendar', t('tasksTab.actions.setDate'), 'T', () => this.openPalette(this.dateStage(targets())));
        this.bulkButton(bar, 'flag', t('tasksTab.actions.setPriority'), '1–3', () => this.openPalette(this.priorityStage(targets())));
        this.bulkButton(bar, 'circle-dot', t('tasksTab.actions.setStatus'), 'S', () => this.openPalette(this.statusStage(targets())));
        this.bulkButton(bar, 'copy', t('tasksTab.actions.copy'), '', () => void this.copyTasks(targets()));
        bar.createDiv({ cls: 'sh-bar-divider' });
        this.bulkButton(bar, 'trash-2', t('tasksTab.actions.delete'), '⌘⌫', () => this.deleteTasks(targets())).addClass('is-destructive');
    }

    private bulkButton(bar: HTMLElement, icon: string, label: string, key: string, run: () => void): HTMLElement {
        const button = bar.createEl('button', { cls: 'sh-bar-button' });
        setIcon(button, icon);
        setTooltip(button, key ? `${label} (${key})` : label, { placement: 'top' });
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            run();
        });
        return button;
    }

    private toast(message: string, undoable: boolean): void {
        if (this.toastTimer) window.clearTimeout(this.toastTimer);
        this.toastEl?.remove();
        const toast = this.main.createDiv({ cls: 'sh-glass sh-toast' });
        this.toastEl = toast;
        toast.createSpan({ cls: 'sh-toast-text', text: message });
        if (undoable) {
            const undo = toast.createEl('button', { cls: 'sh-link-button', text: t('tasksTab.actions.undo') });
            undo.addEventListener('click', () => {
                toast.remove();
                void this.undo();
            });
        }
        window.requestAnimationFrame(() => toast.addClass('is-visible'));
        this.toastTimer = window.setTimeout(() => {
            toast.removeClass('is-visible');
            window.setTimeout(() => toast.remove(), 200);
        }, 5000);
    }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The right half of the squircle, for the in-progress fill. */
const SQUIRCLE_RIGHT_HALF = 'M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9Z';

const GLYPH_MARKS: Partial<Record<TaskStatus, string[]>> = {
    done: ['M8 12.4l2.8 2.8L16.2 9.6'],
    cancelled: ['M8.5 12h7'],
    question: ['M9.6 9.6a2.5 2.5 0 0 1 4.85.85c0 1.65-2.45 2.2-2.45 2.2', 'M12 15.9h.01'],
    // Drawn faintly on hover over an open task: the check it's about to get.
    todo: ['M8 12.4l2.8 2.8L16.2 9.6']
};

function svgPath(parent: Element, d: string, cls: string): SVGPathElement {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', cls);
    parent.appendChild(path);
    return path;
}

/**
 * The one leading glyph a row carries, drawn as a squircle to match the
 * sidebar's checkboxes. Status and priority share the checkbox brackets in
 * Markdown, so a task has one or the other and the glyph shows whichever it
 * has: an outline in the priority colour, or a shape for the status (half
 * filled for in progress, a question mark, dashed for cancelled, a filled
 * check for done).
 */
/** Built once per kind of glyph and cloned for every row after that. */
const glyphTemplates = new Map<string, Node[]>();

export function paintGlyph(el: HTMLElement, task: Pick<Task, 'status' | 'priority'> & Partial<Pick<Task, 'completed' | 'marker'>>): void {
    const status = task.status ?? (task.completed ? 'done' : 'todo');
    el.dataset.status = status;
    if (task.priority) el.dataset.priority = String(task.priority);

    // An alternate checkbox ([>], [*], [i] …) is an open task that wears its
    // own icon inside the squircle, in its own colour.
    const marker = status === 'todo' && !task.priority ? markerDef(task.marker) : undefined;
    if (marker) {
        el.dataset.marker = marker.id;
        el.dataset.tone = marker.tone;
    }

    const templateKey = `${status}|${marker?.id ?? ''}`;
    let template = glyphTemplates.get(templateKey);
    if (!template) {
        const scratch = createDiv();
        drawGlyph(scratch, status, marker);
        template = Array.from(scratch.childNodes);
        glyphTemplates.set(templateKey, template);
    }
    for (const node of template) el.appendChild(node.cloneNode(true));
}

function drawGlyph(el: HTMLElement, status: TaskStatus, marker: ReturnType<typeof markerDef>): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'sh-glyph-svg');
    svg.setAttribute('aria-hidden', 'true');
    svgPath(svg, SQUIRCLE_PATH, 'sh-glyph-fill');
    if (status === 'in-progress') {
        svgPath(svg, SQUIRCLE_RIGHT_HALF, 'sh-glyph-half').setAttribute('transform', 'translate(12 12) scale(0.6) translate(-12 -12)');
    }
    svgPath(svg, SQUIRCLE_PATH, 'sh-glyph-outline');
    if (!marker) for (const d of GLYPH_MARKS[status] ?? []) svgPath(svg, d, 'sh-glyph-mark');
    el.appendChild(svg);
    if (marker) setIcon(el.createSpan({ cls: 'sh-glyph-icon' }), marker.icon);
}

/** A dashed squircle, for the row that invites a new task. */
function paintEmptyGlyph(el: HTMLElement): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'sh-glyph-svg');
    svgPath(svg, SQUIRCLE_PATH, 'sh-glyph-outline');
    el.appendChild(svg);
}

/** Enter inside a list item starts the next item, or ends the list on an empty one. */
function continueList(editor: HTMLTextAreaElement): boolean {
    const { value, selectionStart, selectionEnd } = editor;
    if (selectionStart !== selectionEnd) return false;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const line = value.slice(lineStart, selectionStart);
    const match = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[.\]\s+)?/);
    if (!match) return false;
    if (line.trim() === match[0].trim()) {
        // An empty item: the list ends here.
        editor.setRangeText('', lineStart, selectionStart, 'end');
        return true;
    }
    const [, indent, bullet, space, box] = match;
    const next = /\d/.test(bullet) ? `${parseInt(bullet, 10) + 1}${bullet.slice(-1)}` : bullet;
    editor.setRangeText(`\n${indent}${next}${space}${box ? '[ ] ' : ''}`, selectionStart, selectionEnd, 'end');
    return true;
}

/** Tab and Shift-Tab indent or outdent every line the selection touches. */
function indentSelection(editor: HTMLTextAreaElement, outdent: boolean): void {
    const { value, selectionStart, selectionEnd } = editor;
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const end = selectionEnd;
    const block = value.slice(start, end);
    const lines = block.split('\n');
    const changed = lines.map(line => (outdent ? line.replace(/^( {1,4}|\t)/, '') : `    ${line}`));
    const text = changed.join('\n');
    editor.setRangeText(text, start, end, 'select');
    if (selectionStart === selectionEnd) {
        const shift = text.length - block.length;
        editor.setSelectionRange(Math.max(start, selectionStart + shift), Math.max(start, selectionStart + shift));
    }
}

/** ⌘B and ⌘I: wrap the selection in Markdown emphasis, or unwrap it. */
function wrapSelection(editor: HTMLTextAreaElement, mark: string): void {
    const { value, selectionStart, selectionEnd } = editor;
    const selected = value.slice(selectionStart, selectionEnd);
    const before = value.slice(selectionStart - mark.length, selectionStart);
    const after = value.slice(selectionEnd, selectionEnd + mark.length);
    if (before === mark && after === mark) {
        editor.setRangeText(selected, selectionStart - mark.length, selectionEnd + mark.length, 'select');
        return;
    }
    editor.setRangeText(`${mark}${selected}${mark}`, selectionStart, selectionEnd, 'end');
    if (selected === '') editor.setSelectionRange(selectionStart + mark.length, selectionStart + mark.length);
}

function truncate(text: string, length: number): string {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
