/**
 * Tests for Tasks-plugin metadata stripping (issue #101).
 */

import { stripTasksPluginMetadata } from './task-metadata';

describe('stripTasksPluginMetadata', () => {
    describe('Dataview-style fields', () => {
        it('should strip the scheduled field from the issue report', () => {
            expect(stripTasksPluginMetadata('Review PR [scheduled:: 2026-08-20]'))
                .toBe('Review PR');
        });

        it.each([
            'due', 'scheduled', 'start', 'created', 'completion', 'done',
            'cancelled', 'repeat', 'recurrence', 'priority', 'id',
            'dependsOn', 'blockedBy', 'onCompletion'
        ])('should strip the %s field', (key) => {
            expect(stripTasksPluginMetadata(`Task [${key}:: value]`)).toBe('Task');
        });

        it('should strip parenthesised fields', () => {
            expect(stripTasksPluginMetadata('Task (due:: 2026-08-21)')).toBe('Task');
        });

        it('should strip several fields at once', () => {
            expect(stripTasksPluginMetadata('Task [due:: 2026-08-21] [priority:: high]'))
                .toBe('Task');
        });

        it('should be case insensitive', () => {
            expect(stripTasksPluginMetadata('Task [Due:: 2026-08-21]')).toBe('Task');
        });

        it('should keep inline fields that are not Tasks plugin keys', () => {
            expect(stripTasksPluginMetadata('Task [effort:: 3] [client:: Acme]'))
                .toBe('Task [effort:: 3] [client:: Acme]');
        });

        it('should keep a custom field while stripping a Tasks one', () => {
            expect(stripTasksPluginMetadata('Task [effort:: 3] [due:: 2026-08-21]'))
                .toBe('Task [effort:: 3]');
        });
    });

    describe('emoji signifiers', () => {
        it.each([
            ['➕', 'created'],
            ['\u{1F6EB}', 'start'],
            ['⏳', 'scheduled'],
            ['\u{1F4C5}', 'due'],
            ['✅', 'done'],
            ['❌', 'cancelled']
        ])('should strip %s (%s) with its date', (emoji) => {
            expect(stripTasksPluginMetadata(`Review PR ${emoji} 2026-08-20`)).toBe('Review PR');
        });

        it.each(['\u{1F53A}', '⏫', '\u{1F53C}', '\u{1F53D}', '⏬'])(
            'should strip the valueless priority signifier %s',
            (emoji) => {
                expect(stripTasksPluginMetadata(`Review PR ${emoji}`)).toBe('Review PR');
            }
        );

        it('should strip a recurrence rule', () => {
            expect(stripTasksPluginMetadata('Review PR \u{1F501} every week'))
                .toBe('Review PR');
        });

        it.each(['\u{1F194}', '⛔', '\u{1F3C1}'])(
            'should strip the token signifier %s with its value',
            (emoji) => {
                expect(stripTasksPluginMetadata(`Review PR ${emoji} abc123`)).toBe('Review PR');
            }
        );

        it('should strip a full combination in the usual order', () => {
            const text = 'Review PR ⏳ 2026-08-20 \u{1F4C5} 2026-08-21 \u{1F501} every week ⏫';
            expect(stripTasksPluginMetadata(text)).toBe('Review PR');
        });

        it('should strip recurrence followed by another signifier', () => {
            const text = 'Review PR \u{1F501} every week \u{1F4C5} 2026-08-21';
            expect(stripTasksPluginMetadata(text)).toBe('Review PR');
        });
    });

    describe('text that must survive', () => {
        it('should leave a task with no metadata untouched', () => {
            expect(stripTasksPluginMetadata('Just a normal task')).toBe('Just a normal task');
        });

        it('should keep tags and links', () => {
            const text = 'Review [[Some Note]] for #project before shipping';
            expect(stripTasksPluginMetadata(text)).toBe(text);
        });

        it('should keep a date that has no signifier', () => {
            // The plugin parses bare dates itself; only Tasks metadata is stripped here.
            expect(stripTasksPluginMetadata('Ship release 2026-08-20'))
                .toBe('Ship release 2026-08-20');
        });

        it('should keep an unrelated emoji', () => {
            expect(stripTasksPluginMetadata('Buy \u{1F382} for the party'))
                .toBe('Buy \u{1F382} for the party');
        });

        it('should keep a date signifier that is not followed by a date', () => {
            // Shape-aware matching: without a date this is prose, not metadata.
            expect(stripTasksPluginMetadata('Mark \u{1F4C5} on the calendar'))
                .toBe('Mark \u{1F4C5} on the calendar');
        });

        it('should keep a markdown checkbox-like bracket', () => {
            expect(stripTasksPluginMetadata('Task with [a bracketed note]'))
                .toBe('Task with [a bracketed note]');
        });
    });

    describe('whitespace', () => {
        it('should collapse the gap left by a field removed mid-line', () => {
            expect(stripTasksPluginMetadata('Review [due:: 2026-08-21] the PR'))
                .toBe('Review the PR');
        });

        it('should trim trailing whitespace', () => {
            expect(stripTasksPluginMetadata('Review PR   \u{1F4C5} 2026-08-20'))
                .toBe('Review PR');
        });

        it('should handle text that is only metadata', () => {
            expect(stripTasksPluginMetadata('\u{1F4C5} 2026-08-20')).toBe('');
        });
    });
});
