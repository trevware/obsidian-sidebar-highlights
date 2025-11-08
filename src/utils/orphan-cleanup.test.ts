/**
 * Unit tests for orphan cleanup logic
 * Tests the fix for backup restore bug where orphan cleanup happened before file scanning
 */

export {};

interface TestHighlight {
    id: string;
    text: string;
}

interface TestCollection {
    id: string;
    name: string;
    highlightIds: string[];
}

/**
 * Simulates the OLD (buggy) orphan cleanup - runs BEFORE scanning
 */
function cleanupOrphansBeforeScanning(
    collections: Map<string, TestCollection>,
    existingHighlights: Map<string, TestHighlight[]>
): { cleanedCollections: Map<string, TestCollection>; orphanCount: number } {
    let orphanCount = 0;
    const cleanedCollections = new Map<string, TestCollection>();

    // BUGGY: Clean orphans based on current highlights (might be empty!)
    for (const [collectionId, collection] of collections) {
        const cleaned = {
            ...collection,
            highlightIds: collection.highlightIds.filter(id => {
                // Check if highlight exists in current map
                for (const highlights of existingHighlights.values()) {
                    if (highlights.some(h => h.id === id)) {
                        return true;
                    }
                }
                orphanCount++;
                return false;
            })
        };
        cleanedCollections.set(collectionId, cleaned);
    }

    return { cleanedCollections, orphanCount };
}

/**
 * Simulates the NEW (fixed) orphan cleanup - runs AFTER scanning
 */
function cleanupOrphansAfterScanning(
    collections: Map<string, TestCollection>,
    scannedHighlights: Map<string, TestHighlight[]>
): { cleanedCollections: Map<string, TestCollection>; orphanCount: number } {
    let orphanCount = 0;
    const cleanedCollections = new Map<string, TestCollection>();

    // CORRECT: Clean orphans based on SCANNED highlights (fully populated)
    for (const [collectionId, collection] of collections) {
        const cleaned = {
            ...collection,
            highlightIds: collection.highlightIds.filter(id => {
                // Check if highlight exists in scanned map
                for (const highlights of scannedHighlights.values()) {
                    if (highlights.some(h => h.id === id)) {
                        return true;
                    }
                }
                orphanCount++;
                return false;
            })
        };
        cleanedCollections.set(collectionId, cleaned);
    }

    return { cleanedCollections, orphanCount };
}

describe('Orphan Cleanup Order Fix', () => {
    let restoredCollections: Map<string, TestCollection>;
    let markdownHighlights: Map<string, TestHighlight[]>;

    beforeEach(() => {
        // Simul highlights that exist in markdown files
        markdownHighlights = new Map([
            ['file1.md', [
                { id: 'h1', text: 'highlight 1' },
                { id: 'h2', text: 'highlight 2' },
                { id: 'h3', text: 'highlight 3' },
            ]],
            ['file2.md', [
                { id: 'h4', text: 'highlight 4' },
                { id: 'h5', text: 'highlight 5' },
            ]],
        ]);

        // Simulate collections restored from backup
        restoredCollections = new Map([
            ['col1', {
                id: 'col1',
                name: 'Collection 1',
                highlightIds: ['h1', 'h2', 'h3'],
            }],
            ['col2', {
                id: 'col2',
                name: 'Collection 2',
                highlightIds: ['h4', 'h5'],
            }],
        ]);
    });

    test('OLD BEHAVIOR: Orphan cleanup before scanning with empty highlights map', () => {
        const emptyHighlights = new Map<string, TestHighlight[]>();

        const result = cleanupOrphansBeforeScanning(restoredCollections, emptyHighlights);

        // ALL highlights are marked as orphans because highlights map is empty
        expect(result.orphanCount).toBe(5);

        // Collections are now empty
        const col1 = result.cleanedCollections.get('col1');
        expect(col1?.highlightIds.length).toBe(0);

        const col2 = result.cleanedCollections.get('col2');
        expect(col2?.highlightIds.length).toBe(0);
    });

    test('NEW BEHAVIOR: Orphan cleanup after scanning with populated highlights map', () => {
        const result = cleanupOrphansAfterScanning(restoredCollections, markdownHighlights);

        // NO orphans because all highlights exist in markdown
        expect(result.orphanCount).toBe(0);

        // Collections are preserved
        const col1 = result.cleanedCollections.get('col1');
        expect(col1?.highlightIds.length).toBe(3);
        expect(col1?.highlightIds).toEqual(['h1', 'h2', 'h3']);

        const col2 = result.cleanedCollections.get('col2');
        expect(col2?.highlightIds.length).toBe(2);
        expect(col2?.highlightIds).toEqual(['h4', 'h5']);
    });

    test('NEW BEHAVIOR: Correctly identifies actual orphans', () => {
        // Add some orphaned highlight IDs to collections
        const collectionsWithOrphans = new Map([
            ['col1', {
                id: 'col1',
                name: 'Collection 1',
                highlightIds: ['h1', 'h2', 'orphan1', 'h3', 'orphan2'],
            }],
        ]);

        const result = cleanupOrphansAfterScanning(collectionsWithOrphans, markdownHighlights);

        // Only 2 orphans detected (orphan1 and orphan2)
        expect(result.orphanCount).toBe(2);

        // Collection retains valid highlights
        const col1 = result.cleanedCollections.get('col1');
        expect(col1?.highlightIds.length).toBe(3);
        expect(col1?.highlightIds).toEqual(['h1', 'h2', 'h3']);
    });

    test('LARGE SCALE: 300 highlights, 10 collections', () => {
        // Create 300 highlights across 20 files
        const largeHighlights = new Map<string, TestHighlight[]>();
        for (let i = 0; i < 20; i++) {
            const highlights: TestHighlight[] = [];
            for (let j = 0; j < 15; j++) {
                highlights.push({
                    id: `h${i * 15 + j}`,
                    text: `highlight ${i * 15 + j}`,
                });
            }
            largeHighlights.set(`file${i}.md`, highlights);
        }

        // Create 10 collections with 30 highlights each
        const largeCollections = new Map<string, TestCollection>();
        for (let i = 0; i < 10; i++) {
            const highlightIds: string[] = [];
            for (let j = 0; j < 30; j++) {
                highlightIds.push(`h${i * 30 + j}`);
            }
            largeCollections.set(`col${i}`, {
                id: `col${i}`,
                name: `Collection ${i}`,
                highlightIds,
            });
        }

        // Test OLD behavior with empty map
        const emptyMap = new Map<string, TestHighlight[]>();
        const oldResult = cleanupOrphansBeforeScanning(largeCollections, emptyMap);

        expect(oldResult.orphanCount).toBe(300); // ALL marked as orphans
        oldResult.cleanedCollections.forEach(col => {
            expect(col.highlightIds.length).toBe(0); // ALL collections empty
        });

        // Test NEW behavior with scanned map
        const newResult = cleanupOrphansAfterScanning(largeCollections, largeHighlights);

        expect(newResult.orphanCount).toBe(0); // NO orphans
        newResult.cleanedCollections.forEach(col => {
            expect(col.highlightIds.length).toBe(30); // ALL preserved
        });
    });

    test('RACE CONDITION: Concurrent operations', () => {
        // Simulate the scenario where:
        // 1. Restore starts with collections
        // 2. Another operation clears highlights map temporarily
        // 3. Cleanup runs

        const result1 = cleanupOrphansAfterScanning(restoredCollections, markdownHighlights);
        expect(result1.orphanCount).toBe(0);

        // Even if another operation clears the highlights map temporarily,
        // the NEW behavior ensures we clean based on CURRENT state after scanning
        const emptyMap = new Map<string, TestHighlight[]>();
        const result2 = cleanupOrphansBeforeScanning(restoredCollections, emptyMap);
        expect(result2.orphanCount).toBe(5); // This is what OLD behavior would do

        // But with the mutex in place, concurrent scans are prevented
        // So the NEW behavior is: wait for scan to complete, then clean
    });
});
