# Entity notes

An entity is an ordinary Markdown note whose frontmatter names its type; this page explains exactly what's written in it.

## What makes a note an entity

A note is an entity when its frontmatter has an `entity` property **and** that property names the key of a type you have. Everything else about it is normal: it lives in your vault, syncs, and can be edited with any tool.

```yaml
---
entity: project
status: active
owner: "[[Ada Lovelace]]"
team:
  - "[[Grace Hopper]]"
  - "[[Alan Turing]]"
due: 2027-03-31
budget: 120000
related: []
tags: []
---
## Overview
```

You rarely need to touch this YAML. The [properties form](/reference/properties-form) replaces Obsidian's Properties block on entity notes, and only lets values that suit the type go in. Source mode still shows the raw YAML.

### Turning an existing note into an entity

- **Convert current note to entity** (a command), or **Convert to entity…** in the note's file menu, asks for a type. Values already in the note are kept, and the type's missing fields are added empty.
- Notes that aren't entities show a **Convert to entity** button in the [side panel](/reference/side-panel).
- **Create entity type from this note…** (file menu) works out a whole new type from a note's properties. See [Types and groups](/reference/types#creating-a-type-from-a-note).

If you delete a type, its notes keep `entity: <key>` and all their values. They stop being treated as entities until a type with that key exists again.

## The fixed properties

Six properties are the same on every entity, whatever its type. Their names are reserved, so a field can't use them.

| Property | What it holds |
|---|---|
| `entity` | The type's **key**, such as `person` or `project`. Change it and the note becomes another type (use **Change type…** rather than editing it by hand; see below). |
| `status` | One of the statuses of the note's type, or of its group when the type doesn't have its own. New notes start with the first status. |
| `tags` | Ordinary Obsidian tags, as a list. |
| `aliases` | Ordinary Obsidian aliases, as a list. When a note's name has characters a file name can't have, the plugin saves the file under a tidied name and adds the original name here. |
| `related` | General links to any notes, as a list of wikilinks. They read both ways and show under **Related** on both notes. See [Relationships](/reference/relationships#related-links). |
| `order` | A number that sorts a note among its siblings in the [Entity Browser](/reference/browser). It's only used, and only shown in the form, for types that have parent fields. |

### Status

- The list of statuses comes from the type's group, unless the type has its own (see [Types and groups](/reference/types#statuses)).
- The **first** status is where new notes start. The **last** status counts as done when the plugin works out progress, such as a roll-up's **% done** or a dashboard's progress bar.
- A status that isn't in the list is flagged as a problem (see [Values that don't fit](#values-that-don-t-fit-the-type)).

## How each field kind is written

Every other property comes from the type's fields. The property name is the field's **key** (shown as **Frontmatter key** in the type editor), not its label.

| Kind | Written as | Empty value | Example |
|---|---|---|---|
| **Text** | text | `null` | `role: Engineer` |
| **Long text** | text, over several lines if needed | `null` | `summary: Land on the moon.` |
| **Number** | a number | `null` | `budget: 120000` |
| **Date** | `YYYY-MM-DD` | `null` | `due: 2027-03-31` |
| **Choice** | one of the choices | `null` | `priority: High` |
| **Multiple choice** | a list of choices | `[]` | `labels: [Bug, UI]` |
| **List** | a list of text | `[]` | `agenda: [Budget, Hiring]` |
| **Checkbox** | `true` or `false` | `false` | `billable: true` |
| **Link (URL)** | text | `null` | `website: https://example.com` |
| **Relation**, one link | a wikilink | `null` | `owner: "[[Ada Lovelace]]"` |
| **Relation**, many links | a list of wikilinks | `[]` | see below |
| **Roll-up**, **Formula** | not written | | worked out whenever they're shown |

- **New notes** get every stored field of their type, with empty values for the ones you didn't fill in. That way each field is ready to fill in, in the form or in Obsidian's Properties.
- **Choices** are stored as their label (`High`), even when the choices have values. The number for each choice lives in the type, so changing it needs no note changes.
- **Roll-ups and formulas** are never stored. If a note has its own property with the same name as one, that property is ignored.

### Links

Relation values are ordinary wikilinks, so backlinks, the graph view and renaming notes all keep working.

```yaml
owner: "[[Ada Lovelace]]"          # one link
team:                              # several links
  - "[[Grace Hopper]]"
  - "[[Alan Turing]]"
contacts:                          # labelled links: the label is the link's alias
  - "[[Ada Lovelace|economic buyer]]"
  - "[[Grace Hopper|technical lead]]"
```

- Only the note that holds a link stores it. The other note shows it under the field's inverse label, worked out when it's shown. See [Relationships](/reference/relationships).
- Links are written in the shortest form that's unambiguous, without `.md`.
- The plugin reads `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]`, Markdown links (`[x](Target.md)`) and bare note names. A bare name works, but isn't tracked by Obsidian, so it's flagged with a one-click fix.
- A link to a note that doesn't exist yet isn't a problem. It shows as a dashed chip; click it to create the note.

## Dates

Dates are always **stored** as `YYYY-MM-DD`, whatever they look like on screen. That keeps them sortable, and readable by other plugins.

- **On screen,** a date is shown in the field's own **Display format**, or else in the **Date display format** setting (DD/MM/YYYY to start with). See [Display formats](/reference/fields#display-formats) and [Settings](/reference/settings).
- **Typing a date:** you can always type `YYYY-MM-DD`. You can also type it in the field's display format, when that format has a day, a month and a four-digit year (such as `05/12/2026`). A date that doesn't exist isn't saved, and a notice says why.
- **The calendar:** clicking a date field in the properties form, the create dialog or the type editor opens a calendar under it, while you can still type. The calendar follows what you type.
  - Click a day to pick it. **Today** and **Clear** are at the bottom.
  - Click the month title to switch to a month and year view.
  - **Alt+↓** opens the calendar from the keyboard; **Esc** closes it (a second **Esc** cancels your typing).

### Display formats

Numbers, dates, checkboxes and URLs can each have a display format. A format changes how a value **looks**, never what's stored: `budget: 1240.5` stays as it is in the note, while the form shows `$1,240.50`. Clicking in to edit shows the plain value again. See [Fields](/reference/fields#display-formats) for every format.

## Obsidian property types

Obsidian's own Properties block chooses an editor for each property by name. The plugin tells Obsidian which editor suits each field, so the right one appears when the properties form is off, in hover previews and in the **File properties** sidebar.

| Field | Obsidian property type |
|---|---|
| Date | Date (Obsidian's date picker) |
| Number, and `order` | Number |
| Checkbox | Checkbox |
| List, multiple choice, relations with many links, and `related` | List |
| Text, long text, choice, URL, relations with one link | Left as text |

This is saved in your vault's `.obsidian/types.json`. Obsidian's property types apply to the whole vault, so if two of your types use the same key for different kinds of field (a number in one, a date in another), that key is left alone.

## A new note

When you create an entity, the plugin:

1. Takes the name you gave it as the file name, removing characters a file name can't have (`\ / : * ? " < > | # ^ [ ]`). If it had to change the name, the original goes in `aliases`.
2. Files it in its type's folder (see [Organise notes in folders](/guides/folders)). If the name is already taken there, it adds a number: `Grace Hopper 2.md`.
3. Starts the body from the type's template (see [Types and groups](/reference/types#template)).
4. Writes the frontmatter: `entity`, the first status, every stored field (with its default, if it has one), `related` and `tags`. If the template has frontmatter of its own, its values are kept wherever the plugin has nothing to write, and tags from both are combined.

## Values that don't fit the type

Values set somewhere else, such as Source mode, a sync, another plugin or Obsidian's Properties, are never changed behind your back. Instead the plugin checks every entity against its type, and flags what doesn't fit.

- **In the properties form,** the problem row gets a red outline (an error) or an orange one (a warning). Hover the icon to see why. Where there's an obvious fix, a **Fix** button does it in one click.
- **The form's top row** counts the problems; click the count to go to the first one.
- **Tables and boards** mark a value with a problem.
- **Check entities** (a command) lists every note with problems. Choose one to open it.

| Problem | Kind | One-click fix |
|---|---|---|
| A status that isn't in the type's list | error | none: pick a status from the dropdown |
| A number written as text (`"42"`) | error | **Make it a number** |
| Something that isn't a number in a number field | error | none |
| `"true"` or `"false"` written as text in a checkbox field | error | **Make it yes** / **Make it no** |
| A date that isn't a date, or doesn't exist | error | none |
| A choice that isn't one of the choices | error | none |
| A list in a field that holds one value | error | **Use a single value**, or **Join the values** for text |
| Choices in a multiple-choice field that aren't choices | error | **Remove** |
| One value where a list is expected (lists, multiple choice, links, `tags`, `aliases`, `related`) | error | **Make it a list** |
| Several links in a field that holds one | error | **Use a single link** or **Keep the first** |
| Something in a link field that isn't a link | error | **Remove it** |
| A link to the wrong type of entity | error | **Remove the link** |
| A link to a note that isn't an entity, in a field that only links to some types | warning | **Remove the link** |
| A link written as a plain name, so Obsidian won't track it | warning | **Make it a link** |
| A required field that's empty | warning | none |
| A value that breaks one of the field's validation rules | error | none |
| A field that's required now (**Required when…**) but empty | warning | none |
| An `order` that isn't a number | error | **Make it a number** |

- **Problems never stop a note being saved.** The create dialog is stricter: it won't create a note until its values fit (see [Validate what goes in](/guides/validation)).
- A value of the wrong kind is reported as that, before any validation rule is checked.
- A required field that's hidden by its form layout's **Show only when…** isn't required while it's hidden.

## Other properties

Properties the type doesn't define (perhaps left over from before the note was an entity) are kept. The properties form lists them in a collapsed **Other properties** section, each with an editor that suits its Obsidian property type.

- **+ Add property** in the section, or **Add other property…** in the form's **⋯** menu, adds one.
- A property's **⋯** menu offers **Add to the *Type* type**, which opens the type editor with a new draft field for it, or **Remove**.

## Changing a note's type

**Change type…** in the properties form's **⋯** menu (or **Change entity type…** in the file menu) moves a note to another type.

- Every value is kept. Fields the new type doesn't have move to **Other properties**, and the new type's missing fields are added with their defaults.
- If the status isn't one of the new type's statuses, it's reset to the first one, and a notice says so.
- The note isn't moved. If the new type's folder is elsewhere, the notice offers to move it.
