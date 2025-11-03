/**
 * Tests for inline footnote insertion
 * Tests positioning, newline handling, and cursor placement
 */

import { InlineFootnoteManager } from './inline-footnote-manager';

export {};

// Mock Editor interface for testing
class MockEditor {
    private content: string;
    public cursorPos: { line: number, ch: number } | null = null;
    public selection: { from: { line: number, ch: number }, to: { line: number, ch: number } } | null = null;
    public focused: boolean = false;

    constructor(initialContent: string) {
        this.content = initialContent;
    }

    getValue(): string {
        return this.content;
    }

    offsetToPos(offset: number): { line: number, ch: number } {
        const lines = this.content.split('\n');
        let currentOffset = 0;

        for (let line = 0; line < lines.length; line++) {
            const lineLength = lines[line].length;
            if (currentOffset + lineLength >= offset) {
                return { line, ch: offset - currentOffset };
            }
            currentOffset += lineLength + 1; // +1 for newline
        }

        return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    }

    replaceRange(text: string, pos: { line: number, ch: number }): void {
        const lines = this.content.split('\n');
        const line = lines[pos.line];
        const before = line.substring(0, pos.ch);
        const after = line.substring(pos.ch);
        lines[pos.line] = before + text + after;
        this.content = lines.join('\n');
    }

    setCursor(pos: { line: number, ch: number }): void {
        this.cursorPos = pos;
    }

    setSelection(from: { line: number, ch: number }, to: { line: number, ch: number }): void {
        this.selection = { from, to };
    }

    focus(): void {
        this.focused = true;
    }
}

describe('InlineFootnoteManager', () => {
    let manager: InlineFootnoteManager;

    beforeEach(() => {
        manager = new InlineFootnoteManager();
    });

    describe('insertInlineFootnote', () => {
        describe('Basic insertion', () => {
            it('should insert footnote immediately after highlight on same line', () => {
                // Note: startOffset and endOffset should match the actual highlight position
                // "This is " = 8 chars, "==highlighted text==" = 22 chars, total = 30
                const editor = new MockEditor('This is ==highlighted text== on a line.');
                const highlight = {
                    id: '1',
                    text: 'highlighted text',
                    startOffset: 8,   // Start of ==
                    endOffset: 30,    // End of == (just before the space)
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                // Should insert right after ==, before the space
                const finalText = editor.getValue();
                expect(finalText).toContain('==highlighted text==^[]');
                expect(finalText).toContain(' on a line.');
            });

            it('should insert footnote before newline, not after', () => {
                const editor = new MockEditor('==highlighted text==\nNext line');
                const highlight = {
                    id: '1',
                    text: 'highlighted text',
                    startOffset: 0,
                    endOffset: 22,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('==highlighted text==^[]\nNext line');
                // Should NOT be: "==highlighted text==\n^[]Next line"
            });

            it('should insert footnote at end of line with trailing spaces', () => {
                const editor = new MockEditor('==highlighted text==  \nNext line');
                const highlight = {
                    id: '1',
                    text: 'highlighted text',
                    startOffset: 0,
                    endOffset: 22,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                // Should insert before the newline, after the highlight
                expect(editor.getValue()).toBe('==highlighted text==^[]  \nNext line');
            });

            it('should insert footnote with content', () => {
                const editor = new MockEditor('This is ==highlighted text== here.');
                const highlight = {
                    id: '1',
                    text: 'highlighted text',
                    startOffset: 8,
                    endOffset: 30,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, 'my comment');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('This is ==highlighted text==^[my comment] here.');
                expect(result.contentLength).toBe(10);
            });
        });

        describe('Existing footnotes', () => {
            it('should insert after existing inline footnote', () => {
                const editor = new MockEditor('==highlighted text==^[first comment] more text');
                const highlight = {
                    id: '1',
                    text: 'highlighted text',
                    startOffset: 0,
                    endOffset: 22,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, 'second');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('==highlighted text==^[first comment]^[second] more text');
            });

            it('should insert after multiple existing footnotes', () => {
                const editor = new MockEditor('==text==^[first]^[second] end');
                const highlight = {
                    id: '1',
                    text: 'text',
                    startOffset: 0,
                    endOffset: 10,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, 'third');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('==text==^[first]^[second]^[third] end');
            });

            it('should handle footnotes with nested brackets', () => {
                const editor = new MockEditor('==text==^[comment with [nested] brackets] end');
                const highlight = {
                    id: '1',
                    text: 'text',
                    startOffset: 0,
                    endOffset: 10,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, 'new');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('==text==^[comment with [nested] brackets]^[new] end');
            });
        });

        describe('Edge cases with newlines', () => {
            it('should not include newline in insertion position', () => {
                const editor = new MockEditor('Line 1 ==highlight==\n\nLine 3');
                const highlight = {
                    id: '1',
                    text: 'highlight',
                    startOffset: 7,
                    endOffset: 21,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                // Should be on line 0, not line 1
                expect(editor.getValue()).toBe('Line 1 ==highlight==^[]\n\nLine 3');
            });

            it('should work with CRLF line endings', () => {
                const editor = new MockEditor('==text==\r\nNext line');
                const highlight = {
                    id: '1',
                    text: 'text',
                    startOffset: 0,
                    endOffset: 10,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('==text==^[]\r\nNext line');
            });

            it('should handle highlight at very end of file', () => {
                const editor = new MockEditor('==highlighted text==');
                const highlight = {
                    id: '1',
                    text: 'highlighted text',
                    startOffset: 0,
                    endOffset: 22,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('==highlighted text==^[]');
            });
        });

        describe('Cursor positioning info', () => {
            it('should return correct position for empty footnote', () => {
                const editor = new MockEditor('==text== here');
                const highlight = {
                    id: '1',
                    text: 'text',
                    startOffset: 0,
                    endOffset: 10,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                expect(result.insertPos).toBeDefined();
                expect(result.insertPos!.line).toBe(0);
                expect(result.insertPos!.ch).toBe(8); // After "==text=="
                expect(result.contentLength).toBe(0);
            });

            it('should return correct position with content', () => {
                const editor = new MockEditor('==text== here');
                const highlight = {
                    id: '1',
                    text: 'text',
                    startOffset: 0,
                    endOffset: 10,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, 'comment');

                expect(result.success).toBe(true);
                expect(result.contentLength).toBe(7);
            });
        });

        describe('Duplicate text handling', () => {
            it('should find correct instance based on startOffset', () => {
                const editor = new MockEditor('==word== some text ==word== more');
                const highlight = {
                    id: '1',
                    text: 'word',
                    startOffset: 19, // Second instance
                    endOffset: 29,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                // Should insert after the SECOND instance
                expect(editor.getValue()).toBe('==word== some text ==word==^[] more');
            });
        });

        describe('HTML highlights', () => {
            it('should handle font color highlights', () => {
                const editor = new MockEditor('Text <font color="red">highlighted</font> here');
                const highlight = {
                    id: '1',
                    text: 'highlighted',
                    startOffset: 5,
                    endOffset: 41,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false,
                    color: '#ff0000', // HTML highlights need a color property
                    type: 'html' as 'html'
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('Text <font color="red">highlighted</font>^[] here');
            });
        });

        describe('Native comments', () => {
            it('should handle native comment highlights', () => {
                const editor = new MockEditor('Text %%comment text%% here');
                const highlight = {
                    id: '1',
                    text: 'comment text',
                    startOffset: 5,
                    endOffset: 23,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: true
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('Text %%comment text%%^[] here');
            });
        });

        describe('Failure cases', () => {
            it('should return failure when highlight not found', () => {
                const editor = new MockEditor('Some text without highlight');
                const highlight = {
                    id: '1',
                    text: 'nonexistent',
                    startOffset: 0,
                    endOffset: 10,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(false);
                expect(editor.getValue()).toBe('Some text without highlight');
            });
        });

        describe('Custom patterns', () => {
            it('should insert footnote after custom pattern highlight', () => {
                const editor = new MockEditor('This is --custom text-- here.');
                const highlight = {
                    id: '1',
                    text: 'custom text',
                    startOffset: 8,
                    endOffset: 24,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false,
                    type: 'custom' as 'custom',
                    fullMatch: '--custom text--'
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('This is --custom text--^[] here.');
            });

            it('should insert footnote with content for custom pattern', () => {
                const editor = new MockEditor('--Hello-- world');
                const highlight = {
                    id: '1',
                    text: 'Hello',
                    startOffset: 0,
                    endOffset: 9,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false,
                    type: 'custom' as 'custom',
                    fullMatch: '--Hello--'
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, 'my note');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('--Hello--^[my note] world');
                expect(result.contentLength).toBe(7);
            });

            it('should handle duplicate custom pattern text using distance matching', () => {
                const editor = new MockEditor('--test-- some text --test-- more');
                const highlight = {
                    id: '1',
                    text: 'test',
                    startOffset: 19, // Second occurrence
                    endOffset: 27,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false,
                    type: 'custom' as 'custom',
                    fullMatch: '--test--'
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, 'note2');

                expect(result.success).toBe(true);
                // Should add footnote to the second occurrence
                expect(editor.getValue()).toBe('--test-- some text --test--^[note2] more');
            });

            it('should insert after existing footnote for custom pattern', () => {
                const editor = new MockEditor('--highlighted--^[first] text');
                const highlight = {
                    id: '1',
                    text: 'highlighted',
                    startOffset: 0,
                    endOffset: 15,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false,
                    type: 'custom' as 'custom',
                    fullMatch: '--highlighted--'
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, 'second');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('--highlighted--^[first]^[second] text');
            });

            it('should handle custom pattern at end of line', () => {
                const editor = new MockEditor('Text --end--\nNew line');
                const highlight = {
                    id: '1',
                    text: 'end',
                    startOffset: 5,
                    endOffset: 12,
                    line: 0,
                    tags: [],
                    filePath: 'test.md',
                    isNativeComment: false,
                    type: 'custom' as 'custom',
                    fullMatch: '--end--'
                };

                const result = manager.insertInlineFootnote(editor as any, highlight, '');

                expect(result.success).toBe(true);
                expect(editor.getValue()).toBe('Text --end--^[]\nNew line');
            });
        });
    });

    describe('calculateFootnoteLength', () => {
        it('should calculate single footnote length', () => {
            const text = '^[comment] after';
            const length = InlineFootnoteManager.calculateFootnoteLength(text);
            expect(length).toBe(10); // Length of "^[comment]"
        });

        it('should calculate multiple footnotes', () => {
            const text = '^[first]^[second] after';
            const length = InlineFootnoteManager.calculateFootnoteLength(text);
            expect(length).toBe(17); // Length of "^[first]^[second]"
        });

        it('should handle nested brackets', () => {
            const text = '^[comment with [nested] brackets] after';
            const length = InlineFootnoteManager.calculateFootnoteLength(text);
            expect(length).toBe(33);
        });

        it('should return 0 for no footnotes', () => {
            const text = 'no footnotes here';
            const length = InlineFootnoteManager.calculateFootnoteLength(text);
            expect(length).toBe(0);
        });

        it('should stop at first non-footnote text', () => {
            const text = '^[first]some text^[second]';
            const length = InlineFootnoteManager.calculateFootnoteLength(text);
            expect(length).toBe(8); // Only "^[first]"
        });
    });
});
