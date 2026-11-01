import { describe, expect, it } from "vitest";
import { isoDateAdapter } from "../src/model/dates";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import { extractEdges } from "../src/model/relations";
import {
	availableColumns,
	columnFromId,
	cycleSort,
	dateValue,
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

describe("prefill", () => {
	it("pins status, choices and single links from top-level all conditions", () => {
		const def = view({ types: ["organisation"], filters: { all: [{ field: "status", op: "any-of", value: ["active"] }, { field: "kind", op: "any-of", value: ["Company"] }, { field: "part_of", op: "links-any", value: ["Acme.md"] }, { field: "website", op: "contains", value: "x" }] } });
		const { known } = runView(def, ROWS, ctx);
		expect(prefillFromFilters(def, known)).toEqual({ status: "active", fields: { kind: "Company", part_of: "Acme.md" } });
	});
});
