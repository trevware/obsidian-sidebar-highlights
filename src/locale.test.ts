const mockLocale = { value: 'en' };
jest.mock('obsidian', () => ({ moment: { locale: () => mockLocale.value } }), { virtual: true });

import en from '../locale/en.json';
import zhCn from '../locale/zh-cn.json';
import { i18n } from './i18n';
import { ICON_CATEGORIES } from './tasks-view/icon-sets';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') out.set(path, value);
        else for (const [inner, text] of flatten(value, path)) out.set(inner, text);
    }
    return out;
}

const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

describe('the Chinese translation', () => {
    const english = flatten(en as Tree);
    const chinese = flatten(zhCn as Tree);

    it('has every string the English one has, and nothing else', () => {
        expect([...english.keys()].filter(key => !chinese.has(key))).toEqual([]);
        expect([...chinese.keys()].filter(key => !english.has(key))).toEqual([]);
    });

    it('keeps the same {{placeholders}} in every string', () => {
        const mismatched = [...english].filter(([key, text]) => placeholders(text).join() !== placeholders(chinese.get(key) ?? '').join());
        expect(mismatched.map(([key]) => key)).toEqual([]);
    });

    it('names every section of the icon picker', () => {
        const missing = ICON_CATEGORIES.map(category => `tasksTab.iconPicker.sections.${category.name.toLowerCase()}`).filter(key => !english.has(key) || !chinese.has(key));
        expect(missing).toEqual([]);
    });

    it('translates the Tasks tab', () => {
        const tasks = [...chinese].filter(([key]) => key.startsWith('tasksTab.'));
        const untranslated = tasks.filter(([key, text]) => /[A-Za-z]{4,}/.test(text.replace(/\{\{\w+\}\}|Markdown|Esc|in \d days|nov \d|fri|dddd|MMMM/g, '')) && text === english.get(key));
        expect(untranslated.map(([key]) => key)).toEqual([]);
    });
});

describe('the language dates are written in', () => {
    it('leaves English dates to the system', async () => {
        mockLocale.value = 'en';
        await i18n.init();
        expect(i18n.dateLocale()).toBeUndefined();
    });

    it('writes dates in Chinese when Obsidian is in Chinese', async () => {
        mockLocale.value = 'zh-cn';
        await i18n.init();
        expect(i18n.dateLocale()).toBe('zh-cn');
        expect(i18n.t('tasksTab.lists.today')).toBe('今天');
        mockLocale.value = 'en';
        await i18n.init();
    });
});
