# Testing Documentation

## Setup

The project uses Jest with ts-jest for testing TypeScript code in a JSDOM environment.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage
```

## Test Suites

### 1. HTML Highlight Parser Tests

Located in: `src/utils/html-highlight-parser.test.ts`

**Test Coverage: 36 tests**

#### 1. Font Color Tags (5 tests)
- ✅ Parse `<font color="#ff0000">` with hex colors
- ✅ Parse `<font color="red">` with named colors
- ✅ Parse `<font color="#f00">` with short hex (converts to 6-digit)
- ✅ Handle case-insensitive color names (`BLUE`, `blue`)
- ✅ Support all named colors: yellow, red, green, blue, orange, purple, pink, cyan, magenta, lime, brown, gray/grey, black, white

#### 2. Span Background Tags (4 tests)
- ✅ Parse `<span style="background:#ffff00">`
- ✅ Extract background color from mixed styles
- ✅ Handle named colors in background
- ✅ Handle whitespace in style attributes

#### 3. Mark Tags (2 tests)
- ✅ Parse `<mark>` with default yellow color
- ✅ Handle mark tags with attributes

#### 4. Multiple Highlights (2 tests)
- ✅ Parse multiple highlights of the same type
- ✅ Parse mixed tag types (font + span + mark)

#### 5. Code Block Exclusion (3 tests)
- ✅ Exclude highlights in inline code blocks
- ✅ Exclude highlights in fenced code blocks
- ✅ Include highlights outside code blocks

#### 6. Edge Cases (6 tests)
- ✅ Skip empty highlights
- ✅ Skip whitespace-only highlights
- ✅ Handle nested tags
- ✅ Handle malformed HTML gracefully
- ✅ Handle special characters (&, <, >, ", ')
- ✅ Handle multiline highlights

#### 7. Position Tracking (3 tests)
- ✅ Correctly track startOffset
- ✅ Correctly track endOffset
- ✅ Track positions for multiple highlights

#### 8. findHighlightAtOffset Method (5 tests)
- ✅ Find correct highlight by offset
- ✅ Handle duplicate text with different offsets
- ✅ Return null for non-existent text
- ✅ Find closest match with approximate offset
- ✅ Exclude highlights in code blocks

#### 9. Color Parsing (3 tests)
- ✅ Parse RGB colors: `rgb(255, 0, 0)`
- ✅ Parse RGBA colors: `rgba(0, 255, 0, 0.5)` (alpha ignored)
- ✅ Handle RGB with whitespace

#### 10. Real-World Scenarios (3 tests)
- ✅ Handle URLs with `==` in markdown links
- ✅ Handle mixed markdown and HTML
- ✅ Handle complex document structure with headings, lists, and multiple highlights

### 2. Highlight Detection Tests

Located in: `src/utils/highlight-detection.test.ts`

**Test Coverage: 42 tests**

Tests all regex patterns and detection logic including:
- Markdown highlight regex (`==text==`)
- Comment highlight regex (`%%text%%`)
- Markdown link pattern detection
- Code block detection and exclusion
- Boundary detection (rejecting `===text===`)
- Footnote patterns (standard and inline)
- Real-world issue patterns:
  - URLs with `==` in markdown links
  - Underscores in identifiers (`some_variable_name`)
  - Escaped characters (`\*\*not bold\*\*`)
  - Bold + Italic combined (`***text***`)
- Wikilink patterns
- Edge cases (empty, whitespace, Unicode, CJK, RTL)

### 3. Markdown Renderer Tests

Located in: `src/renderers/markdown-renderer.test.ts`

**Test Coverage: 38 tests**

Tests markdown formatting in sidebar including:
- Single underscore italic handling
- Double underscore bold handling
- Triple underscore bold+italic handling
- Escape character handling (`\*`, `\_`, etc.)
- Bold and italic patterns (`**`, `*`, `***`)
- Strikethrough pattern (`~~`)
- Code pattern (`` ` ``)
- Link patterns (markdown and wikilinks)
- Real-world scenarios (mixed formatting, escaped content)
- Pattern precedence
- Edge cases (empty, adjacent, Unicode)

## Test Results

```
Test Suites: 3 passed, 3 total
Tests:       116 passed, 116 total
Time:        ~0.5s
```

## Adding New Tests

### For HTML Parser
Open `src/utils/html-highlight-parser.test.ts`:

```typescript
it('should do something', () => {
    const content = '<font color="red">test</font>';
    const highlights = HtmlHighlightParser.parseHighlights(content);

    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({
        text: 'test',
        color: '#ff0000',
        tagType: 'font-color'
    });
});
```

### For Highlight Detection
Open `src/utils/highlight-detection.test.ts`:

```typescript
it('should match pattern', () => {
    const text = '==highlighted==';
    const regex = /==([^=\n](?:[^=\n]|=[^=\n])*?[^=\n])==/g;
    const match = regex.exec(text);

    expect(match).not.toBeNull();
    expect(match![1]).toBe('highlighted');
});
```

### For Markdown Renderer
Open `src/renderers/markdown-renderer.test.ts`:

```typescript
it('should render formatting', () => {
    const text = '**bold text**';
    const boldRegex = /\*\*(.*?)\*\*/g;
    const match = boldRegex.exec(text);

    expect(match).not.toBeNull();
    expect(match![1]).toBe('bold text');
});
```

## Test Environment

- **Framework**: Jest 29.7
- **TypeScript**: ts-jest 29.1
- **Environment**: jsdom (simulates browser DOM)
- **Coverage**: Available via `npm test -- --coverage`

## Dependencies

All testing dependencies are in `devDependencies`:
- `jest`: Test framework
- `ts-jest`: TypeScript support for Jest
- `jest-environment-jsdom`: DOM environment for tests
- `@types/jest`: TypeScript types for Jest
