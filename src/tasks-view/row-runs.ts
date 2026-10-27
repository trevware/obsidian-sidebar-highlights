/**
 * Marks a task row in a given state (selected, or lifted by a drag) whose
 * next row is in the same state, so the run of rows draws as one card. The
 * row's bottom corners square off where the next one joins it. A heading in
 * between splits the run.
 */
export function paintRun(row: Element | null | undefined, state: 'is-selected' | 'is-dragging'): void {
    if (!(row instanceof HTMLElement) || !row.hasClass('sh-task-row')) return;
    const next = row.nextElementSibling;
    const joins = row.hasClass(state) && next instanceof HTMLElement && next.hasClass('sh-task-row') && next.hasClass(state);
    row.toggleClass(`joins-${state}`, joins);
}
