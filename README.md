# Obsidian Entities

Define your own entity types (people, organisations, places, projects… or anything else) with typed fields and relationships, then create, find and browse them as ordinary Markdown notes.

Derived from the Story Forge worldbuilding plugin, made domain-neutral. The full design is in [docs/DESIGN.md](docs/DESIGN.md).

## Status

| Milestone | Scope | Status |
|---|---|---|
| M1 Foundation | Settings with groups and types, starter pack, create dialog, convert, find entity, per-type commands, import types | ✅ Done |
| M2 Relationships | Inverse links, info card, Connections panel, add/remove links with Undo | ✅ Done |
| M3 Entity Types view | Visual type editor with drafts, migrations, previews | Planned |
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
- **Dates** are ISO (`YYYY-MM-DD`).
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

To add more types before the type editor arrives (M3), run **Import entity types…** and paste a type pack. The dialog can load the Basic CRM example.

## Commands

| Command | Action |
|---|---|
| Create entity | Pick a type, then the create dialog |
| Create *type* | One command per type |
| Find entity | Entity-only switcher. `person: ada`, `people:` or a shortcut like `p ada` filters by type |
| Open connections panel | Right sidebar panel for the open note (also a ribbon icon and a button on the card) |
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
    dates.ts                 DateAdapter + ISO adapter
    search.ts                switcher type prefixes
    packs.ts                 starter + CRM packs, parsePack, installPack
    settings.ts              defaults and merging
  services/
    entityIndex.ts           entities from the metadata cache
    relationIndex.ts         forward + inverse edges, groupsFor, mentions
    entityFactory.ts         create/convert notes, add/remove links (with Undo), folders
  settings/settingTab.ts
  ui/components/             entity picker, relation input
  ui/modals/                 create, switcher, import types, add link
  ui/header/cardManager.tsx  injects the info card into Live Preview and Reading view
  ui/react/                  EntityCard, ConnectionsPanel, EntityChip, EntityBits (status, card body, groups)
  ui/views/                  ConnectionsView (right sidebar)
tests/                       model.test.ts, relations.test.ts
styles.css                   all classes prefixed `oe-`
```
