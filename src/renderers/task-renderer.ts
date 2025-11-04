import { setIcon, Menu, Notice, moment } from 'obsidian';
import type { Task } from '../../main';
import type HighlightCommentsPlugin from '../../main';

export interface TaskRenderOptions {
    searchTerm?: string;
    onTaskToggle?: (task: Task, checkboxEl: HTMLElement) => void;
    onTaskClick?: (task: Task, event?: MouseEvent) => void;
    onFileNameClick?: (filePath: string, event?: MouseEvent) => void;
    onFlagToggle?: (task: Task) => void;
    onCalendarToggle?: (task: Task) => void;
    hideFilename?: boolean; // Hide filename when grouped
    hideDateBadge?: boolean; // Hide date badge when grouped by date
}

export class TaskRenderer {
    constructor(private plugin: HighlightCommentsPlugin) {}

    /**
     * Create a task item element
     * @param container Container to append the task item to
     * @param task Task data
     * @param options Render options
     * @returns The created task item element
     */
    createTaskItem(
        container: HTMLElement,
        task: Task,
        options: TaskRenderOptions = {}
    ): HTMLElement {
        const item = container.createDiv({
            cls: `task-item-card${task.completed ? ' task-completed' : ''}${options.hideFilename !== undefined ? ' task-grouped' : ''}`,
            attr: { 'data-task-id': task.id }
        });

        // Create quote section - exact structure as highlight-quote
        this.createQuoteSection(item, task, options);

        // Create actions section only for ungrouped tasks (when hideFilename is undefined)
        // Grouped tasks either show inline filename (date grouping) or no filename at all (other grouping)
        if (options.hideFilename === undefined) {
            this.createActionsSection(item, task, options);
        }

        return item;
    }

    /**
     * Create the quote section (checkbox + task text + context) - mirrors highlight-quote
     */
    private createQuoteSection(item: HTMLElement, task: Task, options: TaskRenderOptions): void {
        const quoteEl = item.createDiv({ cls: 'task-quote' });

        // Apply indentation for nested tasks
        // Subtask checkboxes align with parent task text (base padding 8px + checkbox 20px + gap 8px = 36px per level)
        if (task.indentLevel > 0) {
            quoteEl.style.paddingLeft = `${8 + (task.indentLevel * 28)}px`;
        }

        // Checkbox (using Lucide icons)
        const checkboxContainer = quoteEl.createDiv({ cls: 'task-checkbox-container' });
        const checkboxIcon = checkboxContainer.createDiv({ cls: 'task-checkbox' });

        // Use different icons for top-level vs sub-tasks
        if (task.indentLevel > 0) {
            // Sub-tasks: circle and circle-check
            setIcon(checkboxIcon, task.completed ? 'circle-check' : 'circle');
        } else {
            // Top-level tasks: square and square-check
            setIcon(checkboxIcon, task.completed ? 'square-check' : 'square');
        }

        checkboxIcon.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onTaskToggle?.(task, checkboxIcon);
        });

        // Text content wrapper (allows proper wrapping)
        const textContent = quoteEl.createDiv({ cls: 'task-text-content' });

        // Render date badge if date exists (and not hidden)
        if (task.date && !options.hideDateBadge) {
            const dateBadge = textContent.createSpan({ cls: 'task-date-badge' });
            // Format as "MM-DD" (e.g., "07-23")
            const formattedDate = moment(task.date, 'YYYY-MM-DD').format('MM-DD');
            dateBadge.textContent = formattedDate;
        }

        // Check if task is flagged and render flag icon
        if (task.flagged) {
            // Add flag icon before text
            const flagIcon = textContent.createDiv({ cls: 'task-flag-icon' });
            setIcon(flagIcon, 'flag');
        }

        // Task text with date stripped out (if present)
        let displayText = task.text;
        if (task.dateText) {
            // Remove the date text and trim any extra whitespace
            displayText = task.text.replace(task.dateText, '').trim();
        }

        // Task text with tags rendered as badges
        const taskTextDiv = textContent.createDiv();
        this.renderTaskTextWithTags(taskTextDiv, displayText, options.searchTerm);

        // Context: indented text below task
        if (task.context.length > 0) {
            const contextContainer = textContent.createDiv({ cls: 'task-context' });

            task.context.forEach(line => {
                const lineEl = contextContainer.createDiv({ cls: 'task-context-line' });
                // Remove leading "- " from context lines if present
                const cleanLine = line.trim().replace(/^-\s*/, '');
                // Render with markdown formatting
                this.renderTaskTextWithTags(lineEl, cleanLine, options.searchTerm);
            });
        }

        // Filename below context when hideFilename is false (date grouping)
        // Only show for parent tasks (indentLevel === 0), not for subtasks
        if (!options.hideFilename && task.indentLevel === 0) {
            const fileName = task.filePath.split('/').pop()?.replace(/\.md$/, '') || task.filePath;
            const fileNameContainer = textContent.createDiv({ cls: 'task-filename-inline' });

            // Add file icon
            const fileIcon = fileNameContainer.createSpan({ cls: 'task-filename-icon' });
            setIcon(fileIcon, 'file-text');

            // Add filename text
            const fileNameText = fileNameContainer.createSpan({
                cls: 'task-filename-text',
                text: fileName,
                attr: { title: task.filePath }
            });

            fileNameContainer.addEventListener('click', (event) => {
                event.stopPropagation();
                options.onFileNameClick?.(task.filePath, event);
            });
        }

        // Flag button (appears on hover, shows flag-off if task is flagged)
        const flagButton = quoteEl.createDiv({ cls: 'task-flag-button' });

        // Use flag-off icon if task is flagged, otherwise use flag icon
        if (task.flagged) {
            setIcon(flagButton, 'flag-off');
        } else {
            setIcon(flagButton, 'flag');
        }

        flagButton.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onFlagToggle?.(task);
        });

        // Calendar button (appears on hover, shows calendar-cog if task has a date)
        const calendarButton = quoteEl.createDiv({ cls: 'task-calendar-button' });

        // Use calendar-cog icon if task has a date, otherwise use calendar icon
        if (task.date) {
            setIcon(calendarButton, 'calendar-cog');
        } else {
            setIcon(calendarButton, 'calendar');
        }

        calendarButton.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onCalendarToggle?.(task);
        });

        // Click to navigate to task
        quoteEl.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).classList.contains('task-checkbox') ||
                (event.target as HTMLElement).classList.contains('task-flag-button') ||
                (event.target as HTMLElement).classList.contains('task-calendar-button')) {
                return;
            }
            options.onTaskClick?.(task, event);
        });
    }

    /**
     * Create the actions section - mirrors highlight-actions structure
     */
    private createActionsSection(item: HTMLElement, task: Task, options: TaskRenderOptions): void {
        const actions = item.createDiv({ cls: 'task-actions' });

        // Filename section (like highlight-filename)
        const fileName = task.filePath.split('/').pop()?.replace(/\.md$/, '') || task.filePath;
        const fileNameEl = actions.createEl('small', {
            cls: 'task-filename',
            text: fileName,
            attr: { title: task.filePath }
        });

        fileNameEl.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onFileNameClick?.(task.filePath, event);
        });

        // Info container (like highlight-info-container)
        const infoContainer = actions.createDiv({ cls: 'task-info-container' });
        const infoLineContainer = infoContainer.createDiv({ cls: 'task-info-line' });

        // Stats section (like highlight-stats-section)
        const statsSection = infoLineContainer.createDiv({ cls: 'task-stats-section' });

        // Line number info removed for tasks - not needed since tasks are less complex than highlights
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
                const highlightEl = element.createEl('span', { cls: 'cm-highlight' });
                this.renderTextWithTags(highlightEl, segment.content || '', searchTerm);
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
                        this.plugin.app.workspace.openLinkText(url, '', event.ctrlKey || event.metaKey);
                    });
                }
            }
        }
    }

    /**
     * Render text with hashtags as badges (helper for markdown segments)
     */
    private renderTextWithTags(element: HTMLElement, text: string, searchTerm?: string): void {
        const tagRegex = /#([a-zA-Z0-9_-]+)/g;
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

            const tagBegin = element.createSpan({
                cls: `cm-hashtag cm-hashtag-begin cm-meta${tagMatches ? ' task-search-match-tag' : ''}`,
                text: '#'
            });

            const tagEnd = element.createSpan({
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
        text = text.replace(/\\([*_~`\[\]\\])/g, (match, char) => {
            const placeholder = `\u0000ESC${escapeCounter}\u0000`;
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
            { regex: /==(.*?)==/g, type: 'highlight' },
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
                textSegment = textSegment.replace(/\u0000ESC(\d+)\u0000/g, (_, num) => {
                    const placeholder = `\u0000ESC${num}\u0000`;
                    return escapeMap.get(placeholder) || placeholder;
                });
                segments.push({ type: 'text', content: textSegment });
            }

            let content = match.content;
            if (content) {
                content = content.replace(/\u0000ESC(\d+)\u0000/g, (_, num) => {
                    const placeholder = `\u0000ESC${num}\u0000`;
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
            textSegment = textSegment.replace(/\u0000ESC(\d+)\u0000/g, (_, num) => {
                const placeholder = `\u0000ESC${num}\u0000`;
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
            const mark = element.createEl('mark', {
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


    /**
     * Create an empty state message when no tasks are found
     */
    createEmptyState(container: HTMLElement, message: string = 'No tasks found'): HTMLElement {
        const emptyState = container.createDiv({ cls: 'task-empty-state' });

        const icon = emptyState.createDiv({ cls: 'task-empty-icon' });
        setIcon(icon, 'check-square');

        const text = emptyState.createEl('p', {
            cls: 'task-empty-text',
            text: message
        });

        return emptyState;
    }
}
