# Smart defaults

Let new notes fill themselves in: fixed values, dates relative to today, values copied from a linked note, and numbers such as *TASK-0042*.

In [Getting started](/getting-started/first-types) you gave Priority a default of *Medium*. That's the simplest kind. This page builds on the same tracker to show the others, and how they behave when you create a note.

## The four kinds of default

Every stored field has a **Default** on its **General** tab. The dropdown offers the kinds that suit the field:

| Default | For | Example |
|---|---|---|
| **A fixed value** | every kind except relations | Priority starts at *Medium* |
| **Relative to today** | dates | Due starts a week from today: `today+7d` |
| **From a linked note** | every kind, including relations | A task's Role is copied from its Assignee |
| **The next number** | text and numbers | Each task gets the next code: *TASK-0042* |

Roll-ups and formulas are worked out, not stored, so they have no default. Relation fields only offer **None** or **From a linked note**.

## Start dates relative to today

A fixed date is rarely useful: next month it's in the past. A relative date is worked out each time you create a note. Make new tasks due a week from the day they're created:

1. On the Entity Browser's **Types** tab, click **Task**, open the **Fields** tab and click **Due**.
2. On its **General** tab, change **Default** from **A fixed value** to **Relative to today**.
3. Type `today+7d` in the box. Beside it, the editor shows the date that gives today, such as *Today that's 22/11/2026*.
4. Click **Save**.

<!-- SHOT file="guides/defaults-relative.png" vault="Entities Tutorial" alt="The Due field's General tab, with Default set to Relative to today and today+7d typed in" how="Entity Browser → Types tab → click Task → Fields tab → click Due. On the General tab set Default to 'Relative to today' and type today+7d, so the 'Today that's …' line shows. Crop to the field's panel on the right (General tab), from the tab strip down to the Show in the create dialog row. Click Discard afterwards if the vault should stay as in the tutorial." -->

Write `today`, then `+` or `-` a number and a unit:

| Unit | Example | Gives |
|---|---|---|
| `d` days | `today+14d` | two weeks from today |
| `w` weeks | `today-1w` | a week ago |
| `m` months | `today+1m` | this day next month |
| `y` years | `today+1y` | this day next year |

`today` on its own gives today's date: handy for a meeting's **Date**, or a *Started* field.

## Copy a value from a linked note

**From a linked note** copies a field from the note this one links to. It's for values that usually match the linked note's: a task's client from its project, an invoice's address from its customer.

In the tracker, say you want to see tasks by the kind of work. People already have a **Role**, so let each task take its assignee's:

1. Open Task's **Fields** tab and **Add field → Choice**. Label it `Role`, and give it the same choices as Person's: `Manager`, `Designer`, `Developer`, `Tester`.
2. On its **General** tab, set **Default** to **From a linked note**.
3. Two dropdowns appear. In the first choose **Assignee**, the relation field to follow; in the second choose **Role**, the field to copy from the linked note.
4. Click **Save**.

<!-- SHOT file="guides/defaults-linked.png" vault="Entities Tutorial" alt="A Role field whose default is From a linked note: Assignee note's Role" how="Entity Browser → Types tab → click Task → Fields tab → Add field → Choice, label it Role, add choices Manager, Designer, Developer, Tester on its Choices tab. Back on its General tab set Default to 'From a linked note', then pick Assignee in the first dropdown and Role in the second (they read 'Assignee  note's  Role'). Crop to the field's General tab. Save the type (the next shot of the create dialog uses this field)." -->

Now create a task and pick **Grace Hopper** as its Assignee. Role fills in with *Developer* straight away.

- **Change the link** and the copied value changes with it.
- **Set the field yourself** and it's left alone, whatever link you pick.
- The second dropdown lists the linked type's fields, those of the same kind first. Others are marked with their kind, such as *(text)*; copy one only if its values suit this field.

::: tip A copy, not a live link
The value is copied once, when the note is created. If Grace later becomes a Manager, her old tasks keep *Developer*. That's usually what you want for a client or an address. If the value should always follow the linked note, use a formula instead: `prop([Assignee], "Role")` (see [prop()](/reference/formulas#prop)).
:::

## Number notes automatically

**The next number** gives each new note one more than the highest number its type's notes already use in that field. Give tasks a code:

1. On Task's **Fields** tab, **Add field → Text**, and label it `Code`.
2. Set **Default** to **The next number**. The **Pattern** starts as `TASK-{n}`, from the type's name, and **Digits** as `4`.
3. Change the pattern if you like: `{n}` is where the number goes, so `T{n}` gives *T0042*. The line beside it shows what comes next, such as *Next: TASK-0001*.
4. Click **Save**.

On a **Number** field there's no pattern: the default is just the next number, 1, 2, 3 and so on.

- **It counts what's there.** The number is one more than the highest in use, so gaps left by deleted notes aren't filled. Only values that match the pattern count: change `TASK-{n}` to `T-{n}` and numbering starts again at 1.
- **It's taken when the note is created,** not when the dialog opens. Two notes created one after the other never get the same number.
- **Make it unique.** Turn on **Unique** on the field's **Validation** tab, so a code typed by hand that's already in use is flagged (see [Validation](/reference/fields#validation)).
- **Show it.** Add Code to the type's **Subtitle fields** (on the **Display** tab), so it shows under each task's name in pickers and the Entity Browser.

## What you see in the create dialog

Create a task now (**Obsidian Entities: Create entity → Task**). Each kind of default shows up differently:

| Default | In the create dialog |
|---|---|
| **A fixed value** | Already filled in. Change it, or clear it to leave the field empty. |
| **Relative to today** | Already filled in with the date it gives today. |
| **From a linked note** | Empty until you set the link, then filled in. Changing the link fills it in again, unless you've set the field yourself. |
| **The next number** | Empty, with the number it will get as a placeholder, such as *Next: TASK-0042*. Leave it empty to take the number, or type your own. A required field with this default doesn't need filling in. |

<!-- SHOT file="guides/defaults-create-dialog.png" vault="Entities Tutorial" alt="The create dialog for a task, with Due a week ahead, Priority Medium, Role copied from the assignee and Code showing Next: TASK-0001" how="Needs the Due default from the first shot saved, plus the Role field (linked default) and a Code text field with Default 'The next number' (pattern TASK-{n}, 4 digits), all saved on Task. Then Ctrl/Cmd+P → 'Obsidian Entities: Create entity' → Task. Type the name 'Book the venue', pick Grace Hopper in Assignee so Role fills in with Developer. Leave Code empty so its placeholder 'Next: TASK-0001' shows. Crop to the dialog." -->

Fields that aren't in the create dialog get their defaults too, as do notes made without it: **Create "…"** in a link picker, a workflow's **Create a note** step, and so on.

::: tip Prefilled links
With **Prefill links from the active note** on (in **Settings → Obsidian Entities → Behaviour**, on to start with), a new note is linked to the note you're looking at, when one of its fields can link to that type. Open Grace's note and create a task: Assignee is already Grace, so Role is already *Developer*. See [Settings](/reference/settings#behaviour).
:::

The status isn't a field and has no default: new notes start at the type's **first** status. To start somewhere else, reorder the statuses (see [Statuses](/reference/types#statuses)).

## Defaults and existing notes

A default only fills in **new** notes. Adding a default, or changing one, never changes the notes you already have, and **Save** doesn't offer to update them.

To give existing notes a value, use a table: open **All tasks**, select the rows, and choose **Set field…** (see [Bulk edits](/reference/tables#bulk-edits)).

Two things add fields to a note that already exists: **Convert to entity** and **Change type…**. They fill in the type's missing fields with their **fixed** defaults. Relative dates, copied values and numbers are only worked out for new notes.

## Pre-fill the body with a template

Defaults fill in the frontmatter. The note's body comes from its type's **template**: a note in your templates folder (`_templates/entities` to start with).

1. Open the type's **General** tab and, under **Template**, click **Open template**. The file is created from the built-in template if it doesn't exist yet.
2. Edit it like any note. For tasks, you might write:

::: v-pre

```markdown
**{{code}}** · raised on {{date:D MMM YYYY}}

## Details

## Notes
```

Placeholders such as `{{name}}`, `{{date}}` and `{{field_key}}` (a field's value, by its key, such as `{{code}}`) are filled in when the note is created, after the defaults, so `{{code}}` gives the new task's number. Placeholders the plugin doesn't know are left for Templater and other plugins.

:::

If the template has frontmatter of its own, its values are kept wherever the plugin has nothing to write, and its tags are added to the note's. See [Template](/reference/types#template) for every placeholder.

## See also

- [Fields: Defaults](/reference/fields#defaults): every kind of default, in full
- [Validate what goes in](/guides/validation): required fields, unique codes and other rules
- [Organise notes in folders](/guides/folders): where new notes are filed
- [Entity notes: A new note](/reference/notes#a-new-note): exactly what's written when a note is created
- [Relationships: In the create dialog](/reference/relationships#in-the-create-dialog)
