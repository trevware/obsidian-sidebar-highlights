/**
 * Intl's date formatters, kept once they're made. A list of hundreds of rows
 * asks for the same few on every redraw, and building one costs far more
 * than using it. Kept free of Obsidian imports so it can be unit tested
 * directly.
 */

const made = new Map<string, Intl.DateTimeFormat>();

export function dateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale ?? ''}\u0000${JSON.stringify(options)}`;
    let formatter = made.get(key);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, options);
        made.set(key, formatter);
    }
    return formatter;
}
