/**
 * Carrying a task to another note, for a to-do moved to another project in
 * Things: the task's line goes with its notes and subtasks, under the
 * heading it sits under in Things (added when the note lacks it), and leaves
 * the note it was in.
 *
 * The line is found again by its line number and text, so a note that
 * shifted since it was read still gives up the right task, and a task whose
 * text changed in the meantime is left where it is for the next round. Kept
 * free of Obsidian imports so it can be unit tested directly.
 */

import { insertionLine, locateTaskLine, taskBlockEnd } from '../tasks-view/task-line';
import { addUnderNewHeading, newHeadingLevel, noteHeadings } from '../tasks-view/task-move';

/** Both notes' new lines, or null when the task's line couldn't be found. */
export function carryBlock(from: readonly string[], task: { line: number; text: string }, to: readonly string[], heading?: string): { from: string[]; to: string[] } | null {
    const source = [...from];
    const index = locateTaskLine(source, task.line, task.text);
    if (index === -1) return null;
    const end = taskBlockEnd(source, index);
    const block = source.slice(index, end);
    source.splice(index, end - index);

    const name = heading?.trim();
    if (!name) {
        const target = [...to];
        const at = insertionLine(target);
        target.splice(at, 0, ...block);
        return { from: source, to: target };
    }
    const level = newHeadingLevel(noteHeadings([...to]), name);
    return { from: source, to: addUnderNewHeading([...to], name, level, 'bottom', block).lines };
}
