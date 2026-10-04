/**
 * Telling the user's typing apart from a change loaded from disk.
 *
 * When something outside Obsidian changes a note that is open (a sync tool,
 * another program), Obsidian loads the new text into the editor, and the editor
 * reports it as an edit like any other. Highlights found that way were written
 * to data.json by both devices: the one where the edit was made, and the one
 * that merely received it, which is the double write behind issue #126.
 *
 * Right after such a load, the editor holds exactly what Obsidian last read from
 * disk (a markdown view's `data`). Typing hasn't been saved yet, so it doesn't.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

/**
 * True when the editor text is the text last read from or saved to disk. The
 * editor always uses \n line endings, so a file saved with \r\n still matches.
 *
 * @param editorText The editor's current text
 * @param diskText What the view last read from or saved to disk
 */
export function matchesDiskText(editorText: string, diskText: unknown): boolean {
    if (typeof diskText !== 'string') {
        return false;
    }
    return editorText === diskText ||
        (diskText.includes('\r') && editorText === diskText.replace(/\r\n?/g, '\n'));
}
