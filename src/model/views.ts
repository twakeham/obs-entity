import type { DateAdapter } from "./dates";
import type { EntityInfo } from "./entity";
import { isEmptyValue } from "./frontmatter";
import { asArray, parseLabelledEntry, parseLink } from "./links";
import { formatDate, formatNumber, RELATIVE, type MomentLike } from "./formats";
import { COMMON_KEYS, statusesFor, toKey, typeMatchesTarget, type EntityTypeDef, type FieldDef, type GroupDef } from "./types";

// ---------------------------------------------------------------- definition

export type ViewKind = "table";
export const VIEW_KINDS: ViewKind[] = ["table"];

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
	| { kind: "formula"; id: string; formula: string; label?: string };

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

/** Conditional formatting: rows (or one column's cells) matching `when` get `style`. The first matching rule wins. */
export interface HighlightRule {
	name?: string;
	target: string;
	when: FilterGroup;
	style: HighlightStyle;
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
	/** column id → display format (numbers and dates; see formats.ts) */
	formats: Record<string, string>;
	sort: SortLevel[];
	group?: GroupBy;
	filters: FilterGroup;
	/** conditional formatting, in priority order */
	highlight: HighlightRule[];
}

export const NAME_COLUMN: ColumnDef = { kind: "builtin", id: "name", key: "name" };

export function emptyView(types: string[] = ["*"]): ViewDef {
	return { kind: "table", types, columns: [NAME_COLUMN], widths: {}, fill: [], formats: {}, sort: [], filters: { mode: "all", items: [] }, highlight: [] };
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
		return { kind: "formula", id, formula: raw.formula, ...(label ? { label } : {}) };
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
	const formats: Record<string, string> = {};
	if (isObj(raw.formats)) for (const [k, v] of Object.entries(raw.formats)) if (typeof v === "string" && v.trim()) formats[k] = v;

	const sort: SortLevel[] = [];
	for (const s of asArray(raw.sort)) {
		if (typeof s === "string" && s.trim()) sort.push({ by: s.trim(), dir: "asc" });
		else if (isObj(s) && typeof s.by === "string") sort.push({ by: s.by, dir: s.dir === "desc" ? "desc" : "asc" });
	}
	let group: GroupBy | undefined;
	if (typeof raw.group === "string" && raw.group.trim()) group = { by: raw.group.trim() };
	else if (isObj(raw.group) && typeof raw.group.by === "string") group = { by: raw.group.by, ...(raw.group.date === "month" || raw.group.date === "year" ? { date: raw.group.date } : {}) };

	const filters = parseFilterItems(raw.filters, errors, 0) ?? { mode: "all", items: [] };
	const highlight = parseHighlight(raw.highlight, errors);
	if (errors.length && !VIEW_KINDS.includes(kind)) return { def: null, errors };
	return { def: { kind, types: types.length ? types : ["*"], columns, widths, fill, formats, sort, ...(group ? { group } : {}), filters, highlight }, errors };
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
		rules.push({ ...(name ? { name } : {}), target: str(item.target) || ROW_TARGET, when, style, ...(item.off === true ? { off: true } : {}) });
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
			return { formula: c.formula, ...label, id: c.id };
	}
}

function serializeFilters(g: FilterGroup): Record<string, unknown> {
	return { [g.mode]: g.items.map((i) => (isGroup(i) ? serializeFilters(i) : { field: i.field, op: i.op, ...(i.value !== undefined ? { value: i.value } : {}) })) };
}

/** The definition as plain data for YAML, leaving out empty parts. */
export function serializeView(def: ViewDef): Record<string, unknown> {
	const out: Record<string, unknown> = { kind: def.kind, types: def.types, columns: def.columns.map(serializeColumn) };
	const widths = Object.fromEntries(Object.entries(def.widths).filter(([id]) => def.columns.some((c) => c.id === id)));
	if (Object.keys(widths).length) out.widths = widths;
	const fill = (def.fill ?? []).filter((id) => def.columns.some((c) => c.id === id));
	if (fill.length) out.fill = fill.length === 1 ? fill[0] : fill;
	const formats = Object.fromEntries(Object.entries(def.formats ?? {}).filter(([id]) => def.columns.some((c) => c.id === id)));
	if (Object.keys(formats).length) out.formats = formats;
	if (def.sort.length) out.sort = def.sort.map((s) => ({ by: s.by, dir: s.dir }));
	if (def.group) out.group = { ...def.group };
	if (def.filters.items.length) out.filters = serializeFilters(def.filters);
	if (def.highlight?.length)
		out.highlight = def.highlight.map((r) => {
			const style = Object.fromEntries(Object.entries(r.style).filter(([, v]) => v !== undefined && v !== false && v !== ""));
			return { ...(r.name ? { name: r.name } : {}), target: r.target, when: serializeFilters(r.when), style, ...(r.off ? { off: true } : {}) };
		});
	return out;
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

export function resolveColumn(col: ColumnDef, def: ViewDef, ctx: Pick<ViewContext, "types" | "groups">): ResolvedColumn {
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
			return { ...base, label: col.label ?? "Formula", kind: "text", editable: false, invalid: "Formula columns aren't supported yet." };
	}
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
			return EMPTY;
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

/** Why a condition is ignored: an unknown column or an operator the column doesn't support. */
export function conditionIssue(cond: Condition, columns: Map<string, ResolvedColumn>): string | null {
	const col = columns.get(cond.field);
	if (!col) return `“${cond.field}” isn't a column of this view.`;
	if (col.invalid) return col.invalid;
	if (!OPERATORS[col.kind].some((o) => o.op === cond.op)) return `“${cond.op}” doesn't apply to ${col.label}.`;
	return null;
}

/** Column ids a filter group refers to. */
export function filterFields(g: FilterGroup): string[] {
	return g.items.flatMap((i) => (isGroup(i) ? filterFields(i) : [i.field]));
}

function passes(g: FilterGroup, cell: (id: string) => Cell, columns: Map<string, ResolvedColumn>, ctx: Pick<ViewContext, "dates" | "today">): boolean {
	const results: boolean[] = [];
	for (const item of g.items) {
		if (isGroup(item)) {
			if (item.items.length) results.push(passes(item, cell, columns, ctx));
			continue;
		}
		if (conditionIssue(item, columns)) continue;
		results.push(matches(cell(item.field), columns.get(item.field)!.kind, item, ctx));
	}
	if (results.length === 0) return true;
	return g.mode === "all" ? results.every(Boolean) : results.some(Boolean);
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
}

export interface ResultGroup {
	key: string;
	label: string;
	rows: ResultRow[];
}

export interface ViewResult {
	/** the shown columns */
	columns: ResolvedColumn[];
	/** every column the view refers to (shown, filtered, sorted, grouped), by id */
	known: Map<string, ResolvedColumn>;
	rows: ResultRow[];
	/** set when grouping */
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
	const columns = def.columns.map((c) => resolveColumn(c, def, ctx));
	const known = new Map(columns.map((c) => [c.id, c]));
	const rules = def.highlight ?? [];
	const extra = [...filterFields(def.filters), ...def.sort.map((s) => s.by), ...(def.group ? [def.group.by] : []), ...rules.flatMap((r) => filterFields(r.when))];
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
		return conds.length === 0 || conds.some((c) => !conditionIssue(c, known));
	});
	const highlightCounts = rules.map(() => 0);

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
		rules.forEach((rule, i) => {
			if (!usable[i] || !passes(rule.when, cell, known, ctx)) return;
			highlightCounts[i]++;
			if (rule.off || (rule.target !== ROW_TARGET && !shown.has(rule.target))) return;
			hl ??= {};
			hl[rule.target] ??= i;
		});
		out.push({ row, cells, ...(hl ? { hl } : {}) });
	}

	const levels = def.sort.filter((s) => known.has(s.by));
	out.sort((a, b) => {
		for (const s of levels) {
			const r = compareCells(a.cells[s.by] ?? EMPTY, b.cells[s.by] ?? EMPTY, s.dir);
			if (r) return r;
		}
		return natural(a.row.name, b.row.name);
	});

	let groups: ResultGroup[] | null = null;
	const gcol = def.group ? known.get(def.group.by) : undefined;
	if (def.group && gcol) {
		const map = new Map<string, ResultGroup & { sort: Cell }>();
		for (const r of out) {
			for (const g of groupKeys(r.cells[gcol.id] ?? EMPTY, gcol.kind, def.group, ctx)) {
				let entry = map.get(g.key);
				if (!entry) {
					entry = { key: g.key, label: g.label, rows: [], sort: g.sort };
					map.set(g.key, entry);
				}
				entry.rows.push(r);
			}
		}
		const dir = def.sort.find((s) => s.by === gcol.id)?.dir ?? "asc";
		groups = [...map.values()].sort((a, b) => compareCells(a.sort, b.sort, dir) || natural(a.label, b.label)).map(({ key, label, rows: rs }) => ({ key, label, rows: rs }));
	}
	return { columns, known, rows: out, groups, total: rows.length, highlightCounts };
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
