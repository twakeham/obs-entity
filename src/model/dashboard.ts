import { compile, DateVal, FormulaError, isLink, toText, type FValue } from "./formula";
import { FILTER_CONTROLS, filterFValue, filterText, groupWithFilters, parseFilterValue, withFilters, type FilterControl, type FilterValues } from "./dashboardFilters";
import { typeExplicitlyTargeted, type EntityTypeDef } from "./types";
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

export type ComponentKind = "card" | "chart" | "list" | "view" | "text" | "button" | "filter";
export const COMPONENT_KINDS: ComponentKind[] = ["card", "chart", "list", "view", "text", "button", "filter"];
export const COMPONENT_LABELS: Record<ComponentKind, string> = { card: "Summary card", chart: "Chart", list: "List", view: "View", text: "Text", button: "Button", filter: "Filter" };
export const COMPONENT_ICONS: Record<ComponentKind, string> = { card: "hash", chart: "bar-chart-3", list: "list", view: "table", text: "type", button: "mouse-pointer-click", filter: "filter" };
/** a new component's size (grid cells) */
export const DEFAULT_SIZE: Record<ComponentKind, { w: number; h: number }> = { card: { w: 3, h: 2 }, chart: { w: 6, h: 5 }, list: { w: 4, h: 5 }, view: { w: 6, h: 8 }, text: { w: 4, h: 2 }, button: { w: 2, h: 1 }, filter: { w: 4, h: 1 } };

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

/** A dashboard's highlight rule: a card's or button's whole-component rules can also change its layout. */
export type DashRule = HighlightRule & { layout?: CardLayout | ButtonLayout | ListLayout };

export const BUTTON_VARIANTS = ["solid", "soft", "outline", "plain"] as const;
const BUTTON_SIZES = ["s", "m", "l"] as const;
const BUTTON_WIDTHS = ["fill", "fit"] as const;
const BUTTON_ICON_AT = ["before", "above", "after", "only"] as const;
const BUTTON_STATES = ["enabled", "disabled"] as const;

/**
 * How a button looks: solid (the accent or fill colour), soft (tinted), outline or plain (text only); its size;
 * filling its cell or fitting its label; where its label and icon sit; its icon before, above or after the label, or
 * on its own (the label as a tooltip); a description under the label (`[Value]`-style card names are filled in).
 * A whole-button rule can change any of it, and can disable the button (`state`).
 */
export interface ButtonLayout {
	variant?: (typeof BUTTON_VARIANTS)[number];
	size?: (typeof BUTTON_SIZES)[number];
	width?: (typeof BUTTON_WIDTHS)[number];
	align?: (typeof CARD_ALIGNS)[number];
	icon?: (typeof BUTTON_ICON_AT)[number];
	description?: string;
	state?: (typeof BUTTON_STATES)[number];
}
export const DEFAULT_BUTTON_LAYOUT: Required<ButtonLayout> = { variant: "solid", size: "m", width: "fill", align: "center", icon: "before", description: "", state: "enabled" };

const LIST_DENSITIES = ["compact", "comfortable", "spacious"] as const;
const LIST_DISPLAYS = ["rows", "cards"] as const;
const LIST_MARKERS = ["status", "icon", "number", "none"] as const;
const LIST_FIELDS_AT = ["right", "below"] as const;
const LIST_MORE = ["text", "link", "hidden"] as const;

/**
 * How a list looks: spacing; plain rows or small boxed cards; dividers and stripes between rows; what's before each
 * name (the status dot, type icon, a number, or nothing); a header row of field names; fields at the right (in
 * columns) or on a second line; the title row and its count; and "+N more" as text, a link to the notes, or hidden.
 * A whole-list rule (on card values) can change any of it.
 */
export interface ListLayout {
	density?: (typeof LIST_DENSITIES)[number];
	display?: (typeof LIST_DISPLAYS)[number];
	dividers?: boolean;
	stripes?: boolean;
	marker?: (typeof LIST_MARKERS)[number];
	fieldNames?: boolean;
	fields?: (typeof LIST_FIELDS_AT)[number];
	header?: boolean;
	count?: boolean;
	more?: (typeof LIST_MORE)[number];
}
export const DEFAULT_LIST_LAYOUT: Required<ListLayout> = { density: "compact", display: "rows", dividers: false, stripes: false, marker: "status", fieldNames: false, fields: "right", header: true, count: true, more: "text" };

const CHART_COLORINGS = ["field", "one", "palette", "shades"] as const;
const LEGEND_AT = ["right", "below"] as const;
const HOLES = ["pie", "thick", "normal", "thin"] as const;
const PROGRESS_SHOW = ["both", "percent", "count"] as const;
const THICKNESSES = ["thin", "normal", "wide"] as const;
export const CHART_SORTS = ["field", "desc", "asc", "az"] as const;
export type ChartSort = (typeof CHART_SORTS)[number];

/**
 * How a chart looks (each key optional; `chartLook` fills in the defaults, which are how charts looked before they had
 * options). `colors`: the field's own colours, `one` colour (`color`, else the accent colour), a `palette` colour per
 * bar or slice, or `shades` of one colour. Lines and progress bars only take `color`.
 */
export interface ChartLook {
	colors?: (typeof CHART_COLORINGS)[number];
	color?: PaletteColor;
	/** each bar's, slice's (in the legend) or point's value on the chart */
	values?: boolean;
	/** gridlines and the value axis (bars, stacked bars, lines) */
	grid?: boolean;
	/** stacked bars' and donuts' legend */
	legend?: boolean;
	/** a donut's legend: at the right or below (unset: whichever fits the cell) */
	legendAt?: (typeof LEGEND_AT)[number];
	hole?: (typeof HOLES)[number];
	/** the total in a donut's middle */
	total?: boolean;
	smooth?: boolean;
	area?: boolean;
	dots?: boolean;
	/** a progress bar's text: the percentage, "5 of 13", or both */
	show?: (typeof PROGRESS_SHOW)[number];
	/** bars' thickness, or a progress bar's */
	thickness?: (typeof THICKNESSES)[number];
	rounded?: boolean;
}

/** A chart's look with every default filled in (line charts don't show values unless asked). */
export function chartLook(c: { chart: ChartKind; look?: ChartLook }): Required<Omit<ChartLook, "color" | "legendAt">> & Pick<ChartLook, "color" | "legendAt"> {
	return { colors: "field", values: c.chart !== "line", grid: true, legend: true, hole: "normal", total: true, smooth: false, area: true, dots: true, show: "both", thickness: "normal", rounded: false, ...c.look };
}

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
			look?: ChartLook;
			/** bars and slices: their order (the field's own, by value, or by label) */
			sort?: ChartSort;
			/** bars and slices: only the biggest N, the rest as one "Other" */
			top?: number;
			/** bars and slices: leave out the notes with no value ("No status") */
			hideEmpty?: boolean;
	  })
	| (Base & {
			kind: "list";
			source?: DashSource;
			fields: ColumnDef[];
			sort: SortLevel[];
			limit: number;
			layout?: ListLayout;
			/** whole-list rules, on card values (its `highlight` rules are on its notes, styling rows and fields) */
			boxHighlight?: DashRule[];
	  })
	| (Base & { kind: "view"; view: string })
	| (Base & { kind: "text"; text: string })
	| (Base & { kind: "button"; label: string; icon?: string; action?: ButtonAction; layout?: ButtonLayout })
	| (Base & {
			kind: "filter";
			control: FilterControl;
			/** note and choice filters: the types whose notes (or field values) it offers */
			types?: string[];
			/** a choice filter: the choice, status or multiple-choice field it offers the values of */
			field?: ColumnDef;
			/** note and choice filters: pick several (else one) */
			multiple?: boolean;
	  });

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

function parseHighlightRules(raw: unknown, errors: string[], where: string, layouts: "card" | "button" | "list" | null): DashRule[] {
	if (raw === undefined || raw === null) return [];
	const out: DashRule[] = [];
	// One at a time, so each keeps its own layout (a rule with a problem is left out).
	for (const item of Array.isArray(raw) ? raw : [raw]) {
		const { def, errors: e } = parseView({ highlight: Array.isArray(raw) ? [item] : item });
		errors.push(...e.map((m) => `${where}: ${m}`));
		const r = def?.highlight?.[0];
		// Dashboards style with highlight rules only (no data bars or colour scales).
		if (!r || (r.kind && r.kind !== "highlight")) continue;
		const layout = layouts && isObj(item) ? (layouts === "card" ? parseLayout(item.layout) : layouts === "button" ? parseButtonLayout(item.layout, true) : parseListLayout(item.layout)) : undefined;
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

/** A button's layout; `state` (disabling it) only in a rule. */
function parseButtonLayout(raw: unknown, rule = false): ButtonLayout | undefined {
	if (!isObj(raw)) return undefined;
	const one = <T extends string>(v: unknown, of: readonly T[]) => (of.includes(v as T) ? (v as T) : undefined);
	const l: ButtonLayout = {
		...(one(raw.variant, BUTTON_VARIANTS) ? { variant: one(raw.variant, BUTTON_VARIANTS) } : {}),
		...(one(raw.size, BUTTON_SIZES) ? { size: one(raw.size, BUTTON_SIZES) } : {}),
		...(one(raw.width, BUTTON_WIDTHS) ? { width: one(raw.width, BUTTON_WIDTHS) } : {}),
		...(one(raw.align, CARD_ALIGNS) ? { align: one(raw.align, CARD_ALIGNS) } : {}),
		...(one(raw.icon, BUTTON_ICON_AT) ? { icon: one(raw.icon, BUTTON_ICON_AT) } : {}),
		...(str(raw.description) ? { description: str(raw.description) } : {}),
		...(rule && one(raw.state, BUTTON_STATES) ? { state: one(raw.state, BUTTON_STATES) } : {}),
	};
	return Object.keys(l).length ? l : undefined;
}

function parseListLayout(raw: unknown): ListLayout | undefined {
	if (!isObj(raw)) return undefined;
	const l: Record<string, unknown> = {};
	const enums: [keyof ListLayout, readonly string[]][] = [
		["density", LIST_DENSITIES],
		["display", LIST_DISPLAYS],
		["marker", LIST_MARKERS],
		["fields", LIST_FIELDS_AT],
		["more", LIST_MORE],
	];
	for (const [k, of] of enums) if (of.includes(raw[k] as string)) l[k] = raw[k];
	for (const k of ["dividers", "stripes", "fieldNames", "header", "count"] as const) if (typeof raw[k] === "boolean") l[k] = raw[k];
	return Object.keys(l).length ? (l as ListLayout) : undefined;
}

function parseChartLook(raw: unknown): ChartLook | undefined {
	if (!isObj(raw)) return undefined;
	const l: Record<string, unknown> = {};
	const enums: [keyof ChartLook, readonly string[]][] = [
		["colors", CHART_COLORINGS],
		["legendAt", LEGEND_AT],
		["hole", HOLES],
		["show", PROGRESS_SHOW],
		["thickness", THICKNESSES],
	];
	for (const [k, of] of enums) if (of.includes(raw[k] as string)) l[k] = raw[k];
	if (isPaletteColor(raw.color)) l.color = raw.color;
	for (const k of ["values", "grid", "legend", "total", "smooth", "area", "dots", "rounded"] as const) if (typeof raw[k] === "boolean") l[k] = raw[k];
	return Object.keys(l).length ? (l as ChartLook) : undefined;
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
		const highlight = [...parseHighlightRules(c.highlight, errors, where, kind === "card" || kind === "button" ? kind : null), ...(kind === "card" ? legacyRules(c.rules) : [])];
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
				const look = parseChartLook(c.look);
				const sort = (CHART_SORTS as readonly string[]).includes(str(c.sort)) && c.sort !== "field" ? (c.sort as ChartSort) : undefined;
				const top = typeof c.top === "number" && c.top >= 1 ? int(c.top, 1, 100, 1) : undefined;
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
					...(look ? { look } : {}),
					...(sort ? { sort } : {}),
					...(top ? { top } : {}),
					...(c.hideEmpty === true ? { hideEmpty: true } : {}),
				});
				break;
			}
			case "list": {
				const fields = (Array.isArray(c.fields) ? c.fields : []).map((f) => parseOneColumn(f, errors, where)).filter((f): f is ColumnDef => !!f && f.id !== "name");
				const layout = parseListLayout(c.layout);
				const boxHighlight = parseHighlightRules(c.boxHighlight, errors, where, "list");
				def.components.push({ ...base, kind, ...(source ? { source } : {}), fields, sort: parseSort(c.sort), limit: int(c.limit, 1, 500, LIST_LIMIT), ...(layout ? { layout } : {}), ...(boxHighlight.length ? { boxHighlight } : {}) });
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
				const layout = parseButtonLayout(c.layout);
				def.components.push({ ...base, kind, label: str(c.label) || "Button", ...(str(c.icon) ? { icon: str(c.icon) } : {}), ...(action ? { action } : {}), ...(layout ? { layout } : {}) });
				break;
			}
			case "filter": {
				const control = (FILTER_CONTROLS as readonly string[]).includes(str(c.control)) ? (c.control as FilterControl) : "note";
				if (c.control !== undefined && control !== c.control) errors.push(`${where}: unknown filter control "${str(c.control)}". Use ${FILTER_CONTROLS.join(", ")}.`);
				if (id === "this") errors.push(`${where}: a filter can't have the id "this" (it means the note a view is on).`);
				const types = Array.isArray(c.types) ? c.types.map(str).filter(Boolean) : [];
				const field = control === "choice" ? parseOneColumn(c.field, errors, where) : null;
				def.components.push({ ...base, kind, control, ...(types.length && (control === "note" || control === "choice") ? { types } : {}), ...(field ? { field } : {}), ...(c.multiple === true && (control === "note" || control === "choice") ? { multiple: true } : {}) });
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
				if (c.sort && c.sort !== "field") out.sort = c.sort;
				if (c.top) out.top = c.top;
				if (c.hideEmpty) out.hideEmpty = true;
				if (c.look && Object.keys(c.look).length) out.look = c.look;
				break;
			case "list":
				if (c.source) out.source = sourceOut(c.source);
				if (c.fields.length) out.fields = c.fields.map(columnOut);
				if (c.sort.length) out.sort = c.sort.map((s) => ({ by: s.by, dir: s.dir }));
				if (c.limit !== LIST_LIMIT) out.limit = c.limit;
				if (c.layout && Object.keys(c.layout).length) out.layout = c.layout;
				if (c.boxHighlight?.length) out.boxHighlight = highlightOut(c.boxHighlight);
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
				if (c.layout && Object.keys(c.layout).length) out.layout = c.layout;
				break;
			case "filter":
				out.control = c.control;
				if (c.types?.length) out.types = c.types;
				if (c.field) out.field = columnOut(c.field);
				if (c.multiple) out.multiple = true;
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
		case "filter":
			return { ...base, kind, title: "Filter", control: "note" };
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
	/** what's picked in each filter, by its id (conditions using a filter with nothing picked are left out) */
	filters?: FilterValues;
	/** the filters' values in formulas, by title (`[Campaign]`); `withFilterNames` fills it in */
	filterNames?: { name: string; value: FValue }[];
}

/** The env with the dashboard's filters' formula values (`[Campaign]`), for formula sources and card formulas. */
export function withFilterNames(def: DashboardDef, env: DashEnv): DashEnv {
	const filterNames = def.components.filter((c) => c.kind === "filter").map((c) => ({ name: cardName(c), value: filterFValue(env.filters?.[c.id], env.ctx) }));
	return { ...env, filterNames };
}

/** The dashboard's filters, for condition editors (a condition's value can be one). */
export const dashFilterList = (def: DashboardDef) =>
	def.components.flatMap((c) => (c.kind === "filter" ? [{ id: c.id, label: cardName(c), control: c.control }] : []));

/**
 * What each filter starts on: what was last picked (remembered on this device, `stored` by filter id), else, for a
 * dashboard shown on a note (`host`), a note filter whose types name that note's type starts on that note.
 */
export function startingFilters(def: DashboardDef, stored: unknown, host: { path: string; type: EntityTypeDef } | null): FilterValues {
	const out: FilterValues = {};
	const saved = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
	for (const c of def.components) {
		if (c.kind !== "filter") continue;
		const v = parseFilterValue(saved[c.id], c.control);
		if (v) out[c.id] = v;
		else if (c.control === "note" && host && typeExplicitlyTargeted(host.type, c.types)) out[c.id] = { kind: "note", paths: [host.path] };
	}
	return out;
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
	const go = (def: ViewDef, rows: ViewRow[] = env.rows): SourceRun => {
		// The dashboard's filters filled in (a condition on a filter with nothing picked is left out).
		const run = env.filters ? withFilters(def, env.filters, env.ctx.today) : def;
		return { result: runView(run, rows, env.ctx), def: run };
	};
	try {
		if (source.kind === "view") {
			if (!source.view) return { error: "Choose a view." };
			const base = env.view(source.view);
			if (!base) return { error: `There's no view called "${source.view}".` };
			return go(withColumns(base));
		}
		if (source.kind === "query") return go(withColumns(source.def));
		const { value } = evaluateDetached(source.formula, env.ctx, env.filterNames ?? []);
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
	/** all its notes (not just those shown), to open as a table */
	drill?: Drill;
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
export function evaluateDashboard(def: DashboardDef, env0: DashEnv): { cards: Map<string, CardOut>; lists: Map<string, ListOut>; charts: Map<string, ChartOut>; looks: Map<string, ComponentLook> } {
	const env = withFilterNames(def, env0);
	const filterNames = env.filterNames ?? [];
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
				// Other cards by title, and the dashboard's filters (`[Campaign]`); a card wins over a filter of the same name.
				const known = [...names.map((n) => n.name), ...filterNames.map((f) => f.name).filter((f) => !names.some((n) => n.name === f))];
				const refs = compile(c.value.formula, known.map((n) => ({ id: `name:${n}`, label: n, type: "any" }))).refs.filter((r) => r.startsWith("name:")).map((r) => r.slice(5));
				const used = refs.map((name) => {
					const other = cardList.find((x) => cardName(x) === name);
					if (!other) return { name, value: filterNames.find((f) => f.name === name)?.value ?? null };
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
			lists.set(c.id, { rows: r.result.rows.slice(0, c.limit), columns, total: r.result.rows.length, highlightCounts: r.result.highlightCounts, drill: drillOf(cardName(c) === c.id ? "List" : cardName(c), r.def, r.result.rows) });
		}
	}

	const charts = new Map<string, ChartOut>();
	for (const c of def.components) if (c.kind === "chart") charts.set(c.id, chartOf(c, env, run));

	// Each component's look: its style, with the first matching rule on top. A list's whole-list rules are its
	// `boxHighlight` (its `highlight` rules style its rows, and `matched` counts their notes).
	const looks = new Map<string, ComponentLook>();
	for (const c of def.components) {
		const { columns, cells } = valueColumns(def, cards, c);
		const rules = (c.kind === "list" ? c.boxHighlight : c.highlight) ?? [];
		const matched = rules.map((r) => (matchesValues(env.filters ? groupWithFilters(r.when, env.filters, env.ctx.today) : r.when, columns, cells, env.ctx) ? 1 : 0));
		const first = (target: string) => rules.find((r, i) => matched[i] && !r.off && r.target === target);
		const valueRule = c.kind === "card" ? first(VALUE_ID) : undefined;
		const boxRule = first(ROW_TARGET);
		const set = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== "")) as T;
		if (c.kind === "list") {
			looks.set(c.id, {
				box: { ...c.style, ...boxRule?.style },
				list: { ...DEFAULT_LIST_LAYOUT, ...set(c.layout), ...set(boxRule?.layout as ListLayout | undefined) },
				matched: lists.get(c.id)?.highlightCounts ?? [],
				boxMatched: matched,
			});
			continue;
		}
		const card =
			c.kind === "card"
				? (() => {
						const l = { ...DEFAULT_CARD_LAYOUT, ...set(c.layout), ...set(boxRule?.layout as CardLayout | undefined) };
						return { ...l, caption: l.caption ? fillCaption(l.caption, def, cards, c, env) : "" };
					})()
				: undefined;
		const button =
			c.kind === "button"
				? (() => {
						const l = { ...DEFAULT_BUTTON_LAYOUT, ...set(c.layout), ...set(boxRule?.layout as ButtonLayout | undefined) };
						const off = l.state === "disabled";
						return { ...l, description: l.description ? fillCaption(l.description, def, cards, c, env) : "", ...(off && boxRule?.name ? { why: boxRule.name } : {}) };
					})()
				: undefined;
		looks.set(c.id, { box: { ...c.style, ...boxRule?.style }, ...(valueRule ? { value: valueRule.style } : {}), ...(card ? { card } : {}), ...(button ? { button } : {}), matched });
	}
	return { cards, lists, charts, looks };
}

/**
 * A caption with `[Value]` (a card's own value), other cards' `[Title]`s replaced by their values as shown, and (with
 * `env`) filters' `[Title]`s by what's picked ("All" when nothing is).
 */
export function fillCaption(caption: string, def: DashboardDef, cards: Map<string, CardOut>, self: DashComponent, env?: DashEnv): string {
	return caption.replace(/\[([^\]]+)\]/g, (all, name: string) => {
		const key = name.trim().toLowerCase();
		const other = key === VALUE_ID ? self : def.components.find((x) => x.kind === "card" && cardName(x).toLowerCase() === key);
		if (!other) {
			const f = env && def.components.find((x) => x.kind === "filter" && cardName(x).toLowerCase() === key);
			return f ? filterText(env.filters?.[f.id], env.ctx) : all;
		}
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
	/** a button's layout, its description filled in; `why` it's disabled (the rule's name) */
	button?: Required<ButtonLayout> & { why?: string };
	/** a list's layout */
	list?: Required<ListLayout>;
	/** whether each of a list's whole-list rules applies now (its `matched` counts the notes each row rule matches) */
	boxMatched?: number[];
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
		if (!("error" in order)) series = (order.result.groups ?? []).filter((g) => !(c.hideEmpty && !g.label)).map((g) => ({ key: g.key, label: labelOf(split, g.label), color: colorOf(split, g.key) }));
	}
	const lastKey = (k: string) => k.split(GROUP_PATH_SEP).pop() ?? k;
	type Group = { key: string; label: string; empty: boolean; rows: ResultRow[]; value: number; color: PaletteColor | null; childRows: (s: string) => ResultRow[] };
	let groups: Group[] = (grouped.result.groups ?? []).map((g) => ({
		key: g.key,
		label: labelOf(by, g.label),
		empty: !g.label,
		rows: g.rows,
		value: measure(g.rows),
		color: colorOf(by, g.key),
		childRows: (s: string) => g.children?.find((x) => lastKey(x.key) === s)?.rows ?? [],
	}));
	let shownTotal = head;
	if (c.hideEmpty && groups.some((g) => g.empty)) {
		groups = groups.filter((g) => !g.empty);
		// The total is over the notes shown (a note in several groups counts once).
		const t = measure([...new Set(groups.flatMap((g) => g.rows))]);
		shownTotal = { ...head, total: t, totalText: fmt(t) };
	}
	if (c.sort === "desc") groups.sort((a, b) => b.value - a.value);
	else if (c.sort === "asc") groups.sort((a, b) => a.value - b.value);
	else if (c.sort === "az") groups.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
	// Top N: the biggest N stay (in the order above); the rest become one "Other".
	if (c.top && groups.length > c.top) {
		const keep = new Set([...groups].sort((a, b) => b.value - a.value).slice(0, c.top));
		const rest = groups.filter((g) => !keep.has(g));
		const rows = [...new Set(rest.flatMap((g) => g.rows))];
		groups = groups.filter((g) => keep.has(g));
		groups.push({ key: OTHER_KEY, label: `Other (${rest.length})`, empty: false, rows, value: measure(rows), color: "grey", childRows: (s) => [...new Set(rest.flatMap((g) => g.childRows(s)))] });
	}
	const bars: ChartBar[] = groups.map((g) => {
		const parts: ChartPart[] = split
			? series.map((s) => {
					const rows = g.childRows(s.key);
					const v = measure(rows);
					return { key: s.key, label: s.label, value: v, text: fmt(v), color: s.color, drill: drillOf(`${title} · ${g.label} · ${s.label}`, drillDef, rows) };
				})
			: [];
		return { key: g.key, label: g.label, value: g.value, text: fmt(g.value), color: g.color, drill: drillOf(`${title} · ${g.label}`, drillDef, g.rows), parts };
	});
	return { ...shownTotal, bars, series };
}

/** The key of the "Other" bar or slice that top N gathers the rest into. */
export const OTHER_KEY = "\u0000other";
