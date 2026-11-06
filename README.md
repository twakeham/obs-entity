# Obsidian Entities

Define your own entity types (people, organisations, places, projects… or anything else) with typed fields and relationships, then create, find and browse them as ordinary Markdown notes.

Derived from the Story Forge worldbuilding plugin, made domain-neutral. The full design is in [docs/DESIGN.md](docs/DESIGN.md).

## Status

| Milestone | Scope | Status |
|---|---|---|
| M1 Foundation | Settings with groups and types, starter pack, create dialog, convert, find entity, per-type commands, import types | ✅ Done |
| M2 Relationships | Inverse links, info card (since replaced by the properties form), Connections panel, add/remove links with Undo | ✅ Done |
| M3 Entity Types view | Visual editor for types and groups: fields, relationships, display, drafts, note migrations, previews, import/export | ✅ Done |
| M4 Browser | Grouped, hierarchical entity browser with filters | ✅ Done |
| M4.5 Properties form | A form that replaces Obsidian's Properties on entity notes, so only values the type allows go in, and problems are flagged | ✅ Done |
| M4.6 Entity views | Saved, named table and board views over entities, stored as notes: columns, roll-ups, formulas, filters, sorting, grouping, editing in place, kanban boards with drag and drop | ✅ Done |
| M7.1 Workflows, stage 1 | Automation: when a note is created or a field changes, or from a button, set fields, tags and links or show a notice; the Workflows view, run log and undo | ✅ Done |
| M7.2–M7.3 Workflows, stages 2–3 | Steps on linked notes, creating notes, form workflows; schedules and date triggers | Planned |
| M5 Packs & polish | Pack picker on first run, accessibility, docs | Planned |

## How notes are stored

An entity is a normal note whose frontmatter names its type:

```yaml
---
entity: project
status: active
order:
description: Land on the moon.
owner: "[[Ada Lovelace]]"
team: []
due: 2027-03-31
related: []
tags: []
---
```

- **Fixed properties:** `entity`, `status`, `tags`, `aliases`, `related`, `order`. Everything else comes from the type's fields.
- **Relations** are wikilinks, so backlinks, the graph and renames keep working. Labelled relations put the label in the alias: `"[[Grace Hopper|mentor]]"`.
- **Dates** are stored as ISO (`YYYY-MM-DD`) and shown in the field's **display format**, or the **Date display format** setting (DD/MM/YYYY to start with). In the properties form, the create dialog and the type editor, clicking a date field opens a **calendar** under it while you can still type a date; the calendar follows what you type. Click a day to pick it; **Today** and **Clear** are at the bottom, and clicking the month title switches to a month / year view. **Alt+↓** opens the calendar from the keyboard; **Esc** closes it (a second Esc cancels your typing).
- **Display formats** (Fields tab → **Display format**) change how a value looks, never what's stored:
  - **Dates:** presets such as 05/12/2026, 5 Dec 2026, Thursday, 5 December 2026, December 2026 or **Relative** ("in 3 days"), or a custom moment.js pattern. Clicking in shows the date in its format when it can be typed back (a day, month and 4-digit year), otherwise as YYYY-MM-DD; either way you can type ISO.
  - **Numbers:** separators (1,240.5), whole number, 2 decimals, **Currency** ($1,240.50, the Default currency setting or a code), percent (45%), compact (1.2K), or a pattern such as `#,##0 h`. Clicking in shows the plain number; typing `$1,240.50` or `45%` is tidied up to the number.
  - **Checkboxes:** a checkbox, Yes / No, or ✓ (read-only places; editing is always a checkbox). **URLs:** the full address, the domain only, or your own text (clicking still opens the address).
  - Formats show in the properties form, Reading view, the subtitle (pickers, Find entity, chips), tables and boards (as the column's default; a view's **Format…** overrides it) and the type editor's preview.
- **Property types:** the plugin tells Obsidian which editor to use in its Properties block (used when the properties form is off, and in hover previews and the File properties sidebar):
  - date fields get Obsidian's date picker
  - number fields get a number editor, and checkboxes a checkbox
  - list, multiple-choice and multi-link fields (plus `related`) get a list editor
  
  This is stored in the vault's `.obsidian/types.json`. Obsidian's property types are vault-wide by name, so a key that two types use for different kinds is left alone.
- There is no shared summary property. Each type picks **subtitle fields** (`card.subtitle`), whose values are shown under the name in pickers, search and the properties form, e.g. a person's role.

## Properties form

On entity notes, a form built from the note's type replaces Obsidian's Properties block. It appears in Live Preview, and in Reading view, where it's read-only until you click the pencil. Source mode still shows the raw YAML. Turn **Use the entity properties form** off in settings to get Obsidian's Properties back.

**Layout:**
- **Top row:** type, a **status** dropdown (only the group's statuses), the subtitle, a problem count, and buttons for the Connections panel, a **⋯** menu (Change type…, Configure the type) and collapse.
- **One row per field,** in the type's order, then Related, Tags and Aliases. Required fields have a `*`. Empty fields show a faint "Empty", or are hidden behind "Show N empty fields" if the type's **Hide empty fields** option is on (Display tab).
- **Custom layouts:** a type can arrange its form in captioned **frames** (optionally collapsible), **columns** (2–4, with relative widths) and **tabs**, with headings and notes between them.
  - Columns at the top level or in a tab can hold frames, to put frames side by side. Columns stack in narrow places such as the sidebar.
  - A form can have several tab groups. The last tab you opened is remembered for each type, a tab with a problem shows a dot, and "N problems" opens the right tab.
  - Status, Related, Tags and Aliases can be placed too. Fields that aren't placed appear under **Other fields** at the end.
  - **The note itself:** its **Name** (shown large; editing it renames the note) and, read-only, its **Type** (click to change type), **Subtitle**, **Type + subtitle**, **Created** and **Modified** (date and time; hover for how long ago). Their labels are hidden unless you turn them on. Placed, the type and subtitle leave the form's top line. In the create dialog, a placed Name moves the Name box there.
  - **Per slot**, for this form only: a custom label, or no label; placeholder text; help text under the value (the field's description, or your own); a fixed height for long text; and **read-only** (shown with a lock, not editable on notes, though the create dialog, views and bulk edits can still set it).
  - **Frames** can have an icon, an accent colour (the type's or one from the palette), a style (Box, Plain with no border, or Filled) and a coloured **header** bar behind the caption: Soft (a tint) or Solid (the full colour, with white or dark text to suit). The header uses the accent colour, or the type's if there isn't one.
  - **Show only when…:** a frame, tab or field can show only when the note's own values match, e.g. a "Risk details" frame when Likelihood is High. Conditions work like view filters (all or any of them). They update as you edit, in the create dialog too. Values in hidden fields are kept.
    - A required field that's hidden isn't required until it shows again.
    - If a hidden field has another problem, "N problems" shows it, marked "Normally hidden".
  - The create dialog uses the same layout: frames and tabs can be left out of it (they appear with "Show more fields"), and required fields are always asked for.
  - Layouts are designed by drag and drop on the type editor's **Layout** tab.
- **Other properties:** a collapsed section for keys the type doesn't define, each edited by its Obsidian property type. It's only shown when the note has some.
  - **+ Add property** in the section, or **Add other property…** in the form's **⋯** menu, adds a key.
  - A key's **⋯** menu offers **Add to the *type* type**, which opens the type editor with a draft field, or **Remove**.

**Entering values:**
- **Only valid values go in.** Text, numbers and dates save when you leave the box or press Enter, and Esc cancels. A number that isn't a number, or a date that doesn't exist, isn't saved; a notice says why.
- **Other fields save immediately:** checkboxes, choices, chip lists, and links.
- **Choices** work like link fields: the value is a pill (× clears it; click it to pick another), and an empty field has a "Choose…" box that opens the choices as pills (type to filter, ↑/↓ and Enter to pick). Multiple choice shows its pills plus an "Add…" box offering the choices not yet picked. The same control is used in the create dialog and when editing a table cell.
- **Link fields** show each entity as a coloured chip with a **×** inside to remove it. They only offer entities of the allowed types, with **Create "X"**.
  - A single-link field with a link set shows just the link. Remove it with its × (or Delete on the focused link) and the picker appears, ready to type in.
  - Labelled fields ask for the label.
  - Fields that read both ways also show links set on the other note (dotted border).
- **Undo:** **Ctrl/Cmd+Z** in the form undoes the last form edit on that note, up to 20 steps. Removing a link or property also shows a notice with **Undo**.
- **Keyboard:** in chip rows, ←/→ move between chips, and Backspace or Delete removes one.

**Problems:**
- Values set elsewhere (Source mode, sync, other plugins) are never changed silently. Instead they're checked: a wrong kind of value, a choice or status that isn't allowed, a single value where a list is expected, a link to the wrong type of entity, a link written as plain text, an empty required field, or a value that breaks one of the field's validation rules (see Entity types view → Fields).
- A problem outlines its row in red (or orange for warnings), with a tooltip and a one-click **Fix** where there is one (e.g. "Make it a number", "Remove the link").
- **Check entities** lists every note with problems.

**Change type…** keeps all values. Fields the new type doesn't use move to Other properties, and the status is reset if the new group doesn't have it. If the new type's folder is elsewhere, the notice offers to move the note.

## Starter pack

Installed on first run:

| Group | Statuses | Types |
|---|---|---|
| Directory | draft, active, archived | Person, Organisation, Place |
| Work | idea, active, on-hold, done | Project, Note |

Hierarchies:
- Places nest under places, and organisations under organisations (`part_of`).
- Projects nest under projects (`parent_project`), and notes nest under projects (`project`).

## Folders

One setting decides where every entity goes: **Entity folder**, default `Entities/{group}/{entity}`.
- `{group}` is the group name and `{entity}` is the type's plural name, so Ada goes to `Entities/Directory/People/Ada Lovelace.md`.
- The settings tab previews the folder for every type and flags unknown placeholders.
- Existing folders are matched regardless of case, so `entities/{group}/{entity}/` still uses an existing `Entities/` folder.
- **Folder exceptions:** give a type its own pattern (same placeholders), e.g. Person → `Contacts/{entity}`. Use **Add exception** under the Entity folder setting. Types without one follow the main pattern.

Some types also have a **folder rule**:
- **Own folder** (Project): each project gets its own folder, e.g. `…/Projects/Apollo/Apollo.md`. A sub-project's folder goes inside its parent project's folder.
- **Parent folder** (Note): a note goes in `<its project's folder>/Notes/`, or follows the pattern if it has no project.

To add types, use the **Entity types** view (below), or run **Import entity types…** and paste a type pack. The import dialog can load the Basic CRM example.

## Entity types view

Opened from:
- the **shapes** ribbon icon
- **Configure entity types** (opens the open note's type)
- the settings tab
- the file menu: **Configure the Person type**

**Sidebar:** types are listed under their groups.
- **Click a group heading** to edit the group. Drag headings to reorder groups.
- **+ New** offers a type, a duplicate of the current one, a group, **Import pack…**, or **Copy all types as a pack**.

**Type editor tabs:**
- **General:** name, plural, key (fixed once saved), icon, colour, group, statuses (the group's or custom), folder (the entity folder pattern or the type's own exception), folder rule (in the folder / own folder each / inside its parent, with a path preview), template, search shortcuts. Also Duplicate, Copy as JSON, Reset to starter, and Delete type.
- **Fields:** a field list (drag to reorder) and a details panel for the selected field, in three tabs (a field always opens on General):
  - **General:** kind (at the top), label, key, description, default, and show in the create dialog.
  - **Choices**, **Relation**, **Roll-up** or **Formula** (only for those kinds): the kind's own settings: the choices; what a relation links to and how; or what a calculated field works out, with its result and a preview.
  - **Coloured choices:** on the Choices tab, click a choice's dot to give it a colour (red, orange, yellow, green, blue, purple, pink or grey; they follow the light / dark theme), or **Default** for a darker grey. Choices always show as pills, tinted with their colour (or grey): in tables, board cards, bucket and group headings, the properties form and Reading view, and in filter and highlight panels.
  - **Choices with values:** turn on **Each choice has a value** on the Choices tab and type a number in each choice's box (e.g. Low 1, Medium 2, High 3). Notes still store the choice ("High"); the number is used by formulas (`value([Priority])`; for multiple choice, the total of the chosen values), roll-ups (sum, average, smallest, largest), sorting (by value rather than choice order) and the summary row (sum, average, median…). Changing a value needs no note changes. The value shows in the choice dropdown and in each pill's tooltip ("High = 3"); **Show values on pills** makes pills read "High: 3".
  - **Display:** the **display format** (numbers, dates, checkboxes, URLs, and calculated fields that give one of those; each preset shows an example from your notes).
  - **Validation:** required, and the validation rules below. The tab shows how many are set.
  - **Default:** a fixed value, or a smarter one:
    - **Relative to today** (dates): `today`, `today+14d`, `today-1w`, `today+1m`, `today+1y`. The editor shows the date it gives today.
    - **From a linked note:** e.g. a task's Client from its Project's Client. The create dialog fills it in as soon as the project is chosen (and again if you change it), unless you've typed in the field yourself. This is the only kind of default for relation fields.
    - **The next number** (text and number fields): one more than the highest number used by the type's notes, in a pattern such as `TASK-{n}` with a number of digits (TASK-0042). The create dialog shows it as the placeholder and takes it when the note is created.
    - Defaults only fill in new notes.
  - **Validation** (the Validation tab). Breaking a rule never stops a note being saved: the value is flagged as a problem in the properties form and with a marker in tables and boards. The create dialog shows problems as you type and won't create the note until they're fixed.
    - **Numbers:** a range (leave a box empty for no limit) and whole numbers only.
    - **Text, long text and URLs:** a length range, and a pattern (a regular expression) with your own message for when it doesn't match, plus a box to test it.
    - **Dates:** earliest and latest, as a date or relative to today (`today`, `today-1y`, `today+2w`), and before / after another date field (e.g. End on or after Start).
    - **Lists, multiple choice and multi-link fields:** how many items.
    - **Unique:** no other note of the type has the same value (e.g. a code or email).
    - **Required when:** required only while a condition holds (e.g. Lost reason when Status is Lost); the field gets a `*` and the create dialog asks for it.
  - Kinds: text, long text, number, date, choice, multiple choice, list, checkbox, link (URL), relation, and two **calculated** kinds (below).
  - **Calculated fields** are worked out whenever they're shown and never written to the note:
    - **Roll-up:** from linked notes. **From** (this type's relation fields, or notes of another type that link here, e.g. "Tasks (linking here)"), **Calculate** (count, names, unique values, sum, average, smallest, largest, earliest, latest, % done, count by status) and **Of field**, which can be a calculated field of the linked notes too. E.g. Project → "Estimate total" = sum of the tasks' Estimate. **Only include** narrows the linked notes with the same conditions as view filters (on their fields, status, tags, dates…): e.g. "Open tasks" = count of tasks where Status is none of done, or "Hours this sprint" = sum of Estimate where Sprint is Sprint 3. The panel says it in words ("Only tasks where Status is any of done").
    - **Formula:** from this note's fields, built-ins and other calculated fields, in the same formula language as view formula columns (**Edit formula…** opens the same editor, with autocomplete and a live result). E.g. "Days left" = `[Due] - today()`, or "Budget per task" = `[Budget] / [Task count]`.
    - The details panel shows what the field **gives** (a number, a date, true / false…), a **preview** for the sample note, and (Display tab) a **Display format** for numbers, dates and true / false. Loops (A uses B, B uses A) and missing relationships are flagged.
    - They're read-only in the properties form and Reading view (placeable in layouts like any field; a value that can't be worked out shows "—" with the reason on hover), can be in the subtitle, and are ordinary **columns** in tables and boards (sort, filter, group, highlight, summarise, format). Views keep their own roll-up and formula columns too. They're left out of the create dialog. If notes have their own property with the same name, it's ignored (the details panel says how many do).
- **Relationships:** a diagram, links from and to this type (click to jump to the field), and a guided **Add relationship** dialog with a plain-English summary.
- **Display:** parent fields (for the hierarchy), subtitle fields, and the properties form's **Hide empty fields** option.
- **Layout:** design the properties form and create dialog by drag and drop.
  - **Palette** (left): the type's fields, the built-in properties (with the note's Name) and the read-only items (Type, Subtitle, Type + subtitle, Created, Modified); placed ones are greyed (click one to find it); and the components: Frame, 2/3/4 columns, Tabs, Heading, Text. Drag one onto the layout, or click it to add it next to what's selected. Click a section's heading (Fields, Properties, Read-only, My components, Layout) to fold it away; a folded heading shows how many of its items are placed. Folded sections are remembered per type on this device.
  - **Layout** (middle): looks like the form. Drag things to move them; a line shows where they'll land. Drag one back to the palette, or press Delete, to remove it (fields go back to the palette).
    - Drag frames into columns to put them side by side.
    - **Tabs:** click a tab to edit what's in it, **+** adds one, drag a tab along the strip to reorder it, and hover over a tab while dragging to open it (or drop on the tab itself).
  - **Settings** (right) for what's selected: a frame's caption, "Can be collapsed", "Starts collapsed" and "Show in the create dialog"; the number of columns and their relative widths; a tab's caption, icon and "Show in the create dialog"; a tab group's tabs (reorder, add); a field's label (above, beside or hidden), custom label, placeholder, help text, height (long text) and read-only; a frame's icon, accent colour, style and header; **Show only when** conditions for frames, tabs and fields (the canvas shows an eye badge with a summary); heading and text. With nothing selected: **Hide fields that aren't placed**.
  - **Keyboard:** Tab or ↑/↓ to move between items, Alt+↑/↓ to move the selected one, Delete to remove it, the context-menu key or ⋯ for **Move to…** and **Add field here…**, Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z to redo. On a tab: ←/→ switches tabs, Alt+←/→ moves the tab.
  - **Copy and paste:** Ctrl/Cmd+C / X / V copy, cut and paste the selected item with everything inside it (a frame with its columns and fields, a tab group, a single tab…), and Ctrl/Cmd+D duplicates it; the ⋯ / right-click menu has the same. A paste goes where a palette click would (a tab into the selected tab group). Copies go through the clipboard, so you can paste into another type (or vault):
    - fields are matched by key, then by label;
    - fields the type doesn't have are left out, with **Add them** in a notice (they're added to the type, where the copy had them);
    - fields already on the layout: you're asked whether to **move them here** (with the copied label and options) or leave them out. A duplicate always leaves them out, so duplicating a frame gives a styled copy to fill.
  - **My components:** ⋯ → **Save as component…** saves an item (with a name and icon) to the palette's **My components**, for every type in the vault. Drag or click one to add it (the paste rules above apply). Right-click one to edit its name and icon, replace it with the selection, copy it, or delete it.
  - **Start from fields** puts every field in one frame. **Reset layout** goes back to the plain list. Changes are part of the type's draft, so Save or Discard them as usual.

**Preview:** shown in the side panel (right sidebar) while the editor is the active tab; open or close it like any sidebar panel (its tab icon, the ribbon icon or the **Open side panel** command). Switch between **Dialog** (the create dialog), **Picker** (the link-picker row) and **Form** (the properties form). It updates as you edit, before you save, and uses the existing note with the most values, or made-up values.

**Saving:**
- Edits are drafts until you press **Save**. Drafts survive switching types.
- While there are unsaved changes, the top right of the editor shows "Unsaved changes" with **Discard** and **Save** (groups too).
- Problems are shown next to the control, and the tab with a problem gets a red dot.
- Renaming a field key offers to **update existing notes** (on by default). Deleting a field offers to **remove its values** (off by default). These options appear in a short confirm dialog when you press Save, only when existing notes would be affected.
- Subtitle and parent references follow a key rename automatically.

**Groups:**
- You can edit the name, icon and statuses. Statuses can be reordered by dragging, and the first is the starting status.
- **Status colours:** statuses are coloured by name by default (done green, active / in-progress blue, on-hold / blocked orange, archived faint). Click the dot next to a status (in the group editor, or a type's own statuses on its General tab) to pick another colour, or **Default** to go back. A type's own colours win over its group's. They show wherever statuses do: pills in tables and on boards, the properties form's status, and the browser's dots.
- Renaming a status offers to update the notes that use it.
- A group can only be deleted once it has no types.

**Deleting a type** leaves its notes untouched (they keep `entity: <key>`). Deleted starter types don't come back on update.

## Entity browser

A left sidebar tree of all entities. Open it with the **library** ribbon icon or **Open entity browser**.

**Layout:**
- One section per group, with a heading per type.
- Entities nest under their parent, using the type's parent fields, e.g. Lander and Design review under Apollo Moonshot.
- The **View** menu (sliders button) changes this:
  - **Sections:** groups, or none (one tree).
  - **Type headings:** on or off.
  - **Children in other groups:** stay in their own group, or nest under their parent.
  - **Show empty types.**

**Rows:**
- Each row shows the type icon, the name, a child count and a status dot. The subtitle shows as a tooltip.
- **Click:** opens the note. Ctrl/Cmd-click or middle-click opens it in a new tab, and Ctrl + hover shows a preview.
- **Right-click:** Open in new tab / to the right, **New *child type* here** (prefills the parent link and the folder), Show connections, then the usual file menu.

**Headings:**
- **+** on a type heading creates that type. On a group heading it offers the group's types.
- **Right-click** a type heading for "Configure the *type* type", or a group heading for "Configure group".

**Toolbar and filters:**
- **Toolbar:** search, View, Collapse all, Expand all and New entity.
- **Filters:** Type, Status and Tag dropdowns.
- **While filtering**, matches stay inside their hierarchy: parents that don't match are dimmed. A bar shows the match count and **Clear**.
- **Collapsing while filtering** is temporary, so clearing the filter brings back your normal layout.

**Following the open note:** the browser expands to the open note once, without undoing anything you collapse afterwards. Options, filters and expanded rows are remembered.

## Entity views

A view is a saved, named table (or board or calendar, see Boards and Calendars) of entities. It's an ordinary note in the **views folder** (default `Entities/Views`, set in settings). The definition lives in an `entity-view` code block, so the view syncs and opens anywhere; without the plugin you see the readable definition:

````markdown
```entity-view
kind: table
types: [project]
columns: [name, status, owner, due, { rollup: { via: "in:note.project", agg: count }, label: Notes, id: notes }]
sort: [{ by: due, dir: asc }]
filters: { all: [{ field: status, op: any-of, value: [idea, active] }] }
```
````

**Creating and opening views:**
- **New entity view** (command, the + on the browser's **Views** section, or "New table view of …" / "New board of …" / "New calendar of …" on a type or group heading): pick what it shows, Table, Board or Calendar, name it, and the note is created.
- **Open entity view…** lists the view notes. The browser shows them at the top.
- **Embed** a view in any note with `![[Active projects]]`, or paste the block anywhere.

**Toolbar:**
- **Search:** a quick filter on name, aliases and subtitle. It isn't saved.
- **Filters:** conditions combined with **all** or **any**, plus a nested group, e.g. "status is active AND (owner is Ada OR team has Ada)".
  - The operators suit each column: contains / is, < >, before / after / between, is any of, has any / all / none of, links to, link count…
  - Dates also accept `today`, `-7d`, `+2w` or `1m`.
  - **This note:** for a link column (e.g. Project, or an incoming link), **links to any / none of** can pick **This note**: the note the view is shown on. Embed a Tasks view filtered by "Project links to any of This note" in your project notes and each shows its own tasks; **+ New** there links the new task to that project. It also works in highlight rules. When the view note is opened on its own there's no "this note", so the condition is ignored (the Filters button turns orange, and the panel says why).
  - A condition that's missing its value (or has a number or date that can't be read, or a column that's gone) is **ignored** until it's fixed. The panel notes why under it, and the Filters button turns orange to remind you.
- **Sort:** any number of levels, which can be dragged to reorder. Clicking a header sorts by it (ascending, descending, off), and Shift-click adds a level.
  - Statuses sort in their group's order, text sorts naturally ("Chapter 2" before "Chapter 10"), and empty values go last.
- **Group:** any number of levels, e.g. status, then assignee, then due by month. Each level groups by status, type, a choice, a link, a list, or a date by day / month / year. Levels can be dragged to reorder in the Group panel; right-click a header → **Group by X** adds a level.
  - Each group has a collapsible header (indented per level), labelled "Field: value" (e.g. "Status: todo"; turn off with **Show field names in group headers**), with a count and the group's column summaries (turn off with **Show summaries in group headers**). Row names are indented under their group.
  - Grouped columns are hidden from the table while grouped, since their value is in the group header.
  - The checkbox on a group header selects every row in that group, sub-groups included.
  - Right-click a group header to collapse or expand all groups at that level.
- **Highlight:** conditional formatting rules, see below.
- **Columns:**
  - the source types' fields
  - built-ins: type, status, tags, aliases, related, folder, created, modified
  - hierarchy built-ins (when a type has parent fields, the ones the browser nests by): **Parent** (e.g. Portal beta release for the task Accessibility review: the first of the type's parent fields that links to an entity), **Top-level parent** (the top of that chain, e.g. Mobile Banking App) and **Ancestors** (the whole chain as links, "Mobile Banking App › Customer Portal Rebuild › Portal beta release"). They're read-only (change the Milestone / Project field itself) and work for filters ("Parent links to …", including this note), sorting, grouping, swimlanes, highlight rules, card fields and formulas (`[Parent]`).
  - **incoming links**, e.g. "People" on organisations
  - **roll-ups**
  - Drag headers to reorder, and drag their edges to resize. Double-click a header's edge (or right-click → **Auto-fit width**) to fit the column to its contents; **Auto-fit all columns** fits them all.
  - Right-click a header → **Fill available width** to make that column stretch to use the spare width, e.g. a long Description or Mitigation column. Its width becomes a minimum: in a narrow pane it stays at that width and the table scrolls.
  - Right-click a header → **Freeze** to keep that column and everything to its left in view while scrolling sideways. Choose it again to unfreeze.
  - Right-click a header → **Wrap text** to let long values (text, links, tags) wrap onto more lines, e.g. a Mitigation or Description column. Rows grow to fit, up to 5 lines by default; longer text ends in "…" and shows in full when you hover over the cell.
- **⋯:** Save as…, Rename, Edit definition, Copy block.
  - **Compact rows**, **Normal rows**, **Comfortable rows:** the row height (26, 34 or 44px), to fit more rows on screen or give them more room.
  - **Wrapped text: up to N lines…:** how many lines a wrapped cell can show: 2, 3, 5, 10 or Unlimited.

**Formats:** a field's own display format (Fields tab) is the column's default; dates without one use the **Date display format** setting. Right-click a number or date column's header → **Format…** to override it for this view (on a board: **Card fields** → the # / calendar button next to the field); **Default** goes back to the field's.
- **Dates:** presets (2026-12-15, 15 Dec 2026, 15 December 2026, Tue 15 Dec, Tuesday, 15 December 2026, 15/12/2026, December 2026…), **Relative** ("in 6 weeks"), or any moment.js pattern such as `D MMM YYYY`.
- **Numbers:** Number (320,000), Integer, 2 decimals, **Currency** ($320,000.00, using the **Default currency** setting, or e.g. `currency:USD`), Compact (320K), Percent, or a pattern such as `$#,##0.00` or `#,##0 h`.
- Formats only change what's shown: sorting, filtering and editing use the real value.

**Summaries:** a summary row stays at the bottom of the table. Click a column's summary cell, or right-click its header → **Summarise…**, to choose an aggregation. Click the ticked one again, or **None**, to turn it off.
- **Any column:** count, empty, filled (8/12), % filled, unique values.
- **Numbers:** sum, average, median, min, max, range. These use the column's format, e.g. "Sum $1,240,000.00".
- **Dates:** earliest, latest, range (e.g. "4 months").
- **Checkboxes:** checked, unchecked, % checked.
- **Status and choices:** a count of each value ("3 todo · 2 done") or the % of one value.
- **Lists and links:** total values.
- Summaries cover the rows the view shows (after filters and search). When the view is grouped, each group's header shows that group's summaries too.

**Highlight rules** colour the rows or cells that match conditions, e.g. overdue tasks in red, or "Critical" priorities in bold red.
- **Highlight** in the toolbar lists the rules. **+ Add rule**, or right-click a header → **Highlight cells…** for that column.
- Each rule has:
  - an optional name
  - what it applies to: the whole row, or one column's cells
  - conditions, built like filters, which can use fields that aren't shown
  - a style: fill colour, text colour, bold / italic / strikethrough, and an optional icon
- The colours come from the theme, so they work in light and dark mode.
- **The first matching rule wins:** drag rules to reorder them. A cell rule sits on top of the row's rule. What it leaves unset (e.g. no fill) comes from the row's rule.
- Rules can be switched off without deleting them. Each rule shows how many rows it matches.

**Data bars and colour scales** are two more kinds of rule for number and date columns: **Highlight → Data bar / Colour scale**, or right-click a header → **Data bar…** / **Colour scale…**.
- **Data bars** draw a bar behind each value: Budget, Estimate (h), % done. You can set the colour, a gradient, or bars only. Negative numbers draw leftwards in red.
- **Colour scales** shade each cell between two or three colours. Presets include red → yellow → green and green → yellow → red. For example, Days left can go from red (overdue) to green.
- **Ranges:** each end is automatic (from the rows shown), a fixed number or date (`today`, `+30d`), or a percentile (`p90`). An optional condition limits which rows get the bar or colour.

**Roll-ups** summarise the notes linked to each row, through an outgoing field or an incoming link: count, names, unique values of a field, sum / average / min / max of a number, earliest / latest date, % done, or count by status. E.g. "Notes: count" on projects, or "Deals: sum of value" on companies. A type's own roll-up and formula fields are ready-made columns, so a view only needs its own for something specific to it.
- **Only include** (in the roll-up dialog) limits which linked notes count, with the same conditions as the view's filters: e.g. "Deals: sum of value" only where Status is won. The automatic label ends in "(filtered)" and the header's tooltip says what it counts ("Sum of value of Deals where Status is any of won"). A filtered count counts only notes that exist and match. In a view, **This note** works here too: a People view embedded on a project page can count each person's tasks *for that project*.
- Counts and sums can be **shown as a share**: **% of total** (each row's share of the column's total, e.g. "this person has 18% of the hours") or **% of group total** (of its group, or swimlane on a board). Set it with **Show as** in the roll-up dialog, or right-click the header → **Show as % of total**. Shares sort, filter, highlight and take data bars like any number; formulas still see the count or sum itself.

**Editing:**
- Double-click a cell, or press Enter on it, to edit it with the same control and rules as the properties form. Checkboxes toggle with one click.
- **Ctrl/Cmd+Z** undoes the last cell edit or bulk action.
- Arrow keys move between cells.
- **+ New** creates an entity of the view's type, prefilled from simple filters (e.g. status = active).

**Bulk actions:** tick rows (Shift-click for a range, a group's checkbox for the whole group, Space for the focused row, Ctrl/Cmd+A for all). The toolbar then shows what you can do with them:
- **Set field…:** one value for status, tags or any field the selected types have, using the form's controls. **Clear** empties it. Entities without the field, or whose type can't have the status, are skipped.
- **Links…:** add links to one or more entities, or remove links (ticked from those the selection has).
- **Tags…:** add tags, or remove existing ones.
- **Change type…**
- **Delete…:** to the trash, after confirming.
- **⋯:** Move to folder…, Duplicate ("Name (copy)"), Open in new tabs, Copy as list of `[[links]]`.

Right-click a selected row for the same actions; Esc clears the selection, and Delete deletes it (after confirming). Each action is **one undo step**: Ctrl/Cmd+Z in the table, or **Undo** on the notice. Moves go back and duplicates are removed. Deleted notes can be restored from the trash.

**Saving:** changes to columns, filters, sorting and grouping are saved into the block automatically, held while a panel is open. Large views stay fast: only the visible rows are drawn.

**Formula columns** calculate a value for each row: **Columns → Add formula…**. For example:
- `[Due] - today()` gives the days left.
- `[Budget] / [Tasks]`
- `if([Status] = "done", "✓", "")`
- `dateDiff([Start], [Due], "weeks")`
- `join(map([Team], name(item)), ", ")`
- `prop([Project], "Due")` reads a field of the linked project.

The editor:
- **Colouring and checks:** syntax colouring, matching brackets, and errors underlined as you type.
- **Autocomplete:** type `[` for columns, or start a function name.
- **Help:** hover help on functions and columns, and a searchable reference panel.
- **Preview:** the results for the first rows.
- **Result type:** worked out automatically, or chosen yourself.
- **Saving:** Ctrl/Cmd+Enter saves.

In the table, formulas sort, filter, group, highlight, summarise and format like any other column. A row whose formula fails shows "–" with the reason in a tooltip. Double-click a formula cell, or right-click its header → **Edit formula…**, to change it.

Functions: logic (`if`, `ifs`, `and`, `or`, `not`, `empty`, `coalesce`), maths (`round`, `floor`, `ceil`, `abs`, `min`, `max`, `sum`, `avg`, `pow`, `sqrt`, `mod`, `number`, `value`: a choice field's value), text (`concat`, `text`, `upper`, `lower`, `trim`, `len`, `left`, `right`, `mid`, `replace`, `contains`, `startsWith`, `format`), dates (`today`, `date`, `year`, `month`, `day`, `weekday`, `dateAdd`, `dateDiff`, `startOf`, `endOf`), lists (`list`, `count`, `first`, `last`, `join`, `includes`, `unique`, `sort`, `map`, `filter`) and links (`name`, `prop`).

**Full-tab views:** opening a view note shows it as an **entity view** tab: the table fills the whole tab, edge to edge, like the Entity types editor.
- **Open as Markdown** (header button or ⋯) shows the note itself, e.g. to edit the definition or write notes below the block. **Open as entity view** switches back.
- The setting **Open view notes as entity views** turns this off.
- A view embedded in another note (`![[View]]`) stays inline, filling the note's width: the embed's left border and indent are dropped. (An embedded note that has other content besides the view keeps the usual embed look.)
- **Bare:** `![[View|bare]]` hides the view's toolbar and the footer (+ New, the count), leaving the table or board (the summary row and any warnings stay). Selecting rows brings the toolbar back for the bulk actions. Options combine: `![[View|wide bare]]`.
- **Full width:** the ↔ button next to the embed's open-link button widens it to the whole pane (with a small gap each side), and back. It's saved in the embed link as `![[View|wide]]`, so each embed remembers its own width; you can also type `|wide` yourself. In Live Preview the change can be undone like any edit. It keeps any other options (`bare`).

### Boards

Any view can also be shown as a **board**: cards in **buckets**, one per value of a field, like a kanban by status. Use the **Table | Board** toggle next to the search box. The note keeps both layouts' settings, so switching back and forth loses nothing; it opens in whichever was used last, and the browser shows a board icon for boards. (Want two independent views? Use ⋯ → **Save as…**.) **New entity view** asks for Table or Board, and type headings in the browser have "New board of …".

- **Buckets** (toolbar): status, or one of the entities' own choice, checkbox or single-link fields, e.g. Priority, Done, Assignee or Project. Every status or choice gets a bucket, even an empty one, plus "No …" for cards without a value.
  - **Read-only buckets:** the built-ins **Type**, **Folder**, **Created** and **Modified** (by month, newest first), and **Parent**, **Top-level parent** and **Ancestors** can be buckets too, listed under "Built-in (read-only)". The board can't change them, so it's a read-only board: cards can't be dragged to another bucket (they can still be reordered within one), and the Buckets panel and toolbar button warn about it. Only values in use get a bucket. Add card is offered in Type buckets (the new note is of that type), not in the others.
  - Each bucket header shows the count and, for card fields with a summary, the bucket's summaries (e.g. "Sum 34 h"). Right-click a header (or its ⋯) to **Add card**, **Move left / right**, **Collapse** it to a narrow strip, **Set card limit…** (the count turns red, "6 / 5", when there are more), **Hide bucket**, or pick **Summaries…**.
  - **Reorder buckets** by dragging their header. The order is saved in the view (your statuses and options keep their own order elsewhere); "No …" always stays last. **Reset bucket order** in the header menu goes back to the field's order.
  - ⋯ → **Hide empty buckets**, and **Hidden buckets…** to bring hidden ones back.
- **Cards** show the type icon and name (click to open), the **Card fields** you pick in the toolbar (any field, including the one the buckets come from; drag the handles in "On cards" to change their order, and use the # / calendar button next to a number or date field to set its format; empty values are left out), and optionally the subtitle and field names (⋯ → **Show subtitles** / **Show field names**). ⋯ → **Small / Medium / Large cards** sets their width. Highlight rules colour cards (row rules) and fields (cell rules, data bars, colour scales). Cards are read-only: open the note to edit.
- **Drag cards** to another bucket to change the field: status, choice, checkbox or link (the "No …" bucket clears it). Selected cards (tick the checkbox on hover, or Ctrl/Cmd-click) move together. On touch screens, press and hold a card to pick it up. Ctrl/Cmd+Z undoes a move.
  - **Order:** with a sort, cards follow it. Without one, drop a card between others to put it there; the order is saved in the view, and new cards go to the bottom.
- **Swimlanes** (toolbar, where Group is in the table): one grouping field, splitting the board into rows, e.g. buckets by status and swimlanes by assignee. Dragging between swimlanes changes that field too, if it's one dragging can change; otherwise cards stay in their own swimlane.
- **Keyboard:** arrow keys move between cards, Enter opens, Space selects, Ctrl/Cmd+Shift+←/→ moves a card to the next bucket, and Ctrl/Cmd+Shift+Alt+←/→ moves the card's whole bucket.
- Big buckets show 50 cards at a time, with "Show 50 more…".

### Calendars

Any view can also be shown as a **calendar** of its notes by date: use the **Table | Board | Calendar** toggle, or "New calendar of …" on a type heading in the browser (types with a date field). Like boards, the note keeps every layout's settings, and filters, search, sort and highlight rules apply as usual.

- **Dates** (toolbar, e.g. "Dates: Due"): for each type, the date field that places its notes and optionally an **end date field** ("Until …") for notes that span days, such as a project from Start to Due. The first time a view becomes a calendar each type gets a pair named like Start / End (or Start / Due) if it has one, else its first date field; choose **Not shown** to leave a type off. The same panel sets the day the **week starts on** (Monday by default) and **Colour by**: each entry's left edge shows its status colour (set colours, else the status's usual tone), a choice field's colours, or nothing.
- **Month | Week | Agenda** (above the calendar), with **‹ Today ›** and the period's title. Page Up / Page Down and Home do the same from the keyboard.
  - **Month:** the weeks of the month; notes spanning days are bars across them. With Minimal cards every week is the same height (sharing the space, or all as tall as the busiest week); with Extended cards each week grows to fit its cards. A day shows up to four entries, then "+3 more", which lists the day in a popover.
  - **Week:** seven days with every entry. **Swimlanes** (toolbar, Week only) split it into rows by a field, e.g. Assignee or Status, to see who's doing what this week.
  - **Agenda:** the next 30 days from the shown date, day by day (today is always listed). A note spanning days is listed once, on its first day, with its dates.
- **Entries** are cards like a board's: the type icon and name, then the **Card fields** (toolbar), one per line, with their formats and highlight rules; the card grows to fit (the table's first few columns until you choose).
- **Minimal | Extended** (next to Month / Week / Agenda): Minimal cards show only the icon and title, Extended ones the whole card. Each layout remembers its own: Month starts Minimal, Week and Agenda Extended. Ticking a card field while on Minimal switches to Extended. ⋯ → **Show subtitles** / **Show field names** work as on boards. Click a card to open the note (Ctrl/Cmd-click for a new tab), hover for a preview.
- **Editing:** drag an entry to another day to change its date (a spanning note moves its start and end together); drag a bar's start or end to change just that. In Week, dragging into another swimlane changes that field too (if dragging can change it). Double-click a day, or its **+**, to create a note with that date filled in. Right-click an entry for the usual menu plus **Clear date**. Ctrl/Cmd+Z undoes a move.
- **No date** (button above the calendar) lists the notes without a date; drag one onto a day to give it that date. The footer counts the notes in the period shown: "12 in November · 3 without a date".
- Dates have no times, and repeating events aren't supported. Calendars need real (Gregorian) dates.

## Workflows

Workflows do things for you: when a note is **created**, when a **field changes** (e.g. Status becomes done), or when you press a **button**, they run a list of steps on the note. Open the **Workflows** view from the ribbon (lightning bolt), the "Open workflows" command, the settings tab, or a type's **Workflows** tab in the Entity types view.

- **Sidebar:** every workflow, grouped by what starts it (When created, When changed, Run on notes), with a green dot when on, the types it applies to, and a ⚠ if it has problems. **+ New**, search, **Pause all workflows**, and **Recent runs** at the bottom.
- **Editing** works like the type editor: changes are a draft with **Save** / **Discard**; Save with problems lists them and saves nothing. The header has an on/off switch and ⋯ (Duplicate, Delete).
  - **Applies to:** the types (or groups) of note. Needed for created / changed; for buttons, empty means any note.
  - **When:** *Field changes* (pick the field; for status, choice and checkbox fields, optionally the **From** and **To** values as pills; for others, "Changes", "Is filled in" or "Is emptied"), *Note created*, or *Run on notes* (a button: its label, icon, and an optional question to confirm first).
  - **Only if:** conditions on the note after the change, built like a view's filters. None: it always runs.
  - **Do:** steps in order. **Set a field**, **Clear a field**, **Add or remove a tag**, **Add or remove a link**, **Show a notice** (text with `{formula}` parts, e.g. `{[Name]} is done`).
  - **Values** for Set a field and links are picked like a filter's value, to suit the field: pills for status and choices (in their colours), a date or a relative one (`today`, `+7d`, `-1m`, worked out when it runs), a number, a tick, notes from the picker, or text.
  - **[ ]** puts a field in: in a picked value it turns the value into that formula (e.g. Due → `[Start]`). **ƒx** turns the value into a formula and opens the **formula editor** (the views' one, with autocomplete, the function list, `old` / `new`, and a preview of what the first notes would get); in a formula, it opens the editor again. **↺** goes back to a picked value. Formulas are the view formula language, checked as you type, e.g. `[Estimate] * 2` or `dateAdd([Start], 2, "weeks")`; `old([Field])` and `new([Field])` give a changed field's values before and after. `list("a", "b")` makes a list (for multiple choice and list fields). Each step sees the ones before; the note is saved once at the end, and if a step fails nothing is saved.
- **Buttons** (*Run on notes*) show on the note's properties form (a strip at the top, and its ⋯ menu), in the right-click menu of table rows, board cards and calendar entries, in the selection bar (**Run…**, once per selected note), and through "Run workflow on this note…".
- **Safety:** a workflow's changes can set off others, up to 5 deep, and never the same workflow twice on the same note in one chain. Changes made by undo never set off workflows.
- **Undo:** a run set off by an edit in the form or a table is one more Ctrl/Cmd+Z there. Button runs show a notice with **Undo**. "Undo last workflow run" undoes the latest, and any run in **Recent runs** can be undone while its notes haven't changed since (undoing a run also undoes the runs it set off).
- **Recent runs:** the last 200 runs (when, workflow, note, what changed from → to, or why it stopped), kept in `workflow-log.json` in the plugin folder. Each workflow also shows its own at the bottom of the editor.

## Commands

| Command | Action |
|---|---|
| Create entity | Pick a type, then the create dialog |
| Create *type* | One command per type |
| Find entity | Entity-only switcher. `person: ada`, `people:` or a shortcut like `p ada` filters by type |
| Open entity browser | Left sidebar tree of entities (also a ribbon icon) |
| Open side panel (connections, preview) | The plugin's right-sidebar panel (also a ribbon icon and a button on the properties form) |
| Configure entity types | The Entity types view, opened on the open note's type (also a ribbon icon, settings button and file menu) |
| Convert current note to entity | Adds the type's fields to an existing note (existing values win). Also in the file menu, and as "Change type…" on entities |
| Check entities | Lists every entity whose values don't fit its type, with the problems; choose one to open it |
| New entity view (table or board) | Pick what it shows, Table or Board, and a name; creates the view note |
| Open entity view… | Picker of view notes |
| Import entity types… | Paste a type pack, single type or list of types (JSON) |
| Generate template files | Writes editable templates for types without one |
| Open workflows | The Workflows view (also a ribbon icon and settings button) |
| Run workflow on this note… | Pick one of the button workflows for the open note |
| Undo last workflow run | Puts back what the latest run changed |
| Pause or resume workflows | Stops every workflow running, automatically or from buttons, until resumed |
| Rebuild entity index | Re-reads every note |

The create dialog:
- **Same controls as the properties form,** with each field's description shown under it.
- **Which fields:** without a layout, the fields set to show in the dialog, required ones and subtitle fields, with **Show N more fields** for the rest. With a [custom layout](#properties-form), the frames and tabs marked to show in the create dialog, plus any required field that isn't in one, under **Required**. If a required field is empty when you press Create, the dialog opens its tab.
- **Link fields:** fuzzy-searches entities of the allowed types, and offers **Create "X"** to make the linked note on the spot.
- **Prefill:** fills in a link to the active note when a field accepts its type (parent fields first), e.g. a new note while viewing a project.
- **Folder:** shows where the note will be created.
- **Ctrl/Cmd+Enter** creates from any field; Enter in the name does too.

## Relationships

Only the forward link is stored, e.g. Ada's `works_for: "[[Acme Ltd]]"`. The other note shows it as a reverse link using the field's inverse label, e.g. "People: Ada Lovelace" on Acme.
- **Labelled links** (`"[[Grace Hopper|mentor]]"`) show as "Mentor" on Ada and "Mentor of" on Grace.
- **Symmetric fields** and `related` show the same group on both notes.
- **Links to notes that don't exist yet** show as dashed chips. Clicking one creates the note.
- **Body links** that aren't relationships are listed under "Mentioned in" in the panel.

### Side panel

The plugin has one panel in the right sidebar. It follows the last active tab in the main area (clicking in the sidebar doesn't change it), and its tab icon and name change to match:
- **A note:** its **Connections** (below).
- **The Entity types editor:** the selected type's **Preview** (see [Entity types view](#entity-types-view)). With a group selected it asks you to pick a type.
- **Anything else** (entity views, other plugins' tabs, images…): "Nothing to show here".

### Connections

The side panel is the main place to see a note's links:
- **Header:** the type icon, the note's name and its type. No field values; those are in the properties form.
- **Filter box**, plus **+ Link**: pick a field, then the target (or create it), then a label if the field has labels.
- **Groups:** collapsible, with counts and a direction arrow (→ set here, ← set on the other note, ⇄ both ways).
- **Mentioned in:** starts collapsed.
- **Non-entity notes:** offers **Convert to entity**.

### Chips

- **Click:** opens the note. Ctrl/Cmd-click opens it in a new tab, and Ctrl + hover shows a preview.
- **Right-click:** Open in new tab, Open to the right, **Remove link**, then the usual file menu.
  - Removing a reverse link edits the other note, and the menu says so, e.g. "Remove link (edits Ada Lovelace)".
  - Every removal shows a notice with **Undo**.

## Development

```powershell
npm install
npm test          # vitest (pure model code in src/model)
npm run build     # typecheck, bundle, and copy into the vault named in .vault-path
npm run dev       # watch mode
```

`.vault-path` (git-ignored) holds the test vault path. The build copies `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/obs-entities/`.

### Code layout

```
src/
  main.ts                    plugin entry: commands, ribbon, file menu, prefill, views
  model/                     pure, unit-tested
    types.ts                 EntityTypeDef, FieldDef, GroupDef, CardConfig (subtitle), FormConfig, COMMON_KEYS
    validation.ts            typeIssues(): located problems
    rules.ts                 field validation rules (ranges, patterns, dates, unique, required when)
    defaults.ts              smarter defaults (relative dates, from a linked note, the next number)
    colors.ts                choice and status colours (the palette, lookups, keeping them in step)
    choiceValues.ts          choices with values (lookups, totals, pill text)
    links.ts                 wikilink parsing/formatting, labelled links
    relations.ts             edges, groupRelations (inverses), addLink/removeLink
    frontmatter.ts           build/merge frontmatter, value conversion
    paths.ts                 folder pattern, exceptions, folder modes, sanitising
    templates.ts             {{placeholders}}, default templates from type sections
    card.ts                  subtitle, value display, url links
    form.ts                  properties form: value checks + fixes, other properties, typed input, retype, undo history
    dates.ts                 DateAdapter + ISO adapter (with date-picker hooks)
    propertyTypes.ts         Obsidian property types for fields (date, number, checkbox, list)
    search.ts                switcher type prefixes
    packs.ts                 starter + CRM packs, parsePack, installPack
    typeEditing.ts           type/group drafts, field + status renames, migrations, import/export, previews
    settings.ts              defaults and merging
    tree.ts                  browser forest: parent links, sections/type blocks, filtering with context, reveal paths
    views.ts                 entity views: definition parse/serialize, columns, cells, roll-ups, formula cells, filters, sort, group, runView
    formula.ts               formula language: lexer, parser, function registry, type inference, evaluator, label/id references
    formats.ts               display formats (dates, numbers) for view columns and fields
    fieldFormats.ts          field display formats: showing values, edit text, reading typed dates and numbers
    layoutClipboard.ts       copying layout items (with their fields), pasting them into a type, saved components
    summary.ts               column summaries (count, sum, earliest…)
    bulk.ts                  bulk actions: shared fields, applying set / link / tag changes, notice text
    board.ts                 boards: bucket fields, buckets in order, card fields, the run definition, manual card order
    calendarView.ts          calendar views: date fields per type, entries, months / weeks / agenda, bars in lanes, moves
    formLayout.ts            custom form layouts: format, tidying, resolving against a type, field renames
    viewBlock.ts             find / rewrite an entity-view block inside a note
  services/
    entityIndex.ts           entities from the metadata cache
    relationIndex.ts         forward + inverse edges, groupsFor, mentions
    entityFactory.ts         create/convert/retype notes, add/remove links (with Undo), folders, move
    bulkActions.ts           apply changes to many notes: progress, failures, one undo step; type, move, duplicate, delete, open, copy
  settings/settingTab.ts
  ui/components/             entity picker
  ui/modals/                 create (hosts CreateForm), switcher, import types, add link, check entities, views (new / open / name / roll-up), formula editor (CodeMirror), bulk actions (set field, links, tags, folder picker)
  ui/header/formManager.tsx  puts the properties form into Live Preview and Reading view, hiding Obsidian's Properties
  ui/react/                  EntityForm (properties form, layouts, shared rows and controls), CreateForm (create dialog), ConnectionsPanel, EntityChip, EntityBits (status tones, relation groups), EntityBrowser
  ui/react/table/            EntityTable (toolbar, virtual rows, editing; hosts the board too), cells, popovers (filters, sort, group, columns)
  ui/react/board/            Board (buckets, swimlanes, cards, pointer drag and drop, keyboard), Buckets and Swimlanes panels
  ui/react/calendar/         CalendarView (Month, Week, Agenda, No date list, dragging), Dates panel
  ui/react/types/            Entity types view: TypeManager (sidebar, group editor, save), General/Fields/Relationships/Display/Layout tabs, Preview, controls
  ui/views/                  BrowserView (left sidebar), SidePanelView (right sidebar: connections or type preview), TypesView (main area), EntityViewView (view notes as full tabs), viewBlock (renders entity-view blocks in notes)
tests/                       model, relations, typeEditing, tree, form, views, viewBlock, formats, formula, bulk, board, calendar, form layout and choice-value tests
styles.css                   all classes prefixed `oe-`
```
