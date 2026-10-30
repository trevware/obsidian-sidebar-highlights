import { TFile } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import type { Task } from '../../main';
import { TaskManager } from './task-manager';
import { readCalendarRef } from '../calendar/ids';

/** Why the index changed: a few notes, or every note read again. */
export interface IndexChange {
    /** The notes whose tasks changed; empty after a full read. */
    paths: string[];
    /** Notes deleted, whose tasks went with them. */
    deleted: string[];
}

/**
 * Every task in the vault with a date or a calendar ID, kept current as
 * notes change, for reminders and calendar sync to share. Done and
 * cancelled tasks are kept too: calendar sync needs them to remove their
 * events. Reads the notes once at startup and then follows Obsidian's own
 * reports of what changed, so nothing reads the whole vault twice.
 */
export class TaskIndex {
    private plugin: HighlightCommentsPlugin;
    private taskManager: TaskManager;
    private byFile = new Map<string, Task[]>();
    private listeners = new Set<(change: IndexChange) => void>();
    private ready = false;
    /** Bumped by each full read of the notes, so an older one still running stops. */
    private generation = 0;
    private started = false;
    /** The settings that decide which notes are read and how dates are found, as last read. */
    private readWith = '';

    constructor(plugin: HighlightCommentsPlugin, private wanted: () => boolean) {
        this.plugin = plugin;
        this.taskManager = new TaskManager(plugin);
    }

    /** Starts following the notes. Call once the workspace is ready. */
    start(): void {
        if (this.started) return;
        this.started = true;
        const { app } = this.plugin;
        this.plugin.registerEvent(app.metadataCache.on('changed', (file, data) => this.noteChanged(file, data)));
        this.plugin.registerEvent(app.vault.on('delete', (file) => this.forget(file.path, true)));
        this.plugin.registerEvent(app.vault.on('rename', (file, oldPath) => {
            this.forget(oldPath, false);
            if (file instanceof TFile) void this.readNote(file);
        }));
        void this.reload();
    }

    stop(): void {
        this.generation++;
        this.listeners.clear();
    }

    /** Every note has been read, so the index is complete. */
    isReady(): boolean {
        return this.ready;
    }

    tasks(): Task[] {
        return [...this.byFile.values()].flat();
    }

    onChange(listener: (change: IndexChange) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Catches up with the settings: reads every note again when what decides
     * the reading changed, or when the index went from unwanted to wanted.
     */
    settingsChanged(): void {
        if (!this.started) return;
        const readWith = this.readSettings();
        if (!this.wanted()) {
            if (this.ready || this.byFile.size) {
                this.generation++;
                this.byFile.clear();
                this.ready = false;
            }
            return;
        }
        if (!this.ready || readWith !== this.readWith) void this.reload();
    }

    private readSettings(): string {
        const settings = this.plugin.settings;
        return JSON.stringify([settings.taskDateFormat, settings.excludeExcalidraw, settings.fileFilters]);
    }

    private emit(change: IndexChange): void {
        if (!this.ready) return;
        for (const listener of [...this.listeners]) listener(change);
    }

    private async reload(): Promise<void> {
        const generation = ++this.generation;
        this.ready = false;
        this.byFile.clear();
        this.readWith = this.readSettings();
        if (!this.wanted()) return;

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
        this.emit({ paths: [], deleted: [] });
    }

    private async readNote(file: TFile): Promise<void> {
        if (!this.wanted() || !this.taskManager.shouldProcessFile(file)) return;
        const generation = this.generation;
        const content = await this.plugin.app.vault.cachedRead(file);
        if (generation !== this.generation) return;
        if (this.index(file.path, content)) this.emit({ paths: [file.path], deleted: [] });
    }

    private noteChanged(file: TFile, content: string): void {
        if (!this.wanted()) return;
        const changed = this.taskManager.shouldProcessFile(file) ? this.index(file.path, content) : this.byFile.delete(file.path);
        if (changed) this.emit({ paths: [file.path], deleted: [] });
    }

    private forget(path: string, deleted: boolean): void {
        if (this.byFile.delete(path)) this.emit({ paths: [path], deleted: deleted ? [path] : [] });
    }

    /** Reads one note's tasks. Returns whether they changed. */
    private index(path: string, content: string): boolean {
        const kept = this.taskManager.tasksInContent(path, content, true, false)
            .filter(task => task.date || readCalendarRef(task.text));
        const before = this.byFile.get(path) ?? [];
        const signature = (tasks: Task[]) => tasks.map(task => `${task.lineNumber}\u0000${task.status}\u0000${task.text}`).join('\n');
        if (kept.length) this.byFile.set(path, kept);
        else this.byFile.delete(path);
        return signature(before) !== signature(kept);
    }
}
