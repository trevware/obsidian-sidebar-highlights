import { paintRun } from './row-runs';

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasClass = function (this: HTMLElement, cls: string) { return this.classList.contains(cls); };
proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean) { this.classList.toggle(cls, on); };

function rows(...classes: string[]): HTMLElement[] {
    document.body.replaceChildren();
    return classes.map(cls => {
        const el = document.createElement('div');
        el.className = cls;
        document.body.appendChild(el);
        return el;
    });
}

describe('joining selected rows into one block', () => {
    test('a selected row followed by another selected row joins it', () => {
        const [a, b] = rows('sh-task-row is-selected', 'sh-task-row is-selected');
        paintRun(a, 'is-selected');
        paintRun(b, 'is-selected');
        expect(a.classList.contains('joins-is-selected')).toBe(true);
        expect(b.classList.contains('joins-is-selected')).toBe(false);
    });

    test('a heading between two selected rows splits them', () => {
        const [a] = rows('sh-task-row is-selected', 'sh-group-header', 'sh-task-row is-selected');
        paintRun(a, 'is-selected');
        expect(a.classList.contains('joins-is-selected')).toBe(false);
    });

    test('a row stops joining once the row after it is deselected', () => {
        const [a, b] = rows('sh-task-row is-selected', 'sh-task-row is-selected');
        paintRun(a, 'is-selected');
        b.classList.remove('is-selected');
        paintRun(a, 'is-selected');
        expect(a.classList.contains('joins-is-selected')).toBe(false);
    });

    test('leaves anything that is not a task row alone', () => {
        const [header] = rows('sh-group-header is-selected', 'sh-task-row is-selected');
        paintRun(header, 'is-selected');
        expect(header.classList.contains('joins-is-selected')).toBe(false);
    });
});
