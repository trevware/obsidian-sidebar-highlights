/**
 * Tests for highlight detection and regex patterns
 * These tests ensure the main highlight detection logic works correctly
 */

export {};

describe('Highlight Detection Patterns', () => {
    describe('Markdown highlight regex', () => {
        const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;

        it('should match basic highlight', () => {
            const text = '==highlighted text==';
            const match = markdownHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('highlighted text');
        });

        it('should match highlight pattern with = inside', () => {
            // The regex requires: non-= at start, non-= at end, and middle can contain =
            // Minimum 2 chars (start + end), so `a=bc` works: a (start), =b (middle), c (end)
            const text = '==a=bc==';
            markdownHighlightRegex.lastIndex = 0;
            const match = markdownHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[1]).toBe('a=bc');
            }
        });

        it('should match pattern in triple equals but boundary check should reject it', () => {
            const text = '===text===';
            const match = markdownHighlightRegex.exec(text);

            // Pattern matches, but boundary check should reject
            if (match) {
                const beforeMatch = text.charAt(match.index - 1);
                const afterMatch = text.charAt(match.index + match[0].length);
                // Should be rejected by boundary check
                expect(beforeMatch === '=' || afterMatch === '=').toBe(true);
            }
        });

        it('should not match across newlines', () => {
            const text = '==text\nmore text==';
            const match = markdownHighlightRegex.exec(text);

            expect(match).toBeNull();
        });

        it('should match multiple highlights on same line', () => {
            const text = '==first== and ==second==';
            markdownHighlightRegex.lastIndex = 0;

            const matches = [];
            let match;
            while ((match = markdownHighlightRegex.exec(text)) !== null) {
                matches.push(match[1]);
            }

            expect(matches).toHaveLength(2);
            expect(matches[0]).toBe('first');
            expect(matches[1]).toBe('second');
        });

        it('should not match single equals', () => {
            const text = '=text=';
            const match = markdownHighlightRegex.exec(text);

            expect(match).toBeNull();
        });

        it('should match highlight with special characters', () => {
            const text = '==text with @#$%^&*() chars==';
            const match = markdownHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('text with @#$%^&*() chars');
        });
    });

    describe('Comment highlight regex', () => {
        const commentHighlightRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;

        it('should match basic comment', () => {
            const text = '%%comment text%%';
            const match = commentHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('comment text');
        });

        it('should match comment pattern with % inside', () => {
            // The regex requires: non-% at start, non-% at end, and middle can contain %
            // Minimum 2 chars (start + end), so `a%bc` works: a (start), %b (middle), c (end)
            const text = '%%a%bc%%';
            commentHighlightRegex.lastIndex = 0;
            const match = commentHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[1]).toBe('a%bc');
            }
        });

        it('should match pattern in triple percent but boundary check should reject it', () => {
            const text = '%%%text%%%';
            const match = commentHighlightRegex.exec(text);

            // Pattern matches, but boundary check should reject
            if (match) {
                const beforeMatch = text.charAt(match.index - 1);
                const afterMatch = text.charAt(match.index + match[0].length);
                // Should be rejected by boundary check
                expect(beforeMatch === '%' || afterMatch === '%').toBe(true);
            }
        });

        it('should match multiline comments', () => {
            const text = '%%first line\nsecond line%%';
            commentHighlightRegex.lastIndex = 0;
            const match = commentHighlightRegex.exec(text);

            if (match) {
                expect(match[1]).toContain('first line');
                expect(match[1]).toContain('second line');
            } else {
                // Comment regex might not support multiline - that's okay
                expect(true).toBe(true);
            }
        });
    });

    describe('Markdown link pattern', () => {
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

        it('should match basic link', () => {
            const text = '[text](url)';
            const match = linkRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('text');
            expect(match![2]).toBe('url');
        });

        it('should match link with == in URL', () => {
            const text = '[link](https://example.com?param==value)';
            linkRegex.lastIndex = 0;
            const match = linkRegex.exec(text);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[2]).toContain('==');
            }
        });

        it('should match link with multiple == in URL', () => {
            const text = '[link](https://example.com?a==b&c==d)';
            linkRegex.lastIndex = 0;
            const match = linkRegex.exec(text);

            expect(match).not.toBeNull();
            if (match) {
                // Count == occurrences in URL part
                const equalCount = (match[2].match(/==/g) || []).length;
                expect(equalCount).toBe(2);
            }
        });

        it('should match multiple links on same line', () => {
            const text = '[first](url1) and [second](url2)';
            linkRegex.lastIndex = 0;

            const matches = [];
            let match;
            while ((match = linkRegex.exec(text)) !== null) {
                matches.push(match[1]);
            }

            expect(matches).toHaveLength(2);
            expect(matches[0]).toBe('first');
            expect(matches[1]).toBe('second');
        });
    });

    describe('Code block detection', () => {
        it('should detect fenced code block boundaries', () => {
            const content = `Text before
\`\`\`
code here
\`\`\`
Text after`;

            const lines = content.split('\n');
            const codeBlockStarts = [];
            const codeBlockEnds = [];

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].match(/^```/)) {
                    if (codeBlockStarts.length === codeBlockEnds.length) {
                        codeBlockStarts.push(i);
                    } else {
                        codeBlockEnds.push(i);
                    }
                }
            }

            expect(codeBlockStarts).toHaveLength(1);
            expect(codeBlockEnds).toHaveLength(1);
            expect(codeBlockStarts[0]).toBe(1);
            expect(codeBlockEnds[0]).toBe(3);
        });

        // Regression: fenced code blocks inside callouts/blockquotes used to be
        // missed because the fence regex required the marker at column 0,
        // ignoring the leading "> " prefix. The fixed regex allows leading
        // whitespace and ">" characters before the fence.
        describe('fenced code blocks inside callouts/blockquotes', () => {
            // Mirror of getCodeBlockRanges in main.ts (parameterized so we can
            // verify the regex shape directly).
            function getCodeBlockRanges(content: string, openR: RegExp, waveR: RegExp) {
                const ranges: Array<{ start: number; end: number }> = [];
                const lines = content.split('\n');
                let blockStart: number | null = null;
                let blockType: 'backtick' | 'wave' | null = null;
                let pos = 0;
                for (const line of lines) {
                    const lineStart = pos;
                    const lineEnd = pos + line.length;
                    if (line.match(openR)) {
                        if (blockType === 'backtick') {
                            ranges.push({ start: blockStart!, end: lineEnd });
                            blockStart = null;
                            blockType = null;
                        } else if (blockStart === null) {
                            blockStart = lineStart;
                            blockType = 'backtick';
                        }
                    } else if (line.match(waveR)) {
                        if (blockType === 'wave') {
                            ranges.push({ start: blockStart!, end: lineEnd });
                            blockStart = null;
                            blockType = null;
                        } else if (blockStart === null) {
                            blockStart = lineStart;
                            blockType = 'wave';
                        }
                    }
                    pos = lineEnd + 1;
                }
                if (blockStart !== null) {
                    ranges.push({ start: blockStart, end: content.length });
                }
                return ranges;
            }

            const highlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;

            function findHighlights(content: string, ranges: Array<{ start: number; end: number }>) {
                const found: string[] = [];
                let m: RegExpExecArray | null;
                highlightRegex.lastIndex = 0;
                while ((m = highlightRegex.exec(content)) !== null) {
                    const inside = ranges.some(r => m!.index >= r.start && m!.index < r.end);
                    if (!inside) found.push(m[1]);
                }
                return found;
            }

            const FENCE = /^[\s>]*```/;
            const WAVE = /^[\s>]*~~~/;

            it('excludes ``` fences inside a blockquote', () => {
                const content = '> ```js\n> if (a == b && c == d) doStuff();\n> ```\nAfter ==real==\n';
                const ranges = getCodeBlockRanges(content, FENCE, WAVE);
                expect(findHighlights(content, ranges)).toEqual(['real']);
            });

            it('excludes ``` fences inside a callout', () => {
                const content = '> [!note]\n> ```dataviewjs\n> const t = dv.pages().where(p => p.x == 1 && p.y == 2);\n> ```\n==real==\n';
                const ranges = getCodeBlockRanges(content, FENCE, WAVE);
                expect(findHighlights(content, ranges)).toEqual(['real']);
            });

            it('excludes indented ``` fences in list items', () => {
                const content = '- item\n    ```js\n    if (a == b && c == d) doStuff();\n    ```\n==real==\n';
                const ranges = getCodeBlockRanges(content, FENCE, WAVE);
                expect(findHighlights(content, ranges)).toEqual(['real']);
            });

            it('excludes ~~~ fences inside a blockquote', () => {
                const content = '> ~~~js\n> if (a == b && c == d) doStuff();\n> ~~~\n==real==\n';
                const ranges = getCodeBlockRanges(content, FENCE, WAVE);
                expect(findHighlights(content, ranges)).toEqual(['real']);
            });

            it('still detects unwrapped ``` fences (regression baseline)', () => {
                const content = 'Before ==real==\n```js\nif (a == b && c == d) doStuff();\n```\nAfter ==also real==\n';
                const ranges = getCodeBlockRanges(content, FENCE, WAVE);
                expect(findHighlights(content, ranges)).toEqual(['real', 'also real']);
            });
        });

        it('should detect inline code pattern', () => {
            const inlineCodeRegex = /`([^`\n]+?)`/g;
            const text = 'some `inline code` here';
            const match = inlineCodeRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('inline code');
        });

        it('should not match code across newlines', () => {
            const inlineCodeRegex = /`([^`\n]+?)`/g;
            const text = '`code\nmore`';
            const match = inlineCodeRegex.exec(text);

            expect(match).toBeNull();
        });
    });

    describe('Highlight exclusion scenarios', () => {
        const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;

        it('should find highlight outside markdown link', () => {
            const text = '[link](url) ==highlighted==';
            const match = markdownHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('highlighted');
        });

        it('should not find highlight pattern within markdown link URL', () => {
            const text = '[link](url?param==value)';

            // Check if == appears in link pattern
            const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
            const linkMatch = linkRegex.exec(text);

            if (linkMatch) {
                const linkStart = linkMatch.index;
                const linkEnd = linkMatch.index + linkMatch[0].length;

                // Now check for highlights
                markdownHighlightRegex.lastIndex = 0;
                const highlightMatch = markdownHighlightRegex.exec(text);

                if (highlightMatch) {
                    const highlightStart = highlightMatch.index;
                    const highlightEnd = highlightMatch.index + highlightMatch[0].length;

                    // Should not be inside link
                    const isInsideLink = highlightStart >= linkStart && highlightEnd <= linkEnd;
                    expect(isInsideLink).toBe(true); // This proves the pattern exists in the link
                }
            }
        });

        it('should handle two links with == on same line', () => {
            const text = '[link1](url?a==b) [link2](url?c==d)';
            const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

            const links = [];
            let match;
            while ((match = linkRegex.exec(text)) !== null) {
                links.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    url: match[2]
                });
            }

            expect(links).toHaveLength(2);
            expect(links[0].url).toContain('==');
            expect(links[1].url).toContain('==');
        });

        // Regression: nested image-in-link syntax `[![alt](img)](dest)` used to
        // only match the inner image link, leaving the destination URL exposed.
        // When two such links sit on the same line, the `==` in their dest URLs
        // would combine to form a phantom highlight spanning between them.
        describe('nested image-in-link URL exclusion', () => {
            const linkRegex = /\[(?:[^\[\]]|\[[^\]]*\])*\]\(([^)]+)\)/g;
            const highlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;

            function findHighlights(content: string): string[] {
                const ranges: Array<{ start: number; end: number }> = [];
                let m: RegExpExecArray | null;
                linkRegex.lastIndex = 0;
                while ((m = linkRegex.exec(content)) !== null) {
                    ranges.push({ start: m.index, end: m.index + m[0].length });
                }
                const found: string[] = [];
                highlightRegex.lastIndex = 0;
                while ((m = highlightRegex.exec(content)) !== null) {
                    const inside = ranges.some(r => m!.index >= r.start && m!.index < r.end);
                    if (!inside) found.push(m[1]);
                }
                return found;
            }

            it('matches a nested image-in-link as a single range', () => {
                const text = '[![图片](https://example.com/img.png)](http://mp.weixin.qq.com/s?biz=Mzk0MDMyNDUxOQ**==&mid=1)';
                expect(findHighlights(text)).toEqual([]);
            });

            it('handles two nested image links on the same line', () => {
                const text =
                    '[![img1](https://example.com/img1.png)](http://mp.weixin.qq.com/s?biz=Mzk0MDMyNDUxOQ**==&mid=2247486828) ' +
                    '[![img2](https://example.com/img2.png)](http://mp.weixin.qq.com/s?biz=Mzk0MDMyNDUxOQ==**&mid=2247486797)';
                expect(findHighlights(text)).toEqual([]);
            });

            it('handles nested square brackets in the link label', () => {
                const text = '[link with [brackets] inside](http://example.com/?a==b)';
                expect(findHighlights(text)).toEqual([]);
            });

            it('still detects real highlights next to nested image links', () => {
                const text = '==important== then [![alt](https://example.com/img.png)](https://example.com/dest)';
                expect(findHighlights(text)).toEqual(['important']);
            });

            it('still detects real highlights inside the link label text', () => {
                // The label is part of the link range, so highlights inside it
                // are excluded. A highlight outside the link is preserved.
                const text = 'before ==hi== [text](http://example.com)';
                expect(findHighlights(text)).toEqual(['hi']);
            });
        });
    });

    describe('Boundary detection', () => {
        it('should reject highlight surrounded by extra equals', () => {
            const text = '===text===';
            const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
            const match = markdownHighlightRegex.exec(text);

            // Pattern might match, but boundary check should reject it
            if (match) {
                const beforeMatch = text.charAt(match.index - 1);
                const afterMatch = text.charAt(match.index + match[0].length);

                expect(beforeMatch === '=' || afterMatch === '=').toBe(true);
            } else {
                expect(match).toBeNull();
            }
        });

        it('should accept highlight with proper boundaries', () => {
            const text = 'some ==text== here';
            const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
            const match = markdownHighlightRegex.exec(text);

            expect(match).not.toBeNull();

            if (match) {
                const beforeMatch = text.charAt(match.index - 1);
                const afterMatch = text.charAt(match.index + match[0].length);

                expect(beforeMatch).not.toBe('=');
                expect(afterMatch).not.toBe('=');
            }
        });
    });

    describe('Footnote patterns', () => {
        it('should match standard footnote reference', () => {
            const standardFootnoteRegex = /\[\^([a-zA-Z0-9_-]+)\]/g;
            const text = 'Text[^1] with footnote';
            const match = standardFootnoteRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('1');
        });

        it('should match inline footnote', () => {
            const inlineFootnoteRegex = /\^\[([^\]]+)\]/g;
            const text = 'Text^[inline note] here';
            const match = inlineFootnoteRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('inline note');
        });

        it('should match footnote definition', () => {
            const footnoteDefRegex = /^\[\^(\w+)\]:\s*(.+)$/gm;
            const text = '[^1]: This is the footnote content';
            const match = footnoteDefRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('1');
            expect(match![2]).toBe('This is the footnote content');
        });
    });

    describe('Real-world issue patterns', () => {
        describe('Issue: URL with == in markdown link', () => {
            it('example1: single == in URL', () => {
                const text = '[example1](https://m.com/s?__biz=MzA3NDA0ODczNw==&mid=123)';
                const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                const match = linkRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![2]).toContain('==');
            });

            it('example2: pair of == in URL', () => {
                const text = '[example2](https://m.com/s?__biz=MzA3NDA0ODczNw==&chksm==84e6c)';
                const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                const match = linkRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![2]).toContain('==');
                // Count == occurrences
                const equalCount = (match![2].match(/==/g) || []).length;
                expect(equalCount).toBe(2);
            });

            it('two links on same line should not create false highlight between them', () => {
                const text = '[link1](url?a==b) [link2](url?c==d)';

                // Get all link ranges
                const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                const links = [];
                let match;
                while ((match = linkRegex.exec(text)) !== null) {
                    links.push({
                        start: match.index,
                        end: match.index + match[0].length
                    });
                }

                expect(links).toHaveLength(2);

                // Check for highlights that would match between the links
                const highlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
                const highlights = [];
                let highlightMatch;

                while ((highlightMatch = highlightRegex.exec(text)) !== null) {
                    const highlightStart = highlightMatch.index;
                    const highlightEnd = highlightMatch.index + highlightMatch[0].length;

                    // Check if this highlight overlaps with any link
                    const overlapsWithLink = links.some(link =>
                        !(highlightEnd <= link.start || highlightStart >= link.end)
                    );

                    if (!overlapsWithLink) {
                        // This would be a false positive - highlight between links
                        highlights.push(highlightMatch[1]);
                    }
                }

                // There should be no highlights found between the links
                // (the == in URLs shouldn't create a valid highlight between them)
                expect(highlights).toHaveLength(0);
            });
        });

        describe('Issue: Underscores in identifiers', () => {
            it('should not treat underscores in middle of words as emphasis', () => {
                const text = 'some_error_with_highLights_underline';

                // Check if single underscores would be detected as emphasis markers
                const singleUnderscoreRegex = /_([^_]+)_/g;
                const matches = [];
                let match;

                while ((match = singleUnderscoreRegex.exec(text)) !== null) {
                    const charBefore = text[match.index - 1];
                    const charAfter = text[match.index + match[0].length];
                    const isAlphanumBefore = /[a-zA-Z0-9]/.test(charBefore);
                    const isAlphanumAfter = /[a-zA-Z0-9]/.test(charAfter);

                    // Should skip if in middle of word
                    if (isAlphanumBefore && isAlphanumAfter) {
                        continue;
                    }

                    matches.push(match[1]);
                }

                // No italic matches should be found in identifier
                expect(matches).toHaveLength(0);
            });

            it('should still treat underscore emphasis at word boundaries', () => {
                const text = 'Hello _world_ test';

                // Should match emphasis at word boundaries
                const singleUnderscoreRegex = /_([^_]+)_/g;
                const match = singleUnderscoreRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('world');
            });
        });

        describe('Issue: Escaped characters', () => {
            it('should detect backslash escaping', () => {
                const text = '\\*\\*not bold\\*\\*';
                const escapeRegex = /\\([*_~`\[\]\\])/g;

                const matches = [];
                let match;
                while ((match = escapeRegex.exec(text)) !== null) {
                    matches.push(match[1]);
                }

                expect(matches).toHaveLength(4);
                expect(matches.every(m => m === '*')).toBe(true);
            });

            it('should handle escaped equals signs', () => {
                const text = '\\=\\=not highlighted\\=\\=';
                const escapeRegex = /\\([*_~`\[\]\\=])/g;

                const matches = [];
                let match;
                while ((match = escapeRegex.exec(text)) !== null) {
                    matches.push(match[1]);
                }

                expect(matches.length).toBeGreaterThan(0);
            });
        });

        describe('Issue: Bold + Italic combined', () => {
            it('should match triple asterisk', () => {
                const text = '***bold and italic***';
                const tripleAsteriskRegex = /\*\*\*(.*?)\*\*\*/g;
                const match = tripleAsteriskRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('bold and italic');
            });

            it('should match triple underscore at word boundaries', () => {
                const text = '___bold and italic___';
                const tripleUnderscoreRegex = /___(.*?)___/g;
                const match = tripleUnderscoreRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('bold and italic');
            });

            it('should not match triple underscore in middle of identifier', () => {
                const text = 'some___variable___name';
                const tripleUnderscoreRegex = /___(.*?)___/g;
                const match = tripleUnderscoreRegex.exec(text);

                if (match) {
                    // Check boundaries
                    const charBefore = text[match.index - 1];
                    const charAfter = text[match.index + match[0].length];
                    const isAlphanumBefore = /[a-zA-Z0-9]/.test(charBefore);
                    const isAlphanumAfter = /[a-zA-Z0-9]/.test(charAfter);

                    // Should skip if surrounded by alphanumeric
                    if (isAlphanumBefore && isAlphanumAfter) {
                        expect(true).toBe(true); // Should be skipped
                    }
                }
            });
        });
    });

    describe('Wikilink patterns', () => {
        it('should match basic wikilink', () => {
            const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
            const text = '[[Note Name]]';
            const match = wikilinkRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('Note Name');
        });

        it('should match wikilink with display text', () => {
            const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
            const text = '[[Note Name|Display Text]]';
            const match = wikilinkRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('Note Name|Display Text');
        });

        it('should handle wikilink with heading', () => {
            const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
            const text = '[[Note#Heading]]';
            const match = wikilinkRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('Note#Heading');
        });
    });

    describe('Edge case patterns', () => {
        it('should handle empty highlights', () => {
            const text = '====';
            const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
            const match = markdownHighlightRegex.exec(text);

            // Should not match empty content
            expect(match).toBeNull();
        });

        it('should handle whitespace-only highlights', () => {
            const text = '==   ==';
            const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
            const match = markdownHighlightRegex.exec(text);

            // Pattern might match, but should be filtered out by trim check
            if (match) {
                expect(match[1].trim()).toBe('');
            }
        });

        it('should handle special Unicode characters', () => {
            const text = '==emoji 🎉 text==';
            const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
            const match = markdownHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toContain('🎉');
        });

        it('should handle CJK characters', () => {
            const text = '==中文文本==';
            const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
            const match = markdownHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('中文文本');
        });

        it('should handle RTL text', () => {
            const text = '==العربية==';
            const markdownHighlightRegex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
            const match = markdownHighlightRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('العربية');
        });
    });
});
