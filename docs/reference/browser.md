# Entity Browser

The sidebar that lists your entities by group and type, with views and dashboards beside them.

Open it with the **library** icon in the ribbon, or the **Open entity browser** [command](/reference/commands). It opens in the left sidebar.

## The two tabs

| Tab | What it lists |
|---|---|
| **Entities** | Your views and dashboards, then a tree of all your entity notes. |
| **Types** | Your setup: your groups and entity types, then your workflows. |

The browser follows what you open:

- Opening an entity note, a view or a dashboard shows **Entities**.
- Opening the Entity types view or the Workflows view shows **Types**.

If you click a tab yourself, it stays until you open something else.

## The toolbar

Each tab has its own search, filters, View options and **+** menu.

| Button | What it does |
|---|---|
| Search box | Filters the tab as you type. See [Search and filters](#search-and-filters). |
| **View options** (sliders) | How the tab is arranged. See [View options](#view-options). |
| **Collapse all** | Folds every heading and note on the tab. |
| **Expand all** | Unfolds them. |
| **+** | On **Entities**: **New entity…**, **New view** and **New dashboard**. On **Types**: **New entity type**, **New group** and **New workflow**. |

## The Entities tab

### Groups, types and hierarchies

- **One section per group.** Group headings stand out, in bold on a faint band, with a count of their notes. Types without a group are under **No group**.
- **A heading per type** inside each section, with its icon, colour and count. A type's count is left out when it's the same as its group's just above.
- **Notes nest under their parent**, using the type's parent fields (set on the type's **Display** tab). For example, a project's tasks sit under the project.
- **Order:** notes are sorted by their type's order, then their **Order** value, then by name. Names with numbers sort naturally: *Chapter 2* before *Chapter 10*.

A note whose parent is another type is listed under the heading of the type at the top of its branch. A campaign's sessions, for example, are under **Campaigns**, inside their campaign. Their own type's heading still shows:

- with how many there are, in a faint count;
- with a line such as **All 17 under Campaigns · show them**, or **+3 more under Projects · show them** when some notes are under their own heading too.

Click **show them** to filter the browser to that type. Each note is then shown with what it's under.

Types with no notes are hidden, unless **Show empty types** is on. An empty type then says "No *notes* yet", so you can create one from its heading.

### Rows

Each note's row shows its type icon, its name, a count of its children (when it's folded) and a dot in its status colour. Hover over it for its subtitle, and, when it's listed apart from its parent, what it's in.

| Action | What it does |
|---|---|
| Click | Opens the note. |
| <kbd>Ctrl/Cmd</kbd>-click or middle-click | Opens it in a new tab. |
| <kbd>Ctrl</kbd> + hover | Shows a preview. |
| Chevron | Folds or unfolds its children. |
| Right-click | The note's menu (below). |

The right-click menu has:

- **Open in new tab** and **Open to the right**;
- **New *type* here** for each type that can be its child, with the parent link filled in and the note filed in the right folder;
- **Show connections**, which opens the note and the [side panel](/reference/side-panel);
- Obsidian's usual file menu;
- **Delete**, last. It asks first, saying how many notes link to this one (their links will point to a missing note) and how many children it has (they stay). The note goes to the trash, following Obsidian's **Deleted files** setting, so you can restore it.

### Headings

Click a heading to fold or unfold it.

**+** on a **type heading** creates a note of that type. On a **group heading** it creates a note of one of the group's types: it asks which, unless there's only one.

Right-click a **type heading** for:

- **New *type***
- **New table view of *types***, **New board of *types***, and **New calendar of *types*** (if the type has a date field)
- **New workflow for *types***
- **Configure the *Type* type**

Right-click a **group heading** for:

- **New *type*** for each type in the group
- **New table view of *Group***, **New board of *Group***, and **New calendar of *Group*** (if any of its types has a date field)
- **New workflow for *Group***
- **Configure group**

### Where views and dashboards are listed

Every view note and dashboard in your views folder is listed on the Entities tab, with its icon and a small **view** or **dashboard** tag. Each goes where it fits best:

| What it shows | Where it's listed |
|---|---|
| One type | Under that type's heading, e.g. *Quest board* under **Quests**. |
| Types in one group (or the group itself) | At the top of that group's section, e.g. *Campaign calendar* under **At the table**. |
| Anything wider, and dashboards | The **Views** section at the bottom. |

To list one somewhere else:

- **drag** it onto any group or type heading, or onto **Views**; or
- right-click it and choose **Show under…**, then pick a place. The list marks where it is **here now**, and its **automatic** place.

Moving a view back to its automatic place undoes the choice.

If the heading a view belongs under isn't shown (type headings are off, or the type has no notes, or it's filtered out), the view moves up to its group's section, or else to **Views**.

The **Views** section has its own **+** to create a view. When everything is listed elsewhere it says "None here. Drag a view onto this heading to list it here."

Click a view to open it, or <kbd>Ctrl/Cmd</kbd>-click or middle-click to open it in a new tab. Right-click for **Show under…** and the usual file menu.

See [Tables](/reference/tables) and [Dashboards](/reference/dashboards) for what views and dashboards do.

### Following the open note

When you open a note, the browser switches to the **Entities** tab and unfolds the headings and parents above it, once, then scrolls to it. If you fold things again afterwards, they stay folded. Opening a view or dashboard unfolds the heading it's listed under.

## Search and filters

### On the Entities tab

- **Search** finds entities by name and aliases, and views and dashboards by name.
- **Type** (**All types**) keeps that type's notes, and the views that show it (including views of its group, or of every type).
- **Status** (**Any status**) keeps notes with that status.
- **Tag** (**Any tag**) keeps notes with that tag, or a tag nested under it. Only entities have a status and tags, so **Status** and **Tag** leave views out.

### On the Types tab

- **Search** finds entity types (by name, plural or key) and workflows (by name or button label).
- **Type** keeps that entity type and the workflows that apply to it, including ones for any note.

### While filtering

- Matches stay inside their hierarchy: parents that don't match are shown dimmed, and sections with no matches are hidden.
- A bar shows how many matches there are, with **Clear**. If nothing matches, the tab says "Nothing matches."
- Folding headings while filtering is temporary: clearing the filter brings back your normal layout.

## View options

### On the Entities tab

| Option | What it does |
|---|---|
| **Sections: groups** / **Sections: none (one tree)** | One section per group (the default), or a single tree. |
| **Type headings** | A heading per type (on by default). |
| **Children of other types nest under their parent** | A campaign's sessions are inside the campaign (the default). |
| **Children of other types are listed under their own type** | All sessions are under **Sessions**, in a flat list. Hover over a note to see what it's in. |
| **Nest under parents of the same type** | With children listed under their own type: still keep a city inside its region. Turn it off for flat lists everywhere. On by default. |
| **Children in other groups stay in their own group** / **…nest under their parent** | Where a child goes when its parent is in another group. Only with group sections, and children nested under their parent. |
| **Show empty types** | List types with no notes, so you can create one from the heading. Off by default. |
| **Show views** | List views and dashboards. On by default. |

### On the Types tab

| Option | What it does |
|---|---|
| **Show entity types** | Show the **Entities** section. |
| **Show workflows** | Show the **Workflows** section. |

## The Types tab

### Entities

The **Entities** section lists your groups and, under each, its types with their note counts. Types without a group are under **No group**. The type or group open in the Entity types view is highlighted. A new type or group that isn't saved yet shows **new**; one with unsaved changes shows a dot.

| Where | Action | What it does |
|---|---|---|
| **Entities** heading | **+** | Starts a new type. |
| | Right-click | **New entity type**, **New group**, **Browse packs…**, **Import pack…**, **Copy all types as a pack**, **Import app…** and **Export as an app…** |
| A group | Click | Opens the group in the Entity types view. |
| | Chevron | Folds or unfolds it. |
| | Drag onto another group | Reorders your groups. This is saved straight away. |
| | Right-click | **Edit group** and **New entity type in this group**. |
| A type | Click | Opens the type in the Entity types view. Hover for its plural, key and note count. |
| | Right-click | **Open**, **New *type***, **New table view of *types***, **New workflow for *types*** and **Duplicate type**. |

See [Types and groups](/reference/types) for the editor, and [Packs and apps](/reference/packs) for packs and apps.

### Workflows

The **Workflows** section has a heading for each kind of workflow: **When created**, **When changed**, **Run on notes**, **Forms** and **Scheduled**. An empty one says "None yet". **Scheduled** shows **not here** when this device doesn't run scheduled workflows.

Each workflow shows:

- its trigger's icon and its name;
- a green dot when it's on, and faint text when it's switched off;
- ⚠ when it has problems;
- **new** if it isn't saved yet, and a dot for unsaved changes.

Hover over a workflow to see what starts it and which types it applies to.

| Where | Action | What it does |
|---|---|---|
| **Workflows** heading | **+** | Starts a new workflow that isn't tied to a type yet. |
| | Right-click | **New workflow**, **Recent runs**, and **Disable all workflows** / **Enable all workflows**. |
| A kind (e.g. **Scheduled**) | Right-click | Starts a new workflow of that kind, e.g. **New workflow: On a schedule**. |
| A workflow | Click | Opens it in the Workflows view. |
| | Right-click | **Open**, **Recent runs**, **Fill in the form…** or **Run on a note…**, **Try on a note…** (or **Try it…**), **Disable** or **Enable**, **Duplicate** and **Delete…** |
| An unsaved workflow | Right-click | **Open** and **Discard**. |

**Disable all workflows** is a master switch: each workflow keeps its own on or off, and **Enable all workflows** brings them back as they were. While it's on, the heading reads **Workflows (all disabled)**.

See [Workflows](/reference/workflows) and [Triggers](/reference/triggers).

## Technical details

- The tab, View options, filters and which headings and notes are unfolded are saved with Obsidian's workspace, so they survive a restart.
- A view or dashboard you've moved stores its place in its own block, as `place:` (a type key, `@` and a group key, or `views`). It syncs with the note. Moving it back to its automatic place removes `place:`.
- Only notes in the views folder (set in [Settings](/reference/settings)) are listed as views and dashboards.
