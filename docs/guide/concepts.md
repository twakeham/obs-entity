# Concepts

A short tour of the ideas the rest of the documentation relies on.

## Entities are notes

An **entity** is a Markdown note whose frontmatter names its type:

```yaml
---
entity: task
status: doing
due: 2026-11-20
priority: High
assignee: "[[Grace Hopper]]"
related: []
tags: []
---
## Overview
```

- `entity` is the type's **key**. Change it and the note becomes another type.
- `status`, `tags`, `aliases`, `related` and `order` are on every entity.
- Everything else comes from the type's fields. Links are ordinary wikilinks, so backlinks, the graph view and renaming notes keep working.

You rarely edit this YAML yourself: the [properties form](/reference/properties-form) does it for you, and checks every value as it goes in.

## Types and groups

A **type** describes one kind of entity: its name, icon, colour, fields, statuses, where its notes are filed, the template new notes start from, and how its form is laid out.

Types belong to **groups** (Work, Directory, RAID…). A group gives its types a heading in the Entity Browser, a place in the folder path and a shared list of statuses, which a type can replace with its own.

## Fields

Fields come in three families:

- **Stored fields** hold a value in the note: text, long text, number, date, choice, multiple choice, list, checkbox and URL.
- **Relations** hold links to other entities. Each one can have an **inverse** name, so the other note shows the link too.
- **Calculated fields** are worked out whenever they're shown and never stored:
  - a **roll-up** summarises linked notes (count a person's open tasks, total a project's spend);
  - a **formula** calculates from the note's own fields (days until the due date, a risk score).

Fields can also have descriptions, defaults, display formats and validation rules.

## Statuses

Every entity has a **status** from its type's (or group's) list. Statuses can be coloured, and their order matters: the **last** status counts as done when the plugin works out progress (a project's "% done", a dashboard's progress bar). So put your finished state last, and states like *cancelled* before it.

## Views and dashboards

A **view** is a saved table, board or calendar over some types, with its own columns, filters, sorting, grouping and highlights. A **dashboard** is a page of components — cards, charts, lists, buttons, filters and embedded views.

Both are stored as notes (in `Entities/Views/` unless you change it), holding a small code block that describes them. That means they sync with your vault, open in tabs, and can be **embedded in other notes**: put a view of a project's tasks inside the project note itself.

## Workflows

A **workflow** watches for something — a note being created, a field changing, a button being pressed, a form being filled in, a time or a date — and then runs **steps**: set a field, add a tag, create a note, append text, ask a question, loop over linked notes, and more.

Workflows record every run, and you can undo one. Workflows that come with a pack start switched off, so you can look them over first.

## Packs and apps

A **pack** is a set of types — with their views, dashboards, templates and workflows — as JSON. The gallery's packs are how you start quickly, and you can copy any of your own types or groups as a pack to share.

An **app** is your whole configuration, exported for another vault.
