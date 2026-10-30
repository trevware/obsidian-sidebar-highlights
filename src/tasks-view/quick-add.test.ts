const mockPlatform = { isMobile: false };
jest.mock('obsidian', () => ({ setIcon: () => undefined, moment: { locale: () => 'en' }, Platform: mockPlatform }), { virtual: true });

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
proto.setAttr = function (this: HTMLElement, name: string, value: string) { this.setAttribute(name, value); };
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
        defaultDate: () => undefined,
        formatTime: (time) => time,
        timeLabel: (time) => time,
        chooseDestination: () => undefined,
        submit,
        capitalize: () => false,
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

    it('writes the task in Title Case when Capitalize tasks is on, and tells the keyboard to', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { quickAdd, container } = setup(submit, { capitalize: () => true });
        quickAdd.open();
        expect(field(container).getAttribute('autocapitalize')).toBe('words');
        type(container, 'call the dentist about the bill fri');
        expect(field(container).value).toBe('Call the Dentist About the Bill Fri');
        expect(container.querySelector('.sh-quickadd-preview code')?.textContent).toMatch(/^- \[ \] Call the Dentist About the Bill /);
        enter();
        await settle();
        expect(submit.mock.calls[0][0][0]).toMatch(/^- \[ \] Call the Dentist About the Bill \d{4}-\d{2}-\d{2}$/);
    });

    it('capitalizes each word in the field as its first letter is typed, and a small word once it\'s finished', () => {
        const { quickAdd, container } = setup(undefined, { capitalize: () => true });
        quickAdd.open();
        type(container, 'c');
        expect(field(container).value).toBe('C');
        expect(field(container).selectionStart).toBe(1);
        type(container, 'Call m');
        expect(field(container).value).toBe('Call M');
        type(container, 'Call Mom t');
        expect(field(container).value).toBe('Call Mom T');
        type(container, 'Call Mom To');
        expect(field(container).value).toBe('Call Mom To');
        type(container, 'Call Mom To ');
        expect(field(container).value).toBe('Call Mom to ');
    });

    it('gives the capital back when the word turns out to be an iPhone or a web address', () => {
        const { quickAdd, container } = setup(undefined, { capitalize: () => true });
        quickAdd.open();
        type(container, 'i');
        expect(field(container).value).toBe('I');
        type(container, 'IP');
        expect(field(container).value).toBe('iP');
        type(container, 'iPhone backup');
        expect(field(container).value).toBe('iPhone Backup');

        type(container, '');
        type(container, 'h');
        expect(field(container).value).toBe('H');
        type(container, 'Https://');
        expect(field(container).value).toBe('https://');
    });

    it('writes the task as typed when Capitalize tasks is off', async () => {
        const submit = jest.fn(() => Promise.resolve(true));
        const { quickAdd, container } = setup(submit);
        quickAdd.open();
        expect(field(container).hasAttribute('autocapitalize')).toBe(false);
        type(container, 'call the dentist');
        enter();
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] call the dentist'], { path: 'Inbox.md' });
    });
});

describe('the day a task starts on', () => {
    it('writes a typed time on today, or on the day quick add already has', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { quickAdd, container } = setup(submit);
        quickAdd.open();
        type(container, 'Call mom 3pm');
        expect(chips(container)[0].textContent).toBe('2026-10-25 15:00');
        enter();
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] Call mom 2026-10-25 15:00'], { path: 'Inbox.md' });

        quickAdd.open({ date: '2026-10-30' });
        type(container, 'Dentist 9am');
        enter();
        await settle();
        expect(submit).toHaveBeenLastCalledWith(['- [ ] Dentist 2026-10-30 09:00'], { path: 'Inbox.md' });
    });

    it('clears the date and the time with the date chip\'s ×', () => {
        const { quickAdd, container } = setup();
        quickAdd.open();
        type(container, 'Call mom fri 3pm');
        (chips(container)[0].querySelector('.sh-chip-clear') as HTMLElement).click();
        expect(container.querySelector('.sh-quickadd-preview code')?.textContent).toBe('- [ ] Call mom fri 3pm');
    });

    it('never adds a time from the list\'s day', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { quickAdd, container } = setup(submit, { defaultDate: () => '2026-10-25' });
        quickAdd.open();
        type(container, 'Call mom');
        enter();
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] Call mom 2026-10-25'], { path: 'Inbox.md' });
    });

    it('starts on the list\'s day, so a task added in Today is due today', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { quickAdd, container } = setup(submit, { defaultDate: () => '2026-10-25' });
        quickAdd.open();
        expect(chips(container)[0].textContent).toBe('2026-10-25');
        expect(chips(container)[0].classList.contains('is-set')).toBe(true);
        type(container, 'Call the dentist');
        enter();
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] Call the dentist 2026-10-25'], { path: 'Inbox.md' });
    });

    it('lets a typed day win over the list\'s', async () => {
        const submit = jest.fn((_lines: string[]) => Promise.resolve(true));
        const { quickAdd, container } = setup(submit, { defaultDate: () => '2026-10-25' });
        quickAdd.open();
        type(container, 'Call the dentist tomorrow');
        enter();
        await settle();
        expect(submit).toHaveBeenCalledWith(['- [ ] Call the dentist 2026-10-26'], { path: 'Inbox.md' });
    });

    it('keeps a draft with words in it as it was left', () => {
        let today: string | undefined;
        const { quickAdd, container } = setup(undefined, { defaultDate: () => today });
        quickAdd.open();
        type(container, 'Call the dentist');
        escape();
        today = '2026-10-25';
        quickAdd.open();
        expect(chips(container)[0].classList.contains('is-set')).toBe(false);
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

describe('quick add on a phone', () => {
    beforeEach(() => { mockPlatform.isMobile = true; });
    afterEach(() => { mockPlatform.isMobile = false; });

    it('offers Cancel and Add in place of keyboard hints', () => {
        const { quickAdd, container } = setup();
        quickAdd.open();
        const buttons = [...container.querySelectorAll('.sh-palette-foot button')].map(b => b.textContent);
        expect(buttons).toEqual(['tasksTab.quickAdd.cancelButton', 'tasksTab.quickAdd.addButton']);
        expect(container.querySelector('.sh-palette-foot .sh-key')).toBeNull();
    });

    it('saves the task when Add is tapped', async () => {
        const submit = jest.fn(() => Promise.resolve(true));
        const { quickAdd, container } = setup(submit);
        quickAdd.open();
        type(container, 'Call the dentist');
        (container.querySelectorAll<HTMLButtonElement>('.sh-palette-foot button')[1]).click();
        await settle();
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it('puts itself away when Cancel is tapped', () => {
        const { quickAdd, container } = setup();
        quickAdd.open();
        (container.querySelectorAll<HTMLButtonElement>('.sh-palette-foot button')[0]).click();
        expect(quickAdd.isOpen).toBe(false);
    });
});
