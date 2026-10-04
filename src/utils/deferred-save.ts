/**
 * A write that waits for a quiet spell, so a burst of highlight edits reaches
 * data.json as a single write (issue #126).
 *
 * Every request restarts the wait. A direct save makes a pending one redundant
 * and cancels it, and so does settings arriving from another device, since the
 * pending write would only send them straight back.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */
export class DeferredSave {
    private timer: number | null = null;

    constructor(private readonly run: () => void, private readonly delayMs: number) {}

    /** Schedule the write, or push a scheduled one back to a full delay from now. */
    request(): void {
        this.cancel();
        this.timer = window.setTimeout(() => {
            this.timer = null;
            this.run();
        }, this.delayMs);
    }

    /** Drop a scheduled write. Returns whether one was waiting. */
    cancel(): boolean {
        if (this.timer === null) {
            return false;
        }
        window.clearTimeout(this.timer);
        this.timer = null;
        return true;
    }

    /** Run a scheduled write now. Does nothing if none is waiting. */
    flush(): void {
        if (this.cancel()) {
            this.run();
        }
    }
}
