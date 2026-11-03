import { describe, expect, it } from "vitest";
import { isoDateAdapter } from "../src/model/dates";
import { entityProblems, type CheckContext } from "../src/model/form";
import { conditionProblems, evalWhen, hiddenFields, whenIssues, whenText, type WhenContext } from "../src/model/formConditions";
import { normaliseLayout, renameLayoutKey, type FormLayout, type LayoutWhen } from "../src/model/formLayout";
import { STARTER_PACK } from "../src/model/packs";
import { cloneType, statusesFor, type EntityTypeDef } from "../src/model/types";

const GROUPS = STARTER_PACK.groups!;
const day = (s: string) => (isoDateAdapter.parse(s) as { value: number }).value;
const risk = (): EntityTypeDef => {
	const t = cloneType(STARTER_PACK.types.find((x) => x.key === "project")!);
	t.fields.push(
		{ key: "likelihood", label: "Likelihood", kind: "select", options: ["Low", "Medium", "High"] },
		{ key: "mitigation", label: "Mitigation", kind: "textarea", required: true },
		{ key: "score", label: "Score", kind: "number" },
		{ key: "tags_note", label: "Flagged", kind: "boolean" },
	);
	return t;
};
const T = risk();
const ctx: WhenContext = { types: [T], groups: GROUPS, dates: isoDateAdapter, today: day("2026-11-01"), resolve: (lp) => (lp === "Ada" ? "People/Ada.md" : null) };
const high: LayoutWhen = { all: [{ field: "likelihood", op: "any-of", value: ["High"] }] };

describe("show only when", () => {
	it("reads conditions on frames, tabs and slots, dropping empty or broken ones", () => {
		const l = normaliseLayout({
			items: [
				{ kind: "frame", caption: "A", when: { any: [{ field: "likelihood", op: "any-of", value: ["High"] }, { field: "", op: "x" }, "junk"] }, items: [{ kind: "field", key: "mitigation", when: { all: [] } }] },
				{ kind: "tabs", tabs: [{ caption: "T", when: { all: [{ field: "status", op: "not-empty" }] }, items: [] }] },
				{ kind: "field", key: "score", when: { all: [{ field: "score", op: ">", value: 5 }] } },
				{ kind: "field", key: "due", when: { mode: "all", items: [] } },
			],
		})!;
		expect(l.items).toEqual([
			{ kind: "frame", caption: "A", when: { any: [{ field: "likelihood", op: "any-of", value: ["High"] }] }, items: [{ kind: "field", key: "mitigation" }] },
			{ kind: "tabs", tabs: [{ caption: "T", when: { all: [{ field: "status", op: "not-empty" }] }, items: [] }] },
			{ kind: "field", key: "score", when: { all: [{ field: "score", op: ">", value: 5 }] } },
			{ kind: "field", key: "due" },
		]);
	});

	it("tests the note's own values with the view filters' operators", () => {
		expect(evalWhen(high, T, { likelihood: "High" }, ctx)).toBe(true);
		expect(evalWhen(high, T, { likelihood: "Low" }, ctx)).toBe(false);
		expect(evalWhen(high, T, {}, ctx)).toBe(false);
		const both: LayoutWhen = { all: [...(high as { all: [] }).all, { field: "score", op: ">", value: 5 }] };
		expect(evalWhen(both, T, { likelihood: "High", score: 7 }, ctx)).toBe(true);
		expect(evalWhen(both, T, { likelihood: "High", score: 3 }, ctx)).toBe(false);
		expect(evalWhen({ any: (both as { all: never[] }).all }, T, { likelihood: "Low", score: 9 }, ctx)).toBe(true);
		const s0 = statusesFor(T, GROUPS)[0];
		expect(evalWhen({ all: [{ field: "status", op: "any-of", value: [s0] }] }, T, { status: s0 }, ctx)).toBe(true);
		expect(evalWhen({ all: [{ field: "tags", op: "has-any", value: ["urgent"] }] }, T, { tags: ["#urgent"] }, ctx)).toBe(true);
		expect(evalWhen({ all: [{ field: "due", op: "before", value: "+7d" }] }, T, { due: "2026-11-05" }, ctx)).toBe(true);
		expect(evalWhen({ all: [{ field: "due", op: "before", value: "+7d" }] }, T, { due: "2026-12-05" }, ctx)).toBe(false);
		expect(evalWhen({ all: [{ field: "owner", op: "links-any", value: ["People/Ada.md"] }] }, T, { owner: "[[Ada]]" }, ctx)).toBe(true);
		expect(evalWhen({ all: [{ field: "tags_note", op: "checked" }] }, T, { tags_note: true }, ctx)).toBe(true);
		expect(evalWhen({ all: [{ field: "description", op: "is-not", value: "" }] }, T, {}, ctx)).toBe(true);
	});

	it("ignores conditions it can't use (and shows the thing when none are usable)", () => {
		expect(evalWhen({ all: [{ field: "gone", op: "any-of", value: ["x"] }] }, T, {}, ctx)).toBe(true);
		expect(evalWhen({ all: [{ field: "likelihood", op: "any-of", value: [] }] }, T, {}, ctx)).toBe(true);
		expect(evalWhen({ all: [{ field: "gone", op: "any-of", value: ["x"] }, ...(high as { all: [] }).all] }, T, { likelihood: "Low" }, ctx)).toBe(false);
		const ps = conditionProblems({ all: [{ field: "gone", op: "is", value: "x" }, { field: "likelihood", op: "any-of" }] }, T, ctx);
		expect(ps.map((p) => [p.issue, p.incomplete])).toEqual([
			["“gone” isn't a field of this type.", false],
			["It needs a value.", true],
		]);
	});

	it("works out which fields a layout hides", () => {
		const l: FormLayout = {
			items: [
				{ kind: "frame", caption: "Risk", when: high, items: [{ kind: "field", key: "mitigation" }, { kind: "columns", columns: [[{ kind: "field", key: "score" }], []] }] },
				{ kind: "tabs", tabs: [{ caption: "Later", when: { all: [{ field: "due", op: "not-empty" }] }, items: [{ kind: "field", key: "start" }] }] },
				{ kind: "field", key: "owner", when: { all: [{ field: "likelihood", op: "not-empty" }] } },
			],
		};
		expect([...hiddenFields(l, T, {}, ctx)].sort()).toEqual(["mitigation", "owner", "score", "start"]);
		expect([...hiddenFields(l, T, { likelihood: "High", due: "2027-01-01" }, ctx)]).toEqual([]);
		expect([...hiddenFields(l, T, { likelihood: "Low" }, ctx)].sort()).toEqual(["mitigation", "score", "start"]);
	});

	it("doesn't require a field that's hidden by a condition", () => {
		const t = risk();
		t.form = { layout: { items: [{ kind: "frame", caption: "Risk", when: high, items: [{ kind: "field", key: "mitigation" }] }] } };
		const c: CheckContext = { types: [t], groups: GROUPS, dates: isoDateAdapter, resolve: () => null, today: ctx.today };
		const missing = (fm: Record<string, unknown>) => entityProblems(t, fm, c).filter((p) => p.key === "mitigation").map((p) => p.message);
		expect(missing({ likelihood: "Low" })).toEqual([]);
		expect(missing({ likelihood: "High" })).toEqual(["Mitigation is required."]);
		// other problems in a hidden field still count
		expect(entityProblems(t, { likelihood: "Low", mitigation: ["a", "b"] }, c).some((p) => p.key === "mitigation")).toBe(true);
	});

	it("follows renames, and reports conditions on deleted fields", () => {
		const l: FormLayout = { items: [{ kind: "frame", caption: "Risk", when: high, items: [{ kind: "field", key: "score", when: { any: [{ field: "likelihood", op: "not-empty" }] } }] }] };
		const r = renameLayoutKey(l, "likelihood", "chance");
		expect(JSON.stringify(r)).not.toContain("likelihood");
		expect((r.items[0] as { when: { all: { field: string }[] } }).when.all[0].field).toBe("chance");
		// a field renamed to a built-in's name gets the "f:" column id
		expect((renameLayoutKey(l, "likelihood", "status").items[0] as { when: { all: { field: string }[] } }).when.all[0].field).toBe("f:status");
		const gone = renameLayoutKey(l, "likelihood", null);
		expect((gone.items[0] as { when: { all: { field: string }[] } }).when.all[0].field).toBe("likelihood");
		const t = risk();
		t.fields = t.fields.filter((f) => f.key !== "likelihood");
		expect(whenIssues(gone, t, GROUPS)).toEqual([
			"“Show only when” on the “Risk” frame uses “likelihood”, which isn't a field of this type. It's ignored until it's fixed.",
			"“Show only when” on the score slot uses “likelihood”, which isn't a field of this type. It's ignored until it's fixed.",
		]);
		expect(whenIssues(l, T, GROUPS)).toEqual([]);
	});

	it("puts conditions into words", () => {
		expect(whenText(high, T, ctx)).toBe("Likelihood is any of High");
		expect(whenText({ any: [{ field: "likelihood", op: "any-of", value: ["High", "Medium"] }, { field: "score", op: "not-empty" }] }, T, ctx)).toBe("Likelihood is any of High, Medium or Score is not empty");
		expect(whenText({ all: [{ field: "owner", op: "links-any", value: ["People/Ada.md"] }] }, T, ctx)).toBe("Owner links to any of Ada");
	});
});
