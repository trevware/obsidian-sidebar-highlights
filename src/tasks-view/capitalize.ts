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

/** The letter each field had before it was capitalized for you, while that capital stands. */
const raised = new WeakMap<HTMLInputElement | HTMLTextAreaElement, string>();

/**
 * Capitalizes the first letter in a field the moment it's typed. The word
 * is judged again with every key, as typed, so one that turns out to be an
 * iPhone or a web address goes back to how it was written. The caret stays
 * put.
 */
export function capitalizeTyped(field: HTMLInputElement | HTMLTextAreaElement): void {
    const value = field.value;
    const match = value.match(/^\s*[*_~=("'“‘]*/u);
    const at = match ? match[0].length : 0;
    // The word as it was typed: the capital given to it is taken back first.
    const original = raised.get(field);
    const upper = original?.toUpperCase();
    const typed = original && upper && value.startsWith(upper, at)
        ? value.slice(0, at) + original + value.slice(at + upper.length)
        : value;
    const next = capitalizeFirst(typed);
    if (next !== typed) raised.set(field, typed.slice(at, at + 1));
    else raised.delete(field);
    if (next === value) return;
    const shift = next.length - value.length;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    field.value = next;
    field.setSelectionRange(Math.max(at, start + shift), Math.max(at, end + shift));
}
