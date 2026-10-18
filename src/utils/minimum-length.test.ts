import { meetsMinimumCharacterCount } from './minimum-length';

describe('meetsMinimumCharacterCount', () => {
    it('lets everything through when there is no minimum', () => {
        expect(meetsMinimumCharacterCount({ type: 'highlight', text: 'a' }, 0)).toBe(true);
    });

    it('drops highlights shorter than the minimum', () => {
        expect(meetsMinimumCharacterCount({ type: 'highlight', text: 'abc' }, 4)).toBe(false);
        expect(meetsMinimumCharacterCount({ type: 'html', text: 'abc' }, 4)).toBe(false);
    });

    it('keeps highlights that reach the minimum', () => {
        expect(meetsMinimumCharacterCount({ type: 'highlight', text: 'abcd' }, 4)).toBe(true);
    });

    it('drops native comments shorter than the minimum', () => {
        expect(meetsMinimumCharacterCount({ type: 'comment', isNativeComment: true, text: 'abc' }, 4)).toBe(false);
    });

    it('never drops custom pattern matches', () => {
        expect(meetsMinimumCharacterCount({ type: 'custom', text: 'a' }, 4)).toBe(true);
    });
});
