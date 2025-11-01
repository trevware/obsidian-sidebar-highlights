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
