import { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';

/**
 * Opens a note at a line: in the tab already showing it, else a new tab, or
 * beside the current one when asked. The cursor lands at the end of the line.
 */
export async function openNoteAt(app: App, path: string, line?: number, split = false): Promise<void> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    let leaf: WorkspaceLeaf | null = null;
    if (!split) {
        leaf = app.workspace.getLeavesOfType('markdown')
            .find(candidate => (candidate.view as MarkdownView).file?.path === path) ?? null;
    }
    if (!leaf) leaf = split ? app.workspace.getLeaf('split', 'vertical') : app.workspace.getLeaf('tab');

    await leaf.openFile(file, { active: true });
    app.workspace.setActiveLeaf(leaf, { focus: true });

    const view = leaf.view;
    if (line === undefined || !(view instanceof MarkdownView)) return;
    if (view.getMode() === 'preview') {
        view.setEphemeralState({ line });
        return;
    }
    const editor = view.editor;
    const safeLine = Math.min(line, editor.lineCount() - 1);
    const ch = editor.getLine(safeLine).length;
    editor.setCursor({ line: safeLine, ch });
    editor.scrollIntoView({ from: { line: safeLine, ch: 0 }, to: { line: safeLine, ch } }, true);
}
