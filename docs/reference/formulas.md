# Formulas

Formulas calculate a value from fields, the way a spreadsheet does: `[Budget] / [Tasks]`, `dateDiff(today(), [Due], "days")`, `if([Status] = "done", "✓", "")`.

The formula language is small and safe: the plugin works formulas out itself, and never runs them as code.

## Where you can use formulas

| Where | How to get there | What `[ ]` can refer to |
|---|---|---|
| **Formula fields** | The type's **Fields** tab → **Add field** → **Formula**, then its **Formula** tab → **Edit formula…** | The type's fields, built-ins, incoming links and other calculated fields. |
| **Formula columns** in a view | **Columns** → **Add formula…**. To change one: the pencil in the **Columns** panel, right-click its header → **Edit formula…**, or double-click a cell. | Any column the view could show: its columns, the types' fields, built-ins, incoming links, and its roll-up and formula columns, shown or not. |
| **Dashboard cards** | A card's **Data** tab → **Value** from **Other cards** | Other cards by title, and the dashboard's filters by title. |
| **Dashboard sources** | A card's, chart's or list's **Data** tab → **From** **Formula** | The dashboard's filters by title. The formula must give notes. |
| **Workflow steps** | **ƒx** next to a value, or a formula box | The note's fields and built-ins, plus names from the run: this note, loop items, created and found notes, form answers and variables. |

Formula fields are worked out wherever the note shows, like [roll-ups](/reference/rollups). A view's formula columns are for something only that view needs. See [Fields](/reference/fields), [Tables](/reference/tables), [Dashboards](/reference/dashboards) and [Steps](/reference/steps) for the rest of each place's settings.

## The formula editor

Formula fields, view columns and workflow steps share one editor.

- **Name** (view columns only): the column's label, e.g. `Days left`.
- **Formula:** the formula itself, with colouring, matching brackets and quotes, and errors underlined as you type.
  - Type `[` to pick a field, or start typing a function name. Ctrl/Cmd+Space shows suggestions.
  - Hover over a function or field for help.
- **The status line** shows the problem, or the result's type, e.g. **Result: Number**.
- **Result type** (fields and view columns): **Automatic**, or one you choose. See [Result types](#result-types).
- **Preview:** the results for the first few notes. In a workflow, it shows what the first notes would get.
- **The side panel** lists the fields and every function, by category, with a search box. Click one to put it in.
- **Save** (Ctrl/Cmd+Enter) is greyed out while there's an error. **Cancel** throws your changes away.

Dashboard formulas are typed straight into a box on the component's **Data** tab, which shows the result or the problem as you type.

## Referring to fields

Write a field's label in square brackets: `[Due]`, `[Estimate (h)]`, `[Days left]`.

- **Labels first, then keys.** A name is matched against the labels first, ignoring case, then against the keys. `[due]` and `[DUE]` both find the Due field.
- **Renaming is safe.** Formulas are saved with keys and shown with labels, so renaming a field's label doesn't break them.
- **Calculated fields work too.** A formula can use a roll-up (`[Open tasks]`) or another formula (`[Days left] < 0`). A formula that ends up referring to itself is an error: "Circular reference: Days left → Overdue → Days left."
- **Built-ins** use their labels: `[Status]`, `[Tags]`, `[Folder]`, `[Created]`, `[Modified]` and so on. When a type has parent fields, `[Parent]`, `[Top-level parent]` and `[Ancestors]` work too.
- **Incoming links** use the name they have as a column, e.g. `[Tasks]` for the tasks that link to a project.

An unknown name is an error: "Unknown column [Dew]."

## Values and types

Every value has a type:

| Type | Examples |
|---|---|
| **Number** | `42`, `3.5`, `.5`, `1e6`, a number field |
| **Text** | `"done"` or `'done'`, a text or choice field |
| **True/false** | `true`, `false`, a checkbox, a comparison like `[Due] < today()` |
| **Date** | a date field, `today()`, `date(2026, 12, 31)` |
| **List** | a multiple-choice, list or tags field, `list("a", "b")` |
| **Links** | a relation field, `notes("task")` |

Some details:

- **Text** can use straight or curly quotes. Inside it, `\"` is a quote, `\n` a new line and `\t` a tab.
- **Dates** have no time of day. There's no date literal: write `date(2026, 12, 31)` or `date("2026-12-31")`. Text that reads as a date can also be compared with a date: `[Due] < "2026-12-31"`.
- **Function names and keywords** ignore case: `dateDiff`, `datediff` and `DATEDIFF` are the same, and so are `and` and `AND`.
- **Spaces and line breaks** between parts don't matter.

## Operators

| Operator | Meaning | Example |
|---|---|---|
| `+` | Add. A date plus a number moves the date by that many days. | `[Start] + 14` |
| `-` | Subtract. A date minus a date is the number of days between them. | `[Due] - today()` |
| `*` | Multiply | `[Hours] * [Rate]` |
| `/` | Divide | `[Spent] / [Budget]` |
| `%` | The remainder after dividing | `[Order] % 2` |
| `&` | Join as text | `[Code] & "-" & [Number]` |
| `=` or `==` | Equal | `[Status] = "done"` |
| `!=` or `<>` | Not equal | `[Priority] != "Low"` |
| `<` `<=` `>` `>=` | Less than, at most, more than, at least | `[Due] <= today()` |

The logical operators are words, with symbols you can use instead:

- `and` (or `&&`): true when both sides are true.
- `or` (or `||`): true when either side is true.
- `not` (or `!`): true when what follows is false.

A minus sign in front of a value makes it negative: `-[Balance]`.

**Order:** `*`, `/` and `%` come first, then `+` and `-`, then `&`, then comparisons, then `not`, then `and`, then `or`. Use brackets to change the order: `([Budget] - [Spent]) / [Budget]`.

`not` takes in a whole comparison: `not [Status] = "done"` means `not ([Status] = "done")`.

### Joining text

Use `&` or `concat()` to join text. `+` only adds numbers, so `[Name] + " (draft)"` is an error: "Use & to join text, e.g. [Name] & " " & [Status]."

### Empty values

A field with nothing in it is **empty**.

- **Arithmetic** with an empty value is empty: `[Budget] - [Spent]` is empty while Spent is.
- **Comparisons** (`<`, `>`, `<=`, `>=`) with an empty value are false.
- **`=`** treats two empty values as equal: `[Owner] = ""` is true when there's no owner. `empty([Owner])` says the same thing more clearly.
- **`sum()`, `avg()`, `min()` and `max()`** skip empty values. `coalesce()` gives the first value that isn't empty.

### How values compare

- Numbers compare as numbers, dates as dates, and text in natural order, ignoring case (`Task 2` before `Task 10`).
- With `=`, text is compared exactly, so case matters. Use `lower()` on both sides, or `contains()`, to ignore it.
- With `=`, text that reads as a number equals that number: `[Code] = 42` matches the text "42".
- A link equals text that's the note's name, ignoring case: `[Owner] = "Grace Hopper"`.
- A list with one item compares like that item, so a single-link field works with `=`.
- Comparing values that don't go together, like a date and a number, is an error: "Can't compare a date with a number."

### True and false

Wherever a formula is used as a test (`if()`, `filter()`, `and`, `or`, `not`, a workflow's If), these count as **false**: `false`, `0`, empty text, an empty list and an empty value. Everything else is **true**.

## Functions

Every function, by category, as the editor lists them. Arguments with a `?` can be left out.

### Logic

| Function | What it gives | Example |
|---|---|---|
| `if(condition, then, else)` | The second value when the condition is true, otherwise the third. Without the third, empty. | `if([Status] = "done", "✓", "")` |
| `ifs(condition1, value1, condition2, value2, …, else?)` | The value after the first true condition; the last value if none are true. | `ifs([Budget] > 200000, "Large", [Budget] > 50000, "Medium", "Small")` |
| `and(a, b, …)` | True when every value is true. You can also write `a and b`. | `and([Status] != "done", [Due] < today())` |
| `or(a, b, …)` | True when any value is true. You can also write `a or b`. | `or([Priority] = "High", [Priority] = "Critical")` |
| `not(value)` | True when the value is false or empty. | `not(empty([Owner]))` |
| `empty(value)` | True when the value is empty: no text, no number, no date or an empty list. | `empty([Due])` |
| `coalesce(a, b, …)` | The first value that isn't empty. | `coalesce([Due], [Start], today())` |

`if`, `ifs`, `and`, `or` and `coalesce` stop as soon as they know the answer, so a branch that isn't used is never worked out. `if([Tasks] = 0, 0, [Budget] / [Tasks])` never divides by zero.

### Maths

| Function | What it gives | Example |
|---|---|---|
| `round(number, places?)` | Rounds to a number of decimal places (0 by default). | `round([Budget] / [Tasks], 2)` |
| `floor(number)` | Rounds down to a whole number. | `floor([Estimate (h)] / 8)` |
| `ceil(number)` | Rounds up to a whole number. | `ceil([Estimate (h)] / 8)` |
| `abs(number)` | The number without its sign. | `abs([Due] - today())` |
| `min(a, b, …)` | The smallest number or earliest date. Lists are included item by item. | `min([Due], [Start])` |
| `max(a, b, …)` | The largest number or latest date. Lists are included item by item. | `max(0, [Due] - today())` |
| `sum(a, b, …)` | Adds numbers. Lists are included item by item; empty values are skipped. | `sum([Estimate (h)], [Extra])` |
| `avg(a, b, …)` | The average of the numbers. Lists are included item by item; empty values are skipped. | `avg([Q1], [Q2], [Q3])` |
| `pow(number, power)` | A number raised to a power. | `pow(1.05, 3)` |
| `sqrt(number)` | The square root. | `sqrt([Area])` |
| `mod(number, divisor)` | The remainder after dividing (also written `a % b`). | `mod([Order], 2)` |
| `number(value)` | Converts text (or true/false) to a number; empty if it isn't one. Commas and spaces are ignored, so `"1,250"` gives 1250. | `number("42")` |
| `value([Choice field])` | The number a choice stands for (the field's values, set on its **Choices** tab); for multiple choice, the total of the chosen values. Empty when the choice has no value. | `value([Likelihood]) * value([Impact])` |

`sum()` of nothing is 0, while `avg()`, `min()` and `max()` of nothing are empty.

`value()` needs a field written straight in, like `value([Priority])`. Used on a number field, it gives the number.

### Text

| Function | What it gives | Example |
|---|---|---|
| `concat(a, b, …)` | Joins values into one text (also written `a & b`). | `concat([Name], " (", [Status], ")")` |
| `text(value)` | The value as text. | `text([Budget])` |
| `upper(text)` | In capitals. | `upper([Status])` |
| `lower(text)` | In lower case. | `lower([Name])` |
| `trim(text)` | Without spaces at the start and end. | `trim([Code])` |
| `len(text)` | The number of characters (or items, for a list). | `len([Description])` |
| `left(text, count)` | The first characters. | `left([Name], 3)` |
| `right(text, count)` | The last characters. | `right([Code], 4)` |
| `mid(text, start, count)` | Characters from a position (1 is the first). | `mid([Code], 3, 2)` |
| `replace(text, find, with)` | Replaces every occurrence of some text. | `replace([Name], "-", " ")` |
| `contains(text, find)` | True when the text contains the other text (ignoring case). | `contains([Name], "audit")` |
| `startsWith(text, start)` | True when the text starts with the other text (ignoring case). | `startsWith([Code], "PRJ")` |
| `format(value, pattern)` | A number or date as text, using a display format pattern. | `format([Due], "D MMM")` |

As text, lists are joined with ", ", links give the notes' names and dates use your date format.

**`format()` patterns** are the same as a column's display formats:

- **Numbers:** `"number"`, `"integer"`, `"decimal:2"`, `"currency"` (or `"currency:EUR"`), `"compact"`, `"percent"`, or a pattern such as `"#,##0.00"`, `"$#,##0"` or `"#,##0 h"`.
- **Dates:** a pattern such as `"YYYY-MM-DD"`, `"D MMM YYYY"`, `"ddd D MMM"` or `"MMMM YYYY"`, or `"relative"` for "in 3 days", "yesterday" and so on.

### Dates

| Function | What it gives | Example |
|---|---|---|
| `today()` | Today's date. | `[Due] - today()` |
| `now()` | Today's date (dates have no time of day). | `now()` |
| `date(year, month, day)` or `date(text)` | A date from its parts, or from text such as 2026-12-31. | `date(2026, 12, 31)` |
| `year(date)` | The year. | `year([Due])` |
| `month(date)` | The month, 1–12. | `month([Due])` |
| `day(date)` | The day of the month. | `day([Due])` |
| `weekday(date)` | The day of the week: 1 Monday … 7 Sunday. | `weekday([Due]) >= 6` |
| `dateAdd(date, amount, unit)` | A date moved by an amount of time (negative to go back). | `dateAdd([Start], 2, "weeks")` |
| `dateDiff(start, end, unit)` | Whole units from the start date to the end date (negative if the end is earlier). | `dateDiff(today(), [Due], "weeks")` |
| `startOf(date, unit)` | The first day of the date's week (Monday), month or year. | `startOf([Due], "month")` |
| `endOf(date, unit)` | The last day of the date's week (Sunday), month or year. | `endOf(today(), "month")` |

The **unit** is `"days"`, `"weeks"`, `"months"` or `"years"`, for `dateAdd()` and `dateDiff()`, and `"week"`, `"month"` or `"year"` for `startOf()` and `endOf()`. Singular or plural both work.

- Adding months keeps the day of the month where it can, and otherwise uses the month's last day: 31 January plus a month is the end of February.
- `dateDiff()` counts whole units only: from 15 January to 14 March is 1 month.
- `[Due] - today()` gives the same as `dateDiff(today(), [Due], "days")`.

### Lists

| Function | What it gives | Example |
|---|---|---|
| `list(a, b, …)` | A list of the values (lists inside are flattened). | `list("urgent", "design")` |
| `count(list)` | The number of items (1 for a single value, 0 when empty). | `count([Team])` |
| `first(list)` | The first item. | `first([Tags])` |
| `last(list)` | The last item. | `last([Tags])` |
| `join(list, separator?)` | The items as text, separated by ", " or the given separator. | `join([Tags], " · ")` |
| `includes(list, value)` | True when the list has the value (links match by name or path; text ignores case). | `includes([Tags], "urgent")` |
| `unique(list)` | The list without repeats. | `unique(map([Team], prop(item, "Team")))` |
| `sort(list)` | The list in order (numbers, dates or text, naturally). | `sort([Tags])` |
| `map(list, expression)` | Each item transformed by the expression, where `item` is the current item. | `map([Team], name(item))` |
| `filter(list, condition)` | The items for which the condition is true, where `item` is the current item. | `filter([Tasks], prop(item, "Status") != "done")` |

`list()`, `count()` and `join()` leave out empty values.

#### map() and filter()

`map()` and `filter()` go through a list one item at a time. In their second argument, `item` is the current item:

```
map([Team], name(item))
filter([Tasks], prop(item, "Status") != "done")
count(filter([Tasks], prop(item, "Due") < today()))
sum(map([Tasks], prop(item, "Estimate")))
join(map(filter([Team], prop(item, "Role") = "Dev"), name(item)), ", ")
```

`item` only works inside `map()` and `filter()`. Anywhere else it's an error: "item can only be used inside map() or filter()." Inside a `map()` within a `map()`, `item` is the inner list's item.

### Links

| Function | What it gives | Example |
|---|---|---|
| `name(link)` | The linked note's name (a list of names for several links). | `name([Owner])` |
| `prop(link, "Field")` | A field of the linked note, by its label or key (a list for several links). | `prop([Project], "Due")` |
| `notes("type")` | Links to every note of a type (its key or name), of a group (`"@group"`), or every entity (`notes()`). Use with `filter`, `count`, `sum` and `prop`. | `count(filter(notes("quest"), prop(item, "Status") = "active"))` |

#### prop()

`prop()` reads a field of a linked note: `prop([Project], "Due")` is the due date of the project the task links to.

- The field is found by key or label, ignoring case. Built-ins work too: `prop([Project], "Status")`.
- Calculated fields work: `prop([Project], "Open tasks")`.
- With several links, it gives a list, one value per note: `prop([Team], "Role")`.
- A link to a note that doesn't exist gives an empty value.
- A field the linked note's type doesn't have is an error: "Project has no field “Dew”."

#### notes()

`notes()` gives links to notes anywhere in your vault, not only linked ones:

| Write | Gives |
|---|---|
| `notes("task")` | Every task. The type's key, name or plural works, in any case. |
| `notes("@work")` | Every entity in the Work group, by the group's key or name. |
| `notes()` | Every entity. |

The notes come sorted by name. Combine them with `filter()`, `count()`, `map()` and `prop()`:

```
count(filter(notes("task"), prop(item, "Status") != "done" and prop(item, "Due") < today()))
```

A type or group that doesn't exist is an error: "There's no type called "tsak"."

### Workflows

These two only work in workflow formulas. Elsewhere they're an error: "old() only works in workflows."

| Function | What it gives | Example |
|---|---|---|
| `old([Field])` | The field's value before the change that started the workflow (the current value for other triggers). | `old([Status]) = "blocked"` |
| `new([Field])` | The field's value after the change (the same as `[Field]`). | `new([Estimate]) - old([Estimate])` |

Like `value()`, they need a field written straight in: `old([Status])`.

## Formulas in workflows

Workflow steps use formulas for values, tests, lists and text. See [Steps](/reference/steps) for each step.

| Step | The formula |
|---|---|
| **Set a field** and **Create a note**'s fields | The new value, converted to the field's kind, e.g. `today()`, `"High"`, `[Estimate] * 2`. |
| **Add or remove a link** | A note to link: a link, or a note's name. |
| **Set a variable** | The variable's value, e.g. `0`, then `[Total] + [Estimate]`. |
| **For each** | The list to go through, e.g. `filter([Team], prop(item, "Role") = "Dev")` or `[Labels]`. |
| **If** (with **A formula**) | The test, e.g. `[Estimate] > 5`. True as described in [True and false](#true-and-false). |

Each value box has **[ ]**, to put in a field or name, and **ƒx**, to open the formula editor. **↺** goes back to a picked value.

### Text with {formula} parts

Notices, questions, note names, folders and text added to notes can hold formulas in curly brackets. Each part is worked out and put in as text:

```
{[Name]} is done
Archive/{year(today())}
- {format(today(), "D MMM")}: {[Summary]}
Review of {count([Selected notes])} tasks
```

::: v-pre

Write `{{` and `}}` for a curly bracket of your own. Quotes inside a part can hold curly brackets: `{join([Tags], "}")}` works. In a text box, **ƒx** opens the editor on the part the cursor is in, or adds a new one.

:::

### Names in workflow formulas

Besides the note's fields, workflow formulas can use names from the run. **[ ]** lists the ones available at each step.

| Name | What it is |
|---|---|
| `[This note]` | The note the workflow runs on, as a link: `prop([This note], "Due")`. |
| `[Selected notes]` | A button run once for the whole selection: the selected notes. |
| A loop's **Call each** name | The current item of **For linked notes** or **For each**, e.g. `[Task]` or `[Item]`. |
| A created note's **Call it** name | A note a **Create a note** step made, e.g. `[New meeting]`. |
| A found note's name | A note a **Find notes** step found. |
| The form's answers | A form workflow's answers, by their labels, e.g. `[Date]`. |
| Variables | Values from **Set a variable**, e.g. `[Total]`. Empty until a step sets them. |

Inside **For linked notes**, plain field names read each linked note: `[Estimate] + 1` is that task's estimate. `[This note]` is still the note the workflow runs on.

A form's answers come before the note's fields, so an answer called `Name` wins over the note's name. Other names come after the fields, so give variables and loop names labels that no field has.

## Formulas in dashboards

Dashboard formulas have no note behind them, so they can't read a note's fields. They can use `notes()`, `prop()`, dates, the dashboard's filters and (on cards) other cards.

**A card's value from other cards:** refer to the cards by title (or, without a title, by id):

```
[Completed quests] / [All quests] * 100
```

A card's **Format** then displays the result, e.g. `percent`. Cards that refer to each other in a loop show "Circular reference: …".

**Notes from a formula** (for a card, chart or list): the formula must give notes:

```
filter(notes("quest"), prop(item, "Status") = "active")
```

Anything else is a problem: "The formula should give notes, e.g. …".

**Dashboard filters** are named by title, e.g. `[Campaign]`. A filter gives what's picked, or an empty value when nothing is:

| Filter | Value in a formula |
|---|---|
| **Note** | The note as a link, or a list of links when several are picked. |
| **Choice** | The choice as text, or a list. |
| **Search** | The text typed. |
| **Dates** | A list of two dates: from and to. |
| **Number** | A list of two numbers: the lowest and the highest. |
| **Yes / no** | True or false. |

If a card and a filter have the same title, the name means the card.

## Result types

The editor works out what type a formula gives, and the status line shows it: **Result: Number**. The type decides how the field or column sorts, filters, groups and formats, so a number result sorts as a number and can have a number format.

Fields and view columns can set the **Result type** by hand: **Automatic**, **Number**, **Text**, **True/false**, **Date**, **List** or **Links**. With a type chosen, results are converted where it makes sense: text such as "2027-01-05" becomes a date, and "42" a number. A result that can't be converted is a problem for that note: "The result isn't a number: abc."

When the type can't be worked out (say, `first()` of a list of mixed values), the result is shown as text unless you choose a type.

How results show:

- **Numbers** show up to four decimal places, unless you give them a display format.
- **True/false** shows "Yes", or nothing for false.
- **Lists** and **links** show like a list or relation field.

## Errors

There are two kinds of problem.

**Problems with the formula** stop it working at all. The editor underlines them and won't save. If one appears later (say, a field it uses is deleted), a view column's header is greyed out and its cells show "—", and a formula field shows "—"; hover over it for the reason.

| Message | Meaning |
|---|---|
| Unknown column [Dew]. | No field, column or name has that label or key. |
| Unknown function dateadd2(). | There's no function by that name. |
| Unknown name “Due”. Column references go in brackets, e.g. [Due]. | Field names need square brackets. |
| today is a function: write today(…). | Functions need brackets, even with no arguments. |
| round() needs 1–2 arguments: round(number, places?). | Too many or too few arguments. |
| This text is missing its closing quote. | A `"` has no partner. |
| This column reference is missing its closing ]. | A `[` has no partner. |
| Unexpected “…”: is an operator or comma missing? | Two values side by side, e.g. `[A] [B]`. |
| The formula ends too early. | Something's missing at the end, e.g. `[A] +`. |
| item can only be used inside map() or filter(). | See [map() and filter()](#map-and-filter). |
| value() needs a column, e.g. value([Priority]). | `value()`, `old()` and `new()` take a field written straight in. |
| old() only works in workflows. | `old()` and `new()` are for workflow formulas. |
| Circular reference: A → B → A. | Formulas that refer to each other in a loop. |
| [Days left] has a problem: … | A formula this one uses has a problem of its own. |

**Problems for one note** happen while working the formula out, because of that note's values. That note's cell shows a faint "–" with the reason when you hover over it, sorts last and counts as empty. Other notes are fine.

| Message | Meaning |
|---|---|
| Division by zero. | Dividing by 0, or `mod(x, 0)`. Guard it with `if()`. |
| Use & to join text, e.g. [Name] & " " & [Status]. | `+` was used on text. |
| Can't add two dates; subtract them to get days, or add a number of days. | `[Start] + [Due]`. |
| Can't subtract a date from a number. | `30 - [Due]`. |
| Can't compare a date with a number. | A comparison between values that don't go together. |
| Expected a number, got text. | A number was needed, e.g. for `round()`. |
| Expected a date, got a number. | A date was needed, e.g. for `year()`. |
| The unit should be "days", "weeks", "months", "years". | A date function's unit is misspelt. |
| Square root of a negative number. | `sqrt()` of a number below 0. |
| prop() needs a link, got text. | `prop()` was given something that isn't a link. |
| Task has no field “Dew”. | `prop()` asked for a field the linked note doesn't have. |
| There's no type called "tsak". | `notes()` was given a type or group that doesn't exist. |

## More examples

```
[Due] - today()
round([Spent] / [Budget] * 100)
if([Due] < today() and [Status] != "done", "⚠ Overdue", "")
ifs(value([Likelihood]) * value([Impact]) >= 15, "High", value([Likelihood]) * value([Impact]) >= 8, "Medium", "Low")
dateDiff([Start], [Due], "weeks")
format(dateAdd([Start], 1, "months"), "D MMM YYYY")
[Code] & "-" & text([Number])
join(map([Team], name(item)), ", ")
count(filter([Tasks], prop(item, "Status") != "done"))
coalesce(prop([Project], "Due"), [Due])
```
