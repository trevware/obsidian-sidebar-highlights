// The real moment, so dates in task text parse the way they do in Obsidian.
jest.mock('obsidian', () => ({ moment: jest.requireActual('moment') }), { virtual: true });

import { TaskManager } from './task-manager';
import type HighlightCommentsPlugin from '../../main';

function scanner(): TaskManager {
    const plugin = { app: { vault: {} }, settings: { taskDateFormat: 'YYYY-MM-DD' } } as unknown as HighlightCommentsPlugin;
    return new TaskManager(plugin);
}

describe('TaskManager.tasksInContent', () => {
    it('finds tasks written with -, * and + list markers', () => {
        const note = [
            '- [ ] Dash task',
            '* [ ] Star task 2026-11-03',
            '+ [x] Plus task',
            '> * [/] Star in a callout',
        ].join('\n');

        const tasks = scanner().tasksInContent('Note.md', note);

        expect(tasks.map(task => task.text)).toEqual(['Dash task', 'Star task 2026-11-03', 'Plus task', 'Star in a callout']);
        expect(tasks[1].date).toBe('2026-11-03');
        expect(tasks[2].status).toBe('done');
        expect(tasks[3].status).toBe('in-progress');
    });

    it('nests * and + subtasks under their parent', () => {
        const note = ['* [ ] Parent', '    + [ ] Child'].join('\n');

        const [parent, child] = scanner().tasksInContent('Note.md', note);

        expect(child.indentLevel).toBe(1);
        expect(child.parentLine).toBe(parent.lineNumber);
    });
});
