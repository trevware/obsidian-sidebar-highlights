import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { CALENDAR_ID_SOURCE } from './ids';
import { THINGS_ID_SOURCE } from '../things/ids';

/**
 * Hides synced tasks' calendar and Things IDs in the editor, in Live Preview and in
 * source mode alike, with the space in front of each. Reading view hides them
 * already, since they're comments. The cursor steps over a hidden ID as one
 * unit, so it can't be half-deleted by accident.
 */

const HIDDEN = Decoration.replace({});

function hiddenRanges(view: EditorView, pattern: RegExp): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
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

function hideIds(pattern: RegExp): Extension {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = hiddenRanges(view, pattern);
            }

            update(update: ViewUpdate): void {
                if (update.docChanged || update.viewportChanged) this.decorations = hiddenRanges(update.view, pattern);
            }
        },
        {
            decorations: (value) => value.decorations,
            provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)
        }
    );
}

/** The editor extensions hiding whichever kinds of ID are asked for, for the plugin to register. */
export function hideSyncIds(options: { calendar: boolean; things: boolean }): Extension[] {
    const sources: string[] = [];
    if (options.calendar) sources.push(CALENDAR_ID_SOURCE);
    if (options.things) sources.push(THINGS_ID_SOURCE);
    // One plugin over every wanted kind, so each ID is decorated once.
    return sources.length ? [hideIds(new RegExp(String.raw`[ \t]*(?:${sources.join('|')})`, 'g'))] : [];
}

/** The extensions for calendar IDs alone, kept for callers that predate Things sync. */
export const hideCalendarIds = hideSyncIds({ calendar: true, things: false });
