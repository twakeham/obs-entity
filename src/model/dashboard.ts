import { compile, DateVal, FormulaError, isLink, toText, type FValue } from "./formula";
import { formatNumber, formatDate, RELATIVE, type MomentLike } from "./formats";
import { summarize } from "./summary";
import {
	emptyView,
	evaluateDetached,
	NAME_COLUMN,
	parseView,
	runView,
	serializeView,
	type ColumnDef,
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

export type ComponentKind = "card" | "list" | "view" | "text" | "button";
export const COMPONENT_KINDS: ComponentKind[] = ["card", "list", "view", "text", "button"];
export const COMPONENT_LABELS: Record<ComponentKind, string> = { card: "Summary card", list: "List", view: "View", text: "Text", button: "Button" };
export const COMPONENT_ICONS: Record<ComponentKind, string> = { card: "hash", list: "list", view: "table", text: "type", button: "mouse-pointer-click" };
/** a new component's size (grid cells) */
export const DEFAULT_SIZE: Record<ComponentKind, { w: number; h: number }> = { card: { w: 3, h: 2 }, list: { w: 4, h: 5 }, view: { w: 6, h: 8 }, text: { w: 4, h: 2 }, button: { w: 2, h: 1 } };

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
}
export type DashComponent =
	| (Base & { kind: "card"; source?: DashSource; value: CardValue; format?: string })
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
		const base = { id, at, ...(title ? { title } : {}) };
		const where = title || `Component ${i + 1}`;
		const source = parseSource(c.source, errors, where);
		switch (kind) {
			case "card": {
				const v = isObj(c.value) ? c.value : {};
				const value: CardValue = str(v.formula) ? { formula: str(v.formula) } : { agg: str(v.agg) || "count", ...(v.column !== undefined ? { column: parseOneColumn(v.column, errors, where) ?? undefined } : {}) };
				if ("column" in value && !value.column) delete value.column;
				def.components.push({ ...base, kind, ...(source ? { source } : {}), value, ...(str(c.format) ? { format: str(c.format) } : {}) });
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
		switch (c.kind) {
			case "card":
				if (c.source) out.source = sourceOut(c.source);
				out.value = "formula" in c.value ? { formula: c.value.formula } : { agg: c.value.agg, ...(c.value.column ? { column: columnOut(c.value.column) } : {}) };
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

export type SourceRun = { result: ViewResult } | { error: string };

/**
 * Run a source: its notes, with `extra` columns worked out (a card's value column, a list's fields) and sorted by
 * `sort` (else the source's own sort).
 */
export function runSource(source: DashSource | undefined, extra: ColumnDef[], sort: SortLevel[], env: DashEnv): SourceRun {
	if (!source) return { error: "Choose where its notes come from." };
	const withColumns = (base: ViewDef): ViewDef => {
		const columns = [...base.columns];
		for (const c of extra) if (!columns.some((x) => x.id === c.id)) columns.push(c);
		return { ...base, kind: "table", group: [], columns, sort: sort.length ? sort : base.sort };
	};
	try {
		if (source.kind === "view") {
			if (!source.view) return { error: "Choose a view." };
			const base = env.view(source.view);
			if (!base) return { error: `There's no view called "${source.view}".` };
			return { result: runView(withColumns(base), env.rows, env.ctx) };
		}
		if (source.kind === "query") return { result: runView(withColumns(source.def), env.rows, env.ctx) };
		const { value } = evaluateDetached(source.formula, env.ctx);
		const list = Array.isArray(value) ? value : value === null ? [] : [value];
		if (!list.every(isLink)) return { error: 'The formula should give notes, e.g. filter(notes("quest"), prop(item, "Status") = "active").' };
		const paths = new Set(list.map((l) => (isLink(l) ? l.path : null)).filter((p): p is string => !!p));
		return { result: runView(withColumns(emptyView()), env.rows.filter((r) => paths.has(r.path)), env.ctx) };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

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
}

class CycleError extends Error {}

export interface ListOut {
	rows: ResultRow[];
	columns: ResolvedColumn[];
	/** how many notes match, before the limit */
	total: number;
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

/** Every card's value and every list's notes, in one pass (sources shared by several components run once). */
export function evaluateDashboard(def: DashboardDef, env: DashEnv): { cards: Map<string, CardOut>; lists: Map<string, ListOut> } {
	const runs = new Map<string, SourceRun>();
	const run = (source: DashSource | undefined, extra: ColumnDef[], sort: SortLevel[]) => {
		const key = JSON.stringify([source ?? null, extra, sort]);
		let r = runs.get(key);
		if (!r) runs.set(key, (r = runSource(source, extra, sort, env)));
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
				out = { text: formatValue(value, c.format, env.ctx), value };
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
					out = { text: s.text, value, label: `${s.label}${column.id === "name" ? " of notes" : ` of ${col.label}`}`, count: r.result.rows.length };
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
		const r = run(c.source, c.fields, c.sort);
		if ("error" in r) lists.set(c.id, { rows: [], columns: [], total: 0, error: r.error });
		else {
			const columns = c.fields.map((f) => r.result.known.get(f.id) ?? r.result.columns.find((x) => x.id === f.id)).filter((x): x is ResolvedColumn => !!x);
			lists.set(c.id, { rows: r.result.rows.slice(0, c.limit), columns, total: r.result.rows.length });
		}
	}
	return { cards, lists };
}
