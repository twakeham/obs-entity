import { describe, expect, it } from "vitest";
import moment from "moment";
import { isoDateAdapter } from "../src/model/dates";
import type { MomentLike } from "../src/model/formats";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import type { ViewContext, ViewRow } from "../src/model/views";
import {
	asksQuestion,
	BIG_RUN,
	changeMatches,
	dateCheckDue,
	dateReached,
	dueAt,
	folderPath,
	isBigRun,
	isTimed,
	linkedSources,
	movedText,
	nextDue,
	NO_NOTE,
	ON_THIS,
	runsOnce,
	SELECTION_VAR,
	reachText,
	runReach,
	stepScopes,
	createLinkOptions,
	newCreateStep,
	fixedFromFormula,
	formulaFromFixed,
	newWorkflow,
	parseTemplate,
	passesWhen,
	readWorkflows,
	runSteps,
	flatSteps,
	mapStepAt,
	stepAt,
	stepLabel,
	storedValue,
	triggerText,
	workflowFields,
	workflowProblems,
	type Placed,
	type PlaceRequest,
	type DateTrigger,
	type ScheduleTrigger,
	type WorkflowDef,
	type WorkflowStep,
	type IfStep,
	type FindStep,
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
		expect(bad[0]).toMatch(/^step:0: Task has no “nope” field/);
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
		expect(res.error).toEqual({ step: "1", message: "“Urgent” isn't one of Priority's choices." });
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

describe("create a note", () => {
	const apollo = ROWS[0];
	const place = (req: PlaceRequest): Placed =>
		req.exists === "stop" ? { stop: `${req.name} already exists.` } : req.exists === "use" ? { path: "Write docs.md", existing: ROWS[2] } : { path: `Tasks/${req.name}.md` };
	const runP = (w: WorkflowDef, r: ViewRow) => runSteps(w, { ctx, row: r, linkText, place });
	const create = (over: Partial<Extract<WorkflowDef["steps"][number], { kind: "create" }>> = {}) =>
		({ kind: "create", type: "task", name: "{[Name]} kickoff", fields: [], link: { dir: "from-new", field: "project" }, template: true, open: "no", exists: "new", as: "Kickoff", ...over }) as Extract<WorkflowDef["steps"][number], { kind: "create" }>;

	it("offer link fields both ways, and a new step that links back", () => {
		const o = createLinkOptions({ scope: ["project"] }, "task", TYPES);
		expect(o.fromNew.map((f) => f.key)).toEqual(["project", "people"]);
		expect(o.toNew).toEqual([]);
		expect(createLinkOptions({ scope: ["task"] }, "project", TYPES).toNew.map((f) => f.key)).toEqual(["project", "people"]);
		const s = newCreateStep({ scope: ["project"], steps: [], trigger: { kind: "manual" } }, TYPES);
		expect(s).toMatchObject({ type: "task", link: { dir: "from-new", field: "project" }, as: "New task", open: "tab", exists: "new" });
	});

	it("create a note with fields and a link back; later steps act on it and refer to it", () => {
		const w = wf({
			scope: ["project"],
			steps: [
				create({ fields: [{ field: "priority", value: "", fixed: "High" }, { field: "due", value: "today() + 1" }] }),
				{ kind: "set", field: "estimate", value: "", fixed: 5, on: "Kickoff" },
				{ kind: "notice", text: "{[Kickoff]} for {prop([Kickoff], \"Priority\")}" },
			],
		});
		const res = runP(w, apollo);
		expect(res.error).toBeUndefined();
		expect(res.changes).toEqual([]);
		expect(res.others).toHaveLength(1);
		expect(res.others[0]).toMatchObject({ path: "Tasks/Apollo kickoff.md", name: "Apollo kickoff", created: { type: "task", template: true, open: "no" } });
		expect(res.others[0].fm).toEqual({ priority: "High", due: "2026-11-07", project: "[[Apollo]]", estimate: 5 });
		expect(res.notices).toEqual(["Apollo kickoff for High"]);
	});

	it("link this note to the new one; a default name", () => {
		const w = wf({ scope: ["task"], steps: [{ kind: "create", type: "project", name: "", fields: [], link: { dir: "to-new", field: "project" }, template: false, open: "tab", exists: "new", as: "P" }] });
		const res = runP(w, ROWS[2]);
		expect(res.others[0].path).toBe("Tasks/New project.md");
		expect(res.changes).toEqual([{ key: "project", before: "[[Apollo]]", after: "[[Tasks/New project]]" }]);
	});

	it("use the existing note, or stop the run", () => {
		const used = runP(wf({ scope: ["project"], steps: [create({ exists: "use", fields: [{ field: "priority", value: "", fixed: "High" }] }), { kind: "tag", op: "add", tag: "kick", on: "Kickoff" }] }), apollo);
		expect(used.others).toHaveLength(1);
		expect(used.others[0].created).toBeUndefined();
		expect(used.others[0].path).toBe("Write docs.md");
		// its link is made and later steps act on it; the step's own fields aren't applied
		expect(used.others[0].changes.map((c) => c.key).sort()).toEqual(["tags"]);
		const stopped = runP(wf({ scope: ["project"], steps: [{ kind: "set", field: "budget", value: "", fixed: 1 }, create({ exists: "stop" })] }), apollo);
		expect(stopped).toMatchObject({ stopped: "Apollo kickoff already exists.", changes: [], others: [] });
		expect(stopped.error).toBeUndefined();
	});

	it("fail without a place to create notes, changing nothing", () => {
		const res = run(wf({ scope: ["project"], steps: [create()] }), apollo);
		expect(res.error).toEqual({ step: "0", message: "Notes can't be created here." });
	});

	it("report create problems: names, fields, links, and steps on notes no step creates", () => {
		const at = (steps: WorkflowDef["steps"]) => workflowProblems(wf({ name: "x", scope: ["project"], steps }), ctx).map((p) => p.message);
		expect(at([create()])).toEqual([]);
		expect(at([create({ as: "" })])).toEqual(["Name the note for later steps (Call it)."]);
		expect(at([create(), create()])).toEqual(["Another step already uses the name “Kickoff”: choose another."]);
		expect(at([create({ as: "Budget" })])).toEqual(["“Budget” is already a field's name: choose another."]);
		expect(at([create({ type: "" })])).toEqual(["Choose the type of note to create."]);
		expect(at([create({ fields: [{ field: "priority", value: "", fixed: "Urgent" }, { field: "nope", value: "1" }] })])).toEqual(["Priority: “Urgent” isn't one of Priority's choices.", "Task has no “nope” field."]);
		expect(at([create({ link: { dir: "to-new", field: "budget" } })])).toEqual(["“budget” can't link the new note and this one."]);
		expect(at([{ kind: "set", field: "estimate", value: "", fixed: 1, on: "Kickoff" }, create()])).toEqual(["No earlier step creates or finds “Kickoff”."]);
		expect(at([create(), { kind: "set", field: "budget", value: "", fixed: 1, on: "Kickoff" }])).toEqual(["Task has no “budget” field."]);
		expect(at([create(), { kind: "notice", text: "{[Kickoff]}" }, { kind: "set", field: "budget", value: "count([Kickoff])" }])).toEqual([]);
		expect(at([{ kind: "notice", text: "{[Kickoff]}" }, create()])).toEqual(["Unknown column [Kickoff]."]);
	});
});

describe("loops and running other workflows", () => {
	const t1 = row("Plan", TASK, { estimate: 2, project: "[[Apollo]]", priority: "Low", labels: ["bug", "feature"] });
	const t2 = row("Build", TASK, { estimate: 5, project: "[[Apollo]]", priority: "High" });
	const t3 = row("Other", TASK, { estimate: 1, project: "[[Zeus]]", priority: "Low" });
	const all = [ROWS[0], ROWS[1], t1, t2, t3];
	const at = new Map(all.map((r) => [r.path, r]));
	const ctx2: ViewContext = {
		...ctx,
		resolve: (p) => (at.has(`${p}.md`) ? `${p}.md` : at.has(p) ? p : null),
		row: (p) => at.get(p),
		incoming: (p) => all.filter((r) => r.type.key === "task" && r.frontmatter.project === `[[${p.replace(/\.md$/, "")}]]`).map((r) => ({ source: r.path, sourceType: "task", fieldKey: "project" })),
	};
	const place = (req: PlaceRequest): Placed => ({ path: `New/${req.name}.md` });
	const run2 = (w: WorkflowDef, r: ViewRow, workflows: WorkflowDef[] = []) => runSteps(w, { ctx: ctx2, row: r, linkText, place, workflows });
	type Linked = Extract<WorkflowDef["steps"][number], { kind: "linked" }>;
	const linkedTasks = (over: Partial<Linked> = {}) => ({ kind: "linked", source: { dir: "in", type: "task", field: "project" }, when: { mode: "all", items: [] }, as: "Task", steps: [], ...over }) as Linked;

	it("list linked notes both ways, and give each step its scope", () => {
		const src = linkedSources(["project"], TYPES);
		expect(src.out).toEqual([]);
		expect(src.in.map((x) => x.label)).toEqual(["tasks (Project)"]);
		expect(linkedSources(["task"], TYPES).out.map((f) => f.key)).toEqual(["project", "people"]);
		const w = wf({ scope: ["project"], steps: [linkedTasks({ steps: [{ kind: "set", field: "estimate", value: "[Estimate] * 2" }] }), { kind: "notice", text: "x" }] });
		const sc = stepScopes(w, ctx);
		expect(sc.get("0.0")).toMatchObject({ scope: ["task"], loop: "notes", defaultLabel: "Each task" });
		expect(sc.get("0.0")!.vars.map((v) => v.name)).toEqual(["This note", "Task"]);
		expect(sc.get("0.0")!.on.map((o) => o.value)).toEqual([ON_THIS]);
		expect(sc.get("1")!.loop).toBeUndefined();
	});

	it("run steps on each note linking here: formulas read each note, Only if filters them, [This note] is the workflow's", () => {
		const w = wf({
			scope: ["project"],
			steps: [
				linkedTasks({
					when: { mode: "all", items: [{ field: "priority", op: "any-of", value: ["Low"] }] },
					steps: [
						{ kind: "set", field: "estimate", value: "[Estimate] * 10" },
						{ kind: "tag", op: "add", tag: "from-project" },
						{ kind: "set", field: "budget", value: 'prop([This note], "Budget") + 1', on: ON_THIS },
						{ kind: "notice", text: "{[Task]} in {[This note]}" },
					],
				}),
			],
		});
		const res = run2(w, ROWS[0]);
		expect(res.error).toBeUndefined();
		expect(res.changes).toEqual([{ key: "budget", before: 10, after: 11 }]);
		expect(res.others.map((o) => [o.path, o.fm.estimate, o.fm.tags])).toEqual([["Plan.md", 20, ["from-project"]]]);
		expect(res.notices).toEqual(["Plan in Apollo"]);
	});

	it("go through this note's link field", () => {
		const w = wf({ scope: ["task"], steps: [{ kind: "linked", source: { dir: "out", field: "project" }, when: { mode: "all", items: [] }, as: "Project", steps: [{ kind: "set", field: "budget", value: '[Budget] + prop([This note], "Estimate")' }] }] });
		const res = run2(w, t2);
		expect(res.others.map((o) => [o.path, o.fm.budget])).toEqual([["Apollo.md", 15]]);
	});

	it("for each value: create a note per label", () => {
		const w = wf({
			scope: ["task"],
			steps: [{ kind: "each", formula: "[Labels]", items: "values", itemType: "", when: { mode: "all", items: [] }, as: "Label", steps: [{ kind: "create", type: "task", name: "{[Name]} - {[Label]}", fields: [], template: false, open: "no", exists: "new", as: "Follow-up" }] }],
		});
		const res = run2(w, t1);
		expect(res.error).toBeUndefined();
		expect(res.others.map((o) => o.path)).toEqual(["New/Plan - bug.md", "New/Plan - feature.md"]);
	});

	it("for each note of a formula's list", () => {
		const w = wf({ scope: ["project"], steps: [{ kind: "each", formula: 'list("Plan", "Build")', items: "notes", itemType: "task", when: { mode: "all", items: [] }, as: "T", steps: [{ kind: "set", field: "priority", value: "", fixed: "Low" }] }] });
		const res = run2(w, ROWS[0]);
		expect(res.others.map((o) => [o.path, o.fm.priority])).toEqual([["Build.md", "Low"]]);
	});

	it("run another workflow in the same run: its Only if, its steps, on each linked note", () => {
		const close = wf({ id: "close", name: "Close out", scope: ["task"], when: { mode: "all", items: [{ field: "priority", op: "any-of", value: ["High"] }] }, steps: [{ kind: "set", field: "status", value: "", fixed: "done" }] });
		const w = wf({ id: "outer", scope: ["project"], steps: [linkedTasks({ steps: [{ kind: "run", workflow: "close" }] })] });
		const res = run2(w, ROWS[0], [close, w]);
		expect(res.via).toEqual(["Close out"]);
		expect(res.others.map((o) => [o.path, o.fm.status])).toEqual([["Build.md", "done"]]);
	});

	it("report loop and run problems", () => {
		const close = wf({ id: "close", name: "Close out", scope: ["task"], steps: [{ kind: "run", workflow: "outer" }] });
		const probs = (w: WorkflowDef) => workflowProblems(w, { ...ctx, workflows: [close, w] }).map((p) => `${p.at}: ${p.message}`);
		expect(probs(wf({ id: "outer", name: "x", scope: ["project"], steps: [linkedTasks()] }))).toEqual(["step:0: Add a step inside the loop."]);
		expect(probs(wf({ id: "outer", name: "x", scope: ["project"], steps: [linkedTasks({ source: { dir: "out", field: "" }, steps: [{ kind: "tag", op: "add", tag: "a" }] })] }))).toEqual(["step:0: Choose which linked notes."]);
		expect(probs(wf({ id: "outer", name: "x", scope: ["project"], steps: [linkedTasks({ as: "Budget", steps: [{ kind: "set", field: "nope", value: "1" }] })] }))).toEqual([
			"step:0: \u201cBudget\u201d is already a field's name: choose another.",
			"step:0.0: Task has no \u201cnope\u201d field.",
		]);
		expect(probs(wf({ id: "outer", name: "x", scope: ["project"], steps: [{ kind: "run", workflow: "close" }] }))).toEqual(["step:0: \u201cClose out\u201d doesn't apply to projects.", "step:0: \u201cClose out\u201d has problems, so it can't run.", "steps: It runs itself: x \u2192 Close out \u2192 x."]);
		expect(probs(wf({ id: "outer", name: "x", scope: ["project"], steps: [{ kind: "run", workflow: "outer" }] }))).toEqual(["step:0: A workflow can't run itself.", "steps: It runs itself: x \u2192 x."]);
		expect(probs(wf({ id: "outer", name: "x", scope: ["project"], steps: [{ kind: "each", formula: "[Budget]", items: "values", itemType: "", when: { mode: "all", items: [] }, as: "N", steps: [{ kind: "notice", text: "{[N] + 1}" }] }] }))).toEqual([]);
	});

	describe("loops inside loops", () => {
		const labels = (steps: WorkflowStep[]): WorkflowStep => ({ kind: "each", formula: "[Labels]", items: "values", itemType: "", when: { mode: "all", items: [] }, as: "Label", steps });
		const projectOf = (steps: WorkflowStep[]): WorkflowStep => ({ kind: "linked", source: { dir: "out", field: "project" }, when: { mode: "all", items: [] }, as: "P", steps });
		const nested = (inner: WorkflowStep[]) =>
			wf({ id: "n", name: "Nested", scope: ["project"], steps: [linkedTasks({ steps: [labels([{ kind: "notice", text: "{[Task]}: {[Label]}" }]), projectOf(inner)] })] });

		it("are kept when read back, and give each step its scope by its place", () => {
			const w = nested([{ kind: "tag", op: "add", tag: "seen", on: "Task" }]);
			expect(readWorkflows(JSON.parse(JSON.stringify([w])))[0].steps).toEqual(w.steps);
			const sc = stepScopes(w, ctx);
			expect([...sc.keys()]).toEqual(["0", "0.0", "0.0.0", "0.1", "0.1.0"]);
			expect(sc.get("0.0.0")).toMatchObject({ scope: ["task"], loop: "values", defaultLabel: "Each task" });
			// Inside the inner loop: its note by default, the outer loop's note by name.
			expect(sc.get("0.1.0")).toMatchObject({ scope: ["project"], loop: "notes", defaultLabel: "Each p" });
			expect(sc.get("0.1.0")!.on.map((o) => o.value)).toEqual([ON_THIS, "Task"]);
			expect(sc.get("0.1.0")!.vars.map((v) => v.name)).toEqual(["This note", "Task", "P"]);
			expect(workflowProblems(w, ctx)).toEqual([]);
		});

		it("run for each item of each item, starting from the outer loop's note", () => {
			const w = nested([
				{ kind: "set", field: "budget", value: '[Budget] + prop([Task], "Estimate")' },
				{ kind: "tag", op: "add", tag: "seen", on: "Task" },
			]);
			const res = run2(w, ROWS[0]);
			expect(res.error).toBeUndefined();
			expect(res.notices).toEqual(["Plan: bug", "Plan: feature"]);
			// Each task's project is this note: Build (5) then Plan (2) add to its budget.
			expect(res.changes).toEqual([{ key: "budget", before: 10, after: 17 }]);
			expect(res.others.map((o) => [o.path, o.fm.tags])).toEqual([
				["Build.md", ["seen"]],
				["Plan.md", ["seen"]],
			]);
		});

		it("report a failing step inside by its place", () => {
			const res = run2(nested([{ kind: "set", field: "nope", value: "1" }]), ROWS[0]);
			expect(res.error).toEqual({ step: "0.1.0", message: "None of the types has a \u201cnope\u201d field." });
			expect(stepLabel(res.error!.step)).toBe("1.2.1");
			expect(workflowProblems(nested([{ kind: "set", field: "nope", value: "1" }]), ctx).map((p) => p.at)).toEqual(["step:0.1.0"]);
		});

		it("find, replace and list steps at any depth", () => {
			const w = nested([{ kind: "tag", op: "add", tag: "a" }]);
			expect(stepAt(w.steps, "0.1.0")).toEqual({ kind: "tag", op: "add", tag: "a" });
			expect(stepAt(w.steps, "0.2")).toBeUndefined();
			const next = mapStepAt(w.steps, "0.1.0", () => ({ kind: "tag", op: "remove", tag: "b" }));
			expect(stepAt(next, "0.1.0")).toEqual({ kind: "tag", op: "remove", tag: "b" });
			expect(stepAt(next, "0.0.0")).toEqual(stepAt(w.steps, "0.0.0"));
			expect(flatSteps(w.steps).map((s) => s.kind)).toEqual(["linked", "each", "notice", "linked", "tag"]);
			expect(asksQuestion({ steps: mapStepAt(w.steps, "0.0.0", () => ({ kind: "ask", text: "?" })) })).toBe(true);
		});

		it("don't ask a question in a loop inside a loop", () => {
			const w = nested([{ kind: "ask", text: "Sure?" }]);
			expect(workflowProblems(w, ctx).map((p) => `${p.at}: ${p.message}`)).toContain("step:0.1.0: A question can't be inside a loop: ask it before the loop.");
		});
	});

	describe("variables", () => {
		const total = (steps: WorkflowStep[]) =>
			wf({
				id: "v",
				name: "Totals",
				scope: ["project"],
				steps: [{ kind: "var", name: "Total", value: "0" }, linkedTasks({ steps: [{ kind: "var", name: "Total", value: "[Total] + [Estimate]" }] }), ...steps],
			});

		it("keep their value for the rest of the run, after loops too", () => {
			const w = total([
				{ kind: "set", field: "budget", value: "[Total]" },
				{ kind: "notice", text: "{[Total]} hours" },
			]);
			expect(workflowProblems(w, ctx)).toEqual([]);
			expect(readWorkflows(JSON.parse(JSON.stringify([w])))[0].steps).toEqual(w.steps);
			const res = run2(w, ROWS[0]);
			expect(res.error).toBeUndefined();
			expect(res.changes).toEqual([{ key: "budget", before: 10, after: 7 }]);
			expect(res.notices).toEqual(["7 hours"]);
		});

		it("are seen from the step after the first that sets them, with that formula's type", () => {
			const w = total([{ kind: "var", name: "Total", value: '"lots"' }, { kind: "notice", text: "{[Total]}" }]);
			const sc = stepScopes(w, ctx);
			expect(sc.get("0")!.vars.map((v) => v.name)).toEqual([]);
			expect(sc.get("1.0")!.vars.find((v) => v.name === "Total")).toBeDefined();
			expect(sc.get("1.0")!.variables).toEqual(["Total"]);
			// Set to a number, then to text: it can be either.
			expect(sc.get("3")!.vars.find((v) => v.name === "Total")!.type).toBe("any");
			expect(stepScopes(total([]), ctx).get("1.0")!.vars.find((v) => v.name === "Total")!.type).toBe("number");
		});

		it("report a variable used before it's set, and names already taken", () => {
			const probs = (steps: WorkflowStep[]) => workflowProblems(wf({ name: "x", scope: ["project"], steps }), ctx).map((p) => `${p.at}: ${p.message}`);
			expect(probs([{ kind: "var", name: "Total", value: "[Total] + 1" }])[0]).toMatch(/^step:0: .*Total/);
			expect(probs([{ kind: "var", name: "", value: "1" }])).toEqual(["step:0: Name the variable, e.g. Total."]);
			expect(probs([{ kind: "var", name: "Budget", value: "1" }])).toEqual(["step:0: \u201cBudget\u201d is already a field's name: choose another."]);
			expect(probs([{ kind: "var", name: "a[b]", value: "1" }])).toEqual(["step:0: A variable's name can't have brackets or braces in it."]);
			expect(probs([{ kind: "var", name: "N", value: "" }])).toEqual(["step:0: Write the formula, e.g. 0, [Estimate] * 2 or [Total] + 1."]);
			expect(probs([linkedTasks({ steps: [{ kind: "tag", op: "add", tag: "x" }] }), { kind: "var", name: "task", value: "1" }])).toEqual(["step:1: \u201ctask\u201d is already the name of a note or loop item: choose another."]);
			expect(probs([{ kind: "var", name: "Task", value: "1" }, linkedTasks({ steps: [{ kind: "tag", op: "add", tag: "x" }] })])).toEqual(["step:1: Another step already uses the name \u201cTask\u201d: choose another."]);
		});

		it("are empty when the step that sets them didn't run", () => {
			const w = wf({ scope: ["project"], steps: [{ kind: "each", formula: "list()", items: "values", itemType: "", when: { mode: "all", items: [] }, as: "X", steps: [{ kind: "var", name: "Seen", value: "1" }] }, { kind: "notice", text: "[{[Seen]}]" }] });
			expect(run2(w, ROWS[0]).notices).toEqual(["[]"]);
		});

		it("are their own in another workflow that's run", () => {
			const sub = wf({ id: "sub", name: "Sub", scope: ["project"], steps: [{ kind: "var", name: "Total", value: "100" }] });
			const w = total([{ kind: "run", workflow: "sub" }, { kind: "notice", text: "{[Total]}" }]);
			expect(run2(w, ROWS[0], [sub, w]).notices).toEqual(["7"]);
		});
	});

	describe("if / otherwise", () => {
		const iff = (over: Partial<IfStep>): IfStep => ({ kind: "if", test: "filter", when: { mode: "all", items: [] }, formula: "", steps: [], otherwise: [], ...over });
		const high = { mode: "all" as const, items: [{ field: "priority", op: "any-of" as const, value: ["High"] }] };

		it("run Then when the note matches the conditions, else Otherwise", () => {
			const w = wf({ name: "x", scope: ["task"], steps: [iff({ when: high, steps: [{ kind: "tag", op: "add", tag: "urgent" }], otherwise: [{ kind: "tag", op: "add", tag: "later" }] })] });
			expect(workflowProblems(w, ctx)).toEqual([]);
			expect(readWorkflows(JSON.parse(JSON.stringify([w])))[0].steps).toEqual(w.steps);
			expect(run2(w, t1).fm.tags).toEqual(["later"]);
			expect(run2(w, t2).fm.tags).toEqual(["urgent"]);
		});

		it("test a formula, inside a loop, with variables", () => {
			const w = wf({
				name: "x",
				scope: ["project"],
				steps: [
					{ kind: "var", name: "Big", value: "0" },
					linkedTasks({
						steps: [
							iff({
								test: "formula",
								formula: "[Estimate] > 3",
								steps: [
									{ kind: "tag", op: "add", tag: "big" },
									{ kind: "var", name: "Big", value: "[Big] + 1" },
								],
								otherwise: [{ kind: "tag", op: "add", tag: "small" }],
							}),
						],
					}),
					{ kind: "notice", text: "{[Big]} big" },
				],
			});
			expect(workflowProblems(w, ctx)).toEqual([]);
			expect([...stepScopes(w, ctx).keys()]).toEqual(["0", "1", "1.0", "1.0.0", "1.0.1", "1.0.2", "2"]);
			const res = run2(w, ROWS[0]);
			expect(res.notices).toEqual(["1 big"]);
			expect(res.others.map((o) => [o.path, o.fm.tags])).toEqual([
				["Build.md", ["big"]],
				["Plan.md", ["small"]],
			]);
		});

		it("test another note: This note inside a loop, or a created one", () => {
			const rich = { mode: "all" as const, items: [{ field: "budget", op: ">", value: 5 }] };
			const w = wf({ name: "x", scope: ["project"], steps: [linkedTasks({ steps: [iff({ on: ON_THIS, when: rich, steps: [{ kind: "tag", op: "add", tag: "funded" }] })] })] });
			expect(workflowProblems(w, ctx)).toEqual([]);
			expect(run2(w, ROWS[0]).others.map((o) => o.fm.tags)).toEqual([["funded"], ["funded"]]);
			expect(run2(w, ROWS[1]).others).toEqual([]);
		});

		it("ask a question inside one (it isn't a loop), by its place", () => {
			const w = wf({ name: "x", scope: ["task"], steps: [iff({ when: high, steps: [{ kind: "ask", text: "Sure?" }, { kind: "tag", op: "add", tag: "y" }] })] });
			expect(workflowProblems(w, ctx)).toEqual([]);
			expect(run2(w, t2).pending).toEqual({ step: "0.0", text: "Sure?" });
			expect(runSteps(w, { ctx: ctx2, row: t2, linkText, answers: new Set(["0.0"]) }).fm.tags).toEqual(["y"]);
			expect(run2(w, t1).pending).toBeUndefined();
		});

		it("keep notes created inside to the steps after them inside", () => {
			const make: WorkflowStep = { kind: "create", type: "task", name: "Follow-up", fields: [], template: false, open: "no", exists: "new", as: "Follow-up" };
			const w = wf({ name: "x", scope: ["task"], steps: [iff({ when: high, steps: [make, { kind: "tag", op: "add", tag: "a", on: "Follow-up" }] }), { kind: "tag", op: "add", tag: "b", on: "Follow-up" }] });
			expect(workflowProblems(w, ctx).map((p) => `${p.at}: ${p.message}`)).toEqual(["step:1: No earlier step creates or finds \u201cFollow-up\u201d."]);
		});

		it("report what's missing", () => {
			const probs = (s: IfStep, trigger?: WorkflowDef["trigger"]) => workflowProblems(wf({ name: "x", scope: ["task"], ...(trigger ? { trigger } : {}), steps: [s] }), ctx).map((p) => p.message);
			expect(probs(iff({}))).toEqual(["Add a condition.", "Add a step, under Then or Otherwise."]);
			expect(probs(iff({ test: "formula", steps: [{ kind: "tag", op: "add", tag: "x" }] }))).toEqual(["Write the formula, e.g. [Estimate] > 5 or [Total] = 0."]);
			expect(probs(iff({ when: { mode: "all", items: [{ field: "budget", op: "empty" }] }, steps: [{ kind: "tag", op: "add", tag: "x" }] }))).toEqual(["A condition uses \u201cbudget\u201d, which isn't a column of tasks."]);
			// A run for the whole selection has no note to test: a formula instead.
			const once = { kind: "manual", selection: "once" } as WorkflowDef["trigger"];
			expect(probs(iff({ when: high, otherwise: [{ kind: "notice", text: "x" }] }), once)).toEqual([NO_NOTE]);
			expect(probs(iff({ test: "formula", formula: `count([${SELECTION_VAR}]) > 1`, otherwise: [{ kind: "notice", text: "x" }] }), once)).toEqual([]);
		});
	});

	describe("find notes", () => {
		const go = (w: WorkflowDef, r: ViewRow) => runSteps(w, { ctx: ctx2, row: r, linkText, place, rows: all });
		const ofThis = { mode: "all" as const, items: [{ field: "project", op: "links-any", value: ["{this}"] }] };
		const high = { mode: "all" as const, items: [{ field: "priority", op: "any-of" as const, value: ["High"] }] };
		const find = (over: Partial<FindStep>): FindStep => ({ kind: "find", types: ["task"], when: ofThis, keep: "all", as: "Found", ...over });

		it("find every match as a list, sorted, as many as it says", () => {
			const w = wf({
				name: "x",
				scope: ["project"],
				steps: [find({ sort: { by: "estimate", dir: "desc" } }), { kind: "notice", text: "{count([Found])}: {[Found]}" }, find({ as: "Two", limit: 1 }), { kind: "notice", text: "{[Two]}" }],
			});
			expect(workflowProblems(w, ctx)).toEqual([]);
			expect(readWorkflows(JSON.parse(JSON.stringify([w])))[0].steps).toEqual(w.steps);
			// Sorted by name when it doesn't say.
			expect(go(w, ROWS[0]).notices).toEqual(["2: Build, Plan", "Build"]);
			expect(go(w, ROWS[1]).notices).toEqual(["1: Other", "Other"]);
		});

		it("act on the first one found; skip steps on it when none match", () => {
			const w = wf({
				name: "x",
				scope: ["project"],
				steps: [
					find({ keep: "first", as: "Biggest", when: { mode: "all", items: [...ofThis.items, { field: "estimate", op: ">", value: 1 }] }, sort: { by: "estimate", dir: "desc" } }),
					{ kind: "tag", op: "add", tag: "biggest", on: "Biggest" },
					{ kind: "if", test: "filter", on: "Biggest", when: high, formula: "", steps: [{ kind: "notice", text: "urgent" }], otherwise: [{ kind: "notice", text: "not urgent" }] },
				],
			});
			expect(workflowProblems(w, ctx)).toEqual([]);
			expect(stepScopes(w, ctx).get("1")!.on).toEqual([expect.objectContaining({ value: "Biggest", found: true })]);
			const res = go(w, ROWS[0]);
			expect(res.others.map((o) => [o.path, o.fm.tags])).toEqual([["Build.md", ["biggest"]]]);
			expect(res.notices).toEqual(["urgent"]);
			const none = go(w, ROWS[1]);
			expect(none.error).toBeUndefined();
			expect(none.others).toEqual([]);
			expect(none.notices).toEqual(["not urgent"]);
		});

		it("see notes as this run has changed and created them", () => {
			const w = wf({
				name: "x",
				scope: ["project"],
				steps: [
					{ kind: "create", type: "task", name: "Extra", fields: [{ field: "estimate", value: "9" }], link: { dir: "from-new", field: "project" }, template: false, open: "no", exists: "new", as: "Extra" },
					linkedTasks({ steps: [{ kind: "set", field: "estimate", value: "[Estimate] + 10" }] }),
					find({ sort: { by: "estimate", dir: "desc" } }),
					{ kind: "notice", text: "{[Found]}" },
				],
			});
			expect(workflowProblems(w, ctx)).toEqual([]);
			// The loop reaches the new task too (it links here): 19, 15, 12.
			expect(go(w, ROWS[0]).notices).toEqual(["Extra, Build, Plan"]);
		});

		it("are found in a loop each time round, and kept for after it", () => {
			const w = wf({
				name: "x",
				scope: ["project"],
				steps: [
					linkedTasks({ steps: [find({ keep: "first", as: "Top", sort: { by: "estimate", dir: "desc" } })] }),
					{ kind: "notice", text: "{[Top]}" },
					{ kind: "tag", op: "add", tag: "top", on: "Top" },
				],
			});
			expect(workflowProblems(w, ctx)).toEqual([]);
			const res = go(w, ROWS[0]);
			expect(res.notices).toEqual(["Build"]);
			expect(res.others.map((o) => [o.path, o.fm.tags])).toEqual([["Build.md", ["top"]]]);
		});

		it("report problems", () => {
			const probs = (s: FindStep) => workflowProblems(wf({ name: "x", scope: ["project"], steps: [s] }), ctx).map((p) => p.message);
			expect(probs(find({ types: ["nope"], when: { mode: "all", items: [] } }))).toEqual(["\u201cnope\u201d isn't a type or group."]);
			expect(probs(find({ when: { mode: "all", items: [{ field: "budget", op: "empty" }] } }))).toEqual(["A condition uses \u201cbudget\u201d, which isn't a column of these notes."]);
			expect(probs(find({ sort: { by: "nope", dir: "asc" } }))).toEqual(["It's sorted by \u201cnope\u201d, which isn't a column of these notes."]);
			expect(probs(find({ limit: 0.5 }))).toEqual(["At most: a whole number, 1 or more."]);
			expect(probs(find({ as: "" }))).toEqual(["Name the notes it finds for later steps (Call it)."]);
			expect(probs(find({ as: "Budget" }))).toEqual(["\u201cBudget\u201d is already a field's name: choose another."]);
		});
	});
});

describe("big runs", () => {
	const t1 = row("Plan", TASK, { estimate: 2, project: "[[Apollo]]" });
	const t2 = row("Build", TASK, { estimate: 5, project: "[[Apollo]]" });
	const all = [ROWS[0], t1, t2];
	const at = new Map(all.map((r) => [r.path, r]));
	const ctx2: ViewContext = {
		...ctx,
		resolve: (p) => (at.has(`${p}.md`) ? `${p}.md` : at.has(p) ? p : null),
		row: (p) => at.get(p),
		incoming: (p) => all.filter((r) => r.frontmatter.project === `[[${p.replace(/\.md$/, "")}]]`).map((r) => ({ source: r.path, sourceType: "task", fieldKey: "project" })),
	};
	const place = (req: PlaceRequest): Placed => ({ path: `New/${req.name}.md` });

	it("count the notes a run changes and creates, and say it in words", () => {
		const w = wf({
			scope: ["project"],
			steps: [
				{ kind: "set", field: "budget", value: "1" },
				{ kind: "linked", source: { dir: "in", type: "task", field: "project" }, when: { mode: "all", items: [] }, as: "Task", steps: [{ kind: "set", field: "estimate", value: "0" }] },
				{ kind: "create", type: "task", name: "Kick-off", fields: [], template: true, open: "no", exists: "new", as: "New task" },
			],
		});
		const res = runSteps(w, { ctx: ctx2, row: ROWS[0], linkText, place });
		expect(res.error).toBeUndefined();
		const reach = runReach(res);
		expect(reach).toEqual({ changed: 3, created: 1 });
		expect(reachText(reach)).toBe("change 3 notes and create a note");
		expect(isBigRun(reach)).toBe(false);
		expect(reachText({ changed: 0, created: 0 })).toBe("make no changes");
		expect(reachText({ changed: 1, created: 0 })).toBe("change a note");
		expect(isBigRun({ changed: BIG_RUN, created: 0 })).toBe(false);
		expect(isBigRun({ changed: BIG_RUN, created: 1 })).toBe(true);
		// A linked note the loop leaves as it was doesn't count.
		const same = wf({ scope: ["project"], steps: [{ kind: "linked", source: { dir: "in", type: "task", field: "project" }, when: { mode: "all", items: [] }, as: "Task", steps: [{ kind: "set", field: "estimate", value: "[Estimate]" }] }] });
		expect(runReach(runSteps(same, { ctx: ctx2, row: ROWS[0], linkText, place }))).toEqual({ changed: 0, created: 0 });
	});
});
describe("questions, moves and renames", () => {
	const t1 = row("Plan", TASK, { estimate: 2, project: "[[Apollo]]", priority: "Low" });
	const t2 = row("Build", TASK, { estimate: 5, project: "[[Apollo]]", priority: "High" });
	const all = [ROWS[0], t1, t2];
	const at = new Map(all.map((r) => [r.path, r]));
	const ctx2: ViewContext = {
		...ctx,
		resolve: (p) => (at.has(`${p}.md`) ? `${p}.md` : at.has(p) ? p : null),
		row: (p) => at.get(p),
		incoming: (p) => all.filter((r) => r.frontmatter.project === `[[${p.replace(/\.md$/, "")}]]`).map((r) => ({ source: r.path, sourceType: "task", fieldKey: "project" })),
	};
	const place = (req: PlaceRequest): Placed => ({ path: `New/${req.name}.md` });
	const go = (w: WorkflowDef, r: ViewRow, answers?: Set<string> | "all", workflows: WorkflowDef[] = []) => runSteps(w, { ctx: ctx2, row: r, linkText, place, answers, workflows });
	const tasksOf = (steps: WorkflowDef["steps"]) => ({ kind: "linked", source: { dir: "in", type: "task", field: "project" }, when: { mode: "all", items: [] }, as: "Task", steps }) as WorkflowDef["steps"][number];

	it("stop at a question until it's answered Yes, then carry on (a test run takes every answer as Yes)", () => {
		const w = wf({ scope: ["task"], steps: [{ kind: "set", field: "estimate", value: "9" }, { kind: "ask", text: "Close {[Name]} ({[Estimate]} h)?" }, { kind: "set", field: "priority", value: '"High"' }] });
		const first = go(w, t1);
		expect(first.pending).toEqual({ step: "1", text: "Close Plan (9 h)?" });
		expect(first.changes).toEqual([]);
		const yes = go(w, t1, new Set(["1"]));
		expect(yes.pending).toBeUndefined();
		expect(yes.asked).toEqual(["Close Plan (9 h)?"]);
		expect(yes.changes.map((c) => [c.key, c.after])).toEqual([
			["estimate", 9],
			["priority", "High"],
		]);
		expect(go(w, t1, "all").asked).toEqual(["Close Plan (9 h)?"]);
		expect(go(wf({ scope: ["task"], steps: [{ kind: "ask", text: "  " }] }), t1).pending?.text).toBe("Carry on?");
	});

	it("don't ask inside loops or from another workflow", () => {
		const inLoop = wf({ id: "loop", name: "x", scope: ["project"], steps: [tasksOf([{ kind: "ask", text: "Sure?" }])] });
		expect(go(inLoop, ROWS[0], "all").error?.message).toBe("A question can't be inside a loop.");
		expect(workflowProblems(inLoop, ctx).map((p) => p.message)).toContain("A question can't be inside a loop: ask it before the loop.");
		const asks = wf({ id: "asks", name: "Asks", scope: ["task"], steps: [{ kind: "ask", text: "Sure?" }, { kind: "tag", op: "add", tag: "x" }] });
		const runs = wf({ id: "runs", name: "Runs", scope: ["task"], steps: [{ kind: "run", workflow: "asks" }] });
		expect(asksQuestion(asks)).toBe(true);
		expect(asksQuestion(runs)).toBe(false);
		expect(workflowProblems(runs, { ...ctx, workflows: [asks, runs] }).map((p) => p.message)).toContain("\u201cAsks\u201d asks a question, so it can't be run from another workflow.");
		expect(go(runs, t1, "all", [asks, runs]).error?.message).toBe("\u201cAsks\u201d asks a question, so it can't be run from another workflow.");
		expect(workflowProblems(wf({ name: "x", scope: ["task"], steps: [{ kind: "ask", text: "" }] }), ctx).map((p) => p.message)).toEqual(["Write the question, e.g. Also close its tasks?"]);
	});

	it("plan moves and renames from templates, for this note and each linked note", () => {
		const w = wf({
			scope: ["project"],
			steps: [
				{ kind: "rename", name: "{[Name]} (closed)" },
				{ kind: "move", to: "folder", folder: "Archive/{2026}" },
				tasksOf([{ kind: "move", to: "folder", folder: "Archive/Tasks/{[Priority]}" }, { kind: "rename", name: "{[Task]} done" }]),
			],
		});
		const res = go(w, ROWS[0]);
		expect(res.error).toBeUndefined();
		expect(res.changes).toEqual([]);
		// A move keeps an earlier rename, and the other way round.
		expect(res.move).toEqual({ name: "Apollo (closed)", folder: "Archive/2026" });
		expect(res.others.map((o) => [o.path, o.changes.length, o.move])).toEqual([
			["Build.md", 0, { folder: "Archive/Tasks/High", name: "Build done" }],
			["Plan.md", 0, { folder: "Archive/Tasks/Low", name: "Plan done" }],
		]);
		expect(runReach(res)).toEqual({ changed: 3, created: 0 });
		const byType = go(wf({ scope: ["task"], steps: [{ kind: "rename", name: "X" }, { kind: "move", to: "type", folder: "" }] }), t1);
		expect(byType.move).toEqual({ name: "X", byType: true });
		expect(folderPath("  Archive\\\\2026//Q1: plans?/ ")).toBe("Archive/2026/Q1 plans");
		expect(folderPath("/")).toBe("");
	});

	it("leave created notes to their Create a note step, and check templates", () => {
		const create: WorkflowDef["steps"][number] = { kind: "create", type: "task", name: "Kick-off", fields: [], template: true, open: "no", exists: "new", as: "New task" };
		const w = wf({ name: "x", scope: ["project"], steps: [create, { kind: "rename", name: "Other", on: "New task" }] });
		expect(go(w, ROWS[0]).error?.message).toBe("A note this workflow creates is named and placed by its Create a note step.");
		expect(workflowProblems(w, ctx).map((p) => p.message)).toEqual(["\u201cNew task\u201d is a note this workflow creates: its Create a note step names it, and its type's folder rules place it."]);
		const probs = (steps: WorkflowDef["steps"]) => workflowProblems(wf({ name: "x", scope: ["task"], steps }), ctx).map((p) => p.message);
		expect(probs([{ kind: "move", to: "folder", folder: " " }])).toEqual(["Choose the folder, e.g. Archive or Archive/{year(today())}."]);
		expect(probs([{ kind: "move", to: "type", folder: "" }])).toEqual([]);
		expect(probs([{ kind: "rename", name: "" }])).toEqual(["Write the new name, e.g. {[Code]} {[Name]}."]);
		expect(probs([{ kind: "rename", name: "{[Nope]}" }])[0]).toMatch(/Nope/);
		expect(go(wf({ scope: ["task"], steps: [{ kind: "rename", name: "{[Labels]}" }] }), t1).error?.message).toBe("The new name is empty.");
	});

	it("read the new steps back, and say moves in words", () => {
		const back = readWorkflows([{ id: "a", name: "A", scope: ["task"], trigger: { kind: "manual" }, steps: [{ kind: "ask", text: "Q?" }, { kind: "move", to: "type", on: "@this" }, { kind: "move", folder: "X" }, { kind: "rename", name: "N" }] }]);
		expect(back[0].steps).toEqual([
			{ kind: "ask", text: "Q?" },
			{ kind: "move", to: "type", folder: "", on: "@this" },
			{ kind: "move", to: "folder", folder: "X" },
			{ kind: "rename", name: "N" },
		]);
		expect(movedText("A/Plan.md", "A/Plan done.md")).toBe("renamed to Plan done");
		expect(movedText("A/Plan.md", "Archive/Plan.md")).toBe("moved to Archive");
		expect(movedText("A/Plan.md", "Plan.md")).toBe("moved to the vault's top folder");
		expect(movedText("A/Plan.md", "B/Done.md")).toBe("moved to B/Done");
	});
});
describe("schedules and dates", () => {
	const at = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m).getTime();
	const sched = (over: Partial<ScheduleTrigger> = {}): ScheduleTrigger => ({ kind: "schedule", every: "day", at: "09:00", day: 1, hours: 4, limit: 50, ...over });
	const dateT = (over: Partial<DateTrigger> = {}): DateTrigger => ({ kind: "date", field: "due", offset: 0, at: "09:00", limit: 50, ...over });
	const day = (iso: string) => (isoDateAdapter.parse(iso) as { value: number }).value;

	it("say when a schedule is due: the latest time missed, once", () => {
		expect(new Date(at(5, 9)).getDay()).toBe(1);
		const daily = sched();
		expect(dueAt(daily, at(5, 9, 5), at(6, 8, 59))).toBeNull();
		expect(dueAt(daily, at(5, 9, 5), at(6, 9))).toBe(at(6, 9));
		// Closed for days: one run, for the latest time.
		expect(dueAt(daily, at(2, 10), at(6, 12))).toBe(at(6, 9));
		const weekly = sched({ every: "week", day: 1 });
		expect(dueAt(weekly, at(5, 9, 30), at(11, 23))).toBeNull();
		expect(dueAt(weekly, at(5, 9, 30), at(12, 9))).toBe(at(12, 9));
		expect(dueAt(weekly, at(5, 8), at(5, 9, 1))).toBe(at(5, 9));
		const hourly = sched({ every: "hours", hours: 4 });
		expect(dueAt(hourly, at(5, 9), at(5, 12, 59))).toBeNull();
		expect(dueAt(hourly, at(5, 9), at(5, 13))).toBe(at(5, 13));
	});

	it("say when it runs next, and when a date check is due", () => {
		expect(nextDue(sched(), at(5, 9, 30))).toBe(at(6, 9));
		expect(nextDue(sched(), at(5, 8))).toBe(at(5, 9));
		expect(nextDue(sched({ every: "week", day: 1 }), at(5, 9, 30))).toBe(at(12, 9));
		expect(nextDue(sched({ every: "week", day: 3 }), at(5, 9, 30))).toBe(at(7, 9));
		expect(nextDue(sched({ every: "hours", hours: 4 }), at(5, 9))).toBe(at(5, 13));
		expect(nextDue(dateT({ at: "07:30" }), at(5, 9))).toBe(at(6, 7, 30));
		const today = day("2026-01-05");
		expect(dateCheckDue(dateT(), today - 1, today, at(5, 8, 59))).toBe(false);
		expect(dateCheckDue(dateT(), today - 1, today, at(5, 9))).toBe(true);
		expect(dateCheckDue(dateT(), today, today, at(5, 23))).toBe(false);
	});

	it("find dates reached since the last check, with the offset, catching up a gap", () => {
		const before = dateT({ offset: -3 });
		const jan = (d: number) => day(`2026-01-${String(d).padStart(2, "0")}`);
		expect(dateReached(before, "2026-01-10", isoDateAdapter, jan(6), jan(7))).toBe(true);
		expect(dateReached(before, "2026-01-10", isoDateAdapter, jan(5), jan(6))).toBe(false);
		expect(dateReached(before, "2026-01-10", isoDateAdapter, jan(7), jan(8))).toBe(false);
		expect(dateReached(before, "2026-01-10", isoDateAdapter, jan(1), jan(9))).toBe(true);
		expect(dateReached(dateT({ offset: 2 }), "2026-01-10", isoDateAdapter, jan(11), jan(12))).toBe(true);
		expect(dateReached(dateT(), "not a date", isoDateAdapter, jan(1), jan(9))).toBe(false);
		expect(dateReached(dateT(), "", isoDateAdapter, jan(1), jan(9))).toBe(false);
	});

	it("read timed triggers back tidied, say them in words, and check them", () => {
		const back = readWorkflows([
			{ id: "s", name: "S", scope: ["task"], trigger: { kind: "schedule", every: "week", at: "25:00", day: 9, limit: 0 }, steps: [] },
			{ id: "d", name: "D", scope: ["task"], trigger: { kind: "date", field: "due", offset: -3, at: "07:15", limit: 10 }, steps: [] },
		]);
		expect(back[0].trigger).toEqual({ kind: "schedule", every: "week", at: "09:00", day: 1, hours: 4, limit: 50 });
		expect(back[1].trigger).toEqual({ kind: "date", field: "due", offset: -3, at: "07:15", limit: 10 });
		expect(isTimed(back[0].trigger) && isTimed(back[1].trigger)).toBe(true);
		const text = (t: WorkflowDef["trigger"]) => triggerText(wf({ trigger: t }), TYPES);
		expect(text(sched())).toBe("Every day at 09:00");
		expect(text(sched({ every: "week", day: 1 }))).toBe("Every Monday at 09:00");
		expect(text(sched({ every: "hours", hours: 1 }))).toBe("Every hour");
		expect(text(dateT({ offset: -3 }))).toBe("3 days before Due, at 09:00");
		expect(text(dateT({ offset: 1 }))).toBe("1 day after Due, at 09:00");
		expect(text(dateT())).toBe("When Due is today, at 09:00");
		const probs = (t: WorkflowDef["trigger"], steps: WorkflowDef["steps"] = [{ kind: "tag", op: "add", tag: "x" }], scope = ["task"]) => workflowProblems(wf({ name: "x", scope, trigger: t, steps }), ctx).map((p) => p.message);
		expect(probs(dateT())).toEqual([]);
		expect(probs(dateT({ field: "estimate" }))).toEqual(["Estimate isn't a date field."]);
		expect(probs(dateT({ field: "" }))).toEqual(["Choose the date field."]);
		expect(probs(sched({ at: "9am" }))).toEqual(["Choose the time, e.g. 09:00."]);
		expect(probs(sched({ every: "hours", hours: 0, limit: 0 }))).toEqual(["Every 1 to 168 hours.", "Allow at least 1 note per run."]);
		expect(probs(sched(), [{ kind: "tag", op: "add", tag: "x" }], [])).toEqual(["Choose the types this workflow watches."]);
		expect(probs(sched(), [{ kind: "ask", text: "Sure?" }])).toEqual(["A workflow that runs on its own can't ask a question: nobody may be there to answer."]);
	});
});
describe("not setting off other workflows", () => {
	it("read the switch back only when it's on", () => {
		const back = readWorkflows([
			{ id: "a", name: "A", scope: ["task"], trigger: { kind: "manual" }, steps: [], isolated: true },
			{ id: "b", name: "B", scope: ["task"], trigger: { kind: "manual" }, steps: [], isolated: "yes" },
			{ id: "c", name: "C", scope: ["task"], trigger: { kind: "manual" }, steps: [] },
		]);
		expect(back.map((w) => w.isolated)).toEqual([true, undefined, undefined]);
		expect("isolated" in back[2]).toBe(false);
	});
});
describe("once for the whole selection", () => {
	const t1 = row("Plan", TASK, { estimate: 2, project: "[[Apollo]]" });
	const t2 = row("Build", TASK, { estimate: 5, project: "[[Apollo]]" });
	const all = [ROWS[0], t1, t2];
	const at = new Map(all.map((r) => [r.path, r]));
	const ctx2: ViewContext = { ...ctx, resolve: (p) => (at.has(`${p}.md`) ? `${p}.md` : at.has(p) ? p : null), row: (p) => at.get(p) };
	const place = (req: PlaceRequest): Placed => ({ path: `New/${req.name}.md` });
	const once = (steps: WorkflowDef["steps"]) => wf({ name: "x", scope: ["task"], trigger: { kind: "manual", label: "Go", selection: "once" }, steps });
	const go = (w: WorkflowDef, sel: ViewRow[]) => runSteps(w, { ctx: ctx2, row: sel[0], linkText, place, selection: sel });
	const eachSelected = (steps: WorkflowDef["steps"][number][]) => ({ kind: "each", formula: `[${SELECTION_VAR}]`, items: "notes", itemType: "task", when: { mode: "all", items: [] }, as: "Task", steps }) as WorkflowDef["steps"][number];

	it("read it back, say it, and give steps the selection instead of a note", () => {
		const back = readWorkflows([{ id: "a", name: "A", scope: ["task"], trigger: { kind: "manual", selection: "once" }, steps: [] }, { id: "b", name: "B", scope: ["task"], trigger: { kind: "manual", selection: "each" }, steps: [] }]);
		expect(back.map((w) => runsOnce(w))).toEqual([true, false]);
		expect(triggerText(back[0], TYPES)).toBe("Button: A (once for the selection)");
		const sc = stepScopes(once([{ kind: "notice", text: "x" }, eachSelected([{ kind: "tag", op: "add", tag: "y" }])]), ctx);
		expect(sc.get("0")).toMatchObject({ noNote: true, defaultLabel: "No single note" });
		expect(sc.get("0")!.vars.map((v) => v.name)).toEqual([SELECTION_VAR]);
		// Inside a loop over the selection: each note, but no "This note".
		expect(sc.get("1.0")!.noNote).toBeUndefined();
		expect(sc.get("1.0")!.vars.map((v) => v.name)).toEqual([SELECTION_VAR, "Task"]);
		expect(sc.get("1.0")!.on.map((o) => o.value)).toEqual([]);
	});

	it("flag what needs a single note", () => {
		const probs = (steps: WorkflowDef["steps"]) => workflowProblems(once(steps), ctx).map((p) => `${p.at}: ${p.message}`);
		expect(probs([{ kind: "set", field: "estimate", value: "1" }])).toEqual([`step:0: ${NO_NOTE}`]);
		expect(probs([{ kind: "notice", text: "{[Name]} done" }])[0]).toMatch(/no single note here/);
		expect(probs([{ kind: "notice", text: `{count([${SELECTION_VAR}])} done` }])).toEqual([]);
		expect(probs([eachSelected([{ kind: "set", field: "estimate", value: "[Estimate] + 1" }, { kind: "tag", op: "add", tag: "x", on: ON_THIS }])])).toEqual([`step:0.1: ${NO_NOTE}`]);
		expect(probs([{ kind: "create", type: "project", name: "Review", fields: [], link: { dir: "to-new", field: "project" }, template: true, open: "no", exists: "new", as: "Review" }])[0]).toMatch(/no single note to link/);
		expect(probs([{ kind: "linked", source: { dir: "out", field: "project" }, when: { mode: "all", items: [] }, as: "P", steps: [{ kind: "tag", op: "add", tag: "x" }] }])[0]).toMatch(/For linked notes starts from a note/);
		// The same steps are fine on each note.
		expect(workflowProblems(wf({ name: "x", scope: ["task"], trigger: { kind: "manual" }, steps: [{ kind: "set", field: "estimate", value: "1" }] }), ctx)).toEqual([]);
	});

	it("run once: one note made from the selection, then each selected note changed", () => {
		const w = once([
			{ kind: "create", type: "project", name: `Review of {count([${SELECTION_VAR}])} tasks`, fields: [], template: true, open: "no", exists: "new", as: "Review" },
			eachSelected([
				{ kind: "set", field: "estimate", value: "[Estimate] + 1" },
				{ kind: "link", op: "add", field: "project", target: "[Review]" },
			]),
			{ kind: "notice", text: `{join(map([${SELECTION_VAR}], name(item)), ", ")}` },
		]);
		const res = go(w, [t1, t2]);
		expect(res.error).toBeUndefined();
		expect(res.changes).toEqual([]);
		expect(res.others.map((o) => [o.path, o.created ? "new" : "changed", o.fm.estimate, o.fm.project])).toEqual([
			["New/Review of 2 tasks.md", "new", undefined, undefined],
			["Plan.md", "changed", 3, "[[New/Review of 2 tasks]]"],
			["Build.md", "changed", 6, "[[New/Review of 2 tasks]]"],
		]);
		expect(res.notices).toEqual(["Plan, Build"]);
		expect(runReach(res)).toEqual({ changed: 2, created: 1 });
		// Acting on "this note" stops the run, even if the problems were missed.
		expect(go(once([{ kind: "set", field: "estimate", value: "1" }]), [t1]).error?.message).toBe(NO_NOTE);
	});
});