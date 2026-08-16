/**
 * @jest-environment jsdom
 *
 * The fixtures below are the markup Obsidian's setIcon() actually produces for
 * these Lucide icons (verified against the bundled icon table), so this test
 * fails if that markup ever changes shape.
 */

import { squircleifyIcon, SQUIRCLE_PATH } from './squircle-icon';

const RECT = '<rect width="18" height="18" x="3" y="3" rx="2"></rect>';

function icon(inner: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="svg-icon">${inner}</svg>`;
    return el;
}

const outlineD = (el: HTMLElement) => el.querySelector('svg > path')?.getAttribute('d');

describe('squircleifyIcon', () => {
    it('replaces the square outline with the squircle path', () => {
        const el = icon(RECT);
        squircleifyIcon(el);

        expect(el.querySelector('rect')).toBeNull();
        expect(outlineD(el)).toBe(SQUIRCLE_PATH);
    });

    it('keeps square-check\'s glyph, and keeps the outline painted first', () => {
        const el = icon(`${RECT}<path d="m9 12 2 2 4-4"></path>`);
        squircleifyIcon(el);

        const ds = [...el.querySelectorAll('svg > path')].map(p => p.getAttribute('d'));
        expect(ds).toEqual([SQUIRCLE_PATH, 'm9 12 2 2 4-4']);
    });

    it('keeps square-slash\'s <line> glyph', () => {
        const el = icon(`${RECT}<line x1="9" y1="15" x2="15" y2="9"></line>`);
        squircleifyIcon(el);

        expect(el.querySelector('line')).not.toBeNull();
        expect(outlineD(el)).toBe(SQUIRCLE_PATH);
    });

    it('keeps square-minus\'s glyph', () => {
        const el = icon(`${RECT}<path d="M8 12h8"></path>`);
        squircleifyIcon(el);

        const ds = [...el.querySelectorAll('svg > path')].map(p => p.getAttribute('d'));
        expect(ds).toEqual([SQUIRCLE_PATH, 'M8 12h8']);
    });

    it('leaves the circle family (sub-tasks) untouched', () => {
        const el = icon('<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>');
        squircleifyIcon(el);

        expect(el.querySelector('circle')).not.toBeNull();
        expect(outlineD(el)).toBe('m9 12 2 2 4-4');
    });

    it('is a no-op when setIcon rendered nothing', () => {
        const el = document.createElement('div');
        expect(() => squircleifyIcon(el)).not.toThrow();
        expect(el.innerHTML).toBe('');
    });

    it('is idempotent across repeated toggles', () => {
        const el = icon(RECT);
        squircleifyIcon(el);
        squircleifyIcon(el);

        expect(el.querySelectorAll('svg > path')).toHaveLength(1);
        expect(outlineD(el)).toBe(SQUIRCLE_PATH);
    });

    it('creates the path in the SVG namespace so it renders', () => {
        const el = icon(RECT);
        squircleifyIcon(el);

        expect(el.querySelector('svg > path')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });
});
