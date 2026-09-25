import { createCommentHighlight } from './comment-highlight';

describe('comment highlight creation', () => {
    it('uses an empty inline footnote when inline comments are enabled', () => {
        expect(createCommentHighlight('source', true)).toEqual({
            replacement: '==source==^[]',
            cursorOffset: 12,
            commentStyle: 'inline'
        });
    });

    it('leaves the cursor after the highlight when standard footnotes are enabled', () => {
        expect(createCommentHighlight('source', false)).toEqual({
            replacement: '==source==',
            cursorOffset: 10,
            commentStyle: 'standard'
        });
    });

    it('calculates the standard-footnote cursor position for a multiline selection', () => {
        expect(createCommentHighlight('first\nsecond', false)).toEqual({
            replacement: '==first\nsecond==',
            cursorOffset: 16,
            commentStyle: 'standard'
        });
    });
});
