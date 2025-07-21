# Changelog

All notable changes to the Sidebar Highlights plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.17.0] - 2025-07-21

### Added
- **HTML Highlight Support**: Added support for HTML highlight syntax alongside existing markdown highlighting
  - `<font color="color">text</font>` - Font color highlighting
  - `<span style="background:color">text</span>` - Background color highlighting
  - `<mark>text</mark>` - Standard mark tag (defaults to yellow)
- **Color Format Support**: Supports hex colors (#835cf5, #f00), named colors (yellow, red, green, etc.), and case-insensitive matching

### Enhanced
- **Color Display**: HTML highlights display using background color, or font color if only font color is specified in the HTML
- **Read-Only Colors**: HTML highlights cannot have colors changed from sidebar (like native comments) since color is determined by HTML markup
- **Search Integration**: HTML highlights included in search and filtering functionality

## [1.16.0] - 2025-07-19

### Fixed
- **Nested Tag Support**: Fixed nested tags (e.g., `#project/tasks`) being truncated in sidebar display and search functionality
- **Tag Parsing**: Updated regex patterns to properly handle forward slashes in tag names
- **Search Autocomplete**: Fixed autocomplete suggestions for nested tags in search functionality

## [1.15.0] - 2025-07-19

### Added
- **Stable Highlight IDs**: Implemented stable identifier system that preserves highlight IDs across file rescans and plugin updates, preventing collection references from breaking
- **Migration System**: Added comprehensive backup and migration system with automatic validation and user feedback for version upgrades
- **Collection Reference Validation**: Added post-migration validation that checks for broken collection references and provides detailed user feedback

### Enhanced
- **Data Protection**: Collections and highlights now survive plugin updates, external sync, and file changes without data loss
- **User Feedback**: Clear migration messages inform users of success or specific issues that need manual attention
- **Automatic Cleanup**: System automatically removes broken references and maintains clean data state

### Fixed
- **Collection Persistence**: Fixed collections being lost during plugin updates and external settings changes
- **Highlight ID Stability**: Fixed highlights getting new IDs during rescans, which broke collection relationships

## [1.14.0] - 2025-07-19

### Added
- **Custom Color Names**: Added optional naming system for highlight colors in settings - when set, custom names appear in "Group By Color" instead of hex codes
- **External Settings Sync**: Implemented automatic detection and reload of external settings changes, enabling seamless sync between vaults without requiring manual app reloads

### Enhanced
- **Settings UI**: Improved color settings layout with "Highlight name" fields

## [1.13.0] - 2025-07-19

### Fixed
- **Highlight Parsing with Special Characters**: Fixed regex parsing issue where highlights containing `=` characters and comments containing `%` characters would be incorrectly parsed, causing content to be skipped or merged across multiple highlights

## [1.12.0] - 2025-07-18

### Added
- **File Context Menu**: Added right-click context menu to file names in the sidebar with options to open in new tab, split right, and access default Obsidian file operations
- **Link Hover Preview**: Added hover with modifier keys support in the sidebar for quick file previews
- **File Exclusion System**: Added comprehensive file and folder exclusion settings to hide specific files/folders from highlight detection
- **Moment.js Date Formatting**: Added new setting that supports moment.js timestamp formatting with customizable date display patterns
- **Enhanced Comment Interaction**: Added setting to optionally select comment text when clicked in the sidebar, instead of just positioning the cursor

### Fixed
- **Duplicate Comments Bug**: Fixed duplicate comments appearing when a highlight had no markdown content after it
- **Slow Launch Performance**: Fixed slow plugin startup on boot, especially with thousands of markdown files
- **"All" Tab Performance**: Fixed hangs and performance issues by restricting display to 100 highlights per page with pagination
- **Character Filtering**: Fixed unwanted characters appearing in highlights when they shouldn't
- **Sequential Footnote Order**: Fixed footnotes being added in reverse order - now maintains chronological sequence
- **Inline Footnote Positioning**: Fixed inline footnotes being inserted at footnote definitions instead of after highlights

### Enhanced
- **Settings Organization**: Cleaned up and reorganized color settings with better visual hierarchy
- **Excalidraw Detection**: Made Excalidraw file filtering more robust with improved detection methods
- **Footnote Spacing**: Removed unnecessary whitespace between footnote additions for cleaner formatting

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