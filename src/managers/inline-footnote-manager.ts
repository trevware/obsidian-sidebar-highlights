import { Editor } from 'obsidian';
import type { Highlight } from '../../main';

export interface InlineFootnoteMatch {
    content: string;
    startIndex: number;
    endIndex: number;
}

export class InlineFootnoteManager {
    
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
        
        // Find the highlight in the content
        const regexPattern = highlight.isNativeComment 
            ? `%%${escapedText}%%`
            : `==${escapedText}==`;
        const highlightRegex = new RegExp(regexPattern, 'g');
        let match;
        let bestMatch: { index: number, length: number } | null = null;
        let minDistance = Infinity;

        while ((match = highlightRegex.exec(content)) !== null) {
            const distance = Math.abs(match.index - highlight.startOffset);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = { index: match.index, length: match[0].length };
            }
        }

        if (!bestMatch) {
            return false;
        }

        let insertOffset = bestMatch.index + bestMatch.length;
        
        // Find the position after the last footnote (of any type) in the sequence
        const afterHighlight = content.substring(insertOffset);
        
        // Find all footnotes (both standard and inline) in order
        const allFootnotes: Array<{type: 'standard' | 'inline', index: number, endIndex: number}> = [];
        
        // Get all inline footnotes with their positions
        const inlineFootnotes = this.extractInlineFootnotes(content, insertOffset);
        inlineFootnotes.forEach(footnote => {
            allFootnotes.push({
                type: 'inline',
                index: footnote.startIndex,
                endIndex: footnote.endIndex
            });
        });
        
        // Get all standard footnotes with their positions (using same validation logic)
        // Use negative lookahead to avoid matching footnote definitions [^key]: content
        const standardFootnoteRegex = /(\s*\[\^(\w+)\])(?!:)/g;
        let match_sf;
        let lastValidPosition = 0;
        
        while ((match_sf = standardFootnoteRegex.exec(afterHighlight)) !== null) {
            // Check if this standard footnote is in a valid position
            const precedingText = afterHighlight.substring(lastValidPosition, match_sf.index);
            const isValid = /^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*\s*$/.test(precedingText);
            
            if (match_sf.index === lastValidPosition || isValid) {
                allFootnotes.push({
                    type: 'standard',
                    index: insertOffset + match_sf.index,
                    endIndex: insertOffset + match_sf.index + match_sf[0].length
                });
                lastValidPosition = match_sf.index + match_sf[0].length;
            } else {
                // Stop if we encounter a footnote that's not in the valid sequence
                break;
            }
        }
        
        // Sort footnotes by their position and find the last one
        allFootnotes.sort((a, b) => a.index - b.index);
        if (allFootnotes.length > 0) {
            const lastFootnote = allFootnotes[allFootnotes.length - 1];
            insertOffset = lastFootnote.endIndex;
        }
        
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