import { describe, expect, it } from "vitest";
import { isoDateAdapter } from "../src/model/dates";
import { checkField, EditHistory, entityProblems, fieldKindFor, otherKeys, otherKind, parseInput, retype, targetNames, type CheckContext } from "../src/model/form";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import type { EntityTypeDef, FieldDef } from "../src/model/types";

const TYPES = [...STARTER_PACK.types, ...CRM_PACK.types];
const GROUPS = [...STARTER_PACK.groups!, ...CRM_PACK.groups!];
const T = (key: string) => TYPES.find((t) => t.key === key)!;
const F = (type: string, key: string) => T(type).fields.find((f) => f.key === key)!;

/** Fake vault: link path -> note (entity type key, or null for a plain note) */
const notes: Record<string, string | null> = { Acme: "organisation", London: "place", Ada: "person", Grace: "person", Diary: null };
const ctx: CheckContext = {
	types: TYPES,
	groups: GROUPS,
	dates: isoDateAdapter,
	resolve: (p) => (p in notes ? { path: `${p}.md`, type: notes[p] ? T(notes[p]!) : null } : null),
};
const msgs = (field: FieldDef, raw: unknown) => checkField(field, raw, ctx).map((p) => `${p.severity}: ${p.message}${p.fix ? ` [${p.fix.label} → ${JSON.stringify(p.fix.value)}]` : ""}`);

describe("checkField", () => {
	it("accepts valid values and empty optional fields", () => {
		expect(msgs(F("person", "works_for"), "[[Acme]]")).toEqual([]);
		expect(msgs(F("person", "knows"), ["[[Grace|mentor]]", "[[Nobody]]"])).toEqual([]);
		expect(msgs(F("person", "birthday"), "1815-12-10")).toEqual([]);
		expect(msgs(F("organisation", "kind"), "Company")).toEqual([]);
		expect(msgs(F("deal", "value"), 1200)).toEqual([]);
		expect(msgs(F("person", "role"), null)).toEqual([]);
		expect(msgs(F("person", "role"), 42)).toEqual([]);
	});

	it("flags links to the wrong type, non-entities and bare names, with fixes", () => {
		expect(msgs(F("person", "works_for"), "[[London]]")).toEqual(["error: “London” is a place, but Works for links to organisations. [Remove the link → null]"]);
		expect(msgs(F("person", "knows"), ["[[Grace]]", "[[Acme]]"])).toEqual(['error: “Acme” is an organisation, but Knows links to people. [Remove the link → ["[[Grace]]"]]']);
		expect(msgs(F("person", "works_for"), "[[Diary]]")).toEqual(["warning: “Diary” isn't an entity. Works for links to organisations. [Remove the link → null]"]);
		expect(msgs(F("person", "works_for"), "Acme")).toEqual(['warning: “Acme” isn\'t written as a link, so Obsidian won\'t track it. [Make it a link → "[[Acme]]"]']);
		// "any entity" fields accept plain notes
		expect(msgs(F("note", "about"), ["[[Diary]]", "[[Acme]]"])).toEqual([]);
	});

	it("checks single vs list shape for links", () => {
		expect(msgs(F("person", "works_for"), ["[[Acme]]"])).toEqual(['error: Works for holds one link, but it\'s written as a list. [Use a single link → "[[Acme]]"]']);
		expect(msgs(F("person", "works_for"), ["[[Acme]]", "[[Nobody]]"])[0]).toBe('error: Works for holds one link, but has 2. [Keep the first → "[[Acme]]"]');
		expect(msgs(F("project", "team"), "[[Ada]]")).toEqual(['error: Team should be a list. [Make it a list → ["[[Ada]]"]]']);
	});

	it("checks numbers, yes/no, dates and choices", () => {
		expect(msgs(F("deal", "value"), "12")).toEqual(["error: Value is a number written as text. [Make it a number → 12]"]);
		expect(msgs(F("deal", "value"), "lots")).toEqual(["error: “lots” isn't a number."]);
		expect(msgs({ key: "vip", label: "VIP", kind: "boolean" }, "true")).toEqual(["error: VIP is a yes/no value written as text. [Make it yes → true]"]);
		expect(msgs(F("person", "birthday"), "1815-02-30")).toEqual(["error: February 1815 has no day 30."]);
		expect(msgs(F("organisation", "kind"), "Club")).toEqual(["error: “Club” isn't one of the options for Kind."]);
		expect(msgs(F("organisation", "kind"), ["Company"])).toEqual(['error: Kind holds one choice, but it\'s written as a list. [Use a single value → "Company"]']);
		const tags: FieldDef = { key: "labels", label: "Labels", kind: "multiselect", options: ["a", "b"] };
		expect(msgs(tags, ["a", "z"])).toEqual(['error: “z” isn\'t one of the options for Labels. [Remove → ["a"]]']);
		expect(msgs({ key: "aka", label: "Aka", kind: "list" }, "Ada")).toEqual(['error: Aka should be a list. [Make it a list → ["Ada"]]']);
		expect(msgs(F("person", "role"), ["CTO", "CEO"])).toEqual(['error: Role holds one value, but it\'s written as a list. [Join the values → "CTO, CEO"]']);
	});

	it("warns about empty required fields", () => {
		expect(msgs(F("deal", "company"), null)).toEqual(["warning: Company is required."]);
		expect(msgs(F("deal", "company"), [])).toEqual(["warning: Company is required."]);
	});
});

describe("entityProblems", () => {
	it("checks status, fields, list-shaped common keys, related and order", () => {
		const problems = entityProblems(T("project"), { entity: "project", status: "draft", owner: "[[Acme]]", tags: "a b", aliases: "Apollo", related: "[[Ada]]", order: "x" }, ctx);
		expect(problems.map((p) => `${p.key}: ${p.message}`)).toEqual([
			"status: “draft” isn't a status for projects. Choose one of: idea, active, on-hold, done.",
			"owner: “Acme” is an organisation, but Owner links to people.",
			"tags: Tags should be a list.",
			"aliases: Aliases should be a list.",
			"related: Related should be a list.",
			"order: “x” isn't a number.",
		]);
		expect(problems.find((p) => p.key === "tags")?.fix?.value).toEqual(["a", "b"]);
	});
});

describe("other properties", () => {
	it("lists keys the type doesn't define, skipping common keys and unused empty order", () => {
		const fm = { entity: "person", status: "draft", role: "CTO", tags: [], aliases: [], related: [], order: null, cssclasses: ["wide"], rating: 5 };
		expect(otherKeys(T("person"), fm)).toEqual(["cssclasses", "rating"]);
		expect(otherKeys(T("person"), { ...fm, order: 2 })).toEqual(["order", "cssclasses", "rating"]);
		expect(otherKeys(T("place"), { ...fm, order: 2 })).toEqual(["role", "cssclasses", "rating"]);
	});

	it("chooses an editor from Obsidian's property type, else the value", () => {
		expect(otherKind("x", "checkbox")).toBe("boolean");
		expect(otherKind(["a"], null)).toBe("list");
		expect(otherKind(3)).toBe("number");
		expect(otherKind("2024-01-01", "date")).toBe("date");
		expect(otherKind("2024-01-01")).toBe("text");
		expect(fieldKindFor(["[[Ada]]", "[[Grace]]"])).toBe("relation");
		expect(fieldKindFor("[[Ada]]")).toBe("relation");
		expect(fieldKindFor(["a"], "multitext")).toBe("list");
		expect(fieldKindFor(true)).toBe("boolean");
	});
});

describe("parseInput", () => {
	it("accepts valid text, numbers and dates; rejects the rest", () => {
		expect(parseInput("number", " 12.5 ", isoDateAdapter)).toEqual({ ok: true, value: 12.5 });
		expect(parseInput("number", "", isoDateAdapter)).toEqual({ ok: true, value: null });
		expect(parseInput("number", "1e", isoDateAdapter)).toEqual({ ok: false, error: "“1e” isn't a number." });
		expect(parseInput("date", "2024-02-30", isoDateAdapter)).toEqual({ ok: false, error: "February 2024 has no day 30." });
		expect(parseInput("date", "2024-02-03", isoDateAdapter)).toEqual({ ok: true, value: "2024-02-03" });
		expect(parseInput("text", "  hi ", isoDateAdapter)).toEqual({ ok: true, value: "hi" });
		expect(parseInput("textarea", "  line\n", isoDateAdapter)).toEqual({ ok: true, value: "  line" });
	});
});

describe("retype", () => {
	it("adds the new type's fields, keeps old values and resets an invalid status", () => {
		const fm: Record<string, unknown> = { entity: "person", status: "active", role: "CTO", works_for: "[[Acme]]", tags: ["x"] };
		expect(retype(fm, T("project"), GROUPS)).toEqual({ statusReset: false });
		expect(fm.entity).toBe("project");
		expect(fm.status).toBe("active");
		expect(fm.role).toBe("CTO");
		expect(fm).toHaveProperty("owner", null);
		expect(fm).toHaveProperty("team", []);
		expect(fm).toHaveProperty("order", null);
		expect(fm.tags).toEqual(["x"]);

		const other: Record<string, unknown> = { entity: "project", status: "on-hold" };
		expect(retype(other, T("person"), GROUPS)).toEqual({ statusReset: true });
		expect(other.status).toBe("draft");
		const fresh: Record<string, unknown> = {};
		expect(retype(fresh, T("deal"), GROUPS)).toEqual({ statusReset: false });
		expect(fresh.status).toBe("open");
	});
});

describe("EditHistory", () => {
	it("undoes newest first, caps the stack and follows renames", () => {
		const h = new EditHistory(2);
		h.push("a.md", { key: "role", before: undefined, after: "CTO" });
		h.push("a.md", { key: "role", before: "same", after: "same" });
		h.push("a.md", { key: "role", before: "CTO", after: "CEO" });
		h.push("a.md", { key: "tags", before: [], after: ["x"] });
		expect(h.size("a.md")).toBe(2);
		h.rename("a.md", "b.md");
		expect(h.pop("b.md")).toEqual({ key: "tags", before: [], after: ["x"] });
		expect(h.pop("b.md")?.before).toBe("CTO");
		expect(h.pop("b.md")).toBeUndefined();
	});
});

describe("targetNames", () => {
	it("names target types", () => {
		expect(targetNames(["person", "organisation"], TYPES)).toBe("people or organisations");
		expect(targetNames(["@directory"], TYPES)).toBe("people, organisations or places");
		expect(targetNames(["*"], TYPES)).toBe("any entity");
		expect(targetNames([], [] as EntityTypeDef[])).toBe("any entity");
	});
});
