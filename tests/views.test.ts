import { describe, expect, it } from "vitest";
import moment from "moment";
import { isoDateAdapter } from "../src/model/dates";
import type { MomentLike } from "../src/model/formats";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import { extractEdges } from "../src/model/relations";
import {
	availableColumns,
	columnFromId,
	cycleSort,
	dateValue,
	fillWidths,
	highlightOf,
	parseView,
	prefillFromFilters,
	resolveColumn,
	rollupSources,
	runView,
	serializeView,
	unknownSources,
	type ViewContext,
	type ViewDef,
	type ViewRow,
} from "../src/model/views";

const TYPES = [...STARTER_PACK.types, ...CRM_PACK.types];
const GROUPS = [...STARTER_PACK.groups!, ...CRM_PACK.groups!];
const T = (key: string) => TYPES.find((t) => t.key === key)!;

const row = (name: string, type: string, status: string | null, fm: Record<string, unknown> = {}, extra: Partial<ViewRow> = {}): ViewRow => ({
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
	...extra,
});

const ROWS: ViewRow[] = [
	row("Ada", "person", "active", { works_for: "[[Acme]]", birthday: "1815-12-10" }, { tags: ["vip"], aliases: ["Countess"] }),
	row("Grace", "person", "draft", { works_for: "[[Globex]]" }),
	row("Acme", "organisation", "active", { kind: "Company" }),
	row("Globex", "organisation", "draft", { kind: "Non-profit" }),
	row("Apollo", "project", "idea", { owner: "[[Ada]]", team: ["[[Ada]]", "[[Grace]]"], due: "2027-03-31" }, { folder: "Work/Apollo" }),
	row("Lander", "project", "done", { parent_project: "[[Apollo]]", due: "2026-12-01", owner: "[[Grace]]" }, { folder: "Work/Apollo/Lander" }),
	row("Project 10", "project", "active", { due: "" }, { folder: "Work" }),
	row("Project 2", "project", "on-hold", {}, { folder: "Work" }),
	row("Kickoff", "note", null, { project: "[[Apollo]]" }),
	row("Review", "note", null, { project: "[[Apollo]]", noted_on: "2026-01-05" }),
	row("Deal one", "deal", "open", { company: "[[Acme]]", value: 100 }),
	row("Deal two", "deal", "won", { company: "[[Acme]]", value: 50, close_date: "2026-06-30" }),
];
const byName = new Map(ROWS.map((r) => [r.name, r]));
const byPath = new Map(ROWS.map((r) => [r.path, r]));
const resolve = (p: string) => (byName.has(p) ? `${p}.md` : null);
const EDGES = ROWS.flatMap((r) => extractEdges(r.path, r.type, r.frontmatter, resolve));
const ctx: ViewContext = {
	types: TYPES,
	groups: GROUPS,
	dates: isoDateAdapter,
	today: isoDateAdapter.parse("2026-11-01")!.ok ? (isoDateAdapter.parse("2026-11-01") as { value: number }).value : 0,
	resolve: (p) => resolve(p),
	row: (p) => byPath.get(p),
	incoming: (p) => EDGES.filter((e) => e.target === p).map((e) => ({ source: e.source, sourceType: e.sourceType, fieldKey: e.fieldKey })),
};
const view = (raw: Record<string, unknown>): ViewDef => {
	const { def, errors } = parseView(raw);
	expect(errors).toEqual([]);
	return def!;
};
const names = (raw: Record<string, unknown>, search = "") => runView(view(raw), ROWS, ctx, search).rows.map((r) => r.row.name);
const texts = (raw: Record<string, unknown>, id: string) => runView(view(raw), ROWS, ctx).rows.map((r) => `${r.row.name}=${r.cells[id]?.text ?? ""}`);

describe("parse and serialize", () => {
	it("reads every column form, puts name first and round-trips", () => {
		const raw = {
			kind: "table",
			types: ["project"],
			columns: ["status", "name", "owner", { field: "due", label: "Deadline" }, "in:note.project", { rollup: { via: "in:note.project", agg: "count" }, label: "Notes", id: "notes" }, { formula: "1+1", label: "Two" }],
			widths: { owner: 160, gone: 50 },
			sort: [{ by: "due", dir: "desc" }, "name"],
			group: { by: "due", date: "month" },
			filters: { all: [{ field: "status", op: "none-of", value: ["done"] }, { any: [{ field: "owner", op: "empty" }, { field: "team", op: "count>", value: 1 }] }] },
		};
		const def = view(raw);
		expect(def.columns.map((c) => `${c.kind}:${c.id}`)).toEqual(["builtin:name", "builtin:status", "field:owner", "field:due", "incoming:in:note.project", "rollup:notes", "formula:two"]);
		const out = serializeView(def);
		expect(out.columns).toEqual(["name", "status", "owner", { field: "due", label: "Deadline" }, "in:note.project", { rollup: { via: "in:note.project", agg: "count" }, label: "Notes", id: "notes" }, { formula: "1+1", label: "Two", id: "two" }]);
		expect(out.widths).toEqual({ owner: 160 });
		expect(out.sort).toEqual([{ by: "due", dir: "desc" }, { by: "name", dir: "asc" }]);
		expect(view(out)).toEqual({ ...def, widths: { owner: 160 } });
	});

	it("gives field keys that clash with built-ins their own ids", () => {
		const def = view({ columns: ["type", { field: "type" }, "f:folder"] });
		expect(def.columns.map((c) => `${c.kind}:${c.id}`)).toEqual(["builtin:name", "builtin:type", "field:f:type", "field:f:folder"]);
		expect(serializeView(def).columns).toEqual(["name", "type", { field: "type" }, { field: "folder" }]);
	});

	it("reports bad pieces and rejects unknown kinds", () => {
		expect(parseView({ kind: "board" }).def).toBeNull();
		const { def, errors } = parseView({ columns: [{ rollup: { via: "nope", agg: "count" } }, { rollup: { via: "field:team", agg: "sum" } }, 7], filters: { all: [{ any: [{ any: [] }] }, { op: "x" }] } });
		expect(def?.columns.map((c) => c.id)).toEqual(["name"]);
		expect(errors).toEqual([
			'Roll-up "via" should be "field:<key>" or "in:<type>.<field>" (got "nope").',
			'Roll-up "sum" needs a field.',
			"A column isn't a name or an object: 7.",
			"Filter groups can only be nested one level.",
			'A filter condition needs "field" and "op": {"op":"x"}.',
		]);
		expect(parseView(null).def?.types).toEqual(["*"]);
		expect(unknownSources(view({ types: ["project", "@work", "@nope", "ghost"] }), TYPES, GROUPS)).toEqual(["@nope", "ghost"]);
	});
});

describe("columns", () => {
	it("offers source fields, built-ins and incoming relations", () => {
		const cols = availableColumns(view({ types: ["organisation"] }), ctx);
		expect(cols.fields.map((c) => c.id)).toEqual(["kind", "website", "located_in", "part_of"]);
		expect(cols.incoming.map((c) => c.id)).toEqual(["in:person.works_for", "in:organisation.part_of", "in:project.client"]);
		expect(resolveColumn(columnFromId("in:person.works_for"), view({ types: ["organisation"] }), ctx)).toMatchObject({ label: "People", kind: "links", editable: false });
		expect(resolveColumn(columnFromId("ghost"), view({ types: ["organisation"] }), ctx).invalid).toBe('No source type has a "ghost" field.');
		expect(rollupSources(view({ types: ["project"] }), ctx).map((s) => s.via)).toContain("in:note.project");
	});

	it("computes field, built-in, incoming and roll-up values", () => {
		expect(texts({ types: ["organisation"], columns: ["in:person.works_for", { rollup: { via: "in:deal.company", agg: "sum", field: "value" }, id: "total" }] }, "total")).toEqual(["Acme=150", "Globex="]);
		expect(texts({ types: ["organisation"], columns: ["in:person.works_for"] }, "in:person.works_for")).toEqual(["Acme=Ada", "Globex=Grace"]);
		const r = { types: ["project"], filters: { all: [{ field: "name", op: "is", value: "Apollo" }] } };
		const roll = (agg: string, field?: string) => texts({ ...r, columns: [{ rollup: { via: agg.startsWith("in") ? "in:note.project" : "field:team", agg: agg.replace(/^in-/, ""), ...(field ? { field } : {}) }, id: "x" }] }, "x")[0];
		expect(roll("in-count")).toBe("Apollo=2");
		expect(roll("in-list")).toBe("Apollo=Kickoff, Review");
		expect(roll("in-latest", "noted_on")).toBe("Apollo=2026-01-05");
		expect(roll("count")).toBe("Apollo=2");
		expect(roll("unique", "works_for")).toBe("Apollo=Acme, Globex");
		expect(roll("percent-done")).toBe("Apollo=0%");
		expect(roll("count-by-status")).toBe("Apollo=1 draft · 1 active");
		expect(texts({ types: ["project"], columns: [{ rollup: { via: "in:project.parent_project", agg: "percent-done" }, id: "p" }] }, "p")[0]).toBe("Apollo=100%");
	});
});

describe("filters", () => {
	const P = { types: ["project"] };
	it("text, choice, number, date (incl. relative) and folder", () => {
		expect(names({ ...P, filters: { all: [{ field: "name", op: "starts-with", value: "proj" }] } })).toEqual(["Project 2", "Project 10"]);
		expect(names({ ...P, filters: { all: [{ field: "status", op: "none-of", value: ["done", "idea"] }] } })).toEqual(["Project 2", "Project 10"]);
		expect(names({ ...P, filters: { all: [{ field: "due", op: "before", value: "2027-01-01" }] } })).toEqual(["Lander"]);
		expect(names({ ...P, filters: { all: [{ field: "due", op: "on-or-before", value: "+5m" }] } })).toEqual(["Apollo", "Lander"]);
		expect(names({ ...P, filters: { all: [{ field: "due", op: "between", value: ["today", "+2m"] }] } })).toEqual(["Lander"]);
		expect(names({ ...P, filters: { all: [{ field: "due", op: "empty" }] } })).toEqual(["Project 2", "Project 10"]);
		expect(names({ ...P, filters: { all: [{ field: "folder", op: "in-folder", value: "Work/Apollo" }] } })).toEqual(["Apollo", "Lander"]);
		expect(names({ types: ["deal"], filters: { all: [{ field: "value", op: ">=", value: 60 }] } })).toEqual(["Deal one"]);
	});

	it("links, counts, lists, nested any-groups and ignored conditions", () => {
		expect(names({ ...P, filters: { all: [{ field: "team", op: "links-any", value: ["Grace.md"] }] } })).toEqual(["Apollo"]);
		expect(names({ ...P, filters: { all: [{ field: "team", op: "count>", value: 1 }] } })).toEqual(["Apollo"]);
		expect(names({ ...P, filters: { all: [{ field: "owner", op: "links-none", value: ["Ada"] }, { field: "owner", op: "not-empty" }] } })).toEqual(["Lander"]);
		expect(names({ types: ["person"], filters: { all: [{ field: "tags", op: "has-any", value: ["VIP"] }] } })).toEqual(["Ada"]);
		expect(names({ ...P, filters: { all: [{ field: "status", op: "any-of", value: ["active", "idea", "done"] }, { any: [{ field: "owner", op: "links-any", value: ["Grace.md"] }, { field: "name", op: "contains", value: "10" }] }] } })).toEqual(["Lander", "Project 10"]);
		// unknown column and wrong operator are ignored
		expect(names({ ...P, filters: { all: [{ field: "ghost", op: "is", value: "x" }, { field: "due", op: "contains", value: "x" }] } })).toHaveLength(4);
		expect(names({ types: ["person"] }, "countess")).toEqual(["Ada"]);
	});

	it("relative dates", () => {
		expect(dateValue("today", ctx)).toBe(ctx.today);
		expect(dateValue("-1w", ctx)).toBe(ctx.today - 7);
		expect(isoDateAdapter.format(dateValue("+3m", ctx)!, "short")).toBe("2027-02-01");
		expect(isoDateAdapter.format(dateValue("-1y", ctx)!, "short")).toBe("2025-11-01");
		expect(dateValue("2026-02-30", ctx)).toBeNull();
	});
});

describe("sorting and grouping", () => {
	it("sorts naturally, by status order, by dates with empties last, and by several levels", () => {
		expect(names({ types: ["project"] })).toEqual(["Apollo", "Lander", "Project 2", "Project 10"]);
		expect(names({ types: ["project"], sort: [{ by: "status", dir: "asc" }] })).toEqual(["Apollo", "Project 10", "Project 2", "Lander"]);
		expect(names({ types: ["project"], sort: [{ by: "due", dir: "desc" }] })).toEqual(["Apollo", "Lander", "Project 2", "Project 10"]);
		expect(names({ types: ["project"], sort: [{ by: "due", dir: "asc" }] })).toEqual(["Lander", "Apollo", "Project 2", "Project 10"]);
		expect(names({ types: ["person", "organisation"], sort: [{ by: "type", dir: "desc" }, { by: "name", dir: "desc" }] })).toEqual(["Grace", "Ada", "Globex", "Acme"]);
	});

	it("cycles header sorting with and without shift", () => {
		expect(cycleSort([], "due", false)).toEqual([{ by: "due", dir: "asc" }]);
		expect(cycleSort([{ by: "due", dir: "asc" }], "due", false)).toEqual([{ by: "due", dir: "desc" }]);
		expect(cycleSort([{ by: "due", dir: "desc" }], "due", false)).toEqual([]);
		expect(cycleSort([{ by: "due", dir: "asc" }], "name", false)).toEqual([{ by: "name", dir: "asc" }]);
		expect(cycleSort([{ by: "due", dir: "asc" }], "name", true)).toEqual([{ by: "due", dir: "asc" }, { by: "name", dir: "asc" }]);
		expect(cycleSort([{ by: "due", dir: "asc" }, { by: "name", dir: "asc" }], "due", true)).toEqual([{ by: "due", dir: "desc" }, { by: "name", dir: "asc" }]);
	});

	it("groups by status in status order, by month, and by list values", () => {
		const g = (raw: Record<string, unknown>) => runView(view(raw), ROWS, ctx).groups!.map((x) => `${x.label || "(none)"}: ${x.rows.map((r) => r.row.name).join(",")}`);
		expect(g({ types: ["project"], group: { by: "status" } })).toEqual(["idea: Apollo", "active: Project 10", "on-hold: Project 2", "done: Lander"]);
		expect(g({ types: ["project"], group: { by: "due", date: "month" } })).toEqual(["December 2026: Lander", "March 2027: Apollo", "(none): Project 2,Project 10"]);
		expect(g({ types: ["project"], group: { by: "team" } })).toEqual(["Ada: Apollo", "Grace: Apollo", "(none): Lander,Project 2,Project 10"]);
	});
});

describe("formats", () => {
	const fctx = { ...ctx, moment: moment as unknown as MomentLike, locale: "en-AU", currency: "AUD" };
	it("round-trip through the block and drop formats of removed columns", () => {
		const def = view({ types: ["deal"], columns: ["value", "close_date"], formats: { value: "currency", close_date: "D MMM YYYY", gone: "x", bad: 3 } });
		expect(def.formats).toEqual({ value: "currency", close_date: "D MMM YYYY", gone: "x" });
		expect(serializeView(def).formats).toEqual({ value: "currency", close_date: "D MMM YYYY" });
		expect(serializeView(view({ types: ["deal"] })).formats).toBeUndefined();
	});

	it("change the text, not the value, sorting or filtering", () => {
		const raw = { types: ["deal"], columns: ["value", "close_date"], formats: { value: "$#,##0.00", close_date: "ddd D MMM YYYY" }, sort: [{ by: "value", dir: "asc" }], filters: { all: [{ field: "value", op: ">", value: 60 }] } };
		const r = runView(view(raw), ROWS, fctx);
		expect(r.rows.map((x) => [x.row.name, x.cells.value.text, x.cells.value.value])).toEqual([["Deal one", "$100.00", 100]]);
		const all = runView(view({ ...raw, filters: undefined }), ROWS, fctx).rows;
		expect(all.map((x) => `${x.cells.value.text}|${x.cells.close_date.text}`)).toEqual(["$50.00|Tue 30 Jun 2026", "$100.00|"]);
	});

	it("label date groups, and work without moment for relative dates", () => {
		const g = runView(view({ types: ["project"], group: { by: "due" }, formats: { due: "MMMM YYYY" }, columns: ["due"] }), ROWS, fctx).groups!.map((x) => x.label);
		expect(g).toEqual(["December 2026", "March 2027", ""]);
		const rel = runView(view({ types: ["project"], columns: ["due"], formats: { due: "relative" }, sort: [{ by: "due", dir: "asc" }] }), ROWS, ctx).rows.map((x) => x.cells.due.text);
		expect(rel.slice(0, 2)).toEqual(["in 4 weeks", "in 5 months"]);
	});
});

describe("fill columns", () => {
	it("round-trip as a name or a list, dropping removed columns", () => {
		expect(view({ columns: ["status", "due"], fill: "due" }).fill).toEqual(["due"]);
		expect(serializeView(view({ columns: ["status", "due"], fill: "due" })).fill).toBe("due");
		expect(serializeView(view({ columns: ["status", "due"], fill: ["status", "due", "status", "gone", 3] })).fill).toEqual(["status", "due"]);
		expect(serializeView(view({ columns: ["status"] })).fill).toBeUndefined();
	});

	it("share spare width in proportion, never below their own width", () => {
		const cols = [
			{ id: "name", w: 200 },
			{ id: "a", w: 100 },
			{ id: "b", w: 300 },
		];
		expect(fillWidths(cols, [], 1000)).toEqual({ name: 200, a: 100, b: 300 });
		expect(fillWidths(cols, ["b"], 1000, 36)).toEqual({ name: 200, a: 100, b: 664 });
		const two = fillWidths(cols, ["a", "b"], 1001.6);
		expect(two).toEqual({ name: 200, a: 200, b: 601 });
		expect(Object.values(two).reduce((n, w) => n + w, 0)).toBe(1001);
		expect(fillWidths(cols, ["b"], 500)).toEqual({ name: 200, a: 100, b: 300 });
	});
});

describe("highlight", () => {
	const rules = [
		{ name: "Late", target: "row", when: { all: [{ field: "due", op: "before", value: "+2m" }, { field: "status", op: "none-of", value: ["done"] }] }, style: { fill: "red", bold: true, icon: "alert-triangle" } },
		{ target: "status", when: { all: [{ field: "status", op: "any-of", value: ["done", "idea"] }] }, style: { text: "green", strike: true } },
		{ target: "status", when: { all: [{ field: "status", op: "any-of", value: ["idea"] }] }, style: { fill: "orange" } },
		{ target: "row", when: { all: [{ field: "status", op: "any-of", value: ["on-hold"] }] }, style: { fill: "grey" }, off: true },
	];
	const run = (extra: Record<string, unknown> = {}) => runView(view({ types: ["project"], columns: ["status", "due"], highlight: rules, ...extra }), ROWS, ctx);

	it("round-trips rules, leaving out empty style parts", () => {
		const def = view({ types: ["project"], highlight: rules });
		expect(def.highlight[0]).toEqual({ name: "Late", target: "row", when: { mode: "all", items: rules[0].when.all }, style: { fill: "red", bold: true, icon: "alert-triangle" } });
		expect(def.highlight[3].off).toBe(true);
		expect(serializeView(def).highlight).toEqual(rules);
		expect(view(serializeView(def))).toEqual(def);
		expect(serializeView(view({ types: ["project"] })).highlight).toBeUndefined();
		expect(view({ highlight: [{ style: { bold: false } }] }).highlight).toEqual([{ target: "row", when: { mode: "all", items: [] }, style: {} }]);
	});

	it("reports bad rules", () => {
		const { def, errors } = parseView({ highlight: [3, { style: { fill: "teal" } }, { when: { all: [{ op: "x" }] } }] });
		expect(def!.highlight).toHaveLength(2);
		expect(errors).toEqual(['A highlight rule should have target, when and style: 3.', 'Unknown highlight colour "teal". Use red, orange, yellow, green, blue, purple, pink, grey.', 'A filter condition needs "field" and "op": {"op":"x"}.']);
		expect(parseView({ highlight: { target: "row" } }).errors).toEqual(["highlight should be a list of rules."]);
	});

	it("styles rows and cells with the first matching rule, cell rules layered over row rules", () => {
		const r = run();
		const def = view({ types: ["project"], columns: ["status", "due"], highlight: rules });
		const by = new Map(r.rows.map((x) => [x.row.name, x]));
		// Lander (done, due Dec 2026): not late; status cell green. Apollo (idea, due 2027-03-31) isn't within 2 months.
		expect(by.get("Lander")!.hl).toEqual({ status: 1 });
		// idea matches rule 1 first, so rule 2 (orange) never applies.
		expect(by.get("Apollo")!.hl).toEqual({ status: 1 });
		expect(by.get("Project 2")!.hl).toBeUndefined(); // the matching rule is off
		expect(r.highlightCounts).toEqual([0, 2, 1, 1]);
		const late = run({ highlight: [{ ...rules[0], when: { all: [{ field: "due", op: "before", value: "+1y" }] } }, rules[1]] });
		const lander = late.rows.find((x) => x.row.name === "Lander")!;
		expect(lander.hl).toEqual({ row: 0, status: 1 });
		const d2 = view({ types: ["project"], columns: ["status", "due"], highlight: [{ ...rules[0], when: { all: [{ field: "due", op: "before", value: "+1y" }] } }, rules[1]] });
		expect(highlightOf(d2, lander, "status")).toEqual({ style: { fill: "red", bold: true, text: "green", strike: true } });
		expect(highlightOf(d2, lander, "due")).toEqual({ style: { fill: "red", bold: true } });
		expect(highlightOf(d2, lander, "name")).toEqual({ style: { fill: "red", bold: true, icon: "alert-triangle" }, iconRule: d2.highlight[0] });
		// a cell rule's own settings win; its icon replaces the row's in its column
		const d3 = view({ types: ["project"], columns: ["status"], highlight: [{ ...rules[0], when: { all: [] } }, { target: "name", when: { all: [] }, style: { fill: "blue", icon: "star" } }] });
		const r3 = runView(d3, ROWS, ctx).rows[0];
		expect(highlightOf(d3, r3, "name")).toEqual({ style: { fill: "blue", bold: true, icon: "star" }, iconRule: d3.highlight[1] });
		expect(highlightOf(def, by.get("Project 10")!, "due")).toBeNull();
	});

	it("uses hidden fields in conditions, skips hidden target columns, and never matches with only unusable conditions", () => {
		const r = run({ columns: ["due"], highlight: [{ target: "row", when: { all: [{ field: "owner", op: "not-empty" }] }, style: { fill: "blue" } }, { target: "status", when: { all: [] }, style: { fill: "red" } }, { target: "row", when: { all: [{ field: "ghost", op: "is", value: "x" }] }, style: { fill: "pink" } }] });
		expect(r.rows.filter((x) => x.hl).map((x) => `${x.row.name}:${JSON.stringify(x.hl)}`)).toEqual(['Apollo:{"row":0}', 'Lander:{"row":0}']);
		expect(r.highlightCounts).toEqual([2, 4, 0]);
	});
});

describe("prefill", () => {
	it("pins status, choices and single links from top-level all conditions", () => {
		const def = view({ types: ["organisation"], filters: { all: [{ field: "status", op: "any-of", value: ["active"] }, { field: "kind", op: "any-of", value: ["Company"] }, { field: "part_of", op: "links-any", value: ["Acme.md"] }, { field: "website", op: "contains", value: "x" }] } });
		const { known } = runView(def, ROWS, ctx);
		expect(prefillFromFilters(def, known)).toEqual({ status: "active", fields: { kind: "Company", part_of: "Acme.md" } });
	});
});
