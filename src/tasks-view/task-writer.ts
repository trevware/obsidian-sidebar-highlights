import { App, TFile } from 'obsidian';
import type { Task } from '../../main';
import { insertionLine, locateTaskLine } from './task-line';

/** One line the Tasks tab changed, kept so the change can be undone. */
export interface LineChange {
    path: string;
    line: number;
    before: string;
    after: string;
}

export interface WriteResult {
    changes: LineChange[];
    /** Tasks whose line could not be found again, because the note changed under them. */
    missed: Task[];
}

/**
 * Every write the Tasks tab makes to a note.
 *
 * Writes go through `Vault.process`, one call per note however many tasks in
 * it change, so a bulk edit is one atomic write per file. Each line is found
 * again inside the write by its recorded line number and exact text, and a
 * task that can no longer be found is skipped and reported rather than
 * guessed at.
 */
export class TaskWriter {
    constructor(private app: App) {}

    private file(path: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    async apply(tasks: readonly Task[], transform: (line: string, task: Task) => string | null): Promise<WriteResult> {
        const byFile = new Map<string, Task[]>();
        for (const task of tasks) {
            const list = byFile.get(task.filePath);
            if (list) list.push(task);
            else byFile.set(task.filePath, [task]);
        }

        const changes: LineChange[] = [];
        const missed: Task[] = [];

        for (const [path, list] of byFile) {
            const file = this.file(path);
            if (!file) {
                missed.push(...list);
                continue;
            }

            await this.app.vault.process(file, (data) => {
                const lines = data.split('\n');
                for (const task of list) {
                    const index = locateTaskLine(lines, task.lineNumber, task.text);
                    if (index === -1) {
                        missed.push(task);
                        continue;
                    }
                    const next = transform(lines[index], task);
                    if (next === null || next === lines[index]) continue;
                    changes.push({ path, line: index, before: lines[index], after: next });
                    lines[index] = next;
                }
                return lines.join('\n');
            });
        }

        return { changes, missed };
    }

    /** Put changed lines back, finding each by the text it was changed to. */
    async undo(changes: readonly LineChange[]): Promise<number> {
        const byFile = new Map<string, LineChange[]>();
        for (const change of changes) {
            const list = byFile.get(change.path);
            if (list) list.push(change);
            else byFile.set(change.path, [change]);
        }

        let restored = 0;
        for (const [path, list] of byFile) {
            const file = this.file(path);
            if (!file) continue;
            await this.app.vault.process(file, (data) => {
                const lines = data.split('\n');
                for (const change of list) {
                    let index = lines[change.line] === change.after ? change.line : -1;
                    if (index === -1) {
                        let best = Infinity;
                        lines.forEach((line, i) => {
                            if (line === change.after && Math.abs(i - change.line) < best) {
                                best = Math.abs(i - change.line);
                                index = i;
                            }
                        });
                    }
                    if (index === -1) continue;
                    lines[index] = change.before;
                    restored++;
                }
                return lines.join('\n');
            });
        }
        return restored;
    }

    /**
     * Add lines to a note at the end of a heading's section, or at the end of
     * the note. Returns the line number of the first one, or -1 when the note
     * is missing.
     */
    async insert(path: string, heading: string | undefined, newLines: readonly string[]): Promise<number> {
        const file = this.file(path);
        if (!file || newLines.length === 0) return -1;

        let at = -1;
        await this.app.vault.process(file, (data) => {
            const lines = data.length === 0 ? [] : data.split('\n');
            at = insertionLine(lines, heading);
            lines.splice(at, 0, ...newLines);
            return lines.join('\n');
        });
        return at;
    }

    /** Remove lines this tab just added, for undoing a quick add. */
    async remove(path: string, at: number, removeLines: readonly string[]): Promise<void> {
        const file = this.file(path);
        if (!file) return;
        await this.app.vault.process(file, (data) => {
            const lines = data.split('\n');
            const matchesAt = (start: number) => removeLines.every((line, i) => lines[start + i] === line);
            const start = matchesAt(at) ? at : lines.findIndex((_line, i) => matchesAt(i));
            if (start === -1) return data;
            lines.splice(start, removeLines.length);
            return lines.join('\n');
        });
    }
}
