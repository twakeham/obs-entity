# Design a form

Arrange a type's form with frames, columns and tabs, style it, and show parts only when they apply.

Without a layout, the properties form is one list of fields in field order. That's fine for a type with three fields, but a busy type reads better in groups. Here you'll give the **Task** type from [Getting started](/getting-started/) a form like this:

- the task's **Name**, shown large, at the top;
- an **Overview** tab with a *Details* frame and a *Schedule* frame side by side, and a *Completion* frame that only appears once the task is done;
- a **More** tab for links, tags and dates.

The same layout is used by the create dialog and by the type's preview in the side panel. For every option, see [Form layouts](/reference/form-layouts).

## Open the Layout tab

1. On the Entity Browser's **Types** tab, click **Task**. The type editor opens.
2. Open the **Layout** tab. It says *No custom layout: the form lists every field in field order.*

The tab has three parts: the **palette** on the left (fields, properties and layout elements), the **layout** in the middle, which looks like the form, and the **settings** on the right, for whatever you've selected.

::: tip Watch it as you go
Open the side panel (the **Side panel** icon in the ribbon) while the type editor is the active tab. It shows a **Preview** of the type, and you can switch it between **Dialog** (the create dialog) and **Form** (the properties form). It follows your changes before you save.
:::

## Start from the fields

1. Click **Start from fields**. Every field goes into one frame, captioned *Task*.
2. Click the frame's caption to select it, and change **Caption** to `Details`.

Layout changes are part of the type's draft, like any other edit. Click **Save** whenever you're happy with them, or **Discard** to throw them away. While you work, <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> undoes the last change.

## Put two frames side by side

Frames stack one under the other. To put them side by side, put them in columns.

1. In the palette's **Layout** section, drag **2 columns** onto the layout, above the *Details* frame. A line shows where it will land.
2. Drag the *Details* frame by its grip into the left column.
3. Drag a **Frame** from the palette into the right column. Select it and change its **Caption** to `Schedule`.
4. Drag **Due** and **Days left** from *Details* into *Schedule*.
5. Drag **Completed** out of *Details* and drop it below the columns, for now.

*Details* now holds Priority, Assignee and Meeting, and *Schedule* holds Due and Days left.

To make one column wider, select the columns and set **Relative widths**: `2` and `1` makes the left column twice as wide. **Equal** sets them back. On a narrow screen, such as the sidebar, columns stack one above the other.

## Style the frames

Select a frame to style it. Try:

| Frame | Settings |
|---|---|
| *Details* | **Icon** *info*; **Accent colour**: the type's colour (the swatch with the type's icon) |
| *Schedule* | **Icon** *calendar*; **Header** *Soft* |

What each option does:

- **Accent colour** tints the caption and adds a stripe down the left side. Choose the type's colour, or one from the palette.
- **Style** is the frame itself: **Box** (a border), **Plain** (no border) or **Filled** (a light tint).
- **Header** puts a bar behind the caption: **Soft** is a tint, **Solid** the full colour. It uses the accent colour, or the type's colour if there isn't one. A frame needs a caption to show a header.
- **Can be collapsed** lets you fold the frame by clicking its caption. Turn on **Starts collapsed** too for a frame you rarely need.

## Show a frame only when it applies

The *Completed* date only means something once a task is done. Put it in a frame that only shows then.

1. Drag a **Frame** below the columns and caption it `Completion`.
2. Drag **Completed** into it.
3. With the frame selected, find **Show only when** in its settings and click **Add condition**.
4. Set the condition to **Status — is any of — done**.

The frame gets an eye badge reading *Status is any of done*. On a task, it appears as soon as you set the status to *done* (with the date your *Date completed tasks* workflow filled in), and disappears again if you set it back.

<!-- SHOT file="guides/form-layouts-show-only-when.png" vault="Entities Tutorial" alt="The Layout tab with the Completion frame selected and its Show only when condition" how="In the Entities Tutorial vault, open the Task type (Entity Browser > Types > Task) and its Layout tab. Build the layout described on this page if it isn't there yet: Start from fields; rename the frame Details; add 2 columns above it; drag Details into the left column; add a Frame in the right column captioned Schedule and move Due and Days left into it; add a Frame captioned Completion below the columns holding Completed, with Show only when Status is any of done. Select the Completion frame so the right-hand settings pane shows Caption, Icon, Accent colour, Style, Header and the Show only when panel with the condition. Capture the whole type editor (palette, layout and settings), not the rest of Obsidian." -->

A few things to know about conditions:

- They can test the type's fields (calculated fields too), **Status** and **Tags**, with the same operators as [view filters](/reference/filters). Choose **all** or **any** of the conditions.
- Frames, tabs and single fields can have conditions. Columns, headings and text can't; they show or hide with the frame or tab they're in.
- **Hiding never clears a value.** If you set the status back from *done*, Completed keeps its date.
- A required field that's hidden isn't required until it shows again.

## Add tabs

Tabs keep a long form short: one tab is open at a time.

1. Drag **Tabs** from the palette to the top of the layout. It comes with two tabs, *Tab 1* and *Tab 2*.
2. Click *Tab 1* and change its **Caption** to `Overview`. Click *Tab 2* and caption it `More`.
3. Drag the columns (by the grip on their heading) into the *Overview* tab, then the *Completion* frame below them. You can drop onto a tab's name, or hover over it while dragging to open it.
4. Open *More*. From the palette's **Properties** section, drag in **Related**, **Tags** and **Aliases**.

Tab groups only go at the top level, but a tab can hold columns, frames and fields. The form remembers which tab you last opened, for each type, and a tab with a problem in it shows a dot.

## Show the note itself

The palette has items for the note rather than its fields:

| Item | Where in the palette | What it shows |
|---|---|---|
| **Name** | **Properties** | The note's name, shown large. Editing it renames the note. |
| **Type**, **Subtitle**, **Type + subtitle** | **Read-only** | The note's type (click it to change type) and its subtitle. |
| **Created**, **Modified** | **Read-only** | The date and time. Hover for how long ago. |

For the Task form:

1. Drag **Name** above the tab group. The task's name now heads the form.
2. Open the *More* tab and drag in **Created** and **Modified**.
3. Their labels are hidden to start with. Select each one and set **Label** to **Above**, so they read *Created* and *Modified*.

When you place **Status**, **Type** or **Subtitle**, it leaves the form's top row and appears where you put it instead.

## Fine-tune single fields

Click a field on the layout to see its slot settings. They only change this form, not the field itself.

| Setting | Example on the Task form |
|---|---|
| **Label** | *Days left*: **Beside**, so the number sits next to its label. |
| **Custom label** | *Meeting*: `From meeting`. |
| **Placeholder** | *Assignee*: `Who's doing it?`, the grey text in the empty box. |
| **Help text** | *Priority*: **Custom**, `High means this week.` With **None**, the field's description shows when you hover over the label instead. |
| **Read-only on this form** | *Completed*: the workflow fills it in, so nobody needs to edit it. |

A read-only slot shows its value with a lock. It only stops editing in the form: the create dialog, views, bulk edits and workflows can still set it.

Long text fields also have a **Height**. **Edit field** jumps to the field on the **Fields** tab, and **Remove from layout** puts it back in the palette.

Click **Save**. Open a task to see the result:

<!-- SHOT file="guides/form-layouts-task-form.png" vault="Entities Tutorial" alt="A done task's properties form with the Overview tab: Details and Schedule side by side, and the Completion frame" how="With the Task layout from this page saved (Name at the top; a tab group Overview / More; in Overview a 2 columns element holding the Details frame [Priority, Assignee, Meeting; icon info, accent the type's colour] and the Schedule frame [Due, Days left; icon calendar, Header Soft], then the Completion frame [Completed, shown only when Status is any of done]; in More: Related, Tags, Aliases, Created, Modified with labels Above; slot settings: Days left label Beside, Assignee placeholder Who's doing it?, Priority custom help text High means this week., Completed read-only), open a task whose status is done (set one to done if needed so the workflow fills Completed) in Live Preview, in a wide enough pane that the columns sit side by side. Overview tab open. Crop to the properties form only." -->

## What the create dialog shows

The create dialog uses the same layout, with a few differences:

- **Each frame and tab has Show in the create dialog.** Turn it off to leave that part out of the dialog until you click **Show N more fields**. With a layout, this decides what the dialog shows; a field's own **Show in the create dialog** setting is no longer used.
- **Required fields are always asked for.** If one isn't on show, it appears in a **Required** frame of its own.
- **Fields you haven't placed** only appear under **Other fields**, after **Show N more fields**.
- **Status is always at the top.** A placed **Name** moves the dialog's Name box into the layout, and a placed **Tags** does the same.
- **Show only when…** works as you fill the dialog in. A new task starts as *todo*, so the *Completion* frame stays hidden.
- Read-only slots can still be filled in. Calculated fields, Type, Subtitle, Created, Modified, Related and Aliases aren't part of the dialog.

For the Task form, select the *More* tab and turn off **Show in the create dialog**. The dialog then asks for the name, status and the *Overview* fields, and keeps the rest one click away.

<!-- SHOT file="guides/form-layouts-create-dialog.png" vault="Entities Tutorial" alt="The New task dialog using the Task layout" how="With the Task layout from this page saved, and the More tab's Show in the create dialog turned off, run Obsidian Entities: Create task from the command palette. The New task dialog should show Status at the top, the Name box placed by the layout, the Overview/More tabs (or just Overview), the Details and Schedule frames side by side, and a Show N more fields link. Type a name such as Plan the launch. Crop to the modal." -->

::: tip Hide what you haven't placed
Fields you don't place are listed in an **Other fields** frame at the end of the form. To leave them off the form altogether, select nothing on the layout and turn on **Hide fields that aren't placed**. Notes keep their values.
:::

## Reuse a design

- **Copy and paste** a frame, columns or tab with <kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd> and <kbd>Ctrl/Cmd</kbd>+<kbd>V</kbd>, even into another type. Fields are matched by key, then by label.
- **⋯ → Save as component…** keeps the selected item under **My components** in the palette, for every type in the vault.
- **Start again from fields** replaces the layout with one frame; **Reset layout** removes it, so the form goes back to the plain list.

## See also

- [Form layouts](/reference/form-layouts): every element and option, the nesting rules and the keyboard
- [Properties form](/reference/properties-form): how the form works on notes
- [Validate what goes in](/guides/validation): required fields and rules, which the layout shows
- [Side panel](/reference/side-panel#type-preview): the type preview
