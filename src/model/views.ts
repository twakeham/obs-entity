import type { DateAdapter } from "./dates";
import type { EntityInfo } from "./entity";
import { isEmptyValue } from "./frontmatter";
import { asArray, parseLabelledEntry, parseLink } from "./links";
import { formatDate, formatNumber, RELATIVE, type MomentLike } from "./formats";
import { compile, DateVal, evaluate, FormulaError, FTYPES, isLink, toText, truthy, type Compiled, type EvalEnv, type FType, type FValue, type RefColumn } from "./formula";
import { COMMON_KEYS, statusesFor, toKey, typeMatchesTarget, type EntityTypeDef, type FieldDef, type GroupDef } from "./types";

// ---------------------------------------------------------------- definition

export type ViewKind = "table" | "board";
export const VIEW_KINDS: ViewKind[] = ["table", "board"];

export const BUILTINS = ["name", "type", "status", "tags", "aliases", "related", "folder", "created", "modified"] as const;
export type BuiltinKey = (typeof BUILTINS)[number];
const BUILTIN_LABELS: Record<BuiltinKey, string> = {
	name: "Name",
	type: "Type",
	status: "Status",
	tags: "Tags",
	aliases: "Aliases",
	related: "Related",
	folder: "Folder",
	created: "Created",
	modified: "Modified",
};
const isBuiltin = (s: string): s is BuiltinKey => (BUILTINS as readonly string[]).includes(s);

export const ROLLUP_AGGS = ["count", "list", "unique", "sum", "avg", "min", "max", "earliest", "latest", "percent-done", "count-by-status"] as const;
export type RollupAgg = (typeof ROLLUP_AGGS)[number];
/** Aggregations that read a field of the linked notes, and the field kinds they accept. */
export const AGG_FIELD_KINDS: Partial<Record<RollupAgg, readonly string[] | "any">> = {
	unique: "any",
	sum: ["number"],
	avg: ["number"],
	min: ["number"],
	max: ["number"],
	earliest: ["date"],
	latest: ["date"],
};
export const AGG_LABELS: Record<RollupAgg, string> = {
	count: "count",
	list: "names",
	unique: "unique values",
	sum: "sum",
	avg: "average",
	min: "min",
	max: "max",
	earliest: "earliest",
	latest: "latest",
	"percent-done": "% done",
	"count-by-status": "count by status",
};

export interface RollupDef {
	/** "field:<key>" (an outgoing relation of the row) or "in:<type>.<field>" (links pointing at the row) */
	via: string;
	agg: RollupAgg;
	/** the linked notes' field to aggregate (unique, sum, avg, min, max, earliest, latest) */
	field?: string;
}

export type ColumnDef =
	| { kind: "builtin"; id: string; key: BuiltinKey; label?: string }
	| { kind: "field"; id: string; key: string; label?: string }
	| { kind: "incoming"; id: string; type: string; field: string; label?: string }
	| { kind: "rollup"; id: string; rollup: RollupDef; label?: string }
	| { kind: "formula"; id: string; formula: string; label?: string; type?: FType };

export interface Condition {
	field: string;
	op: string;
	value?: unknown;
}
export interface FilterGroup {
	mode: "all" | "any";
	items: (Condition | FilterGroup)[];
}
export const isGroup = (x: Condition | FilterGroup): x is FilterGroup => "items" in x;

export interface SortLevel {
	by: string;
	dir: "asc" | "desc";
}
export interface GroupBy {
	by: string;
	date?: "month" | "year";
}

export const HIGHLIGHT_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "grey"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export const HIGHLIGHT_ICONS = ["alert-triangle", "alert-circle", "check-circle", "clock", "flag", "star", "flame", "circle-dot", "x-circle", "lock"] as const;
/** A rule's target when it styles the whole row (otherwise the target is a column id). */
export const ROW_TARGET = "row";

export interface HighlightStyle {
	fill?: HighlightColor;
	text?: HighlightColor;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	icon?: string;
}

/**
 * A data bar's or colour scale's end point: "auto" (from the values), a fixed number, a percentile ("p50"), or
 * for date columns a date or relative date ("today", "+30d", "2026-12-31").
 */
export type ScaleBound = "auto" | number | string;

export interface BarOptions {
	color?: HighlightColor;
	/** fade the bar out towards its end */
	gradient?: boolean;
	min?: ScaleBound;
	max?: ScaleBound;
	/** colour for negative values (default red) */
	negative?: HighlightColor;
	/** hide the value, show only the bar */
	barOnly?: boolean;
}

export interface ScaleOptions {
	/** low → high (2) or low → middle → high (3) */
	colors: HighlightColor[];
	min?: ScaleBound;
	mid?: ScaleBound;
	max?: ScaleBound;
}

export type HighlightKind = "highlight" | "bar" | "scale";

/**
 * Conditional formatting: rows (or one column's cells) matching `when` get `style`. The first matching rule wins.
 * Data bars and colour scales (kind "bar" / "scale") apply to one number or date column, on the rows `when` matches.
 */
export interface HighlightRule {
	name?: string;
	kind?: HighlightKind;
	target: string;
	when: FilterGroup;
	style: HighlightStyle;
	bar?: BarOptions;
	scale?: ScaleOptions;
	off?: boolean;
}

export interface ViewDef {
	kind: ViewKind;
	/** type keys, "@group" or "*" (like relation targets) */
	types: string[];
	columns: ColumnDef[];
	widths: Record<string, number>;
	/** columns that grow to fill spare width (their `widths` entry is the minimum) */
	fill: string[];
	/** the last frozen column: it and every column to its left stay visible when scrolling sideways */
	freeze?: string;
	/** row height: compact or comfortable (normal when unset) */
	density?: "compact" | "comfortable";
	/** columns whose text wraps (rows grow to fit) */
	wrap: string[];
	/** most lines a wrapped cell shows (0: unlimited; 5 when unset) */
	wrapLines?: number;
	/** column id → display format (numbers and dates; see formats.ts) */
	formats: Record<string, string>;
	/** column id → summary aggregation (see summary.ts) */
	summary: Record<string, string>;
	sort: SortLevel[];
	/** grouping levels, outermost first (empty: not grouped) */
	group: GroupBy[];
	/** show column summaries in group headers (default on) */
	groupSummaries?: false;
	/** label group headers "Field: value" (default on) */
	groupFieldNames?: false;
	filters: FilterGroup;
	/** conditional formatting, in priority order */
	highlight: HighlightRule[];
	/** the board layout's own settings (kept whichever layout is shown) */
	board?: BoardDef;
}

/** Card widths (px) per card size. */
export const CARD_WIDTH = { small: 220, medium: 280, large: 360 } as const;

/** A board's settings. Bucket keys are values (status, choice), "yes" / "no" (checkboxes), note paths (links) or BUCKET_NONE. */
export interface BoardDef {
	/** the field whose values are the buckets: status or one of the entity's own choice, checkbox or single-link fields */
	buckets?: string;
	/** one grouping level, shown as horizontal swimlanes */
	swimlanes?: GroupBy;
	/** columns shown on cards (unset: the table's first few columns) */
	cardFields?: string[];
	collapsedBuckets: string[];
	hiddenBuckets: string[];
	hideEmpty?: true;
	/** bucket key → most cards it should hold */
	limits: Record<string, number>;
	cardSize?: "small" | "large";
	/** show the type's subtitle under the card title */
	cardSubtitle?: true;
	/** label each card field with its name */
	cardLabels?: true;
	/** bucket key → note paths in manual order (used when the view isn't sorted) */
	order: Record<string, string[]>;
	/** bucket keys in the order they're shown (unset: the field's order); the empty bucket is always last */
	bucketOrder?: string[];
}

export const emptyBoard = (): BoardDef => ({ collapsedBuckets: [], hiddenBuckets: [], limits: {}, order: {} });

export const NAME_COLUMN: ColumnDef = { kind: "builtin", id: "name", key: "name" };

/** Lines a wrapped cell shows unless the view says otherwise. */
export const WRAP_LINES_DEFAULT = 5;
/** Row heights (px) per density. */
export const DENSITY_ROW_H = { compact: 26, normal: 34, comfortable: 44 } as const;
export const rowHeight = (def: Pick<ViewDef, "density">) => DENSITY_ROW_H[def.density ?? "normal"];

/** Top offsets of items with the given heights (one more entry than items: the total at the end). */
export function rowOffsets(heights: number[]): number[] {
	const out = new Array<number>(heights.length + 1);
	out[0] = 0;
	for (let i = 0; i < heights.length; i++) out[i + 1] = out[i] + heights[i];
	return out;
}

/** The item at a vertical position (clamped to the items), by binary search over the offsets. */
export function itemAt(offsets: number[], y: number): number {
	const n = offsets.length - 1;
	if (n <= 0) return 0;
	let lo = 0;
	let hi = n - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (offsets[mid] <= y) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

export function emptyView(types: string[] = ["*"]): ViewDef {
	return { kind: "table", types, columns: [NAME_COLUMN], widths: {}, fill: [], wrap: [], formats: {}, summary: {}, sort: [], group: [], filters: { mode: "all", items: [] }, highlight: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A field column. Its id is the key, unless that would read as a built-in or an incoming column ("f:<key>"). */
export function fieldColumn(key: string, label?: string): ColumnDef {
	const id = isBuiltin(key) || /^(in|f):/.test(key) ? `f:${key}` : key;
	return { kind: "field", id, key, ...(label ? { label } : {}) };
}

/** A column from its id / short form: a built-in key, "in:<type>.<field>", "f:<field key>", or a field key. */
export function columnFromId(id: string): ColumnDef {
	if (isBuiltin(id)) return { kind: "builtin", id, key: id };
	if (id.startsWith("in:")) {
		const [type, field] = id.slice(3).split(".");
		return { kind: "incoming", id, type: type ?? "", field: field ?? "" };
	}
	if (id.startsWith("f:")) return fieldColumn(id.slice(2));
	return { kind: "field", id, key: id };
}

function parseColumn(raw: unknown, errors: string[], taken: Set<string>): ColumnDef | null {
	const uniqueId = (base: string) => {
		let id = toKey(base) || "column";
		for (let n = 2; taken.has(id); n++) id = `${toKey(base) || "column"}_${n}`;
		return id;
	};
	if (typeof raw === "string") return raw.trim() ? columnFromId(raw.trim()) : null;
	if (!isObj(raw)) {
		errors.push(`A column isn't a name or an object: ${JSON.stringify(raw)}.`);
		return null;
	}
	const label = str(raw.label) || undefined;
	if (typeof raw.field === "string") return fieldColumn(raw.field, label);
	if (typeof raw.builtin === "string") {
		if (!isBuiltin(raw.builtin)) {
			errors.push(`Unknown built-in column "${raw.builtin}".`);
			return null;
		}
		return { kind: "builtin", id: raw.builtin, key: raw.builtin, ...(label ? { label } : {}) };
	}
	if (typeof raw.incoming === "string") {
		const [type, field] = raw.incoming.split(".");
		if (!type || !field) {
			errors.push(`Incoming column "${raw.incoming}" should be "<type>.<field>".`);
			return null;
		}
		return { kind: "incoming", id: `in:${type}.${field}`, type, field, ...(label ? { label } : {}) };
	}
	if (isObj(raw.rollup)) {
		const r = raw.rollup;
		const via = str(r.via);
		const agg = str(r.agg) as RollupAgg;
		if (!/^(field:[^\s]+|in:[^.\s]+\.[^\s]+)$/.test(via)) {
			errors.push(`Roll-up "via" should be "field:<key>" or "in:<type>.<field>" (got "${via}").`);
			return null;
		}
		if (!ROLLUP_AGGS.includes(agg)) {
			errors.push(`Unknown roll-up aggregation "${agg}".`);
			return null;
		}
		const field = str(r.field) || undefined;
		if (AGG_FIELD_KINDS[agg] && !field) {
			errors.push(`Roll-up "${agg}" needs a field.`);
			return null;
		}
		const id = str(raw.id) || uniqueId(label ?? `${via}_${agg}`);
		return { kind: "rollup", id, rollup: { via, agg, ...(field ? { field } : {}) }, ...(label ? { label } : {}) };
	}
	if (typeof raw.formula === "string") {
		const id = str(raw.id) || uniqueId(label ?? "formula");
		const type = FTYPES.includes(raw.type as FType) ? { type: raw.type as FType } : {};
		if (raw.type !== undefined && !type.type) errors.push(`Unknown formula type "${String(raw.type)}". Use ${FTYPES.join(", ")}.`);
		return { kind: "formula", id, formula: raw.formula, ...(label ? { label } : {}), ...type };
	}
	errors.push(`Unknown column: ${JSON.stringify(raw)}.`);
	return null;
}

function parseFilterItems(raw: unknown, errors: string[], depth: number): FilterGroup | null {
	if (raw === undefined || raw === null) return { mode: "all", items: [] };
	if (!isObj(raw) || (!Array.isArray(raw.all) && !Array.isArray(raw.any))) {
		errors.push('Filters should be { all: [...] } or { any: [...] }.');
		return null;
	}
	const mode = Array.isArray(raw.all) ? "all" : "any";
	const items: (Condition | FilterGroup)[] = [];
	for (const item of (raw[mode] as unknown[]) ?? []) {
		if (isObj(item) && (Array.isArray(item.all) || Array.isArray(item.any))) {
			if (depth >= 1) {
				errors.push("Filter groups can only be nested one level.");
				continue;
			}
			const g = parseFilterItems(item, errors, depth + 1);
			if (g) items.push(g);
		} else if (isObj(item) && typeof item.field === "string" && typeof item.op === "string") {
			items.push({ field: item.field, op: item.op, ...(item.value !== undefined ? { value: item.value } : {}) });
		} else errors.push(`A filter condition needs "field" and "op": ${JSON.stringify(item)}.`);
	}
	return { mode, items };
}

/** Read a view definition (the block's YAML, already parsed). Problems that stop the view from showing are errors. */
export function parseView(raw: unknown): { def: ViewDef | null; errors: string[] } {
	const errors: string[] = [];
	if (raw === null || raw === undefined) return { def: emptyView(), errors };
	if (!isObj(raw)) return { def: null, errors: ["The view definition should be YAML keys like kind:, types:, columns:."] };
	const kind = (str(raw.kind) || "table") as ViewKind;
	if (!VIEW_KINDS.includes(kind)) errors.push(`Unknown view kind "${kind}". Supported: ${VIEW_KINDS.join(", ")}.`);
	const types = raw.types === undefined ? ["*"] : asArray(raw.types).map(String).filter(Boolean);
	const taken = new Set<string>();
	const columns: ColumnDef[] = [];
	for (const c of asArray(raw.columns)) {
		const col = parseColumn(c, errors, taken);
		if (!col || taken.has(col.id)) continue;
		taken.add(col.id);
		columns.push(col);
	}
	// Name is always first.
	const nameAt = columns.findIndex((c) => c.id === "name");
	const name = nameAt >= 0 ? columns.splice(nameAt, 1)[0] : NAME_COLUMN;
	columns.unshift(name);

	const widths: Record<string, number> = {};
	if (isObj(raw.widths)) for (const [k, v] of Object.entries(raw.widths)) if (typeof v === "number" && v > 0) widths[k] = Math.round(v);
	const fill = [...new Set(asArray(raw.fill).filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim()))];
	const freeze = typeof raw.freeze === "string" && raw.freeze.trim() ? { freeze: raw.freeze.trim() } : {};
	const density = raw.density === "compact" || raw.density === "comfortable" ? { density: raw.density as "compact" | "comfortable" } : {};
	if (raw.density !== undefined && raw.density !== "normal" && !density.density) errors.push(`Unknown density "${String(raw.density)}". Use compact, normal or comfortable.`);
	const wrap = [...new Set(asArray(raw.wrap).filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim()))];
	const lines = raw.wrapLines === "unlimited" ? 0 : typeof raw.wrapLines === "number" && raw.wrapLines >= 0 ? Math.round(raw.wrapLines) : undefined;
	const wrapLines = lines !== undefined && lines !== WRAP_LINES_DEFAULT ? { wrapLines: lines } : {};
	const formats: Record<string, string> = {};
	if (isObj(raw.formats)) for (const [k, v] of Object.entries(raw.formats)) if (typeof v === "string" && v.trim()) formats[k] = v;
	const summary: Record<string, string> = {};
	if (isObj(raw.summary)) for (const [k, v] of Object.entries(raw.summary)) if (typeof v === "string" && v.trim()) summary[k] = v.trim();

	const sort: SortLevel[] = [];
	for (const s of asArray(raw.sort)) {
		if (typeof s === "string" && s.trim()) sort.push({ by: s.trim(), dir: "asc" });
		else if (isObj(s) && typeof s.by === "string") sort.push({ by: s.by, dir: s.dir === "desc" ? "desc" : "asc" });
	}
	const group: GroupBy[] = [];
	if (raw.group !== undefined && raw.group !== null) {
		if (!Array.isArray(raw.group)) errors.push("group should be a list of levels, e.g. group: [{ by: status }, { by: due, date: month }].");
		else
			for (const g of raw.group) {
				const by = typeof g === "string" ? g.trim() : isObj(g) && typeof g.by === "string" ? g.by.trim() : "";
				if (!by) {
					errors.push(`A group level needs "by": ${JSON.stringify(g)}.`);
					continue;
				}
				if (group.some((x) => x.by === by)) continue;
				const date = isObj(g) && (g.date === "month" || g.date === "year") ? g.date : undefined;
				group.push({ by, ...(date ? { date } : {}) });
			}
	}
	const groupSummaries = raw.groupSummaries === false ? { groupSummaries: false as const } : {};
	const groupFieldNames = raw.groupFieldNames === false ? { groupFieldNames: false as const } : {};

	const filters = parseFilterItems(raw.filters, errors, 0) ?? { mode: "all", items: [] };
	const highlight = parseHighlight(raw.highlight, errors);
	const board = raw.board === undefined || raw.board === null ? {} : { board: parseBoard(raw.board, errors) };
	if (errors.length && !VIEW_KINDS.includes(kind)) return { def: null, errors };
	return { def: { kind, types: types.length ? types : ["*"], columns, widths, fill, ...freeze, ...density, wrap, ...wrapLines, formats, summary, sort, group, ...groupSummaries, ...groupFieldNames, filters, highlight, ...board }, errors };
}

const strList = (v: unknown) => [...new Set(asArray(v).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()))];

function parseGroupBy(g: unknown): GroupBy | null {
	const by = typeof g === "string" ? g.trim() : isObj(g) && typeof g.by === "string" ? g.by.trim() : "";
	if (!by) return null;
	const date = isObj(g) && (g.date === "month" || g.date === "year") ? g.date : undefined;
	return { by, ...(date ? { date } : {}) };
}

function parseBoard(raw: unknown, errors: string[]): BoardDef {
	const b = emptyBoard();
	if (!isObj(raw)) {
		errors.push("board should be a set of keys like buckets:, cardFields:.");
		return b;
	}
	if (typeof raw.buckets === "string" && raw.buckets.trim()) b.buckets = raw.buckets.trim();
	if (raw.swimlanes !== undefined && raw.swimlanes !== null) {
		const g = parseGroupBy(Array.isArray(raw.swimlanes) ? raw.swimlanes[0] : raw.swimlanes);
		if (g) b.swimlanes = g;
		else errors.push(`board swimlanes should be a column id: ${JSON.stringify(raw.swimlanes)}.`);
	}
	if (raw.cardFields !== undefined) b.cardFields = strList(raw.cardFields);
	b.collapsedBuckets = strList(raw.collapsedBuckets);
	b.hiddenBuckets = strList(raw.hiddenBuckets);
	if (raw.hideEmpty === true) b.hideEmpty = true;
	if (isObj(raw.limits)) for (const [k, v] of Object.entries(raw.limits)) if (typeof v === "number" && v > 0) b.limits[k] = Math.round(v);
	if (raw.cardSize === "small" || raw.cardSize === "large") b.cardSize = raw.cardSize;
	else if (raw.cardSize !== undefined && raw.cardSize !== "medium") errors.push(`Unknown card size "${String(raw.cardSize)}". Use small, medium or large.`);
	if (raw.cardSubtitle === true) b.cardSubtitle = true;
	if (raw.cardLabels === true) b.cardLabels = true;
	if (isObj(raw.order)) for (const [k, v] of Object.entries(raw.order)) if (Array.isArray(v)) b.order[k] = strList(v);
	if (raw.bucketOrder !== undefined) {
		const keys = strList(raw.bucketOrder).filter((k) => k !== "(none)");
		if (keys.length) b.bucketOrder = keys;
	}
	return b;
}

/** The board's settings as plain data, leaving out defaults (undefined when there's nothing to write). */
function serializeBoard(b: BoardDef | undefined): Record<string, unknown> | undefined {
	if (!b) return undefined;
	const out: Record<string, unknown> = {};
	if (b.buckets) out.buckets = b.buckets;
	if (b.swimlanes) out.swimlanes = b.swimlanes.date ? { by: b.swimlanes.by, date: b.swimlanes.date } : b.swimlanes.by;
	if (b.cardFields) out.cardFields = b.cardFields;
	if (b.cardSize) out.cardSize = b.cardSize;
	if (b.cardSubtitle) out.cardSubtitle = true;
	if (b.cardLabels) out.cardLabels = true;
	if (b.hideEmpty) out.hideEmpty = true;
	if (b.collapsedBuckets.length) out.collapsedBuckets = b.collapsedBuckets;
	if (b.hiddenBuckets.length) out.hiddenBuckets = b.hiddenBuckets;
	if (b.bucketOrder?.length) out.bucketOrder = b.bucketOrder;
	if (Object.keys(b.limits).length) out.limits = b.limits;
	const order = Object.fromEntries(Object.entries(b.order).filter(([, v]) => v.length));
	if (Object.keys(order).length) out.order = order;
	return Object.keys(out).length ? out : undefined;
}

const isColor = (v: unknown): v is HighlightColor => HIGHLIGHT_COLORS.includes(v as HighlightColor);

function parseHighlight(raw: unknown, errors: string[]): HighlightRule[] {
	const rules: HighlightRule[] = [];
	if (raw === undefined || raw === null) return rules;
	if (!Array.isArray(raw)) {
		errors.push("highlight should be a list of rules.");
		return rules;
	}
	for (const item of raw) {
		if (!isObj(item)) {
			errors.push(`A highlight rule should have target, when and style: ${JSON.stringify(item)}.`);
			continue;
		}
		const when = item.when === undefined ? { mode: "all" as const, items: [] } : parseFilterItems(item.when, errors, 0);
		if (!when) continue;
		const s = isObj(item.style) ? item.style : {};
		const style: HighlightStyle = {};
		for (const k of ["fill", "text"] as const) {
			if (isColor(s[k])) style[k] = s[k];
			else if (s[k] !== undefined) errors.push(`Unknown highlight colour "${String(s[k])}". Use ${HIGHLIGHT_COLORS.join(", ")}.`);
		}
		for (const k of ["bold", "italic", "strike"] as const) if (s[k] === true) style[k] = true;
		if (typeof s.icon === "string" && s.icon.trim()) style.icon = s.icon.trim();
		const name = str(item.name);
		const kind: HighlightKind = item.kind === "bar" || item.kind === "scale" ? item.kind : "highlight";
		if (item.kind !== undefined && item.kind !== kind) errors.push(`Unknown highlight kind "${String(item.kind)}". Use highlight, bar or scale.`);
		const color = (v: unknown, what: string): HighlightColor | undefined => {
			if (v === undefined) return undefined;
			if (isColor(v)) return v;
			errors.push(`Unknown ${what} colour "${String(v)}". Use ${HIGHLIGHT_COLORS.join(", ")}.`);
			return undefined;
		};
		const bound = (v: unknown): ScaleBound | undefined => (v === undefined || v === null || v === "auto" ? undefined : typeof v === "number" ? v : typeof v === "string" && v.trim() ? v.trim() : undefined);
		const extra: Partial<HighlightRule> = {};
		if (kind === "bar") {
			const b = isObj(item.bar) ? item.bar : {};
			const bar: BarOptions = {};
			const c = color(b.color, "bar");
			if (c) bar.color = c;
			const neg = color(b.negative, "negative bar");
			if (neg) bar.negative = neg;
			if (b.gradient === true) bar.gradient = true;
			if (b.barOnly === true) bar.barOnly = true;
			for (const k of ["min", "max"] as const) {
				const v = bound(b[k]);
				if (v !== undefined) bar[k] = v;
			}
			extra.bar = bar;
		} else if (kind === "scale") {
			const sc = isObj(item.scale) ? item.scale : {};
			const colors = asArray(sc.colors)
				.map((c) => color(c, "scale"))
				.filter((c): c is HighlightColor => !!c);
			const scale: ScaleOptions = { colors: colors.length >= 2 && colors.length <= 3 ? colors : ["red", "yellow", "green"] };
			if (colors.length && (colors.length < 2 || colors.length > 3)) errors.push("A colour scale needs 2 or 3 colours.");
			for (const k of ["min", "mid", "max"] as const) {
				const v = bound(sc[k]);
				if (v !== undefined) scale[k] = v;
			}
			extra.scale = scale;
		}
		rules.push({
			...(name ? { name } : {}),
			...(kind !== "highlight" ? { kind } : {}),
			target: str(item.target) || ROW_TARGET,
			when,
			style,
			...extra,
			...(item.off === true ? { off: true } : {}),
		});
	}
	return rules;
}

function serializeColumn(c: ColumnDef): unknown {
	const label = c.label ? { label: c.label } : {};
	switch (c.kind) {
		case "builtin":
			return c.label ? { builtin: c.key, ...label } : c.key;
		case "field":
			return c.label || c.id !== c.key ? { field: c.key, ...label } : c.key;
		case "incoming":
			return c.label ? { incoming: `${c.type}.${c.field}`, ...label } : c.id;
		case "rollup":
			return { rollup: { ...c.rollup }, ...label, id: c.id };
		case "formula":
			return { formula: c.formula, ...label, id: c.id, ...(c.type ? { type: c.type } : {}) };
	}
}

function serializeFilters(g: FilterGroup): Record<string, unknown> {
	return { [g.mode]: g.items.map((i) => (isGroup(i) ? serializeFilters(i) : { field: i.field, op: i.op, ...(i.value !== undefined ? { value: i.value } : {}) })) };
}

/** The definition as plain data for YAML, leaving out empty parts. */
export function serializeView(def: ViewDef): Record<string, unknown> {
	const out: Record<string, unknown> = { kind: def.kind, types: def.types, columns: def.columns.map(serializeColumn) };
	// Formats and summaries also apply to card fields that aren't table columns.
	const referenced = new Set([...def.columns.map((c) => c.id), ...(def.board?.cardFields ?? [])]);
	const widths = Object.fromEntries(Object.entries(def.widths).filter(([id]) => def.columns.some((c) => c.id === id)));
	if (Object.keys(widths).length) out.widths = widths;
	const fill = (def.fill ?? []).filter((id) => def.columns.some((c) => c.id === id));
	if (fill.length) out.fill = fill.length === 1 ? fill[0] : fill;
	if (def.freeze && def.columns.some((c) => c.id === def.freeze)) out.freeze = def.freeze;
	if (def.density) out.density = def.density;
	const wrap = (def.wrap ?? []).filter((id) => def.columns.some((c) => c.id === id));
	if (wrap.length) out.wrap = wrap;
	if (def.wrapLines !== undefined && def.wrapLines !== WRAP_LINES_DEFAULT) out.wrapLines = def.wrapLines === 0 ? "unlimited" : def.wrapLines;
	const formats = Object.fromEntries(Object.entries(def.formats ?? {}).filter(([id]) => referenced.has(id)));
	if (Object.keys(formats).length) out.formats = formats;
	const summary = Object.fromEntries(Object.entries(def.summary ?? {}).filter(([id]) => referenced.has(id)));
	if (Object.keys(summary).length) out.summary = summary;
	if (def.sort.length) out.sort = def.sort.map((s) => ({ by: s.by, dir: s.dir }));
	if (def.group.length) out.group = def.group.map((g) => ({ by: g.by, ...(g.date ? { date: g.date } : {}) }));
	if (def.groupSummaries === false) out.groupSummaries = false;
	if (def.groupFieldNames === false) out.groupFieldNames = false;
	if (def.filters.items.length) out.filters = serializeFilters(def.filters);
	if (def.highlight?.length)
		out.highlight = def.highlight.map((r) => {
			const style = Object.fromEntries(Object.entries(r.style).filter(([, v]) => v !== undefined && v !== false && v !== ""));
			const kind = r.kind ?? "highlight";
			const clean = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== "" && v !== "auto"));
			return {
				...(r.name ? { name: r.name } : {}),
				...(kind !== "highlight" ? { kind } : {}),
				target: r.target,
				...(r.when.items.length || kind === "highlight" ? { when: serializeFilters(r.when) } : {}),
				...(kind === "highlight" ? { style } : {}),
				...(kind === "bar" ? { bar: clean(r.bar ?? {}) } : {}),
				...(kind === "scale" ? { scale: clean(r.scale ?? { colors: ["red", "yellow", "green"] }) } : {}),
				...(r.off ? { off: true } : {}),
			};
		});
	const board = serializeBoard(def.board);
	if (board) out.board = board;
	return out;
}

/**
 * How many of the shown columns are frozen (0: none). The frozen column may be hidden (grouped): then the
 * freeze stops at the last shown column before it in the definition.
 */
export function frozenCount(def: ViewDef, shown: { id: string }[]): number {
	if (!def.freeze) return 0;
	const at = def.columns.findIndex((c) => c.id === def.freeze);
	if (at < 0) return 0;
	const upTo = new Set(def.columns.slice(0, at + 1).map((c) => c.id));
	let n = 0;
	while (n < shown.length && upTo.has(shown[n].id)) n++;
	return n;
}

/**
 * Column widths with fill columns sharing the spare width (`available` minus the sum of every width, `extra`
 * included for fixed parts like the selection column), in proportion to their own widths. Rounded to whole
 * pixels; the last fill column takes the remainder, so the total meets `available` exactly.
 */
export function fillWidths(cols: { id: string; w: number }[], fill: string[], available: number, extra = 0): Record<string, number> {
	const out = Object.fromEntries(cols.map((c) => [c.id, c.w]));
	const flex = cols.filter((c) => fill.includes(c.id));
	const spare = Math.floor(available - extra - cols.reduce((n, c) => n + c.w, 0));
	if (!flex.length || spare <= 0) return out;
	const total = flex.reduce((n, c) => n + c.w, 0) || 1;
	let given = 0;
	flex.forEach((c, i) => {
		const add = i === flex.length - 1 ? spare - given : Math.floor((spare * c.w) / total);
		given += add;
		out[c.id] = c.w + add;
	});
	return out;
}

// ---------------------------------------------------------------- rows and context

export interface ViewRow extends EntityInfo {
	aliases: string[];
	/** folder path ("" for the vault root) */
	folder: string;
}

/** A link into the row from another entity's relation field. */
export interface IncomingLink {
	source: string;
	sourceType: string;
	fieldKey: string;
}

export interface ViewContext {
	types: EntityTypeDef[];
	groups: GroupDef[];
	dates: DateAdapter;
	/** today, in the date adapter's units (days since 1970-01-01 for ISO dates) */
	today: number;
	/** resolve a link path written on `sourcePath` to a note path (null when no note exists) */
	resolve(linkpath: string, sourcePath: string): string | null;
	row(path: string): ViewRow | undefined;
	incoming(path: string): IncomingLink[];
	/** for column formats: moment.js (date patterns), the number locale and the default currency */
	moment?: MomentLike;
	locale?: string;
	currency?: string;
}

/** Types the view's `types` select. */
export function sourceTypes(def: ViewDef, types: EntityTypeDef[]): EntityTypeDef[] {
	const targets = def.types.length === 0 || def.types.includes("*") ? undefined : def.types;
	return types.filter((t) => typeMatchesTarget(t, targets));
}

/** `types` entries that name no existing type or group. */
export function unknownSources(def: ViewDef, types: EntityTypeDef[], groups: GroupDef[]): string[] {
	return def.types.filter((t) => t !== "*" && !(t.startsWith("@") ? groups.some((g) => `@${g.key}` === t) : types.some((x) => x.key === t)));
}

// ---------------------------------------------------------------- columns

/** How a column's values behave for filters, sorting and grouping. */
export type ValueKind = "text" | "number" | "date" | "choice" | "multi" | "bool" | "links" | "folder";

export interface ResolvedColumn {
	def: ColumnDef;
	id: string;
	label: string;
	kind: ValueKind;
	/** the field definition (field columns), from the first source type that has it */
	field?: FieldDef;
	/** can be edited in place */
	editable: boolean;
	/** why the column can't show values */
	invalid?: string;
	/** choices for choice/multi columns (options, statuses, type keys) */
	options?: string[];
	/** formula columns: the compiled formula, its referenced columns and its result type */
	formula?: { compiled: Compiled; refs: Map<string, ResolvedColumn>; type: FType };
}

const FIELD_VALUE_KIND: Record<string, ValueKind> = {
	text: "text",
	textarea: "text",
	url: "text",
	number: "number",
	date: "date",
	select: "choice",
	multiselect: "multi",
	list: "multi",
	boolean: "bool",
	relation: "links",
};

function fieldOf(key: string, types: EntityTypeDef[]): FieldDef | undefined {
	for (const t of types) {
		const f = t.fields.find((x) => x.key === key);
		if (f) return f;
	}
	return undefined;
}

/** The relation field behind an "in:<type>.<field>" or "field:<key>" path. */
function viaField(via: string, sources: EntityTypeDef[], types: EntityTypeDef[]): { field?: FieldDef; type?: EntityTypeDef; incoming: boolean } {
	if (via.startsWith("field:")) return { field: fieldOf(via.slice(6), sources), incoming: false };
	const [tk, fk] = via.slice(3).split(".");
	const type = types.find((t) => t.key === tk);
	return { type, field: type?.fields.find((f) => f.key === fk), incoming: true };
}

/** Targets of a relation field, as types (any entity when unrestricted). */
function targetTypes(f: FieldDef | undefined, types: EntityTypeDef[]): EntityTypeDef[] {
	return f ? types.filter((t) => typeMatchesTarget(t, f.targets)) : [];
}

export function incomingLabel(type: EntityTypeDef | undefined, field: FieldDef | undefined, fallback: string): string {
	if (!type || !field) return fallback;
	return field.inverse || `${field.label} (from ${type.name})`;
}

export function rollupLabel(r: RollupDef, sources: EntityTypeDef[], types: EntityTypeDef[]): string {
	const v = viaField(r.via, sources, types);
	const rel = v.incoming ? incomingLabel(v.type, v.field, r.via) : (v.field?.label ?? r.via.slice(6));
	const linked = v.incoming ? (v.type ? [v.type] : []) : targetTypes(v.field, types);
	const fieldLabel = r.field ? (fieldOf(r.field, linked)?.label ?? r.field) : "";
	return `${rel}: ${AGG_LABELS[r.agg]}${fieldLabel ? ` of ${fieldLabel.toLowerCase()}` : ""}`;
}

function statusOptions(sources: EntityTypeDef[], groups: GroupDef[]): string[] {
	const out: string[] = [];
	for (const t of sources) for (const s of statusesFor(t, groups)) if (!out.includes(s)) out.push(s);
	return out;
}

export function resolveColumn(col: ColumnDef, def: ViewDef, ctx: Pick<ViewContext, "types" | "groups">, stack: string[] = []): ResolvedColumn {
	const sources = sourceTypes(def, ctx.types);
	const base = { def: col, id: col.id };
	switch (col.kind) {
		case "builtin": {
			const label = col.label ?? BUILTIN_LABELS[col.key];
			switch (col.key) {
				case "name":
					return { ...base, label, kind: "text", editable: false };
				case "type":
					return { ...base, label, kind: "choice", editable: false, options: sources.map((t) => t.key) };
				case "status":
					return { ...base, label, kind: "choice", editable: true, options: statusOptions(sources, ctx.groups) };
				case "tags":
					return { ...base, label, kind: "multi", editable: true };
				case "aliases":
					return { ...base, label, kind: "multi", editable: false };
				case "related":
					return { ...base, label, kind: "links", editable: false };
				case "folder":
					return { ...base, label, kind: "folder", editable: false };
				default:
					return { ...base, label, kind: "date", editable: false };
			}
		}
		case "field": {
			const field = fieldOf(col.key, sources);
			if (!field) return { ...base, label: col.label ?? col.key, kind: "text", editable: false, invalid: `No source type has a "${col.key}" field.` };
			return { ...base, label: col.label ?? field.label, kind: FIELD_VALUE_KIND[field.kind] ?? "text", field, editable: true, ...(field.options ? { options: field.options } : {}) };
		}
		case "incoming": {
			const type = ctx.types.find((t) => t.key === col.type);
			const field = type?.fields.find((f) => f.key === col.field && f.kind === "relation");
			const label = col.label ?? incomingLabel(type, field, col.id);
			return { ...base, label, kind: "links", editable: false, ...(field ? {} : { invalid: `There's no relation field "${col.field}" on type "${col.type}".` }) };
		}
		case "rollup": {
			const r = col.rollup;
			const label = col.label ?? rollupLabel(r, sources, ctx.types);
			const v = viaField(r.via, sources, ctx.types);
			const kind: ValueKind = ["count", "sum", "avg", "min", "max", "percent-done"].includes(r.agg) ? "number" : r.agg === "earliest" || r.agg === "latest" ? "date" : r.agg === "list" || r.agg === "unique" ? "multi" : "text";
			const invalid = !v.field || v.field.kind !== "relation" ? `The roll-up's relationship "${r.via}" doesn't exist.` : undefined;
			return { ...base, label, kind, editable: false, ...(invalid ? { invalid } : {}) };
		}
		case "formula":
			return resolveFormula(col, def, ctx, stack);
	}
}

/** The formula type a column's values have. */
export const kindToFType = (kind: ValueKind): FType =>
	kind === "number" ? "number" : kind === "date" ? "date" : kind === "bool" ? "bool" : kind === "multi" ? "list" : kind === "links" ? "links" : "text";
/** The value kind (for filters, sorting and grouping) of a formula result type. */
export const ftypeToKind = (t: FType): ValueKind => (t === "number" ? "number" : t === "date" ? "date" : t === "bool" ? "bool" : t === "list" ? "multi" : t === "links" ? "links" : "text");

/**
 * Columns a formula can refer to: the view's columns plus everything it could show (fields of the source
 * types, built-ins, incoming links), each once.
 */
export function formulaUniverse(def: ViewDef, ctx: Pick<ViewContext, "types" | "groups">): ColumnDef[] {
	const out: ColumnDef[] = [...def.columns];
	const a = availableColumns(def, ctx);
	for (const c of [...a.fields, ...a.builtins, ...a.incoming]) if (!out.some((x) => x.id === c.id)) out.push(c);
	return out;
}

/** The universe as formula reference columns (labels and types), for compiling and the editor. Formula types resolve lazily. */
export function formulaRefColumns(def: ViewDef, ctx: Pick<ViewContext, "types" | "groups">, stack: string[] = []): RefColumn[] {
	return formulaUniverse(def, ctx).map((c) => {
		if (c.kind !== "formula") {
			const r = resolveColumn(c, def, ctx);
			return { id: c.id, label: r.label, type: kindToFType(r.kind) };
		}
		let type: FType | undefined;
		return {
			id: c.id,
			label: c.label ?? "Formula",
			get type() {
				type ??= c.type ?? resolveColumn(c, def, ctx, stack).formula?.type ?? "any";
				return type;
			},
		};
	});
}

const formulaCache = new WeakMap<ViewDef, WeakMap<object, Map<string, ResolvedColumn>>>();

function resolveFormula(col: Extract<ColumnDef, { kind: "formula" }>, def: ViewDef, ctx: Pick<ViewContext, "types" | "groups">, stack: string[]): ResolvedColumn {
	const base = { def: col as ColumnDef, id: col.id, label: col.label ?? "Formula", kind: ftypeToKind(col.type ?? "text"), editable: false };
	const labelOf = (id: string) => (def.columns.find((c) => c.id === id) as { label?: string } | undefined)?.label ?? id;
	if (stack.includes(col.id)) return { ...base, invalid: `Circular reference: ${[...stack.slice(stack.indexOf(col.id)), col.id].map(labelOf).join(" → ")}.` };
	// Cache top-level resolutions per definition and type list (the table resolves columns often).
	const top = stack.length === 0;
	const cache = top ? formulaCache.get(def)?.get(ctx.types) : undefined;
	const hit = cache?.get(col.id);
	if (hit && hit.def === col) return hit;
	const inner = [...stack, col.id];
	let out: ResolvedColumn;
	try {
		const compiled = compile(col.formula, formulaRefColumns(def, ctx, inner));
		const refs = new Map<string, ResolvedColumn>();
		for (const id of compiled.refs) {
			const c = formulaUniverse(def, ctx).find((x) => x.id === id)!;
			const r = resolveColumn(c, def, ctx, inner);
			if (r.invalid && c.kind === "formula") throw new FormulaError(r.invalid.startsWith("Circular") ? r.invalid : `[${r.label}] has a problem: ${r.invalid}`);
			refs.set(id, r);
		}
		const type = col.type ?? compiled.type;
		out = { ...base, kind: ftypeToKind(type), formula: { compiled, refs, type } };
	} catch (e) {
		out = { ...base, invalid: e instanceof FormulaError ? e.message : String(e) };
	}
	if (top) {
		let byTypes = formulaCache.get(def);
		if (!byTypes) formulaCache.set(def, (byTypes = new WeakMap()));
		let m = byTypes.get(ctx.types);
		if (!m) byTypes.set(ctx.types, (m = new Map()));
		m.set(col.id, out);
	}
	return out;
}

/** Every column the view could show, for the column picker. */
export function availableColumns(def: ViewDef, ctx: Pick<ViewContext, "types" | "groups">): { fields: ColumnDef[]; builtins: ColumnDef[]; incoming: ColumnDef[] } {
	const sources = sourceTypes(def, ctx.types);
	const fields: ColumnDef[] = [];
	for (const t of sources) for (const f of t.fields) if (!fields.some((c) => c.kind === "field" && c.key === f.key)) fields.push(fieldColumn(f.key));
	const builtins = BUILTINS.filter((b) => b !== "name").map((b) => columnFromId(b));
	const incoming: ColumnDef[] = [];
	for (const t of ctx.types)
		for (const f of t.fields)
			if (f.kind === "relation" && sources.some((s) => typeMatchesTarget(s, f.targets)) && (f.targets ?? []).length > 0 && !(f.targets ?? []).includes("*")) incoming.push(columnFromId(`in:${t.key}.${f.key}`));
	return { fields, builtins, incoming };
}

/** Relationships a roll-up can follow from the view's types: outgoing relation fields and incoming ones. */
export function rollupSources(def: ViewDef, ctx: Pick<ViewContext, "types" | "groups">): { via: string; label: string; linked: EntityTypeDef[] }[] {
	const sources = sourceTypes(def, ctx.types);
	const out: { via: string; label: string; linked: EntityTypeDef[] }[] = [];
	for (const t of sources)
		for (const f of t.fields)
			if (f.kind === "relation" && !out.some((o) => o.via === `field:${f.key}`)) out.push({ via: `field:${f.key}`, label: f.label, linked: targetTypes(f, ctx.types) });
	for (const c of availableColumns(def, ctx).incoming) {
		if (c.kind !== "incoming") continue;
		const type = ctx.types.find((t) => t.key === c.type);
		out.push({ via: `in:${c.type}.${c.field}`, label: incomingLabel(type, type?.fields.find((f) => f.key === c.field), c.id), linked: type ? [type] : [] });
	}
	return out;
}

// ---------------------------------------------------------------- cells

export interface LinkValue {
	/** note path, or null for a link to a note that doesn't exist */
	path: string | null;
	linktext: string;
	name: string;
	label?: string;
}

export interface Cell {
	/** normalised value: string | number | boolean | string[] | LinkValue[] | null */
	value: unknown;
	/** text used for display fallbacks and search */
	text: string;
	/** comparison key; null sorts last */
	sort: number | string | null;
	/** why a formula couldn't be worked out for this row */
	error?: string;
}

const EMPTY: Cell = { value: null, text: "", sort: null };
const MS_PER_DAY = 86_400_000;

const toNumber = (v: unknown): number | null => {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
	return null;
};
const basename = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/, "");

function links(raw: unknown, sourcePath: string, ctx: ViewContext, labelled = false): LinkValue[] {
	const out: LinkValue[] = [];
	for (const entry of asArray(raw)) {
		const parsed = labelled ? parseLabelledEntry(entry) : (() => {
			const link = parseLink(entry);
			return link ? { link, label: undefined as string | undefined } : null;
		})();
		if (!parsed) continue;
		const path = ctx.resolve(parsed.link.path, sourcePath);
		out.push({ path, linktext: parsed.link.path, name: path ? (ctx.row(path)?.name ?? basename(path)) : (parsed.link.path.split("/").pop() ?? parsed.link.path), ...(parsed.label ? { label: parsed.label } : {}) });
	}
	return out;
}

function linksCell(list: LinkValue[]): Cell {
	if (list.length === 0) return { value: [], text: "", sort: null };
	const names = list.map((l) => l.name);
	return { value: list, text: names.join(", "), sort: [...names].sort(natural)[0].toLowerCase() };
}

function multiCell(list: string[]): Cell {
	return { value: list, text: list.join(", "), sort: list.length ? [...list].sort(natural)[0].toLowerCase() : null };
}

function dateCell(days: number | null, ctx: ViewContext, display?: string): Cell {
	if (days === null) return EMPTY;
	return { value: days, text: display ?? ctx.dates.format(days, "short"), sort: days };
}

function statusCell(row: ViewRow, ctx: ViewContext): Cell {
	const s = row.status;
	if (!s) return EMPTY;
	const order = statusesFor(row.type, ctx.groups).indexOf(s);
	return { value: s, text: s, sort: order >= 0 ? order : 1000 };
}

/** Rows linked to `row` through a roll-up relationship (resolved entities only, plus the raw link count). */
function linkedRows(row: ViewRow, via: string, ctx: ViewContext): { rows: ViewRow[]; count: number } {
	if (via.startsWith("field:")) {
		const key = via.slice(6);
		const field = row.type.fields.find((f) => f.key === key);
		const ls = links(row.frontmatter[key], row.path, ctx, !!field?.labelled);
		return { rows: ls.map((l) => (l.path ? ctx.row(l.path) : undefined)).filter((r): r is ViewRow => !!r), count: ls.length };
	}
	const [tk, fk] = via.slice(3).split(".");
	const sources = [...new Set(ctx.incoming(row.path).filter((e) => e.sourceType === tk && e.fieldKey === fk).map((e) => e.source))];
	const rows = sources.map((p) => ctx.row(p)).filter((r): r is ViewRow => !!r);
	return { rows, count: sources.length };
}

function rollupCell(row: ViewRow, r: RollupDef, ctx: ViewContext): Cell {
	const { rows, count } = linkedRows(row, r.via, ctx);
	const numbers = () => rows.map((x) => toNumber(x.frontmatter[r.field ?? ""])).filter((n): n is number => n !== null);
	const num = (n: number | null): Cell => (n === null ? EMPTY : { value: n, text: String(Math.round(n * 100) / 100), sort: n });
	switch (r.agg) {
		case "count":
			return { value: count, text: String(count), sort: count };
		case "list":
			return multiCell(rows.map((x) => x.name).sort(natural));
		case "unique": {
			const vals = new Set<string>();
			for (const x of rows) {
				const raw = x.frontmatter[r.field ?? ""];
				const f = x.type.fields.find((ff) => ff.key === r.field);
				if (f?.kind === "relation") for (const l of links(raw, x.path, ctx, !!f.labelled)) vals.add(l.name);
				else for (const v of asArray(raw)) if (!isEmptyValue(v)) vals.add(String(v));
			}
			return multiCell([...vals].sort(natural));
		}
		case "sum": {
			const ns = numbers();
			return num(ns.length ? ns.reduce((a, b) => a + b, 0) : null);
		}
		case "avg": {
			const ns = numbers();
			return num(ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null);
		}
		case "min": {
			const ns = numbers();
			return num(ns.length ? Math.min(...ns) : null);
		}
		case "max": {
			const ns = numbers();
			return num(ns.length ? Math.max(...ns) : null);
		}
		case "earliest":
		case "latest": {
			const ds = rows.map((x) => ctx.dates.parse(x.frontmatter[r.field ?? ""])).filter((p): p is { ok: true; value: number; display: string } => !!p && p.ok).map((p) => p.value);
			if (!ds.length) return EMPTY;
			return dateCell(r.agg === "earliest" ? Math.min(...ds) : Math.max(...ds), ctx);
		}
		case "percent-done": {
			const withStatus = rows.filter((x) => x.status);
			if (!withStatus.length) return EMPTY;
			const done = withStatus.filter((x) => {
				const ss = statusesFor(x.type, ctx.groups);
				return x.status === ss[ss.length - 1];
			}).length;
			const pct = Math.round((done / withStatus.length) * 100);
			return { value: pct, text: `${pct}%`, sort: pct };
		}
		case "count-by-status": {
			const counts = new Map<string, number>();
			const order: string[] = [];
			for (const x of rows) {
				if (!x.status) continue;
				for (const s of statusesFor(x.type, ctx.groups)) if (!order.includes(s)) order.push(s);
				counts.set(x.status, (counts.get(x.status) ?? 0) + 1);
			}
			const parts = order.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s}`);
			for (const [s, n] of counts) if (!order.includes(s)) parts.push(`${n} ${s}`);
			const text = parts.join(" · ");
			return text ? { value: text, text, sort: text.toLowerCase() } : EMPTY;
		}
	}
}

/** The value of one column for one row. */
export function cellOf(row: ViewRow, col: ResolvedColumn, ctx: ViewContext): Cell {
	if (col.invalid) return EMPTY;
	const d = col.def;
	switch (d.kind) {
		case "builtin":
			switch (d.key) {
				case "name":
					return { value: row.name, text: row.name, sort: row.name.toLowerCase() };
				case "type":
					return { value: row.type.key, text: row.type.name, sort: row.type.name.toLowerCase() };
				case "status":
					return statusCell(row, ctx);
				case "tags":
					return multiCell(row.tags);
				case "aliases":
					return multiCell(row.aliases);
				case "related":
					return linksCell(links(row.frontmatter[COMMON_KEYS.related], row.path, ctx));
				case "folder":
					return { value: row.folder, text: row.folder, sort: row.folder ? row.folder.toLowerCase() : null };
				case "created":
				case "modified": {
					const ms = d.key === "created" ? row.ctime : row.mtime;
					if (!ms) return EMPTY;
					const local = new Date(ms);
					const days = Math.floor((ms - local.getTimezoneOffset() * 60_000) / MS_PER_DAY);
					return dateCell(days, ctx, local.toLocaleDateString());
				}
			}
			return EMPTY;
		case "field": {
			// A type that doesn't have the field shows blank.
			const field = row.type.fields.find((f) => f.key === d.key);
			if (!field) return EMPTY;
			const raw = row.frontmatter[d.key];
			switch (field.kind) {
				case "relation":
					return linksCell(links(raw, row.path, ctx, !!field.labelled));
				case "number": {
					const n = toNumber(raw);
					return n === null ? (isEmptyValue(raw) ? EMPTY : { value: null, text: String(raw), sort: null }) : { value: n, text: String(n), sort: n };
				}
				case "date": {
					const p = ctx.dates.parse(raw);
					if (!p) return EMPTY;
					return p.ok ? dateCell(p.value, ctx, String(raw)) : { value: null, text: String(raw), sort: null };
				}
				case "boolean":
					return { value: raw === true, text: raw === true ? "Yes" : "", sort: raw === true ? 0 : 1 };
				case "multiselect":
				case "list":
					return multiCell(asArray(raw).filter((v) => !isEmptyValue(v)).map(String));
				case "select": {
					if (isEmptyValue(raw)) return EMPTY;
					const s = String(Array.isArray(raw) ? raw[0] : raw);
					const i = (field.options ?? []).indexOf(s);
					return { value: s, text: s, sort: i >= 0 ? i : s.toLowerCase() };
				}
				default: {
					if (isEmptyValue(raw)) return EMPTY;
					const s = Array.isArray(raw) ? raw.map(String).join(", ") : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
					return { value: s, text: s, sort: s.toLowerCase() };
				}
			}
		}
		case "incoming": {
			const sources = [...new Set(ctx.incoming(row.path).filter((e) => e.sourceType === d.type && e.fieldKey === d.field).map((e) => e.source))];
			return linksCell(sources.map((p) => ({ path: p, linktext: p, name: ctx.row(p)?.name ?? basename(p) })));
		}
		case "rollup":
			return rollupCell(row, d.rollup, ctx);
		case "formula":
			return formulaCell(row, col, ctx);
	}
}

// ---------------------------------------------------------------- formula cells

/** A cell's value as a formula value, by the column's kind. Formula errors in a referenced column propagate. */
function cellValue(cell: Cell, col: ResolvedColumn): FValue {
	if (cell.error) throw new FormulaError(`[${col.label}]: ${cell.error}`);
	const v = cell.value;
	switch (col.kind) {
		case "date":
			return typeof v === "number" ? new DateVal(v) : null;
		case "number":
			return typeof v === "number" ? v : null;
		case "bool":
			return v === true;
		case "multi":
			return Array.isArray(v) ? (v as string[]) : v === null || v === undefined || v === "" ? [] : [String(v)];
		case "links":
			return Array.isArray(v) ? (v as LinkValue[]) : [];
		default:
			return v === null || v === undefined || v === "" ? null : String(v);
	}
}

/** A linked note's field (by key or label, or a built-in like status), for prop(). */
function propOf(link: LinkValue, name: string, ctx: ViewContext): FValue {
	const row = link.path ? ctx.row(link.path) : undefined;
	if (!row) return null;
	const n = name.trim().toLowerCase();
	const field = row.type.fields.find((f) => f.key.toLowerCase() === n) ?? row.type.fields.find((f) => f.label.toLowerCase() === n);
	const builtin = BUILTINS.find((b) => b === n || BUILTIN_LABELS[b].toLowerCase() === n);
	const colDef = field ? fieldColumn(field.key) : builtin ? columnFromId(builtin) : null;
	if (!colDef) throw new FormulaError(`${row.type.name} has no field “${name}”.`);
	const col = resolveColumn(colDef, emptyView([row.type.key]), ctx);
	return cellValue(cellOf(row, col, ctx), col);
}

const numberText = (n: number) => String(Math.round(n * 1e4) / 1e4);

/** A formula result as a cell of the column's type (coercing where it makes sense, otherwise an error). */
function formulaValueCell(v: FValue, type: FType, ctx: ViewContext): Cell {
	const env = { dateText: (d: number) => ctx.dates.format(d, "short") };
	if (v === null || v === "" || (Array.isArray(v) && v.length === 0 && type !== "list" && type !== "links")) return EMPTY;
	const fail = (what: string): Cell => ({ ...EMPTY, error: `The result isn't ${what}: ${toText(v, env) || "(empty)"}.` });
	switch (type) {
		case "number": {
			const n = typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
			if (n === null || !Number.isFinite(n)) return fail("a number");
			return { value: n, text: numberText(n), sort: n };
		}
		case "date": {
			const days = v instanceof DateVal ? v.days : typeof v === "string" ? ((p) => (p?.ok ? p.value : null))(ctx.dates.parse(v)) : null;
			return days === null ? fail("a date") : dateCell(days, ctx);
		}
		case "bool": {
			const b = truthy(v);
			return { value: b, text: b ? "Yes" : "", sort: b ? 0 : 1 };
		}
		case "list":
			return multiCell(asArray(v).map((x) => toText(x as FValue, env)).filter((s) => s !== ""));
		case "links": {
			const list = asArray(v);
			if (!list.every(isLink)) return fail("a link or list of links");
			return linksCell(list as LinkValue[]);
		}
		default: {
			const s = toText(v, env);
			return s ? { value: s, text: s, sort: typeof v === "number" ? v : s.toLowerCase() } : EMPTY;
		}
	}
}

function formulaCell(row: ViewRow, col: ResolvedColumn, ctx: ViewContext): Cell {
	const f = col.formula;
	if (!f) return EMPTY;
	const env: EvalEnv = {
		col: (id) => {
			const c = f.refs.get(id);
			return c ? cellValue(cellOf(row, c, ctx), c) : null;
		},
		today: ctx.today,
		prop: (link, name) => propOf(link, name, ctx),
		dateText: (d) => ctx.dates.format(d, "short"),
		parseDate: (s) => {
			const p = ctx.dates.parse(s);
			return p?.ok ? p.value : null;
		},
		format: (v, pattern) =>
			v instanceof DateVal ? (ctx.moment || pattern === RELATIVE ? formatDate(v.days, pattern, ctx.moment as MomentLike, ctx.today) : ctx.dates.format(v.days, "short")) : formatNumber(v, pattern, ctx.locale ?? "en", ctx.currency),
	};
	try {
		return formulaValueCell(evaluate(f.compiled.ast, env), f.type, ctx);
	} catch (e) {
		return { ...EMPTY, error: e instanceof Error ? e.message : String(e) };
	}
}


// ---------------------------------------------------------------- filters

export const OPERATORS: Record<ValueKind, { op: string; label: string; value: "none" | "text" | "number" | "date" | "range" | "choices" | "links" }[]> = {
	text: [
		{ op: "contains", label: "contains", value: "text" },
		{ op: "not-contains", label: "does not contain", value: "text" },
		{ op: "is", label: "is", value: "text" },
		{ op: "is-not", label: "is not", value: "text" },
		{ op: "starts-with", label: "starts with", value: "text" },
		{ op: "empty", label: "is empty", value: "none" },
		{ op: "not-empty", label: "is not empty", value: "none" },
	],
	folder: [
		{ op: "in-folder", label: "is in", value: "text" },
		{ op: "contains", label: "contains", value: "text" },
		{ op: "is", label: "is", value: "text" },
		{ op: "is-not", label: "is not", value: "text" },
		{ op: "empty", label: "is the vault root", value: "none" },
	],
	number: [
		{ op: "=", label: "=", value: "number" },
		{ op: "!=", label: "≠", value: "number" },
		{ op: "<", label: "<", value: "number" },
		{ op: "<=", label: "≤", value: "number" },
		{ op: ">", label: ">", value: "number" },
		{ op: ">=", label: "≥", value: "number" },
		{ op: "empty", label: "is empty", value: "none" },
		{ op: "not-empty", label: "is not empty", value: "none" },
	],
	date: [
		{ op: "is", label: "is", value: "date" },
		{ op: "before", label: "is before", value: "date" },
		{ op: "after", label: "is after", value: "date" },
		{ op: "on-or-before", label: "is on or before", value: "date" },
		{ op: "on-or-after", label: "is on or after", value: "date" },
		{ op: "between", label: "is between", value: "range" },
		{ op: "empty", label: "is empty", value: "none" },
		{ op: "not-empty", label: "is not empty", value: "none" },
	],
	choice: [
		{ op: "any-of", label: "is any of", value: "choices" },
		{ op: "none-of", label: "is none of", value: "choices" },
		{ op: "empty", label: "is empty", value: "none" },
		{ op: "not-empty", label: "is not empty", value: "none" },
	],
	multi: [
		{ op: "has-any", label: "has any of", value: "choices" },
		{ op: "has-all", label: "has all of", value: "choices" },
		{ op: "has-none", label: "has none of", value: "choices" },
		{ op: "empty", label: "is empty", value: "none" },
		{ op: "not-empty", label: "is not empty", value: "none" },
	],
	bool: [
		{ op: "checked", label: "is checked", value: "none" },
		{ op: "unchecked", label: "is not checked", value: "none" },
	],
	links: [
		{ op: "links-any", label: "links to any of", value: "links" },
		{ op: "links-none", label: "links to none of", value: "links" },
		{ op: "empty", label: "is empty", value: "none" },
		{ op: "not-empty", label: "is not empty", value: "none" },
		{ op: "count=", label: "count =", value: "number" },
		{ op: "count!=", label: "count ≠", value: "number" },
		{ op: "count<", label: "count <", value: "number" },
		{ op: "count>", label: "count >", value: "number" },
	],
};

/**
 * A date filter value as a day number: an absolute date in the adapter's format, or relative to today:
 * "today", "-7d", "+2w", "1m", "-1y" (days / weeks / months / years). Months and years assume ISO-style days.
 */
export function dateValue(spec: unknown, ctx: Pick<ViewContext, "dates" | "today">): number | null {
	if (spec === undefined || spec === null || spec === "") return null;
	const s = String(spec).trim().toLowerCase();
	if (s === "today") return ctx.today;
	const m = /^([+-]?\d+)\s*([dwmy])$/.exec(s);
	if (m) {
		const n = Number(m[1]);
		if (m[2] === "d") return ctx.today + n;
		if (m[2] === "w") return ctx.today + 7 * n;
		const d = new Date(ctx.today * MS_PER_DAY);
		const months = m[2] === "m" ? n : 12 * n;
		const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
		const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
		return Math.floor(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay)) / MS_PER_DAY);
	}
	const p = ctx.dates.parse(spec);
	return p?.ok ? p.value : null;
}

const lower = (v: unknown) => String(v ?? "").toLowerCase();
const listOf = (v: unknown) => asArray(v).map(String);

/** Whether a cell passes a condition. Unknown operators pass (and are reported by `conditionIssue`). */
export function matches(cell: Cell, kind: ValueKind, cond: Condition, ctx: Pick<ViewContext, "dates" | "today">): boolean {
	const v = cell.value;
	const empty = v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (kind === "bool" && v !== true);
	switch (cond.op) {
		case "empty":
			return kind === "folder" ? !v : empty;
		case "not-empty":
			return !empty;
		case "checked":
			return v === true;
		case "unchecked":
			return v !== true;
	}
	switch (kind) {
		case "text":
		case "folder": {
			const text = lower(cell.text);
			const q = lower(cond.value);
			switch (cond.op) {
				case "contains":
					return text.includes(q);
				case "not-contains":
					return !text.includes(q);
				case "is":
					return text === q;
				case "is-not":
					return text !== q;
				case "starts-with":
					return text.startsWith(q);
				case "in-folder": {
					const f = q.replace(/\/+$/, "");
					return !f || text === f || text.startsWith(`${f}/`);
				}
			}
			return true;
		}
		case "number": {
			const n = typeof v === "number" ? v : null;
			const q = toNumber(cond.value);
			if (n === null || q === null) return false;
			switch (cond.op) {
				case "=":
					return n === q;
				case "!=":
					return n !== q;
				case "<":
					return n < q;
				case "<=":
					return n <= q;
				case ">":
					return n > q;
				case ">=":
					return n >= q;
			}
			return true;
		}
		case "date": {
			const d = typeof v === "number" ? v : null;
			if (cond.op === "between") {
				const [a, b] = asArray(cond.value).map((x) => dateValue(x, ctx));
				if (d === null) return false;
				return (a === null || a === undefined || d >= a) && (b === null || b === undefined || d <= b);
			}
			const q = dateValue(cond.value, ctx);
			if (d === null || q === null) return false;
			switch (cond.op) {
				case "is":
					return d === q;
				case "before":
					return d < q;
				case "after":
					return d > q;
				case "on-or-before":
					return d <= q;
				case "on-or-after":
					return d >= q;
			}
			return true;
		}
		case "choice": {
			const qs = listOf(cond.value).map(lower);
			const has = !empty && qs.includes(lower(v));
			return cond.op === "none-of" ? !has : cond.op === "any-of" ? has : true;
		}
		case "multi": {
			const have = listOf(v).map(lower);
			const qs = listOf(cond.value).map(lower);
			switch (cond.op) {
				case "has-any":
					return qs.some((q) => have.includes(q));
				case "has-all":
					return qs.every((q) => have.includes(q));
				case "has-none":
					return !qs.some((q) => have.includes(q));
			}
			return true;
		}
		case "links": {
			const ls = (Array.isArray(v) ? v : []) as LinkValue[];
			const qs = listOf(cond.value);
			const hit = (l: LinkValue) => qs.some((q) => (l.path ? l.path === q || l.path === `${q}.md` : false) || lower(l.linktext) === lower(q) || lower(l.name) === lower(q));
			const count = ls.length;
			const n = toNumber(cond.value) ?? 0;
			switch (cond.op) {
				case "links-any":
					return ls.some(hit);
				case "links-none":
					return !ls.some(hit);
				case "count=":
					return count === n;
				case "count!=":
					return count !== n;
				case "count<":
					return count < n;
				case "count>":
					return count > n;
			}
			return true;
		}
		case "bool":
			return true;
	}
}

/** A condition's value is missing (a blank text, no choices or notes, an empty number or date). */
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.every((x) => x === undefined || x === null || String(x).trim() === ""));
/** `conditionIssue` for a condition that's only missing its value (still being set up, rather than broken). */
export const NEEDS_VALUE = "It needs a value.";

/**
 * Why a condition is ignored: an unknown column, an operator the column doesn't support, a missing value, or (with
 * `ctx`) a number or date that can't be read. Ignored conditions don't filter anything.
 */
export function conditionIssue(cond: Condition, columns: Map<string, ResolvedColumn>, ctx?: Pick<ViewContext, "dates" | "today">): string | null {
	const col = columns.get(cond.field);
	if (!col) return `“${cond.field}” isn't a column of this view.`;
	if (col.invalid) return col.invalid;
	const op = OPERATORS[col.kind].find((o) => o.op === cond.op);
	if (!op) return `“${cond.op}” doesn't apply to ${col.label}.`;
	if (op.value === "none") return null;
	if (blank(cond.value)) return NEEDS_VALUE;
	if (op.value === "number" && toNumber(cond.value) === null) return `“${String(cond.value)}” isn't a number.`;
	if (ctx && op.value === "date" && dateValue(cond.value, ctx) === null) return `“${String(cond.value)}” isn't a date.`;
	if (ctx && op.value === "range") {
		const bad = asArray(cond.value).find((x) => !blank(x) && dateValue(x, ctx) === null);
		if (bad !== undefined) return `“${String(bad)}” isn't a date.`;
	}
	return null;
}

/** A condition as words, e.g. "Project links to any of". */
export function conditionText(cond: Condition, columns: Map<string, ResolvedColumn>): string {
	const col = columns.get(cond.field);
	const op = col ? OPERATORS[col.kind].find((o) => o.op === cond.op) : undefined;
	return `${col?.label ?? cond.field} ${op?.label ?? cond.op}`;
}

/** Every condition in a filter group (nested ones included) that's ignored, with why. */
export function ignoredConditions(g: FilterGroup, columns: Map<string, ResolvedColumn>, ctx: Pick<ViewContext, "dates" | "today">): { cond: Condition; issue: string }[] {
	return g.items.flatMap((i) => {
		if (isGroup(i)) return ignoredConditions(i, columns, ctx);
		const issue = conditionIssue(i, columns, ctx);
		return issue ? [{ cond: i, issue }] : [];
	});
}

/** Column ids a filter group refers to. */
export function filterFields(g: FilterGroup): string[] {
	return g.items.flatMap((i) => (isGroup(i) ? filterFields(i) : [i.field]));
}

/** Whether the row passes a group; null when the group has no usable conditions (it then doesn't count either way). */
function evalGroup(g: FilterGroup, cell: (id: string) => Cell, columns: Map<string, ResolvedColumn>, ctx: Pick<ViewContext, "dates" | "today">): boolean | null {
	const results: boolean[] = [];
	for (const item of g.items) {
		if (isGroup(item)) {
			const r = evalGroup(item, cell, columns, ctx);
			if (r !== null) results.push(r);
			continue;
		}
		if (conditionIssue(item, columns, ctx)) continue;
		results.push(matches(cell(item.field), columns.get(item.field)!.kind, item, ctx));
	}
	if (results.length === 0) return null;
	return g.mode === "all" ? results.every(Boolean) : results.some(Boolean);
}

function passes(g: FilterGroup, cell: (id: string) => Cell, columns: Map<string, ResolvedColumn>, ctx: Pick<ViewContext, "dates" | "today">): boolean {
	return evalGroup(g, cell, columns, ctx) ?? true;
}

// ---------------------------------------------------------------- sorting and grouping

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const natural = (a: string, b: string) => collator.compare(a, b);

/** Compare two cells, empty values last whatever the direction. */
export function compareCells(a: Cell, b: Cell, dir: "asc" | "desc"): number {
	if (a.sort === null && b.sort === null) return 0;
	if (a.sort === null) return 1;
	if (b.sort === null) return -1;
	let r: number;
	if (typeof a.sort === "number" && typeof b.sort === "number") r = a.sort - b.sort;
	else r = natural(String(a.sort), String(b.sort));
	return dir === "asc" ? r : -r;
}

/**
 * Header click: cycles a column through ascending → descending → off. Without shift it becomes the only level;
 * with shift it's added (or cycled in place) as another level.
 */
export function cycleSort(sort: SortLevel[], id: string, add: boolean): SortLevel[] {
	const at = sort.findIndex((s) => s.by === id);
	const current = at >= 0 ? sort[at] : null;
	const next: SortLevel | null = !current ? { by: id, dir: "asc" } : current.dir === "asc" ? { by: id, dir: "desc" } : null;
	if (!add) return next ? [next] : [];
	const out = sort.filter((s) => s.by !== id);
	if (next) out.splice(at >= 0 ? at : out.length, 0, next);
	return out;
}

export interface GroupKey {
	key: string;
	label: string;
	sort: Cell;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The groups a cell puts its row in (lists and links: one per value; empty: the "" group). */
export function groupKeys(cell: Cell, kind: ValueKind, by: GroupBy, ctx: Pick<ViewContext, "dates">): GroupKey[] {
	const v = cell.value;
	if (kind === "multi") {
		const list = listOf(v);
		return list.length ? list.map((s) => ({ key: s, label: s, sort: { value: s, text: s, sort: s.toLowerCase() } })) : [{ key: "", label: "", sort: EMPTY }];
	}
	if (kind === "links") {
		const ls = (Array.isArray(v) ? v : []) as LinkValue[];
		return ls.length ? ls.map((l) => ({ key: l.path ?? `?${l.linktext}`, label: l.name, sort: { value: l.name, text: l.name, sort: l.name.toLowerCase() } })) : [{ key: "", label: "", sort: EMPTY }];
	}
	if (kind === "bool") return [{ key: v === true ? "yes" : "no", label: v === true ? "Yes" : "No", sort: { value: v, text: "", sort: v === true ? 0 : 1 } }];
	if (kind === "date" && typeof v === "number" && by.date) {
		const dt = new Date(v * MS_PER_DAY);
		const y = dt.getUTCFullYear();
		const m = dt.getUTCMonth();
		return by.date === "year"
			? [{ key: String(y), label: String(y), sort: { value: y, text: "", sort: y } }]
			: [{ key: `${y}-${m + 1}`, label: `${MONTHS[m]} ${y}`, sort: { value: y * 12 + m, text: "", sort: y * 12 + m } }];
	}
	if (cell.sort === null) return [{ key: "", label: "", sort: EMPTY }];
	return [{ key: String(v ?? cell.text), label: cell.text, sort: cell }];
}

// ---------------------------------------------------------------- running a view

export interface ResultRow {
	row: ViewRow;
	cells: Record<string, Cell>;
	/** highlight rule index styling the row (ROW_TARGET) and each column that has a matching cell rule */
	hl?: Record<string, number>;
	/** data bars and colour scales, by column */
	viz?: Record<string, CellViz>;
}

/** A cell's data bar (fractions of the cell width) and colour-scale position (0 low … 1 high), with their rules. */
export interface CellViz {
	bar?: { rule: number; start: number; end: number; negative: boolean };
	scale?: { rule: number; t: number };
}

/** Linear-interpolated percentile of sorted values (p 0–100). */
export function percentile(sorted: number[], p: number): number {
	if (!sorted.length) return NaN;
	const x = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
	const lo = Math.floor(x);
	const hi = Math.ceil(x);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

/** A bound's value: auto (the given fallback), a number, a percentile ("p90"), or a date / relative date for date columns. */
function resolveBound(b: ScaleBound | undefined, sorted: number[], auto: number, isDate: boolean, ctx: Pick<ViewContext, "dates" | "today">): number {
	if (b === undefined || b === "auto") return auto;
	if (typeof b === "number") return b;
	const p = /^p(\d+(?:\.\d+)?)$/i.exec(b.trim());
	if (p) return percentile(sorted, Number(p[1]));
	if (isDate) return dateValue(b, ctx) ?? auto;
	const n = Number(b);
	return Number.isFinite(n) ? n : auto;
}

/** Bar geometry for a value in [lo, hi]: from the zero line when the range spans zero, clamped. */
export function barGeometry(v: number, lo: number, hi: number): { start: number; end: number; negative: boolean } {
	if (!(hi > lo)) return { start: 0, end: v >= hi ? 1 : 0, negative: v < 0 };
	const span = hi - lo;
	const pos = (Math.min(hi, Math.max(lo, v)) - lo) / span;
	if (lo < 0 && hi > 0) {
		const zero = -lo / span;
		return { start: Math.min(zero, pos), end: Math.max(zero, pos), negative: v < 0 };
	}
	if (hi <= 0) return { start: pos, end: 1, negative: true };
	return { start: 0, end: pos, negative: false };
}

/** Where a value sits on a colour scale (0–1), with an optional middle point. */
export function scalePosition(v: number, lo: number, hi: number, mid?: number): number {
	const clamp = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5);
	if (mid !== undefined && Number.isFinite(mid)) {
		if (v <= mid) return mid > lo ? clamp(0.5 * ((v - lo) / (mid - lo))) : 0;
		return hi > mid ? clamp(0.5 + 0.5 * ((v - mid) / (hi - mid))) : 1;
	}
	return hi > lo ? clamp((v - lo) / (hi - lo)) : 0.5;
}

/** Separates the keys in a nested group's path ("active␟Ada"). */
export const GROUP_PATH_SEP = "\u241F";

export interface ResultGroup {
	/** the group's path: its key and its parents' keys, joined with GROUP_PATH_SEP */
	key: string;
	label: string;
	/** 0 for the outermost level */
	level: number;
	/** the column this level groups by */
	by: string;
	/** every row in the group, its sub-groups included */
	rows: ResultRow[];
	/** sub-groups (null at the innermost level) */
	children: ResultGroup[] | null;
}

export interface ViewResult {
	/** the shown columns (columns used as grouping levels are left out) */
	columns: ResolvedColumn[];
	/** every column the view refers to (shown, filtered, sorted, grouped), by id */
	known: Map<string, ResolvedColumn>;
	rows: ResultRow[];
	/** set when grouping: the outermost groups, each with its sub-groups */
	groups: ResultGroup[] | null;
	/** rows of the source types before filtering */
	total: number;
	/** per highlight rule (enabled or not): how many shown rows its conditions match */
	highlightCounts: number[];
}

/** Text the quick search matches: name, aliases and subtitle. */
function searchText(row: ViewRow): string {
	return [row.name, ...row.aliases, row.subtitle ?? ""].join("\n").toLowerCase();
}

/** Columns a display format applies to. */
export const formatKind = (col: ResolvedColumn): "number" | "date" | null => (col.invalid ? null : col.kind === "number" ? "number" : col.kind === "date" ? "date" : null);

/** The cell with its text in the column's display format (values, sorting and filtering are unchanged). */
export function formatCell(cell: Cell, col: ResolvedColumn, format: string | undefined, ctx: Pick<ViewContext, "moment" | "locale" | "currency" | "today">): Cell {
	if (!format || typeof cell.value !== "number") return cell;
	const kind = formatKind(col);
	if (kind === "number") return { ...cell, text: formatNumber(cell.value, format, ctx.locale ?? "en", ctx.currency) };
	if (kind === "date" && (ctx.moment || format === RELATIVE)) return { ...cell, text: formatDate(cell.value, format, ctx.moment as MomentLike, ctx.today) };
	return cell;
}

/** Every condition in a group, nested ones included. */
function conditionsOf(g: FilterGroup): Condition[] {
	return g.items.flatMap((i) => (isGroup(i) ? conditionsOf(i) : [i]));
}

/**
 * A cell's style: the row rule's style with its column's cell rule on top (what the cell rule leaves unset comes
 * from the row rule). Row icons only show in the name column; a cell rule's icon replaces it there.
 */
export function highlightOf(def: ViewDef, r: ResultRow, colId: string): { style: HighlightStyle; iconRule?: HighlightRule } | null {
	const at = (i: number | undefined) => (i === undefined ? undefined : def.highlight[i]);
	const cell = at(r.hl?.[colId]);
	const row = at(r.hl?.[ROW_TARGET]);
	if (!cell && !row) return null;
	const style: HighlightStyle = { ...row?.style };
	delete style.icon;
	for (const [k, v] of Object.entries(cell?.style ?? {}) as [keyof HighlightStyle, HighlightStyle[keyof HighlightStyle]][]) if (v !== undefined && v !== false && k !== "icon") (style as Record<string, unknown>)[k] = v;
	const iconRule = cell?.style.icon ? cell : colId === "name" && row?.style.icon ? row : undefined;
	if (iconRule) style.icon = iconRule.style.icon;
	return { style, ...(iconRule ? { iconRule } : {}) };
}

/** Filter, sort and group the rows of a view. */
export function runView(def: ViewDef, all: ViewRow[], ctx: ViewContext, search = ""): ViewResult {
	const sources = new Set(sourceTypes(def, ctx.types).map((t) => t.key));
	const rows = all.filter((r) => sources.has(r.type.key));
	// Columns used as grouping levels aren't shown: their value is in the group header.
	const columns = def.columns.filter((c) => !def.group.some((g) => g.by === c.id)).map((c) => resolveColumn(c, def, ctx));
	const known = new Map(columns.map((c) => [c.id, c]));
	const rules = def.highlight ?? [];
	const extra = [...filterFields(def.filters), ...def.sort.map((s) => s.by), ...def.group.map((g) => g.by), ...rules.flatMap((r) => filterFields(r.when))];
	for (const id of extra) if (!known.has(id)) {
		const fromId = columnFromId(id);
		// Roll-up / formula ids only exist as columns; field-looking ids that aren't fields stay unknown.
		const resolved = resolveColumn(fromId, def, ctx);
		if (!resolved.invalid) known.set(id, resolved);
	}
	const shown = new Set(columns.map((c) => c.id));
	// A rule whose conditions are all unusable matches nothing (unlike filters, where they're just ignored).
	const usable = rules.map((r) => {
		const conds = conditionsOf(r.when);
		return conds.length === 0 || conds.some((c) => !conditionIssue(c, known, ctx));
	});
	const highlightCounts = rules.map(() => 0);
	const members: ResultRow[][] = rules.map(() => []);

	const q = search.trim().toLowerCase();
	const out: ResultRow[] = [];
	for (const row of rows) {
		if (q && !searchText(row).includes(q)) continue;
		const cells: Record<string, Cell> = {};
		const cell = (id: string) => (cells[id] ??= known.has(id) ? formatCell(cellOf(row, known.get(id)!, ctx), known.get(id)!, def.formats?.[id], ctx) : EMPTY);
		if (!passes(def.filters, cell, known, ctx)) continue;
		for (const c of columns) cell(c.id);
		for (const id of extra) cell(id);
		let hl: Record<string, number> | undefined;
		const rr: ResultRow = { row, cells };
		rules.forEach((rule, i) => {
			if (!usable[i] || !passes(rule.when, cell, known, ctx)) return;
			highlightCounts[i]++;
			if (rule.off || (rule.target !== ROW_TARGET && !shown.has(rule.target))) return;
			if (rule.kind === "bar" || rule.kind === "scale") {
				members[i].push(rr);
				return;
			}
			hl ??= {};
			hl[rule.target] ??= i;
		});
		if (hl) rr.hl = hl;
		out.push(rr);
	}

	// Data bars and colour scales: bounds over the rows each rule applies to, then each row's bar or position.
	rules.forEach((rule, i) => {
		const col = known.get(rule.target);
		if (!members[i].length || !col || (col.kind !== "number" && col.kind !== "date")) return;
		const isDate = col.kind === "date";
		const vals = members[i].map((r) => r.cells[rule.target]?.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		if (!vals.length) return;
		const sorted = [...vals].sort((a, b) => a - b);
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		if (rule.kind === "bar") {
			const o = rule.bar ?? {};
			// Number bars start from zero unless a minimum is set; date bars span the dates.
			const lo = resolveBound(o.min, sorted, isDate ? first : Math.min(0, first), isDate, ctx);
			const hi = resolveBound(o.max, sorted, isDate ? last : Math.max(0, last), isDate, ctx);
			for (const r of members[i]) {
				const v = r.cells[rule.target]?.value;
				if (typeof v !== "number" || !Number.isFinite(v)) continue;
				r.viz ??= {};
				const cv = (r.viz[rule.target] ??= {});
				cv.bar ??= { rule: i, ...barGeometry(v, lo, hi) };
			}
		} else {
			const o = rule.scale ?? { colors: ["red", "yellow", "green"] };
			const lo = resolveBound(o.min, sorted, first, isDate, ctx);
			const hi = resolveBound(o.max, sorted, last, isDate, ctx);
			const mid = o.colors.length === 3 ? resolveBound(o.mid, sorted, percentile(sorted, 50), isDate, ctx) : undefined;
			for (const r of members[i]) {
				const v = r.cells[rule.target]?.value;
				if (typeof v !== "number" || !Number.isFinite(v)) continue;
				r.viz ??= {};
				const cv = (r.viz[rule.target] ??= {});
				cv.scale ??= { rule: i, t: scalePosition(v, lo, hi, mid) };
			}
		}
	});

	const levels = def.sort.filter((s) => known.has(s.by));
	out.sort((a, b) => {
		for (const s of levels) {
			const r = compareCells(a.cells[s.by] ?? EMPTY, b.cells[s.by] ?? EMPTY, s.dir);
			if (r) return r;
		}
		return natural(a.row.name, b.row.name);
	});

	let groups: ResultGroup[] | null = null;
	const levelsUsed = def.group.filter((g) => known.has(g.by));
	if (levelsUsed.length) {
		const build = (rs: ResultRow[], depth: number, parent: string): ResultGroup[] => {
			const g = levelsUsed[depth];
			const gcol = known.get(g.by)!;
			const map = new Map<string, ResultGroup & { sort: Cell }>();
			for (const r of rs) {
				for (const k of groupKeys(r.cells[gcol.id] ?? EMPTY, gcol.kind, g, ctx)) {
					let entry = map.get(k.key);
					if (!entry) {
						entry = { key: parent ? `${parent}${GROUP_PATH_SEP}${k.key}` : k.key, label: k.label, level: depth, by: gcol.id, rows: [], children: null, sort: k.sort };
						map.set(k.key, entry);
					}
					entry.rows.push(r);
				}
			}
			const dir = def.sort.find((s) => s.by === gcol.id)?.dir ?? "asc";
			return [...map.values()]
				.sort((a, b) => compareCells(a.sort, b.sort, dir) || natural(a.label, b.label))
				.map(({ sort: _s, ...grp }) => ({ ...grp, children: depth + 1 < levelsUsed.length ? build(grp.rows, depth + 1, grp.key) : null }));
		};
		groups = build(out, 0, "");
	}
	return { columns, known, rows: out, groups, total: rows.length, highlightCounts };
}

/** Every group in a tree, depth first (parents before their children). */
export function flattenGroups(groups: ResultGroup[] | null): ResultGroup[] {
	const out: ResultGroup[] = [];
	const walk = (gs: ResultGroup[]) => gs.forEach((g) => (out.push(g), g.children && walk(g.children)));
	if (groups) walk(groups);
	return out;
}

/**
 * Values for a new entity from the view's simple filters: top-level "all" conditions that pin one value
 * (status / a choice / a single link / a checkbox), so the new row shows up in the view.
 */
export function prefillFromFilters(def: ViewDef, known: Map<string, ResolvedColumn>): { status?: string; fields: Record<string, unknown> } {
	const out: { status?: string; fields: Record<string, unknown> } = { fields: {} };
	if (def.filters.mode !== "all") return out;
	for (const item of def.filters.items) {
		if (isGroup(item)) continue;
		const col = known.get(item.field);
		if (!col) continue;
		const vals = listOf(item.value);
		const single = vals.length === 1 ? vals[0] : null;
		if (col.def.kind === "builtin" && col.def.key === "status" && (item.op === "any-of" || item.op === "is") && single) out.status = single;
		else if (col.def.kind === "field" && col.field) {
			const f = col.field;
			if (f.kind === "select" && item.op === "any-of" && single) out.fields[f.key] = single;
			else if ((f.kind === "text" || f.kind === "url") && item.op === "is" && single) out.fields[f.key] = single;
			else if (f.kind === "boolean" && item.op === "checked") out.fields[f.key] = true;
			else if (f.kind === "relation" && item.op === "links-any" && single) out.fields[f.key] = single;
		}
	}
	return out;
}
