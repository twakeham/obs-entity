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
