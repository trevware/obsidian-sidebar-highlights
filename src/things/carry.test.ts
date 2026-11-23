import { carryBlock } from './carry';

const source = [
    '# Plan',
    '',
    '## Calls',
    '- [ ] Call Mom %%things:Abc12345%%',
    '\tBring the photos',
    '\t- [ ] Find the album',
    '- [ ] Call Dad',
    ''
];

describe('carrying a task to another note', () => {
    it('takes the line with its notes and subtasks, and puts it under the heading', () => {
        const target = ['# Home', '', '## Family', '- [ ] Visit Gran', ''];
        const result = carryBlock(source, { line: 3, text: 'Call Mom %%things:Abc12345%%' }, target, 'Family');
        expect(result).not.toBeNull();
        expect(result!.from).toEqual(['# Plan', '', '## Calls', '- [ ] Call Dad', '']);
        expect(result!.to).toEqual([
            '# Home', '', '## Family',
            '- [ ] Call Mom %%things:Abc12345%%', '\tBring the photos', '\t- [ ] Find the album',
            '- [ ] Visit Gran', ''
        ]);
    });

    it('adds the heading when the note has none by that name', () => {
        const result = carryBlock(source, { line: 3, text: 'Call Mom %%things:Abc12345%%' }, ['# Home', '', '- [ ] Visit Gran'], 'Family');
        expect(result!.to.filter(line => line === '## Family')).toHaveLength(1);
        expect(result!.to.indexOf('- [ ] Call Mom %%things:Abc12345%%')).toBeGreaterThan(result!.to.indexOf('## Family'));
    });

    it('puts it at the end of the note when there is no heading, or a blank one', () => {
        for (const heading of [undefined, '  ']) {
            const result = carryBlock(source, { line: 3, text: 'Call Mom %%things:Abc12345%%' }, ['# Home', '', '- [ ] Visit Gran', ''], heading);
            expect(result!.to.slice(0, 6)).toEqual(['# Home', '', '- [ ] Visit Gran', '- [ ] Call Mom %%things:Abc12345%%', '\tBring the photos', '\t- [ ] Find the album']);
            expect(result!.to.some(line => /^#+\s*$/.test(line))).toBe(false);
        }
    });

    it('finds the line again when the note shifted', () => {
        const shifted = ['New first line', ...source];
        const result = carryBlock(shifted, { line: 3, text: 'Call Mom %%things:Abc12345%%' }, ['# Home'], undefined);
        expect(result!.from).toEqual(['New first line', '# Plan', '', '## Calls', '- [ ] Call Dad', '']);
    });

    it('leaves both notes alone when the line is gone or changed', () => {
        expect(carryBlock(source, { line: 3, text: 'Call Mum %%things:Abc12345%%' }, ['# Home'], 'Family')).toBeNull();
    });
});
