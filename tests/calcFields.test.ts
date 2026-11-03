import { describe, expect, it } from "vitest";
import moment from "moment";
import { isoDateAdapter } from "../src/model/dates";
import type { MomentLike } from "../src/model/formats";
import { buildFrontmatter } from "../src/model/frontmatter";
import { checkField } from "../src/model/form";
import { extractEdges } from "../src/model/relations";
import { fieldChanges, makeDraft, renameFieldRefs } from "../src/model/typeEditing";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import { typeIssues } from "../src/model/validation";
import { calcCell, calcInfo, fieldColumn, formatCell, parseView, resolveColumn, runView, typeViewDef, type ViewContext, type ViewRow } from "../src/model/views";

const GROUPS: GroupDef[] = [{ key: "work", name: "Work", icon: "x", statuses: ["todo", "doing", "done"] }];
const f = (key: string, label: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const PROJECT: EntityTypeDef = {
	key: "project",
	name: "Project",
	plural: "Projects",
	icon: "x",
	color: "",
	group: "work",
	template: "",
	fields: [
		f("budget", "Budget", "number"),
		f("due", "Due", "date"),
		f("task_count", "Task count", "rollup", { rollup: { via: "in:task.project", agg: "count" } }),
		f("est_total", "Estimate total", "rollup", { rollup: { via: "in:task.project", agg: "sum", field: "estimate" }, format: "#,##0 h" }),
		f("double_total", "Double total", "rollup", { rollup: { via: "in:task.project", agg: "sum", field: "est_double" } }),
		f("per_task", "Budget per task", "formula", { formula: "[budget] / [task_count]", format: "currency" }),
		f("days_left", "Days left", "formula", { formula: "[due] - today()" }),
		f("big", "Big", "formula", { formula: "[budget] > 1000", format: "yesno" }),
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
	fields: [f("project", "Project", "relation", { targets: ["project"] }), f("estimate", "Estimate", "number"), f("est_double", "Double estimate", "formula", { formula: "[estimate] * 2" })],
} as EntityTypeDef;
const TYPES = [PROJECT, TASK];

const row = (name: string, type: EntityTypeDef, fm: Record<string, unknown>): ViewRow => ({ path: `${name}.md`, name, type, status: "todo", subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null, frontmatter: fm });
const ROWS = [
	row("Apollo", PROJECT, { budget: 3000, due: "2026-11-11" }),
	row("Small", PROJECT, { budget: 500 }),
	row("T1", TASK, { project: "[[Apollo]]", estimate: 4 }),
	row("T2", TASK, { project: "[[Apollo]]", estimate: 6 }),
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
const field = (t: EntityTypeDef, k: string) => t.fields.find((x) => x.key === k)!;
const calc = (name: string, k: string) => {
	const r = byPath.get(`${name}.md`)!;
	return calcCell(r, field(r.type, k), ctx);
};

describe("calculated fields", () => {
	it("work out roll-ups, including over the linked notes' own calculated fields", () => {
		expect(calc("Apollo", "task_count").value).toBe(2);
		expect(calc("Apollo", "est_total").value).toBe(10);
		expect(calc("Apollo", "double_total").value).toBe(20);
		expect(calc("Small", "task_count").value).toBe(0);
		expect(calc("T1", "est_double").value).toBe(8);
	});

	it("work out formulas that use fields and other calculated fields", () => {
		expect(calc("Apollo", "per_task").value).toBe(1500);
		expect(calc("Apollo", "days_left").value).toBe(10);
		expect(calc("Apollo", "big").value).toBe(true);
		expect(calc("Apollo", "big").text).toBe("Yes");
		expect(calc("Small", "big").text).toBe("No");
		// Dividing by a zero count: an error on the cell, not a crash.
		const small = calc("Small", "per_task");
		expect(small.value === null || small.error !== undefined || !Number.isFinite(small.value as number)).toBe(true);
	});

	it("are view columns: kinds, formats, sorting and filtering", () => {
		const col = resolveColumn(fieldColumn("per_task"), typeViewDef(PROJECT), ctx);
		expect(col.kind).toBe("number");
		expect(col.editable).toBe(false);
		expect(resolveColumn(fieldColumn("big"), typeViewDef(PROJECT), ctx).kind).toBe("bool");
		expect(formatCell(calc("Apollo", "per_task"), col, undefined, ctx).text).toBe("$1,500.00");
		const est = resolveColumn(fieldColumn("est_total"), typeViewDef(PROJECT), ctx);
		expect(formatCell(calc("Apollo", "est_total"), est, undefined, ctx).text).toBe("10 h");
		const { def } = parseView({ kind: "table", types: ["project"], columns: ["name", "task_count", "est_total"], sort: [{ by: "task_count", dir: "desc" }], filters: { all: [{ field: "task_count", op: ">", value: 0 }] } });
		const res = runView(def!, ROWS, ctx);
		expect(res.rows.map((r) => r.row.name)).toEqual(["Apollo"]);
		expect(res.rows[0].cells.est_total.text).toBe("10 h");
	});

	it("flag problems: loops, missing relationships and empty formulas", () => {
		const loop: EntityTypeDef = { ...PROJECT, fields: [f("a", "A", "formula", { formula: "[b] + 1" }), f("b", "B", "formula", { formula: "[a] + 1" })] };
		expect(calcInfo(loop, loop.fields[0], { types: [loop, TASK], groups: GROUPS }).invalid).toMatch(/Circular reference: A → B → A/);
		const bad = f("x", "X", "rollup", { rollup: { via: "in:task.nope", agg: "count" } });
		expect(calcInfo(PROJECT, bad, ctx).invalid).toMatch(/doesn't exist/);
		expect(calcInfo(PROJECT, f("y", "Y", "formula", { formula: "" }), ctx).invalid).toMatch(/empty/);
		const issues = typeIssues(loop, { typeKeys: ["project", "task"], groupKeys: ["work"], types: [TASK], groups: GROUPS });
		expect(issues.filter((i) => i.at.endsWith(":calc")).length).toBe(2);
		// Without the other types, calculated fields aren't checked.
		expect(typeIssues(loop, { typeKeys: [], groupKeys: ["work"] }).some((i) => i.at.endsWith(":calc"))).toBe(false);
	});

	it("aren't stored: not written, not checked, no note migrations", () => {
		const fm = buildFrontmatter(PROJECT, { name: "P", status: "todo", tags: [], fields: { budget: 1 } });
		expect(Object.keys(fm)).not.toContain("task_count");
		expect(Object.keys(fm)).toContain("budget");
		expect(checkField({ ...field(PROJECT, "task_count"), required: true }, undefined, { types: TYPES, resolve: () => null } as never)).toEqual([]);
		const d = makeDraft(PROJECT);
		d.type.fields[2].key = "tasks";
		d.type.fields.splice(3, 1);
		d.meta.splice(3, 1);
		expect(fieldChanges(d)).toEqual({ renames: [], deleted: [] });
	});

	it("follow a renamed field in formulas and roll-ups", () => {
		const t = JSON.parse(JSON.stringify(PROJECT)) as EntityTypeDef;
		t.fields.push(f("lead", "Lead", "relation"), f("lead_count", "Lead count", "rollup", { rollup: { via: "field:lead", agg: "count" } }));
		renameFieldRefs(t, "budget", "money");
		expect(field(t, "per_task").formula).toBe("[money] / [task_count]");
		renameFieldRefs(t, "lead", "leader");
		expect(field(t, "lead_count").rollup!.via).toBe("field:leader");
	});
});
