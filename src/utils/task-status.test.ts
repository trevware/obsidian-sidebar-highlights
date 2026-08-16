/**
 * Tests for task checkbox parsing and status mapping.
 *
 * These import the real module rather than replicating its regexes, so a change
 * to production syntax cannot silently pass here.
 */

import {
    CHECKBOX_REGEX,
    CHECKBOX_REGEX_WITH_PREFIX,
    checkboxStateToStatus,
    statusToCheckboxState,
    isResolvedStatus,
    createTaskNestingState,
    resetTaskNesting,
    resolveTaskNesting,
    normalizeVisibleNesting
} from './task-status';

describe('task checkbox parsing', () => {
    describe('CHECKBOX_REGEX', () => {
        it('should match the in-progress state from issue #94', () => {
            const match = '- [/] Write the docs'.match(CHECKBOX_REGEX);

            expect(match).not.toBeNull();
            expect(match![2]).toBe('/');
            expect(match![3]).toBe('Write the docs');
        });

        it.each([
            [' ', 'todo'],
            ['x', 'done'],
            ['X', 'done'],
            ['/', 'in-progress'],
            ['-', 'cancelled'],
            ['?', 'question']
        ])('should match state [%s] and map it to %s', (state, expected) => {
            const match = `- [${state}] A task`.match(CHECKBOX_REGEX);

            expect(match).not.toBeNull();
            expect(checkboxStateToStatus(match![2])).toBe(expected);
        });

        it.each(['!', '!1', '!2', '!3', '1', '2', '3'])(
            'should still match the existing priority state [%s]',
            (state) => {
                const match = `- [${state}] A task`.match(CHECKBOX_REGEX);

                expect(match).not.toBeNull();
                expect(match![2]).toBe(state);
                // Priority markers are not a status of their own
                expect(checkboxStateToStatus(match![2])).toBe('todo');
            }
        );

        it('should match new states inside callouts', () => {
            const match = '> - [/] Task in a callout'.match(CHECKBOX_REGEX);

            expect(match).not.toBeNull();
            expect(match![2]).toBe('/');
            expect(match![3]).toBe('Task in a callout');
        });

        it('should preserve indentation for nested tasks', () => {
            const match = '    - [?] Nested question'.match(CHECKBOX_REGEX);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('    ');
            expect(match![2]).toBe('?');
        });

        it('should not match unsupported states', () => {
            expect('- [z] Not a task'.match(CHECKBOX_REGEX)).toBeNull();
            expect('- [] Not a task'.match(CHECKBOX_REGEX)).toBeNull();
        });

        it('should not match a checkbox with no text', () => {
            expect('- [/] '.match(CHECKBOX_REGEX)).toBeNull();
        });
    });

    describe('CHECKBOX_REGEX_WITH_PREFIX', () => {
        it('should capture the callout prefix so it survives a rewrite', () => {
            const match = '> - [/] Task'.match(CHECKBOX_REGEX_WITH_PREFIX);

            expect(match).not.toBeNull();
            const [, calloutPrefix, indent, state, text] = match!;
            expect(calloutPrefix).toBe('> ');
            expect(indent).toBe('');
            expect(state).toBe('/');
            expect(text).toBe('Task');
        });

        it('should round-trip a status change without losing the prefix', () => {
            const line = '> - [/] Task';
            const [, calloutPrefix, indent, , text] = line.match(CHECKBOX_REGEX_WITH_PREFIX)!;
            const rewritten = `${calloutPrefix || ''}${indent}- [${statusToCheckboxState('done')}] ${text}`;

            expect(rewritten).toBe('> - [x] Task');
        });
    });

    describe('status mapping', () => {
        it.each([
            ['todo', ' '],
            ['in-progress', '/'],
            ['cancelled', '-'],
            ['question', '?'],
            ['done', 'x']
        ] as const)('should convert %s to [%s] and back', (status, char) => {
            expect(statusToCheckboxState(status)).toBe(char);
            expect(checkboxStateToStatus(char)).toBe(status);
        });

        it('should treat done and cancelled as resolved', () => {
            expect(isResolvedStatus('done')).toBe(true);
            expect(isResolvedStatus('cancelled')).toBe(true);
        });

        it('should keep in-progress, question and todo unresolved', () => {
            expect(isResolvedStatus('in-progress')).toBe(false);
            expect(isResolvedStatus('question')).toBe(false);
            expect(isResolvedStatus('todo')).toBe(false);
        });
    });

    describe('scan-time nesting', () => {
        /** Run raw indent levels through the resolver, one per line, in order. */
        const run = (levels: number[]) => {
            const state = createTaskNestingState();
            return levels.map((level, line) => resolveTaskNesting(level, line, state));
        };

        it('should record a top-level task as having no parent', () => {
            expect(run([0])).toEqual([{ indentLevel: 0, parentLine: undefined }]);
        });

        it('should record the parent line for a sub-task', () => {
            expect(run([0, 1])).toEqual([
                { indentLevel: 0, parentLine: undefined },
                { indentLevel: 1, parentLine: 0 }
            ]);
        });

        it('should promote a sub-task that has no parent at all', () => {
            expect(run([1])).toEqual([{ indentLevel: 0, parentLine: undefined }]);
        });

        it('should clamp an over-indented task to one level below its ancestor', () => {
            expect(run([0, 3])).toEqual([
                { indentLevel: 0, parentLine: undefined },
                { indentLevel: 1, parentLine: 0 }
            ]);
        });

        it('should point siblings at the same parent', () => {
            const result = run([0, 1, 1]);
            expect(result[1].parentLine).toBe(0);
            expect(result[2].parentLine).toBe(0);
        });

        it('should reattach to the correct ancestor after dedenting', () => {
            //  0: parent
            //  1:   child
            //  2:     grandchild
            //  3:   back to child level
            const result = run([0, 1, 2, 1]);
            expect(result.map(r => r.indentLevel)).toEqual([0, 1, 2, 1]);
            expect(result[2].parentLine).toBe(1);
            expect(result[3].parentLine).toBe(0);
        });

        it('should reset parent tracking at a section boundary', () => {
            const state = createTaskNestingState();

            expect(resolveTaskNesting(0, 0, state).indentLevel).toBe(0);
            resetTaskNesting(state);
            // With tracking cleared, an indented task has no parent to attach to
            expect(resolveTaskNesting(1, 5, state)).toEqual({ indentLevel: 0, parentLine: undefined });
        });
    });

    describe('normalizeVisibleNesting', () => {
        const task = (lineNumber: number, indentLevel: number, parentLine?: number) => ({
            filePath: 'Notes.md',
            lineNumber,
            indentLevel,
            parentLine
        });

        it('should keep nesting when the parent survives filtering', () => {
            const result = normalizeVisibleNesting([task(0, 0), task(1, 1, 0)]);

            expect(result.map(t => t.indentLevel)).toEqual([0, 1]);
        });

        it('should promote a task whose parent was filtered out', () => {
            // The Excerpta.md regression: the parent and siblings are completed and
            // hidden, so the survivor must not nest under the preceding visible task.
            const result = normalizeVisibleNesting([
                task(36, 0),          // unrelated visible task, far earlier
                task(148, 1, 144)     // parent on line 144 was filtered out
            ]);

            expect(result.map(t => t.indentLevel)).toEqual([0, 0]);
        });

        it('should collapse a whole chain when an ancestor is missing', () => {
            const result = normalizeVisibleNesting([
                task(10, 1, 5),   // parent 5 missing -> top level
                task(11, 2, 10)   // parent 10 present, now at level 0 -> level 1
            ]);

            expect(result.map(t => t.indentLevel)).toEqual([0, 1]);
        });

        it('should not treat a same-line task in another file as a parent', () => {
            const result = normalizeVisibleNesting([
                { filePath: 'A.md', lineNumber: 5, indentLevel: 0, parentLine: undefined },
                { filePath: 'B.md', lineNumber: 6, indentLevel: 1, parentLine: 5 }
            ]);

            expect(result.map(t => t.indentLevel)).toEqual([0, 0]);
        });

        it('should preserve object identity for unchanged tasks', () => {
            const parent = task(0, 0);
            const child = task(1, 1, 0);

            const result = normalizeVisibleNesting([parent, child]);

            expect(result[0]).toBe(parent);
            expect(result[1]).toBe(child);
        });

        it('should not mutate the input when a level changes', () => {
            const orphan = task(148, 1, 144);

            const result = normalizeVisibleNesting([orphan]);

            expect(result[0].indentLevel).toBe(0);
            expect(orphan.indentLevel).toBe(1); // cache untouched
        });

        it('should terminate on a self-referencing parent', () => {
            const result = normalizeVisibleNesting([task(7, 1, 7)]);

            expect(result[0].indentLevel).toBe(0);
        });
    });
});
