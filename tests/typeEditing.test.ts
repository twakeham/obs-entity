import { describe, expect, it } from "vitest";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import {
	describeRelationship,
	duplicateType,
	exportPack,
	fieldChanges,
	finaliseType,
	groupIssues,
	importAsDrafts,
	incomingRelations,
	isDirty,
	isGroupDirty,
	makeDraft,
	makeGroupDraft,
	migrateFrontmatter,
	notesWithValue,
	relationshipField,
	renameFieldRefs,
	sampleValues,
	statusRenames,
	targetName,
	uniqueKey,
} from "../src/model/typeEditing";
import { cloneType, type EntityTypeDef } from "../src/model/types";

const GROUPS = STARTER_PACK.groups!;
const ship: EntityTypeDef = {
	key: "ship",
	name: "Ship",
	plural: "Ships",
	icon: "ship",
	color: "#3366aa",
	group: "work",
	template: "Ship.md",
	builtIn: false,
	parentFields: ["fleet"],
	card: { subtitle: ["guns", "launched"] },
	fields: [
		{ key: "captain", label: "Captain", kind: "relation", targets: ["person"], inverse: "Captain of" },
		{ key: "launched", label: "Launched", kind: "date" },
		{ key: "guns", label: "Guns", kind: "number" },
		{ key: "fleet", label: "Fleet", kind: "relation", targets: ["ship"] },
	],
};

describe("type drafts", () => {
	it("tracks dirtiness against the saved type", () => {
		const d = makeDraft(ship);
		expect(isDirty(d)).toBe(false);
		d.type.name = "Vessel";
		expect(isDirty(d)).toBe(true);
		expect(isDirty(makeDraft(null, ship))).toBe(true);
	});

	it("detects renamed and deleted field keys", () => {
		const d = makeDraft(ship);
		d.type.fields[0].key = "commander";
		d.type.fields.splice(2, 1);
		d.meta.splice(2, 1);
		d.type.fields.push({ key: "crew", label: "Crew", kind: "number" });
		d.meta.push({ uid: "x", origKey: null });
		expect(fieldChanges(d)).toEqual({ renames: [{ from: "captain", to: "commander", label: "Captain" }], deleted: [{ key: "guns", label: "Guns" }] });
	});

	it("doesn't count a deleted key that a new field reuses, and has no changes for new types", () => {
		const d = makeDraft(ship);
		d.type.fields.splice(2, 1);
		d.meta.splice(2, 1);
		d.type.fields.push({ key: "guns", label: "Cannons", kind: "number" });
		d.meta.push({ uid: "y", origKey: null });
		expect(fieldChanges(d).deleted).toEqual([]);
		expect(fieldChanges(makeDraft(null, ship))).toEqual({ renames: [], deleted: [] });
	});

	it("fills in default plural and template and drops empty optional lists", () => {
		const t = finaliseType({ ...ship, name: " Galleon ", plural: "", template: "", shortcuts: [], statuses: [], parentFields: [], folderPattern: " X/{entity} " });
		expect([t.name, t.plural, t.template, t.folderPattern]).toEqual(["Galleon", "Galleons", "Galleon.md", "X/{entity}"]);
		expect(t).not.toHaveProperty("shortcuts");
		expect(t).not.toHaveProperty("statuses");
		expect(t).not.toHaveProperty("parentFields");
	});

	it("keeps subtitle and parent fields in step with key changes", () => {
		const t = cloneType(ship);
		renameFieldRefs(t, "guns", "cannons");
		renameFieldRefs(t, "fleet", "squadron");
		expect(t.card).toEqual({ subtitle: ["cannons", "launched"] });
		expect(t.parentFields).toEqual(["squadron"]);
		renameFieldRefs(t, "cannons", null);
		expect(t.card).toEqual({ subtitle: ["launched"] });
		renameFieldRefs(t, "launched", "squadron");
		expect(t.card?.subtitle).toEqual(["squadron"]);
	});
});

describe("migrateFrontmatter", () => {
	it("renames keys and removes deleted ones", () => {
		const fm: Record<string, unknown> = { captain: "[[Silas]]", guns: 12, other: 1 };
		expect(migrateFrontmatter(fm, { renames: [{ from: "captain", to: "commander" }], deleted: ["guns"] }, new Set(["commander", "launched"]))).toBe(true);
		expect(fm).toEqual({ commander: "[[Silas]]", other: 1 });
	});

	it("swaps keys without losing values", () => {
		const fm: Record<string, unknown> = { a: 1, b: 2 };
		migrateFrontmatter(fm, { renames: [{ from: "a", to: "b" }, { from: "b", to: "a" }], deleted: [] }, new Set(["a", "b"]));
		expect(fm).toEqual({ a: 2, b: 1 });
	});

	it("keeps both values when the new key is already filled, and is a no-op without the keys", () => {
		const fm: Record<string, unknown> = { captain: "[[Silas]]", commander: "[[Vex]]" };
		expect(migrateFrontmatter(fm, { renames: [{ from: "captain", to: "commander" }], deleted: [] }, new Set(["commander"]))).toBe(false);
		expect(fm).toEqual({ captain: "[[Silas]]", commander: "[[Vex]]" });
		expect(migrateFrontmatter({ name: "x" }, { renames: [{ from: "captain", to: "commander" }], deleted: ["guns"] }, new Set())).toBe(false);
	});

	it("finds notes that have a value", () => {
		const notes = [
			{ path: "a", frontmatter: { guns: 3 } },
			{ path: "b", frontmatter: { guns: "" } },
			{ path: "c", frontmatter: { guns: [] } },
			{ path: "d", frontmatter: {} },
		];
		expect(notesWithValue(notes, "guns").map((n) => n.path)).toEqual(["a"]);
	});
});

describe("group drafts", () => {
	it("tracks status renames by position", () => {
		const d = makeGroupDraft(GROUPS[0]);
		expect(isGroupDirty(d)).toBe(false);
		d.group.statuses[2] = "retired";
		d.group.statuses.push("new");
		d.statusOrig.push(null);
		expect(isGroupDirty(d)).toBe(true);
		expect(statusRenames(d)).toEqual([{ from: "archived", to: "retired" }]);
		expect(statusRenames(makeGroupDraft(null, GROUPS[0]))).toEqual([]);
	});

	it("validates groups", () => {
		expect(groupIssues(GROUPS[0], { groupKeys: ["directory", "work"], isNew: false })).toEqual([]);
		const bad = { key: "", name: " ", icon: "x", statuses: ["a", "A", " "] };
		expect(groupIssues(bad, { groupKeys: [], isNew: true }).map((i) => i.at)).toEqual(["name", "key", "statuses", "statuses"]);
		expect(groupIssues({ ...GROUPS[0] }, { groupKeys: ["directory"], isNew: true })[0].message).toMatch(/already exists/);
		expect(groupIssues({ ...GROUPS[0], statuses: [] }, { groupKeys: [], isNew: false })[0].message).toMatch(/at least one/);
	});
});

describe("relationships", () => {
	const types = [...STARTER_PACK.types.map(cloneType), ship];

	it("finds relations pointing at a type, specific and generic (any / its group)", () => {
		const incoming = incomingRelations("person", "directory", types);
		const specific = incoming.filter((i) => !i.generic).map((i) => `${i.type.key}.${i.field.key}`);
		expect(specific).toEqual(["person.knows", "project.owner", "project.team", "ship.captain"]);
		expect(incoming.filter((i) => i.generic).map((i) => `${i.type.key}.${i.field.key}`)).toEqual(["note.about"]);
		const grouped = incomingRelations("place", "directory", [{ ...ship, fields: [{ key: "port", label: "Port", kind: "relation", targets: ["@directory"] }] }]);
		expect(grouped).toMatchObject([{ generic: true, field: { key: "port" } }]);
	});

	it("names targets, including groups", () => {
		expect(targetName("*", types)).toBe("Any entities");
		expect(targetName("@work", types, false, GROUPS)).toBe("Any Work entity");
		expect(targetName("person", types)).toBe("People");
		expect(targetName("person", types, false)).toBe("Person");
	});

	it("builds a relation field from the dialog", () => {
		const f = relationshipField({ label: "Home port", targets: ["place"], inverse: "Ships based here", many: false, symmetric: false, labelled: false }, ["captain"]);
		expect(f).toEqual({ key: "home_port", label: "Home port", kind: "relation", targets: ["place"], multiple: false, inModal: true, inverse: "Ships based here" });
		const g = relationshipField({ label: "Captain", targets: [], inverse: "", many: false, symmetric: false, labelled: true }, ["captain"]);
		expect(g).toMatchObject({ key: "captain_2", targets: ["*"], multiple: true, labelled: true });
	});

	it("describes a relationship in plain English", () => {
		const s = describeRelationship({ label: "Crew", targets: ["person"], inverse: "Serves on", many: true, symmetric: false, labelled: false }, "Ship", types);
		expect(s).toBe('A ship can link to several people through "Crew". On the other note it\'s listed as "Serves on".');
		const a = describeRelationship({ label: "Partners", targets: ["@directory"], inverse: "", many: true, symmetric: true, labelled: false }, "Organisation", types, GROUPS);
		expect(a).toMatch(/^An organisation can link to several any directory entities/);
		expect(a).toMatch(/reads both ways.*"Partners"/);
		expect(describeRelationship({ label: "Owner", targets: ["person"], inverse: "", many: false, symmetric: false, labelled: false }, "Ship", types)).toMatch(/"Owner \(from Ship\)"/);
	});

	it("makes unique keys", () => {
		expect(uniqueKey("ship", ["ship", "ship_2"])).toBe("ship_3");
		expect(uniqueKey("boat", ["ship"])).toBe("boat");
	});
});

describe("duplicate / export / import", () => {
	it("duplicates as a custom type with a fresh key", () => {
		const c = duplicateType({ ...ship, builtIn: true, pack: "starter", shortcuts: ["s"] }, ["ship"]);
		expect(c).toMatchObject({ key: "ship_copy", name: "Ship copy", plural: "Ships copy", builtIn: false, template: "", shortcuts: [] });
		expect(c).not.toHaveProperty("pack");
		expect(c.fields).toHaveLength(4);
	});

	it("exports a pack with the groups its types use", () => {
		const pack = JSON.parse(exportPack([{ ...ship, pack: "x" }], GROUPS, "Ships"));
		expect(pack).toMatchObject({ obsEntitiesPack: 1, name: "Ships", groups: [{ key: "work" }] });
		expect(pack.types[0]).not.toHaveProperty("builtIn");
		expect(pack.types[0]).not.toHaveProperty("pack");
	});

	it("imports as drafts: renames clashing keys, reports new groups, doesn't touch inputs", () => {
		const r = importAsDrafts(exportPack([ship, STARTER_PACK.types[0]], [...GROUPS, { key: "fleet", name: "Fleet", icon: "ship", statuses: ["afloat"] }]), GROUPS, STARTER_PACK.types);
		if ("error" in r) throw new Error(r.error);
		expect(r.types.map((t) => t.key)).toEqual(["ship", "person_2"]);
		expect(r.renamed).toEqual({ person: "person_2" });
		expect(r.newGroups).toEqual([]);
		const crm = importAsDrafts(JSON.stringify(CRM_PACK), GROUPS, STARTER_PACK.types);
		if ("error" in crm) throw new Error(crm.error);
		expect(crm.newGroups.map((g) => g.key)).toEqual(["people", "orgs", "sales"]);
		expect(crm.types.every((t) => !t.pack && !t.builtIn)).toBe(true);
		expect(importAsDrafts("nope", GROUPS, [])).toMatchObject({ error: expect.stringMatching(/Not valid JSON/) });
	});
});

describe("sampleValues", () => {
	const opts = { date: "2026-10-28", status: "idea", targetName: () => "Person" };

	it("uses the fullest existing note, through original keys", () => {
		const d = makeDraft(ship);
		d.type.fields[2].key = "cannons";
		const notes = [
			{ path: "a.md", name: "Sloop", status: null, frontmatter: { guns: 4 } },
			{ path: "b.md", name: "Gull", status: "done", frontmatter: { captain: "[[Ada]]", guns: 18 } },
		];
		expect(sampleValues(d, notes, opts)).toMatchObject({ path: "b.md", name: "Gull", status: "done", fromNote: true, frontmatter: { captain: "[[Ada]]", cannons: 18 } });
	});

	it("makes up values for every kind when there are no notes", () => {
		const d = makeDraft(null, {
			...ship,
			fields: [
				...ship.fields,
				{ key: "tags2", label: "Tags", kind: "multiselect", options: ["a", "b", "c"] },
				{ key: "site", label: "Site", kind: "url" },
				{ key: "crew", label: "Crew", kind: "relation", targets: ["person"], labelled: true, multiple: true },
			],
		});
		const s = sampleValues(d, [], opts);
		expect(s).toMatchObject({ path: null, fromNote: false, name: "Example ship" });
		expect(s.frontmatter).toEqual({
			captain: "[[Person]]",
			launched: "2026-10-28",
			guns: 3,
			fleet: "[[Person]]",
			tags2: ["a", "b"],
			site: "https://example.com",
			crew: ["[[Person 1|example]]", "[[Person 2]]"],
		});
	});
});
