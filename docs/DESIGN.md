# Obsidian Entities — Design

A design for a **generic, domain-agnostic entity plugin for Obsidian**: user-defined entity types, a visual type editor, a create dialog, a hierarchical entity browser, typed relationships with computed inverses, a properties form on each note that replaces Obsidian's Properties block, and a Connections panel.

It is distilled from **Story Forge**, a worldbuilding / tabletop campaign plugin that has these pieces running in production. The domain-specific parts of Story Forge are left out: its fantasy calendar, timeline, storyline board, family trees, faction grid and D&D vocabulary. Everything here works for any domain:
- a research knowledge base (Paper, Author, Concept, Dataset)
- a CRM (Company, Person, Deal)
- a home inventory (Room, Item, Supplier)
- a software architecture catalogue (Service, Team, API)
- a worldbuilding vault

> **Name:** *Obsidian Entities*. Plugin id `obs-entities`, CSS prefix `oe-`, project folder `obs-entity`. **Decided:** the frontmatter type key is `entity`, and there is no common `summary` property; each type picks its subtitle fields (§4.5).

---

## Contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Concepts and glossary](#2-concepts-and-glossary)
3. [Storage model](#3-storage-model)
4. [Type definitions](#4-type-definitions)
5. [Relationship semantics](#5-relationship-semantics)
6. [Architecture](#6-architecture)
7. [Services](#7-services)
8. [Features](#8-features)
   1. [Entity Types view (the type editor)](#81-entity-types-view-the-type-editor)
   2. [Create Entity dialog](#82-create-entity-dialog)
   3. [Entity Browser](#83-entity-browser)
   4. [Entity properties form](#84-entity-properties-form)
   5. [Connections panel](#85-connections-panel)
   6. [Find entity (switcher)](#86-find-entity-switcher)
   7. [Convert, commands, menus, ribbon](#87-convert-commands-menus-ribbon)
   8. [Settings tab](#88-settings-tab)
   9. [Optional modules](#89-optional-modules)
   10. [Entity views](#810-entity-views)
9. [Validation rules](#9-validation-rules)
10. [Settings schema and migrations](#10-settings-schema-and-migrations)
11. [Implementation notes and lessons learned](#11-implementation-notes-and-lessons-learned)
12. [Testing strategy](#12-testing-strategy)
13. [Milestones](#13-milestones)
14. [Open decisions](#14-open-decisions)
- [Appendix A — TypeScript interfaces](#appendix-a--typescript-interfaces)
- [Appendix B — Example type pack (JSON)](#appendix-b--example-type-pack-json)
- [Appendix C — Example note](#appendix-c--example-note)
- [Appendix D — Mapping from Story Forge](#appendix-d--mapping-from-story-forge)

---

## 1. Goals and non-goals

### Goals

- **User-defined entity types** with fields, relations, icons, colours, folders and templates, edited in a friendly visual editor rather than a settings form.
- **Plain Markdown storage.** Every entity is a normal note with YAML frontmatter. Uninstalling the plugin leaves readable, linkable notes that keep working with Properties, Bases, Dataview and the graph.
- **Typed, bidirectional relationships.** Only the forward link is written. The inverse ("Members" for "Member of") is computed and shown on the other note.
- **Fast creation.** A create dialog with type-aware fields, fuzzy relation pickers and inline "create the linked note too".
- **Browsing.** A sidebar browser grouped by type, with configurable hierarchies (parent fields), filters and "new child here".
- **Context on every note.** A properties form at the top of entity notes that only accepts values the type allows, plus a Connections panel in the sidebar.
- **Domain neutrality.** No built-in vocabulary. The plugin ships with an empty type list or an optional example pack. Domains are added as importable **type packs** (JSON).

### Non-goals (v1)

- Domain-specific views (timelines, kanban boards, maps, family trees). §8.9 lists them as optional modules.
- Custom calendars. Dates are ISO `YYYY-MM-DD`; §4.4 defines an extension point.
- Database-style storage, a sync server, or multi-vault sharing beyond JSON import/export.
- Replacing Obsidian Bases or Dataview. The plugin produces data they can query.

### Principles

1. **Notes are the source of truth.** All indexes are derived and rebuilt from the metadata cache.
2. **Forward links only.** Never write inverses, so there's one fact per relationship and no sync bugs.
3. **Pure model, thin UI.** Logic lives in pure, unit-tested TypeScript modules with no `obsidian` import. Views are thin.
4. **Drafts, then save.** Type edits are drafts until saved, and saving can migrate existing notes.
5. **Never surprise the user's notes.** Renames and deletes offer, rather than force, frontmatter migrations, and multi-note writes offer Undo.

---

## 2. Concepts and glossary

| Term | Meaning |
|---|---|
| **Entity** | A Markdown note whose frontmatter contains the type key property (`entity: person`) naming a known type. |
| **Entity type** | A definition: key, names, icon, colour, group, folder rule, template, fields, hierarchy and display options. |
| **Group** | A user-defined bucket of types (e.g. "People", "Places", "Projects"). It gives the browser sections, status sets, the `{group}` folder placeholder and `@group` relation targets. |
| **Field** | A typed property of an entity type, stored as a frontmatter key. |
| **Relation field** | A field whose values are links to other notes. It has allowed target types, an inverse label, and options (multiple, symmetric, labelled). |
| **Edge** | One link written in one note's relation field. Edges are indexed and inverted. |
| **Inverse** | How an edge appears on the target note ("Member of" → "Members"). Computed and never stored. |
| **Hierarchy** | Parent/child structure derived from a type's *parent fields* (e.g. `part_of`). The browser uses it to draw trees. |
| **Common keys** | Fixed frontmatter keys every entity has: `entity`, `status`, `tags`, `aliases`, `related`, `order`. |
| **Subtitle** | A type's one-line description, built from the fields that type chooses (§4.5). It replaces a shared summary property. |
| **Type pack** | A JSON file holding one or more type definitions (and optionally groups), for sharing and presets. |
| **Draft** | An in-memory, unsaved edit of a type in the Entity Types view. |

---

## 3. Storage model

### 3.1 Notes

- One entity is one Markdown file. The file name is the entity name (sanitised; §7.3).
- Frontmatter holds every field of the type. Empty fields are written as empty values (`null`, `[]`, `false`), so they show up in the properties form (or Obsidian's Properties block) ready to fill in.
- The body comes from the type's template (§7.4).

### 3.2 Common keys

These property names are **fixed** (not configurable) and defined once in `COMMON_KEYS`. `tags` and `aliases` are Obsidian's own properties.

| Key | Purpose | Value |
|---|---|---|
| `entity` | Type key. A note is an entity only if this is set **and** names a known type. | string |
| `status` | Workflow status from the group's (or type's) status list | string \| null |
| `tags` | Normal Obsidian tags | string[] |
| `aliases` | Normal Obsidian aliases. The plugin adds the original name when the file name had to be sanitised. | string[] |
| `related` | Generic, untyped links (symmetric, labelled "Related") | wikilink[] |
| `order` | Optional manual sort key among siblings | number \| null |

Common keys are **reserved**: a type's field may not use them (§9).

There is deliberately **no common `summary` / description property**. Each type decides what describes it. For example, a Person might be described by its `role` field, and a Deal by its `description` field. See §4.5.

### 3.3 Link encoding

All relation values are **wikilink strings**, so Obsidian treats them as real links. That means they appear in backlinks and the graph, and are updated automatically on rename.

```yaml
located_in: "[[Head Office]]"          # single relation
members:                               # multiple relation
  - "[[Ada Lovelace]]"
  - "[[Charles Babbage]]"
contacts:                              # labelled relation: the label is the link alias
  - "[[Ada Lovelace|account owner]]"
  - "[[Grace Hopper|technical lead]]"
```

- **Labelled relations** store the per-link label as the wikilink alias: `"[[Target|label]]"`. It's still a real link, so renames and backlinks keep working. Story Forge first used `{target, label}` objects, but they weren't real links. The parser should still read that legacy object form.
- **Parsing:** accept `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]`, markdown links `[x](Target.md)`, and bare names (`Target`). Reject strings with stray `[[`/`]]`.
- **Resolution:** `metadataCache.getFirstLinkpathDest(linkpath, sourcePath)`. A link that doesn't resolve is an **unresolved target**, keyed `?<linktext lowercased>`. It's shown dashed, and clicking it offers to create the note.
- **Writing:** link text is always `metadataCache.fileToLinktext(file, sourcePath, true)`. This gives the shortest unambiguous form and omits `.md`.

### 3.4 Folders

There is **one folder setting for all entities**, the *entity folder pattern* (`folderPattern`, default `Entities/{group}/{entity}`):

| Placeholder | Becomes | Example |
|---|---|---|
| `{group}` | the type's group name | `Directory` |
| `{entity}` | the type's plural name | `People` |

- Values are made safe as folder names.
- Placeholders are case-insensitive and may contain spaces (`{ Entity }`).
- Unknown placeholders are left as written, and the settings tab warns about them.
- A trailing slash is fine (`entities/{group}/{entity}/`).
- An empty pattern means the vault root.
- **Folder exceptions:** a type can have its own pattern (`EntityTypeDef.folderPattern`, same placeholders) that replaces the global one, e.g. Person → `Contacts/{entity}`. Unset means "use the global pattern"; `""` means the vault root. Exceptions are listed under the global pattern in settings (type dropdown, pattern, remove), and the preview marks the types that use one. Groups have no folder settings.

Each type has a **folder rule** (`folderMode`), which is a behaviour rather than a path:

| Mode | New note goes to | Example |
|---|---|---|
| `type` (default) | the expanded pattern (the type's exception, if it has one) | `Entities/Directory/People/` |
| `parent` | `<the folder of the note's hierarchy parent>/<plural>/`, using the first parent field with a value. Falls back to the pattern if there's no parent. | a Note under a Project goes to `…/Projects/Apollo/Notes/` |
| `own` | `<pattern>/<sanitised name>/`: the note gets its own folder, so children in `parent` mode nest inside it. If a parent is set, the own folder goes inside the **parent's folder** instead, e.g. a sub-project inside its project. | `Entities/Work/Projects/Apollo/Apollo.md` |

**Paths and case:**
- Path joining normalises slashes and drops empty segments.
- Obsidian's path lookups are case-sensitive, but the file system may not be (Windows, macOS). Creating folders therefore **reuses existing folders whose names differ only in case**: with the pattern `entities/{group}/{entity}` and an existing `Entities/` folder, notes go in `Entities/…`.
- Name clashes are also checked case-insensitively: "grace hopper" next to `Grace Hopper.md` becomes `grace hopper 2.md`.
- The create dialog and the settings preview show the real casing.

---

## 4. Type definitions

Appendix A has the full interfaces; this section explains them.

### 4.1 Entity type

| Property | Notes |
|---|---|
| `key` | `^[a-z][a-z0-9_]*$`. Written into notes as `entity: <key>`, so it's **immutable once saved**. |
| `name`, `plural` | Display names. `plural` defaults to `name + "s"`. |
| `icon` | A Lucide icon id (Obsidian's `getIconIds()` without the `lucide-` prefix). |
| `color` | `#rrggbb`. It tints chips, the properties form, browser icons and graph nodes. |
| `group` | A group key (§4.3). |
| `folderPattern`, `folderMode` | See §3.4. `folderPattern` is an optional exception to the global folder pattern; `folderMode` is the own/parent folder rule. |
| `template` | A file name in the templates folder. Defaults to `<name>.md`. A built-in template is used until the file exists. |
| `sections` | Optional `## ` headings for the built-in template (otherwise Overview / Details / Notes). |
| `shortcuts` | Switcher prefixes, e.g. `["npc"]`, so `npc ada` filters to people. |
| `statuses` | Optional override of the group's status list. |
| `parentFields` | Relation field keys that point at this entity's **parent**, in priority order. The browser builds trees from them (§8.3). |
| `card` | The subtitle fields: the one-line description in compact displays (§4.5). |
| `form` | Properties form options for this type, e.g. `hideEmpty` (§4.5, §8.4). |
| `fields` | Ordered field definitions (§4.2). |
| `builtIn`, `pack` | Where the type came from: a pack id, if installed from a pack, so "Reset to pack default" works. |

### 4.2 Fields

| Kind | YAML value | Editor control | Notes |
|---|---|---|---|
| `text` | string | text input | |
| `textarea` | string (block) | textarea | |
| `number` | number | number input | Invalid input is written as `null`. |
| `date` | `"YYYY-MM-DD"` string | date input + free text | §4.4 extension point |
| `select` | string | dropdown | `options` required (≥1) |
| `multiselect` | string[] | chips | `options` required. New in Obsidian Entities (Story Forge used `list`). |
| `list` | string[] | chips | free values |
| `boolean` | boolean | toggle | an empty value is written as `false` |
| `url` | string | text input + open button | new in Obsidian Entities |
| `relation` | wikilink or wikilink[] | relation picker (§8.2) | see below |

Options common to all kinds:

| Option | Notes |
|---|---|
| `key`, `label` | `key` follows `^[a-z][a-z0-9_]*$` and isn't reserved. While a field is new, its key follows its label automatically. |
| `description` | Help text shown under the control. |
| `inModal` | Show in the create dialog; otherwise the field sits under "Show N more fields". |
| `required` | Must be filled in when creating. When it's empty on a note, the properties form shows a warning (this never blocks saving). |
| `default` | Prefilled value in the create dialog. |

Relation options:

| Option | Notes |
|---|---|
| `targets` | Type keys, `"*"` (any entity), or `"@<group>"` (any type in a group). Empty means any. |
| `multiple` | Store a list instead of a single link. |
| `inverse` | The label shown on the target note. Without one, the target shows `"<label> (from <type name>)"`. |
| `symmetric` | The link reads the same both ways (allies, siblings, related). Both notes show it under one group. |
| `labelled` | Each link has its own label, stored as the alias. Implies `multiple`. |

### 4.3 Groups

```ts
interface GroupDef { key: string; name: string; icon: string; statuses: string[]; }
```

Groups give:
- browser sections
- default status sets (the **first** status counts as "not started / draft")
- the `{group}` placeholder in the folder pattern (§3.4)
- `@group` relation targets

There's always at least one group. If every group is removed, an "Entities" group with statuses `draft, active, done` is added back. A fresh install gets the starter pack's groups (Directory, Work).

### 4.4 Date adapter (extension point)

Date fields go through an adapter, so a domain module can swap in a fantasy or historical calendar:

```ts
interface DateAdapter {
  parse(raw: unknown): { ok: true; value: Comparable; display: string } | { ok: false; error: string } | null;
  format(value: Comparable, style: "short" | "long"): string;
  placeholder: string;               // e.g. "2026-10-27"
  toPicker?(raw: unknown): string | null;   // value as YYYY-MM-DD for the browser's date picker; omit for no picker
  fromPicker?(iso: string): string;         // a picked YYYY-MM-DD in the adapter's format
}
```

The default adapter is ISO dates (pure code, no `moment`). Its picker hooks pass dates straight through and return null for years the browser's picker can't show (before 0001 or after 9999). Story Forge's calendar is a working example of a custom adapter; a custom calendar would omit the picker hooks, so date fields show only the text box.

**Date pickers:** date fields in the create dialog and the type editor's Default have a text box plus a **calendar button**. The button opens the browser's native date picker, anchored to a hidden `<input type="date">` and starting at the current value; the picked date is written back via `fromPicker`. Typing still works.

### 4.4.1 Obsidian property types

Obsidian's Properties block picks an editor per property name (it's used when the properties form is off, in hover previews and in the File properties sidebar) from `.obsidian/types.json`. On load and after every settings save, the plugin sets these through `app.metadataTypeManager.setType` (only where `getAssignedWidget` differs, so the file isn't rewritten needlessly):

| Field kind | Obsidian type |
|---|---|
| `date` | `date` (Obsidian's date picker) |
| `number`, and `order` | `number` |
| `boolean` | `checkbox` |
| `list`, `multiselect`, multi-link `relation`, and `related` | `multitext` |
| `text`, `textarea`, `select`, `url`, single `relation` | left as text |

Property types are vault-wide by name, so a key that different types use for different kinds is skipped (`propertyTypes()` reports it as a conflict).

### 4.5 Subtitle and form display (per type)

There is no shared `summary` property. Each type picks the fields that describe it in one line, plus options for its properties form (§8.4).

```ts
interface CardConfig {
  subtitle?: string[];     // field keys whose values form the one-line description, joined with " · "
}
interface FormConfig {
  hideEmpty?: boolean;     // properties form: list only filled fields, with "Show N empty fields" (default false)
}
```

**Subtitle** (`card.subtitle`, edited on the Display tab):
- **Shown in:** the properties form's top row, link pickers, the Find entity switcher, chip and browser tooltips, and the optional dashboard. Unset means no one-liner.
- **Fields:** each one should be a text, textarea, select, multiselect, list, number, date or url field. Relation fields aren't allowed; they're shown as chips instead.
- **Textareas** contribute only their first line, ellipsised.
- **Several fields** can be combined, e.g. Person → `role`, `email` gives "CTO · ada@example.com". Empty values are skipped.
- **Renames:** the type editor keeps `subtitle` and `parentFields` in step when a field key is renamed or deleted in a draft.

**History:** before the properties form, `card` also configured an optional info card (`show`, `fields`, `incoming`, `showEmpty`, `maxChips`). Those keys are dropped when settings or packs are loaded; only `subtitle` remains.

---

## 5. Relationship semantics

### 5.1 Edges

When indexing an entity, every value of every relation field (plus `related`) becomes an **Edge**:

```ts
interface Edge {
  source: string;            // source note path
  target: string | null;     // resolved path, or null if unresolved
  linktext: string;          // as written, without brackets
  sourceType: string;
  fieldKey: string;          // "related" for the generic field
  fieldLabel: string;
  inverse?: string;
  symmetric: boolean;        // `related` is symmetric
  labelled: boolean;
  label?: string;            // the per-link label (the alias), for labelled fields
  related: boolean;          // true for `related`
  targets?: string[];        // the field's allowed target types (to create unresolved targets)
}
```

Self-links are ignored. The index keeps `outgoing: Map<sourcePath, Edge[]>` and `incoming: Map<targetPath | "?linktext", Edge[]>`.

### 5.2 Grouping relationships for display

Given a note's outgoing and incoming edges, produce **groups** (used by the Connections panel and the browser tooltip):

| Case | Group key | Title | Direction |
|---|---|---|---|
| outgoing `related` / incoming `related` | `sym:related` | Related | both |
| outgoing labelled, with a label | `lab:<label>` | `Label` (capitalised) | out |
| incoming labelled, with a label | `labin:<label>` | `Label of` | in |
| outgoing or incoming symmetric | `sym:<inverse or fieldLabel>` | inverse or field label | both |
| outgoing (plain) | `out:<fieldKey>` | field label | out |
| incoming (plain) | `in:<title>` | `inverse`, or `<fieldLabel> (from <sourceType>)` | in |

- Items within a group are de-duplicated by target, or by `?linktext` for unresolved targets.
- **Sort order:** outgoing groups follow the type's field order; then incoming groups; then Related last. Ties sort by title.
- Incoming groups merge across source types. For example, "Members" collects `member_of` links from Person and from Team.

### 5.3 Writing relationships

- **Add:** `processFrontMatter(source, fm => fm[key] = addLink(fm[key], linktext, {multiple, labelled, label}))`.
  - A single field replaces its value.
  - A multiple field appends, without duplicates (labelled links may repeat with different labels).
- **Remove:** filter out entries that *resolve* to the target. Compare resolved paths, not text, so `[[Ada]]` and `[[People/Ada|Ada]]` both match. For unresolved targets, compare the link text case-insensitively.
- **Removing an inverse:** removing a link shown as an inverse edits the **source** note. The context menu says so, e.g. "Remove link (edits Acme Ltd)".

### 5.4 "Mentioned in"

Notes that link to this note in their body (from `metadataCache.resolvedLinks`) but not through a relation are listed in a collapsed "Mentioned in" group. They're read-only.

---

## 6. Architecture

### 6.1 Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ UI (React 19 inside Obsidian ItemViews / Modals / injected elements) │
│  EntityTypesView · CreateEntityModal · BrowserView · EntityForm ·      │
│  ConnectionsView · SwitcherModal · SettingTab                        │
├──────────────────────────────────────────────────────────────────────┤
│ Services (talk to Obsidian)                                          │
│  EntityIndex · RelationIndex · EntityFactory · TemplateStore ·       │
│  SettingsStore (+ events)                                            │
├──────────────────────────────────────────────────────────────────────┤
│ Model (pure TypeScript, no `obsidian` import, unit-tested)           │
│  types · validation · links · relations · frontmatter · templates ·  │
│  paths · tree · typeEditing (drafts, migrations, import/export) ·    │
│  search                                                              │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Proposed file layout

```
src/
  main.ts                       plugin entry: services, views, commands, ribbon, menus
  model/
    types.ts                    EntityTypeDef, FieldDef, GroupDef, COMMON_KEYS, typeMatchesTarget
    validation.ts               typeIssues() → located problems; validateType()
    links.ts                    parseLink, parseLabelledEntry, toWikilink, toLabelledWikilink, asArray
    relations.ts                extractEdges, groupRelations, addLink, removeLink
    frontmatter.ts              buildFrontmatter, mergeFrontmatter, fieldDisplay, toYamlValue
    templates.ts                renderTemplate, defaultTemplate
    paths.ts                    joinPath, sanitizeFileName, uniquePath, resolveEntityFolder
    tree.ts                     parentMap, buildForest, filterForest, ancestorsOf, buildBrowserGroups, childOptions
    typeEditing.ts              drafts, fieldChanges, migrateFrontmatter, incomingRelations,
                                relationshipField, describeRelationship, duplicateType,
                                exportPack, importPack, sampleValues
    settings.ts                 DEFAULT_SETTINGS, mergeSettings (migrations)
    search.ts                   fuzzy helpers (pure parts)
  services/
    entityIndex.ts              entities from the metadata cache (debounced "updated" events)
    relationIndex.ts            forward + inverse edges, groupsFor(), mentions(), version
    entityFactory.ts            create/convert notes, add/remove relations, templates on disk
  settings/
    settingTab.ts               folders, behaviour, "Open entity types"
  ui/
    react/                      shared components (EntityChip, Icon, StatusSelect, RelationGroups…)
    react/types/                Entity Types view: TypeManager, tabs, controls, preview
    modals/                     CreateEntityModal, EntitySwitcherModal, AddRelationModal, ConfirmModal
    components/                 EntitySuggest (inline picker), RelationInput, TypePickerModal, EntityPickModal
    views/                      TypesView, BrowserView, ConnectionsView (+ GraphView optional)
    header/                     InfoCardManager (Live Preview + Reading view injection)
tests/                          vitest unit tests for model/*
styles.css                      all styles, `oe-` prefixed
```

### 6.3 Data flow

```
vault change ─► metadataCache "changed"/vault "rename"/"delete"
                 │
                 ▼
            EntityIndex.update(file) ──(debounced 150 ms)──► "updated"
                 │                                              │
                 ▼                                              ▼
            RelationIndex.rebuild() (debounced 100 ms, also on metadataCache "resolved")
                 │
                 ▼  version++ ; trigger("updated")
            React views subscribe with useSyncExternalStore(version) and re-render
```

- **`EntityIndex`** maps path → `EntityRecord` (`{file, path, name, type, status, subtitle, tags, aliases, mtime, ctime, order, frontmatter}`). It only includes notes whose type key names a known type. `subtitle` is computed when indexing, from the type's `card.subtitle` fields (§4.5).
- **`RelationIndex`** is rebuilt from scratch on each change. That's simpler and fast enough for tens of thousands of edges: Story Forge rebuilds ~400 edges in under 5 ms.
- **Settings changes** (`saveSettings`) trigger an index rebuild, because types changed. UI-only preferences (collapsed state, layout) use `saveData` without a rebuild.

### 6.4 React in Obsidian

- Each `ItemView` creates a React root in `onOpen` (`createRoot(contentEl)`) and unmounts it in `onClose`.
- View state that should survive restarts goes in `getState()/setState()` and is saved with the workspace. Call `app.workspace.requestSaveLayout()` after changes; debounce for high-frequency state such as scroll position.
- A `PluginContext` (React context) gives components the plugin instance. A `useRelationsVersion()` hook built on `useSyncExternalStore` subscribes to index updates.
- `useSyncExternalStore` only re-renders when the snapshot is a **new reference**. Return a version number, or clone the settings object you changed.
- **React 19:** there's no global `JSX` namespace, so use `ReactNode` for element arrays.

---

## 7. Services

### 7.1 EntityIndex

- **Load:**
  - Listen to `metadataCache.on("changed")`, `vault.on("delete")` and `vault.on("rename")`.
  - Rebuild fully in `workspace.onLayoutReady`.
  - Expose `isReady()`.
- **`update(file, cache?)`:** read the frontmatter type key; if the type is known, (re)index the file, otherwise remove it. Return whether anything changed.
- **Queries:** `get(path)`, `getByFile(file)`, `all()`, `ofType(key)`, `matching(targets)`, `resolveLink(value, sourcePath)`.
- **Freshly created notes:** call `index.update(file, {frontmatter: generated})` immediately after creating, so the note can be picked before the metadata cache catches up.

### 7.2 RelationIndex

- `rebuild()`: for every entity, `extractEdges(entity.path, entity.type, entity.frontmatter, resolve)`, then fill `outgoing` and `incoming`.
- `outgoingOf(path)`, `incomingOf(path)` (the key is a path, or `?linktext` for unresolved targets), `allEdges()`.
- `groupsFor(path)`: grouped relations for display (§5.2).
- `mentions(path, exclude)`: notes linking to `path` in their body.
- `version`, with an `"updated"` event.

### 7.3 EntityFactory

**`createEntity(type, values, {open, newTab})`:**
1. `name = values.name.trim()` (required). `base = sanitizeFileName(name)`, which removes ``\ / : * ? " < > | # ^ [ ]``, collapses whitespace and strips leading dots.
2. Resolve the folder (§3.4), creating missing folders one segment at a time. A path segment that exists as a file is an error.
3. `path = uniquePath(folder, base)`, appending ` 2`, ` 3`… as needed.
4. Render the template (§7.4) and create the file.
5. Build the frontmatter (all fields, empty values for unset ones). If the file name differs from the name, add `aliases: [name]`.
6. `processFrontMatter(file, fm => mergeFrontmatter(fm, generated))`. Template frontmatter is kept where the generated value is empty, and tags are unioned.
7. Index the note immediately, then open it (in a new tab if configured).

**Other methods:**
- **`convertToEntity(file, type)`:** merge the generated empty frontmatter with **existing values winning**, and set the type key. If the note already had a different type, show a Notice.
- **`addRelation(source, fieldKey, target, label?)` and `removeRelation(edge)`:** see §5.3.
- **`templatePath(type)`, `loadTemplate(type)`, `generateTemplates()`:** write default templates for types that have no template file yet.

### 7.4 Templates

- Templates live in a folder (setting, default `_templates/entities`), one file per type.
- Placeholders: `{{name}}` / `{{title}}`, `{{type}}`, `{{date}}`, `{{date:FORMAT}}` (moment format), `{{time}}`, `{{<field_key>}}` (the display value of that field).
- **Unknown placeholders are left untouched**, so Templater and other engines can process them later.
- The **default template** is a list of `## Section` headings: per-type sections from a pack, or a generic Overview / Details / Notes. Don't add an H1, because Obsidian's inline title already shows the name.

---

## 8. Features

Each feature lists its behaviour and its **acceptance criteria (AC)**.

### 8.1 Entity Types view (the type editor)

A main-area tab, opened from:
- the command **Configure entity types** (it opens the active note's type)
- a ribbon icon (`shapes`)
- the **Open entity types** button in plugin settings
- right-click an entity note → **Configure the <type> type**

#### Layout

```
┌──────────────┬──────────────────────────────────────────────────────┐
│ [Search…][+] │  (icon) Person                                       │
│ PEOPLE       │  People · 42 notes · custom · person                 │
│  ● Person 42 │  [General] [Fields 9] [Relationships 4] [Display]    │
│    Team   6  │ ──────────────────────────────────────────────────── │
│ PLACES       │   … tab content (scrolls) …                          │
│    Office 3  │                                                      │
│              │ ──────────────────────────────────────────────────── │
│              │ ● Unsaved changes   [x] Also update 12 notes …       │
│              │                                  [Discard] [Save]    │
│              │ ▾ Preview  [Dialog][Picker][Form]  Using "Ada"   │
│              │   …preview…                                          │
└──────────────┴──────────────────────────────────────────────────────┘
```

#### Type list (left)

- Search box, and **+ New**, which offers:
  - a blank type (in the current type's group)
  - duplicate the selected type
  - a new group
  - **Import pack…** (JSON paste or file)
  - **Copy all types as a pack**
- Types are listed under their **group headings**. Each row shows the icon (in the type colour), name, note count, a `custom`/`new` badge, and an **orange dot when the type has unsaved changes**. Types whose group doesn't exist are listed under "No group".
- **Group headings** can be clicked to open the group editor (below), and dragged onto another heading to reorder groups. The order is saved immediately.

#### Group editor

Opened by clicking a group heading, or with the pencil next to a type's Group.
- **Name**, **key** (follows the name for a new group; fixed once saved) and **icon**.
- **Statuses:** one row per status, reorderable by drag, with the first marked "starting". Rename a status by editing its name; the row shows "was X". Add a status, or remove one (at least one must remain).
- **Save / Discard bar.** When statuses were renamed, it offers `☑ Also update N notes: archived → retired`. This covers notes of the group's types that don't have their own statuses.
- **Delete group:** only enabled when the group has no types. It asks first, then removes `@group` targets from relation fields.
- **Validation:** name required, key valid and unique, at least one status, no blank or duplicate statuses.

#### Header

Big icon, name, a "group · N notes · starter/custom · `key`" line, and the tabs with counts. A tab shows a red dot when its contents have validation problems.

#### General tab

- **Name.** For a new type, the key follows the name until it's edited by hand.
- **Plural**, with the placeholder `<name>s`.
- **Key.** Read-only once saved, with the explanation "Written as `entity: person` in each note. To rename the type, change its name and plural; the key stays." Changing a key would mean rewriting every note, so there's no "change key" action.
- **Icon.** A searchable grid of Lucide icons: prefix matches first, the first 168 shown, Enter picks the first match.
- **Colour.** A swatch palette (including the starter and CRM pack colours) plus a custom colour picker.
- **Group**, with a pencil button to edit that group. Any type, starter ones included, can move to another group.
- **Statuses:** "Group's" (shows the group's list) or "Custom". Custom starts with a copy of the group's statuses, edited as chips.
- **Folder:** "Entity folder pattern" or "Own pattern" (the exception, with `{group}`/`{entity}`; unknown placeholders are flagged).
- **Folder rule:** "In the folder" / "Own folder each" / "Inside its parent", with a live preview of the path, e.g. "New notes go in `Entities/Work/Projects/<name>/`, or inside their parent's folder".
- **Template file**, with **Open template**, which creates the file from the default template if it's missing.
- **Search shortcuts**, as chips.
- **More:**
  - Duplicate
  - Copy as JSON (a pack with this type and its group)
  - **Reset to starter**, for starter types; applied as a draft
  - **Delete type**, for any type. It asks first and says how many notes use it. The notes are left untouched and keep `entity: <key>`. Deleted starter types are recorded so they don't come back.

#### Fields tab (two columns)

- **The list:** one row per field, showing:
  - a drag handle (rows can be reordered with an insertion indicator)
  - a kind icon
  - the label, with the key in monospace
  - badges: target types for relations, "many", "required", "in create dialog"
  - an error icon if the field has problems
- **The details panel (right):** shown for the selected field, sticky while scrolling. It shows only the options that apply to the field's kind:
  - **All kinds:** label, key ("Was `old_key`. You can update existing notes when you save."), kind, description, default.
  - **Choice / multichoice:** options as chips, reorderable by drag, added with Enter or a comma.
  - **Relation:**
    - targets, from type chips and an "+ Add…" dropdown grouped by group, with "Any entity" / "Any <group>"
    - the name on the other note (inverse)
    - one / many
    - reads both ways (symmetric)
    - each link labelled
  - **Date:** none in the core (the adapter decides).
  - **Common:** show in create dialog and required. Plus move up/down and delete. Deleting is just a draft change, so there's no confirmation.
- **+ Add field** opens a menu of kinds (with a one-line description of each), plus **Relationship…**, which opens the guided dialog below. The new field is selected and its label input focused.

#### Relationships tab

- **Diagram:**
  - This type is in the centre, types that link *to* it on the left, and types it links *to* on the right.
  - Curved arrows are labelled with field names, placed at the outer end of each line so they don't bunch up in the middle.
  - Types are nodes coloured by type; clicking one opens that type. "Any entity" / group targets are dashed nodes.
- **Links from <plural>:** this type's relation fields. Each shows target chips, its inverse ("shown there as 'Members'"), and one/many/labelled. Clicking one opens it in Fields.
- **Links to <plural>:** relation fields on other types that target this type, with how they appear here. Clicking one opens that type with the field selected. Fields that only reach this type through "any entity" or "any <group>" are listed in a collapsed section.
- **Add relationship** is a guided dialog with four questions:
  1. What can a <type> link to? (target picker)
  2. What's the link called here? (it warns if the key exists, and gives the new one a numbered key)
  3. What's it called on the other note? (optional when symmetric)
  4. How many? Does it read both ways? Does each link have its own label?

  A live **plain-English sentence** describes the result, e.g. *"A person can link to several teams through "Member of". On the other note it's listed as "Members"."*

#### Display tab

New in Obsidian Entities.
- **Hierarchy:** the parent fields, in priority order, chosen from this type's relation fields. A preview line reads "In the browser, people nest under their Team (via Member of)".
- **Subtitle** (§4.5): an ordered chip list of eligible fields, with "+ Add field". When it's empty, it reads "No subtitle".
- **Properties form** (§8.4): **Hide empty fields** (default off).
- **Default sort among siblings:** `order`, then name.

#### Saving

- **Drafts:**
  - Each type being edited has a draft: a working copy, the saved original, and a parallel list of `{uid, origKey}` for each field.
  - Drafts survive switching types and closing the view for the rest of the session (keep them on the plugin instance).
  - A draft counts as dirty when `JSON.stringify(type) !== JSON.stringify(original)`.
- **The save bar** appears when the type is dirty: "Unsaved changes" (or "New type, not saved yet"), **Discard** and **Save**. When existing notes would be affected:
  - **Renamed field keys:** `☑ Also update N notes: old → new`, ticked by default, with an expandable list of the affected notes.
  - **Deleted fields:** `☐ Remove the values of deleted fields (…) from N notes`, unticked by default.
- **Validation:**
  - Each problem is shown in red next to the control that caused it, flagged on the field's row and on its tab.
  - "Not filled in yet" problems (an empty name, an empty field label) are hidden until the first Save attempt.
  - Saving with problems jumps to the first one and shows a Notice.
- **On save:**
  1. Finalise the type: fill in default plural, folder (only if missing, not if `""`) and template, and trim the name.
  2. Replace (or append) it in settings and run `saveSettings()`, which re-indexes.
  3. For each affected note, run `processFrontMatter(file, fm => migrateFrontmatter(fm, plan, currentKeys))`.
  4. Reset the draft from the saved type, and show "Saved Person and updated 12 notes."

**Frontmatter migration rules** (`migrateFrontmatter`):
- For each rename `from → to`, copy the old value **unless** the new key already has a value. If it does, keep both and don't delete the old key.
- Swaps (`a → b`, `b → a`) work, because the old values are read before anything is written.
- The old key is deleted unless another current field still uses it.
- Deleted keys are removed only when that option is ticked and no current field uses the key.
- Return whether anything changed. Only write notes that actually hold the affected keys.

#### Preview panel

A collapsible panel at the bottom, with its state saved in the view. Modes, in order:
- **Create dialog:** which fields show (create-dialog, required and subtitle fields), and how many are under "Show more fields". Required fields get an asterisk.
- **Picker row:** how a note of this type looks in link pickers and the switcher (icon, name, subtitle and type).
- **Properties form:** the form as it shows on a note of this type (read-only), with the sample's values and real chips.

**Sample values:**
- They come from the type's **existing note with the most filled-in fields**, read through each field's *original* key so renames preview correctly.
- If the type has no notes, values are made up from field kinds: "Example label", 3, today's date, the first options, `https://example.com`, `[[<target type name>]]`.

#### Import / export

- **Copy as JSON:** `{ "obsEntitiesPack": 1, "groups": [ … ], "types": [ … ] }`, with the groups the types use (no `builtIn` or `pack` markers). **Copy all types as a pack** exports everything.
- **Import pack…** accepts a pack, a single type or a list of types. It checks that the input is valid JSON, that each type has a name and a field list, and that every field kind is valid.
  - A key that's already taken gets a suffix (`person_2`), and relation targets inside the pack follow the rename.
  - Imported types open as **new drafts** to review and save.
  - Groups the pack needs that don't exist yet are added straight away (empty groups can be deleted).

**AC:**
- [ ] Creating a type with fields and a relationship and saving it makes notes of that type creatable, indexed and browsable without a reload.
- [ ] Renaming a field key and saving with "Also update" ticked moves the values in every affected note. Unticked, the notes are unchanged.
- [ ] Deleting a field and ticking "Remove values" removes the key only from notes that had a value.
- [ ] A duplicate field key, a select with no options, an unknown target type or a reserved key blocks saving and is shown inline.
- [ ] Discard reverts to the saved type. Discarding a new type removes it from the list.
- [ ] Export → import round-trips, and a clashing key is renamed.

### 8.2 Create Entity dialog

Opened from:
- the ribbon (`book-plus`)
- **Create entity** (which picks a type first)
- one **Create <type>** command per type, registered dynamically (§11)
- the browser's "+" and "New <child> here"
- clicking an unresolved link

**Layout:**
- **Header:** the type icon and "New <type>", with a **change type** button.
- **Name:** autofocused; Enter submits.
- **Status:** from the type's statuses, defaulting to the first.
- **Fields:** those that are `inModal`, `required`, used in the type's subtitle, or already prefilled.
  - Required fields have an asterisk; a missing value blocks creation and names the field.
  - "Show N more fields" reveals the rest.
- **Tags** (comma-separated), then **Cancel** and **Create**.
- **Ctrl/Cmd+Enter** creates the entity from any field.

**The relation input:**
- **Chips** for the chosen entities: icon and colour, the name, and a label input for labelled fields. Each chip can be removed with ×.
- **Inline fuzzy picker** (`AbstractInputSuggest`):
  - It searches names and aliases among entities matching the field's targets, and excludes notes already chosen and the note being created.
  - An empty query lists the most recently edited first.
- **"Create 'X'" entries:**
  - With 1–3 candidate types, one entry per type, e.g. *Create person "X"*.
  - With more, a single *Create "X" as…* entry that opens a type picker.
  - Choosing one creates that note immediately (without opening it) and adds it as a chip.
- **Single vs multiple:** single fields replace their chip; multiple fields append.

**Prefill:**
- From the active note: if the type has a relation field whose targets include the active note's type, prefill it. For example, creating a Person while viewing a Team prefills "Member of". This can be turned off in settings.
- From context: "New child here" prefills the parent field (§8.3). A double-click elsewhere can prefill any field.
- From field `default` values.

**Date fields** have a calendar button (§4.4) and show the adapter's live preview or error underneath.

**AC:**
- [ ] Every field is written to frontmatter, with empty values for unset ones.
- [ ] Relation values are wikilinks; labelled ones are `[[X|label]]`.
- [ ] Inline-created linked notes exist afterwards, typed and indexed.
- [ ] A name with illegal characters makes a sanitised file name and adds the original name as an alias.

### 8.3 Entity Browser

A left-sidebar view (ribbon `library`, command **Open entity browser**).

#### Grouping

- **Sections:** one section per group, in group order (default). Alternatively, **Sections: none** shows one tree.
- **Type headings** (on by default): inside a section, each type gets a collapsible heading with a count. Entities are listed under the heading of their root's type. With headings off, roots are listed directly.
- **Hierarchy:** a **forest** built from each type's `parentFields`. An entity's parent is the first parent field (in priority order) whose target exists. Siblings sort by type order, then `order`, then name (numeric-aware: "Chapter 2" before "Chapter 10").
- **Children whose parent is in another group** have two options:
  - **stay in their own group** (default): they become roots in their own section;
  - **nest under the parent:** they appear in the parent's section.
- **Cycles** are broken: nodes reachable only through a cycle become roots.
- **"Show empty types"** lists types (and groups) with no notes, with a "No … yet" placeholder.
- These four options live in a **View** menu (sliders button) and are saved with the view state.

#### Rows

- Each row shows: a chevron if it has children, the type icon in the type colour, the name, a child count, and a status dot (coloured per status position: first = grey/draft, last = green/done).
- The subtitle (§4.5) is shown as a tooltip.
- **Clicking:** click opens the note; Ctrl/Cmd-click or middle-click opens it in a new tab.
- **Hover preview:** register a hover link source, so Ctrl + hover shows a page preview.
- **Row context menu:**
  - Open in new tab / Open to the right
  - **New <child type> here**, for each type that has a parent field targeting this row's type. It prefills the parent link and inherits container folders (`folderMode: parent`).
  - Show connections
  - plus the standard file menu (`workspace.trigger("file-menu", …)`)
- **Type heading:** a + button on hover creates that type. Right-click offers "New <type>" and "Configure the <type> type".
- **Group heading:** + opens a picker of the group's types. Right-click offers "New <type>" for each type and **Configure group** (opens the group editor).

#### Toolbar and filters

- **Toolbar row:** search, **View**, **Collapse all**, **Expand all**, **New entity**.
- **Filter row:** Type, Status and Tag dropdowns.
- **While filtering**, a bar shows the match count and a **Clear** link.
- **Filtering** keeps matching nodes **and their ancestors**, so the hierarchy stays visible. Ancestors that don't match themselves are dimmed. Everything that matches is expanded.
- **Collapse state during filtering** is kept separately from the persisted state and resets when the filter changes. Story Forge had a bug here: "Collapse all" appeared to do nothing while filtering.

#### Reveal active note

When the active note changes, expand its section and ancestors **once per note** and scroll it into view. It should not keep re-expanding after you collapse something.

#### State

The View options, search, filters, expanded node paths and collapsed sections/headings are saved in the view state. Expanded paths follow renames. `applyFilter(partial)` lets other features open the browser pre-filtered, e.g. a dashboard tile.

**AC:**
- [x] A type with `parentFields: ["part_of"]` nests correctly, including mixed types (Project ⊃ Project, Project ⊃ Note).
- [x] "Collapse all" collapses everything both with and without a filter.
- [x] "New note here" on a project prefills `project: [[Project]]` and the folder `<project folder>/Notes/`.
- [x] Revealing the active note works for deeply nested notes and doesn't fight manual collapsing.

### 8.4 Entity properties form

On entity notes, a form built from the note's type **replaces Obsidian's Properties block**. Values are entered through controls that suit each field, and links are limited to the allowed types. One setting, **Use the entity properties form** (on by default), switches back to Obsidian's Properties block. Non-entity notes are untouched.

#### Placement

- **Live Preview:** inside `.cm-sizer`, just before the editor content. Themes set the readable width in different ways, so the form is aligned by measuring a line of the note, and re-measured when the editor resizes.
- **Reading view:** after the header section. **Read-only** until the pencil button is clicked.
- **Source mode:** the raw YAML, no form.
- **Hiding Obsidian's Properties:** the view gets `oe-has-form`. This sets Obsidian's `--metadata-display-editing` / `--metadata-display-reading` to `none`, and also hides `.metadata-container` directly for themes that ignore those variables.
- **Unchanged places:**
  - Hover previews and embeds keep Obsidian's Properties, because they aren't Markdown leaves.
  - The File properties sidebar is left alone. Edits made there are checked like any outside change.
- **Re-rendering:** the form is re-inserted if a re-render drops it.

#### Layout

- **Top row:**
  - type icon and name
  - a **status** dropdown (the group's statuses)
  - the subtitle
  - a **problems** count, which jumps to the first problem
  - buttons for the Connections panel, a **⋯ menu** (Change type…, Configure the type) and **collapse**. Collapse applies to all notes and is remembered.
- **Field rows:** one per field, in field order, like Obsidian's Properties.
  - The label is on the left, with the kind's icon, `*` when required, and the description as a tooltip.
  - The control is on the right. Empty values show a faint "Empty".
- **`order`:** a number row when the type has parent fields. Otherwise it's hidden, or listed under Other properties if it has a value.
- **Common rows** at the bottom: Related (links to any entity), Tags and Aliases. `entity` can't be edited here; use Change type.
- **Other properties:** a collapsed section for keys the type doesn't define. Whether it's open is shared by all notes for the session.
- **Hide empty fields** (`form.hideEmpty`, on the Display tab, off by default) lists only filled fields, plus a "Show N empty fields" link. Fields with a problem are always shown.
- **Phones:** the label sits above the value.

#### Controls

| Kind | Control | Saved |
|---|---|---|
| text, url | text box (url adds an open-link button) | on blur or Enter; Esc cancels |
| textarea | auto-height text area | on blur or Ctrl/Cmd+Enter |
| number | text box that only accepts numbers | on blur or Enter |
| date | text box + calendar button (§4.4); only valid dates are accepted | on blur, Enter or picking |
| boolean | checkbox | immediately |
| select | dropdown of the options (plus "—") | immediately |
| multiselect | option pills | immediately |
| list, tags, aliases | chips + an add box (Enter or comma adds; `#` is stripped from tags) | immediately |
| relation, related | chips (click opens, Ctrl+hover previews, right-click menu) + a picker limited to the allowed types, with "Create X" | immediately |

- **Relations:**
  - Each linked entity is a coloured chip with its **×** inside it (while editing).
  - A single-link field shows "Change…", and **picking replaces** the link.
  - A labelled field asks for an optional label after picking.
  - Fields that read both ways (symmetric fields, and Related) also show links set on the other note, with a dotted border. Removing one edits that note.
- **Rejected input:** typed text that isn't valid (in a number field, or a bad date) isn't saved. A notice says why, and the box goes back to the saved value.
- **Saving** uses `processFrontMatter` for that one key, so the rest of the YAML is untouched. The form shows the new value straight away, key by key, until the saved copy has it (or another change to that key wins). Problems and their fixes are checked against what's on screen, so quick successive fixes build on each other.
- **Field settings:** the link picker always uses the field's current settings, even if the type was edited (or the note changed type) while it was open.
- **Text boxes follow outside changes** (sync, undo), unless they hold typing of their own.

#### Undo

- **Ctrl/Cmd+Z** with focus in the form undoes the last form edit on that note, up to 20 steps per note (`EditHistory`). A text box with unsaved typing gets the browser's own undo instead.
- **Removing** a link or an extra property also shows a notice with **Undo**.
- **History** follows renames and is cleared when the note is deleted.

#### Validation

Values set anywhere else (Source mode, sync, other plugins, the File properties sidebar) are never silently changed. `entityProblems(type, frontmatter, ctx)` checks them:

| Problem | Severity | Fix |
|---|---|---|
| Status not in the type's statuses | error | pick one (the dropdown marks it "not a status here") |
| Number written as text / not a number | error | "Make it a number" / none |
| Yes/no written as text | error | "Make it yes/no" |
| Invalid date | error | none |
| Choice not among the options; a list where one value is expected | error | "Use a single value" |
| Multiple choice with unknown values | error | "Remove" them |
| Single value where a list is expected (list, multiselect, list relations, tags, aliases, related) | error | "Make it a list" |
| Several links in a single-link field | error | "Use a single link" / "Keep the first" |
| Link to an entity of a type the field doesn't allow | error | "Remove the link" |
| Link to a note that isn't an entity (restricted fields only) | warning | "Remove the link" |
| A link written as a bare name (not tracked by Obsidian) | warning | "Make it a link" |
| Required field empty | warning | none; never blocks saving |
| `order` not a number (types with parent fields) | error | "Make it a number" |

- **Display:**
  - The row's value gets a red (error) or orange (warning) outline, and an icon whose tooltip explains the problem.
  - Fix buttons appear while editing.
  - A problem about one link also outlines that link's chip.
- **Links to notes that don't exist** aren't a problem. They show as dashed chips; click one to create the note.
- **Check entities** (a command) lists every entity with problems in a filterable modal. Choosing one opens it.

#### Other properties

- **Editors:** each extra key gets an editor from its **Obsidian property type** (`metadataTypeManager.getAssignedWidget`): text, number, checkbox, date or list. Without one, the editor is chosen from the value. Objects show as read-only JSON.
- **+ Add property** adds a key with an empty value.
- The row's **⋯ menu**:
  - **Add to the <type> type** opens the Entity Types view on the Fields tab, with a draft field for the key. The kind is guessed from the value (wikilinks become a relation to any entity).
  - **Remove** deletes the key (with Undo).

#### Change type

**Change type…** in the ⋯ menu picks another type and calls `retype()`. It's also in the file menu as "Change entity type…". `retype()`:
- writes `entity` and adds the new type's missing fields with their defaults;
- keeps every existing value; fields the new type doesn't use become other properties;
- resets the status to the first one when it isn't valid for the new type, and says so.

It doesn't move the file. If the folder pattern puts the new type somewhere else, the notice offers **Move to <folder>/**.

#### Keyboard and accessibility

- **Text boxes:** Tab and Shift+Tab move between controls. Enter confirms a text box, and Esc cancels it.
- **Chip rows:**
  - ← and → move between chips and the add box.
  - Backspace or Delete removes the focused chip.
  - Backspace in an empty add box removes the last chip.
- **ARIA:** every control has an ARIA label. The collapse button has `aria-expanded`, and multiple-choice pills have `aria-pressed`.

**AC:**
- [x] Obsidian's Properties block is hidden on entity notes in Live Preview and Reading view, and comes back when the setting is off.
- [x] Typing an invalid date or number isn't saved; picking a link only offers allowed types.
- [x] A wrong-type link set elsewhere is outlined, explained, counted in the top row and fixable in one click.
- [x] Ctrl/Cmd+Z undoes form edits (including chip removals) without touching the note body.
- [x] Change type keeps values, moves unused fields to Other properties and offers to move the file.

### 8.5 Connections panel

A right-sidebar view (ribbon `waypoints`) that **follows the active note**: on `file-open`, ignoring non-Markdown files, and handling renames and deletes.

- **Header:** type icon, name (click to open) and type name only. The panel shows **connections only**: no status, subtitle or field values (those are in the properties form).
- **Filter box:** "Filter N connections…" (matches names and group titles), and **+ Link**, which opens the Add Link dialog:
  1. Choose a field, among this type's relation fields plus `related`.
  2. Fuzzy-pick the target among the types that field allows, or create it.
  3. Add a label if the field is labelled.
- **Groups:** collapsible, with a count and a direction icon (→ outgoing, ← incoming, ⇄ both). "Mentioned in" is collapsed by default.
- **Non-entity notes** show a **Convert to entity** button.
- **Optional graph mode** (module): §8.9.

### 8.6 Find entity (switcher)

The command **Find entity** opens a `SuggestModal` over entities only.

- **Search:** fuzzy over names and aliases (`prepareFuzzySearch`). When an alias matches, it's shown alongside the name.
- **Type filter:** `shortcut query` or `typename: query` restricts the search to one type, e.g. `npc ada` or `person: ada`.
- **Rows:** type icon, name with the match highlighted, subtitle (or the folder when the type has none), and the type name. Link pickers in the create dialog use the same row layout.
- **Opening:** Enter opens; Ctrl/Cmd+Enter opens in a new tab.

### 8.7 Convert, commands, menus, ribbon

**Commands:**

| Command | Action |
|---|---|
| Create entity | Type picker → create dialog |
| Create <type> | One command per type (§11) |
| Find entity | Switcher |
| Open entity browser | Left sidebar |
| Open connections panel | Right sidebar |
| Check entities | Lists entities whose values don't fit their type (§8.4) |
| New entity view (table or board) | Name + source + layout → a view note in the views folder (§8.10) |
| Open entity view… | Picker of view notes |
| Configure entity types | Types view (active note's type) |
| Convert current note to entity | Type picker → convert (only for Markdown notes) |
| Import entity types… | Paste a type pack, single type or list of types (JSON); can load the Basic CRM example |
| Generate template files | Writes missing templates |
| Rebuild entity index | Full rebuild + Notice with the count |

- **File menu:**
  - **Non-entity Markdown notes:** "Convert to entity…".
  - **Entities:** "Change entity type…" (M1), "Configure the <type> type" (M3), plus module items.
- **Ribbon:** Create entity, Entity browser, Connections, Entity types. Consider making these configurable (§14).

### 8.8 Settings tab

- **Folders:**
  - **Entity folder** (`folderPattern`), with `{group}` and `{entity}` placeholders.
  - **Folder exceptions**: per-type patterns that replace the global one. Each row has a type dropdown, a pattern box and a remove button, plus **Add exception**.
  - A live preview of where each type's notes go (including the parent and own-folder rules), marking types with an exception. Unknown placeholders are flagged.
  - Templates folder, with a **Generate templates** button.
  - Views folder (§8.10), default `Entities/Views`.
- **Views:** open view notes as entity views (`openViewsAsTabs`); **Default currency** (`defaultCurrency`, a 3-letter code, default AUD) for currency formats.
- **Behaviour:**
  - open new entities in a new tab
  - prefill relations from the active note
  - **use the entity properties form** (on by default; turning it off brings back Obsidian's Properties block)
- **Entity types:** a description ("N types (M custom)") and an **Open entity types** button. The button closes the settings modal first (`app.setting.close()`), then opens the view.

Common property names are fixed (§3.2), so there's no setting for them.

### 8.9 Optional modules

These are proven in Story Forge and worth adding behind module toggles once the core is stable:

- **Graph mode in the Connections panel** (Cytoscape):
  - **Layout:** rings by depth 1–3, or a force layout.
  - **Filters:** type chips, a relation filter, and a mentions layer.
  - **Edges:** labels on edges that touch the focus; hover to trace; an "Open as tab" view.
  - **Lessons from Story Forge:**
    - Leave out edges between two outermost-ring nodes at depth 2 or more, to avoid a hairball.
    - **Resolve theme colours through a hidden element and normalise them with a canvas.** Themes such as Minimal use `hsl(… calc(…))`, which canvas libraries can't parse, so dark-mode text turns black.
    - Redraw on `css-change`, and re-fit when a hidden tab becomes visible.
- **Overview dashboard:**
  - a launcher of screens, pinned entities, tiles per type with status bars, recently edited/created, and a needs-attention list (draft, empty subtitle fields, missing required fields, unlinked)
  - hubs and loners
  - customisable sections, plus an embeddable code block
- **Bulk edit in the browser:** multi-select, then set status, add a relation, or move.
- **More entity view kinds** (§8.10): gallery, calendar. (Boards are done.)
- **Domain views**, as separate modules: timeline (with a date adapter), family tree, relationship grid.

### 8.10 Entity views

Saved, named views over entities, shown as a **table** or a **board** (cards in buckets). Every view kind shares the same source, columns, filters, sorting and highlight rules; one note keeps both layouts' settings.

#### Storage: a Markdown note

A view is an ordinary note. Its file name is the view's name, e.g. `Entities/Views/Active projects.md`, in the **views folder** (a setting, default `Entities/Views`). The definition is a fenced `entity-view` code block in YAML:

````markdown
```entity-view
kind: table
types: [project]
columns: [name, status, owner, due, { rollup: { via: "in:note.project", agg: count }, label: Notes, id: notes }]
widths: { owner: 160 }
sort: [{ by: due, dir: asc }]
group: [{ by: status }]
filters: { all: [{ field: status, op: is-not, value: done }] }
```
````

- **Rendering:** the plugin renders the block (via `registerMarkdownCodeBlockProcessor`) as the live view in Reading view and Live Preview. The rest of the note is free for your own text.
- **Without the plugin**, the note opens with a readable definition, so a vault synced elsewhere loses nothing.
- **Anywhere:** the block works in any note, and `![[Active projects]]` embeds a view. Embedded views are fully interactive; changes write to whichever note holds the block.
- **Invalid blocks** (bad YAML, unknown types) show an error in place of the table. The text is left untouched.

#### Definition

| Key | Meaning |
|---|---|
| `kind` | The layout the view opens in: `table` or `board` (later `gallery`, `calendar`). The Table / Board toggle switches it. |
| `types` | Type keys, `@group`, or `*` (all entities), like relation targets. Default `*`. |
| `columns` | Ordered columns (below). `name` is always first, and is added if missing. |
| `widths` | Column id → width in px. For fill columns, the minimum width. |
| `fill` | A column id, or a list of them, that grows to fill spare width (see Table). Optional. |
| `freeze` | The last frozen column's id: it and every column to its left stay visible when scrolling sideways (see Table). Optional. |
| `density` | Row height: `compact` (26px), `normal` (34px) or `comfortable` (44px). Only written when not normal. |
| `wrap` | Column ids whose text wraps onto more lines; the row grows to fit (see Table). Optional. |
| `wrapLines` | The most lines a wrapped cell shows: a number, or `unlimited`. Default 5, and only written when different. |
| `sort` | Sort levels: `{ by: <column id>, dir: asc \| desc }`. |
| `group` | Grouping levels, outermost first: a list of `{ by: <column id>, date?: month \| year }` (or just the column id). Always a list, even for one level; any number of levels. Optional. |
| `groupSummaries` | `false` hides column summaries in group headers. Only written when off. |
| `groupFieldNames` | `false` labels group headers with the value alone ("todo") instead of "Field: value" ("Status: todo"). Only written when off. |
| `filters` | `{ all: [...] }` or `{ any: [...] }`. Items are conditions, or one level of nested groups. |
| `formats` | Column id → display format, for number and date columns (see Formats). Optional. |
| `highlight` | Conditional formatting rules, in priority order (see Highlight rules). Optional. |
| `summary` | Column id → summary aggregation, shown in the summary row and group headers (see Summaries). Optional. |
| `board` | The board layout's own settings (see Board). Kept whichever layout is shown. Optional. |

**Shared and per-layout settings.** Both layouts use `types`, `filters`, `sort`, `highlight`, `formats`, `summary` and the column definitions (roll-ups and formulas are defined once, in `columns`). The table alone uses the shown `columns` and their order, `group`, `widths`, `fill`, `freeze`, `density` and `wrap`; the board alone uses `board:`. Formats and summaries are kept for card fields that aren't table columns.

**Columns.** A plain string is a built-in or a field key. An object is one of:
- `{ field: key }` / `{ builtin: key }`, with an optional `label`;
- `{ incoming: "<type>.<field>" }`: the reverse of a relation field (e.g. `person.works_for` on organisations). The label defaults to the field's inverse;
- `{ rollup: { via, agg, field? }, label, id }`: summarises linked notes, see below;
- `{ formula: "…", label, id, type? }`: a formula column (see Formulas).

Column ids are the field / built-in key, `in:<type>.<field>`, or the given `id` (for roll-ups and formulas). A field whose key is also a built-in name (e.g. a `type` field) is written `{ field: type }` and has the id `f:type`.

**Built-ins:** `name` (always first, can't be hidden), `type`, `status`, `tags`, `aliases`, `related`, `folder`, `created`, `modified`.

**Fields:** the union of the source types' fields. A key that several types share appears once; types that don't have it show blank.

**Incoming:** offered for every relation field, of any type, whose targets match a source type.

#### Formulas

A formula column calculates a value per row with a small spreadsheet-style expression language (`model/formula.ts`). The language is evaluated by its own interpreter, never as JavaScript.

```yaml
columns:
  - formula: "[due] - today()"
    label: Days left
    id: days_left
    type: number        # only when the result type is overridden
```

- **References:** `[Column]` refers to any column the view could show: its columns, the source types' fields, built-ins, incoming links, roll-ups and other formulas, shown or not.
  - They're stored by id (`[due]`) and shown by label (`[Due]`); `toStored` / `toDisplay` convert between them. Renaming a field or a column label doesn't break a formula.
  - A name resolves by label first (ignoring case), then by id.
- **Syntax:**
  - Values: numbers, `"text"` (or `'text'`), `true` / `false`.
  - Arithmetic: `+ - * / %` (`%` is the remainder) and unary minus.
  - Joining text: `&`.
  - Comparisons: `= != < <= > >=` (also `==`, `<>`).
  - Logic: `and`, `or`, `not` (also `&&`, `||`, `!`).
  - Grouping with brackets, and function calls `name(args)`.
  - Precedence, from loosest: or, and, not, comparison, `&`, `+ -`, `* / %`, unary minus.
- **Values:** number, text, true/false, date (whole days, like date cells), list, link.
  - **Dates:** `date - date` is days; `date ± number` moves by days.
  - **Empty values:** an empty value makes arithmetic empty and comparisons false. `=` treats empty values as equal to each other.
  - **Mixed comparisons:** text that reads as a date compares with dates, and numeric text with numbers.
- **Functions:**

  | Category | Functions |
  |---|---|
  | Logic | `if`, `ifs`, `and`, `or`, `not`, `empty`, `coalesce` (lazy: unused branches aren't evaluated) |
  | Maths | `round`, `floor`, `ceil`, `abs`, `min`, `max`, `sum`, `avg`, `pow`, `sqrt`, `mod`, `number` |
  | Text | `concat`, `text`, `upper`, `lower`, `trim`, `len`, `left`, `right`, `mid`, `replace`, `contains`, `startsWith`, `format` (column format patterns) |
  | Dates | `today`, `now`, `date(y, m, d)` / `date(text)`, `year`, `month`, `day`, `weekday` (1 Mon … 7 Sun), `dateAdd`, `dateDiff` (whole units, consistent with `dateAdd`), `startOf`, `endOf` (week / month / year) |
  | Lists | `count`, `first`, `last`, `join`, `includes`, `unique`, `sort`, `map(list, expr)`, `filter(list, cond)`; `item` is the current element |
  | Links | `name(link)`, `prop(link, "Field")` (a linked note's field by label or key, or a built-in such as status) |

  Each function has a signature, a description and an example in `FUNCTIONS`; the editor's autocomplete, hover help and reference panel use them.
- **Types:** the result type is inferred (number, text, true/false, date, list, links, or "any", shown as text) and can be overridden.
  - The column's kind follows the type, so formulas work in sorting, filters, grouping, highlight rules, summaries and **Format…** like any other column.
  - With an override, results are converted where possible (e.g. text such as "2027-01-05" to a date). Otherwise the cell gets an error.
- **Errors:**
  - **Whole column:** syntax errors, unknown columns, functions or names, wrong argument counts and loops (`Circular reference: A → B → A.`) make the column invalid. Its header is greyed out and its cells show "—" with the message as a tooltip.
  - **Per row:** runtime problems (division by zero, comparing a date with a number…) are per-row errors. The cell shows a faint "–" with the message, sorts last and counts as empty. Errors in a referenced formula column carry through.
- **Resolution:** `resolveColumn` compiles the formula against `formulaRefColumns` (the view's possible columns; formula types resolve lazily, with a stack for loop detection) and keeps the compiled tree and the referenced columns.
  - Top-level resolutions are cached per definition and type list.
  - `cellOf` evaluates per row. It reads referenced cells with `cellOf`, and linked notes through `ctx.row`.
- **Editor** (`FormulaModal`): open it from **Columns → Add formula…**, the pencil next to a formula in the Columns panel, the header menu's **Edit formula…**, or by double-clicking a formula cell. It has:
  - a **Name** box
  - a CodeMirror editor: colouring for columns, functions, text, numbers, keywords and unknown names, matching brackets, auto-closed brackets and quotes, history, and line wrapping
  - **autocomplete:** `[` lists the columns with their types; letters list functions grouped by category with their signatures and help
  - **hover help** on functions and columns
  - **errors as you type:** a wavy underline at the problem, and a status line showing the message or "Result: Number"
  - **Result type:** Automatic (inferred) or an override
  - a **preview** of the first 5 rows of the view
  - a searchable **reference panel** of columns and functions; clicking one inserts it
  - **Save** (Ctrl/Cmd+Enter, disabled while there's an error) and **Cancel**. Esc closes the suggestion list first.

  A new column's id comes from its name.

#### Roll-ups

`via` is `field:<key>` (an outgoing relation field) or `in:<type>.<field>` (an incoming one).

| `agg` | Needs `field` | Result |
|---|---|---|
| `count` | | number of linked notes |
| `list` | | their names (sorted) |
| `unique` | any field | the distinct values of that field |
| `sum`, `avg`, `min`, `max` | number | number |
| `earliest`, `latest` | date | date |
| `percent-done` | | % of linked entities in their last status |
| `count-by-status` | | e.g. "2 active · 1 done" (sorted as text) |

- **Read-only**, but sortable and filterable as numbers, dates or text, depending on `agg`.
- **Editing** happens in a small dialog: relationship → aggregation → field (if needed) → label.

#### Filters

- **Quick search** matches the name, aliases and subtitle. It isn't saved.
- **Saved filters:** a list of conditions combined with **All** or **Any**, plus one level of nested groups, edited in a popover.
- **Ignored conditions** (`conditionIssue`) don't filter anything:
  - a column that no longer exists, or an operator it doesn't support (the condition is kept, so it can be fixed);
  - **a missing value**: no text, no choices or notes picked, or an empty number or date (a range needs at least one end);
  - a number or date that can't be read ("soon", "lots").
  - A nested group with no usable conditions is skipped too, so it doesn't make an **Any** group match every entity. Before, a missing value matched nothing for some operators (any of, links to any of) and everything for others (contains, none of).
  - **Shown:** in the panel, each such condition gets a note under it with the reason: a muted "needs a value, until then it's ignored" for one that's still being set up, orange for one that's broken. While the panel is closed, a notice above the view names the first ignored condition ("A filter condition is ignored: Project links to any of (it needs a value).", "…and 2 more") with **Edit filters**, and the Filters button turns orange with a warning in its count (`ignoredConditions`, `conditionText`).
  - Highlight rules use the same check: a rule whose conditions are all ignored matches nothing.

| Column kind | Operators |
|---|---|
| text, textarea, url, folder… | `contains`, `not-contains`, `is`, `is-not`, `starts-with`, `empty`, `not-empty` |
| number (incl. roll-ups) | `=`, `!=`, `<`, `<=`, `>`, `>=`, `empty`, `not-empty` |
| date | `is`, `before`, `after`, `on-or-before`, `on-or-after`, `between`, `empty`, `not-empty`. Values may be relative: `today`, `-7d`, `+2w`, `1m`, `-1y` |
| select, status, type | `any-of`, `none-of`, `empty`, `not-empty` |
| multiselect, list, tags, aliases | `has-any`, `has-all`, `has-none`, `empty`, `not-empty` |
| checkbox | `checked`, `unchecked` |
| relation, incoming, related | `links-any`, `links-none` (note paths, chosen with the entity picker), `empty`, `not-empty`, `count=`, `count!=`, `count<`, `count>` |
| folder | `in-folder` (subfolders included) plus the text operators |

#### Sorting and grouping

- **Header clicks:** clicking a header cycles ascending → descending → off. Shift-click adds a secondary level.
- **Sort popover:** any number of levels, reordered by dragging.
- **Comparison:**
  - dates use the adapter's value;
  - numbers sort numerically;
  - text sorts naturally ("Chapter 2" before "Chapter 10");
  - statuses follow the group's order;
  - relations sort by the first linked name.
- **Empty values are always last.** With no sort set, rows are in name order.
- **Group by:** any number of levels, outermost first, e.g. status → assignee → due by month. Each level is one column: status, type, a choice, a relation, a list, or a date by day, month or year. A column can only be one level.
  - **Tree:** `runView` returns a tree of `ResultGroup`s: `key` (the path of keys joined with `GROUP_PATH_SEP`), `label`, `level`, `by`, `rows` (every row inside, sub-groups included) and `children`. `flattenGroups` lists them depth first.
  - **Order:** each level is ordered by its own column, following that column's sort direction if it's sorted, otherwise ascending. Empty goes last.
  - **Rows in several groups:** list and link values put a row in each matching group, at every level.
  - **Group headers:** each is indented 16px per level and gets a lighter background the deeper it is. It shows a chevron, the label, the row count and the group's summaries.
    - **Label:** "Field: value" by default, e.g. "Status: todo", with the field name muted and "none" in faint italics for an empty value. With **Show field names in group headers** off (`groupFieldNames: false`) it's the value alone, with "No <column>" when empty.
  - **Grouped columns are hidden:** a column used as a grouping level isn't shown in the grid (`runView` leaves it out of `columns`), because its value is in the group header. It stays in `columns` in the definition, so it comes back when its level is removed. Highlight cell rules and summaries on it have no effect while it's hidden.
  - **Rows:** the first column (Name) of each row is indented to its grouping depth (16px per level), so it sits under its group's label and the start and end of each group are easy to see.
  - **Collapsing:** clicking a header collapses everything inside it. Collapsed paths are kept for the session. Right-clicking a header offers **Collapse all at this level**, **Expand all at this level** and **Expand all**.
  - **Selection:** each header has a checkbox in the select column. It selects or clears every row in the group, sub-groups and collapsed groups included, and is indeterminate when some are selected. The column header's select-all works the same way over every row in the view.
  - **Editing:**
    - **Group panel:** levels like the Sort panel ("Group by", "then by"), each with a column picker (columns used by other levels are left out) and by day / month / year for dates. Levels can be dragged to reorder, removed, or added with **+ Add level**. **Show field names in group headers** and **Show summaries in group headers** sit below; both are on by default.
    - **Header menu:** **Group by X** adds X as the innermost level, which hides its column. Levels are removed in the Group panel.

#### Formats

Number and date columns (fields, `created` / `modified`, and number or date roll-ups) can have a display format. Right-click a header → **Format…** opens a panel with presets (each showing an example from the column), a custom pattern box with help, and a live preview or error. Formats are saved in `formats` and dropped when their column is removed.

| Kind | Presets | Custom |
|---|---|---|
| date | `YYYY-MM-DD`, `D MMM YYYY`, `ddd D MMM`, `DD/MM/YYYY`, `MM/DD/YYYY`, `MMMM YYYY`, `relative` ("in 3 days", "2 weeks ago") | any moment.js pattern |
| number | `number` (grouping), `integer`, `decimal:N`, `currency` / `currency:CODE`, `compact` (12K), `percent` (value 0–100) | a spreadsheet-style pattern: optional prefix, `#,##0` with optional `.00`, optional suffix, e.g. `$#,##0.00`, `#,##0 h`, `0.0%` |

- **Display only:** sorting, filtering and editing use the raw value. Group labels use the format.
- **Locale:** numbers use the OS regional format when it shares a language with Obsidian's (e.g. en-AU under English), otherwise Obsidian's language. Dates use Obsidian's moment locale.
- **Currency:** `currency` without a code uses the **Default currency** setting (`defaultCurrency`, default AUD).
- An invalid pattern shows a message in the panel and isn't applied; a saved bad pattern falls back to the raw value.

#### Summaries

Each column can show a summary of the rows: in a **summary row** pinned to the bottom of the grid, and in **group headers**.

```yaml
summary:
  name: count
  budget: sum
  due: latest
  status: values           # "3 todo · 2 done"
  done: percent-checked
  stage: "percent:done"    # share of one value
group: [{ by: assignee }]
groupSummaries: false      # only written when turned off
```

| Column kind | Aggregations (keys) |
|---|---|
| any | `count` (rows with a value), `empty`, `filled` ("8/12"), `percent-filled`, `unique` (distinct values, list items counted separately) |
| number (fields, number roll-ups) | `sum`, `avg`, `median`, `min`, `max`, `range` |
| date | `earliest`, `latest`, `range` (a span: "12 days", "3 weeks", "4 months", "2.7 years") |
| checkbox | `checked`, `unchecked`, `percent-checked` (plus `count`) |
| choice, status, type | `values` (count of each value, in status / option order), `percent:<value>` |
| list, links, tags | `links` (total values) |
| name | `count` only (the row count) |

- **The summary row** is always shown. It's sticky at the bottom of the scroll area, like the sticky header.
  - Click a cell, which shows a faint "Summarise" on hover, for a menu of the column's aggregations, ticked when chosen, plus **None**. Clicking the ticked aggregation also turns the summary off.
  - The header menu's **Summarise…** opens the same menu.
- **Rows summarised:** the shown rows, after filters and the quick search. Collapsed groups still count. In the bottom row each row counts once, even when a list or links group puts it in several groups.
- **Group headers:**
  - When grouping, each header row at every level shows that group's summaries (over all its rows, sub-groups included) under their columns, in a smaller, muted style. The group's checkbox sits in the select column, and its name and count in the Name column.
  - **Show summaries in group headers** in the Group panel (`groupSummaries: false`) turns this off for all levels; it's on by default.
  - A row in several groups counts in each.
- **Display:**
  - Each result has a faint label ("Sum", "Avg", "Latest") before its value. Number and date results use the column's display format (§ Formats), so a currency column sums to "$1,240,000.00". Counts, percentages and spans are plain numbers in the number locale.
  - % done roll-ups show averages as "63%".
  - An aggregation that doesn't fit the column (e.g. after its field changed kind) shows "–", as does a number or date aggregation over no values.
- **Saving:** summaries of removed columns are dropped when the view saves, like formats.
- **Code:** `model/summary.ts` holds `summaryOptions`, `summaryApplies`, `summarize` and `spanText` (pure, tested). The table computes summaries with `useMemo` from the run result.

#### Highlight rules

Conditional formatting: a rule is **conditions + a style**, applied to the **whole row** or to **one column's cells**.

```yaml
highlight:
  - name: Overdue          # optional
    target: row            # or a column id, e.g. priority
    when: { all: [ { field: due, op: before, value: today }, { field: status, op: none-of, value: [done] } ] }
    style: { fill: red, text: red, bold: true, italic: true, strike: true, icon: alert-triangle }
    off: true              # disabled, kept
```

- **Conditions** use the filter format and editor (§ Filters): every operator, relative dates, all/any with one nested group. They may use any column the source types offer, shown or not. A rule with no conditions matches every row. A rule whose conditions are all unusable (unknown column, wrong operator) matches nothing.
- **Style:**
  - `fill` and `text` take a palette colour: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `grey`. They map to Obsidian's `--color-*` variables (grey to `--text-muted`), so they suit light and dark themes. The fill is a 16% tint.
  - `bold`, `italic`, `strike`.
  - `icon` is one of a short Lucide list: alert-triangle, alert-circle, check-circle, clock, flag, star, flame, circle-dot, x-circle, lock. Row icons show before the name; cell icons show before the value.
- **Precedence: first match per target, cell over row.**
  - For the row, the first matching enabled row rule applies.
  - For each cell, the first matching enabled rule targeting that column is layered over the row rule. What it sets wins, and what it leaves unset (fill, text colour, bold…) comes from the row rule. So a cell rule can't clear the row's fill.
  - A cell rule's icon replaces the row icon in its column.
- Rules targeting a column that isn't shown have no effect; they're kept, and the panel says so.
- **Hover and selection** still show: they're mixed over the fill. A row fill also covers the checkbox and filler cells.
- **Editing:**
  - The toolbar's **Highlight (n)** button (n counts enabled rules) opens the rule list. Each rule shows a sample, its name (or a summary of its first condition), its target and how many shown rows match.
  - Rules can be turned on and off, reordered by dragging, removed, and expanded to edit: name, apply to (whole row or a column), conditions, fill and text swatches, B / I / S toggles and icon.
  - Right-clicking a header gives **Highlight cells…**, which adds a cell rule for that column, with a condition on it and a yellow fill, and opens it.
- `runView` returns each row's matching rule per target (`hl`) and a match count per rule. Future board, gallery and calendar views will use row rules to colour cards.

#### Data bars and colour scales

Two more kinds of rule, in the same `highlight:` list (so they can be reordered, named and switched off). Each targets **one number or date column** (fields, roll-ups or formulas of those types). An optional condition (`when`, the filter editor) limits which rows get it.

```yaml
highlight:
  - kind: bar
    target: budget
    bar: { color: blue, min: 0, max: p90, gradient: true, negative: red, barOnly: false }
  - kind: scale
    target: days_left
    when: { all: [ { field: status, op: none-of, value: [done] } ] }
    scale: { colors: [red, yellow, green], min: auto, mid: p50, max: +60d }
```

- **Bounds** (`min`, `max`, and `mid` for three-colour scales):
  - `auto` (the default) is the lowest or highest value of the rows the rule applies to, among those shown after filters and search.
  - A fixed number. For date columns, a date or relative date (`today`, `+30d`, `-1m`, `2026-12-31`).
  - A percentile, `p90`.
  - `mid` defaults to the median.
- **Data bars:**
  - A bar behind the value, which stays readable on top. It's the palette colour (blue by default) as a 35% tint, or a gradient that fades out.
  - **Number bars** start from zero: automatic bounds are `min(0, lowest)` and `max(0, highest)`. When the range spans zero, negative values draw leftwards from the zero line in the negative colour (red by default), and positive values rightwards.
  - **Date bars** span the earliest to latest date.
  - Values outside the range are clamped, and empty cells get no bar.
  - **Bar only** hides the value; it's still the cell's tooltip.
  - `barGeometry` gives the bar's start and end as fractions of the cell.
- **Colour scales:**
  - Two colours (low → high) or three (low → middle → high), as a 30% tint of the mixed colour (`color-mix` of the palette's theme variables), so text stays readable in light and dark themes.
  - Presets: Red → Yellow → Green, Green → Yellow → Red, Grey → Blue, Red → Green.
  - `scalePosition` gives the value's position (0–1), measured from the middle point when there is one.
- **Precedence:** a scale's fill replaces the row highlight's fill in its column. A cell highlight rule with its own fill keeps it if it comes before the scale in the list. A bar and a scale can share a column, and the first rule of each kind wins.
- **Groups and summaries:** values are compared across the whole view, not per group. The summary row isn't affected.
- **Editing:**
  - The Highlight panel adds **Data bar** and **Colour scale** next to **Highlight rule**. A rule's sample shows a bar or the gradient, and its summary reads "Data bar on Budget".
  - The editor has the column, colours (with presets for scales), each bound (Automatic / Number or Date / Percentile), the bar's gradient and bar-only options, and the optional conditions.
  - Right-clicking a number or date header gives **Data bar…** and **Colour scale…**, which add the rule and open it.
- **Runtime:** `runView` collects the rows each enabled rule matches, works out the bounds from their values (`percentile`), and stores each row's `viz[column] = { bar?: { rule, start, end, negative }, scale?: { rule, t } }`.

#### Table

- **Toolbar:** source · quick search · Table | Board toggle · Filters (n) · Sort (n) · Group · Highlight (n) · Columns · ⋯ (Save as…, Rename, Edit definition, Copy block, row density, wrapped text lines).
- **Row density:** ⋯ → **Compact rows** / **Normal rows** / **Comfortable rows** (ticked) sets the row height to 26 / 34 / 44px. Group headers follow it, and so does the summary row (24 / 30 / 36px). Compact also tightens cell padding, chips and pills. The header stays 34px.
- **Wrap text:** right-click a header → **Wrap text** (a checked toggle).
  - The column's text, chips and pills (and the name) wrap onto more lines, and its rows grow to fit. Rows without long values keep the density's height.
  - ⋯ → **Wrapped text: up to N lines…** picks 2, 3, 5 (default), 10 or Unlimited. Text past the limit ends in an ellipsis, with the full text as the cell's tooltip; chips and pills past it are cut off.
  - Text is clamped with `-webkit-line-clamp: var(--oe-wrap-lines)`; chips and pills use a `max-height` from the same variable. `none` (unlimited) makes the `calc` invalid, so there's no limit.
- **Header:** sort arrows. Drag a header to reorder, and drag its right edge to resize.
- **Auto-fit:** double-click a column's resize handle, or right-click its header → **Auto-fit width**, to size it to its contents. **Auto-fit all columns** does every shown column.
  - Because the grid only draws the rows in view, the column is measured by drawing its header (with any sort arrow), every shown row (name icons, chips, pills, highlight icons and the group indent included) and its summary off-screen in an auto-sized copy of the table. Each column's natural width becomes its width.
  - The width is clamped to 60–800px. On a fill column it sets the minimum.
- **Frozen columns:** right-click a header → **Freeze** (a checked toggle; on another column it moves the freeze there).
  - That column, every column to its left and the select column stay in place when scrolling sideways, via `position: sticky` with each cell's `left` offset (computed from the shown widths, fill columns included). This applies to the header, rows, group headers and the summary row.
  - Group headers without summaries span the frozen columns, so their label stays in view.
  - While scrolled sideways, the last frozen column gets a darker right border and a soft shadow.
  - If the frozen column is hidden (grouped), the freeze stops at the last shown column before it (`frozenCount`). A removed column's freeze is dropped when the view saves.
- **Fill columns:** right-click a header → **Fill available width** (a checked toggle).
  - A fill column keeps its width as a minimum and grows to take the row's spare width, following the pane as it's resized. Several fill columns share the spare width in proportion to their widths.
  - While a column fills, the filler column is 0 wide. When the pane is too narrow, columns keep their minimums and the table scrolls sideways.
  - Dragging a fill column's edge sets its minimum: the drag shows the minimum, and the column fills again when released. Widening another column takes width from the fill column.
  - Hiding a column turns its fill off. `fillWidths` (pure, tested) does the sharing; the table measures the scroll area with a ResizeObserver.
- **Rows:**
  - A selection checkbox.
  - The name: click opens the note; Ctrl/Cmd-click opens it in a new tab; Ctrl + hover previews.
  - Right-click: the entity menu (open to the right, show connections, change type…, file menu).
- **Cells:**
  - Fields render as in the properties form's read-only mode.
  - Relations and incoming links render as chips.
  - Cells with a problem (§8.4) are outlined, with a tooltip.
- **Editing:**
  - Double-click a cell, or press Enter, to open its editor: a popover with the same control and rules as the properties form.
  - Checkboxes toggle with one click.
  - Read-only: name, built-ins other than status and tags, incoming links, roll-ups and formulas. Double-clicking a formula cell opens the formula editor.
  - Edits go into the form's Ctrl/Cmd+Z history. In the table, Ctrl/Cmd+Z undoes the last cell edit or bulk action.
- **Keyboard:** arrow keys move the focused cell, Enter edits, Esc cancels. Space selects the focused row (or toggles a focused checkbox cell); Ctrl/Cmd+A selects every shown row; Esc clears the selection; Delete / Backspace deletes the selection (after confirming).
- **Bulk actions:** see below.
- **+ New** (bottom row): creates an entity of the view's type, prefilled from simple top-level `is` / `any-of` conditions with one value. It asks for the type when the view has several.
- **Footer:** "12 of 40 · 2 selected". Above it, inside the grid, is the sticky summary row (§ Summaries).
- **Large views:** rows are virtualised inside a scroll area, so thousands of rows stay smooth.
  - **Row heights:** without wrapped columns every row is the density's height. With them, each drawn row (and group header) is measured after rendering, keyed by its note path or group key; rows not drawn yet are estimated at the density's height. `rowOffsets` turns the heights into running offsets, and `itemAt` (a binary search) finds the rows in view. Measurements are dropped when the density, wrapped columns, line limit, widths or pane width change.
  - **Scrolling:** the scroll position is read once per frame and rounded down to a 5-row block, so the grid only re-renders when the drawn rows must change. The 10-row buffer either side covers the rest.
  - **GPU scrolling:** the scroll area has an opaque background and `will-change: scroll-position`, so Chromium scrolls it on the GPU. Without that it repainted on the main thread while the frozen (sticky) cells, which are GPU layers, moved ahead of the other columns.

#### Board

A board shows the view's entities as cards in **buckets**, one per value of a field, e.g. a kanban by status. Same note, same toolbar: switch with the **Table | Board** toggle after the search box (a segmented control with icons and words; the words hide in narrow views, like the other toolbar labels).

```yaml
kind: board
types: [task]
columns: [name, status, assignee, due, priority, estimate]
summary: { estimate: sum }
board:
  buckets: status
  swimlanes: assignee            # optional, one level
  cardFields: [assignee, due, priority, estimate]
  cardSize: large                # small | medium (default) | large
  cardSubtitle: true             # the type's subtitle under the title
  cardLabels: true               # field names on cards
  hideEmpty: true
  collapsedBuckets: [done]
  hiddenBuckets: [cancelled]
  limits: { in-progress: 5 }
  order: { todo: [Tasks/B.md, Tasks/A.md] }
```

| `board:` key | Meaning |
|---|---|
| `buckets` | The bucket field: `status`, or one of the source types' own **choice**, **checkbox** or **single-link** fields. Read-only columns (formulas, roll-ups, incoming links, type, folder…), lists and multi-links can't be buckets. |
| `swimlanes` | One grouping level (`<column id>` or `{ by, date }`), shown as horizontal swimlanes. Any column can be used. |
| `cardFields` | Columns shown on cards, in order; any column, the bucket and swimlane columns included. Unset: the table's first 4 columns after the name, leaving out the bucket and swimlane columns. |
| `cardSize`, `cardSubtitle`, `cardLabels` | Card width (220 / 280 / 360px), the type's subtitle, field names. Only written when not the default. |
| `hideEmpty` | Leave out buckets with no cards. |
| `collapsedBuckets`, `hiddenBuckets` | Bucket keys shown as a narrow strip, or not at all. |
| `limits` | Bucket key → card limit. |
| `order` | Bucket key → note paths in manual order (used when the view isn't sorted). |
| `bucketOrder` | Bucket keys in the order they're shown. Unset: the field's order. The empty bucket is never in it: it's always last. |

Bucket keys are the value (a status or choice), `yes` / `no` (checkboxes), the note path (links), or `(none)` for cards without a value.

- **Buckets:**
  - **Toolbar → Buckets** picks the field (it resets the collapsed, hidden, limit, card order and bucket order settings, which belong to the old values). Switching to Board picks status when nothing is set (`defaultBuckets`); if the types have no usable field, the board says so.
  - **Order** (`bucketsOf`): statuses and choices in their defined order, every one even when empty, then values in use that aren't defined; No then Yes for checkboxes; links A→Z by name. The empty bucket ("No status", in faint italics) comes last: always for choices and links, since dropping there clears the field; for status only when used.
  - **Reordering buckets** (saved in the view as `bucketOrder`; the type's own order is unchanged):
    - Drag a bucket header (its title area; the buttons work as before) to another place: a ghost of the header follows the pointer, the bucket's column is dimmed, a line between buckets shows where it lands, the board scrolls near its edges, Esc cancels. Collapsed buckets drag by their strip. With swimlanes, drag the sticky header row and every swimlane follows. On touch, long-press.
    - The bucket menu has **Move left** / **Move right** (greyed at the ends), and **Reset bucket order** once it's been changed. Ctrl/Cmd+Shift+Alt+←/→ on a card moves its bucket, announced in the live region.
    - The empty bucket can't be picked up and is always last: dropping past the last bucket lands before it.
    - Keys the saved order doesn't know (a new status, option or linked note) go after their neighbour in the field's own order (`applyBucketOrder`); keys that no longer exist are dropped. An order that matches the field's is removed rather than saved (`moveBucketOrder`). Each move is one Ctrl/Cmd+Z step.
  - **Header:** the value (a status pill, choice pill, link with the note's type icon, or Yes / No), the count ("6 / 5" in red over a limit), +, ⋯, and a line of summaries for the bucket's cards (the view's `summary`, for card fields).
  - **Menu** (right-click or ⋯): Add card, Move left / Move right, Reset bucket order (when changed), Collapse / Expand, Set card limit…, Hide bucket, Summaries… (pick a card field, then its aggregation).
  - **Collapsed** buckets are a 40px strip with the name running down and the count, and still take drops. Hidden buckets come back from ⋯ → Hidden buckets.
  - Without swimlanes each bucket scrolls on its own and the board scrolls sideways; with swimlanes the whole board scrolls, under a sticky row of bucket headers.
  - **Large buckets** draw 50 cards, then "Show 50 more…" (the count in the header is always the full count). Drops still work.
- **Cards** (`Board.tsx`):
  - Title: the type icon and name, which opens the note (Ctrl/Cmd-click: new tab; Ctrl + hover: preview). A checkbox appears on hover to select the card.
  - Optional subtitle (2 lines), then the card fields, rendered like table cells (chips, pills, formats, formulas, roll-ups). Empty values are left out. Card text wraps.
  - Left edge: the type's colour. A matching **row** highlight rule styles the card (fill, text, icon by the title); **cell** rules style their field; data bars and colour scales show on their field.
  - **No editing on cards:** fields are read-only here; open the note, use the table, or bulk actions.
  - Right-click: the row's entity menu, or bulk actions when several cards are selected (the table's selection bar works the same).
- **Dragging** (pointer events, so mouse, pen and touch; on touch, long-press to pick a card up):
  - Dropping in another bucket writes the bucket field: a status, a choice, true / false, a link (`[[…]]` as seen from the note) or empty. Status values a card's type doesn't use are refused with a notice; cards whose type lacks the field stay put.
  - Several selected cards move together. A ghost card follows the pointer (with a count badge), the target bucket is outlined, and a line shows where the cards land. Esc cancels; the board scrolls near its edges.
  - **Order within a bucket:** with a sort, cards follow it and a drop only changes the bucket. Without one, dropping between cards saves a manual order (`board.order`, note paths; `orderRows`, `reorder`). It's written only when the cards wouldn't land there anyway, and new cards go to the bottom. Order paths follow renames while the view is open.
  - **Swimlanes:** dropping in another swimlane also sets that column, when it's one dragging can change (the same kinds as buckets, not by date). Otherwise cards stay in their own swimlane, and other swimlanes show a "can't drop" outline.
  - Each drop is one Ctrl/Cmd+Z step, restoring the frontmatter and the order. No notice for moves (failures are still reported).
- **Keyboard:** arrows move between cards (←/→ to the neighbouring bucket), Enter opens, Space selects, the context-menu key or Shift+F10 opens the card menu, Ctrl/Cmd+Shift+←/→ moves the card (or selection) to the neighbouring bucket, Ctrl/Cmd+Shift+Alt+←/→ moves the card's bucket, both announced in a live region. Ctrl/Cmd+A, Delete, Esc and Ctrl/Cmd+Z work as in the table.
- **Toolbar on a board:** Filters, Sort (within buckets), **Buckets**, **Swimlanes** (one level; "Field: value" labels and summaries follow `groupFieldNames` / `groupSummaries`), Highlight, **Card fields** (the Columns panel: an "On cards" list of the picked fields in card order, with drag handles to reorder them, or Alt+↑/↓, and a **Format** button on number and date fields that opens the Format panel in its place (accent-coloured when a format is set); the sections below offer the rest; a new roll-up or formula is added to the view's columns and to the cards), ⋯ (Save as…, Rename, Edit definition, Copy block, Small / Medium / Large cards, Show subtitles, Show field names, Hide empty buckets, Hidden buckets…).
- **Not saved:** collapsed swimlanes, the selection, "Show more" and scroll positions (kept for the session, like the table's).
- **+ New** and **Add card** prefill the bucket's (and swimlane's) value, as well as the filters' values.
- **Notes:**
  - Cards and the board region carry no `aria-label`: Obsidian shows any `aria-label` as a tooltip on hover (the region's showed "Board" over empty board space). Visually hidden spans name them for screen readers instead (the region via `aria-labelledby`; cards get their bucket, "Status: todo").
  - Cards have a fixed width (`--oe-card-w`); a bucket is as wide as its cards plus a stable scrollbar gutter, and an empty bucket's body is still a card wide.
  - With swimlanes, the board's `scroll-padding-top` is set to the sticky header row's height, so a card scrolled into view (focus, auto-scroll) isn't hidden under it.
  - The drop target is worked out before the drag state is cleared on release (an early version cleared it first and dropped nothing).

#### Bulk actions

- **Selecting:**
  - Row checkboxes select rows; Shift-click selects a range.
  - Group-header and column-header checkboxes select every row in the group or view, collapsed groups included.
  - Keyboard: Space, Ctrl/Cmd+A.
- **What a selection covers:** the selected rows that match the view's filters. A quick search doesn't drop them: with a search active and every shown row selected, **Select all N in view** adds the rows the search hides. Rows that stop matching the filters (e.g. after a bulk change) drop out. The selection lasts for the session, not across reopening.
- **Selection bar:** while rows are selected, the toolbar's buttons give way to:
  - "12 selected"
  - **Set field…**, **Links…** (Add / Remove link), **Tags…**, **Change type…**, **Delete…**
  - ⋯ (Move to folder…, Duplicate, Open in new tabs, Copy as list of links)
  - ✕ to clear
- **Row menu:** right-clicking a selected row, when several are selected, shows the same actions under "12 entities selected".
- **Actions** (the logic is in `model/bulk.ts`; `services/bulkActions.ts` does the work):
  - **Set field…:**
    - Pick status, tags or any field the selected types have (`bulkFields`). A field only some types have shows those types, and the others are skipped (the dialog says how many).
    - The value uses the properties form's control for the kind. Status offers the union of the types' statuses; entities whose type can't have the chosen status are skipped.
    - **Clear <field>** empties it on all of them; the key stays, like the form.
  - **Add link… / Remove link…:**
    - Pick a relation field. Add: pick one or more entities, and each is added as seen from each note (no duplicates; a single-link field gets replaced).
    - Remove: tick the notes the selection links to in that field, with how many link to each.
  - **Tags…:** add tags, and/or remove any of the selection's current tags (shown with counts). Matching ignores case and `#`.
  - **Change type…:** `retype` on each note, as for one entity: fields added, values kept, status reset when not valid. Notes already of that type are skipped.
  - **Move to folder…:** pick a folder, into which the notes move. A name that's taken gets a number.
  - **Duplicate:** "Name (copy)" (then "(copy 2)"…) next to each note, with the same content.
  - **Open:** each note in a new background tab, after confirming if there are more than 10.
  - **Copy as list of links:** `[[Note]]` lines.
  - **Delete…:** confirms with the names, then trashes each note with `fileManager.trashFile` (following Obsidian's "Deleted files" setting). It can't be undone from the table.
- **Applying:**
  - Notes are written one by one. More than 20 show a progress notice ("Updating 37 of 120…").
  - Notes a change wouldn't alter are checked on a copy of their frontmatter first, so they're not rewritten.
  - Failures are collected and listed in a notice at the end without stopping the rest.
- **Undo:** each action is one step, on Ctrl/Cmd+Z in the table (`edits` holds cell edits and bulk undos, newest last) or the notice's **Undo** link.
  - Frontmatter actions restore each changed note's whole frontmatter from a snapshot taken just before writing.
  - Moves go back to their old paths.
  - Duplicates are trashed.

#### Saving

- **Autosave:** changes to columns, widths, sorting, grouping and filters are written back to the block (via `getSectionInfo`), debounced about 500 ms. Writes are held while a popover is open.
- **Not saved:** quick search, collapsed groups, selection and scroll position. These are kept for the session per block, so they survive the re-render after a write.
- **Undo:** Ctrl/Cmd+Z in the editor undoes a view change, because it's a note edit.
- **Save as…** asks for a name and creates a copy in the views folder.
- **Rename** renames the note. **Edit definition** switches to Source mode. **Copy block** copies the block's text.

#### Opening

- **Entity view tabs:** a view note opens as a dedicated **entity view** tab (`EntityViewView`, a `TextFileView`). The table fills the tab edge to edge, like the Entity Types editor: toolbar on top, the grid filling the rest, footer at the bottom, no page margins.
  - **How:** `WorkspaceLeaf.prototype.setViewState` is wrapped, the approach the Kanban plugin uses for its board notes. A Markdown open of a view note (any way of opening it: browser, picker, links, file explorer) becomes an entity view.
  - **Tab:** the note's name, with a table or board icon (it follows the Table / Board toggle).
  - **Open as Markdown** (a header button, the pane menu, and ⋯) shows the note itself in that tab, to edit the definition or text below the block, until another file opens there. A Markdown tab showing a view note has an **Open as entity view** header button.
  - **Saving:** edits go into the note's first `entity-view` block through the view's own data (`requestSave`). Pending changes are flushed before the file unloads.
  - **Setting:** "Open view notes as entity views" (on by default).
- **Elsewhere:** embeds (`![[View]]`) and blocks in other notes render inline as before.
- **New entity view** (command, and the browser's Views section +): pick a type (or all entities), Table or Board, and a name, and the note is created and opened. A new board has status buckets.
- **Open entity view…**: a picker of view notes, i.e. notes in the views folder that contain an `entity-view` block.
- **Browser:** a **Views** section at the top lists view notes, with a board icon for boards (`ViewIndex` reads each block's `kind`); clicking opens the view in its saved layout. Type and group headings get "New table view of <plural>" and "New board of <plural>".

**AC:**
- [x] A view note renders an interactive table in both modes and survives sync without the plugin.
- [x] Columns, filters (including nested groups and relative dates), sorting and grouping all round-trip through the block.
- [x] Roll-ups count, sum and list across incoming relationships.
- [x] Editing a cell follows the properties form's rules, and Ctrl/Cmd+Z undoes it.
- [x] 2,000 rows scroll smoothly. Tested with 5,600 in-memory rows: about 0.5 s to render, about 0.4 s to search or sort, with 32 rows in the page.

**Notes:**
- **Full tab:** a view placed directly in a note spans the whole pane, ignoring the readable line width, in both Live Preview and Reading view. Its scroll area can grow to the pane's height. Embedded views (`![[View]]`), views in callouts and hover previews keep their normal size.
  - `ViewBlock.fit()` measures the pane (`.cm-scroller` / `.markdown-preview-view`) and sets the host's margin and width, tracking resizes with ResizeObserver. It only styles its own element: changing CodeMirror's `.cm-embed-block` makes the editor redraw the widget.
  - For that widget, CSS lifts Obsidian's `contain: paint !important` and hides its "Edit this block" button (⋯ → Edit definition does the same).
  - A filler column takes spare width, so the grid reaches the right edge while column widths stay exact.
- **Overriding note table styles:** Obsidian's Markdown table styles (`.markdown-rendered thead tr > th:nth-child(2n+2)` and others) apply to the grid. The table's selectors use `table.oe-table > thead > tr > th` to outrank them.
- **Live Preview:** Obsidian puts an "Edit this block" button in the block's top-right corner. For views that aren't full-tab (embeds), the toolbar keeps 40 px clear on that side.
- **Narrow views:** below 760 px wide (a container query), toolbar buttons show only their icons.
- **New view notes** open with the cursor after the block, so Live Preview shows the table and not the block's source.

---

## 9. Validation rules

`typeIssues(type, allTypeKeys)` returns `{ at, message }[]`, where `at` locates the control. `validateType()` is the same list as plain messages.

| `at` | Rule | Message |
|---|---|---|
| `key` | matches `^[a-z][a-z0-9_]*$` | Type key "X" must be lowercase letters, digits or underscores. |
| `key` | new type: not already taken | A type with the key "x" already exists. |
| `name` | not blank | Type name is required. *(shown after a save attempt)* |
| `group` | a known group | Choose a group. |
| `folderPattern` | the exception uses only `{group}` / `{entity}` | Unknown placeholder in the folder: {type}. Use {group} or {entity}. |
| `field:i:key` | valid pattern | Field key "X" must be lowercase letters, digits or underscores. *(blank → "Give this field a label.")* |
| `field:i:key` | not a common key (`entity`, `status`, `tags`, `aliases`, `related`, `order`) | Field key "status" is reserved. |
| `field:i:key` | unique within the type | Duplicate field key "x". |
| `field:i:options` | select/multiselect has ≥1 option | Choice field "x" needs at least one option. |
| `field:i:targets` | every target is a known type key, `*` or `@<known group>` | Field "x" targets unknown type "y". |
| `field:i:default` | the default is valid for the kind (e.g. one of the options) | Default "z" isn't one of the options. |
| `parentFields` | each is a relation field of this type | Parent field "x" isn't a relation field. |
| `card:subtitle` | each is an existing non-relation field of this type | Subtitle field "x" doesn't exist. / Relation fields can't be used in the subtitle. |

Deleting a type also strips its key from every other type's `targets`.

---

## 10. Settings schema and migrations

```ts
interface Settings {
  settingsVersion: number;
  folderPattern: string;          // "Entities/{group}/{entity}"
  templatesFolder: string;
  openInNewTab: boolean;
  prefillFromActive: boolean;
  useForm: boolean;               // default true: the properties form replaces Obsidian's Properties block
  formCollapsed: boolean;         // the form's collapse state, shared by all notes
  groups: GroupDef[];
  types: EntityTypeDef[];
  modules: { graph: boolean; dashboard: boolean; /* … */ };
}
```

`mergeSettings(saved)`:
- Start from the defaults, overlay the saved values, and deep-merge the nested objects (`modules`).
- Keep the user's types. Append **pack** types that a newer pack version added, unless the user deleted them; track deletions in `deletedPackTypes`.
- **Versioned migrations run once each** (`if ((saved.settingsVersion ?? 1) < N) { … }`), then set `settingsVersion` to the current version. Gating them on the version is what lets a user delete a field the migration added without it coming back. Story Forge does this when adding family fields.
- Normalise lists: drop unknown values and add missing defaults in their natural position.
- **Versions so far:**
  - **v2** turned the info card off once.
  - **v3** replaced it with the properties form: `showCard` / `cardCollapsed` are dropped, `useForm` defaults to true, and `cloneType` strips the old card-body keys from every type.

---

## 11. Implementation notes and lessons learned

These come from building and testing Story Forge against real vaults.

**Obsidian API**
- **Deferred views (Obsidian 1.7+):** background tabs aren't loaded. Call `await leaf.loadIfDeferred?.()` before using `leaf.view`. Find existing tabs by `leaf.getViewState().state`, not with `instanceof`, or you'll open duplicates.
- **Reveal and focus:** `workspace.revealLeaf(leaf)` shows a tab but doesn't focus it. Follow it with `workspace.setActiveLeaf(leaf, { focus: true })`.
- **`processFrontMatter`** is the only safe way to write frontmatter. Group the edits for one file into one call.
- **Renames:** Obsidian updates wikilinks in frontmatter automatically, so keep relations as wikilink strings. Update any stored paths yourself (pins, view state) on `vault.on("rename")`.
- **Dynamic commands:** commands can't be unregistered. Register `create-<type>` once per key with a `checkCallback` that returns `false` when the type no longer exists.
- **Settings modal:** close it (`app.setting.close()`) before opening a view from it, or the view opens hidden behind the modal.
- **Hover previews:** call `registerHoverLinkSource(id, …)`, then trigger `hover-link` with that source.

**Data**
- **Path case:** `getAbstractFileByPath` is case-sensitive but Windows/macOS file systems aren't. Match existing folder names case-insensitively before creating folders, and check file-name clashes case-insensitively, or `vault.createFolder`/`create` fail with "already exists".
- **Reserved keys:** keep fields like a "parent" pointer *out* of the common-keys list, or validation will reject legitimate fields. Story Forge hit this with `campaign`.
- **Indexing cost:** rebuild from scratch on each change, with debounces of 100–150 ms. It's simpler than incremental updates and fast enough.
- **Default colours:** match the palette to the default pack's colours, so built-in types show a selected swatch.

**UI and styling**
- **Toolbars:** give every control in a toolbar the same height (`var(--input-height)`). Mixed heights look broken.
- **Flex layouts:** in a column whose content can overflow, give fixed headers and toolbars `flex-shrink: 0`. Without it, one squashed to 2 px.
- **Canvas libraries** (Cytoscape and similar) need concrete colours (see §8.9). Plain DOM/SVG can use `var(--…)` directly.
- **Styles:** use theme variables everywhere (`--background-*`, `--text-*`, `--interactive-accent`, `--color-*`). Prefix all classes (`oe-`) and avoid `!important`.
- **Dense lists:** prefer `color-mix(in srgb, var(--type-color) 14%, transparent)` for tinted chips.

**Editing UX**
- **Drafts and Undo:** edits that affect several notes need a preview of what changes and an Undo notice that restores the exact previous values (snapshot them first).
- **Hover-to-trace:** dim everything except the hovered item's direct connections. It works well across views (graph, lists).

**Tooling**
- **Encoding:** write files as UTF-8 **without a BOM**. On Windows, PowerShell 5's `Set-Content -Encoding UTF8` adds one, and `Get-Content` without `-Encoding UTF8` corrupts non-ASCII characters like `–` and `·`.
- **React 19:** no global `JSX` namespace, and `StrictMode` double-invokes effects in development. Every effect must clean up (destroy charts, disconnect observers).
- **TypeScript:** recent versions dropped `baseUrl`, and `moment` needs a cast when imported from `obsidian`.

---

## 12. Testing strategy

### Unit tests (vitest)

These cover all of `model/`, with no Obsidian dependency:

- **links:** parse every link form; labelled entries in alias and legacy object form; rejecting malformed links.
- **relations:** edge extraction (single, multiple, labelled, `related`, self-links, unresolved), grouping rules (§5.2 table), `addLink`/`removeLink`.
- **frontmatter:** build for every field kind; merge rules (generated vs existing vs `preferExisting`, tag union).
- **templates:** placeholders, unknown placeholders left alone, date formats.
- **paths:** sanitising, unique paths, every folder mode.
- **tree:** forests with mixed types and priority parent fields, cycles, filtering that keeps ancestors, `ancestorsOf`, `childOptions`.
- **views:**
  - parse/serialize round trip for every column form, including `f:` ids for clashing keys
  - errors for bad pieces
  - available columns and roll-up sources
  - cell values: fields, built-ins, incoming, every roll-up aggregation
  - every filter kind, nested groups and relative dates; ignored conditions (missing values, unreadable numbers and dates, unknown columns and operators) neither matching nor blocking, in "all" and "any" groups and nested groups; reporting them in words
  - natural, status-order and multi-level sorting with empty values last
  - header sort cycling
  - grouping by status, month and list values; nesting any number of levels (paths, levels, per-level order, unknown levels skipped); grouped columns left out of the shown columns; `group` read only as a list, repeats skipped, bad levels reported; `groupSummaries` / `groupFieldNames` round trips
  - prefill from filters
  - formats: parse/serialize, formatted cells and group labels, sorting on raw values
  - highlight: parse/serialize and errors, first-match precedence for rows and cells, cell styles layered over row styles (icons replaced), disabled rules, hidden fields in conditions, hidden target columns, unusable conditions, match counts
  - data bars and colour scales: round trips without defaults and errors for bad kinds and colours; bars from zero, fixed bounds, clamping, negative values from the zero line; date bars; empty cells; conditions limiting rows and bounds; two- and three-colour scales, percentiles and relative dates; leaving highlights alone; hidden and disabled rules; a bar and a scale on one column
  - fill columns: parse/serialize as a name or list, proportional sharing, rounding to the exact width, nothing when there's no spare width
  - frozen columns: parse/serialize (removed column dropped), `frozenCount` including a hidden frozen column
  - density and wrapping: parse/serialize without defaults, `unlimited` lines, repeated and removed wrap columns dropped, an error for a bad density; `rowHeight`, `rowOffsets`, `itemAt` at and between boundaries
- **board:** `board:` round trips without defaults, both layouts' settings surviving a switch, formats and summaries of card fields kept, errors; bucket fields (status and single-value choice / checkbox / link fields only, never read-only columns), types with the field; default card fields (and picked ones, bucket and swimlane columns included) and the run definition; bucket order for status, choices (undefined values, the empty bucket), links and checkboxes, hidden and empty buckets, sort within buckets; manual order (`orderRows`, `reorder`); bucket order (round trips without the empty bucket, saved order applied with unknown keys after their neighbour, the empty bucket always last, moves that return to the field's order saving nothing, stepping left / right).
  - summaries: parse/serialize (removed columns dropped, the group header toggle), every aggregation, status-order value counts, formatted sums and dates, empty results, options by column kind, `spanText`
- **formats:** date presets, custom and relative dates; number presets, currencies, custom patterns and their errors.
- **formula:** tokenizing, precedence, syntax errors with positions; reference resolution by label or id, type inference, unknown columns / names / functions and argument counts; label ↔ id conversion; every function's example compiles; evaluation of arithmetic, dates, comparisons, empty values and runtime errors, and every function category (including lazy logic, `dateAdd` / `dateDiff` month ends, `map` / `filter` / `prop`). In views: per-row values, kinds used for sorting and filtering, formulas using formulas and linked notes' fields, type overrides, invalid columns, loops, per-row errors, round trips.
- **bulk:** shared fields across types (kinds that differ, status and tags), status unions, set / clear (keys kept, values copied, no-op detection), add / remove links (duplicates, single fields), add / remove tags (case and #), which entities a change applies to, set values by kind, notice text, copy names.
- **viewBlock:** finding blocks, and replacing one by line or content, keeping callout prefixes, CRLF, longer fences, and closing an unclosed block.
- **validation:** every row of §9, with the right `at`.
- **card:** subtitle composition (several fields, empty values skipped, first line of a textarea); renaming or deleting a field updates `card.subtitle` and `parentFields` in the draft.
- **form:**
  - `checkField` / `entityProblems` for every row of the §8.4 table, with fixes
  - `otherKeys`, `otherKind` / `fieldKindFor`, `parseInput`
  - `retype`: fields added, values kept, status reset
  - `EditHistory`: cap, order, renames
- **typeEditing:**
  - drafts and dirtiness
  - `fieldChanges`: renames, deletes, a deleted key reused by a new field
  - `migrateFrontmatter`: rename, swap, conflict, no-op
  - incoming relations
  - the relationship dialog's field and its sentence
  - duplicate, export/import (round trip, clashes, bad input)
  - sample values
- **settings:** merging, versioned migrations that run once, normalising lists.

### End-to-end tests

Drive a real Obsidian instance via the Chrome DevTools Protocol (Obsidian started with `--remote-debugging-port=9222`) and `playwright-core`'s `connectOverCDP`.

- Wait for `app.workspace.onLayoutReady` before acting.
- Put temporary test data in a dedicated folder (e.g. `OE-Test/`) and delete it afterwards.
- Back up `.obsidian/plugins/<id>/data.json` (and `appearance.json` if themes are switched) before the test and **restore it byte for byte** afterwards.
- Cover:
  - creating a type in the editor and saving it
  - creating notes of that type, with an inline-created linked note
  - renaming a key with migration, and deleting with removal
  - browser nesting, filtering, collapse-all and "new child here"
  - the properties form in both modes:
    - editing and rejected input
    - wrong-type links and Fix
    - Ctrl/Cmd+Z
    - pickers and chip keyboard
    - other properties and change type
    - Check entities, and the setting toggle
  - Connections panel add/remove link
  - switcher type prefixes
  - import/export
  - boards, on a scratch view: buckets and counts, mouse drags between buckets (status, choice, empty bucket, link) with undo, reordering (drop line, saved order, undo), moving a selection, swimlanes (writable and not), collapsed buckets taking drops, limits, hiding, card options and fields, highlight rules on cards, keyboard moves, Add card prefill, the Table / Board toggle and tab icon, paging big buckets, the New view dialog. Scroll the card and the target into view (centred) before dragging, as auto-scroll would. Board drags write notes: back up the vault's notes first and compare afterwards.
- Check **dark and light themes** and at least one community theme.

### Manual checklist per release

- Mobile layout (if supported).
- 1,000+ entity vault performance: index rebuild under 200 ms, browser scroll smooth.
- Uninstall: notes remain valid Markdown with readable frontmatter.

### Build and deploy

- `npm run build`: `tsc --noEmit`, then an esbuild bundle (`main.js`, CJS, `obsidian`/`electron`/`@codemirror/*` external), then copy `main.js`, `manifest.json` and `styles.css` into `<test vault>/.obsidian/plugins/<id>/`. The vault path is read from a git-ignored `.vault-path` file.
- `npm run dev`: esbuild in watch mode with the same copy step. Use the Hot Reload plugin, or a CDP "reload plugin" script (`app.plugins.disablePlugin(id)` then `enablePlugin(id)`).
- `npm test`: vitest.

---

## 13. Milestones

| # | Milestone | Scope | Exit criteria |
|---|---|---|---|
| M1 ✅ | **Foundation** | Scaffold (TS, esbuild, React 19, vitest, deploy-to-test-vault script); settings with groups and types; starter pack; model modules (links, frontmatter, paths, templates, validation, card subtitle, ISO date adapter, packs); EntityIndex; EntityFactory; Create dialog with relation picker; Convert; Find entity; per-type commands; **Import entity types…** (paste a pack; brought forward from M3/M5 so types can be added before the editor exists) | Can define types (via an imported pack), create typed notes with links, find them |
| M2 ✅ | **Relationships** | RelationIndex with inverses; `groupRelations`; `cardSections` (per-type card content); info card (both modes, later replaced by the properties form); Connections panel (list, filter, + Link, Mentioned in, Convert); Add/Remove link with Undo | Inverses visible on target notes; links editable without touching YAML |
| M3 ✅ | **Entity Types view** | Full editor (§8.1): sidebar with groups, group editor (statuses with rename migration, reorder, delete when empty), General/Fields/Relationships/Display tabs, guided relationship dialog, drafts, validation, save bar with migrations, preview (dialog / picker / card, now the properties form), pack import/export, duplicate, reset to starter, delete; settings button, ribbon, command, file menu | Non-technical user can build a domain model end-to-end without editing JSON |
| M4 ✅ | **Browser** | Groups (or one tree), type headings, hierarchies from parent fields (cross-group option), View menu, filters with dimmed context, reveal active, collapse semantics, row/heading context menus with "New child here", state persistence | Large vaults navigable; hierarchy correct for mixed types |
| M4.5 ✅ | **Entity properties form** | Form replacing Obsidian's Properties block on entity notes (§8.4): typed controls, link pickers limited to allowed types, rejected invalid input, problems with fixes, Ctrl/Cmd+Z history, Other properties with "Add to type", Change type with move offer, Check entities command; info card removed (settings v3) | Values can only be entered in a form the type allows; problems from elsewhere are visible and fixable |
| M4.6 ✅ | **Entity views: table** | View notes with an `entity-view` block (§8.10): source types, columns (fields, built-ins, incoming, roll-ups; formulas added later), filters with groups and relative dates, multi-level sort, group by, inline editing with the form's rules, virtualised rows, autosave, Save as…, New / Open view commands, browser Views section | Named views can be saved, reopened elsewhere, and used to edit entities |
| M5 | **Packs & polish** | Type packs (bundled example pack + import/export of groups), template generation, ribbon options, accessibility pass (keyboard navigation in lists, ARIA on toggles), docs | Ready for a public/BRAT release |
| M6+ | **Modules** | Graph, overview dashboard, bulk edit, Bases generation, domain views | Each behind a module toggle |

---

## 14. Open decisions

Decide these when starting the new project.

1. **Name and identifiers:** *decided*: Obsidian Entities, id `obs-entities`, prefix `oe-`, type key `entity`, fixed common keys, no `summary` key.
2. **First run:** *decided*: a generic starter pack (Person, Organisation, Place, Project, Note) is installed on first run; a "Start from a pack" picker can come in M5.
3. **Groups vs flat:** *decided*: groups are always present. The starter pack has Directory and Work. Folders come from one pattern, `Entities/{group}/{entity}` (§3.4), not per group or type.
4. **Status model:** *decided*: per group (Directory: draft, active, archived; Work: idea, active, on-hold, done), with an optional per-type override.
5. **Dates:** *decided*: ISO in v1, behind the `DateAdapter` interface from the start.
6. **Mobile:** support from v1 (test the touch interactions: drag handles, hover alternatives), or mark desktop-only initially?
7. **Bases integration:** generate `.base` files per type from the Entity Types view (Obsidian 1.9+)?
8. **Relation storage of labels:** keep the alias format, or offer a parallel `<field>_labels` property for tools that strip aliases?
9. **Multiple types per note:** out of scope (one `entity` value per note) or supported as a list?
10. **Internationalisation:** string catalogue from the start?
11. **Cross-group hierarchy:** should a child nest under a parent from another group in the browser (e.g. Deals under their Company), or stay flat in its own group (the current rule)?

---

## Appendix A — TypeScript interfaces

```ts
export type FieldKind =
  | "text" | "textarea" | "number" | "date" | "select" | "multiselect"
  | "list" | "boolean" | "url" | "relation";

/** Type keys, "*" (any entity) or "@<groupKey>" (any type in a group). */
export type RelationTarget = string;

export interface FieldDef {
  key: string;                    // ^[a-z][a-z0-9_]*$, not a common key
  label: string;
  kind: FieldKind;
  description?: string;
  options?: string[];             // select / multiselect
  default?: unknown;
  inModal?: boolean;              // show in the create dialog
  required?: boolean;
  // relation only
  targets?: RelationTarget[];
  multiple?: boolean;             // list of links (implied by labelled)
  inverse?: string;               // label on the target note
  symmetric?: boolean;            // reads both ways
  labelled?: boolean;             // each link has a label (stored as the alias)
}

export type FolderMode = "type" | "parent" | "own";

/** Fixed common frontmatter keys (§3.2). */
export const COMMON_KEYS = {
  type: "entity",
  status: "status",
  tags: "tags",
  aliases: "aliases",
  related: "related",
  order: "order",
} as const;

/** What compact displays show for a type (§4.5). */
export interface CardConfig {
  subtitle?: string[];            // non-relation field keys, joined with " · "
}

/** Properties form options for a type (§8.4). */
export interface FormConfig {
  hideEmpty?: boolean;            // list only filled fields (default false)
}

export interface EntityTypeDef {
  key: string;                    // immutable once saved
  name: string;
  plural: string;
  icon: string;                   // Lucide id
  color: string;                  // #rrggbb
  group: string;                  // GroupDef.key
  folderPattern?: string;         // exception to the global folder pattern ({group}, {entity}); unset = global
  folderMode?: FolderMode;        // default "type"
  template: string;               // file name in the templates folder
  sections?: string[];            // headings for the built-in default template
  shortcuts?: string[];
  statuses?: string[];            // override group statuses
  parentFields?: string[];        // hierarchy, priority order
  card?: CardConfig;
  form?: FormConfig;
  fields: FieldDef[];
  pack?: string;                  // pack id if installed from a pack
  builtIn: boolean;
}

export interface GroupDef {
  key: string;
  name: string;
  icon: string;
  statuses: string[];             // first = draft / not started
}

export interface EntityInfo {     // what pure logic needs
  path: string;
  name: string;
  type: EntityTypeDef;
  status: string | null;
  subtitle: string | null;        // computed from type.card.subtitle
  tags: string[];
  mtime: number;
  ctime?: number;
  order: number | null;
  frontmatter: Record<string, unknown>;
}

export interface EntityRecord extends EntityInfo {   // services/UI
  file: import("obsidian").TFile;
  aliases: string[];
}

export interface Edge {
  source: string;
  target: string | null;
  linktext: string;
  sourceType: string;
  fieldKey: string;
  fieldLabel: string;
  inverse?: string;
  symmetric: boolean;
  labelled: boolean;
  label?: string;
  related: boolean;
  targets?: string[];
}

export type Direction = "out" | "in" | "both";

export interface RelationItem { path: string | null; linktext: string; direction: Direction; edge: Edge; }
export interface RelationGroup { key: string; title: string; direction: Direction; items: RelationItem[]; fieldKey?: string; }

export interface TypeIssue { at: string; message: string; }

// Type editor drafts
export interface FieldMeta { uid: string; origKey: string | null; }
export interface TypeDraft { type: EntityTypeDef; original: EntityTypeDef | null; meta: FieldMeta[]; }
export interface FieldChanges {
  renames: { from: string; to: string; label: string }[];
  deleted: { key: string; label: string }[];
}

// Create dialog
export type FieldValue = string | number | boolean | string[] | { target: string; label: string }[] | null;
export interface EntityFormValues {
  name: string;
  status: string;
  tags: string[];
  fields: Record<string, FieldValue>;   // relation values are link texts
}

// Packs
export interface TypePack {
  obsEntitiesPack: 1;
  id?: string;
  name?: string;
  groups?: GroupDef[];
  types: Omit<EntityTypeDef, "builtIn">[];
}
```

## Appendix B — Example type pack (JSON)

```json
{
  "obsEntitiesPack": 1,
  "id": "crm-basic",
  "name": "Basic CRM",
  "groups": [
    { "key": "people", "name": "People", "icon": "users", "statuses": ["lead", "active", "inactive"] },
    { "key": "orgs", "name": "Organisations", "icon": "building-2", "statuses": ["prospect", "customer", "former"] },
    { "key": "sales", "name": "Sales", "icon": "briefcase", "statuses": ["open", "won", "lost"] }
  ],
  "types": [
    {
      "key": "person", "name": "Person", "plural": "People", "icon": "user", "color": "#2196f3",
      "group": "people", "template": "Person.md", "shortcuts": ["p"],
      "card": { "subtitle": ["role", "email"] },
      "fields": [
        { "key": "role", "label": "Role", "kind": "text", "inModal": true },
        { "key": "email", "label": "Email", "kind": "url", "inModal": true },
        { "key": "works_at", "label": "Works at", "kind": "relation", "targets": ["company"], "inverse": "People", "inModal": true },
        { "key": "knows", "label": "Knows", "kind": "relation", "targets": ["person"], "multiple": true, "labelled": true, "inverse": "Known by" }
      ]
    },
    {
      "key": "company", "name": "Company", "plural": "Companies", "icon": "building-2", "color": "#3f51b5",
      "group": "orgs", "template": "Company.md", "parentFields": ["subsidiary_of"],
      "card": { "subtitle": ["industry"] },
      "fields": [
        { "key": "industry", "label": "Industry", "kind": "select", "options": ["Software", "Finance", "Retail", "Other"], "inModal": true },
        { "key": "website", "label": "Website", "kind": "url" },
        { "key": "subsidiary_of", "label": "Subsidiary of", "kind": "relation", "targets": ["company"], "inverse": "Subsidiaries" }
      ]
    },
    {
      "key": "deal", "name": "Deal", "plural": "Deals", "icon": "handshake", "color": "#4caf50",
      "group": "sales", "folderMode": "parent", "template": "Deal.md", "parentFields": ["company"],
      "card": { "subtitle": ["description"] },
      "fields": [
        { "key": "description", "label": "Description", "kind": "textarea", "inModal": true },
        { "key": "company", "label": "Company", "kind": "relation", "targets": ["company"], "inverse": "Deals", "required": true, "inModal": true },
        { "key": "value", "label": "Value", "kind": "number", "inModal": true },
        { "key": "close_date", "label": "Close date", "kind": "date", "inModal": true },
        { "key": "contacts", "label": "Contacts", "kind": "relation", "targets": ["person"], "multiple": true, "labelled": true, "inverse": "Deals" }
      ]
    }
  ]
}
```

Note: Deal's parent (Company) is in a different group, so in the browser deals stay flat under Sales; `folderMode: "parent"` still files them in a `Deals/` folder next to their company (with the default pattern, `Entities/Organisations/Companies/Deals/`). Decide whether cross-group parents should nest (§14).

## Appendix C — Example note

`Entities/Organisations/Companies/Deals/Acme renewal 2027.md` (default folder pattern, deal filed next to its company):

```markdown
---
entity: deal
status: open
description: Three-year renewal with an upsell to the enterprise tier.
company: "[[Acme Ltd]]"
value: 120000
close_date: 2027-03-31
contacts:
  - "[[Ada Lovelace|economic buyer]]"
  - "[[Grace Hopper|technical lead]]"
related: []
tags: [renewal]
---
## Overview

## Next steps

## Notes
```

In the Connections panel, **Acme Ltd** shows "Deals: Acme renewal 2027", and **Ada Lovelace** shows "Economic buyer of: Acme renewal 2027" (a labelled inverse).

The deal's properties form (Live Preview):

```
[Deal] [open ▾]  Three-year renewal with an upsell to the enterprise tier.      ⇄ ⋯ ˄
Description   Three-year renewal with an upsell to the enterprise tier.
Company *     [Acme Ltd]  Change…
Value         120000
Close date    2027-03-31  📅
Contacts      [Ada Lovelace · economic buyer] [Grace Hopper · technical lead]  Add…
Related       Empty
Tags          #renewal  Add…
Aliases       Empty
› Other properties 0
```

In link pickers and the switcher, the deal shows as **Acme renewal 2027**, with its description underneath as the subtitle.

## Appendix D — Mapping from Story Forge

| Story Forge | Obsidian Entities | Change |
|---|---|---|
| `category: "world" \| "story"` | `group` (user-defined `GroupDef`) | Generalised |
| `entity_type` property | `entity` property | Renamed. Story Forge notes need `entity_type` → `entity` before the new plugin recognises them. |
| `summary` common property | Per-type `card.subtitle` fields (§4.5) | Removed; each type chooses its own description fields |
| Info card shows all filled fields | Properties form replacing Obsidian's Properties block (§8.4) | Replaced |
| World / story statuses (hard-coded) | `GroupDef.statuses`, `EntityTypeDef.statuses` | Configurable |
| `worldRoot` / `storyRoot` / campaign folder rule | One folder pattern (`{group}`, `{entity}`) + `folderMode` (`type` / `parent` / `own`) | Generalised |
| `TREE_GROUPS` (hard-coded Places / Storylines hierarchies) | `parentFields` per type, edited in the Display tab | Data-driven |
| 16 built-in fantasy types | Empty list or example pack; domains as packs | Removed / packaged |
| Fantasy calendar + date parsing | `DateAdapter` extension point; ISO default | Extracted |
| Timeline, Storyline board, Family tree, Faction grid, Dashboard | Optional modules (§8.9) | Out of core |
| Entity types view (§6.10 of Story Forge DESIGN.md) | §8.1, plus a Display tab and groups | Kept, extended |
| World Browser | Entity Browser (§8.3) | Kept, generalised |
| Connections panel, switcher, create dialog | §8.2, §8.5, §8.6 | Kept |
| Labelled relations as `[[Target\|label]]` | Same | Kept |
| `typeIssues`, drafts, `migrateFrontmatter`, import/export | Same, with a pack format | Kept |

### Reusable Story Forge source (copy and adapt)

| File | Reuse |
|---|---|
| `src/model/links.ts`, `relations.ts`, `frontmatter.ts`, `templates.ts`, `paths.ts` | Almost as-is. Replace `category` logic with `group` / `folderMode`. |
| `src/model/types.ts` (`typeIssues`, `validateType`, `typeMatchesTarget`) | Add `@group` targets, group and parentFields checks. |
| `src/model/typeEditing.ts` | As-is. Change the export format to packs. |
| `src/model/tree.ts` | Replace `TREE_GROUPS` with per-type `parentFields`. |
| `src/services/entityIndex.ts`, `relationIndex.ts`, `entityFactory.ts` | Remove family / campaign specifics. |
| `src/ui/react/types/*` (TypeManager, tabs, controls, preview) | Add the Display tab and group selector; remove the Timeline tab. |
| `src/ui/react/WorldBrowser.tsx`, `EntityCard.tsx`, `ConnectionsPanel.tsx`, `RelationGroups.tsx`, `EntityChip.tsx` | Rename, and drop domain buttons (board, family, factions). |
| `src/ui/header/headerManager.tsx` | As-is (rename classes). |
| `src/ui/modals/*`, `src/ui/components/*` | As-is. |
| `tests/model.test.ts`, `typeEditing.test.ts`, `tree.test.ts`, `dashboard.test.ts` (parts) | Port alongside the modules. |
