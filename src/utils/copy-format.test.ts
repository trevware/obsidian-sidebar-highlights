/**
 * Tests for bulk copy formatting (issue #99).
 */

import {
    formatHighlightForCopy,
    formatTaskForCopy,
    joinHighlightEntries,
    joinTaskEntries,
    CopyFormat
} from './copy-format';

describe('copy formatting', () => {
    describe('highlights', () => {
        const highlight = { text: 'remarkable bit' };

        it('should keep highlight syntax in with-syntax format', () => {
            expect(formatHighlightForCopy(highlight, 'with-syntax')).toBe('==remarkable bit==');
        });

        it('should drop highlight syntax in plain format', () => {
            expect(formatHighlightForCopy(highlight, 'plain')).toBe('remarkable bit');
        });

        it('should drop syntax and add a bullet in list format', () => {
            expect(formatHighlightForCopy(highlight, 'list')).toBe('- remarkable bit');
        });

        it.each<CopyFormat>(['with-syntax', 'plain', 'list'])(
            'should keep native comment markers in %s format',
            (format) => {
                const result = formatHighlightForCopy(
                    { text: 'a comment', isNativeComment: true },
                    format
                );

                // The markers say "this was an annotation", which stays useful
                // even once the surrounding document is gone.
                expect(result).toContain('%%a comment%%');
                expect(result).not.toContain('==');
            }
        );

        it.each<CopyFormat>(['with-syntax', 'plain', 'list'])(
            'should keep footnotes in %s format',
            (format) => {
                const result = formatHighlightForCopy(
                    { text: 'text', footnoteContents: ['a note with #tag'] },
                    format
                );

                expect(result).toContain('^[a note with #tag]');
            }
        );

        it('should append multiple footnotes in order', () => {
            const result = formatHighlightForCopy(
                { text: 'text', footnoteContents: ['first', 'second'] },
                'plain'
            );

            expect(result).toBe('text^[first]^[second]');
        });

        it('should not append footnotes to a native comment', () => {
            const result = formatHighlightForCopy(
                { text: 'a comment', isNativeComment: true, footnoteContents: ['ignored'] },
                'plain'
            );

            expect(result).toBe('%%a comment%%');
        });

        it('should handle an empty footnote list', () => {
            expect(formatHighlightForCopy({ text: 'text', footnoteContents: [] }, 'plain'))
                .toBe('text');
        });

        it('should reproduce the layout requested in the issue', () => {
            const entries = [
                formatHighlightForCopy({ text: 'first highlight', footnoteContents: ['a note with #tag1'] }, 'list'),
                formatHighlightForCopy({ text: 'Another highlight', footnoteContents: ['also #tag1'] }, 'list'),
                formatHighlightForCopy({ text: 'a larger comment mentioning #tag1', isNativeComment: true }, 'list')
            ];

            expect(joinHighlightEntries(entries, 'list')).toBe(
                '- first highlight^[a note with #tag1]\n' +
                '- Another highlight^[also #tag1]\n' +
                '- %%a larger comment mentioning #tag1%%'
            );
        });
    });

    describe('tasks', () => {
        it('should keep the checkbox in with-syntax format', () => {
            expect(formatTaskForCopy({ text: 'Write the docs', status: 'todo' }, 'with-syntax'))
                .toBe('- [ ] Write the docs');
        });

        it.each([
            ['todo', '- [ ] Task'],
            ['in-progress', '- [/] Task'],
            ['cancelled', '- [-] Task'],
            ['question', '- [?] Task'],
            ['done', '- [x] Task']
        ] as const)('should render %s as %s', (status, expected) => {
            expect(formatTaskForCopy({ text: 'Task', status }, 'with-syntax')).toBe(expected);
        });

        it('should drop the checkbox in plain format', () => {
            expect(formatTaskForCopy({ text: 'Write the docs', status: 'in-progress' }, 'plain'))
                .toBe('Write the docs');
        });

        it('should use a plain bullet in list format', () => {
            expect(formatTaskForCopy({ text: 'Write the docs', status: 'done' }, 'list'))
                .toBe('- Write the docs');
        });

        it('should fall back to completed when status is absent', () => {
            expect(formatTaskForCopy({ text: 'Task', completed: true }, 'with-syntax'))
                .toBe('- [x] Task');
            expect(formatTaskForCopy({ text: 'Task', completed: false }, 'with-syntax'))
                .toBe('- [ ] Task');
        });
    });

    describe('joining', () => {
        it('should separate list entries with a single newline', () => {
            expect(joinHighlightEntries(['- a', '- b'], 'list')).toBe('- a\n- b');
        });

        it.each<CopyFormat>(['with-syntax', 'plain'])(
            'should separate %s entries with a blank line',
            (format) => {
                expect(joinHighlightEntries(['a', 'b'], format)).toBe('a\n\nb');
            }
        );

        it('should put every task on its own line', () => {
            expect(joinTaskEntries(['- [ ] a', '- [x] b'])).toBe('- [ ] a\n- [x] b');
        });
    });
});
