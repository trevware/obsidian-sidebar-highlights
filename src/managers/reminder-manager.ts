import { Notice, Platform, TFile } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import type { TaskIndex } from './task-index';
import { dueLabel, isoToday, nowTime } from '../tasks-view/dates';
import { locateTaskLine } from '../tasks-view/task-line';
import { openNoteAt } from '../tasks-view/open-note';
import { dueBetween, nextWait, reminderTitle, remindersFor, SEPARATE_LIMIT } from '../tasks-view/reminders';
import type { Reminder, TimedTask } from '../tasks-view/reminders';
import { t } from '../i18n';

interface AppliedSettings {
    enabled: boolean;
    lead: number;
}

/** Where this device keeps the moment it last looked for reminders. */
const LAST_LOOK_KEY = 'sidebar-highlights-reminders-last-look';

/**
 * Shows each task's reminder when it comes due: a notification from the
 * computer on desktop, and a notice inside Obsidian on a phone or tablet,
 * which can't show notifications for plugins. Only works while Obsidian is
 * open. The tasks come from the shared task index.
 */
export class ReminderManager {
    private plugin: HighlightCommentsPlugin;
    private index: TaskIndex;
    private reminders: Reminder[] = [];
    private timer: number | null = null;
    private unsubscribe: (() => void) | null = null;
    /** The settings reminders depend on, as they stood when last applied. */
    private applied: AppliedSettings | null = null;

    constructor(plugin: HighlightCommentsPlugin, index: TaskIndex) {
        this.plugin = plugin;
        this.index = index;
    }

    /** Starts following the task index. Call once the workspace is ready. */
    start(): void {
        this.applied = this.appliedSettings();
        this.unsubscribe = this.index.onChange(() => this.rebuild());
        this.rebuild();
    }

    stop(): void {
        this.unsubscribe?.();
        this.clearTimer();
    }

    /**
     * Catches up with a change to the settings reminders depend on, from the
     * settings tab or from another device.
     */
    settingsChanged(): void {
        const was = this.applied;
        const now = this.appliedSettings();
        this.applied = now;
        if (!was) return;
        // Turned on: start from now, so reminders that went by while it was off stay quiet.
        if (now.enabled && !was.enabled) this.saveLastLook(Date.now());
        if (now.enabled !== was.enabled || now.lead !== was.lead) this.rebuild();
    }

    /** Shows a sample reminder, so you can check that notifications get through. */
    sendTest(): void {
        this.show(t('reminders.test.title'), t('reminders.test.body'), () => undefined);
    }

    private appliedSettings(): AppliedSettings {
        return { enabled: this.plugin.settings.taskReminders, lead: this.plugin.settings.taskReminderLead };
    }

    /** Open tasks with a time. Done and cancelled tasks have no reminder. */
    private timedTasks(): TimedTask[] {
        const timed: TimedTask[] = [];
        for (const task of this.index.tasks()) {
            if (!task.date || !task.time || task.status === 'done' || task.status === 'cancelled') continue;
            timed.push({ path: task.filePath, line: task.lineNumber, text: task.text, dateText: task.dateText, date: task.date, time: task.time });
        }
        return timed;
    }

    // ── Timing ──────────────────────────────────────────────────────────

    private rebuild(): void {
        const ready = this.plugin.settings.taskReminders && this.index.isReady();
        this.reminders = ready ? remindersFor(this.timedTasks(), this.plugin.settings.taskReminderLead) : [];
        if (ready) this.look();
        else this.clearTimer();
    }

    /** Shows what came due since the last look, then waits for the next one. */
    private look(): void {
        this.clearTimer();
        const now = Date.now();
        const due = dueBetween(this.reminders, this.lastLook(now), now);
        this.saveLastLook(now);
        if (due.length) this.deliver(due);
        this.timer = window.setTimeout(() => this.look(), nextWait(this.reminders, now));
    }

    private clearTimer(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    /** When this device last looked. The first time ever, now, so nothing old shows. */
    private lastLook(now: number): number {
        const stored = Number(this.plugin.app.loadLocalStorage(LAST_LOOK_KEY));
        return Number.isFinite(stored) && stored > 0 ? Math.min(stored, now) : now;
    }

    private saveLastLook(now: number): void {
        this.plugin.app.saveLocalStorage(LAST_LOOK_KEY, String(now));
    }

    // ── Showing them ────────────────────────────────────────────────────

    private deliver(due: Reminder[]): void {
        if (due.length > SEPARATE_LIMIT) {
            this.show(
                t('reminders.many', { count: due.length }),
                due.map(reminder => this.title(reminder)).join(', '),
                () => void this.plugin.activateTasksTab()
            );
            return;
        }
        for (const reminder of due) this.show(this.title(reminder), this.detail(reminder), () => void this.open(reminder));
    }

    private title(reminder: Reminder): string {
        return reminderTitle(reminder.text, reminder.dateText, this.plugin.settings.hideTasksPluginMetadata) || t('reminders.untitled');
    }

    /** The task's time, its day when that isn't today, and its note: "15:00 · Inbox". */
    private detail(reminder: Reminder): string {
        const today = isoToday();
        const due = dueLabel(reminder.date, reminder.time, {
            today,
            now: nowTime(),
            words: {
                today: t('tasksTab.dates.today'),
                tomorrow: t('tasksTab.dates.tomorrow'),
                yesterday: t('tasksTab.dates.yesterday')
            },
            hour12: this.plugin.settings.taskTimeFormat === 'h:mma',
            showDay: reminder.date !== today
        });
        const note = reminder.path.split('/').pop()?.replace(/\.md$/, '') ?? reminder.path;
        return `${due.text} · ${note}`;
    }

    /**
     * A notification from the computer where there is one, and otherwise a
     * notice that stays inside Obsidian until it's tapped.
     */
    private show(title: string, body: string, onClick: () => void): void {
        if (!Platform.isMobile && typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
            const notification = new Notification(title, { body });
            notification.onclick = () => {
                window.focus();
                onClick();
                notification.close();
            };
            return;
        }
        const message = createFragment(fragment => {
            fragment.createDiv({ cls: 'sh-reminder-title', text: title });
            fragment.createDiv({ cls: 'sh-reminder-detail', text: body });
        });
        const notice = new Notice(message, 0);
        notice.containerEl.addClass('sh-reminder-notice');
        notice.messageEl.addEventListener('click', onClick);
    }

    /** Opens the task's note at its line, found again if the note has shifted since. */
    private async open(reminder: Reminder): Promise<void> {
        const { app } = this.plugin;
        const file = app.vault.getAbstractFileByPath(reminder.path);
        if (!(file instanceof TFile)) return;
        const found = locateTaskLine((await app.vault.cachedRead(file)).split('\n'), reminder.line, reminder.text);
        await openNoteAt(app, reminder.path, found === -1 ? reminder.line : found);
    }
}
