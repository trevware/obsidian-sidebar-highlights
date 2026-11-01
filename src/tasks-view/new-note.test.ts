import { cleanNoteName, folderOf, newNotePath } from './new-note';
import { railAreas } from './task-views';
import type { NoteInfo } from './task-views';
import type { Task } from '../../main';

describe('new note names', () => {
    it('keeps an ordinary name as typed', () => {
        expect(cleanNoteName('Kitchen renovation')).toBe('Kitchen renovation');
        expect(cleanNoteName('  Q4 plan  ')).toBe('Q4 plan');
    });

    it('drops characters a note name cannot hold or that break links to it', () => {
        expect(cleanNoteName('Trip: Lisbon / Porto?')).toBe('Trip Lisbon Porto');
        expect(cleanNoteName('a*b"c\\d<e>f|g#h^i[j]k')).toBe('a b c d e f g h i j k');
        expect(cleanNoteName('Q3/Q4')).toBe('Q3 Q4');
    });

    it('drops leading dots, which would hide the note', () => {
        expect(cleanNoteName('...notes')).toBe('notes');
    });

    it('leaves nothing when nothing usable was typed', () => {
        expect(cleanNoteName('  /?  ')).toBe('');
    });

    it('drops a typed .md, which the note gets anyway', () => {
        expect(cleanNoteName('Groceries.md')).toBe('Groceries');
    });
});

describe('new note paths', () => {
    it('puts the note in its folder, or at the top of the vault', () => {
        expect(newNotePath('Projects/Home', 'Kitchen')).toBe('Projects/Home/Kitchen.md');
        expect(newNotePath('', 'Kitchen')).toBe('Kitchen.md');
        expect(newNotePath('/', 'Kitchen')).toBe('Kitchen.md');
    });

    it('reads the vault root as an empty folder', () => {
        expect(folderOf('/')).toBe('');
        expect(folderOf('Projects')).toBe('Projects');
    });
});

describe('the rail keeps the open note', () => {
    const notes: NoteInfo = {
        basename: (path) => path.split('/').pop()!.replace(/\.md$/, ''),
        folder: (path) => path.split('/').slice(0, -1).join('/'),
        mtime: () => 0
    };
    const task = { filePath: 'Work/Plan.md', status: 'todo', completed: false } as Task;

    it('shows a note with nothing open while it is the open list', () => {
        const areas = railAreas([task], notes, new Set(), 'Work/New.md');
        expect(areas).toEqual([{ folder: 'Work', notes: [{ path: 'Work/New.md', name: 'New', open: 0 }, { path: 'Work/Plan.md', name: 'Plan', open: 1 }] }]);
    });

    it('does not repeat a kept note that is pinned or already listed', () => {
        expect(railAreas([task], notes, new Set(['Work/New.md']), 'Work/New.md')[0].notes.map(note => note.path)).toEqual(['Work/Plan.md']);
        expect(railAreas([task], notes, new Set(), 'Work/Plan.md')[0].notes).toHaveLength(1);
    });
});
