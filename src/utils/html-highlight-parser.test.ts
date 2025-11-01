/**
 * Tests for HTML Highlight Parser
 */

import { HtmlHighlightParser, HtmlHighlight } from './html-highlight-parser';

describe('HtmlHighlightParser', () => {
    describe('parseHighlights', () => {
        describe('Font color tags', () => {
            it('should parse font color tag with hex color', () => {
                const content = 'This is <font color="#ff0000">highlighted text</font> in a document.';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0]).toMatchObject({
                    text: 'highlighted text',
                    color: '#ff0000',
                    tagType: 'font-color',
                    startOffset: 8,
                    endOffset: 53
                });
            });

            it('should parse font color tag with named color', () => {
                const content = '<font color="red">Important</font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0]).toMatchObject({
                    text: 'Important',
                    color: '#ff0000',
                    tagType: 'font-color'
                });
            });

            it('should parse font color tag with short hex', () => {
                const content = '<font color="#f00">text</font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0].color).toBe('#ff0000');
            });

            it('should handle case-insensitive color names', () => {
                const content = '<font color="BLUE">text</font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0].color).toBe('#0000ff');
            });

            it('should handle various named colors', () => {
                const colors = [
                    { name: 'yellow', hex: '#ffff00' },
                    { name: 'orange', hex: '#ffa500' },
                    { name: 'purple', hex: '#800080' },
                    { name: 'pink', hex: '#ffc0cb' },
                    { name: 'cyan', hex: '#00ffff' },
                    { name: 'magenta', hex: '#ff00ff' },
                    { name: 'lime', hex: '#00ff00' },
                    { name: 'brown', hex: '#a52a2a' },
                    { name: 'gray', hex: '#808080' },
                    { name: 'grey', hex: '#808080' }
                ];

                colors.forEach(({ name, hex }) => {
                    const content = `<font color="${name}">text</font>`;
                    const highlights = HtmlHighlightParser.parseHighlights(content);
                    expect(highlights[0].color).toBe(hex);
                });
            });
        });

        describe('Span background tags', () => {
            it('should parse span with background color', () => {
                const content = '<span style="background:#ffff00">highlighted</span>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0]).toMatchObject({
                    text: 'highlighted',
                    color: '#ffff00',
                    tagType: 'span-background'
                });
            });

            it('should parse span with background and other styles', () => {
                const content = '<span style="color:red; background:#00ff00; font-weight:bold">text</span>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0]).toMatchObject({
                    text: 'text',
                    color: '#00ff00',
                    tagType: 'span-background'
                });
            });

            it('should handle background with named color', () => {
                const content = '<span style="background:yellow">text</span>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0].color).toBe('#ffff00');
            });

            it('should handle whitespace in style attribute', () => {
                const content = '<span style=" background : yellow ">text</span>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0].color).toBe('#ffff00');
            });
        });

        describe('Mark tags', () => {
            it('should parse mark tag with default yellow', () => {
                const content = 'Some <mark>marked text</mark> here.';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0]).toMatchObject({
                    text: 'marked text',
                    color: '#ffff00',
                    tagType: 'mark'
                });
            });

            it('should parse mark tag with attributes', () => {
                const content = '<mark class="important">text</mark>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0].color).toBe('#ffff00');
            });
        });

        describe('Multiple highlights', () => {
            it('should parse multiple highlights of same type', () => {
                const content = '<font color="red">first</font> and <font color="blue">second</font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(2);
                expect(highlights[0]).toMatchObject({
                    text: 'first',
                    color: '#ff0000'
                });
                expect(highlights[1]).toMatchObject({
                    text: 'second',
                    color: '#0000ff'
                });
            });

            it('should parse mixed tag types', () => {
                const content = '<font color="red">font</font> <span style="background:yellow">span</span> <mark>mark</mark>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(3);
                expect(highlights[0].tagType).toBe('font-color');
                expect(highlights[1].tagType).toBe('span-background');
                expect(highlights[2].tagType).toBe('mark');
            });
        });

        describe('Code block exclusion', () => {
            it('should exclude highlights in inline code', () => {
                const content = 'Normal text `<font color="red">code</font>` more text';
                const codeBlockRanges = [{ start: 12, end: 43 }];
                const highlights = HtmlHighlightParser.parseHighlights(content, codeBlockRanges);

                expect(highlights).toHaveLength(0);
            });

            it('should exclude highlights in fenced code blocks', () => {
                const content = `Text before
\`\`\`
<font color="red">code</font>
\`\`\`
Text after`;
                const codeBlockRanges = [{ start: 12, end: 54 }];
                const highlights = HtmlHighlightParser.parseHighlights(content, codeBlockRanges);

                expect(highlights).toHaveLength(0);
            });

            it('should include highlights outside code blocks', () => {
                const content = '<font color="red">before</font> `code` <font color="blue">after</font>';
                const codeBlockRanges = [{ start: 32, end: 38 }];
                const highlights = HtmlHighlightParser.parseHighlights(content, codeBlockRanges);

                expect(highlights).toHaveLength(2);
                expect(highlights[0].text).toBe('before');
                expect(highlights[1].text).toBe('after');
            });
        });

        describe('Edge cases', () => {
            it('should skip empty highlights', () => {
                const content = '<font color="red"></font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(0);
            });

            it('should skip whitespace-only highlights', () => {
                const content = '<font color="red">   </font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(0);
            });

            it('should handle nested tags', () => {
                const content = '<font color="red">outer <mark>inner</mark> text</font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                // Should parse both the outer font tag and inner mark tag
                expect(highlights.length).toBeGreaterThan(0);
            });

            it('should handle malformed HTML gracefully', () => {
                const content = '<font color="red">unclosed tag';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                // Parser should handle gracefully, might return 0 or 1 depending on implementation
                expect(highlights).toBeInstanceOf(Array);
            });

            it('should handle special characters in text', () => {
                const content = '<font color="red">Text with & < > " \' special chars</font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0].text).toContain('&');
            });

            it('should handle multiline highlights', () => {
                const content = `<font color="red">Line 1
Line 2
Line 3</font>`;
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights).toHaveLength(1);
                expect(highlights[0].text).toContain('Line 1');
                expect(highlights[0].text).toContain('Line 3');
            });
        });

        describe('Position tracking', () => {
            it('should correctly track startOffset', () => {
                const content = 'Prefix text <font color="red">highlight</font> suffix';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights[0].startOffset).toBe(12);
            });

            it('should correctly track endOffset', () => {
                const content = 'Prefix <font color="red">highlight</font> suffix';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                const highlight = highlights[0];
                expect(highlight.endOffset).toBe(highlight.startOffset + highlight.fullMatch.length);
            });

            it('should track positions for multiple highlights', () => {
                const content = '<font color="red">first</font> middle <font color="blue">second</font>';
                const highlights = HtmlHighlightParser.parseHighlights(content);

                expect(highlights[0].startOffset).toBe(0);
                expect(highlights[1].startOffset).toBeGreaterThan(highlights[0].endOffset);
            });
        });
    });

    describe('findHighlightAtOffset', () => {
        it('should find correct highlight by offset', () => {
            const content = '<font color="red">first</font> text <font color="blue">second</font>';
            const highlight = HtmlHighlightParser.findHighlightAtOffset(content, 'first', 0);

            expect(highlight).not.toBeNull();
            expect(highlight?.text).toBe('first');
            expect(highlight?.color).toBe('#ff0000');
        });

        it('should handle duplicate text with different offsets', () => {
            const content = '<font color="red">duplicate</font> text <font color="blue">duplicate</font>';

            // Find first instance
            const first = HtmlHighlightParser.findHighlightAtOffset(content, 'duplicate', 0);
            expect(first?.color).toBe('#ff0000');

            // Find second instance
            const second = HtmlHighlightParser.findHighlightAtOffset(content, 'duplicate', 40);
            expect(second?.color).toBe('#0000ff');
        });

        it('should return null for non-existent text', () => {
            const content = '<font color="red">text</font>';
            const highlight = HtmlHighlightParser.findHighlightAtOffset(content, 'nonexistent', 0);

            expect(highlight).toBeNull();
        });

        it('should find closest match when offset is approximate', () => {
            const content = '<font color="red">target</font>';

            // Try with slightly off offset
            const highlight = HtmlHighlightParser.findHighlightAtOffset(content, 'target', 5);

            expect(highlight).not.toBeNull();
            expect(highlight?.text).toBe('target');
        });

        it('should exclude highlights in code blocks', () => {
            const content = '<font color="red">text</font> `<font color="red">text</font>`';
            const codeBlockRanges = [{ start: 30, end: 60 }];

            const highlight = HtmlHighlightParser.findHighlightAtOffset(content, 'text', 0, codeBlockRanges);

            expect(highlight).not.toBeNull();
            expect(highlight?.startOffset).toBe(0);
        });
    });

    describe('Color parsing', () => {
        it('should parse RGB colors', () => {
            const content = '<span style="background:rgb(255, 0, 0)">text</span>';
            const highlights = HtmlHighlightParser.parseHighlights(content);

            expect(highlights[0].color).toBe('#ff0000');
        });

        it('should parse RGBA colors (ignoring alpha)', () => {
            const content = '<span style="background:rgba(0, 255, 0, 0.5)">text</span>';
            const highlights = HtmlHighlightParser.parseHighlights(content);

            expect(highlights[0].color).toBe('#00ff00');
        });

        it('should handle RGB with whitespace', () => {
            const content = '<span style="background: rgb( 100 , 150 , 200 )">text</span>';
            const highlights = HtmlHighlightParser.parseHighlights(content);

            expect(highlights[0].color).toBe('#6496c8');
        });
    });

    describe('Real-world scenarios', () => {
        it('should handle URL with == in markdown link', () => {
            const content = '[link](https://example.com?param==value) <font color="red">highlight</font>';
            const highlights = HtmlHighlightParser.parseHighlights(content);

            expect(highlights).toHaveLength(1);
            expect(highlights[0].text).toBe('highlight');
        });

        it('should handle mixed markdown and HTML', () => {
            const content = '**Bold** and <font color="red">colored</font> and ==highlighted==';
            const highlights = HtmlHighlightParser.parseHighlights(content);

            expect(highlights).toHaveLength(1);
            expect(highlights[0].text).toBe('colored');
        });

        it('should handle complex document structure', () => {
            const content = `# Heading

Some paragraph with <font color="red">red text</font> and more.

- List item with <span style="background:yellow">yellow highlight</span>
- Another item

<mark>Important note</mark> at the end.`;

            const highlights = HtmlHighlightParser.parseHighlights(content);

            expect(highlights).toHaveLength(3);
            expect(highlights[0].color).toBe('#ff0000');
            expect(highlights[1].color).toBe('#ffff00');
            expect(highlights[2].color).toBe('#ffff00');
        });
    });
});
