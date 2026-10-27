import { describe, expect, it } from "vitest";
import { cardSections, urlHref } from "../src/model/card";
import { isoDateAdapter } from "../src/model/dates";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import { addLink, extractEdges, groupRelations, removeLink, type Edge } from "../src/model/relations";
import type { EntityTypeDef } from "../src/model/types";

const TYPES = [...STARTER_PACK.types, ...CRM_PACK.types];
const T = (key: string) => TYPES.find((t) => t.key === key)!;
const typeName = (k: string) => TYPES.find((t) => t.key === k)?.name ?? k;

/** Fake vault: link path -> file path */
const files: Record<string, string> = {
	Acme: "Orgs/Acme.md",
	Globex: "Orgs/Globex.md",
	London: "Places/London.md",
	Ada: "People/Ada.md",
	Grace: "People/Grace.md",
	Alan: "People/Alan.md",
	Apollo: "Projects/Apollo.md",
	Kickoff: "Notes/Kickoff.md",
	Lore: "Notes/Lore.md",
};
const resolve = (p: string) => files[p] ?? null;
const edgesOf = (path: string, type: string | EntityTypeDef, fm: Record<string, unknown>): Edge[] =>
	extractEdges(path, typeof type === "string" ? T(type) : type, fm, resolve);
const order = (type: string) => T(type).fields.map((f) => f.key);

const adaEdges = edgesOf(files.Ada, "person", {
	works_for: "[[Acme]]",
	based_in: "[[London|the city]]",
	knows: ["[[Grace|mentor]]", "[[Alan]]", "[[Nobody|friend]]"],
	related: ["[[Lore]]"],
	role: "[[Acme]]", // not a relation field
});

describe("extractEdges", () => {
	it("extracts relation fields, labelled entries, related and unresolved links", () => {
		expect(adaEdges.map((e) => [e.fieldKey, e.linktext, e.target, e.label ?? null])).toEqual([
			["works_for", "Acme", files.Acme, null],
			["based_in", "London", files.London, null],
			["knows", "Grace", files.Grace, "mentor"],
			["knows", "Alan", files.Alan, null],
			["knows", "Nobody", null, "friend"],
			["related", "Lore", files.Lore, null],
		]);
		expect(adaEdges[0]).toMatchObject({ inverse: "People", symmetric: false, sourceType: "person", targets: ["organisation"] });
		expect(adaEdges[5]).toMatchObject({ related: true, symmetric: true, fieldLabel: "Related" });
	});

	it("skips self links and junk values, reads legacy labelled objects", () => {
		expect(edgesOf(files.Ada, "person", { works_for: "[[Ada]]", knows: [null, 3, ""] })).toEqual([]);
		const legacy = edgesOf(files.Ada, "person", { knows: [{ target: "[[Grace]]", label: "mentor" }] });
		expect(legacy.map((e) => [e.target, e.label])).toEqual([[files.Grace, "mentor"]]);
	});
});

describe("groupRelations", () => {
	it("groups outgoing links by field label and labelled links by label, in field order", () => {
		const groups = groupRelations(files.Ada, adaEdges, [], { fieldOrder: order("person") });
		expect(groups.map((g) => [g.title, g.direction, g.fieldKey, g.items.map((i) => i.path ?? `?${i.linktext}`)])).toEqual([
			["Works for", "out", "works_for", [files.Acme]],
			["Based in", "out", "based_in", [files.London]],
			["Friend", "out", "knows", ["?Nobody"]],
			["Knows", "out", "knows", [files.Alan]],
			["Mentor", "out", "knows", [files.Grace]],
			["Related", "both", "related", [files.Lore]],
		]);
	});

	it("computes inverse groups on the target, merged across sources", () => {
		const grace = edgesOf(files.Grace, "person", { works_for: "[[Acme]]" });
		const incoming = [...adaEdges, ...grace].filter((e) => e.target === files.Acme);
		const groups = groupRelations(files.Acme, [], incoming, { typeName });
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ title: "People", direction: "in" });
		expect(groups[0].items.map((i) => i.path)).toEqual([files.Ada, files.Grace]);
	});

	it("names inverse-less incoming groups after the field and source type", () => {
		const noInverse: EntityTypeDef = { ...T("note"), fields: [{ key: "attendee", label: "Attendee", kind: "relation", targets: ["person"] }] };
		const e = edgesOf(files.Kickoff, noInverse, { attendee: "[[Ada]]" });
		expect(groupRelations(files.Ada, [], e, { typeName }).map((g) => g.title)).toEqual(["Attendee (from Note)"]);
		expect(groupRelations(files.Ada, [], e).map((g) => g.title)).toEqual(["Attendee (from note)"]);
	});

	it("shows labelled incoming links as '<Label> of' and related links both ways", () => {
		const toGrace = adaEdges.filter((e) => e.target === files.Grace);
		expect(groupRelations(files.Grace, [], toGrace).map((g) => [g.title, g.direction])).toEqual([["Mentor of", "in"]]);
		const toAlan = adaEdges.filter((e) => e.target === files.Alan);
		expect(groupRelations(files.Alan, [], toAlan, { typeName }).map((g) => g.title)).toEqual(["Known by"]);
		const lore = groupRelations(files.Lore, [], adaEdges.filter((e) => e.target === files.Lore));
		expect(lore[0]).toMatchObject({ title: "Related", direction: "both" });
		expect(lore[0].fieldKey).toBeUndefined();
	});

	it("merges symmetric relations from both directions without duplicates", () => {
		const partner: EntityTypeDef = { ...T("organisation"), fields: [{ key: "partners", label: "Partners", kind: "relation", targets: ["organisation"], multiple: true, symmetric: true }] };
		const acme = edgesOf(files.Acme, partner, { partners: ["[[Globex]]"] });
		const globex = edgesOf(files.Globex, partner, { partners: ["[[Acme]]"] });
		const groups = groupRelations(files.Acme, acme, globex.filter((e) => e.target === files.Acme));
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ title: "Partners", direction: "both", fieldKey: "partners" });
		expect(groups[0].items.map((i) => i.path)).toEqual([files.Globex]);
	});

	it("puts outgoing groups first, then incoming, then related", () => {
		const incoming = edgesOf(files.Apollo, "project", { owner: "[[Ada]]" });
		const titles = groupRelations(files.Ada, adaEdges, incoming, { fieldOrder: order("person"), typeName }).map((g) => g.title);
		expect(titles).toEqual(["Works for", "Based in", "Friend", "Knows", "Mentor", "Owns projects", "Related"]);
	});
});

describe("cardSections", () => {
	const adaFm = { role: "CTO", email: "ada@example.com", phone: null, birthday: "1815-12-10", works_for: "[[Acme]]" };
	const incoming = edgesOf(files.Apollo, "project", { owner: "[[Ada]]" });
	const groups = groupRelations(files.Ada, adaEdges, incoming, { fieldOrder: order("person"), typeName });
	const describe_ = (s: ReturnType<typeof cardSections>) =>
		s.map((x) => (x.kind === "field" ? `${x.label}: ${x.value}` : x.kind === "relation" ? `[${x.group.title}]` : `[${x.label}: —]`));

	it("defaults to filled fields (minus subtitle fields) then every relation group", () => {
		const sections = cardSections(T("person"), adaFm, groups, isoDateAdapter);
		expect(sections[0]).toMatchObject({ key: "email", href: "mailto:ada@example.com" });
		expect(describe_(sections)).toEqual([
			"Email: ada@example.com",
			"Birthday: 10 December 1815",
			"[Works for]",
			"[Based in]",
			"[Friend]",
			"[Knows]",
			"[Mentor]",
			"[Owns projects]",
			"[Related]",
		]);
	});

	it("hides incoming-only groups when incoming is off", () => {
		const t = { ...T("person"), card: { subtitle: ["role"], incoming: false } };
		expect(describe_(cardSections(t, adaFm, groups, isoDateAdapter))).not.toContain("[Owns projects]");
		expect(describe_(cardSections(t, adaFm, groups, isoDateAdapter))).toContain("[Related]");
	});

	it("follows card.fields order, placing relation groups in position, then incoming groups", () => {
		const t = { ...T("person"), card: { subtitle: ["role"], fields: ["knows", "role", "phone", "works_for"] } };
		expect(describe_(cardSections(t, adaFm, groups, isoDateAdapter))).toEqual([
			"[Friend]",
			"[Knows]",
			"[Mentor]",
			"Role: CTO",
			"[Works for]",
			"[Owns projects]",
		]);
	});

	it("shows empty listed fields when showEmpty is on, and Related when listed", () => {
		const t = { ...T("person"), card: { fields: ["phone", "based_in", "related"], showEmpty: true, incoming: false } };
		const sections = cardSections(t, adaFm, [], isoDateAdapter);
		expect(describe_(sections)).toEqual(["Phone: —", "[Based in: —]", "[Related: —]"]);
		expect(sections[0]).toMatchObject({ empty: true });
		const withRelated = cardSections({ ...t, card: { fields: ["related"] } }, adaFm, groups, isoDateAdapter);
		expect(describe_(withRelated)).toEqual(["[Related]", "[Owns projects]"]);
	});
});

describe("addLink / removeLink", () => {
	it("turns url values into links", () => {
		expect(urlHref("https://acme.example")).toBe("https://acme.example");
		expect(urlHref("ada@example.com")).toBe("mailto:ada@example.com");
		expect(urlHref("acme.example/about")).toBe("https://acme.example/about");
		expect(urlHref("not a link")).toBeUndefined();
		expect(urlHref("")).toBeUndefined();
	});

	it("appends to lists without duplicates and replaces single values", () => {
		expect(addLink(["[[A]]"], "B", { multiple: true })).toEqual(["[[A]]", "[[B]]"]);
		expect(addLink(["[[A]]"], "a", { multiple: true })).toEqual(["[[A]]"]);
		expect(addLink(null, "B", { multiple: true })).toEqual(["[[B]]"]);
		expect(addLink("[[A]]", "B", { multiple: false })).toBe("[[B]]");
		expect(addLink([], "B", { multiple: true, labelled: true, label: "mentor" })).toEqual(["[[B|mentor]]"]);
		expect(addLink([], "B", { multiple: true, labelled: true })).toEqual(["[[B]]"]);
	});

	it("allows the same target with different labels but not the same label twice", () => {
		expect(addLink(["[[B|mentor]]"], "B", { multiple: true, labelled: true, label: "friend" })).toEqual(["[[B|mentor]]", "[[B|friend]]"]);
		expect(addLink(["[[B|mentor]]"], "B", { multiple: true, labelled: true, label: "mentor" })).toEqual(["[[B|mentor]]"]);
	});

	it("removes matching links from lists, labelled lists and single values", () => {
		const isB = (p: string) => p === "B";
		expect(removeLink(["[[A]]", "[[B]]"], isB)).toEqual(["[[A]]"]);
		expect(removeLink(["[[B|mentor]]", "[[A|friend]]"], isB)).toEqual(["[[A|friend]]"]);
		expect(removeLink([{ target: "[[B]]", label: "x" }, { target: "[[A]]" }], isB)).toEqual([{ target: "[[A]]" }]);
		expect(removeLink("[[B|Bee]]", isB)).toBeNull();
		expect(removeLink("[[A]]", isB)).toBe("[[A]]");
	});
});
