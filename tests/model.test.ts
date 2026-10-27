import { describe, expect, it } from "vitest";
import { subtitleOf, valueDisplay } from "../src/model/card";
import { isoDateAdapter } from "../src/model/dates";
import { buildFrontmatter, defaultFieldValue, fieldDisplay, mergeFrontmatter, toYamlValue } from "../src/model/frontmatter";
import { asArray, parseLabelledEntry, parseLink, toLabelledWikilink, toWikilink } from "../src/model/links";
import { CRM_PACK, STARTER_PACK, installPack, parsePack } from "../src/model/packs";
import { DEFAULT_FOLDER_PATTERN, expandFolderPattern, joinPath, resolveEntityFolder, sanitizeFileName, uniquePath, unknownPlaceholders } from "../src/model/paths";
import { findTypeByPrefix, parseTypedQuery } from "../src/model/search";
import { defaultSettings, mergeSettings } from "../src/model/settings";
import { defaultTemplate, renderTemplate } from "../src/model/templates";
import {
	COMMON_KEYS,
	cloneGroup,
	cloneType,
	statusesFor,
	toKey,
	typeExplicitlyTargeted,
	typeMatchesTarget,
	type EntityTypeDef,
	type GroupDef,
} from "../src/model/types";
import { typeIssues, validateType } from "../src/model/validation";

const STARTER = STARTER_PACK.types;
const GROUPS = STARTER_PACK.groups!;
const T = (key: string) => STARTER.find((t) => t.key === key)!;
const ctx = (types = STARTER, groups = GROUPS) => ({ typeKeys: types.map((t) => t.key), groupKeys: groups.map((g) => g.key) });

describe("packs", () => {
	for (const pack of [STARTER_PACK, CRM_PACK]) {
		it(`${pack.name}: every type is valid and references only known types and groups`, () => {
			for (const t of pack.types) expect(validateType(t, ctx(pack.types, pack.groups)), t.key).toEqual([]);
		});
		it(`${pack.name}: unique keys and every relation has an inverse`, () => {
			const keys = pack.types.map((t) => t.key);
			expect(new Set(keys).size).toBe(keys.length);
			for (const t of pack.types)
				for (const f of t.fields.filter((f) => f.kind === "relation")) expect(f.inverse, `${t.key}.${f.key}`).toBeTruthy();
		});
	}

	it("starter pack has the agreed types and groups", () => {
		expect(STARTER.map((t) => t.key)).toEqual(["person", "organisation", "place", "project", "note"]);
		expect(GROUPS.map((g) => g.key)).toEqual(["directory", "work"]);
		expect(T("note").folderMode).toBe("parent");
		expect(T("project").folderMode).toBe("own");
	});

	it("parses packs, single types and type lists", () => {
		expect(parsePack(JSON.stringify(CRM_PACK))).toMatchObject({ ok: true, pack: { id: "crm-basic" } });
		const one = parsePack(JSON.stringify(T("place")));
		expect(one.ok && one.pack.types.map((t) => t.key)).toEqual(["place"]);
		expect(parsePack(JSON.stringify([T("place"), T("note")])).ok).toBe(true);
	});

	it("rejects bad pack input", () => {
		expect(parsePack("  ")).toEqual({ ok: false, error: "Paste a type pack (JSON) first." });
		expect(parsePack("{nope")).toMatchObject({ ok: false, error: expect.stringMatching(/Not valid JSON/) });
		expect(parsePack("{}")).toMatchObject({ ok: false });
		expect(parsePack(JSON.stringify({ types: [] }))).toMatchObject({ ok: false, error: "The pack has no types." });
		expect(parsePack(JSON.stringify({ types: [{ name: "X" }] }))).toMatchObject({ ok: false, error: expect.stringMatching(/no field list/) });
		expect(parsePack(JSON.stringify({ types: [{ name: "X", fields: [{ key: "a", label: "A", kind: "colour" }] }] }))).toMatchObject({
			ok: false,
			error: expect.stringMatching(/unknown kind "colour"/),
		});
	});

	it("installs a pack, adding groups and renaming clashing keys (and targets that point at them)", () => {
		const pack = parsePack(JSON.stringify({ types: [{ ...T("person"), fields: [...T("person").fields] }, T("note")], groups: [{ key: "new", name: "New", root: "Old/Root" }] }));
		if (!pack.ok) throw new Error(pack.error);
		pack.pack.types[0].group = "new";
		const res = installPack(pack.pack, GROUPS, STARTER);
		expect(res.renamed).toEqual({ person: "person_2", note: "note_2" });
		expect(res.addedGroups).toEqual(["new"]);
		expect(res.groups.find((g) => g.key === "new")).toEqual({ key: "new", name: "New", icon: "folder", statuses: ["draft", "active", "done"] });
		const person2 = res.types.find((t) => t.key === "person_2")!;
		expect(person2.group).toBe("new");
		expect(person2.fields.find((f) => f.key === "knows")?.targets).toEqual(["person_2"]);
		expect(person2.fields.find((f) => f.key === "works_for")?.targets).toEqual(["organisation"]);
		expect(res.types).toHaveLength(STARTER.length + 2);
		// the inputs aren't modified
		expect(STARTER).toHaveLength(5);
	});

	it("installs the CRM pack alongside the starter pack without clashes", () => {
		const res = installPack(CRM_PACK, GROUPS, STARTER);
		expect(res.renamed).toEqual({});
		expect(res.added).toEqual(["contact", "company", "deal"]);
		expect(res.types.find((t) => t.key === "deal")?.pack).toBe("crm-basic");
		for (const t of res.types) expect(validateType(t, ctx(res.types, res.groups)), t.key).toEqual([]);
	});
});

describe("types", () => {
	it("matches relation targets, including groups", () => {
		expect(typeMatchesTarget(T("person"), ["person"])).toBe(true);
		expect(typeMatchesTarget(T("person"), ["place"])).toBe(false);
		expect(typeMatchesTarget(T("person"), ["*"])).toBe(true);
		expect(typeMatchesTarget(T("person"), ["@directory"])).toBe(true);
		expect(typeMatchesTarget(T("note"), ["@directory"])).toBe(false);
		expect(typeMatchesTarget(T("note"), undefined)).toBe(true);
		expect(typeExplicitlyTargeted(T("note"), ["*"])).toBe(false);
		expect(typeExplicitlyTargeted(T("note"), ["@work"])).toBe(true);
	});

	it("derives keys from labels", () => {
		expect(toKey("Home Port")).toBe("home_port");
		expect(toKey("  Ship's Captain! ")).toBe("ship_s_captain");
		expect(toKey("1st mate")).toBe("_1st_mate");
	});

	it("uses type statuses, then group statuses", () => {
		expect(statusesFor(T("person"), GROUPS)).toEqual(["draft", "active", "archived"]);
		expect(statusesFor(T("note"), GROUPS)).toEqual(["idea", "active", "on-hold", "done"]);
		expect(statusesFor({ ...T("note"), statuses: ["open", "closed"] }, GROUPS)).toEqual(["open", "closed"]);
		expect(statusesFor({ ...T("note"), group: "gone" }, GROUPS)).toEqual(["draft", "active", "done"]);
	});

	it("drops legacy per-type folders and per-group roots when cloning", () => {
		expect(cloneType({ ...T("person"), folder: "Humans" } as EntityTypeDef)).not.toHaveProperty("folder");
		expect(cloneGroup({ ...GROUPS[0], root: "X" } as GroupDef)).not.toHaveProperty("root");
	});
});

describe("validation", () => {
	const at = (t: EntityTypeDef, extra: Partial<ReturnType<typeof ctx>> & { isNew?: boolean } = {}) =>
		typeIssues(t, { ...ctx(), ...extra }).map((i) => `${i.at}: ${i.message}`);

	it("flags bad keys, names, groups and duplicates", () => {
		const bad: EntityTypeDef = {
			...T("place"),
			key: "Ship",
			name: " ",
			group: "nowhere",
			fields: [
				{ key: "status", label: "Status", kind: "text" },
				{ key: "entity", label: "Entity", kind: "text" },
				{ key: "captain", label: "Captain", kind: "relation", targets: ["pirate", "@crew", "*"] },
				{ key: "captain", label: "Dup", kind: "select" },
				{ key: "", label: "", kind: "text" },
			],
			parentFields: [],
			card: {},
		};
		const out = at(bad).join("\n");
		expect(out).toMatch(/key: Type key "Ship"/);
		expect(out).toMatch(/name: Type name is required/);
		expect(out).toMatch(/group: Choose a group/);
		expect(out).toMatch(/field:0:key: Field key "status" is reserved/);
		expect(out).toMatch(/field:1:key: Field key "entity" is reserved/);
		expect(out).toMatch(/field:2:targets: .*unknown type "pirate"/);
		expect(out).toMatch(/field:2:targets: .*unknown group "crew"/);
		expect(out).toMatch(/field:3:key: Duplicate field key "captain"/);
		expect(out).toMatch(/field:3:options: Choice field "captain" needs at least one option/);
		expect(out).toMatch(/field:4:key: Give this field a label/);
	});

	it("rejects a taken key only for new types", () => {
		expect(at(T("place"), { isNew: true })).toContain('key: A type with the key "place" already exists.');
		expect(at(T("place"))).toEqual([]);
	});

	it("checks defaults", () => {
		const t: EntityTypeDef = {
			...T("place"),
			fields: [
				{ key: "a", label: "A", kind: "select", options: ["x"], default: "y" },
				{ key: "b", label: "B", kind: "multiselect", options: ["x"], default: ["x", "z"] },
				{ key: "c", label: "C", kind: "number", default: "lots" },
				{ key: "d", label: "D", kind: "select", options: ["x"], default: "x" },
			],
			parentFields: [],
			card: {},
		};
		expect(at(t)).toEqual([
			'field:0:default: Default "y" isn\'t one of the options.',
			'field:1:default: Default "z" isn\'t one of the options.',
			'field:2:default: Default "lots" isn\'t a number.',
		]);
	});

	it("checks parent fields and card settings", () => {
		const t: EntityTypeDef = {
			...T("place"),
			parentFields: ["kind", "missing"],
			card: { subtitle: ["part_of", "nope"], fields: ["address", "address", "ghost", "related"] },
		};
		expect(at(t)).toEqual([
			'parentFields: Parent field "kind" isn\'t a relation field.',
			'parentFields: Parent field "missing" doesn\'t exist.',
			'card:subtitle: Relation fields can\'t be used in the subtitle ("part_of").',
			'card:subtitle: Subtitle field "nope" doesn\'t exist.',
			'card:fields: Card field "address" is listed twice.',
			'card:fields: Card field "ghost" doesn\'t exist.',
		]);
	});
});

describe("paths", () => {
	it("joins and normalises", () => {
		expect(joinPath("World/", "", "/Characters")).toBe("World/Characters");
		expect(joinPath("a\\b", "./c")).toBe("a/b/c");
	});

	it("sanitises file names", () => {
		expect(sanitizeFileName('Kel: "the Red" / Lord?')).toBe("Kel the Red Lord");
		expect(sanitizeFileName("[[Waterdeep]]#x")).toBe("Waterdeepx");
		expect(sanitizeFileName("..hidden")).toBe("hidden");
	});

	it("expands the folder pattern", () => {
		const dir = GROUPS[0];
		expect(expandFolderPattern(DEFAULT_FOLDER_PATTERN, T("person"), dir)).toBe("Entities/Directory/People");
		expect(expandFolderPattern("entities/{group}/{entity}/", T("person"), dir)).toBe("entities/Directory/People");
		expect(expandFolderPattern("{ Entity }", T("person"), dir)).toBe("People");
		expect(expandFolderPattern("Notes/{entity}", { ...T("person"), plural: "Q&A: misc" }, dir)).toBe("Notes/Q&A misc");
		expect(expandFolderPattern("{group}/{entity}", T("person"), undefined)).toBe("People");
		expect(expandFolderPattern("", T("person"), dir)).toBe("");
		expect(expandFolderPattern("X/{type}", T("person"), dir)).toBe("X/{type}");
		expect(unknownPlaceholders("X/{type}/{group}/{ ENTITY }")).toEqual(["type"]);
	});

	it("resolves folders for each folder mode", () => {
		const base = "Entities/Work/Notes";
		// type mode
		expect(resolveEntityFolder(T("person"), "Ada", "Entities/Directory/People")).toBe("Entities/Directory/People");
		expect(resolveEntityFolder(T("person"), "Ada", "")).toBe("");
		// parent mode
		expect(resolveEntityFolder(T("note"), "Kickoff", base, "Entities/Work/Projects/Apollo")).toBe("Entities/Work/Projects/Apollo/Notes");
		expect(resolveEntityFolder(T("note"), "Kickoff", base, null)).toBe("Entities/Work/Notes");
		// own mode
		expect(resolveEntityFolder(T("project"), "Apollo: 11", "Entities/Work/Projects")).toBe("Entities/Work/Projects/Apollo 11");
		expect(resolveEntityFolder(T("project"), "Lander", "Entities/Work/Projects", "Entities/Work/Projects/Apollo")).toBe("Entities/Work/Projects/Apollo/Lander");
	});

	it("finds a unique path", () => {
		const existing = new Set(["W/A.md", "W/A 2.md"]);
		expect(uniquePath("W", "A", (p) => existing.has(p))).toBe("W/A 3.md");
		expect(uniquePath("W", "B", (p) => existing.has(p))).toBe("W/B.md");
	});
});

describe("links", () => {
	it("formats wikilinks", () => {
		expect(toWikilink("Waterdeep")).toBe("[[Waterdeep]]");
		expect(toWikilink("Places/Waterdeep", "Waterdeep")).toBe("[[Places/Waterdeep|Waterdeep]]");
	});

	it("parses wikilinks, markdown links and bare names", () => {
		expect(parseLink("[[Waterdeep]]")).toEqual({ path: "Waterdeep", subpath: undefined, display: undefined });
		expect(parseLink("[[A/B#Heading|Alias]]")).toEqual({ path: "A/B", subpath: "#Heading", display: "Alias" });
		expect(parseLink("[City](Places/Water%20deep.md)")).toEqual({ path: "Places/Water deep", display: "City" });
		expect(parseLink("Waterdeep")).toEqual({ path: "Waterdeep" });
		expect(parseLink("")).toBeNull();
		expect(parseLink(42)).toBeNull();
		expect(parseLink("[[broken")).toBeNull();
	});

	it("parses labelled entries (alias form and legacy object form)", () => {
		expect(parseLabelledEntry("[[Vex|rival]]")).toEqual({ link: { path: "Vex", subpath: undefined, display: "rival" }, label: "rival" });
		expect(parseLabelledEntry({ target: "[[Vex]]", label: "rival" })).toEqual({
			link: { path: "Vex", subpath: undefined, display: undefined },
			label: "rival",
		});
		expect(parseLabelledEntry("[[Vex]]")?.label).toBeUndefined();
		expect(parseLabelledEntry({ label: "x" })).toBeNull();
	});

	it("formats labelled wikilinks safely", () => {
		expect(toLabelledWikilink("Vex", "rival")).toBe("[[Vex|rival]]");
		expect(toLabelledWikilink("Vex", " ")).toBe("[[Vex]]");
		expect(toLabelledWikilink("Vex", "[old|friend]")).toBe("[[Vex|oldfriend]]");
	});

	it("normalises to arrays", () => {
		expect(asArray(null)).toEqual([]);
		expect(asArray("x")).toEqual(["x"]);
		expect(asArray(["x", "y"])).toEqual(["x", "y"]);
	});
});

describe("frontmatter", () => {
	it("builds frontmatter with every field present and no summary", () => {
		const fm = buildFrontmatter(T("person"), {
			name: "Ada",
			status: "active",
			tags: ["vip"],
			fields: { role: "CTO", works_for: "Acme", knows: [{ target: "Grace", label: "mentor" }], email: "ada@example.com" },
		});
		expect(fm).toEqual({
			entity: "person",
			status: "active",
			role: "CTO",
			works_for: "[[Acme]]",
			based_in: null,
			email: "ada@example.com",
			phone: null,
			birthday: null,
			knows: ["[[Grace|mentor]]"],
			related: [],
			tags: ["vip"],
		});
		expect(Object.keys(fm)[0]).toBe(COMMON_KEYS.type);
	});

	it("adds order to hierarchical types", () => {
		const empty = { name: "x", status: "", tags: [], fields: {} };
		expect(buildFrontmatter(T("place"), empty)).toHaveProperty("order", null);
		expect(buildFrontmatter(T("person"), empty)).not.toHaveProperty("order");
		expect(buildFrontmatter(T("place"), empty).status).toBeNull();
	});

	it("converts values for each kind", () => {
		const f = (kind: string, extra = {}) => ({ key: "k", label: "K", kind, ...extra }) as never;
		expect(toYamlValue(f("list"), "a, b ,")).toEqual(["a", "b"]);
		expect(toYamlValue(f("multiselect", { options: ["a", "b"] }), ["a"])).toEqual(["a"]);
		expect(toYamlValue(f("multiselect"), null)).toEqual([]);
		expect(toYamlValue(f("number"), "4.5")).toBe(4.5);
		expect(toYamlValue(f("number"), "x")).toBeNull();
		expect(toYamlValue(f("boolean"), null)).toBe(false);
		expect(toYamlValue(f("boolean"), "true")).toBe(true);
		expect(toYamlValue(f("url"), " https://x.y ")).toBe("https://x.y");
		expect(toYamlValue(f("relation"), "A")).toBe("[[A]]");
		expect(toYamlValue(f("relation", { multiple: true }), ["A", "B"])).toEqual(["[[A]]", "[[B]]"]);
		expect(toYamlValue(f("relation", { labelled: true }), [{ target: "A", label: "boss" }])).toEqual(["[[A|boss]]"]);
		expect(toYamlValue(f("relation", { labelled: true }), null)).toEqual([]);
	});

	it("reads field defaults for the create dialog", () => {
		expect(defaultFieldValue({ key: "a", label: "A", kind: "select", options: ["x"], default: "x" })).toBe("x");
		expect(defaultFieldValue({ key: "a", label: "A", kind: "multiselect", default: ["x"] })).toEqual(["x"]);
		expect(defaultFieldValue({ key: "a", label: "A", kind: "relation", default: "x" })).toBeUndefined();
		expect(defaultFieldValue({ key: "a", label: "A", kind: "text" })).toBeUndefined();
	});

	it("merges generated frontmatter over a template", () => {
		const existing: Record<string, unknown> = { tags: ["npc"], role: "Smith", custom: 1 };
		mergeFrontmatter(existing, { role: null, status: "draft", tags: ["npc", "dwarf"] });
		expect(existing).toEqual({ tags: ["npc", "dwarf"], role: "Smith", custom: 1, status: "draft" });
	});

	it("keeps existing values when converting a note", () => {
		const existing: Record<string, unknown> = { status: "complete", tags: "solo" };
		mergeFrontmatter(existing, { status: "draft", role: null, tags: [] }, true);
		expect(existing).toEqual({ status: "complete", role: null, tags: ["solo"] });
	});

	it("displays form values", () => {
		expect(fieldDisplay(["A", "B"])).toBe("A, B");
		expect(fieldDisplay([{ target: "Vex", label: "rival" }])).toBe("Vex (rival)");
		expect(fieldDisplay(null)).toBe("");
		expect(fieldDisplay(3)).toBe("3");
	});
});

describe("card subtitle", () => {
	it("joins subtitle fields, skipping empties", () => {
		expect(subtitleOf(T("place"), { kind: "City", address: "1 Main St\nSpringfield" }, isoDateAdapter)).toBe("City · 1 Main St");
		expect(subtitleOf(T("place"), { kind: "City", address: null }, isoDateAdapter)).toBe("City");
		expect(subtitleOf(T("place"), {}, isoDateAdapter)).toBeNull();
		expect(subtitleOf(T("note"), { noted_on: "2026-10-28" }, isoDateAdapter)).toBe("28 October 2026");
	});

	it("is empty without subtitle fields, and ignores relation or missing fields", () => {
		expect(subtitleOf({ ...T("person"), card: undefined }, { role: "CTO" }, isoDateAdapter)).toBeNull();
		expect(subtitleOf({ ...T("person"), card: { subtitle: ["works_for", "gone", "role"] } }, { works_for: "[[Acme]]", role: "CTO" }, isoDateAdapter)).toBe("CTO");
	});

	it("displays each kind", () => {
		const f = (kind: string) => ({ key: "k", label: "K", kind }) as never;
		expect(valueDisplay(f("boolean"), true, isoDateAdapter)).toBe("Yes");
		expect(valueDisplay(f("boolean"), false, isoDateAdapter)).toBe("");
		expect(valueDisplay(f("multiselect"), ["a", "b"], isoDateAdapter)).toBe("a, b");
		expect(valueDisplay(f("date"), "someday", isoDateAdapter)).toBe("someday");
		expect(valueDisplay(f("number"), 0, isoDateAdapter)).toBe("0");
		expect(valueDisplay(f("relation"), ["[[People/Ada|boss]]", "[[Grace]]"], isoDateAdapter)).toBe("Ada, Grace");
	});
});

describe("dates", () => {
	it("parses and formats ISO dates", () => {
		const r = isoDateAdapter.parse("2027-03-31");
		expect(r).toMatchObject({ ok: true, display: "31 March 2027" });
		if (r?.ok) expect(isoDateAdapter.format(r.value, "short")).toBe("2027-03-31");
		expect(isoDateAdapter.parse("1970-01-02")).toMatchObject({ ok: true, value: 1 });
		expect(isoDateAdapter.parse(new Date(Date.UTC(2000, 1, 29)))).toMatchObject({ ok: true, display: "29 February 2000" });
	});

	it("rejects invalid dates and ignores empty ones", () => {
		expect(isoDateAdapter.parse("2023-02-29")).toEqual({ ok: false, error: "February 2023 has no day 29." });
		expect(isoDateAdapter.parse("2023-13-01")).toEqual({ ok: false, error: "Month 13 doesn't exist." });
		expect(isoDateAdapter.parse("next week")).toMatchObject({ ok: false });
		expect(isoDateAdapter.parse("")).toBeNull();
		expect(isoDateAdapter.parse(null)).toBeNull();
	});

	it("orders dates", () => {
		const v = (s: string) => (isoDateAdapter.parse(s) as { value: number }).value;
		expect(v("2026-01-01")).toBeLessThan(v("2026-01-02"));
		expect(v("1999-12-31")).toBeLessThan(v("2000-01-01"));
	});
});

describe("templates", () => {
	const tctx = { name: "Apollo", type: T("project"), fields: { description: "Moonshot" }, formatDate: (f: string) => `<${f}>` };

	it("renders placeholders and leaves unknown ones", () => {
		const out = renderTemplate("# {{name}} ({{type}}) {{ description }} {{date}} {{date:YYYY}} {{summary}} {{unknown}} <% tp.x %>", tctx);
		expect(out).toBe("# Apollo (Project) Moonshot <YYYY-MM-DD> <YYYY> {{summary}} {{unknown}} <% tp.x %>");
	});

	it("uses the type's sections or generic ones", () => {
		expect(defaultTemplate(T("project"))).toBe("## Goal\n\n## Scope\n\n## Plan\n\n## Decisions\n\n## Risks\n\n## Notes\n");
		expect(defaultTemplate({ ...T("project"), sections: undefined })).toBe("## Overview\n\n## Details\n\n## Notes\n");
	});
});

describe("search", () => {
	it("parses colon prefixes", () => {
		expect(parseTypedQuery("person: ada", STARTER)).toMatchObject({ type: { key: "person" }, text: "ada", via: "colon" });
		expect(parseTypedQuery("People:", STARTER)).toMatchObject({ type: { key: "person" }, text: "" });
		expect(parseTypedQuery("org: acme", STARTER)).toMatchObject({ type: { key: "organisation" }, text: "acme" });
		expect(parseTypedQuery("Meeting: a title", STARTER)).toEqual({ type: null, text: "Meeting: a title" });
	});

	it("parses shortcut-space prefixes (exact shortcuts only)", () => {
		expect(parseTypedQuery("p ada", STARTER)).toMatchObject({ type: { key: "person" }, text: "ada", via: "shortcut" });
		expect(parseTypedQuery("proj apollo", STARTER)).toMatchObject({ type: { key: "project" }, text: "apollo" });
		expect(parseTypedQuery("person ada", STARTER)).toEqual({ type: null, text: "person ada" });
		expect(parseTypedQuery("p", STARTER)).toEqual({ type: null, text: "p" });
		expect(parseTypedQuery("ada", STARTER)).toEqual({ type: null, text: "ada" });
	});

	it("prefers exact prefix matches", () => {
		expect(findTypeByPrefix("note", STARTER)?.key).toBe("note");
		expect(findTypeByPrefix("pla", STARTER)?.key).toBe("place");
		expect(findTypeByPrefix("", STARTER)).toBeNull();
	});
});

describe("settings", () => {
	it("installs the starter pack on first run", () => {
		const s = mergeSettings(null);
		expect(s).toEqual(defaultSettings());
		expect(s.types.map((t) => t.key)).toEqual(["person", "organisation", "place", "project", "note"]);
		expect(s.types.every((t) => t.pack === "starter")).toBe(true);
		expect(s.groups.map((g) => g.key)).toEqual(["directory", "work"]);
	});

	it("keeps saved types and groups and adds missing starter types unless deleted", () => {
		const custom: EntityTypeDef = { ...T("place"), key: "ship", name: "Ship", plural: "Ships", builtIn: false };
		const s = mergeSettings({
			openInNewTab: true,
			groups: [GROUPS[0]],
			types: [{ ...T("person"), color: "#000000" }, custom],
			deletedPackTypes: ["note"],
		});
		expect(s.openInNewTab).toBe(true);
		expect(s.types.find((t) => t.key === "person")?.color).toBe("#000000");
		expect(s.types.map((t) => t.key)).toEqual(["person", "ship", "organisation", "place", "project"]);
		expect(s.groups.map((g) => g.key)).toEqual(["directory", "work"]);
	});

	it("always has a group with statuses, and a folder pattern", () => {
		const s = mergeSettings({ groups: [], types: [], deletedPackTypes: STARTER.map((t) => t.key) });
		expect(s.groups).toEqual([{ key: "entities", name: "Entities", icon: "shapes", statuses: ["draft", "active", "done"] }]);
		expect(s.folderPattern).toBe("Entities/{group}/{entity}");
		const t = mergeSettings({ groups: [{ ...GROUPS[0], statuses: [] }] });
		expect(t.groups[0].statuses).toEqual(["draft", "active", "done"]);
		expect(mergeSettings({ folderPattern: "Notes/{entity}" }).folderPattern).toBe("Notes/{entity}");
	});

	it("drops folders saved before the folder pattern existed", () => {
		const s = mergeSettings({
			groups: [{ ...GROUPS[0], root: "Old" } as GroupDef],
			types: [{ ...T("person"), folder: "Humans" } as EntityTypeDef],
		});
		expect(s.groups[0]).not.toHaveProperty("root");
		expect(s.types[0]).not.toHaveProperty("folder");
	});

	it("does not share objects with the defaults", () => {
		const a = mergeSettings(null);
		a.types[0].fields.push({ key: "x", label: "x", kind: "text" });
		a.groups[0].statuses.push("x");
		expect(mergeSettings(null).types[0].fields.some((f) => f.key === "x")).toBe(false);
		expect(STARTER_PACK.groups![0].statuses).not.toContain("x");
	});
});
