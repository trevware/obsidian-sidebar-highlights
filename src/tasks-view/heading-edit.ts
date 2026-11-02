/**
 * Editing a heading from the Tasks tab: renaming it, changing its level, and
 * deleting it, either the heading line alone or the heading with everything
 * under it. Also pointing a link at a renamed heading.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import { bodyStart, changedRun, findHeading, headingSectionEnd, noteHeadings, trimBack } from './task-move';
import type { HeadingRef, MovePlan, NoteHeading } from './task-move';

/** A note with one heading edit made, and the run of lines it changed for undo. */
export interface HeadingEdit {
    lines: string[];
    change: MovePlan['change'];
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;
/** A list item, or a line indented under one. */
const LIST_LINE = /^(\s*([-*+]|\d+[.)])\s|\s+\S)/;

function edited(lines: string[], next: string[]): HeadingEdit | null {
    if (next.length === lines.length && next.every((line, i) => line === lines[i])) return null;
    return { lines: next, change: changedRun(lines, next) };
}

/** The heading the ref names, found by its text nearest the line it was read from. */
function locate(lines: string[], ref: HeadingRef): { headings: NoteHeading[]; index: number } | null {
    const headings = noteHeadings(lines);
    const index = findHeading(headings, ref);
    return index === -1 ? null : { headings, index };
}

/** The headings inside a heading's section, below it and smaller. */
function smallerHeadings(headings: readonly NoteHeading[], index: number): NoteHeading[] {
    const end = headingSectionEnd(headings, headings[index].line);
    return headings.filter(heading => heading.line > headings[index].line && heading.line < end);
}

/** The note with a heading's words changed. Its level and everything under it stay. */
export function renameHeading(lines: string[], ref: HeadingRef, name: string): HeadingEdit | null {
    const title = name.replace(/\s+/g, ' ').trim();
    const found = locate(lines, ref);
    if (!found || title === '') return null;
    const heading = found.headings[found.index];
    if (heading.title === title) return null;
    const prefix = lines[heading.line].match(/^#{1,6}\s+/)?.[0] ?? `${'#'.repeat(heading.level)} `;
    const next = [...lines];
    next[heading.line] = prefix + title;
    return edited(lines, next);
}

/**
 * The levels a heading can take while the smaller headings under it move
 * with it and stay within six. Includes its own level.
 */
export function levelChoices(headings: readonly NoteHeading[], ref: HeadingRef): number[] {
    const index = findHeading(headings, ref);
    if (index === -1) return [];
    const deepest = Math.max(headings[index].level, ...smallerHeadings(headings, index).map(heading => heading.level));
    const room = 6 - (deepest - headings[index].level);
    return [1, 2, 3, 4, 5, 6].filter(level => level <= room);
}

/**
 * The note with a heading at a new level. The smaller headings under it move
 * by the same step, so its section keeps its shape.
 */
export function setHeadingLevel(lines: string[], ref: HeadingRef, level: number): HeadingEdit | null {
    const found = locate(lines, ref);
    if (!found) return null;
    const heading = found.headings[found.index];
    if (level === heading.level || !levelChoices(found.headings, ref).includes(level)) return null;
    const step = level - heading.level;
    const next = [...lines];
    for (const moved of [heading, ...smallerHeadings(found.headings, found.index)]) {
        next[moved.line] = next[moved.line].replace(/^#{1,6}/, '#'.repeat(moved.level + step));
    }
    return edited(lines, next);
}

/**
 * The note with a heading line taken out. What was under it joins the
 * section above. Two lists meet with no gap, so the tasks read as one list;
 * anything else keeps a single blank line between, so paragraphs stay apart.
 */
export function removeHeading(lines: string[], ref: HeadingRef): HeadingEdit | null {
    const found = locate(lines, ref);
    if (!found) return null;
    const at = found.headings[found.index].line;
    const floor = bodyStart(lines);
    const above = trimBack(lines, at, floor);
    let below = at + 1;
    while (below < lines.length && lines[below].trim() === '') below++;

    const headingLines = new Set(found.headings.map(heading => heading.line));
    const atTop = above === floor;
    const content = below < lines.length && !headingLines.has(below);
    let cutStart = at;
    let cutEnd = at + 1;
    if (!atTop && content && LIST_LINE.test(lines[above - 1]) && LIST_ITEM.test(lines[below])) {
        cutStart = above;
        cutEnd = below;
    } else if (atTop || above < at) {
        cutEnd = below;
    }
    return edited(lines, [...lines.slice(0, cutStart), ...lines.slice(cutEnd)]);
}

/**
 * The note with a heading and its whole section taken out: its text, its
 * tasks and the smaller headings under it. The gap closes up to the single
 * break the note had there.
 */
export function deleteSection(lines: string[], ref: HeadingRef): HeadingEdit | null {
    const found = locate(lines, ref);
    if (!found) return null;
    const start = found.headings[found.index].line;
    const sectionEnd = Math.min(headingSectionEnd(found.headings, start), lines.length);
    const floor = bodyStart(lines);
    const end = trimBack(lines, sectionEnd, start + 1);
    const blankBefore = start - trimBack(lines, start, floor);
    let afterEnd = end;
    while (afterEnd < lines.length && lines[afterEnd].trim() === '') afterEnd++;
    const blankAfter = afterEnd - end;

    let cutStart = start;
    let cutEnd = end;
    if (blankBefore > 0 && (blankAfter > 0 || end === lines.length)) cutStart = start - blankBefore;
    else if (blankBefore === 0 && start === floor) cutEnd = afterEnd;
    return edited(lines, [...lines.slice(0, cutStart), ...lines.slice(cutEnd)]);
}

/**
 * A heading's words as a link to it can carry them: the characters that
 * would break a link become spaces, the way Obsidian writes heading links.
 */
export function linkSafeHeading(heading: string): string {
    return heading.replace(/%%|\[\[|\]\]|[:#|^\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A heading's words as a Markdown link writes them: spaces and brackets encoded. */
function encodeFragment(heading: string): string {
    return encodeURI(heading).replace(/[()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * A link as written in a note, pointed at a renamed heading: the last part
 * of its heading path becomes `heading`. Aliases and link titles stay.
 * `heading` should already be safe for a link. Null when the link names no
 * heading.
 */
export function retargetLink(original: string, heading: string): string | null {
    const wiki = original.match(/^(!?\[\[)([^\]|]*)(\|[^\]]*)?(\]\])$/);
    if (wiki) {
        const target = wiki[2];
        const hash = target.indexOf('#');
        if (hash === -1) return null;
        const parts = target.slice(hash + 1).split('#');
        parts[parts.length - 1] = heading;
        return `${wiki[1]}${target.slice(0, hash)}#${parts.join('#')}${wiki[3] ?? ''}${wiki[4]}`;
    }
    const markdown = original.match(/^(!?\[[\s\S]*\]\()(<[^>]*>|[^\s)]*)([\s\S]*\))$/);
    if (markdown) {
        const angled = markdown[2].startsWith('<');
        const destination = angled ? markdown[2].slice(1, -1) : markdown[2];
        const hash = destination.indexOf('#');
        if (hash === -1) return null;
        const parts = destination.slice(hash + 1).split('#');
        parts[parts.length - 1] = angled ? heading : encodeFragment(heading);
        const next = `${destination.slice(0, hash)}#${parts.join('#')}`;
        return `${markdown[1]}${angled ? `<${next}>` : next}${markdown[3]}`;
    }
    return null;
}
