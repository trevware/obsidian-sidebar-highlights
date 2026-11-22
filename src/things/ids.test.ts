import { isThingsComment, readThingsId, stripThingsId, withThingsId } from './ids';
import { editableTitle, setDateInText } from '../tasks-view/task-line';

describe('Things IDs', () => {
    it('reads the ID from a task line', () => {
        expect(readThingsId('Call mum 2026-11-23 %%things:4FdDY8gKGP5sh5Ry4FLzGg%%')).toBe('4FdDY8gKGP5sh5Ry4FLzGg');
        expect(readThingsId('Call mum')).toBeUndefined();
        expect(readThingsId('Call mum %%things:short%%')).toBeUndefined();
    });

    it('puts the ID after the text and before a calendar ID', () => {
        expect(withThingsId('Call mum %%cal:0fq7k2m9vd3a%%', 'Abc12345')).toBe('Call mum %%things:Abc12345%% %%cal:0fq7k2m9vd3a%%');
        expect(withThingsId('Call mum', 'Abc12345')).toBe('Call mum %%things:Abc12345%%');
        expect(withThingsId('Call mum %%things:Abc12345%%', 'Zzz98765')).toBe('Call mum %%things:Zzz98765%%');
    });

    it('removes the ID with null', () => {
        expect(withThingsId('Call mum %%things:Abc12345%%', null)).toBe('Call mum');
    });

    it('strips the ID and leaves other comments', () => {
        expect(stripThingsId('A %%things:Abc12345%% %%cal:0fq7k2m9vd3a%%')).toBe('A %%cal:0fq7k2m9vd3a%%');
    });

    it('recognises a Things comment but not a note', () => {
        expect(isThingsComment('things:Abc12345')).toBe(true);
        expect(isThingsComment(' things:Abc12345 ')).toBe(true);
        expect(isThingsComment('things: a note')).toBe(false);
    });

    it('keeps a date and title editing in front of the ID', () => {
        expect(setDateInText('Pay rent %%things:Abc12345%%', undefined, '2026-12-01')).toBe('Pay rent 2026-12-01 %%things:Abc12345%%');
        expect(editableTitle('Pay rent %%things:Abc12345%%', undefined)).toBe('Pay rent');
    });
});
