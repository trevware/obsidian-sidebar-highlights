/**
 * Moving tasks within a note: next to another task, to the bottom of a
 * heading, or under a heading that doesn't exist yet.
 *
 * A task always travels with its block (its notes and subtasks), the way
 * deleting one does, and lands at the indent of where it goes, so a subtask
 * dragged out comes out to the top level. Kept free of Obsidian imports so it
 * can be unit tested directly.
 */

import { locateTaskLine, parseTaskLine, taskBlockEnd } from './task-line';

/** A task to move, found again by its text near the line it was read from. */
export interface MoveSource {
    line: number;
    text: string;
}

/**
 * Where moved tasks land. A heading is named by its text, and '' is the part
 * of the note above the first heading. A new heading goes at the end of the
 * note, or at the top as the note's first section.
 */
export type MoveTarget =
    | { kind: 'before'; line: number; text: string }
    | { kind: 'after'; line: number; text: string }
    /** `line` picks between two headings with the same name: the one nearest it. */
    | { kind: 'heading'; heading: string; line?: number }
    | { kind: 'new-heading'; heading: string; level: number; where: 'top' | 'bottom' };

export interface MovePlan {
    lines: string[];
    /** The run of lines that changed, so the move can be undone. */
    change: { start: number; before: string[]; after: string[] };
    /** Where each line of the note went, by its old line number. */
    lineMap: Map<number, number>;
    /** The new line of each moved task, in the order they landed. */
    landed: number[];
}

export interface NoteHeading {
    line: number;
    level: number;
    title: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** Where the note's body starts: after its properties, when it has them. */
function bodyStart(lines: string[]): number {
    if (lines[0]?.trim() !== '---') return 0;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---' || lines[i].trim() === '...') return i + 1;
    }
    return 0;
}

/** The note's headings, leaving out anything in its properties or in code. */
export function noteHeadings(lines: string[]): NoteHeading[] {
    const headings: NoteHeading[] = [];
    let fence: string | null = null;
    for (let i = bodyStart(lines); i < lines.length; i++) {
        const fenceMatch = lines[i].match(FENCE);
        if (fenceMatch) {
            const mark = fenceMatch[1][0];
            if (fence === null) fence = mark;
            else if (fence === mark) fence = null;
            continue;
        }
        if (fence !== null) continue;
        const match = lines[i].match(HEADING);
        if (match) headings.push({ line: i, level: match[1].length, title: match[2].trim() });
    }
    return headings;
}

/** The note's title: a first heading at level one, when it's the only one. */
function titleOf(headings: readonly NoteHeading[]): NoteHeading | null {
    const first = headings[0];
    if (!first || first.level !== 1) return null;
    return headings.filter(heading => heading.level === 1).length === 1 ? first : null;
}

/**
 * The level for a heading created for a task: the same as the heading it's
 * under, so the new one sits beside it. Under the note's title or under no
 * heading, it copies the note's first section, or is a second-level heading.
 */
export function newHeadingLevel(headings: readonly NoteHeading[], heading: string | undefined): number {
    const title = titleOf(headings);
    const current = heading ? headings.find(candidate => candidate.title === heading) : undefined;
    if (current && current !== title) return current.level;
    return headings.find(candidate => candidate !== title)?.level ?? 2;
}

/** Steps back over blank lines, so a task joins the list above it. */
function trimBack(lines: string[], end: number, floor: number): number {
    while (end > floor && lines[end - 1].trim() === '') end--;
    return end;
}

/**
 * The line where a task goes at the bottom of a heading: before the next
 * heading of any level, since a task belongs to the nearest heading above it.
 */
function headingEnd(lines: string[], heading: string, near?: number): number | null {
    const headings = noteHeadings(lines);
    if (heading === '') return trimBack(lines, headings[0]?.line ?? lines.length, bodyStart(lines));
    let index = -1;
    headings.forEach((candidate, i) => {
        if (candidate.title !== heading) return;
        if (index === -1 || (near !== undefined && Math.abs(candidate.line - near) < Math.abs(headings[index].line - near))) index = i;
    });
    if (index === -1) return null;
    return trimBack(lines, headings[index + 1]?.line ?? lines.length, headings[index].line + 1);
}

function reindent(block: string[], indent: string): string[] {
    const base = parseTaskLine(block[0])?.indent ?? '';
    if (base === indent) return block;
    return block.map(line => (line.trim() !== '' && line.startsWith(base) ? indent + line.slice(base.length) : line));
}

function changedRun(before: string[], after: string[]): MovePlan['change'] {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }
    return { start, before: before.slice(start, endBefore), after: after.slice(start, endAfter) };
}

/**
 * The note with the tasks moved, or null when there's nothing to do: a task
 * or the target is gone, the target is inside a task being moved, a task sits
 * in a callout, or the tasks are already where they would land.
 */
export function moveTasks(lines: string[], sources: readonly MoveSource[], target: MoveTarget): MovePlan | null {
    const ranges: Array<[number, number]> = [];
    for (const source of sources) {
        const index = locateTaskLine(lines, source.line, source.text);
        if (index === -1 || parseTaskLine(lines[index])?.prefix) return null;
        ranges.push([index, taskBlockEnd(lines, index)]);
    }
    if (ranges.length === 0) return null;

    // Outermost first, so a subtask inside a moved parent goes with it once.
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const blocks: Array<[number, number]> = [];
    for (const range of ranges) {
        const last = blocks[blocks.length - 1];
        if (last && range[0] < last[1]) continue;
        blocks.push(range);
    }
    const inBlock = (index: number) => blocks.some(([start, end]) => index >= start && index < end);
    const keptOrigin = lines.map((_line, index) => index).filter(index => !inBlock(index));
    const kept = keptOrigin.map(index => lines[index]);

    let at: number;
    let indent = '';
    // Lines added around the moved tasks: a new heading and its spacing.
    let lead: string[] = [];
    let trail: string[] = [];
    if (target.kind === 'before' || target.kind === 'after') {
        const index = locateTaskLine(lines, target.line, target.text);
        const parsed = index === -1 ? null : parseTaskLine(lines[index]);
        if (!parsed || parsed.prefix || inBlock(index)) return null;
        indent = parsed.indent;
        const original = target.kind === 'before' ? index : taskBlockEnd(lines, index);
        if (blocks.some(([start, end]) => original > start && original < end)) return null;
        at = original - blocks.filter(([, end]) => end <= original).reduce((sum, [start, end]) => sum + end - start, 0);
    } else if (target.kind === 'heading') {
        // The line was counted before the moved tasks came out.
        const near = target.line === undefined ? undefined : keptOrigin.filter(index => index < (target.line as number)).length;
        const end = headingEnd(kept, target.heading, near);
        if (end === null) return null;
        at = end;
    } else {
        const headings = noteHeadings(kept);
        const title = titleOf(headings);
        const first = headings.find(heading => heading !== title);
        const heading = `${'#'.repeat(Math.min(6, Math.max(1, target.level)))} ${target.heading.trim()}`;
        if (target.where === 'top' && first) {
            at = first.line;
            lead = at > 0 && kept[at - 1].trim() !== '' ? ['', heading] : [heading];
            trail = [''];
        } else {
            at = trimBack(kept, kept.length, 0);
            lead = at > 0 ? ['', heading] : [heading];
        }
    }

    const moved = blocks.flatMap(([start, end]) => reindent(lines.slice(start, end), indent));
    const movedOrigin = blocks.flatMap(([start, end]) => Array.from({ length: end - start }, (_line, i) => start + i));
    const next = [...kept.slice(0, at), ...lead, ...moved, ...trail, ...kept.slice(at)];
    if (next.length === lines.length && next.every((line, index) => line === lines[index])) return null;

    const origin = [...keptOrigin.slice(0, at), ...lead.map(() => -1), ...movedOrigin, ...trail.map(() => -1), ...keptOrigin.slice(at)];
    const lineMap = new Map<number, number>();
    origin.forEach((old, index) => {
        if (old !== -1) lineMap.set(old, index);
    });
    const landed = blocks.map(([start]) => lineMap.get(start) ?? -1);
    return { lines: next, change: changedRun(lines, next), lineMap, landed };
}
