# Roll-ups

A roll-up summarises the notes linked to a note: it counts them, totals or averages a number, finds the earliest or latest date, lists names, or works out how much is done.

Roll-ups are **calculated**: they're worked out whenever they're shown and never stored in the note, so they're always up to date. A project's "Open tasks" changes the moment a task is ticked off.

## Two places to add one

You can add a roll-up in two places. They work the same way.

| | Where | Use it for |
|---|---|---|
| **Roll-up field** | The type's **Fields** tab | Something every note of the type should have, everywhere: in its form, in Reading view and in every view. |
| **Roll-up column** | A view's **Columns** panel | Something only one view needs. |

A type's roll-up fields are ready-made columns in every view of that type, so a view only needs a roll-up column of its own for something specific to it.

### A roll-up field

1. Open the type in the Entity types view, and go to its **Fields** tab.
2. Click **Add field**, choose **Roll-up** (*worked out from linked notes*) and give it a label, e.g. `Open tasks`.
3. Open its **Roll-up** tab and fill in:

| Setting | What it does |
|---|---|
| **From** | Which linked notes: one of this type's relation fields, or notes of another type that link here, e.g. *Tasks (linking here)*. |
| **Calculate** | What to work out. See [Every calculation](#every-calculation). |
| **Of field** | The linked notes' field to work it out from. Only shown when the calculation needs one. |
| **Only include** | Conditions, so only some linked notes count. See [Only some linked notes](#only-some-linked-notes). |

Below them, **Gives** says what kind of value you get (a number, a date, a list or text), and **Preview** shows the value for one of your notes. A number or date result can also have a display format, like any number or date field.

If the type has no relationships at all, the tab says so: add a relation field to this type, or one on another type that links to it.

### A roll-up column in a view

1. In a table or board, click **Columns** in the toolbar.
2. Under **Roll-ups and formulas**, click **Add roll-up…**.
3. Fill in the **Add roll-up** dialog:

| Setting | What it does |
|---|---|
| **Relationship** | The view's types' relation fields, and links from other types, marked *(incoming)*. |
| **Summarise as** | What to work out. |
| **Of field** | The linked notes' field, when the calculation needs one. |
| **Only include linked notes that match** | Conditions, so only some linked notes count. |
| **Show as** | For counts and sums: the **Value**, **% of total** or **% of group total**. See [Showing a share of the total](#showing-a-share-of-the-total). |
| **Column label** | The column's name. Leave it empty for an automatic one, such as `Tasks: sum of estimate`. |

4. Click **Add column**.

To change it later, click the pencil next to it in the **Columns** panel, or right-click its header and choose **Edit roll-up…**.

## Which linked notes

A roll-up follows links in either direction.

- **This note's links:** a relation field on this type. A project's **Team** field gives the people it links to.
- **Links pointing here:** a relation field on another type that links to this one. On a person, *Tasks (linking here)* gives every task whose **Assignee** is that person. You don't need a field on the person at all.

Links pointing here are named after the other field's **inverse** name if it has one, otherwise as the field and its type, e.g. *Assignee (from Task)*. Only relation fields limited to particular types are offered here; a link field that can point at any entity isn't.

Roll-ups only look at linked notes that are entities. A note linked twice from the same note counts once when you follow links pointing here.

## Every calculation

The type editor and the view dialog word the choices slightly differently. They're the same calculations.

| **Calculate** (type editor) | **Summarise as** (view) | **Of field** | Gives |
|---|---|---|---|
| Count | count | — | How many linked notes there are. |
| Names | names | — | The linked notes' names, A–Z, as a list. |
| Unique values of a field | unique values | Any field | Each different value of the field once, A–Z, as a list. Links give the notes' names. |
| Sum of a field | sum | A number | The total. |
| Average of a field | average | A number | The average. |
| Smallest value of a field | min | A number | The smallest value. |
| Largest value of a field | max | A number | The largest value. |
| Earliest date of a field | earliest | A date | The earliest date. |
| Latest date of a field | latest | A date | The latest date. |
| % done (by status) | % done | — | The share of linked notes that are done, e.g. `75%`. See [% done](#done-and-the-last-status). |
| Count by status | count by status | — | How many are in each status, e.g. `2 active · 1 done`. |

**Of field** lists only the fields that suit the calculation:

- **A number:** number fields, choice fields whose choices have values (each note counts as its choice's number; multiple choice as the total), and calculated fields that give a number.
- **A date:** date fields, and calculated fields that give a date.
- **Any field:** every field, calculated ones too.

Because calculated fields are offered, a roll-up can build on another roll-up or a formula. A programme can sum its projects' **Open tasks**, which is itself a roll-up.

### Empty and missing values

- Linked notes with no value in the field are skipped.
- A sum, average, min or max with no numbers to work from is empty, not 0. The same goes for earliest and latest.
- A count is 0 when nothing is linked.
- A count with no conditions counts every link, even links to notes that don't exist yet. With conditions, it counts only the linked notes that exist and match, because a missing note can't be checked.
- Numbers show with up to two decimal places, unless you give the field or column a display format.

## Only some linked notes

Add conditions to roll up only the linked notes that match. For example:

- **Open tasks:** count of tasks where **Status** is none of *done*.
- **Hours this sprint:** sum of **Estimate** where **Sprint** is *Sprint 3*.
- **Won deals:** sum of **Value** where **Status** is any of *won*.

In the type editor, click **Add a condition…** next to **Only include**. In the view dialog, the conditions are always there. Either way you build them exactly like a view's filters: pick a field of the linked notes, an operator and a value, combine conditions with **All** or **Any**, and group them. See [Filters, sorting and highlights](/reference/filters) for every operator.

You can test:

- the linked notes' **fields**, calculated ones too;
- their **built-ins**: name, status, tags, folder, dates and so on;
- their **incoming links**.

The roll-up then says what it counts in words. In the type editor, **Only include** reads e.g. "Only tasks where Status is any of done." In a view, the automatic label ends in "(filtered)", and hovering the header shows e.g. "Sum of value of Deals where Status is any of won".

A condition that can't be used (its field no longer exists, or it has no value yet) is ignored, as in view filters. In the type editor, an ignored condition shows as a problem on the field.

### This note (views only)

In a roll-up column's conditions, a link condition can point at **This note**: the note the view is embedded in. A People view embedded in a project note can then count each person's tasks *for that project*:

- **Relationship:** *Tasks (incoming)*: the tasks whose Assignee is the person
- **Summarise as:** count
- **Only include:** **Project** links to **This note**

Roll-up fields don't have This note: they're worked out wherever the note shows, so there's no note to point at.

## % done and the last status

**% done** is the share of linked notes whose status is their type's **last** status. Each linked note is checked against its own type's list (or its group's, if the type uses the group's statuses).

- Linked notes with no status are left out.
- The result is a whole percentage: 3 tasks done out of 4 is `75%`.
- It's empty when none of the linked notes has a status.

So put your finished state last in the status list, and states like *cancelled* before it. A task that's *cancelled* doesn't count as done; if you'd rather leave cancelled tasks out altogether, add a condition: **Status** is none of *cancelled*.

**Count by status** goes through the statuses in their list order, e.g. `1 todo · 2 doing · 3 done`, leaving out statuses no linked note has. Its result is text, so it sorts as text.

## Showing a share of the total

In a view, a **count** or **sum** column can show each row's share of the whole instead of its own value: "this person has 18% of the hours".

| **Show as** | Each row shows |
|---|---|
| **Value** | The count or sum itself. |
| **% of total** | Its share of the column's total over the rows in the view. |
| **% of group total** | Its share of its group's total (its swimlane, on a board). Without grouping, the same as % of total. |

Set it with **Show as** in the dialog, or right-click the header and tick **Show as % of total**.

- The total is over the rows left after the search and filters. A filter on the share itself (e.g. greater than 10) doesn't change the other rows' shares.
- Shares show as e.g. `18%`, `< 1%` for tiny shares, and empty when the total is 0.
- They sort, filter, highlight and take data bars like any other number. A number format applies to the share.
- The summary row's sum shows 100%.
- [Formulas](/reference/formulas) that use the column still get the count or sum itself, not the share.

Showing a share is only for view columns, not roll-up fields.

## Using roll-ups

A roll-up's value is read-only. Everywhere else, it acts like an ordinary field of its kind:

- **In the form and Reading view** it shows its value, and it can go in a form layout or the subtitle. A value that can't be worked out shows "—", with the reason when you hover over it.
- **In views** it's a column you can sort, filter, group, highlight, summarise and format. Counts, sums, averages, min, max and % done are numbers; earliest and latest are dates; names and unique values are lists; count by status is text. The summary row shows the average of a % done column as a percentage.
- **In formulas** you refer to it by its label, e.g. `[Open tasks] = 0`. See [Formulas](/reference/formulas).
- **In dashboards** a card or chart can summarise it, like any field.

Roll-up fields are left out of the create dialog, as there's nothing to type. If some notes have their own property with the same name as a roll-up field, it's ignored and the worked-out value is shown; the field's tab says how many notes have one.

## Problems

| Message | What to do |
|---|---|
| The roll-up's relationship "…" doesn't exist. | The relation field it follows was deleted or renamed. Choose another in **From** or **Relationship**. |
| Choose the field to roll up. | Pick an **Of field**. |
| Choose what to roll up. | The roll-up field isn't set up yet: open its **Roll-up** tab. |
| Circular reference between notes. | The roll-up reaches back to the note it's on, e.g. through a roll-up on the linked notes that rolls this one up. Roll up a different field. |
| The condition "…" is ignored: … | One of the **Only include** conditions can't be used. Fix or remove it. |

## In the view block

A roll-up column is stored in its view note's code block, in `columns`. You can write one by hand:

```yaml
columns:
  - name
  - status
  - rollup:
      via: in:task.assignee
      agg: count
      where:
        all:
          - field: status
            op: none-of
            value: [done]
    label: Open tasks
    id: open_tasks
```

| Key | Value |
|---|---|
| `via` | `field:<key>` for one of the row's relation fields, or `in:<type>.<field>` for another type's relation field that links here (type and field keys). |
| `agg` | `count`, `list` (names), `unique`, `sum`, `avg`, `min`, `max`, `earliest`, `latest`, `percent-done` or `count-by-status`. |
| `field` | The linked notes' field key. Needed for `unique`, `sum`, `avg`, `min`, `max`, `earliest` and `latest`. |
| `show` | `value` (the default), `total` or `group`. Only for `count` and `sum`. |
| `where` | Conditions, written like the view's `filters`: `all:` or `any:` and a list of `field`, `op` and `value`. |
| `label`, `id` | The column's label, and the id that sorting, filters and formulas use. |

Roll-up fields use the same settings, saved with the type.
