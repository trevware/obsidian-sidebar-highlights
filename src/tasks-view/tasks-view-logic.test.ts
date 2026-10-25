import { addDays, addMonths, daysBetween, rowDateLabel, startOfWeek, weekday } from './dates';
import { buildTaskLine, contextRange, insertionLine, locateTaskLine, notesLines, notesText, setDateInText, taskBlockEnd, withState } from './task-line';
import { parseDateQuery, parseQuickAdd } from './quick-parse';
import { buildGroups, completedLast, DEFAULT_DISPLAY, listCounts, railAreas, tasksForList, upcomingBucket } from './task-views';
import type { GroupLabels, NoteInfo } from './task-views';
import type { Task } from '../../main';

// 2026-10-25 is a Sunday.
const TODAY = '2026-10-25';

const words = { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday' };

const labels: GroupLabels = {
    overdue: 'Overdue',
    today: 'Today',
    tomorrow: 'Tomorrow',
    noDate: 'No date',
    noPriority: 'No priority',
    priority: level => `Priority ${level}`,
    weekOf: date => `Week of ${date}`
};

const notes: NoteInfo = {
    basename: path => path.split('/').pop()!.replace(/\.md$/, ''),
    folder: path => path.split('/').slice(0, -1).join('/'),
    mtime: path => (path.includes('recent') ? 2 : 1)
};

function task(overrides: Partial<Task>): Task {
    return {
        id: 'x',
        text: 'Task',
        completed: false,
        status: 'todo',
        flagged: false,
        filePath: 'Work/Note.md',
        lineNumber: 0,
        context: [],
        indentLevel: 0,
        ...overrides
    };
}

describe('dates', () => {
    it('does day arithmetic across month and year ends', () => {
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(daysBetween('2026-10-25', '2026-11-01')).toBe(7);
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    });

    it('knows the weekday and the Monday that starts its week', () => {
        expect(weekday(TODAY)).toBe(0);
        expect(startOfWeek(TODAY)).toBe('2026-10-19');
        expect(startOfWeek('2026-10-26')).toBe('2026-10-26');
    });

    it('labels dates with neutral words and a tone', () => {
        expect(rowDateLabel(TODAY, TODAY, words, 'en-GB')).toEqual({ text: 'Today', tone: 'today' });
        expect(rowDateLabel('2026-10-26', TODAY, words, 'en-GB')).toEqual({ text: 'Tomorrow', tone: 'soon' });
        expect(rowDateLabel('2026-10-24', TODAY, words, 'en-GB')).toEqual({ text: 'Yesterday', tone: 'overdue' });
        expect(rowDateLabel('2026-10-28', TODAY, words, 'en-GB')).toEqual({ text: 'Wednesday', tone: 'soon' });
        expect(rowDateLabel('2026-11-03', TODAY, words, 'en-GB')).toEqual({ text: '3 Nov', tone: 'later' });
        expect(rowDateLabel('2027-01-03', TODAY, words, 'en-GB').text).toBe('3 Jan 2027');
        expect(rowDateLabel('2026-10-01', TODAY, words, 'en-GB')).toEqual({ text: '1 Oct', tone: 'overdue' });
    });
});

describe('task-line', () => {
    it('swaps the checkbox state and keeps callout prefix and indent', () => {
        expect(withState('> \t- [ ] Ship it', 'x')).toBe('> \t- [x] Ship it');
        expect(withState('- [!1] Ship it', '/')).toBe('- [/] Ship it');
        expect(withState('Not a task', 'x')).toBeNull();
    });

    it('replaces an existing date where it stands', () => {
        expect(setDateInText('2026-10-20 Call Sam', '2026-10-20', '2026-10-27')).toBe('2026-10-27 Call Sam');
        expect(setDateInText('Call Sam 2026-10-20 today', '2026-10-20', null)).toBe('Call Sam today');
    });

    it('adds a new date at the end, before a trailing sync marker', () => {
        expect(setDateInText('Call Sam', undefined, '2026-10-27')).toBe('Call Sam 2026-10-27');
        expect(setDateInText('Call Sam #followup [↗](https://app.todoist.com/app/task/abc)', undefined, '2026-10-27'))
            .toBe('Call Sam #followup 2026-10-27 [↗](https://app.todoist.com/app/task/abc)');
        // A link with words in its label is the task's own text.
        expect(setDateInText('Read [the post](https://x.y)', undefined, '2026-10-27')).toBe('Read [the post](https://x.y) 2026-10-27');
    });

    it('finds a task again after the note shifted', () => {
        const lines = ['# Head', '- [ ] Other', '', '- [ ] Call Sam'];
        expect(locateTaskLine(lines, 3, 'Call Sam')).toBe(3);
        expect(locateTaskLine(lines, 1, 'Call Sam')).toBe(3);
        expect(locateTaskLine(lines, 1, 'Gone')).toBe(-1);
    });

    it('builds the line quick add writes', () => {
        expect(buildTaskLine({ text: 'Call the dentist', priority: 1, date: '2026-10-27' })).toBe('- [!1] Call the dentist 2026-10-27');
        expect(buildTaskLine({ text: ' Plain ' })).toBe('- [ ] Plain');
    });

    it('takes a task with its notes and subtasks, and leaves what follows', () => {
        const lines = ['- [ ] Parent', '    - a note', '', '    - [ ] Child', '        - child note', '- [ ] Next', '', 'Text'];
        expect(taskBlockEnd(lines, 0)).toBe(5);
        expect(taskBlockEnd(lines, 3)).toBe(5);
        expect(taskBlockEnd(lines, 5)).toBe(6);
        expect(taskBlockEnd(['> - [ ] In a callout', '>     - its note', '> - [ ] Next'], 0)).toBe(2);
    });

    it('finds a task\'s notes, stopping at its first subtask', () => {
        const lines = ['- [ ] Parent', '    - note one', '', '    more', '    - [ ] Child', '    - after child', '- [ ] Next'];
        expect(contextRange(lines, 0)).toEqual([1, 4]);
        expect(contextRange(lines, 6)).toEqual([7, 7]);
    });

    it('turns notes into Markdown and back, one step deeper than the task', () => {
        expect(notesText(['    - note one', '        - nested', '    plain'])).toBe('- note one\n    - nested\nplain');
        const lines = ['- [ ] Parent', '- [ ] Next'];
        expect(notesLines(lines, 0, '- first\n  - second\n\n')).toEqual(['    - first', '      - second']);
        expect(notesLines(['\t- [ ] Tabbed'], 0, 'hi')).toEqual(['\t\thi']);
        expect(notesLines(['> - [ ] In a callout'], 0, 'note')).toEqual(['>     note']);
        expect(notesLines(['- [ ] Parent', '  - two-space note'], 0, 'a\nb')).toEqual(['  a', '  b']);
        expect(notesLines(lines, 0, '   ')).toEqual([]);
    });

    it('inserts at the top of a heading\'s tasks', () => {
        const lines = ['## A', 'Intro', '- [x] done', '- [ ] open', '', '## B'];
        expect(insertionLine(lines, 'A')).toBe(2);
    });

    it('stays above a heading\'s subheadings', () => {
        const lines = ['# A', '- [ ] one', '', '## B', '- [ ] two', '', '# C', 'text'];
        expect(insertionLine(lines, 'A')).toBe(1);
        expect(insertionLine(lines, 'B')).toBe(4);
        expect(insertionLine(['## A', '', '### Sub', '- [ ] x'], 'A')).toBe(1);
    });

    it('joins the notes under a heading that has no tasks yet, above blank lines', () => {
        expect(insertionLine(['## 2026-10-25', '- Talked it through', '', '## Older'], '2026-10-25')).toBe(2);
        expect(insertionLine(['## A', '- Topic', '    - [ ] nested', '## B'], 'A')).toBe(3);
        expect(insertionLine(['# A', '- [ ] one', '', '# C', 'text'], 'C')).toBe(5);
    });

    it('inserts at the end of the note without a heading', () => {
        expect(insertionLine(['# A', '- [ ] one', '', '## B', 'text'])).toBe(5);
        expect(insertionLine(['- [ ] a', '', ''])).toBe(1);
        expect(insertionLine(['## A', '- [ ] a'], 'Missing')).toBe(2);
    });
});

describe('quick-parse', () => {
    it('reads a weekday and a priority, and leaves the title clean', () => {
        const parsed = parseQuickAdd('Call the dentist fri p1', TODAY);
        expect(parsed).toMatchObject({ title: 'Call the dentist', date: '2026-10-30', priority: 1 });
        expect(parsed.tokens.map(token => token.text)).toEqual(['fri', 'p1']);
    });

    it('prefers the longer phrase and the last date', () => {
        expect(parseQuickAdd('Plan next fri', TODAY).date).toBe('2026-10-30');
        expect(parseQuickAdd('Plan next mon', TODAY).date).toBe('2026-10-26');
        expect(parseQuickAdd('Move today to tomorrow', TODAY)).toMatchObject({ date: '2026-10-26', title: 'Move today to' });
    });

    it('reads relative and calendar dates', () => {
        expect(parseQuickAdd('x in 3 days', TODAY).date).toBe('2026-10-28');
        expect(parseQuickAdd('x in 2w', TODAY).date).toBe('2026-11-08');
        expect(parseQuickAdd('x nov 3', TODAY).date).toBe('2026-11-03');
        expect(parseQuickAdd('x 3 March', TODAY).date).toBe('2027-03-03');
        expect(parseQuickAdd('x 2026-12-01', TODAY).date).toBe('2026-12-01');
        expect(parseQuickAdd('x next week', TODAY).date).toBe('2026-10-26');
    });

    it('never reads a date out of the middle of a word', () => {
        expect(parseQuickAdd('Buy tomatoes', TODAY).date).toBeUndefined();
        expect(parseQuickAdd('Email Friedrich', TODAY).date).toBeUndefined();
        expect(parseQuickAdd('Fix p10 bug', TODAY).priority).toBeUndefined();
    });

    it('leaves a phrase alone once it has been turned back into text', () => {
        const parsed = parseQuickAdd('Watch Friday Night Lights', TODAY, new Set(['friday']));
        expect(parsed.date).toBeUndefined();
        expect(parsed.title).toBe('Watch Friday Night Lights');
    });

    it('matches the picker query by its first letters', () => {
        expect(parseDateQuery('we', TODAY)).toBe('2026-10-28');
        expect(parseDateQuery('tom', TODAY)).toBe('2026-10-26');
        expect(parseDateQuery('next th', TODAY)).toBe('2026-10-29');
        expect(parseDateQuery('3', TODAY)).toBe('2026-10-28');
        expect(parseDateQuery('dec 24', TODAY)).toBe('2026-12-24');
        expect(parseDateQuery('banana', TODAY)).toBeUndefined();
    });
});

describe('task-views', () => {
    const tasks = [
        task({ text: 'Overdue', date: '2026-10-20', lineNumber: 1 }),
        task({ text: 'Due today', date: TODAY, lineNumber: 2, section: 'Plans' }),
        task({ text: 'Tomorrow', date: '2026-10-26', lineNumber: 3, filePath: 'Work/recent.md' }),
        task({ text: 'Later', date: '2026-12-02', lineNumber: 4 }),
        task({ text: 'Undated', lineNumber: 5, status: 'in-progress' }),
        task({ text: 'Done', lineNumber: 6, status: 'done', completed: true }),
        task({ text: 'Question', lineNumber: 7, status: 'question', filePath: 'Inbox.md' })
    ];

    it('puts each task in the right lists', () => {
        const texts = (id: Parameters<typeof tasksForList>[1]) =>
            tasksForList(tasks, id, TODAY, DEFAULT_DISPLAY).map(t => t.text);
        expect(texts({ kind: 'smart', id: 'today' })).toEqual(['Overdue', 'Due today']);
        expect(texts({ kind: 'smart', id: 'upcoming' })).toEqual(['Tomorrow', 'Later']);
        expect(texts({ kind: 'smart', id: 'in-progress' })).toEqual(['Undated']);
        expect(texts({ kind: 'smart', id: 'logbook' })).toEqual(['Done']);
        expect(texts({ kind: 'smart', id: 'anytime' })).not.toContain('Done');
    });

    it('keeps a just-completed task in place while it lingers', () => {
        const list = tasksForList(tasks, { kind: 'smart', id: 'anytime' }, TODAY, DEFAULT_DISPLAY, new Set(['Work/Note.md:6']));
        expect(list.map(t => t.text)).toContain('Done');
    });

    it('counts open tasks per list', () => {
        expect(listCounts(tasks, TODAY)).toEqual({ today: 2, overdue: 1, upcoming: 2, anytime: 6, inProgress: 1, questions: 1 });
    });

    it('groups Today as Overdue first, then Today', () => {
        const list = tasksForList(tasks, { kind: 'smart', id: 'today' }, TODAY, DEFAULT_DISPLAY);
        const groups = buildGroups(list, { kind: 'smart', id: 'today' }, TODAY, DEFAULT_DISPLAY, labels, notes, 'en-GB');
        expect(groups.map(g => [g.title, g.count])).toEqual([['Overdue', 1], ['Today', 1]]);
    });

    it('groups Upcoming by day, then week, then month', () => {
        expect(upcomingBucket('2026-10-26', TODAY, labels, 'en-GB').title).toBe('Tomorrow');
        expect(upcomingBucket('2026-10-28', TODAY, labels, 'en-GB').title).toBe('Wednesday');
        expect(upcomingBucket('2026-11-04', TODAY, labels, 'en-GB').title).toBe('Week of 2 Nov');
        expect(upcomingBucket('2026-12-02', TODAY, labels, 'en-GB').title).toBe('December');
        expect(upcomingBucket('2027-02-02', TODAY, labels, 'en-GB').title).toBe('February 2027');
    });

    it('groups by note with the most recently edited note first, split by heading', () => {
        const list = tasksForList(tasks, { kind: 'smart', id: 'anytime' }, TODAY, DEFAULT_DISPLAY);
        const groups = buildGroups(list, { kind: 'smart', id: 'anytime' }, TODAY, DEFAULT_DISPLAY, labels, notes);
        expect(groups[0].title).toBe('recent');
        const note = groups.find(g => g.title === 'Note')!;
        expect(note.sections.map(s => s.title)).toEqual(['', 'Plans']);
    });

    it('turns a note into a list of its headings', () => {
        const ref = { kind: 'note' as const, path: 'Work/Note.md' };
        const list = tasksForList(tasks, ref, TODAY, DEFAULT_DISPLAY);
        const groups = buildGroups(list, ref, TODAY, DEFAULT_DISPLAY, labels, notes);
        expect(groups.map(g => [g.kind, g.title])).toEqual([['heading', ''], ['heading', 'Plans']]);
        expect(groups[1].add).toEqual({ path: 'Work/Note.md', heading: 'Plans' });
    });

    it('lists finished tasks after open ones, moving whole families', () => {
        const family = [
            task({ text: 'A done', status: 'done', lineNumber: 1 }),
            task({ text: 'A child', lineNumber: 2, indentLevel: 1 }),
            task({ text: 'B open', lineNumber: 3 }),
            task({ text: 'B done child', status: 'done', lineNumber: 4, indentLevel: 1 }),
            task({ text: 'C open', lineNumber: 5 })
        ];
        expect(completedLast(family, t => t.status === 'done' && t.indentLevel >= 0).map(t => t.text))
            .toEqual(['B open', 'B done child', 'C open', 'A done', 'A child']);
    });

    it('sorts completed last in a note by default, but holds a lingering task in place', () => {
        const ref = { kind: 'note' as const, path: 'Work/Note.md' };
        const display = { ...DEFAULT_DISPLAY, showCompleted: true };
        const list = [
            task({ text: 'First', lineNumber: 1 }),
            task({ text: 'Ticked', lineNumber: 2, status: 'done', completed: true }),
            task({ text: 'Third', lineNumber: 3 })
        ];
        const order = (opts: typeof display, lingering: Set<string>) =>
            buildGroups(list, ref, TODAY, opts, labels, notes, undefined, lingering).flatMap(g => g.sections.flatMap(s => s.tasks.map(t => t.text)));
        expect(order(display, new Set())).toEqual(['First', 'Third', 'Ticked']);
        expect(order(display, new Set(['Work/Note.md:2']))).toEqual(['First', 'Ticked', 'Third']);
        expect(order({ ...display, completedLast: false }, new Set())).toEqual(['First', 'Ticked', 'Third']);
    });

    it('collects notes with open tasks under their folders', () => {
        expect(railAreas(tasks, notes)).toEqual([
            { folder: '', notes: [{ path: 'Inbox.md', name: 'Inbox', open: 1 }] },
            { folder: 'Work', notes: [{ path: 'Work/Note.md', name: 'Note', open: 4 }, { path: 'Work/recent.md', name: 'recent', open: 1 }] }
        ]);
    });
});
