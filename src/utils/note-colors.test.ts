import {
    parseColorMarker,
    stripColorMarker,
    noteColorValue,
    noteColorName,
    noteColorLabel,
    detectedHighlightColor,
    highlightDisplayText
} from './note-colors';

describe('parseColorMarker', () => {
    it('reads each of the six circle emoji as its colour', () => {
        expect(parseColorMarker('🔴text')?.color).toBe('red');
        expect(parseColorMarker('🟠text')?.color).toBe('orange');
        expect(parseColorMarker('🟡text')?.color).toBe('yellow');
        expect(parseColorMarker('🟢text')?.color).toBe('green');
        expect(parseColorMarker('🔵text')?.color).toBe('blue');
        expect(parseColorMarker('🟣text')?.color).toBe('purple');
    });

    it('reads the square emoji too, as Obsidian does', () => {
        expect(parseColorMarker('🟥text')?.color).toBe('red');
        expect(parseColorMarker('🟧text')?.color).toBe('orange');
        expect(parseColorMarker('🟨text')?.color).toBe('yellow');
        expect(parseColorMarker('🟩text')?.color).toBe('green');
        expect(parseColorMarker('🟦text')?.color).toBe('blue');
        expect(parseColorMarker('🟪text')?.color).toBe('purple');
    });

    it('reports the marker length in UTF-16 units so it can be sliced off', () => {
        expect(parseColorMarker('🔵text')?.length).toBe(2);
    });

    it('only counts an emoji in the very first position', () => {
        // Obsidian checks the first character after == and nothing else
        expect(parseColorMarker(' 🔵text')).toBeNull();
        expect(parseColorMarker('text 🔵')).toBeNull();
    });

    it('ignores emoji that are not highlight colours', () => {
        expect(parseColorMarker('⚫text')).toBeNull();
        expect(parseColorMarker('🟤text')).toBeNull();
        expect(parseColorMarker('😀text')).toBeNull();
    });

    it('returns null for plain and empty text', () => {
        expect(parseColorMarker('text')).toBeNull();
        expect(parseColorMarker('')).toBeNull();
    });
});

describe('stripColorMarker', () => {
    it('drops a leading colour emoji', () => {
        expect(stripColorMarker('🔵text')).toBe('text');
    });

    it('keeps whatever follows the emoji, spaces included', () => {
        // Obsidian slices the emoji alone and renders the rest as written
        expect(stripColorMarker('🔵 text')).toBe(' text');
    });

    it('drops only the first emoji', () => {
        expect(stripColorMarker('🔵🔴text')).toBe('🔴text');
    });

    it('leaves text without a marker alone', () => {
        expect(stripColorMarker('text 🔵')).toBe('text 🔵');
    });
});

describe('noteColorValue / noteColorName', () => {
    it('stores a note colour as the theme colour variable', () => {
        expect(noteColorValue('blue')).toBe('var(--color-blue)');
    });

    it('recognises a stored note colour', () => {
        expect(noteColorName('var(--color-purple)')).toBe('purple');
    });

    it('does not mistake palette or HTML colours for note colours', () => {
        expect(noteColorName('#45b7d1')).toBeNull();
        expect(noteColorName('blue')).toBeNull();
        expect(noteColorName(undefined)).toBeNull();
    });
});

describe('noteColorLabel', () => {
    it('labels a note colour with its emoji and name', () => {
        expect(noteColorLabel('blue')).toBe('🔵 Blue');
        expect(noteColorLabel('orange')).toBe('🟠 Orange');
    });
});

describe('detectedHighlightColor', () => {
    it('takes the colour from the emoji', () => {
        expect(detectedHighlightColor('🟢text', undefined)).toBe('var(--color-green)');
    });

    it('lets the emoji win over a colour picked in the sidebar', () => {
        expect(detectedHighlightColor('🟢text', '#ff6b6b')).toBe('var(--color-green)');
    });

    it('follows the note when the emoji changes', () => {
        expect(detectedHighlightColor('🔴text', 'var(--color-green)')).toBe('var(--color-red)');
    });

    it('drops the note colour once the emoji is removed', () => {
        expect(detectedHighlightColor('text', 'var(--color-green)')).toBeUndefined();
    });

    it('keeps a colour picked in the sidebar when there is no emoji', () => {
        expect(detectedHighlightColor('text', '#ff6b6b')).toBe('#ff6b6b');
        expect(detectedHighlightColor('text', undefined)).toBeUndefined();
    });
});

describe('highlightDisplayText', () => {
    it('hides the emoji on a markdown highlight', () => {
        expect(highlightDisplayText({ type: 'highlight', text: '🔵text' })).toBe('text');
    });

    it('treats highlights stored before types existed as markdown highlights', () => {
        expect(highlightDisplayText({ text: '🔵text' })).toBe('text');
    });

    it('leaves comments, HTML highlights and custom patterns as written', () => {
        // Obsidian only colours == highlights
        expect(highlightDisplayText({ type: 'comment', isNativeComment: true, text: '🔵text' })).toBe('🔵text');
        expect(highlightDisplayText({ type: 'html', text: '🔵text' })).toBe('🔵text');
        expect(highlightDisplayText({ type: 'custom', text: '🔵text' })).toBe('🔵text');
    });
});
