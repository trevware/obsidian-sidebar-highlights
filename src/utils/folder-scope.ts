/**
 * Folder membership for the Current note tab's folder scope.
 *
 * Obsidian vault paths are '/'-separated and have no leading slash, so a note at
 * the root has no folder segment at all — represented here as an empty path,
 * which is also how the root folder itself is named.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

/** The folder a note sits in. Empty string for a note at the vault root. */
export function parentFolderPath(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/');
    return lastSlash === -1 ? '' : filePath.slice(0, lastSlash);
}

/**
 * Whether a note sits in a folder — directly, or at any depth when
 * `includeSubfolders` is set.
 *
 * The recursive test compares against `folderPath + '/'` rather than using a bare
 * `startsWith`, so `Projects/Acme` does not swallow `Projects/Acme Archive`, and a
 * note named `Projects/Acme.md` is not mistaken for the folder's contents.
 */
export function isInFolder(filePath: string, folderPath: string, includeSubfolders: boolean): boolean {
    if (!includeSubfolders) {
        return parentFolderPath(filePath) === folderPath;
    }
    // The root folder contains the whole vault
    if (folderPath === '') return true;
    return filePath.startsWith(`${folderPath}/`);
}
