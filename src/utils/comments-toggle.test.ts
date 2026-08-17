/**
 * Regression cover for the "Toggle highlight comments" button latching on.
 *
 * The button used to derive its next state purely from whether any highlight was
 * currently expanded. In a vault where no highlight has a comment, that check is
 * permanently false, so every click computed `!false` and the button turned on and
 * stayed on — `commentsExpanded: true` was written to data.json on every click.
 */

import { isCommentsToggleOn, nextCommentsToggleState } from './comments-toggle';

describe('comments toggle with no commentable highlights', () => {
    const NONE = { anyExpanded: false, hasToggleable: false };

    it('turns off again after being turned on', () => {
        expect(nextCommentsToggleState(true, NONE.anyExpanded, NONE.hasToggleable)).toBe(false);
    });

    it('turns back on from off', () => {
        expect(nextCommentsToggleState(false, NONE.anyExpanded, NONE.hasToggleable)).toBe(true);
    });

    it('alternates over repeated clicks instead of latching', () => {
        let expanded = false;
        const states: boolean[] = [];
        for (let i = 0; i < 4; i++) {
            expanded = nextCommentsToggleState(expanded, NONE.anyExpanded, NONE.hasToggleable);
            states.push(expanded);
        }
        expect(states).toEqual([true, false, true, false]);
    });

    it('reports its own state, so the icon and active style follow the clicks', () => {
        expect(isCommentsToggleOn(true, NONE.anyExpanded, NONE.hasToggleable)).toBe(true);
        expect(isCommentsToggleOn(false, NONE.anyExpanded, NONE.hasToggleable)).toBe(false);
    });
});

describe('comments toggle with commentable highlights', () => {
    it('collapses everything when something is expanded', () => {
        expect(nextCommentsToggleState(true, true, true)).toBe(false);
    });

    it('expands everything when nothing is expanded', () => {
        expect(nextCommentsToggleState(false, false, true)).toBe(true);
    });

    it('still collapses when a comment was expanded by hand while the button read off', () => {
        expect(nextCommentsToggleState(false, true, true)).toBe(false);
        expect(isCommentsToggleOn(false, true, true)).toBe(true);
    });

    it('still expands when the last open comment was closed by hand while the button read on', () => {
        expect(nextCommentsToggleState(true, false, true)).toBe(true);
        expect(isCommentsToggleOn(true, false, true)).toBe(false);
    });
});
