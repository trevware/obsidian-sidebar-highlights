import { FOOTNOTE_SEQUENCE_REGEX, FOOTNOTE_VALIDATION_REGEX } from './regex-patterns';

describe('footnote validation', () => {
    it('accepts an empty inline footnote while its comment is being written', () => {
        expect(FOOTNOTE_VALIDATION_REGEX.test('^[]')).toBe(true);
        expect('^[] next text'.match(FOOTNOTE_SEQUENCE_REGEX)?.[0]).toBe('^[]');
    });

    it('continues to accept populated inline and standard footnotes', () => {
        expect(FOOTNOTE_VALIDATION_REGEX.test('^[note] [^1]')).toBe(true);
    });
});
