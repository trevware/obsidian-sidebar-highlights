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

/** Running parent state while scanning a file's task lines top to bottom. */
export interface TaskNestingState {
    parentIndentLevel: number | undefined;
    parentIsVisible: boolean;
}

export function createTaskNestingState(): TaskNestingState {
    return { parentIndentLevel: undefined, parentIsVisible: false };
}

/** Clear parent tracking, e.g. at a heading or an unindented non-task line. */
export function resetTaskNesting(state: TaskNestingState): void {
    state.parentIndentLevel = undefined;
    state.parentIsVisible = false;
}

/**
 * Resolve a task's effective indent level and advance parent tracking.
 *
 * Two rules matter here:
 *
 * 1. Every task line advances the state, including ones hidden by the
 *    completed-task filter, so nesting follows the file's real structure.
 * 2. A sub-task only stays nested if its parent is actually rendered. If the
 *    parent is absent or hidden, the sub-task is promoted to top level rather
 *    than attaching to whichever task happened to be the previous visible one —
 *    which could be an unrelated task much earlier in the file.
 *
 * @param rawIndentLevel Indent level derived from leading whitespace
 * @param isVisible Whether this task will actually be rendered
 * @param state Running state, mutated in place
 * @returns The effective indent level to store on the task
 */
export function resolveTaskNesting(
    rawIndentLevel: number,
    isVisible: boolean,
    state: TaskNestingState
): number {
    let indentLevel = rawIndentLevel;

    if (indentLevel > 0 && (state.parentIndentLevel === undefined || !state.parentIsVisible)) {
        indentLevel = 0;
    }

    if (indentLevel === 0 ||
        (state.parentIndentLevel !== undefined && indentLevel <= state.parentIndentLevel)) {
        state.parentIndentLevel = indentLevel;
        state.parentIsVisible = isVisible;
    }

    return indentLevel;
}
