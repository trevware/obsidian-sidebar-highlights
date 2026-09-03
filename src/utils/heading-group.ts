/**
 * Grouping highlights by the heading they sit under.
 *
 * Headings come from Obsidian's metadata cache (`HeadingCache`), but only the text
 * and the 0-based line are needed here, so the shape is kept minimal and free of
 * Obsidian imports for unit testing.
 */

export interface HeadingRef {
    heading: string;
    line: number;
}

/** Group key for highlights that precede every heading in a single note. Translated at display time. */
export const NO_SECTION_KEY = 'No section';

/** Position of a heading group, used to keep groups in reading order rather than alphabetical. */
export interface DocumentPosition {
    file: string;
    /** Line of the group's heading, or -1 for content before the first heading. */
    line: number;
}

/** The nearest heading at or above `line`, or null when the line precedes every heading. */
export function headingForLine(headings: HeadingRef[], line: number): HeadingRef | null {
    let best: HeadingRef | null = null;
    for (const heading of headings) {
        if (heading.line <= line && (best === null || heading.line > best.line)) {
            best = heading;
        }
    }
    return best;
}

/**
 * Group key for a highlight. Within one note the heading text stands alone. Across
 * notes the note name is prefixed so identical headings in different notes stay
 * apart, and highlights before any heading fall under the bare note name.
 */
export function headingGroupKey(heading: string | null, noteName: string | null): string {
    if (noteName === null) {
        return heading ?? NO_SECTION_KEY;
    }
    return heading === null ? noteName : `${noteName} › ${heading}`;
}

/** Reading order: by note name, then by heading position within the note. */
export function compareDocumentOrder(a: DocumentPosition, b: DocumentPosition): number {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
}
