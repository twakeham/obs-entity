import { FuzzySuggestModal, Modal, type TFolder } from "obsidian";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { applyChange, bulkFields, changeApplies, describeChange, entitiesText, setValueFor, statusUnion, type BulkChange } from "../../model/bulk";
import { asArray, parseLabelledEntry, parseLink } from "../../model/links";
import { isListValued } from "../../model/types";
import type { BulkUndo } from "../../services/bulkActions";
import type { EntityRecord } from "../../services/entityIndex";
import { EntitySuggest } from "../components/entityPicker";
import { PluginContext } from "../react/context";
import { CheckControl, ListControl, MultiControl, RelationControl, SelectControl, TextControl } from "../react/EntityForm";
import { Icon } from "../react/Icon";

/** A modal whose body is React. `body` gets a close function. */
export class ReactModal extends Modal {
	private root: Root | null = null;

	constructor(
		private plugin: EntitiesPlugin,
		private heading: string,
		private body: (close: () => void) => ReactNode,
		private cls = "",
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		if (this.cls) this.modalEl.addClass(this.cls);
		this.root = createRoot(this.contentEl);
		this.root.render(<PluginContext.Provider value={this.plugin}>{this.body(() => this.close())}</PluginContext.Provider>);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

const uniqueTypes = (entities: EntityRecord[]) => [...new Map(entities.map((e) => [e.type.key, e.type])).values()];

function Footer({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
	return (
		<div className="oe-bulk-footer">
			<span className="oe-pop-hint">{hint}</span>
			<span className="oe-spacer" />
			{children}
		</div>
	);
}

// ---------------------------------------------------------------- set field

/** "Set field…": one value for a field on every selected entity that has it. */
function SetField({ plugin, entities, close, onUndo }: { plugin: EntitiesPlugin; entities: EntityRecord[]; close: () => void; onUndo: (u: BulkUndo | null) => void }) {
	const groups = plugin.settings.groups;
	const types = useMemo(() => uniqueTypes(entities), [entities]);
	const fields = useMemo(() => bulkFields(types), [types]);
	const [key, setKey] = useState(fields[0].key);
	const field = fields.find((f) => f.key === key) ?? fields[0];
	const [value, setValue] = useState<unknown>(undefined);
	// Text boxes save on blur, which happens just before the button's click: read the latest value from a ref.
	const latest = useRef<unknown>(undefined);
	const commit = (v: unknown) => {
		latest.current = v;
		setValue(v);
	};
	useEffect(() => commit(field.kind === "boolean" ? false : undefined), [key]); // eslint-disable-line react-hooks/exhaustive-deps

	const hasField = entities.filter((e) => field.types.includes(e.type.key));
	const changeOf = (v: unknown): BulkChange => ({ op: "set", key: field.key, value: setValueFor(field, v) });
	const applies = (v: unknown) => hasField.filter((e) => changeApplies(changeOf(v), e.type, groups));
	const n = applies(value).length;
	const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

	const valueText = (v: unknown) =>
		asArray(v)
			.map((x) => {
				const s = String(x);
				const link = parseLabelledEntry(s)?.link ?? parseLink(s);
				return link ? (link.path.split("/").pop() ?? link.path) : s;
			})
			.join(", ");
	const apply = async (v: unknown) => {
		const change = changeOf(v);
		close();
		const paths = hasField.map((e) => e.path);
		const skippedTypes = entities.length - hasField.length;
		const undo = await plugin.bulk.updateFrontmatter(
			paths,
			(e) => (changeApplies(change, e.type, groups) ? change : null),
			(changed, skipped) => `${describeChange(change, field.label, valueText(v), changed)}${skipped + skippedTypes ? ` (${entitiesText(skipped + skippedTypes)} skipped)` : ""}.`,
		);
		onUndo(undo);
	};

	const sample = entities[0];
	let control: ReactNode;
	const f = field.field;
	if (field.kind === "status")
		control = (
			<select className="dropdown" value={typeof value === "string" ? value : ""} aria-label="Status" onChange={(e) => commit(e.target.value || undefined)}>
				<option value="">Choose a status…</option>
				{statusUnion(types, groups).map((s) => (
					<option key={s} value={s}>
						{s}
					</option>
				))}
			</select>
		);
	else if (field.kind === "tags") control = <ListControl value={value} editable label="Tags" tag onCommit={commit} />;
	else if (f?.kind === "relation")
		control = (
			<RelationControl
				fieldKey={f.key}
				label={field.label}
				targets={f.targets}
				list={isListValued(f)}
				labelled={!!f.labelled}
				symmetric={false}
				value={value}
				editable
				path={sample.path}
				type={sample.type}
				live={false}
				problems={[]}
				onCommit={commit}
			/>
		);
	else if (f?.kind === "boolean") control = <CheckControl value={value} editable label={field.label} onCommit={commit} />;
	else if (f?.kind === "select") control = <SelectControl options={f.options ?? []} value={value} editable label={field.label} onCommit={commit} />;
	else if (f?.kind === "multiselect") control = <MultiControl options={f.options ?? []} value={value} editable label={field.label} onCommit={commit} />;
	else if (f?.kind === "list") control = <ListControl value={value} editable label={field.label} onCommit={commit} />;
	else if (f) control = <TextControl key={field.key} kind={f.kind as "text"} value={value} editable label={field.label} onCommit={commit} />;

	const missing = entities.length - hasField.length;
	return (
		<div className="oe-bulk oe-form is-editing">
			<label className="oe-bulk-row">
				<span>Field</span>
				<select className="dropdown" value={key} aria-label="Field" onChange={(e) => setKey(e.target.value)}>
					{fields.map((x) => (
						<option key={x.key} value={x.key}>
							{x.label}
							{x.types.length < types.length ? ` (${x.types.map((t) => types.find((y) => y.key === t)?.name ?? t).join(", ")})` : ""}
						</option>
					))}
				</select>
			</label>
			<div className="oe-bulk-row">
				<span>Value</span>
				<div className="oe-prop-value oe-bulk-control">{control}</div>
			</div>
			<div className="oe-pop-hint">
				{missing > 0 ? `${entitiesText(missing)} don't have ${field.label} and will be skipped. ` : ""}
				{field.kind === "status" && !empty && n < hasField.length ? `${entitiesText(hasField.length - n)} can't have “${String(value)}” and will be skipped.` : ""}
			</div>
			<Footer hint="One undo step: Ctrl/Cmd+Z in the table, or Undo on the notice.">
				<button onClick={() => void apply(null)} disabled={!hasField.length}>
					Clear {field.label}
				</button>
				<button
					className="mod-cta"
					disabled={empty && field.kind !== "boolean"}
					onClick={() => {
						// Let a text box's blur commit land first.
						window.setTimeout(() => void apply(latest.current), 0);
					}}
				>
					Set on {entitiesText(n)}
				</button>
			</Footer>
		</div>
	);
}

// ---------------------------------------------------------------- links

/** "Add link… / Remove link…" on a relation field. */
function Links({ plugin, entities, mode, close, onUndo }: { plugin: EntitiesPlugin; entities: EntityRecord[]; mode: "add" | "remove"; close: () => void; onUndo: (u: BulkUndo | null) => void }) {
	const { app } = plugin;
	const types = useMemo(() => uniqueTypes(entities), [entities]);
	const fields = useMemo(() => bulkFields(types).filter((f) => f.field?.kind === "relation"), [types]);
	const [key, setKey] = useState(fields[0]?.key ?? "");
	const field = fields.find((f) => f.key === key);
	const [picked, setPicked] = useState<EntityRecord[]>([]);
	const [chosen, setChosen] = useState<Set<string>>(new Set());
	const input = useRef<HTMLInputElement>(null);
	const latestField = useRef(field);
	latestField.current = field;

	useEffect(() => {
		if (mode !== "add" || !input.current) return;
		const s = new EntitySuggest(app, input.current, plugin, {
			get targets() {
				return latestField.current?.field?.targets;
			},
			exclude: () => new Set(),
			onPick: (e) => setPicked((p) => (p.some((x) => x.path === e.path) ? p : [...p, e])),
			allowCreate: false,
		});
		return () => s.close();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode]);

	/** For removing: every note the selection links to in the field, with how many link to it. */
	const existing = useMemo(() => {
		const m = new Map<string, { key: string; name: string; count: number }>();
		if (!field) return [];
		for (const e of entities) {
			if (!field.types.includes(e.type.key)) continue;
			for (const raw of asArray(e.frontmatter[field.key])) {
				const link = field.field?.labelled ? parseLabelledEntry(raw)?.link : parseLink(raw);
				if (!link) continue;
				const file = app.metadataCache.getFirstLinkpathDest(link.path, e.path);
				const k = file?.path ?? `?${link.path.toLowerCase()}`;
				const entry = m.get(k) ?? { key: k, name: file?.basename ?? link.path, count: 0 };
				entry.count++;
				m.set(k, entry);
			}
		}
		return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	}, [field, entities, app]);

	if (!field) return <div className="oe-pop-empty">The selected entities have no relationship fields.</div>;
	const list = isListValued(field.field!);
	const hasField = entities.filter((e) => field.types.includes(e.type.key));

	const apply = async () => {
		const names = mode === "add" ? picked.map((p) => p.name) : existing.filter((x) => chosen.has(x.key)).map((x) => x.name);
		close();
		const undo = await plugin.bulk.updateFrontmatter(
			hasField.map((e) => e.path),
			(e, file) => (fm) => {
				let changed = false;
				if (mode === "add") {
					for (const p of picked) {
						if (p.path === e.path) continue;
						const linktext = app.metadataCache.fileToLinktext(p.file, file.path, true);
						changed = applyChange(fm, { op: "add-link", key: field.key, linktext, multiple: list, labelled: !!field.field?.labelled }) || changed;
					}
				} else {
					const matches = (linkpath: string) => {
						const dest = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
						return chosen.has(dest?.path ?? `?${linkpath.toLowerCase()}`);
					};
					changed = applyChange(fm, { op: "remove-link", key: field.key, matches }) || changed;
				}
				return changed;
			},
			(n, skipped) =>
				`${mode === "add" ? `Added ${names.join(", ")} to` : `Removed ${names.join(", ")} from`} ${field.label} on ${entitiesText(n)}${skipped + entities.length - hasField.length ? ` (${entitiesText(skipped + entities.length - hasField.length)} skipped)` : ""}.`,
		);
		onUndo(undo);
	};

	return (
		<div className="oe-bulk">
			<label className="oe-bulk-row">
				<span>Field</span>
				<select
					className="dropdown"
					value={key}
					aria-label="Relationship field"
					onChange={(e) => {
						setKey(e.target.value);
						setPicked([]);
						setChosen(new Set());
					}}
				>
					{fields.map((x) => (
						<option key={x.key} value={x.key}>
							{x.label}
						</option>
					))}
				</select>
			</label>
			{mode === "add" ? (
				<div className="oe-bulk-row">
					<span>Link to</span>
					<div className="oe-bulk-control">
						<div className="oe-bulk-chips">
							{picked.map((p) => (
								<span key={p.path} className="oe-pill">
									{p.name}
									<button className="clickable-icon" aria-label={`Remove ${p.name}`} onClick={() => setPicked((x) => x.filter((y) => y.path !== p.path))}>
										<Icon name="x" />
									</button>
								</span>
							))}
						</div>
						<input ref={input} type="text" placeholder={list ? "Search entities… (pick several)" : "Search entities…"} aria-label="Entity to link" />
						{!list && picked.length > 1 && <div className="oe-pop-hint">{field.label} holds one link: the last one picked replaces the others.</div>}
					</div>
				</div>
			) : (
				<div className="oe-bulk-row">
					<span>Remove</span>
					<div className="oe-bulk-control oe-bulk-checks">
						{existing.length === 0 && <div className="oe-pop-empty">None of the selected entities link to anything in {field.label}.</div>}
						{existing.map((x) => (
							<label key={x.key} className="oe-columns-item">
								<input type="checkbox" checked={chosen.has(x.key)} onChange={(e) => setChosen((s) => (e.target.checked ? new Set([...s, x.key]) : new Set([...s].filter((k) => k !== x.key))))} />
								<span className="oe-columns-label">{x.name}</span>
								<span className="oe-pop-hint">{x.count}</span>
							</label>
						))}
					</div>
				</div>
			)}
			<Footer hint={`${entitiesText(hasField.length)} have ${field.label}.`}>
				<button onClick={close}>Cancel</button>
				<button className="mod-cta" disabled={mode === "add" ? !picked.length : !chosen.size} onClick={() => void apply()}>
					{mode === "add" ? "Add links" : "Remove links"}
				</button>
			</Footer>
		</div>
	);
}

// ---------------------------------------------------------------- tags

function Tags({ plugin, entities, close, onUndo }: { plugin: EntitiesPlugin; entities: EntityRecord[]; close: () => void; onUndo: (u: BulkUndo | null) => void }) {
	const [add, setAdd] = useState<string[]>([]);
	const addRef = useRef<string[]>([]);
	const [remove, setRemove] = useState<Set<string>>(new Set());
	const current = useMemo(() => {
		const m = new Map<string, { tag: string; count: number }>();
		for (const e of entities)
			for (const t of e.tags) {
				const k = t.toLowerCase();
				const x = m.get(k) ?? { tag: t, count: 0 };
				x.count++;
				m.set(k, x);
			}
		return [...m.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
	}, [entities]);
	const apply = async () => {
		const adding = addRef.current;
		const removing = [...remove];
		close();
		const parts: string[] = [];
		if (adding.length) parts.push(describeChange({ op: "add-tags", tags: adding }, "", "", 0).replace(/ to 0 entities$/, ""));
		if (removing.length) parts.push(describeChange({ op: "remove-tags", tags: removing }, "", "", 0).replace(/ from 0 entities$/, "").replace(/^Removed/, adding.length ? "removed" : "Removed"));
		const undo = await plugin.bulk.updateFrontmatter(
			entities.map((e) => e.path),
			() => (fm) => {
				let changed = false;
				if (adding.length) changed = applyChange(fm, { op: "add-tags", tags: adding }) || changed;
				if (removing.length) changed = applyChange(fm, { op: "remove-tags", tags: removing }) || changed;
				return changed;
			},
			(n) => `${parts.join(", ")} on ${entitiesText(n)}.`,
		);
		onUndo(undo);
	};
	return (
		<div className="oe-bulk oe-form is-editing">
			<div className="oe-bulk-row">
				<span>Add</span>
				<div className="oe-prop-value oe-bulk-control">
					<ListControl
						value={add}
						editable
						label="Tags to add"
						tag
						onCommit={(v) => {
							const next = asArray(v).map(String);
							addRef.current = next;
							setAdd(next);
						}}
					/>
				</div>
			</div>
			<div className="oe-bulk-row">
				<span>Remove</span>
				<div className="oe-bulk-control oe-pop-pills">
					{current.length === 0 && <span className="oe-pop-empty">The selected entities have no tags.</span>}
					{current.map((t) => (
						<button
							key={t.tag}
							className={`oe-option${remove.has(t.tag) ? " is-active" : ""}`}
							aria-pressed={remove.has(t.tag)}
							onClick={() => setRemove((s) => (s.has(t.tag) ? new Set([...s].filter((x) => x !== t.tag)) : new Set([...s, t.tag])))}
						>
							#{t.tag} <span className="oe-pop-hint">{t.count}</span>
						</button>
					))}
				</div>
			</div>
			<Footer hint="Tags are matched ignoring case and #.">
				<button onClick={close}>Cancel</button>
				<button className="mod-cta" disabled={!add.length && !remove.size} onClick={() => window.setTimeout(() => void apply(), 0)}>
					Apply to {entitiesText(entities.length)}
				</button>
			</Footer>
		</div>
	);
}

// ---------------------------------------------------------------- folders

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		private plugin: EntitiesPlugin,
		private onChoose: (folder: TFolder) => void,
		placeholder: string,
	) {
		super(plugin.app);
		this.setPlaceholder(placeholder);
	}

	getItems(): TFolder[] {
		return this.plugin.bulk.folders();
	}

	getItemText(f: TFolder): string {
		return f.isRoot() ? "/" : f.path;
	}

	onChooseItem(f: TFolder): void {
		this.onChoose(f);
	}
}

// ---------------------------------------------------------------- openers

type Opts = { plugin: EntitiesPlugin; entities: EntityRecord[]; onUndo: (u: BulkUndo | null) => void };

export const openSetField = ({ plugin, entities, onUndo }: Opts) =>
	new ReactModal(plugin, `Set a field on ${entitiesText(entities.length)}`, (close) => <SetField plugin={plugin} entities={entities} close={close} onUndo={onUndo} />, "oe-bulk-modal").open();

export const openLinks = ({ plugin, entities, onUndo }: Opts, mode: "add" | "remove") =>
	new ReactModal(
		plugin,
		`${mode === "add" ? "Add links to" : "Remove links from"} ${entitiesText(entities.length)}`,
		(close) => <Links plugin={plugin} entities={entities} mode={mode} close={close} onUndo={onUndo} />,
		"oe-bulk-modal",
	).open();

export const openTags = ({ plugin, entities, onUndo }: Opts) =>
	new ReactModal(plugin, `Tags on ${entitiesText(entities.length)}`, (close) => <Tags plugin={plugin} entities={entities} close={close} onUndo={onUndo} />, "oe-bulk-modal").open();
