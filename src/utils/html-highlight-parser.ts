/**
 * HTML Highlight Parser
 *
 * Parses HTML highlight tags from content using DOMParser instead of regex.
 * Handles: <span style="background:color">, <font color="color">, <mark>, <span class="class">
 */

export interface HtmlHighlight {
    text: string;
    color: string;
    startOffset: number;
    endOffset: number;
    tagType: 'span-background' | 'font-color' | 'mark' | 'span-class';
    fullMatch: string;
}

export class HtmlHighlightParser {
    /**
     * Parse HTML highlights from content
     * @param content The markdown content to parse
     * @param codeBlockRanges Ranges to exclude from parsing (code blocks)
     * @returns Array of parsed HTML highlights with their positions
     */
    static parseHighlights(
        content: string,
        codeBlockRanges: Array<{start: number, end: number}> = []
    ): HtmlHighlight[] {
        const highlights: HtmlHighlight[] = [];

        // Find all potential HTML tags in the content
        const htmlTagRegex = /<(span|font|mark)[^>]*>.*?<\/\1>/gis;
        let match;

        while ((match = htmlTagRegex.exec(content)) !== null) {
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;
            const fullMatch = match[0];

            // Skip if inside code block
            if (this.isInsideCodeBlock(startOffset, endOffset, codeBlockRanges)) {
                continue;
            }

            // Parse the HTML tag using DOMParser
            const highlight = this.parseHtmlTag(fullMatch, startOffset);
            if (highlight) {
                highlights.push(highlight);
            }
        }

        return highlights;
    }

    /**
     * Parse a single HTML tag to extract highlight information
     */
    private static parseHtmlTag(htmlString: string, startOffset: number): HtmlHighlight | null {
        try {
            // Create a temporary DOM element to parse the HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');
            const element = doc.body.firstChild as Element;

            if (!element) {
                return null;
            }

            const tagName = element.tagName.toLowerCase();
            const text = element.textContent || '';

            // Skip empty or whitespace-only content
            if (!text || text.trim() === '') {
                return null;
            }

            let color: string | null = null;
            let tagType: HtmlHighlight['tagType'] | null = null;

            // Parse based on tag type
            if (tagName === 'span') {
                const style = element.getAttribute('style');
                const className = element.getAttribute('class');

                if (style && /background\s*:/i.test(style)) {
                    // Extract background color from style
                    const bgMatch = style.match(/background\s*:\s*([^;]+)/i);
                    if (bgMatch) {
                        color = this.parseHtmlColor(bgMatch[1]);
                        tagType = 'span-background';
                    }
                } else if (className) {
                    // Extract color from CSS class
                    color = this.getCssClassColor(className);
                    tagType = 'span-class';
                }
            } else if (tagName === 'font') {
                const colorAttr = element.getAttribute('color');
                if (colorAttr) {
                    color = this.parseHtmlColor(colorAttr);
                    tagType = 'font-color';
                }
            } else if (tagName === 'mark') {
                color = '#ffff00'; // Default yellow for <mark>
                tagType = 'mark';
            }

            // Return null if we couldn't extract a valid color
            if (!color || !tagType) {
                return null;
            }

            return {
                text,
                color,
                startOffset,
                endOffset: startOffset + htmlString.length,
                tagType,
                fullMatch: htmlString
            };
        } catch (error) {
            // If parsing fails, return null
            console.warn('Failed to parse HTML tag:', htmlString, error);
            return null;
        }
    }

    /**
     * Find a specific highlight instance by offset
     * Handles duplicate text correctly using distance-based matching
     */
    static findHighlightAtOffset(
        content: string,
        text: string,
        targetOffset: number,
        codeBlockRanges: Array<{start: number, end: number}> = []
    ): HtmlHighlight | null {
        const highlights = this.parseHighlights(content, codeBlockRanges);

        // Filter to only highlights with matching text
        const matchingHighlights = highlights.filter(h => h.text === text);

        if (matchingHighlights.length === 0) {
            return null;
        }

        // Find the closest match by offset
        let closestMatch = matchingHighlights[0];
        let minDistance = Math.abs(closestMatch.startOffset - targetOffset);

        for (const highlight of matchingHighlights) {
            const distance = Math.abs(highlight.startOffset - targetOffset);
            if (distance < minDistance) {
                minDistance = distance;
                closestMatch = highlight;
            }
        }

        return closestMatch;
    }

    /**
     * Check if a range is inside any code block
     */
    private static isInsideCodeBlock(
        start: number,
        end: number,
        codeBlockRanges: Array<{start: number, end: number}>
    ): boolean {
        return codeBlockRanges.some(range => start >= range.start && end <= range.end);
    }

    /**
     * Parse HTML color value to hex format
     */
    private static parseHtmlColor(colorValue: string): string | null {
        const color = colorValue.trim().toLowerCase();

        // Named colors to hex mapping
        const namedColors: { [key: string]: string } = {
            'yellow': '#ffff00',
            'red': '#ff0000',
            'green': '#008000',
            'blue': '#0000ff',
            'orange': '#ffa500',
            'purple': '#800080',
            'pink': '#ffc0cb',
            'cyan': '#00ffff',
            'magenta': '#ff00ff',
            'lime': '#00ff00',
            'brown': '#a52a2a',
            'gray': '#808080',
            'grey': '#808080',
            'black': '#000000',
            'white': '#ffffff'
        };

        // Check if it's a named color
        if (namedColors[color]) {
            return namedColors[color];
        }

        // Check if it's already a hex color
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
            // Convert 3-digit hex to 6-digit
            if (color.length === 4) {
                return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
            }
            return color;
        }

        // Check if it's an rgb/rgba value
        const rgbMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (rgbMatch) {
            const r = parseInt(rgbMatch[1]);
            const g = parseInt(rgbMatch[2]);
            const b = parseInt(rgbMatch[3]);
            return '#' +
                r.toString(16).padStart(2, '0') +
                g.toString(16).padStart(2, '0') +
                b.toString(16).padStart(2, '0');
        }

        // Return null for unsupported color formats
        return null;
    }

    /**
     * Get color from CSS class by creating a temporary element
     */
    private static getCssClassColor(className: string): string | null {
        try {
            // Create temporary element to test the class
            const tempEl = document.createElement('span');
            tempEl.className = className;
            tempEl.style.visibility = 'hidden';
            tempEl.style.position = 'absolute';
            document.body.appendChild(tempEl);

            // Get computed background color
            const computed = window.getComputedStyle(tempEl);
            const bgColor = computed.backgroundColor;

            // Cleanup
            document.body.removeChild(tempEl);

            // Parse the rgba color
            if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
                return this.parseHtmlColor(bgColor);
            }

            return null;
        } catch {
            return null;
        }
    }
}
