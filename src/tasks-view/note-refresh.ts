import type { Task } from '../../main';

/** Everything about a note's tasks that the view shows. */
function signature(tasks: Task[]): string {
    return tasks
        .map(task => `${task.lineNumber}\u0001${task.marker}\u0001${task.indentLevel}\u0001${task.section}\u0001${task.text}\u0001${task.context.join('\u0002')}`)
        .join('\u0003');
}

/**
 * Swaps one note's tasks in the view's list for a fresh read of that note.
 *
 * Several notes often change at once (a sync ticking boxes across a vault),
 * so their reads overlap. The list is taken after the note is read, so each
 * read lands on top of the others; and when one note is read twice, the
 * later read wins whichever finishes last.
 */
export class NoteRefresher {
    // The latest read started for each note, numbered across all notes so a
    // number is never reused.
    private readonly reads = new Map<string, number>();
    private lastRead = 0;

    constructor(private readonly get: () => Task[], private readonly set: (tasks: Task[]) => void) {}

    /** Re-reads one note's tasks. Returns whether anything about them changed. */
    async refresh(path: string, read: () => Promise<Task[]>): Promise<boolean> {
        const ticket = ++this.lastRead;
        this.reads.set(path, ticket);
        const fresh = await read();
        if (this.reads.get(path) !== ticket) return false;
        const current = this.get();
        const mine = current.filter(task => task.filePath === path);
        if (signature(mine) === signature(fresh)) return false;
        this.set([...current.filter(task => task.filePath !== path), ...fresh]);
        return true;
    }
}
