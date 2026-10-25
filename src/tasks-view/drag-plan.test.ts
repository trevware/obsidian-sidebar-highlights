import { nearestGap, planDrag, shiftFor } from './drag-plan';
import type { DragItem } from './drag-plan';

// A note's list as laid out: 30px rows, 40px headings.
function layout(spec: Array<string>): DragItem[] {
    let top = 0;
    return spec.map((entry) => {
        let item: DragItem;
        if (entry.startsWith('# ')) {
            item = { kind: 'heading', heading: entry.slice(2), top, height: 40 };
        } else {
            const indent = entry.match(/^>*/)?.[0].length ?? 0;
            const done = entry.includes('[x]');
            const text = entry.replace(/^>*/, '').replace('[x] ', '');
            const [heading, name] = text.split('/');
            item = { kind: 'row', heading, text: name, line: 0, indent, done, top, height: 30 };
        }
        top += item.height;
        return item;
    });
}

const list = layout([
    '# A',
    'A/one',
    'A/two',
    '>A/two-child',
    'A/three',
    '# B',
    'B/four'
]);

const describeGap = (items: DragItem[], gap: { target: unknown; at: number }) => JSON.stringify(gap.target);

describe('planDrag', () => {
    it('offers a gap before each top-level task and at the end of each heading', () => {
        const plan = planDrag(list, 1, { skipDone: false });
        // The first gap is where the task already sits.
        expect(plan.gaps.map(gap => describeGap(list, gap))).toEqual([
            JSON.stringify({ kind: 'before', line: 0, text: 'two' }),
            JSON.stringify({ kind: 'before', line: 0, text: 'three' }),
            JSON.stringify({ kind: 'heading', heading: 'A' }),
            JSON.stringify({ kind: 'before', line: 0, text: 'four' }),
            JSON.stringify({ kind: 'heading', heading: 'B' })
        ]);
    });

    it('never offers a gap between a task and its subtasks', () => {
        const plan = planDrag(list, 6, { skipDone: false });
        expect(plan.gaps.some(gap => gap.at === 3)).toBe(false);
    });

    it('carries a task\'s visible subtasks with it', () => {
        const plan = planDrag(list, 2, { skipDone: false });
        expect([plan.blockStart, plan.blockEnd, plan.span]).toEqual([2, 4, 60]);
    });

    it('measures gaps as if the dragged tasks had left the list', () => {
        const plan = planDrag(list, 2, { skipDone: false });
        const beforeThree = plan.gaps.find(gap => JSON.stringify(gap.target).includes('"three"'));
        const beforeFour = plan.gaps.find(gap => JSON.stringify(gap.target).includes('"four"'));
        expect(beforeThree?.y).toBe(70);
        expect(beforeFour?.y).toBe(140);
    });

    it('drops completed tasks shown last to the end of their heading', () => {
        const items = layout(['# A', 'A/one', 'A/[x]done', 'A/[x]done too', '# B', 'B/two']);
        const plan = planDrag(items, 5, { skipDone: true });
        expect(plan.gaps.map(gap => describeGap(items, gap))).toEqual([
            JSON.stringify({ kind: 'before', line: 0, text: 'one' }),
            JSON.stringify({ kind: 'heading', heading: 'A' }),
            JSON.stringify({ kind: 'heading', heading: 'B' })
        ]);
    });
    it('says which heading each gap is under', () => {
        const plan = planDrag(list, 1, { skipDone: false });
        expect(plan.gaps.map(gap => gap.heading)).toEqual(['A', 'A', 'A', 'B', 'B']);
    });
});

describe('nearestGap', () => {
    it('picks the gap closest to where the dragged task is', () => {
        const plan = planDrag(list, 1, { skipDone: false });
        expect(nearestGap(plan, 100)?.target).toEqual({ kind: 'before', line: 0, text: 'three' });
        expect(nearestGap(plan, 500)?.target).toEqual({ kind: 'heading', heading: 'B' });
    });
});

describe('shiftFor', () => {
    it('slides the tasks in between up or down by the dragged block\'s height', () => {
        const plan = planDrag(list, 1, { skipDone: false });
        const gap = plan.gaps.find(candidate => candidate.at === 4)!;
        expect([2, 3, 4, 5].map(index => shiftFor(plan, index, gap))).toEqual([-30, -30, 0, 0]);
        const up = planDrag(list, 4, { skipDone: false });
        const top = up.gaps.find(candidate => candidate.at === 1)!;
        expect([1, 2, 3, 5].map(index => shiftFor(up, index, top))).toEqual([30, 30, 30, 0]);
    });
});
