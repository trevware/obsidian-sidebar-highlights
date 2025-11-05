# Changelog

All notable changes to the Sidebar Highlights plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.32.0] - 2025-11-05

### Added
- **Priority System**: Enhanced task prioritization with three priority levels
  - Priority 1 (High/Red): `- [!1]` - Highest priority tasks
  - Priority 2 (Medium/Yellow): `- [!2]` - Medium priority tasks
  - Priority 3 (Low/Blue): `- [!3]` - Low priority tasks
  - Priority markers color the checkbox for visual distinction
  - Quick priority menu accessible via flag button on tasks
- **Multi-Select Support**: Select multiple highlights with Cmd/Ctrl+Click for bulk operations
  - Add selected highlights to collections
- **Task Animation**: Added subtle flash animation when tasks move between groups
  - Provides visual feedback when changing task dates or priorities
  - Uses theme's hover color for consistency
- **Optimistic UI Updates**: Date changes now update instantly before file write
  - Immediate visual feedback when changing task dates
  - Tasks move to new date groups instantly
  - Automatically reverts if file update fails

### Enhanced
- **Date Grouping**: "End of This Week" now correctly picks Friday instead of Saturday
  - More accurate weekly planning and organization
- **Task Date Labels**: Changed terminology from "Task Date" to "Due Date"

### Fixed
- **Task Duplication**: Fixed visual duplication of tasks when grouping is enabled
  - Added render guard to prevent concurrent task rendering
  - Eliminated race condition causing duplicate DOM elements
  - Tasks now render once reliably regardless of grouping mode
- **Date Accumulation**: Fixed bug where changing task dates multiple times would sometimes accumulate date stamps
  - Example: `- [ ] 2025-11-06 2025-11-12 2025-11-05` now correctly becomes `- [ ] 2025-11-05`
  - Date parser now reads actual file content instead of modified task object
  - Properly removes old date before adding new date
- **Copy Button Alignment**: Fixed alignment of copy-to-clipboard button on highlight cards
  - Button now properly aligned with other action buttons
  - Consistent spacing and visual hierarchy
- **Double Bottom Border**: Removed duplicate bottom border line on task cards
  - Cleaner visual appearance in grouped task views
  - Consistent border styling across all task cards
- **Title Change Focus**: Fixed issue where changing file titles would break highlight focus navigation
  - Highlight focus now works correctly after file renames
  - Maintained proper reference tracking across title changes
- **Debug Output**: Removed debugging console output for cleaner production experience
  - Improved performance by removing unnecessary logging
  - Cleaner console for users and developers

## [1.31.0] - 2025-11-03

### Added
- **Smart Date Grouping**: Intelligent date-based grouping for tasks with contextual labels
  - First 7 days (Today through 6 days out): Individual day groups with descriptive names (Today, Tomorrow, Wednesday, etc.)
  - Rest of current month: Single group showing date range (e.g., "November 11-30")
  - Next 4 months: Month name groups (December, January, February, March)
  - Years thereafter: Year number groups (2026, 2027, etc.)
  - Always shows nearest dates first for better task prioritization
- **Task Text Highlighting**: Clicking a task from the sidebar now highlights the task text in the editor
  - Provides clear visual feedback of which task was clicked
  - Automatically selects task text (excluding checkbox) and scrolls into view

### Enhanced
- **Simplified Date Grouping**: Removed descending date order option (always shows soonest dates first)
  - "Due Date" grouping option replaces previous "Due date ↑" and "Due date ↓" options
  - Chronological ordering makes more sense for task management
- **Smart Date Badge Display**: Date badges now intelligently show/hide based on group type
  - Hidden for individual day groups (Today, Tuesday, etc.) where date is redundant
  - Shown for month/year groups (December, 2026) so users can see specific dates
  - Date badge format changed from "MMM DD" to "MM-DD" (e.g., "07-23")
- **Section Ordering**: Tasks without headers now appear first in each group
  - Makes it easier to find tasks that aren't organized under headers
  - Followed by alphabetically sorted header sections

### Fixed
- **Bulk Operations**: Fixed duplicate empty state messages when bulk deleting/adding files
  - Added 300ms debouncing to file create/delete/rename events
  - Prevents multiple simultaneous renders causing visual glitches
- **Exclusion Settings**: Fixed Tasks view not updating when removing directories from exclusion list
  - Sidebar now automatically refreshes when exclusion settings change
  - No manual reload required to see tasks from newly included folders
- **Header Changes**: Fixed task headers not updating when markdown headers are deleted or modified
  - Task change detection now includes header tracking
  - Sidebar automatically refreshes when headers above tasks change
- **Localization Loading**: Fixed translations not loading when plugin installed from release
  - Translations now bundled directly into main.js instead of separate files
  - Ensures consistent i18n behavior across all installations
- **Collections Empty State**: Fixed alignment of "No Collections" text
  - Now matches other empty state messages for visual consistency

## [1.3.0] - 2025-11-03

### Added
- **Tasks Tab** (NEW): Complete task management system integrated into the sidebar
  - **Note**: Tasks tab is hidden by default - enable it in Settings > Views > Show Tasks tab
  - Automatically scans vault for all tasks (`- [ ]` and `- [x]`)
  - Task context support showing indented content below tasks
  - Flag tasks for priority marking
  - Natural language date parsing for due dates (e.g., `📅 2024-11-15`, `due: tomorrow`)
  - Toggle completed task visibility in Settings
  - Dedicated task date format setting (YYYY-MM-DD, MM/DD/YYYY, etc.)
  - Click tasks to navigate to their location in files
  - Inline file name display with click-to-open
- **Task Grouping Options**: Multiple grouping modes for task organization
  - Group by Due Date (ascending/descending) with "Overdue", "Today", "Tomorrow" smart labels
  - Group by Filename for project-based organization
  - Automatic section grouping by markdown headers (when not grouping by date)
  - Overdue tasks automatically pinned at top when grouping by date
- **Task Filtering System**: Advanced filtering options for task management
  - Filter by completion status (Completed, Incomplete)
  - Filter by flagged tasks
  - Filter by due date (Overdue, Due Today, Upcoming, No Date)
  - Dynamic filter menu shows only relevant filters based on task data
- **Display Modes** (NEW): Save and restore display configurations
  - Save current display settings (visibility, timestamps, etc.) as named presets
  - Apply saved modes from settings or Command Palette
  - Update existing modes with current settings
  - Rename and delete display modes
  - Quick switching between different viewing preferences (e.g., "Reading Mode", "Full View")
- **Internationalization** (NEW): Full Chinese (Simplified) localization support
  - Complete translation of all UI elements, settings, and messages
  - Locale switching follows Obsidian's language setting
  - Framework in place for additional language support
  - Localized empty states, filter labels, and date formats
- **Task Highlight Rendering**: Tasks now properly render `==highlighted text==` with Obsidian's native highlight styling
  - Uses `span.cm-highlight` class matching editor appearance
  - Maintains theme color consistency between editor and sidebar
- **Intelligent Task Change Detection**: Sidebar now detects changes to task context (sub-bullets/comments below tasks)
  - Adding or editing indented lines below tasks triggers sidebar refresh
  - Compares full task blocks including context for accurate change detection
  - Cache system tracks task content per file for efficient comparison

### Enhanced
- **Natural Language Date Input**: Intelligent date picker with smart suggestions
  - Autocomplete suggestions: "today", "tomorrow", "next Monday", "in 2 weeks"
  - Relative date parsing: "+3d", "2w", "next Friday"
  - Calendar helper for picking specific dates
  - Update or remove existing task dates
  - Suggestion dropdown with keyboard navigation
- **Command Palette Integration**: Display modes accessible via command palette
  - Quick application of saved display configurations
  - Commands automatically created/removed when modes are added/deleted
  - Consistent command naming: "Apply display mode: [Mode Name]"
- **Optimized Task Updates**: Dramatically improved task update performance
  - Only re-scans modified files instead of entire vault
  - Incremental cache updates for changed tasks
  - 1-second debounce prevents excessive refreshes while typing
  - File-level change tracking with smart comparison logic
  - Smart change detection: only refreshes when task content actually changes
- **Streamlined Date Grouping**: Reduced visual clutter when grouping tasks by date
  - Removed markdown section headers in date grouping mode
  - Date badges hidden on individual tasks (redundant with group header)
  - Consistent spacing between date groups and tasks
  - Filenames displayed inline for better context
  - Progress circles show completion percentage per date group
- **Unified Empty States**: Consistent empty state design across tasks and highlights
  - Simplified layout with centered text
  - Localized for both English and Chinese
- **Settings Organization**: Improved settings layout with new sections
  - Display Modes section for managing saved configurations
  - Tasks section for task-specific settings
  - Views section for controlling tab visibility

### Fixed
- **Adjacent Comments Toggle**: Fixed bug where HTML comments were always treated as adjacent regardless of setting
  - Both native (`%% %%`) and HTML (`<!-- -->`) comments now respect the "Detect adjacent native comments" toggle
  - Setting now controls adjacency behavior for all comment types uniformly
- **Comment Focus Navigation**: Fixed navigation to adjacent comments from sidebar
  - All comment types now focusable: inline footnotes, standard footnotes, native comments, HTML comments, custom patterns
  - Proper selection and cursor positioning for each comment type
  - Distance-based matching prevents focusing wrong occurrence of duplicate comments
- **Per-Tab State Persistence**: Fixed temporary display of wrong content during sidebar refresh
  - View mode and grouping settings now properly maintained during refresh
  - Eliminated brief flashing of highlights in Tasks tab when creating new highlights
  - State restoration happens before rendering to prevent visual glitches
- **Localization Loading**: Fixed translations not loading when plugin installed from release
  - Translations now bundled directly into main.js instead of separate files
  - Ensures consistent i18n behavior across all installations

## [1.21.0] - 2025-10-31

### Added
- **Custom Pattern Support**: Added experimental custom pattern detection for highlights and comments via regex (Settings > Advanced)
  - Support for custom highlight patterns (e.g., Regex Mark plugin's `//text//` syntax)
  - Support for custom comment patterns (e.g., IA Writer comments)
  - Pattern validation with runtime safety limits
  - Conflict warnings for patterns that overlap with built-in syntax
- **HTML Comment Support**: Added support for HTML comment syntax `<!-- comment -->` as highlights/comments (Settings > Advanced)
  - HTML comments can appear adjacent to highlights and merge as footnotes
  - Supports same adjacency rules as native comments (blank lines break adjacency)
- **Alphabetical Sorting**: Added alphabetical sorting options (A-Z and Z-A) for highlights in sidebar (Settings > Display > Sort by)
- **Copy to Clipboard**: Added copy highlight text to clipboard button on hover over highlight cards
- **Multi-Paragraph Highlights**: Full support for highlights spanning multiple paragraphs
  - Works with both `==text==` and `%%comments%%` syntax
  - Comment addition and navigation work correctly across paragraphs
- **Adjacent Comment Merging**: Comments immediately following highlights (with optional footnotes between) are now merged as footnotes
  - Supports native comments (`%%comment%%`), HTML comments (`<!-- -->`), and custom pattern comments
  - Example: `==highlight==^[note]%%comment%%` treats the comment as a footnote
  - Blank lines break adjacency - preserves separate comments
- **Disable Collections Setting**: Added option to completely disable collections feature in settings (Settings > Collections)
- **Backup Organization**: Data backup files now stored in dedicated `backups/` folder with automatic migration of existing backups

### Enhanced
- **Settings UI Redesign**: Reorganized Styling section with separated "Colors" and "Color names" subsections for better clarity
- **Theme Compatibility**: Removed background colors from search container and tabs that conflicted with theme customization
- **Excluded Files Management**: Automatically removes non-existent paths when opening Excluded Files modal

### Fixed
- **Inline Comment Cursor**: Fixed cursor placement when adding inline footnotes to highlights
- **CSS Conflicts**: Fixed CSS custom properties clashing with theme color customization

## [1.20.0] - 2025-07-27

### Added
- **Minimum Character Count Filter**: Added setting to hide highlights and native comments shorter than specified character count from sidebar (Settings > Display)
- **Auto-unfold on Focus**: Added optional setting to automatically unfold content when focusing highlights from sidebar (Settings > Display)
- **Class-based Custom CSS**: Added support for class-based styling when using custom CSS (e.g., `.g { background: #00c80066; color: var(--text-normal); }`)

### Fixed
- **HTML Highlight Colors**: Fixed issue where non-HTML highlight colors could not be altered once changed at least once
- **Comment Expansion Persistence**: Fixed comment expansion state to persist across all three tabs and work for newly created highlights

### Enhanced
- **Settings UI**: Added periods to setting descriptions for consistency (Date format, Minimum character count, Excluded files)
- **Filter Logic**: Minimum character count filtering applies only to highlights and native comments, preserving regular footnote-based comments

## [1.19.0] - 2025-07-23

### Added
- **Typography Settings**: Added customizable font size controls in Settings > Display > Typography
  - **Main highlight text**: Adjust font size for the main highlight content (default 11px)
  - **Details text size**: Adjust font size for filename, line number, stats, buttons, etc. (default 11px)
  - **Comment text size**: Adjust font size for comment content (default 11px)
- **Real-time Updates**: Font size changes apply immediately when adjusted in settings
- **Input Validation**: Font size inputs accept values between 8-32px with validation

### Enhanced
- **Settings Organization**: Added dedicated Typography section under Display settings
- **User Control**: Independent control over different text elements for optimal readability customization

## [1.18.0] - 2025-07-22

### Fixed
- **Code Block Detection**: Fixed issue where `==` operators inside code blocks were incorrectly detected as highlight markers
- **Highlight Regex**: Updated markdown highlight regex to prevent matching across newlines and code block boundaries
- **Code Block Parsing**: Improved fenced code block detection with separate patterns for ``` and ~~~ blocks

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