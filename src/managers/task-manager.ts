import { App, TFile, Vault, moment } from 'obsidian';
import { Task } from '../../main';
import type HighlightCommentsPlugin from '../../main';

export class TaskManager {
    private app: App;
    private vault: Vault;
    private plugin: HighlightCommentsPlugin;

    constructor(plugin: HighlightCommentsPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.vault = plugin.app.vault;
    }

    /**
     * Check if a file should be processed based on exclusion settings
     */
    private shouldProcessFile(file: TFile): boolean {
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
        if (!this.plugin.settings.excludedFiles || this.plugin.settings.excludedFiles.length === 0) {
            return false;
        }

        const normalizedFilePath = filePath.replace(/\\/g, '/');

        for (const excludedPath of this.plugin.settings.excludedFiles) {
            const normalizedExcludedPath = excludedPath.replace(/\\/g, '/');

            // Exact file match
            if (normalizedFilePath === normalizedExcludedPath) {
                return true;
            }

            // Folder match - check if file is inside excluded folder
            if (normalizedFilePath.startsWith(normalizedExcludedPath + '/')) {
                return true;
            }
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
        const formatParts = dateFormat.split(/[-/\s.]/);

        // Build a regex based on the format
        // For YYYY-MM-DD: match 4 digits-2 digits-2 digits
        const separatorMatch = dateFormat.match(/[^YMDymd]/);
        const separator = separatorMatch ? separatorMatch[0] : '-';
        const escapedSeparator = separator.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

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

        // Regex to match checkbox syntax: - [ ] or - [x] or - [!]
        // Captures leading whitespace, checkbox state, and task text
        const checkboxRegex = /^(\s*)- \[([ xX!])\] (.+)$/;

        // Regex to match markdown headers: # Header
        const headerRegex = /^(#{1,6})\s+(.+)$/;

        // Track the current section header
        let currentSection: string | undefined = undefined;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check if this line is a header
            const headerMatch = line.match(headerRegex);
            if (headerMatch) {
                currentSection = headerMatch[2].trim();
                continue;
            }

            const match = line.match(checkboxRegex);

            if (match) {
                const [, indent, checkboxState, taskText] = match;
                const isCompleted = checkboxState.toLowerCase() === 'x';
                const isFlagged = checkboxState === '!';

                // Calculate indent level (treat tab as 4 spaces)
                const indentSpaces = indent.replace(/\t/g, '    ').length;
                const indentLevel = Math.floor(indentSpaces / 4);

                // Skip completed tasks if not showing them
                if (isCompleted && !showCompleted) {
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
                    flagged: isFlagged,
                    filePath: file.path,
                    lineNumber: i,
                    context: contextLines,
                    indentLevel: indentLevel,
                    section: currentSection,
                    date: parsedDate?.date,
                    dateText: parsedDate?.dateText
                };

                tasks.push(task);
            }
        }

        return tasks;
    }

    /**
     * Toggle a task's completion status in its source file
     * @param task The task to toggle
     * @returns Updated task object
     */
    async toggleTaskCompletion(task: Task): Promise<Task> {
        const file = this.vault.getAbstractFileByPath(task.filePath);

        if (!(file instanceof TFile)) {
            throw new Error(`File not found: ${task.filePath}`);
        }

        const content = await this.vault.read(file);
        const lines = content.split('\n');

        // Verify the line still contains the expected task
        const currentLine = lines[task.lineNumber];

        if (!currentLine) {
            throw new Error(`Line ${task.lineNumber} not found in ${task.filePath}`);
        }

        // Toggle the checkbox state - also handle [!] for flagged tasks
        const checkboxRegex = /^(\s*)- \[([ xX!])\] (.+)$/;
        const match = currentLine.match(checkboxRegex);

        if (!match) {
            throw new Error(`No checkbox found at line ${task.lineNumber} in ${task.filePath}`);
        }

        const [, indent, currentState, taskText] = match;

        // Toggle logic:
        // [!] (flagged) -> [x] (completed, removes flag)
        // [x] (completed) -> [ ] (uncompleted)
        // [ ] (uncompleted) -> [x] (completed)
        const newState = currentState.toLowerCase() === 'x' ? ' ' : 'x';
        const newLine = `${indent}- [${newState}] ${taskText}`;

        // Update the line
        lines[task.lineNumber] = newLine;
        const newContent = lines.join('\n');

        // Write back to file
        await this.vault.modify(file, newContent);

        // Return updated task
        const updatedTask = {
            ...task,
            completed: newState === 'x',
            flagged: false // Flag is removed when task is toggled
        };
        return updatedTask;
    }

    /**
     * Toggle a flag state on a task using [!] checkbox
     * @param task The task to toggle flag
     * @returns Updated task object
     */
    async toggleTaskFlag(task: Task): Promise<Task> {
        const file = this.vault.getAbstractFileByPath(task.filePath);

        if (!(file instanceof TFile)) {
            throw new Error(`File not found: ${task.filePath}`);
        }

        const content = await this.vault.read(file);
        const lines = content.split('\n');

        // Verify the line still contains the expected task
        const currentLine = lines[task.lineNumber];
        if (!currentLine) {
            throw new Error(`Line ${task.lineNumber} not found in ${task.filePath}`);
        }

        // Parse the task line - now including [!] for flagged tasks
        const checkboxRegex = /^(\s*)- \[([ xX!])\] (.+)$/;
        const match = currentLine.match(checkboxRegex);

        if (!match) {
            throw new Error(`No checkbox found at line ${task.lineNumber} in ${task.filePath}`);
        }

        const [, indent, checkboxState, taskText] = match;

        // Toggle flag state: switch between [!] and [ ]
        let newCheckboxState: string;
        if (checkboxState === '!') {
            // Remove flag - go back to unchecked
            newCheckboxState = ' ';
        } else {
            // Add flag
            newCheckboxState = '!';
        }

        const newLine = `${indent}- [${newCheckboxState}] ${taskText}`;

        // Update the line
        lines[task.lineNumber] = newLine;
        const newContent = lines.join('\n');

        // Write back to file
        await this.vault.modify(file, newContent);

        // Return updated task
        return {
            ...task,
            flagged: newCheckboxState === '!'
        };
    }

    /**
     * Update or remove a date from a task
     * @param task The task to update
     * @param newDate New date string in the format configured in settings (or null to remove)
     * @returns Updated task object
     */
    async updateTaskDate(task: Task, newDate: string | null): Promise<Task> {
        const file = this.vault.getAbstractFileByPath(task.filePath);

        if (!(file instanceof TFile)) {
            throw new Error(`File not found: ${task.filePath}`);
        }

        const content = await this.vault.read(file);
        const lines = content.split('\n');

        // Verify the line still contains the expected task
        const currentLine = lines[task.lineNumber];
        if (!currentLine) {
            throw new Error(`Line ${task.lineNumber} not found in ${task.filePath}`);
        }

        // Parse the task line
        const checkboxRegex = /^(\s*)- \[([ xX!])\] (.+)$/;
        const match = currentLine.match(checkboxRegex);

        if (!match) {
            throw new Error(`No checkbox found at line ${task.lineNumber} in ${task.filePath}`);
        }

        const [, indent, checkboxState, taskText] = match;

        // Remove existing date if present
        let updatedTaskText = taskText;
        if (task.dateText) {
            updatedTaskText = taskText.replace(task.dateText, '').trim();
        }

        // Add new date if provided (prepend to task text)
        let finalTaskText = updatedTaskText;
        let parsedDate: { date: string; dateText: string } | undefined;

        if (newDate) {
            finalTaskText = `${newDate} ${updatedTaskText}`;
            // Parse the new date to store in ISO format
            parsedDate = this.parseDateFromText(finalTaskText);
        }

        const newLine = `${indent}- [${checkboxState}] ${finalTaskText}`;

        // Update the line
        lines[task.lineNumber] = newLine;
        const newContent = lines.join('\n');

        // Write back to file
        await this.vault.modify(file, newContent);

        // Return updated task
        return {
            ...task,
            text: finalTaskText,
            date: parsedDate?.date,
            dateText: parsedDate?.dateText
        };
    }
}

