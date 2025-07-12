# Sidebar Highlights

Simplify and streamline how you work with highlights and comments in Obsidian. This plugin helps you capture, organize, and navigate your thoughts across your entire vault with advanced search capabilities and a flexible comment system.

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

### **Visual Organization**
- **Smart grouping** by color, date, folder, collection, or filename
- **Collections system** to organize highlights across multiple files
- **Clean sidebar interface** with optional toolbar and action hiding
- **Color-coded highlights**: Gold, Red, Teal, Blue, and Green

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

2. **Navigate**: Three tabs available:
   - **Current Note**: See highlights from active file
   - **All Notes**: Browse your entire vault
   - **Collections**: Organized highlight groups
3. **Click to jump**: Any highlight takes you directly to its location
4. **Search & filter**: Use the powerful search and filter options
5. **Group & organize**: Sort by color, date, folder, or collection

### Collections - Organize Highlights Across Files

Collections help you group related highlights from different notes:

1. **Create**: Go to Collections tab → "New Collection"
2. **Add highlights**: Click the collection button on any highlight 
3. **Browse**: Click collection cards to see contents
4. **Quick access**: Use Command Palette → "Go to [Collection Name]"

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

- **Use inline footnotes by default**: Toggle between footnote styles
- **Hide toolbar/actions**: Clean up the interface
- **Show timestamps**: Display creation times on highlights
- **Show filenames**: Show note titles in multi-file views

## Keyboard Shortcuts & Commands

- **Toggle sidebar**: Open/close the highlights panel
- **Create highlight**: Convert selected text to highlight
- **Go to [Collection]**: Jump directly to specific collections

*Tip: Set custom hotkeys in Obsidian's Hotkeys settings*

## Pro Tips & Tricks

- **Quick footnotes**: Enable "Use inline footnotes by default" for faster note-taking
- **Take advantage of search**: Use `(#urgent OR #important) AND -#completed` for complex filtering
- **Color coding system**: Develop your own color meanings for consistent organization
- **Collection workflows**: Create collections for projects, topics, or review cycles

## Troubleshooting & FAQ

**Q: Can I use this with PDF files?**
A: PDF highlights aren't supported.

**Q: Why can't I jump to highlights from within Reading View?**
A: Jumping to highlights from within Reading View is not currently supported.

### Need More Help?

- Report bugs or request features on [GitHub Issues](https://github.com/trevware/obsidian-sidebar-highlights/issues)

## ❤️ Support the Project

If this plugin enhances your Obsidian experience:
- ☕ [Buy me a coffee](https://buymeacoffee.com/trevware) to fuel development
- ⭐ Star the project on GitHub

---

*Made with ❤️ for the Obsidian community*
