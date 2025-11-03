/**
 * Tests for adjacent comment focus functionality
 * Tests the logic that allows clicking adjacent comments to focus them in the editor
 */

export {};

describe('Adjacent Comment Focus Logic', () => {
    describe('HTML comment regex extraction', () => {
        const htmlCommentRegex = /<!--([^]*?)-->/g;

        it('should extract single HTML comment', () => {
            const content = '==highlight==<!-- adjacent comment -->';
            const afterHighlight = '<!-- adjacent comment -->';

            const matches = [];
            let match;
            while ((match = htmlCommentRegex.exec(afterHighlight)) !== null) {
                matches.push({
                    fullText: match[0],
                    content: match[1].trim(),
                    startIndex: match.index,
                    endIndex: match.index + match[0].length
                });
            }

            expect(matches).toHaveLength(1);
            expect(matches[0].fullText).toBe('<!-- adjacent comment -->');
            expect(matches[0].content).toBe('adjacent comment');
        });

        it('should extract HTML comment with color annotation', () => {
            const content = '==text==<!-- @purple 对应的注释 -->';
            const afterHighlight = '<!-- @purple 对应的注释 -->';

            const matches = [];
            let match;
            htmlCommentRegex.lastIndex = 0;
            while ((match = htmlCommentRegex.exec(afterHighlight)) !== null) {
                matches.push({
                    content: match[1].trim()
                });
            }

            expect(matches).toHaveLength(1);
            expect(matches[0].content).toBe('@purple 对应的注释');
        });

        it('should extract HTML comment after inline footnote', () => {
            const content = '==text==^[note]<!-- comment -->';
            const afterHighlight = '^[note]<!-- comment -->';

            const matches = [];
            let match;
            htmlCommentRegex.lastIndex = 0;
            while ((match = htmlCommentRegex.exec(afterHighlight)) !== null) {
                matches.push({
                    fullText: match[0],
                    content: match[1].trim(),
                    startIndex: match.index
                });
            }

            expect(matches).toHaveLength(1);
            expect(matches[0].content).toBe('comment');
            expect(matches[0].startIndex).toBe(7); // After ^[note]
        });

        it('should extract multiple HTML comments', () => {
            const content = '==text==<!-- first --><!-- second -->';
            const afterHighlight = '<!-- first --><!-- second -->';

            const matches = [];
            let match;
            htmlCommentRegex.lastIndex = 0;
            while ((match = htmlCommentRegex.exec(afterHighlight)) !== null) {
                matches.push(match[1].trim());
            }

            expect(matches).toHaveLength(2);
            expect(matches[0]).toBe('first');
            expect(matches[1]).toBe('second');
        });

        it('should handle multiline HTML comments', () => {
            const afterHighlight = `<!--
                This is a multiline
                adjacent comment
            -->`;

            const matches = [];
            let match;
            htmlCommentRegex.lastIndex = 0;
            while ((match = htmlCommentRegex.exec(afterHighlight)) !== null) {
                matches.push(match[1].trim());
            }

            expect(matches).toHaveLength(1);
            expect(matches[0]).toContain('multiline');
        });
    });

    describe('Native comment regex extraction', () => {
        const nativeCommentRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;

        it('should extract single native comment', () => {
            const content = '==highlight==%% adjacent comment %%';
            const afterHighlight = '%% adjacent comment %%';

            const matches = [];
            let match;
            while ((match = nativeCommentRegex.exec(afterHighlight)) !== null) {
                matches.push({
                    fullText: match[0],
                    content: match[1].trim(),
                    startIndex: match.index,
                    endIndex: match.index + match[0].length
                });
            }

            expect(matches).toHaveLength(1);
            expect(matches[0].fullText).toBe('%% adjacent comment %%');
            expect(matches[0].content).toBe('adjacent comment');
        });

        it('should extract native comment after inline footnote', () => {
            const content = '==text==^[note]%% comment %%';
            const afterHighlight = '^[note]%% comment %%';

            const matches = [];
            let match;
            nativeCommentRegex.lastIndex = 0;
            while ((match = nativeCommentRegex.exec(afterHighlight)) !== null) {
                matches.push({
                    fullText: match[0],
                    content: match[1].trim(),
                    startIndex: match.index
                });
            }

            expect(matches).toHaveLength(1);
            expect(matches[0].content).toBe('comment');
            expect(matches[0].startIndex).toBe(7); // After ^[note]
        });

        it('should extract multiple native comments', () => {
            const content = '==text==%% first %%%% second %%';
            const afterHighlight = '%% first %%%% second %%';

            const matches = [];
            let match;
            nativeCommentRegex.lastIndex = 0;
            while ((match = nativeCommentRegex.exec(afterHighlight)) !== null) {
                matches.push(match[1].trim());
            }

            expect(matches).toHaveLength(2);
            expect(matches[0]).toBe('first');
            expect(matches[1]).toBe('second');
        });

        it('should handle native comment with single % inside', () => {
            const content = '==text==%% 100% complete %%';
            const afterHighlight = '%% 100% complete %%';

            const matches = [];
            let match;
            nativeCommentRegex.lastIndex = 0;
            while ((match = nativeCommentRegex.exec(afterHighlight)) !== null) {
                matches.push(match[1].trim());
            }

            expect(matches).toHaveLength(1);
            expect(matches[0]).toBe('100% complete');
        });
    });

    describe('Focus position calculation', () => {
        it('should calculate correct positions for HTML comment', () => {
            const content = '==highlight==<!-- comment -->';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('<!--');
            const commentEnd = content.indexOf('-->') + 3;

            // Content inside <!-- -->
            const contentStart = commentStart + 4; // skip <!--
            const contentEnd = commentEnd - 3; // skip -->

            expect(commentStart).toBe(13);
            expect(commentEnd).toBe(29);
            expect(contentStart).toBe(17);
            expect(contentEnd).toBe(26);
            expect(content.substring(contentStart, contentEnd)).toBe(' comment ');
        });

        it('should calculate correct positions for native comment', () => {
            const content = '==highlight==%% comment %%';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('%%');
            const commentEnd = content.lastIndexOf('%%') + 2;

            // Content inside %% %%
            const contentStart = commentStart + 2; // skip %%
            const contentEnd = commentEnd - 2; // skip %%

            expect(commentStart).toBe(13);
            expect(commentEnd).toBe(26);
            expect(contentStart).toBe(15);
            expect(contentEnd).toBe(24);
            expect(content.substring(contentStart, contentEnd)).toBe(' comment ');
        });

        it('should handle whitespace trimming in content matching', () => {
            const storedContent = 'adjacent comment'; // Trimmed when stored
            const actualText = '<!-- adjacent comment -->'; // In editor with delimiters

            const innerStart = 4; // skip <!--
            const innerEnd = actualText.length - 3; // skip -->
            const extractedContent = actualText.substring(innerStart, innerEnd).trim();

            expect(extractedContent).toBe(storedContent);
        });
    });

    describe('Comment detection logic', () => {
        it('should detect HTML comment by delimiters', () => {
            const footnoteText = '<!-- comment -->';

            const isHtmlComment = footnoteText.startsWith('<!--') && footnoteText.endsWith('-->');
            const isNativeComment = footnoteText.startsWith('%%') && footnoteText.endsWith('%%');
            const isInlineFootnote = footnoteText.includes('^[');

            expect(isHtmlComment).toBe(true);
            expect(isNativeComment).toBe(false);
            expect(isInlineFootnote).toBe(false);
        });

        it('should detect native comment by delimiters', () => {
            const footnoteText = '%% comment %%';

            const isHtmlComment = footnoteText.startsWith('<!--') && footnoteText.endsWith('-->');
            const isNativeComment = footnoteText.startsWith('%%') && footnoteText.endsWith('%%');
            const isInlineFootnote = footnoteText.includes('^[');

            expect(isHtmlComment).toBe(false);
            expect(isNativeComment).toBe(true);
            expect(isInlineFootnote).toBe(false);
        });

        it('should detect inline footnote by caret', () => {
            const footnoteText = '^[note]';

            const isHtmlComment = footnoteText.startsWith('<!--') && footnoteText.endsWith('-->');
            const isNativeComment = footnoteText.startsWith('%%') && footnoteText.endsWith('%%');
            const isInlineFootnote = footnoteText.includes('^[');

            expect(isHtmlComment).toBe(false);
            expect(isNativeComment).toBe(false);
            expect(isInlineFootnote).toBe(true);
        });
    });

    describe('Real-world scenarios from user feedback', () => {
        it('should handle adjacent HTML comment with inline footnote', () => {
            const content = '==这是一个带注释的高亮片段==^[脚注，嘿嘿]<!-- @purple 额外的注释 -->';
            const highlightEnd = content.indexOf('==这是一个带注释的高亮片段==') + '==这是一个带注释的高亮片段=='.length;
            const afterHighlight = content.substring(highlightEnd);

            // Extract inline footnote
            const inlineFootnoteRegex = /\^\[([^\]]+)\]/g;
            const inlineMatches = [];
            let match;
            while ((match = inlineFootnoteRegex.exec(afterHighlight)) !== null) {
                inlineMatches.push(match[1]);
            }

            // Extract HTML comment
            const htmlCommentRegex = /<!--([^]*?)-->/g;
            const htmlMatches = [];
            htmlCommentRegex.lastIndex = 0;
            while ((match = htmlCommentRegex.exec(afterHighlight)) !== null) {
                htmlMatches.push(match[1].trim());
            }

            expect(inlineMatches).toHaveLength(1);
            expect(inlineMatches[0]).toBe('脚注，嘿嘿');
            expect(htmlMatches).toHaveLength(1);
            expect(htmlMatches[0]).toBe('@purple 额外的注释');
        });

        it('should handle adjacent native comment with standard footnote', () => {
            const content = '==highlight==[^1]%% Think what would happen if they did not exist %%';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const afterHighlight = content.substring(highlightEnd);

            // Extract standard footnote
            const standardFootnoteRegex = /\[\^([a-zA-Z0-9_-]+)\]/g;
            const standardMatches = [];
            let match;
            while ((match = standardFootnoteRegex.exec(afterHighlight)) !== null) {
                standardMatches.push(match[1]);
            }

            // Extract native comment
            const nativeCommentRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;
            const nativeMatches = [];
            nativeCommentRegex.lastIndex = 0;
            while ((match = nativeCommentRegex.exec(afterHighlight)) !== null) {
                nativeMatches.push(match[1].trim());
            }

            expect(standardMatches).toHaveLength(1);
            expect(standardMatches[0]).toBe('1');
            expect(nativeMatches).toHaveLength(1);
            expect(nativeMatches[0]).toBe('Think what would happen if they did not exist');
        });

        it('should handle multiple footnotes and adjacent comment', () => {
            const content = '==text==[^1]^[inline note][^2]<!-- final comment -->';
            const highlightEnd = content.indexOf('==text==') + '==text=='.length;
            const afterHighlight = content.substring(highlightEnd);

            // Extract all types
            const allItems: Array<{type: string, content: string, position: number}> = [];

            // Standard footnotes
            const standardRegex = /\[\^([a-zA-Z0-9_-]+)\]/g;
            let match;
            while ((match = standardRegex.exec(afterHighlight)) !== null) {
                allItems.push({
                    type: 'standard',
                    content: match[1],
                    position: match.index
                });
            }

            // Inline footnotes
            const inlineRegex = /\^\[([^\]]+)\]/g;
            inlineRegex.lastIndex = 0;
            while ((match = inlineRegex.exec(afterHighlight)) !== null) {
                allItems.push({
                    type: 'inline',
                    content: match[1],
                    position: match.index
                });
            }

            // HTML comments
            const htmlRegex = /<!--([^]*?)-->/g;
            htmlRegex.lastIndex = 0;
            while ((match = htmlRegex.exec(afterHighlight)) !== null) {
                allItems.push({
                    type: 'html',
                    content: match[1].trim(),
                    position: match.index
                });
            }

            // Sort by position
            allItems.sort((a, b) => a.position - b.position);

            expect(allItems).toHaveLength(4);
            expect(allItems[0].type).toBe('standard');
            expect(allItems[0].content).toBe('1');
            expect(allItems[1].type).toBe('inline');
            expect(allItems[1].content).toBe('inline note');
            expect(allItems[2].type).toBe('standard');
            expect(allItems[2].content).toBe('2');
            expect(allItems[3].type).toBe('html');
            expect(allItems[3].content).toBe('final comment');
        });
    });

    describe('Custom pattern comments', () => {
        it('should extract custom pattern comment with // delimiters', () => {
            const afterHighlight = '// Comment //';
            const customPattern = '//(.+?)//';
            const customRegex = new RegExp(customPattern, 'g');

            const match = customRegex.exec(afterHighlight);
            expect(match).not.toBeNull();
            if (match) {
                expect(match[0]).toBe('// Comment //'); // Full match
                expect(match[1].trim()).toBe('Comment'); // Captured text
            }
        });

        it('should extract custom pattern comment with ## delimiters', () => {
            const afterHighlight = '## Another comment ##';
            const customPattern = '##(.+?)##';
            const customRegex = new RegExp(customPattern, 'g');

            const match = customRegex.exec(afterHighlight);
            expect(match).not.toBeNull();
            if (match) {
                expect(match[0]).toBe('## Another comment ##');
                expect(match[1].trim()).toBe('Another comment');
            }
        });

        it('should extract custom pattern after inline footnote', () => {
            const content = '==text==^[note]// Comment //';
            const afterHighlight = '^[note]// Comment //';
            const customPattern = '//(.+?)//';
            const customRegex = new RegExp(customPattern, 'g');

            const match = customRegex.exec(afterHighlight);
            expect(match).not.toBeNull();
            if (match) {
                expect(match.index).toBe(7); // After ^[note]
                expect(match[1].trim()).toBe('Comment');
            }
        });

        it('should calculate positions for custom pattern comment', () => {
            const footnoteText = '// Comment //';
            const customPattern = '//(.+?)//';
            const customRegex = new RegExp(customPattern);

            const match = customRegex.exec(footnoteText);
            expect(match).not.toBeNull();
            if (match) {
                // Find where the captured group starts
                const capturedText = match[1];
                const captureStart = footnoteText.indexOf(capturedText);
                const captureEnd = captureStart + capturedText.length;

                expect(captureStart).toBe(2); // After //
                expect(captureEnd).toBe(11); // Before //
                expect(footnoteText.substring(captureStart, captureEnd)).toBe(' Comment ');
            }
        });

        it('should handle user example with custom pattern', () => {
            const content = '-- This is a highlight --^[Adding comments to this highlight!] // Comment //';
            const highlightEnd = content.indexOf('-- This is a highlight --') + '-- This is a highlight --'.length;
            const afterHighlight = content.substring(highlightEnd);

            // Extract inline footnote
            const inlineRegex = /\^\[([^\]]+)\]/g;
            const inlineMatch = inlineRegex.exec(afterHighlight);

            // Extract custom pattern
            const customPattern = '//(.+?)//';
            const customRegex = new RegExp(customPattern, 'g');
            const customMatch = customRegex.exec(afterHighlight);

            expect(inlineMatch).not.toBeNull();
            expect(customMatch).not.toBeNull();

            if (inlineMatch && customMatch) {
                expect(inlineMatch[1]).toBe('Adding comments to this highlight!');
                expect(customMatch[1].trim()).toBe('Comment');
                expect(customMatch.index).toBeGreaterThan(inlineMatch.index);
            }
        });

        it('should detect custom pattern comment by matching', () => {
            const footnoteText = '// comment //';
            const customPatterns = [
                { name: 'slash', pattern: '//(.+?)//', type: 'comment' },
                { name: 'hash', pattern: '##(.+?)##', type: 'comment' }
            ];

            let matchedPattern = null;
            for (const pattern of customPatterns) {
                const regex = new RegExp(pattern.pattern);
                const match = regex.exec(footnoteText);
                if (match) {
                    matchedPattern = pattern.name;
                    break;
                }
            }

            expect(matchedPattern).toBe('slash');
        });
    });

    describe('Edge cases', () => {
        it('should handle empty HTML comment', () => {
            const afterHighlight = '<!---->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;

            const match = htmlCommentRegex.exec(afterHighlight);
            expect(match).not.toBeNull();
            if (match) {
                expect(match[1].trim()).toBe('');
            }
        });

        it('should handle HTML comment with only whitespace', () => {
            const afterHighlight = '<!--   -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;

            const match = htmlCommentRegex.exec(afterHighlight);
            expect(match).not.toBeNull();
            if (match) {
                expect(match[1].trim()).toBe('');
            }
        });

        it('should handle native comment with emoji', () => {
            const afterHighlight = '%% comment with 🎉 emoji %%';
            const nativeCommentRegex = /%%([^%](?:[^%]|%[^%])*?)%%/g;

            const match = nativeCommentRegex.exec(afterHighlight);
            expect(match).not.toBeNull();
            if (match) {
                expect(match[1]).toContain('🎉');
            }
        });

        it('should handle HTML comment separated by newline', () => {
            const afterHighlight = '\n<!-- comment -->';
            const htmlCommentRegex = /<!--([^]*?)-->/g;

            const match = htmlCommentRegex.exec(afterHighlight);
            expect(match).not.toBeNull();
            expect(match!.index).toBe(1); // After newline
        });

        it('should handle mixed footnotes with whitespace', () => {
            const afterHighlight = '^[note]  <!-- comment -->';

            const inlineRegex = /\^\[([^\]]+)\]/g;
            const htmlRegex = /<!--([^]*?)-->/g;

            const inlineMatch = inlineRegex.exec(afterHighlight);
            const htmlMatch = htmlRegex.exec(afterHighlight);

            expect(inlineMatch).not.toBeNull();
            expect(htmlMatch).not.toBeNull();
            expect(inlineMatch![0]).toBe('^[note]');
            expect(htmlMatch![0]).toBe('<!-- comment -->');
        });
    });
});
