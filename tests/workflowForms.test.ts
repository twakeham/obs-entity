import { describe, expect, it } from "vitest";
import moment from "moment";
import { isoDateAdapter } from "../src/model/dates";
import type { MomentLike } from "../src/model/formats";
import { placeableKeys, resolveLayout } from "../src/model/formLayout";
import { renameWorkflowKeys } from "../src/model/packs";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import { DateVal } from "../src/model/formula";
import { compileFormula, type ViewContext, type ViewRow } from "../src/model/views";
import {
	answerTexts,
	formAnswers,
	formType,
	isFormType,
	newWorkflow,
	NO_NOTE_FORM,
	noteless,
	onNotes,
	readWorkflows,
	renameRefs,
	runSteps,
	stepScopes,
	triggerText,
	workflowDef,
	workflowProblems,
	type FormTrigger,
	type PlaceRequest,
	type Placed,
	type WorkflowDef,
	type WorkflowStep,
} from "../src/model/workflows";

const GROUPS: GroupDef[] = [{ key: "work", name: "Work", icon: "x", statuses: ["todo", "doing", "done"] }];
const f = (key: string, label: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const type = (key: string, fields: FieldDef[]): EntityTypeDef => ({ key, name: key[0].toUpperCase() + key.slice(1), plural: `${key}s`, icon: "x", color: "", group: "work", template: "", fields }) as EntityTypeDef;
const CAMPAIGN = type("campaign", [f("current", "Current session", "relation", { targets: ["session"] })]);
const SESSION = type("session", [f("date", "Date", "date"), f("campaign", "Campaign", "relation", { targets: ["campaign"] }), f("attendees", "Attendees", "relation", { targets: ["*"], multiple: true })]);
const TYPES = [CAMPAIGN, SESSION];
const row = (name: string, t: EntityTypeDef, fm: Record<string, unknown>): ViewRow => ({ path: `${name}.md`, name, type: t, status: "todo", subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null, frontmatter: { status: "todo", ...fm } });
const ROWS = [row("Dragons", CAMPAIGN, {}), row("Ann", SESSION, {}), row("Bob", SESSION, {})];
const byPath = new Map(ROWS.map((r) => [r.path, r]));
const ctx: ViewContext = {
	types: TYPES,
	groups: GROUPS,
	dates: isoDateAdapter,
	today: (isoDateAdapter.parse("2026-11-12") as { value: number }).value,
	resolve: (p) => (byPath.has(`${p}.md`) ? `${p}.md` : byPath.has(p) ? p : null),
	row: (p) => byPath.get(p),
	incoming: () => [],
	moment: moment as unknown as MomentLike,
	locale: "en-AU",
	currency: "AUD",
	dateFormat: "DD/MM/YYYY",
};
const linkText = (p: string) => p.replace(/\.md$/, "");
const lookup = { types: TYPES, groups: GROUPS };

const LOG_FORM: FormTrigger = {
	kind: "form",
	title: "Log session",
	button: "Log it",
	fields: [f("date", "Date", "date", { required: true }), f("campaign", "Campaign", "relation", { targets: ["campaign"] }), f("people", "People", "relation", { multiple: true }), f("summary", "Summary", "textarea"), f("hours", "Hours", "number"), f("topics", "Topics", "list"), f("big", "Big", "boolean")],
};
const form = (over: Partial<WorkflowDef> = {}): WorkflowDef => ({ ...newWorkflow([], LOG_FORM), name: "Log session", ...over });
const VALUES = { date: "2026-11-12", campaign: "[[Dragons]]", people: ["[[Ann]]", "[[Nobody]]"], summary: "We met.", hours: 3, topics: ["combat"], big: true };

describe("form workflows", () => {
	it("read forms: fields (not calculated ones), layout and title; own command", () => {
		const [w] = readWorkflows([
			{
				id: "w",
				name: "Log",
				scope: [],
				command: true,
				trigger: { kind: "form", title: "Log session", button: "Log", fields: [{ key: "date", label: "Date", kind: "date" }, { key: "n", label: "N", kind: "formula", formula: "1" }, { nope: 1 }], layout: { items: [{ kind: "field", key: "date" }] } },
				steps: [],
			},
		]);
		expect(w.command).toBe(true);
		expect(w.trigger).toMatchObject({ kind: "form", title: "Log session", button: "Log", fields: [{ key: "date", label: "Date", kind: "date" }], layout: { items: [{ kind: "field", key: "date" }] } });
		expect(noteless(w)).toBe(true);
		expect(onNotes(w)).toBe(false);
		expect(onNotes({ ...w, scope: ["session"] })).toBe(true);
		expect(triggerText(w, TYPES)).toBe("Form: Log session");
		expect(triggerText({ ...w, scope: ["session"] }, TYPES)).toBe("Form: Log session (on sessions)");
	});

	it("follow a renamed answer into every step's formulas and texts", () => {
		const steps: WorkflowStep[] = [
			{ kind: "notice", text: "{[summary]} on {[Date]} ({{[Summary]}})" },
			{ kind: "if", test: "formula", when: { mode: "all", items: [] }, formula: "empty([Summary])", steps: [{ kind: "var", name: "S", value: "[Summary] + \"!\"" }], otherwise: [] },
			{ kind: "create", type: "session", name: "{[Summary]}", fields: [{ field: "date", value: "[Date]" }], template: false, open: "no", exists: "new", as: "New" },
		];
		const out = renameRefs(steps, "Summary", "What happened");
		expect(out[0]).toMatchObject({ text: "{[What happened]} on {[Date]} ({{[Summary]}})" });
		expect(out[1]).toMatchObject({ formula: "empty([What happened])", steps: [{ value: "[What happened] + \"!\"" }] });
		expect(out[2]).toMatchObject({ name: "{[What happened]}", fields: [{ value: "[Date]" }] });
		expect(renameRefs(steps, "Summary", "")).toBe(steps);
	});

	it("follow renamed types into a form's link fields (pack imports)", () => {
		const w = renameWorkflowKeys(form({ scope: ["campaign"] }), new Map([["campaign", "saga"]]));
		expect(w.scope).toEqual(["saga"]);
		expect((w.trigger as FormTrigger).fields.find((x) => x.key === "campaign")?.targets).toEqual(["saga"]);
		expect(LOG_FORM.fields.find((x) => x.key === "campaign")?.targets).toEqual(["campaign"]);
	});

	it("edit and show a form as a type with only its fields to place", () => {
		const ft = formType(LOG_FORM);
		expect(isFormType(ft)).toBe(true);
		expect(placeableKeys(ft)).toEqual(LOG_FORM.fields.map((x) => x.key));
		expect(resolveLayout({ items: [{ kind: "field", key: "status" }, { kind: "field", key: "date" }] }, ft).items).toEqual([{ kind: "field", key: "date" }]);
	});

	it("turn answers into formula values, and into words for the log", () => {
		const a = formAnswers(LOG_FORM, VALUES, ctx, linkText);
		expect(a.Date).toBeInstanceOf(DateVal);
		expect(a.Campaign).toEqual([{ path: "Dragons.md", linktext: "Dragons", name: "Dragons" }]);
		expect(a.People).toEqual([
			{ path: "Ann.md", linktext: "Ann", name: "Ann" },
			{ path: null, linktext: "Nobody", name: "Nobody" },
		]);
		expect(a).toMatchObject({ Summary: "We met.", Hours: 3, Topics: ["combat"], Big: true });
		expect(formAnswers(LOG_FORM, {}, ctx, linkText)).toMatchObject({ Date: null, Campaign: [], Summary: null, Hours: null, Topics: [], Big: false });
		expect(answerTexts(LOG_FORM, VALUES)).toEqual([
			{ question: "Date", answer: "2026-11-12" },
			{ question: "Campaign", answer: "Dragons" },
			{ question: "People", answer: "Ann, Nobody" },
			{ question: "Summary", answer: "We met." },
			{ question: "Hours", answer: "3" },
			{ question: "Topics", answer: "combat" },
			{ question: "Big", answer: "Yes" },
		]);
	});

	it("give steps the answers as names, and the single-note ones to act on; no note when it starts on its own", () => {
		const sc = stepScopes(form({ steps: [{ kind: "notice", text: "" }] }), lookup).get("0")!;
		expect(sc.noNote).toBe(true);
		expect(sc.vars.map((v) => `${v.name}:${v.type}:${v.role}`)).toEqual(["Date:date:form", "Campaign:links:form", "People:links:form", "Summary:text:form", "Hours:number:form", "Topics:list:form", "Big:bool:form"]);
		expect(sc.on).toEqual([{ value: "Campaign", label: "Campaign", types: [CAMPAIGN], answer: true }]);
		// Only a form's answers come before the columns; "Ask a question" answers keep theirs after.
		const def = workflowDef({ scope: ["session"], when: { mode: "all", items: [] } });
		expect(compileFormula("[Date]", def, lookup, { workflow: true, vars: [{ name: "Date", type: "text", role: "form" }] }).refs.size).toBe(0);
		expect(compileFormula("[Date]", def, lookup, { workflow: true, vars: [{ name: "Date", type: "text", role: "answer" }] }).refs.size).toBe(1);
		const scoped = stepScopes(form({ scope: ["campaign"], steps: [{ kind: "notice", text: "" }] }), lookup).get("0")!;
		expect(scoped.noNote).toBeUndefined();
		expect(scoped.vars[0]).toMatchObject({ name: "This note", role: "this" });
	});

	it("flag steps on a note it hasn't got, clashing names, and form problems", () => {
		const probs = (w: WorkflowDef) => workflowProblems(w, lookup).map((p) => `${p.at}: ${p.message}`);
		expect(probs(form({ steps: [{ kind: "tag", op: "add", tag: "x" }] }))).toEqual([`step:0: ${NO_NOTE_FORM}`]);
		// The answer "Date" is a session field's name too: fine without a note, a clash with one.
		expect(probs(form({ steps: [{ kind: "tag", op: "add", tag: "x", on: "Campaign" }, { kind: "notice", text: "{[Date]} {[Summary]}" }] }))).toEqual([]);
		expect(probs(form({ scope: ["session"], steps: [{ kind: "notice", text: "{[Summary]}" }] }))).toEqual(["Date", "Campaign"].map((n) => `form: “${n}” is already a field of these notes: give the form's field another label, so steps can tell the answer from the note's field.`));
		const twice: FormTrigger = { ...LOG_FORM, fields: [f("a", "Name", "text"), f("b", "name", "text"), f("c", "Pick", "select")] };
		expect(probs(form({ trigger: twice, steps: [{ kind: "notice", text: "{[Name]}" }] }))).toEqual([
			"form: Choice field \"c\" needs at least one option.",
			"form: Two of the form's fields are called “name”: steps use the answers by name, so give one another label.",
		]);
		expect(probs(form({ when: { mode: "all", items: [{ field: "f:date", op: "is-empty" }] }, steps: [{ kind: "notice", text: "x" }] }))).toContain("when: This form starts on its own, with no note to check: remove the conditions (an If step can test the answers).");
		expect(probs(form({ steps: [{ kind: "var", name: "Summary", value: "1" }] }))).toEqual(["step:0: “Summary” is already the name of a note, a loop item or one of the form's answers: choose another."]);
		const caller: WorkflowDef = { ...newWorkflow(["session"], { kind: "manual" }), id: "caller", name: "Caller", steps: [{ kind: "run", workflow: "logform" }] };
		expect(workflowProblems(caller, { ...lookup, workflows: [caller, form({ id: "logform", steps: [{ kind: "notice", text: "x" }] })] }).map((p) => p.message)).toEqual(["“Log session” has a form to fill in, so it can't be run from another workflow."]);
	});

	it("run with the answers: create a note from them, act on the note picked, skip steps on one not picked", () => {
		const place = (req: PlaceRequest): Placed => ({ path: `Sessions/${req.name}.md` });
		const steps: WorkflowStep[] = [
			{ kind: "create", type: "session", name: "{format([Date], \"YYYY-MM-DD\")} {[Summary]}", fields: [{ field: "date", value: "[Date]" }, { field: "campaign", value: "[Campaign]" }, { field: "attendees", value: "[People]" }], template: false, open: "no", exists: "new", as: "New session" },
			{ kind: "link", op: "add", field: "current", target: "[New session]", on: "Campaign" },
			{ kind: "append", text: "- {[Summary]}", where: "end", heading: "", on: "Campaign" },
		];
		const w = form({ steps });
		expect(workflowProblems(w, lookup)).toEqual([]);
		const stand = row("", SESSION, {});
		const res = runSteps(w, { ctx, row: stand, linkText, place, noNote: true, form: formAnswers(LOG_FORM, { ...VALUES, people: ["[[Ann]]"] }, ctx, linkText) });
		expect(res.error).toBeUndefined();
		expect(res.changes).toEqual([]);
		const made = res.others.find((o) => o.created)!;
		expect(made.path).toBe("Sessions/2026-11-12 We met..md");
		expect(made.fm).toMatchObject({ date: "2026-11-12", campaign: "[[Dragons]]", attendees: ["[[Ann]]"] });
		expect(res.others.find((o) => o.path === "Dragons.md")).toMatchObject({ changes: [{ key: "current", after: "[[Sessions/2026-11-12 We met.]]" }], adds: [{ text: "- We met.", where: "end" }] });
		// No campaign picked: the steps on it are skipped.
		const none = runSteps(w, { ctx, row: stand, linkText, place, noNote: true, form: formAnswers(LOG_FORM, { ...VALUES, people: [], campaign: null }, ctx, linkText) });
		expect(none.error).toBeUndefined();
		expect(none.others.map((o) => o.path)).toEqual(["Sessions/2026-11-12 We met..md"]);
	});
});
