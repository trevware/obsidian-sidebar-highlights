/**
 * Obsidian's own highlight colours (issue #130).
 *
 * Since Obsidian 1.14 a colour emoji at the very start of a highlight tints it in
 * the note: `==🔵text==` renders blue, with the emoji hidden. These helpers read
 * that marker exactly the way Obsidian does: only the first character after the
 * opening `==` counts, and the circle and square of each colour are equivalent.
 *
 * The colour is stored on the highlight as the theme's colour variable, the same
 * one Obsidian paints its swatch with, so the sidebar matches the note in any
 * theme. The highlight's stored text keeps the emoji, because every lookup that
 * finds a highlight in its note rebuilds `==text==` from it; only what the
 * sidebar shows drops it.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

export type NoteColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

// Mirrors Obsidian 1.14's marker table
const MARKER_COLORS: Record<string, NoteColor> = {
    '🔴': 'red', '🟥': 'red',
    '🟠': 'orange', '🟧': 'orange',
    '🟡': 'yellow', '🟨': 'yellow',
    '🟢': 'green', '🟩': 'green',
    '🔵': 'blue', '🟦': 'blue',
    '🟣': 'purple', '🟪': 'purple'
};

// The emoji Obsidian itself inserts for each colour
const COLOR_EMOJI: Record<NoteColor, string> = {
    red: '🔴',
    orange: '🟠',
    yellow: '🟡',
    green: '🟢',
    blue: '🔵',
    purple: '🟣'
};

const NOTE_COLOR_VALUE = /^var\(--color-(red|orange|yellow|green|blue|purple)\)$/;

export interface ColorMarker {
    color: NoteColor;
    /** Length of the emoji in UTF-16 units, for slicing it off the text. */
    length: number;
}

/** The colour marker leading a highlight's inner text, if it has one. */
export function parseColorMarker(text: string): ColorMarker | null {
    const codePoint = text.codePointAt(0);
    if (codePoint === undefined) return null;

    const firstChar = String.fromCodePoint(codePoint);
    const color = MARKER_COLORS[firstChar];
    return color ? { color, length: firstChar.length } : null;
}

/** The text with its leading colour marker removed. */
export function stripColorMarker(text: string): string {
    const marker = parseColorMarker(text);
    return marker ? text.slice(marker.length) : text;
}

/** The value a note colour is stored as: the theme's colour variable. */
export function noteColorValue(color: NoteColor): string {
    return `var(--color-${color})`;
}

/** Which note colour a stored colour value is, or null for any other colour. */
export function noteColorName(value: string | undefined): NoteColor | null {
    const match = value ? NOTE_COLOR_VALUE.exec(value.trim()) : null;
    return match ? match[1] as NoteColor : null;
}

/**
 * Menu label for a note colour. The emoji keeps it apart from the palette slot
 * of the same name, which is a different colour.
 */
export function noteColorLabel(color: NoteColor): string {
    return `${COLOR_EMOJI[color]} ${color.charAt(0).toUpperCase()}${color.slice(1)}`;
}

/**
 * The colour a markdown highlight takes on detection. The note owns a marked
 * highlight's colour, so the emoji wins over one picked in the sidebar; once the
 * emoji is gone, so is the colour it set.
 */
export function detectedHighlightColor(text: string, existingColor: string | undefined): string | undefined {
    const marker = parseColorMarker(text);
    if (marker) return noteColorValue(marker.color);
    return noteColorName(existingColor) ? undefined : existingColor;
}

/** Whether a highlight is an `==` highlight, the only kind Obsidian colours. */
export function isMarkdownHighlight(highlight: { type?: string; isNativeComment?: boolean }): boolean {
    // Highlights stored before types were recorded are all `==` highlights
    return (highlight.type === 'highlight' || highlight.type === undefined) && !highlight.isNativeComment;
}

/** The text the sidebar shows for a highlight. */
export function highlightDisplayText(highlight: { text: string; type?: string; isNativeComment?: boolean }): string {
    return isMarkdownHighlight(highlight) ? stripColorMarker(highlight.text) : highlight.text;
}
