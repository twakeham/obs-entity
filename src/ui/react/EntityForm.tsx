import { Menu, Modal, moment, Notice, Setting, type App, type TFile } from "obsidian";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { subtitleOf, urlHref } from "../../model/card";
import { entityProblems, otherKeys, otherKind, parseInput, usesOrder, type FieldProblem, type OtherKind } from "../../model/form";
import { editPattern, editText, formatValue, parseTyped, showDate } from "../../model/fieldFormats";
import { isEmptyValue } from "../../model/frontmatter";
import { asArray, parseLabelledEntry, parseLink } from "../../model/links";
import { addLink, type Edge, type RelationItem } from "../../model/relations";
import { calcCell, fieldColumn, formatCell, resolveColumn, typeViewDef, type ViewContext, type ViewRow } from "../../model/views";
import { COMMON_KEYS, isCalculated, isListValued, statusesFor, type EntityTypeDef, type FieldDef, type FieldKind, type RelationTarget } from "../../model/types";
import { fieldSlots, isNoteItem, NOTE_ITEMS, nodeKeys, normaliseLayout, readableOn, resolveLayout, slotHelp, slotLabel, tabsOnPath, walkLayout, type LabelPosition, type LayoutField, type LayoutFrame, type LayoutNode, type LayoutTab, type LayoutWhen } from "../../model/formLayout";
import { evalWhen, todayDays, whenText, type WhenContext } from "../../model/formConditions";
import type { EntityRecord } from "../../services/entityIndex";
import { CalendarPopover } from "./Calendar";
import { EntitySuggest, TypePickerModal } from "../components/entityPicker";
import { usePlugin, useRelationsVersion } from "./context";
import { statusTone } from "./EntityBits";
import { EntityChip } from "./EntityChip";
import { Icon } from "./Icon";
import { KIND_INFO } from "./types/editor";

/** live: Live Preview (editable); reading: Reading view (read-only until the pencil); preview: the type editor's preview */
export type FormMode = "live" | "reading" | "preview";

/** Labels and icons of the note items a layout can place. */
export const NOTE_ITEM_INFO: Record<string, { label: string; icon: string }> = {
	[NOTE_ITEMS.name]: { label: "Name", icon: "text-cursor-input" },
	[NOTE_ITEMS.type]: { label: "Type", icon: "shapes" },
	[NOTE_ITEMS.subtitle]: { label: "Subtitle", icon: "text" },
	[NOTE_ITEMS.typeSubtitle]: { label: "Type and subtitle", icon: "heading" },
	[NOTE_ITEMS.created]: { label: "Created", icon: "calendar-plus" },
	[NOTE_ITEMS.modified]: { label: "Modified", icon: "calendar-clock" },
};

/** "Other properties" open or closed, shared by all notes for the session. */
let othersOpenDefault = false;

/** Open form tabs per type, kept in the vault's local storage ("type:t0" → tab). */
const TABS_STORAGE = "obs-entities-form-tabs";
function rememberedTabs(app: App, typeKey: string): Record<string, number> {
	const all: unknown = app.loadLocalStorage(TABS_STORAGE);
	const out: Record<string, number> = {};
	if (all && typeof all === "object")
		for (const [k, v] of Object.entries(all as Record<string, unknown>)) if (k.startsWith(`${typeKey}:`) && typeof v === "number") out[k.slice(typeKey.length + 1)] = v;
	return out;
}
function rememberTab(app: App, typeKey: string, group: string, tab: number): void {
	const all: unknown = app.loadLocalStorage(TABS_STORAGE);
	app.saveLocalStorage(TABS_STORAGE, { ...(all && typeof all === "object" ? all : {}), [`${typeKey}:${group}`]: tab });
}

const basename = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/, "");
const Empty = () => <span className="oe-prop-empty">Empty</span>;

/** A calculated field's value as the form shows it. */
interface CalcShown {
	text: string;
	error?: string;
}

/** A calculated field's value: read-only; "—" with the reason on hover when it can't be worked out. */
function CalcValue({ shown }: { shown?: CalcShown }) {
	if (shown?.error)
		return (
			<span className="oe-prop-text oe-prop-calc is-error" aria-label={shown.error} title={shown.error}>
				—
			</span>
		);
	if (!shown?.text) return <Empty />;
	return <span className="oe-prop-text oe-prop-calc">{shown.text}</span>;
}

type Write = (key: string, value: unknown) => void;

/** The entity properties form for a note, shown in place of Obsidian's Properties block. */
export function EntityForm({ path, mode }: { path: string; mode: Exclude<FormMode, "preview"> }) {
	const plugin = usePlugin();
	useRelationsVersion();
	const [editing, setEditing] = useState(mode === "live");
	const entity = plugin.index.get(path);
	if (!entity) return null;
	return <FormView type={entity.type} fm={entity.frontmatter} path={path} file={entity.file} mode={mode} editing={editing} setEditing={setEditing} />;
}

/** Read-only form for the type editor's preview, filled with sample values. */
export function FormPreview({ type, fm, path }: { type: EntityTypeDef; fm: Record<string, unknown>; path: string }) {
	return <FormView type={type} fm={fm} path={path} file={null} mode="preview" editing={false} />;
}

interface FormViewProps {
	type: EntityTypeDef;
	fm: Record<string, unknown>;
	path: string;
	file: TFile | null;
	mode: FormMode;
	editing: boolean;
	setEditing?: (v: boolean) => void;
}

/** A value written by the form that the metadata cache hasn't caught up with yet. */
interface Pending {
	value: unknown;
	/** the saved value (JSON) when it was written: if the saved value changes to anything else, something else won */
	base: string | undefined;
}

const json = (v: unknown) => JSON.stringify(v);

/** The control for one of a type's fields (the properties form's, also used by the create dialog). */
export function fieldControl(
	f: FieldDef,
	o: { value: unknown; editable: boolean; path: string; type: EntityTypeDef; live: boolean; problems: FieldProblem[]; onCommit: (v: unknown) => void; placeholder?: string; rows?: number },
): ReactNode {
	const label = f.label || f.key;
	switch (f.kind) {
		case "relation":
			return (
				<RelationControl
					fieldKey={f.key}
					label={label}
					targets={f.targets}
					list={isListValued(f)}
					labelled={!!f.labelled}
					symmetric={!!f.symmetric}
					value={o.value}
					editable={o.editable}
					path={o.path}
					type={o.type}
					live={o.live}
					problems={o.problems}
					placeholder={o.placeholder}
					onCommit={o.onCommit}
				/>
			);
		case "boolean":
			return <CheckControl value={o.value} editable={o.editable} label={label} format={f.format} onCommit={o.onCommit} />;
		case "rollup":
		case "formula":
			// Worked out by the properties form (FormView); elsewhere (the create dialog) there's nothing to show yet.
			return <Empty />;
		case "select":
			return <SelectControl options={f.options ?? []} value={o.value} editable={o.editable} label={label} placeholder={o.placeholder} onCommit={o.onCommit} />;
		case "multiselect":
			return <MultiControl options={f.options ?? []} value={o.value} editable={o.editable} label={label} onCommit={o.onCommit} />;
		case "list":
			return <ListControl value={o.value} editable={o.editable} label={label} placeholder={o.placeholder} onCommit={o.onCommit} />;
		default:
			return <TextControl kind={f.kind} field={f} value={o.value} editable={o.editable} label={label} placeholder={o.placeholder} rows={o.rows} onCommit={o.onCommit} />;
	}
}

/** How a layout's frames and tabs behave where it's shown. Frames are keyed by path ("2.0.1"), tab groups by "t0", "t1"… */
export interface FrameControls {
	/** frames that are collapsed */
	closed: Set<string>;
	toggle: (frame: string) => void;
	/** whether a field in these keys has a problem (a dot on a collapsed frame's caption or another tab) */
	flagged: (keys: string[]) => boolean;
	/** which frames and tabs to show (default: all), e.g. the create dialog's */
	include?: (part: LayoutFrame | LayoutTab) => boolean;
	/** a tab group's open tab */
	tab: (group: string) => number;
	setTab: (group: string, tab: number) => void;
	/** whether a "show only when" holds (default: always) */
	shows?: (w: LayoutWhen) => boolean;
	/** show what conditions hide (to fix a problem in it), with why it's normally hidden */
	reveal?: (w: LayoutWhen) => string;
	/** the type's colour (a solid header in it picks readable text) */
	typeColor?: string;
}

/** The note on something shown only to fix a problem. */
const revealNote = (text: string) => (
	<div className="oe-form-revealed-note" role="note">
		<Icon name="eye-off" />
		<span>Normally hidden: shown only when {text}.</span>
	</div>
);

/** Frames that start collapsed, by path (for FrameControls.closed). */
export function startCollapsed(items: LayoutNode[]): Set<string> {
	const out = new Set<string>();
	walkLayout({ items }, (n, p) => n.kind === "frame" && n.collapsible && n.collapsed && out.add(p.join(".")));
	return out;
}

/** The tab group key (FrameControls.tab) and tab a field is in, if it's in one. */
export function tabOfKey(items: LayoutNode[], key: string): { group: string; tab: number } | null {
	const layout = { items };
	const slot = fieldSlots(layout).find((s) => s.field.key === key);
	const t = slot ? tabsOnPath(layout, slot.path)[0] : undefined;
	if (!t) return null;
	const top = Number(t.group);
	return { group: `t${items.slice(0, top).filter((n) => n.kind === "tabs").length}`, tab: t.tab };
}

type Rendered = { node: ReactNode; fields: boolean; shown: boolean };

/** Whether some rendered parts show: a field in them does, or (with no fields) something does. */
const anyShown = (rs: Rendered[]) => (rs.some((r) => r.fields) ? rs.some((r) => r.fields && r.shown) : rs.some((r) => r.shown));

/**
 * A layout's frames, columns, tabs and rows. `propFor` gives a property's row, or null when it's hidden (then frames,
 * columns and tabs with nothing shown are left out). Call it while rendering (not as a component), so hidden-row
 * counts add up. Every tab's rows are rendered (others hidden), so counts and lookups include them.
 */
export function layoutNodes(items: LayoutNode[], propFor: (key: string, slot?: LayoutField) => ReactNode | null, frames: FrameControls): ReactNode[] {
	let tabGroups = 0;
	const many = (nodes: LayoutNode[], prefix: number[]): Rendered[] => nodes.map((n, i) => one(n, [...prefix, i]));
	const one = (n: LayoutNode, path: number[]): Rendered => {
		const key = path.join(".");
		switch (n.kind) {
			case "heading":
			case "text":
				return { node: <div key={key} className={n.kind === "heading" ? "oe-form-heading" : "oe-form-note"}>{n.text}</div>, fields: false, shown: true };
			case "field": {
				const off = !!n.when && !!frames.shows && !frames.shows(n.when);
				if (off && !frames.reveal) return { node: null, fields: true, shown: false };
				const r = propFor(n.key, n);
				return {
					node:
						off && r ? (
							<div key={key} className="oe-form-revealed">
								{r}
								{revealNote(frames.reveal!(n.when!))}
							</div>
						) : (
							r
						),
					fields: true,
					shown: r !== null,
				};
			}
			case "columns": {
				// Empty columns (nothing shown) are left out, and the rest share the row.
				const cols = n.columns.map((c, ci) => ({ rs: many(c, [...path, ci]), w: n.widths?.[ci] ?? 1, ci }));
				const shown = cols.filter((c) => anyShown(c.rs));
				return {
					node: shown.length ? (
						<div key={key} className="oe-form-columns" style={{ gridTemplateColumns: shown.map((c) => `minmax(0, ${c.w}fr)`).join(" ") }}>
							{shown.map((c) => (
								<div key={c.ci} className="oe-form-column">
									{c.rs.filter((r) => r.shown).map((r) => r.node)}
								</div>
							))}
						</div>
					) : null,
					fields: cols.some((c) => c.rs.some((r) => r.fields)),
					shown: shown.length > 0,
				};
			}
			case "frame": {
				if (frames.include && !frames.include(n)) return { node: null, fields: false, shown: false };
				const off = !!n.when && !!frames.shows && !frames.shows(n.when);
				if (off && !frames.reveal) return { node: null, fields: true, shown: false };
				const rs = many(n.items, path);
				// A frame shows when a field in it does (or it has no fields, only text).
				if (rs.some((r) => r.fields) && !rs.some((r) => r.fields && r.shown)) return { node: null, fields: true, shown: false };
				const open = !n.collapsible || !frames.closed.has(key);
				const flagged = frames.flagged(nodeKeys(n.items));
				const icon = n.icon ? <Icon name={n.icon} className="oe-form-frame-icon" /> : null;
				const caption = n.caption ? (
					n.collapsible ? (
						<button type="button" className="oe-form-frame-caption is-toggle" aria-expanded={open} onClick={() => frames.toggle(key)}>
							<Icon name={open ? "chevron-down" : "chevron-right"} />
							{icon}
							<span>{n.caption}</span>
							{flagged && !open && <span className="oe-form-frame-dot" aria-label="A field in here has a problem" />}
						</button>
					) : (
						<div className="oe-form-frame-caption">
							{icon}
							<span>{n.caption}</span>
						</div>
					)
				) : null;
				// A coloured header uses the accent, else the type's colour, and replaces the accent stripe.
				const colour = n.color ?? (n.header ? "type" : undefined);
				const accent = colour ? (colour === "type" ? "var(--oe-type-color)" : colour) : undefined;
				const on = n.header === "solid" && colour ? readableOn(colour === "type" ? (frames.typeColor ?? "") : colour) : undefined;
				return {
					node: (
						<section
							key={key}
							className={`oe-form-frame${open ? "" : " is-closed"}${n.style ? ` is-${n.style}` : ""}${accent && !n.header ? " has-accent" : ""}${n.header && n.caption ? ` has-header is-header-${n.header}` : ""}`}
							style={accent ? ({ "--oe-frame-accent": accent, ...(on ? { "--oe-frame-on": on } : {}) } as CSSProperties) : undefined}
							data-frame={key}
						>
							{caption}
							{off && revealNote(frames.reveal!(n.when!))}
							{open && <div className="oe-form-rows">{rs.filter((r) => r.shown).map((r) => r.node)}</div>}
						</section>
					),
					fields: rs.some((r) => r.fields),
					shown: true,
				};
			}
			case "tabs": {
				const group = `t${tabGroups++}`;
				const tabOff = (t: LayoutTab) => !!t.when && !!frames.shows && !frames.shows(t.when);
				const tabs = n.tabs.map((t, ti) => ({ t, ti, rs: (!frames.include || frames.include(t)) && (!tabOff(t) || frames.reveal) ? many(t.items, [...path, ti]) : null }));
				const avail = tabs.filter((x): x is typeof x & { rs: Rendered[] } => !!x.rs && anyShown(x.rs));
				const fields = tabs.some((x) => x.rs?.some((r) => r.fields));
				if (!avail.length) return { node: null, fields, shown: false };
				const want = frames.tab(group);
				const cur = avail.some((x) => x.ti === want) ? want : avail[0].ti;
				const onKey = (e: KeyboardEvent<HTMLButtonElement>, at: number) => {
					if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
					e.preventDefault();
					const i = e.key === "Home" ? 0 : e.key === "End" ? avail.length - 1 : (at + (e.key === "ArrowLeft" ? -1 : 1) + avail.length) % avail.length;
					frames.setTab(group, avail[i].ti);
					(e.currentTarget.parentElement?.children[i] as HTMLElement | undefined)?.focus();
				};
				return {
					node: (
						<div key={key} className="oe-form-tabs" data-tabs={group}>
							<div className="oe-form-tabstrip" role="tablist">
								{avail.map((x, i) => (
									<button
										key={x.ti}
										type="button"
										role="tab"
										aria-selected={x.ti === cur}
										tabIndex={x.ti === cur ? 0 : -1}
										className={`oe-form-tab${x.ti === cur ? " is-active" : ""}`}
										data-tab={x.ti}
										onClick={() => frames.setTab(group, x.ti)}
										onKeyDown={(e) => onKey(e, i)}
									>
										{x.t.icon && <Icon name={x.t.icon} />}
										<span>{x.t.caption}</span>
										{x.ti !== cur && frames.flagged(nodeKeys(x.t.items)) && <span className="oe-form-frame-dot" aria-label="A field in here has a problem" />}
									</button>
								))}
							</div>
							{avail.map((x) => (
								<div key={x.ti} role="tabpanel" className="oe-form-tabpanel" data-tab={x.ti} hidden={x.ti !== cur}>
									{tabOff(x.t) && revealNote(frames.reveal!(x.t.when!))}
									{x.rs.filter((r) => r.shown).map((r) => r.node)}
								</div>
							))}
						</div>
					),
					fields,
					shown: true,
				};
			}
		}
		return { node: null, fields: false, shown: false };
	};
	return many(items, [])
		.filter((r) => r.shown)
		.map((r) => r.node);
}
/** A captioned frame of rows the layout doesn't define ("Other fields", the create dialog's "Required"). */
export function extraFrame(key: string, caption: string, rows: ReactNode[], cls = "is-other"): ReactNode {
	return (
		<section key={key} className={`oe-form-frame ${cls}`}>
			<div className="oe-form-frame-caption">{caption}</div>
			<div className="oe-form-rows">{rows}</div>
		</section>
	);
}

function FormView({ type, fm, path, file, mode, editing, setEditing }: FormViewProps) {
	const plugin = usePlugin();
	const editable = editing && mode !== "preview" && !!file;
	const [pending, setPending] = useState<Record<string, Pending>>({});
	const [collapsed, setCollapsed] = useState(mode !== "preview" && plugin.settings.formCollapsed);
	const [showEmpty, setShowEmpty] = useState(false);
	const [othersOpen, setOthersOpen] = useState(othersOpenDefault);
	/** adding a property the type doesn't define (from the ⋯ menu): shows "Other properties" even when it's empty */
	const [addingOther, setAddingOther] = useState(false);
	/** layout frames (by path) that are collapsed: those that start collapsed, until opened */
	const [closedFrames, setClosedFrames] = useState<Set<string>>(() => {
		const l = type.form?.layout ? normaliseLayout(type.form.layout) : null;
		return l ? startCollapsed(resolveLayout(l, type).items) : new Set();
	});
	/** after "N problems": show what conditions hide, so a problem in it can be fixed */
	const [reveal, setReveal] = useState(false);
	/** bumped when a rename is refused, so the name box shows the real name again */
	const [nameKey, setNameKey] = useState(0);
	/** each tab group's open tab, remembered per type (not in the type editor's preview) */
	const [openTabs, setOpenTabs] = useState<Record<string, number>>(() => (mode === "preview" ? {} : rememberedTabs(plugin.app, type.key)));
	const setTab = (group: string, tab: number) => {
		setOpenTabs((o) => ({ ...o, [group]: tab }));
		if (mode !== "preview") rememberTab(plugin.app, type.key, group, tab);
	};
	const rootRef = useRef<HTMLDivElement>(null);
	// Show written values until the saved copy has them (or another change to the same key wins), key by key.
	useEffect(
		() =>
			setPending((o) => {
				const next: Record<string, Pending> = {};
				let changed = false;
				for (const [k, p] of Object.entries(o)) {
					const saved = json(fm[k]);
					if (saved === json(p.value) || saved !== p.base) changed = true;
					else next[k] = p;
				}
				return changed ? next : o;
			}),
		[fm],
	);

	const values: Record<string, unknown> = { ...fm };
	for (const [k, p] of Object.entries(pending)) {
		if (p.value === undefined) delete values[k];
		else values[k] = p.value;
	}
	const get = (key: string) => values[key];
	const hold = (key: string, value: unknown) => setPending((o) => ({ ...o, [key]: { value, base: o[key]?.base ?? json(fm[key]) } }));

	const write: Write = (key, value) => {
		if (!file) return;
		hold(key, value);
		plugin.writeProperty(file, key, value).catch((e: Error) => new Notice(`Couldn't save ${key}: ${e.message}`));
	};

	// Checked against what's on screen, so fixes build on edits that haven't reached the index yet.
	const problems = mode === "preview" ? [] : entityProblems(type, values, plugin.checkContext(path));
	const problemsAt = (key: string) => problems.filter((p) => p.key === key);
	const fix = (p: FieldProblem) => p.fix && write(p.key, p.fix.value);
	// Once the problems are fixed, what conditions hide goes back to hidden.
	useEffect(() => {
		if (!problems.length) setReveal(false);
	}, [problems.length]);

	const jumpToProblem = () => {
		setCollapsed(false);
		setShowEmpty(true);
		setReveal(true);
		// Open collapsed frames, and the tab with the first problem, so its field is on screen.
		setClosedFrames(new Set());
		const l = type.form?.layout ? normaliseLayout(type.form.layout) : null;
		const items = l ? resolveLayout(l, type).items : [];
		const first = fieldSlots({ items })
			.map((s) => s.field.key)
			.find((k) => problemsAt(k).length > 0);
		const t = first ? tabOfKey(items, first) : null;
		if (t) setTab(t.group, t.tab);
		window.setTimeout(() => {
			const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>(".oe-status.is-invalid, .oe-prop.has-problem") ?? [])].filter((r) => r.offsetParent !== null);
			const row = rows.find((r) => r.dataset.key === first) ?? rows[0];
			if (!row) return;
			row.scrollIntoView({ block: "center" });
			(row.matches("select") ? row : row.querySelector<HTMLElement>(".oe-prop-value input, .oe-prop-value select, .oe-prop-value textarea, .oe-prop-value button, .oe-prop-value a"))?.focus();
		}, 0);
	};

	const toggleCollapsed = () => {
		const next = !collapsed;
		setCollapsed(next);
		plugin.settings.formCollapsed = next;
		void plugin.saveData(plugin.settings);
	};

	const changeType = () => {
		if (!file) return;
		new TypePickerModal(plugin, (t) => void plugin.factory.convertToEntity(file, t), plugin.settings.types.filter((t) => t.key !== type.key), `Change "${file.basename}" from ${type.name.toLowerCase()} to…`).open();
	};

	const headerMenu = (evt: MouseEvent) => {
		if (!file) return;
		const m = new Menu();
		m.addItem((i) => i.setTitle("Change type…").setIcon("repeat").onClick(changeType));
		m.addItem((i) =>
			i
				.setTitle("Add other property…")
				.setIcon("plus")
				.onClick(() => {
					if (!editable) setEditing?.(true);
					setCollapsed(false);
					setOthersOpen(true);
					setAddingOther(true);
				}),
		);
		m.addItem((i) => i.setTitle(`Configure the ${type.name} type`).setIcon("shapes").onClick(() => void plugin.activateTypes(type.key)));
		m.showAtMouseEvent(evt.nativeEvent);
	};

	// Ctrl/Cmd+Z undoes the last form edit, unless a text box has unsaved typing (then the browser undoes that).
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (!file || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
		const t = e.target as HTMLElement;
		if (t.dataset.dirty === "1") return;
		e.preventDefault();
		e.stopPropagation();
		const edit = plugin.undoProperty(file.path);
		if (edit) hold(edit.key, edit.before);
		else new Notice("Nothing to undo in the properties form.");
	};


	const isBlank = (kind: FieldKind | "order", raw: unknown) => isEmptyValue(raw) || (kind === "boolean" && raw !== true);
	const hideEmpty = !!type.form?.hideEmpty && !showEmpty;

	// ---- calculated fields: worked out from the index, with this note's values as shown
	const calcFields = type.fields.filter((f) => isCalculated(f));
	let viewCtx: ViewContext | undefined;
	const calc = new Map<string, CalcShown>();
	if (calcFields.length) {
		const data = plugin.viewData();
		// The type editor's preview edits a draft: use it in place of the saved type.
		const types = data.ctx.types.includes(type) ? data.ctx.types : [...data.ctx.types.filter((t) => t.key !== type.key), type];
		viewCtx = { ...data.ctx, types };
		const base = data.rows.find((r) => r.path === path);
		const status = values[COMMON_KEYS.status];
		const row: ViewRow = { ...(base ?? { path, name: basename(path), subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null }), type, status: typeof status === "string" && status ? status : null, frontmatter: values };
		for (const f of calcFields) {
			const cell = calcCell(row, f, viewCtx);
			const col = resolveColumn(fieldColumn(f.key), typeViewDef(type), viewCtx);
			calc.set(f.key, { text: formatCell(cell, col, undefined, viewCtx).text, ...(cell.error || col.invalid ? { error: cell.error ?? col.invalid } : {}) });
		}
	}
	const calcBlank = (key: string) => {
		const c = calc.get(key);
		return !c || (!c.text && !c.error);
	};
	let hidden = 0;
	/** A property's row, or null when it's hidden (empty, with "hide empty fields" on). `slot`: its place in a layout. */
	const rowFor = (key: string, kind: FieldKind | "order", node: ReactNode, opts: { label: string; icon: string; required?: boolean; desc?: string }, slot: LayoutField | undefined, rowEditable: boolean): ReactNode | null => {
		const ps = problemsAt(key);
		const blank = kind === "rollup" || kind === "formula" ? calcBlank(key) : isBlank(kind, get(key));
		if (hideEmpty && blank && ps.length === 0) {
			hidden++;
			return null;
		}
		return (
			<PropRow
				key={key}
				k={key}
				{...opts}
				label={slot?.caption || opts.label}
				problems={ps}
				empty={blank}
				editable={rowEditable}
				onFix={fix}
				labelPos={slot ? slotLabel(slot) : undefined}
				help={slotHelp(slot, opts.desc)}
				locked={!!slot?.readOnly}
			>
				{node}
			</PropRow>
		);
	};
	/** The row for a field or a built-in property (status, order, related, tags, aliases); null when hidden. */
	const propFor = (key: string, slot?: LayoutField): ReactNode | null => {
		if (isNoteItem(key)) return noteRow(key, slot);
		const ed = editable && !slot?.readOnly;
		const ph = slot?.placeholder;
		const f = type.fields.find((x) => x.key === key);
		if (f && isCalculated(f)) return rowFor(f.key, f.kind, <CalcValue shown={calc.get(f.key)} />, { label: f.label || f.key, icon: KIND_INFO[f.kind].icon, desc: f.description }, slot, false);
		if (f)
			return rowFor(
				f.key,
				f.kind,
				fieldControl(f, { value: get(f.key), editable: ed, path, type, live: mode !== "preview", problems: problemsAt(f.key), onCommit: (v) => write(f.key, v), placeholder: ph, rows: slot?.rows }),
				{ label: f.label || f.key, icon: KIND_INFO[f.kind].icon, required: f.required, desc: f.description },
				slot,
				ed,
			);
		switch (key) {
			case COMMON_KEYS.status:
				return rowFor(COMMON_KEYS.status, "select", <StatusControl type={type} value={get(COMMON_KEYS.status)} editable={ed} problem={problemsAt(COMMON_KEYS.status)[0]} onCommit={(v) => write(COMMON_KEYS.status, v)} />, { label: "Status", icon: "circle-dot" }, slot, ed);
			case COMMON_KEYS.order:
				if (!usesOrder(type)) return null;
				return rowFor(
					COMMON_KEYS.order,
					"order",
					<TextControl kind="number" value={get(COMMON_KEYS.order)} editable={ed} label="Order" placeholder={ph} onCommit={(v) => write(COMMON_KEYS.order, v)} />,
					{ label: "Order", icon: "arrow-down-01", desc: "Sorts this note among its siblings in the browser." },
					slot,
					ed,
				);
			case COMMON_KEYS.related:
				return rowFor(
					COMMON_KEYS.related,
					"relation",
					<RelationControl
						fieldKey={COMMON_KEYS.related}
						label="Related"
						list
						labelled={false}
						symmetric
						value={get(COMMON_KEYS.related)}
						editable={ed}
						path={path}
						type={type}
						live={mode !== "preview"}
						problems={problemsAt(COMMON_KEYS.related)}
						placeholder={ph}
						onCommit={(v) => write(COMMON_KEYS.related, v)}
					/>,
					{ label: "Related", icon: "link-2", desc: "Links to any entity, shown on both notes." },
					slot,
					ed,
				);
			case COMMON_KEYS.tags:
				return rowFor(COMMON_KEYS.tags, "list", <ListControl value={get(COMMON_KEYS.tags)} editable={ed} label="Tags" tag placeholder={ph} onCommit={(v) => write(COMMON_KEYS.tags, v)} />, { label: "Tags", icon: "tags" }, slot, ed);
			case COMMON_KEYS.aliases:
				return rowFor(COMMON_KEYS.aliases, "list", <ListControl value={get(COMMON_KEYS.aliases)} editable={ed} label="Aliases" placeholder={ph} onCommit={(v) => write(COMMON_KEYS.aliases, v)} />, { label: "Aliases", icon: "forward" }, slot, ed);
		}
		return null;
	};	// ---- the note itself: its name (renames it), type, subtitle, created and modified
	const noteName = file?.basename ?? basename(path);
	const rename = async (to: string) => {
		const name = to.trim();
		if (!file || !name || name === file.basename) return;
		const refuse = (msg: string) => {
			new Notice(msg);
			setNameKey((n) => n + 1);
		};
		if (/[\\/:*?"<>|#^[\]]/.test(name)) return refuse(`A note's name can't contain \\ / : * ? " < > | # ^ [ or ].`);
		const dir = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
		const dest = `${dir}${name}.${file.extension}`;
		if (plugin.app.vault.getAbstractFileByPath(dest)) return refuse(`There's already a note called “${name}” here.`);
		try {
			await plugin.app.fileManager.renameFile(file, dest);
		} catch (e) {
			refuse(`Couldn't rename: ${(e as Error).message}`);
		}
	};
	const typeChip = (
		<span className="oe-form-type">
			<Icon name={type.icon} className="oe-chip-icon" />
			{type.name}
		</span>
	);
	const typeControl =
		file && mode !== "preview" ? (
			<button type="button" className="oe-form-type is-button" aria-label={`${type.name}: change type`} onClick={changeType}>
				<Icon name={type.icon} className="oe-chip-icon" />
				{type.name}
			</button>
		) : (
			typeChip
		);
	const stamp = (ms: number | undefined) => {
		if (!ms) return null;
		const d = new Date(ms);
		const days = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
		return (
			<span className="oe-prop-text" title={(moment as unknown as (t: number) => { fromNow(): string })(ms).fromNow()}>
				{showDate(days, plugin.settings.dateFormat, plugin.formatEnv())}, {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
			</span>
		);
	};
	/** A note item's row (null when it's hidden: an empty subtitle or date with "hide empty fields" on). */
	const noteRow = (key: string, slot?: LayoutField): ReactNode | null => {
		const sub = subtitleOf(type, values, plugin.formatEnv(), (f) => calc.get(f.key)?.text ?? "");
		let node: ReactNode;
		let blank = false;
		switch (key) {
			case NOTE_ITEMS.name:
				node = (
					<span className="oe-form-name">
						<TextControl key={`${noteName}:${nameKey}`} kind="text" value={noteName} editable={editable && !slot?.readOnly && !!file} label="Name" placeholder={slot?.placeholder} onCommit={(v) => void rename(String(v ?? ""))} />
					</span>
				);
				break;
			case NOTE_ITEMS.type:
				node = typeControl;
				break;
			case NOTE_ITEMS.subtitle:
				blank = !sub;
				node = sub ? <span className="oe-form-subtitle is-placed">{sub}</span> : <Empty />;
				break;
			case NOTE_ITEMS.typeSubtitle:
				node = (
					<span className="oe-form-typeline">
						{typeControl}
						{sub && <span className="oe-form-subtitle is-placed">{sub}</span>}
					</span>
				);
				break;
			case NOTE_ITEMS.created:
			case NOTE_ITEMS.modified: {
				const ms = key === NOTE_ITEMS.created ? file?.stat.ctime : file?.stat.mtime;
				blank = !ms;
				node = stamp(ms) ?? <Empty />;
				break;
			}
			default:
				return null;
		}
		if (hideEmpty && blank) {
			hidden++;
			return null;
		}
		const info = NOTE_ITEM_INFO[key];
		return (
			<PropRow
				key={key}
				k={key}
				label={slot?.caption || info.label}
				icon={info.icon}
				problems={[]}
				empty={blank}
				editable={editable}
				onFix={() => {}}
				labelPos={slot ? slotLabel(slot) : undefined}
				help={typeof slot?.help === "object" ? slot.help.text : undefined}
			>
				{node}
			</PropRow>
		);
	};

	/** Built-in properties in the order the form has always listed them after the fields. */
	const TAIL = [COMMON_KEYS.order, COMMON_KEYS.related, COMMON_KEYS.tags, COMMON_KEYS.aliases];

	const layout = type.form?.layout ? normaliseLayout(type.form.layout) : null;
	const resolved = layout ? resolveLayout(layout, type) : null;
	let body: ReactNode;
	if (!resolved) {
		// No layout: one list, in field order, then the built-ins.
		body = <div className="oe-form-rows">{[...type.fields.map((f) => propFor(f.key)), ...TAIL.map((k) => propFor(k))]}</div>;
	} else {
		const whenCtx: WhenContext = {
			types: plugin.settings.types,
			groups: plugin.settings.groups,
			dates: plugin.dates,
			today: todayDays(),
			resolve: (lp) => plugin.app.metadataCache.getFirstLinkpathDest(lp, path)?.path ?? null,
			// Conditions on calculated fields need the other notes.
			...(viewCtx ? { view: viewCtx, path } : {}),
		};
		const nodes = layoutNodes(resolved.items, propFor, {
			closed: closedFrames,
			toggle: (k) => setClosedFrames((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k]))),
			flagged: (keys) => keys.some((k) => problemsAt(k).length > 0),
			tab: (g) => openTabs[g] ?? 0,
			setTab,
			typeColor: type.color,
			shows: (w) => evalWhen(w, type, values, whenCtx),
			...(reveal && problems.length ? { reveal: (w: LayoutWhen) => whenText(w, type, whenCtx) } : {}),
		});
		// Fields that aren't placed: an "Other fields" section (only when something's in it).
		const others = layout!.hideUnplaced ? [] : resolved.unplaced.map((k) => propFor(k)).filter((r) => r !== null);
		if (others.length)
			nodes.push(
				<section key="other" className="oe-form-frame is-other">
					<div className="oe-form-frame-caption">Other fields</div>
					<div className="oe-form-rows">{others}</div>
				</section>,
			);
		// Built-ins that aren't placed stay where they've always been: after the fields (status: the header).
		const tail = TAIL.filter((k) => resolved.unplacedBuiltins.includes(k)).map((k) => propFor(k)).filter((r) => r !== null);
		if (tail.length) nodes.push(<div key="tail" className="oe-form-rows">{tail}</div>);
		body = <div className="oe-form-layout">{nodes}</div>;
	}

	const others = mode === "preview" ? [] : otherKeys(type, values);
	const subtitle = subtitleOf(type, values, plugin.formatEnv(), (f) => calc.get(f.key)?.text ?? "");
	const statusProblem = problemsAt(COMMON_KEYS.status)[0];

	return (
		<div
			ref={rootRef}
			className={`oe-form${collapsed ? " is-collapsed" : ""}${editable ? " is-editing" : ""}`}
			style={{ "--oe-type-color": type.color } as CSSProperties}
			data-entity-type={type.key}
			onKeyDown={onKeyDown}
		>
			<div className="oe-form-top">
				{!resolved?.placesType && typeChip}
				{!resolved?.placesStatus && <StatusControl type={type} value={get(COMMON_KEYS.status)} editable={editable} problem={statusProblem} onCommit={(v) => write(COMMON_KEYS.status, v)} />}
				{resolved?.placesSubtitle ? (
					<span className="oe-spacer" />
				) : (
					<span className="oe-form-subtitle" title={subtitle ?? undefined}>
						{subtitle}
					</span>
				)}
				{problems.length > 0 && (
					<button type="button" className="oe-form-problems" aria-label="Go to the first problem" onClick={jumpToProblem}>
						<Icon name="alert-circle" />
						{problems.length} {problems.length === 1 ? "problem" : "problems"}
					</button>
				)}
				{mode !== "preview" && (
					<span className="oe-form-actions">
						{mode === "reading" && setEditing && (
							<button type="button" className={`clickable-icon${editing ? " is-active" : ""}`} aria-label={editing ? "Done editing" : "Edit properties"} onClick={() => setEditing(!editing)}>
								<Icon name={editing ? "check" : "pencil"} />
							</button>
						)}
						<button type="button" className="clickable-icon" aria-label="Open connections panel" onClick={() => void plugin.activateSidePanel()}>
							<Icon name="waypoints" />
						</button>
						<button type="button" className="clickable-icon" aria-label="More options" onClick={headerMenu}>
							<Icon name="more-horizontal" />
						</button>
						<button type="button" className="clickable-icon oe-form-collapse" aria-label={collapsed ? "Show properties" : "Hide properties"} aria-expanded={!collapsed} onClick={toggleCollapsed}>
							<Icon name={collapsed ? "chevron-down" : "chevron-up"} />
						</button>
					</span>
				)}
			</div>
			{!collapsed && (
				<div className="oe-form-body">
					{body}
					{hidden > 0 && (
						<button type="button" className="oe-form-more" onClick={() => setShowEmpty(true)}>
							Show {hidden} empty {hidden === 1 ? "field" : "fields"}
						</button>
					)}
					{type.form?.hideEmpty && showEmpty && hidden === 0 && (
						<button type="button" className="oe-form-more" onClick={() => setShowEmpty(false)}>
							Hide empty fields
						</button>
					)}
					{(others.length > 0 || (addingOther && editable)) && (
						<div className={`oe-form-other${othersOpen ? " is-open" : ""}`}>
							<button
								type="button"
								className="oe-form-other-toggle"
								aria-expanded={othersOpen}
								onClick={() => {
									othersOpenDefault = !othersOpen;
									setOthersOpen(!othersOpen);
								}}
							>
								<Icon name={othersOpen ? "chevron-down" : "chevron-right"} />
								Other properties
								<span className="oe-form-count">{others.length}</span>
							</button>
							{othersOpen && (
								<div className="oe-form-rows">
									{others.map((k) => (
										<OtherRow key={k} k={k} value={get(k)} editable={editable} type={type} write={write} />
									))}
									{editable && <AddProperty key={addingOther ? "adding" : "idle"} existing={Object.keys(values)} onAdd={(k) => write(k, null)} startAdding={addingOther} onDone={() => setAddingOther(false)} />}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function PropRow({
	k,
	label,
	icon,
	required,
	desc,
	problems,
	empty,
	editable,
	onFix,
	menu,
	labelPos,
	help,
	locked,
	children,
}: {
	k: string;
	label: string;
	icon: string;
	required?: boolean;
	desc?: string;
	problems: FieldProblem[];
	empty: boolean;
	editable: boolean;
	onFix: (p: FieldProblem) => void;
	menu?: (evt: MouseEvent) => void;
	/** in a layout: the label above the value, beside it, or hidden (unset: the plain list's label | value row) */
	labelPos?: LabelPosition;
	/** text under the value (a slot's help text; the create dialog's descriptions), else the description is the label's tooltip */
	help?: string;
	/** read-only on this form: a lock by the label */
	locked?: boolean;
	children: ReactNode;
}) {
	const worst = problems.find((p) => p.severity === "error") ?? problems[0];
	return (
		<div
			className={`oe-prop${worst ? ` has-problem is-${worst.severity}` : ""}${empty ? " is-empty" : ""}${labelPos === "above" ? " is-label-above" : labelPos === "hidden" ? " is-label-hidden" : ""}${locked ? " is-locked" : ""}`}
			data-key={k}
		>
			<div className="oe-prop-label" aria-label={help ? undefined : desc}>
				<Icon name={icon} className="oe-prop-icon" />
				<span className="oe-prop-name">{label}</span>
				{required && (
					<span className="oe-prop-required" aria-label="Required">
						*
					</span>
				)}
				{locked && (
					<span className="oe-prop-lock" aria-label="Read-only on this form">
						<Icon name="lock" />
					</span>
				)}
			</div>
			<div className="oe-prop-value">
				{children}
				{help && <div className="oe-prop-desc">{help}</div>}
				{worst && (
					<span className="oe-prop-problem">
						<span className="oe-prop-problem-icon" aria-label={problems.map((p) => p.message).join("\n")}>
							<Icon name={worst.severity === "error" ? "alert-circle" : "alert-triangle"} />
						</span>
						{editable &&
							problems
								.filter((p) => p.fix)
								.map((p, i) => (
									<button key={i} type="button" className="oe-prop-fix" onClick={() => onFix(p)}>
										{p.fix!.label}
										{p.link ? ` (${basename(p.link)})` : ""}
									</button>
								))}
					</span>
				)}
			</div>
			{menu && (
				<button type="button" className="clickable-icon oe-prop-menu" aria-label={`${label} options`} onClick={menu}>
					<Icon name="more-horizontal" />
				</button>
			)}
		</div>
	);
}

export function StatusControl({ type, value, editable, problem, onCommit }: { type: EntityTypeDef; value: unknown; editable: boolean; problem?: FieldProblem; onCommit: (v: unknown) => void }) {
	const plugin = usePlugin();
	const options = statusesFor(type, plugin.settings.groups);
	const current = typeof value === "string" ? value : isEmptyValue(value) ? "" : String(value);
	const invalid = problem ? " is-invalid" : "";
	if (!editable) {
		return current ? (
			<span className={`oe-status-pill oe-tone-${statusTone(current)}${invalid}`} aria-label={problem?.message}>
				{current}
			</span>
		) : null;
	}
	const all = current && !options.includes(current) ? [current, ...options] : options;
	return (
		<select className={`oe-status dropdown oe-tone-${statusTone(current || null)}${invalid}`} value={current} aria-label={problem ? `Status: ${problem.message}` : "Status"} onChange={(e) => onCommit(e.target.value || null)}>
			{!current && <option value="">no status</option>}
			{all.map((s) => (
				<option key={s} value={s}>
					{options.includes(s) ? s : `${s} (not a status here)`}
				</option>
			))}
		</select>
	);
}

/**
 * Single-value text-like fields: saved on blur or Enter, Esc cancels. Invalid input isn't saved. Numbers, dates and
 * URLs show in their field's display format until you click in; then dates are typed in their format (or ISO) and
 * numbers as plain numbers (symbols and separators are tidied up).
 */
export function TextControl({
	kind,
	field,
	value,
	editable,
	label,
	placeholder,
	rows,
	onCommit,
}: {
	kind: "text" | "textarea" | "url" | "number" | "date";
	/** the type's field, for its display format (unset: other properties and built-ins) */
	field?: FieldDef;
	value: unknown;
	editable: boolean;
	label: string;
	/** grey text when empty (default "Empty"; dates show their format) */
	placeholder?: string;
	/** long text: a fixed height in lines (default: grows with the text) */
	rows?: number;
	onCommit: (v: unknown) => void;
}) {
	const plugin = usePlugin();
	const dates = plugin.dates;
	const env = plugin.formatEnv();
	const fmt = { kind, format: field?.format } as const;
	const formatted = kind === "number" || kind === "date" || kind === "url";
	const display = isEmptyValue(value) ? "" : Array.isArray(value) ? value.map(String).join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
	/** what the box starts with when you click in */
	const start = formatted && kind !== "url" ? editText(fmt, value, env) : display;
	/** what it shows otherwise */
	const shownValue = formatted ? formatValue(fmt, value, env) : display;
	const [text, setText] = useState(start);
	const [hasFocus, setHasFocus] = useState(false);
	const focused = useRef(false);
	const cancelled = useRef(false);
	const inputRef = useRef<HTMLInputElement>(null);
	/** dates: the calendar under the box is open (while it has focus, until a day is picked or Esc) */
	const [calOpen, setCalOpen] = useState(false);
	const shown = useRef(start);
	// Follow outside changes (sync, undo); while focused only if the box has no typing of its own.
	useEffect(() => {
		if (!focused.current || text === shown.current) setText(start);
		shown.current = start;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [start]);

	if (!editable) {
		if (!display) return <Empty />;
		if (kind === "url") {
			const href = urlHref(display);
			return href ? (
				<a className="external-link oe-prop-text" href={href} target="_blank" rel="noopener" title={shownValue !== display ? display : undefined}>
					{shownValue}
				</a>
			) : (
				<span className="oe-prop-text">{display}</span>
			);
		}
		return <span className={`oe-prop-text${kind === "textarea" ? " is-multiline" : ""}`}>{shownValue}</span>;
	}

	const read = (t: string) => (kind === "number" || kind === "date" ? parseTyped(fmt, t, env) : parseInput(kind, t, dates));
	const commit = (t: string) => {
		if (t === start) return;
		const r = read(t);
		if (!r.ok) {
			new Notice(`Not saved: ${r.error}`);
			setText(start);
			return;
		}
		onCommit(r.value);
	};
	// Dates with a calendar (the adapter can convert to and from YYYY-MM-DD).
	const calendar = kind === "date" && !!dates.toPicker && !!dates.fromPicker;
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if (calendar && e.altKey && e.key === "ArrowDown") {
			e.preventDefault();
			setCalOpen(true);
			return;
		}
		// The first Esc closes the calendar; the next cancels the typing.
		if (e.key === "Escape" && calOpen) {
			e.preventDefault();
			e.stopPropagation();
			setCalOpen(false);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			cancelled.current = true;
			e.currentTarget.blur();
		} else if (e.key === "Enter" && !e.nativeEvent.isComposing && (kind !== "textarea" || e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.currentTarget.blur();
		}
	};
	const props = {
		className: "oe-prop-input",
		"aria-label": label,
		value: hasFocus || !formatted ? text : shownValue,
		placeholder: kind === "date" ? editPattern(fmt, env) : placeholder || "Empty",
		"data-dirty": text !== start ? "1" : undefined,
		onChange: (e: { target: { value: string } }) => setText(e.target.value),
		onFocus: () => {
			focused.current = true;
			setHasFocus(true);
			if (calendar) setCalOpen(true);
		},
		onClick: () => {
			if (calendar) setCalOpen(true);
		},
		onBlur: () => {
			focused.current = false;
			setHasFocus(false);
			setCalOpen(false);
			if (cancelled.current) {
				cancelled.current = false;
				setText(start);
				return;
			}
			commit(text);
		},
		onKeyDown,
	};
	if (kind === "textarea") return <textarea {...props} rows={rows ?? Math.min(8, Math.max(1, text.split("\n").length))} />;
	const input = <input ref={inputRef} type="text" inputMode={kind === "number" ? "decimal" : kind === "url" ? "url" : undefined} {...props} />;
	if (calendar) {
		const { toPicker, fromPicker } = dates;
		const set = (v: string) => {
			setText(v);
			commit(v);
			setCalOpen(false);
		};
		// The calendar works in ISO days; the box in the field's edit format.
		const typed = read(text);
		const iso = typed.ok && typeof typed.value === "string" ? toPicker!.call(dates, typed.value) : null;
		return (
			<>
				{input}
				{calOpen && inputRef.current && (
					<CalendarPopover anchor={inputRef.current} value={iso} onPick={(d) => set(editText(fmt, fromPicker!.call(dates, d), env))} onClear={() => set("")} onClose={() => setCalOpen(false)} />
				)}
			</>
		);
	}
	if (kind === "url") {
		const href = urlHref(display);
		return (
			<span className="oe-prop-inline">
				{input}
				{href && (
					<a className="clickable-icon oe-prop-open" href={href} target="_blank" rel="noopener" aria-label="Open link">
						<Icon name="external-link" />
					</a>
				)}
			</span>
		);
	}
	return input;
}

/** A checkbox; read-only, it shows in the field's format (a ticked box, Yes / No, or ✓). */
export function CheckControl({ value, editable, label, format, onCommit }: { value: unknown; editable: boolean; label: string; format?: string; onCommit: (v: unknown) => void }) {
	if (!editable) {
		if (value !== true && value !== false) return <Empty />;
		if (format === "yesno") return <span className="oe-prop-text">{value ? "Yes" : "No"}</span>;
		if (format === "check") return value ? <span className="oe-prop-text">✓</span> : <Empty />;
		return <input type="checkbox" className="oe-prop-check" aria-label={label} checked={value === true} disabled />;
	}
	return <input type="checkbox" className="oe-prop-check" aria-label={label} checked={value === true} onChange={(e) => onCommit(e.target.checked)} />;
}
export function SelectControl({ options, value, editable, label, placeholder, onCommit }: { options: string[]; value: unknown; editable: boolean; label: string; placeholder?: string; onCommit: (v: unknown) => void }) {
	const current = isEmptyValue(value) ? "" : Array.isArray(value) ? String(value[0] ?? "") : String(value);
	if (!editable) return current ? <span className="oe-prop-text">{current}</span> : <Empty />;
	const all = current && !options.includes(current) ? [current, ...options] : options;
	return (
		<select className="dropdown oe-prop-select" aria-label={label} value={current} onChange={(e) => onCommit(e.target.value || null)}>
			<option value="">{placeholder || "—"}</option>
			{all.map((o) => (
				<option key={o} value={o}>
					{options.includes(o) ? o : `${o} (not an option)`}
				</option>
			))}
		</select>
	);
}

export function MultiControl({ options, value, editable, label, onCommit }: { options: string[]; value: unknown; editable: boolean; label: string; onCommit: (v: unknown) => void }) {
	const chosen = asArray(value).map(String);
	const extra = chosen.filter((c) => !options.includes(c));
	if (!editable) {
		return chosen.length ? (
			<span className="oe-prop-pills">
				{chosen.map((c) => (
					<span key={c} className="oe-pill">
						{c}
					</span>
				))}
			</span>
		) : (
			<Empty />
		);
	}
	const toggle = (o: string) => onCommit(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...options.filter((x) => x === o || chosen.includes(x)), ...extra]);
	return (
		<span className="oe-prop-options" role="group" aria-label={label}>
			{options.map((o) => (
				<button key={o} type="button" className={`oe-option${chosen.includes(o) ? " is-active" : ""}`} aria-pressed={chosen.includes(o)} onClick={() => toggle(o)}>
					{o}
				</button>
			))}
			{extra.map((o) => (
				<button key={`x:${o}`} type="button" className="oe-option is-active is-invalid" aria-label={`Remove “${o}” (not an option)`} onClick={() => onCommit(chosen.filter((x) => x !== o))}>
					{o} ×
				</button>
			))}
		</span>
	);
}

/**
 * Keyboard for chip rows: ←/→ move between chips and the add box, Backspace/Delete removes the focused chip,
 * Backspace in an empty add box removes the last chip.
 */
function chipKeys(remove: (chip: HTMLElement) => void) {
	return (e: KeyboardEvent<HTMLElement>) => {
		const container = e.currentTarget;
		const stops = Array.from(container.querySelectorAll<HTMLElement>(".oe-prop-chip > a.oe-chip, .oe-pill[tabindex], input.oe-prop-add"));
		const active = document.activeElement as HTMLElement | null;
		const i = active ? stops.indexOf(active) : -1;
		if (i < 0) return;
		const inInput = active instanceof HTMLInputElement;
		if (inInput && active.value) return;
		const chipOf = (el: HTMLElement) => el.closest<HTMLElement>("[data-chip]");
		const focusAfterRemoval = (idx: number) =>
			window.setTimeout(() => {
				const now = Array.from(container.querySelectorAll<HTMLElement>(".oe-prop-chip > a.oe-chip, .oe-pill[tabindex], input.oe-prop-add"));
				now[Math.min(idx, now.length - 1)]?.focus();
			}, 50);
		if (e.key === "ArrowLeft" && i > 0) {
			e.preventDefault();
			stops[i - 1].focus();
		} else if (e.key === "ArrowRight" && i < stops.length - 1 && !inInput) {
			e.preventDefault();
			stops[i + 1].focus();
		} else if ((e.key === "Backspace" || e.key === "Delete") && !inInput) {
			const chip = chipOf(active!);
			if (!chip) return;
			e.preventDefault();
			remove(chip);
			focusAfterRemoval(i);
		} else if (e.key === "Backspace" && inInput && i > 0) {
			const chip = chipOf(stops[i - 1]);
			if (!chip) return;
			e.preventDefault();
			remove(chip);
		}
	};
}

/** Free lists (list fields, tags, aliases): chips plus an add box (Enter or comma adds). */
export function ListControl({ value, editable, label, tag, placeholder, onCommit }: { value: unknown; editable: boolean; label: string; tag?: boolean; placeholder?: string; onCommit: (v: unknown) => void }) {
	const items = asArray(value).map(String);
	const [text, setText] = useState("");
	const show = (t: string) => (tag ? `#${t.replace(/^#/, "")}` : t);
	if (!editable) {
		return items.length ? (
			<span className="oe-prop-pills">
				{items.map((t, i) => (
					<span key={i} className={`oe-pill${tag ? " is-tag" : ""}`}>
						{show(t)}
					</span>
				))}
			</span>
		) : (
			<Empty />
		);
	}
	const clean = (s: string) => (tag ? s.trim().replace(/^#/, "") : s).trim();
	const add = (s: string) => {
		const parts = s
			.split(",")
			.map(clean)
			.filter((p, i, all) => p && !items.includes(p) && all.indexOf(p) === i);
		if (parts.length) onCommit([...items, ...parts]);
		setText("");
	};
	const removeAt = (i: number) => onCommit(items.filter((_, j) => j !== i));
	return (
		<span className="oe-prop-chips" onKeyDown={chipKeys((chip) => removeAt(Number(chip.dataset.chip)))}>
			{items.map((t, i) => (
				<span key={`${i}:${t}`} className={`oe-pill is-removable${tag ? " is-tag" : ""}`} data-chip={i} tabIndex={0} aria-label={`${show(t)}. Press Delete to remove.`}>
					{show(t)}
					<span className="oe-pill-x" role="button" aria-label={`Remove ${show(t)}`} onClick={() => removeAt(i)}>
						<Icon name="x" />
					</span>
				</span>
			))}
			<input
				className="oe-prop-add"
				value={text}
				placeholder={items.length ? "Add…" : placeholder || "Empty"}
				aria-label={`Add to ${label}`}
				data-dirty={text ? "1" : undefined}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if ((e.key === "Enter" || e.key === ",") && text.trim()) {
						e.preventDefault();
						add(text);
					} else if (e.key === "Escape") {
						setText("");
						e.currentTarget.blur();
					}
				}}
				onBlur={() => text.trim() && add(text)}
			/>
		</span>
	);
}

/** Ask for an optional label for a labelled link ("mentor"). Closing the dialog cancels. */
class LabelModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private done: (label: string | undefined) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		let value = "";
		new Setting(this.contentEl)
			.setName("Label")
			.setDesc("Optional, e.g. mentor or rival.")
			.addText((t) => {
				t.onChange((v) => (value = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						this.submit(value);
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText("Add link")
				.setCta()
				.onClick(() => this.submit(value)),
		);
	}

	private submit(v: string): void {
		this.close();
		this.done(v.trim() || undefined);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Show `message` with an Undo link. */
function undoNotice(message: string, undo: () => void): void {
	const frag = document.createDocumentFragment();
	frag.append(`${message} `);
	const a = frag.appendChild(document.createElement("a"));
	a.href = "#";
	a.textContent = "Undo";
	const notice = new Notice(frag, 8000);
	a.addEventListener("click", (e) => {
		e.preventDefault();
		notice.hide();
		undo();
	});
}

/**
 * Relation fields (and Related): chips for this note's links, chips for links set on other notes when the field
 * reads both ways, and a picker limited to the allowed types. A single-link field shows its picker only when it's empty.
 */
export function RelationControl({
	fieldKey,
	label,
	targets,
	list,
	labelled,
	symmetric,
	value,
	editable,
	path,
	type,
	live,
	problems,
	placeholder,
	onCommit,
}: {
	fieldKey: string;
	label: string;
	targets?: RelationTarget[];
	list: boolean;
	labelled: boolean;
	symmetric: boolean;
	value: unknown;
	editable: boolean;
	path: string;
	type: EntityTypeDef;
	/** a real note (not the type editor preview): include links set on other notes */
	live: boolean;
	problems: FieldProblem[];
	/** grey text in the picker when there are no links (default "Empty") */
	placeholder?: string;
	onCommit: (v: unknown) => void;
}) {
	const plugin = usePlugin();
	const { app } = plugin;
	const inputRef = useRef<HTMLInputElement>(null);
	const latest = useRef(value);
	latest.current = value;
	const related = fieldKey === COMMON_KEYS.related;

	const entries = asArray(value);
	const items: { index: number; item: RelationItem; name: string }[] = [];
	entries.forEach((raw, index) => {
		const parsed = labelled ? parseLabelledEntry(raw) : (() => {
			const link = parseLink(raw);
			return link ? { link, label: undefined as string | undefined } : null;
		})();
		if (!parsed) return;
		const target = app.metadataCache.getFirstLinkpathDest(parsed.link.path, path)?.path ?? null;
		const edge: Edge = {
			source: path,
			target,
			linktext: parsed.link.path,
			sourceType: type.key,
			fieldKey,
			fieldLabel: label,
			symmetric,
			labelled,
			label: parsed.label,
			related,
			targets,
		};
		items.push({ index, item: { path: target, linktext: parsed.link.path, direction: "out", edge }, name: target ? basename(target) : (parsed.link.path.split("/").pop() ?? parsed.link.path) });
	});
	const mine = new Set(items.map((x) => x.item.path).filter(Boolean));
	const incoming =
		live && symmetric
			? plugin.relations
					.incomingOf(path)
					.filter((e) => e.source !== path && !mine.has(e.source) && (related ? e.related : !e.related && e.symmetric && e.fieldKey === fieldKey))
					.filter((e, i, all) => all.findIndex((x) => x.source === e.source) === i)
			: [];

	const pick = (entity: EntityRecord) => {
		const linktext = app.metadataCache.fileToLinktext(entity.file, path, true);
		const finish = (lab?: string) => onCommit(addLink(latest.current, linktext, { multiple: list, labelled, label: lab }));
		if (labelled) new LabelModal(app, `${label}: ${entity.name}`, finish).open();
		else finish();
	};
	// The picker lives as long as the input; it reads the field's current settings (they change when the type is edited or the note changes type).
	const current = useRef({ pick, list, labelled, targets, related });
	current.current = { pick, list, labelled, targets, related };
	// A single link has no picker while it's set: remove it (×) first, then the picker appears, ready to type in.
	const showPicker = editable && (list || items.length === 0);
	const focusPicker = useRef(false);
	useEffect(() => {
		if (!showPicker || !inputRef.current) return;
		const suggest = new EntitySuggest(app, inputRef.current, plugin, {
			get targets() {
				return current.current.related ? undefined : current.current.targets;
			},
			exclude: () => {
				const { list: many, labelled: lab } = current.current;
				const paths = new Set<string>([path]);
				for (const raw of asArray(latest.current)) {
					const link = lab ? parseLabelledEntry(raw)?.link : parseLink(raw);
					const file = link ? app.metadataCache.getFirstLinkpathDest(link.path, path) : null;
					if (file && many) paths.add(file.path);
				}
				return paths;
			},
			onPick: (e) => current.current.pick(e),
		});
		return () => suggest.close();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [showPicker]);
	useEffect(() => {
		if (!focusPicker.current || !inputRef.current) return;
		focusPicker.current = false;
		inputRef.current.focus();
	});

	const removeAt = (index: number, name: string) => {
		const before = latest.current;
		const next = Array.isArray(before) ? before.filter((_, j) => j !== index) : list ? [] : null;
		if (!list) focusPicker.current = true;
		onCommit(next);
		undoNotice(`Removed ${name} from ${label}.`, () => onCommit(before));
	};
	const removeIncoming = (source: string) => {
		const edge = incoming.find((e) => e.source === source);
		if (edge) void plugin.factory.removeRelation(edge);
	};

	if (!editable && items.length === 0 && incoming.length === 0) return <Empty />;
	const problemFor = (linkpath: string) => problems.find((p) => p.link === linkpath);
	return (
		<span
			className="oe-prop-chips"
			onKeyDown={chipKeys((chip) => {
				if (chip.dataset.source) removeIncoming(chip.dataset.source);
				else {
					const x = items.find((it) => String(it.index) === chip.dataset.chip);
					if (x) removeAt(x.index, x.name);
				}
			})}
		>
			{items.map(({ index, item, name }) => {
				const p = problemFor(item.linktext);
				return (
					<span key={`o${index}`} className={`oe-prop-chip${p ? ` has-problem is-${p.severity}` : ""}`} data-chip={index} aria-label={p?.message}>
						<EntityChip item={item} sourcePath={path} onRemove={editable ? () => removeAt(index, name) : undefined} removeLabel={`Remove ${name}`} />
					</span>
				);
			})}
			{incoming.map((e) => (
				<span key={`i:${e.source}`} className="oe-prop-chip is-incoming" data-chip={`in:${e.source}`} data-source={e.source} aria-label={`Set on ${basename(e.source)}`}>
					<EntityChip
						item={{ path: e.source, linktext: e.source, direction: "in", edge: e }}
						sourcePath={path}
						onRemove={editable ? () => removeIncoming(e.source) : undefined}
						removeLabel={`Remove ${basename(e.source)} (edits ${basename(e.source)})`}
					/>
				</span>
			))}
			{showPicker && <input ref={inputRef} className="oe-prop-add" placeholder={items.length === 0 ? placeholder || "Empty" : "Add…"} aria-label={list ? `Add to ${label}` : `Choose ${label}`} />}
		</span>
	);
}

const OTHER_ICONS: Record<OtherKind, string> = { text: "type", number: "hash", boolean: "check-square", date: "calendar", list: "list" };

/** A property the type doesn't define, edited by its Obsidian property type (or its value's shape). */
function OtherRow({ k, value, editable, type, write }: { k: string; value: unknown; editable: boolean; type: EntityTypeDef; write: Write }) {
	const plugin = usePlugin();
	const kind = otherKind(value, plugin.propertyWidget(k));
	const commit = (v: unknown) => write(k, v);
	const complex = value !== null && typeof value === "object" && !Array.isArray(value);
	const control = complex ? (
		<span className="oe-prop-text oe-prop-code">{JSON.stringify(value)}</span>
	) : kind === "boolean" ? (
		<CheckControl value={value} editable={editable} label={k} onCommit={commit} />
	) : kind === "list" ? (
		<ListControl value={value} editable={editable} label={k} onCommit={commit} />
	) : (
		<TextControl kind={kind} value={value} editable={editable} label={k} onCommit={commit} />
	);
	const menu = (evt: MouseEvent) => {
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle(`Add to the ${type.name} type`)
				.setIcon("list-plus")
				.onClick(() => void plugin.addPropertyToType(type.key, k, value)),
		);
		m.addItem((i) =>
			i
				.setTitle("Remove")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => {
					write(k, undefined);
					undoNotice(`Removed the “${k}” property.`, () => write(k, value));
				}),
		);
		m.showAtMouseEvent(evt.nativeEvent);
	};
	return (
		<PropRow k={k} label={k} icon={OTHER_ICONS[kind]} problems={[]} empty={isEmptyValue(value)} editable={editable} onFix={() => {}} menu={editable ? menu : undefined}>
			{control}
		</PropRow>
	);
}

/** "Add property" for a property the type doesn't define; `startAdding`: open with the name box ready. */
function AddProperty({ existing, onAdd, startAdding, onDone }: { existing: string[]; onAdd: (key: string) => void; startAdding?: boolean; onDone?: () => void }) {
	const [adding, setAdding] = useState(!!startAdding);
	const [name, setName] = useState("");
	if (!adding) {
		return (
			<button type="button" className="oe-form-addprop" onClick={() => setAdding(true)}>
				<Icon name="plus" />
				Add property
			</button>
		);
	}
	const submit = () => {
		const k = name.trim();
		if (k && existing.includes(k)) {
			new Notice(`This note already has a “${k}” property.`);
			return;
		}
		if (k) onAdd(k);
		setName("");
		setAdding(false);
		onDone?.();
	};
	return (
		<input
			autoFocus
			className="oe-prop-input oe-form-addprop-input"
			placeholder="Property name"
			aria-label="New property name"
			value={name}
			data-dirty={name ? "1" : undefined}
			onChange={(e) => setName(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					submit();
				} else if (e.key === "Escape") {
					setName("");
					setAdding(false);
					onDone?.();
				}
			}}
			onBlur={submit}
		/>
	);
}
