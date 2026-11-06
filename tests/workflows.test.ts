import { describe, expect, it } from "vitest";
import moment from "moment";
import { isoDateAdapter } from "../src/model/dates";
import type { MomentLike } from "../src/model/formats";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import type { ViewContext, ViewRow } from "../src/model/views";
import {
	changeMatches,
	fixedFromFormula,
	formulaFromFixed,
	newWorkflow,
	parseTemplate,
	passesWhen,
	readWorkflows,
	runSteps,
	storedValue,
	triggerText,
	workflowFields,
	workflowProblems,
	type WorkflowDef,
} from "../src/model/workflows";

const GROUPS: GroupDef[] = [{ key: "work", name: "Work", icon: "x", statuses: ["todo", "doing", "done"] }];
const f = (key: string, label: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const type = (key: string, fields: FieldDef[]): EntityTypeDef => ({ key, name: key[0].toUpperCase() + key.slice(1), plural: `${key}s`, icon: "x", color: "", group: "work", template: "", fields }) as EntityTypeDef;
const PROJECT = type("project", [f("budget", "Budget", "number")]);
const TASK = type("task", [
	f("due", "Due", "date"),
	f("completed", "Completed", "date"),
	f("priority", "Priority", "select", { options: ["Low", "High"] }),
	f("labels", "Labels", "multiselect", { options: ["bug", "feature"] }),
	f("estimate", "Estimate", "number"),
	f("alive", "Alive", "boolean"),
	f("project", "Project", "relation", { targets: ["project"] }),
	f("people", "People", "relation", { targets: ["*"], multiple: true }),
	f("double", "Double", "formula", { formula: "[Estimate] * 2" }),
]);
const TYPES = [PROJECT, TASK];

const row = (name: string, t: EntityTypeDef, fm: Record<string, unknown>, status: string | null = "todo"): ViewRow => ({ path: `${name}.md`, name, type: t, status, subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null, frontmatter: { status, ...fm } });
const ROWS = [row("Apollo", PROJECT, { budget: 10 }), row("Zeus", PROJECT, {}), row("Write docs", TASK, { estimate: 3, project: "[[Apollo]]", priority: "Low" })];
const byPath = new Map(ROWS.map((r) => [r.path, r]));
const today = (isoDateAdapter.parse("2026-11-06") as { value: number }).value;
const ctx: ViewContext = {
	types: TYPES,
	groups: GROUPS,
	dates: isoDateAdapter,
	today,
	resolve: (p) => (byPath.has(`${p}.md`) ? `${p}.md` : byPath.has(p) ? p : null),
	row: (p) => byPath.get(p),
	incoming: () => [],
	moment: moment as unknown as MomentLike,
	locale: "en-AU",
	currency: "AUD",
	dateFormat: "DD/MM/YYYY",
};
const linkText = (p: string) => p.replace(/\.md$/, "");
const wf = (over: Partial<WorkflowDef>): WorkflowDef => ({ ...newWorkflow(["task"]), ...over });
const run = (w: WorkflowDef, r: ViewRow, old?: ViewRow) => runSteps(w, { ctx, row: r, old, linkText });

describe("workflow definitions", () => {
	it("read saved workflows, tidying what doesn't fit", () => {
		const ws = readWorkflows([
			{ id: "a", name: "One", scope: ["task"], trigger: { kind: "changed", field: "status", to: ["done"], from: [] }, steps: [{ kind: "set", field: "completed", value: "today()" }, { kind: "explode" }] },
			{ id: "a", on: false, trigger: { kind: "manual", label: "Go" } },
			"junk",
		]);
		expect(ws).toHaveLength(2);
		expect(ws[0]).toMatchObject({ id: "a", name: "One", on: true, trigger: { kind: "changed", field: "status", to: ["done"] }, when: { mode: "all", items: [] } });
		expect(ws[0].trigger).not.toHaveProperty("from");
		expect(ws[0].steps).toEqual([{ kind: "set", field: "completed", value: "today()" }]);
		expect(ws[1].id).not.toBe("a");
		expect(ws[1]).toMatchObject({ name: "Workflow", on: false, scope: [], trigger: { kind: "manual", label: "Go" } });
	});

	it("list the fields a workflow can use: status, the scoped types' stored fields, tags", () => {
		expect(workflowFields({ scope: ["task"] }, TYPES).map((x) => x.key)).toEqual(["status", "due", "completed", "priority", "labels", "estimate", "alive", "project", "people", "tags"]);
	});

	it("put triggers in words", () => {
		expect(triggerText(wf({ trigger: { kind: "changed", field: "status", to: ["done"] } }), TYPES)).toBe("When Status changes to “done”");
		expect(triggerText(wf({ trigger: { kind: "changed", field: "alive", from: ["true"], to: ["false"] } }), TYPES)).toBe("When Alive changes from “true” to “false”");
		expect(triggerText(wf({ trigger: { kind: "changed", field: "due", to: "filled" } }), TYPES)).toBe("When Due is filled in");
		expect(triggerText(wf({ trigger: { kind: "created" } }), TYPES)).toBe("When a task is created");
		expect(triggerText(wf({ name: "Ship", trigger: { kind: "manual" } }), TYPES)).toBe("Button: Ship");
	});
});

describe("matching changes", () => {
	const t = (to?: string[] | "filled" | "empty", from?: string[], field = "status") => ({ kind: "changed" as const, field, ...(to ? { to } : {}), ...(from ? { from } : {}) });
	it("status and choices: to and from values, ignoring case; no change, no match", () => {
		expect(changeMatches(t(["done"]), { status: "todo" }, { status: "done" }, TASK)).toBe(true);
		expect(changeMatches(t(["Done"]), { status: "todo" }, { status: "done" }, TASK)).toBe(true);
		expect(changeMatches(t(["done"]), { status: "todo" }, { status: "doing" }, TASK)).toBe(false);
		expect(changeMatches(t(["done"], ["doing"]), { status: "todo" }, { status: "done" }, TASK)).toBe(false);
		expect(changeMatches(t(), { status: "done" }, { status: "done" }, TASK)).toBe(false);
		expect(changeMatches(t(undefined, undefined, "priority"), { priority: "Low" }, { priority: "High" }, TASK)).toBe(true);
	});

	it("checkboxes: unticked counts as false, even when the key is missing", () => {
		expect(changeMatches(t(["false"], ["true"], "alive"), { alive: true }, { alive: false }, TASK)).toBe(true);
		expect(changeMatches(t(["false"], ["true"], "alive"), { alive: true }, {}, TASK)).toBe(true);
		expect(changeMatches(t(undefined, undefined, "alive"), {}, { alive: false }, TASK)).toBe(false);
	});

	it("other fields: filled, emptied or any change; unknown fields never match", () => {
		expect(changeMatches(t("filled", undefined, "due"), { due: null }, { due: "2026-11-06" }, TASK)).toBe(true);
		expect(changeMatches(t("filled", undefined, "due"), { due: "2026-11-01" }, { due: "2026-11-06" }, TASK)).toBe(false);
		expect(changeMatches(t("filled", undefined, "due"), { due: "2026-11-05" }, { due: "" }, TASK)).toBe(false);
		expect(changeMatches(t("empty", undefined, "due"), { due: "2026-11-05" }, { due: "" }, TASK)).toBe(true);
		expect(changeMatches(t(undefined, undefined, "labels"), { labels: ["bug"] }, { labels: ["bug", "feature"] }, TASK)).toBe(true);
		expect(changeMatches(t(undefined, undefined, "nope"), {}, { nope: 1 }, TASK)).toBe(false);
	});

	it("check Only if on the note, with {this}", () => {
		const r = row("Write docs", TASK, { estimate: 3 });
		expect(passesWhen(wf({ when: { mode: "all", items: [{ field: "estimate", op: ">", value: 2 }] } }), r, ctx)).toBe(true);
		expect(passesWhen(wf({ when: { mode: "all", items: [{ field: "estimate", op: ">", value: 5 }] } }), r, ctx)).toBe(false);
		expect(passesWhen(wf({}), r, ctx)).toBe(true);
	});
});

describe("templates and problems", () => {
	it("split text and {formulas}, with {{ for a brace and braces inside quotes", () => {
		expect(parseTemplate("Session {[Number] + 1} of {{campaign}}")).toEqual([{ text: "Session " }, { formula: "[Number] + 1", from: 9 }, { text: " of {campaign}" }]);
		expect(parseTemplate('{concat("}", [Name])}!')).toEqual([{ formula: 'concat("}", [Name])', from: 1 }, { text: "!" }]);
		expect(() => parseTemplate("Oops {[Name]")).toThrow(/no closing/);
	});

	it("report what keeps a workflow from running", () => {
		const at = (w: WorkflowDef) => workflowProblems(w, ctx).map((p) => `${p.at}: ${p.message}`);
		expect(at(wf({ steps: [{ kind: "set", field: "completed", value: "today()" }] }))).toEqual([]);
		expect(at(wf({ scope: [], steps: [{ kind: "notice", text: "hi" }] }))).toEqual(["scope: Choose the types this workflow watches."]);
		expect(at(wf({ trigger: { kind: "changed", field: "double" }, steps: [{ kind: "notice", text: "x" }] }))[0]).toMatch(/calculated/);
		expect(at(wf({ steps: [] }))).toEqual(["steps: Add a step."]);
		const bad = at(
			wf({
				steps: [
					{ kind: "set", field: "nope", value: "1" },
					{ kind: "set", field: "due", value: "[Nope] + 1" },
					{ kind: "link", op: "add", field: "due", target: "[Project]" },
					{ kind: "notice", text: "Done {[Name]" },
					{ kind: "set", field: "double", value: "1" },
					{ kind: "set", field: "estimate", value: "old([Estimate]) + new([Estimate])" },
				],
			}),
		);
		expect(bad[0]).toMatch(/^step:0: None of the types has a “nope” field/);
		expect(bad[1]).toMatch(/^step:1: .*Nope/);
		expect(bad[2]).toMatch(/^step:2: Due isn't a link field/);
		expect(bad[3]).toMatch(/^step:3: .*closing/);
		expect(bad[4]).toMatch(/^step:4: Double is calculated/);
		expect(bad.some((x) => x.startsWith("step:5"))).toBe(false);
		expect(at(wf({ scope: ["nope"], trigger: { kind: "manual" }, steps: [{ kind: "tag", op: "add", tag: "x" }] }))).toEqual(["scope: “nope” isn't a type or group."]);
	});
});

describe("values and steps", () => {
	const fields = Object.fromEntries(workflowFields({ scope: ["task"] }, TYPES).map((x) => [x.key, x]));
	const r = ROWS[2];
	const sv = (key: string, v: unknown) => storedValue(fields[key], v as never, r, ctx, linkText);

	it("convert formula results to stored values", () => {
		expect(sv("priority", "high")).toEqual({ value: "High" });
		expect(sv("priority", "urgent")).toEqual({ error: "“urgent” isn't one of Priority's choices." });
		expect(sv("status", "DONE")).toEqual({ value: "done" });
		expect(sv("status", "lost")).toEqual({ error: "Task has no status “lost”." });
		expect(sv("estimate", "4.5")).toEqual({ value: 4.5 });
		expect(sv("estimate", "lots")).toEqual({ error: "“lots” isn't a number." });
		expect(sv("due", "2026-12-01")).toEqual({ value: "2026-12-01" });
		expect(sv("labels", ["Bug", "feature"])).toEqual({ value: ["bug", "feature"] });
		expect(sv("alive", 0)).toEqual({ value: false });
		expect(sv("project", "Zeus")).toEqual({ value: "[[Zeus]]" });
		expect(sv("project", [{ path: "Apollo.md", linktext: "Apollo", name: "Apollo" }])).toEqual({ value: "[[Apollo]]" });
		expect(sv("people", ["Apollo", "Zeus"])).toEqual({ value: ["[[Apollo]]", "[[Zeus]]"] });
		expect(sv("project", "Nobody")).toEqual({ error: "No note called “Nobody”." });
		expect(sv("due", null)).toEqual({ value: null });
	});

	it("run steps in order, each seeing the ones before", () => {
		const res = run(
			wf({
				steps: [
					{ kind: "set", field: "completed", value: "today()" },
					{ kind: "set", field: "estimate", value: "[Estimate] * 2" },
					{ kind: "set", field: "priority", value: 'if([Estimate] > 5, "High", "Low")' },
					{ kind: "tag", op: "add", tag: "#shipped" },
					{ kind: "link", op: "add", field: "people", target: '"Zeus"' },
					{ kind: "set", field: "status", value: '"done"' },
					{ kind: "notice", text: "{[Name]} done on {format([Completed], \"D MMM\")} ({[Estimate]} h)" },
				],
			}),
			r,
		);
		expect(res.error).toBeUndefined();
		expect(res.fm).toMatchObject({ completed: "2026-11-06", estimate: 6, priority: "High", tags: ["shipped"], people: ["[[Zeus]]"], status: "done" });
		expect(res.changes.map((c) => c.key).sort()).toEqual(["completed", "estimate", "people", "priority", "status", "tags"]);
		expect(res.notices).toEqual(["Write docs done on 6 Nov (6 h)"]);
		expect(r.frontmatter.estimate).toBe(3);
	});

	it("stop at a failing step, changing nothing", () => {
		const res = run(wf({ steps: [{ kind: "set", field: "estimate", value: "9" }, { kind: "set", field: "priority", value: '"Urgent"' }] }), r);
		expect(res.error).toEqual({ step: 1, message: "“Urgent” isn't one of Priority's choices." });
		expect(res.changes).toEqual([]);
		expect(res.fm.estimate).toBe(3);
	});

	it("give old() the value before the change, and remove links", () => {
		const before = row("Write docs", TASK, { estimate: 2, project: "[[Apollo]]" });
		const after = row("Write docs", TASK, { estimate: 5, project: "[[Apollo]]" });
		const res = run(wf({ steps: [{ kind: "notice", text: "{new([Estimate]) - old([Estimate])} more" }, { kind: "link", op: "remove", field: "project", target: "[Project]" }] }), after, before);
		expect(res.notices).toEqual(["3 more"]);
		expect(res.fm.project ?? null).toBeNull();
	});
});

describe("fixed values", () => {
	const fields = Object.fromEntries(workflowFields({ scope: ["task"] }, TYPES).map((x) => [x.key, x]));
	const r = ROWS[2];

	it("turn plain formulas into fixed values, by the field's kind", () => {
		expect(fixedFromFormula('"High"', fields.priority)).toBe("High");
		expect(fixedFromFormula('"bug"', fields.labels)).toEqual(["bug"]);
		expect(fixedFromFormula("5", fields.estimate)).toBe(5);
		expect(fixedFromFormula("true", fields.alive)).toBe(true);
		expect(fixedFromFormula("today()", fields.due)).toBe("today");
		expect(fixedFromFormula("today() + 7", fields.due)).toBe("+7d");
		expect(fixedFromFormula("today()-3", fields.due)).toBe("-3d");
		expect(fixedFromFormula('"2026-12-01"', fields.due)).toBe("2026-12-01");
		for (const [src, k] of [["[Start] + 7", "due"], ['"5"', "estimate"], ['concat("a", "b")', "priority"], ['"Apollo"', "project"], ["5", "priority"]] as const) expect(fixedFromFormula(src, fields[k])).toBeUndefined();
	});

	it("write fixed values back as formulas", () => {
		expect(formulaFromFixed("High", fields.priority)).toBe('"High"');
		expect(formulaFromFixed(["bug", "feature"], fields.labels)).toBe('list("bug", "feature")');
		expect(formulaFromFixed(5, fields.estimate)).toBe("5");
		expect(formulaFromFixed(false, fields.alive)).toBe("false");
		expect(formulaFromFixed("+7d", fields.due)).toBe("today() + 7");
		expect(formulaFromFixed("-2w", fields.due)).toBe("today() - 14");
		expect(formulaFromFixed("1m", fields.due)).toBe('dateAdd(today(), 1, "months")');
		expect(formulaFromFixed(["Apollo.md"], fields.project)).toBe('"Apollo"');
		expect(formulaFromFixed("", fields.priority)).toBe("");
	});

	it("convert plain saved formulas when read with the types", () => {
		const [w] = readWorkflows(
			[{ id: "a", name: "A", scope: ["task"], trigger: { kind: "manual" }, steps: [{ kind: "set", field: "priority", value: '"High"' }, { kind: "set", field: "due", value: "[Completed] + 1" }, { kind: "set", field: "estimate", fixed: 4, value: "" }] }],
			TYPES,
		);
		expect(w.steps).toEqual([
			{ kind: "set", field: "priority", value: "", fixed: "High" },
			{ kind: "set", field: "due", value: "[Completed] + 1" },
			{ kind: "set", field: "estimate", value: "", fixed: 4 },
		]);
	});

	it("run fixed values: choices, numbers, checkboxes, relative dates, notes", () => {
		const res = run(
			wf({
				steps: [
					{ kind: "set", field: "priority", value: "", fixed: "high" },
					{ kind: "set", field: "labels", value: "", fixed: ["bug"] },
					{ kind: "set", field: "estimate", value: "", fixed: 8 },
					{ kind: "set", field: "alive", value: "", fixed: false },
					{ kind: "set", field: "due", value: "", fixed: "+7d" },
					{ kind: "set", field: "project", value: "", fixed: ["Zeus.md"] },
					{ kind: "link", op: "add", field: "people", target: "", fixed: ["Apollo.md"] },
				],
			}),
			r,
		);
		expect(res.error).toBeUndefined();
		expect(res.fm).toMatchObject({ priority: "High", labels: ["bug"], estimate: 8, alive: false, due: "2026-11-13", project: "[[Zeus]]", people: ["[[Apollo]]"] });
	});

	it("report fixed values that don't fit", () => {
		const at = (steps: WorkflowDef["steps"]) => workflowProblems(wf({ name: "x", steps }), ctx).map((p) => p.message);
		expect(at([{ kind: "set", field: "priority", value: "", fixed: "" }])).toEqual(["Choose or write the value."]);
		expect(at([{ kind: "set", field: "priority", value: "", fixed: "Urgent" }])).toEqual(["“Urgent” isn't one of Priority's choices."]);
		expect(at([{ kind: "set", field: "status", value: "", fixed: "archived" }])).toEqual(["None of these types has the status “archived”."]);
		expect(at([{ kind: "set", field: "alive", value: "", fixed: false }])).toEqual([]);
		expect(at([{ kind: "link", op: "add", field: "people", target: "", fixed: [] }])).toEqual(["Choose the note to link."]);
	});

	it("list() makes a list", () => {
		const res = run(wf({ steps: [{ kind: "set", field: "labels", value: 'list("bug", "feature")' }] }), r);
		expect(res.fm.labels).toEqual(["bug", "feature"]);
	});
});