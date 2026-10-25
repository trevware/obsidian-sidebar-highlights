/**
 * The numbers behind the status bar counter (issue #129): what the sidebar tab
 * you're on is showing, reduced to a few counts.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

export type StatusBarCountKind = 'highlights' | 'nativeComments' | 'files' | 'collections';

export type StatusBarCounts = Partial<Record<StatusBarCountKind, number>>;

export interface StatusBarSegment {
    kind: StatusBarCountKind;
    count: number;
}

// Left to right as they appear in the status bar, matching the order of the
// sidebar's own group headers (highlights, native comments, files).
const SEGMENT_ORDER: StatusBarCountKind[] = ['highlights', 'nativeComments', 'files', 'collections'];

/**
 * Count the rows a tab is showing. The note count is only asked for on tabs
 * that span more than one note, the same as the group headers.
 */
export function countHighlights(
    rows: Array<{ filePath: string; isNativeComment?: boolean }>,
    includeFiles: boolean
): StatusBarCounts {
    let nativeComments = 0;
    for (const row of rows) {
        if (row.isNativeComment) nativeComments++;
    }

    const counts: StatusBarCounts = {
        highlights: rows.length - nativeComments,
        nativeComments,
    };
    if (includeFiles) {
        counts.files = new Set(rows.map(row => row.filePath)).size;
    }
    return counts;
}

/** The counts worth showing, in display order. A zero hides its segment. */
export function visibleSegments(counts: StatusBarCounts): StatusBarSegment[] {
    const segments: StatusBarSegment[] = [];
    for (const kind of SEGMENT_ORDER) {
        const count = counts[kind];
        if (count) segments.push({ kind, count });
    }
    return segments;
}

// i18n keys under `statusBar`, singular then plural, for the hover text.
const SEGMENT_WORDING: Record<StatusBarCountKind, [string, string]> = {
    highlights: ['highlight', 'highlights'],
    nativeComments: ['nativeComment', 'nativeComments'],
    files: ['file', 'files'],
    collections: ['collection', 'collections'],
};

/** The counts spelled out in words, e.g. "12 highlights, 3 native comments". */
export function describeSegments(
    segments: StatusBarSegment[],
    translate: (key: string, vars?: Record<string, unknown>) => string
): string {
    return segments
        .map(({ kind, count }) => {
            const [singular, plural] = SEGMENT_WORDING[kind];
            return translate(`statusBar.${count === 1 ? singular : plural}`, { count });
        })
        .join(', ');
}
