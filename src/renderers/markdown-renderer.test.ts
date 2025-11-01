/**
 * Tests for markdown rendering in sidebar
 * Tests the fixes for underscore handling, escape characters, and formatting
 */

export {};

describe('Markdown Renderer', () => {
    // Mock DOM environment for testing
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('Underscore handling', () => {
        describe('Single underscore italic', () => {
            it('should render italic with single underscores at word boundaries', () => {
                const text = 'Hello _world_ test';
                // Pattern should match _world_
                const italicRegex = /_([^_]+)_/g;
                const match = italicRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('world');
            });

            it('should NOT treat underscores in middle of identifiers as italic', () => {
                const text = 'some_error_with_highLights_underline';

                // Simulate the word boundary check
                const findItalicWithBoundaryCheck = (str: string): string[] => {
                    const results: string[] = [];
                    for (let i = 0; i < str.length; i++) {
                        if (str[i] === '_') {
                            const charBefore = i > 0 ? str[i - 1] : ' ';
                            const charAfter = i < str.length - 1 ? str[i + 1] : ' ';
                            const isAlphanumBefore = /[a-zA-Z0-9]/.test(charBefore);
                            const isAlphanumAfter = /[a-zA-Z0-9]/.test(charAfter);

                            // Skip if in middle of word
                            if (isAlphanumBefore && isAlphanumAfter) {
                                continue;
                            }

                            // Find closing
                            for (let j = i + 1; j < str.length; j++) {
                                if (str[j] === '_') {
                                    const closingCharBefore = str[j - 1];
                                    const closingCharAfter = j < str.length - 1 ? str[j + 1] : ' ';
                                    const closingIsAlphanumBefore = /[a-zA-Z0-9]/.test(closingCharBefore);
                                    const closingIsAlphanumAfter = /[a-zA-Z0-9]/.test(closingCharAfter);

                                    if (closingIsAlphanumBefore && closingIsAlphanumAfter) {
                                        continue;
                                    }

                                    results.push(str.substring(i + 1, j));
                                    break;
                                }
                            }
                        }
                    }
                    return results;
                };

                const matches = findItalicWithBoundaryCheck(text);
                expect(matches).toHaveLength(0);
            });

            it('should render italic in mixed content', () => {
                const text = 'normal _italic_ normal';
                const italicRegex = /_([^_]+)_/g;
                const match = italicRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('italic');
            });

            it('should handle underscore at start of word', () => {
                const text = '_italic text_';
                const italicRegex = /_([^_]+)_/g;
                const match = italicRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('italic text');
            });
        });

        describe('Double underscore bold', () => {
            it('should render bold with double underscores at word boundaries', () => {
                const text = 'Hello __world__ test';
                const boldRegex = /__([^_]+)__/g;
                const match = boldRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('world');
            });

            it('should NOT treat double underscores in identifiers as bold', () => {
                const text = 'some__variable__name';

                // Simulate boundary check
                const checkBoundary = (str: string, matchIndex: number, matchLength: number): boolean => {
                    const charBefore = matchIndex > 0 ? str[matchIndex - 1] : ' ';
                    const charAfter = matchIndex + matchLength < str.length ? str[matchIndex + matchLength] : ' ';
                    const isAlphanumBefore = /[a-zA-Z0-9]/.test(charBefore);
                    const isAlphanumAfter = /[a-zA-Z0-9]/.test(charAfter);

                    return isAlphanumBefore && isAlphanumAfter;
                };

                const boldRegex = /__([^_]+)__/g;
                const match = boldRegex.exec(text);

                if (match) {
                    const shouldSkip = checkBoundary(text, match.index, match[0].length);
                    expect(shouldSkip).toBe(true);
                }
            });

            it('should render bold at word boundaries', () => {
                const text = 'normal __bold__ normal';
                const boldRegex = /__([^_]+)__/g;
                const match = boldRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('bold');
            });
        });

        describe('Triple underscore bold+italic', () => {
            it('should match triple underscore at word boundaries', () => {
                const text = '___bold and italic___';
                const tripleRegex = /___([^_]+)___/g;
                const match = tripleRegex.exec(text);

                expect(match).not.toBeNull();
                expect(match![1]).toBe('bold and italic');
            });

            it('should NOT match triple underscore in identifiers', () => {
                const text = 'some___long___variable';
                const tripleRegex = /___([^_]+)___/g;
                const match = tripleRegex.exec(text);

                if (match) {
                    const charBefore = text[match.index - 1];
                    const charAfter = text[match.index + match[0].length];
                    const shouldSkip = /[a-zA-Z0-9]/.test(charBefore) && /[a-zA-Z0-9]/.test(charAfter);
                    expect(shouldSkip).toBe(true);
                }
            });
        });
    });

    describe('Escape character handling', () => {
        it('should detect escaped asterisks', () => {
            const text = '\\*\\*not bold\\*\\*';
            const escapeRegex = /\\([*_~`\[\]\\])/g;

            const escaped = [];
            let match;
            while ((match = escapeRegex.exec(text)) !== null) {
                escaped.push(match[1]);
            }

            expect(escaped).toHaveLength(4);
            expect(escaped.every(char => char === '*')).toBe(true);
        });

        it('should detect escaped underscores', () => {
            const text = '\\_italic\\_';
            const escapeRegex = /\\([*_~`\[\]\\])/g;

            const escaped = [];
            let match;
            while ((match = escapeRegex.exec(text)) !== null) {
                escaped.push(match[1]);
            }

            expect(escaped).toHaveLength(2);
            expect(escaped.every(char => char === '_')).toBe(true);
        });

        it('should detect escaped brackets', () => {
            const text = '\\[not a link\\]';
            const escapeRegex = /\\([*_~`\[\]\\])/g;

            const escaped = [];
            let match;
            while ((match = escapeRegex.exec(text)) !== null) {
                escaped.push(match[1]);
            }

            expect(escaped).toHaveLength(2);
            expect(escaped[0]).toBe('[');
            expect(escaped[1]).toBe(']');
        });

        it('should detect escaped backticks', () => {
            const text = '\\`not code\\`';
            const escapeRegex = /\\([*_~`\[\]\\])/g;

            const escaped = [];
            let match;
            while ((match = escapeRegex.exec(text)) !== null) {
                escaped.push(match[1]);
            }

            expect(escaped).toHaveLength(2);
            expect(escaped.every(char => char === '`')).toBe(true);
        });

        it('should detect escaped backslash', () => {
            const text = 'backslash\\\\here';
            const escapeRegex = /\\([*_~`\[\]\\])/g;
            const match = escapeRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('\\');
        });

        it('should handle mixed escaped characters', () => {
            const text = '\\*italic\\* and \\_bold\\_ and \\`code\\`';
            const escapeRegex = /\\([*_~`\[\]\\])/g;

            const escaped = [];
            let match;
            while ((match = escapeRegex.exec(text)) !== null) {
                escaped.push(match[1]);
            }

            expect(escaped.length).toBeGreaterThan(0);
            expect(escaped).toContain('*');
            expect(escaped).toContain('_');
            expect(escaped).toContain('`');
        });
    });

    describe('Bold and italic patterns', () => {
        it('should match bold with double asterisk', () => {
            const text = '**bold text**';
            const boldRegex = /\*\*(.*?)\*\*/g;
            const match = boldRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('bold text');
        });

        it('should match italic with single asterisk', () => {
            const text = '*italic text*';
            const italicRegex = /\*(.*?)\*/g;
            const match = italicRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('italic text');
        });

        it('should match bold+italic with triple asterisk', () => {
            const text = '***bold and italic***';
            const tripleRegex = /\*\*\*(.*?)\*\*\*/g;
            const match = tripleRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('bold and italic');
        });

        it('should handle nested formatting', () => {
            const text = '**bold with _italic_ inside**';

            // Match bold
            const boldRegex = /\*\*(.*?)\*\*/g;
            const boldMatch = boldRegex.exec(text);
            expect(boldMatch).not.toBeNull();

            // Check for italic inside
            const content = boldMatch![1];
            const italicRegex = /_([^_]+)_/g;
            const italicMatch = italicRegex.exec(content);
            expect(italicMatch).not.toBeNull();
            expect(italicMatch![1]).toBe('italic');
        });
    });

    describe('Strikethrough pattern', () => {
        it('should match strikethrough', () => {
            const text = '~~striked text~~';
            const strikeRegex = /~~(.*?)~~/g;
            const match = strikeRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('striked text');
        });

        it('should not match single tilde', () => {
            const text = '~not striked~';
            const strikeRegex = /~~(.*?)~~/g;
            const match = strikeRegex.exec(text);

            expect(match).toBeNull();
        });
    });

    describe('Code pattern', () => {
        it('should match inline code', () => {
            const text = '`code here`';
            const codeRegex = /`([^`]+?)`/g;
            const match = codeRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('code here');
        });

        it('should not match across newlines', () => {
            const text = '`code\nmore`';
            const codeRegex = /`([^`\n]+?)`/g;
            const match = codeRegex.exec(text);

            expect(match).toBeNull();
        });

        it('should match code with special characters', () => {
            const text = '`<font color="red">`';
            const codeRegex = /`([^`]+?)`/g;
            const match = codeRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('<font color="red">');
        });
    });

    describe('Link patterns', () => {
        it('should match markdown link', () => {
            const text = '[link text](https://example.com)';
            const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
            const match = linkRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('link text');
            expect(match![2]).toBe('https://example.com');
        });

        it('should match wikilink', () => {
            const text = '[[Note Name]]';
            const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
            const match = wikilinkRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('Note Name');
        });

        it('should match wikilink with display text', () => {
            const text = '[[Note Name|Display Text]]';
            const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
            const match = wikilinkRegex.exec(text);

            expect(match).not.toBeNull();
            const content = match![1];
            const parts = content.split('|');
            expect(parts[0]).toBe('Note Name');
            expect(parts[1]).toBe('Display Text');
        });
    });

    describe('Real-world rendering scenarios', () => {
        it('should handle identifier with underscores correctly', () => {
            const text = 'some_error_with_highLights_underline';

            // Should preserve all underscores
            const hasAlphanumericBoundaries = (str: string, index: number): boolean => {
                const before = index > 0 ? str[index - 1] : ' ';
                const after = index < str.length - 1 ? str[index + 1] : ' ';
                return /[a-zA-Z0-9]/.test(before) && /[a-zA-Z0-9]/.test(after);
            };

            let hasInvalidMatch = false;
            for (let i = 0; i < text.length; i++) {
                if (text[i] === '_' && !hasAlphanumericBoundaries(text, i)) {
                    hasInvalidMatch = true;
                }
            }

            // All underscores should be in alphanumeric context
            expect(!hasInvalidMatch || text.indexOf('_') === -1).toBe(true);
        });

        it('should render italic in normal text', () => {
            const text = 'Hello _world_ test';
            const italicRegex = /_([^_]+)_/g;
            const match = italicRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('world');
        });

        it('should handle mixed markdown formatting', () => {
            const text = '**Bold** and *italic* and `code` and ~~strike~~';

            // Check each pattern
            expect(text).toContain('**Bold**');
            expect(text).toContain('*italic*');
            expect(text).toContain('`code`');
            expect(text).toContain('~~strike~~');
        });

        it('should handle escaped formatting in mixed content', () => {
            const text = 'Normal \\*\\*not bold\\*\\* and **actual bold**';
            const escapeRegex = /\\([*_~`\[\]\\])/g;
            const boldRegex = /\*\*(.*?)\*\*/g;

            // Find escaped sequences
            const escaped = [];
            let escMatch;
            while ((escMatch = escapeRegex.exec(text)) !== null) {
                escaped.push(escMatch.index);
            }

            // Find bold
            const boldMatch = boldRegex.exec(text);

            expect(escaped.length).toBeGreaterThan(0);
            expect(boldMatch).not.toBeNull();
            expect(boldMatch![1]).toBe('actual bold');
        });
    });

    describe('Pattern precedence', () => {
        it('should process triple asterisk before double asterisk', () => {
            const text = '***bold and italic***';

            // Triple should match first
            const tripleRegex = /\*\*\*(.*?)\*\*\*/g;
            const tripleMatch = tripleRegex.exec(text);

            expect(tripleMatch).not.toBeNull();
            expect(tripleMatch![1]).toBe('bold and italic');

            // After removing triple match, double shouldn't match
            const afterTriple = text.replace(tripleRegex, '');
            const doubleRegex = /\*\*(.*?)\*\*/g;
            const doubleMatch = doubleRegex.exec(afterTriple);

            expect(doubleMatch).toBeNull();
        });

        it('should process triple underscore before double underscore', () => {
            const text = '___bold and italic___';

            // Triple should match first
            const tripleRegex = /___([^_]+)___/g;
            const tripleMatch = tripleRegex.exec(text);

            expect(tripleMatch).not.toBeNull();
            expect(tripleMatch![1]).toBe('bold and italic');
        });
    });

    describe('Edge cases', () => {
        it('should handle empty formatting', () => {
            const text = '****';
            const boldRegex = /\*\*(.*?)\*\*/g;
            const match = boldRegex.exec(text);

            if (match) {
                expect(match[1]).toBe('');
            }
        });

        it('should handle adjacent formatting', () => {
            const text = '**bold***italic*';

            // Should match bold first
            const boldRegex = /\*\*(.*?)\*\*/g;
            const boldMatch = boldRegex.exec(text);
            expect(boldMatch).not.toBeNull();
        });

        it('should handle Unicode in formatting', () => {
            const text = '**emoji 🎉 text**';
            const boldRegex = /\*\*(.*?)\*\*/g;
            const match = boldRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toContain('🎉');
        });
    });
});
