/**
 * Regression cover for issue #126: a note changed by a sync tool while it was
 * open got its highlights written to data.json by the receiving device too.
 */

import { matchesDiskText } from './change-origin';

describe('matchesDiskText', () => {
    const saved = '# Brakes\n\nThe ==master cylinder== feeds both circuits.\n';

    it('matches right after a change is loaded from disk', () => {
        expect(matchesDiskText(saved, saved)).toBe(true);
    });

    it('does not match unsaved typing', () => {
        expect(matchesDiskText(saved.replace('both', 'the two'), saved)).toBe(false);
    });

    it('matches a file saved with Windows line endings', () => {
        expect(matchesDiskText(saved, saved.replace(/\n/g, '\r\n'))).toBe(true);
    });

    it('does not match typing in a file saved with Windows line endings', () => {
        expect(matchesDiskText(saved + 'more', saved.replace(/\n/g, '\r\n'))).toBe(false);
    });

    it('treats a view with nothing loaded as typing', () => {
        expect(matchesDiskText(saved, undefined)).toBe(false);
        expect(matchesDiskText(saved, null)).toBe(false);
    });
});
