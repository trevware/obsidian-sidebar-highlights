import { jsonCreateLink, updateLink, whenParam } from './links';

/** A link's parameters as Things decodes them. */
const params = (link: string): URLSearchParams => new URL(link).searchParams;

/** Text that breaks Markdown, URLs or a line: a tag, an ampersand, a percent, a link, a newline, an emoji. */
const NASTY = 'Read [[Q3 plan|plan]] #work & 100% 🎯\nthen a=b?c';

describe('updateLink', () => {
    it('percent-encodes every value and keeps Things in the background', () => {
        expect(updateLink('ABCD1234', { title: 'Fix #1 & 50%\nthen ship' }, 'tok/en+1'))
            .toBe('things:///update?id=ABCD1234&auth-token=tok%2Fen%2B1&title=Fix%20%231%20%26%2050%25%0Athen%20ship&reveal=false');
    });

    it('brings text that breaks Markdown or URLs through unchanged', () => {
        const link = updateLink('ABCD1234', { title: NASTY, notes: NASTY }, 'tok');
        expect(link).not.toMatch(/[\s#]/);
        expect(link.split('&')).toHaveLength(5);
        expect(params(link).get('title')).toBe(NASTY);
        expect(params(link).get('notes')).toBe(NASTY);
    });

    it('never lets a parameter replace the id, the token or reveal=false', () => {
        const link = updateLink('ABCD1234', { id: 'OTHER123', 'auth-token': 'x', reveal: 'true', when: 'anytime' }, 'tok');
        expect(params(link).getAll('id')).toEqual(['ABCD1234']);
        expect(params(link).getAll('auth-token')).toEqual(['tok']);
        expect(params(link).getAll('reveal')).toEqual(['false']);
        expect(params(link).get('when')).toBe('anytime');
    });

    it('sends an empty value, which clears that field in Things', () => {
        expect(updateLink('ABCD1234', { 'checklist-items': '' }, 'tok')).toContain('&checklist-items=&');
    });
});

describe('jsonCreateLink', () => {
    const items = [{ type: 'project', attributes: { title: NASTY, items: [{ type: 'heading', attributes: { title: 'Next\nweek' } }] } }];

    it('carries the items as encoded JSON, with the token when given', () => {
        const link = jsonCreateLink(items, 'tok');
        expect(link.startsWith('things:///json?')).toBe(true);
        expect(link).not.toMatch(/[\s#"{}[\]]/);
        expect(JSON.parse(params(link).get('data') ?? '')).toEqual(items);
        expect(params(link).get('auth-token')).toBe('tok');
        expect(params(link).get('reveal')).toBe('false');
    });

    it('leaves the token out when there is none', () => {
        expect(params(jsonCreateLink(items)).has('auth-token')).toBe(false);
    });
});

describe('whenParam', () => {
    it('sends Someday as someday, even with a date', () => {
        expect(whenParam({ someday: true })).toBe('someday');
        expect(whenParam({ someday: true, when: '2026-11-23', reminder: '15:00' })).toBe('someday');
    });

    it('sends no date as anytime', () => {
        expect(whenParam({ someday: false })).toBe('anytime');
    });

    it('sends a date alone, or with its reminder so a date change keeps the reminder', () => {
        expect(whenParam({ someday: false, when: '2026-11-23' })).toBe('2026-11-23');
        expect(whenParam({ someday: false, when: '2026-11-23', reminder: '09:05' })).toBe('2026-11-23@09:05');
    });

    it('ignores a reminder with no date, which Things has no day for', () => {
        expect(whenParam({ someday: false, reminder: '09:05' })).toBe('anytime');
    });
});
