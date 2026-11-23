/**
 * Runs the bridge's scripts and links on the Mac: osascript for JXA, `open -g`
 * for things:/// links so Things stays in the background, and pgrep to see
 * whether Things is running. Failures come back as `ThingsError`s.
 *
 * `child_process` is loaded only inside `nodeRunner`, behind the macOS
 * desktop check, so Obsidian on a phone never evaluates it. Not unit tested:
 * everything here talks to Things.
 */

/* global require -- Node's require, which Obsidian's desktop app provides */
import { Platform } from 'obsidian';
import { ThingsError, thingsErrorFrom } from './bridge';
import type { Runner } from './bridge';
import type { OwnerFs } from './owner';

type ExecFile = (
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
    done: (error: Error | null, stdout: string, stderr: string) => void
) => unknown;

/** A read prints every to-do with its notes; leave plenty of room. */
const MAX_OUTPUT = 64 * 1024 * 1024;
const OPEN_TIMEOUT_MS = 10_000;
const PGREP_TIMEOUT_MS = 5_000;

/** `child_process`'s execFile, loaded only in Obsidian's desktop app on a Mac so mobile never evaluates it. */
function loadExecFile(): ExecFile {
    if (Platform.isDesktop && Platform.isDesktopApp && Platform.isMacOS) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- the guarded require() obsidianmd/no-nodejs-modules asks for; an import would load on mobile
        const childProcess = require('child_process') as { execFile: ExecFile };
        return childProcess.execFile;
    }
    throw new ThingsError('other', 'Things sync runs only in Obsidian on a Mac');
}

export function nodeRunner(): Runner {
    const execFile = loadExecFile();
    const run = (file: string, args: string[], timeout: number): Promise<string> => new Promise((resolve, reject) => {
        execFile(file, args, { timeout, maxBuffer: MAX_OUTPUT }, (error, stdout, stderr) => {
            if (error) reject(thingsErrorFrom(error, String(stderr ?? '')));
            else resolve(String(stdout));
        });
    });
    return {
        jxa: (script, timeoutMs) => run('osascript', ['-l', 'JavaScript', '-e', script], timeoutMs),
        open: async url => { await run('open', ['-g', url], OPEN_TIMEOUT_MS); },
        running: () => new Promise(resolve => {
            execFile('pgrep', ['-x', 'Things3'], { timeout: PGREP_TIMEOUT_MS, maxBuffer: MAX_OUTPUT }, error => resolve(error === null));
        })
    };
}

interface NodeFs {
    readFileSync(path: string, encoding: 'utf8'): string;
    writeFileSync(path: string, text: string, encoding: 'utf8'): void;
    mkdirSync(path: string, options: { recursive: boolean }): void;
    rmSync(path: string, options: { force: boolean }): void;
}

interface NodeOs {
    homedir(): string;
    hostname(): string;
}

/** Node's fs and os, loaded only in Obsidian's desktop app on a Mac, like `child_process` above. */
function loadNode(): { fs: NodeFs; os: NodeOs } {
    if (Platform.isDesktop && Platform.isDesktopApp && Platform.isMacOS) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- guarded like loadExecFile; an import would load on mobile
        const fs = require('fs') as NodeFs;
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- guarded like loadExecFile; an import would load on mobile
        const os = require('os') as NodeOs;
        return { fs, os };
    }
    throw new ThingsError('other', 'Things sync runs only in Obsidian on a Mac');
}

/** The Mac user's home folder, where the file naming the vault that owns Things lives. */
export function homeDir(): string {
    return loadNode().os.homedir();
}

/** This Mac's name, shown on other devices as the one syncing with Things. */
export function deviceName(): string {
    return loadNode().os.hostname().replace(/\.local$/, '');
}

/** The owner file's reads and writes, on this Mac's disk. */
export function nodeOwnerFs(): OwnerFs {
    const { fs } = loadNode();
    return {
        read: (path) => {
            try {
                return fs.readFileSync(path, 'utf8');
            } catch {
                return null;
            }
        },
        write: (path, text) => {
            fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
            fs.writeFileSync(path, text, 'utf8');
        },
        remove: (path) => fs.rmSync(path, { force: true })
    };
}
