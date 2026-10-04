/**
 * Deciding whether a change to a note's highlights is worth writing to data.json.
 *
 * Everything about a highlight's place in its note (offsets, line, the comments
 * after it) is read back from the note whenever the plugin loads or opens it.
 * What a restart can't rebuild is the highlight's identity: the id collections
 * point at, its creation time, and a colour picked in the sidebar.
 *
 * Writing on every change is what produced issue #126. Typing above a highlight
 * moves its offsets, so each pause in typing rewrote data.json, and two synced
 * devices editing different notes both rewrote it between sync passes. The sync
 * tool then kept one write and set the other aside as a conflict copy. Positions
 * still update in memory as before; they reach disk with the next write that has
 * a reason to happen.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

export interface PersistedHighlight {
    id: string;
    text: string;
    type?: string;
    isNativeComment?: boolean;
    color?: string;
    createdAt?: number;
}

function persistedForm(highlights: PersistedHighlight[]): string {
    return JSON.stringify(highlights.map(h => [
        h.id,
        h.text,
        h.type ?? null,
        h.isNativeComment === true,
        h.color ?? null,
        h.createdAt ?? null
    ]));
}

/**
 * True when the highlights stored for a note differ in anything a restart would
 * lose, so the change has to be written to data.json.
 */
export function hasPersistentHighlightChanges(
    before: PersistedHighlight[],
    after: PersistedHighlight[]
): boolean {
    return persistedForm(before) !== persistedForm(after);
}
