import { describe, expect, it } from "vitest";
import { adoptFrontmatter, adoptionNeeded, inferType, labelOf, orderOptions, pluralOf, singular, type InferContext, type InferNote } from "../src/model/inferType";
import { adoptionRenames, inferredDraft } from "../src/model/typeEditing";
import type { EntityTypeDef, GroupDef } from "../src/model/types";

const GROUPS: GroupDef[] = [
	{ key: "delivery", name: "Delivery", icon: "x", statuses: ["planned", "active", "done"] },
	{ key: "governance", name: "Governance", icon: "x", statuses: ["open", "monitoring", "closed"] },
];
const type = (key: string): EntityTypeDef => ({ key, name: key, plural: `${key}s`, icon: "x", color: "#000", group: "delivery", template: "", fields: [], builtIn: false });
const ENTITIES: Record<string, string> = { "People/Daniel Kim.md": "person", "Projects/Mobile Banking App.md": "project", "Projects/Web.md": "project" };
const ctx = (widgets: Record<string, string> = {}): InferContext => ({
	types: [type("person"), type("project")],
	groups: GROUPS,
	resolve: (link) => Object.keys(ENTITIES).find((p) => p.endsWith(`/${link}.md`)) ?? (link === "Some note" ? "Notes/Some note.md" : link.startsWith("Risk ") ? `Entities/Governance/Risks/${link}.md` : null),
	typeAt: (path) => ENTITIES[path] ?? null,
	widget: (k) => widgets[k] ?? null,
	color: "#123456",
});
const risk = (n: number, fm: Record<string, unknown>, headings = ["Description", "Mitigation plan"]): InferNote => ({ path: `Entities/Governance/Risks/Risk ${n}.md`, frontmatter: { entity: "risk", ...fm }, headings });
const field = (t: EntityTypeDef, key: string) => t.fields.find((f) => f.key === key);

describe("working out a type from notes", () => {
	const notes = [
		risk(1, { status: "monitoring", order: null, project: "[[Mobile Banking App]]", owner: "[[Daniel Kim]]", likelihood: "Low", impact: "High", raised: "2026-09-10", mitigation: "Pre-submission review.", related: [], tags: [] }),
		risk(2, { status: "open", project: "[[Web]]", owner: ["[[Daniel Kim]]"], likelihood: "High", impact: "High", raised: "2026-08-01", mitigation: "Other.", parent: "[[Risk 1]]", link: "https://example.com", cost: 5, done: false, "Due Date": "2026-10-01" }),
		risk(3, { status: "escalated", project: "[[Mobile Banking App]]", likelihood: "Low", impact: "Medium", raised: "2026-07-01", mitigation: "A very long mitigation that goes on and on for well over eighty characters in all, really." }),
	];
	const inf = inferType(notes, ctx());
	const t = inf.type;

	it("name, key, group, statuses and sections", () => {
		expect([t.key, t.name, t.plural, t.group, t.color]).toEqual(["risk", "Risk", "Risks", "governance", "#123456"]);
		// The group's statuses, then the ones in use it doesn't have.
		expect(t.statuses).toEqual(["open", "monitoring", "closed", "escalated"]);
		expect(t.sections).toEqual(["Description", "Mitigation plan"]);
		expect(inf.paths).toEqual(notes.map((n) => n.path));
	});

	it("a field per property, in order, the common keys left out", () => {
		expect(t.fields.map((f) => f.key)).toEqual(["project", "owner", "likelihood", "impact", "raised", "mitigation", "parent", "link", "cost", "done", "due_date"]);
		expect(field(t, "due_date")?.label).toBe("Due date");
		expect(inf.props.due_date).toBe("Due Date");
	});

	it("links to entities become relations to their types; a list makes it multiple", () => {
		expect(field(t, "project")).toMatchObject({ kind: "relation", targets: ["project"] });
		expect(field(t, "project")?.multiple).toBeUndefined();
		expect(field(t, "owner")).toMatchObject({ kind: "relation", targets: ["person"], multiple: true });
		// Links to the notes it's learned from point at the new type.
		expect(field(t, "parent")).toMatchObject({ kind: "relation", targets: ["risk"] });
	});

	it("choices, dates, long text, URLs, numbers and checkboxes", () => {
		expect(field(t, "likelihood")).toMatchObject({ kind: "select", options: ["Low", "High"] });
		expect(field(t, "impact")).toMatchObject({ kind: "select", options: ["Medium", "High"] });
		expect(orderOptions(["High", "low", "Medium"])).toEqual(["low", "Medium", "High"]);
		expect(orderOptions(["10", "2", "1"])).toEqual(["1", "2", "10"]);
		expect(orderOptions(["Blue", "Red"])).toEqual(["Blue", "Red"]);
		expect(field(t, "raised")?.kind).toBe("date");
		expect(field(t, "mitigation")?.kind).toBe("textarea");
		expect(field(t, "link")?.kind).toBe("url");
		expect(field(t, "cost")?.kind).toBe("number");
		expect(field(t, "done")?.kind).toBe("boolean");
	});

	it("one note: no choices guessed; links to notes that aren't entities target any entity", () => {
		const one = inferType([{ path: "Inbox/Thing.md", frontmatter: { kind: "Low", ref: "[[Some note]]", tags: ["a"], when: null }, headings: [] }], ctx({ when: "date" })).type;
		expect([one.key, one.name, one.plural, one.group]).toEqual(["inbox", "Inbox", "Inboxes", "delivery"]);
		expect(field(one, "kind")?.kind).toBe("text");
		expect(field(one, "ref")).toMatchObject({ kind: "relation", targets: ["*"] });
		expect(field(one, "when")?.kind).toBe("date");
		expect(one.statuses).toBeUndefined();
		expect(one.sections).toBeUndefined();
	});

	it("plain text that names an entity is a relation; other plain text isn't", () => {
		const t2 = inferType([{ path: "Inbox/X.md", frontmatter: { client: "Web", note: "Hello" }, headings: [] }], ctx()).type;
		expect(field(t2, "client")).toMatchObject({ kind: "relation", targets: ["project"] });
		expect(field(t2, "note")?.kind).toBe("text");
	});

	it("a key that's taken gets a number; a folder name is made singular", () => {
		const t3 = inferType([{ path: "Projects/Apollo.md", frontmatter: { a: 1 }, headings: [] }], ctx()).type;
		expect([t3.key, t3.name, t3.plural]).toEqual(["project_2", "Project", "Projects"]);
		expect(singular("Companies")).toBe("Company");
		expect(singular("Boxes")).toBe("Box");
		expect(singular("Status")).toBe("Status");
		expect(pluralOf("Company")).toBe("Companies");
		expect(labelOf("dueDate")).toBe("Due date");
	});
});

describe("adopting the type", () => {
	it("set entity and move properties to the fields' keys", () => {
		const fm: Record<string, unknown> = { entity: "risk", "Due Date": "2026-01-01", keep: 1, taken: "x", other: "y" };
		adoptFrontmatter(fm, "risk_2", [["Due Date", "due_date"], ["other", "taken"]]);
		expect(fm).toEqual({ entity: "risk_2", due_date: "2026-01-01", keep: 1, taken: "x", other: "y" });
		expect(Object.keys(fm)).toEqual(["entity", "due_date", "keep", "taken", "other"]);
		const plain: Record<string, unknown> = { a: 1, "B c": 2 };
		adoptFrontmatter(plain, "thing", [["B c", "b_c"]]);
		expect(Object.keys(plain)).toEqual(["entity", "a", "b_c"]);
		expect(adoptionNeeded({ entity: "risk", a: 1 }, "risk", [["b", "c"]])).toBe(false);
		expect(adoptionNeeded({ entity: "risk", b: 1 }, "risk", [["b", "c"]])).toBe(true);
		expect(adoptionNeeded({ a: 1 }, "risk", [])).toBe(true);
	});

	it("the draft remembers each field's property, following renames and removals", () => {
		const inf = inferType([{ path: "Inbox/X.md", frontmatter: { "Due Date": "2026-01-01", owner: "a", gone: 1 }, headings: [] }], ctx());
		const d = inferredDraft(inf);
		expect(d.adopt?.paths).toEqual(["Inbox/X.md"]);
		expect(adoptionRenames(d)).toEqual([["Due Date", "due_date"]]);
		d.type.fields[1].key = "lead";
		d.type.fields.splice(2, 1);
		d.meta.splice(2, 1);
		expect(adoptionRenames(d)).toEqual([["Due Date", "due_date"], ["owner", "lead"]]);
	});
});
