# Changelog

All notable changes to the Sidebar Highlights plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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