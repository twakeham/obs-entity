# Calendars

A calendar shows a view's entities by date, in a **Month**, **Week** or **Agenda** layout.

Any view can be shown as a calendar: click **Calendar** in the **Table | Board | Calendar** toggle. The note keeps every layout's settings, so switching loses nothing. To start with a calendar, choose the **Calendar** layout in **New view**, or **New calendar of …** on a type or group heading in the Entity Browser (offered when a type has a date field).

Filters, search, sorting and highlight rules are the view's own and work as in a [table](/reference/tables). See [Filters, sorting and highlights](/reference/filters).

## The toolbar

| Button | What it does |
|---|---|
| **Filters**, **Sort**, **Highlight** | As in a table. Sorting orders the entries within each day. |
| **Dates** | Which date fields place each type's notes, the first day of the week, and what colours entries. It reads e.g. "Dates: Due" when every type uses a field of that name. |
| **Swimlanes** | Splits the **Week** layout into rows by a field. |
| **Card fields** | What each entry shows on **Extended** cards. |
| **⋯** | **Save as…**, **Rename**, **Edit definition**, **Copy block**, **Show workflow toolbar**, **Show subtitles**, **Show field names** |

Above the calendar are the **Month | Week | Agenda** switch, the **Minimal | Extended** switch, **‹ Today ›** with the title of the period shown, and the **No date** button.

## Which dates are used

Click **Dates** to choose, for each type the view shows, the date field that places its notes. Choose **Not shown** to leave a type off the calendar.

Once a type has a date field, you can also pick an end date field (**Until …**). Notes with both span the days from one to the other, like a project from Start to Due. Choose **No end date** for one-day entries.

The first time a view becomes a calendar, each type gets an automatic choice, which is then saved:

- a pair of fields named like a start and an end, if the type has one: start, begin or from, with end, finish, until, due or deadline;
- otherwise, the type's first date field.

Saving the choice means adding a date field later doesn't move notes around.

Only stored date fields can place notes, since dragging writes to them: calculated date fields can't. A note whose end is before its start shows on its start day only.

::: info Dates without times
Dates have no times, and repeating events aren't supported. Calendars need real (Gregorian) dates: if your vault uses a custom calendar, the view says it can't show it.
:::

## Layouts

| Layout | Shows |
|---|---|
| **Month** | The weeks of the month. Notes spanning days are bars across them. A day shows up to four entries; when there are more, it shows three and "+*n* more", which lists the whole day. |
| **Week** | Seven days, with every entry. |
| **Agenda** | The next 30 days from the date shown, day by day. Only days with entries are listed, plus today. A note spanning days is listed once, on its first day, with its dates. |

**‹** and **›** move a month, a week or 30 days, and **Today** goes back to today. From the keyboard, **Page Up**, **Page Down** and **Home** do the same.

Without a sort, entries within a day are in status order, then by name.

The footer counts the notes in the period shown, e.g. "12 in November · 3 without a date · 2 not on the calendar".

## Cards, colours and card fields

Each entry is a card like a board's: the type's icon and the note's name, then its card fields.

- **Minimal | Extended:** **Minimal** cards show only the icon and name; **Extended** cards show the whole card. Each layout remembers its own: Month starts **Minimal**, Week and Agenda **Extended**.
- **Card fields:** click **Card fields** and tick the fields to show, then drag them into order under **On cards**. The **#** or calendar button next to a number or date field sets its format. Until you choose, cards show the table's first three columns after the name. Ticking a card field while on **Minimal** switches that layout to **Extended**, so you can see it.
- **⋯ → Show subtitles** adds the type's subtitle under the name, and **⋯ → Show field names** labels the card fields.
- **Colour by** (in the **Dates** panel): each entry's left edge shows its **Status** colour (the default), the colour of a choice field's option, or **Nothing**.
- **Highlights:** highlight rules style entries and their fields, as on a board.

Click an entry to open its note (Ctrl/Cmd-click for a new tab), or hover for a preview.

## Swimlanes in Week

**Swimlanes** (Week only) splits the week into rows, one per value of a field: by Assignee, say, to see who's doing what this week. Each row shows its value and the number of entries that week. You get one level, and any column can be used.

The **Show field names in swimlane headers** and **Show summaries in swimlane headers** options work as on a [board](/reference/boards#swimlanes).

## Dragging to reschedule

- **Move an entry:** drag it to another day to change its date. A note that spans days moves its start and end together.
- **Change one end:** drag the start or end of a bar (in Month and Week) to change just that date. The ends can't pass each other.
- **Change a swimlane:** in Week, dragging into another swimlane changes that field too, when it's one dragging can change (status, a choice, a checkbox or a single link). Otherwise entries stay in their own swimlane.
- **Undo:** **Ctrl/Cmd+Z** undoes a move. **Esc** cancels a drag.

Dates are written in your vault's usual date format.

### Notes without a date

**No date** opens a list of the notes whose type is on the calendar but which have no date (or one that can't be read). Drag one onto a day to give it that date.

### Creating and clearing

- **Create a note on a day:** double-click the day, or click its **+**. The new note's date field is set to that day, along with the Week swimlane's value and values from the view's simple filters. Only types on the calendar are offered.
- **Clear a date:** right-click an entry for the usual entity menu plus **Clear date**, which empties its date (and end date).

## The view block

A calendar's own settings go under `calendar:` in the view's `entity-view` block. Everything else (`types`, `filters`, `sort`, `highlight`, `formats` and the roll-up and formula definitions in `columns`) is shared with the table. See [Tables](/reference/tables#the-view-block) for those keys.

````markdown
```entity-view
kind: calendar
types: [project, milestone, task, meeting]
columns: [name, status, assignee, priority]
calendar:
  dates:
    project: { start: start, end: due }
    milestone: due
    task: due
    meeting: none
  layout: week
  weekStart: sunday
  colorBy: priority
  cardFields: [assignee]
  swimlanes: assignee
  cards: { month: extended }
```
````

`kind: calendar` makes the view open as a calendar.

| `calendar:` key | Meaning |
|---|---|
| `dates` | Type key → its date field's key, `{ start: <field>, end: <field> }` for notes that span days, or `none` to leave the type off. Types not listed get the automatic choice. A field that's gone, or isn't a date, falls back to it too. |
| `layout` | `month` (the default), `week` or `agenda`. |
| `weekStart` | The first day of the week: a day name such as `sunday`, or a number from `0` (Sunday) to `6` (Saturday). Default `monday`. |
| `colorBy` | `status` (the default), a choice field's column id, or `none`. |
| `cardFields` | Column ids shown on Extended cards, in order. Unset: the table's first three columns after the name. |
| `swimlanes` | One column id, or `{ by: <column id>, date: month \| year }`. Used in Week only. |
| `cardSubtitle` | `true` shows the type's subtitle on cards. |
| `cardLabels` | `true` labels card fields with their names. |
| `cards` | Layout → `minimal` or `extended`, e.g. `{ month: extended }`. Defaults: `month: minimal`, `week: extended`, `agenda: extended`. |

Keys left at their default aren't written.

To embed a calendar in another note, embed its view note: `![[Team calendar]]`. `|bare` hides the toolbar and footer, but keeps the calendar's own navigation. See [Views inside notes](/guides/views-in-notes).
