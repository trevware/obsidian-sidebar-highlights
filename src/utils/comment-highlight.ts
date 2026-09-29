export type CommentStyle = 'inline' | 'standard';

export interface CommentHighlight {
    replacement: string;
    cursorOffset: number;
    commentStyle: CommentStyle;
}

export function createCommentHighlight(selection: string, commentStyle: CommentStyle): CommentHighlight {
    const highlightedText = `==${selection}==`;

    if (commentStyle === 'inline') {
        const replacement = `${highlightedText}^[]`;
        return {
            replacement,
            cursorOffset: replacement.length - 1,
            commentStyle: 'inline'
        };
    }

    return {
        replacement: highlightedText,
        cursorOffset: highlightedText.length,
        commentStyle: 'standard'
    };
}
