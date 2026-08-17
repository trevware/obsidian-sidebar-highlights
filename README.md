# Sidebar Highlights

Collect every highlight, comment and task in your vault into one sidebar, then find your way back to them. It works with Obsidian's own markdown: highlights are `==text==`, comments are footnotes, and nothing is stored in a format only this plugin can read.

<p align="center">
  <picture>
    <img src="https://github.com/user-attachments/assets/eebaa062-adee-4bda-b3ce-bdc0a536ecaf" alt="Preview">
  </picture>
</p>

<p align="center">
  <b>Sidebar Highlights is free, and built in my spare time.</b><br>
  If it earns a place in your vault, buying me a coffee keeps it going.
</p>

<p align="center">
  <a href="https://buymeacoffee.com/trevware">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="50">
  </a>
</p>

## Highlights

Select text and choose **Create highlight** from the right-click menu, or run it from the command palette and give it a hotkey. Typing the syntax by hand works just as well.

| Syntax | Notes |
| --- | --- |
| `==text==` | Standard markdown highlight |
| `<mark>text</mark>` | Including the inline-style and CSS-class output of [Highlightr](https://github.com/chetachiezikeuzor/Highlightr-Plugin) |
| `<font color="#835cf5">text</font>` | Hex, shorthand hex and named colors |
| `<span style="background:yellow">text</span>` | Background color is read from the style |
| `%%text%%` | A native Obsidian comment, shown in the sidebar in its own right |

Hover a highlight in the sidebar to reveal its color picker. Your own names for the five palette colors live in **Settings → Color names**, and those names are what the color filter shows.

## Comments

Comments are ordinary Obsidian footnotes, so they survive without this plugin installed.

```markdown
==Standard comment==[^1]

[^1]: Kept out of the way at the bottom of the note

==Inline comment==^[Written right where you are]

==Both at once==[^1]^[and as many as you like]

%% A native comment, standing on its own %%
```

**Settings → Comments** chooses which style the plugin writes by default, and whether deleting a highlight takes its comments with it.

## The sidebar

Five tabs, each remembering its own filters, grouping and sort:

- **Current note**: highlights in the note you're reading
- **Current folder**: every note in that note's folder, following you as you move around the vault. Widen it to subfolders from the overflow menu. *Hidden by default; enable in Settings → Views*
- **All notes**: the whole vault, paginated
- **Collections**: highlights you've grouped by hand, across any number of notes
- **Tasks**: every task in the vault. *Hidden by default; enable in Settings → Views*

Clicking anything takes you to it, in Editing or Reading view. **Follow editor scroll**, in the overflow menu, works the other way round: the sidebar tracks the highlight nearest what you're reading.

### Search

The search box takes text, tags, collections and boolean logic:

| Query | Finds |
| --- | --- |
| `onboarding` | Text in the highlight, or in its note's path |
| `#important` | Highlights tagged `#important` |
| `@work` | Highlights in the "work" collection |
| `#urgent AND @project` | Both at once |
| `#bug OR #feature` | Either |
| `(#critical OR #high) AND security` | Grouped with parentheses |
| `-#archived` | Everything except that tag |
| `"Projects/Acme/reference"` | A quoted phrase, including a folder path |

Start typing `#` or `@` for autocomplete, and use ↑↓ to pick.

### Filters

The filter menu narrows what search alone can't:

- **Type**: highlights and comments together, highlights only, or comments only
- **Colors**: one or several at once, listing only the colors actually present
- **Tags** and **Collections**: the same sets search reaches, pickable instead of typed
- **Status** and **Due date**: in the Tasks tab, covering flagged, complete, overdue, due today and more

Filters and search compose, and the filter button lights up whenever a filter is active, so a narrowed list is never a mystery.

### Grouping and sorting

Group by color, tag, folder, collection, note, comment count or creation date. Group headings fold away, and stay folded across restarts. Sort alphabetically, by source note, or by when a highlight or note was created, plus by priority and due date in the Tasks tab.

### Collections

Collections gather related highlights from anywhere in the vault.

1. **Create** one from the Collections tab
2. **Add** highlights with the collection button on any highlight
3. **Jump** straight to one from the command palette, where each collection gets its own command as you create it

## Tasks

The Tasks tab collects every checkbox in the vault: `- [ ]`, `- [x]`, plus in-progress `- [/]`, cancelled `- [-]` and question `- [?]`.

- Set due dates in natural language, like "tomorrow", "next Monday" or "+3d"
- Group by due date with readable headings: Today, Tomorrow, weekday names, months
- Flag what matters, and filter by flag, status or date
- See each task's context, the indented lines beneath it, without leaving the sidebar
- Metadata written by the Tasks plugin is hidden by default, in either the Dataview or emoji style

## Settings worth knowing

Everything lives under **Settings → Sidebar Highlights**.

- **Views**: which of the five tabs appear
- **Display modes**: save your Display and Views settings as a named mode, and apply it from the command palette
- **Detection**: whether HTML comments and adjacent native comments are picked up
- **Filters**: skip Excalidraw files, or include and exclude specific files and folders from scanning
- **Display**: note titles, timestamps, date format, and a minimum character count to keep stray `==` out of the sidebar
- **Typography** and **Styling**: font sizes and weights per element
- **Backup and restore**: automatic backups of your collections and highlight metadata, with a retention limit

## Installation

**From Community Plugins**: Settings → Community Plugins → Browse → search "Sidebar Highlights" → Install → Enable.

**Manually**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/trevware/obsidian-sidebar-highlights/releases), drop them in `.obsidian/plugins/sidebar-highlights/`, and enable the plugin.

## Notes and limitations

- PDF highlights aren't supported
- Highlights inside code blocks are ignored on purpose, so `==` in a DataviewJS block won't appear
- Fully localized in English and Chinese (Simplified)

Bugs and feature requests are welcome on [GitHub Issues](https://github.com/trevware/obsidian-sidebar-highlights/issues).

## Support the project

This plugin is free and always will be. It's built and maintained in my own time, and support is what makes that sustainable.

<p align="center">
  <a href="https://buymeacoffee.com/trevware">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="50">
  </a>
</p>

<p align="center">
  <a href="https://buymeacoffee.com/trevware"><b>buymeacoffee.com/trevware</b></a><br>
  Starring the repo helps too, and costs nothing.
</p>
