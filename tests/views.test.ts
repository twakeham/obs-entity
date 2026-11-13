import { describe, expect, it } from "vitest";
import moment from "moment";
import { isoDateAdapter } from "../src/model/dates";
import type { MomentLike } from "../src/model/formats";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import { extractEdges } from "../src/model/relations";
import { typeIssues } from "../src/model/validation";
import { spanText, summarize, summaryOptions } from "../src/model/summary";
import {
	availableColumns,
	barGeometry,
	columnFromId,
	conditionIssue,
	conditionText,
	cycleSort,
	dateValue,
	fillWidths,
	flattenGroups,
	formatKind,
	frozenCount,
	GROUP_PATH_SEP,
	highlightOf,
	ignoredConditions,
	itemAt,
	NEEDS_VALUE,
	NO_THIS_NOTE,
	parseView,
	percentile,
	prefillFromFilters,
	resolveColumn,
	rollupIgnored,
	rollupLinkedTypes,
	rollupFilterColumns,
	rollupSources,
	rowHeight,
	rowOffsets,
	runView,
	scalePosition,
	serializeView,
	shareCell,
	THIS_NOTE,
	unknownSources,
	usesThisNote,
	withThisNote,
	type ColumnDef,
	type ViewContext,
	type ResultGroup,
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
			group: [{ by: "due", date: "month" }, "owner"],
			filters: { all: [{ field: "status", op: "none-of", value: ["done"] }, { any: [{ field: "owner", op: "empty" }, { field: "team", op: "count>", value: 1 }] }] },
		};
		const def = view(raw);
		expect(def.columns.map((c) => `${c.kind}:${c.id}`)).toEqual(["builtin:name", "builtin:status", "field:owner", "field:due", "incoming:in:note.project", "rollup:notes", "formula:two"]);
		const out = serializeView(def);
		expect(out.columns).toEqual(["name", "status", "owner", { field: "due", label: "Deadline" }, "in:note.project", { rollup: { via: "in:note.project", agg: "count" }, label: "Notes", id: "notes" }, { formula: "1+1", label: "Two", id: "two" }]);
		expect(out.widths).toEqual({ owner: 160 });
		expect(out.sort).toEqual([{ by: "due", dir: "desc" }, { by: "name", dir: "asc" }]);
		expect(out.group).toEqual([{ by: "due", date: "month" }, { by: "owner" }]);
		expect(view(out)).toEqual({ ...def, widths: { owner: 160 } });
	});

	it("gives field keys that clash with built-ins their own ids", () => {
		const def = view({ columns: ["type", { field: "type" }, "f:folder"] });
		expect(def.columns.map((c) => `${c.kind}:${c.id}`)).toEqual(["builtin:name", "builtin:type", "field:f:type", "field:f:folder"]);
		expect(serializeView(def).columns).toEqual(["name", "type", { field: "type" }, { field: "folder" }]);
	});

	it("reports bad pieces and rejects unknown kinds", () => {
		expect(parseView({ kind: "gallery" }).def).toBeNull();
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

	it("ignore conditions without a value, or with a number or date that can't be read", () => {
		const all = names(P);
		expect(all).toHaveLength(4);
		// Each would otherwise match nothing (any-of, links-any, a number) or everything (contains "", none-of []).
		for (const c of [
			{ field: "owner", op: "links-any" },
			{ field: "owner", op: "links-any", value: [] },
			{ field: "status", op: "any-of", value: [] },
			{ field: "status", op: "none-of" },
			{ field: "name", op: "contains", value: "  " },
			{ field: "folder", op: "in-folder", value: "" },
			{ field: "team", op: "count>", value: "lots" },
			{ field: "due", op: "before", value: "someday" },
			{ field: "due", op: "between", value: ["", ""] },
			{ field: "due", op: "between", value: ["today", "never"] },
		])
			expect(names({ ...P, filters: { all: [c, { field: "status", op: "any-of", value: ["idea", "done"] }] } }), JSON.stringify(c)).toEqual(["Apollo", "Lander"]);
		// One end of a date range is enough.
		expect(names({ ...P, filters: { all: [{ field: "due", op: "between", value: ["", "2027-01-01"] }] } })).toEqual(["Lander"]);
		// In an "any" group, an ignored condition doesn't make every row match, and neither does a nested group
		// with nothing usable in it.
		expect(names({ ...P, filters: { any: [{ field: "status", op: "any-of", value: ["done"] }, { field: "owner", op: "links-any" }] } })).toEqual(["Lander"]);
		expect(names({ ...P, filters: { any: [{ field: "status", op: "any-of", value: ["done"] }, { all: [{ field: "owner", op: "links-any" }] }] } })).toEqual(["Lander"]);
		// A view whose conditions are all ignored shows everything.
		expect(names({ ...P, filters: { all: [{ field: "owner", op: "links-any" }, { any: [{ field: "name", op: "is" }] }] } })).toEqual(all);
	});

	it("report ignored conditions and why, in words", () => {
		const def = view({ types: ["project"], columns: ["status", "owner", "due"], filters: { all: [{ field: "owner", op: "links-any" }, { field: "status", op: "any-of", value: ["idea"] }, { any: [{ field: "due", op: "after", value: "soon" }, { field: "ghost", op: "is", value: "x" }, { field: "team", op: "count<", value: "x" }] }] } });
		const known = runView(def, ROWS, ctx).known;
		const ignored = ignoredConditions(def.filters, known, ctx);
		expect(ignored.map((i) => `${conditionText(i.cond, known)}: ${i.issue}`)).toEqual([
			"Owner links to any of: It needs a value.",
			"Due is after: “soon” isn't a date.",
			"ghost is: “ghost” isn't a column of this view.",
			"Team count <: “x” isn't a number.",
		]);
		expect(ignored[0].issue).toBe(NEEDS_VALUE);
		// Operators without a value are fine.
		expect(conditionIssue({ field: "owner", op: "empty" }, known, ctx)).toBeNull();
		// A highlight rule whose only condition needs a value matches nothing.
		const r = runView(view({ types: ["project"], highlight: [{ target: "row", when: { all: [{ field: "owner", op: "links-any" }] }, style: { fill: "red" } }] }), ROWS, ctx);
		expect(r.highlightCounts).toEqual([0]);
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
		expect(g({ types: ["project"], group: [{ by: "status" }] })).toEqual(["idea: Apollo", "active: Project 10", "on-hold: Project 2", "done: Lander"]);
		expect(g({ types: ["project"], group: [{ by: "due", date: "month" }] })).toEqual(["December 2026: Lander", "March 2027: Apollo", "(none): Project 2,Project 10"]);
		expect(g({ types: ["project"], group: ["team"] })).toEqual(["Ada: Apollo", "Grace: Apollo", "(none): Lander,Project 2,Project 10"]);
	});

	it("nests any number of levels, with paths, levels and per-level order", () => {
		const r = runView(view({ types: ["person", "organisation", "project"], group: ["type", "status", { by: "team" }], sort: [{ by: "status", dir: "desc" }] }), ROWS, ctx);
		const tree = (gs: ResultGroup[] | null, pad = ""): string[] =>
			(gs ?? []).flatMap((g) => [`${pad}${g.label || "(none)"} [${g.level}:${g.by}] ${g.rows.length}`, ...tree(g.children, pad + "  ")]);
		expect(tree(r.groups)).toEqual([
			"Organisation [0:type] 2",
			"  active [1:status] 1",
			"    (none) [2:team] 1",
			"  draft [1:status] 1",
			"    (none) [2:team] 1",
			"Person [0:type] 2",
			"  active [1:status] 1",
			"    (none) [2:team] 1",
			"  draft [1:status] 1",
			"    (none) [2:team] 1",
			"Project [0:type] 4",
			"  done [1:status] 1",
			"    (none) [2:team] 1",
			"  on-hold [1:status] 1",
			"    (none) [2:team] 1",
			"  active [1:status] 1",
			"    (none) [2:team] 1",
			"  idea [1:status] 1",
			"    Ada [2:team] 1",
			"    Grace [2:team] 1",
		]);
		const flat = flattenGroups(r.groups);
		expect(flat.length).toBe(20);
		// grouped columns aren't shown, but stay in the definition and still group
		const g2 = runView(view({ types: ["project"], columns: ["status", "due", "team"], group: ["status"] }), ROWS, ctx);
		expect(g2.columns.map((c) => c.id)).toEqual(["name", "due", "team"]);
		expect(g2.known.has("status")).toBe(true);
		expect(g2.groups!.length).toBe(4);
		expect(flat.find((g) => g.label === "Grace")!.key).toBe(["project", "idea", "Grace.md"].join(GROUP_PATH_SEP));
		expect(runView(view({ types: ["project"] }), ROWS, ctx).groups).toBeNull();
		// unknown levels are skipped
		expect(runView(view({ types: ["project"], group: ["ghost", "status"] }), ROWS, ctx).groups!.map((g) => g.by)).toEqual(["status", "status", "status", "status"]);
	});

	it("reads group as a list only, skipping repeats and reporting bad levels", () => {
		expect(parseView({ group: { by: "status" } }).errors).toEqual(["group should be a list of levels, e.g. group: [{ by: status }, { by: due, date: month }]."]);
		const { def, errors } = parseView({ group: ["status", { by: "status" }, { date: "month" }, { by: "due", date: "week" }] });
		expect(def!.group).toEqual([{ by: "status" }, { by: "due" }]);
		expect(errors).toEqual(['A group level needs "by": {"date":"month"}.']);
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
		const g = runView(view({ types: ["project"], group: ["due"], formats: { due: "MMMM YYYY" }, columns: ["due"] }), ROWS, fctx).groups!.map((x) => x.label);
		expect(g).toEqual(["December 2026", "March 2027", ""]);
		const rel = runView(view({ types: ["project"], columns: ["due"], formats: { due: "relative" }, sort: [{ by: "due", dir: "asc" }] }), ROWS, ctx).rows.map((x) => x.cells.due.text);
		expect(rel.slice(0, 2)).toEqual(["in 4 weeks", "in 5 months"]);
	});
});

describe("summaries", () => {
	const fctx = { ...ctx, moment: moment as unknown as MomentLike, locale: "en-AU", currency: "AUD" };
	const sum = (raw: Record<string, unknown>, id: string, agg: string, c = ctx) => {
		const def = view(raw);
		const r = runView(def, ROWS, c);
		const res = summarize(r.rows, r.columns.find((x) => x.id === id)!, agg, c, def.formats[id]);
		return res ? `${res.label} ${res.text}`.trim() : null;
	};
	const P = { types: ["project"], columns: ["status", "due", "team"] };

	it("round-trip, dropping removed columns, and keep the group header toggle", () => {
		const def = view({ ...P, summary: { due: "latest", gone: "sum", name: "count" }, group: ["status"], groupSummaries: false });
		expect(def.summary).toEqual({ due: "latest", gone: "sum", name: "count" });
		const out = serializeView(def);
		expect(out.summary).toEqual({ due: "latest", name: "count" });
		expect(out.group).toEqual([{ by: "status" }]);
		expect(out.groupSummaries).toBe(false);
		expect(serializeView(view({ ...P, group: ["status"] })).groupSummaries).toBeUndefined();
		expect(view({ ...P, group: ["status"], groupFieldNames: false }).groupFieldNames).toBe(false);
		expect(serializeView(view({ ...P, group: ["status"], groupFieldNames: false })).groupFieldNames).toBe(false);
		expect(serializeView(view({ ...P, group: ["status"], groupFieldNames: true })).groupFieldNames).toBeUndefined();
		expect(serializeView(view(P)).summary).toBeUndefined();
	});

	it("count, fill and distinct values for any column", () => {
		expect(sum(P, "name", "count")).toBe("Count 4");
		expect(sum(P, "due", "count")).toBe("Count 2");
		expect(sum(P, "due", "empty")).toBe("Empty 2");
		expect(sum(P, "due", "filled")).toBe("Filled 2/4");
		expect(sum(P, "due", "percent-filled")).toBe("Filled 50%");
		expect(sum(P, "team", "unique")).toBe("Unique 2");
		expect(sum(P, "team", "links")).toBe("Total 2");
	});

	it("choices: counts in status order and the share of one value", () => {
		expect(sum(P, "status", "values")).toBe("1 idea · 1 active · 1 on-hold · 1 done");
		expect(sum(P, "status", "percent:done")).toBe("done 25%");
	});

	it("numbers use the column's format; dates give earliest, latest and a span", () => {
		const D = { types: ["deal"], columns: ["value"] };
		expect(["sum", "avg", "median", "min", "max", "range"].map((a) => sum(D, "value", a))).toEqual(["Sum 150", "Avg 75", "Median 75", "Min 50", "Max 100", "Range 50"]);
		expect(sum({ ...D, formats: { value: "currency" } }, "value", "sum", fctx)).toBe("Sum $150.00");
		expect(sum(P, "due", "earliest")).toBe("Earliest 2026-12-01");
		expect(sum({ ...P, formats: { due: "D MMM YYYY" } }, "due", "latest", fctx)).toBe("Latest 31 Mar 2027");
		expect(sum(P, "due", "range")).toBe("Range 4 months");
		expect(sum(P, "due", "sum")).toBeNull();
		expect(sum({ types: ["deal"], columns: ["value"], filters: { all: [{ field: "value", op: ">", value: 500 }] } }, "value", "sum")).toBe("Sum –");
	});

	it("offers options by kind and spells out spans", () => {
		const cols = runView(view({ ...P, columns: ["status", "due", "team"] }), ROWS, ctx).columns;
		expect(summaryOptions(cols[0]).map((o) => o.key)).toEqual(["count"]);
		expect(summaryOptions(cols[1], ["idea", "done"]).map((o) => o.key).slice(0, 3)).toEqual(["values", "percent:idea", "percent:done"]);
		expect(summaryOptions(cols[2]).map((o) => o.key).slice(0, 3)).toEqual(["earliest", "latest", "range"]);
		expect([1, 13, 20, 59, 120, 400, 1000].map(spanText)).toEqual(["1 day", "13 days", "3 weeks", "8 weeks", "4 months", "13 months", "2.7 years"]);
	});
});

describe("density and wrapping", () => {
	it("round-trip, leaving out defaults, dropping removed columns and reporting a bad density", () => {
		const def = view({ columns: ["status", "due"], density: "compact", wrap: ["due", "due", "gone"], wrapLines: 3 });
		expect([def.density, def.wrap, def.wrapLines]).toEqual(["compact", ["due", "gone"], 3]);
		expect(serializeView(def)).toMatchObject({ density: "compact", wrap: ["due"], wrapLines: 3 });
		const plain = serializeView(view({ columns: ["status"], density: "normal", wrapLines: 5 }));
		expect([plain.density, plain.wrap, plain.wrapLines]).toEqual([undefined, undefined, undefined]);
		expect(view({ wrapLines: "unlimited" }).wrapLines).toBe(0);
		expect(serializeView(view({ wrapLines: "unlimited" })).wrapLines).toBe("unlimited");
		expect(parseView({ density: "cosy" }).errors).toEqual(['Unknown density "cosy". Use compact, normal or comfortable.']);
		expect([rowHeight({}), rowHeight({ density: "compact" }), rowHeight({ density: "comfortable" })]).toEqual([34, 26, 44]);
	});

	it("find rows of different heights by position", () => {
		const off = rowOffsets([34, 80, 34, 120]);
		expect(off).toEqual([0, 34, 114, 148, 268]);
		expect([itemAt(off, 0), itemAt(off, 33), itemAt(off, 34), itemAt(off, 113), itemAt(off, 150), itemAt(off, 999), itemAt(off, -5)]).toEqual([0, 0, 1, 1, 3, 3, 0]);
		expect(itemAt(rowOffsets([]), 10)).toBe(0);
	});
});

describe("frozen columns", () => {
	it("round-trip, dropping a removed column, and count the frozen shown columns", () => {
		const def = view({ columns: ["status", "due", "team"], freeze: "due" });
		expect(def.freeze).toBe("due");
		expect(serializeView(def).freeze).toBe("due");
		expect(serializeView({ ...def, columns: def.columns.filter((c) => c.id !== "due") }).freeze).toBeUndefined();
		expect(serializeView(view({ columns: ["status"] })).freeze).toBeUndefined();
		const ids = (...xs: string[]) => xs.map((id) => ({ id }));
		expect(frozenCount(def, ids("name", "status", "due", "team"))).toBe(3);
		// the frozen column is grouped (hidden): stop at the last shown column before it
		expect(frozenCount(def, ids("name", "status", "team"))).toBe(2);
		expect(frozenCount(view({ columns: ["status"] }), ids("name", "status"))).toBe(0);
		expect(frozenCount({ ...def, freeze: "gone" }, ids("name", "status"))).toBe(0);
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

describe("formula columns", () => {
	const F = (raw: Record<string, unknown>) => runView(view({ types: ["project"], ...raw }), ROWS, ctx);
	const vals = (raw: Record<string, unknown>, id: string) => F(raw).rows.map((r) => `${r.row.name}=${r.cells[id]?.error ? `!${r.cells[id].error}` : r.cells[id]?.text}`);

	it("compute per row, with an inferred kind used for sorting and filtering", () => {
		const raw = { columns: [{ formula: "[due] - today()", label: "Days left", id: "left" }], sort: [{ by: "left", dir: "asc" }] };
		const r = F(raw);
		expect(r.columns[1].kind).toBe("number");
		expect(r.rows.map((x) => `${x.row.name}=${x.cells.left.text}`)).toEqual(["Lander=30", "Apollo=150", "Project 2=", "Project 10="]);
		expect(F({ ...raw, filters: { all: [{ field: "left", op: "<", value: 100 }] } }).rows.map((x) => x.row.name)).toEqual(["Lander"]);
		expect(formatKind(r.columns[1])).toBe("number");
	});

	it("reference labels or ids, other formulas, and fields of linked notes", () => {
		const cols = [
			{ formula: "[Due] + 7", label: "Grace", id: "grace" },
			{ formula: "dateDiff(today(), [grace], \"weeks\")", label: "Weeks", id: "weeks" },
			{ formula: 'prop([Owner], "status") & " / " & count([Team])', label: "Owner status", id: "os" },
			{ formula: "join(map([Team], name(item)), \" + \")", label: "Team names", id: "tn" },
		];
		const r = F({ columns: cols });
		expect(r.columns.map((c) => c.kind)).toEqual(["text", "date", "number", "text", "text"]);
		const apollo = r.rows.find((x) => x.row.name === "Apollo")!;
		expect([apollo.cells.grace.text, apollo.cells.weeks.text, apollo.cells.os.text, apollo.cells.tn.text]).toEqual(["2027-04-07", "22", "active / 2", "Ada + Grace"]);
	});

	it("override the type, and report problems per column and per row", () => {
		const r = F({
			columns: [
				{ formula: '"2027-01-0" & 5', label: "As date", id: "d", type: "date" },
				{ formula: "[budget] + 1", label: "Bad ref", id: "bad" },
				{ formula: "1 / count([Team])", label: "Per member", id: "pm" },
				{ formula: "[b] + 1", label: "A", id: "a" },
				{ formula: "[a] + 1", label: "B", id: "b" },
			],
		});
		const c = Object.fromEntries(r.columns.map((x) => [x.id, x]));
		expect(c.d.kind).toBe("date");
		expect(r.rows[0].cells.d.text).toBe("2027-01-05");
		expect(c.bad.invalid).toBe("Unknown column [budget].");
		expect(c.a.invalid).toBe("Circular reference: A → B → A.");
		expect(vals({ columns: [{ formula: "1 / count([Team])", label: "Per member", id: "pm" }] }, "pm")).toEqual(["Apollo=0.5", "Lander=!Division by zero.", "Project 2=!Division by zero.", "Project 10=!Division by zero."]);
		expect(parseView({ columns: [{ formula: "1", type: "colour" }] }).errors).toEqual(['Unknown formula type "colour". Use number, text, bool, date, list, links.']);
	});

	it("round-trip, with the type override", () => {
		const def = view({ columns: [{ formula: "[due] - today()", label: "Days left", id: "left", type: "number" }] });
		expect(serializeView(def).columns).toEqual(["name", { formula: "[due] - today()", label: "Days left", id: "left", type: "number" }]);
	});

	it("query notes with notes(): by type key or name, by group, or every entity", () => {
		const withAll: ViewContext = { ...ctx, all: () => ROWS };
		const one = (formula: string, c: ViewContext = withAll) => {
			const r = runView(view({ types: ["project"], columns: [{ formula, label: "Q", id: "q" }] }), ROWS, c).rows.find((x) => x.row.name === "Apollo")!.cells.q;
			return r.error ? `!${r.error}` : r.text;
		};
		expect(one('count(notes("project"))')).toBe("4");
		expect(one('count(notes("Projects"))')).toBe("4");
		expect(one('join(name(notes("organisation")), ", ")')).toBe("Acme, Globex");
		expect(one("count(notes())")).toBe(String(ROWS.length));
		expect(one(`count(notes("@${T("deal").group}"))`)).toBe(String(ROWS.filter((r) => r.type.group === T("deal").group).length));
		expect(one('count(filter(notes("project"), prop(item, "status") = "active"))')).toBe("1");
		expect(one('sum(prop(notes("deal"), "value"))')).toBe("150");
		expect(one('count(notes("planet"))')).toBe('!There\'s no type called "planet".');
		expect(one('count(notes("project"))', ctx)).toBe("!notes() can't be used here.");
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

describe("data bars and colour scales", () => {
	const D = (rules: unknown[], extra: Record<string, unknown> = {}) => runView(view({ types: ["deal"], columns: ["value", "close_date"], highlight: rules, ...extra }), ROWS, ctx);
	const P = (rules: unknown[]) => runView(view({ types: ["project"], columns: ["due"], highlight: rules }), ROWS, ctx);

	it("round-trip, leaving out defaults, and report bad options", () => {
		const raw = [
			{ kind: "bar", target: "value", bar: { color: "blue", min: 0, max: "p90", gradient: true, barOnly: false } },
			{ kind: "scale", target: "due", when: { all: [{ field: "status", op: "none-of", value: ["done"] }] }, scale: { colors: ["red", "yellow", "green"], min: "today", mid: "auto", max: "+30d" } },
		];
		const def = view({ types: ["project"], columns: ["due"], highlight: raw });
		expect(def.highlight[0]).toMatchObject({ kind: "bar", bar: { color: "blue", min: 0, max: "p90", gradient: true } });
		expect(serializeView(def).highlight).toEqual([
			{ kind: "bar", target: "value", bar: { color: "blue", min: 0, max: "p90", gradient: true } },
			{ kind: "scale", target: "due", when: raw[1].when, scale: { colors: ["red", "yellow", "green"], min: "today", max: "+30d" } },
		]);
		expect(view(serializeView(def))).toEqual(def);
		const bad = parseView({ highlight: [{ kind: "sparkle" }, { kind: "scale", scale: { colors: ["red"] } }, { kind: "bar", bar: { color: "teal" } }] });
		expect(bad.errors).toEqual(['Unknown highlight kind "sparkle". Use highlight, bar or scale.', "A colour scale needs 2 or 3 colours.", 'Unknown bar colour "teal". Use red, orange, yellow, green, blue, purple, pink, grey.']);
		expect(bad.def!.highlight[1].scale!.colors).toEqual(["red", "yellow", "green"]);
	});

	it("bars: from zero for numbers, clamped to fixed bounds, from the zero line for negatives", () => {
		const r = D([{ kind: "bar", target: "value" }]);
		expect(r.rows.map((x) => [x.row.name, x.cells.value.value, x.viz?.value?.bar])).toEqual([
			["Deal one", 100, { rule: 0, start: 0, end: 1, negative: false }],
			["Deal two", 50, { rule: 0, start: 0, end: 0.5, negative: false }],
		]);
		expect(D([{ kind: "bar", target: "value", bar: { min: 50, max: 80 } }]).rows.map((x) => x.viz?.value?.bar?.end)).toEqual([1, 0]);
		expect(barGeometry(-25, -50, 50)).toEqual({ start: 0.25, end: 0.5, negative: true });
		expect(barGeometry(25, -50, 50)).toEqual({ start: 0.5, end: 0.75, negative: false });
		expect(barGeometry(-10, -20, -5)).toEqual({ start: 10 / 15, end: 1, negative: true });
		expect(barGeometry(5, 5, 5)).toEqual({ start: 0, end: 1, negative: false });
	});

	it("bars on dates span the dates; rows with no value get none; the rule's condition limits rows and bounds", () => {
		const r = P([{ kind: "bar", target: "due" }]);
		const by = Object.fromEntries(r.rows.map((x) => [x.row.name, x.viz?.due?.bar ?? null]));
		expect(by.Lander).toEqual({ rule: 0, start: 0, end: 0, negative: false });
		expect(by.Apollo).toEqual({ rule: 0, start: 0, end: 1, negative: false });
		expect(by["Project 2"]).toBeNull();
		const only = P([{ kind: "bar", target: "due", when: { all: [{ field: "status", op: "any-of", value: ["idea"] }] } }]);
		expect(only.rows.filter((x) => x.viz).map((x) => x.row.name)).toEqual(["Apollo"]);
		expect(only.highlightCounts).toEqual([1]);
	});

	it("scales: two or three colours, percentiles and relative dates", () => {
		expect(D([{ kind: "scale", target: "value", scale: { colors: ["white", "blue"].map((c) => (c === "white" ? "grey" : c)) } }]).rows.map((x) => x.viz?.value?.scale?.t)).toEqual([1, 0]);
		expect(scalePosition(25, 0, 100, 50)).toBe(0.25);
		expect(scalePosition(75, 0, 100, 50)).toBe(0.75);
		expect(scalePosition(5, 5, 5)).toBe(0.5);
		expect(scalePosition(200, 0, 100)).toBe(1);
		expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
		// today (2026-11-01) red → +60d green: Lander (2026-12-01, 30 days) sits half way
		const r = P([{ kind: "scale", target: "due", scale: { colors: ["red", "green"], min: "today", max: "+60d" } }]);
		expect(r.rows.find((x) => x.row.name === "Lander")!.viz!.due!.scale!.t).toBeCloseTo(0.5, 1);
		expect(r.rows.find((x) => x.row.name === "Apollo")!.viz!.due!.scale!.t).toBe(1);
	});

	it("leave highlights alone, skip hidden or disabled columns, and both kinds can share a column", () => {
		const r = D([
			{ kind: "bar", target: "value" },
			{ kind: "scale", target: "value", scale: { colors: ["red", "green"] } },
			{ kind: "bar", target: "close_date", off: true },
			{ target: "value", when: { all: [{ field: "value", op: ">", value: 60 }] }, style: { bold: true } },
		]);
		const one = r.rows[0];
		expect(Object.keys(one.viz!)).toEqual(["value"]);
		expect(one.viz!.value).toEqual({ bar: { rule: 0, start: 0, end: 1, negative: false }, scale: { rule: 1, t: 1 } });
		expect(one.hl).toEqual({ value: 3 });
		expect(highlightOf(view({ types: ["deal"], columns: ["value"], highlight: [{ kind: "bar", target: "value" }] }), r.rows[1], "value")).toBeNull();
		expect(runView(view({ types: ["deal"], columns: ["close_date"], highlight: [{ kind: "bar", target: "value" }] }), ROWS, ctx).rows.some((x) => x.viz)).toBe(false);
	});
});

describe("prefill", () => {
	it("pins status, choices and single links from top-level all conditions", () => {
		const def = view({ types: ["organisation"], filters: { all: [{ field: "status", op: "any-of", value: ["active"] }, { field: "kind", op: "any-of", value: ["Company"] }, { field: "part_of", op: "links-any", value: ["Acme.md"] }, { field: "website", op: "contains", value: "x" }] } });
		const { known } = runView(def, ROWS, ctx);
		expect(prefillFromFilters(def, known)).toEqual({ status: "active", fields: { kind: "Company", part_of: "Acme.md" } });
	});
});

describe("this note", () => {
	const def = view({ types: ["project"], columns: ["team"], filters: { all: [{ field: "team", op: "links-any", value: [THIS_NOTE] }] }, highlight: [{ target: "row", when: { all: [{ field: "owner", op: "links-none", value: [THIS_NOTE, "Ada"] }] }, style: { fill: "red" } }] });

	it("becomes the note the view is shown on, in filters and highlight rules", () => {
		expect(usesThisNote(def)).toBe(true);
		expect(usesThisNote(view({ types: ["project"] }))).toBe(false);
		const on = withThisNote(def, "Grace.md");
		expect(runView(on, ROWS, ctx).rows.map((r) => r.row.name)).toEqual(["Apollo"]);
		expect(on.highlight?.[0].when.items[0]).toEqual({ field: "owner", op: "links-none", value: ["Grace.md", "Ada"] });
		// What's saved keeps the placeholder.
		expect((def.filters.items[0] as { value: unknown }).value).toEqual([THIS_NOTE]);
		// + New links the new note to it.
		expect(prefillFromFilters(on, runView(on, ROWS, ctx).known).fields).toEqual({ team: "Grace.md" });
	});

	it("is skipped, and reported, where there's no note", () => {
		const off = withThisNote(def, null);
		const r = runView(off, ROWS, ctx);
		expect(r.rows).toHaveLength(4);
		const ignored = ignoredConditions(off.filters, r.known, ctx);
		expect(ignored.map((i) => i.issue)).toEqual([NO_THIS_NOTE]);
		// Mixed with real notes, only the placeholder goes.
		expect(off.highlight?.[0].when.items[0]).toEqual({ field: "owner", op: "links-none", value: ["Ada"] });
	});
});

describe("roll-up filters", () => {
	const deals = (where: unknown, agg = "count", field?: string) => ({ types: ["organisation"], columns: [{ rollup: { via: "in:deal.company", agg, ...(field ? { field } : {}), where }, id: "x" }] });

	it("only roll up the linked notes that match", () => {
		expect(texts(deals({ all: [{ field: "status", op: "any-of", value: ["won"] }] }, "sum", "value"), "x")).toEqual(["Acme=50", "Globex="]);
		expect(texts(deals({ all: [{ field: "value", op: ">=", value: 60 }] }), "x")).toEqual(["Acme=1", "Globex=0"]);
		// Relative dates, and "any" groups.
		expect(texts(deals({ all: [{ field: "close_date", op: "before", value: "today" }] }), "x")[0]).toBe("Acme=1");
		expect(texts(deals({ any: [{ field: "value", op: ">", value: 75 }, { field: "status", op: "any-of", value: ["won"] }] }), "x")[0]).toBe("Acme=2");
		// Outgoing relationships too: Apollo's team, only the active people.
		const team = { types: ["project"], columns: [{ rollup: { via: "field:team", agg: "list", where: { all: [{ field: "status", op: "any-of", value: ["active"] }] } }, id: "x" }] };
		expect(texts(team, "x")).toContain("Apollo=Ada");
		// A condition that can't be used is ignored (every linked note counts).
		expect(texts(deals({ all: [{ field: "status", op: "any-of", value: [] }] }), "x")[0]).toBe("Acme=2");
	});

	it("round-trip, label themselves and say what they count", () => {
		const def = view(deals({ all: [{ field: "status", op: "any-of", value: ["won"] }] }, "sum", "value"));
		const col = def.columns[1] as Extract<ColumnDef, { kind: "rollup" }>;
		expect(col.rollup.where).toEqual({ mode: "all", items: [{ field: "status", op: "any-of", value: ["won"] }] });
		expect(serializeView(def).columns).toContainEqual({ rollup: { via: "in:deal.company", agg: "sum", field: "value", where: { all: [{ field: "status", op: "any-of", value: ["won"] }] } }, id: "x" });
		expect(view(serializeView(def))).toEqual(def);
		// No conditions: no "where" at all.
		expect((serializeView(view(deals({ all: [] }))).columns as unknown[])[1]).toEqual({ rollup: { via: "in:deal.company", agg: "count" }, id: "x" });
		const r = runView(def, ROWS, ctx).columns[1];
		expect(r.label).toMatch(/ \(filtered\)$/);
		expect(r.hint).toBe("Sum of value of Deals where Status is any of won");
		expect(rollupLinkedTypes(col.rollup, [T("organisation")], TYPES).map((t) => t.key)).toEqual(["deal"]);
		const cols = rollupFilterColumns([T("deal")], ctx);
		expect(cols.find((c) => c.col.id === "value")?.group).toBe("Fields");
		expect(cols.find((c) => c.col.id === "name")?.group).toBe("Built-in");
		expect(rollupIgnored({ ...col.rollup, where: { mode: "all", items: [{ field: "ghost", op: "is", value: "x" }] } }, [T("organisation")], ctx)[0].issue).toMatch(/ghost/);
	});

	it("can use this note in a view (the note the view is on)", () => {
		// People: how many of the projects they're on are owned by this note.
		const def = view({ types: ["person"], columns: [{ rollup: { via: "in:project.team", agg: "count", where: { all: [{ field: "owner", op: "links-any", value: [THIS_NOTE] }] } }, id: "x" }] });
		const counts = (path: string | null) => runView(withThisNote(def, path), ROWS, ctx).rows.map((r) => `${r.row.name}=${r.cells.x.text}`);
		expect(counts("Ada.md")).toEqual(["Ada=1", "Grace=1"]);
		expect(counts("Grace.md")).toEqual(["Ada=0", "Grace=0"]);
		// No note: the condition is ignored.
		expect(counts(null)).toEqual(["Ada=1", "Grace=1"]);
		expect(usesThisNote(def)).toBe(true);
	});

	it("are checked with the type", () => {
		const org = T("organisation");
		const won = { key: "won", label: "Won", kind: "rollup" as const, rollup: { via: "in:deal.company", agg: "count" as const, where: { mode: "all" as const, items: [{ field: "ghost", op: "is", value: "x" }, { field: "status", op: "any-of" }] } } };
		const t = { ...org, fields: [...org.fields, won] };
		const issues = typeIssues(t, { typeKeys: TYPES.map((x) => x.key), groupKeys: GROUPS.map((g) => g.key), types: TYPES, groups: GROUPS }).filter((i) => i.at === `field:${t.fields.length - 1}:calc`);
		// The unknown column is a problem; the condition still waiting for a value isn't.
		expect(issues.map((i) => i.message)).toEqual(["Won: the condition “ghost is” is ignored: No source type has a \"ghost\" field."]);
	});
});

describe("roll-ups as a share of the total", () => {
	const share = (show: string, extra: Record<string, unknown> = {}) => ({
		types: ["project"],
		columns: ["status", { rollup: { via: "field:team", agg: "count", show }, label: "Share", id: "sh" }],
		...extra,
	});
	const shares = (raw: Record<string, unknown>, search = "") => runView(view(raw), ROWS, ctx, search).rows.map((r) => `${r.row.name}=${r.cells.sh.text}`);

	it("parse and serialize, only for count and sum", () => {
		const def = view(share("total"));
		expect(serializeView(def).columns).toContainEqual({ rollup: { via: "field:team", agg: "count", show: "total" }, label: "Share", id: "sh" });
		expect(view(share("value")).columns[2]).toEqual({ kind: "rollup", id: "sh", rollup: { via: "field:team", agg: "count" }, label: "Share" });
		expect(parseView({ columns: [{ rollup: { via: "field:team", agg: "list", show: "total" } }] }).errors).toEqual(['Roll-up "show: total" only works with count and sum.']);
		expect(parseView({ columns: [{ rollup: { via: "field:team", agg: "count", show: "half" } }] }).errors).toEqual(['Unknown roll-up "show" "half". Use value, total or group.']);
		const label = runView(view({ types: ["project"], columns: [{ rollup: { via: "field:team", agg: "count", show: "group" } }] }), ROWS, ctx).columns[1].label;
		expect(label).toBe("Team: count (% of group total)");
	});

	it("each row's share of the view's total; the shares add up to 100%", () => {
		expect(shares(share("total"))).toEqual(["Apollo=100%", "Lander=0%", "Project 2=0%", "Project 10=0%"]);
		const orgs = { types: ["organisation"], columns: [{ rollup: { via: "in:person.works_for", agg: "count", show: "total" }, id: "sh" }] };
		expect(shares(orgs)).toEqual(["Acme=50%", "Globex=50%"]);
		// the total follows the search
		expect(shares(orgs, "acme")).toEqual(["Acme=100%"]);
		const r = runView(view(orgs), ROWS, ctx);
		expect(r.rows.map((x) => [x.cells.sh.value, x.cells.sh.raw])).toEqual([[50, 1], [50, 1]]);
		expect(summarize(r.rows, r.columns[1], "sum", ctx)?.text).toBe("100%");
	});

	it("of the group's total, per innermost group", () => {
		const orgs = (show: string, group?: string[]) => ({ types: ["organisation"], columns: [{ rollup: { via: "in:person.works_for", agg: "count", show }, id: "sh" }], ...(group ? { group } : {}) });
		expect(shares(orgs("group", ["status"]))).toEqual(["Acme=100%", "Globex=100%"]);
		// not grouped: the same as the view's total
		expect(shares(orgs("group"))).toEqual(["Acme=50%", "Globex=50%"]);
		expect(shares(orgs("total", ["status"]))).toEqual(["Acme=50%", "Globex=50%"]);
	});

	it("filter, sort, format and highlight on the share; formulas get the roll-up's own value", () => {
		// the share is of the rows the other filters keep, so a filter on it doesn't change the shares
		expect(shares(share("total", { filters: { all: [{ field: "sh", op: ">", value: 50 }] } }))).toEqual(["Apollo=100%"]);
		expect(shares(share("total", { sort: [{ by: "sh", dir: "desc" }] }))[0]).toBe("Apollo=100%");
		expect(shares(share("total", { formats: { sh: "decimal:1" } }))[0]).toBe("Apollo=100.0");
		const h = runView(view(share("total", { highlight: [{ target: "row", when: { all: [{ field: "sh", op: ">=", value: 100 }] }, style: { fill: "red" } }] })), ROWS, ctx);
		expect(h.highlightCounts).toEqual([1]);
		const f = runView(view(share("total", { columns: ["status", { rollup: { via: "field:team", agg: "count", show: "total" }, label: "Share", id: "sh" }, { formula: "[Share] * 10", label: "F", id: "f" }] })), ROWS, ctx);
		expect(f.rows.map((r) => r.cells.f.value)).toEqual([20, 0, 0, 0]);
	});

	it("tiny and empty shares", () => {
		expect(shareCell({ value: 1, text: "1", sort: 1 }, 1000)).toEqual({ value: 0.1, text: "< 1%", sort: 0.1, raw: 1 });
		expect(shareCell({ value: 3, text: "3", sort: 3 }, 0)).toEqual({ value: null, text: "", sort: null, raw: 3 });
		expect(shareCell({ value: null, text: "", sort: null }, 10).text).toBe("");
	});
});
