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
- **Dates** are ISO (`YYYY-MM-DD`). In the create dialog and the type editor, date fields have a **calendar button** that opens a date picker. You can still type a date.
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
- **Other properties:** a collapsed section for keys the type doesn't define, each edited by its Obsidian property type.
  - **+ Add property** adds a key.
  - A key's **⋯** menu offers **Add to the *type* type**, which opens the type editor with a draft field, or **Remove**.

**Entering values:**
- **Only valid values go in.** Text, numbers and dates save when you leave the box or press Enter, and Esc cancels. A number that isn't a number, or a date that doesn't exist, isn't saved; a notice says why.
- **Other fields save immediately:** checkboxes, dropdowns, multiple-choice pills, chip lists, and links.
- **Link fields** show each entity as a coloured chip with a **×** inside to remove it. They only offer entities of the allowed types, with **Create "X"**.
  - In a single-link field, picking replaces the link.
  - Labelled fields ask for the label.
  - Fields that read both ways also show links set on the other note (dotted border).
- **Undo:** **Ctrl/Cmd+Z** in the form undoes the last form edit on that note, up to 20 steps. Removing a link or property also shows a notice with **Undo**.
- **Keyboard:** in chip rows, ←/→ move between chips, and Backspace or Delete removes one.

**Problems:**
- Values set elsewhere (Source mode, sync, other plugins) are never changed silently. Instead they're checked: a wrong kind of value, a choice or status that isn't allowed, a single value where a list is expected, a link to the wrong type of entity, a link written as plain text, or an empty required field.
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
- **Fields:** a field list (drag to reorder) and a details panel with label, key, kind, description, choices, default, create-dialog / required toggles, and relation options.
  - Kinds: text, long text, number, date, choice, multiple choice, list, checkbox, link (URL), relation.
- **Relationships:** a diagram, links from and to this type (click to jump to the field), and a guided **Add relationship** dialog with a plain-English summary.
- **Display:** parent fields (for the hierarchy), subtitle fields, and the properties form's **Hide empty fields** option.

**Preview:** Create dialog, Picker row and Properties form. It uses the existing note with the most values, or made-up values.

**Saving:**
- Edits are drafts until you press **Save**. Drafts survive switching types.
- Problems are shown next to the control, and the tab with a problem gets a red dot.
- Renaming a field key offers to **update existing notes** (on by default). Deleting a field offers to **remove its values** (off by default).
- Subtitle and parent references follow a key rename automatically.

**Groups:**
- You can edit the name, icon and statuses. Statuses can be reordered by dragging, and the first is the starting status.
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

A view is a saved, named table (or board, see Boards) of entities. It's an ordinary note in the **views folder** (default `Entities/Views`, set in settings). The definition lives in an `entity-view` code block, so the view syncs and opens anywhere; without the plugin you see the readable definition:

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
- **New entity view** (command, the + on the browser's **Views** section, or "New table view of …" / "New board of …" on a type or group heading): pick what it shows, Table or Board, name it, and the note is created.
- **Open entity view…** lists the view notes. The browser shows them at the top.
- **Embed** a view in any note with `![[Active projects]]`, or paste the block anywhere.

**Toolbar:**
- **Search:** a quick filter on name, aliases and subtitle. It isn't saved.
- **Filters:** conditions combined with **all** or **any**, plus a nested group, e.g. "status is active AND (owner is Ada OR team has Ada)".
  - The operators suit each column: contains / is, < >, before / after / between, is any of, has any / all / none of, links to, link count…
  - Dates also accept `today`, `-7d`, `+2w` or `1m`.
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
  - **incoming links**, e.g. "People" on organisations
  - **roll-ups**
  - Drag headers to reorder, and drag their edges to resize. Double-click a header's edge (or right-click → **Auto-fit width**) to fit the column to its contents; **Auto-fit all columns** fits them all.
  - Right-click a header → **Fill available width** to make that column stretch to use the spare width, e.g. a long Description or Mitigation column. Its width becomes a minimum: in a narrow pane it stays at that width and the table scrolls.
  - Right-click a header → **Freeze** to keep that column and everything to its left in view while scrolling sideways. Choose it again to unfreeze.
  - Right-click a header → **Wrap text** to let long values (text, links, tags) wrap onto more lines, e.g. a Mitigation or Description column. Rows grow to fit, up to 5 lines by default; longer text ends in "…" and shows in full when you hover over the cell.
- **⋯:** Save as…, Rename, Edit definition, Copy block.
  - **Compact rows**, **Normal rows**, **Comfortable rows:** the row height (26, 34 or 44px), to fit more rows on screen or give them more room.
  - **Wrapped text: up to N lines…:** how many lines a wrapped cell can show: 2, 3, 5, 10 or Unlimited.

**Formats:** right-click a number or date column's header → **Format…**.
- **Dates:** presets (2026-12-15, 15 Dec 2026, Tue 15 Dec, 15/12/2026, December 2026…), **Relative** ("in 6 weeks"), or any moment.js pattern such as `D MMM YYYY`.
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

**Roll-ups** summarise the notes linked to each row, through an outgoing field or an incoming link: count, names, unique values of a field, sum / average / min / max of a number, earliest / latest date, % done, or count by status. E.g. "Notes: count" on projects, or "Deals: sum of value" on companies.

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

Functions: logic (`if`, `ifs`, `and`, `or`, `not`, `empty`, `coalesce`), maths (`round`, `floor`, `ceil`, `abs`, `min`, `max`, `sum`, `avg`, `pow`, `sqrt`, `mod`, `number`), text (`concat`, `text`, `upper`, `lower`, `trim`, `len`, `left`, `right`, `mid`, `replace`, `contains`, `startsWith`, `format`), dates (`today`, `date`, `year`, `month`, `day`, `weekday`, `dateAdd`, `dateDiff`, `startOf`, `endOf`), lists (`count`, `first`, `last`, `join`, `includes`, `unique`, `sort`, `map`, `filter`) and links (`name`, `prop`).

**Full-tab views:** opening a view note shows it as an **entity view** tab: the table fills the whole tab, edge to edge, like the Entity types editor.
- **Open as Markdown** (header button or ⋯) shows the note itself, e.g. to edit the definition or write notes below the block. **Open as entity view** switches back.
- The setting **Open view notes as entity views** turns this off.
- A view embedded in another note (`![[View]]`) stays inline.

### Boards

Any view can also be shown as a **board**: cards in **buckets**, one per value of a field, like a kanban by status. Use the **Table / Board** toggle at the left of the toolbar. The note keeps both layouts' settings, so switching back and forth loses nothing; it opens in whichever was used last, and the browser shows a board icon for boards. (Want two independent views? Use ⋯ → **Save as…**.) **New entity view** asks for Table or Board, and type headings in the browser have "New board of …".

- **Buckets** (toolbar): status, or one of the entities' own choice, checkbox or single-link fields, e.g. Priority, Done, Assignee or Project. Every status or choice gets a bucket, even an empty one, plus "No …" for cards without a value.
  - Each bucket header shows the count and, for card fields with a summary, the bucket's summaries (e.g. "Sum 34 h"). Right-click a header (or its ⋯) to **Add card**, **Collapse** it to a narrow strip, **Set card limit…** (the count turns red, "6 / 5", when there are more), **Hide bucket**, or pick **Summaries…**.
  - ⋯ → **Hide empty buckets**, and **Hidden buckets…** to bring hidden ones back.
- **Cards** show the type icon and name (click to open), the **Card fields** you pick in the toolbar (empty values are left out), and optionally the subtitle and field names (⋯ → **Show subtitles** / **Show field names**). ⋯ → **Small / Medium / Large cards** sets their width. Highlight rules colour cards (row rules) and fields (cell rules, data bars, colour scales). Cards are read-only: open the note to edit.
- **Drag cards** to another bucket to change the field: status, choice, checkbox or link (the "No …" bucket clears it). Selected cards (tick the checkbox on hover, or Ctrl/Cmd-click) move together. On touch screens, press and hold a card to pick it up. Ctrl/Cmd+Z undoes a move.
  - **Order:** with a sort, cards follow it. Without one, drop a card between others to put it there; the order is saved in the view, and new cards go to the bottom.
- **Swimlanes** (toolbar, where Group is in the table): one grouping field, splitting the board into rows, e.g. buckets by status and swimlanes by assignee. Dragging between swimlanes changes that field too, if it's one dragging can change; otherwise cards stay in their own swimlane.
- **Keyboard:** arrow keys move between cards, Enter opens, Space selects, Ctrl/Cmd+Shift+←/→ moves a card to the next bucket.
- Big buckets show 50 cards at a time, with "Show 50 more…".

## Commands

| Command | Action |
|---|---|
| Create entity | Pick a type, then the create dialog |
| Create *type* | One command per type |
| Find entity | Entity-only switcher. `person: ada`, `people:` or a shortcut like `p ada` filters by type |
| Open entity browser | Left sidebar tree of entities (also a ribbon icon) |
| Open connections panel | Right sidebar panel for the open note (also a ribbon icon and a button on the properties form) |
| Configure entity types | The Entity types view, opened on the open note's type (also a ribbon icon, settings button and file menu) |
| Convert current note to entity | Adds the type's fields to an existing note (existing values win). Also in the file menu, and as "Change type…" on entities |
| Check entities | Lists every entity whose values don't fit its type, with the problems; choose one to open it |
| New entity view (table or board) | Pick what it shows, Table or Board, and a name; creates the view note |
| Open entity view… | Picker of view notes |
| Import entity types… | Paste a type pack, single type or list of types (JSON) |
| Generate template files | Writes editable templates for types without one |
| Rebuild entity index | Re-reads every note |

The create dialog:
- **Link fields:** fuzzy-searches entities of the allowed types, and offers **Create "X"** to make the linked note on the spot.
- **Prefill:** fills in a link to the active note when a field accepts its type (parent fields first), e.g. a new note while viewing a project.
- **Folder:** shows where the note will be created.

## Relationships

Only the forward link is stored, e.g. Ada's `works_for: "[[Acme Ltd]]"`. The other note shows it as a reverse link using the field's inverse label, e.g. "People: Ada Lovelace" on Acme.
- **Labelled links** (`"[[Grace Hopper|mentor]]"`) show as "Mentor" on Ada and "Mentor of" on Grace.
- **Symmetric fields** and `related` show the same group on both notes.
- **Links to notes that don't exist yet** show as dashed chips. Clicking one creates the note.
- **Body links** that aren't relationships are listed under "Mentioned in" in the panel.

### Connections panel

The right sidebar is the main place to see a note's links. It follows the open note:
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
    formats.ts               column display formats (dates, numbers)
    summary.ts               column summaries (count, sum, earliest…)
    bulk.ts                  bulk actions: shared fields, applying set / link / tag changes, notice text
    board.ts                 boards: bucket fields, buckets in order, card fields, the run definition, manual card order
    viewBlock.ts             find / rewrite an entity-view block inside a note
  services/
    entityIndex.ts           entities from the metadata cache
    relationIndex.ts         forward + inverse edges, groupsFor, mentions
    entityFactory.ts         create/convert/retype notes, add/remove links (with Undo), folders, move
    bulkActions.ts           apply changes to many notes: progress, failures, one undo step; type, move, duplicate, delete, open, copy
  settings/settingTab.ts
  ui/components/             entity picker, relation input, date picker button
  ui/modals/                 create, switcher, import types, add link, check entities, views (new / open / name / roll-up), formula editor (CodeMirror), bulk actions (set field, links, tags, folder picker)
  ui/header/formManager.tsx  puts the properties form into Live Preview and Reading view, hiding Obsidian's Properties
  ui/react/                  EntityForm, ConnectionsPanel, EntityChip, EntityBits (status tones, relation groups), EntityBrowser
  ui/react/table/            EntityTable (toolbar, virtual rows, editing; hosts the board too), cells, popovers (filters, sort, group, columns)
  ui/react/board/            Board (buckets, swimlanes, cards, pointer drag and drop, keyboard), Buckets and Swimlanes panels
  ui/react/types/            Entity types view: TypeManager (sidebar, group editor, save), General/Fields/Relationships/Display tabs, Preview, controls
  ui/views/                  BrowserView (left sidebar), ConnectionsView (right sidebar), TypesView (main area), EntityViewView (view notes as full tabs), viewBlock (renders entity-view blocks in notes)
tests/                       model, relations, typeEditing, tree, form, views, viewBlock, formats, formula, bulk and board tests
styles.css                   all classes prefixed `oe-`
```
