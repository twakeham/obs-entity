# Form layouts

Every element you can put in a type's form layout, and its options.

A **form layout** arranges a type's [properties form](/reference/properties-form) in frames, columns and tabs, with headings and text between them. The same layout is used by the create dialog and by the type's preview in the [side panel](/reference/side-panel). Without a layout, the form is one list of fields in field order.

You design a layout on the **Layout** tab of the type editor. For a step-by-step walkthrough, see [Design a form](/guides/form-layouts).

## The Layout tab

The tab has three parts:

| Part | What it holds |
|---|---|
| Palette (left) | **Fields**, **Properties** (the built-in properties and the note's Name), **Read-only** (things about the note), **Workflow buttons**, **My components** and **Layout** (frames, columns, tabs, headings and text). Drag an item onto the layout, or click it to add it. |
| Layout (middle) | Looks like the form. Drag things to move them; a line shows where they'll land. Click something to select it. |
| Settings (right) | The options for what's selected. With nothing selected: **Hide fields that aren't placed**. |

The toolbar above the layout has Undo and Redo, a count of frames and placed properties, and:

- **Start from fields** puts every field in one frame captioned with the type's name. Once there's a layout it reads **Start again from fields**.
- **Reset layout** removes the layout, so the form goes back to the plain list.

Layout changes are part of the type's draft: press **Save** to keep them, or **Discard**.

## Layout elements

| Element | What it is |
|---|---|
| **Frame** | A captioned box of rows. |
| **2 columns**, **3 columns**, **4 columns** | Fields or frames side by side. |
| **Tabs** | A group of tabs, one open at a time. Top level only. |
| **Heading** | A caption between rows. |
| **Text** | Help text between rows. |

### Frames

| Option | What it does |
|---|---|
| **Caption** | The frame's title. Leave it empty for no caption. |
| **Can be collapsed** | Clicking the caption folds the frame away. |
| **Starts collapsed** | The frame is folded when the note opens. Only for frames that can be collapsed. |
| **Show in the create dialog** | On by default. Off: the frame is left out of the create dialog until you click **Show N more fields**. |
| **Icon** | An icon before the caption, or **No icon**. |
| **Accent colour** | None, the type's colour, or one of 16 palette colours. Tints the caption and adds a stripe down the left. |
| **Style** | **Box** (a border, the default), **Plain** (no border) or **Filled** (a light tint instead of a border). |
| **Header** | **Plain** (the default), **Soft** (a tinted bar behind the caption) or **Solid** (a bar in the full colour, with white or dark text, whichever reads better). The header uses the accent colour, or the type's colour if there isn't one. It needs a caption to show. |
| **Show only when** | Conditions for showing the frame. See [Show only when…](#show-only-when). |

On the form:

- A frame that holds fields only shows when at least one of its fields does. A frame of headings and text always shows.
- A collapsed frame with a problem in it shows a dot on its caption.

To take a frame away, use **Remove frame, keep contents** (its rows take its place) or **Remove with contents**.

### Columns

| Option | What it does |
|---|---|
| **Number of columns** | 2, 3 or 4. With fewer columns, what was in the ones that go moves to the last column. |
| **Relative widths** | A whole number from 1 to 12 for each column. 2 and 1 makes the first column twice as wide. **Equal** sets them back. |

On the form:

- Columns stack one above the other in narrow places, such as the sidebar.
- A column with nothing to show is left out, and the rest share the row.
- Columns can't have **Show only when**. Put the condition on the frames or fields inside them.

### Tabs

A **Tabs** element is a group of tabs. Select the group to see its settings:

- **Tabs** lists its tabs. Click one to edit it, and use the arrows to reorder them.
- **Add tab** adds one at the end.
- **Remove tabs, keep contents** or **Remove with contents**.

Click a tab on the layout to select it. Each tab has:

| Option | What it does |
|---|---|
| **Caption** | The tab's name. |
| **Icon** | An icon before the caption, or **No icon**. |
| **Show in the create dialog** | On by default. Off: the tab is left out of the create dialog until you click **Show N more fields**. |
| **Show only when** | Conditions for showing the tab. |

You can remove a single tab with **Remove tab, keep its contents** (they move to the top level, after the tab group) or **Remove tab and its contents** in its **⋯** menu. Removing the last tab removes the group.

On the form:

- A form can have several tab groups.
- The tab you last opened is remembered for each type.
- A tab with a problem in it shows a dot. **N problems** opens the tab with the first one.
- A tab with nothing to show is left out of the strip.
- With a tab focused, <kbd>←</kbd>/<kbd>→</kbd> move between tabs, and <kbd>Home</kbd>/<kbd>End</kbd> go to the first or last.

### Headings and text

A **Heading** has a single line of text. A **Text** element has as many lines as you like, for notes or instructions. Neither has any other options.

## Field slots

Each field you place on the layout is a **slot**. A slot can hold:

- one of the type's **fields**, including calculated fields;
- a built-in **property**: **Status**, **Related**, **Tags**, **Aliases**, and **Order** if the type has parent fields;
- something about the **note** itself (see [Note items](#note-items));
- a **workflow button** (see [Workflow buttons](#workflow-buttons)).

Each can be placed once. Placed fields are ticked in the palette; click one to find it on the layout.

Slot options apply to this form only. They don't change the field.

| Option | What it does |
|---|---|
| **Label** | **Above** the value (the default), **Beside** it, or **Hidden**. |
| **Custom label** | A label for this form instead of the field's own. |
| **Placeholder** | Grey text in the empty control. Not offered for checkboxes, dates, multiple choice, calculated fields, Status or the read-only note items. |
| **Help text** | Text under the value: **None**, the field's **Description**, or **Custom** text. With **None**, the description shows when you hover over the label. |
| **Height** | Long text only: **Auto** (grows with the text), **Short** (3 lines), **Medium** (6) or **Tall** (12). |
| **Read-only on this form** | The value is shown with a lock and can't be edited on notes. The create dialog, views and bulk edits can still set it. |
| **Show only when** | Conditions for showing the slot. |

**Edit field** opens the field on the **Fields** tab. **Remove from layout** puts it back in the palette.

### Note items

These show the note itself rather than a property. Their labels are hidden unless you turn them on.

| Item | What it shows |
|---|---|
| **Name** | The note's name, shown large. Editing it renames the note. It can be made read-only. |
| **Type** | The note's type. Click it to change type. |
| **Subtitle** | The values of the type's subtitle fields. |
| **Type + subtitle** | Both, on one line. |
| **Created** | When the note was created: date and time. Hover for how long ago. |
| **Modified** | When the note was last changed: date and time. Hover for how long ago. |

Type, Subtitle, Type + subtitle, Created and Modified are always read-only.

When they aren't placed, the name is the note's title, and status, type and subtitle are in the form's top row. Placing **Status**, **Type** or **Subtitle** (or **Type + subtitle**) takes them out of the top row. **Related**, **Tags**, **Aliases** and **Order** stay at the end of the form unless you place them.

### Workflow buttons

The **Workflow buttons** section of the palette lists the buttons of [workflows](/reference/workflows) you start on notes of this type: **Run on notes** workflows, and form workflows that apply to the type. If there are none, it says so.

Buttons that aren't placed appear in a strip at the top of the form. A placed button sits in the layout like a field, and has:

| Option | What it does |
|---|---|
| **Button text** | Text for this button instead of the workflow's own. |
| **Help text** | Text under the button. |
| **Show only when** | Conditions for showing the button. |

**Open workflow** opens it in the Workflows view.

- A workflow that's switched off can still be placed; its button shows once it's on.
- If the workflow is deleted, or no longer runs on this type from a button, the slot is flagged on the Layout tab and the button isn't shown.

### Fields that aren't placed

The type's fields that aren't on the layout are listed in an **Other fields** frame at the end of the form.

Turn on **Hide fields that aren't placed** (select nothing to see it) to leave them off the form altogether. Notes keep their values; they just aren't shown.

## Show only when…

A frame, a tab or a slot can show only when the note's own values match, for example a "Risk details" frame when Likelihood is High.

- Conditions can test the type's fields (calculated fields too), **Status** and **Tags**.
- They work like [view filters](/reference/filters): the same operators for each kind of field, and **all** or **any** of the conditions must hold.
- They update as you edit, in the properties form and in the create dialog.
- Columns, headings and text have no conditions of their own; they show or hide with the frame or tab they're in.

On the Layout tab, anything with conditions has an eye badge with a summary, such as "Likelihood is any of High".

What happens to hidden values:

- **Values are kept.** Hiding a field never clears it.
- **A required field that's hidden isn't required** until it shows again.
- **Other problems still count.** If a hidden field has a problem, **N problems** shows it, marked "Normally hidden: shown only when …", until it's fixed.

If a condition tests a field that's been deleted, the type editor flags it and the condition is ignored until you fix it. If a field's key is renamed, conditions on it follow.

## Nesting rules

Not everything can go everywhere. The drop line only appears where an item is allowed.

| Where | What it can hold |
|---|---|
| Top level | Anything. |
| A tab | Anything except another tab group. |
| Columns at the top level or in a tab | Frames, fields, headings and text. |
| A frame | Fields, headings, text, and columns of fields. |
| Columns inside a frame | Fields only. |

So tab groups only go at the top level, and the deepest a form goes is tab → column → frame → columns → field. To put frames side by side, drag them into columns.

## In the create dialog

The create dialog uses the type's layout too:

- Frames and tabs with **Show in the create dialog** turned off are left out. They appear when you click **Show N more fields**.
- Required fields that aren't on show are still asked for, in a frame of their own: **Required** (or **Required and filled in**, when it also holds fields you've already filled in).
- Fields that aren't placed appear, under **Other fields**, with **Show N more fields**.
- A placed **Name** moves the dialog's Name box into the layout. A placed **Tags** does the same. Status is always at the top.
- Read-only slots can still be filled in.
- Each field shows its description underneath, unless its slot has custom help text.
- **Show only when…** works as you fill in the dialog.
- If a required field is empty when you press **Create**, the dialog opens its tab.

Type, Subtitle, Created, Modified, Related, Aliases, Order, workflow buttons and calculated fields aren't part of the create dialog.

## Editing on the Layout tab

### Keyboard

| Keys | What they do |
|---|---|
| <kbd>Tab</kbd>, <kbd>↑</kbd>/<kbd>↓</kbd> | Move between items. |
| <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> | Move the selected item up or down. |
| <kbd>Delete</kbd> | Remove the selected item. Fields go back to the palette. |
| Context-menu key, or **⋯** | The item's menu: **Move up**, **Move down**, **Move to…**, **Add field here…** and more. |
| <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> | Undo. |
| <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Redo. |
| <kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> | Copy, cut and paste the selected item with everything inside it. |
| <kbd>Ctrl/Cmd</kbd>+<kbd>D</kbd> | Duplicate the selected item. |
| <kbd>←</kbd>/<kbd>→</kbd> on a tab | Switch tabs. |
| <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> on a tab | Move the tab along the strip. |

You can also drag an item back to the palette to remove it, drag a tab along the strip to reorder it, and hover over a tab while dragging to open it.

### Copy, paste and components

Copies go through the clipboard, so you can paste into another type, or another vault. When you paste:

- Fields are matched by key, then by label.
- Fields the type doesn't have are left out, with **Add them** in a notice to add them to the type.
- If a field is already on the layout, you're asked whether to **Move here** (with the copied label and options) or leave it out. **Duplicate** always leaves them out, so duplicating a frame gives you an empty, styled copy.

**⋯** → **Save as component…** saves the selected item, with a name and icon, under **My components** in the palette. Components are shared by every type in the vault. Right-click one to edit its name and icon, replace it with the selection, copy it or delete it.

## Form workflows

A [form workflow](/reference/triggers)'s form has a **Layout** tab too, and works the same way with its own fields. It has no built-in properties, note items or workflow buttons, no read-only slots, and no create-dialog settings.

## Technical details

A layout is stored in the type's definition as `form.layout`, so it's included when you use **Copy as JSON** on the type and when the type is shared in a [pack](/reference/packs).

```json
"form": {
  "layout": {
    "items": [
      { "kind": "field", "key": "@name" },
      {
        "kind": "columns",
        "widths": [2, 1],
        "columns": [
          [{ "kind": "frame", "caption": "Details", "icon": "info", "color": "type", "header": "soft",
             "items": ["likelihood", "impact", { "kind": "field", "key": "notes", "rows": 6, "help": "description" }] }],
          [{ "kind": "frame", "caption": "Dates", "style": "plain",
             "items": [{ "kind": "field", "key": "@created", "label": "above" }, "due"] }]
        ]
      },
      {
        "kind": "frame",
        "caption": "Risk details",
        "collapsible": true,
        "create": false,
        "when": { "all": [{ "field": "likelihood", "op": "any-of", "value": ["High"] }] },
        "items": ["mitigation", { "kind": "field", "key": "owner", "label": "beside", "readOnly": true }]
      },
      { "kind": "tabs", "tabs": [
        { "caption": "Notes", "icon": "file-text", "items": [{ "kind": "text", "text": "Anything else worth knowing." }, "tags"] }
      ] }
    ],
    "hideUnplaced": true
  }
}
```

| Kind | Properties |
|---|---|
| `frame` | `caption`, `collapsible`, `collapsed`, `create: false`, `icon`, `color` (`"type"` or a CSS colour), `style` (`plain`, `filled`), `header` (`soft`, `solid`), `when`, `items` |
| `columns` | `columns` (2 to 4 lists), `widths` |
| `tabs` | `tabs`: each with `caption`, `icon`, `create: false`, `when`, `items` |
| `heading`, `text` | `text` |
| `field` | `key`, `label` (`above`, `beside`, `hidden`), `caption`, `placeholder`, `help` (`"description"` or `{ "text": "…" }`), `rows` (3, 6 or 12), `readOnly`, `when` |

- A field slot with no options can be written as just its key, e.g. `"due"`.
- Note items use keys starting with `@`: `@name`, `@type`, `@subtitle`, `@type-subtitle`, `@created`, `@modified`.
- A workflow button's key is `wf:` followed by the workflow's id.
- `when` holds `all` or `any`, with a list of conditions. Each has a `field` (a field key, `status` or `tags`), an `op` and, for most operators, a `value`, in the same form as [view filters](/reference/filters).
- Layouts are tidied when they're read: unknown properties are dropped, items in the wrong place are lifted out to where they can go, and a column count outside 2 to 4 is corrected. A key that isn't a field of the type, or that's placed twice, is flagged in the type editor and left out of the form.
