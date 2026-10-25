import { moveTasks, newHeadingLevel, noteHeadings } from './task-move';
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
