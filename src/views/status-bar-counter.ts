import { setIcon, setTooltip } from 'obsidian';
import { t } from '../i18n';
import { squircleifyIcon } from '../utils/squircle-icon';
import { describeSegments, StatusBarCountKind, StatusBarCounts, visibleSegments } from '../utils/status-bar-counts';

// The same icons the sidebar uses for each thing, so the two read as one counter
const SEGMENT_ICONS: Record<StatusBarCountKind, string> = {
    highlights: 'highlighter',
    nativeComments: 'captions',
    files: 'file-text',
    collections: 'folder-open',
    tasks: 'square-check',
};

/**
 * The counter in Obsidian's status bar (issue #129). It shows what the sidebar
 * tab you're on is showing, after search and filters, or the note you're in
 * when no sidebar is open. Hidden whenever there is nothing to count.
 */
export class StatusBarCounter {
    private updateTimer: number | null = null;

    constructor(
        private el: HTMLElement,
        private getCounts: () => StatusBarCounts,
        onClick: () => void
    ) {
        el.addClass('mod-clickable', 'sidebar-highlights-status-bar');
        el.addEventListener('click', onClick);
        el.hide();
    }

    // A tab switch, a re-render and a detection pass can all land together, so
    // they share one recount rather than each redrawing the item.
    requestUpdate(): void {
        if (this.updateTimer !== null) return;
        this.updateTimer = window.setTimeout(() => {
            this.updateTimer = null;
            this.update();
        }, 50);
    }

    destroy(): void {
        if (this.updateTimer !== null) {
            window.clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
    }

    private update(): void {
        const segments = visibleSegments(this.getCounts());
        this.el.empty();
        if (segments.length === 0) {
            this.el.hide();
            return;
        }

        for (const { kind, count } of segments) {
            const segmentEl = this.el.createSpan({ cls: 'sidebar-highlights-status-bar-segment' });
            const iconEl = segmentEl.createSpan({ cls: 'sidebar-highlights-status-bar-icon' });
            setIcon(iconEl, SEGMENT_ICONS[kind]);
            if (kind === 'tasks') squircleifyIcon(iconEl);
            segmentEl.createSpan({ text: count.toLocaleString() });
        }
        setTooltip(this.el, describeSegments(segments, t), { placement: 'top' });
        this.el.show();
    }
}
