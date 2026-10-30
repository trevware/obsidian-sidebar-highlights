/**
 * Reminders for tasks with a time.
 *
 * A reminder goes off at a task's time, or a set number of minutes before
 * it, while Obsidian is open. The device remembers when it last looked, so a
 * reminder that came due while Obsidian was closed or the computer slept
 * still shows once it's back, as long as the task's day hasn't ended, and a
 * restart never shows one twice. Kept free of Obsidian imports so it can be
 * unit tested directly; `src/managers/reminder-manager.ts` watches the notes
 * and delivers them.
 */

import { isoToday } from './dates';
import { editableTitle } from './task-line';
import { stripTasksPluginMetadata } from '../utils/task-metadata';

/** A task with a time, as much of it as a reminder needs. */
export interface TimedTask {
    path: string;
    line: number;
    /** The task's text as written, to find its line again and to title the reminder. */
    text: string;
    dateText?: string;
    /** The task's day, as an ISO date. */
    date: string;
    /** The task's time, as 24-hour HH:mm. */
    time: string;
}

export interface Reminder extends TimedTask {
    /** When it goes off, in milliseconds on this device's clock. */
    at: number;
}

/** How long before a task's time its reminder can go off, in minutes. */
export const REMINDER_LEADS = [0, 5, 10, 15, 30, 60];

/** Past this many at once, reminders arrive as one notification. */
export const SEPARATE_LIMIT = 3;

/** The longest wait between looks, so a computer waking from sleep catches up within a minute. */
export const LONGEST_WAIT = 60_000;

/** The moment a task's reminder goes off: its day and time on this device's clock, less the lead. */
export function reminderAt(date: string, time: string, leadMinutes: number): number {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minutes] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minutes - leadMinutes).getTime();
}

/** Every task's reminder, earliest first. */
export function remindersFor(tasks: Iterable<TimedTask>, leadMinutes: number): Reminder[] {
    const reminders: Reminder[] = [];
    for (const task of tasks) reminders.push({ ...task, at: reminderAt(task.date, task.time, leadMinutes) });
    return reminders.sort((a, b) => a.at - b.at);
}

/**
 * The reminders that came due after the last look and by now, earliest
 * first. One whose task's day is already over is dropped: by then the Tasks
 * tab shows it overdue, and a reminder would only be noise.
 */
export function dueBetween(reminders: readonly Reminder[], since: number, now: number): Reminder[] {
    const today = isoToday(new Date(now));
    return reminders.filter(reminder => reminder.at > since && reminder.at <= now && reminder.date >= today);
}

/** How long to wait before looking again: until the next reminder, and never more than a minute. */
export function nextWait(reminders: readonly Reminder[], now: number): number {
    const next = reminders.find(reminder => reminder.at > now);
    return next ? Math.min(next.at - now, LONGEST_WAIT) : LONGEST_WAIT;
}

/**
 * A task's words as a notification shows them: no date or time, no marker
 * link at the end, and links and formatting reduced to the words they show.
 */
export function reminderTitle(text: string, dateText: string | undefined, hideMetadata: boolean): string {
    let title = editableTitle(text, dateText);
    if (hideMetadata) title = stripTasksPluginMetadata(title);
    return title
        .replace(/%%.*?%%/g, '')
        .replace(/!?\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
        .replace(/!?\[\[([^\]]*)\]\]/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|__|==|~~|`/g, '')
        .replace(/\*(\S(?:[^*]*\S)?)\*/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}
