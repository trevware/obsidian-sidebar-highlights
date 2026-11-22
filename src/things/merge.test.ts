import { differences, mergeFields } from './merge';
import type { Capabilities, TodoFields } from './model';

const caps: Capabilities = { headings: true, checklist: true, reminder: true, repeating: true, reorder: false };

function fields(over: Partial<TodoFields> = {}): TodoFields {
    return { title: 'Call Mom', notes: '', checklist: [], tags: [], status: 'open', someday: false, when: '2026-11-22', ...over };
}

describe('mergeFields', () => {
    it('sends a field only the note changed to Things', () => {
        const result = mergeFields(fields({ title: 'Call Dad' }), fields(), fields(), caps);
        expect(result.toThings).toEqual({ title: 'Call Dad' });
        expect(result.toVault).toEqual({});
        expect(result.merged.title).toBe('Call Dad');
    });

    it('brings a field only Things changed back to the note', () => {
        const result = mergeFields(fields(), fields({ status: 'completed' }), fields(), caps);
        expect(result.toThings).toEqual({});
        expect(result.toVault).toEqual({ status: 'completed' });
        expect(result.merged.status).toBe('completed');
    });

    it('lets the note win when both changed the same field', () => {
        const result = mergeFields(fields({ when: '2026-11-24' }), fields({ when: '2026-11-25' }), fields(), caps);
        expect(result.toThings).toEqual({ when: '2026-11-24' });
        expect(result.toVault).toEqual({});
        expect(result.merged.when).toBe('2026-11-24');
    });

    it('merges each field on its own', () => {
        const result = mergeFields(fields({ title: 'Call Dad' }), fields({ tags: ['Errands'] }), fields(), caps);
        expect(result.toThings).toEqual({ title: 'Call Dad' });
        expect(result.toVault).toEqual({ tags: ['Errands'] });
        expect(result.merged).toEqual(fields({ title: 'Call Dad', tags: ['Errands'] }));
    });

    it('sends nothing when both sides made the same change', () => {
        const result = mergeFields(fields({ title: 'Call Dad' }), fields({ title: 'Call Dad' }), fields(), caps);
        expect(result.toThings).toEqual({});
        expect(result.toVault).toEqual({});
        expect(result.merged.title).toBe('Call Dad');
    });

    it('sends a cleared date as a present key with no value', () => {
        const result = mergeFields(fields({ when: undefined }), fields(), fields(), caps);
        expect('when' in result.toThings).toBe(true);
        expect(result.toThings.when).toBeUndefined();
        expect('when' in result.merged).toBe(false);
    });

    it('compares checklists item by item', () => {
        const ticked = fields({ checklist: [{ title: 'Milk', done: true }] });
        const written = fields({ checklist: [{ title: 'Milk', done: false }] });
        expect(mergeFields(written, ticked, written, caps).toVault).toEqual({ checklist: [{ title: 'Milk', done: true }] });
        expect(mergeFields(written, { ...written, checklist: [{ done: false, title: 'Milk' }] }, written, caps).toVault).toEqual({});
    });

    it('ignores a checklist change on the Things side when Things cannot show checklists', () => {
        const written = fields({ checklist: [{ title: 'Milk', done: false }] });
        const result = mergeFields(written, fields({ checklist: [] }), written, { ...caps, checklist: false });
        expect(result.toVault).toEqual({});
        expect(result.toThings).toEqual({});
        expect(result.merged.checklist).toEqual([{ title: 'Milk', done: false }]);
    });

    it('still sends a checklist the note changed when Things cannot show checklists', () => {
        const result = mergeFields(fields({ checklist: [{ title: 'Eggs', done: false }] }), fields(), fields(), { ...caps, checklist: false });
        expect(result.toThings).toEqual({ checklist: [{ title: 'Eggs', done: false }] });
    });

    it('ignores a reminder change on the Things side when Things cannot show reminders', () => {
        const written = fields({ reminder: '15:00' });
        const result = mergeFields(written, fields(), written, { ...caps, reminder: false });
        expect(result.toVault).toEqual({});
        expect(result.merged.reminder).toBe('15:00');
    });
});

describe('differences', () => {
    it('lists the fields that differ with the target\'s values, a cleared date as a present key, and lists compared by item', () => {
        const ticked = [{ title: 'Flowers', done: true }];
        const result = differences(fields({ checklist: ticked, tags: ['home'] }), fields({ checklist: [{ title: 'Flowers', done: true }], tags: ['work'], when: undefined }));
        expect(result).toEqual({ tags: ['work'] });
        expect('when' in result).toBe(true);
        expect(differences(fields(), fields())).toEqual({});
    });
});
