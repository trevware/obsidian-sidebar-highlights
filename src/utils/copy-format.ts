/**
 * Formatting for bulk "copy visible results" actions.
 *
 * Kept free of Obsidian imports so the output shape can be unit tested directly.
 *
 * Context (issue #99): the original bulk copy always emitted `==text==`. Users
 * pointed out that once the surrounding document is gone there is no body text
 * left to distinguish, so the highlight markup is redundant and visually loud.
 * Native comment markers (`%%`) and footnotes (`^[...]`) are deliberately kept
 * in every format — those still convey which part was an annotation.
 */

import type { TaskStatus } from '../../main';
import { statusToCheckboxState } from './task-status';

export type CopyFormat = 'with-syntax' | 'plain' | 'list';

export interface CopyableHighlight {
    text: string;
    isNativeComment?: boolean;
    footnoteContents?: string[];
}

export interface CopyableTask {
    text: string;
    status?: TaskStatus;
    completed?: boolean;
}

/**
 * Format a single highlight.
 *
 * - `with-syntax` keeps `==text==` (the original behaviour)
 * - `plain` drops the highlight markers
 * - `list` drops them and prefixes a bullet
 */
export function formatHighlightForCopy(highlight: CopyableHighlight, format: CopyFormat): string {
    let text: string;

    if (highlight.isNativeComment) {
        // A native comment is the annotation, so its markers always survive.
        text = `%%${highlight.text}%%`;
    } else if (format === 'with-syntax') {
        // Both regular markdown and HTML highlights export as ==text==
        text = `==${highlight.text}==`;
    } else {
        text = highlight.text;
    }

    // Append footnotes/comments (but not for native comments — the text is the comment)
    if (!highlight.isNativeComment && highlight.footnoteContents) {
        for (const content of highlight.footnoteContents) {
            text += `^[${content}]`;
        }
    }

    return format === 'list' ? `- ${text}` : text;
}

/**
 * Format a single task.
 *
 * - `with-syntax` keeps the checkbox, e.g. `- [/] text`
 * - `plain` is the task text alone
 * - `list` is a plain bullet
 */
export function formatTaskForCopy(task: CopyableTask, format: CopyFormat): string {
    if (format === 'plain') {
        return task.text;
    }

    if (format === 'list') {
        return `- ${task.text}`;
    }

    const status: TaskStatus = task.status ?? (task.completed ? 'done' : 'todo');
    return `- [${statusToCheckboxState(status)}] ${task.text}`;
}

/**
 * Join formatted highlight entries. Bullets read as a single list, so they are
 * newline separated; the other formats keep a blank line between entries since
 * a highlight and its notes can run to several lines.
 */
export function joinHighlightEntries(entries: string[], format: CopyFormat): string {
    return entries.join(format === 'list' ? '\n' : '\n\n');
}

/** Tasks are always one per line, in every format. */
export function joinTaskEntries(entries: string[]): string {
    return entries.join('\n');
}
