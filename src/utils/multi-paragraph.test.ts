describe('Multi-paragraph Highlights', () => {

    // Helper to simulate highlight detection
    const detectHighlights = (content: string) => {
        const markdownHighlightRegex = /==((?:[^=]|=[^=])+?)==/g;
        const matches: Array<{ text: string, start: number, end: number }> = [];
        let match;

        while ((match = markdownHighlightRegex.exec(content)) !== null) {
            matches.push({
                text: match[1],
                start: match.index,
                end: match.index + match[0].length
            });
        }

        return matches;
    };

    describe('Basic multi-paragraph detection', () => {
        it('should detect highlight spanning two paragraphs', () => {
            const content = `==First paragraph.

Second paragraph.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe(`First paragraph.

Second paragraph.`);
        });

        it('should detect highlight spanning three paragraphs', () => {
            const content = `==Paragraph one.

Paragraph two.

Paragraph three.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe(`Paragraph one.

Paragraph two.

Paragraph three.`);
        });

        it('should detect multiple multi-paragraph highlights', () => {
            const content = `==First multi-paragraph

highlight.== Some text. ==Second multi-paragraph

highlight.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(2);
            expect(matches[0].text).toBe(`First multi-paragraph

highlight.`);
            expect(matches[1].text).toBe(`Second multi-paragraph

highlight.`);
        });

        it('should preserve blank lines within highlight', () => {
            const content = `==Text before blank line.


Text after blank line.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe(`Text before blank line.


Text after blank line.`);
        });
    });

    describe('Multi-paragraph with line breaks', () => {
        it('should detect highlight with single line breaks', () => {
            const content = `==Line one
Line two
Line three==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe(`Line one
Line two
Line three`);
        });

        it('should detect highlight with mixed line breaks', () => {
            const content = `==Line one

Line three
Line four==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe(`Line one

Line three
Line four`);
        });
    });

    describe('Multi-paragraph with special content', () => {
        it('should detect multi-paragraph with lists', () => {
            const content = `==Intro paragraph.

- List item 1
- List item 2

Conclusion.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe(`Intro paragraph.

- List item 1
- List item 2

Conclusion.`);
        });

        it('should detect multi-paragraph with headings', () => {
            const content = `==## First Section

Content here.

## Second Section

More content.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toContain('## First Section');
            expect(matches[0].text).toContain('## Second Section');
        });

        it('should detect multi-paragraph with bold/italic', () => {
            const content = `==First paragraph with **bold**.

Second paragraph with *italic*.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe(`First paragraph with **bold**.

Second paragraph with *italic*.`);
        });

        it('should detect multi-paragraph with single equals signs', () => {
            const content = `==First paragraph with a=b equation.

Second paragraph with x=y.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe(`First paragraph with a=b equation.

Second paragraph with x=y.`);
        });
    });

    describe('Edge cases', () => {
        it('should not match empty highlights', () => {
            const content = `====`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(0);
        });

        it('should handle highlight with only newlines', () => {
            const content = `==

==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe('\n\n');
        });

        it('should stop at double equals', () => {
            const content = `==First highlight== text ==Second highlight==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(2);
            expect(matches[0].text).toBe('First highlight');
            expect(matches[1].text).toBe('Second highlight');
        });

        it('should handle nested single equals', () => {
            const content = `==Text with = and more = signs inside==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe('Text with = and more = signs inside');
        });
    });

    describe('Mixed single and multi-paragraph', () => {
        it('should detect both single and multi-paragraph highlights in same document', () => {
            const content = `==Single paragraph highlight.==

Some regular text.

==Multi-paragraph
highlight
here.==

More text.

==Another single.==`;

            const matches = detectHighlights(content);
            expect(matches).toHaveLength(3);
            expect(matches[0].text).toBe('Single paragraph highlight.');
            expect(matches[1].text).toBe(`Multi-paragraph
highlight
here.`);
            expect(matches[2].text).toBe('Another single.');
        });
    });

    describe('Native comments multi-paragraph', () => {
        it('should detect multi-paragraph native comments', () => {
            const commentRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;
            const content = `%%First paragraph.

Second paragraph.%%`;

            const matches: string[] = [];
            let match;
            while ((match = commentRegex.exec(content)) !== null) {
                matches.push(match[1]);
            }

            expect(matches).toHaveLength(1);
            expect(matches[0]).toBe(`First paragraph.

Second paragraph.`);
        });

        it('should detect multi-paragraph native comments with lists', () => {
            const commentRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;
            const content = `%%Note:

- Point 1
- Point 2

Conclusion.%%`;

            const matches: string[] = [];
            let match;
            while ((match = commentRegex.exec(content)) !== null) {
                matches.push(match[1]);
            }

            expect(matches).toHaveLength(1);
            expect(matches[0]).toContain('- Point 1');
            expect(matches[0]).toContain('Conclusion.');
        });
    });

    describe('Performance considerations', () => {
        it('should handle very long multi-paragraph highlights efficiently', () => {
            const paragraphs = Array(50).fill('This is a test paragraph.').join('\n\n');
            const content = `==${paragraphs}==`;

            const startTime = Date.now();
            const matches = detectHighlights(content);
            const endTime = Date.now();

            expect(matches).toHaveLength(1);
            expect(endTime - startTime).toBeLessThan(100); // Should complete in under 100ms
        });

        it('should not cause catastrophic backtracking', () => {
            // Test with many equals signs that could cause backtracking
            const content = `==Text with ${'='.repeat(100)} many equals==`;

            const startTime = Date.now();
            const matches = detectHighlights(content);
            const endTime = Date.now();

            expect(endTime - startTime).toBeLessThan(100);
        });
    });
});

export {};
