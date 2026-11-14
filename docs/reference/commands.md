# Commands

Every command the plugin adds to the command palette.

Open the palette with <kbd>Ctrl/Cmd</kbd>+<kbd>P</kbd>. The plugin's commands start with **Obsidian Entities:**, so typing `entities` lists them all. Some only appear when they make sense, for example when the open note is an entity.

## Creating and finding entities

| Command | What it does |
|---|---|
| **Create entity** | Asks for a type, then opens the create dialog. |
| **Create *type*** | One per type, such as **Create task** or **Create person**. Opens the create dialog for that type straight away. See [Per-type commands](#per-type-commands). |
| **Find entity** | A quick switcher that lists entities only. Type `person: ada`, `people:` or a search shortcut such as `p ada` to search one type. If no entity has exactly the name you typed, it also offers to create one. <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> opens the note in a new tab. |
| **Convert current note to entity** | Asks for a type and makes the open note an entity of that type. The type's fields are added; values already in the note are kept. On an entity, this changes its type. Only for Markdown notes. |

## Types and templates

| Command | What it does |
|---|---|
| **Configure entity types** | Opens the Entity types view. If the open note is an entity, its type is selected. |
| **Create entity type from current note** | Works out a new type from the open note's properties and opens it as a draft in the Entity types view, to check and save. Only on a note that isn't an entity and has properties. |
| **Import entity types…** | Opens **Import entity types**: paste a pack, a single type or a list of types as JSON. See [Packs and apps](/reference/packs#import-entity-types). |
| **Generate template files** | Writes an editable template file, in your templates folder, for every type that doesn't have one yet. |

## Panels and views

| Command | What it does |
|---|---|
| **Open entity browser** | Opens the Entity Browser in the left sidebar. |
| **Open side panel (connections, preview)** | Opens the side panel in the right sidebar, showing the open note's connections. |
| **New entity view (table or board)** | Asks what the view shows, a layout (**Table**, **Board** or **Calendar**) and a name, then creates the view note in your views folder. If the open note is an entity, its type is picked to start with. |
| **Open entity view…** | A picker of your view notes and dashboards. |

## Workflows

| Command | What it does |
|---|---|
| **Open workflows** | Opens the Workflows view. |
| **Run workflow on this note…** | Lists the button workflows (and forms with types) that apply to the open note, and runs the one you pick on it. Only when the open note is an entity with at least one switched-on workflow of this kind. |
| **Fill in a form…** | Lists the forms that start on their own (forms with no types under **Applies to**), opens the one you pick, and runs it. Only when at least one is switched on. |
| **Workflow: *name*** | One per button or form workflow that has **Its own command** switched on. See [Workflow commands](#workflow-commands). |
| **Undo last workflow run** | Puts back what the most recent workflow run changed. If there's nothing to undo, a notice says so. |
| **Pause or resume workflows** | The master switch. While paused, no workflow runs, automatically or from buttons. A notice says which way it went. |

See [Workflows](/reference/workflows) for how runs, undo and pausing work.

## Upkeep

| Command | What it does |
|---|---|
| **Check entities** | Checks every entity against its type and lists those with problems (wrong kinds of value, choices that aren't allowed, empty required fields, broken validation rules and so on). Choose one to open it. If there are none, a notice says how many entities were checked. |
| **Rebuild entity index** | Reads every note again and says how many entities it found. Use it if something looks out of date. |

## Per-type commands

Every type gets its own create command, named **Create** plus the type's name in lower case: **Create task**, **Create research note**.

- A new type's command appears as soon as you save the type.
- A deleted type's command is no longer offered.
- A renamed type's command keeps its old name until you restart Obsidian or reload the plugin.

## Workflow commands

A button or form workflow can have a command of its own. In the Workflows view, open the workflow and switch on **Its own command** (under **Command**). The command is called **Workflow:** plus the button's label or the form's title, such as **Workflow: Log a session**, and follows it when you rename it.

- A form with no types opens its form.
- A button, or a form with types, runs on the open note. It's only offered when the open note is an entity of a type the workflow applies to.
- A workflow that's switched off, deleted, or has **Its own command** turned off isn't offered.

Forms that start on their own can also have a **Ribbon icon** of their own, set in the same place.

## Hotkeys

::: tip Give a command a hotkey
Go to **Settings → Hotkeys** and search for `Obsidian Entities`. Every command on this page can have a hotkey, including each **Create *type*** and **Workflow: *name*** command, so you can, for example, create a task or log a meeting with one key press.
:::

Some commands are also ribbon icons. Choose which ones show under **Settings → Obsidian Entities → Ribbon**; see [Settings](/reference/settings#ribbon).
