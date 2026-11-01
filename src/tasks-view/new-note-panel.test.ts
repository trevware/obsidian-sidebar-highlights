const mockPlatform = { isMobile: false };
jest.mock('obsidian', () => ({ setIcon: () => undefined, moment: { locale: () => 'en' }, Platform: mockPlatform }), { virtual: true });

import { NewNotePanel } from './new-note-panel';
import type { NewNoteHost } from './new-note-panel';
import { i18n } from '../i18n';

beforeAll(() => i18n.init());

// Obsidian's element helpers, as far as the panel uses them.
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
proto.hasClass = function (this: HTMLElement, cls: string) { return this.classList.contains(cls); };
proto.setAttr = function (this: HTMLElement, name: string, value: string) { this.setAttribute(name, value); };
proto.empty = function (this: HTMLElement) { this.replaceChildren(); };

function setup(overrides: Partial<NewNoteHost> = {}) {
    document.body.replaceChildren();
    const container = document.body.createDiv({ cls: 'sh-tasks-view' });
    const calls = { submitted: [] as string[], opened: [] as Array<[string, boolean]>, closes: 0, picker: null as null | ((folder: string) => void) };
    const host: NewNoteHost = {
        defaultFolder: () => '',
        chooseFolder: (done) => { calls.picker = done; },
        existing: () => null,
        submit: (path) => { calls.submitted.push(path); return Promise.resolve(path); },
        onClose: () => { calls.closes++; },
        opened: (path, created) => { calls.opened.push([path, created]); },
        ...overrides
    };
    const panel = new NewNotePanel(container, host);
    return { panel, container, calls };
}

const input = (container: HTMLElement) => container.querySelector('.sh-quickadd-input') as HTMLInputElement;
const type = (container: HTMLElement, text: string) => {
    input(container).value = text;
    input(container).dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    return event;
};
const chip = (container: HTMLElement) => container.querySelector('button.sh-chip') as HTMLElement;
const preview = (container: HTMLElement) => container.querySelector('.sh-quickadd-preview')?.textContent;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('new note panel', () => {
    it('opens on no folder, with the cursor in the name field', () => {
        const { panel, container } = setup();
        panel.open();
        expect(chip(container).textContent).toContain('No folder');
        expect(chip(container).classList.contains('is-set')).toBe(false);
        expect(document.activeElement).toBe(input(container));
    });

    it('makes the note at the top of the vault on Enter, then hands it over once closed', async () => {
        const { panel, container, calls } = setup();
        panel.open();
        type(container, 'Kitchen: reno');
        expect(preview(container)).toBe('Kitchen reno.md');
        key('Enter');
        await settle();
        expect(calls.submitted).toEqual(['Kitchen reno.md']);
        expect(panel.isOpen).toBe(false);
        expect(calls.opened).toEqual([['Kitchen reno.md', true]]);
    });

    it('puts the note in the folder picked on the chip, and × takes the folder off', async () => {
        const { panel, container, calls } = setup();
        panel.open();
        type(container, 'Garden');
        chip(container).click();
        calls.picker!('Projects/Home');
        expect(chip(container).textContent).toContain('Home');
        expect(chip(container).classList.contains('is-set')).toBe(true);
        expect(preview(container)).toBe('Projects/Home/Garden.md');

        (container.querySelector('.sh-chip-clear') as HTMLElement).click();
        expect(chip(container).textContent).toContain('No folder');

        chip(container).click();
        calls.picker!('Projects');
        key('Enter');
        await settle();
        expect(calls.submitted).toEqual(['Projects/Garden.md']);
    });

    it('opens the folder picker on a slash, which a note name cannot hold anyway', () => {
        const { panel, calls } = setup();
        panel.open();
        const event = key('/');
        expect(event.defaultPrevented).toBe(true);
        expect(calls.picker).not.toBeNull();
    });

    it('goes to a note that already has the name instead of making another', async () => {
        const { panel, container, calls } = setup({ existing: (path) => (path.toLowerCase() === 'inbox.md' ? 'Inbox.md' : null) });
        panel.open();
        type(container, 'inbox');
        expect(preview(container)).toBe('Inbox.mdalready exists, ↵ opens it');
        key('Enter');
        await settle();
        expect(calls.submitted).toEqual([]);
        expect(calls.opened).toEqual([['Inbox.md', false]]);
    });

    it('does nothing on Enter with no name, and Escape closes without making anything', async () => {
        const { panel, calls } = setup();
        panel.open();
        key('Enter');
        await settle();
        expect(panel.isOpen).toBe(true);
        key('Escape');
        expect(panel.isOpen).toBe(false);
        expect(calls.submitted).toEqual([]);
        expect(calls.opened).toEqual([]);
        expect(calls.closes).toBe(1);
    });

    it('stays open with the name when the note could not be made', async () => {
        const { panel, container, calls } = setup({ submit: () => Promise.resolve(null) });
        panel.open();
        type(container, 'Taken');
        key('Enter');
        await settle();
        expect(panel.isOpen).toBe(true);
        expect(input(container).value).toBe('Taken');
        expect(calls.opened).toEqual([]);
    });
});
