# Changelog

All notable changes to the Sidebar Highlights plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.0] - 2025-07-12

### Fixed
- **Scroll Position Preservation**: Fixed sidebar scroll position jumping to top when changing highlight colors
- **Highlight Persistence**: Fixed highlights being lost when creating new tabs or switching between tabs

### Enhanced
- **Settings Redesign**: Revamped settings interface with improved layout and custom color options
- **Excalidraw Filtering**: Added option to hide Excalidraw files that might clutter the "All Notes" tab
- **Visual Consistency**: Highlight card borders now correctly use the corresponding highlight color
- **Theme Integration**: Default highlight color now uses your theme's highlight color instead of a fixed color

## [1.10.0] - 2025-07-12

### Added
- **Advanced Search System**: Complete search system overhaul with AST-based parsing and proper operator precedence
  - Support for `#tag` and `@collection` filters with intelligent autocomplete
  - Logical operators: `AND`, `OR` with correct precedence (AND binds tighter than OR)
  - Parentheses support for grouping: `(#urgent OR #work) AND @archive`
  - Exclude filters: `-#spam` and `-@archive` for negative filtering
  - Full-text search integration: `phishing #malware` combines text and tag filtering
  - Real-time search preview showing parsed query logic
  - Obsidian-style autocomplete with keyboard navigation (↑↓ arrows, Enter, Esc)
- **Inline Comment Support**: New `^[comment content]` syntax for immediate comments attached to highlights
  - Mixed footnote support: combine standard `[^key]` and inline `^[content]` on same highlight
  - Setting option: "Use inline footnotes by default" for controlling comment creation method
  - Automatic text selection when adding new inline comments via "Add comment" button
- **Enhanced Filter Dropdown**: Improved tag and collection filtering with better UX
  - Alphabetical sorting with proper locale-aware comparison (supports multiple languages)
  - Unicode character support for international tags (Chinese, Japanese, Arabic, etc.)
  - Improved visual organization and accessibility

### Enhanced
- **Search Parser Architecture**: Moved from simple token matching to full Abstract Syntax Tree (AST) parsing
- **Filter Integration**: Smart search works seamlessly with existing tag/collection filter dropdowns
- **Real-time Feedback**: Live preview shows exactly how complex queries will be interpreted
- **Unified Filtering**: All filtering systems (search, dropdowns, native comments) work together with AND logic
- **Tag Recognition**: Improved hashtag extraction with full Unicode support for international characters
- **Internationalization**: Better support for non-Latin scripts in tag names and filtering

## [1.0.6] - 2025-07-08

### Changed
- **UI Text Consistency**: Updated all UI text elements to use proper sentence case formatting for better consistency and readability
- **Settings Tab Cleanup**: Removed unnecessary plugin name heading from settings tab per Obsidian guidelines
- **Accessibility Improvements**: Replaced aria-label attributes with setTooltip function for better accessibility and user experience
- **Vault-Specific Storage**: Replaced localStorage with App.saveLocalStorage/loadLocalStorage for vault-specific data persistence
- **Timeout Handling**: Updated timeout implementations to use proper web API methods (window.setTimeout/clearTimeout) with number types instead of Node.js-specific types

### Fixed
- **Command Cleanup**: Collection commands are now properly removed from the command palette when collections are deleted using removeCommand()
- **Launch Behavior**: Plugin no longer forces the sidebar to open automatically when Obsidian launches
- **TypeScript Build**: Fixed build error related to private property access in CollectionsManager

### Removed
- **Obsolete Code**: Removed obsolete command tracking code and deleted collection name tracking system

## [1.0.5] - 2025-06-13

### Added
- **Native Comment Syntax Support**: Added support for Obsidian's comment syntax `%% comment text %%` that appears in the sidebar alongside highlights
- **Native Comment Styling**: Native comments display with distinct muted styling to differentiate from regular highlights
- **Native Comment Integration**: Native comments work with all existing features (focus on click, collections, search, grouping) but exclude color picker and footnote comment functionality
- **Native Comment Toggle**: Native comments can be enabled/disabled within the sidebar by clicking on the icon in actions menu.
- **Hide Toolbar and Highlight Actions**: Added toggles in settings to hide the toolbar and/or highlight actions for a cleaner sidebar interface.

### Fixed
- **PDF File Parsing**: Fixed issue where PDF files were being parsed for highlights. PDF files now display "PDF highlights are not supported." message instead. Will revisit if PDF.JS is updated.
- **Date Grouping Timezone Issue**: Fixed date grouping logic that was using UTC time instead of local timezone, causing highlights from previous days to appear under incorrect date headers
- **Duplicate Timestamps**: Fixed issue where multiple highlights created in the same scanning operation would receive identical timestamps, causing incorrect date grouping and sorting
- **Timestamp Preservation**: Fixed issue where existing highlights would lose their original creation timestamps upon reload.
- **Comment Grouping**: Renamed "Comments" grouping to "Highlight comments" and excluded native comments from comment grouping (they now appear in "No Comments" group)
- **Quote Display**: Fixed proper display of quotes in the sidebar
- **Code Block Exclusion**: Fixed issue where highlights inside fenced code blocks and inline code were being detected and displayed in the sidebar

## [1.0.4] - 2025-06-05

### Added
- **Show Filenames Setting**: Added toggle in settings to control whether note titles appear below highlights in "All Notes" and "Collections" views.
- **Show Timestamps Setting**: Added toggle in settings to control whether timestamps appear on highlight cards.

### Fixed
- **Timestamp Positioning**: Improved timestamp positioning and layout within highlight cards on smaller screens.

### Changed
- **CSS Refactoring**: Moved all inline styles to CSS classes for better maintainability, except for dynamic dropdown positioning which requires runtime calculations.
- **Code Cleanup**: Removed exhaustive console logging statements to improve performance and reduce noise.
- **Collection Notices**: Removed notification popups when creating, editing, or deleting collections for a cleaner user experience.