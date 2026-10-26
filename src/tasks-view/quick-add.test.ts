jest.mock('obsidian', () => ({ setIcon: () => undefined, moment: { locale: () => 'en' } }), { virtual: true });

import { QuickAdd } from './quick-add';
import type { QuickAddHost } from './quick-add';

// Obsidian's element helpers, as far as quick add uses them.
type Info = { cls?: string | string[]; text?: string; type?: string } | string | undefined;
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: HTMLElement, tag: string, info?: Info) {
    const el = document.createElement(tag);
    if (typeof info === 'string') el.className = info;
    else if (info) {
        if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
        if (info.text != null) el.textContent = info.text;
        if (info.type) el.setAttribute('type', info.type);
    }
    this.appendChild(el);
    return el;
};
proto.createDiv = function (this: HTMLElement, info?: Info) { return (this as unknown as { createEl: (tag: string, info?: Info) => HTMLElement }).createEl('div', info); };
proto.createSpan = function (this: HTMLElement, info?: Info) { return (this as unknown as { createEl: (tag: string, info?: Info) => HTMLElement }).createEl('span', info); };
proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean) { this.classList.toggle(cls, on); };
proto.addClass = function (this: HTMLElement, ...cls: string[]) { this.classList.add(...cls); };
proto.removeClass = function (this: HTMLElement, ...cls: string[]) { this.classList.remove(...cls); };
proto.hasClass = function (this: HTMLElement, cls: string) { return this.classList.contains(cls); };
proto.empty = function (this: HTMLElement) { this.replaceChildren(); };
proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); };

function setup(submit: QuickAddHost['submit'] = () => Promise.resolve(true), overrides: Partial<QuickAddHost> = {}) {
    document.body.replaceChildren();
    const container = document.body.createDiv({ cls: 'sh-tasks-view' });
    const outside = container.createDiv({ cls: 'sh-tasks-scroll' });
    outside.tabIndex = 0;
    let closed = 0;
    const host: QuickAddHost = {
        today: () => '2026-10-25',
        formatDate: (iso) => iso,
        dateLabel: (iso) => iso,
        destinationLabel: (destination) => destination.path,
        defaultDestination: () => ({ path: 'Inbox.md' }),
        chooseDestination: () => undefined,
        submit,
        onClose: () => { closed++; },
        ...overrides
    };
    const quickAdd = new QuickAdd(container, host);
    return { quickAdd, container, outside, closes: () => closed };
}

const escape = () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const enter = () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const type = (container: HTMLElement, text: string) => {
    const input = container.querySelector('.sh-quickadd-input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(event);
    return event;
};
const field = (container: HTMLElement) => container.querySelector('.sh-quickadd-input') as HTMLInputElement;
const chips = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('button.sh-chip')];
const press = (el: Element) => el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));

describe('closing quick add', () => {
    it('closes with Escape while typing', () => {
        const { quickAdd } = setup();
        quickAdd.open();
        escape();
        expect(quickAdd.isOpen).toBe(false);
    });

    it('closes with Escape after focus has left the field', () => {
        const { quickAdd, outside } = setup();
        quickAdd.open();
        outside.focus();
        escape();
        expect(quickAdd.isOpen).toBe(false);
    });

    it('closes on a click outside it', () => {
        const { quickAdd, outside, closes } = setup();
        quickAdd.open();
        press(outside);
        expect(quickAdd.isOpen).toBe(false);
        expect(closes()).toBe(1);
    });

    it('stays open for a click inside it, keeping the cursor in the field', () => {
        const { quickAdd, container } = setup();
        quickAdd.open();
        const panel = container.querySelector('.sh-quickadd') as HTMLElement;
        press(panel);
        const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        panel.dispatchEvent(down);
        expect(quickAdd.isOpen).toBe(true);
        expect(down.defaultPrevented).toBe(true);
    });

    it('stays open while the note picker is over it', () => {
        const { quickAdd, outside } = setup();
        quickAdd.open();
        quickAdd.setHidden(true);
        press(outside);
        outside.focus();
        escape();
        expect(quickAdd.isOpen).toBe(true);
    });
});

describe('saving from quick add', () => {
    it('saves with Enter after focus has left the field', async () => {
        const submit = jest.fn(() => Promise.resolve(true));
        const { quickAdd, container, outside } = setup(submit);
        quickAdd.open();
        type(container, 'Call the dentist');
        outside.focus();
        enter();
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] Call the dentist'], { path: 'Inbox.md' });
    });

    it('puts typing back into the field after focus has left it', () => {
        const { quickAdd, container, outside } = setup();
        quickAdd.open();
        outside.focus();
        outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
        expect(document.activeElement).toBe(container.querySelector('.sh-quickadd-input'));
    });

    it('still saves after a save that failed', async () => {
        const submit = jest.fn()
            .mockImplementationOnce(() => Promise.reject(new Error('disk full')))
            .mockImplementation(() => Promise.resolve(true));
        const { quickAdd, container } = setup(submit);
        quickAdd.open();
        type(container, 'Call the dentist');
        enter();
        await settle();
        enter();
        await settle();
        expect(submit).toHaveBeenCalledTimes(2);
    });
});

describe('where quick add writes', () => {
    it('takes the note of the list it opens on, after an earlier add went elsewhere', async () => {
        let place = 'Inbox.md';
        const submit = jest.fn(() => Promise.resolve(true));
        const { quickAdd, container } = setup(submit, { defaultDestination: () => ({ path: place }) });
        quickAdd.open();
        type(container, 'First');
        enter();
        await settle();
        place = 'Projects/Kitchen.md';
        quickAdd.open();
        type(container, 'Second');
        enter();
        await settle();
        expect(submit).toHaveBeenLastCalledWith(['- [ ] Second'], { path: 'Projects/Kitchen.md' });
    });

    it('keeps the note a half-written task was headed for', async () => {
        let place = 'Inbox.md';
        const submit = jest.fn(() => Promise.resolve(true));
        const { quickAdd, container } = setup(submit, { defaultDestination: () => ({ path: place }) });
        quickAdd.open();
        type(container, 'Half written');
        escape();
        place = 'Projects/Kitchen.md';
        quickAdd.open();
        enter();
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] Half written'], { path: 'Inbox.md' });
    });
});

describe('quick add from the keyboard', () => {
    it('lets Enter on a chip open the chip instead of saving', async () => {
        const submit = jest.fn(() => Promise.resolve(true));
        const { quickAdd, container } = setup(submit);
        quickAdd.open();
        type(container, 'Call the dentist');
        const note = chips(container)[2];
        note.focus();
        const event = keydown(note, 'Enter');
        await settle();
        expect(submit).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('keeps Tab inside the panel', () => {
        const { quickAdd, container } = setup();
        quickAdd.open();
        const [date, , note] = chips(container);
        keydown(field(container), 'Tab');
        expect(document.activeElement).toBe(date);
        keydown(date, 'Tab');
        keydown(document.activeElement as Element, 'Tab');
        expect(document.activeElement).toBe(note);
        keydown(note, 'Tab');
        expect(document.activeElement).toBe(field(container));
        keydown(field(container), 'Tab', { shiftKey: true });
        expect(document.activeElement).toBe(note);
    });

    it('opens the note picker for a slash at the start of a word', () => {
        const chooseDestination = jest.fn();
        const { quickAdd, container } = setup(undefined, { chooseDestination });
        quickAdd.open();
        type(container, 'Email the contractor ');
        const input = field(container);
        input.setSelectionRange(input.value.length, input.value.length);
        const event = keydown(input, '/');
        expect(chooseDestination).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('leaves a slash inside a word alone', () => {
        const chooseDestination = jest.fn();
        const { quickAdd, container } = setup(undefined, { chooseDestination });
        quickAdd.open();
        type(container, 'Due 10');
        const input = field(container);
        input.setSelectionRange(input.value.length, input.value.length);
        keydown(input, '/');
        expect(chooseDestination).not.toHaveBeenCalled();
    });
});
