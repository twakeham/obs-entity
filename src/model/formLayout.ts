import { COMMON_KEYS, type EntityTypeDef } from "./types";
import { columnFromId, fieldColumn } from "./views";

/**
 * A type's custom form layout: frames (captioned boxes), columns, tab groups, headings, text and field slots, used by
 * the properties form, the create dialog and the type editor's preview.
 *
 * Nesting (`allowedIn`): the top level holds anything; a tab holds anything but tab groups; columns at the top level or
 * in a tab hold frames, fields, headings and text; a frame holds fields, headings, text and columns of fields; columns
 * in a frame hold fields only. The deepest a form goes is tab → column → frame → columns → field.
 */
export interface FormLayout {
	items: LayoutNode[];
	/** leave out the type's fields that aren't placed (otherwise they're listed under "Other fields") */
	hideUnplaced?: true;
}

/** A condition on the note's own values, like a view filter's: a column id (field key, "f:<key>", status, tags), an operator and a value. */
export interface LayoutCondition {
	field: string;
	op: string;
	value?: unknown;
}

/** "Show only when…": all or any of these conditions hold (stored like view filters). */
export type LayoutWhen = { all: LayoutCondition[] } | { any: LayoutCondition[] };

export type LabelPosition = "above" | "beside" | "hidden";

/** A field slot: one of the type's fields, or a built-in property (status, tags, aliases, related, order). */
export interface LayoutField {
	kind: "field";
	key: string;
	/** where the label goes (default above; hidden: the value only) */
	label?: LabelPosition;
	/** a label for this form only (default: the field's) */
	caption?: string;
	/** grey text in the empty control */
	placeholder?: string;
	/** text under the value: the field's description, or this form's own */
	help?: "description" | { text: string };
	/** long text: the box's height in lines (default: grows with the text) */
	rows?: number;
	/** shown but not editable on the properties form (the create dialog can still set it) */
	readOnly?: true;
	/** shown only when this holds */
	when?: LayoutWhen;
}

/** Heights offered for long text, in lines. */
export const TEXT_ROWS = [3, 6, 12] as const;

export interface LayoutColumns {
	kind: "columns";
	/** 2 to 4 columns, each a stack (of fields; outside frames, of frames, headings and text too) */
	columns: LayoutNode[][];
	/** relative widths, one per column (default equal) */
	widths?: number[];
}

export type LayoutText = { kind: "heading"; text: string } | { kind: "text"; text: string };

export interface LayoutFrame {
	kind: "frame";
	caption?: string;
	/** can be collapsed by clicking its caption */
	collapsible?: true;
	/** starts collapsed (collapsible frames only) */
	collapsed?: true;
	/** false: left out of the create dialog (required fields are still asked for there) */
	create?: false;
	/** an icon before the caption */
	icon?: string;
	/** an accent (caption tint and a stripe down the left): "type" for the type's colour, or a CSS colour */
	color?: string;
	/** plain: no border; filled: a light tint instead of a border (default: a bordered box) */
	style?: "plain" | "filled";
	/** a coloured header bar behind the caption (the accent colour, else the type's): a light tint, or the full colour */
	header?: "soft" | "solid";
	/** shown only when this holds */
	when?: LayoutWhen;
	items: LayoutNode[];
}

export interface LayoutTab {
	caption: string;
	icon?: string;
	/** false: left out of the create dialog (required fields are still asked for there) */
	create?: false;
	/** shown only when this holds */
	when?: LayoutWhen;
	items: LayoutNode[];
}

/** A tab group: one tab's contents show at a time. Top level only. */
export interface LayoutTabs {
	kind: "tabs";
	tabs: LayoutTab[];
}

export type LayoutNode = LayoutField | LayoutColumns | LayoutText | LayoutFrame | LayoutTabs;

/** Where a list of nodes is, which decides what it can hold. */
export type LayoutPlace = "root" | "tab" | "frame" | "outer-column" | "inner-column";

/** Built-in properties a layout can place. Unplaced, they stay where the form always shows them. */
export const LAYOUT_BUILTINS = [COMMON_KEYS.status, COMMON_KEYS.related, COMMON_KEYS.tags, COMMON_KEYS.aliases, COMMON_KEYS.order] as const;

/**
 * Things about the note itself a layout can place ("@" keys can't clash with field keys): its name (editable: it renames
 * the note), and read-only items. Unplaced, the name is Obsidian's title and the type and subtitle are in the form's
 * top line.
 */
export const NOTE_ITEMS = {
	name: "@name",
	type: "@type",
	subtitle: "@subtitle",
	typeSubtitle: "@type-subtitle",
	created: "@created",
	modified: "@modified",
} as const;
export const READ_ONLY_ITEMS: readonly string[] = [NOTE_ITEMS.type, NOTE_ITEMS.subtitle, NOTE_ITEMS.typeSubtitle, NOTE_ITEMS.created, NOTE_ITEMS.modified];
export const isNoteItem = (key: string) => key.startsWith("@");
/** Where a slot's label goes: as set, else above (hidden for the note items, which speak for themselves). */
export const slotLabel = (slot: LayoutField): LabelPosition => slot.label ?? (isNoteItem(slot.key) ? "hidden" : "above");
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Whether a node can go in a list at this place. */
export function allowedIn(place: LayoutPlace, node: LayoutNode): boolean {
	switch (node.kind) {
		case "tabs":
			return place === "root";
		case "frame":
			return place === "root" || place === "tab" || place === "outer-column";
		case "columns":
			return place === "root" || place === "tab" || (place === "frame" && node.columns.every((c) => c.every((e) => e.kind === "field")));
		case "heading":
		case "text":
			return place !== "inner-column";
		default:
			return true;
	}
}

// ---------------------------------------------------------------- reading layouts from settings

/** A "show only when" from settings: { all: [...] } or { any: [...] } of { field, op, value }; none when it has no conditions. */
export function readWhen(raw: unknown): LayoutWhen | undefined {
	if (!isObj(raw)) return undefined;
	const mode = Array.isArray(raw.all) ? "all" : Array.isArray(raw.any) ? "any" : null;
	if (!mode) return undefined;
	const items = (raw[mode] as unknown[]).filter(isObj).flatMap((c): LayoutCondition[] =>
		typeof c.field === "string" && c.field.trim() && typeof c.op === "string" && c.op.trim() ? [{ field: c.field.trim(), op: c.op.trim(), ...(c.value !== undefined ? { value: c.value } : {}) }] : [],
	);
	if (!items.length) return undefined;
	return mode === "all" ? { all: items } : { any: items };
}

/** A "show only when"'s mode and conditions. */
export const whenParts = (w: LayoutWhen): { mode: "all" | "any"; items: LayoutCondition[] } => ("all" in w ? { mode: "all", items: w.all } : { mode: "any", items: w.any });

function readField(raw: unknown): LayoutField | null {
	const key = typeof raw === "string" ? raw : isObj(raw) && typeof raw.key === "string" ? raw.key : "";
	if (!key.trim()) return null;
	if (!isObj(raw)) return { kind: "field", key: key.trim() };
	// "above" is the default (so not kept), except for the note items, whose default is hidden.
	const label = raw.label === "beside" || (raw.label === "hidden" && !isNoteItem(key.trim())) || (raw.label === "above" && isNoteItem(key.trim())) ? raw.label : undefined;
	const caption = text(raw.caption).trim();
	const placeholder = text(raw.placeholder).trim();
	const help = raw.help === "description" ? "description" : isObj(raw.help) && text(raw.help.text).trim() ? { text: text(raw.help.text).trim() } : undefined;
	const rows = typeof raw.rows === "number" && (TEXT_ROWS as readonly number[]).includes(raw.rows) ? raw.rows : undefined;
	return {
		kind: "field",
		key: key.trim(),
		...(label ? { label } : {}),
		...(caption ? { caption } : {}),
		...(placeholder ? { placeholder } : {}),
		...(help ? { help } : {}),
		...(rows ? { rows } : {}),
		...(raw.readOnly === true ? { readOnly: true as const } : {}),
		...withWhen(raw.when),
	};
}

const withWhen = (raw: unknown): { when?: LayoutWhen } => {
	const when = readWhen(raw);
	return when ? { when } : {};
};

/** A node read for a place: what can't go there is lifted out (a nested frame's rows, a column's entries) or dropped. */
function readNode(raw: unknown, place: LayoutPlace): LayoutNode[] {
	if (typeof raw === "string") {
		const f = readField(raw);
		return f ? [f] : [];
	}
	if (!isObj(raw)) return [];
	const many = (list: unknown[], at: LayoutPlace) => list.flatMap((x) => readNode(x, at));
	switch (raw.kind) {
		case "field":
		case undefined: {
			const f = readField(raw);
			return f ? [f] : [];
		}
		case "heading":
		case "text":
			return place === "inner-column" ? [] : [{ kind: raw.kind, text: text(raw.text) }];
		case "frame": {
			if (place === "frame" || place === "inner-column") return many(arr(raw.items), place);
			const frame: LayoutFrame = {
				kind: "frame",
				...(text(raw.caption).trim() ? { caption: text(raw.caption).trim() } : {}),
				...(raw.collapsible === true ? { collapsible: true as const } : {}),
				...(raw.collapsible === true && raw.collapsed === true ? { collapsed: true as const } : {}),
				...(raw.create === false ? { create: false as const } : {}),
				...(text(raw.icon).trim() ? { icon: text(raw.icon).trim() } : {}),
				...(text(raw.color).trim() ? { color: text(raw.color).trim() } : {}),
				...(raw.style === "plain" || raw.style === "filled" ? { style: raw.style } : {}),
				...(raw.header === "soft" || raw.header === "solid" ? { header: raw.header } : {}),
				...withWhen(raw.when),
				items: many(arr(raw.items), "frame"),
			};
			return [frame];
		}
		case "columns": {
			if (place === "outer-column" || place === "inner-column") return arr(raw.columns).flatMap((c) => many(arr(c), place));
			const inner: LayoutPlace = place === "frame" ? "inner-column" : "outer-column";
			const cols = arr(raw.columns)
				.slice(0, MAX_COLUMNS)
				.map((c) => many(arr(c), inner));
			while (cols.length < MIN_COLUMNS) cols.push([]);
			const w = arr(raw.widths);
			const widths = w.length === cols.length && w.every((x) => typeof x === "number" && x > 0) && new Set(w).size > 1 ? { widths: w as number[] } : {};
			return [{ kind: "columns", columns: cols, ...widths }];
		}
		case "tabs": {
			if (place !== "root") return arr(raw.tabs).flatMap((t) => (isObj(t) ? many(arr(t.items), place) : []));
			const tabs: LayoutTab[] = arr(raw.tabs)
				.filter(isObj)
				.map((t, i) => ({
					caption: text(t.caption).trim() || `Tab ${i + 1}`,
					...(text(t.icon).trim() ? { icon: text(t.icon).trim() } : {}),
					...(t.create === false ? { create: false as const } : {}),
					...withWhen(t.when),
					items: many(arr(t.items), "tab"),
				}));
			return tabs.length ? [{ kind: "tabs", tabs }] : [];
		}
	}
	return [];
}

/** A layout from settings or an imported type, tidied: unknown parts dropped, nesting and column counts enforced. */
export function normaliseLayout(raw: unknown): FormLayout | null {
	if (!isObj(raw) || !Array.isArray(raw.items)) return null;
	return { items: raw.items.flatMap((n) => readNode(n, "root")), ...(raw.hideUnplaced === true ? { hideUnplaced: true as const } : {}) };
}

// ---------------------------------------------------------------- walking

/** Where a node is: an index into the top level, then per container: a frame's row; a column and position; a tab and position. */
export type LayoutPath = number[];

/** A list of nodes: the top level (`at` []), a frame's rows (`at` the frame), or a column / tab (`at` the node, `slot` which). */
export interface LayoutList {
	at: LayoutPath;
	slot?: number;
}

/** Visit every node with its path and the place of the list it's in, in the order they show. */
export function walkLayout(layout: FormLayout, visit: (node: LayoutNode, path: LayoutPath, place: LayoutPlace) => void): void {
	const list = (items: LayoutNode[], prefix: LayoutPath, place: LayoutPlace) =>
		items.forEach((n, i) => {
			const p = [...prefix, i];
			visit(n, p, place);
			if (n.kind === "frame") list(n.items, p, "frame");
			else if (n.kind === "columns") n.columns.forEach((c, ci) => list(c, [...p, ci], place === "frame" ? "inner-column" : "outer-column"));
			else if (n.kind === "tabs") n.tabs.forEach((t, ti) => list(t.items, [...p, ti], "tab"));
		});
	list(layout.items, [], "root");
}

/** Every field slot with its path, in the order they show. */
export function fieldSlots(layout: FormLayout): { path: LayoutPath; field: LayoutField }[] {
	const out: { path: LayoutPath; field: LayoutField }[] = [];
	walkLayout(layout, (n, path) => n.kind === "field" && out.push({ path, field: n }));
	return out;
}

/** Every field slot in the layout, in order. */
export function layoutFields(layout: FormLayout): LayoutField[] {
	return fieldSlots(layout).map((s) => s.field);
}

/** Text colour that reads best on a background colour ("#rrggbb" or "#rgb"): white or near-black (white when unknown). */
export function readableOn(bg: string): string {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim());
	if (!m) return "#ffffff";
	const hex = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join("") : m[1];
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
	// Perceived brightness (YIQ): dark text on light colours (ambers, light greens), white on the rest.
	return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#1e1e1e" : "#ffffff";
}

/** Keys of the fields in some nodes (frames, columns and tabs included). */
export function nodeKeys(nodes: LayoutNode[]): string[] {
	return layoutFields({ items: nodes }).map((f) => f.key);
}

/** The text a slot shows under its value on the properties form (none by default). */
export function slotHelp(slot: LayoutField | undefined, description: string | undefined): string | undefined {
	if (!slot?.help) return undefined;
	return slot.help === "description" ? description?.trim() || undefined : slot.help.text;
}

/** Keys a type can place: its fields, status, related, tags, aliases, and order when it has parent fields. */
export function placeableKeys(type: EntityTypeDef): string[] {
	const builtins = LAYOUT_BUILTINS.filter((k) => k !== COMMON_KEYS.order || !!type.parentFields?.length);
	return [...type.fields.map((f) => f.key), ...builtins, ...Object.values(NOTE_ITEMS)];
}

/** The layout with every field slot mapped (to none, one or several slots), containers kept. */
function mapFields(nodes: LayoutNode[], fn: (f: LayoutField) => LayoutField[]): LayoutNode[] {
	return nodes.flatMap((n): LayoutNode[] => {
		switch (n.kind) {
			case "field":
				return fn(n);
			case "frame":
				return [{ ...n, items: mapFields(n.items, fn) }];
			case "columns":
				return [{ ...n, columns: n.columns.map((c) => mapFields(c, fn)) }];
			case "tabs":
				return [{ ...n, tabs: n.tabs.map((t) => ({ ...t, items: mapFields(t.items, fn) })) }];
			default:
				return [n];
		}
	});
}

export interface ResolvedLayout {
	/** the layout with slots for keys the type doesn't have, and repeated slots, left out */
	items: LayoutNode[];
	/** the type's fields that aren't placed, in field order */
	unplaced: string[];
	/** built-in properties that aren't placed (shown where the form always shows them) */
	unplacedBuiltins: string[];
	/** whether status is placed (then it's not in the form's header) */
	placesStatus: boolean;
	/** whether the type, and the subtitle, are placed (on their own or as "type + subtitle"; then they leave the top line) */
	placesType: boolean;
	placesSubtitle: boolean;
}

/** The layout as the form shows it for a type. */
export function resolveLayout(layout: FormLayout, type: EntityTypeDef): ResolvedLayout {
	const allowed = new Set(placeableKeys(type));
	const seen = new Set<string>();
	const items = mapFields(layout.items, (f) => {
		if (!allowed.has(f.key) || seen.has(f.key)) return [];
		seen.add(f.key);
		return [f];
	});
	return {
		items,
		unplaced: type.fields.map((f) => f.key).filter((k) => !seen.has(k)),
		unplacedBuiltins: [...allowed].filter((k) => !seen.has(k) && !type.fields.some((f) => f.key === k)),
		placesStatus: seen.has(COMMON_KEYS.status),
		placesType: seen.has(NOTE_ITEMS.type) || seen.has(NOTE_ITEMS.typeSubtitle),
		placesSubtitle: seen.has(NOTE_ITEMS.subtitle) || seen.has(NOTE_ITEMS.typeSubtitle),
	};
}

/**
 * Keep a layout in step when a field's key changes (`to` null: the field was deleted, so its slot goes). Conditions on
 * the field follow a rename; after a deletion they stay, and are reported (`whenIssues`) and ignored.
 */
export function renameLayoutKey(layout: FormLayout, from: string, to: string | null): FormLayout {
	const next = { ...layout, items: mapFields(layout.items, (f) => (f.key !== from ? [f] : to ? [{ ...f, key: to }] : [])) };
	if (!to) return next;
	const toId = fieldColumn(to).id;
	const isFrom = (id: string) => {
		const col = columnFromId(id);
		return col.kind === "field" && col.key === from;
	};
	const fix = (w: LayoutWhen | undefined): LayoutWhen | undefined => {
		if (!w) return w;
		const { mode, items } = whenParts(w);
		const out = items.map((c) => (isFrom(c.field) ? { ...c, field: toId } : c));
		return mode === "all" ? { all: out } : { any: out };
	};
	const walk = (nodes: LayoutNode[]): LayoutNode[] =>
		nodes.map((n) => {
			switch (n.kind) {
				case "field":
					return n.when ? { ...n, when: fix(n.when) } : n;
				case "frame":
					return { ...n, ...(n.when ? { when: fix(n.when) } : {}), items: walk(n.items) };
				case "columns":
					return { ...n, columns: n.columns.map(walk) };
				case "tabs":
					return { ...n, tabs: n.tabs.map((t) => ({ ...t, ...(t.when ? { when: fix(t.when) } : {}), items: walk(t.items) })) };
				default:
					return n;
			}
		});
	return { ...next, items: walk(next.items) };
}

/** Every "show only when" in a layout (frames, tabs and slots). */
export function layoutWhens(layout: FormLayout): LayoutWhen[] {
	const out: LayoutWhen[] = [];
	walkLayout(layout, (n) => {
		if ((n.kind === "field" || n.kind === "frame") && n.when) out.push(n.when);
		if (n.kind === "tabs") for (const t of n.tabs) if (t.when) out.push(t.when);
	});
	return out;
}

/** A first layout for a type: one frame with every field, in field order. */
export function layoutFromFields(type: EntityTypeDef): FormLayout {
	return { items: [{ kind: "frame", caption: type.name, items: type.fields.map((f) => ({ kind: "field", key: f.key })) }] };
}

/** Problems with a type's layout, for the type editor's validation. */
export function layoutIssues(layout: FormLayout, type: EntityTypeDef): string[] {
	const allowed = new Set(placeableKeys(type));
	const out: string[] = [];
	const seen = new Set<string>();
	for (const f of layoutFields(layout)) {
		if (!allowed.has(f.key)) out.push(`The form layout places "${f.key}", which isn't a field of this type.`);
		else if (seen.has(f.key)) out.push(`The form layout places "${f.key}" more than once.`);
		seen.add(f.key);
	}
	return out;
}

/** Problems with field slots, by path ("1.0"): keys the type doesn't have, and keys placed twice. */
export function slotProblems(layout: FormLayout, type: EntityTypeDef): Map<string, string> {
	const allowed = new Set(placeableKeys(type));
	const seen = new Set<string>();
	const out = new Map<string, string>();
	for (const { path, field } of fieldSlots(layout)) {
		const at = path.join(".");
		if (!allowed.has(field.key)) out.set(at, `“${field.key}” isn't a field of this type`);
		else if (seen.has(field.key)) out.set(at, `“${field.key}” is placed more than once`);
		seen.add(field.key);
	}
	return out;
}

/** The tabs a node is inside, outermost first, as "group path key → tab index". */
export function tabsOnPath(layout: FormLayout, path: LayoutPath): { group: string; tab: number }[] {
	const out: { group: string; tab: number }[] = [];
	let nodes = layout.items;
	let i = 0;
	while (i < path.length) {
		const n = nodes[path[i]];
		if (!n) break;
		const here = path.slice(0, i + 1);
		if (n.kind === "frame") {
			nodes = n.items;
			i += 1;
		} else if (n.kind === "columns") {
			nodes = n.columns[path[i + 1]] ?? [];
			i += 2;
		} else if (n.kind === "tabs") {
			if (path[i + 1] === undefined) break;
			out.push({ group: here.join("."), tab: path[i + 1] });
			nodes = n.tabs[path[i + 1]]?.items ?? [];
			i += 2;
		} else break;
	}
	return out;
}

// ---------------------------------------------------------------- editing (the type editor's layout designer)

export type LayoutComponent = "frame" | "columns2" | "columns3" | "columns4" | "heading" | "text" | "tabs";

/** A new component from the designer's palette. */
export function blankNode(kind: LayoutComponent): LayoutNode {
	switch (kind) {
		case "frame":
			return { kind: "frame", caption: "New frame", items: [] };
		case "heading":
			return { kind: "heading", text: "Heading" };
		case "text":
			return { kind: "text", text: "Help text" };
		case "tabs":
			return { kind: "tabs", tabs: [{ caption: "Tab 1", items: [] }, { caption: "Tab 2", items: [] }] };
		default:
			return { kind: "columns", columns: Array.from({ length: Number(kind.slice(-1)) }, () => []) };
	}
}

/** The node at a path (null when there's none). */
export function nodeAt(layout: FormLayout, path: LayoutPath): LayoutNode | null {
	if (!path.length) return null;
	let node: LayoutNode | undefined = layout.items[path[0]];
	let i = 1;
	while (node && i < path.length) {
		if (node.kind === "frame") {
			node = node.items[path[i]];
			i += 1;
		} else if (node.kind === "columns") {
			node = path[i + 1] === undefined ? undefined : node.columns[path[i]]?.[path[i + 1]];
			i += 2;
		} else if (node.kind === "tabs") {
			node = path[i + 1] === undefined ? undefined : node.tabs[path[i]]?.items[path[i + 1]];
			i += 2;
		} else return null;
	}
	return node ?? null;
}

/** Whether a list exists in the layout. */
export function hasList(layout: FormLayout, list: LayoutList): boolean {
	if (!list.at.length) return list.slot === undefined;
	const o = nodeAt(layout, list.at);
	if (o?.kind === "frame") return list.slot === undefined;
	if (o?.kind === "columns") return list.slot !== undefined && list.slot >= 0 && list.slot < o.columns.length;
	if (o?.kind === "tabs") return list.slot !== undefined && list.slot >= 0 && list.slot < o.tabs.length;
	return false;
}

/** The nodes a list holds (the array itself, so edits on a copy can splice it). */
export function listItems(layout: FormLayout, list: LayoutList): LayoutNode[] {
	if (!hasList(layout, list)) return [];
	if (!list.at.length) return layout.items;
	const o = nodeAt(layout, list.at)!;
	if (o.kind === "frame") return o.items;
	if (o.kind === "columns") return o.columns[list.slot!];
	if (o.kind === "tabs") return o.tabs[list.slot!].items;
	return [];
}

/** The list a node is in, and its position there. */
export function parentList(layout: FormLayout, path: LayoutPath): { list: LayoutList; index: number } {
	let last = { list: { at: [] } as LayoutList, index: path[0] };
	let node: LayoutNode | undefined = layout.items[path[0]];
	let i = 1;
	while (node && i < path.length) {
		const at = path.slice(0, i);
		if (node.kind === "frame") {
			last = { list: { at }, index: path[i] };
			node = node.items[path[i]];
			i += 1;
		} else if (node.kind === "columns" || node.kind === "tabs") {
			last = { list: { at, slot: path[i] }, index: path[i + 1] };
			node = node.kind === "columns" ? node.columns[path[i]]?.[path[i + 1]] : node.tabs[path[i]]?.items[path[i + 1]];
			i += 2;
		} else break;
	}
	return last;
}

/** The path of a list's `index`th node. */
export function childPath(list: LayoutList, index: number): LayoutPath {
	return [...list.at, ...(list.slot !== undefined ? [list.slot] : []), index];
}

/** Where a list is (which decides what it can hold). */
export function placeOf(layout: FormLayout, list: LayoutList): LayoutPlace {
	if (!list.at.length) return "root";
	const o = nodeAt(layout, list.at);
	if (o?.kind === "frame") return "frame";
	if (o?.kind === "tabs") return "tab";
	return placeOf(layout, parentList(layout, list.at).list) === "frame" ? "inner-column" : "outer-column";
}

/** Whether a list can hold a node. */
export function canHold(layout: FormLayout, list: LayoutList, node: LayoutNode): boolean {
	return hasList(layout, list) && allowedIn(placeOf(layout, list), node);
}

export const listKey = (list: LayoutList) => `${list.at.join(".")}:${list.slot ?? ""}`;
export const sameList = (a: LayoutList, b: LayoutList) => listKey(a) === listKey(b);

export function parseListKey(key: string): LayoutList | null {
	const m = /^((?:\d+\.)*\d+)?:(\d+)?$/.exec(key);
	if (!m) return null;
	return { at: m[1] ? m[1].split(".").map(Number) : [], ...(m[2] !== undefined ? { slot: Number(m[2]) } : {}) };
}

/** Every list in the layout, in the order they show. */
export function allLists(layout: FormLayout): LayoutList[] {
	const out: LayoutList[] = [{ at: [] }];
	walkLayout(layout, (n, path) => {
		if (n.kind === "frame") out.push({ at: path });
		else if (n.kind === "columns") n.columns.forEach((_, slot) => out.push({ at: path, slot }));
		else if (n.kind === "tabs") n.tabs.forEach((_, slot) => out.push({ at: path, slot }));
	});
	return out;
}

/** The layout with a node put into a list at `index` (null when the list can't hold it). */
export function insertNode(layout: FormLayout, list: LayoutList, index: number, node: LayoutNode): FormLayout | null {
	if (!canHold(layout, list, node)) return null;
	const next = clone(layout);
	const items = listItems(next, list);
	items.splice(Math.max(0, Math.min(index, items.length)), 0, clone(node));
	return next;
}

/** The layout without the node at a path (its contents go with it). */
export function removeNode(layout: FormLayout, path: LayoutPath): FormLayout {
	const next = clone(layout);
	const { list, index } = parentList(next, path);
	listItems(next, list).splice(index, 1);
	return next;
}

const isWithin = (path: LayoutPath, ancestor: LayoutPath) => path.length >= ancestor.length && ancestor.every((v, i) => path[i] === v);

/** Find a node by identity (the layout given, not a copy). */
function pathOfNode(layout: FormLayout, target: unknown): LayoutPath | null {
	let found: LayoutPath | null = null;
	walkLayout(layout, (n, p) => {
		if (!found && n === target) found = p;
	});
	return found;
}

/**
 * Move a node into a list before position `index` (positions as they are before the move, as a drop line shows them).
 * Returns the new layout and where the node ended up, or null when it can't go there.
 */
export function moveNode(layout: FormLayout, from: LayoutPath, to: LayoutList, index: number): { layout: FormLayout; path: LayoutPath } | null {
	const node = nodeAt(layout, from);
	if (!node || !canHold(layout, to, node) || isWithin(to.at, from)) return null;
	const next = clone(layout);
	const moving = nodeAt(next, from)!;
	const { list, index: at } = parentList(next, from);
	// Leave a placeholder where the node was, so positions in the target list stay as given; then drop the placeholder.
	const placeholder = { kind: "heading", text: "\u0000moving" } as LayoutNode;
	listItems(next, list)[at] = placeholder;
	const target = listItems(next, to);
	target.splice(Math.max(0, Math.min(index, target.length)), 0, moving);
	const was = pathOfNode(next, placeholder)!;
	const p = parentList(next, was);
	listItems(next, p.list).splice(p.index, 1);
	return { layout: next, path: pathOfNode(next, moving)! };
}

/** Move a node up (-1) or down (+1) within its list (null at either end). */
export function moveBy(layout: FormLayout, path: LayoutPath, delta: -1 | 1): { layout: FormLayout; path: LayoutPath } | null {
	const { list, index } = parentList(layout, path);
	const to = index + delta;
	if (to < 0 || to >= listItems(layout, list).length) return null;
	return moveNode(layout, path, list, delta > 0 ? to + 1 : to);
}

/** The layout with the node at a path changed by `fn` (on a copy). */
export function updateNode(layout: FormLayout, path: LayoutPath, fn: (n: LayoutNode) => LayoutNode | void): FormLayout {
	const next = clone(layout);
	const { list, index } = parentList(next, path);
	const items = listItems(next, list);
	const r = fn(items[index]);
	if (r) items[index] = r;
	return next;
}

/** A frame replaced by its rows, where it was (null when that list can't hold them, e.g. columns in a column). */
export function ungroupFrame(layout: FormLayout, path: LayoutPath): FormLayout | null {
	const f = nodeAt(layout, path);
	if (f?.kind !== "frame") return null;
	const { list, index } = parentList(layout, path);
	const place = placeOf(layout, list);
	if (!f.items.every((i) => allowedIn(place, i))) return null;
	const next = clone(layout);
	listItems(next, list).splice(index, 1, ...clone(f.items));
	return next;
}

/** Columns with another number of columns: new ones start empty; what's in dropped ones moves to the last kept one. */
export function setColumnCount(cols: LayoutColumns, n: number): LayoutColumns {
	const count = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, n));
	const columns = clone(cols.columns).slice(0, count);
	while (columns.length < count) columns.push([]);
	for (const extra of cols.columns.slice(count)) columns[count - 1].push(...clone(extra));
	const widths = cols.widths ? [...cols.widths.slice(0, count), ...Array(Math.max(0, count - cols.widths.length)).fill(1)] : undefined;
	return { kind: "columns", columns, ...(widths && new Set(widths).size > 1 ? { widths } : {}) };
}

/**
 * Where "add" (from the palette or "Add field here…") puts a node, given what's selected: into a selected frame, tab
 * group (its open tab) or columns (the shortest column that can hold it); else after the selection in the nearest list
 * that can hold it; else at the end.
 */
export function insertionPoint(layout: FormLayout, selected: LayoutPath | null, node: LayoutNode, openTab: (group: LayoutPath) => number = () => 0): { list: LayoutList; index: number } {
	const end = { list: { at: [] } as LayoutList, index: layout.items.length };
	const sel = selected ? nodeAt(layout, selected) : null;
	if (!selected || !sel) return end;
	let inside: LayoutList | null = null;
	if (sel.kind === "frame") inside = { at: selected };
	else if (sel.kind === "tabs") inside = { at: selected, slot: Math.min(openTab(selected), sel.tabs.length - 1) };
	else if (sel.kind === "columns") {
		let col = -1;
		sel.columns.forEach((c, i) => {
			if (canHold(layout, { at: selected, slot: i }, node) && (col < 0 || c.length < sel.columns[col].length)) col = i;
		});
		if (col >= 0) inside = { at: selected, slot: col };
	}
	if (inside && canHold(layout, inside, node)) return { list: inside, index: listItems(layout, inside).length };
	let p = selected;
	for (;;) {
		const { list, index } = parentList(layout, p);
		if (canHold(layout, list, node)) return { list, index: index + 1 };
		if (!list.at.length) return end;
		p = list.at;
	}
}

// ---- tabs

/** A tab group's tab, changed by `fn` (on a copy). */
export function updateTab(layout: FormLayout, group: LayoutPath, tab: number, fn: (t: LayoutTab) => LayoutTab): FormLayout {
	const next = clone(layout);
	const g = nodeAt(next, group);
	if (g?.kind === "tabs" && g.tabs[tab]) g.tabs[tab] = fn(g.tabs[tab]);
	return next;
}

/** A tab added at the end of a group ("Tab N"). */
export function addTab(layout: FormLayout, group: LayoutPath): FormLayout {
	const next = clone(layout);
	const g = nodeAt(next, group);
	if (g?.kind === "tabs") {
		const names = new Set(g.tabs.map((t) => t.caption));
		let n = g.tabs.length + 1;
		while (names.has(`Tab ${n}`)) n++;
		g.tabs.push({ caption: `Tab ${n}`, items: [] });
	}
	return next;
}

/**
 * A tab removed. `keep`: its contents move to the top level, after the group. The last tab's removal removes the group
 * (its contents, kept, take the group's place).
 */
export function removeTab(layout: FormLayout, group: LayoutPath, tab: number, keep: boolean): FormLayout {
	const g = nodeAt(layout, group);
	if (g?.kind !== "tabs" || !g.tabs[tab]) return layout;
	const next = clone(layout);
	const ng = nodeAt(next, group) as LayoutTabs;
	const [gone] = ng.tabs.splice(tab, 1);
	const at = group[0];
	const contents = keep ? gone.items : [];
	if (ng.tabs.length) next.items.splice(at + 1, 0, ...contents);
	else next.items.splice(at, 1, ...contents);
	return next;
}

/**
 * Move a tab to a position in a group (positions before the move, as the drop line shows them). Returns where it
 * ended up, or null. A group left with no tabs goes.
 */
export function moveTab(layout: FormLayout, from: { group: LayoutPath; tab: number }, to: { group: LayoutPath; index: number }): { layout: FormLayout; group: LayoutPath; tab: number } | null {
	const g = nodeAt(layout, from.group);
	const tg = nodeAt(layout, to.group);
	if (g?.kind !== "tabs" || tg?.kind !== "tabs" || !g.tabs[from.tab]) return null;
	const next = clone(layout);
	const src = nodeAt(next, from.group) as LayoutTabs;
	const dst = nodeAt(next, to.group) as LayoutTabs;
	const moving = src.tabs[from.tab];
	const placeholder = { caption: "\u0000moving", items: [] } as LayoutTab;
	src.tabs[from.tab] = placeholder;
	dst.tabs.splice(Math.max(0, Math.min(to.index, dst.tabs.length)), 0, moving);
	src.tabs.splice(src.tabs.indexOf(placeholder), 1);
	let groupPath = to.group;
	if (!src.tabs.length) {
		next.items.splice(from.group[0], 1);
		if (to.group[0] > from.group[0]) groupPath = [to.group[0] - 1];
	}
	const finalGroup = nodeAt(next, groupPath) as LayoutTabs;
	return { layout: next, group: groupPath, tab: finalGroup.tabs.indexOf(moving) };
}
