/**
 * Naming and normalising highlight colours for the colour filter.
 *
 * Colours reach a highlight from three directions: the five configurable palette
 * slots, arbitrary values carried by HTML highlights (`<font color>`,
 * `<span style="background">`, Highlightr's `<mark>`), and the vault default for
 * highlights that never had one set. The filter has to treat `#FFD700`, `#ffd700`
 * and a highlight with no colour at all as the same bucket, or the menu sprouts
 * duplicate entries that each match half the highlights.
 *
 * Kept free of Obsidian imports so it can be unit tested directly.
 */

export interface ColorPalette {
    customColors: Record<string, string>;
    customColorNames: Record<string, string>;
}

/**
 * The colour a highlight is filtered by.
 *
 * The fallback to the vault default mirrors how grouping by colour resolves it,
 * so a colour group and a colour filter always agree on which rows belong.
 */
export function resolveHighlightColor(color: string | undefined, defaultColor: string): string {
    return normalizeColor(color || defaultColor);
}

/** Lowercase, and expand `#abc` to `#aabbcc`, so one colour is never two buckets. */
export function normalizeColor(color: string): string {
    const lower = color.trim().toLowerCase();
    const shorthand = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(lower);
    if (shorthand) {
        const [, r, g, b] = shorthand;
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    return lower;
}

/**
 * A human label for a colour: the user's own name for that palette slot, else the
 * slot's name, else the raw value for colours that live outside the palette.
 */
export function colorLabel(color: string, palette: ColorPalette): string {
    const normalized = normalizeColor(color);

    for (const [slot, slotColor] of Object.entries(palette.customColors)) {
        if (normalizeColor(slotColor) !== normalized) continue;
        const custom = palette.customColorNames[slot]?.trim();
        return custom || slot.charAt(0).toUpperCase() + slot.slice(1);
    }

    return normalized;
}
