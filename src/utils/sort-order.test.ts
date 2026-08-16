/**
 * Tests for sidebar sort comparators.
 */

import {
    compareHighlights,
    compareTasks,
    noteTitleFromPath,
    SortContext,
    SortableHighlight,
    SortableTask
} from './sort-order';

const flat: SortContext = { fallback: 'path-then-position' };
const grouped: SortContext = { fallback: 'position' };

const hl = (over: Partial<SortableHighlight> = {}): SortableHighlight => ({
    text: 'text',
    filePath: 'Notes/Note.md',
    startOffset: 0,
    ...over
});

const sortHl = (items: SortableHighlight[], mode: any, ctx: SortContext = flat) =>
    [...items].sort((a, b) => compareHighlights(a, b, mode, ctx));

describe('noteTitleFromPath', () => {
    it('should take the file name without folders or extension', () => {
        expect(noteTitleFromPath('Work/Projects/Meeting Notes.md')).toBe('Meeting Notes');
    });

    it('should handle a file at the vault root', () => {
        expect(noteTitleFromPath('Note.md')).toBe('Note');
    });

    it('should handle a name containing dots', () => {
        expect(noteTitleFromPath('Folder/v1.2 spec.md')).toBe('v1.2 spec');
    });
});

describe('compareHighlights', () => {
    describe('default order', () => {
        it('should sort by path then position for a flat list', () => {
            const a = hl({ filePath: 'B.md', startOffset: 0 });
            const b = hl({ filePath: 'A.md', startOffset: 50 });

            expect(sortHl([a, b], 'none').map(h => h.filePath)).toEqual(['A.md', 'B.md']);
        });

        it('should sort by position only within a group', () => {
            const a = hl({ filePath: 'B.md', startOffset: 10 });
            const b = hl({ filePath: 'A.md', startOffset: 5 });

            expect(sortHl([a, b], 'none', grouped).map(h => h.startOffset)).toEqual([5, 10]);
        });
    });

    describe('by source note title', () => {
        it('should order on title, not full path', () => {
            // Path order would put Archive/Zoo first; title order puts Apple first.
            const zoo = hl({ filePath: 'Archive/Zoo.md' });
            const apple = hl({ filePath: 'Work/Apple.md' });

            expect(sortHl([zoo, apple], 'note-title-asc').map(h => h.filePath))
                .toEqual(['Work/Apple.md', 'Archive/Zoo.md']);
        });

        it('should reverse for descending', () => {
            const zoo = hl({ filePath: 'Archive/Zoo.md' });
            const apple = hl({ filePath: 'Work/Apple.md' });

            expect(sortHl([apple, zoo], 'note-title-desc').map(h => h.filePath))
                .toEqual(['Archive/Zoo.md', 'Work/Apple.md']);
        });

        it('should keep position order within the same note', () => {
            const second = hl({ filePath: 'A.md', startOffset: 90 });
            const first = hl({ filePath: 'A.md', startOffset: 10 });

            expect(sortHl([second, first], 'note-title-asc').map(h => h.startOffset))
                .toEqual([10, 90]);
        });

        it('should be case insensitive', () => {
            const upper = hl({ filePath: 'apple.md' });
            const lower = hl({ filePath: 'Banana.md' });

            expect(sortHl([lower, upper], 'note-title-asc').map(h => h.filePath))
                .toEqual(['apple.md', 'Banana.md']);
        });
    });

    describe('by note creation date', () => {
        const ctx: SortContext = {
            fallback: 'path-then-position',
            getNoteCreated: (path) => ({ 'New.md': 3000, 'Old.md': 1000 } as Record<string, number>)[path]
        };

        it('should put the newest note first when descending', () => {
            const oldNote = hl({ filePath: 'Old.md' });
            const newNote = hl({ filePath: 'New.md' });

            expect([oldNote, newNote].sort((a, b) => compareHighlights(a, b, 'note-created-desc', ctx))
                .map(h => h.filePath)).toEqual(['New.md', 'Old.md']);
        });

        it('should put the oldest note first when ascending', () => {
            const oldNote = hl({ filePath: 'Old.md' });
            const newNote = hl({ filePath: 'New.md' });

            expect([newNote, oldNote].sort((a, b) => compareHighlights(a, b, 'note-created-asc', ctx))
                .map(h => h.filePath)).toEqual(['Old.md', 'New.md']);
        });

        it('should sort notes with no resolvable date last in both directions', () => {
            const unknown = hl({ filePath: 'Missing.md' });
            const known = hl({ filePath: 'Old.md' });

            for (const mode of ['note-created-asc', 'note-created-desc'] as const) {
                expect([unknown, known].sort((a, b) => compareHighlights(a, b, mode, ctx))
                    .map(h => h.filePath)).toEqual(['Old.md', 'Missing.md']);
            }
        });
    });

    describe('by highlight creation date', () => {
        it('should build a newest-first timeline across notes', () => {
            const older = hl({ filePath: 'B.md', createdAt: 1000 });
            const newer = hl({ filePath: 'A.md', createdAt: 5000 });

            expect(sortHl([older, newer], 'created-desc').map(h => h.createdAt))
                .toEqual([5000, 1000]);
        });

        it('should build an oldest-first timeline', () => {
            const older = hl({ filePath: 'B.md', createdAt: 1000 });
            const newer = hl({ filePath: 'A.md', createdAt: 5000 });

            expect(sortHl([newer, older], 'created-asc').map(h => h.createdAt))
                .toEqual([1000, 5000]);
        });

        it('should sort highlights with no timestamp last in both directions', () => {
            // createdAt is optional; older vaults and restored backups may lack it.
            const undated = hl({ filePath: 'A.md' });
            const dated = hl({ filePath: 'B.md', createdAt: 1000 });

            for (const mode of ['created-asc', 'created-desc'] as const) {
                expect(sortHl([undated, dated], mode).map(h => h.createdAt))
                    .toEqual([1000, undefined]);
            }
        });
    });

    describe('alphabetical', () => {
        it('should still sort by highlight text', () => {
            const b = hl({ text: 'banana' });
            const a = hl({ text: 'apple' });

            expect(sortHl([b, a], 'alphabetical-asc').map(h => h.text)).toEqual(['apple', 'banana']);
            expect(sortHl([a, b], 'alphabetical-desc').map(h => h.text)).toEqual(['banana', 'apple']);
        });
    });
});

describe('compareTasks', () => {
    const task = (over: Partial<SortableTask> = {}): SortableTask => ({
        text: 'task',
        filePath: 'A.md',
        lineNumber: 0,
        ...over
    });

    const sortTasks = (items: SortableTask[], mode: any, ctx: SortContext = flat) =>
        [...items].sort((a, b) => compareTasks(a, b, mode, ctx));

    it('should preserve priority order with unprioritised tasks last', () => {
        const none = task({ text: 'none', lineNumber: 0 });
        const low = task({ text: 'low', priority: 3, lineNumber: 1 });
        const high = task({ text: 'high', priority: 1, lineNumber: 2 });

        expect(sortTasks([none, low, high], 'priority').map(t => t.text))
            .toEqual(['high', 'low', 'none']);
    });

    it('should preserve date order with undated tasks last in both directions', () => {
        const undated = task({ text: 'undated', lineNumber: 0 });
        const early = task({ text: 'early', date: '2026-01-01', lineNumber: 1 });
        const late = task({ text: 'late', date: '2026-12-31', lineNumber: 2 });

        expect(sortTasks([undated, late, early], 'date-asc').map(t => t.text))
            .toEqual(['early', 'late', 'undated']);
        expect(sortTasks([undated, early, late], 'date-desc').map(t => t.text))
            .toEqual(['late', 'early', 'undated']);
    });

    it('should sort tasks by source note title', () => {
        const zoo = task({ filePath: 'Archive/Zoo.md' });
        const apple = task({ filePath: 'Work/Apple.md' });

        expect(sortTasks([zoo, apple], 'note-title-asc').map(t => t.filePath))
            .toEqual(['Work/Apple.md', 'Archive/Zoo.md']);
    });

    it('should fall back to line number within a group', () => {
        const later = task({ filePath: 'B.md', lineNumber: 20 });
        const earlier = task({ filePath: 'A.md', lineNumber: 5 });

        expect(sortTasks([later, earlier], 'none', grouped).map(t => t.lineNumber))
            .toEqual([5, 20]);
    });

    it('should fall back to path then line number in a flat list', () => {
        const b = task({ filePath: 'B.md', lineNumber: 0 });
        const a = task({ filePath: 'A.md', lineNumber: 99 });

        expect(sortTasks([b, a], 'none').map(t => t.filePath)).toEqual(['A.md', 'B.md']);
    });
});
