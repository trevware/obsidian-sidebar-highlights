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
