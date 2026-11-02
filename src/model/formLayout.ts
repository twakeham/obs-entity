import { COMMON_KEYS, type EntityTypeDef } from "./types";

/**
 * A type's custom form layout: frames (captioned boxes) and rows of fields, column groups, headings and text,
 * used by the properties form, the create dialog and the type editor's preview. Two levels at most:
 * form → frames and rows; frame → rows; row → a field, columns, a heading or text; column → fields.
 */
export interface FormLayout {
	items: LayoutNode[];
	/** leave out the type's fields that aren't placed (otherwise they're listed under "Other fields") */
	hideUnplaced?: true;
}

export type LabelPosition = "above" | "beside";

/** A field slot: one of the type's fields, or a built-in property (status, tags, aliases, related, order). */
export interface LayoutField {
	kind: "field";
	key: string;
	/** where the label goes (default above) */
	label?: LabelPosition;
}

export interface LayoutColumns {
	kind: "columns";
	/** 2 to 4 columns, each a stack of fields */
	columns: LayoutField[][];
	/** relative widths, one per column (default equal) */
	widths?: number[];
}

export type LayoutText = { kind: "heading"; text: string } | { kind: "text"; text: string };

export type LayoutItem = LayoutField | LayoutColumns | LayoutText;

export interface LayoutFrame {
	kind: "frame";
	caption?: string;
	/** can be collapsed by clicking its caption */
	collapsible?: true;
	/** starts collapsed (collapsible frames only) */
	collapsed?: true;
	/** false: left out of the create dialog (required fields are still asked for there) */
	create?: false;
	items: LayoutItem[];
}

export type LayoutNode = LayoutFrame | LayoutItem;

/** Built-in properties a layout can place. Unplaced, they stay where the form always shows them. */
export const LAYOUT_BUILTINS = [COMMON_KEYS.status, COMMON_KEYS.related, COMMON_KEYS.tags, COMMON_KEYS.aliases, COMMON_KEYS.order] as const;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v : "");

function readField(raw: unknown): LayoutField | null {
	const key = typeof raw === "string" ? raw : isObj(raw) && typeof raw.key === "string" ? raw.key : "";
	if (!key.trim()) return null;
	const label = isObj(raw) && (raw.label === "above" || raw.label === "beside") ? raw.label : undefined;
	return { kind: "field", key: key.trim(), ...(label && label !== "above" ? { label } : {}) };
}

function readItem(raw: unknown): LayoutItem | null {
	if (typeof raw === "string") return readField(raw);
	if (!isObj(raw)) return null;
	switch (raw.kind) {
		case "field":
		case undefined:
			return readField(raw);
		case "columns": {
			const cols = (Array.isArray(raw.columns) ? raw.columns : [])
				.slice(0, MAX_COLUMNS)
				.map((c) => (Array.isArray(c) ? c : []).map(readField).filter((f): f is LayoutField => !!f));
			while (cols.length < MIN_COLUMNS) cols.push([]);
			const w = Array.isArray(raw.widths) ? raw.widths : [];
			const widths = w.length === cols.length && w.every((x) => typeof x === "number" && x > 0) && new Set(w).size > 1 ? { widths: w as number[] } : {};
			return { kind: "columns", columns: cols, ...widths };
		}
		case "heading":
			return { kind: "heading", text: text(raw.text) };
		case "text":
			return { kind: "text", text: text(raw.text) };
	}
	return null;
}

/** A layout from settings or an imported type, tidied: unknown parts dropped, nesting and column counts enforced. */
export function normaliseLayout(raw: unknown): FormLayout | null {
	if (!isObj(raw) || !Array.isArray(raw.items)) return null;
	const items: LayoutNode[] = [];
	for (const n of raw.items) {
		if (isObj(n) && n.kind === "frame") {
			const frame: LayoutFrame = {
				kind: "frame",
				...(text(n.caption).trim() ? { caption: text(n.caption).trim() } : {}),
				...(n.collapsible === true ? { collapsible: true as const } : {}),
				...(n.collapsible === true && n.collapsed === true ? { collapsed: true as const } : {}),
				...(n.create === false ? { create: false as const } : {}),
				// Frames can't hold frames: a nested one's items are lifted into this frame.
				items: (Array.isArray(n.items) ? n.items : []).flatMap((i) => (isObj(i) && i.kind === "frame" ? (Array.isArray(i.items) ? i.items : []) : [i])).map(readItem).filter((i): i is LayoutItem => !!i),
			};
			items.push(frame);
		} else {
			const item = readItem(n);
			if (item) items.push(item);
		}
	}
	return { items, ...(raw.hideUnplaced === true ? { hideUnplaced: true as const } : {}) };
}

/** Every field slot in the layout, in order (frames and columns included). */
export function layoutFields(layout: FormLayout): LayoutField[] {
	const out: LayoutField[] = [];
	const visit = (i: LayoutNode) => {
		if (i.kind === "frame") i.items.forEach(visit);
		else if (i.kind === "columns") i.columns.forEach((c) => out.push(...c));
		else if (i.kind === "field") out.push(i);
	};
	layout.items.forEach(visit);
	return out;
}

/** Keys a type can place: its fields, status, related, tags, aliases, and order when it has parent fields. */
export function placeableKeys(type: EntityTypeDef): string[] {
	const builtins = LAYOUT_BUILTINS.filter((k) => k !== COMMON_KEYS.order || !!type.parentFields?.length);
	return [...type.fields.map((f) => f.key), ...builtins];
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
}

/** The layout as the form shows it for a type. */
export function resolveLayout(layout: FormLayout, type: EntityTypeDef): ResolvedLayout {
	const allowed = new Set(placeableKeys(type));
	const seen = new Set<string>();
	const keep = (f: LayoutField) => {
		if (!allowed.has(f.key) || seen.has(f.key)) return false;
		seen.add(f.key);
		return true;
	};
	const items: LayoutNode[] = [];
	const item = (i: LayoutItem): LayoutItem | null => {
		if (i.kind === "field") return keep(i) ? i : null;
		if (i.kind === "columns") return { ...i, columns: i.columns.map((c) => c.filter(keep)) };
		return i;
	};
	for (const n of layout.items) {
		if (n.kind === "frame") items.push({ ...n, items: n.items.map(item).filter((i): i is LayoutItem => !!i) });
		else {
			const i = item(n);
			if (i) items.push(i);
		}
	}
	return {
		items,
		unplaced: type.fields.map((f) => f.key).filter((k) => !seen.has(k)),
		unplacedBuiltins: [...allowed].filter((k) => !seen.has(k) && !type.fields.some((f) => f.key === k)),
		placesStatus: seen.has(COMMON_KEYS.status),
	};
}

/** Keep a layout in step when a field's key changes (`to` null: the field was deleted, so its slot goes). */
export function renameLayoutKey(layout: FormLayout, from: string, to: string | null): FormLayout {
	const field = (f: LayoutField): LayoutField[] => (f.key !== from ? [f] : to ? [{ ...f, key: to }] : []);
	const item = (i: LayoutItem): LayoutItem[] => (i.kind === "field" ? field(i) : i.kind === "columns" ? [{ ...i, columns: i.columns.map((c) => c.flatMap(field)) }] : [i]);
	return {
		...layout,
		items: layout.items.flatMap((n): LayoutNode[] => (n.kind === "frame" ? [{ ...n, items: n.items.flatMap(item) }] : item(n))),
	};
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

// ---------------------------------------------------------------- editing (the type editor's layout designer)

/**
 * Where a node is: its top-level index; then, in a frame, its row; then, in columns, the column and position.
 * [i] top level · [i, j] row j of frame i · [i, c, k] columns at the top level · [i, j, c, k] columns in a frame.
 */
export type LayoutPath = number[];

/** A list that holds nodes: the form itself, a frame's rows, or one column of a columns row (`at`: the columns). */
export type LayoutList = { kind: "root" } | { kind: "frame"; frame: number } | { kind: "column"; at: LayoutPath; col: number };

export type LayoutComponent = "frame" | "columns2" | "columns3" | "columns4" | "heading" | "text";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A new component from the designer's palette. */
export function blankNode(kind: LayoutComponent): LayoutNode {
	switch (kind) {
		case "frame":
			return { kind: "frame", caption: "New frame", items: [] };
		case "heading":
			return { kind: "heading", text: "Heading" };
		case "text":
			return { kind: "text", text: "Help text" };
		default:
			return { kind: "columns", columns: Array.from({ length: Number(kind.slice(-1)) }, () => []) };
	}
}

/** The node at a path (null when there's none). */
export function nodeAt(layout: FormLayout, path: LayoutPath): LayoutNode | null {
	const top = layout.items[path[0]];
	if (!top || path.length === 1) return top ?? null;
	let rest = path.slice(1);
	let node: LayoutNode | undefined = top;
	if (node.kind === "frame") {
		node = node.items[rest[0]];
		rest = rest.slice(1);
		if (!node || !rest.length) return node ?? null;
	}
	if (node.kind !== "columns" || rest.length !== 2) return null;
	return node.columns[rest[0]]?.[rest[1]] ?? null;
}

/** The nodes a list holds. */
export function listItems(layout: FormLayout, list: LayoutList): LayoutNode[] {
	if (list.kind === "root") return layout.items;
	if (list.kind === "frame") {
		const f = layout.items[list.frame];
		return f?.kind === "frame" ? f.items : [];
	}
	const c = nodeAt(layout, list.at);
	return c?.kind === "columns" ? (c.columns[list.col] ?? []) : [];
}

/** The list a node is in, and its position there. */
export function parentList(path: LayoutPath): { list: LayoutList; index: number } {
	if (path.length === 1) return { list: { kind: "root" }, index: path[0] };
	if (path.length === 2) return { list: { kind: "frame", frame: path[0] }, index: path[1] };
	return { list: { kind: "column", at: path.slice(0, -2), col: path[path.length - 2] }, index: path[path.length - 1] };
}

/** The path of a list's `index`th node. */
export function childPath(list: LayoutList, index: number): LayoutPath {
	return list.kind === "root" ? [index] : list.kind === "frame" ? [list.frame, index] : [...list.at, list.col, index];
}

/** Whether a list can hold a node: frames only at the top level, columns only outside columns. */
export function canHold(list: LayoutList, node: LayoutNode): boolean {
	if (node.kind === "frame") return list.kind === "root";
	if (list.kind === "column") return node.kind === "field";
	return true;
}

export const sameList = (a: LayoutList, b: LayoutList) => listKey(a) === listKey(b);

/** A list as a string (for data attributes), and back. */
export function listKey(list: LayoutList): string {
	return list.kind === "root" ? "root" : list.kind === "frame" ? `frame:${list.frame}` : `column:${list.at.join(".")}:${list.col}`;
}

export function parseListKey(key: string): LayoutList | null {
	if (key === "root") return { kind: "root" };
	let m = /^frame:(\d+)$/.exec(key);
	if (m) return { kind: "frame", frame: Number(m[1]) };
	m = /^column:([\d.]+):(\d+)$/.exec(key);
	if (m) return { kind: "column", at: m[1].split(".").map(Number), col: Number(m[2]) };
	return null;
}

/** Every list in the layout, in the order they show. */
export function allLists(layout: FormLayout): LayoutList[] {
	const out: LayoutList[] = [{ kind: "root" }];
	const cols = (at: LayoutPath, n: LayoutNode) => {
		if (n.kind === "columns") n.columns.forEach((_, col) => out.push({ kind: "column", at, col }));
	};
	layout.items.forEach((n, i) => {
		if (n.kind === "frame") {
			out.push({ kind: "frame", frame: i });
			n.items.forEach((it, j) => cols([i, j], it));
		} else cols([i], n);
	});
	return out;
}

/** The layout with a node put into a list at `index` (null when the list can't hold it). */
export function insertNode(layout: FormLayout, list: LayoutList, index: number, node: LayoutNode): FormLayout | null {
	if (!canHold(list, node) || !hasList(layout, list)) return null;
	const next = clone(layout);
	const items = listItems(next, list);
	items.splice(Math.max(0, Math.min(index, items.length)), 0, clone(node));
	return next;
}

/** The layout without the node at a path (a frame's or columns' contents go with it). */
export function removeNode(layout: FormLayout, path: LayoutPath): FormLayout {
	const next = clone(layout);
	const { list, index } = parentList(path);
	listItems(next, list).splice(index, 1);
	return next;
}

/** Find a node by identity (the layout given, not a copy). */
function pathOfNode(layout: FormLayout, target: unknown): LayoutPath | null {
	for (const list of allLists(layout)) {
		const i = listItems(layout, list).indexOf(target as LayoutNode);
		if (i >= 0) return childPath(list, i);
	}
	return null;
}

/**
 * Move a node into a list before position `index` (positions as they are before the move, as a drop line shows them).
 * Returns the new layout and where the node ended up, or null when it can't go there.
 */
export function moveNode(layout: FormLayout, from: LayoutPath, to: LayoutList, index: number): { layout: FormLayout; path: LayoutPath } | null {
	const node = nodeAt(layout, from);
	if (!node || !canHold(to, node) || !hasList(layout, to)) return null;
	const next = clone(layout);
	const moving = nodeAt(next, from)!;
	const { list, index: at } = parentList(from);
	// Leave a placeholder where the node was, so positions in the target list stay as given; then drop the placeholder.
	const placeholder = { kind: "__moving" } as unknown as LayoutNode;
	listItems(next, list)[at] = placeholder;
	const target = listItems(next, to);
	target.splice(Math.max(0, Math.min(index, target.length)), 0, moving);
	const was = pathOfNode(next, placeholder)!;
	const p = parentList(was);
	listItems(next, p.list).splice(p.index, 1);
	return { layout: next, path: pathOfNode(next, moving)! };
}

/** Move a node up (-1) or down (+1) within its list (null at either end). */
export function moveBy(layout: FormLayout, path: LayoutPath, delta: -1 | 1): { layout: FormLayout; path: LayoutPath } | null {
	const { list, index } = parentList(path);
	const to = index + delta;
	if (to < 0 || to >= listItems(layout, list).length) return null;
	return moveNode(layout, path, list, delta > 0 ? to + 1 : to);
}

/** The layout with the node at a path changed by `fn` (on a copy). */
export function updateNode(layout: FormLayout, path: LayoutPath, fn: (n: LayoutNode) => LayoutNode | void): FormLayout {
	const next = clone(layout);
	const { list, index } = parentList(path);
	const items = listItems(next, list);
	const r = fn(items[index]);
	if (r) items[index] = r;
	return next;
}

/** A frame replaced by its rows (they move to the top level where it was). */
export function ungroupFrame(layout: FormLayout, index: number): FormLayout {
	const f = layout.items[index];
	if (f?.kind !== "frame") return layout;
	const next = clone(layout);
	next.items.splice(index, 1, ...clone(f.items));
	return next;
}

/** Columns with another number of columns: new ones start empty; fields in dropped ones move to the last kept one. */
export function setColumnCount(cols: LayoutColumns, n: number): LayoutColumns {
	const count = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, n));
	const columns = clone(cols.columns).slice(0, count);
	while (columns.length < count) columns.push([]);
	for (const extra of cols.columns.slice(count)) columns[count - 1].push(...clone(extra));
	const widths = cols.widths ? [...cols.widths.slice(0, count), ...Array(Math.max(0, count - cols.widths.length)).fill(1)] : undefined;
	return { kind: "columns", columns, ...(widths && new Set(widths).size > 1 ? { widths } : {}) };
}

/**
 * Where "add" (from the palette or "Add field here…") puts a node, given what's selected: into a selected frame or
 * columns (the shortest column), else after the selection in the nearest list that can hold it, else at the end.
 */
export function insertionPoint(layout: FormLayout, selected: LayoutPath | null, node: LayoutNode): { list: LayoutList; index: number } {
	const root: LayoutList = { kind: "root" };
	const sel = selected ? nodeAt(layout, selected) : null;
	if (!selected || !sel) return { list: root, index: layout.items.length };
	if (node.kind === "frame") return { list: root, index: selected[0] + 1 };
	if (sel.kind === "frame") return { list: { kind: "frame", frame: selected[0] }, index: sel.items.length };
	if (sel.kind === "columns" && node.kind === "field") {
		let col = 0;
		sel.columns.forEach((c, i) => c.length < sel.columns[col].length && (col = i));
		return { list: { kind: "column", at: selected, col }, index: sel.columns[col].length };
	}
	// After the selection, or after the columns it's in when its column can't hold the node.
	let p = selected;
	for (;;) {
		const { list, index } = parentList(p);
		if (canHold(list, node)) return { list, index: index + 1 };
		p = (list as Extract<LayoutList, { kind: "column" }>).at;
	}
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

/** Every field slot with its path, in the order they show. */
export function fieldSlots(layout: FormLayout): { path: LayoutPath; field: LayoutField }[] {
	const out: { path: LayoutPath; field: LayoutField }[] = [];
	const item = (it: LayoutItem, at: LayoutPath) => {
		if (it.kind === "field") out.push({ path: at, field: it });
		else if (it.kind === "columns") it.columns.forEach((c, ci) => c.forEach((f, k) => out.push({ path: [...at, ci, k], field: f })));
	};
	layout.items.forEach((n, i) => (n.kind === "frame" ? n.items.forEach((it, j) => item(it, [i, j])) : item(n, [i])));
	return out;
}

/** Whether a list exists in the layout. */
export function hasList(layout: FormLayout, list: LayoutList): boolean {
	if (list.kind === "root") return true;
	if (list.kind === "frame") return layout.items[list.frame]?.kind === "frame";
	const c = nodeAt(layout, list.at);
	return c?.kind === "columns" && list.col >= 0 && list.col < c.columns.length;
}
