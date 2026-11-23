/**
 * The heading swap, carried out. Things can't add a heading to a project, so
 * a project whose note's headings changed is rebuilt:
 *
 * 1. A new project with the note's headings, in the same area and with the
 *    same title, made by a `json` link and found by a marker in its notes.
 * 2. Every to-do the note has there moved across, each under its heading
 *    (`list-id` goes with `heading=`, as Things asks), keeping its ID. Then
 *    everything else still in the old project, done and cancelled to-dos
 *    too, under its heading when the new project has it.
 * 3. The old project, now empty, to the Trash. If done to-dos wouldn't move
 *    it is completed instead, so it goes to the Logbook with its history;
 *    an open to-do still in it (one added since the read) keeps it as it is.
 *
 * If an open to-do won't move, everything moved is put back and the new
 * project goes to the Trash, so the old one is left as it was for the next
 * round to try again. The new project is trashed only once it's empty.
 *
 * Things' own order within a heading isn't touched: reordering isn't
 * possible yet (`Capabilities.reorder` is always false).
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

import { ThingsError } from './bridge';
import { updateLink } from './links';
import type { ThingsStep } from './plan';
import type { Round } from './round';

/** Every to-do in a project, done and cancelled ones too, none trashed. */
async function todoIds(round: Round, projectId: string): Promise<string[]> {
    const listed: unknown = JSON.parse((await round.run({ kind: 'projectTodoIds', id: projectId })) ?? '[]');
    if (!Array.isArray(listed)) throw new ThingsError('other', `Things listed project ${projectId}'s to-dos as ${String(listed)}`);
    return listed.map(String);
}

/** The heading a to-do sits under in Things: as read, or as last written when this Things can't show headings. */
function headingOf(round: Round, id: string): string | undefined {
    if (round.caps.headings) return round.todoById.get(id)?.heading;
    return round.base.todos.find(todo => todo.id === id)?.place.heading;
}

/** Open as read. A to-do the read didn't list is in the Logbook. */
const isOpen = (round: Round, id: string): boolean => round.todoById.get(id)?.fields.status === 'open';

export async function swapProject(round: Round, step: Extract<ThingsStep, { kind: 'swapProject' }>): Promise<boolean> {
    const old = step.id;
    const now = round.projectNow.get(old);
    const sp = round.next.projects.find(p => p.id === old);
    const title = now?.title ?? sp?.title ?? '';
    const made = await round.makeProject(title, step.headings, now?.areaId, { path: step.path, swapOf: old, notes: round.notesOf(old) });

    /** The to-dos moved into the new project, each with the heading it got there. */
    const moved = new Map<string, string | undefined>();
    const place = async (id: string, heading?: string): Promise<void> => {
        await round.run({ kind: 'moveTodo', id, projectId: made });
        moved.set(id, undefined);
        // Always a link, so an earlier link this round can't pull the to-do elsewhere after the script moved it.
        await round.open(updateLink(id, { 'list-id': made, ...(heading === undefined ? {} : { heading }) }, round.deps.token));
        moved.set(id, heading);
    };
    try {
        for (const entry of step.order) await place(entry.id, entry.heading);
        for (const id of await todoIds(round, old)) {
            if (moved.has(id)) continue;
            const heading = headingOf(round, id);
            try {
                await place(id, heading !== undefined && step.headings.includes(heading) ? heading : undefined);
            } catch (error) {
                // A done to-do that won't move stays, and the old project is completed instead of trashed.
                if (isOpen(round, id) || round.halts(error)) throw error;
            }
        }
    } catch (error) {
        if (await putBack(round, moved, old, made)) round.settle(made);
        throw error;
    }
    await retireOld(round, old);
    round.settle(made);

    if (sp) {
        sp.id = made;
        sp.headings = [...step.headings];
    }
    round.headingsIn.set(made, [...step.headings]);
    round.projectNow.set(made, { title, ...(now?.areaId === undefined ? {} : { areaId: now.areaId }) });
    round.newProjects.add(made);
    // A heading Things can show counts once a read confirms it, so a heading link Things turned away is sent again.
    moved.forEach((heading, id) => round.placed.set(id, heading === undefined || round.caps.headings ? { path: step.path } : { path: step.path, heading }));
    return true;
}

/** The old project after the move: trashed when empty, completed when only done to-dos are left, else left as it is. */
async function retireOld(round: Round, old: string): Promise<void> {
    let left: string[];
    try {
        left = await todoIds(round, old);
    } catch (error) {
        round.fail(error);
        return;
    }
    if (left.length === 0) {
        try {
            await round.run({ kind: 'deleteProject', id: old });
            return;
        } catch (error) {
            round.fail(error);
        }
    } else if (left.some(id => isOpen(round, id))) {
        round.fail(new ThingsError('other', `The old project ${old} still holds open to-dos, so it stays`));
        return;
    }
    try {
        await round.run({ kind: 'setProject', id: old, status: 'completed' });
    } catch (error) {
        round.fail(error);
    }
}

/**
 * A swap that failed: every to-do moved goes back under its heading, then the
 * new project, once empty, to the Trash. True when everything went back and
 * the new project is gone; otherwise a later round finishes the job.
 */
async function putBack(round: Round, moved: Map<string, string | undefined>, old: string, made: string): Promise<boolean> {
    let stuck = false;
    for (const id of [...moved.keys()].reverse()) {
        try {
            await round.run({ kind: 'moveTodo', id, projectId: old });
            const heading = headingOf(round, id);
            await round.open(updateLink(id, { 'list-id': old, ...(heading === undefined ? {} : { heading }) }, round.deps.token));
        } catch {
            stuck = true;
        }
    }
    if (stuck) return false;
    try {
        await round.run({ kind: 'deleteProject', id: made });
        return true;
    } catch {
        // An empty project stays in Things; nothing in it is lost, and a later round trashes it.
        return false;
    }
}
