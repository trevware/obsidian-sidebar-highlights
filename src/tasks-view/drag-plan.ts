/**
 * The arithmetic behind dragging a task through its note's list: which gaps
 * it can drop into, where each gap sits on screen, and how far every other
 * row slides to make room. Works on measured positions only, so it can be
 * unit tested directly.
 *
 * A task drops in front of a top-level task, or at the end of a heading, and
 * never between a task and its subtasks: it lands at the top level and its
 * own visible subtasks travel with it.
 */

import type { MoveTarget } from './task-move';

export interface DragItem {
    kind: 'row' | 'heading' | 'static';
    /** Measured before the drag started, from the top of the list. */
    top: number;
    height: number;
    /** Rows: how deep the row is drawn. */
    indent?: number;
    done?: boolean;
    /** Rows: the heading they sit under. Headings: their own text. */
    heading?: string;
    /** That heading's line, which tells apart two headings with the same name. */
    headingLine?: number;
    line?: number;
    text?: string;
}

export interface DragGap {
    /** Where the dragged rows would go, as an index into the items. */
    at: number;
    /** The gap's height on screen, with the dragged rows taken out. */
    y: number;
    target: MoveTarget;
    /** The heading the dragged rows would end up under. */
    heading: string;
}

export interface DragPlan {
    blockStart: number;
    blockEnd: number;
    /** How much room the dragged rows take up. */
    span: number;
    gaps: DragGap[];
}

const isTopRow = (item: DragItem | undefined) => item?.kind === 'row' && (item.indent ?? 0) === 0;

export function planDrag(items: readonly DragItem[], grabbed: number, options: { skipDone: boolean }): DragPlan {
    const depth = items[grabbed]?.indent ?? 0;
    let blockEnd = grabbed + 1;
    while (blockEnd < items.length && items[blockEnd].kind === 'row' && (items[blockEnd].indent ?? 0) > depth) blockEnd++;
    const last = items[blockEnd - 1];
    const span = (blockEnd < items.length ? items[blockEnd].top : last.top + last.height) - items[grabbed].top;
    const collapsed = (index: number) => items[index].top - (index >= blockEnd ? span : 0);

    // With completed tasks shown last, each heading shows two runs, the open
    // tasks and then the completed ones, and a task only drops into its own
    // run: anywhere else it would land in the note somewhere other than
    // where it shows.
    const lane = options.skipDone ? items[grabbed].done === true : null;
    const inLane = (item: DragItem) => lane === null || (item.done === true) === lane;

    // What the scan has passed in the current heading, leaving out the
    // dragged rows.
    let lastOpen: DragItem | undefined;
    let doneSeen = false;

    const gaps: DragGap[] = [];
    for (let at = 0; at <= items.length; at++) {
        const passed = items[at - 1];
        if (passed && (at - 1 < grabbed || at - 1 >= blockEnd)) {
            if (passed.kind !== 'row') {
                lastOpen = undefined;
                doneSeen = false;
            } else if (isTopRow(passed)) {
                if (passed.done) doneSeen = true;
                else lastOpen = passed;
            }
        }
        // Inside the dragged rows there is no gap, and their far edge is the
        // same gap as their near one.
        if (at > grabbed && at <= blockEnd) continue;
        const prev = at - 1;
        const nextIndex = at === grabbed ? blockEnd : at;
        const before = prev >= 0 ? items[prev] : undefined;
        const next = nextIndex < items.length ? items[nextIndex] : undefined;

        let target: MoveTarget | null = null;
        let heading = '';
        if (next && isTopRow(next)) {
            heading = next.heading ?? '';
            if (inLane(next)) {
                target = { kind: 'before', line: next.line ?? 0, text: next.text ?? '' };
            } else if (lane === false && !doneSeen) {
                // The end of the open run, where the completed ones begin.
                target = lastOpen
                    ? { kind: 'after', line: lastOpen.line ?? 0, text: lastOpen.text ?? '' }
                    : { kind: 'heading', heading, line: next.headingLine };
            }
        } else if (!next || next.kind !== 'row') {
            heading = before?.heading ?? '';
            const after = before?.kind === 'row' || before?.kind === 'heading';
            // The open run already ended above the completed tasks.
            if (after && !(lane === false && doneSeen)) target = { kind: 'heading', heading, line: before.headingLine };
        }
        if (!target) continue;

        const y = next ? collapsed(nextIndex) : before ? collapsed(prev) + before.height : 0;
        gaps.push({ at, y, target, heading });
    }
    return { blockStart: grabbed, blockEnd, span, gaps };
}

/** The gap nearest to where the top of the dragged rows is now. */
export function nearestGap(plan: DragPlan, blockTop: number): DragGap | null {
    let best: DragGap | null = null;
    for (const gap of plan.gaps) {
        if (!best || Math.abs(gap.y - blockTop) < Math.abs(best.y - blockTop)) best = gap;
    }
    return best;
}

/** How far a row that isn't being dragged slides while the rows sit in a gap. */
export function shiftFor(plan: DragPlan, index: number, gap: DragGap): number {
    return (index >= plan.blockEnd ? -plan.span : 0) + (index >= gap.at ? plan.span : 0);
}
