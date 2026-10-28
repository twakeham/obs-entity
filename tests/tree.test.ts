import { describe, expect, it } from "vitest";
import type { EntityInfo } from "../src/model/entity";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import { extractEdges } from "../src/model/relations";
import {
	DEFAULT_BROWSER_OPTIONS,
	branchPaths,
	buildBrowser,
	buildForest,
	childOptions,
	countMatches,
	filterBrowser,
	locate,
	parentMap,
	type BrowserSection,
	type TreeNode,
} from "../src/model/tree";
import type { EntityTypeDef } from "../src/model/types";

// The CRM example's Deal gets a parent field here, to test nesting across groups.
const TYPES: EntityTypeDef[] = [...STARTER_PACK.types, ...CRM_PACK.types.map((t) => (t.key === "deal" ? { ...t, parentFields: ["company"] } : t))];
const GROUPS = [...STARTER_PACK.groups!, ...CRM_PACK.groups!];
const T = (key: string) => TYPES.find((t) => t.key === key)!;

/** Notes: [name, type, frontmatter]. Paths are "<name>.md"; links resolve by name. */
function vault(notes: [string, string, Record<string, unknown>, Partial<EntityInfo>?][]) {
	const entities: EntityInfo[] = notes.map(([name, type, fm, extra]) => ({
		path: `${name}.md`,
		name,
		type: T(type),
		status: null,
		subtitle: null,
		tags: [],
		mtime: 0,
		order: null,
		frontmatter: fm,
		...extra,
	}));
	const names = new Set(notes.map((n) => n[0]));
	const resolve = (link: string) => (names.has(link) ? `${link}.md` : null);
	const edges = entities.flatMap((e) => extractEdges(e.path, e.type, e.frontmatter, resolve));
	return { entities, edges };
}

const { entities, edges } = vault([
	["Apollo", "project", {}],
	["Lander", "project", { parent_project: "[[Apollo]]" }],
	["Kickoff", "note", { project: "[[Apollo]]" }],
	["Lander notes", "note", { project: "[[Lander]]" }],
	["Loose note", "note", {}],
	["Earth", "place", {}],
	["London", "place", { part_of: "[[Earth]]" }],
	["Ada", "person", { works_for: "[[Acme]]" }],
	["Acme", "organisation", {}],
	["Acme UK", "organisation", { part_of: "[[Acme]]" }],
	["Globex", "company", {}],
	["Big deal", "deal", { company: "[[Globex]]" }],
	["Sub co", "company", { subsidiary_of: "[[Globex]]" }],
]);

const shape = (sections: BrowserSection[]) =>
	sections.map((s) => ({
		section: s.key,
		count: s.count,
		blocks: s.blocks.map((b) => `${b.type?.key ?? "*"}: ${outline(b.roots)}`),
	}));
const outline = (nodes: TreeNode[]): string => nodes.map((n) => (n.children.length ? `${n.entity.name}(${outline(n.children)})` : n.entity.name)).join(", ");

describe("parentMap / buildForest", () => {
	it("finds parents through each type's parent fields", () => {
		const p = parentMap(entities, edges);
		expect(p.get("Lander.md")).toBe("Apollo.md");
		expect(p.get("Kickoff.md")).toBe("Apollo.md");
		expect(p.get("London.md")).toBe("Earth.md");
		expect(p.has("Ada.md")).toBe(false); // works_for isn't a parent field
	});

	it("uses the first parent field that is filled in", () => {
		const t: EntityTypeDef = { ...T("note"), parentFields: ["about", "project"] };
		const v = vault([
			["P", "project", {}],
			["X", "place", {}],
		]);
		const n: EntityInfo = { ...v.entities[0], path: "N.md", name: "N", type: t, frontmatter: { project: "[[P]]", about: ["[[X]]"] } };
		const ed = extractEdges("N.md", t, n.frontmatter, (l) => (l === "P" || l === "X" ? `${l}.md` : null));
		expect(parentMap([...v.entities, n], ed).get("N.md")).toBe("X.md");
	});

	it("breaks cycles and sorts siblings by type order, order, then name (numeric)", () => {
		const v = vault([
			["A", "place", { part_of: "[[B]]" }],
			["B", "place", { part_of: "[[A]]" }],
			["Chapter 10", "note", {}],
			["Chapter 2", "note", {}],
			["Zed", "note", {}, { order: 1 }],
		]);
		const roots = buildForest(v.entities, parentMap(v.entities, v.edges), ["place", "note"]);
		expect(outline(roots)).toBe("A(B), Zed, Chapter 2, Chapter 10");
	});
});

describe("buildBrowser", () => {
	it("default: group sections, type headings, children nest within their group", () => {
		expect(shape(buildBrowser(entities, edges, TYPES, GROUPS, DEFAULT_BROWSER_OPTIONS))).toEqual([
			{ section: "directory", count: 5, blocks: ["person: Ada", "organisation: Acme(Acme UK)", "place: Earth(London)"] },
			{ section: "work", count: 5, blocks: ["project: Apollo(Lander(Lander notes), Kickoff)", "note: Loose note"] },
			{ section: "orgs", count: 2, blocks: ["company: Globex(Sub co)"] },
			{ section: "sales", count: 1, blocks: ["deal: Big deal"] },
		]);
	});

	it("can nest children under parents in other groups", () => {
		const s = buildBrowser(entities, edges, TYPES, GROUPS, { ...DEFAULT_BROWSER_OPTIONS, crossGroup: "parent" });
		expect(shape(s).map((x) => x.section)).toEqual(["directory", "work", "orgs"]);
		expect(shape(s).find((x) => x.section === "orgs")!.blocks).toEqual(["company: Globex(Sub co, Big deal)"]);
	});

	it("can drop type headings (one tree per section) or sections (one tree)", () => {
		const noHeadings = buildBrowser(entities, edges, TYPES, GROUPS, { ...DEFAULT_BROWSER_OPTIONS, typeHeadings: false });
		expect(shape(noHeadings)[1]).toEqual({ section: "work", count: 5, blocks: ["*: Apollo(Lander(Lander notes), Kickoff), Loose note"] });
		const one = buildBrowser(entities, edges, TYPES, GROUPS, { ...DEFAULT_BROWSER_OPTIONS, sections: "none", typeHeadings: false });
		expect(shape(one)).toEqual([{ section: "*", count: 13, blocks: ["*: Ada, Acme(Acme UK), Earth(London), Apollo(Lander(Lander notes), Kickoff), Loose note, Globex(Sub co, Big deal)"] }]);
		const byType = buildBrowser(entities, edges, TYPES, GROUPS, { ...DEFAULT_BROWSER_OPTIONS, sections: "none" });
		expect(shape(byType)[0].blocks).toContain("company: Globex(Sub co, Big deal)");
		expect(shape(byType)[0].blocks).not.toContain("deal: Big deal");
	});

	it("shows empty types and groups when asked, and puts types with an unknown group last", () => {
		const s = buildBrowser(entities, edges, TYPES, GROUPS, { ...DEFAULT_BROWSER_OPTIONS, showEmpty: true });
		expect(s.find((x) => x.key === "people")?.blocks.map((b) => `${b.type?.key}:${b.count}`)).toEqual(["contact:0"]);
		const lost: EntityTypeDef = { ...T("place"), key: "lost", group: "nowhere" };
		const v = vault([["Lost thing", "place", {}]]);
		v.entities[0].type = lost;
		const t = buildBrowser(v.entities, [], [...TYPES, lost], GROUPS, DEFAULT_BROWSER_OPTIONS);
		expect(shape(t)).toEqual([{ section: "", count: 1, blocks: ["lost: Lost thing"] }]);
	});
});

describe("filterBrowser / locate", () => {
	const sections = buildBrowser(entities, edges, TYPES, GROUPS, DEFAULT_BROWSER_OPTIONS);

	it("keeps matches and their ancestors (as context), dropping empty blocks and sections", () => {
		const f = filterBrowser(sections, (e) => e.name.includes("notes"));
		expect(shape(f)).toEqual([{ section: "work", count: 1, blocks: ["project: Apollo(Lander(Lander notes))"] }]);
		const apollo = f[0].blocks[0].roots[0];
		expect([apollo.context, apollo.children[0].context, apollo.children[0].children[0].context]).toEqual([true, true, undefined]);
		expect(countMatches(f[0].blocks[0].roots)).toBe(1);
	});

	it("locates a note's section, block and ancestors, and lists branches", () => {
		expect(locate(sections, "Lander notes.md")).toEqual({ section: "work", block: "work/project", ancestors: ["Apollo.md", "Lander.md"] });
		expect(locate(sections, "Ada.md")).toEqual({ section: "directory", block: "directory/person", ancestors: [] });
		expect(locate(sections, "Nope.md")).toBeNull();
		expect(branchPaths(sections).sort()).toEqual(["Acme.md", "Apollo.md", "Earth.md", "Globex.md", "Lander.md"]);
	});
});

describe("childOptions", () => {
	it("lists types whose parent fields accept the parent", () => {
		expect(childOptions(T("project"), TYPES).map((c) => `${c.type.key}.${c.field}`)).toEqual(["project.parent_project", "note.project"]);
		expect(childOptions(T("place"), TYPES).map((c) => `${c.type.key}.${c.field}`)).toEqual(["place.part_of"]);
		expect(childOptions(T("company"), TYPES).map((c) => `${c.type.key}.${c.field}`)).toEqual(["company.subsidiary_of", "deal.company"]);
		expect(childOptions(T("person"), TYPES)).toEqual([]);
	});
});
