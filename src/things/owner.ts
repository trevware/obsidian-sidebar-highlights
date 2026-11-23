/**
 * One vault per Mac syncs with Things.
 *
 * Things keeps one library per Mac account, and Things sync moves
 * everything both ways, so two vaults connected at once would each pull in
 * the other's areas and fight over them. The vault that connects first is
 * written down in a small file in the Mac user's Library, where every vault
 * on the Mac can see it, and any other vault is turned away by name until
 * that one disconnects.
 *
 * The file is read and written through `OwnerFs`, so tests use a map. Kept
 * free of Obsidian imports so it can be unit tested directly.
 */

export interface Owner {
    vaultPath: string;
    vaultName: string;
}

/** Reading and writing one small text file; `read` gives null for a file that isn't there. */
export interface OwnerFs {
    read(path: string): string | null;
    write(path: string, text: string): void;
    remove(path: string): void;
}

export function ownerFile(home: string): string {
    return `${home}/Library/Application Support/Sidebar Highlights and Tasks/things-owner.json`;
}

export function canConnect(owner: Owner | null, vaultPath: string): { ok: true } | { ok: false; vaultName: string } {
    if (!owner || owner.vaultPath === vaultPath) return { ok: true };
    return { ok: false, vaultName: owner.vaultName };
}

/** The vault that owns Things on this Mac, or null when none does or the file can't be read. */
export function readOwner(fs: OwnerFs, file: string): Owner | null {
    let text: string | null;
    try {
        text = fs.read(file);
    } catch {
        return null;
    }
    if (!text) return null;
    try {
        const value = JSON.parse(text) as Partial<Owner> | null;
        if (value && typeof value.vaultPath === 'string' && typeof value.vaultName === 'string') {
            return { vaultPath: value.vaultPath, vaultName: value.vaultName };
        }
    } catch {
        // A broken file says nothing about who owns Things.
    }
    return null;
}

export function writeOwner(fs: OwnerFs, file: string, owner: Owner): void {
    fs.write(file, JSON.stringify(owner));
}

/** Lets go of Things, but only when this vault is the one holding it. */
export function releaseOwner(fs: OwnerFs, file: string, vaultPath: string): void {
    if (readOwner(fs, file)?.vaultPath === vaultPath) fs.remove(file);
}
