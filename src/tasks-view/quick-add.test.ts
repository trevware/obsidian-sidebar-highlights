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

function setup() {
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
        submit: () => Promise.resolve(true),
        onClose: () => { closed++; }
    };
    const quickAdd = new QuickAdd(container, host);
    return { quickAdd, container, outside, closes: () => closed };
}

const escape = () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
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
