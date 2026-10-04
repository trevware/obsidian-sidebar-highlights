/**
 * The quiet-period write behind issue #126: a burst of highlight edits reaches
 * data.json as a single write.
 */

import { DeferredSave } from './deferred-save';

describe('DeferredSave', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('runs once after the quiet period, however many requests came in', () => {
        const run = jest.fn();
        const save = new DeferredSave(run, 1000);

        save.request();
        save.request();
        save.request();
        expect(run).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1000);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('restarts the quiet period on each request', () => {
        const run = jest.fn();
        const save = new DeferredSave(run, 1000);

        save.request();
        jest.advanceTimersByTime(800);
        save.request();
        jest.advanceTimersByTime(800);
        expect(run).not.toHaveBeenCalled();

        jest.advanceTimersByTime(200);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending run and says whether one was pending', () => {
        const run = jest.fn();
        const save = new DeferredSave(run, 1000);

        expect(save.cancel()).toBe(false);
        save.request();
        expect(save.cancel()).toBe(true);

        jest.advanceTimersByTime(5000);
        expect(run).not.toHaveBeenCalled();
    });

    it('flushes a pending run immediately, and only once', () => {
        const run = jest.fn();
        const save = new DeferredSave(run, 1000);

        save.request();
        save.flush();
        expect(run).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(5000);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('does nothing on flush when nothing is pending', () => {
        const run = jest.fn();
        new DeferredSave(run, 1000).flush();
        expect(run).not.toHaveBeenCalled();
    });
});
