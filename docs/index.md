---
layout: home

hero:
  name: Obsidian Entities
  text: Your own kinds of notes, linked, counted and automated
  tagline: Define people, projects, tasks, books or anything else, with typed fields and relationships. Browse them, build views and dashboards over them, and let workflows do the busywork. Everything stays ordinary Markdown.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/
    - theme: alt
      text: What is it?
      link: /guide/introduction
    - theme: alt
      text: Reference
      link: /reference/notes 
---

<div class="home-sections">

<section>

## 🧩 Types you design

Decide what kinds of notes your vault holds — people, projects, tasks, books, characters — and what each one records. Types are built in a visual editor, so there's no YAML to write.

- **Every kind of field:** text, numbers, dates, coloured choices, lists, checkboxes, web addresses and links to other notes.
- **Forms you lay out:** drag fields into frames, columns and tabs, and show some only when they apply, like *Risk details* when Likelihood is High.
- **Validation:** required fields, ranges, patterns, unique values and dates that must come after other dates. Problems are flagged, never lost.
- **Smart defaults:** a due date a week out, a client copied from the linked project, or numbers that count up, like `TASK-0042`.

[Tutorial: your first types](/getting-started/first-types) · [Reference: fields](/reference/fields)

</section>

<section>

## 🔗 Real relationships

Link a task to a person, and the person knows about it. Links are ordinary wikilinks in the frontmatter, so backlinks, the graph and renaming notes keep working.

- **Set once, seen from both ends:** give a task an *Assignee*, and the person's note lists it under *Tasks*. The two ends can never disagree.
- **Links with rules:** an Assignee is one Person; an Owner can be a Person or a Team; *See also* can be anything. Pickers only offer notes that fit.
- **Two-way and labelled links:** allies read the same from either side, and each of a deal's contacts can carry a label, like *economic buyer*.
- **The Connections panel** shows everything the open note links to, and everything that links to it.

[Tutorial: linking notes](/getting-started/linking-notes) · [Reference: relationships](/reference/relationships)

</section>

<section>

## 🧮 Roll-ups and formulas

Fields that work themselves out whenever they're shown. They're never stored, so they're never out of date.

- **Roll-ups** summarise linked notes: count a person's open tasks, total a project's budget lines, find the latest due date or show % done.
- **Formulas** calculate like a spreadsheet: `dateDiff(today(), [Due], "days")`, `[Budget] - [Spent]`, `if([Status] = "done", "✓", "")`.
- **An editor that helps:** type `[` to pick a field, hover for help, see errors as you type and preview results on your own notes.
- **They build on each other,** and work in fields, view columns, dashboard cards and workflows alike.

[Tutorial: roll-ups and formulas](/getting-started/calculated-fields) · [Reference: formulas](/reference/formulas)

</section>

<section>

## 📋 Tables, boards and calendars

Saved views over any of your types. Each view is a note, so it syncs with your vault, opens in a tab and can sit inside another note — a project's tasks, in the project.

- **Tables:** edit in place, change many notes at once, add roll-up and formula columns, and group with totals.
- **Highlights:** rules that colour rows and cells, data bars and colour scales. Overdue in red, budgets as bars.
- **Boards:** drag cards between statuses, choices or people, with swimlanes, card limits and bucket summaries.
- **Calendars:** month, week and agenda layouts, notes that span from start to end, and drag to reschedule.

[Tutorial: views](/getting-started/views) · [Reference: tables](/reference/tables)

</section>

<section>

## 📊 Dashboards

Cards, charts, lists, buttons, text and whole views on a grid you arrange by dragging. Like views, dashboards are notes, and can be embedded in other notes.

- **Summary cards:** counts, totals, averages, % done or formulas over other cards, with styling that changes with the value.
- **Charts:** bar, stacked bar, donut, line over time and progress, in your statuses' and choices' own colours.
- **Click through:** click a card, a bar or a slice to see the notes behind it.
- **Filters:** pick a project or a person and every component follows. Embedded in a project note, the dashboard starts on that project.

[Tutorial: a dashboard](/getting-started/dashboards) · [Reference: dashboards](/reference/dashboards)

</section>

<section>

## ⚡ Workflows

Automation without code: choose what starts it, which notes it applies to, and the steps it takes.

- **Triggers:** a note being created, a field changing, a button, a form, a schedule, or a date coming round.
- **Steps:** set fields, add tags and links, create linked notes, add text, move or rename notes, loop over linked notes, ask a question or run another workflow.
- **Safe to try:** a test run shows what a workflow would change before anything is saved, and big runs ask first.
- **Run log and undo:** every run is recorded, and one click puts things back.

[Tutorial: a workflow](/getting-started/workflows) · [Reference: workflows](/reference/workflows)

</section>

</div>

<style>
.home-sections {
	display: grid;
	gap: 0 64px;
}
@media (min-width: 960px) {
	.home-sections {
		grid-template-columns: 1fr 1fr;
	}
}
.home-sections section > :last-child {
	margin-bottom: 0;
}
</style>

