import type { Task } from '../../main';
import { parseTaskLine } from '../tasks-view/task-line';
import { vaultSnapshot } from './vault-snapshot';

/** Stands in for TaskManager.tasksInContent: one Task per checkbox line, with parentLine from indentation. */
function parse(path: string, content: string): Task[] {
    const lines = content.split('\n');
    const tasks: Task[] = [];
    const stack: Array<{ indent: number; line: number }> = [];
    lines.forEach((line, index) => {
        const parsed = parseTaskLine(line);
        if (!parsed) return;
        const indent = line.length - line.trimStart().length;
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        const parentLine = stack.length ? stack[stack.length - 1].line : undefined;
        stack.push({ indent, line: index });
        const match = parsed.text.match(/\d{4}-\d{2}-\d{2}/);
        const status = parsed.state.toLowerCase() === 'x' ? 'done' : parsed.state === '-' ? 'cancelled' : 'todo';
        tasks.push({
            id: `${path}:${index}`, text: parsed.text, completed: status === 'done', status, flagged: false,
            filePath: path, lineNumber: index, context: [], indentLevel: 0, parentLine,
            date: match?.[0], dateText: match?.[0], marker: parsed.state
        } as Task);
    });
    return tasks;
}

const note = (path: string, text: string, mtime = 1) => ({ path, lines: text.split('\n'), mtime });
const opts = { parse, hideMetadata: false, dailyDate: () => undefined as string | undefined };

describe('vaultSnapshot', () => {
    it('lists the headings that hold a task worth syncing, not the title or empty ones', () => {
        const text = ['# Title', '- [ ] Top', '## A', '- [ ] One', '## B', '- [x] Done, no id', '## C', '- [x] Done with id %%things:abcdefgh12%%'].join('\n');
        const snap = vaultSnapshot([note('Work/Plan.md', text, 7)], opts);
        expect(snap.notes).toHaveLength(1);
        const n = snap.notes[0];
        expect(n).toMatchObject({ path: 'Work/Plan.md', folder: 'Work', title: 'Plan', headings: ['A', 'C'], mtime: 7 });
        expect(n.tasks.map(t => [t.text, t.heading, t.line, t.id])).toEqual([
            ['Top', undefined, 1, undefined], ['One', 'A', 3, undefined], ['Done with id', 'C', 7, 'abcdefgh12']
        ]);
        expect(snap.folders).toEqual(['Work']);
    });

    it('makes a subtask a checklist item, not a task', () => {
        const snap = vaultSnapshot([note('a.md', '- [ ] Trip\n\t- [ ] Book train')], opts);
        expect(snap.notes[0].tasks).toHaveLength(1);
        expect(snap.notes[0].tasks[0].fields.checklist).toEqual([{ title: 'Book train', done: false }]);
        expect(snap.notes[0].folder).toBe('');
        expect(snap.folders).toEqual([]);
    });

    it('leaves out a note of only done tasks without IDs', () => {
        const snap = vaultSnapshot([note('a.md', '- [x] Done\n- [-] Dropped')], opts);
        expect(snap.notes).toEqual([]);
        expect(snap.folders).toEqual([]);
    });

    it('gives only undated tasks the daily note\'s day', () => {
        const snap = vaultSnapshot([note('Daily/2026-11-22.md', '- [ ] Water\n- [ ] Pay 2026-11-25')], { ...opts, dailyDate: () => '2026-11-22' });
        const [a, b] = snap.notes[0].tasks;
        expect(a.impliedWhen).toBe('2026-11-22');
        expect(a.fields.when).toBe('2026-11-22');
        expect(b.impliedWhen).toBeUndefined();
        expect(b.fields.when).toBe('2026-11-25');
    });
});
