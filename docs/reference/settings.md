# Settings

Every setting in **Settings → Obsidian Entities**, in the order the tab shows them.

Most of your setup (types, groups, fields, views and workflows) lives in the Entity types and Workflows views, not here. This tab holds the vault-wide options, plus buttons that open those views.

## Folders

| Setting | Default | What it does |
|---|---|---|
| **Entity folder** | `Entities/{group}/{entity}` | Where new entities are created. `{group}` is the group's name and `{entity}` is the type's plural name, so a person in the Directory group goes to `Entities/Directory/People/`. |
| **Folder exceptions** | None | Gives a type its own folder pattern instead of the one above. |
| **Templates folder** | `_templates/entities` | Where each type's editable Markdown template lives. |
| **Views folder** | `Entities/Views` | Where view and dashboard notes are saved. |
| **Open view notes as entity views** | On | Opens a view note as a full-tab view. |
| **Default currency** | `AUD` | The currency the **Currency** number format starts with. |
| **Date display format** | `DD/MM/YYYY` | How dates are shown when a field or column doesn't set its own format. |

### Entity folder

Only placeholders `{group}` and `{entity}` are recognised. Anything else in braces is flagged under the box (*Unknown placeholder: {…}. Use {group} or {entity}.*).

Under the folder settings, a preview lists every type and where its new notes will go. It takes each type's folder rule into account, and marks types with an exception. Existing folders are matched whatever their case, so `entities/{group}/{entity}` still uses an `Entities/` folder you already have.

Changing the folder only affects new notes. Existing notes stay where they are.

See [Organise notes in folders](/guides/folders) for folder rules (a folder of its own, inside the parent's folder).

### Folder exceptions

Click **Add exception** to add a row. Each row has:

- a dropdown to choose the type;
- the type's own pattern, with the same placeholders (leave it empty for the vault root);
- **×** (**Remove exception**) to go back to the main pattern.

A new exception starts with the main pattern, for the first type that doesn't have one yet. **Add exception** is greyed out when every type has one.

### Templates folder

New notes start from the type's template file in this folder. Until a type's file exists, its built-in template is used (its section headings).

**Generate templates** writes a file for every type that doesn't have one yet, so you can edit it. The **Generate template files** command does the same.

### Views folder

**New entity view** saves view notes here, and **Open entity view…** lists the views in this folder. Changing it re-reads the folder.

### Open view notes as entity views

- **On**: a view note opens as a full-tab table, board, calendar or dashboard, like the Entity types view.
- **Off**: view notes open as ordinary notes with the view inside.

Either way, **Open as Markdown** and **Open as entity view** switch a tab between the two.

### Default currency

A three-letter currency code such as `AUD`, `USD`, `EUR` or `GBP`. Each column or field with the **Currency** format can still choose its own. Anything that isn't three letters isn't saved.

### Date display format

Pick a preset, or **Custom…** to type a [moment.js](https://momentjs.com/docs/#/displaying/format/) pattern (the box suggests `ddd D MMM YYYY`). The dropdown shows each preset as today's date would look, and the description shows today in the format you've chosen.

| Preset | Example |
|---|---|
| `YYYY-MM-DD` | 2026-11-15 |
| `D MMM YYYY` | 15 Nov 2026 |
| `D MMMM YYYY` | 15 November 2026 |
| `ddd D MMM` | Sun 15 Nov |
| `dddd, D MMMM YYYY` | Sunday, 15 November 2026 |
| `DD/MM/YYYY` (default) | 15/11/2026 |
| `MM/DD/YYYY` | 11/15/2026 |
| `MMMM YYYY` | November 2026 |
| Relative | today, tomorrow, in 3 days, 2 weeks ago |

This only changes how dates look. Notes always store dates as `YYYY-MM-DD`.

## Behaviour

| Setting | Default | What it does |
|---|---|---|
| **Open new entities in a new tab** | Off | Opens a note you've just created in a new tab instead of the current one. |
| **Prefill links from the active note** | On | When you create an entity, fills in a link field with the note you're looking at, if the field accepts its type (parent fields first). For example, creating a person while viewing an organisation sets **Works for** to that organisation. |
| **Use the entity properties form** | On | On entity notes, replaces Obsidian's Properties block with a form built from the note's type. Only valid values can be entered, links are limited to the allowed types, and problems are flagged. Turn it off to use Obsidian's Properties block. Source mode always shows the raw YAML. See [Properties form](/reference/properties-form). |

## Ribbon

Which of the plugin's icons appear in the left ribbon. Each one is also a command.

| Icon | Default | Opens |
|---|---|---|
| **Create entity** | Off | The type picker, then the create dialog. |
| **Entity browser** | On | The Entity Browser. |
| **Side panel (connections, preview)** | On | The side panel. |
| **Entity types** | Off | The Entity types view. |
| **Workflows** | Off | The Workflows view. |

Forms that start on their own can have ribbon icons of their own; switch on **Ribbon icon** on the form in the Workflows view. To reorder ribbon icons, use Obsidian's **Appearance → Ribbon menu → Manage**.

## Entity types

**Types** shows how many types (and custom types) you have, in how many groups, and lists them. Its buttons:

| Button | What it does |
|---|---|
| **Browse packs…** | Opens the pack gallery. See [Packs and apps](/reference/packs#the-gallery). |
| **Import types…** | Opens **Import entity types**, to paste a pack as JSON. See [Packs and apps](/reference/packs#import-entity-types). |
| **Open entity types** | Closes settings and opens the Entity types view. |

## Workflows

| Setting | Default | What it does |
|---|---|---|
| **Workflows** | – | Shows how many workflows you have and how many are on (and whether all are paused). **Open workflows** closes settings and opens the Workflows view. |
| **Pause all workflows** | Off | Nothing runs, automatically or from buttons, until you turn this off. Each workflow keeps its own on or off. The same switch is in the Workflows view and the command palette (**Pause or resume workflows**). |
| **Run scheduled workflows on this device** | On for desktops, off for phones and tablets | Scheduled and date workflows run while Obsidian is open on a device where this is on. |

::: warning Synced vaults
**Run scheduled workflows on this device** is kept on each device, not in the vault. With a synced vault, turn it on for one device only, or each device would run them. When you turn it on, scheduled workflows start from now rather than catching up on everything they missed.
:::

See [Workflows](/reference/workflows).

## Apps

**Export or import an app** describes what an app holds and, once you've exported or imported one, the name and version it was last exported or imported as.

| Button | What it does |
|---|---|
| **Import app…** | Choose an app file, see what it holds, and replace your configuration with it or add it alongside. |
| **Export as an app…** | Saves every group, type, workflow, view note, template and saved component in one file. |

See [Packs and apps](/reference/packs#apps).
