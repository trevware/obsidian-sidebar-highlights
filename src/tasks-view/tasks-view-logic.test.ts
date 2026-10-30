import { addDays, addMonths, daysBetween, dueLabel, rowDateLabel, startOfWeek, weekday } from './dates';
import { buildTaskLine, contextRange, dateTimeText, editableTitle, insertionLine, locateTaskLine, notesLines, notesText, setDateInText, setDueInText, subtaskLines, taskBlockEnd, withState, withTitle } from './task-line';
import { titleCase } from './capitalize';
import { parseDateQuery, parseDateTimeQuery, parseQuickAdd } from './quick-parse';
import { buildGroups, completedLast, DEFAULT_DISPLAY, followNote, listCounts, listDefaults, outsideSidebar, railAreas, sameList, tasksForList, upcomingBucket } from './task-views';
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

describe('due labels', () => {
    const base = { today: TODAY, now: '14:00', words, hour12: false, showDay: true, locale: 'en-US' };

    it('adds the time to a row\'s date', () => {
        expect(dueLabel(TODAY, '15:00', base)).toEqual({ text: 'Today 15:00', tone: 'today' });
        expect(dueLabel(addDays(TODAY, 1), '09:30', base)).toEqual({ text: 'Tomorrow 09:30', tone: 'soon' });
        expect(dueLabel(TODAY, undefined, base)).toEqual(rowDateLabel(TODAY, TODAY, words, 'en-US'));
    });

    it('shows only the time inside a day\'s own group', () => {
        expect(dueLabel(TODAY, '15:00', { ...base, showDay: false })).toEqual({ text: '15:00', tone: 'today' });
    });

    it('turns a time that has passed today to overdue, and only today', () => {
        expect(dueLabel(TODAY, '13:59', base).tone).toBe('overdue');
        expect(dueLabel(TODAY, '14:00', base).tone).toBe('today');
        expect(dueLabel(addDays(TODAY, 1), '13:59', base).tone).toBe('soon');
    });

    it('reuses its formatters from row to row', () => {
        const spy = jest.spyOn(Intl, 'DateTimeFormat');
        for (let i = 0; i < 50; i++) {
            dueLabel('2026-11-03', '15:00', { ...base, hour12: true });
            dueLabel('2026-10-28', '09:30', base);
        }
        expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
        spy.mockRestore();
    });

    it('follows a 12-hour setting', () => {
        expect(dueLabel(TODAY, '15:00', { ...base, hour12: true }).text.replace(/\s/g, ' ')).toBe('Today 3 PM');
    });
});

describe('task-line', () => {
    it('keeps a date and its time together through renames', () => {
        const dateText = '2026-10-30 15:00';
        expect(editableTitle('Call mom 2026-10-30 15:00', dateText)).toBe('Call mom');
        expect(withTitle('Call mom 2026-10-30 15:00', dateText, 'Phone mom')).toBe('Phone mom 2026-10-30 15:00');
        expect(withTitle('2026-10-30 3pm Call mom', '2026-10-30 3pm', 'Phone mom')).toBe('2026-10-30 3pm Phone mom');
    });

    it('clears a date and its time, keeping a marker last', () => {
        expect(setDateInText('Call 2026-10-30 15:00 [↗](https://x.y)', '2026-10-30 15:00', null)).toBe('Call [↗](https://x.y)');
    });

    it('re-dates a task and keeps its time as written', () => {
        const task = { dateText: '2026-10-30 3pm', timeText: '3pm' };
        expect(setDueInText('Call 2026-10-30 3pm', task, '2026-11-02')).toBe('Call 2026-11-02 3pm');
        expect(setDueInText('Call 2026-10-30 3pm', task, '2026-11-02', '16:00')).toBe('Call 2026-11-02 16:00');
        expect(setDueInText('Call 2026-10-30 3pm', task, '2026-10-30', null)).toBe('Call 2026-10-30');
        expect(setDueInText('Call 2026-10-30 3pm', task, null)).toBe('Call');
        expect(setDueInText('Call [↗](https://x.y)', {}, '2026-10-30', '15:00')).toBe('Call 2026-10-30 15:00 [↗](https://x.y)');
    });

    it('writes a new task with a time', () => {
        expect(dateTimeText('2026-10-30', '15:00')).toBe('2026-10-30 15:00');
        expect(dateTimeText('2026-10-30')).toBe('2026-10-30');
        expect(buildTaskLine({ text: 'Call mom', date: '2026-10-30', time: '3pm' })).toBe('- [ ] Call mom 2026-10-30 3pm');
    });

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

    it('edits a task\'s words without its date or sync marker', () => {
        const synced = 'Get each CSM\'s OK #followup 2026-08-07 [↗](https://app.todoist.com/app/task/abc)';
        expect(editableTitle(synced, '2026-08-07')).toBe('Get each CSM\'s OK #followup');
        expect(withTitle(synced, '2026-08-07', 'Get every CSM\'s OK #followup'))
            .toBe('Get every CSM\'s OK #followup 2026-08-07 [↗](https://app.todoist.com/app/task/abc)');
        expect(editableTitle('2026-10-20 Call Sam', '2026-10-20')).toBe('Call Sam');
        expect(withTitle('2026-10-20 Call Sam', '2026-10-20', 'Call Sam back')).toBe('2026-10-20 Call Sam back');
        expect(withTitle('Call Sam', undefined, '  Call   Sam back ')).toBe('Call Sam back');
        expect(withTitle('Read [the post](https://x.y)', undefined, 'Read [the post](https://x.y) twice')).toBe('Read [the post](https://x.y) twice');
    });

    it('adds a subtask after the task\'s notes and last subtask', () => {
        const lines = ['- [ ] Parent', '\t- a note', '', '\t- [ ] Child', '\t\t- child note', '', '- [ ] Next'];
        expect(subtaskLines(lines, 0, ['- [ ] New'])).toEqual({ at: 5, lines: ['\t- [ ] New'] });
        expect(subtaskLines(lines, 3, ['- [ ] Deeper'])).toEqual({ at: 5, lines: ['\t\t- [ ] Deeper'] });
        expect(subtaskLines(lines, 1, ['- [ ] x'])).toBeNull();
    });

    it('indents a first subtask the way the note indents its lists', () => {
        expect(subtaskLines(['- [ ] Alone', '- [ ] Next'], 0, ['- [ ] a'])).toEqual({ at: 1, lines: ['\t- [ ] a'] });
        expect(subtaskLines(['- [ ] Alone', '', '- [ ] Other', '  - [ ] two-space'], 0, ['- [ ] a'])?.lines).toEqual(['  - [ ] a']);
        expect(subtaskLines(['    - [ ] Nested', '- [ ] Next'], 0, ['- [ ] a'])?.lines).toEqual(['        - [ ] a']);
        expect(subtaskLines(['- [ ] Parent', '    - [ ] Spaced child'], 0, ['- [ ] a'])?.lines).toEqual(['    - [ ] a']);
        expect(subtaskLines(['> - [ ] In a callout', '> - [ ] Next'], 0, ['- [ ] a'])).toEqual({ at: 1, lines: ['> \t- [ ] a'] });
    });
});

describe('title case', () => {
    it('capitalizes every word but the small ones', () => {
        expect(titleCase('call mom to ask about the lease', { final: true })).toBe('Call Mom to Ask About the Lease');
        expect(titleCase('does this actually work', { final: true })).toBe('Does This Actually Work');
        expect(titleCase('éclair run')).toBe('Éclair Run');
        expect(titleCase("don't forget mom's gift")).toBe("Don't Forget Mom's Gift");
        expect(titleCase('**buy** milk and (fresh) eggs')).toBe('**Buy** Milk and (Fresh) Eggs');
        expect(titleCase('"quote" it')).toBe('"Quote" It');
        expect(titleCase('Already Fine')).toBe('Already Fine');
    });

    it('makes small words small, unless they open the task, follow a colon or end it', () => {
        expect(titleCase('The Plan For The Week')).toBe('The Plan for the Week');
        expect(titleCase('the plan', { final: true })).toBe('The Plan');
        expect(titleCase('launch: a new site')).toBe('Launch: A New Site');
        expect(titleCase('log in', { final: true })).toBe('Log In');
        expect(titleCase('log in')).toBe('Log in');
        expect(titleCase('apples vs. oranges')).toBe('Apples vs. Oranges');
    });

    it('capitalizes each part of a hyphenated word', () => {
        expect(titleCase('follow-up with step-by-step notes')).toBe('Follow-Up With Step-by-Step Notes');
    });

    it('leaves links, tags, code, addresses, file names and words with their own capitals alone', () => {
        expect(titleCase('[[my note]] review')).toBe('[[my note]] Review');
        expect(titleCase('read [the docs](https://x.y) today')).toBe('Read [the docs](https://x.y) Today');
        expect(titleCase('#followup ask sam')).toBe('#followup Ask Sam');
        expect(titleCase('run `npm run build` again')).toBe('Run `npm run build` Again');
        expect(titleCase('open https://x.y and www.x.y')).toBe('Open https://x.y and www.x.y');
        expect(titleCase('email bob@x.y about notes.md and src/main.ts')).toBe('Email bob@x.y About notes.md and src/main.ts');
        expect(titleCase('iPhone backup to USB, e.g. tonight')).toBe('iPhone Backup to USB, e.g. Tonight');
        expect(titleCase('2026 plan')).toBe('2026 Plan');
        expect(titleCase('')).toBe('');
    });

    it('leaves a link being typed alone', () => {
        expect(titleCase('see [[my no')).toBe('See [[my no');
        expect(titleCase('see [[my note]')).toBe('See [[my note]');
        expect(titleCase('run `npm i')).toBe('Run `npm i');
    });
});

describe('quick-parse', () => {
    it('reads times next to dates and on their own', () => {
        expect(parseQuickAdd('Call mom 3pm', TODAY)).toMatchObject({ title: 'Call mom', time: '15:00', date: undefined });
        expect(parseQuickAdd('Dentist fri 9am', TODAY)).toMatchObject({ title: 'Dentist', date: '2026-10-30', time: '09:00' });
        expect(parseQuickAdd('Dentist 9am fri', TODAY)).toMatchObject({ title: 'Dentist', date: '2026-10-30', time: '09:00' });
        expect(parseQuickAdd('Standup tomorrow at 15:30', TODAY)).toMatchObject({ title: 'Standup', date: '2026-10-26', time: '15:30' });
        expect(parseQuickAdd('Ship oct 30 3pm', TODAY)).toMatchObject({ title: 'Ship', date: '2026-10-30', time: '15:00' });
        expect(parseQuickAdd('Lunch @ noon', TODAY)).toMatchObject({ title: 'Lunch', time: '12:00' });
        expect(parseQuickAdd('Plan 2026-10-30 15:00', TODAY)).toMatchObject({ title: 'Plan', date: '2026-10-30', time: '15:00' });
    });

    it('leaves numbers that are not times as words', () => {
        expect(parseQuickAdd('Read John 3:16', TODAY)).toMatchObject({ title: 'Read John 3:16', time: undefined });
        expect(parseQuickAdd('Read John 3:16 fri', TODAY)).toMatchObject({ title: 'Read John 3:16', time: undefined });
        expect(parseQuickAdd('Call at 3', TODAY)).toMatchObject({ title: 'Call at 3', time: undefined });
        // Tinted and undoable in quick add: Backspace turns it back into words.
        expect(parseQuickAdd('Discuss the 3pm slot', TODAY).time).toBe('15:00');
        expect(parseQuickAdd('Discuss the 3pm slot', TODAY, new Set(['3pm'])).time).toBeUndefined();
    });

    it('reads a shortened day with a time on the date page', () => {
        expect(parseDateTimeQuery('we 3pm', TODAY)).toEqual({ date: parseDateQuery('we', TODAY), time: '15:00' });
        expect(parseDateTimeQuery('tom 15:00', TODAY)).toEqual({ date: '2026-10-26', time: '15:00' });
        expect(parseDateTimeQuery('nov 3 at 9am', TODAY)).toEqual({ date: '2026-11-03', time: '09:00' });
        expect(parseDateTimeQuery('3pm we', TODAY)).toEqual({ date: parseDateQuery('we', TODAY), time: '15:00' });
        expect(parseDateTimeQuery('soon 3pm', TODAY)).toBeUndefined();
    });

    it('reads a date and time for the date page', () => {
        expect(parseDateTimeQuery('3pm', TODAY)).toEqual({ time: '15:00' });
        expect(parseDateTimeQuery('15:00', TODAY)).toEqual({ time: '15:00' });
        expect(parseDateTimeQuery('fri 3pm', TODAY)).toEqual({ date: '2026-10-30', time: '15:00' });
        expect(parseDateTimeQuery('we', TODAY)).toEqual({ date: parseDateQuery('we', TODAY) });
        expect(parseDateTimeQuery('soon', TODAY)).toBeUndefined();
    });

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

describe('today\'s daily note', () => {
    const daily = `Daily/${TODAY}.md`;
    const tasks = [
        task({ text: 'Water the plants', filePath: daily, lineNumber: 1 }),
        task({ text: 'Dated in daily', filePath: daily, lineNumber: 2, date: '2026-10-30' }),
        task({ text: 'Undated elsewhere', lineNumber: 3 }),
        task({ text: 'Old daily', filePath: 'Daily/2026-10-20.md', lineNumber: 1 })
    ];
    const today = { kind: 'smart' as const, id: 'today' as const };

    it('puts its undated tasks in Today', () => {
        expect(tasksForList(tasks, today, TODAY, DEFAULT_DISPLAY, new Set(), daily).map(t => t.text)).toEqual(['Water the plants']);
        expect(tasksForList(tasks, today, TODAY, DEFAULT_DISPLAY).map(t => t.text)).toEqual([]);
    });

    it('counts them in Today', () => {
        expect(listCounts(tasks, TODAY, daily).today).toBe(1);
        expect(listCounts(tasks, TODAY).today).toBe(0);
    });

    it('shows them under Today, not No date', () => {
        const list = tasksForList(tasks, today, TODAY, DEFAULT_DISPLAY, new Set(), daily);
        const groups = buildGroups(list, today, TODAY, DEFAULT_DISPLAY, labels, notes, 'en-GB', new Set(), daily);
        expect(groups.map(g => [g.title, g.count])).toEqual([['Today', 1]]);
    });
});

describe('sorting', () => {
    const texts = (groups: ReturnType<typeof buildGroups>) => groups.flatMap(g => g.sections.flatMap(s => s.tasks.map(t => `${'  '.repeat(t.indentLevel)}${t.text}`)));

    it('keeps subtasks under their parent when sorted by priority', () => {
        const ref = { kind: 'note' as const, path: 'Work/Note.md' };
        const list = [
            task({ text: 'Quotes', lineNumber: 1 }),
            task({ text: 'Quote A', lineNumber: 2, indentLevel: 1, parentLine: 1 }),
            task({ text: 'Quote B', lineNumber: 3, indentLevel: 1, parentLine: 1, priority: 1 }),
            task({ text: 'Urgent', lineNumber: 4, priority: 1 })
        ];
        const display = { ...DEFAULT_DISPLAY, sort: 'priority' as const };
        expect(texts(buildGroups(list, ref, TODAY, display, labels, notes))).toEqual(['Urgent', 'Quotes', '  Quote A', '  Quote B']);
    });

    it('orders Today and Upcoming by priority within each day', () => {
        const ref = { kind: 'smart' as const, id: 'today' as const };
        const list = [
            task({ text: 'Plain', date: TODAY, lineNumber: 1 }),
            task({ text: 'Second', date: TODAY, lineNumber: 2, priority: 2 }),
            task({ text: 'First', date: TODAY, lineNumber: 3, filePath: 'Inbox.md', priority: 1 })
        ];
        const display = { ...DEFAULT_DISPLAY, ...listDefaults(ref) };
        expect(texts(buildGroups(list, ref, TODAY, display, labels, notes))).toEqual(['First', 'Second', 'Plain']);
        expect(listDefaults({ kind: 'smart', id: 'upcoming' }).sort).toBe('priority');
        expect(listDefaults({ kind: 'note', path: 'Work/Note.md' }).sort).toBe('file');
    });

    it('puts timed tasks first within a day, earliest first, under priority', () => {
        const ref = { kind: 'smart' as const, id: 'today' as const };
        const list = [
            task({ text: 'P3 untimed', date: TODAY, lineNumber: 0, priority: 3 }),
            task({ text: 'P3 15:00', date: TODAY, time: '15:00', lineNumber: 3, priority: 3 }),
            task({ text: 'P1 untimed', date: TODAY, lineNumber: 1, priority: 1 }),
            task({ text: 'P3 9:00', date: TODAY, time: '09:00', lineNumber: 2, priority: 3 })
        ];
        const display = { ...DEFAULT_DISPLAY, ...listDefaults(ref) };
        // Priority first (an untimed P1 stays above a P3 at 09:00), then time.
        expect(texts(buildGroups(list, ref, TODAY, display, labels, notes))).toEqual(['P1 untimed', 'P3 9:00', 'P3 15:00', 'P3 untimed']);
    });

    it('keeps weeks ahead in date order, priority breaking ties', () => {
        const ref = { kind: 'smart' as const, id: 'upcoming' as const };
        const list = [
            task({ text: 'Later plain', date: '2026-11-12', lineNumber: 1 }),
            task({ text: 'Sooner', date: '2026-11-10', lineNumber: 2 }),
            task({ text: 'Later urgent', date: '2026-11-12', lineNumber: 3, priority: 1 })
        ];
        const display = { ...DEFAULT_DISPLAY, ...listDefaults(ref) };
        expect(texts(buildGroups(list, ref, TODAY, display, labels, notes))).toEqual(['Sooner', 'Later urgent', 'Later plain']);
    });
});

describe('This note', () => {
    const following = { kind: 'note' as const, path: 'Work/Note.md', follow: true };

    it('follows the note that opens', () => {
        expect(followNote(following, 'Inbox.md')).toEqual({ kind: 'note', path: 'Inbox.md', follow: true });
    });

    it('stays put for a file that is not a note, no file, or the same note', () => {
        expect(followNote(following, 'Board.canvas')).toBeNull();
        expect(followNote(following, null)).toBeNull();
        expect(followNote(following, 'Work/Note.md')).toBeNull();
    });

    it('leaves a note picked from the list where it is', () => {
        expect(followNote({ kind: 'note', path: 'Work/Note.md' }, 'Inbox.md')).toBeNull();
        expect(followNote({ kind: 'smart', id: 'today' }, 'Inbox.md')).toBeNull();
    });

    it('gives way to Today once the tab leaves the sidebar', () => {
        expect(outsideSidebar(following)).toEqual({ kind: 'smart', id: 'today' });
    });

    it('leaves every other list alone outside the sidebar', () => {
        const picked = { kind: 'note' as const, path: 'Work/Note.md' };
        const upcoming = { kind: 'smart' as const, id: 'upcoming' as const };
        expect(outsideSidebar(picked)).toBe(picked);
        expect(outsideSidebar(upcoming)).toBe(upcoming);
    });

    it('is its own list, apart from the note it shows', () => {
        expect(sameList(following, { kind: 'note', path: 'Work/Note.md' })).toBe(false);
        expect(sameList(following, { ...following, path: 'Inbox.md' })).toBe(true);
    });
});

describe('headings that share a name', () => {
    const ref = { kind: 'note' as const, path: 'Work/Note.md' };
    const list = [
        task({ text: 'One', lineNumber: 2, section: 'Action items', sectionLine: 1 }),
        task({ text: 'Two', lineNumber: 5, section: 'Notes', sectionLine: 4 }),
        task({ text: 'Three', lineNumber: 8, section: 'Action items', sectionLine: 7 })
    ];
    const shape = (groups: ReturnType<typeof buildGroups>) => groups.map(g => [g.title, g.sections.flatMap(s => s.tasks.map(t => t.text))]);

    it('stay apart in a note, in the note\'s order', () => {
        const groups = buildGroups(list, ref, TODAY, DEFAULT_DISPLAY, labels, notes);
        expect(shape(groups)).toEqual([['Action items', ['One']], ['Notes', ['Two']], ['Action items', ['Three']]]);
        expect(new Set(groups.map(g => g.key)).size).toBe(3);
    });

    it('keep the first one\'s key, so folds saved before still apply', () => {
        const groups = buildGroups(list, ref, TODAY, DEFAULT_DISPLAY, labels, notes);
        expect(groups[0].key).toBe('Work/Note.md#Action items');
    });

    it('add to the heading the group shows', () => {
        const groups = buildGroups(list, ref, TODAY, DEFAULT_DISPLAY, labels, notes);
        expect(groups[2].add).toEqual({ path: 'Work/Note.md', heading: 'Action items', headingLine: 7 });
    });

    it('stay apart inside a note\'s group in other lists too', () => {
        const groups = buildGroups(list, { kind: 'smart', id: 'anytime' }, TODAY, { ...DEFAULT_DISPLAY, group: 'note' }, labels, notes);
        expect(groups[0].sections.map(s => [s.title, s.tasks.map(t => t.text)])).toEqual([['Action items', ['One']], ['Notes', ['Two']], ['Action items', ['Three']]]);
    });

    it('take a new task under the one asked for', () => {
        const lines = ['## Action items', '- [ ] one', '## Notes', '## Action items', '- [ ] two'];
        expect(insertionLine(lines, 'Action items', 3)).toBe(4);
        expect(insertionLine(lines, 'Action items')).toBe(1);
    });
});
