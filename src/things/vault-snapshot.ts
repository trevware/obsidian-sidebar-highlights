/**
 * The vault as Things sync sees it: every note with a task worth syncing, the
 * headings that hold those tasks, and each task's Things fields.
 *
 * Kept free of Obsidian imports so it can be unit tested directly. Parsing is
 * passed in (`TaskManager.tasksInContent` in the plugin, a fake in tests).
 */

import type { Task } from '../../main';
import { noteHeadings, titleOf } from '../tasks-view/task-move';
import { readThingsId } from './ids';
import { fieldsFromTask } from './mapping';
import type { VaultNote, VaultSnapshot, VaultTask } from './model';

export interface SnapshotOptions {
    parse(path: string, content: string): Task[];
    hideMetadata: boolean;
    /** The day a daily note stands for, if `path` is one. */
    dailyDate(path: string): string | undefined;
}

/** A task still being worked on, or one Things already knows by its ID. */
function worthSyncing(task: Task, id: string | undefined): boolean {
    return id !== undefined || (task.status !== 'done' && task.status !== 'cancelled');
}

/**
 * Reads each note's tasks. A note is in when it has an open task or a task
 * with a Things ID. Subtasks are their parent's checklist, not tasks of their
 * own. A task's heading is the nearest one above it that isn't the note's title.
 */
export function vaultSnapshot(notes: Array<{ path: string; lines: string[]; mtime: number }>, opts: SnapshotOptions): VaultSnapshot {
    const result: VaultNote[] = [];
    const folders: string[] = [];
    for (const { path, lines, mtime } of notes) {
        const headings = noteHeadings(lines);
        const title = titleOf(headings);
        const impliedWhen = opts.dailyDate(path);
        const tasks: VaultTask[] = [];
        const held = new Set<string>();
        for (const task of opts.parse(path, lines.join('\n'))) {
            if (task.parentLine !== undefined) continue;
            const id = readThingsId(task.text);
            if (!worthSyncing(task, id)) continue;
            let heading: string | undefined;
            for (const candidate of headings) {
                if (candidate.line >= task.lineNumber) break;
                if (candidate !== title) heading = candidate.title;
            }
            const own = task.date ? undefined : impliedWhen;
            const vaultTask: VaultTask = {
                path, line: task.lineNumber, text: task.text,
                fields: fieldsFromTask(task, lines, { hideMetadata: opts.hideMetadata, impliedWhen: own })
            };
            if (heading !== undefined) { vaultTask.heading = heading; held.add(heading); }
            if (id) vaultTask.id = id;
            if (task.dateText) vaultTask.dateText = task.dateText;
            if (task.timeText) vaultTask.timeText = task.timeText;
            if (own) vaultTask.impliedWhen = own;
            tasks.push(vaultTask);
        }
        if (!tasks.length) continue;
        const slash = path.lastIndexOf('/');
        const folder = slash < 0 ? '' : path.slice(0, slash);
        const base = path.slice(slash + 1);
        result.push({
            path, folder, title: base.replace(/\.md$/i, ''), mtime, tasks,
            headings: headings.map(h => h.title).filter((name, i, all) => held.has(name) && all.indexOf(name) === i)
        });
        if (folder && !folders.includes(folder)) folders.push(folder);
    }
    return { notes: result, folders };
}
