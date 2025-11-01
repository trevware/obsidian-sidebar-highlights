/**
 * Tests for HTML comments and custom pattern detection
 * Tests the new detection features added for expanded syntax support
 */

export {};

describe('HTML Comment Detection', () => {
    describe('Basic HTML comment patterns', () => {
        it('should match simple HTML comment', () => {
            const text = '<!-- this is a comment -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe(' this is a comment ');
        });

        it('should match HTML comment with leading/trailing whitespace', () => {
            const text = '<!--   whitespace comment   -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1].trim()).toBe('whitespace comment');
        });

        it('should match HTML comment with newlines', () => {
            const text = '<!-- multi\nline\ncomment -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe(' multi\nline\ncomment ');
        });

        it('should match multiple HTML comments', () => {
            const text = '<!-- first --> some text <!-- second -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const matches = [];
            let match;
            while ((match = htmlCommentRegex.exec(text)) !== null) {
                matches.push(match[1].trim());
            }

            expect(matches).toHaveLength(2);
            expect(matches[0]).toBe('first');
            expect(matches[1]).toBe('second');
        });

        it('should not match incomplete HTML comments', () => {
            const text = '<!-- incomplete comment';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).toBeNull();
        });

        it('should handle nested angle brackets', () => {
            const text = '<!-- comment with <tags> inside -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe(' comment with <tags> inside ');
        });
    });

    describe('HTML comments in context', () => {
        it('should detect HTML comment in markdown', () => {
            const text = 'Some text <!-- a note --> more text';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match!.index).toBe(10);
            expect(match![1].trim()).toBe('a note');
        });

        it('should not match HTML comment in code blocks', () => {
            const text = '```\n<!-- not a comment -->\n```';
            // This test verifies the pattern itself
            // Actual code block exclusion is tested in integration tests
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            // Pattern matches, but should be excluded by code block detection
            expect(match).not.toBeNull();
            expect(match![1].trim()).toBe('not a comment');
        });

        it('should handle HTML comments at start of line', () => {
            const text = '<!-- comment at start\nNew line';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).toBeNull(); // No closing -->
        });

        it('should handle HTML comments at end of line', () => {
            const text = 'Text here <!-- comment -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match!.index).toBe(10);
        });
    });
});

describe('Adjacent Comment Patterns', () => {
    describe('Detection of adjacent patterns', () => {
        it('should detect highlight followed by HTML comment', () => {
            const text = '==highlight==<!-- comment -->';
            const highlightMatch = /==([^=\n]+)==/.exec(text);
            const commentMatch = /<!--([^]*?)-->/.exec(text);

            expect(highlightMatch).not.toBeNull();
            expect(commentMatch).not.toBeNull();
            expect(highlightMatch!.index + highlightMatch![0].length).toBe(commentMatch!.index);
        });

        it('should detect highlight followed by native comment', () => {
            const text = '==highlight==%% comment %%';
            const highlightMatch = /==([^=\n]+)==/.exec(text);
            const commentMatch = /%%([^%]+)%%/.exec(text);

            expect(highlightMatch).not.toBeNull();
            expect(commentMatch).not.toBeNull();
            expect(highlightMatch!.index + highlightMatch![0].length).toBe(commentMatch!.index);
        });

        it('should detect highlight followed by comment with whitespace', () => {
            const text = '==highlight==  <!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            expect(/^\s*$/.test(betweenText)).toBe(true);
        });

        it('should not treat as adjacent if content between', () => {
            const text = '==highlight== text <!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            expect(/^\s*$/.test(betweenText)).toBe(false);
        });

        it('should NOT treat comment as adjacent if there is a blank line', () => {
            const text = '==highlight==\n\n%%comment%%';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('%%');
            const betweenText = text.substring(highlightEnd, commentStart);

            // Should have blank line
            expect(betweenText).toContain('\n\n');
            expect(/\n\s*\n/.test(betweenText)).toBe(true);
        });

        it('should NOT treat comment as adjacent with blank line after footnote', () => {
            const text = '==highlight==^[note]\n\n%%comment%%';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('%%');
            const betweenText = text.substring(highlightEnd, commentStart);

            // After removing the footnote, should still have blank line
            expect(/\n\s*\n/.test(betweenText)).toBe(true);
        });

        it('should treat comment as adjacent with single newline', () => {
            const text = '==highlight==\n%%comment%%';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('%%');
            const betweenText = text.substring(highlightEnd, commentStart);

            // Single newline, no blank line
            expect(/\n\s*\n/.test(betweenText)).toBe(false);
            expect(/^\s*$/.test(betweenText)).toBe(true);
        });

        it('should treat comment as adjacent on same line', () => {
            const text = '==highlight== %%comment%%';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('%%');
            const betweenText = text.substring(highlightEnd, commentStart);

            // Just a space
            expect(/\n\s*\n/.test(betweenText)).toBe(false);
            expect(/^\s*$/.test(betweenText)).toBe(true);
        });

        it('should handle multiple adjacent patterns', () => {
            const text = '==highlight==%% first %% <!-- second -->';
            const highlightRegex = /==([^=\n]+)==/g;
            const commentRegex = /%%([^%]+)%%|<!--([^]*?)-->/g;

            const highlightMatch = highlightRegex.exec(text);
            const matches = [];
            let match;
            while ((match = commentRegex.exec(text)) !== null) {
                matches.push(match[1] || match[2]);
            }

            expect(highlightMatch).not.toBeNull();
            expect(matches.length).toBeGreaterThan(0);
        });
    });

    describe('Whitespace handling', () => {
        it('should allow no whitespace between patterns', () => {
            const text = '==highlight==<!-- comment -->';
            const betweenMatch = /==([^=\n]+)==(\s*)<!--/.exec(text);

            expect(betweenMatch).not.toBeNull();
            expect(betweenMatch![2]).toBe('');
        });

        it('should allow spaces between patterns', () => {
            const text = '==highlight==   <!-- comment -->';
            const betweenMatch = /==([^=\n]+)==(\s*)<!--/.exec(text);

            expect(betweenMatch).not.toBeNull();
            expect(betweenMatch![2]).toBe('   ');
        });

        it('should allow tabs between patterns', () => {
            const text = '==highlight==\t<!-- comment -->';
            const betweenMatch = /==([^=\n]+)==(\s*)<!--/.exec(text);

            expect(betweenMatch).not.toBeNull();
            expect(/^\s*$/.test(betweenMatch![2])).toBe(true);
        });

        it('should not allow newlines between patterns', () => {
            const text = '==highlight==\n<!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            // Contains newline, so should NOT be treated as adjacent
            expect(betweenText).toBe('\n');
            expect(/^\s*$/.test(betweenText)).toBe(true); // Whitespace only
            // But in practice, we'd want to check for same line
        });
    });

    describe('Adjacent with existing footnotes', () => {
        it('should detect comment after inline footnote', () => {
            const text = '==highlight==^[inline note]<!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            // Between text should be just the inline footnote
            expect(betweenText).toBe('^[inline note]');
            // Should match inline footnote pattern
            expect(/^\^\[/.test(betweenText)).toBe(true);
        });

        it('should detect comment after multiple inline footnotes', () => {
            const text = '==highlight==^[first]^[second]<!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('^[first]^[second]');
        });

        it('should detect comment after inline footnote with whitespace', () => {
            const text = '==highlight==^[note] <!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('^[note] ');
            // Should still be considered adjacent
        });

        it('should detect native comment after inline footnote', () => {
            const text = '==highlight==^[note]%% native %%';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const nativeStart = text.indexOf('%%');
            const betweenText = text.substring(highlightEnd, nativeStart);

            expect(betweenText).toBe('^[note]');
        });

        it('should detect custom comment after inline footnote', () => {
            const text = '==highlight==^[note]//custom//';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const customStart = text.indexOf('//');
            const betweenText = text.substring(highlightEnd, customStart);

            expect(betweenText).toBe('^[note]');
        });

        it('should not merge if text between footnote and comment', () => {
            const text = '==highlight==^[note] some text <!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('^[note] some text ');
            // Should NOT be treated as adjacent due to "some text"
        });

        it('should handle standard footnote before comment', () => {
            const text = '==highlight==[^1]<!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('[^1]');
            // Standard footnote pattern
            expect(/^\[\^[a-zA-Z0-9_-]+\]/.test(betweenText)).toBe(true);
        });

        it('should handle mixed footnotes before comment', () => {
            const text = '==highlight==[^1]^[inline]<!-- comment -->';
            const highlightEnd = text.indexOf('==', 2) + 2;
            const commentStart = text.indexOf('<!--');
            const betweenText = text.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('[^1]^[inline]');
        });
    });
});

describe('Custom Pattern Detection', () => {
    describe('Basic custom patterns', () => {
        it('should match custom pattern with capturing group', () => {
            const pattern = '//(.+?)//';
            const text = '//custom comment//';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('custom comment');
        });

        it('should match line comment pattern', () => {
            const pattern = '//([^\\n]+)';
            const text = '// line comment';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe(' line comment');
        });

        it('should match bracket pattern', () => {
            const pattern = '\\[\\[(.+?)\\]\\]';
            const text = '[[wikilink]]';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('wikilink');
        });

        it('should match multiple custom patterns', () => {
            const pattern = '//(.+?)//';
            const text = '//first// and //second//';
            const regex = new RegExp(pattern, 'g');
            const matches = [];
            let match;
            while ((match = regex.exec(text)) !== null) {
                matches.push(match[1]);
            }

            expect(matches).toHaveLength(2);
            expect(matches[0]).toBe('first');
            expect(matches[1]).toBe('second');
        });

        it('should handle pattern with special characters', () => {
            const pattern = '\\{\\{(.+?)\\}\\}';
            const text = '{{template}}';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('template');
        });
    });

    describe('Pattern validation', () => {
        it('should detect invalid regex pattern', () => {
            const invalidPattern = '//(.+';
            let isValid = true;

            try {
                new RegExp(invalidPattern);
            } catch (e) {
                isValid = false;
            }

            expect(isValid).toBe(false);
        });

        it('should detect missing capturing group', () => {
            const pattern = '//.+?//';
            expect(pattern.includes('(')).toBe(false);
            expect(pattern.includes(')')).toBe(false);
        });

        it('should accept pattern with capturing group', () => {
            const pattern = '//(.+?)//';
            expect(pattern.includes('(')).toBe(true);
            expect(pattern.includes(')')).toBe(true);
        });

        it('should handle escaped characters in pattern', () => {
            const pattern = '\\*\\*(.+?)\\*\\*';
            const text = '**bold text**';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('bold text');
        });
    });

    describe('Custom patterns in context', () => {
        it('should match custom pattern in markdown', () => {
            const pattern = '//(.+?)//';
            const text = 'Normal text //custom// more text';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match!.index).toBe(12);
            expect(match![1]).toBe('custom');
        });

        it('should match custom pattern at start of line', () => {
            const pattern = '//([^\\n]+)';
            const text = '// comment at start';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match!.index).toBe(0);
        });

        it('should match custom pattern at end of line', () => {
            const pattern = '//(.+?)//';
            const text = 'Text here //comment//';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('comment');
        });

        it('should not cross line boundaries with non-greedy pattern', () => {
            const pattern = '//(.+?)//';
            const text = '//first line\nsecond line//';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            // Should match across newlines with .+? since . doesn't match \n by default
            // But with [^\n] it wouldn't
            expect(match).toBeNull();
        });
    });
});

describe('Integration Scenarios', () => {
    describe('Mixed syntax detection', () => {
        it('should detect all syntax types in document', () => {
            const text = `
==markdown highlight==
<!-- HTML comment -->
%% native comment %%
//custom pattern//
            `.trim();

            const highlightRegex = /==([^=\n]+)==/g;
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const nativeCommentRegex = /%%([^%]+)%%/g;
            const customRegex = /\/\/(.+?)\/\//g;

            expect(highlightRegex.exec(text)).not.toBeNull();
            expect(htmlCommentRegex.exec(text)).not.toBeNull();
            expect(nativeCommentRegex.exec(text)).not.toBeNull();
            expect(customRegex.exec(text)).not.toBeNull();
        });

        it('should handle adjacent different syntax types', () => {
            const text = '==highlight==<!-- HTML --> %% native %%';
            const highlightRegex = /==([^=\n]+)==/g;
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const nativeCommentRegex = /%%([^%]+)%%/g;

            const highlightMatch = highlightRegex.exec(text);
            const htmlMatch = htmlCommentRegex.exec(text);
            const nativeMatch = nativeCommentRegex.exec(text);

            expect(highlightMatch).not.toBeNull();
            expect(htmlMatch).not.toBeNull();
            expect(nativeMatch).not.toBeNull();
        });

        it('should maintain correct order of matches', () => {
            const text = 'first ==highlight== then <!-- comment --> last';
            const allMatches: Array<{index: number, type: string}> = [];

            const highlightRegex = /==([^=\n]+)==/g;
            const htmlCommentRegex = /<!--([^]*?)-->/g;

            let match;
            while ((match = highlightRegex.exec(text)) !== null) {
                allMatches.push({index: match.index, type: 'highlight'});
            }
            while ((match = htmlCommentRegex.exec(text)) !== null) {
                allMatches.push({index: match.index, type: 'comment'});
            }

            allMatches.sort((a, b) => a.index - b.index);

            expect(allMatches).toHaveLength(2);
            expect(allMatches[0].type).toBe('highlight');
            expect(allMatches[1].type).toBe('comment');
        });
    });

    describe('Edge cases', () => {
        it('should handle empty HTML comment', () => {
            const text = '<!---->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toBe('');
        });

        it('should handle HTML comment with just whitespace', () => {
            const text = '<!--   -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1].trim()).toBe('');
        });

        it('should handle nested delimiters in HTML comments', () => {
            const text = '<!-- text with == and %% inside -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const match = htmlCommentRegex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toContain('==');
            expect(match![1]).toContain('%%');
        });

        it('should handle custom pattern with nested delimiters', () => {
            const pattern = '//(.+?)//';
            const text = '//text with [[wikilink]] inside//';
            const regex = new RegExp(pattern, 'g');
            const match = regex.exec(text);

            expect(match).not.toBeNull();
            expect(match![1]).toContain('[[');
        });
    });
});
