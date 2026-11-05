import { describe, expect, it } from "vitest";
import moment from "moment";
import { choiceText, choiceTitle, choiceValue, choiceValueOf, hasValues, pruneValues } from "../src/model/choiceValues";
import { isoDateAdapter } from "../src/model/dates";
import type { MomentLike } from "../src/model/formats";
import { extractEdges } from "../src/model/relations";
import { summarize, summaryOptions } from "../src/model/summary";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import { calcCell, calcInfo, fieldColumn, parseView, resolveColumn, runView, typeViewDef, type ViewContext, type ViewRow } from "../src/model/views";

const GROUPS: GroupDef[] = [{ key: "work", name: "Work", icon: "x", statuses: ["todo", "doing", "done"] }];
const f = (key: string, label: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const PRIORITY = f("priority", "Priority", "select", { options: ["Low", "Medium", "High", "Someday"], valued: true, values: { Low: 1, Medium: 2, High: 3 } });
const TAGS = f("effort", "Effort", "multiselect", { options: ["Design", "Build", "Test"], valued: true, values: { Design: 2, Build: 5, Test: 1 } });
const PROJECT: EntityTypeDef = {
	key: "project",
	name: "Project",
	plural: "Projects",
	icon: "x",
	color: "",
	group: "work",
	template: "",
	fields: [
		f("total", "Total priority", "rollup", { rollup: { via: "in:task.project", agg: "sum", field: "priority" } }),
		f("top", "Top priority", "rollup", { rollup: { via: "in:task.project", agg: "max", field: "priority" } }),
	],
} as EntityTypeDef;
const TASK: EntityTypeDef = {
	key: "task",
	name: "Task",
	plural: "Tasks",
	icon: "x",
	color: "",
	group: "work",
	template: "",
	fields: [
		f("project", "Project", "relation", { targets: ["project"] }),
		PRIORITY,
		TAGS,
		f("score", "Score", "formula", { formula: "value([priority]) * 10" }),
		f("work", "Work", "formula", { formula: "value([effort])" }),
	],
} as EntityTypeDef;
const TYPES = [PROJECT, TASK];

const row = (name: string, type: EntityTypeDef, fm: Record<string, unknown>): ViewRow => ({ path: `${name}.md`, name, type, status: "todo", subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null, frontmatter: fm });
const ROWS = [
	row("Apollo", PROJECT, {}),
	row("T1", TASK, { project: "[[Apollo]]", priority: "High", effort: ["Design", "Build"] }),
	row("T2", TASK, { project: "[[Apollo]]", priority: "low", effort: ["Test"] }),
	row("T3", TASK, { project: "[[Apollo]]", priority: "Medium" }),
	row("T4", TASK, { priority: "Someday" }),
];
const byPath = new Map(ROWS.map((r) => [r.path, r]));
const resolve = (p: string) => (byPath.has(`${p}.md`) ? `${p}.md` : null);
const EDGES = ROWS.flatMap((r) => extractEdges(r.path, r.type, r.frontmatter, resolve));
const ctx: ViewContext = {
	types: TYPES,
	groups: GROUPS,
	dates: isoDateAdapter,
	today: (isoDateAdapter.parse("2026-11-01") as { value: number }).value,
	resolve: (p) => resolve(p),
	row: (p) => byPath.get(p),
	incoming: (p) => EDGES.filter((e) => e.target === p).map((e) => ({ source: e.source, sourceType: e.sourceType, fieldKey: e.fieldKey })),
	moment: moment as unknown as MomentLike,
	locale: "en-AU",
	currency: "AUD",
	dateFormat: "DD/MM/YYYY",
};
const calc = (name: string, k: string) => {
	const r = byPath.get(`${name}.md`)!;
	return calcCell(r, r.type.fields.find((x) => x.key === k)!, ctx).value;
};

describe("choice values", () => {
	it("look up a choice's value, matching the label exactly, else ignoring case", () => {
		expect(hasValues(PRIORITY)).toBe(true);
		expect(hasValues({ ...PRIORITY, valued: false })).toBe(false);
		expect(hasValues({ ...PRIORITY, kind: "text" })).toBe(false);
		expect(choiceValue(PRIORITY, "High")).toBe(3);
		expect(choiceValue(PRIORITY, "high")).toBe(3);
		expect(choiceValue(PRIORITY, "Someday")).toBeNull();
		expect(choiceValue({ ...PRIORITY, valued: false }, "High")).toBeNull();
	});

	it("give a note's value: the choice's, or the total for multiple choice", () => {
		expect(choiceValueOf(PRIORITY, "Medium")).toBe(2);
		expect(choiceValueOf(PRIORITY, "Someday")).toBeNull();
		expect(choiceValueOf(PRIORITY, null)).toBeNull();
		expect(choiceValueOf(TAGS, ["Design", "Build"])).toBe(7);
		expect(choiceValueOf(TAGS, ["Nope"])).toBeNull();
		expect(choiceValueOf(TAGS, [])).toBeNull();
	});

	it("show the value on pills only when asked, and always in the tooltip", () => {
		expect(choiceText(PRIORITY, "High")).toBe("High");
		expect(choiceText({ ...PRIORITY, showValues: true }, "High")).toBe("High: 3");
		expect(choiceText({ ...PRIORITY, showValues: true }, "Someday")).toBe("Someday");
		expect(choiceTitle(PRIORITY, "High")).toBe("High = 3");
		expect(choiceTitle(PRIORITY, "Someday")).toBeUndefined();
	});

	it("drop the values of removed choices", () => {
		expect(pruneValues({ Low: 1, High: 3 }, ["Low"])).toEqual({ Low: 1 });
		expect(pruneValues({ High: 3 }, ["Low"])).toBeUndefined();
		expect(pruneValues(undefined, ["Low"])).toBeUndefined();
	});

	it("feed formulas through value()", () => {
		expect(calc("T1", "score")).toBe(30);
		expect(calc("T2", "score")).toBe(10);
		expect(calc("T4", "score")).toBeNull();
		expect(calc("T1", "work")).toBe(7);
		expect(calcInfo(TASK, f("bad", "Bad", "formula", { formula: "value(1)" }), ctx).invalid).toMatch(/value\(\)/);
	});

	it("feed roll-ups (sum, max) with the linked notes' values", () => {
		expect(calc("Apollo", "total")).toBe(6);
		expect(calc("Apollo", "top")).toBe(3);
	});

	it("sort views by value and offer number summaries", () => {
		const { def } = parseView({ kind: "table", types: ["task"], columns: ["name", "priority", "effort"], sort: [{ by: "priority", dir: "desc" }] });
		const res = runView(def!, ROWS, ctx);
		expect(res.rows.map((r) => r.row.name)).toEqual(["T1", "T3", "T2", "T4"]);
		expect(res.rows[0].cells.priority.num).toBe(3);
		expect(res.rows[0].cells.effort.num).toBe(7);

		const col = resolveColumn(fieldColumn("priority"), typeViewDef(TASK), ctx);
		expect(summaryOptions(col).map((o) => o.key)).toContain("sum");
		expect(summarize(res.rows, col, "sum", ctx)?.text).toBe("6");
		expect(summarize(res.rows, col, "avg", ctx)?.text).toBe("2");
		const effort = resolveColumn(fieldColumn("effort"), typeViewDef(TASK), ctx);
		expect(summarize(res.rows, effort, "sum", ctx)?.text).toBe("8");

		const unvalued = { ...TASK, fields: [{ ...PRIORITY, valued: false }] } as EntityTypeDef;
		const plain = resolveColumn(fieldColumn("priority"), typeViewDef(unvalued), { ...ctx, types: [PROJECT, unvalued] });
		expect(summaryOptions(plain).map((o) => o.key)).not.toContain("sum");
	});
});
