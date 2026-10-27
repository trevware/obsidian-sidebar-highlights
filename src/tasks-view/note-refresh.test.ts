import { NoteRefresher } from './note-refresh';
import type { Task } from '../../main';

function task(filePath: string, text: string, marker = ' '): Task {
    return { id: `${filePath}:${text}`, text, completed: marker === 'x', status: marker === 'x' ? 'done' : 'todo', filePath, lineNumber: 0, context: [], indentLevel: 0, marker } as unknown as Task;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

describe('re-reading notes after they change', () => {
    let tasks: Task[];
    let refresher: NoteRefresher;

    beforeEach(() => {
        tasks = [task('a.md', 'Pick up the prescription'), task('b.md', 'Call the plumber')];
        refresher = new NoteRefresher(() => tasks, (next) => { tasks = next; });
    });

    test('takes in a change to one note', async () => {
        const changed = await refresher.refresh('a.md', () => Promise.resolve([task('a.md', 'Pick up the prescription', 'x')]));
        expect(changed).toBe(true);
        expect(tasks.find(t => t.filePath === 'a.md')?.marker).toBe('x');
    });

    test('reports nothing when the note reads the same', async () => {
        const changed = await refresher.refresh('a.md', () => Promise.resolve([task('a.md', 'Pick up the prescription')]));
        expect(changed).toBe(false);
    });

    test('keeps both changes when two notes change at once', async () => {
        const readA = deferred<Task[]>();
        const readB = deferred<Task[]>();
        const a = refresher.refresh('a.md', () => readA.promise);
        const b = refresher.refresh('b.md', () => readB.promise);
        readA.resolve([task('a.md', 'Pick up the prescription', 'x')]);
        await a;
        readB.resolve([task('b.md', 'Call the plumber about the leak')]);
        await b;
        expect(tasks.find(t => t.filePath === 'a.md')?.marker).toBe('x');
        expect(tasks.find(t => t.filePath === 'b.md')?.text).toBe('Call the plumber about the leak');
    });

    test('lets the newest read of a note win when an older one finishes last', async () => {
        const older = deferred<Task[]>();
        const newer = deferred<Task[]>();
        const first = refresher.refresh('a.md', () => older.promise);
        const second = refresher.refresh('a.md', () => newer.promise);
        newer.resolve([task('a.md', 'Pick up the prescription', 'x')]);
        await second;
        older.resolve([task('a.md', 'Pick up the prescription')]);
        await first;
        expect(tasks.find(t => t.filePath === 'a.md')?.marker).toBe('x');
    });
});
