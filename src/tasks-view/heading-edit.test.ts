import { deleteSection, levelChoices, linkSafeHeading, removeHeading, renameHeading, retargetLink, setHeadingLevel } from './heading-edit';
import { noteHeadings } from './task-move';
import type { HeadingRef } from './task-move';

const note = (...lines: string[]) => lines;
const ref = (lines: string[], title: string): HeadingRef => ({ line: noteHeadings(lines).find(heading => heading.title === title)?.line ?? -1, title });

const base = note(
    '# Excerpta',
    '',
    '## Search',
    '- [ ] Index by chapter',
    '- [ ] Faster search',
    '',
    '### Later',
    '- [ ] Fuzzy matching',
    '',
    '## Export',
    '- [ ] Readwise',
    ''
);

describe('renameHeading', () => {
    it('changes the words and keeps the level', () => {
        const plan = renameHeading(base, ref(base, 'Search'), 'Finding things');
        expect(plan?.lines[2]).toBe('## Finding things');
        expect(plan?.change).toEqual({ start: 2, before: ['## Search'], after: ['## Finding things'] });
    });

    it('trims and squeezes the new name', () => {
        expect(renameHeading(base, ref(base, 'Export'), '  Send   out ')?.lines[9]).toBe('## Send out');
    });

    it('does nothing for the same name, an empty one, or a heading that is gone', () => {
        expect(renameHeading(base, ref(base, 'Search'), 'Search')).toBeNull();
        expect(renameHeading(base, ref(base, 'Search'), '   ')).toBeNull();
        expect(renameHeading(base, { line: 2, title: 'Nope' }, 'New')).toBeNull();
    });

    it('picks the heading nearest the line when two share a name', () => {
        const lines = note('## Notes', '- [ ] a', '## Notes', '- [ ] b');
        const plan = renameHeading(lines, { line: 2, title: 'Notes' }, 'More notes');
        expect(plan?.lines).toEqual(['## Notes', '- [ ] a', '## More notes', '- [ ] b']);
    });

    it('leaves headings inside code alone', () => {
        const lines = note('```', '## Search', '```', '## Search');
        expect(renameHeading(lines, { line: 1, title: 'Search' }, 'Found')?.lines).toEqual(['```', '## Search', '```', '## Found']);
    });
});

describe('levelChoices', () => {
    it('offers every level that keeps the smaller headings within six', () => {
        const lines = note('## A', '### B', '#### C', '## D');
        expect(levelChoices(noteHeadings(lines), { line: 0, title: 'A' })).toEqual([1, 2, 3, 4]);
        expect(levelChoices(noteHeadings(lines), { line: 3, title: 'D' })).toEqual([1, 2, 3, 4, 5, 6]);
    });
});

describe('setHeadingLevel', () => {
    it('moves the heading and the smaller headings under it by the same step', () => {
        const plan = setHeadingLevel(base, ref(base, 'Search'), 3);
        expect(plan?.lines.slice(2, 7)).toEqual(['### Search', '- [ ] Index by chapter', '- [ ] Faster search', '', '#### Later']);
        expect(plan?.lines[9]).toBe('## Export');
    });

    it('promotes too', () => {
        const plan = setHeadingLevel(base, ref(base, 'Later'), 2);
        expect(plan?.lines[6]).toBe('## Later');
    });

    it('does nothing at the same level or one that would push a smaller heading past six', () => {
        expect(setHeadingLevel(base, ref(base, 'Search'), 2)).toBeNull();
        const lines = note('## A', '###### B');
        expect(setHeadingLevel(lines, { line: 0, title: 'A' }, 3)).toBeNull();
    });
});

describe('removeHeading', () => {
    it('takes out the heading line so its tasks join the list above', () => {
        const plan = removeHeading(base, ref(base, 'Later'));
        expect(plan?.lines.slice(2, 8)).toEqual([
            '## Search',
            '- [ ] Index by chapter',
            '- [ ] Faster search',
            '- [ ] Fuzzy matching',
            '',
            '## Export'
        ]);
    });

    it('keeps a blank line between paragraphs so they stay apart', () => {
        const lines = note('Some words.', '', '## Aside', 'More words.');
        expect(removeHeading(lines, ref(lines, 'Aside'))?.lines).toEqual(['Some words.', '', 'More words.']);
    });

    it('closes the gap an empty section leaves', () => {
        const lines = note('- [ ] a', '', '## Empty', '', '## Next', '- [ ] b');
        expect(removeHeading(lines, ref(lines, 'Empty'))?.lines).toEqual(['- [ ] a', '', '## Next', '- [ ] b']);
    });

    it('drops the blank line under a heading at the top of the note', () => {
        const lines = note('---', 'tags: [x]', '---', '## Top', '', 'Words.');
        expect(removeHeading(lines, ref(lines, 'Top'))?.lines).toEqual(['---', 'tags: [x]', '---', 'Words.']);
    });

    it('returns the run it changed, for undo', () => {
        const plan = removeHeading(base, ref(base, 'Later'));
        expect(plan?.change).toEqual({ start: 5, before: ['', '### Later'], after: [] });
    });
});

describe('deleteSection', () => {
    it('takes out the heading with everything under it, smaller headings included', () => {
        const plan = deleteSection(base, ref(base, 'Search'));
        expect(plan?.lines).toEqual(['# Excerpta', '', '## Export', '- [ ] Readwise', '']);
    });

    it('works on the last section and keeps the note ending as it did', () => {
        expect(deleteSection(base, ref(base, 'Export'))?.lines).toEqual(base.slice(0, 8).concat(''));
        const bare = note('## A', '- [ ] a', '', '## B', '- [ ] b');
        expect(deleteSection(bare, ref(bare, 'B'))?.lines).toEqual(['## A', '- [ ] a']);
    });

    it('takes the blank lines after a section at the top of the note', () => {
        const lines = note('## A', '- [ ] a', '', '## B');
        expect(deleteSection(lines, ref(lines, 'A'))?.lines).toEqual(['## B']);
    });

    it('returns null for a heading that is gone', () => {
        expect(deleteSection(base, { line: 0, title: 'Nope' })).toBeNull();
    });
});

describe('retargetLink', () => {
    it('points a wikilink at the new heading, keeping its alias', () => {
        expect(retargetLink('[[Excerpta#Search]]', 'Finding things')).toBe('[[Excerpta#Finding things]]');
        expect(retargetLink('[[Excerpta#Search|the search bit]]', 'Find')).toBe('[[Excerpta#Find|the search bit]]');
        expect(retargetLink('![[Excerpta#Search]]', 'Find')).toBe('![[Excerpta#Find]]');
    });

    it('handles links within the note and nested heading paths', () => {
        expect(retargetLink('[[#Search]]', 'Find')).toBe('[[#Find]]');
        expect(retargetLink('[[Excerpta#Export#Search]]', 'Find')).toBe('[[Excerpta#Export#Find]]');
    });

    it('encodes Markdown links the way Obsidian writes them', () => {
        expect(retargetLink('[search](Excerpta.md#Search)', 'Find things (soon)')).toBe('[search](Excerpta.md#Find%20things%20%28soon%29)');
        expect(retargetLink('[s](<Excerpta.md#Old one>)', 'New one')).toBe('[s](<Excerpta.md#New one>)');
        expect(retargetLink('[s](Excerpta.md#Old "title")', 'New')).toBe('[s](Excerpta.md#New "title")');
    });

    it('returns null for a link with no heading', () => {
        expect(retargetLink('[[Excerpta]]', 'Find')).toBeNull();
        expect(retargetLink('[x](Excerpta.md)', 'Find')).toBeNull();
    });
});

describe('linkSafeHeading', () => {
    it('turns the characters that break a link into spaces', () => {
        expect(linkSafeHeading('foo:#|^\\\r\n%%[[]]bar')).toBe('foo bar');
        expect(linkSafeHeading('Q3: plans')).toBe('Q3 plans');
        expect(linkSafeHeading('Plain words (draft)')).toBe('Plain words (draft)');
    });
});
