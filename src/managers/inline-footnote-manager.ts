import { Editor } from 'obsidian';
import type { Highlight } from '../../main';

export interface InlineFootnoteMatch {
    content: string;
    startIndex: number;
    endIndex: number;
}

export class InlineFootnoteManager {
    
    private isHtmlHighlight(highlight: Highlight): boolean {
        // HTML highlights have a color property and are not native comments
        return !highlight.isNativeComment && !!highlight.color;
    }

    private getHtmlHighlightPatterns(highlight: Highlight): Array<{pattern: string}> {
        const escapedText = this.escapeRegex(highlight.text);
        const patterns: Array<{pattern: string}> = [];
        
        // Pattern for <span style="background:color">text</span>
        patterns.push({
            pattern: `<span\\s+style=["'][^"']*background:\\s*[^;"']+[^"']*["'][^>]*>${escapedText}<\\/span>`
        });
        
        // Pattern for <font color="color">text</font>  
        patterns.push({
            pattern: `<font\\s+color=["'][^"']+["'][^>]*>${escapedText}<\\/font>`
        });
        
        // Pattern for <mark>text</mark>
        patterns.push({
            pattern: `<mark[^>]*>${escapedText}<\\/mark>`
        });
        
        return patterns;
    }
    
    /**
     * Extracts inline footnotes immediately following a highlight
     * Pattern: ^[content] with optional spaces between multiple footnotes
     */
    public extractInlineFootnotes(content: string, highlightEndIndex: number): InlineFootnoteMatch[] {
        const inlineFootnotes: InlineFootnoteMatch[] = [];
        const afterHighlight = content.substring(highlightEndIndex);
        
        // Match one or more inline footnotes with optional spaces between them
        // Pattern: ^[content] with optional spaces before each footnote
        const inlineFootnoteRegex = /(\s*\^\[([^\]]+)\])/g;
        let match;
        
        while ((match = inlineFootnoteRegex.exec(afterHighlight)) !== null) {
            // Only process if this footnote is at the very beginning or follows another footnote
            if (match.index === 0 || this.isValidFootnotePosition(afterHighlight, match.index)) {
                inlineFootnotes.push({
                    content: match[2], // The content inside ^[content]
                    startIndex: highlightEndIndex + match.index,
                    endIndex: highlightEndIndex + match.index + match[0].length
                });
            } else {
                // Stop processing if we encounter a footnote that's not immediately following
                break;
            }
        }
        
        return inlineFootnotes;
    }
    
    /**
     * Checks if a footnote position is valid (immediately following highlight, standard footnotes, or previous inline footnotes)
     */
    private isValidFootnotePosition(afterHighlight: string, index: number): boolean {
        const precedingText = afterHighlight.substring(0, index);
        // Should only contain whitespace, standard footnotes [^key], or previous inline footnotes ^[content]
        // Allow alphanumeric keys and underscores/hyphens for standard footnotes
        // Note: The regex needs to match the full pattern including complete footnotes
        return /^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*\s*$/.test(precedingText);
    }
    
    /**
     * Inserts an inline footnote after a highlight in the editor
     */
    public insertInlineFootnote(editor: Editor, highlight: Highlight, footnoteContent: string): boolean {
        const content = editor.getValue();
        const escapedText = this.escapeRegex(highlight.text);
        
        let bestMatch: { index: number, length: number } | null = null;
        let minDistance = Infinity;

        if (highlight.isNativeComment) {
            // Native comment pattern
            const regexPattern = `%%${escapedText}%%`;
            const highlightRegex = new RegExp(regexPattern, 'g');
            let match;
            while ((match = highlightRegex.exec(content)) !== null) {
                const distance = Math.abs(match.index - highlight.startOffset);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = { index: match.index, length: match[0].length };
                }
            }
        } else if (this.isHtmlHighlight(highlight)) {
            // HTML highlight patterns
            const patterns = this.getHtmlHighlightPatterns(highlight);
            for (const {pattern} of patterns) {
                const regex = new RegExp(pattern, 'gi');
                let match;
                while ((match = regex.exec(content)) !== null) {
                    const distance = Math.abs(match.index - highlight.startOffset);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestMatch = { index: match.index, length: match[0].length };
                    }
                }
            }
        } else {
            // Regular markdown highlight pattern
            const regexPattern = `==${escapedText}==`;
            const highlightRegex = new RegExp(regexPattern, 'g');
            let match;
            while ((match = highlightRegex.exec(content)) !== null) {
                const distance = Math.abs(match.index - highlight.startOffset);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = { index: match.index, length: match[0].length };
                }
            }
        }

        if (!bestMatch) {
            return false;
        }

        let insertOffset = bestMatch.index + bestMatch.length;
        
        // Use the same footnote boundary detection logic as the sidebar view
        const afterHighlight = content.substring(insertOffset);
        const footnoteEndMatch = afterHighlight.match(/^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\]))*/);
        let footnoteEndLength = footnoteEndMatch ? footnoteEndMatch[0].length : 0;
        
        // If there are footnotes and content continues after them, don't include trailing whitespace
        if (footnoteEndLength > 0 && afterHighlight.length > footnoteEndLength) {
            const afterFootnotes = afterHighlight.substring(footnoteEndLength);
            // If the next character after footnotes is non-whitespace, position right after footnotes
            if (afterFootnotes.match(/^\S/)) {
                // footnoteEndLength is already correct (no trailing whitespace included)
            } else {
                // Check if there's whitespace followed by content
                const whitespaceMatch = afterFootnotes.match(/^(\s+)/);
                if (whitespaceMatch) {
                    const whitespaceAfterFootnotes = whitespaceMatch[1];
                    const afterWhitespace = afterFootnotes.substring(whitespaceMatch[0].length);
                    // Only include the whitespace if there's no content after it (end of line)
                    if (afterWhitespace.length === 0) {
                        footnoteEndLength += whitespaceMatch[0].length;
                    }
                    // If there's content after whitespace, don't include the whitespace
                }
            }
        } else if (footnoteEndLength > 0) {
            // No content after footnotes, include any trailing whitespace  
            const trailingWhitespaceMatch = afterHighlight.substring(footnoteEndLength).match(/^\s+/);
            if (trailingWhitespaceMatch) {
                footnoteEndLength += trailingWhitespaceMatch[0].length;
            }
        }
        insertOffset += footnoteEndLength;
        
        // Add inline footnote without extra spacing
        const footnoteText = `^[${footnoteContent}]`;
        
        const insertPos = editor.offsetToPos(insertOffset);
        editor.replaceRange(footnoteText, insertPos);
        
        // Position cursor inside the brackets for easy editing
        if (footnoteContent.length > 0) {
            // Select the footnote content for easy editing
            const footnoteStartPos = editor.offsetToPos(insertOffset + footnoteText.indexOf(footnoteContent));
            const footnoteEndPos = editor.offsetToPos(insertOffset + footnoteText.indexOf(footnoteContent) + footnoteContent.length);
            editor.setSelection(footnoteStartPos, footnoteEndPos);
        } else {
            // Position cursor between the brackets: ^[|]
            const cursorPos = editor.offsetToPos(insertOffset + footnoteText.length - 1);
            editor.setCursor(cursorPos);
        }
        editor.focus();
        
        return true;
    }
    
    /**
     * Escapes special regex characters in text
     */
    private escapeRegex(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
}