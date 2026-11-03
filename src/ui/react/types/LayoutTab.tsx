import { FuzzySuggestModal, Menu, Modal, Notice, Scope, Setting, type App } from "obsidian";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as RFocusEvent, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../../main";
import { clipNodes, clipOfNode, clipOfTab, clipSummary, clipText, placeNode, placeTab, planPaste, preparePaste, readClip, type LayoutClip, type SavedComponent } from "../../../model/layoutClipboard";
import { newUid } from "../../../model/typeEditing";
import type { FieldDef } from "../../../model/types";
import {
	addTab,
	allLists,
	blankNode,
	canHold,
	childPath,
	fieldSlots,
	insertionPoint,
	insertNode,
	layoutFromFields,
	listItems,
	listKey,
	MAX_COLUMNS,
	MIN_COLUMNS,
	moveBy,
	moveNode,
	moveTab,
	nodeAt,
	normaliseLayout,
	parentList,
	parseListKey,
	placeableKeys,
	placeOf,
	readableOn,
	removeNode,
	removeTab,
	sameList,
	setColumnCount,
	slotHelp,
	slotLabel,
	isNoteItem,
	NOTE_ITEMS,
	READ_ONLY_ITEMS,
	slotProblems,
	tabsOnPath,
	ungroupFrame,
	updateNode,
	updateTab,
	type FormLayout,
	type LayoutColumns,
	type LayoutComponent,
	type LabelPosition,
	type LayoutField,
	type LayoutFrame,
	type LayoutList,
	type LayoutNode,
	type LayoutPath,
	type LayoutTab as LayoutTabDef,
	type LayoutTabs,
	type LayoutWhen,
	whenParts,
} from "../../../model/formLayout";
import { conditionProblems, todayDays, whenColumns, whenText, type WhenContext } from "../../../model/formConditions";
import { COMMON_KEYS } from "../../../model/types";
import { FiltersPanel, type ColumnChoice } from "../table/popovers";
import { PluginContext, usePlugin } from "../context";
import { Icon } from "../Icon";
import { IconPicker, Issues, PALETTE, Segmented, Toggle } from "./controls";
import { KIND_INFO, useEditor } from "./editor";

const BUILTINS: Record<string, { label: string; icon: string; kind: string; desc?: string }> = {
	[COMMON_KEYS.status]: { label: "Status", icon: "circle-dot", kind: "Status" },
	[COMMON_KEYS.related]: { label: "Related", icon: "link-2", kind: "Links to any entity", desc: "Links to any entity, shown on both notes." },
	[COMMON_KEYS.tags]: { label: "Tags", icon: "tags", kind: "Tags" },
	[COMMON_KEYS.aliases]: { label: "Aliases", icon: "forward", kind: "Other names" },
	[COMMON_KEYS.order]: { label: "Order", icon: "arrow-down-01", kind: "Number", desc: "Sorts this note among its siblings in the browser." },
	[NOTE_ITEMS.name]: { label: "Name", icon: "text-cursor-input", kind: "The note's name (renames it)" },
	[NOTE_ITEMS.type]: { label: "Type", icon: "shapes", kind: "Type" },
	[NOTE_ITEMS.subtitle]: { label: "Subtitle", icon: "text", kind: "Subtitle" },
	[NOTE_ITEMS.typeSubtitle]: { label: "Type + subtitle", icon: "heading", kind: "Type · subtitle" },
	[NOTE_ITEMS.created]: { label: "Created", icon: "calendar-plus", kind: "Date and time" },
	[NOTE_ITEMS.modified]: { label: "Modified", icon: "calendar-clock", kind: "Date and time" },
};

const TABS_ICON = "panels-top-left";

const COMPONENTS: { kind: LayoutComponent; label: string; icon: string; desc: string }[] = [
	{ kind: "frame", label: "Frame", icon: "square", desc: "A captioned box of rows" },
	{ kind: "columns2", label: "2 columns", icon: "columns-2", desc: "Fields or frames side by side" },
	{ kind: "columns3", label: "3 columns", icon: "columns-3", desc: "Fields or frames side by side" },
	{ kind: "columns4", label: "4 columns", icon: "columns-4", desc: "Fields or frames side by side" },
	{ kind: "tabs", label: "Tabs", icon: TABS_ICON, desc: "Tabs, one open at a time (top level only)" },
	{ kind: "heading", label: "Heading", icon: "heading", desc: "A caption between rows" },
	{ kind: "text", label: "Text", icon: "text", desc: "Help text between rows" },
];

const pk = (p: LayoutPath) => p.join(".");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isWithin = (path: LayoutPath, ancestor: LayoutPath) => path.length >= ancestor.length && ancestor.every((v, i) => path[i] === v);

/** Undo history per type, kept while switching tabs (dropped when the draft's layout changes elsewhere). */
interface History {
	past: (FormLayout | null)[];
	future: (FormLayout | null)[];
	/** the layout the history ends at, to tell whether it still applies */
	current: string;
	/** edits to the same box in quick succession are one undo step */
	tag?: string;
	/** when the last tagged edit was made */
	tagAt?: number;
}

/** Edits to the same box within this long of each other join one undo step. */
const JOIN_MS = 1500;
const histories = new Map<string, History>();

type TabRef = { group: LayoutPath; tab: number };
type DragSource = { from: "palette"; node: LayoutNode } | { from: "saved"; id: string; node: LayoutNode } | { from: "canvas"; path: LayoutPath; node: LayoutNode } | { from: "tab"; group: LayoutPath; tab: number };
type DropTarget = { list: LayoutList; index: number } | { remove: true } | { strip: LayoutPath; index: number };

/** Pick a property to place (Add field here…). */
class PlaceModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private keys: string[],
		private labelOf: (k: string) => string,
		private done: (k: string) => void,
	) {
		super(app);
		this.setPlaceholder("Add a field that isn't placed yet…");
	}
	getItems(): string[] {
		return this.keys;
	}
	getItemText(k: string): string {
		return this.labelOf(k);
	}
	onChooseItem(k: string): void {
		this.done(k);
	}
}

/** A question with a row of buttons (Esc: none of them). */
class AskModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private body: string,
		private buttons: { text: string; cta?: boolean; warning?: boolean; run: () => void }[],
	) {
		super(app);
	}
	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: this.body });
		const row = new Setting(this.contentEl);
		for (const b of this.buttons)
			row.addButton((btn) => {
				btn.setButtonText(b.text).onClick(() => {
					this.close();
					b.run();
				});
				if (b.cta) btn.setCta();
				if (b.warning) btn.setWarning();
			});
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

/** Name and icon for a saved component, with what's in it. */
function ComponentForm({ init, summary, onSave, onCancel }: { init: { name: string; icon: string }; summary: string; onSave: (v: { name: string; icon: string }) => void; onCancel: () => void }) {
	const [name, setName] = useState(init.name);
	const [icon, setIcon] = useState(init.icon);
	const save = () => name.trim() && onSave({ name: name.trim(), icon: icon || "package" });
	return (
		<div className="oe-ld-compform">
			<label className="oe-ld-compfield">
				<span>Name</span>
				<input
					type="text"
					autoFocus
					value={name}
					placeholder="e.g. Contact details"
					aria-label="Component name"
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							save();
						}
					}}
				/>
			</label>
			<div className="oe-ld-compfield">
				<span>Icon</span>
				<IconPicker value={icon} color="var(--text-normal)" onChange={setIcon} />
			</div>
			<div className="oe-ld-compsummary">
				<Icon name={icon || "package"} />
				<span>{summary}</span>
			</div>
			<div className="modal-button-container">
				<button onClick={onCancel}>Cancel</button>
				<button className="mod-cta" disabled={!name.trim()} onClick={save}>
					Save
				</button>
			</div>
		</div>
	);
}

class ComponentModal extends Modal {
	private root: Root | null = null;
	constructor(
		private plugin: EntitiesPlugin,
		private heading: string,
		private init: { name: string; icon: string },
		private summary: string,
		private done: (v: { name: string; icon: string }) => void,
	) {
		super(plugin.app);
	}
	onOpen(): void {
		this.setTitle(this.heading);
		this.modalEl.addClass("oe-ld-compmodal");
		this.root = createRoot(this.contentEl);
		this.root.render(
			<PluginContext.Provider value={this.plugin}>
				<ComponentForm
					init={this.init}
					summary={this.summary}
					onCancel={() => this.close()}
					onSave={(v) => {
						this.close();
						this.done(v);
					}}
				/>
			</PluginContext.Provider>,
		);
	}
	onClose(): void {
		this.root?.unmount();
		this.root = null;
	}
}

/** Palette sections that are folded away, per type, in the vault's local storage. */
const PALETTE_STORAGE = "obs-entities-layout-palette";
type PalSection = "fields" | "properties" | "readonly" | "saved" | "layout";
function foldedSections(app: App, typeKey: string | undefined): Set<PalSection> {
	const all: unknown = typeKey ? app.loadLocalStorage(PALETTE_STORAGE) : null;
	const list = all && typeof all === "object" ? (all as Record<string, unknown>)[typeKey!] : null;
	return new Set(Array.isArray(list) ? (list.filter((x) => typeof x === "string") as PalSection[]) : []);
}
function saveFolded(app: App, typeKey: string | undefined, folded: Set<PalSection>): void {
	if (!typeKey) return;
	const all: unknown = app.loadLocalStorage(PALETTE_STORAGE);
	const next: Record<string, unknown> = { ...(all && typeof all === "object" ? (all as Record<string, unknown>) : {}) };
	if (folded.size) next[typeKey] = [...folded];
	else delete next[typeKey];
	app.saveLocalStorage(PALETTE_STORAGE, next);
}

/**
 * The Layout tab: a palette (fields not placed yet, and components), a canvas laid out like the form, and the
 * selected part's settings. Drag to place and move; drag back to the palette (or Delete) to remove. Keyboard:
 * Alt+↑/↓ to move, the ⋯ menu to move elsewhere or add fields, Ctrl/Cmd+Z to undo.
 */
export function LayoutTab() {
	const plugin = usePlugin();
	const { draft, update, issuesAt, setTab, setFieldUid, groups, allTypes } = useEditor();
	const type = draft.type;
	const raw = type.form?.layout;
	const layout = useMemo(() => (raw ? normaliseLayout(raw) : null), [raw]);
	const base: FormLayout = layout ?? { items: [] };
	const histId = draft.original?.key ?? `new:${type.key}`;
	/** the selected node, or the selected tab (one or the other) */
	const [sel, setSel] = useState<LayoutPath | null>(null);
	const [selTab, setSelTab] = useState<TabRef | null>(null);
	/** each tab group's open tab on the canvas, by the group's path */
	const [openTabs, setOpenTabs] = useState<Record<string, number>>({});
	const [, setTick] = useState(0);
	const canvasRef = useRef<HTMLDivElement>(null);
	const paletteRef = useRef<HTMLDivElement>(null);
	/** a selector to focus after the next render */
	const focusNext = useRef<string | null>(null);
	const savedKey = draft.original?.key;
	const [folded, setFolded] = useState(() => foldedSections(plugin.app, savedKey));
	useEffect(() => setFolded(foldedSections(plugin.app, savedKey)), [plugin, savedKey]);
	const toggleSection = (id: PalSection) =>
		setFolded((cur) => {
			const next = new Set(cur);
			if (!next.delete(id)) next.add(id);
			saveFolded(plugin.app, savedKey, next);
			return next;
		});

	const selected = sel ? nodeAt(base, sel) : null;
	const selGroup = selTab ? nodeAt(base, selTab.group) : null;
	const selTabDef = selGroup?.kind === "tabs" ? selGroup.tabs[selTab!.tab] : undefined;
	useEffect(() => {
		if (sel && !selected) setSel(null);
		if (selTab && !selTabDef) setSelTab(null);
	}, [sel, selected, selTab, selTabDef]);
	useEffect(() => {
		const q = focusNext.current;
		if (!q) return;
		focusNext.current = null;
		const el = canvasRef.current?.querySelector<HTMLElement>(q);
		el?.focus();
		el?.scrollIntoView({ block: "nearest" });
	});
	const nodeSel = (p: LayoutPath) => `[data-ld-path="${pk(p)}"]`;
	const tabSel = (t: TabRef) => `[data-ld-tabhead="${pk(t.group)}:${t.tab}"]`;
	const openTab = (g: LayoutPath) => openTabs[pk(g)] ?? 0;
	const selectNode = (p: LayoutPath | null) => {
		setSel(p);
		setSelTab(null);
	};
	const selectTab = (t: TabRef) => {
		setSelTab(t);
		setSel(null);
		setOpenTabs((o) => ({ ...o, [pk(t.group)]: t.tab }));
	};
	/** open the tabs a node is inside, so it's on the canvas */
	const reveal = (l: FormLayout, p: LayoutPath) => {
		const ts = tabsOnPath(l, p);
		if (ts.length) setOpenTabs((o) => ({ ...o, ...Object.fromEntries(ts.map((t) => [t.group, t.tab])) }));
	};

	// ---- history
	const json = JSON.stringify(layout);
	const hist = (): History => {
		let h = histories.get(histId);
		if (!h || h.current !== json) {
			h = { past: [], future: [], current: json };
			histories.set(histId, h);
		}
		return h;
	};
	const write = (next: FormLayout | null) =>
		update((t) => {
			const f = { ...(t.form ?? {}) };
			if (next) f.layout = next;
			else delete f.layout;
			if (Object.keys(f).length) t.form = f;
			else delete t.form;
		});
	/** Change the layout (one undo step; `tag`: repeated edits of the same text box join one step). */
	const commit = (rawNext: FormLayout | null, opts: { select?: LayoutPath | null; tab?: TabRef; focus?: boolean; tag?: string; replace?: boolean } = {}) => {
		// Store layouts tidied, so the history matches what the draft reads back.
		const next = rawNext ? normaliseLayout(rawNext) : null;
		const h = hist();
		const nextJson = JSON.stringify(next);
		if (nextJson === h.current) return;
		const now = Date.now();
		// `replace`: this change stands in for the last step (e.g. a paste redone with its missing fields added).
		if (!opts.replace && (!opts.tag || h.tag !== opts.tag || now - (h.tagAt ?? 0) > JOIN_MS)) h.past.push(layout);
		h.future = [];
		h.tag = opts.tag;
		h.tagAt = now;
		h.current = nextJson;
		write(next);
		if (opts.tab) {
			selectTab(opts.tab);
			if (opts.focus) focusNext.current = tabSel(opts.tab);
		} else if (opts.select !== undefined) {
			selectNode(opts.select);
			if (opts.select && next) reveal(next, opts.select);
			if (opts.focus && opts.select) focusNext.current = nodeSel(opts.select);
		}
	};
	const undo = () => {
		const h = hist();
		if (!h.past.length) return;
		const prev = h.past.pop()!;
		h.future.push(layout);
		h.tag = undefined;
		h.current = JSON.stringify(prev);
		write(prev);
		setTick((n) => n + 1);
	};
	const redo = () => {
		const h = hist();
		if (!h.future.length) return;
		const next = h.future.pop()!;
		h.past.push(layout);
		h.tag = undefined;
		h.current = JSON.stringify(next);
		write(next);
		setTick((n) => n + 1);
	};
	const h = histories.get(histId);
	const canUndo = !!h && h.current === json && h.past.length > 0;
	const canRedo = !!h && h.current === json && h.future.length > 0;

	// ---- what's placed
	const placeable = placeableKeys(type);
	const placedAt = new Map<string, LayoutPath>();
	for (const s of fieldSlots(base)) if (!placedAt.has(s.field.key)) placedAt.set(s.field.key, s.path);
	const problems = slotProblems(base, type);
	const fieldOf = (k: string) => type.fields.find((f) => f.key === k);
	const labelOf = (k: string) => {
		const f = fieldOf(k);
		return f ? f.label || f.key : (BUILTINS[k]?.label ?? k);
	};
	/** the label a property has without a custom one */
	const baseLabel = labelOf;
	const descOf = (k: string) => fieldOf(k)?.description?.trim() || BUILTINS[k]?.desc || "";
	// ---- "show only when"
	const whenCtx: WhenContext = { types: allTypes, groups, dates: plugin.dates, today: todayDays() };
	const whenSummary = (w: LayoutWhen) => whenText(w, type, whenCtx);
	const whenBroken = (w: LayoutWhen) => conditionProblems(w, type, whenCtx).some((p) => !p.incomplete);
	const choices: ColumnChoice[] = whenColumns(type, whenCtx).map((col) => ({ col, group: col.def.kind === "field" ? "Fields" : "Properties" }));
	const viewCtx = useMemo(() => plugin.viewData().ctx, [plugin]);
	const valuesOf = (id: string) => (id === COMMON_KEYS.tags ? [...new Set(plugin.index.ofType(draft.original?.key ?? type.key).flatMap((e) => e.tags))].sort() : []);
	const whenEditor = (w: LayoutWhen | undefined, set: (w: LayoutWhen | undefined, tag?: string) => void, tag: string) => (
		<div className="oe-ld-when-editor">
			<FiltersPanel
				filters={w ? whenParts(w) : { mode: "all", items: [] }}
				choices={choices}
				ctx={viewCtx}
				valuesOf={valuesOf}
				noGroups
				heading="Show only when"
				emptyText="Always shown. Add a condition to show it only for some notes."
				onChange={(g) => {
					const items = g.items.filter((i): i is { field: string; op: string; value?: unknown } => !("items" in i));
					set(items.length ? (g.mode === "all" ? { all: items } : { any: items }) : undefined, tag);
				}}
			/>
		</div>
	);
	const whenBadge = (w: LayoutWhen | undefined) =>
		w ? (
			<span className={`oe-ld-badge is-when${whenBroken(w) ? " is-broken" : ""}`} title={`Shown only when ${whenSummary(w)}`}>
				<Icon name="eye" /> <span className="oe-ld-when-text">{whenSummary(w)}</span>
			</span>
		) : null;
	/** whether a property's control can show a placeholder (not checkboxes, dates, multiple choice or status) */
	const takesPlaceholder = (k: string) => {
		const f = fieldOf(k);
		return f ? !["boolean", "date", "multiselect", "rollup", "formula"].includes(f.kind) : isNoteItem(k) ? k === NOTE_ITEMS.name : k !== COMMON_KEYS.status;
	};
	const iconOf = (k: string) => {
		const f = fieldOf(k);
		return f ? KIND_INFO[f.kind].icon : (BUILTINS[k]?.icon ?? "help-circle");
	};
	const notPlaced = placeable.filter((k) => !placedAt.has(k));
	const unplacedFields = type.fields.filter((f) => !placedAt.has(f.key)).map((f) => f.key);

	// ---- edits
	const where = (node: LayoutNode) => insertionPoint(base, selTab ? selTab.group : sel, node, (g) => (selTab && pk(selTab.group) === pk(g) ? selTab.tab : openTab(g)));
	const add = (node: LayoutNode, at?: { list: LayoutList; index: number }) => {
		const w = at ?? where(node);
		const next = insertNode(base, w.list, w.index, node);
		if (next) commit(next, { select: childPath(w.list, Math.min(w.index, listItems(base, w.list).length)), focus: true });
	};
	const remove = (path: LayoutPath) => {
		const next = removeNode(base, path);
		const { list, index } = parentList(base, path);
		const left = listItems(next, list).length;
		const after = left ? childPath(list, Math.min(index, left - 1)) : list.at.length ? list.at : null;
		commit(next, { select: after, focus: !!after });
	};
	const move = (path: LayoutPath, to: LayoutList, index: number) => {
		const r = moveNode(base, path, to, index);
		if (r) commit(r.layout, { select: r.path, focus: true });
	};
	const change = (path: LayoutPath, fn: (n: LayoutNode) => LayoutNode, tag?: string) => commit(updateNode(base, path, fn), { tag });
	const changeTab = (t: TabRef, fn: (x: LayoutTabDef) => LayoutTabDef, tag?: string) => commit(updateTab(base, t.group, t.tab, fn), { tag });
	/** a tab group replaced by its tabs' contents, in order */
	const ungroupTabs = (group: LayoutPath): FormLayout => {
		const g = nodeAt(base, group);
		let l = base;
		if (g?.kind === "tabs") for (let t = g.tabs.length - 1; t >= 0; t--) l = removeTab(l, group, t, true);
		return l;
	};
	const dropTab = (t: TabRef, keep: boolean) => {
		const g = nodeAt(base, t.group) as LayoutTabs;
		const next = removeTab(base, t.group, t.tab, keep);
		if (g.tabs.length > 1) {
			const tab = Math.min(t.tab, g.tabs.length - 2);
			commit(next, { tab: { group: t.group, tab }, focus: true });
		} else commit(next, { select: null });
	};
	const shiftTab = (t: TabRef, to: TabRef & { index?: number }) => {
		const r = moveTab(base, t, { group: to.group, index: to.index ?? to.tab });
		if (r) commit(r.layout, { tab: { group: r.group, tab: r.tab }, focus: true });
	};

	// ---- copy, paste, duplicate, saved components
	/** the latest render's commit and layout, for actions that finish later (a notice's button, a dialog) */
	const live = useRef({ commit, base, update });
	live.current = { commit, base, update };
	const components: SavedComponent[] = plugin.settings.layoutComponents;
	const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? ""));
	const clipLabel = (clip: LayoutClip) => (k: string) => (fieldOf(k) || BUILTINS[k] ? labelOf(k) : clip.fields.find((f) => f.key === k)?.label || k);
	/** what's at a node or tab, as a copy */
	const clipAt = (path: LayoutPath | null, t: TabRef | null): LayoutClip | null => {
		if (t) {
			const g = nodeAt(base, t.group);
			return g?.kind === "tabs" && g.tabs[t.tab] ? clipOfTab(g.tabs[t.tab], type) : null;
		}
		const n = path ? nodeAt(base, path) : null;
		return n ? clipOfNode(n, type) : null;
	};
	const selectedClip = () => clipAt(selTab ? null : sel, selTab);
	const copy = async (clip: LayoutClip | null, cut?: () => void) => {
		if (!clip) return;
		try {
			await navigator.clipboard.writeText(clipText(clip));
		} catch {
			new Notice("Couldn't copy to the clipboard.");
			return;
		}
		cut?.();
		new Notice(`${cut ? "Cut" : "Copied"}: ${clipSummary(clip, clipLabel(clip))}`, 2500);
	};
	type Anchor = { path: LayoutPath | null; tab: TabRef | null };
	/** Where a paste goes: a tab into a tab group (after the anchor's tab); anything else like a palette click. */
	const pasteTarget = (clip: LayoutClip, at: { list: LayoutList; index: number } | undefined, anchor: Anchor): { group: LayoutPath; index: number } | { list: LayoutList; index: number } => {
		if (clip.tab && !at) {
			if (anchor.tab) return { group: anchor.tab.group, index: anchor.tab.tab + 1 };
			const n = anchor.path ? nodeAt(base, anchor.path) : null;
			if (n?.kind === "tabs") return { group: anchor.path!, index: n.tabs.length };
			if (anchor.path && anchor.path.length >= 2 && nodeAt(base, [anchor.path[0]])?.kind === "tabs") return { group: [anchor.path[0]], index: anchor.path[1] + 1 };
		}
		if (at) return at;
		const node = clipNodes(clip)[0];
		return insertionPoint(base, anchor.tab ? anchor.tab.group : anchor.path, node, (g) => (anchor.tab && pk(anchor.tab.group) === pk(g) ? anchor.tab.tab : openTab(g)));
	};
	/** Add fields a paste brought (as new fields of the draft). */
	const addFields = (fields: FieldDef[]) =>
		live.current.update((t, meta) => {
			for (const f of fields) {
				if (t.fields.some((x) => x.key === f.key)) continue;
				t.fields.push(JSON.parse(JSON.stringify(f)));
				meta.push({ uid: newUid(), origKey: null });
			}
		});
	const noticeWith = (text: string, action: string, run: () => void) => {
		const n = new Notice(
			createFragment((f) => {
				f.appendText(`${text} `);
				const a = f.createEl("a", { text: action, href: "#", cls: "oe-notice-action" });
				a.addEventListener("click", (e) => {
					e.preventDefault();
					n.hide();
					run();
				});
			}),
			12000,
		);
	};
	/**
	 * Paste a copy: its fields matched to this type's; fields already placed are moved here (when the user says so) or
	 * left out; fields this type doesn't have are left out, with "Add them" in a notice. One undo step.
	 */
	const paste = (clip: LayoutClip, opts: { at?: { list: LayoutList; index: number }; anchor?: Anchor; duplicate?: boolean } = {}) => {
		const plan = planPaste(clip, type, base);
		const target = pasteTarget(clip, opts.at, opts.anchor ?? { path: sel, tab: selTab });
		const before = base;
		const label = clipLabel(clip);
		/** place it on the layout as it was before the paste; returns the result's JSON, or null */
		const place = (move: boolean, add: boolean, replace: boolean): string | null => {
			const ready = preparePaste(clip, plan, { add, move });
			const moveKeys = move ? plan.placed : [];
			const { commit: doCommit } = live.current;
			if ("group" in target && ready.tab) {
				const tab = opts.duplicate ? { ...ready.tab, caption: `${ready.tab.caption} copy` } : ready.tab;
				const r = placeTab(before, target.group, target.index, tab, moveKeys);
				if (!r) return null;
				doCommit(r.layout, { tab: { group: r.group, tab: r.tab }, focus: true, replace });
				return JSON.stringify(normaliseLayout(r.layout));
			}
			const node: LayoutNode | undefined = ready.node ?? (ready.tab ? { kind: "tabs", tabs: [ready.tab] } : undefined);
			if (!node) {
				new Notice(opts.duplicate ? "A field can only be placed once, so there's nothing to duplicate." : `Nothing to paste: ${listNames(plan.placed.map(label))} ${plan.placed.length === 1 ? "is" : "are"} already in the layout.`);
				return null;
			}
			const at = "group" in target ? insertionPoint(before, null, node) : target;
			const r = placeNode(before, at.list, at.index, node, moveKeys);
			if (!r) {
				new Notice("That can't go here.");
				return null;
			}
			doCommit(r.layout, { select: r.path, focus: true, replace });
			return JSON.stringify(normaliseLayout(r.layout));
		};
		const run = (move: boolean) => {
			const after = place(move, false, false);
			if (after === null || !plan.missing.length) return;
			const names = plan.missing.map((f) => f.label || f.key);
			noticeWith(`${names.length === 1 ? "1 field isn't" : `${names.length} fields aren't`} in ${type.name || "this type"}: ${listNames(names)}.`, "Add them", () => {
				addFields(plan.missing);
				// Redo the paste with them, unless the layout has changed since.
				if (JSON.stringify(live.current.base) === after) place(move, true, true);
				else new Notice(`Added ${listNames(names)}. Place ${names.length === 1 ? "it" : "them"} from the palette.`);
			});
		};
		if (plan.placed.length && !opts.duplicate) {
			const names = plan.placed.map(label);
			const it = names.length === 1 ? "it" : "them";
			new AskModal(plugin.app, "Already in the layout", `${listNames(names)} ${names.length === 1 ? "is" : "are"} already in the layout. Move ${it} here with the copied settings, or leave ${it} out of the paste?`, [
				{ text: `Leave ${it} out`, run: () => run(false) },
				{ text: "Move here", cta: true, run: () => run(true) },
			]).open();
		} else run(false);
	};
	const pasteFromClipboard = async (anchor: Anchor, explain: boolean) => {
		let text = "";
		try {
			text = await navigator.clipboard.readText();
		} catch {
			// nothing readable
		}
		const clip = readClip(text);
		if (clip) paste(clip, { anchor });
		else if (explain) new Notice("The clipboard doesn't hold a copied layout item.");
	};
	/** A copy right after the item (fields already placed are left out). */
	const duplicate = (path: LayoutPath | null, t: TabRef | null) => {
		const clip = clipAt(path, t);
		if (!clip) return;
		if (t) paste(clip, { anchor: { path: null, tab: t }, duplicate: true });
		else if (path) {
			const { list, index } = parentList(base, path);
			paste(clip, { at: { list, index: index + 1 }, duplicate: true });
		}
	};
	const saveComponents = async (list: SavedComponent[]) => {
		plugin.settings.layoutComponents = list;
		await plugin.saveSettings();
		setTick((n) => n + 1);
	};
	const saveAsComponent = (clip: LayoutClip | null) => {
		if (!clip) return;
		const n = clip.node;
		const suggested = clip.tab?.caption ?? (n?.kind === "frame" ? n.caption : n?.kind === "heading" ? n.text : "") ?? "";
		const icon = clip.tab?.icon ?? (n?.kind === "frame" ? n.icon : undefined) ?? "package";
		new ComponentModal(plugin, "Save as component", { name: suggested, icon }, clipSummary(clip, clipLabel(clip)), (v) => {
			void saveComponents([...plugin.settings.layoutComponents, { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: v.name, icon: v.icon, clip }]);
			new Notice(`Saved “${v.name}” to My components.`);
		}).open();
	};
	const componentMenu = (c: SavedComponent, menu: Menu) => {
		const cur = selectedClip();
		menu.addItem((i) =>
			i
				.setTitle("Edit name and icon…")
				.setIcon("pencil")
				.onClick(() =>
					new ComponentModal(plugin, "Edit component", { name: c.name, icon: c.icon }, clipSummary(c.clip), (v) =>
						void saveComponents(plugin.settings.layoutComponents.map((x) => (x.id === c.id ? { ...x, ...v } : x))),
					).open(),
				),
		);
		menu.addItem((i) =>
			i
				.setTitle("Replace with selection")
				.setIcon("replace")
				.setDisabled(!cur)
				.onClick(() => {
					if (!cur) return;
					void saveComponents(plugin.settings.layoutComponents.map((x) => (x.id === c.id ? { ...x, clip: cur } : x)));
					new Notice(`“${c.name}” now holds: ${clipSummary(cur, clipLabel(cur))}`);
				}),
		);
		menu.addItem((i) =>
			i
				.setTitle("Copy")
				.setIcon("copy")
				.onClick(() => void copy(c.clip)),
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Delete")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() =>
					new AskModal(plugin.app, `Delete “${c.name}”?`, "It's removed from My components for every type. Layouts that used it keep their copy.", [
						{ text: "Cancel", run: () => {} },
						{ text: "Delete", warning: true, run: () => void saveComponents(plugin.settings.layoutComponents.filter((x) => x.id !== c.id)) },
					]).open(),
				),
		);
	};
	/** Copy, Cut, Paste, Duplicate and Save as component for a node or tab menu. */
	const clipboardItems = (menu: Menu, path: LayoutPath | null, t: TabRef | null, cut: () => void) => {
		menu.addItem((i) =>
			i
				.setTitle("Copy")
				.setIcon("copy")
				.onClick(() => void copy(clipAt(path, t))),
		);
		menu.addItem((i) =>
			i
				.setTitle("Cut")
				.setIcon("scissors")
				.onClick(() => void copy(clipAt(path, t), cut)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Paste")
				.setIcon("clipboard-paste")
				.onClick(() => void pasteFromClipboard({ path, tab: t }, true)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Duplicate")
				.setIcon("copy-plus")
				.onClick(() => duplicate(path, t)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Save as component…")
				.setIcon("package-plus")
				.onClick(() => saveAsComponent(clipAt(path, t))),
		);
		menu.addSeparator();
	};

	// ---- labels for lists (Move to…): e.g. Tab “Main” › “Overview” › column 2
	const crumbs = (list: LayoutList): string[] => {
		if (!list.at.length) return [];
		const o = nodeAt(base, list.at);
		const up = crumbs(parentList(base, list.at).list);
		if (o?.kind === "frame") return [...up, o.caption ? `“${o.caption}”` : "frame"];
		if (o?.kind === "tabs") return [...up, `tab “${o.tabs[list.slot!]?.caption}”`];
		return [...up, ...(list.at.length === 1 ? ["top-level columns"] : []), `column ${(list.slot ?? 0) + 1}`];
	};
	const listLabel = (l: LayoutList) => {
		const c = crumbs(l).join(" › ");
		return c ? c.charAt(0).toUpperCase() + c.slice(1) : "Top level";
	};
	const tabGroups = base.items.flatMap((n, i) => (n.kind === "tabs" ? [i] : []));

	const addFieldTo = (list: LayoutList) =>
		new PlaceModal(plugin.app, notPlaced, labelOf, (k) => add({ kind: "field", key: k }, { list, index: listItems(base, list).length })).open();

	const nodeMenu = (path: LayoutPath, menu: Menu) => {
		const node = nodeAt(base, path);
		if (!node) return;
		const { list, index } = parentList(base, path);
		const count = listItems(base, list).length;
		clipboardItems(menu, path, null, () => remove(path));
		menu.addItem((i) =>
			i
				.setTitle("Move up")
				.setIcon("arrow-up")
				.setDisabled(index === 0)
				.onClick(() => move(path, list, index - 1)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Move down")
				.setIcon("arrow-down")
				.setDisabled(index >= count - 1)
				.onClick(() => move(path, list, index + 2)),
		);
		const targets = allLists(base).filter((l) => !sameList(l, list) && !isWithin(l.at, path) && canHold(base, l, node));
		if (targets.length) {
			menu.addSeparator();
			for (const l of targets)
				menu.addItem((i) =>
					i
						.setTitle(`Move to ${listLabel(l)}`)
						.setIcon("corner-down-right")
						.onClick(() => move(path, l, listItems(base, l).length)),
				);
		}
		if ((node.kind === "frame" || node.kind === "columns" || node.kind === "tabs") && notPlaced.length) {
			menu.addSeparator();
			menu.addItem((i) =>
				i
					.setTitle("Add field here…")
					.setIcon("plus")
					.onClick(() =>
						new PlaceModal(plugin.app, notPlaced, labelOf, (k) => {
							const f: LayoutNode = { kind: "field", key: k };
							add(f, insertionPoint(base, path, f, openTab));
						}).open(),
					),
			);
		}
		menu.addSeparator();
		if (node.kind === "frame") {
			const kept = ungroupFrame(base, path);
			menu.addItem((i) =>
				i
					.setTitle("Remove frame, keep its contents")
					.setIcon("ungroup")
					.setDisabled(!kept)
					.onClick(() => kept && commit(kept, { select: node.items.length ? path : null, focus: node.items.length > 0 })),
			);
			menu.addItem((i) =>
				i
					.setTitle("Remove frame and its contents")
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => remove(path)),
			);
		} else if (node.kind === "tabs") {
			menu.addItem((i) =>
				i
					.setTitle("Remove tabs, keep their contents")
					.setIcon("ungroup")
					.onClick(() => commit(ungroupTabs(path), { select: null })),
			);
			menu.addItem((i) =>
				i
					.setTitle("Remove tabs and their contents")
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => remove(path)),
			);
		} else
			menu.addItem((i) =>
				i
					.setTitle(node.kind === "field" ? "Remove from layout" : "Remove")
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => remove(path)),
			);
	};
	const tabMenu = (t: TabRef, menu: Menu) => {
		const g = nodeAt(base, t.group) as LayoutTabs;
		clipboardItems(menu, null, t, () => dropTab(t, false));
		menu.addItem((i) =>
			i
				.setTitle("Move left")
				.setIcon("arrow-left")
				.setDisabled(t.tab === 0)
				.onClick(() => shiftTab(t, { group: t.group, tab: t.tab, index: t.tab - 1 })),
		);
		menu.addItem((i) =>
			i
				.setTitle("Move right")
				.setIcon("arrow-right")
				.setDisabled(t.tab >= g.tabs.length - 1)
				.onClick(() => shiftTab(t, { group: t.group, tab: t.tab, index: t.tab + 2 })),
		);
		const others = tabGroups.filter((i) => i !== t.group[0]);
		if (others.length) {
			menu.addSeparator();
			for (const i of others)
				menu.addItem((m) =>
					m
						.setTitle(`Move to tab group ${tabGroups.indexOf(i) + 1}`)
						.setIcon("corner-down-right")
						.onClick(() => {
							const dst = nodeAt(base, [i]) as LayoutTabs;
							shiftTab(t, { group: [i], tab: 0, index: dst.tabs.length });
						}),
				);
		}
		if (notPlaced.length) {
			menu.addSeparator();
			menu.addItem((i) =>
				i
					.setTitle("Add field here…")
					.setIcon("plus")
					.onClick(() => addFieldTo({ at: t.group, slot: t.tab })),
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Remove tab, keep its contents")
				.setIcon("ungroup")
				.onClick(() => dropTab(t, true)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Remove tab and its contents")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => dropTab(t, false)),
		);
	};
	const openMenu = (fill: (m: Menu) => void, at: { x: number; y: number }) => {
		const m = new Menu();
		fill(m);
		m.showAtPosition(at);
	};

	// ---- keyboard
	const onNodeKey = (e: RKeyboardEvent<HTMLElement>, path: LayoutPath) => {
		if (e.target !== e.currentTarget) return;
		const node = nodeAt(base, path);
		if (!node) return;
		const stop = () => {
			e.preventDefault();
			e.stopPropagation();
		};
		if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
			stop();
			const r = moveBy(base, path, e.key === "ArrowUp" ? -1 : 1);
			if (r) commit(r.layout, { select: r.path, focus: true });
		} else if (!e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
			stop();
			const all = [...(canvasRef.current?.querySelectorAll<HTMLElement>("[data-ld-path]") ?? [])];
			all[all.indexOf(e.currentTarget) + (e.key === "ArrowUp" ? -1 : 1)]?.focus();
		} else if (e.key === "Delete" || e.key === "Backspace") {
			stop();
			remove(path);
		} else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
			stop();
			const r = e.currentTarget.getBoundingClientRect();
			openMenu((m) => nodeMenu(path, m), { x: r.left + 16, y: r.top + 24 });
		} else if (e.key === "Escape") {
			e.stopPropagation();
			selectNode(null);
			e.currentTarget.blur();
		}
	};
	const onTabKey = (e: RKeyboardEvent<HTMLElement>, t: TabRef, count: number) => {
		const stop = () => {
			e.preventDefault();
			e.stopPropagation();
		};
		if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
			stop();
			const d = e.key === "ArrowLeft" ? -1 : 1;
			if (e.altKey) {
				const to = t.tab + d;
				if (to >= 0 && to < count) shiftTab(t, { group: t.group, tab: t.tab, index: d > 0 ? to + 1 : to });
				return;
			}
			const next = { group: t.group, tab: (t.tab + d + count) % count };
			selectTab(next);
			focusNext.current = tabSel(next);
		} else if (e.key === "Delete" || e.key === "Backspace") {
			stop();
			dropTab(t, true);
		} else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
			stop();
			const r = e.currentTarget.getBoundingClientRect();
			openMenu((m) => tabMenu(t, m), { x: r.left + 8, y: r.bottom + 4 });
		}
	};
	const onRootKey = (e: RKeyboardEvent<HTMLElement>) => {
		const t = e.target as HTMLElement;
		if (t.matches("input, textarea, select, [contenteditable]")) return;
		const mod = e.ctrlKey || e.metaKey;
		if (mod && !e.altKey && e.key.toLowerCase() === "z") {
			e.preventDefault();
			e.stopPropagation();
			if (e.shiftKey) redo();
			else undo();
		} else if (mod && !e.altKey && e.key.toLowerCase() === "y") {
			e.preventDefault();
			e.stopPropagation();
			redo();
		} else if (mod && !e.altKey && !e.shiftKey && ["c", "x", "v"].includes(e.key.toLowerCase())) {
			const k = e.key.toLowerCase();
			if (k === "v") {
				e.preventDefault();
				e.stopPropagation();
				void pasteFromClipboard({ path: sel, tab: selTab }, false);
				return;
			}
			const clip = selectedClip();
			if (!clip) return;
			e.preventDefault();
			e.stopPropagation();
			if (k === "c") void copy(clip);
			else void copy(clip, () => (selTab ? dropTab(selTab, false) : sel && remove(sel)));
		}
	};
	// Obsidian's hotkeys take Ctrl/Cmd+D before the view sees it, so while the designer has focus a keymap scope does.
	const rootRef = useRef<HTMLDivElement>(null);
	const dup = useRef(() => {});
	dup.current = () => duplicate(selTab ? null : sel, selTab);
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const scope = new Scope(plugin.app.scope);
		scope.register(["Mod"], "d", (e) => {
			if ((e.target as HTMLElement | null)?.matches?.("input, textarea, select, [contenteditable]")) return true;
			dup.current();
			return false;
		});
		let pushed = false;
		const enter = () => {
			if (pushed) return;
			plugin.app.keymap.pushScope(scope);
			pushed = true;
		};
		const leave = (e: FocusEvent) => {
			if (!pushed || el.contains(e.relatedTarget as Node | null)) return;
			plugin.app.keymap.popScope(scope);
			pushed = false;
		};
		el.addEventListener("focusin", enter);
		el.addEventListener("focusout", leave);
		return () => {
			el.removeEventListener("focusin", enter);
			el.removeEventListener("focusout", leave);
			if (pushed) plugin.app.keymap.popScope(scope);
		};
	}, [plugin]);

	// ---- dragging (pointer events, so it works with mouse, pen and touch)
	const [dragging, setDragging] = useState<DragSource | null>(null);
	const [drop, setDrop] = useState<DropTarget | null>(null);
	const drag = useRef<{
		src: DragSource;
		el: HTMLElement;
		x0: number;
		y0: number;
		x: number;
		y: number;
		dx: number;
		dy: number;
		touch: boolean;
		active: boolean;
		timer: number;
		ghost: HTMLElement | null;
		frame: number;
		/** a tab header being hovered (it opens after a moment) */
		hover: string | null;
		hoverTimer: number;
	} | null>(null);
	const justDragged = useRef(false);

	const targetAt = (x: number, y: number): DropTarget | null => {
		const d = drag.current;
		if (!d) return null;
		const hit = document.elementFromPoint(x, y);
		if (!hit) return null;
		const src = d.src;
		if (src.from === "canvas" && paletteRef.current?.contains(hit)) return { remove: true };
		if (!canvasRef.current?.contains(hit)) return null;
		if (src.from === "tab") {
			const strip = hit.closest<HTMLElement>("[data-ld-strip]");
			if (!strip) return null;
			const heads = [...strip.querySelectorAll<HTMLElement>(":scope > [data-ld-tabhead]")];
			let index = heads.length;
			for (let i = 0; i < heads.length; i++) {
				const r = heads[i].getBoundingClientRect();
				if (x < r.left + r.width / 2) {
					index = i;
					break;
				}
			}
			return { strip: strip.dataset.ldStrip!.split(".").map(Number), index };
		}
		const fits = (l: LayoutList) => canHold(base, l, src.node) && !(src.from === "canvas" && isWithin(l.at, src.path));
		// On a tab header: into that tab, at the end.
		const head = hit.closest<HTMLElement>("[data-ld-tabhead]");
		if (head) {
			const [g, t] = head.dataset.ldTabhead!.split(":");
			const l: LayoutList = { at: g.split(".").map(Number), slot: Number(t) };
			if (fits(l)) return { list: l, index: listItems(base, l).length };
		}
		let listEl = hit.closest<HTMLElement>("[data-ld-list]");
		while (listEl && canvasRef.current.contains(listEl)) {
			const list = parseListKey(listEl.dataset.ldList!);
			if (list && fits(list)) {
				const kids = [...listEl.querySelectorAll<HTMLElement>(":scope > [data-ld-path]")];
				let index = kids.length;
				for (let i = 0; i < kids.length; i++) {
					const r = kids[i].getBoundingClientRect();
					if (y < r.top + r.height / 2) {
						index = i;
						break;
					}
				}
				return { list, index };
			}
			listEl = listEl.parentElement?.closest<HTMLElement>("[data-ld-list]") ?? null;
		}
		return null;
	};
	const setTarget = (t: DropTarget | null) => setDrop((cur) => (JSON.stringify(cur) === JSON.stringify(t) ? cur : t));

	const autoScroll = () => {
		const d = drag.current;
		if (!d?.active) return;
		const sc = canvasRef.current;
		if (sc) {
			const r = sc.getBoundingClientRect();
			const edge = 40;
			const before = sc.scrollTop;
			if (d.y < r.top + edge) sc.scrollTop -= Math.ceil(((edge - Math.max(0, d.y - r.top)) / edge) * 14);
			else if (d.y > r.bottom - edge) sc.scrollTop += Math.ceil(((edge - Math.max(0, r.bottom - d.y)) / edge) * 14);
			if (sc.scrollTop !== before) setTarget(targetAt(d.x, d.y));
		}
		d.frame = requestAnimationFrame(autoScroll);
	};
	const startDrag = () => {
		const d = drag.current;
		if (!d || d.active) return;
		d.active = true;
		const r = d.el.getBoundingClientRect();
		const ghost = d.el.cloneNode(true) as HTMLElement;
		ghost.classList.add("oe-ld-ghost");
		ghost.classList.remove("is-selected");
		ghost.removeAttribute("data-ld-path");
		ghost.removeAttribute("data-ld-tabhead");
		ghost.style.width = `${Math.min(r.width, 360)}px`;
		ghost.style.left = `${d.x - Math.min(d.dx, 340)}px`;
		ghost.style.top = `${d.y - d.dy}px`;
		document.body.appendChild(ghost);
		d.ghost = ghost;
		window.getSelection()?.removeAllRanges();
		setDragging(d.src);
		setTarget(targetAt(d.x, d.y));
		d.frame = requestAnimationFrame(autoScroll);
	};
	const endDrag = (commitDrop: boolean) => {
		const d = drag.current;
		const target = commitDrop && d?.active ? targetAt(d.x, d.y) : null;
		drag.current = null;
		document.removeEventListener("pointermove", onMove);
		document.removeEventListener("pointerup", onUp);
		document.removeEventListener("pointercancel", onCancel);
		document.removeEventListener("touchmove", blockTouch);
		document.removeEventListener("keydown", onDragKey, true);
		if (!d) return;
		window.clearTimeout(d.timer);
		window.clearTimeout(d.hoverTimer);
		cancelAnimationFrame(d.frame);
		d.ghost?.remove();
		if (d.active) {
			justDragged.current = true;
			window.setTimeout(() => (justDragged.current = false), 0);
			setDragging(null);
			setDrop(null);
		}
		if (!target) return;
		const src = d.src;
		if ("remove" in target) {
			if (src.from === "canvas") remove(src.path);
		} else if ("strip" in target) {
			if (src.from === "tab") shiftTab(src, { group: target.strip, tab: 0, index: target.index });
		} else if (src.from === "canvas") move(src.path, target.list, target.index);
		else if (src.from === "palette") add(src.node, target);
		else if (src.from === "saved") {
			const c = components.find((x) => x.id === src.id);
			if (c) paste(c.clip, { at: target });
		}
	};
	const onMove = (e: PointerEvent) => {
		const d = drag.current;
		if (!d) return;
		d.x = e.clientX;
		d.y = e.clientY;
		if (!d.active) {
			const far = Math.hypot(d.x - d.x0, d.y - d.y0);
			if (d.touch) {
				if (far > 8) endDrag(false);
			} else if (far > 5) startDrag();
			return;
		}
		if (d.ghost) {
			d.ghost.style.left = `${d.x - Math.min(d.dx, 340)}px`;
			d.ghost.style.top = `${d.y - d.dy}px`;
		}
		// Hovering over a tab header while dragging something into the layout opens that tab after a moment.
		if (d.src.from !== "tab") {
			const head = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>("[data-ld-tabhead]")?.dataset.ldTabhead ?? null;
			if (head !== d.hover) {
				window.clearTimeout(d.hoverTimer);
				d.hover = head;
				if (head) {
					const [g, t] = head.split(":");
					d.hoverTimer = window.setTimeout(() => setOpenTabs((o) => ({ ...o, [g]: Number(t) })), 500);
				}
			}
		}
		setTarget(targetAt(d.x, d.y));
	};
	const onUp = () => endDrag(true);
	const onCancel = () => endDrag(false);
	const blockTouch = (e: TouchEvent) => {
		if (drag.current?.active) e.preventDefault();
	};
	const onDragKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || !drag.current?.active) return;
		e.preventDefault();
		e.stopPropagation();
		endDrag(false);
	};
	const handlers = useRef({ endDrag });
	handlers.current = { endDrag };
	useEffect(() => () => handlers.current.endDrag(false), []);

	const startPointer = (e: RPointerEvent<HTMLElement>, src: DragSource) => {
		if (e.button !== 0 || (e.target as HTMLElement).closest("input, textarea, select, .oe-ld-more, .oe-ld-addtab")) return;
		e.stopPropagation();
		if (drag.current) endDrag(false);
		const rect = e.currentTarget.getBoundingClientRect();
		const touch = e.pointerType === "touch";
		drag.current = { src, el: e.currentTarget, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, touch, active: false, timer: 0, ghost: null, frame: 0, hover: null, hoverTimer: 0 };
		if (touch) drag.current.timer = window.setTimeout(startDrag, 350);
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onCancel);
		document.addEventListener("touchmove", blockTouch, { passive: false });
		document.addEventListener("keydown", onDragKey, true);
	};

	// ---- canvas
	const listDrop = drop && "list" in drop ? drop : null;
	const dropCls = (list: LayoutList, i: number, count: number) => {
		if (!listDrop || !sameList(listDrop.list, list)) return "";
		if (listDrop.index === i) return " is-drop-before";
		if (i === count - 1 && listDrop.index === count) return " is-drop-after";
		return "";
	};
	const listCls = (list: LayoutList, count: number) => (listDrop && sameList(listDrop.list, list) && count === 0 ? " is-drop-target" : "");
	const isDragged = (p: LayoutPath) => dragging?.from === "canvas" && pk(dragging.path) === pk(p);
	const isSel = (p: LayoutPath) => !!sel && pk(sel) === pk(p);

	const nodeProps = (path: LayoutPath, node: LayoutNode, cls: string, list: LayoutList, i: number, count: number) => ({
		"data-ld-path": pk(path),
		"data-kind": node.kind,
		tabIndex: 0,
		className: `oe-ld-node ${cls}${isSel(path) ? " is-selected" : ""}${isDragged(path) ? " is-dragging" : ""}${dropCls(list, i, count)}`,
		"aria-selected": isSel(path),
		onFocus: (e: RFocusEvent) => {
			e.stopPropagation();
			selectNode(path);
		},
		onClick: (e: RMouseEvent) => {
			e.stopPropagation();
			if (!justDragged.current) selectNode(path);
		},
		onContextMenu: (e: RMouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			selectNode(path);
			openMenu((m) => nodeMenu(path, m), { x: e.clientX, y: e.clientY });
		},
		onKeyDown: (e: RKeyboardEvent<HTMLElement>) => onNodeKey(e, path),
	});
	const moreBtn = (label: string, fill: (m: Menu) => void, onOpen: () => void) => (
		<button
			type="button"
			className="clickable-icon oe-ld-more"
			aria-label={`${label}: options`}
			tabIndex={-1}
			onClick={(e) => {
				e.stopPropagation();
				onOpen();
				const r = e.currentTarget.getBoundingClientRect();
				openMenu(fill, { x: r.left, y: r.bottom + 4 });
			}}
		>
			<Icon name="more-horizontal" />
		</button>
	);
	const nodeMore = (path: LayoutPath, label: string) => moreBtn(label, (m) => nodeMenu(path, m), () => selectNode(path));

	const renderList = (list: LayoutList, nodes: LayoutNode[], cls: string, empty: string) => (
		<div className={`oe-ld-list ${cls}${listCls(list, nodes.length)}`} data-ld-list={listKey(list)}>
			{nodes.map((n, i) => renderNode(n, childPath(list, i), list, i, nodes.length))}
			{!nodes.length && <div className="oe-ld-empty">{empty}</div>}
		</div>
	);

	const renderNode = (n: LayoutNode, path: LayoutPath, list: LayoutList, i: number, count: number): ReactNode => {
		const key = pk(path);
		switch (n.kind) {
			case "field": {
				const def = fieldOf(n.key);
				const problem = problems.get(key);
				const label = labelOf(n.key);
				const pos = slotLabel(n);
				const p = nodeProps(path, n, `oe-ld-field${pos === "beside" ? " is-beside" : pos === "hidden" ? " is-label-hidden" : ""}${problem ? " has-problem" : ""}`, list, i, count);
				const kind = def ? KIND_INFO[def.kind].label : (BUILTINS[n.key]?.kind ?? "");
				const help = slotHelp(n, descOf(n.key));
				return (
					<div key={key} {...p} onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: n })} title={problem}>
						<span className="oe-ld-label">
							<Icon name={problem ? "alert-triangle" : iconOf(n.key)} />
							<span className="oe-ld-label-text">{n.caption || label}</span>
							{def?.required && <span className="oe-prop-required">*</span>}
							{n.label === "hidden" && <Icon name="eye-off" className="oe-ld-flag" />}
							{n.readOnly && <Icon name="lock" className="oe-ld-flag" />}
						</span>
						{n.when && <span className="oe-ld-field-when">{whenBadge(n.when)}</span>}
						<span className={`oe-ld-control${n.placeholder && !problem ? " has-placeholder" : ""}`} style={n.rows ? { minHeight: `${Math.min(n.rows, 6) * 0.9 + 0.6}em` } : undefined}>
							{problem ?? n.placeholder ?? (n.rows ? `${kind} · ${n.rows} lines` : kind)}
						</span>
						{help && <span className="oe-ld-help">{help}</span>}
						{nodeMore(path, n.caption || label)}
					</div>
				);
			}
			case "heading":
			case "text": {
				const p = nodeProps(path, n, `oe-ld-${n.kind}`, list, i, count);
				return (
					<div key={key} {...p} onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: n })}>
						<span className="oe-ld-textval">{n.text || <span className="oe-ld-faint">{n.kind === "heading" ? "Empty heading" : "Empty text"}</span>}</span>
						{nodeMore(path, n.kind === "heading" ? "Heading" : "Text")}
					</div>
				);
			}
			case "columns": {
				const inner = placeOf(base, { at: path, slot: 0 }) === "inner-column";
				const p = nodeProps(path, n, "oe-ld-columns", list, i, count);
				return (
					<div key={key} {...p}>
						<div className="oe-ld-head" onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: n })}>
							<Icon name="grip-vertical" className="oe-ld-grip" />
							<Icon name={`columns-${n.columns.length}`} />
							<span className="oe-ld-head-text">{n.columns.length} columns</span>
							{n.widths && <span className="oe-ld-badge">{n.widths.join(" : ")}</span>}
							{nodeMore(path, "Columns")}
						</div>
						<div className="oe-ld-grid" style={{ gridTemplateColumns: n.columns.map((_, ci) => `minmax(0, ${n.widths?.[ci] ?? 1}fr)`).join(" ") }}>
							{n.columns.map((col, ci) => renderList({ at: path, slot: ci }, col, "oe-ld-column", inner ? "Drop fields here" : "Drop fields or frames here"))}
						</div>
					</div>
				);
			}
			case "frame": {
				const colour = n.color ?? (n.header ? "type" : undefined);
				const accent = colour ? (colour === "type" ? "var(--oe-type-color)" : colour) : undefined;
				const on = n.header === "solid" && colour ? readableOn(colour === "type" ? type.color : colour) : undefined;
				const p = nodeProps(path, n, `oe-ld-frame${n.style ? ` is-${n.style}` : ""}${n.color && !n.header ? " has-accent" : ""}${n.header ? ` has-header is-header-${n.header}` : ""}`, list, i, count);
				return (
					<section key={key} {...p} style={accent ? ({ "--oe-frame-accent": accent, ...(on ? { "--oe-frame-on": on } : {}) } as CSSProperties) : undefined}>
						<div className="oe-ld-head" onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: n })}>
							<Icon name="grip-vertical" className="oe-ld-grip" />
							{n.collapsible && <Icon name={n.collapsed ? "chevron-right" : "chevron-down"} />}
							{n.icon && <Icon name={n.icon} className="oe-ld-frame-icon" />}
							<span className="oe-ld-caption">{n.caption || <span className="oe-ld-faint">No caption</span>}</span>
							{whenBadge(n.when)}
							{n.create === false && (
								<span className="oe-ld-badge" title="Not in the create dialog">
									<Icon name="eye-off" /> Create dialog
								</span>
							)}
							{nodeMore(path, n.caption || "Frame")}
						</div>
						{renderList({ at: path }, n.items, "oe-ld-rows", "Drop fields, columns or text here")}
					</section>
				);
			}
			case "tabs": {
				const cur = Math.min(openTab(path), n.tabs.length - 1);
				const stripDrop = drop && "strip" in drop && pk(drop.strip) === key ? drop : null;
				const p = nodeProps(path, n, "oe-ld-tabs", list, i, count);
				return (
					<div key={key} {...p}>
						<div className="oe-ld-head" onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: n })}>
							<Icon name="grip-vertical" className="oe-ld-grip" />
							<Icon name={TABS_ICON} />
							<span className="oe-ld-head-text">Tabs</span>
							{nodeMore(path, "Tabs")}
						</div>
						<div className="oe-ld-strip" data-ld-strip={key} role="tablist">
							{n.tabs.map((t, ti) => {
								const ref = { group: path, tab: ti };
								const tabIsSel = !!selTab && pk(selTab.group) === key && selTab.tab === ti;
								const dragged = dragging?.from === "tab" && pk(dragging.group) === key && dragging.tab === ti;
								const line = stripDrop ? (stripDrop.index === ti ? " is-drop-before" : ti === n.tabs.length - 1 && stripDrop.index === n.tabs.length ? " is-drop-after" : "") : "";
								return (
									<button
										key={ti}
										type="button"
										role="tab"
										aria-selected={ti === cur}
										tabIndex={ti === cur ? 0 : -1}
										data-ld-tabhead={`${key}:${ti}`}
										className={`oe-ld-tabhead${ti === cur ? " is-open" : ""}${tabIsSel ? " is-selected" : ""}${dragged ? " is-dragging" : ""}${line}`}
										onPointerDown={(e) => startPointer(e, { from: "tab", group: path, tab: ti })}
										onClick={(e) => {
											e.stopPropagation();
											if (!justDragged.current) selectTab(ref);
										}}
										onFocus={(e) => e.stopPropagation()}
										onKeyDown={(e) => onTabKey(e, ref, n.tabs.length)}
										onContextMenu={(e) => {
											e.preventDefault();
											e.stopPropagation();
											selectTab(ref);
											openMenu((m) => tabMenu(ref, m), { x: e.clientX, y: e.clientY });
										}}
									>
										{t.icon && <Icon name={t.icon} />}
										<span>{t.caption}</span>
										{t.create === false && <Icon name="eye-off" className="oe-ld-tab-off" />}
										{t.when && (
											<span className="oe-ld-tab-when" title={`Shown only when ${whenSummary(t.when)}`}>
												<Icon name="eye" />
											</span>
										)}
									</button>
								);
							})}
							<button
								type="button"
								className="clickable-icon oe-ld-addtab"
								aria-label="Add a tab"
								onClick={(e) => {
									e.stopPropagation();
									const next = addTab(base, path);
									commit(next, { tab: { group: path, tab: n.tabs.length }, focus: true });
								}}
							>
								<Icon name="plus" />
							</button>
						</div>
						{renderList({ at: path, slot: cur }, n.tabs[cur].items, "oe-ld-tabbody", "Drop fields, frames or columns here")}
					</div>
				);
			}
		}
	};

	// ---- palette
	const paletteField = (k: string) => {
		const at = placedAt.get(k);
		const def = fieldOf(k);
		return (
			<button
				key={k}
				type="button"
				className={`oe-ld-pal-item${at ? " is-placed" : ""}`}
				data-key={k}
				title={at ? "Placed: click to find it" : "Drag onto the layout, or click to add it"}
				onPointerDown={at ? undefined : (e) => startPointer(e, { from: "palette", node: { kind: "field", key: k } })}
				onClick={() => {
					if (justDragged.current) return;
					if (at) {
						selectNode(at);
						reveal(base, at);
						focusNext.current = nodeSel(at);
						setTick((n) => n + 1);
					} else add({ kind: "field", key: k });
				}}
			>
				<Icon name={iconOf(k)} />
				<span className="oe-ld-pal-label">{labelOf(k)}</span>
				{def?.required && <span className="oe-prop-required">*</span>}
				{at && <Icon name="check" className="oe-ld-pal-check" />}
			</button>
		);
	};
	const builtinKeys = placeable.filter((k) => !fieldOf(k) && !READ_ONLY_ITEMS.includes(k));
	const fieldsLeft = notPlaced.filter((k) => fieldOf(k)).length;
	/** a folded section's note of what's in it */
	const placedOf = (keys: readonly string[]) => {
		const n = keys.filter((k) => placedAt.has(k)).length;
		return n ? `${n} of ${keys.length} placed` : `${keys.length} items`;
	};
	/** A palette section whose title folds it away (remembered per type). Counts show on Fields always, others when folded. */
	const palSection = (id: PalSection, title: string, note: string | null, body: ReactNode) => {
		const open = !folded.has(id);
		const shown = id === "fields" || !open ? note : null;
		return (
			<div className={`oe-ld-pal-section${open ? "" : " is-folded"}`} data-section={id}>
				<button type="button" className="oe-ld-pal-title" aria-expanded={open} onClick={() => toggleSection(id)}>
					<Icon name="chevron-right" className="oe-ld-pal-chevron" />
					<span className="oe-ld-pal-name">{title}</span>
					{shown && <span className="oe-tm-muted">{shown}</span>}
				</button>
				{open && body}
			</div>
		);
	};

	// ---- settings of the selection
	const props = (): ReactNode => {
		if (selTab && selTabDef) {
			const t = selTab;
			const def = selTabDef;
			return (
				<>
					<div className="oe-ld-props-title">
						<Icon name={def.icon || TABS_ICON} /> Tab
					</div>
					<label className="oe-ld-prop-col">
						<span>Caption</span>
						<LocalText value={def.caption} label="Tab caption" onChange={(v) => changeTab(t, (x) => ({ ...x, caption: v }), `tab:${pk(t.group)}:${t.tab}`)} />
					</label>
					<div className="oe-ld-prop-col">
						<span>Icon</span>
						<div className="oe-ld-iconrow">
							<IconPicker value={def.icon ?? ""} color="var(--text-muted)" empty="No icon" onChange={(v) => changeTab(t, (x) => ({ ...x, icon: v }))} />
							{def.icon && (
								<button type="button" onClick={() => changeTab(t, (x) => ({ ...x, icon: undefined }))}>
									No icon
								</button>
							)}
						</div>
					</div>
					<div className="oe-ld-prop-row">
						<span>Show in the create dialog</span>
						<Toggle label="Show in the create dialog" value={def.create !== false} onChange={(v) => changeTab(t, (x) => ({ ...x, create: v ? undefined : false }))} />
					</div>
					<p className="oe-tm-muted oe-ld-note">Required fields are always asked for when creating a note.</p>
					{whenEditor(def.when, (w, tag) => changeTab(t, (x) => ({ ...x, when: w }), tag), `when:tab:${pk(t.group)}:${t.tab}`)}
					<div className="oe-ld-prop-buttons">
						<button type="button" onClick={() => dropTab(t, true)}>
							<Icon name="ungroup" /> Remove tab, keep contents
						</button>
						<button type="button" className="mod-warning" onClick={() => dropTab(t, false)}>
							<Icon name="trash-2" /> Remove with contents
						</button>
					</div>
				</>
			);
		}
		if (!sel || !selected) {
			return (
				<>
					<div className="oe-ld-props-title">Layout</div>
					<p className="oe-tm-muted">Select a frame, columns, tab or field on the layout to change it.</p>
					{layout && (
						<>
							<div className="oe-ld-prop-row">
								<span>Hide fields that aren't placed</span>
								<Toggle label="Hide fields that aren't placed" value={!!layout.hideUnplaced} onChange={(v) => commit({ ...base, ...(v ? { hideUnplaced: true as const } : { hideUnplaced: undefined }) })} />
							</div>
							<p className="oe-tm-muted oe-ld-note">
								{unplacedFields.length
									? layout.hideUnplaced
										? `${plural(unplacedFields.length, "field")} not placed: they don't show on the form (notes keep their values).`
										: `${plural(unplacedFields.length, "field")} not placed: listed under “Other fields” at the end.`
									: "Every field is placed."}
							</p>
						</>
					)}
				</>
			);
		}
		const removeBtn = (label = "Remove") => (
			<button type="button" className="mod-warning" onClick={() => remove(sel)}>
				<Icon name="trash-2" /> {label}
			</button>
		);
		if (selected.kind === "frame") {
			const fr = selected;
			const kept = ungroupFrame(base, sel);
			const setFrame = (patch: Partial<LayoutFrame>) => change(sel, (n) => ({ ...(n as LayoutFrame), ...patch }));
			return (
				<>
					<div className="oe-ld-props-title">Frame</div>
					<label className="oe-ld-prop-col">
						<span>Caption</span>
						<LocalText value={fr.caption ?? ""} placeholder="No caption" label="Caption" onChange={(v) => change(sel, (n) => ({ ...(n as LayoutFrame), caption: v.trim() ? v : undefined }), `caption:${pk(sel)}`)} />
					</label>
					<div className="oe-ld-prop-row">
						<span>Can be collapsed</span>
						<Toggle label="Can be collapsed" value={!!fr.collapsible} onChange={(v) => change(sel, (n) => ({ ...(n as LayoutFrame), collapsible: v ? true : undefined, collapsed: undefined }))} />
					</div>
					<div className="oe-ld-prop-row">
						<span>Starts collapsed</span>
						<Toggle label="Starts collapsed" disabled={!fr.collapsible} value={!!fr.collapsed} onChange={(v) => change(sel, (n) => ({ ...(n as LayoutFrame), collapsed: v ? true : undefined }))} />
					</div>
					<div className="oe-ld-prop-row">
						<span>Show in the create dialog</span>
						<Toggle label="Show in the create dialog" value={fr.create !== false} onChange={(v) => change(sel, (n) => ({ ...(n as LayoutFrame), create: v ? undefined : false }))} />
					</div>
					<p className="oe-tm-muted oe-ld-note">Required fields are always asked for when creating a note.</p>
					<div className="oe-ld-prop-col">
						<span>Icon</span>
						<div className="oe-ld-iconrow">
							<IconPicker value={fr.icon ?? ""} color="var(--text-muted)" empty="No icon" onChange={(v) => setFrame({ icon: v })} />
							{fr.icon && (
								<button type="button" onClick={() => setFrame({ icon: undefined })}>
									No icon
								</button>
							)}
						</div>
					</div>
					<div className="oe-ld-prop-col">
						<span>Accent colour</span>
						<div className="oe-ld-swatches" role="radiogroup" aria-label="Accent colour">
							<button type="button" role="radio" aria-checked={!fr.color} aria-label="No accent" className={`oe-ld-swatch is-none${!fr.color ? " is-active" : ""}`} onClick={() => setFrame({ color: undefined })} />
							<button type="button" role="radio" aria-checked={fr.color === "type"} aria-label="The type's colour" className={`oe-ld-swatch is-type${fr.color === "type" ? " is-active" : ""}`} style={{ backgroundColor: type.color }} onClick={() => setFrame({ color: "type" })}>
								<Icon name={type.icon} />
							</button>
							{PALETTE.map((col) => (
								<button key={col} type="button" role="radio" aria-checked={fr.color === col} aria-label={col} className={`oe-ld-swatch${fr.color === col ? " is-active" : ""}`} style={{ backgroundColor: col }} onClick={() => setFrame({ color: col })} />
							))}
						</div>
					</div>
					<div className="oe-ld-prop-col">
						<span>Style</span>
						<Segmented
							label="Frame style"
							value={fr.style ?? "box"}
							options={[
								{ value: "box", label: "Box" },
								{ value: "plain", label: "Plain" },
								{ value: "filled", label: "Filled" },
							]}
							onChange={(v) => setFrame({ style: v === "box" ? undefined : (v as "plain" | "filled") })}
						/>
					</div>
					<div className="oe-ld-prop-col">
						<span>Header</span>
						<Segmented
							label="Frame header"
							value={fr.header ?? "plain"}
							options={[
								{ value: "plain", label: "Plain" },
								{ value: "soft", label: "Soft" },
								{ value: "solid", label: "Solid" },
							]}
							onChange={(v) => setFrame({ header: v === "plain" ? undefined : (v as "soft" | "solid") })}
						/>
						{fr.header && <span className="oe-tm-muted oe-ld-note">{fr.caption ? `In the accent colour${fr.color ? "" : " (none set: the type's colour)"}.` : "Give the frame a caption to show its header."}</span>}
					</div>
					{whenEditor(fr.when, (w, tag) => change(sel, (n) => ({ ...(n as LayoutFrame), when: w }), tag), `when:${pk(sel)}`)}
					<div className="oe-ld-prop-buttons">
						<button type="button" disabled={!kept} title={kept ? undefined : "Its columns can't go in a column"} onClick={() => kept && commit(kept, { select: fr.items.length ? sel : null })}>
							<Icon name="ungroup" /> Remove frame, keep contents
						</button>
						{removeBtn("Remove with contents")}
					</div>
				</>
			);
		}
		if (selected.kind === "tabs") {
			const g = selected;
			const path = sel;
			return (
				<>
					<div className="oe-ld-props-title">
						<Icon name={TABS_ICON} /> Tabs
					</div>
					<div className="oe-ld-prop-col">
						<span>Tabs</span>
						<div className="oe-ld-tablist">
							{g.tabs.map((t, ti) => (
								<div key={ti} className="oe-ld-tablist-row">
									<button type="button" className="oe-ld-tablist-name" onClick={() => selectTab({ group: path, tab: ti })}>
										{t.icon && <Icon name={t.icon} />}
										{t.caption}
									</button>
									<button type="button" className="clickable-icon" aria-label={`Move ${t.caption} up`} disabled={ti === 0} onClick={() => shiftTab({ group: path, tab: ti }, { group: path, tab: ti, index: ti - 1 })}>
										<Icon name="arrow-up" />
									</button>
									<button type="button" className="clickable-icon" aria-label={`Move ${t.caption} down`} disabled={ti === g.tabs.length - 1} onClick={() => shiftTab({ group: path, tab: ti }, { group: path, tab: ti, index: ti + 2 })}>
										<Icon name="arrow-down" />
									</button>
								</div>
							))}
						</div>
						<div className="oe-ld-prop-buttons">
							<button type="button" onClick={() => commit(addTab(base, path), { tab: { group: path, tab: g.tabs.length }, focus: true })}>
								<Icon name="plus" /> Add tab
							</button>
						</div>
					</div>
					<p className="oe-tm-muted oe-ld-note">Tab groups go at the top level. Click a tab on the layout to change its caption, icon or create-dialog setting.</p>
					<div className="oe-ld-prop-buttons">
						<button type="button" onClick={() => commit(ungroupTabs(path), { select: null })}>
							<Icon name="ungroup" /> Remove tabs, keep contents
						</button>
						{removeBtn("Remove with contents")}
					</div>
				</>
			);
		}
		if (selected.kind === "columns") {
			const c = selected;
			const widths = c.widths ?? c.columns.map(() => 1);
			const setWidths = (w: number[]) => change(sel, (n) => ({ ...(n as LayoutColumns), widths: new Set(w).size > 1 ? w : undefined }));
			return (
				<>
					<div className="oe-ld-props-title">Columns</div>
					<div className="oe-ld-prop-col">
						<span>Number of columns</span>
						<Segmented
							label="Number of columns"
							value={String(c.columns.length)}
							options={Array.from({ length: MAX_COLUMNS - MIN_COLUMNS + 1 }, (_, i) => ({ value: String(i + MIN_COLUMNS), label: String(i + MIN_COLUMNS) }))}
							onChange={(v) => change(sel, (n) => setColumnCount(n as LayoutColumns, Number(v)))}
						/>
					</div>
					{c.columns.length > MIN_COLUMNS && <p className="oe-tm-muted oe-ld-note">With fewer columns, what's in the ones that go moves to the last column.</p>}
					<div className="oe-ld-prop-col">
						<span>Relative widths</span>
						<div className="oe-ld-widths">
							{widths.map((w, i) => (
								<input
									key={i}
									type="number"
									min={1}
									max={12}
									step={1}
									value={w}
									aria-label={`Column ${i + 1} width`}
									onChange={(e) => {
										const v = Math.max(1, Math.min(12, Math.round(Number(e.target.value) || 1)));
										setWidths(widths.map((x, j) => (j === i ? v : x)));
									}}
								/>
							))}
							{c.widths && (
								<button type="button" onClick={() => setWidths(widths.map(() => 1))}>
									Equal
								</button>
							)}
						</div>
						<span className="oe-tm-muted oe-ld-note">E.g. 2 and 1: the first column is twice as wide. Columns stack in narrow places.</span>
					</div>
					<div className="oe-ld-prop-buttons">{removeBtn("Remove with contents")}</div>
				</>
			);
		}
		if (selected.kind === "field") {
			const f = selected;
			const def = fieldOf(f.key);
			const problem = problems.get(pk(sel));
			const setSlot = (patch: Partial<LayoutField>, tag?: string) => change(sel, (n) => ({ ...(n as LayoutField), ...patch }), tag);
			return (
				<>
					<div className="oe-ld-props-title">
						<Icon name={iconOf(f.key)} /> {labelOf(f.key)}
					</div>
					<p className="oe-tm-muted oe-ld-note">
						{def ? `${KIND_INFO[def.kind].label} field` : isNoteItem(f.key) ? (READ_ONLY_ITEMS.includes(f.key) ? "About the note (read-only)" : "The note's name: editing it renames the note") : BUILTINS[f.key] ? "Built-in property" : "Not a field of this type"} · <code>{f.key}</code>
					</p>
					{problem && <Issues issues={[{ at: "form:layout", message: problem }]} />}
					<div className="oe-ld-prop-col">
						<span>Label</span>
						<Segmented
							label="Label position"
							value={slotLabel(f)}
							options={[
								{ value: "above", label: "Above", icon: "arrow-up-to-line" },
								{ value: "beside", label: "Beside", icon: "arrow-left-to-line" },
								{ value: "hidden", label: "Hidden", icon: "eye-off" },
							]}
							onChange={(v) => setSlot({ label: v === (isNoteItem(f.key) ? "hidden" : "above") ? undefined : (v as LabelPosition) })}
						/>
					</div>
					<label className="oe-ld-prop-col">
						<span>Custom label</span>
						<LocalText value={f.caption ?? ""} placeholder={baseLabel(f.key)} label="Custom label" onChange={(v) => setSlot({ caption: v.trim() ? v : undefined }, `caption:${pk(sel)}`)} />
					</label>
					{takesPlaceholder(f.key) && (
						<label className="oe-ld-prop-col">
							<span>Placeholder</span>
							<LocalText value={f.placeholder ?? ""} placeholder="Empty" label="Placeholder" onChange={(v) => setSlot({ placeholder: v.trim() ? v : undefined }, `placeholder:${pk(sel)}`)} />
						</label>
					)}
					<div className="oe-ld-prop-col">
						<span>Help text</span>
						<Segmented
							label="Help text"
							value={!f.help ? "none" : f.help === "description" ? "description" : "custom"}
							options={[
								{ value: "none", label: "None" },
								{ value: "description", label: "Description" },
								{ value: "custom", label: "Custom" },
							]}
							onChange={(v) => setSlot({ help: v === "none" ? undefined : v === "description" ? "description" : { text: typeof f.help === "object" ? f.help.text : descOf(f.key) || "Help text" } })}
						/>
						{f.help === "description" && <span className="oe-tm-muted oe-ld-note">{descOf(f.key) || "This field has no description yet (set it on the Fields tab)."}</span>}
						{typeof f.help === "object" && <LocalText multiline value={f.help.text} label="Custom help text" onChange={(v) => setSlot({ help: v.trim() ? { text: v } : "description" }, `help:${pk(sel)}`)} />}
						{!f.help && <span className="oe-tm-muted oe-ld-note">The description shows when you hover over the label.</span>}
					</div>
					{def?.kind === "textarea" && (
						<div className="oe-ld-prop-col">
							<span>Height</span>
							<Segmented
								label="Height"
								value={String(f.rows ?? "auto")}
								options={[
									{ value: "auto", label: "Auto" },
									{ value: "3", label: "Short" },
									{ value: "6", label: "Medium" },
									{ value: "12", label: "Tall" },
								]}
								onChange={(v) => setSlot({ rows: v === "auto" ? undefined : Number(v) })}
							/>
						</div>
					)}
					{!READ_ONLY_ITEMS.includes(f.key) && (
						<div className="oe-ld-prop-row">
							<span>Read-only on this form</span>
							<Toggle label="Read-only on this form" value={!!f.readOnly} onChange={(v) => setSlot({ readOnly: v ? true : undefined })} />
						</div>
					)}
					{f.readOnly && <p className="oe-tm-muted oe-ld-note">Shown but not editable on notes. The create dialog, views and bulk edits can still set it.</p>}
					{whenEditor(f.when, (w, tag) => setSlot({ when: w }, tag), `when:${pk(sel)}`)}
					<div className="oe-ld-prop-buttons">
						{def && (
							<button
								type="button"
								onClick={() => {
									const i = type.fields.indexOf(def);
									setFieldUid(draft.meta[i]?.uid ?? null);
									setTab("fields");
								}}
							>
								<Icon name="pencil" /> Edit field
							</button>
						)}
						{removeBtn("Remove from layout")}
					</div>
				</>
			);
		}
		const t = selected;
		return (
			<>
				<div className="oe-ld-props-title">{t.kind === "heading" ? "Heading" : "Text"}</div>
				<label className="oe-ld-prop-col">
					<span>{t.kind === "heading" ? "Heading" : "Text"}</span>
					<LocalText multiline={t.kind === "text"} value={t.text} label={t.kind === "heading" ? "Heading" : "Text"} onChange={(v) => change(sel, (n) => ({ ...(n as typeof t), text: v }), `text:${pk(sel)}`)} />
				</label>
				<div className="oe-ld-prop-buttons">{removeBtn()}</div>
			</>
		);
	};

	const layoutIssues = issuesAt("form:layout");
	const root: LayoutList = { at: [] };
	const count = base.items.length;
	const frames = (() => {
		let n = 0;
		walkFrames(base.items, () => n++);
		return n;
	})();
	return (
		<div ref={rootRef} className={`oe-ld${dragging ? " is-dragging" : ""}`} onKeyDown={onRootKey}>
			<aside ref={paletteRef} className={`oe-ld-palette${drop && "remove" in drop ? " is-drop-remove" : ""}`}>
				{dragging?.from === "canvas" && (
					<div className="oe-ld-remove-hint">
						<Icon name="trash-2" /> Drop here to remove
					</div>
				)}
				{palSection(
					"fields",
					"Fields",
					fieldsLeft ? `${fieldsLeft} not placed yet` : "all placed",
					type.fields.length ? type.fields.map((f) => paletteField(f.key)) : <div className="oe-tm-muted oe-ld-note">No fields yet.</div>,
				)}
				{palSection("properties", "Properties", placedOf(builtinKeys), builtinKeys.map(paletteField))}
				{palSection(
					"readonly",
					"Read-only",
					placedOf(READ_ONLY_ITEMS),
					<>
						{READ_ONLY_ITEMS.map(paletteField)}
						<p className="oe-tm-muted oe-ld-note">Not placed, the name is the note's title, status, type and subtitle are in the form's top line, and the others are at the end.</p>
					</>,
				)}
				{palSection(
					"saved",
					"My components",
					folded.has("saved") && components.length ? `${components.length} item${components.length === 1 ? "" : "s"}` : null,
					components.length ? (
						components.map((c) => (
							<button
								key={c.id}
								type="button"
								className="oe-ld-pal-item is-component is-saved"
								data-saved={c.id}
								title={`${clipSummary(c.clip)}. Drag onto the layout or click to add it; right-click for more.`}
								onPointerDown={(e) => startPointer(e, { from: "saved", id: c.id, node: clipNodes(c.clip)[0] })}
								onClick={() => !justDragged.current && paste(c.clip)}
								onContextMenu={(e) => {
									e.preventDefault();
									openMenu((m) => componentMenu(c, m), { x: e.clientX, y: e.clientY });
								}}
							>
								<Icon name={c.icon} />
								<span className="oe-ld-pal-label">{c.name}</span>
							</button>
						))
					) : (
						<p className="oe-tm-muted oe-ld-note">Select something on the layout, then ⋯ → Save as component… to reuse it here and in other types.</p>
					),
				)}
				{palSection(
					"layout",
					"Layout",
					folded.has("layout") ? `${COMPONENTS.length} items` : null,
					COMPONENTS.map((c) => (
						<button
							key={c.kind}
							type="button"
							className="oe-ld-pal-item is-component"
							data-component={c.kind}
							title={`${c.desc}. Drag onto the layout, or click to add it.`}
							onPointerDown={(e) => startPointer(e, { from: "palette", node: blankNode(c.kind) })}
							onClick={() => !justDragged.current && add(blankNode(c.kind))}
						>
							<Icon name={c.icon} />
							<span className="oe-ld-pal-label">{c.label}</span>
						</button>
					)),
				)}
			</aside>

			<div className="oe-ld-main">
				<div className="oe-ld-toolbar">
					<button type="button" className="clickable-icon" aria-label="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}>
						<Icon name="undo-2" />
					</button>
					<button type="button" className="clickable-icon" aria-label="Redo (Ctrl/Cmd+Shift+Z)" disabled={!canRedo} onClick={redo}>
						<Icon name="redo-2" />
					</button>
					<span className="oe-ld-toolbar-note oe-tm-muted">{layout ? `${plural(frames, "frame")}, ${plural(placedAt.size, "property", "properties")} placed` : "No custom layout"}</span>
					<span className="oe-spacer" />
					<button type="button" onClick={() => commit(layoutFromFields(type), { select: null })}>
						<Icon name="list-restart" /> {layout ? "Start again from fields" : "Start from fields"}
					</button>
					{layout && (
						<button type="button" onClick={() => commit(null, { select: null })}>
							<Icon name="rotate-ccw" /> Reset layout
						</button>
					)}
				</div>
				{layoutIssues.length > 0 && <Issues issues={layoutIssues} />}
				<div
					ref={canvasRef}
					className={`oe-ld-canvas oe-ld-list${listCls(root, count)}`}
					data-ld-list={listKey(root)}
					onClick={(e) => {
						if (e.target !== e.currentTarget) return;
						selectNode(null);
					}}
				>
					{base.items.map((n, i) => renderNode(n, [i], root, i, count))}
					{!layout && (
						<div className="oe-ld-start">
							<p>No custom layout: the form lists every field in field order.</p>
							<p className="oe-tm-muted">Drag fields and frames here, or start from the fields.</p>
							<div className="oe-ld-prop-buttons">
								<button type="button" className="mod-cta" onClick={() => commit(layoutFromFields(type), { select: null })}>
									Start from fields
								</button>
								<button type="button" onClick={() => add(blankNode("frame"))}>
									Start with an empty frame
								</button>
							</div>
						</div>
					)}
					{layout && !layout.hideUnplaced && unplacedFields.length > 0 && (
						<div className="oe-ld-other" aria-hidden="true">
							<div className="oe-ld-other-caption">Other fields</div>
							<div className="oe-ld-faint">{unplacedFields.map(labelOf).join(", ")}</div>
						</div>
					)}
					{layout && count === 0 && <div className="oe-ld-empty">Drag fields, frames or columns here</div>}
				</div>
				<div className="oe-ld-hint oe-tm-muted">
					Drag to place and move · Alt+↑/↓ moves the selection (Alt+←/→ for tabs) · Delete removes it · right-click or ⋯ for more · Ctrl/Cmd+Z undoes
				</div>
			</div>

			<aside className="oe-ld-props">{props()}</aside>
		</div>
	);
}

/** Visit every frame in some nodes (inside columns and tabs too). */
function walkFrames(nodes: LayoutNode[], fn: (f: LayoutFrame) => void): void {
	for (const n of nodes) {
		if (n.kind === "frame") fn(n);
		else if (n.kind === "columns") n.columns.forEach((c) => walkFrames(c, fn));
		else if (n.kind === "tabs") n.tabs.forEach((t) => walkFrames(t.items, fn));
	}
}

/** A text box that keeps what's typed (spaces included) while the layout tidies the saved value. */
function LocalText({ value, onChange, label, placeholder, multiline }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; multiline?: boolean }) {
	const [text, setText] = useState(value);
	const focused = useRef(false);
	useEffect(() => {
		if (!focused.current) setText(value);
	}, [value]);
	const common = {
		"aria-label": label,
		value: text,
		placeholder,
		onFocus: () => (focused.current = true),
		onBlur: () => {
			focused.current = false;
			setText(value);
		},
		onChange: (e: { target: { value: string } }) => {
			setText(e.target.value);
			onChange(e.target.value);
		},
	};
	return multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />;
}
