jest.mock('obsidian', () => ({ setIcon: () => undefined, moment: { locale: () => 'en' }, Platform: { isMobile: false } }), { virtual: true });

import { SubtaskField } from './subtask-field';
import type { SubtaskFieldHost } from './subtask-field';

// Obsidian's element helpers, as far as the field uses them.
type Info = { cls?: string | string[]; text?: string; type?: string } | string | undefined;
const make = (tag: string, info?: Info) => {
    const el = document.createElement(tag);
    if (typeof info === 'string') el.className = info;
    else if (info) {
        if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
        if (info.text != null) el.textContent = info.text;
        if (info.type) el.setAttribute('type', info.type);
    }
    return el;
};
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: HTMLElement, tag: string, info?: Info) { return this.appendChild(make(tag, info)); };
proto.createDiv = function (this: HTMLElement, info?: Info) { return this.appendChild(make('div', info)); };
proto.createSpan = function (this: HTMLElement, info?: Info) { return this.appendChild(make('span', info)); };
proto.setAttr = function (this: HTMLElement, name: string, value: string) { this.setAttribute(name, value); };
proto.empty = function (this: HTMLElement) { this.replaceChildren(); };
(globalThis as unknown as Record<string, unknown>).createDiv = (info?: Info) => make('div', info);

function setup(submit: SubtaskFieldHost['submit'] = () => Promise.resolve(true), capitalize = false) {
    document.body.replaceChildren();
    const card = document.body.appendChild(document.createElement('div'));
    const outside = document.body.appendChild(document.createElement('button'));
    const closes: boolean[] = [];
    const field = new SubtaskField('Project.md:3', {
        today: () => '2026-10-28',
        formatDate: (iso) => iso,
        capitalize: () => capitalize,
        submit,
        onClose: (byKey) => { closes.push(byKey); }
    });
    card.appendChild(field.el);
    field.focus();
    return { field, card, outside, closes };
}

const input = () => document.querySelector('.sh-card-subtask-input') as HTMLInputElement;
const type = (text: string) => {
    input().value = text;
    input().setSelectionRange(text.length, text.length);
    input().dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (name: string) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(event);
    return event;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('typing subtasks in the card', () => {
    it('capitalizes the field once the first word is typed, when Capitalize tasks is on', () => {
        setup(undefined, true);
        type('ask ');
        expect(input().value).toBe('Ask ');
    });

    it('adds on Enter, reading the date, and stays open for the next one', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { field, closes } = setup(submit, true);
        type('ask about pricing tomorrow');
        key('Enter');
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] Ask about pricing 2026-10-29']);
        expect(input().value).toBe('');
        expect(field.el.isConnected).toBe(true);
        expect(document.activeElement).toBe(input());
        expect(closes).toEqual([]);
    });

    it('tints a recognised date', () => {
        setup();
        type('call back fri');
        expect(document.querySelector('.sh-quickadd-token.is-date')?.textContent).toBe('fri');
    });

    it('turns a date back into words with Backspace right after it', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        setup(submit);
        type('call back fri');
        expect(key('Backspace').defaultPrevented).toBe(true);
        expect(document.querySelector('.sh-quickadd-token')).toBeNull();
        key('Enter');
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] call back fri']);
    });

    it('closes on Enter with nothing typed', () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { field, closes } = setup(submit);
        key('Enter');
        expect(submit).not.toHaveBeenCalled();
        expect(field.el.isConnected).toBe(false);
        expect(closes).toEqual([true]);
    });

    it('closes on Escape without adding', () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { field, closes } = setup(submit);
        type('never mind');
        key('Escape');
        expect(submit).not.toHaveBeenCalled();
        expect(field.el.isConnected).toBe(false);
        expect(closes).toEqual([true]);
    });

    it('adds what was typed when you click away, then closes', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { field, outside, closes } = setup(submit);
        type('book a room');
        outside.focus();
        await settle();
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledWith(['- [ ] book a room']);
        expect(field.el.isConnected).toBe(false);
        expect(closes).toEqual([false]);
    });

    it('keeps its words through a redraw of the card', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { field, card, closes } = setup(submit);
        type('half typed');
        // Chrome blurs a focused field as it takes it off the page.
        input().blur();
        card.remove();
        const redrawn = document.body.appendChild(document.createElement('div'));
        redrawn.appendChild(field.el);
        field.focus();
        await settle();
        expect(submit).not.toHaveBeenCalled();
        expect(closes).toEqual([]);
        expect(input().value).toBe('half typed');
        expect(document.activeElement).toBe(input());
    });

    it('puts the words back when the subtask could not be added', async () => {
        const { field } = setup(() => Promise.resolve(false));
        type('call back');
        key('Enter');
        await settle();
        expect(input().value).toBe('call back');
        expect(field.el.isConnected).toBe(true);
    });

    it('adds one subtask per pasted line', () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        setup(submit);
        const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
        Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '- first\n- [ ] second p1\n' } });
        input().dispatchEvent(paste);
        expect(paste.defaultPrevented).toBe(true);
        expect(submit).toHaveBeenCalledWith(['- [ ] first', '- [!1] second']);
    });
});
