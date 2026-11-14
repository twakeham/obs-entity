# Triggers

What starts a workflow.

## The triggers

You pick the trigger under **When** in the workflow editor, from a row of buttons. There are six:

| Trigger | Button in the editor | What starts it | Applies to | Can ask questions |
|---|---|---|---|---|
| [When a field changes](#when-a-field-changes) | **Field changes** | A field changing on a note | Required | Yes |
| [When a note is created](#when-a-note-is-created) | **Note created** | A note being created | Required | Yes |
| [Run on notes](#run-on-notes) | **Run on notes** | You, pressing its button on notes | Optional (empty: any note) | Yes |
| [Fill in a form](#fill-in-a-form) | **Form** | You, filling in its form | Optional (empty: no note) | Yes |
| [On a schedule](#on-a-schedule) | **Schedule** | A time: every day, every week or every few hours | Required | No |
| [On a date](#on-a-date) | **Date reached** | A date field reaching today (or some days before or after) | Required | No |

**Can ask questions** means it may contain **Confirm** and **Ask a question** steps. Scheduled and date workflows run on their own, with nobody there to answer.

Changing the trigger keeps the rest of the workflow. The editor's header always shows the trigger in words, such as *When Status changes from "doing" to "done"* or *3 days before Due, at 09:00*.

## When a note is created

**Note created** in the editor. It runs when a note of the workflow's types is created: from the create dialog, **+ New** in a view, a calendar day, converting a note to an entity, or a **Create a note** step in another workflow. It also runs when a note of these types appears through sync. Renaming or moving a note doesn't count.

There are no options. **Only if** is checked on the new note.

Typical uses: stamp a date, add a tag, create linked notes to go with it.

## When a field changes

**Field changes** in the editor. It runs when a field changes on a note of the workflow's types. Changes from anywhere count: the properties form, a table, a board, another workflow, or the note's properties edited by hand. Edits to the note's body don't.

| Option | What it does |
|---|---|
| **Field** | The field to watch: **Status**, **Tags**, or any stored field of these types. |
| **From** | Only when the old value is one of these. None picked: any. |
| **To** | Only when the new value is one of these. None picked: any. |
| **When it** | For fields without a list of values: **Changes**, **Is filled in** or **Is emptied**. |

**From** and **To** are offered for status, choice and checkbox fields. Pick values the same way as on a multiple-choice field; picking several means any of them. For a checkbox, the values are **Ticked** and **Unticked**. Values are matched whatever their case.

For other fields (text, numbers, dates, links, lists and so on), **When it** offers:

- **Changes**: any change to the value.
- **Is filled in**: it was empty, and now has a value.
- **Is emptied**: it had a value, and now it's empty.

Calculated fields (roll-ups and formulas) can't be watched: they're never stored in the note, so they never change there. Watch the fields they're worked out from.

Inside the workflow, `old([Field])` gives a field's value before the change, and `new([Field])` its value after. See [Values and formulas](/reference/steps#values-formulas-and-text).

::: tip Which changes count
The workflow runs only when the value actually differs. Setting Status to *done* when it's already *done* doesn't count. Changes made by undo, and by workflows with **Set off other workflows** turned off, never count.
:::

## Run on notes

A button. It runs when you press it on one or more notes.

| Option | What it does |
|---|---|
| **Button** | Its icon and label. The label starts as the workflow's name. |
| **Ask first** | A question to confirm before it runs, such as *Close this task?*. Empty: it runs straight away. |
| **On several notes** | **Each note** (one run per note) or **Once for the selection** (one run for them all). |
| **Command** | A command of its own, **Workflow:** plus the label, which runs it on the open note. |
| **On views** | The views whose toolbars offer it. |

The button shows on the properties form (a strip at the top, or where the type's [form layout](/reference/form-layouts) places it) and its **⋯** menu, in the right-click menu of table rows, board cards and calendar entries, and in a view's selection bar under **Run…**. The **Run workflow on this note…** command lists the buttons for the open note. See [Buttons and forms](/reference/workflows#buttons-and-forms).

**Applies to** picks the types the button shows on. Leave it empty to offer it on every note.

**Ask first** is plain text, asked once however many notes you run it on. For a question that depends on the note, use a [Confirm](/reference/steps#confirm) step instead.

### Each note, or once for the selection

With **Each note**, running the button on 6 notes makes 6 runs. Each has its own note as "this note", and each is logged on its own.

With **Once for the selection**, it makes one run for all the selected notes together:

- The selected notes it applies to (its types, and its **Only if**) are `[Selected notes]`, a list of links.
- There's no single "this note". Use a [For each](/reference/steps#for-each) step over `[Selected notes]` to change each one, and `[Selected notes]` in formulas, such as `count([Selected notes])`.
- It's one entry in the run log (*3 selected notes*), with one **Undo**.
- If none of the selected notes match **Only if**, it doesn't run, and a notice says so.

For example, a *Long rest* button for player characters sets each one's HP to its maximum, then shows *4 heroes rest and recover*. See [Runs with no single note](/reference/steps#runs-with-no-single-note) for what steps can do there.

## Fill in a form

**Form** in the editor. A form workflow asks you to fill in a form, then runs its steps with your answers.

| Option | What it does |
|---|---|
| **Title** | Its icon and title, shown at the top of the form and in the command palette. |
| **Button** | The text of the button that sends the form. Empty: *Run*. |
| **The form** | Shows its fields, with buttons for **Form fields**, **Form layout** and **Preview**. |
| **Command** | A command of its own, **Workflow:** plus the title. |
| **Ribbon icon** | Forms that start on their own: an icon of its own in the left ribbon, which opens the form. |
| **On views** | The views whose toolbars offer it. |

### Building the form

The **Form fields** and **Form layout** tabs are the same as a type's **Fields** and **Layout** tabs in the Entity types view. A form can have every kind of field except roll-ups and formulas, with everything a type's field can have: required fields, defaults (including relative dates such as today), choices, link targets, validation rules and "required when". The layout can have frames, columns, tabs and conditions. See [Form layouts](/reference/form-layouts).

**Preview** shows the form in the side panel, as it will open, and follows your edits.

The form opens with the properties form's controls. **Ctrl/Cmd+Enter** sends it. **Cancel** runs nothing. A form with no fields runs straight away.

### With types, or without

**Applies to** decides how the form starts:

- **Without types** (Applies to empty), the form starts on its own, with no note: from the **Fill in a form…** command, its own command, its ribbon icon, view toolbars, or a dashboard button. Its steps act on notes the form picks, or ones they create or find. It can't have **Only if** conditions.
- **With types**, it's a button on those notes, like **Run on notes**, that asks the form first. Run on several notes, it asks once, and each note gets its own run with the same answers.

For example, a *Log a meeting* form with no types asks for a date, a project, the attendees and a summary, then creates the meeting note and adds a line to the project.

### The answers

Steps use each answer by its field's label: `[Date]`, `[Attendees]`, `[Summary]`. They're listed under **The form's answers** in a step's **[ ]** menu and in the formula editor.

| Field kind | The answer is |
|---|---|
| Number | A number |
| Date | A date |
| Checkbox | `true` or `false` |
| Multiple choice, list | A list |
| Link | A list of links |
| Anything else | Text |

An empty answer is empty. A link field that picks **one** note can be acted on: steps offer it under **Picked on the form** in their **On** picker, so you can add text to `[Project]`, say. If nothing was picked, steps on it are skipped.

Answer names must be unique, can't be *This note* or *Selected notes*, and can't contain brackets or braces. On a form with types, a label also can't be the same as a field of those notes. Renaming a field's label updates the steps that use it: `[Summary]` becomes `[What happened]`.

The run log keeps the answers. A form workflow can't be run by **Run another workflow**.

## On a schedule

**Schedule** in the editor. It runs at set times, on every note of its types that matches **Only if**: one run for each note.

| Option | What it does |
|---|---|
| **Every** | **Day**, **Week** or **Few hours**. |
| **On** | Week: the day of the week. |
| **At** | Day and week: the time, in local time. |
| **Hours** | Few hours: how many hours after it last ran (1 to 168). |
| **At most** | The most notes it runs on. When more match, it doesn't run at all. |

For example, *Every Friday at 18:00*, tag each session planned in the next week with `prep` and show a reminder.

## On a date

**Date reached** in the editor. It runs when a date field on a note reaches today, or a number of days before or after it.

| Option | What it does |
|---|---|
| **Date field** | One of these types' date fields. |
| **When** | **Before**, **On the day** or **After**. Before and after take a number of **days**. |
| **Check at** | The time it checks, once a day. |
| **At most** | The most notes it runs on in one check. When more match, it doesn't run at all. |

For example, *3 days before Deadline* tags a quest `urgent`; *1 day after Due* tags a task `overdue`.

It checks once a day, at the **Check at** time (or when Obsidian next opens, if it was closed then). Each check runs on the notes whose date (moved by the days before or after) has been reached since the last check, so dates that passed while Obsidian was closed are caught up, once per note. If you set a date to today after today's check, it runs straight away.

## Scheduled and date workflows

Both run on their own, so they share some rules:

- **Where they run.** They run while Obsidian is open, on devices where **Run scheduled workflows on this device** is on. See [Scheduled workflows on each device](/reference/workflows#scheduled-workflows-on-each-device).
- **Missed runs.** A missed run catches up **once**, the next time Obsidian is open. A workflow that was off or paused, or had problems, starts again from now rather than catching up.
- **At most.** If more notes match than **At most** (50 to start with), it doesn't run at all, and the run log says why. Each note's run also stops if it would change or create more notes than that.
- **No questions.** They can't have **Confirm** or **Ask a question** steps.
- **Moves and renames** only happen if Obsidian updates links by itself (**Settings → Files and links → Automatically update internal links**). Otherwise Obsidian would ask, and nobody would answer, so the run stops. The editor warns you.
- **Notices.** After a run, one notice says how many notes it ran on (and how many didn't), with **Undo**.

The editor shows when it last ran (or checked) and when it runs next on this device, and warns you if it won't run: switched off, paused, or not on this device.

## How triggers are stored

In a [pack](/reference/packs), a workflow's `trigger` is an object whose `kind` says which trigger it is. See [How workflows are stored](/reference/workflows#how-workflows-are-stored) for the rest of the workflow.

| `kind` | Keys |
|---|---|
| `"created"` | None. |
| `"changed"` | `field`: the field's key (`"status"`, `"tags"` or a field). `from`: a list of values. `to`: a list of values, or `"filled"` or `"empty"`. |
| `"manual"` | `label`, `icon`, `confirm` (the **Ask first** text), `selection`: `"once"` for once for the selection. |
| `"form"` | `title`, `button`, `icon`, `fields`: a list of fields as in a type, `layout`: a form layout. |
| `"schedule"` | `every`: `"day"`, `"week"` or `"hours"`. `at`: `"HH:MM"`. `day`: 0 (Sunday) to 6 (Saturday). `hours`: 1 to 168. `limit`: **At most**. |
| `"date"` | `field`, `offset`: days (negative is before, `0` on the day), `at`: `"HH:MM"`, `limit`: **At most**. |

Keys that aren't set can be left out. Unusable values fall back to the defaults: `09:00`, Monday, every 4 hours, and 50 notes.

```json
{ "kind": "changed", "field": "status", "from": ["doing"], "to": ["done"] }
```

```json
{ "kind": "changed", "field": "assignee", "to": "filled" }
```

```json
{ "kind": "manual", "label": "Level up", "icon": "trending-up", "confirm": "Raise this character's level by one?" }
```

```json
{ "kind": "manual", "label": "Long rest", "icon": "bed", "selection": "once" }
```

```json
{ "kind": "schedule", "every": "week", "at": "18:00", "day": 5, "hours": 4, "limit": 20 }
```

```json
{ "kind": "date", "field": "deadline", "offset": -3, "at": "09:00", "limit": 20 }
```

A form's fields use the same keys as a type's fields:

```json
{
  "kind": "form",
  "title": "Log a meeting",
  "button": "Log meeting",
  "icon": "notebook-pen",
  "fields": [
    { "key": "date", "label": "Date", "kind": "date", "required": true, "defaultFrom": { "kind": "relative", "spec": "today" } },
    { "key": "project", "label": "Project", "kind": "relation", "targets": ["project"], "required": true },
    { "key": "summary", "label": "Summary", "kind": "textarea" }
  ]
}
```
