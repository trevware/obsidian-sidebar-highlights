import { TFile, Vault, moment } from 'obsidian';
import { Task } from '../../main';
import type HighlightCommentsPlugin from '../../main';
import {
    CHECKBOX_REGEX,
    checkboxStateToStatus,
    isResolvedStatus,
    createTaskNestingState,
    resetTaskNesting,
    resolveTaskNesting
} from '../utils/task-status';

export {
    CHECKBOX_PATTERN,
    CHECKBOX_REGEX,
    CHECKBOX_REGEX_WITH_PREFIX,
    checkboxStateToStatus,
    statusToCheckboxState,
    isResolvedStatus
} from '../utils/task-status';

export class TaskManager {
    private vault: Vault;
    private plugin: HighlightCommentsPlugin;

    constructor(plugin: HighlightCommentsPlugin) {
        this.plugin = plugin;
        this.vault = plugin.app.vault;
    }

    /**
     * Check if a file should be processed based on exclusion settings
     */
    shouldProcessFile(file: TFile): boolean {
        if (file.extension !== 'md') {
            return false;
        }

        if (this.plugin.settings.excludeExcalidraw) {
            // Check for .excalidraw extension in the filename
            if (file.name.endsWith('.excalidraw.md')) {
                return false;
            }
        }

        // Check if file is excluded
        if (this.isFileExcluded(file.path)) {
            return false;
        }

        return true;
    }

    /**
     * Check if a file path is in the excluded files list
     */
    private isFileExcluded(filePath: string): boolean {
        const filters = this.plugin.settings.fileFilters;

        if (!filters || filters.length === 0) {
            return false; // No filters = process all files
        }

        const normalizedFilePath = filePath.replace(/\\/g, '/');

        // Check each filter - each has its own mode
        let hasIncludeFilters = false;
        let matchesIncludeFilter = false;
        let matchesExcludeFilter = false;

        for (const filter of filters) {
            const normalizedFilterPath = filter.path.replace(/\\/g, '/');

            // Check if file matches this filter
            const matches =
                normalizedFilePath === normalizedFilterPath ||
                normalizedFilePath.startsWith(normalizedFilterPath + '/');

            if (matches) {
                if (filter.mode === 'include') {
                    matchesIncludeFilter = true;
                } else {
                    matchesExcludeFilter = true;
                }
            }

            if (filter.mode === 'include') {
                hasIncludeFilters = true;
            }
        }

        // KEY FIX: If file matches an include filter, it should NOT be excluded
        // (even if it also matches an exclude filter)
        // This allows more specific include filters to override broader exclude filters
        if (matchesIncludeFilter) {
            return false;
        }

        // If there are any include filters, file must match at least one to be processed
        if (hasIncludeFilters && !matchesIncludeFilter) {
            return true; // Excluded because not in any include filter
        }

        // If file matches an exclude filter, it's excluded
        if (matchesExcludeFilter) {
            return true;
        }

        return false;
    }

    /**
     * Extract date from task text based on configured format
     * @param text Task text to parse
     * @returns Object with ISO date and original text if found, undefined otherwise
     */
    private parseDateFromText(text: string): { date: string; dateText: string } | undefined {
        const dateFormat = this.plugin.settings.taskDateFormat || 'YYYY-MM-DD';

        // Create regex pattern to find dates in the configured format
        // This is a simplified approach - we'll look for patterns that could be dates
        // Based on the format YYYY-MM-DD, we look for 4 digits, dash, 2 digits, dash, 2 digits

        // Build a regex based on the format
        // For YYYY-MM-DD: match 4 digits-2 digits-2 digits
        const separatorMatch = dateFormat.match(/[^YMDymd]/);
        const separator = separatorMatch ? separatorMatch[0] : '-';
        const escapedSeparator = separator.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

        let pattern = dateFormat
            .replace(/YYYY/g, '(\\d{4})')
            .replace(/YY/g, '(\\d{2})')
            .replace(/MM/g, '(\\d{1,2})')
            .replace(/DD/g, '(\\d{1,2})')
            .replace(/M/g, '(\\d{1,2})')
            .replace(/D/g, '(\\d{1,2})');

        // Escape separator characters in the pattern
        pattern = pattern.replace(new RegExp(separator, 'g'), escapedSeparator);

        const regex = new RegExp(pattern);
        const match = text.match(regex);

        if (match) {
            const dateStr = match[0];
            // Parse with moment and return in ISO format
            const parsedDate = moment(dateStr, dateFormat, true);

            if (parsedDate.isValid()) {
                return {
                    date: parsedDate.format('YYYY-MM-DD'),
                    dateText: dateStr
                };
            }
        }

        return undefined;
    }

    /**
     * Scan all markdown files in the vault for checkbox tasks
     * @param showCompleted Whether to include completed tasks
     * @param showContext Whether to capture indented text as context
     * @returns Array of Task objects
     */
    async scanAllTasks(
        showCompleted: boolean = true,
        showContext: boolean = true
    ): Promise<Task[]> {
        const tasks: Task[] = [];
        const files = this.vault.getMarkdownFiles();

        // Filter files based on exclusion settings
        const filesToProcess = files.filter(file => this.shouldProcessFile(file));

        for (const file of filesToProcess) {
            const fileTasks = await this.scanFileForTasks(file, showCompleted, showContext);
            tasks.push(...fileTasks);
        }

        return tasks;
    }

    /**
     * Scan a single file for checkbox tasks
     * @param file The file to scan
     * @param showCompleted Whether to include completed tasks
     * @param showContext Whether to capture indented text as context
     * @returns Array of Task objects from this file
     */
    async scanFileForTasks(
        file: TFile,
        showCompleted: boolean = true,
        showContext: boolean = true
    ): Promise<Task[]> {
        const tasks: Task[] = [];
        const content = await this.vault.read(file);
        const lines = content.split('\n');

        const checkboxRegex = CHECKBOX_REGEX;

        // Regex to match markdown headers: # Header
        const headerRegex = /^(#{1,6})\s+(.+)$/;

        // Track the current section header
        let currentSection: string | undefined = undefined;
        let currentSectionLine: number | undefined = undefined;

        // Structural parent tracking for nesting. Deliberately not a Task object:
        // hidden tasks must advance it too, and they never build one.
        const nesting = createTaskNestingState();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check if this line is a header
            const headerMatch = line.match(headerRegex);
            if (headerMatch) {
                currentSection = headerMatch[2].trim();
                currentSectionLine = i;
                resetTaskNesting(nesting); // Reset parent when entering new section
                continue;
            }

            const match = line.match(checkboxRegex);

            if (match) {
                const [, indent, checkboxState, taskText] = match;
                const status = checkboxStateToStatus(checkboxState);
                const isCompleted = status === 'done';
                const isFlagged = checkboxState.startsWith('!');

                // Extract priority from checkbox state: [!1], [!2], [!3]
                let priority: 1 | 2 | 3 | undefined = undefined;
                if (checkboxState === '!1') {
                    priority = 1;
                } else if (checkboxState === '!2') {
                    priority = 2;
                } else if (checkboxState === '!3') {
                    priority = 3;
                }

                // Calculate indent level (treat tab as 4 spaces)
                const indentSpaces = indent.replace(/\t/g, '    ').length;
                let indentLevel = Math.floor(indentSpaces / 4);

                // Resolved tasks are hidden when completed tasks are hidden. Cancelled
                // counts as resolved; in-progress and question still need action.
                const isVisible = !(isResolvedStatus(status) && !showCompleted);

                // Runs for every task line, including hidden ones, so the recorded
                // structure follows the file rather than whatever survived filtering.
                // The view re-resolves nesting after it applies its own filters.
                const nested = resolveTaskNesting(indentLevel, i, nesting);
                indentLevel = nested.indentLevel;

                if (!isVisible) {
                    continue;
                }

                // Extract context: indented text below the task
                const contextLines: string[] = [];
                if (showContext) {
                    // Look at lines below this task
                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j];

                        // Skip any task lines (don't capture them as context)
                        const nextTaskMatch = nextLine.match(checkboxRegex);
                        if (nextTaskMatch) {
                            // Found another task, stop collecting context
                            break;
                        }

                        // Check if line is indented more than the task
                        if (nextLine.trim() === '') {
                            // Skip empty lines but don't stop
                            continue;
                        }

                        const lineIndent = nextLine.match(/^(\s*)/)?.[1].replace(/\t/g, '    ').length || 0;
                        if (lineIndent > indentSpaces) {
                            // This line is indented more than the task, so it's context
                            contextLines.push(nextLine);
                        } else {
                            // Line is at same or lower indent, stop here
                            break;
                        }
                    }
                }

                // Parse date from task text
                const parsedDate = this.parseDateFromText(taskText);

                // Create task object
                const task: Task = {
                    id: `${file.path}:${i}:${taskText}`, // Unique ID based on file, line, and text
                    text: taskText,
                    completed: isCompleted,
                    status: status,
                    flagged: isFlagged,
                    priority: priority,
                    filePath: file.path,
                    lineNumber: i,
                    context: contextLines,
                    indentLevel: indentLevel,
                    parentLine: nested.parentLine,
                    section: currentSection,
                    sectionLine: currentSectionLine,
                    date: parsedDate?.date,
                    dateText: parsedDate?.dateText,
                    marker: checkboxState
                };

                tasks.push(task);
                // Parent tracking already happened above, before the visibility check,
                // so that hidden tasks still contribute to the structure.
            } else {
                // Non-task line - reset parent task if we encounter a non-empty line at indent 0
                if (line.trim() !== '' && !line.match(/^[\s]/)) {
                    resetTaskNesting(nesting);
                }
            }
        }

        return tasks;
    }

}

