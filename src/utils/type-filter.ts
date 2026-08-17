/**
 * Filtering the sidebar by what a row *is*: a highlight (`==text==`, or its HTML
 * equivalents) or a native comment (`%%text%%`).
 *
 * This replaces a plain "show native comments" boolean, which could only ever hide
 * comments — there was no way to ask for comments on their own. The third state is
 * the point; the other two preserve the old behaviour exactly. It is selected from
 * the Filters menu, which is why there is no cycling helper here.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

export type HighlightTypeFilter = 'all' | 'highlights' | 'comments';

/** Whether a row survives the filter. */
export function matchesTypeFilter(isNativeComment: boolean | undefined, filter: HighlightTypeFilter): boolean {
    if (filter === 'all') return true;
    return filter === 'comments' ? !!isNativeComment : !isNativeComment;
}

/**
 * Read the state a previous version stored, so nobody's sidebar silently changes
 * on update. The old key held the string 'false' when comments were hidden.
 */
export function migrateLegacyTypeFilter(legacyValue: string | null): HighlightTypeFilter {
    return legacyValue === 'false' ? 'highlights' : 'all';
}
