import { ColorPalette, colorLabel, resolveHighlightColor } from './color-labels';

const PALETTE: ColorPalette = {
    customColors: {
        yellow: '#ffd700',
        red: '#ff6b6b',
        teal: '#4ecdc4',
        blue: '#45b7d1',
        green: '#96ceb4'
    },
    customColorNames: {
        yellow: '',
        red: 'Blocker',
        teal: '',
        blue: '',
        green: ''
    }
};

describe('resolveHighlightColor', () => {
    it('uses the highlight own colour', () => {
        expect(resolveHighlightColor('#ff6b6b', '#ffd700')).toBe('#ff6b6b');
    });

    it('falls back to the vault default when the highlight has none', () => {
        // Matches how grouping by colour resolves it, so the two agree
        expect(resolveHighlightColor(undefined, '#ffd700')).toBe('#ffd700');
        expect(resolveHighlightColor('', '#ffd700')).toBe('#ffd700');
    });

    it('normalises case so one colour is not treated as two', () => {
        expect(resolveHighlightColor('#FFD700', '#ffd700')).toBe('#ffd700');
    });

    it('expands shorthand hex to its six-digit form', () => {
        expect(resolveHighlightColor('#F00', '#ffd700')).toBe('#ff0000');
    });
});

describe('colorLabel', () => {
    it('prefers the user custom name', () => {
        expect(colorLabel('#ff6b6b', PALETTE)).toBe('Blocker');
    });

    it('falls back to the palette slot name when no custom name is set', () => {
        expect(colorLabel('#ffd700', PALETTE)).toBe('Yellow');
    });

    it('matches regardless of hex case', () => {
        expect(colorLabel('#FFD700', PALETTE)).toBe('Yellow');
    });

    it('shows the raw value for a colour outside the palette', () => {
        // HTML highlights carry arbitrary colours from <font>, <span> and Highlightr
        expect(colorLabel('#835cf5', PALETTE)).toBe('#835cf5');
    });
});
