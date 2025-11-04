# Sidebar Highlights

Simplify and streamline how you work with highlights, comments, and tasks in Obsidian. This plugin helps you capture, organize, and navigate your thoughts across your entire vault with advanced search capabilities, a flexible comment system, and comprehensive task management.

<p align="center">
  <picture>
    <img src="https://github.com/user-attachments/assets/eebaa062-adee-4bda-b3ce-bdc0a536ecaf" alt="Preview">
  </picture>
</p>

### **Flexible Comment System using Obsidian's Footnote Syntax**
- **Standard comments**: `==highlight==[^1]` with `[^1]: Your comment`
- **Inline comments**: `==highlight==^[immediate comment]`
- **Native Obsidian comments**: `%%standalone comment%%` will also appear in the sidebar
- **Mixed commenting**: Combine different comment types on the same highlight

### **Comprehensive Task Management**
- **Smart task detection** automatically scans vault for all tasks (`- [ ]` and `- [x]`)
- **Natural language dates** like "tomorrow", "next Monday", or "+3d" for due dates
- **Intelligent grouping** by due date with contextual labels (Today, Tomorrow, day names, months, years)
- **Task filtering** by completion status, flagged tasks, or due dates (Overdue, Due Today, etc.)
- **Task context** shows indented content and sub-bullets below tasks
- **Flag tasks** for priority marking and quick filtering

### **Visual Organization**
- **Smart grouping** by color, date, folder, collection, filename, or due date
- **Collections system** to organize highlights across multiple files
- **Display modes** to save and restore different display configurations
- **Clean sidebar interface** with optional toolbar and action hiding
- **Color-coded highlights**: Gold, Red, Teal, Blue, and Green
- **International support**: Full Chinese (Simplified) localization

### **Seamless Integration**
- **Works directly with Obsidian's markdown syntax** - no custom formats required
- **Command palette live updates** to navigate to collections as you create them
- **Click sidebar highlights and comments** to navigate directly to their location
- **Real-time updates** as edits are made in the editor

### **Advanced Search & Filtering**
- **Smart search** with logical operators (`AND`, `OR`) and parentheses for complex queries
- **Tag filters** using `#tag` syntax with autocomplete support
- **Collection filters** using `@collection` syntax 
- **Exclude filters** with `-#tag` and `-@collection` for precise filtering
- **Real-time search preview** showing exactly how your query will be interpreted
- **International support** for Unicode characters in tags and search

## Getting Started

### Creating Your First Highlight

**Method 1: Right-click menu (Easiest)**
1. Select any text in a markdown file
2. Right-click and choose "Create highlight"
3. Your text is now highlighted and appears in the sidebar!

**Method 2: Command palette**
- Press `Ctrl/Cmd + P` → type "Toggle highlight"

**Method 3: Manual syntax**
- Type: `==your highlighted text==`

**Pro tip**: Use a hotkey for highlights.

### The Three Comment Types

#### 1. **Standard Comments**
Perfect for detailed comments that don't clutter your text:
```markdown
==Important concept==[^1]

[^1]: This is my detailed explanation of why this concept matters
```

#### 2. **Inline Comments**
Great for immediate thoughts without jumping around:
```markdown
==Key insight==^[This changed my perspective completely!]
```

#### 3. **Native Comments** (Standalone)
Use anywhere in your document for general thoughts:
```markdown
%% Remember to revisit this section during review %%
```

**Pro tip**: This plugin supports mixed footnote types! For example: `==text==[^1]^[quick note]`

### Advanced Search

The search bar supports powerful queries:

**Basic examples:**
- `home` - Find all highlights containing "home"
- `#important` - Show only highlights tagged with #important
- `@work` - Filter by "work" collection

**Advanced queries:**
- `#urgent AND @project` - Must have both tag and collection
- `#bug OR #feature` - Either tag works
- `(#critical OR #high) AND security` - Complex logic with parentheses
- `-#archived` - Exclude highlights tagged with #archived
- `home #important -@completed` - Text + include tag + exclude collection

**Auto-complete**: Start typing `#` or `@` and use ↑↓ arrows to navigate suggestions.

### Using the Sidebar

2. **Navigate**: Four tabs available:
   - **Current Note**: See highlights from active file
   - **All Notes**: Browse your entire vault
   - **Collections**: Organized highlight groups
   - **Tasks**: Manage tasks from across your vault (enable in Settings)
3. **Click to jump**: Any highlight or task takes you directly to its location
4. **Search & filter**: Use the powerful search and filter options
5. **Group & organize**: Sort by color, date, folder, collection, or due date

### Collections - Organize Highlights Across Files

Collections help you group related highlights from different notes:

1. **Create**: Go to Collections tab → "New Collection"
2. **Add highlights**: Click the collection button on any highlight
3. **Browse**: Click collection cards to see contents
4. **Quick access**: Use Command Palette → "Go to [Collection Name]"

### Tasks - Manage Your To-Dos

The Tasks tab provides a unified view of all tasks in your vault:

1. **Enable**: Go to Settings → Views → Show Tasks tab
2. **Add dates**: Click the calendar icon to set due dates with natural language ("tomorrow", "next week", etc.)
3. **Flag tasks**: Mark important tasks for quick filtering
4. **Group by date**: Organize tasks with smart labels (Today, Tomorrow, day names, month names, years)
5. **Filter**: Show only overdue, due today, flagged, or incomplete tasks
6. **Click to edit**: Any task takes you directly to its location in the file

**Pro tip**: Tasks automatically show their context (indented content below them) for better understanding.

### Display Modes - Save Your View Preferences

Display Modes let you save and quickly switch between different display configurations:

1. **Save a mode**: Set up your preferred view → Settings → Display Modes → Save Current Display
2. **Apply modes**: Use the Command Palette → "Apply display mode: [Mode Name]"
3. **Update modes**: Make changes and update existing modes with new settings
4. **Quick switching**: Perfect for different workflows (Reading Mode, Full View, etc.)

### Color Your Highlights

**Change colors**: Hover over the side of a highlight to view the color picker.

## Installation

### Option 1: Community Plugin (Recommended)
1. Open Obsidian Settings
2. Go to **Community Plugins** → **Browse**
3. Search for "Sidebar Highlights"
4. Click **Install** and then **Enable**

### Option 2: Manual Installation
1. Download the latest release from GitHub
2. Extract to your vault's `.obsidian/plugins/sidebar-highlights/` folder
3. Reload Obsidian or restart the app
4. Enable the plugin in **Settings** → **Community Plugins**

## Settings & Customization

Access plugin settings via **Settings** → **Sidebar Highlights**:

**Display:**
- **Use inline footnotes by default**: Toggle between footnote styles
- **Hide toolbar/actions**: Clean up the interface
- **Show timestamps**: Display creation times on highlights
- **Show filenames**: Show note titles in multi-file views

**Views:**
- **Show Tasks tab**: Enable the Tasks tab in the sidebar

**Tasks:**
- **Show completed tasks**: Toggle visibility of completed tasks
- **Show task context**: Display indented content below tasks
- **Task date format**: Choose how dates appear (YYYY-MM-DD, MM/DD/YYYY, etc.)

**Display Modes:**
- **Save current display**: Create named presets for different viewing configurations
- **Manage modes**: Update, rename, or delete existing display modes

## Keyboard Shortcuts & Commands

- **Toggle sidebar**: Open/close the highlights panel
- **Create highlight**: Convert selected text to highlight
- **Go to [Collection]**: Jump directly to specific collections
- **Apply display mode**: Quickly switch between saved display configurations

*Tip: Set custom hotkeys in Obsidian's Hotkeys settings*

## Pro Tips & Tricks

- **Quick footnotes**: Enable "Use inline footnotes by default" for faster note-taking
- **Take advantage of search**: Use `(#urgent OR #important) AND -#completed` for complex filtering
- **Color coding system**: Develop your own color meanings for consistent organization
- **Collection workflows**: Create collections for projects, topics, or review cycles
- **Natural language dates**: Use "tomorrow", "next Monday", "+3d", or "in 2 weeks" for quick task scheduling
- **Display modes for workflows**: Save different modes for reading, reviewing, or editing sessions
- **Smart date grouping**: Group tasks by due date to see what's coming up (Today, Tomorrow, day names, months)

## Troubleshooting & FAQ

**Q: Can I use this with PDF files?**
A: PDF highlights aren't supported.

**Q: Why can't I jump to highlights from within Reading View?**
A: Jumping to highlights from within Reading View is not currently supported.

**Q: Where is the Tasks tab?**
A: The Tasks tab is hidden by default. Enable it in Settings → Views → Show Tasks tab.

### Need More Help?

- Report bugs or request features on [GitHub Issues](https://github.com/trevware/obsidian-sidebar-highlights/issues)

## ❤️ Support the Project

If this plugin enhances your Obsidian experience:
- ☕ [Buy me a coffee](https://buymeacoffee.com/trevware) to fuel development
- ⭐ Star the project on GitHub

---

*Made with ❤️ for the Obsidian community*
