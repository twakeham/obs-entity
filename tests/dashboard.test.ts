import { describe, expect, it } from "vitest";
import { isoDateAdapter } from "../src/model/dates";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import { extractEdges } from "../src/model/relations";
import { evaluateDashboard, newComponent, parseDashboard, readingOrder, runSource, serializeDashboard, type DashEnv } from "../src/model/dashboard";
import { parseView, type ViewContext, type ViewRow } from "../src/model/views";

const TYPES = [...STARTER_PACK.types, ...CRM_PACK.types];
const GROUPS = [...STARTER_PACK.groups!, ...CRM_PACK.groups!];
const T = (key: string) => TYPES.find((t) => t.key === key)!;
const row = (name: string, type: string, status: string | null, fm: Record<string, unknown> = {}): ViewRow => ({
	path: `${name}.md`,
	name,
	type: T(type),
	status,
	subtitle: null,
	tags: [],
	aliases: [],
	folder: "",
	mtime: 0,
	order: null,
	frontmatter: { entity: type, status, ...fm },
});
const ROWS: ViewRow[] = [
	row("Apollo", "project", "active", { due: "2026-11-20" }),
	row("Lander", "project", "done", { due: "2026-12-01" }),
	row("Gemini", "project", "active", { due: "2027-02-01" }),
	row("Mercury", "project", "idea"),
	row("Acme", "organisation", "active"),
	row("Deal one", "deal", "open", { company: "[[Acme]]", value: 100 }),
	row("Deal two", "deal", "won", { company: "[[Acme]]", value: 50 }),
];
const byName = new Map(ROWS.map((r) => [r.name, r]));
const byPath = new Map(ROWS.map((r) => [r.path, r]));
const resolve = (p: string) => (byName.has(p) ? `${p}.md` : null);
const EDGES = ROWS.flatMap((r) => extractEdges(r.path, r.type, r.frontmatter, resolve));
const ctx: ViewContext = {
	types: TYPES,
	groups: GROUPS,
	dates: isoDateAdapter,
	today: (isoDateAdapter.parse("2026-11-13") as { value: number }).value,
	resolve: (p) => resolve(p),
	row: (p) => byPath.get(p),
	all: () => ROWS,
	incoming: (p) => EDGES.filter((e) => e.target === p).map((e) => ({ source: e.source, sourceType: e.sourceType, fieldKey: e.fieldKey })),
};
const ACTIVE_PROJECTS = parseView({ types: ["project"], filters: { all: [{ field: "status", op: "any-of", value: ["active"] }] }, sort: [{ by: "due", dir: "asc" }] }).def!;
const env: DashEnv = { ctx, rows: ROWS, view: (name) => (name === "Active projects" ? ACTIVE_PROJECTS : null) };

const RAW = {
	kind: "dashboard",
	place: "views",
	components: [
		{ id: "all", kind: "card", title: "All projects", at: [0, 0, 3, 2], source: { types: ["project"] }, value: { agg: "count" } },
		{ id: "done", kind: "card", title: "Done projects", at: [3, 0, 3, 2], source: { types: ["project"], filters: { all: [{ field: "status", op: "any-of", value: ["done"] }] } }, value: { agg: "count" } },
		{ id: "share", kind: "card", title: "Done share", at: [6, 0, 3, 2], value: { formula: "[Done projects] / [All projects] * 100" }, format: "percent" },
		{ id: "won", kind: "card", title: "Deal value", at: [9, 0, 3, 2], source: { formula: 'notes("deal")' }, value: { agg: "sum", column: "value" }, format: "currency:USD" },
		{ id: "soon", kind: "list", title: "Active", at: [0, 2, 6, 4], source: { view: "Active projects" }, fields: ["status", "due"], limit: 1 },
		{ id: "v", kind: "view", at: [6, 2, 6, 6], view: "Active projects" },
		{ id: "t", kind: "text", at: [0, 6, 6, 2], text: "## Hello" },
		{ id: "b", kind: "button", at: [0, 8, 2, 1], label: "New project", icon: "plus", action: { new: "project" } },
	],
};

describe("dashboards", () => {
	it("read and write every component, keeping the browser place", () => {
		const { def, errors } = parseDashboard(RAW);
		expect(errors).toEqual([]);
		expect(def.components.map((c) => c.kind)).toEqual(["card", "card", "card", "card", "list", "view", "text", "button"]);
		expect(def.place).toBe("views");
		const out = serializeDashboard(def);
		expect(out).toEqual({ ...RAW, components: RAW.components.map((c) => (c.kind === "card" && c.source && "types" in c.source ? { ...c, source: { types: c.source.types, ...("filters" in c.source ? { filters: c.source.filters } : {}) } } : c)) });
		expect(parseDashboard(out).def).toEqual(def);
	});

	it("report problems, fix sizes and give every component an id", () => {
		const { def, errors } = parseDashboard({ kind: "dashboard", components: [{ kind: "gauge" }, "x", { kind: "card", at: [11, 0, 5, 0] }, { kind: "card", id: "card3" }] });
		expect(errors).toEqual(['Component 1: unknown kind "gauge". Use card, chart, list, view, text, button.', "Component 2 should be a set of keys like kind:, at:."]);
		expect(def.components.map((c) => [c.id, c.at])).toEqual([
			["card3", { x: 7, y: 0, w: 5, h: 1 }],
			["card3_2", { x: 0, y: 0, w: 3, h: 2 }],
		]);
	});

	it("work out cards: counts, sums from a formula source, and formulas over other cards", () => {
		const { cards } = evaluateDashboard(parseDashboard(RAW).def, env);
		expect(cards.get("all")).toMatchObject({ text: "4", value: 4, count: 4 });
		expect(cards.get("done")).toMatchObject({ text: "1", value: 1 });
		expect(cards.get("share")).toMatchObject({ text: "25%", value: 25 });
		expect(cards.get("won")).toMatchObject({ value: 150, label: "Sum of Value" });
		expect(cards.get("won")!.text).toMatch(/150\.00/);
	});

	it("show problems on cards: cycles, unknown cards and views, wrong aggregations", () => {
		const def = parseDashboard({
			kind: "dashboard",
			components: [
				{ id: "a", kind: "card", title: "A", value: { formula: "[B] + 1" } },
				{ id: "b", kind: "card", title: "B", value: { formula: "[A] + 1" } },
				{ id: "c", kind: "card", value: { formula: "[Nope] + 1" } },
				{ id: "d", kind: "card", source: { view: "Gone" }, value: { agg: "count" } },
				{ id: "e", kind: "card", source: { types: ["project"] }, value: { agg: "sum", column: "status" } },
				{ id: "f", kind: "card", value: { agg: "count" } },
			],
		}).def;
		const { cards } = evaluateDashboard(def, env);
		expect(cards.get("a")!.error).toBe("Circular reference: A → B → A.");
		expect(cards.get("b")!.error).toBe("Circular reference: A → B → A.");
		expect(cards.get("c")!.error).toBe("Unknown column [Nope].");
		expect(cards.get("d")!.error).toBe('There\'s no view called "Gone".');
		expect(cards.get("e")!.error).toBe('"sum" doesn\'t apply to Status.');
		expect(cards.get("f")!.error).toBe("Choose where its notes come from.");
	});

	it("list a source's notes, sorted and limited, with their fields", () => {
		const { lists } = evaluateDashboard(parseDashboard(RAW).def, env);
		const l = lists.get("soon")!;
		expect(l.rows.map((r) => r.row.name)).toEqual(["Apollo"]);
		expect(l.total).toBe(2);
		expect(l.columns.map((c) => c.label)).toEqual(["Status", "Due"]);
	});

	it("run formula sources, and say when they don't give notes", () => {
		const names = (formula: string) => {
			const r = runSource({ kind: "formula", formula }, [], [], env);
			return "error" in r ? r.error : r.result.rows.map((x) => x.row.name);
		};
		expect(names('filter(notes("project"), prop(item, "status") = "active")')).toEqual(["Apollo", "Gemini"]);
		expect(names("1 + 1")).toBe('The formula should give notes, e.g. filter(notes("quest"), prop(item, "Status") = "active").');
	});

	it("add components at the bottom with fresh ids, and stack in reading order", () => {
		const def = parseDashboard(RAW).def;
		const c = newComponent("card", def);
		expect(c.id).toBe("card9");
		expect(c.at).toEqual({ x: 0, y: 9, w: 3, h: 2 });
		expect(readingOrder(def.components).map((x) => x.id)).toEqual(["all", "done", "share", "won", "soon", "v", "t", "b"]);
	});
});

describe("dashboard charts", () => {
	const DONE = { all: [{ field: "status", op: "any-of", value: ["done"] }] };
	const charts = (components: Record<string, unknown>[]) => {
		const { def, errors } = parseDashboard({ kind: "dashboard", components });
		expect(errors).toEqual([]);
		return evaluateDashboard(def, env).charts;
	};
	const bars = (out: ReturnType<typeof charts> extends Map<string, infer V> ? V : never) => out.bars.map((b) => [b.label, b.value, b.color]);

	it("count notes per group, in the field's order, coloured like their status", () => {
		const out = charts([{ id: "c", kind: "chart", chart: "bar", source: { types: ["project"] }, by: "status" }]).get("c")!;
		expect(bars(out)).toEqual([
			["idea", 1, null],
			["active", 2, "blue"],
			["done", 1, "green"],
		]);
		expect(out.total).toBe(4);
		expect(out.bars[1].drill.paths).toEqual(["Apollo.md", "Gemini.md"]);
		expect(out.bars[1].drill.title).toBe("Bar · active");
	});

	it("sum or average a number field per group", () => {
		const sum = charts([{ id: "c", kind: "chart", chart: "hbar", title: "Deals", source: { types: ["deal"] }, by: "status", measure: { agg: "sum", column: "value" } }]).get("c")!;
		expect(sum.bars.map((b) => [b.label, b.value])).toEqual([
			["open", 100],
			["won", 50],
		]);
		expect(sum.measureLabel).toBe("Sum of Value");
		const avg = charts([{ id: "c", kind: "chart", chart: "donut", source: { types: ["deal"] }, by: "type", measure: { agg: "avg", column: "value" } }]).get("c")!;
		expect(avg.bars.map((b) => b.value)).toEqual([75]);
	});

	it("split stacked bars by a second field, with the split values in their order", () => {
		const out = charts([{ id: "c", kind: "chart", chart: "stacked", source: { types: ["project"] }, by: "type", split: "status" }]).get("c")!;
		expect(out.series.map((s) => s.label)).toEqual(["idea", "active", "done"]);
		expect(out.bars[0].parts.map((p) => [p.label, p.value, p.drill.paths.length])).toEqual([
			["idea", 1, 1],
			["active", 2, 2],
			["done", 1, 1],
		]);
	});

	it("put dates in steps over time, filling the gaps", () => {
		const month = charts([{ id: "c", kind: "chart", chart: "line", source: { types: ["project"] }, by: "due" }]).get("c")!;
		expect(bars(month).map((b) => [b[0], b[1]])).toEqual([
			["Nov 2026", 1],
			["Dec 2026", 1],
			["Jan 2027", 0],
			["Feb 2027", 1],
		]);
		const year = charts([{ id: "c", kind: "chart", chart: "line", source: { types: ["project"] }, by: "due", every: "year" }]).get("c")!;
		expect(year.bars.map((b) => [b.label, b.value])).toEqual([
			["2026", 2],
			["2027", 1],
		]);
		const week = charts([{ id: "c", kind: "chart", chart: "line", source: { types: ["project"] }, by: "due", every: "week" }]).get("c")!;
		expect(week.bars[0].label).toBe("16 Nov");
		expect(week.bars.length).toBe(12);
	});

	it("show progress: the done notes against all of them", () => {
		const out = charts([{ id: "c", kind: "chart", chart: "progress", source: { types: ["project"] }, done: DONE }]).get("c")!;
		expect(out.progress).toMatchObject({ done: 1, share: 0.25 });
		expect(out.progress!.drill.paths).toEqual(["Lander.md"]);
		expect(out.total).toBe(4);
	});

	it("explain what's missing or wrong", () => {
		const err = (c: Record<string, unknown>) => charts([{ id: "c", kind: "chart", source: { types: ["project"] }, ...c }]).get("c")!.error;
		expect(err({ chart: "bar" })).toBe("Choose a field to group by.");
		expect(err({ chart: "line", by: "status" })).toBe("A line chart needs a date field; Status isn't one.");
		expect(err({ chart: "bar", by: "status", measure: { agg: "sum", column: "status" } })).toBe("Sum needs a number field; Status isn't one.");
		expect(err({ chart: "progress" })).toBe("Set when a note counts as done.");
		expect(err({ chart: "stacked", by: "status" })).toBe("Choose a field to split each bar by.");
	});

	it("round-trip charts and card rules", () => {
		const raw = {
			kind: "dashboard",
			components: [
				{ id: "c", kind: "chart", at: [0, 0, 6, 5], chart: "stacked", source: { types: ["project"] }, by: "type", split: "status", measure: { agg: "sum", column: "budget" }, format: "currency" },
				{ id: "p", kind: "chart", at: [6, 0, 6, 5], chart: "progress", source: { types: ["project"] }, done: DONE },
				{ id: "l", kind: "chart", at: [0, 5, 6, 5], chart: "line", source: { types: ["project"] }, by: "due", every: "week" },
				{ id: "k", kind: "card", at: [6, 5, 3, 2], source: { types: ["project"] }, value: { agg: "count" }, rules: [{ op: "<", value: 3, color: "red", on: "card", icon: "flame" }, { op: ">=", value: 3, color: "green" }] },
			],
		};
		const { def, errors } = parseDashboard(raw);
		expect(errors).toEqual([]);
		expect(serializeDashboard(def)).toEqual(raw);
		expect(parseDashboard({ kind: "dashboard", components: [{ kind: "card", rules: [{ op: "~", value: 1 }] }] }).errors).toEqual(['Component 1: a colour rule needs op (< <= > >= = !=) and a number value: {"op":"~","value":1}.']);
	});
});

describe("dashboard cards: colour rules and the notes behind them", () => {
	it("pick the first matching rule, comparing percentages as shown", () => {
		const { def } = parseDashboard({
			kind: "dashboard",
			components: [
				{ id: "n", kind: "card", source: { types: ["project"] }, value: { agg: "count" }, rules: [{ op: "<", value: 3, color: "red" }, { op: ">=", value: 3, color: "green", on: "card" }] },
				{ id: "pct", kind: "card", source: { types: ["project"] }, value: { agg: "percent:active", column: "status" }, rules: [{ op: ">=", value: 50, color: "blue" }] },
				{ id: "f", kind: "card", value: { formula: "2 + 2" }, rules: [{ op: "=", value: 4, icon: "star", on: "value" }] },
			],
		});
		const { cards } = evaluateDashboard(def, env);
		expect(cards.get("n")!.rule).toMatchObject({ color: "green", on: "card" });
		expect(cards.get("pct")!.num).toBe(50);
		expect(cards.get("pct")!.rule).toMatchObject({ color: "blue" });
		expect(cards.get("f")!.rule).toMatchObject({ icon: "star" });
		expect(cards.get("n")!.drill!.paths).toEqual(["Apollo.md", "Gemini.md", "Lander.md", "Mercury.md"]);
		expect(cards.get("f")!.drill).toBeUndefined();
	});

	it("open exactly the notes behind a formula source (only, in runView)", () => {
		const r = runSource({ kind: "formula", formula: 'filter(notes("project"), prop(item, "status") = "active")' }, [], [], env);
		expect("def" in r && r.def.only).toEqual(["Apollo.md", "Gemini.md"]);
		expect("result" in r && r.result.rows.map((x) => x.row.name)).toEqual(["Apollo", "Gemini"]);
	});
});