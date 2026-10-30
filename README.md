# Sidebar Highlights and Tasks

Collect every highlight, comment and task in your vault into one sidebar, then find your way back to them. It works with Obsidian's own markdown: highlights are `==text==`, comments are footnotes, tasks are checkboxes, and nothing is stored in a format only this plugin can read.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/hero-dark.webp">
    <img src="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/hero-light.webp" alt="A note with its highlights listed in the sidebar beside it">
  </picture>
</p>

<p align="center">
  <b>Sidebar Highlights and Tasks is free, and built in my spare time.</b><br>
  If it earns a place in your vault, sponsoring it on GitHub keeps it going.
</p>

<p align="center">
  <a href="https://github.com/sponsors/trevware">
    <img src="https://img.shields.io/badge/Sponsor_on_GitHub-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub" height="40">
  </a>
  &nbsp;
  <a href="https://buymeacoffee.com/trevware">
    <img src="https://img.shields.io/badge/Buy_me_a_coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee" height="40">
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

Hover a highlight in the sidebar to reveal its color picker (on a phone, press and hold it). Your own names for the five palette colors live in **Settings → Color names**, and those names are what the color filter and color groups show.

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

## The Sidebar

Four tabs, each remembering its own filters, grouping and sort:

- **Current note**: highlights in the note you're reading
- **Current folder**: every note in that note's folder, following you as you move around the vault. Widen it to subfolders from the overflow menu. *Hidden by default; enable in Settings → Views*
- **All notes**: the whole vault, paginated
- **Collections**: highlights you've grouped by hand, across any number of notes

Clicking anything takes you to it, in Editing or Reading view. **Follow editor scroll**, in the overflow menu, works the other way round: the sidebar tracks the highlight nearest what you're reading.

The status bar keeps count of whatever the tab you're on is showing, after any search or filter: highlights, native comments and notes, or collections. With the sidebar closed it counts the note you're in, and clicking it opens the sidebar.

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
- **Tags** and **Collections**: the same sets search reaches, picked from a list

Filters and search compose, and the filter button lights up whenever a filter is active, so a narrowed list is never a mystery.

### Grouping and Sorting

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/colors-dark.webp">
  <img align="right" width="300" src="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/colors-light.webp" alt="Highlights grouped by color, under the names Question, Quote and Next step">
</picture>

Group by color, heading, note, folder, collection, comment count or creation date. Group headings fold away, and stay folded across restarts. Sort alphabetically, by source note, or by when a highlight or note was created.

Name your colors and grouping by color reads like a set of labels: the screenshot uses Key idea, Problem, Quote, Question and Next step.

<br clear="right">

### Collections

Collections gather related highlights from anywhere in the vault.

1. **Create** one from the Collections tab
2. **Add** highlights with the collection button on any highlight
3. **Jump** straight to one from the command palette, where each collection gets its own command as you create it

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/collections-dark.webp">
    <img width="400" src="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/collections-light.webp" alt="Two collections, Redesign brief and Interview quotes">
  </picture>
</p>

## Tasks

**Open tasks**, from the ribbon or the command palette, opens a tab with every checkbox in the vault. Each task stays in the note where you wrote it: ticking it, dating it or moving it changes that line, so the note is always the record.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/tasks-dark.webp">
    <img src="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/tasks-light.webp" alt="The Tasks tab on Today, with overdue tasks above today's">
  </picture>
</p>

### Lists

- **Today**: what's overdue, what's due today, and anything in today's daily note. **Reschedule** moves everything overdue in one go
- **Upcoming**: the days ahead, then weeks and months further out
- **All Open**, **In Progress**, **Questions** and **Done**
- Every note with open tasks, grouped by folder, with its tasks under their headings

Each list keeps its own grouping and sorting, and whether it shows completed tasks, under **Display**.

### Adding Tasks

Press **Q**, or the **+** button, and type it the way you'd say it. `Call the dentist fri p1` is due Friday with priority 1, and dates understand things like `tomorrow`, `in 3 days` and `nov 3`. A task added from a note's list goes to that note, otherwise to wherever you added the last one, and typing `/` picks another note or a heading.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/quick-add-dark.webp">
    <img src="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/quick-add-light.webp" alt="Quick add reading a date and a priority out of the task as it's typed">
  </picture>
</p>

### Working With Tasks

- Click the box to complete a task, or ⌥-click it to cancel
- Click a task to highlight it, then click again to open its card: the notes under it, its date, priority and status
- Right-click it (or press and hold on a phone) for everything else: move it under another heading, copy it as Markdown, open it beside the note, delete it
- Drag tasks to reorder them, or onto another heading to move them there
- Undo any change from the message at the bottom, or with ⌘Z
- ⌘K searches tasks, notes and commands, and **?** lists every keyboard shortcut

### In the Sidebar

**Open tasks in the sidebar** puts the same tab in the right sidebar, where it starts on **This Note**: the tasks of whichever note you're reading, under their headings.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/tasks-sidebar-dark.webp">
    <img src="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/tasks-sidebar-light.webp" alt="A project note with its tasks in the sidebar, grouped under the same headings">
  </picture>
</p>

### What Counts as a Task

Standard checkboxes, `- [ ]` and `- [x]`, plus in-progress `- [/]`, cancelled `- [-]` and question `- [?]`. Alternate checkboxes from themes like Minimal show up under their own names. A date anywhere on the line, in the format set under **Settings → Tasks → Due date format**, is the task's due date. A time written right after that date, like `2026-10-30 15:00` or `2026-10-30 3pm`, is the task's time: it shows on the row, sorts the day, and turns red once it has gone by. Metadata written by the Tasks plugin is hidden by default.

## On Your Phone

Everything works in Obsidian for iOS and Android. Swipe in from the right for your highlights, open **Tasks** from the menu, and press and hold a highlight or a task for the menu a right-click opens on a computer.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/phone-tasks-dark.webp">
    <img width="280" src="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/phone-tasks-light.webp" alt="The Tasks tab on a phone">
  </picture>
  &nbsp;&nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/phone-highlights-dark.webp">
    <img width="280" src="https://raw.githubusercontent.com/trevware/obsidian-sidebar-highlights/HEAD/.github/screenshots/phone-highlights-light.webp" alt="A note's highlights in the sidebar on a phone">
  </picture>
</p>

## Settings Worth Knowing

Everything lives under **Settings → Sidebar Highlights and Tasks**.

- **Views**: which of the four sidebar tabs appear, and whether the status bar shows counts
- **Display modes**: save your Display and Views settings as a named mode, and apply it from the command palette
- **Detection**: whether HTML comments and adjacent native comments are picked up
- **Filters**: skip Excalidraw files, or include and exclude specific files and folders from scanning
- **Display**: note titles, timestamps, date format, and a minimum character count to keep stray `==` out of the sidebar
- **Tasks**: the date and time formats your tasks use, and whether Tasks plugin metadata is hidden
- **Typography** and **Styling**: font sizes and weights per element
- **Backup and restore**: automatic backups of your collections and highlight metadata, with a retention limit

## Installation

**From Community Plugins**: Settings → Community Plugins → Browse → search "Sidebar Highlights" → Install → Enable.

**Manually**: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/trevware/obsidian-sidebar-highlights/releases), drop them in `.obsidian/plugins/sidebar-highlights/`, and enable the plugin.

## Notes and Limitations

- PDF highlights aren't supported
- Highlights inside code blocks are ignored on purpose, so `==` in a DataviewJS block won't appear
- Available in English and Chinese (Simplified). The Tasks tab is in English for now
- Screenshots use the [Minimal](https://github.com/kepano/obsidian-minimal) theme with the Nord color scheme

Bugs and feature requests are welcome on [GitHub Issues](https://github.com/trevware/obsidian-sidebar-highlights/issues).

## Support the Project

This plugin is free and always will be. It's built and maintained in my own time, and support is what makes that sustainable.

<p align="center">
  <a href="https://github.com/sponsors/trevware">
    <img src="https://img.shields.io/badge/Sponsor_on_GitHub-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub" height="40">
  </a>
  &nbsp;
  <a href="https://buymeacoffee.com/trevware">
    <img src="https://img.shields.io/badge/Buy_me_a_coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee" height="40">
  </a>
</p>

<p align="center">
  <a href="https://github.com/sponsors/trevware"><b>github.com/sponsors/trevware</b></a><br>
  You can also <a href="https://buymeacoffee.com/trevware">buy me a coffee</a>. Starring the repo helps too, and costs nothing.
</p>
