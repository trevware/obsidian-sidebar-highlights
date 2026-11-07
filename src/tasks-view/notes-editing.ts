/**
 * Typing notes as plain Markdown in a text box: the keys the task card's
 * notes and quick add's notes share. Enter continues a list, Tab indents,
 * and ⌘B and ⌘I wrap the selection.
 */

/** Enter inside a list item starts the next item, or ends the list on an empty one. */
export function continueList(editor: HTMLTextAreaElement): boolean {
    const { value, selectionStart, selectionEnd } = editor;
    if (selectionStart !== selectionEnd) return false;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const line = value.slice(lineStart, selectionStart);
    const match = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[.\]\s+)?/);
    if (!match) return false;
    if (line.trim() === match[0].trim()) {
        // An empty item: the list ends here.
        editor.setRangeText('', lineStart, selectionStart, 'end');
        return true;
    }
    const [, indent, bullet, space, box] = match;
    const next = /\d/.test(bullet) ? `${parseInt(bullet, 10) + 1}${bullet.slice(-1)}` : bullet;
    editor.setRangeText(`\n${indent}${next}${space}${box ? '[ ] ' : ''}`, selectionStart, selectionEnd, 'end');
    return true;
}

/** Tab and Shift-Tab indent or outdent every line the selection touches. */
export function indentSelection(editor: HTMLTextAreaElement, outdent: boolean): void {
    const { value, selectionStart, selectionEnd } = editor;
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const end = selectionEnd;
    const block = value.slice(start, end);
    const lines = block.split('\n');
    const changed = lines.map(line => (outdent ? line.replace(/^( {1,4}|\t)/, '') : `    ${line}`));
    const text = changed.join('\n');
    editor.setRangeText(text, start, end, 'select');
    if (selectionStart === selectionEnd) {
        const shift = text.length - block.length;
        editor.setSelectionRange(Math.max(start, selectionStart + shift), Math.max(start, selectionStart + shift));
    }
}

/** ⌘B and ⌘I: wrap the selection in Markdown emphasis, or unwrap it. */
export function wrapSelection(editor: HTMLTextAreaElement, mark: string): void {
    const { value, selectionStart, selectionEnd } = editor;
    const selected = value.slice(selectionStart, selectionEnd);
    const before = value.slice(selectionStart - mark.length, selectionStart);
    const after = value.slice(selectionEnd, selectionEnd + mark.length);
    if (before === mark && after === mark) {
        editor.setRangeText(selected, selectionStart - mark.length, selectionEnd + mark.length, 'select');
        return;
    }
    editor.setRangeText(`${mark}${selected}${mark}`, selectionStart, selectionEnd, 'end');
    if (selected === '') editor.setSelectionRange(selectionStart + mark.length, selectionStart + mark.length);
}
