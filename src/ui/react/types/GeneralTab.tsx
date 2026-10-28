import { Notice } from "obsidian";
import { effectiveFolderPattern, expandFolderPattern } from "../../../model/paths";
import { STARTER_PACK } from "../../../model/packs";
import { defaultTemplate } from "../../../model/templates";
import { finaliseType, newUid } from "../../../model/typeEditing";
import { cloneType, statusesFor, toKey, type FolderMode } from "../../../model/types";
import { usePlugin } from "../context";
import { Icon } from "../Icon";
import { ChipsInput, ColorPicker, IconPicker, Row, Section, Segmented, TextInput } from "./controls";
import { useEditor } from "./editor";

const FOLDER_MODES: { value: FolderMode; label: string; icon: string }[] = [
	{ value: "type", label: "In the folder", icon: "folder" },
	{ value: "own", label: "Own folder each", icon: "folder-tree" },
	{ value: "parent", label: "Inside its parent", icon: "folder-input" },
];

export function GeneralTab({ onDuplicate, onExport, onDelete }: { onDuplicate: () => void; onExport: () => void; onDelete: () => void }) {
	const plugin = usePlugin();
	const s = plugin.settings;
	const { draft, update, issuesAt, noteCount, groups, openGroup } = useEditor();
	const t = draft.type;
	const isNew = !draft.original;
	const fin = finaliseType(t);
	const group = groups.find((g) => g.key === t.group);
	const starter = t.pack === STARTER_PACK.id ? STARTER_PACK.types.find((x) => x.key === t.key) : undefined;
	const hasException = typeof t.folderPattern === "string";
	const base = plugin.factory.matchExistingCase(expandFolderPattern(effectiveFolderPattern(s.folderPattern, fin), fin, group));
	const mode = t.folderMode ?? "type";
	const parentField = t.fields.find((f) => f.key === t.parentFields?.[0]);
	const folderPreview =
		mode === "own" ? (
			<>
				New notes go in <code>{base ? `${base}/` : ""}&lt;name&gt;/</code>
				{t.parentFields?.length ? ", or inside their parent's folder" : ""}
			</>
		) : mode === "parent" ? (
			<>
				New notes go in <code>&lt;parent's folder&gt;/{fin.plural}/</code>
				{parentField ? ` (parent: ${parentField.label})` : " (set a parent field on the Display tab)"}, or <code>{base || "(vault root)"}/</code> without a parent
			</>
		) : (
			<>
				New notes go in <code>{base || "(vault root)"}/</code>
			</>
		);
	const groupStatuses = group?.statuses ?? statusesFor({ ...t, statuses: undefined }, groups);

	const openTemplate = async () => {
		if (isNew) {
			new Notice("Save the type first.");
			return;
		}
		const saved = plugin.getType(t.key) ?? fin;
		const path = plugin.factory.templatePath(saved);
		if (!plugin.app.vault.getAbstractFileByPath(path)) {
			await plugin.factory.ensureFolder(path.split("/").slice(0, -1).join("/"));
			await plugin.app.vault.create(path, defaultTemplate(saved));
			new Notice(`Created ${path}`);
		}
		await plugin.app.workspace.openLinkText(path, "", "tab");
	};

	return (
		<div className="oe-tm-general">
			<Section title="Identity">
				<Row label="Name" issues={issuesAt("name")}>
					<TextInput
						label="Name"
						value={t.name}
						placeholder="e.g. Ship"
						invalid={issuesAt("name").length > 0}
						autoFocus={isNew && !t.name}
						onChange={(v) =>
							update((x) => {
								// New types: the key follows the name until it's edited by hand.
								if (isNew && (!x.key || x.key === toKey(x.name))) x.key = toKey(v);
								x.name = v;
							})
						}
					/>
				</Row>
				<Row label="Plural">
					<TextInput label="Plural name" value={t.plural} placeholder={`${t.name || "Ship"}s`} onChange={(v) => update((x) => (x.plural = v))} />
				</Row>
				<Row
					label="Key"
					desc={
						isNew ? (
							<>
								Written as <code>entity: {t.key || "…"}</code> in each note. Can't be changed once saved.
							</>
						) : (
							<>
								Written as <code>entity: {t.key}</code> in each note. To rename the type, change its name and plural; the key stays.
							</>
						)
					}
					issues={issuesAt("key")}
				>
					<TextInput label="Key" className="oe-tm-mono" value={t.key} disabled={!isNew} invalid={issuesAt("key").length > 0} onChange={(v) => update((x) => (x.key = v.trim()))} />
				</Row>
				<Row label="Icon">
					<IconPicker value={t.icon} color={t.color} onChange={(v) => update((x) => (x.icon = v))} />
				</Row>
				<Row label="Colour" stacked>
					<ColorPicker value={t.color} onChange={(v) => update((x) => (x.color = v))} />
				</Row>
				<Row label="Group" desc="Groups organise types in lists and the browser, and set the default statuses." issues={issuesAt("group")}>
					<div className="oe-tm-inline">
						<select className="dropdown" aria-label="Group" value={t.group} onChange={(e) => update((x) => (x.group = e.target.value))}>
							{!group && <option value={t.group}>{t.group ? `Unknown group (${t.group})` : "Choose a group"}</option>}
							{groups.map((g) => (
								<option key={g.key} value={g.key}>
									{g.name}
								</option>
							))}
						</select>
						{group && (
							<button className="clickable-icon" aria-label={`Edit the ${group.name} group`} onClick={() => openGroup(group.key)}>
								<Icon name="pencil" />
							</button>
						)}
					</div>
				</Row>
				<Row label="Statuses" desc={t.statuses ? "This type's own statuses. The first is the starting status." : <>Uses the group's statuses: {groupStatuses.join(", ")}.</>} issues={issuesAt("statuses")} stacked={!!t.statuses}>
					<div className="oe-tm-stack">
						<Segmented
							label="Statuses"
							value={t.statuses ? "own" : "group"}
							options={[
								{ value: "group", label: "Group's" },
								{ value: "own", label: "Custom" },
							]}
							onChange={(v) => update((x) => (v === "own" ? (x.statuses = [...groupStatuses]) : delete x.statuses))}
						/>
						{t.statuses && <ChipsInput label="Statuses" placeholder="e.g. open, closed" values={t.statuses} invalid={issuesAt("statuses").length > 0} onChange={(v) => update((x) => (x.statuses = v))} />}
					</div>
				</Row>
			</Section>

			<Section title="Notes">
				<Row label="Folder" desc={hasException ? <>An exception to the entity folder pattern (<code>{s.folderPattern || "(vault root)"}</code>). Use <code>{"{group}"}</code> and <code>{"{entity}"}</code>.</> : <>Follows the entity folder pattern in settings: <code>{s.folderPattern || "(vault root)"}</code></>} issues={issuesAt("folderPattern")} stacked={hasException}>
					<div className="oe-tm-stack">
						<Segmented
							label="Folder"
							value={hasException ? "own" : "pattern"}
							options={[
								{ value: "pattern", label: "Entity folder pattern" },
								{ value: "own", label: "Own pattern" },
							]}
							onChange={(v) => update((x) => (v === "own" ? (x.folderPattern = s.folderPattern) : delete x.folderPattern))}
						/>
						{hasException && <TextInput label="Folder pattern" className="oe-tm-mono" value={t.folderPattern ?? ""} placeholder="(vault root)" invalid={issuesAt("folderPattern").length > 0} onChange={(v) => update((x) => (x.folderPattern = v))} />}
					</div>
				</Row>
				<Row label="Folder rule" desc={folderPreview} stacked>
					<Segmented label="Folder rule" value={mode} options={FOLDER_MODES} onChange={(v) => update((x) => (v === "type" ? delete x.folderMode : (x.folderMode = v)))} />
				</Row>
				<Row label="Template" desc={<>In your templates folder (<code>{s.templatesFolder}</code>). A built-in template is used until the file exists.</>}>
					<div className="oe-tm-inline">
						<TextInput label="Template file" value={t.template} placeholder={fin.template} onChange={(v) => update((x) => (x.template = v))} />
						<button onClick={() => void openTemplate()} disabled={isNew} title={isNew ? "Save the type first" : undefined}>
							<Icon name="file-pen-line" /> Open template
						</button>
					</div>
				</Row>
				<Row label="Search shortcuts" desc="Type one of these before a name in Find entity, e.g. “p ada”.">
					<ChipsInput label="Search shortcuts" placeholder="e.g. p" values={t.shortcuts ?? []} onChange={(v) => update((x) => (x.shortcuts = v))} />
				</Row>
			</Section>

			<Section title="More">
				<div className="oe-tm-actions">
					<button onClick={onDuplicate} disabled={isNew}>
						<Icon name="copy" /> Duplicate
					</button>
					<button onClick={onExport}>
						<Icon name="clipboard-copy" /> Copy as JSON
					</button>
					{starter && (
						<button
							onClick={() =>
								update((x, meta) => {
									const fresh = { ...cloneType(starter), pack: STARTER_PACK.id };
									for (const k of Object.keys(x)) delete (x as unknown as Record<string, unknown>)[k];
									Object.assign(x, fresh);
									meta.splice(0, meta.length, ...fresh.fields.map((f) => ({ uid: newUid(), origKey: draft.original?.fields.some((o) => o.key === f.key) ? f.key : null })));
								})
							}
						>
							<Icon name="rotate-ccw" /> Reset to starter
						</button>
					)}
					{!isNew && (
						<button className="mod-warning" onClick={onDelete}>
							<Icon name="trash-2" /> Delete type
						</button>
					)}
				</div>
				<div className="oe-tm-muted">
					{starter ? "From the starter pack." : t.pack ? `From the “${t.pack}” pack.` : isNew ? "New type, not saved yet." : "Custom type."} {noteCount} note{noteCount === 1 ? " uses" : "s use"} it.
					{starter ? " Reset brings back the starter definition; save to apply it." : ""}
				</div>
			</Section>
		</div>
	);
}
