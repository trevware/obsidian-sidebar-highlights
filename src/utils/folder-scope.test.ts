import { isInFolder, parentFolderPath } from './folder-scope';

describe('parentFolderPath', () => {
    it('returns the containing folder', () => {
        expect(parentFolderPath('Projects/Acme/Spec.md')).toBe('Projects/Acme');
    });

    it('returns an empty path for a note at the vault root', () => {
        expect(parentFolderPath('Spec.md')).toBe('');
    });

    it('keeps every level of a deep path', () => {
        expect(parentFolderPath('a/b/c/d/Note.md')).toBe('a/b/c/d');
    });
});

describe('isInFolder, folder only', () => {
    it('accepts a note directly in the folder', () => {
        expect(isInFolder('Projects/Acme/Spec.md', 'Projects/Acme', false)).toBe(true);
    });

    it('rejects a note in a subfolder', () => {
        expect(isInFolder('Projects/Acme/reference/API.md', 'Projects/Acme', false)).toBe(false);
    });

    it('rejects a note in the parent folder', () => {
        expect(isInFolder('Projects/Overview.md', 'Projects/Acme', false)).toBe(false);
    });

    it('scopes to the vault root without pulling in the whole vault', () => {
        expect(isInFolder('Inbox.md', '', false)).toBe(true);
        expect(isInFolder('Projects/Acme/Spec.md', '', false)).toBe(false);
    });
});

describe('isInFolder, including subfolders', () => {
    it('accepts a note directly in the folder', () => {
        expect(isInFolder('Projects/Acme/Spec.md', 'Projects/Acme', true)).toBe(true);
    });

    it('accepts a note at any depth below it', () => {
        expect(isInFolder('Projects/Acme/reference/v2/API.md', 'Projects/Acme', true)).toBe(true);
    });

    it('rejects a sibling folder that starts with the same characters', () => {
        // The reason the comparison is not a bare startsWith
        expect(isInFolder('Projects/Acme Archive/Old.md', 'Projects/Acme', true)).toBe(false);
        expect(isInFolder('Projects/Acme-2024/Old.md', 'Projects/Acme', true)).toBe(false);
    });

    it('rejects a note above the folder', () => {
        expect(isInFolder('Projects/Overview.md', 'Projects/Acme', true)).toBe(false);
    });

    it('treats the vault root as the whole vault', () => {
        expect(isInFolder('Inbox.md', '', true)).toBe(true);
        expect(isInFolder('Projects/Acme/Spec.md', '', true)).toBe(true);
    });

    it('does not confuse a folder with a note of the same name', () => {
        expect(isInFolder('Projects/Acme.md', 'Projects/Acme', true)).toBe(false);
    });
});

describe('reused folder names, the case Ken raised', () => {
    const files = [
        'Projects/Acme/reference/API.md',
        'Projects/Beta/reference/API.md',
        'Archive/reference/API.md'
    ];

    it('separates folders that share a name at different paths', () => {
        expect(files.filter(f => isInFolder(f, 'Projects/Acme/reference', true)))
            .toEqual(['Projects/Acme/reference/API.md']);
    });
});
