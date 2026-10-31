/**
 * The icons a note can wear in the Tasks tab: a hand-picked set in
 * categories to browse, and every Lucide icon Obsidian ships to search.
 * Obsidian's copy of Lucide carries no categories, so these are ours; an icon
 * a given Obsidian version lacks is simply left out.
 */

import { rank } from './fuzzy';

export interface IconSection {
    /** The category, or '' for search results. */
    title: string;
    icons: string[];
}

export const ICON_CATEGORIES: ReadonlyArray<{ name: string; icons: readonly string[] }> = [
    {
        name: 'Work',
        icons: ['briefcase', 'building-2', 'presentation', 'clipboard-list', 'kanban', 'list-todo', 'calendar', 'calendar-days', 'mail', 'inbox', 'folder', 'file-text', 'notebook', 'target', 'rocket', 'trophy', 'handshake', 'users', 'megaphone', 'chart-line', 'timer', 'flag']
    },
    {
        name: 'Home',
        icons: ['house', 'bed', 'sofa', 'lamp', 'key', 'wrench', 'hammer', 'paint-roller', 'bath', 'washing-machine', 'utensils', 'cooking-pot', 'refrigerator', 'sprout', 'flower-2', 'dog', 'cat', 'baby', 'trash-2', 'package']
    },
    {
        name: 'Money',
        icons: ['wallet', 'credit-card', 'banknote', 'piggy-bank', 'coins', 'receipt', 'landmark', 'chart-pie', 'trending-up', 'calculator', 'shopping-cart', 'shopping-bag', 'store', 'tag', 'gift', 'badge-dollar-sign']
    },
    {
        name: 'Health',
        icons: ['heart', 'heart-pulse', 'activity', 'dumbbell', 'bike', 'footprints', 'apple', 'salad', 'pill', 'stethoscope', 'brain', 'bed-double', 'smile', 'droplet', 'scale', 'syringe']
    },
    {
        name: 'Travel',
        icons: ['plane', 'car', 'train-front', 'bus', 'ship', 'map', 'map-pin', 'compass', 'globe', 'luggage', 'tent', 'mountain', 'tree-palm', 'camera', 'ticket', 'hotel', 'fuel', 'route']
    },
    {
        name: 'Learning',
        icons: ['book', 'book-open', 'graduation-cap', 'library', 'pencil', 'notebook-pen', 'lightbulb', 'school', 'languages', 'microscope', 'flask-conical', 'atom', 'puzzle', 'glasses', 'brain-circuit', 'sigma']
    },
    {
        name: 'Creative',
        icons: ['palette', 'brush', 'pen-tool', 'music', 'guitar', 'mic', 'headphones', 'film', 'clapperboard', 'image', 'aperture', 'feather', 'scissors', 'shapes', 'sparkles', 'wand-sparkles']
    },
    {
        name: 'Tech',
        icons: ['code', 'terminal', 'laptop', 'monitor', 'smartphone', 'tablet', 'server', 'database', 'cpu', 'wifi', 'cloud', 'git-branch', 'bug', 'settings', 'keyboard', 'bot']
    },
    {
        name: 'People',
        icons: ['user', 'user-round', 'users-round', 'contact', 'message-circle', 'phone', 'party-popper', 'cake', 'coffee', 'beer', 'wine', 'pizza', 'gamepad-2', 'dice-5', 'drama', 'church']
    },
    {
        name: 'Nature',
        icons: ['sun', 'moon', 'cloud-sun', 'cloud-rain', 'snowflake', 'umbrella', 'rainbow', 'leaf', 'tree-pine', 'trees', 'flower', 'sunrise', 'wind', 'waves', 'flame', 'bird']
    },
    {
        name: 'Symbols',
        icons: ['star', 'bookmark', 'bell', 'zap', 'circle', 'square', 'triangle', 'hexagon', 'diamond', 'infinity', 'hash', 'at-sign', 'circle-check', 'circle-alert', 'circle-help', 'lock', 'shield', 'crown', 'gem', 'anchor']
    }
];

/** Obsidian's icon IDs as Lucide names: the lucide- prefix dropped, other icons left out, each once. */
export function lucideIds(ids: readonly string[]): string[] {
    const names = new Set<string>();
    for (const id of ids) if (id.startsWith('lucide-')) names.add(id.slice('lucide-'.length));
    return [...names].sort();
}

/**
 * What the picker shows. With nothing typed, the categories, each without
 * the icons this Obsidian lacks. With a query, every available icon whose
 * name or category matches, best first, up to `limit`.
 */
export function iconSections(query: string, available: readonly string[], limit = 120): IconSection[] {
    const have = new Set(available);
    if (query.trim() === '') {
        return ICON_CATEGORIES
            .map(category => ({ title: category.name, icons: category.icons.filter(icon => have.has(icon)) }))
            .filter(section => section.icons.length > 0);
    }
    const categoryOf = new Map<string, string>();
    for (const category of ICON_CATEGORIES) for (const icon of category.icons) categoryOf.set(icon, category.name);
    const hits = rank(query.trim(), available, icon => ({ primary: icon.replace(/-/g, ' '), secondary: categoryOf.get(icon)?.toLowerCase() }));
    if (hits.length === 0) return [];
    return [{ title: '', icons: hits.slice(0, limit).map(hit => hit.item) }];
}
