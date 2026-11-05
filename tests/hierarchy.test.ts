import { describe, expect, it } from "vitest";
import moment from "moment";
import { isoDateAdapter } from "../src/model/dates";
import type { MomentLike } from "../src/model/formats";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import { availableColumns, columnFromId, hierarchyOf, parentOf, parseView, runView, serializeView, type LinkValue, type ViewContext, type ViewRow } from "../src/model/views";

const GROUPS: GroupDef[] = [{ key: "work", name: "Work", icon: "x", statuses: ["todo", "done"] }];
const rel = (key: string, label: string, targets: string[]): FieldDef => ({ key, label, kind: "relation", targets });
const type = (key: string, fields: FieldDef[], parentFields?: string[]): EntityTypeDef =>
	({ key, name: key, plural: `${key}s`, icon: "x", color: "", group: "work", template: "", fields, ...(parentFields ? { parentFields } : {}) }) as EntityTypeDef;
const PROJECT = type("project", [rel("parent_project", "Parent project", ["project"])], ["parent_project"]);
const MILESTONE = type("milestone", [rel("project", "Project", ["project"])], ["project"]);
const TASK = type("task", [rel("milestone", "Milestone", ["milestone"]), rel("project", "Project", ["project"])], ["milestone", "project"]);
const NOTE = type("note", [rel("about", "About", ["*"])]);
const TYPES = [PROJECT, MILESTONE, TASK, NOTE];

const row = (name: string, t: EntityTypeDef, fm: Record<string, unknown>): ViewRow => ({ path: `${name}.md`, name, type: t, status: "todo", subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null, frontmatter: fm });
const ROWS = [
	row("Programme", PROJECT, {}),
	row("Portal", PROJECT, { parent_project: "[[Programme]]" }),
	row("Beta", MILESTONE, { project: "[[Portal]]" }),
	row("Review", TASK, { milestone: "[[Beta]]", project: "[[Portal]]" }),
	row("Loose", TASK, { milestone: "[[Missing]]", project: "[[Portal]]" }),
	row("Orphan", TASK, {}),
	row("Loop A", PROJECT, { parent_project: "[[Loop B]]" }),
	row("Loop B", PROJECT, { parent_project: "[[Loop A]]" }),
	row("Memo", NOTE, { about: "[[Portal]]" }),
];
const byPath = new Map(ROWS.map((r) => [r.path, r]));
const ctx: ViewContext = {
	types: TYPES,
	groups: GROUPS,
	dates: isoDateAdapter,
	today: 0,
	resolve: (p) => (byPath.has(`${p}.md`) ? `${p}.md` : null),
	row: (p) => byPath.get(p),
	incoming: () => [],
	moment: moment as unknown as MomentLike,
	locale: "en-AU",
	currency: "AUD",
	dateFormat: "DD/MM/YYYY",
};
const r = (name: string) => byPath.get(`${name}.md`)!;
const run = (raw: Record<string, unknown>) => runView(parseView({ kind: "table", ...raw }).def!, ROWS, ctx);
const names = (v: unknown) => (v as LinkValue[]).map((l) => l.name);

describe("hierarchy built-ins", () => {
	it("find the parent as the browser does: the first parent field linking to an entity", () => {
		expect(parentOf(r("Review"), ctx)?.name).toBe("Beta");
		expect(parentOf(r("Loose"), ctx)?.name).toBe("Portal");
		expect(parentOf(r("Orphan"), ctx)).toBeUndefined();
		expect(parentOf(r("Memo"), ctx)).toBeUndefined();
		expect(hierarchyOf(r("Review"), ctx).map((x) => x.name)).toEqual(["Beta", "Portal", "Programme"]);
		expect(hierarchyOf(r("Loop A"), ctx).map((x) => x.name)).toEqual(["Loop B"]);
	});

	it("show Parent, Top-level parent and Ancestors", () => {
		const res = run({ types: ["task"], columns: ["name", "tree-parent", "tree-root", "tree-path"] });
		const cells = Object.fromEntries(res.rows.map((x) => [x.row.name, x.cells]));
		expect(names(cells.Review["tree-parent"].value)).toEqual(["Beta"]);
		expect(names(cells.Review["tree-root"].value)).toEqual(["Programme"]);
		expect(cells.Review["tree-path"].text).toBe("Programme › Portal › Beta");
		expect(cells.Review["tree-path"].chain?.map((l) => l.path)).toEqual(["Programme.md", "Portal.md", "Beta.md"]);
		expect(names(cells.Loose["tree-root"].value)).toEqual(["Programme"]);
		expect(cells.Orphan["tree-parent"].value).toEqual([]);
		expect(cells.Orphan["tree-path"].text).toBe("");
		expect(res.columns.map((c) => [c.label, c.kind, c.editable])).toEqual([
			["Name", "text", false],
			["Parent", "links", false],
			["Top-level parent", "links", false],
			["Ancestors", "text", false],
		]);
		expect(serializeView(parseView({ types: ["task"], columns: ["name", "tree-parent"] }).def!).columns).toEqual(["name", "tree-parent"]);
	});

	it("filter, sort and group like link columns", () => {
		const f = run({ types: ["task"], filters: { all: [{ field: "tree-parent", op: "links-any", value: ["Beta.md"] }] } });
		expect(f.rows.map((x) => x.row.name)).toEqual(["Review"]);
		const g = run({ types: ["task"], group: [{ by: "tree-parent" }] });
		expect(g.groups!.map((x) => `${x.label}:${x.rows.map((y) => y.row.name).join(",")}`)).toEqual(["Beta:Review", "Portal:Loose", ":Orphan"]);
		const s = run({ types: ["task"], columns: ["name", "tree-path"], sort: [{ by: "tree-path" }] });
		expect(s.rows.map((x) => x.row.name)).toEqual(["Loose", "Review", "Orphan"]);
	});

	it("work in formulas", () => {
		const res = run({ types: ["task"], columns: ["name", { formula: "name(first([Parent]))", label: "P", id: "p" }, { formula: "[Ancestors]", label: "A", id: "a" }] });
		const review = res.rows.find((x) => x.row.name === "Review")!;
		expect(review.cells.p.text).toBe("Beta");
		expect(review.cells.a.text).toBe("Programme › Portal › Beta");
	});

	it("are offered only when a source type has parent fields", () => {
		const ids = (types: string[]) => availableColumns(parseView({ types }).def!, ctx).builtins.map((c) => c.id);
		expect(ids(["task"])).toEqual(expect.arrayContaining(["tree-parent", "tree-root", "tree-path"]));
		expect(ids(["note"])).not.toContain("tree-parent");
		expect(columnFromId("tree-parent")).toEqual({ kind: "builtin", id: "tree-parent", key: "tree-parent" });
	});
});
