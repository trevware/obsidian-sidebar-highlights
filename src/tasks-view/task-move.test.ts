import { addUnderNewHeading, headingSectionEnd, moveHeading, moveTasks, newHeadingLevel, noteHeadings } from './task-move';
import type { MoveSource } from './task-move';

const note = (text: string) => text.split('\n');
const at = (lines: string[], text: string): MoveSource => ({ line: lines.findIndex(line => line.endsWith(` ${text}`)), text });

describe('moveTasks', () => {
    const base = note([
        '# Excerpta',
        '',
        '## Search',
        '- [ ] Index by chapter',
        '- [ ] Faster search',
        '    - Profile the query',
        '    - [ ] Cache the tokenizer',
        '- [ ] Highlight matches',
        '',
        '## Export',
        '- [ ] Readwise',
        '- [ ] Markdown export',
        ''
    ].join('\n'));

    it('puts a task right above another one', () => {
        const plan = moveTasks(base, [at(base, 'Highlight matches')], { kind: 'before', ...at(base, 'Index by chapter') });
        expect(plan?.lines.slice(2, 8)).toEqual([
            '## Search',
            '- [ ] Highlight matches',
            '- [ ] Index by chapter',
            '- [ ] Faster search',
            '    - Profile the query',
            '    - [ ] Cache the tokenizer'
        ]);
    });

    it('takes a task\'s notes and subtasks with it', () => {
        const plan = moveTasks(base, [at(base, 'Faster search')], { kind: 'after', ...at(base, 'Readwise') });
        expect(plan?.lines.slice(2, 13)).toEqual([
            '## Search',
            '- [ ] Index by chapter',
            '- [ ] Highlight matches',
            '',
            '## Export',
            '- [ ] Readwise',
            '- [ ] Faster search',
            '    - Profile the query',
            '    - [ ] Cache the tokenizer',
            '- [ ] Markdown export',
            ''
        ]);
    });

    it('lands after the whole block of the task above, not inside it', () => {
        const plan = moveTasks(base, [at(base, 'Index by chapter')], { kind: 'after', ...at(base, 'Faster search') });
        expect(plan?.lines.slice(3, 8)).toEqual([
            '- [ ] Faster search',
            '    - Profile the query',
            '    - [ ] Cache the tokenizer',
            '- [ ] Index by chapter',
            '- [ ] Highlight matches'
        ]);
    });

    it('goes to the bottom of a heading, joining its list', () => {
        const plan = moveTasks(base, [at(base, 'Index by chapter')], { kind: 'heading', heading: 'Export' });
        expect(plan?.lines.slice(-4)).toEqual(['- [ ] Readwise', '- [ ] Markdown export', '- [ ] Index by chapter', '']);
    });

    it('brings a subtask out to the top level, keeping its own children under it', () => {
        const lines = note(['## A', '- [ ] Parent', '    - [ ] Child', '        - [ ] Grandchild', '## B', '- [ ] Other'].join('\n'));
        const plan = moveTasks(lines, [at(lines, 'Child')], { kind: 'heading', heading: 'B' });
        expect(plan?.lines).toEqual(['## A', '- [ ] Parent', '## B', '- [ ] Other', '- [ ] Child', '    - [ ] Grandchild']);
    });

    it('matches the indent of the task it lands next to', () => {
        const lines = note(['## A', '- [ ] Move me', '## B', '\t- [ ] Indented list'].join('\n'));
        const plan = moveTasks(lines, [at(lines, 'Move me')], { kind: 'before', ...at(lines, 'Indented list') });
        expect(plan?.lines).toEqual(['## A', '## B', '\t- [ ] Move me', '\t- [ ] Indented list']);
    });

    it('moves several tasks together, in note order', () => {
        const plan = moveTasks(base, [at(base, 'Highlight matches'), at(base, 'Index by chapter')], { kind: 'heading', heading: 'Export' });
        expect(plan?.lines.slice(-5)).toEqual(['- [ ] Readwise', '- [ ] Markdown export', '- [ ] Index by chapter', '- [ ] Highlight matches', '']);
    });

    it('moves a selected subtask once, with its selected parent', () => {
        const plan = moveTasks(base, [at(base, 'Faster search'), at(base, 'Cache the tokenizer')], { kind: 'heading', heading: 'Export' });
        expect(plan?.lines.slice(-5)).toEqual(['- [ ] Markdown export', '- [ ] Faster search', '    - Profile the query', '    - [ ] Cache the tokenizer', '']);
    });

    it('finds a task again when the note shifted under it', () => {
        const shifted = ['Intro line', ...base];
        const plan = moveTasks(shifted, [{ line: 7, text: 'Highlight matches' }], { kind: 'before', line: 3, text: 'Index by chapter' });
        expect(plan?.lines.slice(3, 6)).toEqual(['## Search', '- [ ] Highlight matches', '- [ ] Index by chapter']);
    });

    it('moves tasks above the first heading with an empty heading name', () => {
        const lines = note(['- [ ] Loose task', '', '## A', '- [ ] Filed task'].join('\n'));
        const plan = moveTasks(lines, [at(lines, 'Filed task')], { kind: 'heading', heading: '' });
        expect(plan?.lines).toEqual(['- [ ] Loose task', '- [ ] Filed task', '', '## A']);
    });

    it('goes under the heading it was aimed at when two share a name', () => {
        const lines = note(['## Action items', '- [ ] One', '## Notes', '- [ ] Move me', '## Action items', '- [ ] Two'].join('\n'));
        const plan = moveTasks(lines, [at(lines, 'Move me')], { kind: 'heading', heading: 'Action items', line: 4 });
        expect(plan?.lines).toEqual(['## Action items', '- [ ] One', '## Notes', '## Action items', '- [ ] Two', '- [ ] Move me']);
    });

    it('leaves the note alone when the task would not move', () => {
        expect(moveTasks(base, [at(base, 'Index by chapter')], { kind: 'before', ...at(base, 'Faster search') })).toBeNull();
        expect(moveTasks(base, [at(base, 'Faster search')], { kind: 'after', ...at(base, 'Index by chapter') })).toBeNull();
    });

    it('refuses to drop a task inside its own block', () => {
        expect(moveTasks(base, [at(base, 'Faster search')], { kind: 'before', ...at(base, 'Cache the tokenizer') })).toBeNull();
    });

    it('refuses when a task or its target is gone', () => {
        expect(moveTasks(base, [{ line: 3, text: 'Not here' }], { kind: 'heading', heading: 'Export' })).toBeNull();
        expect(moveTasks(base, [at(base, 'Readwise')], { kind: 'heading', heading: 'Missing' })).toBeNull();
    });

    it('leaves tasks inside callouts alone', () => {
        const lines = note(['## A', '> - [ ] In a callout', '## B', '- [ ] Other'].join('\n'));
        expect(moveTasks(lines, [{ line: 1, text: 'In a callout' }], { kind: 'heading', heading: 'B' })).toBeNull();
    });

    it('describes the change so it can be put back', () => {
        const plan = moveTasks(base, [at(base, 'Faster search')], { kind: 'heading', heading: 'Export' });
        if (!plan) throw new Error('expected a plan');
        const restored = [...plan.lines];
        restored.splice(plan.change.start, plan.change.after.length, ...plan.change.before);
        expect(restored).toEqual(base);
    });

    it('says where every line went, so rows can slide to their new places', () => {
        const plan = moveTasks(base, [at(base, 'Faster search')], { kind: 'after', ...at(base, 'Readwise') });
        if (!plan) throw new Error('expected a plan');
        base.forEach((line, index) => expect(plan.lines[plan.lineMap.get(index) ?? -1]).toBe(line));
        expect(plan.lineMap.get(4)).toBe(8);
        expect(plan.lineMap.get(7)).toBe(4);
    });

    it('names the lines the moved tasks landed on', () => {
        const plan = moveTasks(base, [at(base, 'Highlight matches'), at(base, 'Faster search')], { kind: 'heading', heading: 'Export' });
        expect(plan?.landed.map(line => plan.lines[line])).toEqual(['- [ ] Faster search', '- [ ] Highlight matches']);
    });

    describe('into a new heading', () => {
        it('names the lines the moved tasks landed on', () => {
            const plan = moveTasks(base, [at(base, 'Readwise')], { kind: 'new-heading', heading: 'Now', level: 2, where: 'top' });
            expect(plan?.landed.map(line => plan.lines[line])).toEqual(['- [ ] Readwise']);
        });

        it('adds it at the bottom of the note', () => {
            const plan = moveTasks(base, [at(base, 'Readwise')], { kind: 'new-heading', heading: 'Later', level: 2, where: 'bottom' });
            expect(plan?.lines.slice(-5)).toEqual(['- [ ] Markdown export', '', '## Later', '- [ ] Readwise', '']);
        });

        it('adds it at the top as the first section, under the title', () => {
            const plan = moveTasks(base, [at(base, 'Readwise')], { kind: 'new-heading', heading: 'Now', level: 2, where: 'top' });
            expect(plan?.lines.slice(0, 7)).toEqual(['# Excerpta', '', '## Now', '- [ ] Readwise', '', '## Search', '- [ ] Index by chapter']);
        });

        it('puts a top heading after loose tasks, so it never takes them over', () => {
            const lines = note(['---', 'tags: [x]', '---', '- [ ] Loose', '- [ ] Move me'].join('\n'));
            const plan = moveTasks(lines, [at(lines, 'Move me')], { kind: 'new-heading', heading: 'Now', level: 2, where: 'top' });
            expect(plan?.lines).toEqual(['---', 'tags: [x]', '---', '- [ ] Loose', '', '## Now', '- [ ] Move me']);
        });

        it('describes the change so it can be put back', () => {
            const plan = moveTasks(base, [at(base, 'Readwise')], { kind: 'new-heading', heading: 'Now', level: 2, where: 'top' });
            if (!plan) throw new Error('expected a plan');
            const restored = [...plan.lines];
            restored.splice(plan.change.start, plan.change.after.length, ...plan.change.before);
            expect(restored).toEqual(base);
        });
    });
});

describe('noteHeadings', () => {
    it('lists headings, skipping fenced code and properties', () => {
        const lines = note(['---', '# not: a heading', '---', '# Title', '```sh', '# a comment', '```', '## Real', '### Deeper'].join('\n'));
        expect(noteHeadings(lines)).toEqual([
            { line: 3, level: 1, title: 'Title' },
            { line: 7, level: 2, title: 'Real' },
            { line: 8, level: 3, title: 'Deeper' }
        ]);
    });
});

describe('newHeadingLevel', () => {
    const lines = note(['# Excerpta', '- [ ] Under the title', '### Search', '- [ ] Filed'].join('\n'));

    it('matches the heading the task is under', () => {
        expect(newHeadingLevel(noteHeadings(lines), 'Search')).toBe(3);
    });

    it('goes one below a title, never beside it', () => {
        expect(newHeadingLevel(noteHeadings(note('# Only a title\n- [ ] Task')), 'Only a title')).toBe(2);
    });

    it('copies the note\'s first section heading for a task under no heading', () => {
        expect(newHeadingLevel(noteHeadings(lines), undefined)).toBe(3);
    });

    it('falls back to a second-level heading', () => {
        expect(newHeadingLevel(noteHeadings(note('- [ ] Task')), undefined)).toBe(2);
    });
});

describe('moveHeading', () => {
    const base = note([
        '# Excerpta',
        '- [ ] Under the title',
        '',
        '## Search',
        '- [ ] Index by chapter',
        '### Ideas',
        '- [ ] Fuzzy matching',
        '',
        '## Export',
        '- [ ] Readwise',
        'Some notes about export.',
        '',
        '## Later',
        '- [ ] Sync',
        ''
    ].join('\n'));
    const heading = (lines: string[], title: string) => ({ line: lines.findIndex(line => / /.test(line) && line.replace(/^#+ /, '') === title && line.startsWith('#')), title });

    it('puts a heading and everything under it right above another heading', () => {
        const plan = moveHeading(base, heading(base, 'Export'), { kind: 'before', ...heading(base, 'Search') });
        expect(plan?.lines).toEqual([
            '# Excerpta',
            '- [ ] Under the title',
            '',
            '## Export',
            '- [ ] Readwise',
            'Some notes about export.',
            '',
            '## Search',
            '- [ ] Index by chapter',
            '### Ideas',
            '- [ ] Fuzzy matching',
            '',
            '## Later',
            '- [ ] Sync',
            ''
        ]);
    });

    it('brings smaller headings under it along', () => {
        const plan = moveHeading(base, heading(base, 'Search'), { kind: 'before', ...heading(base, 'Later') });
        expect(plan?.lines.slice(3, 13)).toEqual([
            '## Export',
            '- [ ] Readwise',
            'Some notes about export.',
            '',
            '## Search',
            '- [ ] Index by chapter',
            '### Ideas',
            '- [ ] Fuzzy matching',
            '',
            '## Later'
        ]);
    });

    it('keeps a heading at its own level wherever it lands', () => {
        const plan = moveHeading(base, heading(base, 'Ideas'), { kind: 'before', ...heading(base, 'Later') });
        expect(plan?.lines.slice(3, 14)).toEqual([
            '## Search',
            '- [ ] Index by chapter',
            '',
            '## Export',
            '- [ ] Readwise',
            'Some notes about export.',
            '',
            '### Ideas',
            '- [ ] Fuzzy matching',
            '',
            '## Later'
        ]);
    });

    it('moves a heading to the bottom of the note', () => {
        const plan = moveHeading(base, heading(base, 'Search'), { kind: 'bottom' });
        expect(plan?.lines).toEqual([
            '# Excerpta',
            '- [ ] Under the title',
            '',
            '## Export',
            '- [ ] Readwise',
            'Some notes about export.',
            '',
            '## Later',
            '- [ ] Sync',
            '',
            '## Search',
            '- [ ] Index by chapter',
            '### Ideas',
            '- [ ] Fuzzy matching',
            ''
        ]);
    });

    it('keeps a note without blank lines between sections that way', () => {
        const lines = note(['## A', '- [ ] One', '## B', '- [ ] Two', '## C', '- [ ] Three'].join('\n'));
        expect(moveHeading(lines, heading(lines, 'C'), { kind: 'before', ...heading(lines, 'A') })?.lines)
            .toEqual(['## C', '- [ ] Three', '## A', '- [ ] One', '## B', '- [ ] Two']);
        expect(moveHeading(lines, heading(lines, 'A'), { kind: 'bottom' })?.lines)
            .toEqual(['## B', '- [ ] Two', '## C', '- [ ] Three', '## A', '- [ ] One']);
    });

    it('leaves loose tasks above the first heading where they are', () => {
        const lines = note(['---', 'tags: [x]', '---', '- [ ] Loose', '', '## A', '- [ ] One', '', '## B', '- [ ] Two'].join('\n'));
        expect(moveHeading(lines, heading(lines, 'B'), { kind: 'before', ...heading(lines, 'A') })?.lines)
            .toEqual(['---', 'tags: [x]', '---', '- [ ] Loose', '', '## B', '- [ ] Two', '', '## A', '- [ ] One']);
    });

    it('moves the first section without leaving a blank line at the top', () => {
        const lines = note(['## A', '- [ ] One', '', '## B', '- [ ] Two', ''].join('\n'));
        expect(moveHeading(lines, heading(lines, 'A'), { kind: 'bottom' })?.lines)
            .toEqual(['## B', '- [ ] Two', '', '## A', '- [ ] One', '']);
    });

    it('never moves the note\'s title, or puts anything above it', () => {
        expect(moveHeading(base, heading(base, 'Excerpta'), { kind: 'bottom' })).toBeNull();
        expect(moveHeading(base, heading(base, 'Later'), { kind: 'before', ...heading(base, 'Excerpta') })).toBeNull();
    });

    it('won\'t drop a heading inside itself', () => {
        expect(moveHeading(base, heading(base, 'Search'), { kind: 'before', ...heading(base, 'Ideas') })).toBeNull();
    });

    it('does nothing when the heading is already there', () => {
        expect(moveHeading(base, heading(base, 'Search'), { kind: 'before', ...heading(base, 'Export') })).toBeNull();
        expect(moveHeading(base, heading(base, 'Later'), { kind: 'bottom' })).toBeNull();
    });

    it('finds a heading again by its name near the line it was read from', () => {
        const shifted = ['', ...base];
        const plan = moveHeading(shifted, heading(base, 'Later'), { kind: 'before', ...heading(base, 'Search') });
        expect(plan?.lines.slice(4, 7)).toEqual(['## Later', '- [ ] Sync', '']);
        expect(moveHeading(base, { line: 8, title: 'Gone' }, { kind: 'bottom' })).toBeNull();
    });

    it('of two headings with the same name, moves the one at its line', () => {
        const lines = note(['## Day 1', '### Notes', '- [ ] First', '## Day 2', '### Notes', '- [ ] Second'].join('\n'));
        expect(moveHeading(lines, { line: 4, title: 'Notes' }, { kind: 'before', line: 1, title: 'Notes' })?.lines)
            .toEqual(['## Day 1', '### Notes', '- [ ] Second', '### Notes', '- [ ] First', '## Day 2']);
    });

    it('ignores heading marks inside code', () => {
        const lines = note(['## A', '```sh', '# a comment', '```', '## B', '- [ ] Two'].join('\n'));
        expect(moveHeading(lines, heading(lines, 'A'), { kind: 'bottom' })?.lines)
            .toEqual(['## B', '- [ ] Two', '## A', '```sh', '# a comment', '```']);
    });

    it('describes the change so it can be put back', () => {
        const plan = moveHeading(base, heading(base, 'Later'), { kind: 'before', ...heading(base, 'Search') });
        if (!plan) throw new Error('expected a plan');
        const restored = [...plan.lines];
        restored.splice(plan.change.start, plan.change.after.length, ...plan.change.before);
        expect(restored).toEqual(base);
    });

    it('says where every line went, and where the heading landed', () => {
        const plan = moveHeading(base, heading(base, 'Later'), { kind: 'before', ...heading(base, 'Search') });
        if (!plan) throw new Error('expected a plan');
        for (const [from, to] of plan.lineMap) expect(plan.lines[to]).toBe(base[from]);
        expect(plan.lineMap.get(13)).toBe(4);
        expect(plan.landed).toEqual([3]);
    });
});

describe('headingSectionEnd', () => {
    const lines = note(['# Title', '## A', '### A1', '## Hidden', '### H1', '## B'].join('\n'));

    it('ends a section at the next heading as big or bigger', () => {
        expect(headingSectionEnd(noteHeadings(lines), 1)).toBe(3);
        expect(headingSectionEnd(noteHeadings(lines), 2)).toBe(3);
    });

    it('runs to the end of the note when nothing follows', () => {
        expect(headingSectionEnd(noteHeadings(lines), 5)).toBe(Infinity);
    });
});

describe('addUnderNewHeading', () => {
    const base = note(['# Excerpta', '', '## Search', '- [ ] Index by chapter', ''].join('\n'));

    it('adds a heading with the new tasks at the bottom of the note', () => {
        const result = addUnderNewHeading(base, 'Ideas', 2, 'bottom', ['- [ ] One', '- [ ] Two']);
        expect(result.lines).toEqual(['# Excerpta', '', '## Search', '- [ ] Index by chapter', '', '## Ideas', '- [ ] One', '- [ ] Two', '']);
        expect(result.first).toBe(6);
    });

    it('adds it at the top as the first section, under the title', () => {
        const result = addUnderNewHeading(base, 'Ideas', 2, 'top', ['- [ ] One']);
        expect(result.lines).toEqual(['# Excerpta', '', '## Ideas', '- [ ] One', '', '## Search', '- [ ] Index by chapter', '']);
        expect(result.first).toBe(3);
    });

    it('starts an empty note with the heading', () => {
        const result = addUnderNewHeading([], 'Ideas', 2, 'top', ['- [ ] One']);
        expect(result.lines).toEqual(['## Ideas', '- [ ] One']);
        expect(result.first).toBe(1);
    });

    it('adds under the heading when the note already has one by that name', () => {
        const result = addUnderNewHeading(base, 'search', 2, 'bottom', ['- [ ] One']);
        expect(result.lines).toEqual(['# Excerpta', '', '## Search', '- [ ] One', '- [ ] Index by chapter', '']);
        expect(result.first).toBe(3);
    });

    it('says which run of lines it added, so the add can be undone', () => {
        const result = addUnderNewHeading(base, 'Ideas', 2, 'top', ['- [ ] One']);
        const restored = [...result.lines];
        restored.splice(result.at, result.added.length);
        expect(restored).toEqual(base);
        expect(result.added).toContain('## Ideas');
    });
});
