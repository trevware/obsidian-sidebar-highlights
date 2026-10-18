/**
 * The "Minimum character count" setting, shared by the sidebar's filters and the
 * status bar counter so both agree on what counts as a highlight.
 *
 * Only highlights and native comments are held to it; custom pattern matches
 * always pass. Kept free of Obsidian imports so it can be unit tested directly.
 */
export function meetsMinimumCharacterCount(
    highlight: { type?: string; isNativeComment?: boolean; text: string },
    minimum: number
): boolean {
    if (minimum <= 0) return true;
    const isHeldToMinimum = highlight.type === 'highlight' || highlight.type === 'html' || !!highlight.isNativeComment;
    return !isHeldToMinimum || highlight.text.length >= minimum;
}
