import { ICON_CATEGORIES, iconSections, lucideIds } from './icon-sets';

describe('lucideIds', () => {
    it('drops the lucide- prefix, keeps only Lucide icons, and lists each once', () => {
        expect(lucideIds(['lucide-plane', 'lucide-car', 'plane', 'obsidian-logo', 'lucide-plane'])).toEqual(['car', 'plane']);
    });
});

describe('iconSections', () => {
    const available = ['plane', 'car', 'wallet', 'shopping-cart', 'credit-card', 'star', 'bookmark', 'square-pen'];

    it('shows the categories when nothing is typed, leaving out icons this Obsidian lacks', () => {
        const sections = iconSections('', available);
        const travel = sections.find(section => section.title === 'Travel');
        expect(travel?.icons).toEqual(expect.arrayContaining(['plane', 'car']));
        expect(travel?.icons.every(icon => available.includes(icon))).toBe(true);
        expect(sections.every(section => section.icons.length > 0)).toBe(true);
        expect(sections.map(section => section.title)).toEqual(ICON_CATEGORIES.map(c => c.name).filter(name => sections.some(s => s.title === name)));
    });

    it('searches every icon by name, best match first', () => {
        const [results] = iconSections('cart', available);
        expect(results.title).toBe('');
        expect(results.icons[0]).toBe('shopping-cart');
    });

    it('finds icons by their category too', () => {
        const [results] = iconSections('money', available);
        expect(results.icons).toEqual(expect.arrayContaining(['wallet', 'credit-card']));
    });

    it('caps a long list of matches', () => {
        const many = Array.from({ length: 300 }, (_, i) => `arrow-${i}`);
        expect(iconSections('arrow', many, 50)[0].icons).toHaveLength(50);
    });

    it('shows nothing when no icon matches', () => {
        expect(iconSections('zzzz', available)).toEqual([]);
    });
});
