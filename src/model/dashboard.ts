import { compile, DateVal, FormulaError, isLink, toText, type FValue } from "./formula";
import { formatNumber, formatDate, RELATIVE, type MomentLike } from "./formats";
import { summarize } from "./summary";
import { choiceColor, isPaletteColor, statusPaint, type PaletteColor } from "./colors";
import {
	columnFromId,
	emptyView,
	evaluateDetached,
	GROUP_PATH_SEP,
	HIGHLIGHT_COLORS,
	matchesValues,
	NAME_COLUMN,
	ROW_TARGET,
	type Cell,
	type HighlightRule,
	type HighlightStyle,
	type ValueKind,
	parseView,
	runView,
	serializeView,
	type ColumnDef,
	type FilterGroup,
	type GroupBy,
	type ResolvedColumn,
	type ResultRow,
	type SortLevel,
	type ViewContext,
	type ViewDef,
	type ViewResult,
	type ViewRow,
} from "./views";

/** Dashboards (DESIGN §8.12): a view note whose block has `kind: dashboard` and a grid of components. */

export const DASHBOARD_KIND = "dashboard";
export const DASHBOARD_ICON = "layout-dashboard";
/** grid columns, and the height of one grid row (px) */
export const GRID_COLS = 12;
export const ROW_HEIGHT = 48;
/** below this width (px) components stack in one column */
export const STACK_BELOW = 600;

export type ComponentKind = "card" | "chart" | "list" | "view" | "text" | "button";
export const COMPONENT_KINDS: ComponentKind[] = ["card", "chart", "list", "view", "text", "button"];
export const COMPONENT_LABELS: Record<ComponentKind, string> = { card: "Summary card", chart: "Chart", list: "List", view: "View", text: "Text", button: "Button" };
export const COMPONENT_ICONS: Record<ComponentKind, string> = { card: "hash", chart: "bar-chart-3", list: "list", view: "table", text: "type", button: "mouse-pointer-click" };
/** a new component's size (grid cells) */
export const DEFAULT_SIZE: Record<ComponentKind, { w: number; h: number }> = { card: { w: 3, h: 2 }, chart: { w: 6, h: 5 }, list: { w: 4, h: 5 }, view: { w: 6, h: 8 }, text: { w: 4, h: 2 }, button: { w: 2, h: 1 } };

export type ChartKind = "bar" | "hbar" | "stacked" | "donut" | "line" | "progress";
export const CHART_KINDS: ChartKind[] = ["bar", "hbar", "stacked", "donut", "line", "progress"];
export const CHART_LABELS: Record<ChartKind, string> = { bar: "Bar", hbar: "Horizontal bar", stacked: "Stacked bar", donut: "Donut", line: "Line over time", progress: "Progress" };
export const CHART_ICONS: Record<ChartKind, string> = { bar: "bar-chart-3", hbar: "bar-chart-horizontal", stacked: "bar-chart-big", donut: "pie-chart", line: "line-chart", progress: "gauge" };
export type TimeStep = "week" | "month" | "year";
/** What a chart measures per group: how many notes, or the sum or average of a number column. */
export interface Measure {
	agg: "count" | "sum" | "avg";
	column?: ColumnDef;
}

/** A summary card's own value in conditions (`[Value]`); other cards are `card:<id>`, labelled by title. */
export const VALUE_ID = "value";
export const cardColumnId = (id: string) => `card:${id}`;
const LEGACY_OPS = ["<", "<=", ">", ">=", "=", "!="];

export const CARD_SIZES = ["s", "m", "l", "xl", "fit"] as const;
export type CardSize = (typeof CARD_SIZES)[number];
const CARD_ALIGNS = ["left", "center", "right"] as const;
const CARD_LABELS = ["above", "below", "hidden"] as const;
const CARD_ICONS = ["inline", "side"] as const;
const CARD_ACCENTS = ["none", "left", "top"] as const;

/**
 * How a summary card lays out: its value's size ("fit" grows it to fill the card), alignment, where its label goes,
 * a caption under the value (`[Value]` and other cards' `[Title]`s are replaced by their values), its icon inline
 * before the value or large at the side, and an accent edge in its colour. A card has one; a whole-card rule can
 * change any of it.
 */
export interface CardLayout {
	size?: CardSize;
	align?: (typeof CARD_ALIGNS)[number];
	label?: (typeof CARD_LABELS)[number];
	caption?: string;
	icon?: (typeof CARD_ICONS)[number];
	accent?: (typeof CARD_ACCENTS)[number];
}
export const DEFAULT_CARD_LAYOUT: Required<CardLayout> = { size: "m", align: "left", label: "above", caption: "", icon: "inline", accent: "none" };

/** A dashboard's highlight rule: a card's whole-card rules can also change its layout. */
export type DashRule = HighlightRule & { layout?: CardLayout };

export interface GridAt {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Where a card or list gets its notes. */
export type DashSource =
	/** a saved view note, by name (resolved like a link): its types, filters and sort */
	| { kind: "view"; view: string }
	/** its own types, filters and sort (a view definition with only those) */
	| { kind: "query"; def: ViewDef }
	/** a formula giving links, e.g. filter(notes("quest"), …) */
	| { kind: "formula"; formula: string };

/** A card's value: an aggregation of a column over its source's notes, or a formula over other cards. */
export type CardValue = { agg: string; column?: ColumnDef } | { formula: string };

export type ButtonAction = { new: string } | { workflow: string } | { open: string };

interface Base {
	id: string;
	at: GridAt;
	title?: string;
	/** the look when no highlight rule applies */
	style?: HighlightStyle;
	/**
	 * conditional styling, first match wins (as in views): on card values for every component (a card's own is
	 * `value`, and a card's rules can style just its value); a list's rules are on its notes, styling rows or fields
	 */
	highlight?: DashRule[];
}
export type DashComponent =
	| (Base & { kind: "card"; source?: DashSource; value: CardValue; format?: string; layout?: CardLayout })
	| (Base & {
			kind: "chart";
			chart: ChartKind;
			source?: DashSource;
			/** the column notes are grouped by (bar, horizontal bar, stacked, donut), or the date column (line) */
			by?: ColumnDef;
			/** stacked bars: the column splitting each bar */
			split?: ColumnDef;
			/** line: the time step */
			every?: TimeStep;
			measure: Measure;
			/** progress: the conditions a note meets when it's done */
			done?: FilterGroup;
			format?: string;
	  })
	| (Base & { kind: "list"; source?: DashSource; fields: ColumnDef[]; sort: SortLevel[]; limit: number })
	| (Base & { kind: "view"; view: string })
	| (Base & { kind: "text"; text: string })
	| (Base & { kind: "button"; label: string; icon?: string; action?: ButtonAction });

export interface DashboardDef {
	kind: "dashboard";
	components: DashComponent[];
	/** where the Entity Browser lists the note (see viewPlace.ts) */
	place?: string;
}

export const LIST_LIMIT = 10;

// ---------------------------------------------------------------- reading and writing

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);

/** Whether a block's parsed YAML is a dashboard. */
export const isDashboardRaw = (raw: unknown): boolean => isObj(raw) && raw.kind === DASHBOARD_KIND;

/** One column (a field key, built-in, or a roll-up / formula object), read as a view reads its columns. */
function parseOneColumn(raw: unknown, errors: string[], where: string): ColumnDef | null {
	if (raw === undefined || raw === null || raw === "") return null;
	const { def, errors: e } = parseView({ columns: [raw] });
	errors.push(...e.map((m) => `${where}: ${m}`));
	return def?.columns.find((c) => c.id !== "name") ?? (raw === "name" ? NAME_COLUMN : null);
}

const columnOut = (c: ColumnDef): unknown => (c.id === "name" ? "name" : serializeView({ ...emptyView(), columns: [NAME_COLUMN, c] }).columns as unknown[])[1] ?? c.id;

function parseSource(raw: unknown, errors: string[], where: string): DashSource | undefined {
	if (!isObj(raw)) return undefined;
	if (str(raw.view)) return { kind: "view", view: str(raw.view) };
	if (str(raw.formula)) return { kind: "formula", formula: str(raw.formula) };
	const { def, errors: e } = parseView({ types: raw.types, filters: raw.filters, sort: raw.sort });
	errors.push(...e.map((m) => `${where}: ${m}`));
	return def ? { kind: "query", def } : undefined;
}

function sourceOut(s: DashSource): Record<string, unknown> {
	if (s.kind === "view") return { view: s.view };
	if (s.kind === "formula") return { formula: s.formula };
	const out = serializeView(s.def);
	return { types: out.types, ...(out.filters ? { filters: out.filters } : {}), ...(out.sort ? { sort: out.sort } : {}) };
}

function parseSort(raw: unknown): SortLevel[] {
	const out: SortLevel[] = [];
	for (const s of Array.isArray(raw) ? raw : raw ? [raw] : []) {
		if (typeof s === "string" && s.trim()) out.push({ by: s.trim(), dir: "asc" });
		else if (isObj(s) && typeof s.by === "string") out.push({ by: s.by, dir: s.dir === "desc" ? "desc" : "asc" });
	}
	return out;
}

function parseAction(raw: unknown): ButtonAction | undefined {
	if (!isObj(raw)) return undefined;
	if (str(raw.new)) return { new: str(raw.new) };
	if (str(raw.workflow)) return { workflow: str(raw.workflow) };
	if (str(raw.open)) return { open: str(raw.open) };
	return undefined;
}

/** The colour rules cards had before they took highlight rules ("When < 3: red, the card"), as highlight rules. */
function legacyRules(raw: unknown): HighlightRule[] {
	const out: HighlightRule[] = [];
	for (const r of Array.isArray(raw) ? raw : []) {
		if (!isObj(r) || !LEGACY_OPS.includes(String(r.op)) || typeof r.value !== "number") continue;
		const color = isPaletteColor(r.color) ? r.color : undefined;
		const card = r.on === "card";
		const style: HighlightStyle = { ...(color ? (card ? { fill: color } : { text: color }) : {}), ...(str(r.icon) ? { icon: str(r.icon) } : {}) };
		out.push({ target: card ? ROW_TARGET : VALUE_ID, when: { mode: "all", items: [{ field: VALUE_ID, op: String(r.op), value: r.value }] }, style });
	}
	return out;
}

function parseStyle(raw: unknown): HighlightStyle | undefined {
	if (!isObj(raw)) return undefined;
	const color = (v: unknown) => ((HIGHLIGHT_COLORS as readonly string[]).includes(String(v)) ? (v as HighlightStyle["fill"]) : undefined);
	const s: HighlightStyle = {
		...(color(raw.fill) ? { fill: color(raw.fill) } : {}),
		...(color(raw.text) ? { text: color(raw.text) } : {}),
		...(raw.bold === true ? { bold: true } : {}),
		...(raw.italic === true ? { italic: true } : {}),
		...(raw.strike === true ? { strike: true } : {}),
		...(str(raw.icon) ? { icon: str(raw.icon) } : {}),
	};
	return Object.keys(s).length ? s : undefined;
}

function parseHighlightRules(raw: unknown, errors: string[], where: string, layouts: boolean): DashRule[] {
	if (raw === undefined || raw === null) return [];
	const out: DashRule[] = [];
	// One at a time, so each keeps its own layout (a rule with a problem is left out).
	for (const item of Array.isArray(raw) ? raw : [raw]) {
		const { def, errors: e } = parseView({ highlight: Array.isArray(raw) ? [item] : item });
		errors.push(...e.map((m) => `${where}: ${m}`));
		const r = def?.highlight?.[0];
		// Dashboards style with highlight rules only (no data bars or colour scales).
		if (!r || (r.kind && r.kind !== "highlight")) continue;
		const layout = layouts && isObj(item) ? parseLayout(item.layout) : undefined;
		out.push(layout && r.target === ROW_TARGET ? { ...r, layout } : r);
	}
	return out;
}

const highlightOut = (rules: DashRule[]) =>
	(serializeView({ ...emptyView(), highlight: rules }).highlight as Record<string, unknown>[]).map((o, i) => (rules[i].layout && rules[i].target === ROW_TARGET && Object.keys(rules[i].layout!).length ? { ...o, layout: rules[i].layout } : o));

function parseLayout(raw: unknown): CardLayout | undefined {
	if (!isObj(raw)) return undefined;
	const one = <T extends string>(v: unknown, of: readonly T[]) => (of.includes(v as T) ? (v as T) : undefined);
	const l: CardLayout = {
		...(one(raw.size, CARD_SIZES) ? { size: one(raw.size, CARD_SIZES) } : {}),
		...(one(raw.align, CARD_ALIGNS) ? { align: one(raw.align, CARD_ALIGNS) } : {}),
		...(one(raw.label, CARD_LABELS) ? { label: one(raw.label, CARD_LABELS) } : {}),
		...(str(raw.caption) ? { caption: str(raw.caption) } : {}),
		...(one(raw.icon, CARD_ICONS) ? { icon: one(raw.icon, CARD_ICONS) } : {}),
		...(one(raw.accent, CARD_ACCENTS) ? { accent: one(raw.accent, CARD_ACCENTS) } : {}),
	};
	return Object.keys(l).length ? l : undefined;
}

function parseMeasure(raw: unknown, errors: string[], where: string): Measure {
	if (!isObj(raw)) return { agg: "count" };
	const agg = raw.agg === "sum" || raw.agg === "avg" ? raw.agg : "count";
	const column = agg !== "count" ? parseOneColumn(raw.column, errors, where) : null;
	if (agg !== "count" && !column) errors.push(`${where}: ${agg} needs a column.`);
	return column ? { agg, column } : { agg: "count" };
}

function parseFilters(raw: unknown, errors: string[], where: string): FilterGroup | undefined {
	if (!isObj(raw)) return undefined;
	const { def, errors: e } = parseView({ filters: raw });
	errors.push(...e.map((m) => `${where}: ${m}`));
	return def && def.filters.items.length ? def.filters : undefined;
}

const filtersOut = (f: FilterGroup) => serializeView({ ...emptyView(), filters: f }).filters;

/** Read a dashboard block (its parsed YAML). Problems that leave a component out, or part of one, are errors. */
export function parseDashboard(raw: unknown): { def: DashboardDef; errors: string[] } {
	const errors: string[] = [];
	const def: DashboardDef = { kind: "dashboard", components: [] };
	if (!isObj(raw)) return { def, errors };
	if (str(raw.place)) def.place = str(raw.place);
	const taken = new Set<string>();
	const list = Array.isArray(raw.components) ? raw.components : [];
	list.forEach((c, i) => {
		if (!isObj(c)) {
			errors.push(`Component ${i + 1} should be a set of keys like kind:, at:.`);
			return;
		}
		const kind = str(c.kind) as ComponentKind;
		if (!COMPONENT_KINDS.includes(kind)) {
			errors.push(`Component ${i + 1}: unknown kind "${str(c.kind)}". Use ${COMPONENT_KINDS.join(", ")}.`);
			return;
		}
		let id = str(c.id) || `${kind}${i + 1}`;
		for (let n = 2; taken.has(id); n++) id = `${str(c.id) || kind}_${n}`;
		taken.add(id);
		const a = Array.isArray(c.at) ? c.at : [];
		const size = DEFAULT_SIZE[kind];
		const w = int(a[2], 1, GRID_COLS, size.w);
		const at: GridAt = { x: int(a[0], 0, GRID_COLS - w, 0), y: int(a[1], 0, 10_000, 0), w, h: int(a[3], 1, 100, size.h) };
		const title = str(c.title);
		const where = title || `Component ${i + 1}`;
		const style = parseStyle(c.style);
		const highlight = [...parseHighlightRules(c.highlight, errors, where, kind === "card"), ...(kind === "card" ? legacyRules(c.rules) : [])];
		const base = { id, at, ...(title ? { title } : {}), ...(style ? { style } : {}), ...(highlight.length ? { highlight } : {}) };
		const source = parseSource(c.source, errors, where);
		switch (kind) {
			case "card": {
				const v = isObj(c.value) ? c.value : {};
				const value: CardValue = str(v.formula) ? { formula: str(v.formula) } : { agg: str(v.agg) || "count", ...(v.column !== undefined ? { column: parseOneColumn(v.column, errors, where) ?? undefined } : {}) };
				if ("column" in value && !value.column) delete value.column;
				const layout = parseLayout(c.layout);
				def.components.push({ ...base, kind, ...(source ? { source } : {}), value, ...(str(c.format) ? { format: str(c.format) } : {}), ...(layout ? { layout } : {}) });
				break;
			}
			case "chart": {
				const chart = (CHART_KINDS as string[]).includes(str(c.chart)) ? (str(c.chart) as ChartKind) : "bar";
				if (c.chart !== undefined && chart !== c.chart) errors.push(`${where}: unknown chart "${str(c.chart)}". Use ${CHART_KINDS.join(", ")}.`);
				const by = parseOneColumn(c.by, errors, where);
				const split = parseOneColumn(c.split, errors, where);
				const every: TimeStep | undefined = c.every === "week" || c.every === "year" || c.every === "month" ? c.every : undefined;
				const done = parseFilters(c.done, errors, where);
				def.components.push({
					...base,
					kind,
					chart,
					...(source ? { source } : {}),
					...(by ? { by } : {}),
					...(split ? { split } : {}),
					...(every ? { every } : {}),
					measure: parseMeasure(c.measure, errors, where),
					...(done ? { done } : {}),
					...(str(c.format) ? { format: str(c.format) } : {}),
				});
				break;
			}
			case "list": {
				const fields = (Array.isArray(c.fields) ? c.fields : []).map((f) => parseOneColumn(f, errors, where)).filter((f): f is ColumnDef => !!f && f.id !== "name");
				def.components.push({ ...base, kind, ...(source ? { source } : {}), fields, sort: parseSort(c.sort), limit: int(c.limit, 1, 500, LIST_LIMIT) });
				break;
			}
			case "view":
				def.components.push({ ...base, kind, view: str(c.view) });
				break;
			case "text":
				def.components.push({ ...base, kind, text: typeof c.text === "string" ? c.text : "" });
				break;
			case "button": {
				const action = parseAction(c.action);
				def.components.push({ ...base, kind, label: str(c.label) || "Button", ...(str(c.icon) ? { icon: str(c.icon) } : {}), ...(action ? { action } : {}) });
				break;
			}
		}
	});
	return { def, errors };
}

/** The definition as plain data for YAML. */
export function serializeDashboard(def: DashboardDef): Record<string, unknown> {
	const components = def.components.map((c) => {
		const out: Record<string, unknown> = { id: c.id, kind: c.kind };
		if (c.title) out.title = c.title;
		out.at = [c.at.x, c.at.y, c.at.w, c.at.h];
		if (c.style && Object.keys(c.style).length) out.style = c.style;
		if (c.highlight?.length) out.highlight = highlightOut(c.highlight);
		switch (c.kind) {
			case "card":
				if (c.source) out.source = sourceOut(c.source);
				out.value = "formula" in c.value ? { formula: c.value.formula } : { agg: c.value.agg, ...(c.value.column ? { column: columnOut(c.value.column) } : {}) };
				if (c.format) out.format = c.format;
				if (c.layout && Object.keys(c.layout).length) out.layout = c.layout;
				break;
			case "chart":
				out.chart = c.chart;
				if (c.source) out.source = sourceOut(c.source);
				if (c.by) out.by = columnOut(c.by);
				if (c.split) out.split = columnOut(c.split);
				if (c.every) out.every = c.every;
				if (c.measure.agg !== "count") out.measure = { agg: c.measure.agg, ...(c.measure.column ? { column: columnOut(c.measure.column) } : {}) };
				if (c.done) out.done = filtersOut(c.done);
				if (c.format) out.format = c.format;
				break;
			case "list":
				if (c.source) out.source = sourceOut(c.source);
				if (c.fields.length) out.fields = c.fields.map(columnOut);
				if (c.sort.length) out.sort = c.sort.map((s) => ({ by: s.by, dir: s.dir }));
				if (c.limit !== LIST_LIMIT) out.limit = c.limit;
				break;
			case "view":
				out.view = c.view;
				break;
			case "text":
				out.text = c.text;
				break;
			case "button":
				out.label = c.label;
				if (c.icon) out.icon = c.icon;
				if (c.action) out.action = c.action;
				break;
		}
		return out;
	});
	return { kind: DASHBOARD_KIND, components, ...(def.place ? { place: def.place } : {}) };
}

// ---------------------------------------------------------------- editing helpers

/** The row below every component (where new ones go). */
export const bottomRow = (def: DashboardDef) => def.components.reduce((y, c) => Math.max(y, c.at.y + c.at.h), 0);

/** A new component of a kind, at the bottom (or at `at`), with an id not used yet. */
export function newComponent(kind: ComponentKind, def: DashboardDef, at?: Partial<GridAt>): DashComponent {
	let n = def.components.length + 1;
	while (def.components.some((c) => c.id === `${kind}${n}`)) n++;
	const size = DEFAULT_SIZE[kind];
	const base = { id: `${kind}${n}`, at: { x: 0, y: bottomRow(def), ...size, ...at } };
	switch (kind) {
		case "card":
			return { ...base, kind, title: "Count", source: { kind: "query", def: emptyView() }, value: { agg: "count" } };
		case "chart":
			return { ...base, kind, title: "By status", chart: "bar", source: { kind: "query", def: emptyView() }, by: columnFromId("status"), measure: { agg: "count" } };
		case "list":
			return { ...base, kind, title: "List", source: { kind: "query", def: emptyView() }, fields: [], sort: [], limit: LIST_LIMIT };
		case "view":
			return { ...base, kind, view: "" };
		case "text":
			return { ...base, kind, text: "## Heading\nSome text." };
		case "button":
			return { ...base, kind, label: "New note" };
	}
}

/** Stacked order for narrow widths: by row, then column. */
export const readingOrder = (cs: DashComponent[]) => [...cs].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);

// ---------------------------------------------------------------- evaluating

export interface DashEnv {
	ctx: ViewContext;
	rows: ViewRow[];
	/** a view note's definition by name (resolved like a link), or null when there's no such view */
	view: (name: string) => ViewDef | null;
}

/** A source's run: its result, and the definition run (for opening the notes as a table). */
export type SourceRun = { result: ViewResult; def: ViewDef } | { error: string };

/**
 * Run a source: its notes, with `extra` columns worked out (a card's value column, a list's fields) and sorted by
 * `sort` (else the source's own sort). `opts.group`: grouping levels (charts); `opts.filters`: more conditions the
 * notes must also meet (a progress chart's "done"); `opts.highlight`: rules styling the rows (a list's).
 */
export function runSource(source: DashSource | undefined, extra: ColumnDef[], sort: SortLevel[], env: DashEnv, opts: { group?: GroupBy[]; filters?: FilterGroup; highlight?: HighlightRule[] } = {}): SourceRun {
	if (!source) return { error: "Choose where its notes come from." };
	const withColumns = (base: ViewDef): ViewDef => {
		const columns = [...base.columns];
		for (const c of extra) if (!columns.some((x) => x.id === c.id)) columns.push(c);
		const filters = opts.filters ? { mode: "all" as const, items: [base.filters, opts.filters] } : base.filters;
		// The component's own highlight rules (a list's), not a saved view's.
		return { ...base, kind: "table", group: opts.group ?? [], columns, sort: sort.length ? sort : base.sort, filters, highlight: opts.highlight ?? [] };
	};
	const go = (def: ViewDef, rows: ViewRow[] = env.rows): SourceRun => ({ result: runView(def, rows, env.ctx), def });
	try {
		if (source.kind === "view") {
			if (!source.view) return { error: "Choose a view." };
			const base = env.view(source.view);
			if (!base) return { error: `There's no view called "${source.view}".` };
			return go(withColumns(base));
		}
		if (source.kind === "query") return go(withColumns(source.def));
		const { value } = evaluateDetached(source.formula, env.ctx);
		const list = Array.isArray(value) ? value : value === null ? [] : [value];
		if (!list.every(isLink)) return { error: 'The formula should give notes, e.g. filter(notes("quest"), prop(item, "Status") = "active").' };
		const paths = [...new Set(list.map((l) => (isLink(l) ? l.path : null)).filter((p): p is string => !!p))];
		return go({ ...withColumns(emptyView()), only: paths });
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

/** Notes to open as a table: the definition they came from, and exactly which notes. */
export interface Drill {
	title: string;
	def: ViewDef;
	paths: string[];
}

const drillOf = (title: string, def: ViewDef, rows: ResultRow[]): Drill => ({ title, def, paths: rows.map((r) => r.row.path) });

export interface CardOut {
	text: string;
	value: FValue;
	/** what's shown under the value (e.g. "Sum of Reward gold"), when there's no title */
	label?: string;
	error?: string;
	/** how many notes it's over (cards with a source) */
	count?: number;
	/** the error is a circular reference (passed on as is, not as "[X] has a problem") */
	cycle?: true;
	/** the value as a number to compare (a percentage as shown, 0–100), for highlight conditions */
	num?: number;
	/** its notes, to open as a table (cards with a source) */
	drill?: Drill;
}

class CycleError extends Error {}

export interface ListOut {
	rows: ResultRow[];
	columns: ResolvedColumn[];
	/** how many notes match, before the limit */
	total: number;
	/** per highlight rule: how many of the notes it matches */
	highlightCounts: number[];
	error?: string;
}

/** A card's name for formulas over cards: its title, else its id. */
export const cardName = (c: DashComponent) => c.title || c.id;

const formatValue = (v: FValue, format: string | undefined, ctx: ViewContext): string => {
	if (v instanceof DateVal) return format && ctx.moment ? formatDate(v.days, format, ctx.moment as MomentLike, ctx.today) : format === RELATIVE ? formatDate(v.days, format, ctx.moment as MomentLike, ctx.today) : ctx.dates.format(v.days, "short");
	if (typeof v === "number") return formatNumber(v, format || "number", ctx.locale ?? "en", ctx.currency);
	if (Array.isArray(v) && v.every(isLink)) return v.map((l) => (isLink(l) ? l.name : "")).join(", ");
	return toText(v, { dateText: (d) => ctx.dates.format(d, "short") });
};

/** Every card's value, every list's notes, every chart's bars and every component's look, in one pass (sources shared by several components run once). */
export function evaluateDashboard(def: DashboardDef, env: DashEnv): { cards: Map<string, CardOut>; lists: Map<string, ListOut>; charts: Map<string, ChartOut>; looks: Map<string, ComponentLook> } {
	const runs = new Map<string, SourceRun>();
	const run = (source: DashSource | undefined, extra: ColumnDef[], sort: SortLevel[], opts: { group?: GroupBy[]; filters?: FilterGroup; highlight?: HighlightRule[] } = {}) => {
		const key = JSON.stringify([source ?? null, extra, sort, opts]);
		let r = runs.get(key);
		if (!r) runs.set(key, (r = runSource(source, extra, sort, env, opts)));
		return r;
	};

	const cards = new Map<string, CardOut>();
	const cardList = def.components.filter((c): c is Extract<DashComponent, { kind: "card" }> => c.kind === "card");
	const names = cardList.map((c) => ({ id: c.id, name: cardName(c) }));
	/** cards being worked out, to catch formulas that refer back to themselves */
	const stack: string[] = [];
	const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? id;
	const card = (c: Extract<DashComponent, { kind: "card" }>): CardOut => {
		const done = cards.get(c.id);
		if (done) return done;
		let out: CardOut;
		if ("formula" in c.value) {
			if (stack.includes(c.id)) return { text: "", value: null, error: `Circular reference: ${[...stack.slice(stack.indexOf(c.id)), c.id].map(nameOf).join(" → ")}.`, cycle: true };
			stack.push(c.id);
			try {
				const refs = compile(c.value.formula, names.map((n) => ({ id: `name:${n.name}`, label: n.name, type: "any" }))).refs.filter((r) => r.startsWith("name:")).map((r) => r.slice(5));
				const used = refs.map((name) => {
					const other = cardList.find((x) => cardName(x) === name)!;
					const v = card(other);
					if (v.cycle) throw new CycleError(v.error!);
					if (v.error) throw new FormulaError(`[${name}] has a problem: ${v.error}`);
					return { name, value: v.value };
				});
				const value = evaluateDetached(c.value.formula, env.ctx, used).value;
				out = { text: formatValue(value, c.format, env.ctx), value, ...(typeof value === "number" && Number.isFinite(value) ? { num: value } : {}) };
			} catch (e) {
				out = { text: "", value: null, error: e instanceof Error ? e.message : String(e), ...(e instanceof CycleError ? { cycle: true as const } : {}) };
			}
			stack.pop();
		} else {
			const column = c.value.column ?? NAME_COLUMN;
			const r = run(c.source, [column], []);
			if ("error" in r) out = { text: "", value: null, error: r.error };
			else {
				const col = r.result.known.get(column.id) ?? r.result.columns.find((x) => x.id === column.id);
				const s = col ? summarize(r.result.rows, col, c.value.agg, env.ctx, c.format) : null;
				if (!col || !s) out = { text: "", value: null, error: col?.invalid ?? `"${c.value.agg}" doesn't apply to ${col?.label ?? column.id}.` };
				else {
					const value = s.value === undefined ? s.text : s.date ? new DateVal(s.value) : s.value;
					// Percentages compare as shown (50, not 0.5).
					const num = s.value === undefined || s.date ? undefined : s.text.trim().endsWith("%") ? s.value * 100 : s.value;
					out = { text: s.text, value, label: `${s.label}${column.id === "name" ? " of notes" : ` of ${col.label}`}`, count: r.result.rows.length, drill: drillOf(cardName(c), r.def, r.result.rows), ...(num !== undefined ? { num } : {}) };
				}
			}
		}
		cards.set(c.id, out);
		return out;
	};
	for (const c of cardList) card(c);

	const lists = new Map<string, ListOut>();
	for (const c of def.components) {
		if (c.kind !== "list") continue;
		const r = run(c.source, c.fields, c.sort, c.highlight?.length ? { highlight: c.highlight } : {});
		if ("error" in r) lists.set(c.id, { rows: [], columns: [], total: 0, highlightCounts: [], error: r.error });
		else {
			const columns = c.fields.map((f) => r.result.known.get(f.id) ?? r.result.columns.find((x) => x.id === f.id)).filter((x): x is ResolvedColumn => !!x);
			lists.set(c.id, { rows: r.result.rows.slice(0, c.limit), columns, total: r.result.rows.length, highlightCounts: r.result.highlightCounts });
		}
	}

	const charts = new Map<string, ChartOut>();
	for (const c of def.components) if (c.kind === "chart") charts.set(c.id, chartOf(c, env, run));

	// Each component's look: its style, with the first matching rule on top (a list's rules style its rows instead).
	const looks = new Map<string, ComponentLook>();
	for (const c of def.components) {
		if (c.kind === "list") {
			looks.set(c.id, { box: c.style ?? {}, matched: lists.get(c.id)?.highlightCounts ?? [] });
			continue;
		}
		const { columns, cells } = valueColumns(def, cards, c);
		const rules = c.highlight ?? [];
		const matched = rules.map((r) => (matchesValues(r.when, columns, cells, env.ctx) ? 1 : 0));
		const first = (target: string) => rules.find((r, i) => matched[i] && !r.off && r.target === target);
		const valueRule = c.kind === "card" ? first(VALUE_ID) : undefined;
		const boxRule = first(ROW_TARGET);
		const card =
			c.kind === "card"
				? (() => {
						const set = (o: CardLayout | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== "")) as CardLayout;
						const l = { ...DEFAULT_CARD_LAYOUT, ...set(c.layout), ...set(boxRule?.layout) };
						return { ...l, caption: l.caption ? fillCaption(l.caption, def, cards, c) : "" };
					})()
				: undefined;
		looks.set(c.id, { box: { ...c.style, ...boxRule?.style }, ...(valueRule ? { value: valueRule.style } : {}), ...(card ? { card } : {}), matched });
	}
	return { cards, lists, charts, looks };
}

/** A card's caption with `[Value]` (its own value) and other cards' `[Title]`s replaced by their values as shown. */
export function fillCaption(caption: string, def: DashboardDef, cards: Map<string, CardOut>, self: DashComponent): string {
	return caption.replace(/\[([^\]]+)\]/g, (all, name: string) => {
		const key = name.trim().toLowerCase();
		const other = key === VALUE_ID ? self : def.components.find((x) => x.kind === "card" && cardName(x).toLowerCase() === key);
		if (!other) return all;
		const out = cards.get(other.id);
		return out && !out.error && out.text ? out.text : "–";
	});
}

/**
 * How a component looks now: its box's style, a card's value's own style and its layout (the caption filled in),
 * and whether each rule matches (1 / 0, or rows).
 */
export interface ComponentLook {
	box: HighlightStyle;
	value?: HighlightStyle;
	card?: Required<CardLayout>;
	matched: number[];
}

const valueKind = (v: FValue): ValueKind => (typeof v === "number" ? "number" : v instanceof DateVal ? "date" : typeof v === "boolean" ? "bool" : "text");
const valueCell = (v: FValue, text: string): Cell =>
	v === null || v === undefined || v === ""
		? { value: null, text: "", sort: null }
		: typeof v === "number"
			? { value: v, text, sort: v }
			: v instanceof DateVal
				? { value: v.days, text, sort: v.days }
				: typeof v === "boolean"
					? { value: v, text, sort: v ? 1 : 0 }
					: { value: text, text, sort: text.toLowerCase() };

/**
 * What highlight conditions on a dashboard can test: every card's value, by title (`card:<id>`), and for a card its
 * own as Value. Percentages are compared as shown (50 for 50%). A card that has no value yet is a number.
 */
export function valueColumns(def: DashboardDef, cards: Map<string, CardOut>, self?: DashComponent): { columns: ResolvedColumn[]; cells: Record<string, Cell> } {
	const columns: ResolvedColumn[] = [];
	const cells: Record<string, Cell> = {};
	const add = (id: string, label: string, out: CardOut | undefined) => {
		const v = out?.error ? null : out?.num !== undefined ? out.num : (out?.value ?? null);
		const kind: ValueKind = v === null ? "number" : valueKind(v);
		columns.push({ def: { kind: "formula", id, formula: "", label }, id, label, kind, editable: false });
		cells[id] = valueCell(v, out?.text ?? "");
	};
	if (self?.kind === "card") add(VALUE_ID, "Value", cards.get(self.id));
	for (const c of def.components) if (c.kind === "card" && c.id !== self?.id) add(cardColumnId(c.id), cardName(c), cards.get(c.id));
	return { columns, cells };
}

// ---------------------------------------------------------------- charts

export interface ChartPart {
	key: string;
	label: string;
	value: number;
	text: string;
	color: PaletteColor | null;
	drill: Drill;
}

/** One bar, slice or point: a group of notes and its measure; a stacked bar's parts are its split values. */
export interface ChartBar extends ChartPart {
	parts: ChartPart[];
}

export interface ChartOut {
	bars: ChartBar[];
	/** stacked bars: the split values, in their order */
	series: { key: string; label: string; color: PaletteColor | null }[];
	/** the measure over every note */
	total: number;
	totalText: string;
	/** progress: the done notes' measure against every note's */
	progress?: { done: number; doneText: string; share: number; drill: Drill };
	/** what's measured, for the axis and tooltips ("Notes", "Sum of Reward gold") */
	measureLabel: string;
	error?: string;
}

const NO_CHART: Omit<ChartOut, "error"> = { bars: [], series: [], total: 0, totalText: "", measureLabel: "" };
const MAX_STEPS = 400;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A time step's bucket for a date (days): its first day, and the next bucket's first day. */
export function stepOf(days: number, every: TimeStep): number {
	const d = new Date(days * 86_400_000);
	if (every === "week") return days - ((d.getUTCDay() + 6) % 7);
	if (every === "month") return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86_400_000);
	return Math.floor(Date.UTC(d.getUTCFullYear(), 0, 1) / 86_400_000);
}
export function nextStep(start: number, every: TimeStep): number {
	if (every === "week") return start + 7;
	const d = new Date(start * 86_400_000);
	return every === "month" ? Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 86_400_000) : Math.floor(Date.UTC(d.getUTCFullYear() + 1, 0, 1) / 86_400_000);
}
function stepLabel(start: number, every: TimeStep): string {
	const d = new Date(start * 86_400_000);
	if (every === "year") return String(d.getUTCFullYear());
	if (every === "month") return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
	return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

function chartOf(c: Extract<DashComponent, { kind: "chart" }>, env: DashEnv, run: (s: DashSource | undefined, extra: ColumnDef[], sort: SortLevel[], opts?: { group?: GroupBy[]; filters?: FilterGroup }) => SourceRun): ChartOut {
	const { ctx } = env;
	const title = c.title || CHART_LABELS[c.chart];
	const fail = (error: string): ChartOut => ({ ...NO_CHART, error });
	const mcol = c.measure.agg === "count" ? null : (c.measure.column ?? null);
	const extra = [...(c.by ? [c.by] : []), ...(c.split ? [c.split] : []), ...(mcol ? [mcol] : [])];
	const fmt = (n: number) => formatNumber(n, c.format || "number", ctx.locale ?? "en", ctx.currency);
	const base = run(c.source, extra, []);
	if ("error" in base) return fail(base.error);
	const resolved = (col: ColumnDef) => base.result.known.get(col.id) ?? base.result.columns.find((x) => x.id === col.id);
	const measureCol = mcol ? resolved(mcol) : null;
	if (mcol && (!measureCol || measureCol.kind !== "number")) return fail(`${c.measure.agg === "sum" ? "Sum" : "Average"} needs a number field${measureCol ? `; ${measureCol.label} isn't one` : ""}.`);
	const measure = (rows: ResultRow[]): number => {
		if (!measureCol) return rows.length;
		const nums = rows.map((r) => r.cells[measureCol.id]?.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		const sum = nums.reduce((a, b) => a + b, 0);
		return c.measure.agg === "avg" ? (nums.length ? sum / nums.length : 0) : sum;
	};
	const measureLabel = measureCol ? `${c.measure.agg === "sum" ? "Sum" : "Average"} of ${measureCol.label}` : "Notes";
	const total = measure(base.result.rows);
	const head = { series: [], total, totalText: fmt(total), measureLabel };
	const drillDef = { ...base.def, group: [] };

	if (c.chart === "progress") {
		if (!c.done?.items.length) return { ...fail("Set when a note counts as done."), measureLabel };
		const done = run(c.source, extra, [], { filters: c.done });
		if ("error" in done) return fail(done.error);
		const d = measure(done.result.rows);
		return { ...head, bars: [], progress: { done: d, doneText: fmt(d), share: total ? d / total : 0, drill: drillOf(`${title} · done`, drillDef, done.result.rows) } };
	}

	if (!c.by) return fail(c.chart === "line" ? "Choose a date field." : "Choose a field to group by.");
	const by = resolved(c.by);
	if (!by || by.invalid) return fail(by?.invalid ?? `Unknown field ${c.by.id}.`);
	const colorOf = (col: ResolvedColumn, key: string): PaletteColor | null =>
		col.def.kind === "builtin" && col.def.key === "status" ? statusPaint(key, ctx.types, ctx.groups) : col.field ? choiceColor(col.field, key) : null;
	const labelOf = (col: ResolvedColumn, label: string) => label || `No ${col.label.toLowerCase()}`;

	if (c.chart === "line") {
		if (by.kind !== "date") return fail(`A line chart needs a date field; ${by.label} isn't one.`);
		const every = c.every ?? "month";
		const buckets = new Map<number, ResultRow[]>();
		for (const r of base.result.rows) {
			const v = r.cells[by.id]?.value;
			if (typeof v !== "number" || !Number.isFinite(v)) continue;
			const k = stepOf(v, every);
			buckets.set(k, [...(buckets.get(k) ?? []), r]);
		}
		if (!buckets.size) return { ...head, bars: [] };
		const keys = [...buckets.keys()].sort((a, b) => a - b);
		const bars: ChartBar[] = [];
		for (let k = keys[0], n = 0; k <= keys[keys.length - 1] && n < MAX_STEPS; k = nextStep(k, every), n++) {
			const rows = buckets.get(k) ?? [];
			const value = measure(rows);
			const label = stepLabel(k, every);
			bars.push({ key: String(k), label, value, text: fmt(value), color: null, drill: drillOf(`${title} · ${label}`, drillDef, rows), parts: [] });
		}
		return { ...head, bars };
	}

	const grouped = run(c.source, extra, [], { group: [{ by: c.by.id }, ...(c.chart === "stacked" && c.split ? [{ by: c.split.id }] : [])] });
	if ("error" in grouped) return fail(grouped.error);
	const split = c.chart === "stacked" && c.split ? resolved(c.split) : null;
	if (c.chart === "stacked" && !split) return fail("Choose a field to split each bar by.");
	// The split values in their own order (statuses in status order, choices in choice order).
	let series: ChartOut["series"] = [];
	if (split) {
		const order = run(c.source, extra, [], { group: [{ by: split.id }] });
		if (!("error" in order)) series = (order.result.groups ?? []).map((g) => ({ key: g.key, label: labelOf(split, g.label), color: colorOf(split, g.key) }));
	}
	const lastKey = (k: string) => k.split(GROUP_PATH_SEP).pop() ?? k;
	const bars: ChartBar[] = (grouped.result.groups ?? []).map((g) => {
		const value = measure(g.rows);
		const label = labelOf(by, g.label);
		const parts: ChartPart[] = split
			? series.map((s) => {
					const child = g.children?.find((x) => lastKey(x.key) === s.key);
					const rows = child?.rows ?? [];
					const v = measure(rows);
					return { key: s.key, label: s.label, value: v, text: fmt(v), color: s.color, drill: drillOf(`${title} · ${label} · ${s.label}`, drillDef, rows) };
				})
			: [];
		return { key: g.key, label, value, text: fmt(value), color: colorOf(by, g.key), drill: drillOf(`${title} · ${label}`, drillDef, g.rows), parts };
	});
	return { ...head, bars, series };
}
