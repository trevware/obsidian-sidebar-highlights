import { createCommentHighlight } from './comment-highlight';

describe('comment highlight creation', () => {
    it('uses an empty inline footnote when the inline style is requested', () => {
        expect(createCommentHighlight('source', 'inline')).toEqual({
            replacement: '==source==^[]',
            cursorOffset: 12,
            commentStyle: 'inline'
        });
    });

    it('leaves the cursor after the highlight when the standard style is requested', () => {
        expect(createCommentHighlight('source', 'standard')).toEqual({
            replacement: '==source==',
            cursorOffset: 10,
            commentStyle: 'standard'
        });
    });

    it('calculates the standard-footnote cursor position for a multiline selection', () => {
        expect(createCommentHighlight('first\nsecond', 'standard')).toEqual({
            replacement: '==first\nsecond==',
            cursorOffset: 16,
            commentStyle: 'standard'
        });
    });
});
