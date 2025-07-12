// Test for mixed footnote functionality
// Run with: node test-mixed-footnotes.js

class TestInlineFootnoteManager {
    extractInlineFootnotes(content, highlightEndIndex) {
        const inlineFootnotes = [];
        const afterHighlight = content.substring(highlightEndIndex);
        
        // Match one or more inline footnotes with optional spaces between them
        const inlineFootnoteRegex = /(\s*\^\[([^\]]+)\])/g;
        let match;
        
        while ((match = inlineFootnoteRegex.exec(afterHighlight)) !== null) {
            // Only process if this footnote is at the very beginning or follows another footnote
            if (match.index === 0 || this.isValidFootnotePosition(afterHighlight, match.index)) {
                inlineFootnotes.push({
                    content: match[2], // The content inside ^[content]
                    startIndex: highlightEndIndex + match.index,
                    endIndex: highlightEndIndex + match.index + match[0].length
                });
            } else {
                // Stop processing if we encounter a footnote that's not immediately following
                break;
            }
        }
        
        return inlineFootnotes;
    }
    
    isValidFootnotePosition(afterHighlight, index) {
        const precedingText = afterHighlight.substring(0, index);
        // Should only contain whitespace, standard footnotes [^key], or previous inline footnotes ^[content]
        // Allow alphanumeric keys for standard footnotes
        return /^(\s*(\[\^[a-zA-Z0-9_-]+\]|\^\[[^\]]+\])\s*)*\s*$/.test(precedingText);
    }
}

// Test cases for mixed footnotes
const manager = new TestInlineFootnoteManager();

const testCases = [
    {
        name: "Standard footnote followed by inline footnote",
        content: "==Je suis abonner a leur compte facebook==[^1] ^[Test]",
        highlightEnd: 42,
        expected: [{ content: "Test" }]
    },
    {
        name: "Standard footnote followed by inline footnote (no space)",
        content: "==des memeres==[^2] ^[Inline]",
        highlightEnd: 15,
        expected: [{ content: "Inline" }]
    },
    {
        name: "Multiple standard footnotes followed by inline footnotes",
        content: "==highlight==[^1][^2] ^[First inline] ^[Second inline]",
        highlightEnd: 13,
        expected: [
            { content: "First inline" },
            { content: "Second inline" }
        ]
    },
    {
        name: "Standard footnote, inline footnote, then more inline footnotes",
        content: "==text==[^ref]^[First]^[Second] ^[Third]",
        highlightEnd: 8,
        expected: [
            { content: "First" },
            { content: "Second" },
            { content: "Third" }
        ]
    },
    {
        name: "Only standard footnotes, no inline footnotes",
        content: "==highlight==[^1][^2] some text",
        highlightEnd: 13,
        expected: []
    },
    {
        name: "Inline footnote followed by standard footnote (should stop at standard)",
        content: "==text==^[Inline][^1] more text",
        highlightEnd: 8,
        expected: [{ content: "Inline" }]
    },
    {
        name: "User's example: standard footnote, inline footnotes, then more standard footnotes",
        content: "==When I was a boy, I had a ride-on lawnmower with no blades==[^1]^[New comment] ^[New comment] ^[New comment] ^[fsdfsd] ^[Testing out in-line comments.] ^[Hello, World] ^[Changing it up] [^2] [^3]",
        highlightEnd: 62, // End of the highlight itself: ==When I was a boy, I had a ride-on lawnmower with no blades==
        expected: [
            { content: "New comment" },
            { content: "New comment" },
            { content: "New comment" },
            { content: "fsdfsd" },
            { content: "Testing out in-line comments." },
            { content: "Hello, World" },
            { content: "Changing it up" }
        ]
    },
    {
        name: "User's new example: inline footnote followed by standard footnote",
        content: "==I'd wanted a ride-on lawnmower for years== ^[in-line1] [^1]",
        highlightEnd: 44, // End of the highlight itself
        expected: [
            { content: "in-line1" }
        ]
    },
    {
        name: "User's ordering example: standard, inline, inline, inline, standard",
        content: "==I'd wanted a ride-on lawnmower for years== [^2]^[in-line1] ^[Actually in-line] ^[Hello World] [^1]",
        highlightEnd: 44, // End of the highlight itself
        expected: [
            { content: "in-line1" },
            { content: "Actually in-line" },
            { content: "Hello World" }
        ]
    }
];

console.log("Testing mixed footnote extraction...\n");

testCases.forEach((testCase, index) => {
    console.log(`Test ${index + 1}: ${testCase.name}`);
    const result = manager.extractInlineFootnotes(testCase.content, testCase.highlightEnd);
    
    const actualContents = result.map(fn => fn.content);
    const expectedContents = testCase.expected.map(fn => fn.content);
    
    const passed = JSON.stringify(actualContents) === JSON.stringify(expectedContents);
    
    console.log(`  Content: "${testCase.content}"`);
    console.log(`  Expected: [${expectedContents.map(c => `"${c}"`).join(', ')}]`);
    console.log(`  Actual:   [${actualContents.map(c => `"${c}"`).join(', ')}]`);
    console.log(`  Result:   ${passed ? 'PASS' : 'FAIL'}`);
    
    if (!passed) {
        console.log(`  Debug: afterHighlight = "${testCase.content.substring(testCase.highlightEnd)}"`);
        // Test the regex pattern
        const afterHighlight = testCase.content.substring(testCase.highlightEnd);
        const inlineFootnoteRegex = /(\s*\^\[([^\]]+)\])/g;
        let match;
        console.log(`  Regex matches:`);
        while ((match = inlineFootnoteRegex.exec(afterHighlight)) !== null) {
            const precedingText = afterHighlight.substring(0, match.index);
            const isValid = manager.isValidFootnotePosition(afterHighlight, match.index);
            console.log(`    Match: "${match[0]}" at index ${match.index}, valid: ${isValid}, preceding: "${precedingText}"`);
        }
    }
    console.log();
});

console.log("Test completed!");