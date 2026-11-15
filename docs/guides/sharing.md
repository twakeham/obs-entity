# Share your setup

Copy types as a pack, export your whole configuration as an app, and import them in another vault.

Everything you built in Getting started (types, views, dashboards, workflows) can travel to another vault: yours, or a colleague's. You choose how much goes. None of the ways described here ever copies your notes.

For the exact rules, see [Packs and apps](/reference/packs).

## Choose how to share

| You want to… | Use | Where |
|---|---|---|
| Give someone one type | **Copy as JSON** | The type editor's **General** tab, under **More** |
| Share a group of types with their views and workflows | **Copy group as a pack** | The group editor, under **More** |
| Copy every type into another vault, beside what's there | **Copy all types as a pack** | Right-click the **Entities** heading on the Entity Browser's **Types** tab |
| Set up another vault exactly like this one, or publish a ready-made setup | **Export as an app…** | The same menu, or **Settings → Obsidian Entities → Apps** |

The three copy buttons put a **pack** on the clipboard, as JSON. An **app** is a file holding your whole configuration, with a name and version.

## Copy a group as a pack

Say a colleague wants your task tracker. Everything in it lives in the **Work** group, so copy that.

1. On the Entity Browser's **Types** tab, click the **Work** group. The group editor opens.
2. Under **More**, click **Copy group as a pack**.
3. A notice says what it copied, such as *Copied the Work group (3 types, 1 workflow and 2 views) as a pack.*

<!-- SHOT file="guides/sharing-copy-group.png" vault="Entities Tutorial" alt="The group editor for Work, with Copy group as a pack under More" how="On the Entity Browser's Types tab, click the Work group so the group editor opens in the Entity types view. Scroll down so the Statuses list and the More section (Copy group as a pack and Delete group buttons) are both visible. Don't click either button. Crop to the editor panel." -->

The pack holds:

- **Person**, **Task** and **Meeting**, and the **Work** group with its statuses;
- **Date completed tasks**, because it applies only to tasks;
- **All tasks** and the **Team dashboard**, because they only show the group's types;
- the types' template files, if you've made any.

Views or workflows that cover types outside the group (or every type) are left out, so the pack doesn't depend on anything your colleague doesn't have. A workflow that a copied one runs with **Run another workflow** comes along too, whatever it applies to.

**Copy group as a pack** is greyed out until the group has saved types.

::: warning Links out of the group
If a type in the group links to a type in another group, that type isn't copied. When the pack is imported, the link field shows a problem until the other type exists or you change the field. Keep linked types in one group, or use **Copy all types as a pack**.
:::

### One type, or everything

- **Copy as JSON** copies one type as it is in the editor (unsaved changes included), its group, its template, and the workflows that apply only to it. It never includes views.
- **Copy all types as a pack** copies every type, group, workflow, view note, dashboard and template. The pack is named after your vault.

### Save it as a file

The copy buttons only fill the clipboard. To send a pack by email or keep it for later, paste it into a plain text file and save it with a `.json` ending, such as *Work tracker.json*. **Import pack…** can read the file directly.

## Import a pack

In the other vault:

1. On the Entity Browser's **Types** tab, right-click the **Entities** heading and choose **Import pack…**.
2. In **Import a pack**, paste the JSON, or choose the `.json` file. Click **Import**.
3. A notice says what was imported. Groups, view notes, dashboards and templates are added straight away.
4. Each type opens as a **draft** in the Entity types view, marked **new** in the Entity Browser. Look each one over and click **Save**. Discard a draft and that type isn't added.
5. The pack's workflows open as drafts in the Workflows view, switched off. Save each one, then switch it **On** when you're happy with it.

<!-- SHOT file="guides/sharing-import-pack.png" vault="Entities Tutorial" alt="The Import a pack dialog, with a pack pasted in" how="In the Entities Tutorial vault, open the Work group's editor and click Copy group as a pack. Then right-click the Entities heading on the Entity Browser's Types tab, choose Import pack…, and paste (Ctrl+V) into the box so the start of the JSON shows. Do NOT click Import; cancel afterwards. Crop to the dialog." -->

If the other vault already has types with the same keys, the pack's get numbered keys (`task_2`), and everything in the pack follows them. A pack you copy doesn't list any **shared** types, so even a Person becomes `person_2` if the vault already has one. See [Keys already taken](/reference/packs#keys-already-taken).

::: tip Where did the Work group go?
A group's key never changes, even when you rename it. The tracker's group was renamed from **Entities** to **Work**, but its key is still `entities`. A vault that started empty has an **Entities** group with that key, so the pack's types go into it instead of adding **Work**. Rename that group to `Work` and you're done.
:::

If you discard a type's draft, delete any view notes the pack wrote for it: they won't show anything.

### Import entity types… instead

The **Import entity types…** command (also **Import types…** in **Settings → Obsidian Entities → Entity types**) skips the drafts: paste the JSON and click **Import**, and types, groups and workflows are saved straight away, with workflows switched off. If any type has a problem, such as a link to a type that doesn't exist, nothing is imported and the first few problems are listed. **Load example: Basic CRM** fills the box with a small pack to try.

## What travels with a pack

| | Copy as JSON | Copy group as a pack | Copy all types as a pack | App |
|---|---|---|---|---|
| Types and their groups | One type | The group's saved types | All | All, and empty groups too |
| Workflows | Those that apply only to it | Those that apply only to the group's types | All | All, with their on/off state |
| View notes and dashboards | – | Those that only show the group's types | All | All |
| Templates | Its template | The group's types' | All | All |
| Saved layout components (**My components**) | – | – | – | All |
| Notes and plugin settings (folders, formats) | – | – | – | – |

A few things to know:

- **Workflows arrive switched off** from any pack, whatever they were when copied. Only an app can keep them on.
- **Only the view travels**, not the note around it. If you wrote text above or below the view in a view note, it isn't copied.
- **Templates are copied as text.** A view embedded in a template names types by key, so if a type's key changes on import, check the template.
- **Picked notes don't travel.** A workflow step that links to a particular note you picked still names that note, which may not exist in the other vault.

## Export your setup as an app

An app is your whole configuration in one file, for setting up another vault the same way or for sharing a finished setup.

1. Right-click the **Entities** heading on the **Types** tab and choose **Export as an app…** (or use **Settings → Obsidian Entities → Apps**).
2. The window says what it includes. Fill in the details:
   - **Name**, such as `Work tracker` (required);
   - **Version**, `1.0` to start with. It's part of the file name, so change it each time you export changes;
   - **Author** and **Description**, both optional.
3. Click **Save…** and choose where to save the file. It's named from the name and version: *Work tracker 1.0.json*.

The details are remembered, so next time you only need to bump the version.

<!-- SHOT file="guides/sharing-export-app.png" vault="Entities Tutorial" alt="The Export as an app window, filled in" how="Right-click the Entities heading on the Entity Browser's Types tab and choose Export as an app…. Wait for the 'Includes …' summary line to fill in. Set Name to Work tracker, Version 1.0, Author Tim, and Description 'People, tasks and meetings, with a team dashboard.'. Don't click Save…. Crop to the modal." -->

## Import an app

1. In the other vault, right-click the **Entities** heading and choose **Import app…**, then **Choose a file…**.
2. The window shows the app's name, version, author, description and what it holds. (A plain pack works here too.)
3. Under **How to import**, choose one:

| Option | Use it when | What happens |
|---|---|---|
| **Replace the current configuration** | The vault should match the app: a new vault, or updating to a newer version of the same app. | The app's groups, types and workflows take the place of yours, keys and all. View notes and templates with the same names are overwritten (a copy of each changed one goes to the trash first). |
| **Add alongside the current configuration** | You want the app's types as well as your own. | Like installing a pack: taken keys get a number, and view notes and templates are numbered when their names are taken. |

4. If any of the app's workflows were on when it was exported, **Switch on its workflows** appears. Leave it off to check them first, or turn it on to keep each one as it was.
5. Click **Replace configuration** or **Add to configuration**.

<!-- SHOT file="guides/sharing-import-app.png" vault="Entities Tutorial" alt="The Import an app window, showing the app's details and the How to import options" how="First export an app from the Entities Tutorial vault (Export as an app…, Name Work tracker, Version 1.0, Description 'People, tasks and meetings, with a team dashboard.', Save… to a folder outside the vault). Turn on the Date completed tasks workflow before exporting so the Switch on its workflows toggle appears. Then choose Import app…, click Choose a file… and pick that file. Leave How to import on Replace the current configuration so its warnings show. Do NOT click Replace configuration; cancel afterwards. Crop to the modal." -->

Before you replace, read the warnings. The window says how many of your notes use types the app doesn't have (they're left alone, but aren't entities until a type with their key exists) and how many unsaved changes in the Entity types and Workflows views will be lost.

::: tip Keep two vaults in step
Because **Replace** keeps keys as they are, notes in the other vault carry on working after an update. Export a new version whenever you change your setup, and import it with **Replace** on the other side.
:::

## See also

- [Packs and apps](/reference/packs): the full rules, the pack format and import errors
- [Start from a pack](/guides/packs): the ready-made packs in the gallery
- [Types and groups](/reference/types): keys, and Copy as JSON
- [Workflows](/reference/workflows): reviewing and switching on imported workflows
