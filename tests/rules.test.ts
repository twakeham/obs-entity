import { describe, expect, it } from "vitest";
import { isoDateAdapter } from "../src/model/dates";
import { entityProblems, type CheckContext } from "../src/model/form";
import { boundDays, boundText, pruneRules, ruleMessages, rulesIssues, type RuleContext } from "../src/model/rules";
import { renameFieldRefs } from "../src/model/typeEditing";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import { typeIssues } from "../src/model/validation";

const day = (iso: string) => (isoDateAdapter.parse(iso) as { value: number }).value;
const TODAY = day("2026-11-04");
const f = (key: string, kind: FieldDef["kind"], rules: FieldDef["rules"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label: key[0].toUpperCase() + key.slice(1), kind, rules, ...extra });
const rctx = (values: Record<string, unknown> = {}, others?: RuleContext["others"]): RuleContext => ({
	dates: isoDateAdapter,
	today: TODAY,
	showDate: (d) => isoDateAdapter.format(d, "short"),
	values,
	labelOf: (k) => k[0].toUpperCase() + k.slice(1),
	...(others ? { others } : {}),
});
const msgs = (field: FieldDef, v: unknown, values: Record<string, unknown> = {}, others?: RuleContext["others"]) => ruleMessages(field, v, rctx(values, others));

describe("validation rules", () => {
	it("reads date bounds: fixed, today, and today ± days / weeks / months / years", () => {
		expect(boundDays("2026-01-31", TODAY, isoDateAdapter)).toBe(day("2026-01-31"));
		expect(boundDays("today", TODAY, isoDateAdapter)).toBe(TODAY);
		expect(boundDays("today + 14d", TODAY, isoDateAdapter)).toBe(day("2026-11-18"));
		expect(boundDays("today-2w", TODAY, isoDateAdapter)).toBe(day("2026-10-21"));
		expect(boundDays("today+1m", TODAY, isoDateAdapter)).toBe(day("2026-12-04"));
		expect(boundDays("today-1y", TODAY, isoDateAdapter)).toBe(day("2025-11-04"));
		expect(boundDays("soon", TODAY, isoDateAdapter)).toBeNull();
		expect(boundText("today+14d", (d) => String(d), TODAY, isoDateAdapter)).toBe("today + 14 days");
		expect(boundText("today-1y", (d) => String(d), TODAY, isoDateAdapter)).toBe("today − 1 year");
	});

	it("checks numbers: limits and whole numbers", () => {
		const n = f("players", "number", { min: 1, max: 6, integer: true });
		expect(msgs(n, 3)).toEqual([]);
		expect(msgs(n, 0)).toEqual(["Must be between 1 and 6."]);
		expect(msgs(n, 2.5)).toEqual(["Must be a whole number."]);
		expect(msgs(f("hp", "number", { min: 0 }), -1)).toEqual(["Must be at least 0."]);
		expect(msgs(f("hp", "number", { max: 10 }), 11)).toEqual(["Must be at most 10."]);
		// Empty values aren't checked (that's "required").
		expect(msgs(n, null)).toEqual([]);
	});

	it("checks text: length and pattern (with its own message)", () => {
		const code = f("code", "text", { pattern: "^[A-Z]{3}-\\d+$", patternMessage: "Use the form ABC-123" });
		expect(msgs(code, "ABC-12")).toEqual([]);
		expect(msgs(code, "abc-12")).toEqual(["Use the form ABC-123"]);
		expect(msgs(f("code", "text", { pattern: "^x" }), "y")).toEqual(["Doesn't match the pattern ^x"]);
		expect(msgs(f("name", "textarea", { minLength: 3, maxLength: 5 }), "ab")).toEqual(["Must be at least 3 characters (it has 2)."]);
		expect(msgs(f("name", "textarea", { maxLength: 5 }), "abcdef")).toEqual(["Must be at most 5 characters (it has 6)."]);
		// A broken pattern isn't applied (the type editor reports it).
		expect(msgs(f("code", "text", { pattern: "([" }), "x")).toEqual([]);
	});

	it("checks dates: bounds and another date field", () => {
		const due = f("due", "date", { earliest: "today", latest: "2027-12-31", compare: { op: "not-before", field: "start" } });
		expect(msgs(due, "2026-12-01", { start: "2026-11-10" })).toEqual([]);
		expect(msgs(due, "2026-11-01")).toEqual(["Must be on or after today."]);
		expect(msgs(due, "2028-01-01")).toEqual(["Must be on or before 2027-12-31."]);
		expect(msgs(due, "2026-11-20", { start: "2026-11-25" })).toEqual(["Must be on or after Start (2026-11-25)."]);
		expect(msgs(f("due", "date", { latest: "today+7d" }), "2026-12-01")).toEqual(["Must be on or before today + 7 days (2026-11-11)."]);
		// No start date: nothing to compare with.
		expect(msgs(due, "2026-12-01", {})).toEqual([]);
	});

	it("checks how many items", () => {
		const tags = f("labels", "list", { minItems: 1, maxItems: 2 });
		expect(msgs(tags, ["a", "b", "c"])).toEqual(["Can have at most 2 items (it has 3)."]);
		expect(msgs(f("team", "relation", { minItems: 2 }, { multiple: true }), ["[[Ada]]"])).toEqual(["Needs at least 2 items (it has 1)."]);
	});

	it("checks unique values against other notes", () => {
		const code = f("code", "text", { unique: true });
		const others = () => [
			{ name: "Alpha", value: "ABC-1" },
			{ name: "Beta", value: "abc-1 " },
			{ name: "Gamma", value: "XYZ-9" },
		];
		expect(msgs(code, "ABC-1", {}, others)).toEqual(["Must be unique: 2 other notes have the same value."]);
		expect(msgs(code, "XYZ-9", {}, others)).toEqual(["Must be unique: “Gamma” has the same value."]);
		expect(msgs(code, "NEW-1", {}, others)).toEqual([]);
	});

	it("are problems on the note, with required when… and unique leaving the note itself out", () => {
		const GROUPS: GroupDef[] = [{ key: "g", name: "G", icon: "x", statuses: ["todo", "doing", "done"] }];
		const T = {
			key: "task",
			name: "Task",
			plural: "Tasks",
			icon: "x",
			color: "",
			group: "g",
			fields: [f("estimate", "number", { min: 0, max: 40 }), f("due", "date", { requiredWhen: { all: [{ field: "status", op: "any-of", value: ["doing"] }] } }), f("code", "text", { unique: true })],
		} as unknown as EntityTypeDef;
		const ctx: CheckContext = {
			types: [T],
			groups: GROUPS,
			dates: isoDateAdapter,
			resolve: () => null,
			today: TODAY,
			path: "me.md",
			others: () => [
				{ path: "me.md", name: "Me", value: "A1" },
				{ path: "other.md", name: "Other", value: "B2" },
			],
		};
		const p = entityProblems(T, { status: "doing", estimate: 50, code: "A1" }, ctx);
		expect(p.map((x) => `${x.key}:${x.severity}:${x.message}`)).toEqual(["estimate:error:Must be between 0 and 40.", "due:warning:Due is required when Status is any of doing."]);
		expect(p.find((x) => x.key === "due")?.missing).toBe(true);
		expect(entityProblems(T, { status: "todo", code: "B2" }, ctx).map((x) => x.message)).toEqual(["Must be unique: “Other” has the same value."]);
		// A value the type can't read is reported as that, not against the rules.
		expect(entityProblems(T, { status: "todo", estimate: "lots" }, ctx).map((x) => x.message)).toEqual(["“lots” isn't a number."]);
	});

	it("flags rules that can't work, in the type editor", () => {
		const others = [f("start", "date", undefined), f("name", "text", undefined)];
		expect(rulesIssues(f("x", "number", { min: 5, max: 1 }), others, isoDateAdapter)).toEqual(["The minimum is more than the maximum."]);
		expect(rulesIssues(f("x", "text", { pattern: "([" }), others, isoDateAdapter)[0]).toMatch(/isn't a valid regular expression/);
		expect(rulesIssues(f("x", "date", { earliest: "soon" }), others, isoDateAdapter)[0]).toMatch(/isn't a date/);
		expect(rulesIssues(f("x", "date", { compare: { op: "after", field: "name" } }), others, isoDateAdapter)).toEqual(["“Name” isn't a date field."]);
		expect(rulesIssues(f("x", "date", { compare: { op: "after", field: "gone" } }), others, isoDateAdapter)[0]).toMatch(/isn't a field/);
		const t = { key: "t", name: "T", plural: "Ts", icon: "x", color: "", group: "g", fields: [f("x", "number", { min: 5, max: 1 })] } as unknown as EntityTypeDef;
		expect(typeIssues(t, { typeKeys: [], groupKeys: ["g"] }).some((i) => i.at === "field:0:rules")).toBe(true);
	});

	it("keep only what the new kind can use when a field changes kind", () => {
		const x = f("x", "text", { maxLength: 5, pattern: "^a", unique: true, requiredWhen: { all: [{ field: "status", op: "not-empty" }] } });
		x.kind = "number";
		pruneRules(x);
		expect(x.rules).toEqual({ unique: true, requiredWhen: { all: [{ field: "status", op: "not-empty" }] } });
		x.kind = "formula";
		pruneRules(x);
		expect(x.rules).toBeUndefined();
	});

	it("follow renamed fields", () => {
		const t = {
			key: "t",
			fields: [f("start", "date", undefined), f("due", "date", { compare: { op: "after", field: "start" }, requiredWhen: { all: [{ field: "start", op: "not-empty" }] } })],
		} as unknown as EntityTypeDef;
		renameFieldRefs(t, "start", "begins");
		expect(t.fields[1].rules?.compare?.field).toBe("begins");
		expect(t.fields[1].rules?.requiredWhen).toEqual({ all: [{ field: "begins", op: "not-empty" }] });
	});
});
