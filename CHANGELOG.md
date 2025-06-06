# Changelog

All notable changes to the Sidebar Highlights plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.04] - 2025-06-05

### Added
- **Show Filenames Setting**: Added toggle in settings to control whether note titles appear below highlights in "All Notes" and "Collections" views.
- **Show Timestamps Setting**: Added toggle in settings to control whether timestamps appear on highlight cards.

### Fixed
- **Timestamp Positioning**: Improved timestamp positioning and layout within highlight cards on smaller screens.

### Changed
- **CSS Refactoring**: Moved all inline styles to CSS classes for better maintainability, except for dynamic dropdown positioning which requires runtime calculations.
- **Code Cleanup**: Removed exhaustive console logging statements to improve performance and reduce noise.
- **Collection Notices**: Removed notification popups when creating, editing, or deleting collections for a cleaner user experience.