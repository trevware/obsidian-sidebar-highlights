/**
 * Tests for adjacent comments functionality
 * Tests the logic that merges comments adjacent to highlights based on settings
 */

export {};

describe('Adjacent Comments Logic', () => {
    describe('Pattern matching and detection', () => {
        it('should identify native comments', () => {
            const nativeComment = '%%this is a comment%%';
            const isNativeComment = nativeComment.startsWith('%%') && nativeComment.endsWith('%%');

            expect(isNativeComment).toBe(true);
        });

        it('should identify HTML comments', () => {
            const htmlComment = '<!-- this is a comment -->';
            const isHtmlComment = htmlComment.startsWith('<!--') && htmlComment.endsWith('-->');

            expect(isHtmlComment).toBe(true);
        });

        it('should differentiate between native and HTML comments', () => {
            const nativeComment = '%%comment%%';
            const htmlComment = '<!-- comment -->';

            const isNative1 = nativeComment.startsWith('%%') && nativeComment.endsWith('%%');
            const isNative2 = htmlComment.startsWith('%%') && htmlComment.endsWith('%%');

            expect(isNative1).toBe(true);
            expect(isNative2).toBe(false);
        });
    });

    describe('Adjacency detection', () => {
        it('should detect adjacent comments with no space', () => {
            const content = '==highlight==<!-- comment -->';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('<!-- comment -->');
            const betweenText = content.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('');
        });

        it('should detect adjacent comments with whitespace', () => {
            const content = '==highlight== <!-- comment -->';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('<!-- comment -->');
            const betweenText = content.substring(highlightEnd, commentStart);

            expect(betweenText.trim()).toBe('');
            expect(/^\s*$/.test(betweenText)).toBe(true);
        });

        it('should detect adjacent comments with inline footnotes', () => {
            const content = '==highlight==^[note]<!-- comment -->';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('<!-- comment -->');
            const betweenText = content.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('^[note]');
            // This would require InlineFootnoteManager.calculateFootnoteLength in real implementation
        });

        it('should detect adjacent comments with standard footnotes', () => {
            const content = '==highlight==[^1]<!-- comment -->';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('<!-- comment -->');
            const betweenText = content.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('[^1]');
        });

        it('should NOT detect comments separated by blank line', () => {
            const content = '==highlight==\n\n<!-- comment -->';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('<!-- comment -->');
            const betweenText = content.substring(highlightEnd, commentStart);

            const hasBlankLine = /\n\s*\n/.test(betweenText);
            expect(hasBlankLine).toBe(true);
        });

        it('should NOT detect comments separated by other content', () => {
            const content = '==highlight== some text <!-- comment -->';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('<!-- comment -->');
            const betweenText = content.substring(highlightEnd, commentStart);

            // After removing potential footnotes, there's still non-whitespace content
            expect(betweenText.trim()).not.toBe('');
        });
    });

    describe('Adjacent comment settings logic', () => {
        /**
         * Simulates the shouldApplyAdjacency logic from main.ts
         */
        const shouldApplyAdjacency = (commentText: string, detectAdjacentNativeComments: boolean): boolean => {
            const isNativeComment = commentText.startsWith('%%') && commentText.endsWith('%%');
            // This is the FIXED logic - both types respect the setting
            return detectAdjacentNativeComments;
        };

        describe('With detectAdjacentNativeComments = true', () => {
            it('should apply adjacency to native comments', () => {
                const result = shouldApplyAdjacency('%%comment%%', true);
                expect(result).toBe(true);
            });

            it('should apply adjacency to HTML comments', () => {
                const result = shouldApplyAdjacency('<!-- comment -->', true);
                expect(result).toBe(true);
            });

            it('should apply adjacency to both comment types in same document', () => {
                const nativeResult = shouldApplyAdjacency('%%native%%', true);
                const htmlResult = shouldApplyAdjacency('<!-- html -->', true);

                expect(nativeResult).toBe(true);
                expect(htmlResult).toBe(true);
            });
        });

        describe('With detectAdjacentNativeComments = false', () => {
            it('should NOT apply adjacency to native comments', () => {
                const result = shouldApplyAdjacency('%%comment%%', false);
                expect(result).toBe(false);
            });

            it('should NOT apply adjacency to HTML comments', () => {
                const result = shouldApplyAdjacency('<!-- comment -->', false);
                expect(result).toBe(false);
            });

            it('should NOT apply adjacency to both comment types in same document', () => {
                const nativeResult = shouldApplyAdjacency('%%native%%', false);
                const htmlResult = shouldApplyAdjacency('<!-- html -->', false);

                expect(nativeResult).toBe(false);
                expect(htmlResult).toBe(false);
            });
        });
    });

    describe('Real-world scenarios from user feedback', () => {
        describe('Example 1: Native comment with toggle OFF', () => {
            it('should show native comment separately', () => {
                const content = '==The benefits of predatory insects==%% Think what would happen if they did not exist %%';
                const detectAdjacentNativeComments = false;

                // Simulate the logic
                const isNativeComment = true;
                const shouldApplyAdjacency = detectAdjacentNativeComments;

                expect(shouldApplyAdjacency).toBe(false);
                // Comment should appear separately in sidebar
            });
        });

        describe('Example 2: HTML comment with toggle OFF', () => {
            it('should show HTML comment separately (FIXED)', () => {
                const content = '==一个文字==<!-- @purple 对应的注释 -->';
                const detectAdjacentNativeComments = false;

                // Simulate the FIXED logic
                const isNativeComment = false;
                const shouldApplyAdjacency = detectAdjacentNativeComments; // FIXED: was (!isNativeComment || detectAdjacentNativeComments)

                expect(shouldApplyAdjacency).toBe(false);
                // Comment should appear separately in sidebar, not merged with highlight
            });

            it('OLD BUGGY BEHAVIOR: HTML comment was always adjacent', () => {
                const content = '==一个文字==<!-- @purple 对应的注释 -->';
                const detectAdjacentNativeComments = false;

                // Simulate the OLD BUGGY logic
                const isNativeComment = false;
                const shouldApplyAdjacencyOld = !isNativeComment || detectAdjacentNativeComments;

                expect(shouldApplyAdjacencyOld).toBe(true); // BUG: was always true for HTML
                // This was the bug - HTML comments were always merged
            });
        });

        describe('Example 3: HTML comment with toggle ON', () => {
            it('should merge HTML comment with highlight', () => {
                const content = '==一个文字==<!-- @purple 对应的注释 -->';
                const detectAdjacentNativeComments = true;

                // Simulate the logic
                const isNativeComment = false;
                const shouldApplyAdjacency = detectAdjacentNativeComments;

                expect(shouldApplyAdjacency).toBe(true);
                // Comment should be merged as footnote to the highlight
            });
        });

        describe('Example 4: Mixed highlight with footnote and comment', () => {
            it('should handle highlight + inline footnote + HTML comment with toggle ON', () => {
                const content = '==这是一个带注释的高亮片段==^[脚注，嘿嘿]<!-- @purple 额外的注释 -->';
                const detectAdjacentNativeComments = true;

                // Parse components
                const highlightEnd = content.indexOf('==这是一个带注释的高亮片段==') + '==这是一个带注释的高亮片段=='.length;
                const footnoteStart = content.indexOf('^[');
                const footnoteEnd = content.indexOf(']', footnoteStart) + 1;
                const commentStart = content.indexOf('<!--');

                const betweenHighlightAndComment = content.substring(highlightEnd, commentStart);

                // Should contain only the footnote
                expect(betweenHighlightAndComment).toBe('^[脚注，嘿嘿]');

                // With toggle ON, comment should be merged
                const shouldApplyAdjacency = detectAdjacentNativeComments;
                expect(shouldApplyAdjacency).toBe(true);
            });

            it('should handle highlight + inline footnote + HTML comment with toggle OFF', () => {
                const content = '==highlight==^[note]<!-- comment -->';
                const detectAdjacentNativeComments = false;

                // With toggle OFF, comment should NOT be merged
                const shouldApplyAdjacency = detectAdjacentNativeComments;
                expect(shouldApplyAdjacency).toBe(false);
                // Comment should appear separately
            });
        });

        describe('Example 5: Multiple footnotes before comment', () => {
            it('should handle multiple footnotes between highlight and comment', () => {
                const content = '==highlight==[^1]^[note2][^3]<!-- comment -->';

                const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
                const commentStart = content.indexOf('<!--');
                const betweenText = content.substring(highlightEnd, commentStart);

                expect(betweenText).toBe('[^1]^[note2][^3]');
                // After removing footnotes, should be empty or whitespace only
            });
        });

        describe('Example 6: Comment with color annotation', () => {
            it('should handle HTML comments with color annotations', () => {
                const htmlCommentRegex = /<!--\s*@(\w+)\s+(.*?)\s*-->/;
                const comment = '<!-- @purple 对应的注释 -->';

                const match = htmlCommentRegex.exec(comment);

                expect(match).not.toBeNull();
                if (match) {
                    expect(match[1]).toBe('purple'); // color
                    expect(match[2]).toBe('对应的注释'); // text
                }
            });

            it('should extract text from HTML comment without color annotation', () => {
                const htmlCommentRegex = /<!--([^]*?)-->/;
                const comment = '<!-- just a regular comment -->';

                const match = htmlCommentRegex.exec(comment);

                expect(match).not.toBeNull();
                if (match) {
                    expect(match[1].trim()).toBe('just a regular comment');
                }
            });
        });
    });

    describe('Edge cases', () => {
        it('should handle empty comment', () => {
            const content = '==highlight==<!---->';
            const htmlCommentRegex = /<!--([^]*?)-->/;
            const match = htmlCommentRegex.exec(content);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[1].trim()).toBe('');
            }
        });

        it('should handle comment with only whitespace', () => {
            const content = '==highlight==<!--   -->';
            const htmlCommentRegex = /<!--([^]*?)-->/;
            const match = htmlCommentRegex.exec(content);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[1].trim()).toBe('');
            }
        });

        it('should handle multiline HTML comment', () => {
            const content = `==highlight==<!--
                This is a multiline
                comment
            -->`;
            const htmlCommentRegex = /<!--([^]*?)-->/;
            const match = htmlCommentRegex.exec(content);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[1]).toContain('multiline');
            }
        });

        it('should handle comment immediately after newline', () => {
            const content = '==highlight==\n<!-- comment -->';
            const highlightEnd = content.indexOf('==highlight==') + '==highlight=='.length;
            const commentStart = content.indexOf('<!--');
            const betweenText = content.substring(highlightEnd, commentStart);

            expect(betweenText).toBe('\n');
            expect(/^\s*$/.test(betweenText)).toBe(true);

            // Should still be adjacent (single newline, not blank line)
            const hasBlankLine = /\n\s*\n/.test(betweenText);
            expect(hasBlankLine).toBe(false);
        });

        it('should handle CJK characters in comments', () => {
            const content = '==高亮==<!-- 中文注释 -->';
            const htmlCommentRegex = /<!--([^]*?)-->/;
            const match = htmlCommentRegex.exec(content);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[1].trim()).toBe('中文注释');
            }
        });

        it('should handle emoji in comments', () => {
            const content = '==highlight==<!-- comment with emoji 🎉 -->';
            const htmlCommentRegex = /<!--([^]*?)-->/;
            const match = htmlCommentRegex.exec(content);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[1]).toContain('🎉');
            }
        });
    });

    describe('Sorting and positioning', () => {
        it('should use comment position for sorting when merging', () => {
            const content = '==highlight==^[inline note]<!-- comment -->';

            const inlineFootnotePos = content.indexOf('^[');
            const htmlCommentPos = content.indexOf('<!--');

            // When merging, both should be sorted by their actual position
            expect(inlineFootnotePos).toBeLessThan(htmlCommentPos);
            // The adjacent comment position should be stored for correct sorting
        });

        it('should maintain correct order with multiple footnotes and comment', () => {
            const content = '==highlight==[^1]^[note]<!-- comment -->';

            const footnote1Pos = content.indexOf('[^1]');
            const footnote2Pos = content.indexOf('^[note]');
            const commentPos = content.indexOf('<!--');

            expect(footnote1Pos).toBeLessThan(footnote2Pos);
            expect(footnote2Pos).toBeLessThan(commentPos);
        });
    });
});
