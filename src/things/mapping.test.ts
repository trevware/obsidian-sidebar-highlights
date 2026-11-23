import type { Task } from '../../main';
import { parseTaskLine } from '../tasks-view/task-line';
import { readTimeAfter } from '../tasks-view/times';
import { areaName, checklistLines, escapeTitle, fieldsFromTask, folderFor, lineTag, lineTagsIn, looseNoteName, noteName, relink, resolveTags, statusFromTags, thingsTag, unescapeTitle } from './mapping';

/** Builds a Task from the line at `index`, the way TaskManager.tasksInContent would. */
function taskAt(lines: string[], index = 0): Task {
    const parsed = parseTaskLine(lines[index])!;
    const match = parsed.text.match(/\d{4}-\d{2}-\d{2}/);
    const time = match ? readTimeAfter(parsed.text, match.index! + match[0].length) : undefined;
    const priority = /^!([123])$/.exec(parsed.state);
    const status = parsed.state.toLowerCase() === 'x' ? 'done' : parsed.state === '/' ? 'in-progress' : parsed.state === '-' ? 'cancelled' : parsed.state === '?' ? 'question' : 'todo';
    return {
        id: `n.md:${index}`, text: parsed.text, completed: status === 'done', status, flagged: false,
        priority: priority ? (Number(priority[1]) as 1 | 2 | 3) : undefined,
        filePath: 'n.md', lineNumber: index, context: [], indentLevel: 0,
        date: match?.[0], dateText: match ? parsed.text.slice(match.index, time ? time.end : match.index! + 10) : undefined,
        time: time?.time, timeText: time?.text, marker: parsed.state
    } as Task;
}

const opts = { hideMetadata: false };
const fields = (line: string, o: { hideMetadata: boolean; impliedWhen?: string } = opts) => fieldsFromTask(taskAt([line]), [line], o);

describe('fieldsFromTask', () => {
    it('turns status and priority into tags, next to the line\'s own', () => {
        expect(fields('- [/] Draft plan #work 2026-11-23 15:00').tags).toEqual(['In Progress', 'work']);
        expect(fields('- [!1] Ship it').tags).toEqual(['Priority 1']);
        expect(fields('- [?] Does it scale').tags).toEqual(['Question']);
    });

    it('reads the date and time, and the status', () => {
        expect(fields('- [ ] Pay rent 2026-12-01 15:00')).toMatchObject({ title: 'Pay rent', when: '2026-12-01', reminder: '15:00', status: 'open', someday: false });
        expect(fields('- [x] Done thing').status).toBe('completed');
        expect(fields('- [-] Old idea').status).toBe('canceled');
    });

    it('treats #someday as Someday, not as a tag', () => {
        expect(fields('- [ ] Read book #someday')).toMatchObject({ title: 'Read book', someday: true, tags: [] });
    });

    it('sorts tags, drops repeats and writes them the Things way', () => {
        expect(fields('- [ ] Plan #home #Deep-Work #home').tags).toEqual(['Deep Work', 'home']);
    });

    it('keeps the tag words as the title when a line is only tags', () => {
        expect(fields('- [ ] #work #home')).toMatchObject({ title: 'work home', tags: ['home', 'work'] });
        const lines = ['- [ ] Trip', '\t- [ ] #errand'];
        expect(fieldsFromTask(taskAt(lines), lines, opts).checklist).toEqual([{ title: 'errand', done: false }]);
    });

    it('leaves a status or priority look-alike in the title, not in the tags', () => {
        expect(fields('- [ ] Fix #Question')).toMatchObject({ title: 'Fix #Question', tags: [] });
        expect(fields('- [ ] Ship #priority-1 #In-Progress #home')).toMatchObject({ title: 'Ship #priority-1 #In-Progress', tags: ['home'] });
        expect(fields('- [?] Fix #Question').tags).toEqual(['Question']);
    });

    it('gives an undated task in a daily note its note\'s day', () => {
        expect(fields('- [ ] Water plants', { hideMetadata: false, impliedWhen: '2026-11-22' }).when).toBe('2026-11-22');
        expect(fields('- [ ] Water plants 2026-11-25', { hideMetadata: false, impliedWhen: '2026-11-22' }).when).toBe('2026-11-25');
    });

    it('takes notes from the lines under the task and a checklist from its child checkboxes', () => {
        const lines = ['- [ ] Trip', '\tPack light', '\t- [x] Book train', '\t- [ ] Book hotel'];
        expect(fieldsFromTask(taskAt(lines), lines, opts)).toMatchObject({
            notes: 'Pack light',
            checklist: [{ title: 'Book train', done: true }, { title: 'Book hotel', done: false }]
        });
    });

    it('flattens deeper checkboxes into the checklist in line order and ignores later siblings', () => {
        const lines = ['- [ ] Trip', '\t- [ ] Book', '\t\t- [x] Train', '\t- [ ] Pack', '- [ ] Next task'];
        expect(fieldsFromTask(taskAt(lines), lines, opts).checklist).toEqual([
            { title: 'Book', done: false }, { title: 'Train', done: true }, { title: 'Pack', done: false }
        ]);
    });

    it('keeps titles that would break Markdown or URLs readable and on one line', () => {
        expect(fields('- [ ] Fix #1 & 50% of [[A|b]] 🎉').title).toBe('Fix #1 & 50% of b 🎉');
        expect(fields('- [ ] See [[Sarah Chen]] %%things:abcdefgh12%%').title).toBe('See Sarah Chen');
    });
});

describe('callout notes', () => {
    it('reads a callout task\'s notes without the callout prefix', () => {
        const lines = ['> - [ ] Trip', '> \tPack light', '>', '> \tBring snacks', '> \t- [ ] Book train'];
        expect(fieldsFromTask(taskAt(lines), lines, opts)).toMatchObject({ notes: 'Pack light\n\nBring snacks', checklist: [{ title: 'Book train', done: false }] });
    });
});

describe('checklistLines', () => {
    it('gives each checklist item with its line, after the task\'s notes', () => {
        const lines = ['- [ ] Trip', '\tPack light', '\t- [x] Book train', '\t\t- [ ] Seat', '- [ ] Next'];
        expect(checklistLines(lines, 0)).toEqual([
            { line: 2, item: { title: 'Book train', done: true } },
            { line: 3, item: { title: 'Seat', done: false } }
        ]);
        expect(checklistLines(lines, 4)).toEqual([]);
    });
});

describe('status and tags', () => {
    it('reads the checkbox a to-do\'s tags imply and leaves the rest', () => {
        expect(statusFromTags(['Question', 'home'])).toEqual({ state: '?', tags: ['home'] });
        expect(statusFromTags(['In Progress'])).toEqual({ state: '/', tags: [] });
        expect(statusFromTags(['Priority 2', 'x'])).toEqual({ state: '!2', tags: ['x'] });
        expect(statusFromTags(['home'])).toEqual({ state: ' ', tags: ['home'] });
    });

    it('finds no tags inside comments or links', () => {
        expect(lineTagsIn('Call #home %%see #foo%% [[A#b]] [[A|c #d]] [x](https://x.com/a #e)').map(tag => tag.name)).toEqual(['home']);
    });

    it('finds a line\'s tags, marking the ones that read as status or priority', () => {
        expect(lineTagsIn('Ask #Question about #deep-work, not #1')).toEqual([
            { start: 4, end: 13, name: 'Question', reserved: true },
            { start: 20, end: 30, name: 'deep-work', reserved: false }
        ]);
    });

    it('swaps spaces and hyphens in tags', () => {
        expect(lineTag('Deep Work')).toBe('Deep-Work');
        expect(thingsTag('Deep-Work')).toBe('Deep Work');
    });
});

describe('areas and notes', () => {
    it('maps folders to area names and back', () => {
        expect(areaName('Home/Errands')).toBe('Home/Errands');
        expect(areaName('')).toBe('');
        expect(folderFor('Home/Errands')).toBe('Home/Errands');
        expect(folderFor('Work: Q3?')).toBe('Work Q3');
    });

    it('names notes, numbering a clash', () => {
        expect(noteName('Plan: v2', p => p === 'Work/Plan v2.md', 'Work')).toBe('Work/Plan v2 2.md');
        expect(noteName('Plan: v2', () => false, '')).toBe('Plan v2.md');
        expect(noteName('Plan', p => p === 'Plan.md' || p === 'Plan 2.md', '')).toBe('Plan 3.md');
    });

    it('names an area\'s loose note after its last segment', () => {
        expect(looseNoteName('Home/Errands')).toBe('Errands');
    });
});

describe('relink', () => {
    it('re-wraps links whose words are still in the new title', () => {
        expect(relink('Ask Sarah Chen about Q3', 'Ask [[Sarah Chen]] about launch')).toBe('Ask [[Sarah Chen]] about Q3');
        expect(relink('Ask Sarah about Q3', 'Ask [[Sarah Chen|Sarah]] about launch')).toBe('Ask [[Sarah Chen|Sarah]] about Q3');
    });

    it('drops a link whose words are gone and leaves existing links alone', () => {
        expect(relink('Ask Bob', 'Ask [[Sarah Chen]]')).toBe('Ask Bob');
        expect(relink('Ask [[Sarah Chen]]', 'Ask [[Sarah Chen]]')).toBe('Ask [[Sarah Chen]]');
    });

    it('re-wraps Markdown links whose label is still in the new title, and nothing else', () => {
        expect(relink('Read the docs and fix it today', 'Read [the docs](https://example.com/a) and **fix** it')).toBe('Read [the docs](https://example.com/a) and fix it today');
        expect(relink('Skim the notes', 'Read [the docs](https://example.com/a)')).toBe('Skim the notes');
        expect(relink('Read [the docs](https://example.com/a)', 'Read [the docs](https://example.com/a)')).toBe('Read [the docs](https://example.com/a)');
        expect(relink('See docs and [[Docs]]', 'See [docs](https://x.com) and [[Docs]]')).toBe('See [docs](https://x.com) and [[Docs]]');
    });
});

describe('Things titles and tags kept whole on the way through a line', () => {
    const nasty = 'Email #design team about [[Q4]] and [the deck](https://x.co) 50% & more by 2026-11-30, **bold** ==mark== `code` %%note%% ~~old~~';

    it('escapes a Things title so a line reads it back unchanged', () => {
        const escaped = escapeTitle(nasty);
        expect(escaped).not.toContain(' #design');
        expect(unescapeTitle(escaped)).toBe(nasty);
        const text = `- [ ] ${escaped}`;
        const read = fieldsFromTask(taskAt([text]), [text], { hideMetadata: true });
        expect(read.title).toBe(nasty);
        expect(read.tags).toEqual([]);
        expect(read.when).toBeUndefined();
    });

    it('writes a Things tag as a tag a line can hold', () => {
        expect(lineTag('@home')).toBe('home');
        expect(lineTag('Q&A')).toBe('QA');
        expect(lineTag('follow-up')).toBe('follow-up');
        expect(lineTag('Deep Work')).toBe('Deep-Work');
    });

    it('reads a line\'s tags back as the Things tags they came from', () => {
        const known = ['@home', 'Q&A', 'follow-up', 'Deep Work'];
        expect(resolveTags(['home', 'QA', 'follow up', 'Deep Work', 'new one'], known)).toEqual(['@home', 'Deep Work', 'Q&A', 'follow-up', 'new one']);
    });
});
