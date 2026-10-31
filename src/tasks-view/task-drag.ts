/**
 * Dragging tasks to a new place in their note, with a mouse or trackpad.
 *
 * A row lifts once the pointer has moved a few pixels and follows it, and
 * the rows around it slide apart to show where it will land, with the
 * heading it would land under lit up; the list scrolls when the pointer
 * nears its top or bottom edge. In a list sorted by
 * anything other than the note's own order the rows stay put and the task
 * drops onto a heading instead. Escape puts everything back.
 *
 * In a note's own list, a heading's title drags the same way: its group
 * lifts with the groups of the smaller headings under it, and drops above
 * another heading or at the bottom, moving the section in the note.
 *
 * Positions are measured once, when the drag starts, and everything after
 * that is arithmetic on them (drag-plan.ts), so a long note stays smooth.
 */

import type { Task } from '../../main';
import type { HeadingRef, HeadingTarget, MoveTarget } from './task-move';
import { isOpenTask } from './task-views';
import { nearestGap, planDrag, planHeadingDrag, shiftFor } from './drag-plan';
import type { DragGap, DragItem, DragPlan, HeadingDragItem } from './drag-plan';
import { paintRun } from './row-runs';

export interface DragHost {
    taskOf(row: HTMLElement): Task | undefined;
    /** The note a list group shows, and its heading (with that heading's line) when the group is one heading. */
    groupOf(group: HTMLElement): { path: string; heading?: string; headingLine?: number } | null;
    /** The tasks a drag of this one carries: the whole selection when it's part of one. */
    carried(task: Task): Task[];
    canDrag(): boolean;
    /** The list is in the note's own order, so a task can land between two others. */
    inNoteOrder(): boolean;
    /** Completed tasks are shown, gathered at the bottom of each heading. */
    completedLast(): boolean;
    /** Moves the tasks. False when nothing moved, so the rows go back. */
    drop(tasks: Task[], target: MoveTarget, heading: string, from: Task): Promise<boolean>;
    /**
     * A heading's group in a note's list: its note, and its heading's line
     * and text (neither for the loose tasks). A pinned group stays put. Null
     * for any other group.
     */
    headingOf(group: HTMLElement): { path: string; line?: number; title?: string; pinned: boolean } | null;
    /** Where a heading's section ends in its note: the line of the next heading as big as it, or Infinity. */
    sectionEnd(path: string, line: number): number;
    /** Moves a heading with its section. False when nothing moved, so the groups go back. */
    dropHeading(path: string, heading: HeadingRef, target: HeadingTarget): Promise<boolean>;
}

/** How far the pointer moves before a press becomes a drag. */
const THRESHOLD = 5;
/** How close to the list's edge the pointer comes before it scrolls. */
const EDGE = 56;
/** The fastest the list scrolls, in pixels a frame. */
const MAX_SPEED = 16;

interface Lift {
    elements: HTMLElement[];
    /** Where each element sat, measured when the drag started. */
    tops: number[];
    /** A task drag's rows and headings, to light up the heading it would land under. Null for a heading drag. */
    items: DragItem[] | null;
    grabbed: number;
    plan: DragPlan<unknown>;
    tasks: Task[];
    /** The pointer's height in the list when the row lifted. */
    startY: number;
    gap: DragGap<unknown> | null;
    shifts: number[];
    target: HTMLElement | null;
    frame: number;
    /** Makes the move for one of the plan's gaps, by its index. False when nothing moved. */
    land: (gap: number) => Promise<boolean>;
}

interface Press {
    pointerId: number;
    x: number;
    y: number;
    /** The row pressed, or the heading's group whose title was pressed. */
    row: HTMLElement;
    /** The pressed row's task; null for a heading. */
    task: Task | null;
    lift: Lift | null;
}

export class TaskDrag {
    private press: Press | null = null;
    private swallowClick = false;
    private lastX = 0;
    private lastY = 0;

    constructor(private column: HTMLElement, private scroller: HTMLElement, private host: DragHost) {}

    get active(): boolean {
        return this.press?.lift != null;
    }

    /** Wired to the list's pointerdown. */
    down(event: PointerEvent): void {
        if (event.button !== 0 || event.pointerType === 'touch' || this.press) return;
        const target = event.target as HTMLElement;
        if (target.closest('button, a, input, textarea, [contenteditable="true"]')) return;
        const row = target.closest<HTMLElement>('.sh-task-row');
        let pressed: { row: HTMLElement; task: Task | null } | null = null;
        if (row) {
            const task = row.hasClass('is-expanded') ? undefined : this.host.taskOf(row);
            if (task) pressed = { row, task };
        } else {
            const group = target.closest<HTMLElement>('.sh-group-header')?.parentElement;
            const heading = group ? this.host.headingOf(group) : null;
            if (group && heading && !heading.pinned) pressed = { row: group, task: null };
        }
        if (!pressed || !this.host.canDrag()) return;
        this.press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...pressed, lift: null };
        window.addEventListener('pointermove', this.onMove, true);
        window.addEventListener('pointerup', this.onUp, true);
        window.addEventListener('pointercancel', this.onCancel, true);
        window.addEventListener('keydown', this.onKey, true);
    }

    /** Wired to the list's click, in the capture phase: a drag's release is not a click. */
    click(event: MouseEvent): void {
        if (!this.swallowClick) return;
        this.swallowClick = false;
        event.stopPropagation();
        event.preventDefault();
    }

    /** Ends any drag without moving anything, for when the tab closes. */
    destroy(): void {
        if (this.press?.lift) this.settle(this.press.lift, false);
        this.stopListening();
        this.press = null;
    }

    private onMove = (event: PointerEvent) => {
        const press = this.press;
        if (!press || event.pointerId !== press.pointerId) return;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        if (!press.lift) {
            if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < THRESHOLD) return;
            press.lift = this.lift(press);
            if (!press.lift) {
                this.stopListening();
                this.press = null;
                return;
            }
        }
        event.preventDefault();
        this.follow(press.lift);
    };

    private onUp = (event: PointerEvent) => {
        const press = this.press;
        if (!press || event.pointerId !== press.pointerId) return;
        this.stopListening();
        this.press = null;
        const lift = press.lift;
        if (!lift) return;
        // The click that follows this release is swallowed; one that never
        // comes (a release outside the list) mustn't eat the next real one.
        this.swallowClick = true;
        window.setTimeout(() => { this.swallowClick = false; }, 0);
        window.cancelAnimationFrame(lift.frame);
        void this.release(press, lift);
    };

    private onCancel = (event: PointerEvent) => {
        if (!this.press || event.pointerId !== this.press.pointerId) return;
        const lift = this.press.lift;
        this.stopListening();
        this.press = null;
        if (lift) this.settle(lift, true);
    };

    private onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !this.press) return;
        event.preventDefault();
        event.stopPropagation();
        const lift = this.press.lift;
        this.stopListening();
        this.press = null;
        if (lift) this.settle(lift, true);
    };

    private stopListening(): void {
        window.removeEventListener('pointermove', this.onMove, true);
        window.removeEventListener('pointerup', this.onUp, true);
        window.removeEventListener('pointercancel', this.onCancel, true);
        window.removeEventListener('keydown', this.onKey, true);
    }

    /** Measures the note's part of the list and lifts what was pressed, or returns null when it can't be dragged. */
    private lift(press: Press): Lift | null {
        return press.task ? this.liftRows(press, press.task) : this.liftHeading(press);
    }

    /** Lifts a heading's group, with the groups of the smaller headings under it. */
    private liftHeading(press: Press): Lift | null {
        const heading = this.host.headingOf(press.row);
        if (!heading || heading.line === undefined) return null;
        const top = this.column.getBoundingClientRect().top;
        const elements: HTMLElement[] = [];
        const items: HeadingDragItem[] = [];
        for (const group of Array.from(this.column.children) as HTMLElement[]) {
            const info = group.hasClass('sh-group') ? this.host.headingOf(group) : null;
            if (!info || info.path !== heading.path) continue;
            const rect = group.getBoundingClientRect();
            items.push({ top: rect.top - top, height: rect.height, line: info.line, title: info.title, pinned: info.pinned });
            elements.push(group);
        }
        const grabbed = elements.indexOf(press.row);
        const plan = grabbed === -1 ? null : planHeadingDrag(items, grabbed, this.host.sectionEnd(heading.path, heading.line));
        if (!plan) return null;

        window.getSelection()?.removeAllRanges();
        this.column.addClass('has-drag');
        for (let i = plan.blockStart; i < plan.blockEnd; i++) elements[i].addClass('is-dragging');
        const ref = { line: heading.line, title: heading.title ?? '' };
        return this.start({
            elements, tops: items.map(item => item.top), items: null, grabbed, plan, tasks: [], startY: press.y - top,
            land: (index) => this.host.dropHeading(heading.path, ref, plan.gaps[index].target)
        });
    }

    /** Lifts a task row, with its subtasks and the rest of the selection. */
    private liftRows(press: Press, task: Task): Lift | null {
        const path = task.filePath;
        const top = this.column.getBoundingClientRect().top;
        const elements: HTMLElement[] = [];
        const items: DragItem[] = [];
        for (const group of Array.from(this.column.children) as HTMLElement[]) {
            const info = group.hasClass('sh-group') ? this.host.groupOf(group) : null;
            if (!info || info.path !== path) continue;
            for (const el of Array.from(group.children) as HTMLElement[]) {
                const rect = el.getBoundingClientRect();
                const at = { top: rect.top - top, height: rect.height };
                if (el.hasClass('sh-task-row')) {
                    const task = this.host.taskOf(el);
                    if (!task) continue;
                    const indent = Number(el.style.getPropertyValue('--sh-indent')) || 0;
                    const headingLine = task.section === undefined ? undefined : task.sectionLine;
                    items.push({ kind: 'row', ...at, indent, done: !isOpenTask(task), heading: task.section ?? '', headingLine, line: task.lineNumber, text: task.text });
                } else if (el.hasClass('sh-section-title')) {
                    const line = el.dataset.line === undefined ? undefined : Number(el.dataset.line);
                    items.push({ kind: 'heading', ...at, heading: el.dataset.heading ?? '', headingLine: line });
                } else if (el.hasClass('sh-group-header') && info.heading !== undefined) {
                    items.push({ kind: 'heading', ...at, heading: info.heading, headingLine: info.headingLine });
                } else {
                    items.push({ kind: 'static', ...at });
                }
                elements.push(el);
            }
        }
        const grabbed = elements.indexOf(press.row);
        if (grabbed === -1) return null;

        const plan = planDrag(items, grabbed, { skipDone: this.host.completedLast() });
        if (!this.host.inNoteOrder()) plan.gaps = [];
        const tasks = this.host.carried(task);

        window.getSelection()?.removeAllRanges();
        this.column.addClass('has-drag');
        for (let i = plan.blockStart; i < plan.blockEnd; i++) elements[i].addClass('is-dragging');
        for (let i = plan.blockStart; i < plan.blockEnd; i++) paintRun(elements[i], 'is-dragging');
        if (tasks.length > 1) {
            press.row.createSpan({ cls: 'sh-drag-count', text: String(tasks.length) });
            // The other carried tasks fade where they are, with the subtasks
            // that go along with them.
            const carried = new Set(tasks.map(task => `${task.filePath}:${task.lineNumber}`));
            let depth = -1;
            elements.forEach((el, i) => {
                const indent = items[i].indent ?? 0;
                if (depth !== -1 && (items[i].kind !== 'row' || indent <= depth)) depth = -1;
                if (el.hasClass('is-dragging')) return;
                if (depth === -1 && carried.has(el.dataset.key ?? '')) depth = indent;
                if (depth !== -1) el.addClass('is-drag-companion');
            });
        }

        return this.start({
            elements, tops: items.map(item => item.top), items, grabbed, plan, tasks, startY: press.y - top,
            land: (index) => {
                const gap = plan.gaps[index];
                return this.host.drop(tasks, gap.target, gap.heading, task);
            }
        });
    }

    /** Starts following the pointer with what was lifted. */
    private start(parts: Pick<Lift, 'elements' | 'tops' | 'items' | 'grabbed' | 'plan' | 'tasks' | 'startY' | 'land'>): Lift {
        const lift: Lift = { ...parts, gap: null, shifts: parts.elements.map(() => 0), target: null, frame: 0 };
        const tick = () => {
            this.scrollNearEdge();
            this.follow(lift);
            lift.frame = window.requestAnimationFrame(tick);
        };
        lift.frame = window.requestAnimationFrame(tick);
        return lift;
    }

    private scrollNearEdge(): void {
        const rect = this.scroller.getBoundingClientRect();
        let speed = 0;
        if (this.lastY < rect.top + EDGE) speed = -MAX_SPEED * Math.min(1, (rect.top + EDGE - this.lastY) / EDGE);
        else if (this.lastY > rect.bottom - EDGE) speed = MAX_SPEED * Math.min(1, (this.lastY - (rect.bottom - EDGE)) / EDGE);
        if (speed) this.scroller.scrollTop += speed;
    }

    /** Moves the lifted rows with the pointer and slides the rest to the nearest gap. */
    private follow(lift: Lift): void {
        const { plan, elements, items } = lift;
        const offset = this.lastY - this.column.getBoundingClientRect().top - lift.startY;
        for (let i = plan.blockStart; i < plan.blockEnd; i++) elements[i].style.transform = `translateY(${offset}px)`;

        if (plan.gaps.length > 0) {
            const gap = nearestGap(plan, lift.tops[lift.grabbed] + offset);
            if (gap === lift.gap) return;
            lift.gap = gap;
            // The heading the rows would land under lights up: the last one
            // above the gap.
            if (items) {
                let under = -1;
                if (gap) for (let i = gap.at - 1; i >= 0 && under === -1; i--) if (items[i].kind === 'heading') under = i;
                this.paintTarget(lift, under === -1 ? null : elements[under]);
            }
            elements.forEach((el, i) => {
                if (i >= plan.blockStart && i < plan.blockEnd) return;
                const shift = gap ? shiftFor(plan, i, gap) : 0;
                if (shift === lift.shifts[i]) return;
                lift.shifts[i] = shift;
                if (shift) el.style.transform = `translateY(${shift}px)`;
                else el.style.removeProperty('transform');
            });
            return;
        }

        // Out of the note's order, the task drops onto a heading.
        if (!items) return;
        const under = document.elementFromPoint(this.lastX, this.lastY)?.closest<HTMLElement>('.sh-section-title, .sh-group-header') ?? null;
        const index = under ? elements.indexOf(under) : -1;
        this.paintTarget(lift, index !== -1 && items[index].kind === 'heading' ? under : null);
    }

    private paintTarget(lift: Lift, target: HTMLElement | null): void {
        if (target === lift.target) return;
        lift.target?.removeClass('is-drop-target');
        target?.addClass('is-drop-target');
        lift.target = target;
    }

    private async release(press: Press, lift: Lift): Promise<void> {
        let land: (() => Promise<boolean>) | null = null;
        if (lift.plan.gaps.length > 0) {
            // Back where it started is no move at all.
            const gap = lift.gap;
            if (gap && gap.at !== lift.plan.blockStart) land = () => lift.land(lift.plan.gaps.indexOf(gap));
        } else if (lift.target && lift.items && press.task) {
            const item = lift.items[lift.elements.indexOf(lift.target)];
            const heading = item.heading ?? '';
            const from = press.task;
            land = () => this.host.drop(lift.tasks, { kind: 'heading', heading, line: item.headingLine }, heading, from);
        }
        if (!land) {
            this.settle(lift, true);
            return;
        }
        // The rows hold where they were dropped until the list redraws, and
        // then slide from there to where the move put them.
        this.column.removeClass('has-drag');
        lift.target?.removeClass('is-drop-target');
        const moved = await land();
        if (!moved) this.settle(lift, true);
    }

    /** Puts every row back where it was, sliding there when `animate`. */
    private settle(lift: Lift, animate: boolean): void {
        window.cancelAnimationFrame(lift.frame);
        lift.target?.removeClass('is-drop-target');
        if (animate) this.column.addClass('has-drag');
        for (const el of lift.elements) {
            el.removeClass('is-dragging', 'is-drag-companion', 'joins-is-dragging');
            el.style.removeProperty('transform');
            el.querySelector('.sh-drag-count')?.remove();
        }
        window.setTimeout(() => {
            if (!this.press) this.column.removeClass('has-drag');
        }, animate ? 200 : 0);
    }
}
