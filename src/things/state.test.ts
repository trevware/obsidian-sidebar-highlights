import { EMPTY_STATE } from './model';
import type { ThingsState } from './model';
import { freshState, parseState, renameInState } from './state';

function state(): ThingsState {
    return {
        version: 1,
        joined: true,
        areas: [{ id: 'aW', folder: 'Work' }, { id: 'aP', folder: 'Work/People' }, { id: 'aS', folder: 'Workshop' }],
        projects: [
            { id: 'p1', path: 'Work/Plan.md', title: 'Plan', headings: ['A'], areaId: 'aW' },
            { id: 'p2', path: 'Work/People/Sam.md', title: 'Sam', headings: [], areaId: 'aP' },
            { id: 'p3', path: 'Workshop/Bench.md', title: 'Bench', headings: [], areaId: 'aS' }
        ],
        todos: [
            { id: 't1', place: { path: 'Work/Plan.md', heading: 'A' }, fields: { title: 'Call', notes: '', checklist: [], tags: [], status: 'open', someday: false } },
            { id: 't2', place: { path: 'Workshop/Bench.md' }, fields: { title: 'Sand', notes: '', checklist: [], tags: [], status: 'open', someday: false } }
        ],
        inboxNote: 'Things Inbox.md',
        looseNotes: { aW: 'Work/Work.md' }
    };
}

describe('the stored state', () => {
    it('starts fresh as a copy, never the shared empty state', () => {
        const a = freshState();
        a.todos.push({ id: 'x', place: { path: 'a.md' }, fields: { title: '', notes: '', checklist: [], tags: [], status: 'open', someday: false } });
        expect(EMPTY_STATE.todos).toEqual([]);
        expect(freshState().todos).toEqual([]);
    });

    it('reads a saved state back', () => {
        expect(parseState(JSON.stringify(state()))).toEqual(state());
    });

    it('reads missing, broken or foreign text as a fresh state', () => {
        expect(parseState(null)).toEqual(EMPTY_STATE);
        expect(parseState('{nope')).toEqual(EMPTY_STATE);
        expect(parseState('{"version":2}')).toEqual(EMPTY_STATE);
        expect(parseState('[]')).toEqual(EMPTY_STATE);
    });

    it('follows a note renamed or moved in the vault', () => {
        const next = renameInState(state(), 'Work/Plan.md', 'Work/Launch plan.md', false);
        expect(next.projects[0].path).toBe('Work/Launch plan.md');
        expect(next.todos[0].place).toEqual({ path: 'Work/Launch plan.md', heading: 'A' });
        expect(next.projects[2].path).toBe('Workshop/Bench.md');
    });

    it('follows the inbox note and an area\'s loose note', () => {
        const next = renameInState(renameInState(state(), 'Things Inbox.md', 'Inbox.md', false), 'Work/Work.md', 'Work/Loose.md', false);
        expect(next.inboxNote).toBe('Inbox.md');
        expect(next.looseNotes).toEqual({ aW: 'Work/Loose.md' });
    });

    it('follows a folder renamed, with its subfolders, and leaves a folder that only shares its first letters', () => {
        const next = renameInState(state(), 'Work', 'Job', true);
        expect(next.areas.map(area => area.folder)).toEqual(['Job', 'Job/People', 'Workshop']);
        expect(next.projects.map(project => project.path)).toEqual(['Job/Plan.md', 'Job/People/Sam.md', 'Workshop/Bench.md']);
        expect(next.todos.map(todo => todo.place.path)).toEqual(['Job/Plan.md', 'Workshop/Bench.md']);
        expect(next.looseNotes).toEqual({ aW: 'Job/Work.md' });
    });

    it('never changes the state it was given', () => {
        const before = state();
        renameInState(before, 'Work', 'Job', true);
        expect(before).toEqual(state());
    });
});
