import { FileSystemAdapter, TFile, TFolder, moment } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import type HighlightCommentsPlugin from '../../main';
import { SETTLE_MS } from '../calendar/plan';
import { TaskManager } from '../managers/task-manager';
import { thingsAvailable } from '../plus/plus-client';
import { formatTime } from '../tasks-view/times';
import { t } from '../i18n';
import { ScriptBridge, ThingsError } from './bridge';
import type { ThingsBridge } from './bridge';
import { deviceName, homeDir, nodeOwnerFs, nodeRunner } from './bridge-runner';
import { carryBlock } from './carry';
import { joinFirstConnect, withDeadline } from './join';
import { withThingsTags } from './mapping';
import type { Place, StateStamp, ThingsState, VaultSnapshot, VaultTask } from './model';
import { applyThingsEdits } from './note-edits';
import type { ThingsFormats } from './note-edits';
import { canConnect, ownerFile, readOwner, releaseOwner, writeOwner } from './owner';
import { planThingsSync } from './plan';
import type { ThingsNoteInfo } from './plan';
import { runThingsRound } from './round';
import type { ThingsRoundResult } from './round';
import { freshState, renameInState, stateFor } from './state';
import { vaultSnapshot } from './vault-snapshot';

/** This device's Things URL token, from Things → Settings → General → Enable Things URLs → Manage. */
const TOKEN_SECRET = 'sidebar-highlights-things-token';
const STATE_FILE = 'things-state.json';
/** How long after a note changes a round runs, so a burst of edits is one round. */
const SETTLE_DELAY_MS = 5_000;
/** How often a round runs to pick up changes made in Things, here or on the phone. */
const POLL_MS = 30_000;
/** A link that only asks Things its version: opening it starts Things in the background. */
const LAUNCH_LINK = 'things:///version';
/** How long to wait for Things to start, and how often to look. */
const LAUNCH_WAIT_MS = 10_000;
const LAUNCH_LOOK_MS = 500;

export interface ThingsStatus {
    state: 'off' | 'idle' | 'syncing' | 'problem' | 'elsewhere' | 'closed';
    message?: string;
    /** When the last round finished, in milliseconds. */
    at?: number;
    result?: ThingsRoundResult;
    /** The round stopped because this many synced items vanished from one side; the user can confirm it. */
    missing?: { side: 'things' | 'vault'; count: number };
}

const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const sleep = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

/**
 * Keeps the vault and Things in step, from Obsidian on the one Mac that
 * syncs for the vault: a round a few seconds after notes change, every 30
 * seconds, and when Obsidian comes back to the front. Also connects,
 * disconnects and hands syncing to another Mac.
 *
 * Nothing here runs, and Things is never started or asked anything, until
 * the vault is connected and this device is the one syncing. Things has to
 * be running to take in changes from the phone, so the plugin starts it in
 * the background when it isn't; if the user quits it, it stays closed until
 * they open it again, press Sync now, or restart Obsidian.
 */
export class ThingsSync {
    private status: ThingsStatus = { state: 'off' };
    private listeners = new Set<() => void>();
    private timer: number | null = null;
    private running: Promise<void> | null = null;
    private again = false;
    private started = false;
    private taskManager: TaskManager;
    /** Every note's lines, kept current from Obsidian's reports, so a round never reads the whole vault. */
    /** `seen` is when this Obsidian last saw the note change, which a note synced from another device can be newer than its mtime. */
    private cache = new Map<string, { lines: string[]; mtime: number; seen: number }>();
    private cacheReady = false;
    /** The settings that decide how notes are read, as the cache was read with. */
    private readWith = '';
    /** A round is planning from a snapshot: renames from now on wait for the state it hands back. */
    private planning = false;
    /** The state file as last read or written, so an unchanged state isn't written again. */
    private savedText = '';
    /** This Mac held Things for the vault, so it lets go when the vault disconnects from elsewhere. */
    private ownedHere = false;
    /** Text this plugin just wrote, so its own writes don't set off another round. */
    private ownWrites = new Map<string, string>();
    /** Notes this round renamed, which its own state already follows. */
    private ownRenames = new Set<string>();
    /** Renames the user made while a round ran, applied to the state the round hands back. */
    private pendingRenames: Array<{ from: string; to: string; folder: boolean }> = [];
    private state: ThingsState | null = null;
    private bridge: ThingsBridge | null = null;
    private wasRunning = false;
    private quitSeen = false;
    private acceptMissingNext = false;
    /** The user pressed Sync now or gave a new token: links paused after Things turned them away go out again. */
    private retryLinksNext = false;

    constructor(private plugin: HighlightCommentsPlugin) {
        this.taskManager = new TaskManager(plugin);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    start(): void {
        if (this.started || !thingsAvailable(this.plugin.app)) return;
        this.started = true;
        this.readWith = this.readSettings();
        const { app } = this.plugin;
        this.plugin.registerEvent(app.metadataCache.on('changed', (file, data) => this.noteChanged(file, data)));
        this.plugin.registerEvent(app.vault.on('rename', (file, oldPath) => void this.renamed(file, oldPath)));
        this.plugin.registerEvent(app.vault.on('delete', (file) => this.deleted(file)));
        this.plugin.registerInterval(window.setInterval(() => this.schedule(0), POLL_MS));
        this.plugin.registerDomEvent(window, 'focus', () => this.schedule(0));
        this.refreshStatus();
        this.schedule(0);
    }

    stop(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
        this.listeners.clear();
    }

    getStatus(): ThingsStatus {
        return this.status;
    }

    onStatus(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Settings changed: the notes are read again only when what decides the reading changed (excluded files, date format). */
    settingsChanged(): void {
        const readWith = this.readSettings();
        if (readWith !== this.readWith) {
            this.readWith = readWith;
            this.cache.clear();
            this.cacheReady = false;
        }
        this.schedule(SETTLE_DELAY_MS);
    }

    private readSettings(): string {
        const settings = this.plugin.settings;
        return JSON.stringify([settings.taskDateFormat, settings.excludeExcalidraw, settings.fileFilters, settings.hideTasksPluginMetadata]);
    }

    /** Forgets what this Mac remembered of an earlier connection: the state and the notes are read afresh. */
    private resetLocal(): void {
        this.state = null;
        this.savedText = '';
        this.cache.clear();
        this.cacheReady = false;
    }

    private setStatus(status: ThingsStatus): void {
        this.status = status;
        for (const listener of [...this.listeners]) listener();
    }

    /** Off when not connected, elsewhere when another Mac syncs; leaves a round's own status alone otherwise. */
    private refreshStatus(): void {
        const connection = this.plugin.settings.things;
        if (!connection && this.ownedHere) {
            // Disconnected from another device: this Mac lets go of Things and its token.
            this.ownedHere = false;
            this.releaseHere();
        }
        if (!connection) this.setStatus({ state: 'off' });
        else if (!this.isSyncingDevice()) this.setStatus({ state: 'elsewhere', message: t('things.status.elsewhere', { device: connection.device.name }) });
        else if (this.status.state === 'off' || this.status.state === 'elsewhere') this.setStatus({ state: 'idle' });
    }

    private active(): boolean {
        return this.started && Boolean(this.plugin.settings.things) && this.isSyncingDevice();
    }

    isSyncingDevice(): boolean {
        return this.plugin.settings.things?.device.install === this.install();
    }

    private install(): string {
        return this.plugin.calendarSync.plus.installId();
    }

    private schedule(delay: number): void {
        if (!this.active()) {
            this.refreshStatus();
            return;
        }
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            this.timer = null;
            void this.run();
        }, delay);
    }

    // ── Following the notes ─────────────────────────────────────────────

    /** Keeps the cache current whenever it's been read, so a round never plans from notes as they were days ago. */
    private noteChanged(file: TFile, content: string): void {
        if (!this.started || !this.cacheReady) return;
        if (!this.taskManager.shouldProcessFile(file)) {
            this.cache.delete(file.path);
            return;
        }
        this.cache.set(file.path, { lines: content.split(/\r?\n/), mtime: file.stat.mtime, seen: Date.now() });
        if (this.ownWrites.get(file.path) === content) {
            this.ownWrites.delete(file.path);
            return;
        }
        if (this.active()) this.schedule(SETTLE_DELAY_MS);
    }

    private deleted(file: TAbstractFile): void {
        for (const path of [...this.cache.keys()]) {
            if (path === file.path || path.startsWith(`${file.path}/`)) this.cache.delete(path);
        }
        if (this.active()) this.schedule(SETTLE_DELAY_MS);
    }

    private async renamed(file: TAbstractFile, oldPath: string): Promise<void> {
        const folder = file instanceof TFolder;
        for (const [path, entry] of [...this.cache]) {
            if (path === oldPath || (folder && path.startsWith(`${oldPath}/`))) {
                this.cache.delete(path);
                const moved = `${file.path}${path.slice(oldPath.length)}`;
                if (this.included(moved)) this.cache.set(moved, { ...entry, seen: Date.now() });
            }
        }
        // Only the Mac that syncs keeps the state.
        if (!this.active()) return;
        if (this.ownRenames.delete(oldPath)) return;
        if (this.planning) {
            this.pendingRenames.push({ from: oldPath, to: file.path, folder });
            return;
        }
        const state = await this.loadState();
        await this.saveState(renameInState(state, oldPath, file.path, folder));
        if (this.active()) this.schedule(SETTLE_DELAY_MS);
    }

    private async fillCache(): Promise<void> {
        if (this.cacheReady) return;
        const { vault } = this.plugin.app;
        this.readWith = this.readSettings();
        // Every note is read: Obsidian's index may not yet know about notes changed while it was closed.
        const now = Date.now();
        for (const file of vault.getMarkdownFiles()) {
            if (!this.taskManager.shouldProcessFile(file)) continue;
            const content = await vault.cachedRead(file);
            this.cache.set(file.path, { lines: content.split(/\r?\n/), mtime: file.stat.mtime, seen: now });
        }
        this.cacheReady = true;
    }

    private snapshot(): VaultSnapshot {
        const settings = this.plugin.settings;
        return vaultSnapshot(
            [...this.cache].map(([path, entry]) => ({ path, lines: entry.lines, mtime: entry.mtime })),
            {
                parse: (path, content) => this.taskManager.tasksInContent(path, content, true, true),
                hideMetadata: settings.hideTasksPluginMetadata,
                // Undated tasks stay undated in Things, daily notes included (see the design's Status).
                dailyDate: () => undefined
            }
        );
    }

    /** Whether a path is one the Tasks tab reads: not excluded in settings, and not an Excalidraw drawing. */
    private included(path: string): boolean {
        if (this.plugin.settings.excludeExcalidraw && path.endsWith('.excalidraw.md')) return false;
        return !this.taskManager.isFileExcluded(path);
    }

    private noteInfo(): ThingsNoteInfo {
        const { vault } = this.plugin.app;
        return {
            included: (path) => this.included(path),
            exists: (path) => vault.getAbstractFileByPath(path) instanceof TFile,
            // The later of the note's mtime and when this Obsidian saw it change, so a note
            // arriving from another device with an older mtime still waits out the settle.
            mtime: (path) => {
                const file = vault.getAbstractFileByPath(path);
                return Math.max(file instanceof TFile ? file.stat.mtime : 0, this.cache.get(path)?.seen ?? 0);
            }
        };
    }


    private formats(): ThingsFormats {
        const settings = this.plugin.settings;
        const dateFormat = settings.taskDateFormat || 'YYYY-MM-DD';
        return {
            date: (iso) => moment(iso, 'YYYY-MM-DD').format(dateFormat),
            time: (hhmm) => formatTime(hhmm, settings.taskTimeFormat),
            today: moment().format(dateFormat)
        };
    }

    // ── State ───────────────────────────────────────────────────────────

    private statePath(): string {
        return `${this.plugin.manifest.dir ?? ''}/${STATE_FILE}`;
    }

    private async loadState(): Promise<ThingsState> {
        if (this.state) return this.state;
        const adapter = this.plugin.app.vault.adapter;
        let text: string | null = null;
        try {
            if (await adapter.exists(this.statePath())) text = await adapter.read(this.statePath());
        } catch {
            text = null;
        }
        this.state = stateFor(text, this.stamp());
        this.savedText = text !== null && this.state.connection && JSON.stringify(this.state) === text ? text : '';
        return this.state;
    }

    /** Writes the state, stamped with this Mac and connection, unless nothing in it changed. */
    private async saveState(state: ThingsState): Promise<void> {
        const stamp = this.stamp();
        const next = stamp ? { ...state, connection: stamp } : state;
        this.state = next;
        const text = JSON.stringify(next);
        if (text === this.savedText) return;
        await this.plugin.app.vault.adapter.write(this.statePath(), text);
        this.savedText = text;
    }

    private stamp(): StateStamp | null {
        const connection = this.plugin.settings.things;
        return connection ? { install: connection.device.install, connectedAt: connection.connectedAt } : null;
    }

    // ── Talking to Things ───────────────────────────────────────────────

    private getBridge(): ThingsBridge {
        this.bridge ??= new ScriptBridge(nodeRunner());
        return this.bridge;
    }

    /** This device's Things URL token, when it has one. */
    token(): string | null {
        return this.plugin.app.secretStorage.getSecret(TOKEN_SECRET)?.trim() || null;
    }

    /** Whether Things is running, starting it in the background when it isn't and the user hasn't quit it. */
    private async thingsReady(bridge: ThingsBridge): Promise<'ready' | 'closed' | 'missing'> {
        if (await bridge.isRunning()) {
            this.wasRunning = true;
            this.quitSeen = false;
            return 'ready';
        }
        if (this.wasRunning || this.quitSeen) {
            this.wasRunning = false;
            this.quitSeen = true;
            return 'closed';
        }
        await bridge.open(LAUNCH_LINK);
        for (let waited = 0; waited < LAUNCH_WAIT_MS; waited += LAUNCH_LOOK_MS) {
            await sleep(LAUNCH_LOOK_MS);
            if (await bridge.isRunning()) {
                this.wasRunning = true;
                return 'ready';
            }
        }
        return 'missing';
    }

    // ── A round ─────────────────────────────────────────────────────────

    /** Runs a round now, starting Things again if the user had quit it. */
    syncNow(): Promise<void> {
        this.quitSeen = false;
        this.retryLinksNext = true;
        return this.run();
    }

    /** The user confirmed what vanished: the next round goes ahead with it. */
    confirmMissing(): Promise<void> {
        this.acceptMissingNext = true;
        return this.syncNow();
    }

    private run(): Promise<void> {
        if (this.running) {
            this.again = true;
            return this.running;
        }
        this.running = this.round().finally(() => {
            this.running = null;
            if (this.again) {
                this.again = false;
                this.schedule(0);
            }
        });
        return this.running;
    }

    private problem(message: string, extra: Partial<ThingsStatus> = {}): void {
        this.setStatus({ state: 'problem', message, at: this.status.at, ...extra });
    }

    private async round(): Promise<void> {
        if (!this.active()) {
            this.refreshStatus();
            return;
        }
        const plus = await this.plugin.refreshPlusStatus();
        if (plus.state !== 'active') return this.problem(plus.message ?? t('things.errors.noPlus'));
        const token = this.token();
        if (!token) return this.problem(t('things.errors.noToken'));

        const acceptMissing = this.acceptMissingNext;
        this.acceptMissingNext = false;
        const retryLinks = this.retryLinksNext;
        this.retryLinksNext = false;
        try {
            const bridge = this.getBridge();
            const ready = await this.thingsReady(bridge);
            if (ready === 'closed') return this.setStatus({ state: 'closed', message: t('things.status.closed'), at: this.status.at });
            if (ready === 'missing') return this.problem(t('things.errors.notInstalled'));
            await this.fillCache();
            const state = await this.loadState();
            this.ownedHere = true;
            this.planning = true;
            this.setStatus({ ...this.status, state: 'syncing' });
            const { result, state: next } = await runThingsRound({
                vault: this.snapshot(),
                state,
                bridge,
                token,
                now: Date.now(),
                fmt: this.formats(),
                notes: this.noteInfo(),
                acceptMissing,
                retryLinks,
                editNote: (path, steps) => this.editNote(path, steps),
                createNote: (path, content) => this.createNote(path, content),
                renameNote: (from, to) => this.renameNote(from, to),
                moveTaskBlock: (from, to) => this.moveTaskBlock(from, to),
                newMarker: () => `sidebar-highlights-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
                wait: sleep
            });
            let saved = next;
            for (const rename of this.pendingRenames.splice(0)) saved = renameInState(saved, rename.from, rename.to, rename.folder);
            await this.saveState(saved);
            if (result.stopped) {
                const key = result.stopped.side === 'things' ? 'things.errors.emptiedThings' : 'things.errors.emptiedVault';
                return this.problem(t(key, { count: result.stopped.missing }), { missing: { side: result.stopped.side, count: result.stopped.missing }, at: Date.now() });
            }
            if (result.failed) {
                return this.problem(this.messageFor(result.failed.kind, result.failed.message), { at: Date.now(), result });
            }
            this.setStatus({ state: 'idle', at: Date.now(), result });
        } catch (error) {
            this.pendingRenames.splice(0).forEach(rename => {
                if (this.state) this.state = renameInState(this.state, rename.from, rename.to, rename.folder);
            });
            if (this.state) await this.saveState(this.state);
            const kind = error instanceof ThingsError ? error.kind : 'other';
            this.problem(this.messageFor(kind, error instanceof Error ? error.message : String(error)));
        } finally {
            this.planning = false;
        }
    }

    private messageFor(kind: string, message: string): string {
        switch (kind) {
            case 'permission': return t('things.errors.permission');
            case 'not-installed': return t('things.errors.notInstalled');
            case 'urls-off': return t('things.errors.urlsOff');
            case 'timeout': return t('things.errors.timeout');
            default: return message;
        }
    }

    // ── Writing notes ───────────────────────────────────────────────────

    private file(path: string): TFile | null {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    /** Remembers a note the plugin just wrote, for the cache, the task index and its own change report. */
    private wrote(file: TFile, content: string): void {
        this.cache.set(file.path, { lines: content.split(/\r?\n/), mtime: file.stat.mtime, seen: Date.now() });
        this.ownWrites.set(file.path, content);
        this.plugin.taskIndex.noteWritten(file.path, content);
    }

    private async editNote(path: string, steps: Parameters<typeof applyThingsEdits>[1]): Promise<number> {
        const file = this.file(path);
        if (!file) return steps.length;
        let missed = 0;
        const fmt = this.formats();
        const written = await this.plugin.app.vault.process(file, (content) => {
            const eol = content.includes('\r\n') ? '\r\n' : '\n';
            const result = applyThingsEdits(content.split(/\r?\n/), steps, fmt);
            missed = result.missed;
            return result.lines.join(eol);
        });
        this.wrote(file, written);
        return missed;
    }

    private async ensureFolder(folder: string): Promise<void> {
        if (!folder) return;
        const { vault } = this.plugin.app;
        let path = '';
        for (const part of folder.split('/')) {
            path = path ? `${path}/${part}` : part;
            if (!vault.getAbstractFileByPath(path)) await vault.createFolder(path);
        }
    }

    private async createNote(path: string, content: string): Promise<void> {
        await this.ensureFolder(folderOf(path));
        const file = await this.plugin.app.vault.create(path, content);
        this.wrote(file, content);
    }

    private async renameNote(from: string, to: string): Promise<void> {
        const file = this.file(from);
        if (!file) throw new Error(t('things.errors.noteGone', { path: from }));
        await this.ensureFolder(folderOf(to));
        this.ownRenames.add(from);
        await this.plugin.app.fileManager.renameFile(file, to);
    }

    /**
     * Carries a task to another note. The line is added to the new note
     * before it leaves the old one, so a failure part way can only leave a
     * copy, which the next round sorts out, and never loses the line.
     */
    private async moveTaskBlock(from: VaultTask, to: Place): Promise<boolean> {
        const source = this.file(from.path);
        const target = this.file(to.path);
        if (!source || !target) return false;
        const { vault } = this.plugin.app;
        const sourceLines = (await vault.read(source)).split(/\r?\n/);
        let carried = false;
        const writtenTarget = await vault.process(target, (content) => {
            const eol = content.includes('\r\n') ? '\r\n' : '\n';
            const result = carryBlock(sourceLines, from, content.split(/\r?\n/), to.heading);
            if (!result) return content;
            carried = true;
            return result.to.join(eol);
        });
        if (!carried) return false;
        this.wrote(target, writtenTarget);
        const writtenSource = await vault.process(source, (content) => {
            const eol = content.includes('\r\n') ? '\r\n' : '\n';
            const result = carryBlock(content.split(/\r?\n/), from, [], undefined);
            return result ? result.from.join(eol) : content;
        });
        this.wrote(source, writtenSource);
        return true;
    }

    // ── Connecting ──────────────────────────────────────────────────────

    private vaultPath(): string {
        const adapter = this.plugin.app.vault.adapter;
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : this.plugin.app.vault.getName();
    }

    /** The vault Things is already synced with on this Mac, when it's another one. */
    ownerElsewhere(): string | null {
        const verdict = canConnect(readOwner(nodeOwnerFs(), ownerFile(homeDir())), this.vaultPath());
        return verdict.ok ? null : verdict.vaultName;
    }

    /**
     * What connecting would do: how many to-dos go to Things and how many
     * tasks come into the vault. Reads Things, and plans without changing
     * anything.
     */
    async preview(fresh = false): Promise<{ toThings: number; toVault: number }> {
        const bridge = this.getBridge();
        const ready = await this.thingsReady(bridge);
        if (ready !== 'ready') throw new ThingsError('not-installed', t('things.errors.notInstalled'));
        await this.fillCache();
        // Taking over plans the way the first round after it will: from a fresh state, the IDs on the lines joining up.
        const state = fresh ? freshState() : await this.loadState();
        const notes = this.noteInfo();
        const read = await bridge.read([]);
        const things = { ...read, todos: read.todos.map(withDeadline) };
        const vault = withThingsTags(this.snapshot(), things);
        const base = state.joined ? state : joinFirstConnect(vault, things, state, path => notes.exists(path));
        const plan = planThingsSync(vault, things, base, { now: Date.now(), settleMs: SETTLE_MS, notes });
        return plan.ok ? plan.counts : { toThings: 0, toVault: 0 };
    }

    /** Connects this vault, with this Mac syncing, and runs the first round. */
    async connect(token: string): Promise<void> {
        const owner = this.ownerElsewhere();
        if (owner) throw new Error(t('things.errors.otherVault', { vault: owner }));
        this.plugin.app.secretStorage.setSecret(TOKEN_SECRET, token.trim());
        writeOwner(nodeOwnerFs(), ownerFile(homeDir()), { vaultPath: this.vaultPath(), vaultName: this.plugin.app.vault.getName() });
        this.plugin.settings.things = { device: { install: this.install(), name: deviceName() }, connectedAt: Date.now() };
        await this.plugin.saveSettings();
        this.resetLocal();
        this.ownedHere = true;
        this.quitSeen = false;
        this.start();
        this.refreshStatus();
        void this.syncNow();
    }

    /** Makes this Mac the one that syncs, for a vault another Mac was syncing. */
    async takeOver(): Promise<void> {
        const connection = this.plugin.settings.things;
        if (!connection) return;
        const owner = this.ownerElsewhere();
        if (owner) throw new Error(t('things.errors.otherVault', { vault: owner }));
        writeOwner(nodeOwnerFs(), ownerFile(homeDir()), { vaultPath: this.vaultPath(), vaultName: this.plugin.app.vault.getName() });
        // A new connection stamp: whatever this Mac remembered from before is set aside, and the IDs on the lines join up again.
        this.plugin.settings.things = { device: { install: this.install(), name: deviceName() }, connectedAt: Date.now() };
        await this.plugin.saveSettings();
        this.resetLocal();
        this.ownedHere = true;
        this.refreshStatus();
        void this.syncNow();
    }

    /**
     * Stops syncing. Notes and Things stay exactly as they are; the IDs on
     * the lines and the saved state stay too, so reconnecting picks up where
     * it left off.
     */
    async disconnect(): Promise<void> {
        if (this.isSyncingDevice()) this.releaseHere();
        this.ownedHere = false;
        this.plugin.settings.things = null;
        await this.plugin.saveSettings();
        this.setStatus({ state: 'off' });
    }

    /** Lets go of Things on this Mac: the owner file, if this vault holds it, and the token. */
    private releaseHere(): void {
        this.plugin.app.secretStorage.setSecret(TOKEN_SECRET, '');
        releaseOwner(nodeOwnerFs(), ownerFile(homeDir()), this.vaultPath());
    }

    /** Whether this device has the Things URL token. */
    hasToken(): boolean {
        return Boolean(this.token());
    }

    setToken(token: string): void {
        this.plugin.app.secretStorage.setSecret(TOKEN_SECRET, token.trim());
        this.retryLinksNext = true;
    }
}
