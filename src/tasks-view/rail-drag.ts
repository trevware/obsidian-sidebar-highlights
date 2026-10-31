/**
 * Dragging a pinned note to a new place in the rail's Pinned section, with a
 * mouse or trackpad.
 *
 * The row lifts once the pointer has moved a few pixels and follows it, and
 * the other pinned notes slide apart to show where it will land. Escape puts
 * everything back. On a phone, the note's menu moves it up or down instead.
 *
 * Positions are measured once, when the drag starts, and everything after
 * that is arithmetic on them (drag-plan.ts).
 */

import { nearestGap, planReorder, shiftFor } from './drag-plan';
import type { DragGap, DragPlan } from './drag-plan';

export interface RailDragHost {
    canDrag(): boolean;
    /** Moves a pinned note in front of another, or to the end when `before` is null. */
    reorder(path: string, before: string | null): void;
}

/** How far the pointer moves before a press becomes a drag. */
const THRESHOLD = 5;

interface Lift {
    rows: HTMLElement[];
    tops: number[];
    grabbed: number;
    plan: DragPlan<number | null>;
    gap: DragGap<number | null> | null;
    shifts: number[];
}

interface Press {
    pointerId: number;
    x: number;
    y: number;
    row: HTMLElement;
    lift: Lift | null;
    /** Escape put a lifted drag back; the release that follows is no click. */
    cancelled?: boolean;
}

export class RailDrag {
    private press: Press | null = null;
    private swallowClick = false;

    constructor(private rail: HTMLElement, private host: RailDragHost) {}

    /** Wired to the rail's pointerdown. */
    down(event: PointerEvent): void {
        if (event.button !== 0 || event.pointerType === 'touch' || this.press) return;
        const row = (event.target as HTMLElement).closest<HTMLElement>('.sh-rail-item.is-pinned');
        if (!row || !this.host.canDrag()) return;
        this.press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, row, lift: null };
        window.addEventListener('pointermove', this.onMove, true);
        window.addEventListener('pointerup', this.onUp, true);
        window.addEventListener('pointercancel', this.onCancel, true);
        window.addEventListener('keydown', this.onKey, true);
    }

    /** Wired to the rail's click, in the capture phase: a drag's release is not a click. */
    click(event: MouseEvent): void {
        if (!this.swallowClick) return;
        this.swallowClick = false;
        event.stopPropagation();
        event.preventDefault();
    }

    /** Ends any drag without moving anything, for when the tab closes. */
    destroy(): void {
        if (this.press?.lift) this.settle(this.press.lift);
        this.stopListening();
        this.press = null;
    }

    private onMove = (event: PointerEvent) => {
        const press = this.press;
        if (!press || event.pointerId !== press.pointerId || press.cancelled) return;
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
        this.follow(press.lift, event.clientY - press.y);
    };

    private onUp = (event: PointerEvent) => {
        const press = this.press;
        if (!press || event.pointerId !== press.pointerId) return;
        this.stopListening();
        this.press = null;
        const lift = press.lift;
        if (!lift && !press.cancelled) return;
        // The click that follows this release is swallowed; one that never
        // comes (a release outside the rail) mustn't eat the next real one.
        this.swallowClick = true;
        window.setTimeout(() => { this.swallowClick = false; }, 0);
        if (!lift) {
            window.setTimeout(() => {
                if (!this.press) this.rail.removeClass('has-drag');
            }, 200);
            return;
        }
        const gap = lift.gap;
        const path = press.row.dataset.path;
        if (!gap || gap.at === lift.plan.blockStart || !path) {
            this.settle(lift);
            return;
        }
        const before = gap.target === null ? null : lift.rows[gap.target].dataset.path ?? null;
        // The rail draws again in the new order, right where the rows sit now.
        this.rail.removeClass('has-drag');
        this.host.reorder(path, before);
    };

    private onCancel = (event: PointerEvent) => {
        if (!this.press || event.pointerId !== this.press.pointerId) return;
        const lift = this.press.lift;
        this.stopListening();
        this.press = null;
        if (lift) this.settle(lift);
    };

    private onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !this.press || this.press.cancelled) return;
        event.preventDefault();
        event.stopPropagation();
        const lift = this.press.lift;
        if (lift) {
            // The button is still down: wait for its release, so the click
            // it makes doesn't open or select what's under the pointer.
            this.press.lift = null;
            this.press.cancelled = true;
            this.settle(lift);
            return;
        }
        this.stopListening();
        this.press = null;
    };

    private stopListening(): void {
        window.removeEventListener('pointermove', this.onMove, true);
        window.removeEventListener('pointerup', this.onUp, true);
        window.removeEventListener('pointercancel', this.onCancel, true);
        window.removeEventListener('keydown', this.onKey, true);
    }

    /** Measures the pinned notes and lifts the pressed one, or returns null when there's nothing to reorder. */
    private lift(press: Press): Lift | null {
        const rows = Array.from(this.rail.querySelectorAll<HTMLElement>('.sh-rail-item.is-pinned'));
        const grabbed = rows.indexOf(press.row);
        if (rows.length < 2 || grabbed === -1) return null;
        const top = this.rail.getBoundingClientRect().top;
        const items = rows.map(row => {
            const rect = row.getBoundingClientRect();
            return { top: rect.top - top, height: rect.height };
        });
        window.getSelection()?.removeAllRanges();
        this.rail.addClass('has-drag');
        press.row.addClass('is-dragging');
        return { rows, tops: items.map(item => item.top), grabbed, plan: planReorder(items, grabbed), gap: null, shifts: rows.map(() => 0) };
    }

    /** Moves the lifted row with the pointer and slides the rest to the nearest gap. */
    private follow(lift: Lift, offset: number): void {
        lift.rows[lift.grabbed].style.transform = `translateY(${offset}px)`;
        const gap = nearestGap(lift.plan, lift.tops[lift.grabbed] + offset);
        if (gap === lift.gap) return;
        lift.gap = gap;
        lift.rows.forEach((row, i) => {
            if (i === lift.grabbed) return;
            const shift = gap ? shiftFor(lift.plan, i, gap) : 0;
            if (shift === lift.shifts[i]) return;
            lift.shifts[i] = shift;
            if (shift) row.style.transform = `translateY(${shift}px)`;
            else row.style.removeProperty('transform');
        });
    }

    /** Puts every row back where it was, sliding there. */
    private settle(lift: Lift): void {
        for (const row of lift.rows) {
            row.removeClass('is-dragging');
            row.style.removeProperty('transform');
        }
        window.setTimeout(() => {
            if (!this.press) this.rail.removeClass('has-drag');
        }, 200);
    }
}
