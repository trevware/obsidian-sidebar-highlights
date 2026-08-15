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
