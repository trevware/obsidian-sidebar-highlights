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
    isResolvedStatus
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
});
