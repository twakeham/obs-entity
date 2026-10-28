import { Menu, Modal, Notice, Setting, type App } from "obsidian";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { STARTER_PACK } from "../../../model/packs";
import {
	duplicateType,
	exportPack,
	fieldChanges,
	finaliseType,
	groupIssues,
	hasValue,
	importAsDrafts,
	isDirty,
	isGroupDirty,
	makeDraft,
	makeGroupDraft,
	migrateFrontmatter,
	notesWithValue,
	sampleValues,
	statusRenames,
	targetName,
	uniqueKey,
	type FieldMeta,
	type GroupDraft,
	type SampleNote,
	type TypeDraft,
} from "../../../model/typeEditing";
import { cloneGroup, COMMON_KEYS, DEFAULT_STATUSES, statusesFor, toKey, type EntityTypeDef, type GroupDef } from "../../../model/types";
import { typeIssues, type TypeIssue } from "../../../model/validation";
import type { EntityRecord } from "../../../services/entityIndex";
import { usePlugin, useRelationsVersion } from "../context";
import { Icon } from "../Icon";
import { DisplayTab } from "./DisplayTab";
import { IconPicker, PALETTE, Row, Section, TextInput } from "./controls";
import { EditorContext, type EditorApi, type EditorTab } from "./editor";
import { FieldsTab } from "./FieldsTab";
import { GeneralTab } from "./GeneralTab";
import { PreviewPanel, type PreviewMode } from "./Preview";
import { AddRelationshipDialog, RelationshipsTab } from "./RelationshipsTab";

export interface TypesState {
	/** a saved type's key, "new:<n>" for an unsaved type, "group:<key>" / "group:new:<n>" for groups */
	selected: string | null;
	tab: EditorTab;
	previewOpen: boolean;
	previewMode: PreviewMode;
}

export const DEFAULT_TYPES_STATE: TypesState = { selected: null, tab: "general", previewOpen: true, previewMode: "dialog" };

const TABS: { id: EditorTab; label: string; icon: string }[] = [
	{ id: "general", label: "General", icon: "settings-2" },
	{ id: "fields", label: "Fields", icon: "list" },
	{ id: "relationships", label: "Relationships", icon: "waypoints" },
	{ id: "display", label: "Display", icon: "layout-panel-top" },
];

const GROUP_PREFIX = "group:";
let newCounter = 0;

/** Problems that only mean "not filled in yet": shown inline once the user tries to save. */
function isBlankIssue(i: TypeIssue, t: EntityTypeDef): boolean {
	if (i.at === "name") return true;
	if (i.at === "key") return !t.key;
	const m = /^field:(\d+):key$/.exec(i.at);
	return !!m && !t.fields[Number(m[1])]?.key;
}

function friendly(i: TypeIssue, t: EntityTypeDef): TypeIssue {
	if (i.at === "key" && !t.key) return { ...i, message: "Give the type a key (it's filled in from the name)." };
	const m = /^field:(\d+):key$/.exec(i.at);
	if (m && !t.fields[Number(m[1])]?.key) return { ...i, message: "Give this field a label." };
	return i;
}

const tabFor = (at: string): EditorTab => (at.startsWith("field:") ? "fields" : at === "parentFields" || at.startsWith("card:") ? "display" : "general");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function TypeManager({ state, setState }: { state: TypesState; setState: (p: Partial<TypesState>) => void }) {
	const plugin = usePlugin();
	const version = useRelationsVersion();
	const settings = plugin.settings;
	const [drafts, setDraftsState] = useState<Map<string, TypeDraft>>(() => plugin.typeDrafts);
	const [groupDrafts, setGroupDraftsState] = useState<Map<string, GroupDraft>>(() => plugin.groupDrafts);
	const [fieldUid, setFieldUid] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [wizard, setWizard] = useState(false);
	const [importing, setImporting] = useState(false);
	const [attempted, setAttempted] = useState<Set<string>>(new Set());
	const [opts, setOpts] = useState({ rename: true, remove: false });
	const [dragGroup, setDragGroup] = useState<string | null>(null);
	const [, setTick] = useState(0);
	/** field to select once a newly opened type is shown */
	const pendingField = useRef<string | null>(null);

	const setDrafts = (fn: (m: Map<string, TypeDraft>) => Map<string, TypeDraft>) =>
		setDraftsState((prev) => {
			const next = fn(prev);
			plugin.typeDrafts = next;
			return next;
		});
	const setGroupDrafts = (fn: (m: Map<string, GroupDraft>) => Map<string, GroupDraft>) =>
		setGroupDraftsState((prev) => {
			const next = fn(prev);
			plugin.groupDrafts = next;
			return next;
		});

	// Draft for a saved type, created on first use (clean drafts are kept so field ids stay stable).
	const draftFor = (id: string): TypeDraft | null => {
		const existing = drafts.get(id);
		const saved = settings.types.find((t) => t.key === id);
		if (existing && (existing.original === null || isDirty(existing) || !saved || JSON.stringify(existing.original) === JSON.stringify(saved))) return existing;
		return saved ? makeDraft(saved) : null;
	};
	const groupDraftFor = (id: string): GroupDraft | null => {
		const existing = groupDrafts.get(id);
		const saved = settings.groups.find((g) => `${GROUP_PREFIX}${g.key}` === id);
		if (existing && (existing.original === null || isGroupDirty(existing) || !saved || JSON.stringify(existing.original) === JSON.stringify(saved))) return existing;
		return saved ? makeGroupDraft(saved) : null;
	};

	const isGroupId = (id: string | null) => !!id && id.startsWith(GROUP_PREFIX);
	const validSelection =
		state.selected &&
		(isGroupId(state.selected) ? groupDrafts.has(state.selected) || settings.groups.some((g) => `${GROUP_PREFIX}${g.key}` === state.selected) : drafts.has(state.selected) || settings.types.some((t) => t.key === state.selected));
	const selectedId = validSelection ? state.selected : (settings.types[0]?.key ?? null);
	const draft = selectedId && !isGroupId(selectedId) ? draftFor(selectedId) : null;
	const groupDraft = selectedId && isGroupId(selectedId) ? groupDraftFor(selectedId) : null;
	useEffect(() => {
		if (selectedId && draft && drafts.get(selectedId) !== draft) setDrafts((m) => new Map(m).set(selectedId, draft));
		if (selectedId && groupDraft && groupDrafts.get(selectedId) !== groupDraft) setGroupDrafts((m) => new Map(m).set(selectedId, groupDraft));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedId, draft, groupDraft]);
	useEffect(() => {
		setFieldUid(pendingField.current);
		pendingField.current = null;
	}, [selectedId]);

	// Every type and group as currently edited.
	const allTypes = useMemo(() => {
		const list = settings.types.map((t) => drafts.get(t.key)?.type ?? t);
		for (const [id, d] of drafts) if (id.startsWith("new:")) list.push(d.type);
		return list;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [drafts, settings.types, version]);
	const allGroups = useMemo(() => {
		const list = settings.groups.map((g) => groupDrafts.get(`${GROUP_PREFIX}${g.key}`)?.group ?? g);
		for (const [id, d] of groupDrafts) if (id.startsWith(`${GROUP_PREFIX}new:`)) list.push(d.group);
		return list;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [groupDrafts, settings.groups, version]);

	const entities = useMemo(
		() => (draft?.original ? plugin.index.ofType(draft.original.key) : []),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[draft?.original?.key, version],
	);

	const issues = useMemo(() => {
		if (!draft) return [];
		const t = draft.type;
		const others = allTypes.filter((x) => x !== t).map((x) => x.key);
		const list = typeIssues(t, { typeKeys: [...new Set([...others, ...settings.types.filter((x) => x.key !== draft.original?.key).map((x) => x.key)])], groupKeys: settings.groups.map((g) => g.key), isNew: !draft.original });
		if (allGroups.some((g) => g.key === t.group) && !settings.groups.some((g) => g.key === t.group)) {
			const i = list.findIndex((x) => x.at === "group");
			if (i >= 0) list[i] = { at: "group", message: "Save the new group first." };
		}
		return list.map((i) => friendly(i, t));
	}, [draft, allTypes, allGroups, settings.types, settings.groups]);
	const shownIssues = draft && selectedId && !attempted.has(selectedId) ? issues.filter((i) => !isBlankIssue(i, draft.type)) : issues;

	const sample: SampleNote = useMemo(() => {
		if (!draft) return { path: null, name: "", status: "", frontmatter: {}, fromNote: false };
		return sampleValues(draft, entities, {
			date: new Date().toISOString().slice(0, 10),
			status: statusesFor(draft.type, allGroups)[0],
			targetName: (targets) => (targets?.length ? targetName(targets[0], allTypes, false, allGroups) : "Entity").replace(/^Any (.+) entity$/i, "$1").replace(/^Any entity$/, "Entity"),
		});
	}, [draft, entities, allTypes, allGroups]);

	const select = (id: string, tab?: EditorTab) => setState({ selected: id, ...(tab ? { tab } : {}) });

	const update = (fn: (t: EntityTypeDef, meta: FieldMeta[]) => void) => {
		if (!selectedId || isGroupId(selectedId)) return;
		setDrafts((m) => {
			const base = m.get(selectedId) ?? draftFor(selectedId);
			if (!base) return m;
			const next: TypeDraft = { original: base.original, type: JSON.parse(JSON.stringify(base.type)), meta: base.meta.map((x) => ({ ...x })) };
			fn(next.type, next.meta);
			return new Map(m).set(selectedId, next);
		});
	};

	const goToIssue = (i: TypeIssue) => {
		if (!draft) return;
		const m = /^field:(\d+):/.exec(i.at);
		if (m) setFieldUid(draft.meta[Number(m[1])]?.uid ?? null);
		setState({ tab: tabFor(i.at) });
	};

	const changes = draft ? fieldChanges(draft) : { renames: [], deleted: [] };
	const renameNotes = useMemo(() => {
		const set = new Map<string, EntityRecord>();
		for (const r of changes.renames) for (const e of notesWithValue(entities, r.from)) set.set(e.path, e);
		return Array.from(set.values());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(changes.renames), entities]);
	const deleteNotes = useMemo(
		() => entities.filter((e) => changes.deleted.some((d) => hasValue(e.frontmatter[d.key]))),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[JSON.stringify(changes.deleted), entities],
	);

	const save = async () => {
		if (!draft || !selectedId) return;
		if (issues.length) {
			setAttempted((s) => new Set(s).add(selectedId));
			goToIssue(issues[0]);
			new Notice(`Fix ${issues.length === 1 ? "this problem" : `these ${issues.length} problems`} before saving.`);
			return;
		}
		const fin = finaliseType(draft.type);
		const list = settings.types;
		const at = draft.original ? list.findIndex((t) => t.key === draft.original!.key) : -1;
		if (at >= 0) list[at] = fin;
		else list.push(fin);
		settings.deletedPackTypes = settings.deletedPackTypes.filter((k) => k !== fin.key);
		const plan = { renames: opts.rename ? changes.renames : [], deleted: opts.remove ? changes.deleted.map((d) => d.key) : [] };
		const targets = [...(opts.rename ? renameNotes : []), ...(opts.remove ? deleteNotes : [])];
		await plugin.saveSettings();
		let updated = 0;
		const current = new Set(fin.fields.map((f) => f.key));
		for (const e of new Set(targets)) {
			let did = false;
			await plugin.app.fileManager.processFrontMatter(e.file, (fm: Record<string, unknown>) => {
				did = migrateFrontmatter(fm, plan, current);
			});
			if (did) updated++;
		}
		setDrafts((m) => {
			const next = new Map(m);
			next.delete(selectedId);
			next.set(fin.key, makeDraft(fin));
			return next;
		});
		setAttempted((s) => {
			const n = new Set(s);
			n.delete(selectedId);
			return n;
		});
		setOpts({ rename: true, remove: false });
		if (selectedId !== fin.key) select(fin.key);
		new Notice(`Saved ${fin.name}${updated ? ` and updated ${plural(updated, "note")}` : ""}.`);
	};

	const discard = () => {
		if (!draft || !selectedId) return;
		if (!draft.original) {
			setDrafts((m) => {
				const n = new Map(m);
				n.delete(selectedId);
				return n;
			});
			select(settings.types[0]?.key ?? "");
		} else {
			setDrafts((m) => new Map(m).set(selectedId, makeDraft(draft.original!)));
		}
		setFieldUid(null);
	};

	const addDraft = (type: EntityTypeDef, tab: EditorTab = "general") => {
		const id = `new:${++newCounter}`;
		setDrafts((m) => new Map(m).set(id, makeDraft(null, type)));
		select(id, tab);
	};

	const blankType = (group?: string): EntityTypeDef => ({
		key: "",
		name: "",
		plural: "",
		icon: "file",
		color: PALETTE[(settings.types.length + newCounter) % PALETTE.length],
		group: group ?? draft?.type.group ?? settings.groups[0]?.key ?? "",
		template: "",
		fields: [],
		builtIn: false,
		shortcuts: [],
	});

	const addGroupDraft = () => {
		const id = `${GROUP_PREFIX}new:${++newCounter}`;
		setGroupDrafts((m) => new Map(m).set(id, makeGroupDraft(null, { key: "", name: "", icon: "folder", statuses: [...DEFAULT_STATUSES] })));
		select(id);
	};

	const newMenu = (evt: MouseEvent) => {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Type").setIcon("file-plus").onClick(() => addDraft(blankType())));
		if (draft?.original)
			menu.addItem((i) =>
				i
					.setTitle(`Duplicate “${draft.type.name}”`)
					.setIcon("copy")
					.onClick(() => addDraft(duplicateType(draft.type, allTypes.map((t) => t.key)))),
			);
		menu.addItem((i) => i.setTitle("Group").setIcon("folder-plus").onClick(addGroupDraft));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Import pack…").setIcon("import").onClick(() => setImporting(true)));
		menu.addItem((i) =>
			i
				.setTitle("Copy all types as a pack")
				.setIcon("clipboard-copy")
				.onClick(async () => {
					await navigator.clipboard.writeText(exportPack(settings.types, settings.groups, plugin.app.vault.getName()));
					new Notice(`Copied ${plural(settings.types.length, "type")} and ${plural(settings.groups.length, "group")} as a pack.`);
				}),
		);
		menu.showAtMouseEvent(evt.nativeEvent);
	};

	const exportJson = async () => {
		if (!draft) return;
		await navigator.clipboard.writeText(exportPack([finaliseType(draft.type)], allGroups));
		new Notice(`Copied “${draft.type.name}” as JSON. Paste it into “New → Import pack…” in another vault.`);
	};

	const deleteType = () => {
		if (!draft?.original) return;
		const t = draft.original;
		const n = plugin.index.ofType(t.key).length;
		new ConfirmModal(
			plugin.app,
			`Delete the “${t.name}” type?`,
			n
				? `${plural(n, "note")} ${n === 1 ? "uses" : "use"} it. ${n === 1 ? "It keeps" : "They keep"} their content and frontmatter (including entity: ${t.key}), but won't be treated as entities until a type with the key “${t.key}” exists again.`
				: "No notes use it.",
			"Delete type",
			async () => {
				settings.types = settings.types.filter((x) => x.key !== t.key);
				for (const x of settings.types) for (const f of x.fields) if (f.targets) f.targets = f.targets.filter((k) => k !== t.key);
				if (t.pack === STARTER_PACK.id && !settings.deletedPackTypes.includes(t.key)) settings.deletedPackTypes.push(t.key);
				await plugin.saveSettings();
				setDrafts((m) => {
					const next = new Map(m);
					next.delete(t.key);
					return next;
				});
				select(settings.types[0]?.key ?? "");
				new Notice(`Deleted the “${t.name}” type.`);
			},
		).open();
	};

	const openType = (key: string, fieldKey?: string) => {
		const d = draftFor(key);
		if (!d) return;
		if (!drafts.has(key)) setDrafts((m) => new Map(m).set(key, d));
		const i = fieldKey ? d.type.fields.findIndex((f) => f.key === fieldKey) : -1;
		const uid = i >= 0 ? d.meta[i].uid : null;
		if (key === selectedId) setFieldUid(uid);
		else pendingField.current = uid;
		select(key, fieldKey ? "fields" : undefined);
	};

	/** Drag a group heading onto another to move it there. Saved straight away. */
	const moveGroup = async (fromKey: string, toKey: string) => {
		if (fromKey === toKey) return;
		const list = settings.groups;
		const from = list.findIndex((g) => g.key === fromKey);
		const to = list.findIndex((g) => g.key === toKey);
		if (from < 0 || to < 0) return;
		const [g] = list.splice(from, 1);
		list.splice(to, 0, g);
		await plugin.saveSettings();
		setTick((n) => n + 1);
	};

	// Re-render when settings are saved elsewhere (e.g. another type).
	useEffect(() => {
		const ref = plugin.index.on("updated", () => setTick((n) => n + 1));
		return () => plugin.index.offref(ref);
	}, [plugin]);

	const api: EditorApi | null = draft
		? {
				draft,
				update,
				issues: shownIssues,
				issuesAt: (at) => shownIssues.filter((i) => i.at === at),
				allTypes,
				groups: allGroups,
				openType,
				openGroup: (key) => select(`${GROUP_PREFIX}${key}`),
				fieldUid,
				setFieldUid,
				setTab: (tab) => setState({ tab }),
				noteCount: entities.length,
				sample,
			}
		: null;

	const dirty = draft ? isDirty(draft) : false;
	const q = search.trim().toLowerCase();
	const listed = allTypes.filter((t) => !q || t.name.toLowerCase().includes(q) || t.key.includes(q) || t.plural.toLowerCase().includes(q));
	const idOf = (t: EntityTypeDef) => {
		for (const [id, d] of drafts) if (d.type === t) return id;
		return t.key;
	};
	const groupIdOf = (g: GroupDef) => {
		for (const [id, d] of groupDrafts) if (d.group === g) return id;
		return `${GROUP_PREFIX}${g.key}`;
	};
	const ungrouped = listed.filter((t) => !allGroups.some((g) => g.key === t.group));

	const typeRow = (t: EntityTypeDef) => {
		const id = idOf(t);
		const d = drafts.get(id);
		const isNew = id.startsWith("new:");
		const count = isNew ? 0 : plugin.index.ofType(t.key).length;
		return (
			<button key={id} data-type={t.key || id} className={`oe-tm-typeitem${id === selectedId ? " is-selected" : ""}`} style={{ "--oe-type-color": t.color } as CSSProperties} onClick={() => select(id)}>
				<span className="oe-type-icon">
					<Icon name={t.icon} />
				</span>
				<span className="oe-tm-typename">{t.name || "New type"}</span>
				{isNew ? <span className="oe-tm-badge is-new">new</span> : t.pack !== STARTER_PACK.id && <span className="oe-tm-badge">custom</span>}
				{d && isDirty(d) && <span className="oe-tm-dirty" aria-label="Unsaved changes" />}
				<span className="oe-tm-count">{isNew ? "" : count}</span>
			</button>
		);
	};

	return (
		<div className="oe-tm">
			<aside className="oe-tm-sidebar">
				<div className="oe-tm-sidebar-head">
					<input type="search" placeholder="Search types…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search types" />
					<button className="mod-cta" onClick={newMenu} aria-label="New">
						<Icon name="plus" /> New
					</button>
				</div>
				<div className="oe-tm-typelist">
					{allGroups.map((g) => {
						const gid = groupIdOf(g);
						const members = listed.filter((t) => t.group === g.key && g.key);
						const gd = groupDrafts.get(gid);
						const isNewGroup = gid.startsWith(`${GROUP_PREFIX}new:`);
						if (q && !members.length) return null;
						return (
							<div
								key={gid}
								className={`oe-tm-typegroup${dragGroup && dragGroup !== g.key ? " is-drop-target" : ""}`}
								onDragOver={(e) => dragGroup && !isNewGroup && e.preventDefault()}
								onDrop={() => {
									if (dragGroup && !isNewGroup) void moveGroup(dragGroup, g.key);
									setDragGroup(null);
								}}
							>
								<button
									className={`oe-tm-typegroup-title${gid === selectedId ? " is-selected" : ""}`}
									draggable={!isNewGroup}
									onDragStart={() => setDragGroup(g.key)}
									onDragEnd={() => setDragGroup(null)}
									onClick={() => select(gid)}
									data-group={g.key || gid}
									title="Click to edit the group. Drag to reorder."
								>
									<Icon name={g.icon || "folder"} />
									<span className="oe-tm-typename">{g.name || "New group"}</span>
									{isNewGroup && <span className="oe-tm-badge is-new">new</span>}
									{gd && isGroupDirty(gd) && <span className="oe-tm-dirty" aria-label="Unsaved changes" />}
								</button>
								{members.map(typeRow)}
								{!members.length && !q && <div className="oe-tm-muted oe-tm-typegroup-empty">No types yet</div>}
							</div>
						);
					})}
					{ungrouped.length > 0 && (
						<div className="oe-tm-typegroup">
							<div className="oe-tm-typegroup-title is-static">
								<Icon name="help-circle" />
								<span className="oe-tm-typename">No group</span>
							</div>
							{ungrouped.map(typeRow)}
						</div>
					)}
				</div>
			</aside>

			{groupDraft && selectedId ? (
				<GroupEditor
					key={selectedId}
					id={selectedId}
					draft={groupDraft}
					allGroups={allGroups}
					allTypes={allTypes}
					setDraft={(d) => setGroupDrafts((m) => new Map(m).set(selectedId, d))}
					onSaved={(key) => {
						setGroupDrafts((m) => {
							const next = new Map(m);
							next.delete(selectedId);
							return next;
						});
						select(`${GROUP_PREFIX}${key}`);
					}}
					onDiscarded={() => {
						setGroupDrafts((m) => {
							const next = new Map(m);
							next.delete(selectedId);
							return next;
						});
						if (!groupDraft.original) select(settings.types[0]?.key ?? "");
					}}
					onDeleted={() => select(settings.types[0]?.key ?? "")}
					openType={(key) => select(key)}
					newType={(group) => addDraft(blankType(group))}
				/>
			) : api && draft ? (
				<EditorContext.Provider value={api}>
					<main className="oe-tm-main" style={{ "--oe-type-color": draft.type.color } as CSSProperties}>
						<header className="oe-tm-header">
							<div className="oe-tm-title">
								<span className="oe-type-icon oe-type-icon-xl">
									<Icon name={draft.type.icon} />
								</span>
								<div>
									<h1>{draft.type.name || "New type"}</h1>
									<div className="oe-tm-muted">
										{allGroups.find((g) => g.key === draft.type.group)?.name ?? "No group"} · {draft.original ? plural(entities.length, "note") : "not saved yet"} · {draft.type.pack === STARTER_PACK.id ? "starter" : "custom"}
										{draft.type.key && (
											<>
												{" "}
												· <code>{draft.type.key}</code>
											</>
										)}
									</div>
								</div>
							</div>
							<nav className="oe-tm-tabs" role="tablist">
								{TABS.map((tab) => {
									const n = tab.id === "fields" ? draft.type.fields.length : tab.id === "relationships" ? draft.type.fields.filter((f) => f.kind === "relation").length : null;
									const bad = shownIssues.some((i) => tabFor(i.at) === tab.id);
									return (
										<button key={tab.id} role="tab" aria-selected={state.tab === tab.id} data-tab={tab.id} className={`oe-tm-tab${state.tab === tab.id ? " is-active" : ""}`} onClick={() => setState({ tab: tab.id })}>
											<Icon name={tab.icon} />
											{tab.label}
											{n !== null && <span className="oe-tm-tabcount">{n}</span>}
											{bad && <Icon name="alert-circle" className="oe-tm-issue-dot" />}
										</button>
									);
								})}
							</nav>
						</header>

						<div className={`oe-tm-body is-${state.tab}`}>
							{state.tab === "general" && <GeneralTab onDuplicate={() => addDraft(duplicateType(draft.type, allTypes.map((t) => t.key)))} onExport={() => void exportJson()} onDelete={deleteType} />}
							{state.tab === "fields" && <FieldsTab addRelationship={() => setWizard(true)} />}
							{state.tab === "relationships" && <RelationshipsTab addRelationship={() => setWizard(true)} />}
							{state.tab === "display" && <DisplayTab />}
						</div>

						{dirty && (
							<div className="oe-tm-savebar" role="region" aria-label="Unsaved changes">
								<div className="oe-tm-savebar-main">
									<span className="oe-tm-savebar-title">
										<span className="oe-tm-dirty" /> {draft.original ? "Unsaved changes" : "New type, not saved yet"}
									</span>
									{issues.length > 0 && attempted.has(selectedId!) && (
										<a
											href="#"
											className="oe-tm-savebar-issues"
											onClick={(e) => {
												e.preventDefault();
												goToIssue(issues[0]);
											}}
										>
											<Icon name="alert-circle" /> {plural(issues.length, "problem")} to fix
										</a>
									)}
									<span className="oe-spacer" />
									<button onClick={discard}>Discard</button>
									<button className="mod-cta" onClick={() => void save()}>
										Save
									</button>
								</div>
								{renameNotes.length > 0 && (
									<MigrationOption
										checked={opts.rename}
										onChange={(v) => setOpts({ ...opts, rename: v })}
										label={`Also update ${plural(renameNotes.length, "note")}: ${changes.renames.map((r) => `${r.from} → ${r.to}`).join(", ")}`}
										notes={renameNotes}
									/>
								)}
								{deleteNotes.length > 0 && (
									<MigrationOption
										checked={opts.remove}
										onChange={(v) => setOpts({ ...opts, remove: v })}
										label={`Remove the values of deleted field${changes.deleted.length === 1 ? "" : "s"} (${changes.deleted.map((d) => d.key).join(", ")}) from ${plural(deleteNotes.length, "note")}`}
										notes={deleteNotes}
									/>
								)}
							</div>
						)}

						<PreviewPanel open={state.previewOpen} setOpen={(v) => setState({ previewOpen: v })} mode={state.previewMode} setMode={(m) => setState({ previewMode: m })} />
					</main>
					{wizard && <AddRelationshipDialog onClose={() => setWizard(false)} />}
				</EditorContext.Provider>
			) : (
				<main className="oe-tm-main">
					<div className="oe-tm-empty oe-tm-bigempty">Select a type on the left, or create a new one.</div>
				</main>
			)}
			{importing && (
				<ImportDialog
					onClose={() => setImporting(false)}
					onImport={(json) => {
						const r = importAsDrafts(json, settings.groups, allTypes);
						if ("error" in r) return r.error;
						if (r.newGroups.length) {
							settings.groups.push(...r.newGroups.map(cloneGroup));
							void plugin.saveSettings();
						}
						let first: string | null = null;
						setDrafts((m) => {
							const next = new Map(m);
							for (const t of r.types) {
								const id = `new:${++newCounter}`;
								first ??= id;
								next.set(id, makeDraft(null, t));
							}
							return next;
						});
						setImporting(false);
						if (first) select(first, "general");
						const renamed = Object.entries(r.renamed).map(([a, b]) => `${a} → ${b}`);
						new Notice(
							`Imported ${plural(r.types.length, "type")} to review and save` +
								(r.newGroups.length ? `, and added ${plural(r.newGroups.length, "group")} (${r.newGroups.map((g) => g.name).join(", ")})` : "") +
								(renamed.length ? `. Keys already taken: ${renamed.join(", ")}` : "") +
								".",
						);
						return null;
					}}
				/>
			)}
		</div>
	);
}

/** Group editor: name, icon, statuses (renaming offers to update notes), and the group's types. */
function GroupEditor({
	id,
	draft,
	allGroups,
	allTypes,
	setDraft,
	onSaved,
	onDiscarded,
	onDeleted,
	openType,
	newType,
}: {
	id: string;
	draft: GroupDraft;
	allGroups: GroupDef[];
	allTypes: EntityTypeDef[];
	setDraft: (d: GroupDraft) => void;
	onSaved: (key: string) => void;
	onDiscarded: () => void;
	onDeleted: () => void;
	openType: (key: string) => void;
	newType: (group: string) => void;
}) {
	const plugin = usePlugin();
	const settings = plugin.settings;
	const [attempted, setAttempted] = useState(false);
	const [migrate, setMigrate] = useState(true);
	const [dragFrom, setDragFrom] = useState<number | null>(null);
	const g = draft.group;
	const isNew = !draft.original;
	const dirty = isGroupDirty(draft);
	const edit = (fn: (g: GroupDef, orig: (string | null)[]) => void) => {
		const next: GroupDraft = { original: draft.original, group: cloneGroup(draft.group), statusOrig: [...draft.statusOrig] };
		fn(next.group, next.statusOrig);
		setDraft(next);
	};
	const issues = groupIssues(g, { groupKeys: allGroups.filter((x) => x !== g).map((x) => x.key), isNew });
	const shown = attempted ? issues : issues.filter((i) => i.at !== "name" && !(i.at === "key" && !g.key));
	const at = (k: string) => shown.filter((i) => i.at === k);
	const members = allTypes.filter((t) => t.group === (draft.original?.key ?? g.key) && g.key);
	const renames = statusRenames(draft);
	// Notes whose status follows this group (types without their own statuses) and uses a renamed status.
	const affected = useMemo(() => {
		if (!renames.length || !draft.original) return [];
		const from = new Set(renames.map((r) => r.from));
		return plugin.index.all().filter((e) => e.type.group === draft.original!.key && !e.type.statuses && e.status && from.has(e.status));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(renames), draft.original, plugin]);

	const save = async () => {
		if (issues.length) {
			setAttempted(true);
			new Notice(`Fix ${issues.length === 1 ? "this problem" : `these ${issues.length} problems`} before saving.`);
			return;
		}
		const fin: GroupDef = { ...cloneGroup(g), name: g.name.trim(), statuses: g.statuses.map((s) => s.trim()) };
		const list = settings.groups;
		const i = draft.original ? list.findIndex((x) => x.key === draft.original!.key) : -1;
		if (i >= 0) list[i] = fin;
		else list.push(fin);
		await plugin.saveSettings();
		let updated = 0;
		if (migrate && affected.length) {
			const map = new Map(renames.map((r) => [r.from, r.to]));
			for (const e of affected) {
				await plugin.app.fileManager.processFrontMatter(e.file, (fm: Record<string, unknown>) => {
					const to = map.get(String(fm[COMMON_KEYS.status]));
					if (to) fm[COMMON_KEYS.status] = to;
				});
				updated++;
			}
		}
		setAttempted(false);
		setMigrate(true);
		onSaved(fin.key);
		new Notice(`Saved the ${fin.name} group${updated ? ` and updated ${plural(updated, "note")}` : ""}.`);
	};

	const del = () => {
		if (!draft.original) return;
		const key = draft.original.key;
		new ConfirmModal(plugin.app, `Delete the “${draft.original.name}” group?`, "It has no types. Relations that target “any entity in this group” lose that target.", "Delete group", async () => {
			settings.groups = settings.groups.filter((x) => x.key !== key);
			for (const t of settings.types) for (const f of t.fields) if (f.targets) f.targets = f.targets.filter((x) => x !== `@${key}`);
			await plugin.saveSettings();
			onDiscarded();
			onDeleted();
			new Notice(`Deleted the “${draft.original!.name}” group.`);
		}).open();
	};

	const moveStatus = (from: number, to: number) =>
		edit((x, orig) => {
			const [s] = x.statuses.splice(from, 1);
			const [o] = orig.splice(from, 1);
			x.statuses.splice(to, 0, s);
			orig.splice(to, 0, o);
		});

	return (
		<main className="oe-tm-main oe-tm-groupeditor" data-group-id={id}>
			<header className="oe-tm-header">
				<div className="oe-tm-title">
					<span className="oe-type-icon oe-type-icon-xl">
						<Icon name={g.icon || "folder"} />
					</span>
					<div>
						<h1>{g.name || "New group"}</h1>
						<div className="oe-tm-muted">
							Group · {plural(members.length, "type")}
							{g.key && (
								<>
									{" "}
									· <code>{g.key}</code>
								</>
							)}
						</div>
					</div>
				</div>
			</header>
			<div className="oe-tm-body">
				<Section title="Group">
					<Row label="Name" issues={at("name")}>
						<TextInput
							label="Group name"
							value={g.name}
							placeholder="e.g. Work"
							autoFocus={isNew && !g.name}
							invalid={at("name").length > 0}
							onChange={(v) =>
								edit((x) => {
									if (isNew && (!x.key || x.key === toKey(x.name))) x.key = uniqueKey(toKey(v), allGroups.filter((o) => o !== g).map((o) => o.key));
									x.name = v;
								})
							}
						/>
					</Row>
					<Row label="Key" desc={isNew ? "Used by types and relation targets. Can't be changed once saved." : "Used by types and relation targets (e.g. “any entity in this group”). It can't be changed."} issues={at("key")}>
						<TextInput label="Group key" className="oe-tm-mono" value={g.key} disabled={!isNew} invalid={at("key").length > 0} onChange={(v) => edit((x) => (x.key = v.trim()))} />
					</Row>
					<Row label="Icon">
						<IconPicker value={g.icon} color="var(--text-muted)" onChange={(v) => edit((x) => (x.icon = v))} />
					</Row>
				</Section>
				<Section title="Statuses" desc="The status choices for this group's types (unless a type has its own). The first is the starting status. Drag to reorder; edit a name to rename it.">
					<div className="oe-tm-statuslist">
						{g.statuses.map((s, i) => (
							<div
								key={i}
								className="oe-tm-statusrow"
								draggable
								onDragStart={() => setDragFrom(i)}
								onDragOver={(e) => e.preventDefault()}
								onDrop={() => {
									if (dragFrom !== null && dragFrom !== i) moveStatus(dragFrom, i);
									setDragFrom(null);
								}}
							>
								<Icon name="grip-vertical" className="oe-tm-grip" />
								<TextInput label={`Status ${i + 1}`} value={s} invalid={!s.trim() && attempted} onChange={(v) => edit((x) => (x.statuses[i] = v))} />
								{i === 0 && <span className="oe-tm-badge">starting</span>}
								{draft.statusOrig[i] && draft.statusOrig[i] !== s && s.trim() && <span className="oe-tm-muted">was {draft.statusOrig[i]}</span>}
								<button
									className="clickable-icon oe-tm-danger"
									aria-label={`Remove ${s}`}
									disabled={g.statuses.length === 1}
									onClick={() =>
										edit((x, orig) => {
											x.statuses.splice(i, 1);
											orig.splice(i, 1);
										})
									}
								>
									<Icon name="x" />
								</button>
							</div>
						))}
						<button
							className="oe-tm-addstatus"
							onClick={() =>
								edit((x, orig) => {
									x.statuses.push("");
									orig.push(null);
								})
							}
						>
							<Icon name="plus" /> Add status
						</button>
					</div>
					{at("statuses").map((i, n) => (
						<div key={n} className="oe-tm-issue">
							<Icon name="alert-circle" /> {i.message}
						</div>
					))}
				</Section>
				<Section
					title="Types"
					actions={
						!isNew && (
							<button onClick={() => newType(g.key)}>
								<Icon name="plus" /> New type here
							</button>
						)
					}
				>
					{members.length ? (
						<div className="oe-tm-chips">
							{members.map((t) => (
								<button key={t.key} className="oe-tm-chip is-type" style={{ "--oe-type-color": t.color } as CSSProperties} onClick={() => openType(t.key)}>
									<Icon name={t.icon} className="oe-chip-icon" />
									{t.name}
								</button>
							))}
						</div>
					) : (
						<div className="oe-tm-empty">No types in this group yet.</div>
					)}
				</Section>
				{!isNew && (
					<Section title="More">
						<div className="oe-tm-actions">
							<button className="mod-warning" disabled={members.length > 0} onClick={del} title={members.length ? "Move its types to another group first" : undefined}>
								<Icon name="trash-2" /> Delete group
							</button>
						</div>
						{members.length > 0 && <div className="oe-tm-muted">To delete this group, move its types to another group first (General → Group).</div>}
					</Section>
				)}
			</div>
			{dirty && (
				<div className="oe-tm-savebar" role="region" aria-label="Unsaved changes">
					<div className="oe-tm-savebar-main">
						<span className="oe-tm-savebar-title">
							<span className="oe-tm-dirty" /> {isNew ? "New group, not saved yet" : "Unsaved changes"}
						</span>
						<span className="oe-spacer" />
						<button onClick={onDiscarded}>Discard</button>
						<button className="mod-cta" onClick={() => void save()}>
							Save
						</button>
					</div>
					{affected.length > 0 && (
						<MigrationOption checked={migrate} onChange={setMigrate} label={`Also update ${plural(affected.length, "note")}: ${renames.map((r) => `${r.from} → ${r.to}`).join(", ")}`} notes={affected} />
					)}
				</div>
			)}
		</main>
	);
}

function MigrationOption({ checked, onChange, label, notes }: { checked: boolean; onChange: (v: boolean) => void; label: string; notes: EntityRecord[] }) {
	const plugin = usePlugin();
	const [open, setOpen] = useState(false);
	return (
		<div className="oe-tm-migration">
			<label>
				<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
				{label}
			</label>
			<a
				href="#"
				onClick={(e) => {
					e.preventDefault();
					setOpen(!open);
				}}
			>
				{open ? "Hide notes" : "Show notes"}
			</a>
			{open && (
				<div className="oe-tm-migration-notes">
					{notes.map((n) => (
						<a
							key={n.path}
							href="#"
							className="oe-tm-notelink"
							onClick={(e) => {
								e.preventDefault();
								plugin.openPath(n.path, "tab");
							}}
						>
							{n.name}
						</a>
					))}
				</div>
			)}
		</div>
	);
}

function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (json: string) => string | null }) {
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	return (
		<div className="oe-tm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="oe-tm-dialog" role="dialog" aria-label="Import pack" onKeyDown={(e) => e.key === "Escape" && onClose()}>
				<div className="oe-tm-dialog-head">
					<h2>Import a pack</h2>
					<button className="clickable-icon" aria-label="Close" onClick={onClose}>
						<Icon name="x" />
					</button>
				</div>
				<p className="oe-tm-muted">Paste a pack, a type copied with “Copy as JSON”, or a list of types, or choose a .json file. Each type opens as a draft to review before saving.</p>
				<textarea className="oe-tm-import" autoFocus value={text} placeholder='{ "obsEntitiesPack": 1, "types": [ … ] }' onChange={(e) => setText(e.target.value)} />
				<input
					type="file"
					accept=".json,application/json"
					aria-label="Choose a JSON file"
					onChange={async (e) => {
						const file = e.target.files?.[0];
						if (file) setText(await file.text());
					}}
				/>
				{error && (
					<div className="oe-tm-issue">
						<Icon name="alert-circle" /> {error}
					</div>
				)}
				<div className="oe-tm-dialog-foot">
					<button onClick={onClose}>Cancel</button>
					<button className="mod-cta" disabled={!text.trim()} onClick={() => setError(onImport(text))}>
						Import
					</button>
				</div>
			</div>
		</div>
	);
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private body: string,
		private action: string,
		private onConfirm: () => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: this.body });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.action)
					.setWarning()
					.onClick(async () => {
						this.close();
						await this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
