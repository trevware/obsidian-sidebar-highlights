import { Editor } from 'obsidian';
import type { Highlight } from '../../main';
import { HtmlHighlightParser } from '../utils/html-highlight-parser';

export interface InlineFootnoteMatch {
    content: string;
    startIndex: number;
    endIndex: number;
}

export class InlineFootnoteManager {

    /**
     * Calculates the length of footnotes (standard and inline) after a position in text
     * Handles nested brackets in inline footnotes correctly
     */
    public static calculateFootnoteLength(text: string, startPosition: number = 0): number {
        const afterPosition = text.substring(startPosition);
        let pos = 0;
        let lastFootnoteEnd = 0;

        while (pos < afterPosition.length) {
            // Skip whitespace, but track where we are
            const whitespaceMatch = afterPosition.substring(pos).match(/^(\s+)/);
            if (whitespaceMatch) {
                pos += whitespaceMatch[0].length;
                // Don't update lastFootnoteEnd - whitespace only counts if followed by a footnote

                // If we're at the end, return the position before whitespace
                if (pos >= afterPosition.length) {
                    return lastFootnoteEnd;
                }
            }

            // Check for standard footnote [^key]
            const standardMatch = afterPosition.substring(pos).match(/^\[\^[a-zA-Z0-9_-]+\]/);
            if (standardMatch) {
                pos += standardMatch[0].length;
                lastFootnoteEnd = pos;
                continue;
            }

            // Check for inline footnote ^[...] with nested bracket support
            if (afterPosition.substring(pos, pos + 2) === '^[') {
                pos += 2;
                let bracketDepth = 1;
                while (pos < afterPosition.length && bracketDepth > 0) {
                    if (afterPosition[pos] === '[') {
                        bracketDepth++;
                    } else if (afterPosition[pos] === ']') {
                        bracketDepth--;
                    }
                    pos++;
                }
                if (bracketDepth !== 0) {
                    // Unmatched brackets, stop here
                    break;
                }
                lastFootnoteEnd = pos;
                continue;
            }

            // Found something that's not a footnote or whitespace
            break;
        }

        return lastFootnoteEnd;
    }

    private isHtmlHighlight(highlight: Highlight): boolean {
        // HTML highlights have a color property and are not native comments
        return !highlight.isNativeComment && !!highlight.color;
    }
    
    /**
     * Extracts inline footnotes immediately following a highlight
     * Pattern: ^[content] with optional spaces between multiple footnotes
     */
    public extractInlineFootnotes(content: string, highlightEndIndex: number): InlineFootnoteMatch[] {
        const inlineFootnotes: InlineFootnoteMatch[] = [];
        const afterHighlight = content.substring(highlightEndIndex);

        // Match one or more inline footnotes with optional spaces between them
        // Pattern: ^[content] with support for nested brackets (like wikilinks [[link]])
        // We need to manually parse to handle nested brackets correctly
        let position = 0;

        while (position < afterHighlight.length) {
            // Skip whitespace
            const whitespaceMatch = afterHighlight.substring(position).match(/^(\s*)/);
            if (whitespaceMatch) {
                position += whitespaceMatch[0].length;
            }

            // Check if this position is valid for a footnote
            if (position > 0 && !this.isValidFootnotePosition(afterHighlight, position)) {
                break;
            }

            // Skip over standard footnotes [^key] as they're handled separately
            const standardMatch = afterHighlight.substring(position).match(/^\[\^[a-zA-Z0-9_-]+\]/);
            if (standardMatch) {
                position += standardMatch[0].length;
                continue; // Continue looking for inline footnotes
            }

            // Look for inline footnote start: ^[
            if (afterHighlight.substring(position, position + 2) === '^[') {
                const startPos = position;
                position += 2; // Skip past ^[

                // Find the matching closing bracket, handling nested brackets
                let bracketDepth = 1;
                let contentStart = position;

                while (position < afterHighlight.length && bracketDepth > 0) {
                    if (afterHighlight[position] === '[') {
                        bracketDepth++;
                    } else if (afterHighlight[position] === ']') {
                        bracketDepth--;
                    }
                    if (bracketDepth > 0) {
                        position++;
                    }
                }

                if (bracketDepth === 0) {
                    // Successfully found matching bracket
                    const content = afterHighlight.substring(contentStart, position);
                    inlineFootnotes.push({
                        content: content,
                        startIndex: highlightEndIndex + startPos,
                        endIndex: highlightEndIndex + position + 1 // +1 to include the closing ]
                    });
                    position++; // Move past the closing bracket
                } else {
                    // Unmatched bracket, stop processing
                    break;
                }
            } else {
                // No more inline footnotes found
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
        // Should only contain whitespace, standard footnotes [^key], or previous inline footnotes ^[...]
        // Allow alphanumeric keys and underscores/hyphens for standard footnotes
        // For inline footnotes, we need to handle nested brackets properly

        let pos = 0;
        while (pos < precedingText.length) {
            // Skip whitespace
            const whitespaceMatch = precedingText.substring(pos).match(/^(\s+)/);
            if (whitespaceMatch) {
                pos += whitespaceMatch[0].length;
                continue;
            }

            // Check for standard footnote [^key]
            const standardMatch = precedingText.substring(pos).match(/^\[\^[a-zA-Z0-9_-]+\]/);
            if (standardMatch) {
                pos += standardMatch[0].length;
                continue;
            }

            // Check for inline footnote ^[...]
            if (precedingText.substring(pos, pos + 2) === '^[') {
                pos += 2;
                let bracketDepth = 1;
                while (pos < precedingText.length && bracketDepth > 0) {
                    if (precedingText[pos] === '[') {
                        bracketDepth++;
                    } else if (precedingText[pos] === ']') {
                        bracketDepth--;
                    }
                    pos++;
                }
                if (bracketDepth !== 0) {
                    return false; // Unmatched brackets
                }
                continue;
            }

            // Found something that's not whitespace or a footnote
            return false;
        }

        return true;
    }
    
    /**
     * Inserts an inline footnote after a highlight in the editor
     */
    public insertInlineFootnote(editor: Editor, highlight: Highlight, footnoteContent: string): { success: boolean, insertPos?: { line: number, ch: number }, contentLength: number } {
        const content = editor.getValue();
        const escapedText = this.escapeRegex(highlight.text);
        
        let bestMatch: { index: number, length: number } | null = null;
        let minDistance = Infinity;

        if (highlight.isNativeComment) {
            // Try HTML comment pattern first
            const htmlCommentPattern = `<!--\\s*${escapedText}\\s*-->`;
            const htmlCommentRegex = new RegExp(htmlCommentPattern, 'g');
            let match;
            while ((match = htmlCommentRegex.exec(content)) !== null) {
                const distance = Math.abs(match.index - highlight.startOffset);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = { index: match.index, length: match[0].length };
                }
            }

            // If no HTML comment matches, try native comment pattern
            if (!bestMatch) {
                const regexPattern = `%%${escapedText}%%`;
                const highlightRegex = new RegExp(regexPattern, 'g');
                while ((match = highlightRegex.exec(content)) !== null) {
                    const distance = Math.abs(match.index - highlight.startOffset);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestMatch = { index: match.index, length: match[0].length };
                    }
                }
            }
        } else if (this.isHtmlHighlight(highlight)) {
            // Use HTML parser for distance-based matching
            const htmlHighlight = HtmlHighlightParser.findHighlightAtOffset(
                content,
                highlight.text,
                highlight.startOffset,
                [] // No code block ranges available in this context
            );

            if (htmlHighlight) {
                bestMatch = {
                    index: htmlHighlight.startOffset,
                    length: htmlHighlight.endOffset - htmlHighlight.startOffset
                };
                minDistance = 0; // Found exact match
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
            return { success: false, contentLength: footnoteContent.length };
        }

        let insertOffset = bestMatch.index + bestMatch.length;

        // Get text after highlight, but only up to the end of the current line
        const afterHighlight = content.substring(insertOffset);
        const newlineMatch = afterHighlight.match(/^[^\r\n]*/);
        const restOfLine = newlineMatch ? newlineMatch[0] : '';

        // Use the static helper to calculate footnote length with nested bracket support
        // Only look for footnotes on the same line
        let footnoteEndLength = InlineFootnoteManager.calculateFootnoteLength(restOfLine);

        // If there are existing footnotes, position after them
        if (footnoteEndLength > 0) {
            // Include any trailing spaces/tabs on this line (but not newlines)
            const afterFootnotes = restOfLine.substring(footnoteEndLength);
            const trailingSpacesMatch = afterFootnotes.match(/^[ \t]+/);
            if (trailingSpacesMatch) {
                // Only include trailing spaces if there's no more content on this line
                const afterSpaces = afterFootnotes.substring(trailingSpacesMatch[0].length);
                if (afterSpaces.length === 0) {
                    footnoteEndLength += trailingSpacesMatch[0].length;
                }
            }
        }

        insertOffset += footnoteEndLength;
        
        // Add inline footnote without extra spacing
        const footnoteText = `^[${footnoteContent}]`;

        const insertPos = editor.offsetToPos(insertOffset);
        editor.replaceRange(footnoteText, insertPos);

        // Return insertion info so caller can position cursor after editor updates
        return {
            success: true,
            insertPos: { line: insertPos.line, ch: insertPos.ch },
            contentLength: footnoteContent.length
        };
    }
    
    /**
     * Escapes special regex characters in text
     */
    private escapeRegex(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
}