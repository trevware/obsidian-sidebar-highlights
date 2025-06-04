# Highlights Sidebar

A sidebar plugin for Obsidian that helps you view and manage text highlights, comments, and collections across your vault.

## Features

- **Create highlights** from selected text using `==highlighted text==` syntax
- **Sidebar view** showing all highlights from the current file
- **Search and filter** highlights by text content
- **Color coding** with 5 different highlight colors
- **Comments system** using footnotes (e.g., `==text==[^comment]`)
- **Collections** to organize highlights across multiple files
- **Tag support** for categorizing highlights
- **Dynamic commands** for viewing highlights in specific collections

## Usage

### Creating Highlights

1. **Select text** in any markdown file
2. **Right-click** and choose "Create highlight" from the context menu
3. Or use the command palette: `Ctrl/Cmd + P` → "Toggle highlight"
4. Or manually type: `==your highlighted text==`

### Using the Sidebar

1. Click the **highlighter icon** in the ribbon to open the sidebar
2. The sidebar shows all highlights from the currently active file
3. **Click any highlight** to jump directly to its location in the document
4. Use the **All Notes tab** to view highlights from across your entire vault
5. **Group highlights** by Color, Comments, Folder, Parent, Collection or Filename using the grouping buttons
6. **Filter by tags** using the tag filter dropdown to show only highlights with specific tags

### Adding Comments

Add footnotes immediately after highlights to create comments:
```markdown
==Important text==[^1]

[^1]: This is my comment about the highlighted text
```

You can also click the **comment button** on any highlight in the sidebar and select "Add Comment" to create footnotes automatically at the highlight's location.

### Working with Collections

1. Switch to the **Collections tab** in the sidebar
2. Click **"New Collection"** to create a collection
3. Add highlights to collections using the collection button on each highlight
4. View collection contents by clicking on any collection card
5. Jump to collections by using the command palette

### Color Coding

- Change highlight colors using the color picker in each highlight card
- 5 colors available: Gold, Red, Teal, Blue, and Green
- Colors help categorize and organize your highlights

## Installation

1. Download the plugin files
2. Place them in your `.obsidian/plugins/obsidian-highlights-sidebar/` folder
3. Enable the plugin in Obsidian's Community Plugins settings

## Commands

- **Toggle**: Open/close the sidebar
- **Go to "Collection"**: Jumps to that specific collection 

## Important Notes

- **Manual removal**: For now, highlights and comments must be manually removed from your markdown files by deleting the `==` syntax and footnotes.
- **Collection commands**: If a collection is deleted, the command to jump to that specific collection will remain in the command palette **until reload.** However, it will show (deleted) next to the name of a collection prior to reloading.

## Support

For issues or feature requests, please visit the plugin's repository.

If you find this plugin helpful, consider [buying me a coffee](https://buymeacoffee.com/trevware) ☕
