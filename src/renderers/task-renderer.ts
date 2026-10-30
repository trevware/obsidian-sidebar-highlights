import type { Task } from '../../main';
import { stripTasksPluginMetadata } from '../utils/task-metadata';
import { stripCalendarRef } from '../calendar/ids';
import { parseColorMarker } from '../utils/note-colors';
import type HighlightCommentsPlugin from '../../main';

export class TaskRenderer {
    constructor(private plugin: HighlightCommentsPlugin) {}

    /**
     * Text to render for a task: the raw text minus the date this plugin parsed
     * out into its own badge, and minus Tasks-plugin metadata when that setting
     * is on. `task.text` itself is never modified — search, IDs and file
     * rewrites all continue to work against the real line.
     */
    private getDisplayText(task: Task): string {
        let displayText = stripCalendarRef(task.text);

        if (task.dateText) {
            // Remove the date text and trim any extra whitespace
            displayText = displayText.replace(task.dateText, '').trim();
        }

        if (this.plugin.settings.hideTasksPluginMetadata) {
            displayText = stripTasksPluginMetadata(displayText);
        }

        return displayText;
    }

    /**
     * Render a task's display text (date and Tasks-plugin metadata removed) with
     * the same markdown, tag and highlight styling the sidebar uses. Shared with
     * the Tasks tab so a task reads the same in both places.
     */
    renderTaskText(element: HTMLElement, task: Task, searchTerm?: string): void {
        this.renderTaskTextWithTags(element, this.getDisplayText(task), searchTerm);
    }

    /**
     * Render task text with markdown formatting and tags
     */
    private renderTaskTextWithTags(element: HTMLElement, text: string, searchTerm?: string): void {
        element.empty();

        // Parse markdown segments (like highlights do)
        const segments = this.parseMarkdownSegments(text);

        for (const segment of segments) {
            if (segment.type === 'text') {
                // For text segments, check for hashtags and render them
                this.renderTextWithTags(element, segment.content || '', searchTerm);
            } else if (segment.type === 'strong') {
                const strongEl = element.createEl('strong');
                this.renderTextWithTags(strongEl, segment.content || '', searchTerm);
            } else if (segment.type === 'em') {
                const emEl = element.createEl('em');
                this.renderTextWithTags(emEl, segment.content || '', searchTerm);
            } else if (segment.type === 'strong-em') {
                const strongEl = element.createEl('strong');
                const emEl = strongEl.createEl('em');
                this.renderTextWithTags(emEl, segment.content || '', searchTerm);
            } else if (segment.type === 'code') {
                const codeEl = element.createEl('code');
                codeEl.textContent = segment.content || '';
            } else if (segment.type === 'del') {
                const delEl = element.createEl('del');
                this.renderTextWithTags(delEl, segment.content || '', searchTerm);
            } else if (segment.type === 'highlight') {
                const highlightEl = element.createSpan({ cls: 'cm-highlight' });
                // Obsidian's colour emoji (==🔵text==) tints the highlight and isn't shown
                const content = segment.content || '';
                const marker = parseColorMarker(content);
                if (marker) {
                    highlightEl.setAttribute('data-highlight', marker.color);
                }
                this.renderTextWithTags(highlightEl, marker ? content.slice(marker.length) : content, searchTerm);
            } else if (segment.type === 'link') {
                const linkEl = element.createEl('a');
                linkEl.textContent = segment.text || '';
                linkEl.href = segment.url || '';
                linkEl.target = '_blank';
            } else if (segment.type === 'wikilink') {
                const linkEl = element.createEl('a');
                linkEl.textContent = segment.text || '';
                linkEl.addClass('internal-link');

                const url = segment.url || '';
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    linkEl.href = url;
                    linkEl.target = '_blank';
                    linkEl.addClass('external-link');
                } else {
                    linkEl.setAttribute('data-href', url);
                    linkEl.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void this.plugin.app.workspace.openLinkText(url, '', event.ctrlKey || event.metaKey);
                    });
                }
            }
        }
    }

    /**
     * Render text with hashtags as badges (helper for markdown segments)
     */
    private renderTextWithTags(element: HTMLElement, text: string, searchTerm?: string): void {
        const tagRegex = /#([a-zA-Z0-9_/-]+)/g;
        let lastIndex = 0;
        let match;
        let hasMatches = false;

        while ((match = tagRegex.exec(text)) !== null) {
            hasMatches = true;

            if (match.index > lastIndex) {
                const textBefore = text.substring(lastIndex, match.index);
                this.appendTextWithHighlight(element, textBefore, searchTerm);
            }

            const tagName = match[1];
            const fullTag = `#${tagName}`;
            const tagMatches = searchTerm && fullTag.toLowerCase().includes(searchTerm.toLowerCase());

            element.createSpan({
                cls: `cm-hashtag cm-hashtag-begin cm-meta${tagMatches ? ' task-search-match-tag' : ''}`,
                text: '#'
            });

            element.createSpan({
                cls: `cm-hashtag cm-hashtag-end${tagMatches ? ' task-search-match-tag' : ''}`,
                text: tagName,
                attr: { 'data-tag': tagName }
            });

            lastIndex = match.index + match[0].length;
        }

        if (hasMatches && lastIndex < text.length) {
            const remainingText = text.substring(lastIndex);
            this.appendTextWithHighlight(element, remainingText, searchTerm);
        }

        if (!hasMatches) {
            this.appendTextWithHighlight(element, text, searchTerm);
        }
    }

    /**
     * Parse markdown segments (copied from highlight-renderer)
     */
    private parseMarkdownSegments(text: string): Array<{type: string, content?: string, text?: string, url?: string}> {
        const segments: Array<{type: string, content?: string, text?: string, url?: string}> = [];

        // Handle backslash escaping
        const escapeMap = new Map<string, string>();
        let escapeCounter = 0;
        text = text.replace(/\\([*_~`[\]\\=])/g, (_match: string, char: string) => {
            const placeholder = `\uE000ESC${escapeCounter}\uE000`;
            escapeMap.set(placeholder, char);
            escapeCounter++;
            return placeholder;
        });

        const patterns = [
            { regex: /\*\*\*(.*?)\*\*\*/g, type: 'strong-em' },
            { regex: /___(.*?)___/g, type: 'strong-em' },
            { regex: /\*\*(.*?)\*\*/g, type: 'strong' },
            { regex: /__(.*?)__/g, type: 'strong' },
            { regex: /~~(.*?)~~/g, type: 'del' },
            { regex: /==(?!\s)(.*?)(?<!\s)==/g, type: 'highlight' },
            { regex: /`([^`]+?)`/g, type: 'code' },
            { regex: /\[\[([^\]]+?)\]\]/g, type: 'wikilink' },
            { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' }
        ];

        const matches: Array<{start: number, end: number, type: string, content?: string, text?: string, url?: string}> = [];

        for (const pattern of patterns) {
            let match;
            pattern.regex.lastIndex = 0;
            while ((match = pattern.regex.exec(text)) !== null) {
                if (pattern.type === 'link') {
                    matches.push({
                        start: match.index,
                        end: match.index + match[0].length,
                        type: pattern.type,
                        text: match[1],
                        url: match[2]
                    });
                } else if (pattern.type === 'wikilink') {
                    const linkContent = match[1];
                    const parts = linkContent.split('|');
                    const url = parts[0].trim();
                    const displayText = parts.length > 1 ? parts[1].trim() : url;
                    matches.push({
                        start: match.index,
                        end: match.index + match[0].length,
                        type: pattern.type,
                        text: displayText,
                        url: url
                    });
                } else {
                    matches.push({
                        start: match.index,
                        end: match.index + match[0].length,
                        type: pattern.type,
                        content: match[1]
                    });
                }
            }
        }

        // Add italic matches
        this.findItalicMatches(text, matches);

        // Sort and remove overlaps
        matches.sort((a, b) => a.start - b.start);
        const nonOverlapping: Array<{start: number, end: number, type: string, content?: string, text?: string, url?: string}> = [];
        for (const match of matches) {
            if (nonOverlapping.length === 0 || match.start >= nonOverlapping[nonOverlapping.length - 1].end) {
                nonOverlapping.push(match);
            }
        }

        // Build segments
        let lastEnd = 0;
        for (const match of nonOverlapping) {
            if (match.start > lastEnd) {
                let textSegment = text.substring(lastEnd, match.start);
                textSegment = textSegment.replace(/\uE000ESC(\d+)\uE000/g, (_: string, num: string) => {
                    const placeholder = `\uE000ESC${num}\uE000`;
                    return escapeMap.get(placeholder) || placeholder;
                });
                segments.push({ type: 'text', content: textSegment });
            }

            let content = match.content;
            if (content) {
                content = content.replace(/\uE000ESC(\d+)\uE000/g, (_: string, num: string) => {
                    const placeholder = `\uE000ESC${num}\uE000`;
                    return escapeMap.get(placeholder) || placeholder;
                });
            }

            segments.push({
                type: match.type,
                content: content,
                text: match.text,
                url: match.url
            });

            lastEnd = match.end;
        }

        if (lastEnd < text.length) {
            let textSegment = text.substring(lastEnd);
            textSegment = textSegment.replace(/\uE000ESC(\d+)\uE000/g, (_: string, num: string) => {
                const placeholder = `\uE000ESC${num}\uE000`;
                return escapeMap.get(placeholder) || placeholder;
            });
            segments.push({ type: 'text', content: textSegment });
        }

        return segments;
    }

    /**
     * Find italic matches manually (iOS compatibility)
     */
    private findItalicMatches(text: string, matches: Array<{start: number, end: number, type: string, content?: string}>): void {
        // Single asterisk
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '*' && (i === 0 || text[i-1] !== '*') && (i === text.length - 1 || text[i+1] !== '*')) {
                for (let j = i + 1; j < text.length; j++) {
                    if (text[j] === '*' && (j === text.length - 1 || text[j+1] !== '*') && (j === 0 || text[j-1] !== '*')) {
                        const content = text.substring(i + 1, j);
                        if (content.length > 0 && !content.includes('\n')) {
                            matches.push({
                                start: i,
                                end: j + 1,
                                type: 'em',
                                content: content
                            });
                            i = j;
                            break;
                        }
                    }
                }
            }
        }

        // Single underscore
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '_' && (i === 0 || text[i-1] !== '_') && (i === text.length - 1 || text[i+1] !== '_')) {
                const charBefore = i > 0 ? text[i-1] : ' ';
                const charAfter = i < text.length - 1 ? text[i+1] : ' ';
                const isWordChar = (c: string) => /[a-zA-Z0-9]/.test(c);

                if (isWordChar(charBefore) && isWordChar(charAfter)) {
                    continue;
                }

                for (let j = i + 1; j < text.length; j++) {
                    if (text[j] === '_' && (j === text.length - 1 || text[j+1] !== '_') && (j === 0 || text[j-1] !== '_')) {
                        const charBeforeClose = j > 0 ? text[j-1] : ' ';
                        const charAfterClose = j < text.length - 1 ? text[j+1] : ' ';

                        if (isWordChar(charBeforeClose) && isWordChar(charAfterClose)) {
                            continue;
                        }

                        const content = text.substring(i + 1, j);
                        if (content.length > 0 && !content.includes('\n')) {
                            matches.push({
                                start: i,
                                end: j + 1,
                                type: 'em',
                                content: content
                            });
                            i = j;
                            break;
                        }
                    }
                }
            }
        }
    }

    /**
     * Append text to element with search term highlighting
     */
    private appendTextWithHighlight(element: HTMLElement, text: string, searchTerm?: string): void {
        if (!searchTerm || searchTerm.length === 0) {
            element.appendText(text);
            return;
        }

        const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
            // Add text before match
            if (match.index > lastIndex) {
                element.appendText(text.substring(lastIndex, match.index));
            }

            // Add highlighted match
            element.createEl('mark', {
                cls: 'task-search-match',
                text: match[0]
            });

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            element.appendText(text.substring(lastIndex));
        }

        // If no matches, just append the text
        if (lastIndex === 0) {
            element.appendText(text);
        }
    }


}
