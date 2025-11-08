import { App, AbstractInputSuggest, normalizePath, TFile, TFolder } from "obsidian";

/**
 * FileFolderSuggest class.
 * This class extends AbstractInputSuggest to provide file and folder suggestions based on user input.
 * It filters the list of files and folders in the vault and displays them as suggestions.
 */
export class FileFolderSuggest extends AbstractInputSuggest<string> {
    private folders: string[];
    private files: string[];
    private inputEl: HTMLInputElement;
    private onSelectCallback?: (path: string) => void;

    constructor(app: App, inputEl: HTMLInputElement, onSelectCallback?: (path: string) => void) {
        super(app, inputEl);

        this.inputEl = inputEl;
        this.onSelectCallback = onSelectCallback;

        // Get all folders
        this.folders = this.app.vault
            .getAllFolders(true)
            .map((folder: TFolder) => normalizePath(folder.path))
            .filter((path: string) => path !== ""); // Remove empty root folder

        // Get all files
        this.files = this.app.vault
            .getFiles()
            .map((file: TFile) => normalizePath(file.path));
    }

    /**
     * Returns the suggestions to display based on the user's input.
     * By default shows folders, but when searching shows both files and folders.
     *
     * @param inputStr - The user's input string.
     * @returns An array of file/folder paths that match the input string.
     */
    getSuggestions(inputStr: string): string[] {
        const inputLower = inputStr.toLowerCase().trim();

        // If no input, show only folders by default
        if (!inputLower) {
            return this.folders.slice(0, 10); // Limit to first 10 folders
        }

        // When searching, show both folders and files
        const matchingFolders = this.folders.filter((folder) =>
            folder.toLowerCase().includes(inputLower)
        );

        const matchingFiles = this.files.filter((file) =>
            file.toLowerCase().includes(inputLower)
        );

        // Prioritize folders first, then files
        return [...matchingFolders, ...matchingFiles].slice(0, 20); // Limit to 20 total results
    }

    /**
     * Renders a suggestion in the dropdown.
     *
     * @param path - The file/folder path to render.
     * @param el - The HTML element to render the suggestion in.
     */
    renderSuggestion(path: string, el: HTMLElement): void {
        el.setText(path);
    }

    /**
     * Handles the selection of a suggestion.
     *
     * @param path - The selected file/folder path.
     */
    selectSuggestion(path: string): void {
        this.inputEl.value = path;
        const event = new Event("input");
        this.inputEl.dispatchEvent(event);
        this.close();

        // Call the callback if provided (for auto-add functionality)
        if (this.onSelectCallback) {
            this.onSelectCallback(path);
        }
    }
}