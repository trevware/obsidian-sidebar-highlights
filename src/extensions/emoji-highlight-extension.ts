/**
 * CodeMirror 6 editor extension that decorates emoji-prefixed highlights
 * (e.g. ==🟥Important text==) with:
 *
 * 1. A background-color mark matching the configured color slot.
 * 2. A Decoration.replace that hides the emoji character — unless the
 *    cursor is currently inside that highlight range, mirroring how
 *    Obsidian's live preview hides `==` markers until focused.
 * 3. Plain ==highlights== without emoji get the default color slot's
 *    background when a default color is configured.
 *
 * Registration:  plugin.registerEditorExtension(extensionArray)
 * Reactivity:    mutate the array contents + app.workspace.updateOptions()
 */

import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
} from '@codemirror/view';
import { Extension, Range } from '@codemirror/state';
import { type ColorSlotKey, type EmojiColorMappings, buildEmojiToColorSlotMap, detectEmojiPrefix } from '../utils/emoji-utils';

// ── Public config type ──────────────────────────────────────────────

export interface EmojiHighlightConfig {
    emojiColorMappings: EmojiColorMappings;
    /** hex colors keyed by slot */
    customColors: Record<ColorSlotKey, string>;
    /** slot whose color is "default" — plain ==text== without emoji gets this color */
    defaultColorSlot: 'none' | ColorSlotKey;
}

// ── Pre-built decoration marks (one per color slot) ─────────────────

const colorMarkDecos: Record<ColorSlotKey, Decoration> = {
    yellow: Decoration.mark({ class: 'sh-editor-highlight-yellow' }),
    red:    Decoration.mark({ class: 'sh-editor-highlight-red' }),
    teal:   Decoration.mark({ class: 'sh-editor-highlight-teal' }),
    blue:   Decoration.mark({ class: 'sh-editor-highlight-blue' }),
    green:  Decoration.mark({ class: 'sh-editor-highlight-green' }),
};

/** Replaces a range with nothing — used to visually hide the emoji character. */
const hideEmoji = Decoration.replace({});

// ── Highlight regex (same as main.ts) ───────────────────────────────

const HIGHLIGHT_RE = /==((?:[^=]|=[^=])+?)==/g;

// ── Build decorations ───────────────────────────────────────────────

function buildDecorations(view: EditorView, config: EmojiHighlightConfig): DecorationSet {
    const emojiMap = buildEmojiToColorSlotMap(config.emojiColorMappings);

    const ranges: Range<Decoration>[] = [];

    // Collect all selection ranges for cursor-intersection checks
    const selRanges = view.state.selection.ranges;

    // Resolve the default-slot decoration (for plain ==text== without emoji)
    const defaultDeco = config.defaultColorSlot !== 'none'
        ? colorMarkDecos[config.defaultColorSlot]
        : null;

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        HIGHLIGHT_RE.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = HIGHLIGHT_RE.exec(text)) !== null) {
            const innerText = match[1];                       // text between == markers
            const matchStart = from + match.index;            // absolute offset of first =
            const matchEnd = matchStart + match[0].length;    // absolute offset past last =
            const innerStart = matchStart + 2;                // past opening ==
            const innerEnd = matchEnd - 2;                    // before closing ==

            if (innerStart >= innerEnd) continue;

            const { slot, emojiLength } = emojiMap.size > 0
                ? detectEmojiPrefix(innerText, emojiMap)
                : { slot: undefined, emojiLength: 0 };

            if (slot) {
                // ── Emoji-prefixed highlight: use the emoji's color ──
                // Cover the full ==...== range including markers
                ranges.push(colorMarkDecos[slot].range(matchStart, matchEnd));

                // Hide emoji when cursor is NOT inside this highlight
                if (emojiLength > 0) {
                    const emojiFrom = innerStart;
                    const emojiTo = innerStart + emojiLength;
                    const cursorInside = selRanges.some(
                        r => r.from < matchEnd && r.to > matchStart
                    );
                    if (!cursorInside && emojiFrom < emojiTo) {
                        ranges.push(hideEmoji.range(emojiFrom, emojiTo));
                    }
                }
            } else if (defaultDeco) {
                // ── Plain ==text== without emoji: apply default color ──
                // Cover the full ==...== range including markers
                ranges.push(defaultDeco.range(matchStart, matchEnd));
            }
        }
    }

    // Decoration.set() handles sorting by from/startSide automatically
    return Decoration.set(ranges, true);
}

// ── ViewPlugin ──────────────────────────────────────────────────────

function createViewPlugin(config: EmojiHighlightConfig) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildDecorations(view, config);
            }

            update(update: ViewUpdate) {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.selectionSet
                ) {
                    this.decorations = buildDecorations(update.view, config);
                }
            }
        },
        {
            decorations: v => v.decorations,
        }
    );
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create the CM6 Extension for emoji highlight decorations.
 *
 * Typical usage in plugin.onload():
 *
 *     private editorExtensions: Extension[] = [];
 *
 *     this.registerEditorExtension(this.editorExtensions);
 *
 *     // Whenever settings change:
 *     this.editorExtensions.length = 0;
 *     this.editorExtensions.push(createEmojiHighlightExtension({ ... }));
 *     this.app.workspace.updateOptions();
 */
export function createEmojiHighlightExtension(config: EmojiHighlightConfig): Extension {
    return createViewPlugin(config);
}
