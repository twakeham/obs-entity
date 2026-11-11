import { describe, expect, it } from "vitest";
import { packWorkflows, parsePack, renameFormula } from "../src/model/packs";
import { exportPack, importAsDrafts } from "../src/model/typeEditing";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import { newWorkflow, stepAt, type WorkflowDef } from "../src/model/workflows";

const GROUPS: GroupDef[] = [{ key: "work", name: "Work", icon: "x", statuses: ["todo", "done"] }];
const f = (key: string, label: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const type = (key: string, fields: FieldDef[]): EntityTypeDef => ({ key, name: key[0].toUpperCase() + key.slice(1), plural: `${key}s`, icon: "x", color: "#000000", group: "work", template: "", fields, builtIn: false });
const PROJECT = type("project", [
	f("open", "Open tasks", "rollup", { rollup: { via: "in:task.project", agg: "count", where: { mode: "all", items: [{ field: "status", op: "is-not", value: "done" }, { mode: "any", items: [{ field: "in:task.project", op: "empty" }] }] } } }),
	f("share", "Share", "formula", { formula: "[open] / count([in:task.project])" }),
]);
const TASK = type("task", [f("project", "Project", "relation", { targets: ["project"] }), f("estimate", "Estimate", "number")]);
const wf = (over: Partial<WorkflowDef>): WorkflowDef => ({ ...newWorkflow(["task"]), name: "W", ...over });

describe("packs with workflows", () => {
	const closeOut = wf({ id: "wf-close", name: "Close out", scope: ["task"], trigger: { kind: "manual", label: "Close" }, steps: [{ kind: "set", field: "status", value: "", fixed: "done" }] });
	const onProject = wf({
		id: "wf-proj",
		name: "Project kick-off",
		scope: ["project"],
		trigger: { kind: "created" },
		when: { mode: "all", items: [{ field: "in:task.project", op: "empty" }] },
		steps: [
			{ kind: "create", type: "task", name: "{[Name]} kick-off ({{draft}}, {count([in:task.project])})", fields: [{ field: "estimate", value: "count([in:task.project]) + 1" }], link: { dir: "from-new", field: "project" }, template: true, open: "no", exists: "new", as: "New task" },
			{ kind: "linked", source: { dir: "in", type: "task", field: "project" }, when: { mode: "all", items: [{ field: "estimate", op: "gt", value: 1 }] }, as: "Task", steps: [{ kind: "run", workflow: "wf-close" }] },
			{ kind: "each", formula: "[in:task.project]", items: "notes", itemType: "task", when: { mode: "all", items: [] }, as: "Each", steps: [{ kind: "notice", text: "{[Each]}" }, { kind: "each", formula: "[in:task.project]", items: "notes", itemType: "task", when: { mode: "all", items: [] }, as: "Inner", steps: [{ kind: "var", name: "N", value: "count([in:task.project])" }] }] },
			{ kind: "notice", text: "{count([in:task.project])} tasks" },
		],
	});
	const other = wf({ id: "wf-other", name: "Elsewhere", scope: ["person"], steps: [{ kind: "tag", op: "add", tag: "x" }] });
	const anyNote = wf({ id: "wf-any", name: "Any", scope: [], trigger: { kind: "manual" }, steps: [{ kind: "tag", op: "add", tag: "y" }] });
	const ALL = [closeOut, onProject, other, anyNote];
	const PERSON = type("person", []);

	it("export a type's own workflows and the ones they run", () => {
		expect(packWorkflows([PROJECT], ALL, [PROJECT, TASK, PERSON]).map((w) => w.id)).toEqual(["wf-proj", "wf-close"]);
		expect(packWorkflows([TASK], ALL, [PROJECT, TASK, PERSON]).map((w) => w.id)).toEqual(["wf-close"]);
		expect(packWorkflows([PERSON], ALL, [PROJECT, TASK, PERSON]).map((w) => w.id)).toEqual(["wf-other"]);
		const pack = JSON.parse(exportPack([PROJECT, TASK], GROUPS, "Work", [onProject, closeOut]));
		expect(pack.workflows.map((w: WorkflowDef) => w.id)).toEqual(["wf-proj", "wf-close"]);
		expect(JSON.parse(exportPack([PROJECT], GROUPS)).workflows).toBeUndefined();
	});

	it("import with clashing keys and ids: every reference follows, and workflows come in off", () => {
		const text = exportPack([PROJECT, TASK], GROUPS, "Work", [onProject, closeOut]);
		const r = importAsDrafts(text, GROUPS, [PROJECT, TASK], [closeOut]);
		if ("error" in r) throw new Error(r.error);
		expect(r.renamed).toEqual({ project: "project_2", task: "task_2" });
		const [p2, t2] = r.types;
		expect(t2.fields[0].targets).toEqual(["project_2"]);
		expect(p2.fields[0].rollup).toEqual({ via: "in:task_2.project", agg: "count", where: { mode: "all", items: [{ field: "status", op: "is-not", value: "done" }, { mode: "any", items: [{ field: "in:task_2.project", op: "empty" }] }] } });
		expect(p2.fields[1].formula).toBe("[open] / count([in:task_2.project])");

		expect(r.workflows.map((w) => [w.name, w.on, w.scope])).toEqual([
			["Project kick-off", false, ["project_2"]],
			["Close out", false, ["task_2"]],
		]);
		const [kick, close] = r.workflows;
		// Close out's id was taken here: it gets a new one, and the step that runs it follows.
		expect(close.id).not.toBe("wf-close");
		expect(kick.id).toBe("wf-proj");
		expect(kick.when.items).toEqual([{ field: "in:task_2.project", op: "empty" }]);
		const [create, linked, each, notice] = kick.steps as [Extract<WorkflowDef["steps"][number], { kind: "create" }>, Extract<WorkflowDef["steps"][number], { kind: "linked" }>, Extract<WorkflowDef["steps"][number], { kind: "each" }>, Extract<WorkflowDef["steps"][number], { kind: "notice" }>];
		expect(create.type).toBe("task_2");
		expect(create.name).toBe("{[Name]} kick-off ({{draft}}, {count([in:task_2.project])})");
		expect(create.fields[0].value).toBe("count([in:task_2.project]) + 1");
		expect(linked.source).toEqual({ dir: "in", type: "task_2", field: "project" });
		expect(linked.steps[0]).toEqual({ kind: "run", workflow: close.id });
		expect(each.formula).toBe("[in:task_2.project]");
		expect(each.itemType).toBe("task_2");
		// Inside a loop inside a loop: a variable's formula follows too.
		expect(stepAt(kick.steps, "2.1.0")).toEqual({ kind: "var", name: "N", value: "count([in:task_2.project])" });
		expect(notice.text).toBe("{count([in:task_2.project])} tasks");
	});

	it("leave everything as written when nothing clashes", () => {
		const r = importAsDrafts(exportPack([PROJECT, TASK], GROUPS, "Work", [onProject]), GROUPS, []);
		if ("error" in r) throw new Error(r.error);
		expect(r.renamed).toEqual({});
		expect(r.types[0].fields[1].formula).toBe("[open] / count([in:task.project])");
		expect((r.workflows[0].steps[0] as { name: string }).name).toBe("{[Name]} kick-off ({{draft}}, {count([in:task.project])})");
		expect(r.workflows[0].on).toBe(false);
	});

	it("rename only the renamed types' references in formulas", () => {
		const keys = new Map([["task", "task_2"]]);
		expect(renameFormula('if([in:task.project] = "x",  [in:taskforce.lead], [Name])', keys)).toBe('if([in:task_2.project] = "x",  [in:taskforce.lead], [Name])');
		expect(renameFormula("[in:task.project", keys)).toBe("[in:task.project");
	});

	it("read packs with workflows: a list, each with steps; a pack of only workflows is fine", () => {
		expect(parsePack(JSON.stringify({ obsEntitiesPack: 1, types: [], workflows: [onProject] }))).toMatchObject({ ok: true });
		expect(parsePack(JSON.stringify({ obsEntitiesPack: 1, types: [], workflows: [] }))).toEqual({ ok: false, error: "The pack has no types." });
		expect(parsePack(JSON.stringify({ types: [TASK], workflows: {} }))).toEqual({ ok: false, error: "“workflows” should be a list." });
		expect(parsePack(JSON.stringify({ types: [TASK], workflows: [{ name: "Bad" }] }))).toEqual({ ok: false, error: "Workflow “Bad” has no steps list." });
	});
});
