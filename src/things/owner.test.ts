import { canConnect, ownerFile, readOwner, releaseOwner, writeOwner } from './owner';
import type { OwnerFs } from './owner';

function memoryFs(files: Record<string, string> = {}): OwnerFs & { files: Record<string, string> } {
    return {
        files,
        read: (path) => (path in files ? files[path] : null),
        write: (path, text) => { files[path] = text; },
        remove: (path) => { delete files[path]; }
    };
}

describe('the one vault per Mac that syncs with Things', () => {
    it('keeps its file in the Mac user\'s Library', () => {
        expect(ownerFile('/Users/trevor')).toBe('/Users/trevor/Library/Application Support/Sidebar Highlights and Tasks/things-owner.json');
    });

    it('lets a vault connect when no vault owns Things yet', () => {
        expect(canConnect(null, '/Users/trevor/Documents/Aegis')).toEqual({ ok: true });
    });

    it('lets the owning vault connect again', () => {
        expect(canConnect({ vaultPath: '/Users/trevor/Documents/Aegis', vaultName: 'Aegis' }, '/Users/trevor/Documents/Aegis')).toEqual({ ok: true });
    });

    it('turns away another vault, naming the one Things is synced with', () => {
        expect(canConnect({ vaultPath: '/Users/trevor/Documents/Pantheon', vaultName: 'Pantheon' }, '/Users/trevor/Documents/Aegis'))
            .toEqual({ ok: false, vaultName: 'Pantheon' });
    });

    it('writes, reads back and releases the owner', () => {
        const fs = memoryFs();
        const file = ownerFile('/Users/t');
        writeOwner(fs, file, { vaultPath: '/v/Aegis', vaultName: 'Aegis' });
        expect(readOwner(fs, file)).toEqual({ vaultPath: '/v/Aegis', vaultName: 'Aegis' });
        releaseOwner(fs, file, '/v/Other');
        expect(readOwner(fs, file)).not.toBeNull();
        releaseOwner(fs, file, '/v/Aegis');
        expect(readOwner(fs, file)).toBeNull();
    });

    it('reads a missing, empty or broken file as no owner', () => {
        const file = ownerFile('/Users/t');
        expect(readOwner(memoryFs(), file)).toBeNull();
        expect(readOwner(memoryFs({ [file]: '' }), file)).toBeNull();
        expect(readOwner(memoryFs({ [file]: '{not json' }), file)).toBeNull();
        expect(readOwner(memoryFs({ [file]: '{"vaultName":"Aegis"}' }), file)).toBeNull();
    });
});
