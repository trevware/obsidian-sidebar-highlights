/**
 * Task checkbox syntax and status mapping.
 *
 * Kept free of Obsidian imports so it can be unit tested directly — the regexes
 * used to be duplicated across five call sites in task-manager.ts and mirrored
 * again inline in tests, which is exactly how production and test drift apart.
 */

import type { TaskStatus } from '../../main';

/**
 * Matches checkbox syntax: - [ ] - [x] - [/] - [-] - [?] - [!] - [!1] - [!2] - [!3]
 * Supports tasks in callouts (lines starting with >).
 * Captures leading whitespace, checkbox state, and task text.
 *
 * The hyphen sits last in the character class so it is read as a literal.
 */
export const CHECKBOX_PATTERN = String.raw`(\s*)- \[([ xX!/?-]|!?[123])\] (.+)$`;

/** Detection form — the callout prefix is matched but not captured. */
export const CHECKBOX_REGEX = new RegExp(String.raw`^(?:>+ ?)?` + CHECKBOX_PATTERN);

/** Rewrite form — captures the callout prefix so it can be preserved. */
export const CHECKBOX_REGEX_WITH_PREFIX = new RegExp(String.raw`^(>+ ?)?` + CHECKBOX_PATTERN);

/** Map a raw checkbox character to its status. Priority markers count as 'todo'. */
export function checkboxStateToStatus(checkboxState: string): TaskStatus {
    switch (checkboxState.toLowerCase()) {
        case 'x': return 'done';
        case '/': return 'in-progress';
        case '-': return 'cancelled';
        case '?': return 'question';
        default: return 'todo';
    }
}

/** Inverse of checkboxStateToStatus, for writing a status back to markdown. */
export function statusToCheckboxState(status: TaskStatus): string {
    switch (status) {
        case 'done': return 'x';
        case 'in-progress': return '/';
        case 'cancelled': return '-';
        case 'question': return '?';
        default: return ' ';
    }
}

/**
 * Statuses treated as resolved, and therefore hidden when completed tasks are
 * hidden. In-progress and question still need action, so they stay visible.
 */
export function isResolvedStatus(status: TaskStatus): boolean {
    return status === 'done' || status === 'cancelled';
}

/**
 * Running state while scanning a file's task lines top to bottom.
 * `ancestorLines[n]` is the line number of the most recent task at indent level n.
 */
export interface TaskNestingState {
    ancestorLines: number[];
}

export function createTaskNestingState(): TaskNestingState {
    return { ancestorLines: [] };
}

/** Clear parent tracking, e.g. at a heading or an unindented non-task line. */
export function resetTaskNesting(state: TaskNestingState): void {
    state.ancestorLines = [];
}

export interface ResolvedNesting {
    indentLevel: number;
    /** Line number of the structural parent, or undefined at top level. */
    parentLine: number | undefined;
}

/**
 * Resolve a task's indent level against the file's real structure and record
 * which line is its parent.
 *
 * Runs for every task line, including ones the caller will filter out, so the
 * recorded structure always reflects the file rather than what survived a
 * filter. A task can never sit more than one level below its nearest ancestor,
 * which normalises over-indented or orphaned sub-tasks.
 */
export function resolveTaskNesting(
    rawIndentLevel: number,
    lineNumber: number,
    state: TaskNestingState
): ResolvedNesting {
    const indentLevel = Math.min(Math.max(rawIndentLevel, 0), state.ancestorLines.length);
    const parentLine = indentLevel > 0 ? state.ancestorLines[indentLevel - 1] : undefined;

    // This task becomes the ancestor at its own level; anything deeper is stale.
    state.ancestorLines.length = indentLevel;
    state.ancestorLines.push(lineNumber);

    return { indentLevel, parentLine };
}

/** Minimum shape needed to re-resolve nesting for a filtered list. */
export interface NestableTask {
    filePath: string;
    lineNumber: number;
    indentLevel: number;
    parentLine?: number;
}

/**
 * Re-resolve indent levels for a list of tasks that has already been filtered.
 *
 * Filtering happens in the view (hiding completed tasks, search, tags), so a
 * task's parent may not be present in the list being rendered. Such a task is
 * promoted to top level instead of appearing nested under whichever task merely
 * happens to precede it — which can be an unrelated task far earlier in the file.
 *
 * Returns a new array; unchanged tasks keep their original object identity, and
 * changed ones are shallow copies so the shared task cache is never mutated.
 */
export function normalizeVisibleNesting<T extends NestableTask>(tasks: T[]): T[] {
    const key = (filePath: string, lineNumber: number) => `${filePath}:${lineNumber}`;

    const visible = new Map<string, T>();
    for (const task of tasks) {
        visible.set(key(task.filePath, task.lineNumber), task);
    }

    const depths = new Map<string, number>();
    const resolving = new Set<string>();

    const depthOf = (task: T): number => {
        const taskKey = key(task.filePath, task.lineNumber);

        const cached = depths.get(taskKey);
        if (cached !== undefined) {
            return cached;
        }

        // A malformed parent chain must not loop forever. Neither case is reachable
        // from the scanner, which always points at a strictly earlier line.
        if (resolving.has(taskKey)) {
            return 0;
        }
        resolving.add(taskKey);

        let depth = 0;
        if (task.parentLine !== undefined && task.parentLine !== task.lineNumber) {
            const parent = visible.get(key(task.filePath, task.parentLine));
            if (parent) {
                depth = depthOf(parent) + 1;
            }
        }

        resolving.delete(taskKey);
        depths.set(taskKey, depth);
        return depth;
    };

    return tasks.map(task => {
        const depth = depthOf(task);
        return depth === task.indentLevel ? task : { ...task, indentLevel: depth };
    });
}
