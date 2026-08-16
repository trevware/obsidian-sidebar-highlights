/**
 * Sort comparators for the sidebar.
 *
 * These used to be inlined at nine call sites — three for highlights, five for
 * tasks, plus the menu — which is how the tabs drifted into sorting slightly
 * differently from one another. Defining them once keeps every list consistent
 * and makes the ordering unit testable.
 *
 * Kept free of Obsidian imports. Note creation time needs vault access, so it
 * is injected as a lookup rather than imported.
 */

export type SortMode =
    | 'none'
    | 'alphabetical-asc'
    | 'alphabetical-desc'
    | 'note-title-asc'
    | 'note-title-desc'
    | 'note-created-asc'
    | 'note-created-desc'
    | 'created-asc'
    | 'created-desc'
    | 'priority'
    | 'date-asc'
    | 'date-desc';

/**
 * How to break ties. Grouped lists order within one group, where the file is
 * already implied; flat lists span files and need the path first.
 */
export type SortFallback = 'position' | 'path-then-position';

export interface SortableHighlight {
    text: string;
    filePath: string;
    startOffset: number;
    createdAt?: number;
}

export interface SortableTask {
    text: string;
    filePath: string;
    lineNumber: number;
    priority?: 1 | 2 | 3;
    date?: string;
}

/** Lookup for a note's creation time, in epoch milliseconds. */
export type NoteCreatedLookup = (filePath: string) => number | undefined;

export interface SortContext {
    getNoteCreated?: NoteCreatedLookup;
    fallback: SortFallback;
}

/** Display title of a note: its file name without the path or extension. */
export function noteTitleFromPath(filePath: string): string {
    const fileName = filePath.split('/').pop() ?? filePath;
    return fileName.replace(/\.[^.]+$/, '');
}

/**
 * Compare two optional numbers, always sorting missing values last regardless
 * of direction. Highlights created before the timestamp existed, and notes
 * whose file cannot be resolved, would otherwise masquerade as the oldest
 * items. This matches how the task list already handles tasks without a date.
 */
function compareOptionalNumbers(a: number | undefined, b: number | undefined, descending: boolean): number {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return descending ? b - a : a - b;
}

function comparePaths(aPath: string, bPath: string): number {
    return aPath === bPath ? 0 : aPath.localeCompare(bPath);
}

export function compareHighlights(
    a: SortableHighlight,
    b: SortableHighlight,
    mode: SortMode,
    context: SortContext
): number {
    let primary = 0;

    switch (mode) {
        case 'alphabetical-asc':
        case 'alphabetical-desc': {
            primary = a.text.toLowerCase().localeCompare(b.text.toLowerCase());
            if (mode === 'alphabetical-desc') primary = -primary;
            break;
        }
        case 'note-title-asc':
        case 'note-title-desc': {
            primary = noteTitleFromPath(a.filePath).toLowerCase()
                .localeCompare(noteTitleFromPath(b.filePath).toLowerCase());
            if (mode === 'note-title-desc') primary = -primary;
            break;
        }
        case 'note-created-asc':
        case 'note-created-desc': {
            primary = compareOptionalNumbers(
                context.getNoteCreated?.(a.filePath),
                context.getNoteCreated?.(b.filePath),
                mode === 'note-created-desc'
            );
            break;
        }
        case 'created-asc':
        case 'created-desc': {
            primary = compareOptionalNumbers(a.createdAt, b.createdAt, mode === 'created-desc');
            break;
        }
        default:
            primary = 0;
    }

    if (primary !== 0) {
        return primary;
    }

    if (context.fallback === 'path-then-position') {
        const byPath = comparePaths(a.filePath, b.filePath);
        if (byPath !== 0) return byPath;
    }

    return a.startOffset - b.startOffset;
}

export function compareTasks(
    a: SortableTask,
    b: SortableTask,
    mode: SortMode,
    context: SortContext
): number {
    let primary = 0;

    switch (mode) {
        case 'alphabetical-asc':
        case 'alphabetical-desc': {
            primary = a.text.toLowerCase().localeCompare(b.text.toLowerCase());
            if (mode === 'alphabetical-desc') primary = -primary;
            break;
        }
        case 'note-title-asc':
        case 'note-title-desc': {
            primary = noteTitleFromPath(a.filePath).toLowerCase()
                .localeCompare(noteTitleFromPath(b.filePath).toLowerCase());
            if (mode === 'note-title-desc') primary = -primary;
            break;
        }
        case 'note-created-asc':
        case 'note-created-desc': {
            primary = compareOptionalNumbers(
                context.getNoteCreated?.(a.filePath),
                context.getNoteCreated?.(b.filePath),
                mode === 'note-created-desc'
            );
            break;
        }
        case 'priority': {
            // Lower number is higher priority; tasks without one go last.
            primary = (a.priority ?? 999) - (b.priority ?? 999);
            break;
        }
        case 'date-asc':
        case 'date-desc': {
            // Tasks without a date sort last in both directions.
            const dateA = a.date ?? '9999-12-31';
            const dateB = b.date ?? '9999-12-31';
            primary = dateA.localeCompare(dateB);
            if (mode === 'date-desc' && dateA !== '9999-12-31' && dateB !== '9999-12-31') {
                primary = -primary;
            }
            break;
        }
        default:
            primary = 0;
    }

    if (primary !== 0) {
        return primary;
    }

    if (context.fallback === 'path-then-position') {
        const byPath = comparePaths(a.filePath, b.filePath);
        if (byPath !== 0) return byPath;
    }

    return a.lineNumber - b.lineNumber;
}
