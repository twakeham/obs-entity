import { isListValued, type EntityTypeDef, type GroupDef } from "./types";
import {
	availableColumns,
	columnFromId,
	CARD_WIDTH,
	emptyBoard,
	natural,
	NAME_COLUMN,
	resolveColumn,
	sourceTypes,
	type BoardDef,
	type Cell,
	type ColumnDef,
	type LinkValue,
	type ResolvedColumn,
	type ResultRow,
	type ViewDef,
} from "./views";

/** The bucket key of cards with no value. */
export const BUCKET_NONE = "(none)";
/** Card fields a new board shows, taken from the table's columns. */
export const DEFAULT_CARD_FIELDS = 4;
/** Cards a bucket draws before "Show more". */
export const BUCKET_PAGE = 50;
/** Lucide icon for boards (views, the layout toggle). */
export const BOARD_ICON = "kanban";

type Lookup = { types: EntityTypeDef[]; groups: GroupDef[] };

export const boardOf = (def: ViewDef): BoardDef => def.board ?? emptyBoard();
export const cardWidth = (def: ViewDef) => CARD_WIDTH[boardOf(def).cardSize ?? "medium"];

/**
 * Whether a column can be a board's buckets (or a swimlane cards can be dropped into): status, or one of the
 * entity's own fields holding one value from a known set — a choice, a checkbox or a single link.
 */
export function isBucketColumn(col: ResolvedColumn): boolean {
	if (col.invalid) return false;
	if (col.def.kind === "builtin") return col.def.key === "status";
	if (col.def.kind !== "field" || !col.field) return false;
	const f = col.field;
	return f.kind === "select" || f.kind === "boolean" || (f.kind === "relation" && !isListValued(f));
}

/** Columns a board can use as buckets: status, then the source types' choice, checkbox and single-link fields. */
export function bucketColumns(def: ViewDef, lookup: Lookup): ResolvedColumn[] {
	const avail = availableColumns(def, lookup);
	const status = avail.builtins.filter((c) => c.id === "status");
	return [...status, ...avail.fields].map((c) => resolveColumn(c, def, lookup)).filter(isBucketColumn);
}

/** The bucket column a board starts with: status when the types have statuses, else the first usable field. */
export function defaultBuckets(def: ViewDef, lookup: Lookup): string | undefined {
	return bucketColumns(def, lookup)[0]?.id;
}

/** The bucket column in use (null when it's unset or can't be used). */
export function bucketColumn(def: ViewDef, lookup: Lookup): ResolvedColumn | null {
	const id = boardOf(def).buckets;
	if (!id) return null;
	return bucketColumns(def, lookup).find((c) => c.id === id) ?? null;
}

/** A column definition for an id: the view's own (roll-ups, formulas, labels) or one built from the id. */
const defFor = (def: ViewDef, id: string): ColumnDef => def.columns.find((c) => c.id === id) ?? columnFromId(id);

/**
 * Card fields: the board's own list (any column you pick, the bucket and swimlane columns included), or by default
 * the table's first few columns, leaving out the bucket and swimlane columns (their value is in the header).
 */
export function cardFieldIds(def: ViewDef): string[] {
	const b = boardOf(def);
	if (b.cardFields) return b.cardFields.filter((id) => id !== "name");
	const skip = new Set(["name", b.buckets ?? "", b.swimlanes?.by ?? ""]);
	return def.columns
		.map((c) => c.id)
		.filter((id) => !skip.has(id))
		.slice(0, DEFAULT_CARD_FIELDS);
}

/**
 * The definition `runView` runs for a board: name, the card fields and the bucket column as columns, and the
 * swimlane as the only grouping level. Filters, search, sort and highlight rules are the view's own.
 */
export function boardRunDef(def: ViewDef): ViewDef {
	const b = boardOf(def);
	const ids = [...cardFieldIds(def), ...(b.buckets ? [b.buckets] : [])];
	const columns = [NAME_COLUMN, ...[...new Set(ids)].map((id) => defFor(def, id))];
	return { ...def, columns, group: b.swimlanes ? [b.swimlanes] : [] };
}

export interface Bucket {
	key: string;
	label: string;
	/** what dropping a card here writes: a status or choice, true / false, a note path (links), or null (clears) */
	value: string | boolean | null;
	rows: ResultRow[];
	/** in the board's hidden list */
	hidden: boolean;
}

/** The bucket a cell puts its card in. */
export function bucketKeyOf(cell: Cell | undefined, col: ResolvedColumn): string {
	const v = cell?.value;
	if (col.kind === "bool") return v === true ? "yes" : "no";
	if (col.kind === "links") {
		const l = (Array.isArray(v) ? v : [])[0] as LinkValue | undefined;
		return l ? (l.path ?? `?${l.linktext}`) : BUCKET_NONE;
	}
	return v === null || v === undefined || v === "" ? BUCKET_NONE : String(v);
}

/**
 * The buckets for a board's cards, in the field's order: statuses and choices in their defined order (every one,
 * empty or not), then values in use that aren't defined; No then Yes for checkboxes; links A→Z by name. The empty
 * bucket comes last: always for choices and links (dropping there clears the field), for status only when used.
 * Rows keep their order. Hidden buckets are flagged; with `hideEmpty`, empty buckets are left out.
 */
export function bucketsOf(col: ResolvedColumn, rows: ResultRow[], board: BoardDef): Bucket[] {
	const byKey = new Map<string, ResultRow[]>();
	const labels = new Map<string, string>();
	for (const r of rows) {
		const cell = r.cells[col.id];
		const key = bucketKeyOf(cell, col);
		(byKey.get(key) ?? byKey.set(key, []).get(key)!).push(r);
		if (col.kind === "links" && key !== BUCKET_NONE) labels.set(key, ((cell?.value as LinkValue[])[0]?.name ?? key) as string);
	}
	const keys: string[] = [];
	if (col.kind === "bool") keys.push("no", "yes");
	else if (col.kind === "links") keys.push(...[...byKey.keys()].filter((k) => k !== BUCKET_NONE).sort((a, b) => natural(labels.get(a) ?? a, labels.get(b) ?? b)));
	else {
		const defined = col.options ?? [];
		keys.push(...defined, ...[...byKey.keys()].filter((k) => k !== BUCKET_NONE && !defined.includes(k)).sort(natural));
	}
	const isStatus = col.def.kind === "builtin";
	const ordered = applyBucketOrder(keys, board.bucketOrder);
	if (col.kind !== "bool" && (!isStatus || byKey.has(BUCKET_NONE))) ordered.push(BUCKET_NONE);
	const out: Bucket[] = ordered.map((key) => ({
		key,
		label: key === BUCKET_NONE ? "" : col.kind === "bool" ? (key === "yes" ? "Yes" : "No") : (labels.get(key) ?? key),
		value: key === BUCKET_NONE ? null : col.kind === "bool" ? key === "yes" : key,
		rows: byKey.get(key) ?? [],
		hidden: board.hiddenBuckets.includes(key),
	}));
	return board.hideEmpty ? out.filter((b) => b.rows.length) : out;
}

/**
 * Bucket keys (the empty bucket aside) in the saved order. Keys the saved order doesn't know (a new status, option
 * or linked note) go after their neighbour in the field's own order; saved keys that no longer exist are dropped.
 */
export function applyBucketOrder(natural: string[], saved: string[] | undefined): string[] {
	const keys = natural.filter((k) => k !== BUCKET_NONE);
	if (!saved?.length) return keys;
	const out = saved.filter((k) => keys.includes(k));
	keys.forEach((k, i) => {
		if (out.includes(k)) return;
		let at = 0;
		for (let j = i - 1; j >= 0; j--) {
			const p = out.indexOf(keys[j]);
			if (p >= 0) {
				at = p + 1;
				break;
			}
		}
		out.splice(at, 0, k);
	});
	return out;
}

/**
 * The saved order after moving `key` before `before` (to the end when null, which is still before the empty
 * bucket). `all` is every bucket key in its current order (hidden and empty ones included). Undefined when the
 * result is the field's own order, so nothing needs saving; the empty bucket can't move.
 */
export function moveBucketOrder(all: string[], natural: string[], key: string, before: string | null): string[] | undefined {
	const keys = all.filter((k) => k !== BUCKET_NONE);
	const next = key === BUCKET_NONE ? keys : reorder(keys, [key], before === BUCKET_NONE ? null : before);
	const nat = natural.filter((k) => k !== BUCKET_NONE);
	return next.join("\n") === nat.join("\n") ? undefined : next;
}

/**
 * Where a bucket goes when moved one place left (-1) or right (+1) among the shown buckets: the key to put it
 * before (null: the end). Undefined when it can't move that way (at an end, or the empty bucket).
 */
export function bucketStep(shown: string[], key: string, dir: -1 | 1): string | null | undefined {
	const list = shown.filter((k) => k !== BUCKET_NONE);
	const i = list.indexOf(key);
	if (i < 0) return undefined;
	if (dir < 0) return i > 0 ? list[i - 1] : undefined;
	return i < list.length - 1 ? (list[i + 2] ?? null) : undefined;
}

/** Cards in manual order: the saved order first, then the rest (new cards) at the bottom in their current order. */
export function orderRows(rows: ResultRow[], order: string[] | undefined): ResultRow[] {
	if (!order?.length) return rows;
	const at = new Map(order.map((p, i) => [p, i]));
	const placed = rows.filter((r) => at.has(r.row.path)).sort((a, b) => at.get(a.row.path)! - at.get(b.row.path)!);
	return [...placed, ...rows.filter((r) => !at.has(r.row.path))];
}

/** A bucket's paths with `moving` taken out and put back before `before` (at the end when null or moving). */
export function reorder(paths: string[], moving: string[], before: string | null): string[] {
	const out = paths.filter((p) => !moving.includes(p));
	const at = before && !moving.includes(before) ? out.indexOf(before) : -1;
	out.splice(at < 0 ? out.length : at, 0, ...moving);
	return out;
}

/** Source types that have the bucket field (a card of another type can't be moved between buckets). */
export function typesWithField(def: ViewDef, col: ResolvedColumn, types: EntityTypeDef[]): EntityTypeDef[] {
	const sources = sourceTypes(def, types);
	if (col.def.kind === "builtin") return sources;
	const key = col.def.kind === "field" ? col.def.key : "";
	return sources.filter((t) => t.fields.some((f) => f.key === key));
}
