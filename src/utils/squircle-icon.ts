/**
 * Squircle task checkboxes.
 *
 * Lucide ships a `squircle` icon but only as a bare outline — there is no
 * `squircle-check` / `-minus` / `-slash` to pair with the checkbox states. Its
 * path does however occupy exactly the same 18x18 footprint as the `square`
 * family's `<rect x=3 y=3 width=18 height=18 rx=2>`, so swapping the rect for
 * that path after setIcon() gives every square state a squircle outline while
 * leaving the inner glyph, the stroke, currentColor and the toggle animations
 * untouched.
 *
 * This is deliberately not done in CSS: `rx` is settable on a `<rect>`, but a
 * rect can only ever produce circular corners, and CSS cannot substitute one
 * SVG element for another.
 *
 * Kept free of Obsidian imports so it can be unit tested directly — call it
 * immediately after setIcon().
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lucide's `squircle` outline, verbatim. */
export const SQUIRCLE_PATH = 'M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9';

/**
 * Replace a freshly-set `square`-family icon's outline with a squircle.
 *
 * Icons without a `<rect>` (the `circle` family used by sub-tasks, and
 * `circle-help`) are left exactly as Lucide draws them.
 */
export function squircleifyIcon(el: HTMLElement): void {
    const rect = el.querySelector('svg > rect');
    if (!rect) return;

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', SQUIRCLE_PATH);
    rect.replaceWith(path);
}
