import { describe, expect, it } from "vitest";
import { isoDateAdapter } from "../src/model/dates";
import { autoText, autoValue, defaultIssues, defaultKinds, emptyFormValues, firstLink, linkedValues, nextAutoNumber, relativeDate } from "../src/model/defaults";
import { renameFieldRefs } from "../src/model/typeEditing";
import type { EntityTypeDef, FieldDef } from "../src/model/types";

const day = (iso: string) => (isoDateAdapter.parse(iso) as { value: number }).value;
const TODAY = day("2026-11-04");
const f = (key: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label: key, kind, ...extra });
const PROJECT = { key: "project", name: "Project", group: "g", fields: [f("client", "relation", { targets: ["client"] }), f("budget", "number")] } as unknown as EntityTypeDef;
const TASK = {
	key: "task",
	name: "Task",
	group: "g",
	fields: [
		f("project", "relation", { targets: ["project"] }),
		f("client", "relation", { targets: ["client"], defaultFrom: { kind: "linked", via: "project", field: "client" } }),
		f("due", "date", { defaultFrom: { kind: "relative", spec: "today+14d" } }),
		f("code", "text", { defaultFrom: { kind: "auto", pattern: "TASK-{n}", pad: 4 } }),
		f("size", "number", { default: 3 }),
	],
} as unknown as EntityTypeDef;

describe("smarter defaults", () => {
	it("offers the kinds that suit the field", () => {
		expect(defaultKinds(f("x", "date"))).toEqual(["fixed", "relative", "linked"]);
		expect(defaultKinds(f("x", "text"))).toEqual(["fixed", "linked", "auto"]);
		expect(defaultKinds(f("x", "relation"))).toEqual(["linked"]);
		expect(defaultKinds(f("x", "formula"))).toEqual([]);
	});

	it("works out relative dates for a new note's values", () => {
		expect(relativeDate("today", TODAY, isoDateAdapter)).toBe("2026-11-04");
		expect(relativeDate("today+1m", TODAY, isoDateAdapter)).toBe("2026-12-04");
		expect(relativeDate("soon", TODAY, isoDateAdapter)).toBeNull();
		const v = emptyFormValues(TASK, [{ key: "g", name: "G", icon: "x", statuses: ["todo"] }], "", { today: TODAY });
		expect(v.fields).toEqual({ due: "2026-11-18", size: 3 });
	});

	it("numbers new notes one past the highest", () => {
		const d = { kind: "auto" as const, pattern: "TASK-{n}", pad: 4 };
		expect(autoText(d, 42)).toBe("TASK-0042");
		expect(nextAutoNumber(f("code", "text"), d, ["TASK-0007", "TASK-12", "other", null, "TASK-0003"])).toBe(13);
		expect(nextAutoNumber(f("code", "text"), d, [])).toBe(1);
		expect(nextAutoNumber(f("n", "number"), { kind: "auto" }, [4, 9.5, "x"])).toBe(10);
		expect(autoValue(f("n", "number"), { kind: "auto" }, 10)).toBe(10);
		expect(autoText({ kind: "auto" }, 5)).toBe("5");
	});

	it("copies from a linked note, only into fields that are still empty", () => {
		const read = (lp: string) => (lp === "Apollo" ? { client: "[[Acme]]", budget: 10 } : null);
		expect(linkedValues(TASK, { project: "[[Apollo]]" }, read, () => true)).toEqual({ client: "[[Acme]]" });
		expect(linkedValues(TASK, { project: "[[Apollo]]" }, read, (k) => k !== "client")).toEqual({});
		expect(linkedValues(TASK, { project: "[[Nowhere]]" }, read, () => true)).toEqual({});
		expect(firstLink(["[[A|x]]", "[[B]]"])).toBe("A");
		expect(firstLink("Plain name")).toBe("Plain name");
		expect(firstLink([{ target: "C", label: "x" }])).toBe("C");
	});

	it("flags defaults that can't work, and follows renamed relation fields", () => {
		expect(defaultIssues(TASK.fields[1], TASK, [PROJECT, TASK], isoDateAdapter)).toEqual([]);
		expect(defaultIssues(f("x", "text", { defaultFrom: { kind: "linked", via: "project", field: "nope" } }), TASK, [PROJECT, TASK], isoDateAdapter)[0]).toMatch(/no “nope” field/);
		expect(defaultIssues(f("x", "text", { defaultFrom: { kind: "linked", via: "code", field: "x" } }), TASK, [PROJECT, TASK], isoDateAdapter)[0]).toMatch(/relation field/);
		expect(defaultIssues(f("x", "text", { defaultFrom: { kind: "auto", pattern: "T-" } }), TASK, undefined, isoDateAdapter)[0]).toMatch(/\{n\}/);
		expect(defaultIssues(f("x", "date", { defaultFrom: { kind: "relative", spec: "later" } }), TASK, undefined, isoDateAdapter)[0]).toMatch(/isn't "today"/);
		expect(defaultIssues(f("x", "number", { defaultFrom: { kind: "relative", spec: "today" } }), TASK, undefined, isoDateAdapter)[0]).toMatch(/doesn't suit/);
		const t = JSON.parse(JSON.stringify(TASK)) as EntityTypeDef;
		renameFieldRefs(t, "project", "parent");
		expect(t.fields[1].defaultFrom).toEqual({ kind: "linked", via: "parent", field: "client" });
	});
});
