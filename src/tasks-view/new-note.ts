/**
 * Naming a note made from the Tasks tab. Kept free of Obsidian imports so it
 * can be unit tested directly.
 */

/**
 * Characters a note name can't hold on some systems (`\ / : * ? " < > |`),
 * and the ones that break a link to the note (`# ^ [ ]`).
 */
const UNUSABLE = /[\\/:*?"<>|#^[\]]/g;

/** A typed name made safe for a note: unusable characters out, spaces tidied, no leading dots or `.md`. */
export function cleanNoteName(raw: string): string {
    return raw
        .replace(UNUSABLE, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.md$/i, '')
        .replace(/^\.+/, '')
        .trim();
}

/** A folder's path as the rail and note paths use it: the vault root is ''. */
export function folderOf(folderPath: string): string {
    return folderPath === '/' ? '' : folderPath;
}

/** Where a note of this name goes in this folder. */
export function newNotePath(folder: string, name: string): string {
    const parent = folderOf(folder);
    return parent ? `${parent}/${name}.md` : `${name}.md`;
}
