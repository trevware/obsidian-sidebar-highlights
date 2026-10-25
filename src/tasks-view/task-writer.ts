import { App, TFile } from 'obsidian';
import type { Task } from '../../main';
import { contextRange, insertionLine, locateTaskLine, notesLines, taskBlockEnd } from './task-line';
import { moveTasks } from './task-move';
import type { MoveTarget } from './task-move';

/** One line the Tasks tab changed, kept so the change can be undone. */
export interface LineChange {
    path: string;
    line: number;
    before: string;
    after: string;
}

/** What a move did: the change to undo it, and where the tasks went. */
export interface MoveResult {
    change: RangeChange;
    /** Where each line of the note went, by its old line number. */
    lineMap: Map<number, number>;
    /** The new line of each moved task. */
    landed: number[];
}

/** A run of lines replaced in a note, kept so it can be put back. */
export interface RangeChange {
    path: string;
    start: number;
    before: string[];
    after: string[];
}

/** A task's lines taken out of a note, kept so they can be put back. */
export interface RemovedBlock {
    path: string;
    start: number;
    lines: string[];
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
    async insert(path: string, heading: string | undefined, newLines: readonly string[], headingLine?: number): Promise<number> {
        const file = this.file(path);
        if (!file || newLines.length === 0) return -1;

        let at = -1;
        await this.app.vault.process(file, (data) => {
            const lines = data.length === 0 ? [] : data.split('\n');
            at = insertionLine(lines, heading, headingLine);
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

    /**
     * Deletes tasks from their notes: each task line with its indented notes
     * and subtasks. One write per note; a task inside another deleted task's
     * block goes with its parent.
     */
    async removeTasks(tasks: readonly Task[]): Promise<{ removed: RemovedBlock[]; missed: Task[] }> {
        const byFile = new Map<string, Task[]>();
        for (const task of tasks) {
            const list = byFile.get(task.filePath);
            if (list) list.push(task);
            else byFile.set(task.filePath, [task]);
        }

        const removed: RemovedBlock[] = [];
        const missed: Task[] = [];
        for (const [path, list] of byFile) {
            const file = this.file(path);
            if (!file) {
                missed.push(...list);
                continue;
            }
            await this.app.vault.process(file, (data) => {
                const lines = data.split('\n');
                const ranges: Array<[number, number]> = [];
                for (const task of list) {
                    const index = locateTaskLine(lines, task.lineNumber, task.text);
                    if (index === -1) {
                        missed.push(task);
                        continue;
                    }
                    ranges.push([index, taskBlockEnd(lines, index)]);
                }
                // Outermost first, so a child inside its parent's block is skipped.
                ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
                const kept: Array<[number, number]> = [];
                for (const range of ranges) {
                    const last = kept[kept.length - 1];
                    if (last && range[0] < last[1]) continue;
                    kept.push(range);
                }
                // Bottom up, so earlier line numbers stay true while splicing.
                for (const [start, end] of [...kept].reverse()) {
                    removed.push({ path, start, lines: lines.slice(start, end) });
                    lines.splice(start, end - start);
                }
                return lines.join('\n');
            });
        }
        return { removed, missed };
    }

    /** Puts deleted blocks back where they were, top down. */
    async restoreBlocks(blocks: readonly RemovedBlock[]): Promise<void> {
        const byFile = new Map<string, RemovedBlock[]>();
        for (const block of blocks) {
            const list = byFile.get(block.path);
            if (list) list.push(block);
            else byFile.set(block.path, [block]);
        }
        for (const [path, list] of byFile) {
            const file = this.file(path);
            if (!file) continue;
            await this.app.vault.process(file, (data) => {
                const lines = data.split('\n');
                for (const block of [...list].sort((a, b) => a.start - b.start)) {
                    lines.splice(Math.min(block.start, lines.length), 0, ...block.lines);
                }
                return lines.join('\n');
            });
        }
    }

    /**
     * Replaces the notes under a task with some Markdown, indented under the
     * task line. Returns the change for undo, or null when the task is gone
     * or nothing changed.
     */
    async setNotes(task: Task, markdown: string): Promise<RangeChange | null> {
        const file = this.file(task.filePath);
        if (!file) return null;
        let change: RangeChange | null = null;
        await this.app.vault.process(file, (data) => {
            const lines = data.split('\n');
            const index = locateTaskLine(lines, task.lineNumber, task.text);
            if (index === -1) return data;
            const [start, end] = contextRange(lines, index);
            const before = lines.slice(start, end);
            const after = notesLines(lines, index, markdown);
            if (before.join('\n') === after.join('\n')) return data;
            lines.splice(start, end - start, ...after);
            change = { path: task.filePath, start, before, after };
            return lines.join('\n');
        });
        return change;
    }

    /**
     * Moves tasks, with their notes and subtasks, within the one note they
     * share. Returns null when the note is gone or nothing moved.
     */
    async moveTasks(path: string, tasks: readonly Task[], target: MoveTarget): Promise<MoveResult | null> {
        const file = this.file(path);
        if (!file) return null;
        let result: MoveResult | null = null;
        await this.app.vault.process(file, (data) => {
            const plan = moveTasks(data.split('\n'), tasks.map(task => ({ line: task.lineNumber, text: task.text })), target);
            if (!plan) return data;
            result = { change: { path, ...plan.change }, lineMap: plan.lineMap, landed: plan.landed };
            return plan.lines.join('\n');
        });
        return result;
    }

    /** Puts a replaced run of lines back, finding it by what it was changed to. */
    async undoRange(change: RangeChange): Promise<void> {
        const file = this.file(change.path);
        if (!file) return;
        await this.app.vault.process(file, (data) => {
            const lines = data.split('\n');
            const matchesAt = (start: number) => change.after.every((line, i) => lines[start + i] === line);
            let start = matchesAt(change.start) ? change.start : -1;
            if (start === -1 && change.after.length > 0) start = lines.findIndex((_line, i) => matchesAt(i));
            if (start === -1) start = Math.min(change.start, lines.length);
            lines.splice(start, change.after.length, ...change.before);
            return lines.join('\n');
        });
    }
}
