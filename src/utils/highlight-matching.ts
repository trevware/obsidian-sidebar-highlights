/**
 * Matching a freshly detected highlight to the stored one it came from, so it
 * keeps its id, and with it its collections, colour, and creation time.
 *
 * Tried in order: the same text at the same place, the same text within 50
 * characters, then the same text anywhere in the note. The last step used to
 * apply only when the text was unique in the note. Stored positions can now lag
 * the note by many edits (they are no longer written on their own, see
 * highlight-persistence.ts), so highlights sharing a text are now taken in
 * order: the next one not yet claimed, in the order they were stored.
 * Detection walks the note top to bottom, so the first repeat gets the first
 * stored id and so on, which survives any amount of typing above them.
 *
 * Recolouring a highlight in Obsidian changes the colour emoji at the start of
 * its text (issue #130). When nothing has the exact text, the same steps run
 * again with the emoji set aside, so a recoloured highlight keeps its id.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import { stripColorMarker } from './note-colors';

export interface MatchableHighlight {
    id: string;
    text: string;
    startOffset: number;
    endOffset: number;
    isNativeComment?: boolean;
}

/**
 * Find the stored highlight a detected one corresponds to, and mark it used so
 * it isn't handed out twice in the same pass.
 *
 * @param existing Highlights stored for the note before this pass
 * @param used Ids already claimed during this pass (updated in place)
 */
export function findExistingHighlight<T extends MatchableHighlight>(
    existing: T[],
    used: Set<string>,
    text: string,
    startOffset: number,
    endOffset: number,
    isComment: boolean
): T | undefined {
    const unclaimed = existing.filter(h => !used.has(h.id) && h.isNativeComment === isComment);

    let match = closest(unclaimed.filter(h => h.text === text), startOffset, endOffset);

    // Obsidian only colours == highlights, so in a comment the emoji is just text
    if (!match && !isComment) {
        const words = stripColorMarker(text);
        match = closest(unclaimed.filter(h => stripColorMarker(h.text) === words), startOffset, endOffset);
    }

    if (match) {
        used.add(match.id);
    }
    return match;
}

function closest<T extends MatchableHighlight>(candidates: T[], startOffset: number, endOffset: number): T | undefined {
    return candidates.find(h => h.startOffset === startOffset && h.endOffset === endOffset) ??
        candidates.find(h => Math.abs(h.startOffset - startOffset) <= 50) ??
        candidates.reduce<T | undefined>((first, h) => (!first || h.startOffset < first.startOffset ? h : first), undefined);
}
