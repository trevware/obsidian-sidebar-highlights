import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { CALENDAR_ID_SOURCE } from './ids';

/**
 * Hides synced tasks' calendar IDs in the editor, in Live Preview and in
 * source mode alike, with the space in front of each. Reading view hides them
 * already, since they're comments. The cursor steps over a hidden ID as one
 * unit, so it can't be half-deleted by accident.
 */

const HIDDEN = Decoration.replace({});

function hiddenRanges(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const pattern = new RegExp(String.raw`[ \t]*${CALENDAR_ID_SOURCE}`, 'g');
    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
            builder.add(from + match.index, from + match.index + match[0].length, HIDDEN);
        }
    }
    return builder.finish();
}

const hideIds = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = hiddenRanges(view);
        }

        update(update: ViewUpdate): void {
            if (update.docChanged || update.viewportChanged) this.decorations = hiddenRanges(update.view);
        }
    },
    {
        decorations: (value) => value.decorations,
        provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)
    }
);

/** The editor extension, for the plugin to register while IDs are hidden. */
export const hideCalendarIds = [hideIds];
