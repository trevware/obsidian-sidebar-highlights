/**
 * Starts a task's words with a capital letter, for Settings → Tasks →
 * Capitalize tasks. Leading emphasis and quotes are stepped over. A link, a
 * tag, code, a web address, or a word that already mixes cases (iPhone, eBay)
 * is left as written.
 */
export function capitalizeFirst(text: string): string {
    const match = text.match(/^(\s*[*_~=("'“‘]*)(\p{Ll})(\S*)/u);
    if (!match) return text;
    const [, lead, letter, rest] = match;
    if (/\p{Lu}/u.test(rest)) return text;
    if (/^[\p{L}\d+.-]*:\/\//u.test(letter + rest) || /^www\./i.test(letter + rest)) return text;
    return `${lead}${letter.toUpperCase()}${text.slice(lead.length + letter.length)}`;
}

/**
 * Capitalizes the first word in a field once it's typed, the way macOS does:
 * the space after the word is the cue. Waiting for the whole word lets an
 * iPhone or a web address be seen for what it is and left alone, and it works
 * whatever the keyboard does with `autocapitalize`. The caret stays put.
 */
export function capitalizeTyped(field: HTMLInputElement | HTMLTextAreaElement): void {
    const value = field.value;
    if (!/^\s*\S+\s/.test(value)) return;
    const next = capitalizeFirst(value);
    if (next === value) return;
    const shift = next.length - value.length;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    field.value = next;
    field.setSelectionRange(start + shift, end + shift);
}
