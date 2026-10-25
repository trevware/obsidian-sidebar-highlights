/**
 * How the Tasks tab draws each alternate checkbox: the Lucide icon that sits
 * inside the squircle and the theme colour it takes. The markers themselves,
 * and the fact that every one is an open task, come from task-status.ts.
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

export type MarkerTone = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export interface MarkerDef {
    char: string;
    /** Translation key under tasksTab.markers, and the data-marker value. */
    id: string;
    icon: string;
    tone: MarkerTone;
}

export const MARKER_DEFS: readonly MarkerDef[] = [
    { char: '>', id: 'forwarded', icon: 'forward', tone: 'blue' },
    { char: '<', id: 'scheduling', icon: 'calendar-clock', tone: 'blue' },
    { char: '!', id: 'important', icon: 'alert-triangle', tone: 'orange' },
    { char: '*', id: 'star', icon: 'star', tone: 'yellow' },
    { char: '"', id: 'quote', icon: 'quote', tone: 'gray' },
    { char: 'l', id: 'location', icon: 'map-pin', tone: 'red' },
    { char: 'b', id: 'bookmark', icon: 'bookmark', tone: 'orange' },
    { char: 'i', id: 'information', icon: 'info', tone: 'blue' },
    { char: 'S', id: 'savings', icon: 'dollar-sign', tone: 'green' },
    { char: 'I', id: 'idea', icon: 'lightbulb', tone: 'yellow' },
    { char: 'p', id: 'pros', icon: 'thumbs-up', tone: 'green' },
    { char: 'c', id: 'cons', icon: 'thumbs-down', tone: 'red' },
    { char: 'f', id: 'fire', icon: 'flame', tone: 'red' },
    { char: 'k', id: 'key', icon: 'key', tone: 'yellow' },
    { char: 'w', id: 'win', icon: 'trophy', tone: 'purple' },
    { char: 'u', id: 'up', icon: 'trending-up', tone: 'green' },
    { char: 'd', id: 'down', icon: 'trending-down', tone: 'red' }
];

const BY_CHAR = new Map(MARKER_DEFS.map(def => [def.char, def]));

/** The alternate marker a checkbox carries, or undefined for the core states and priorities. */
export function markerDef(char: string | undefined): MarkerDef | undefined {
    return char === undefined ? undefined : BY_CHAR.get(char);
}
