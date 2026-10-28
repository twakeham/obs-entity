# Obsidian Entities

Define your own entity types (people, organisations, places, projects… or anything else) with typed fields and relationships, then create, find and browse them as ordinary Markdown notes.

Derived from the Story Forge worldbuilding plugin, made domain-neutral. The full design is in [docs/DESIGN.md](docs/DESIGN.md).

## Status

| Milestone | Scope | Status |
|---|---|---|
| M1 Foundation | Settings with groups and types, starter pack, create dialog, convert, find entity, per-type commands, import types | ✅ Done |
| M2 Relationships | Inverse links, info card, Connections panel, add/remove links with Undo | ✅ Done |
| M3 Entity Types view | Visual editor for types and groups: fields, relationships, display, drafts, note migrations, previews, import/export | ✅ Done |
| M4 Browser | Grouped, hierarchical entity browser with filters | Planned |
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
- **Property types:** the plugin tells Obsidian which editor to use in the Properties panel:
  - date fields get Obsidian's date picker
  - number fields get a number editor, and checkboxes a checkbox
  - list, multiple-choice and multi-link fields (plus `related`) get a list editor
  
  This is stored in the vault's `.obsidian/types.json`. Obsidian's property types are vault-wide by name, so a key that two types use for different kinds is left alone.
- There is no shared summary property. Each type picks **subtitle fields** (`card.subtitle`), whose values are shown under the name in pickers and search, e.g. a person's role.

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
- **Fields:** a field list (drag to reorder) and a details panel with label, key, kind, description, choices, default, create-dialog / required / show-on-card toggles, and relation options.
  - Kinds: text, long text, number, date, choice, multiple choice, list, checkbox, link (URL), relation.
- **Relationships:** a diagram, links from and to this type (click to jump to the field), and a guided **Add relationship** dialog with a plain-English summary.
- **Display:** parent fields (for the hierarchy), subtitle fields, and card settings (on/off, all filled fields or only chosen ones in order, incoming links, empty fields, links per row).

**Preview:** Create dialog, Picker row and Info card. It uses the existing note with the most values, or made-up values.

**Saving:**
- Edits are drafts until you press **Save**. Drafts survive switching types.
- Problems are shown next to the control, and the tab with a problem gets a red dot.
- Renaming a field key offers to **update existing notes** (on by default). Deleting a field offers to **remove its values** (off by default).
- Subtitle, card and parent references follow a key rename automatically.

**Groups:**
- You can edit the name, icon and statuses. Statuses can be reordered by dragging, and the first is the starting status.
- Renaming a status offers to update the notes that use it.
- A group can only be deleted once it has no types.

**Deleting a type** leaves its notes untouched (they keep `entity: <key>`). Deleted starter types don't come back on update.

## Commands

| Command | Action |
|---|---|
| Create entity | Pick a type, then the create dialog |
| Create *type* | One command per type |
| Find entity | Entity-only switcher. `person: ada`, `people:` or a shortcut like `p ada` filters by type |
| Open connections panel | Right sidebar panel for the open note (also a ribbon icon and a button on the card) |
| Configure entity types | The Entity types view, opened on the open note's type (also a ribbon icon, settings button and file menu) |
| Convert current note to entity | Adds the type's fields to an existing note (existing values win). Also in the file menu |
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
- **Header:** the type icon, the note's name and its type. No field values; those are in Properties.
- **Filter box**, plus **+ Link**: pick a field, then the target (or create it), then a label if the field has labels.
- **Groups:** collapsible, with counts and a direction arrow (→ set here, ← set on the other note, ⇄ both ways).
- **Mentioned in:** starts collapsed.
- **Non-entity notes:** offers **Convert to entity**.

### Chips

- **Click:** opens the note. Ctrl/Cmd-click opens it in a new tab, and Ctrl + hover shows a preview.
- **Right-click:** Open in new tab, Open to the right, **Remove link**, then the usual file menu.
  - Removing a reverse link edits the other note, and the menu says so, e.g. "Remove link (edits Ada Lovelace)".
  - Every removal shows a notice with **Undo**.

### Info card (optional)

**Off by default.** Turn on **Show entity info card** in settings to get a compact card at the top of entity notes, in both Live Preview and Reading view:
- **Top row:** type, an editable status pill (coloured by status), the subtitle, and buttons for the Connections panel and collapse. Collapse applies to all notes and is remembered.
- **Body:** by default, filled fields (minus subtitle fields), then links: outgoing in field order, then incoming, then Related, with up to 6 chips per row and "+N more".
- **Per type:** the `card` settings choose the subtitle, which fields to show and in what order (link fields appear in place), whether incoming links show, empty fields, and chips per row. A type can also opt out with `card.show: false`.

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
    types.ts                 EntityTypeDef, FieldDef, GroupDef, CardConfig, COMMON_KEYS
    validation.ts            typeIssues(): located problems
    links.ts                 wikilink parsing/formatting, labelled links
    relations.ts             edges, groupRelations (inverses), addLink/removeLink
    frontmatter.ts           build/merge frontmatter, value conversion
    paths.ts                 folder pattern, exceptions, folder modes, sanitising
    templates.ts             {{placeholders}}, default templates from type sections
    card.ts                  subtitle, value display, cardSections (what the card shows)
    dates.ts                 DateAdapter + ISO adapter (with date-picker hooks)
    propertyTypes.ts         Obsidian property types for fields (date, number, checkbox, list)
    search.ts                switcher type prefixes
    packs.ts                 starter + CRM packs, parsePack, installPack
    typeEditing.ts           type/group drafts, field + status renames, migrations, import/export, previews
    settings.ts              defaults and merging
  services/
    entityIndex.ts           entities from the metadata cache
    relationIndex.ts         forward + inverse edges, groupsFor, mentions
    entityFactory.ts         create/convert notes, add/remove links (with Undo), folders
  settings/settingTab.ts
  ui/components/             entity picker, relation input, date picker button
  ui/modals/                 create, switcher, import types, add link
  ui/header/cardManager.tsx  injects the info card into Live Preview and Reading view
  ui/react/                  EntityCard, ConnectionsPanel, EntityChip, EntityBits (status, card body, groups)
  ui/react/types/            Entity types view: TypeManager (sidebar, group editor, save), General/Fields/Relationships/Display tabs, Preview, controls
  ui/views/                  ConnectionsView (right sidebar), TypesView (main area)
tests/                       model.test.ts, relations.test.ts, typeEditing.test.ts
styles.css                   all classes prefixed `oe-`
```
