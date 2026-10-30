import { Notice, Platform, TFile } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import { TaskManager } from './task-manager';
import { dueLabel, isoToday, nowTime } from '../tasks-view/dates';
import { locateTaskLine } from '../tasks-view/task-line';
import { openNoteAt } from '../tasks-view/open-note';
import { dueBetween, nextWait, reminderTitle, remindersFor, SEPARATE_LIMIT } from '../tasks-view/reminders';
import type { Reminder, TimedTask } from '../tasks-view/reminders';
import { t } from '../i18n';

interface AppliedSettings {
    enabled: boolean;
    lead: number;
    /** What decides which tasks are read and how their dates are found. */
    notes: string;
}

/** Where this device keeps the moment it last looked for reminders. */
const LAST_LOOK_KEY = 'sidebar-highlights-reminders-last-look';

/**
 * Watches every note for tasks with a time and shows each one's reminder
 * when it comes due: a notification from the computer on desktop, and a
 * notice inside Obsidian on a phone or tablet, which can't show
 * notifications for plugins. Only works while Obsidian is open.
 */
export class ReminderManager {
    private plugin: HighlightCommentsPlugin;
    private taskManager: TaskManager;
    /** Each note's tasks with a time, by path. */
    private timedTasks = new Map<string, TimedTask[]>();
    private reminders: Reminder[] = [];
    private timer: number | null = null;
    /** Every note has been read, so a look sees every reminder. */
    private ready = false;
    /** Bumped by each full read of the notes, so an older one still running stops. */
    private generation = 0;
    /** The settings reminders depend on, as they stood when last applied. */
    private applied: AppliedSettings | null = null;

    constructor(plugin: HighlightCommentsPlugin) {
        this.plugin = plugin;
        this.taskManager = new TaskManager(plugin);
    }

    /** Starts watching the notes. Call once the workspace is ready. */
    start(): void {
        const { app } = this.plugin;
        this.plugin.registerEvent(app.metadataCache.on('changed', (file, data) => this.noteChanged(file, data)));
        this.plugin.registerEvent(app.vault.on('delete', (file) => this.forget(file.path)));
        this.plugin.registerEvent(app.vault.on('rename', (file, oldPath) => {
            this.forget(oldPath);
            if (file instanceof TFile) void this.readNote(file);
        }));
        this.applied = this.appliedSettings();
        void this.reload();
    }

    stop(): void {
        this.generation++;
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
        if (now.enabled !== was.enabled || now.notes !== was.notes) void this.reload();
        else if (now.lead !== was.lead && now.enabled) this.rebuild();
    }

    /** Shows a sample reminder, so you can check that notifications get through. */
    sendTest(): void {
        this.show(t('reminders.test.title'), t('reminders.test.body'), () => undefined);
    }

    // ── Reading the notes ───────────────────────────────────────────────

    private appliedSettings(): AppliedSettings {
        const settings = this.plugin.settings;
        return {
            enabled: settings.taskReminders,
            lead: settings.taskReminderLead,
            notes: JSON.stringify([settings.taskDateFormat, settings.excludeExcalidraw, settings.fileFilters])
        };
    }

    /** Reads every note again. */
    private async reload(): Promise<void> {
        const generation = ++this.generation;
        this.clearTimer();
        this.ready = false;
        this.timedTasks.clear();
        this.reminders = [];
        if (!this.plugin.settings.taskReminders) return;

        const { vault, metadataCache } = this.plugin.app;
        for (const file of vault.getMarkdownFiles()) {
            if (!this.taskManager.shouldProcessFile(file)) continue;
            // A note with no list items has no tasks, so it isn't worth reading.
            const cache = metadataCache.getFileCache(file);
            if (cache && !cache.listItems?.length) continue;
            const content = await vault.cachedRead(file);
            if (generation !== this.generation) return;
            this.index(file.path, content);
        }
        this.ready = true;
        this.rebuild();
    }

    private async readNote(file: TFile): Promise<void> {
        if (!this.plugin.settings.taskReminders || !this.taskManager.shouldProcessFile(file)) return;
        const generation = this.generation;
        const content = await this.plugin.app.vault.cachedRead(file);
        if (generation !== this.generation) return;
        this.index(file.path, content);
        if (this.ready) this.rebuild();
    }

    private noteChanged(file: TFile, content: string): void {
        if (!this.plugin.settings.taskReminders) return;
        if (this.taskManager.shouldProcessFile(file)) this.index(file.path, content);
        else this.timedTasks.delete(file.path);
        if (this.ready) this.rebuild();
    }

    private forget(path: string): void {
        if (this.timedTasks.delete(path) && this.ready) this.rebuild();
    }

    /** Notes the open tasks with a time in one note. Done and cancelled tasks have no reminder. */
    private index(path: string, content: string): void {
        const timed: TimedTask[] = [];
        for (const task of this.taskManager.tasksInContent(path, content, false, false)) {
            if (!task.date || !task.time) continue;
            timed.push({ path, line: task.lineNumber, text: task.text, dateText: task.dateText, date: task.date, time: task.time });
        }
        if (timed.length) this.timedTasks.set(path, timed);
        else this.timedTasks.delete(path);
    }

    // ── Timing ──────────────────────────────────────────────────────────

    private rebuild(): void {
        this.reminders = remindersFor([...this.timedTasks.values()].flat(), this.plugin.settings.taskReminderLead);
        this.look();
    }

    /** Shows what came due since the last look, then waits for the next one. */
    private look(): void {
        this.clearTimer();
        if (!this.ready) return;
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
