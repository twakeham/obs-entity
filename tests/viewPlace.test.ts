import { describe, expect, it } from "vitest";
import { findViewBlocks, setBlockPlace } from "../src/model/viewBlock";
import { autoViewSpot, placeFor, placeSpot, placeViews, viewSpot, type ViewSpot } from "../src/model/viewPlace";
import { parseView, serializeView } from "../src/model/views";
import type { BrowserBlock, BrowserSection } from "../src/model/tree";
import type { EntityTypeDef, GroupDef } from "../src/model/types";

const type = (key: string, group: string): EntityTypeDef => ({ key, name: key, plural: `${key}s`, icon: "x", color: "", group, template: "", fields: [], builtIn: false });
const TYPES = [type("campaign", "table"), type("session", "table"), type("quest", "table"), type("npc", "cast")];
const GROUPS: GroupDef[] = [
	{ key: "table", name: "At the table", icon: "dices", statuses: [] },
	{ key: "cast", name: "Cast", icon: "users", statuses: [] },
];
const block = (section: string, key: string | null): BrowserBlock => ({ key: `${section}/${key ?? "*"}`, type: key ? TYPES.find((t) => t.key === key)! : null, roots: [], count: 0, nested: 0, nestedUnder: [] });
const section = (key: string, blocks: (string | null)[]): BrowserSection => ({ key, group: GROUPS.find((g) => g.key === key) ?? null, blocks: blocks.map((b) => block(key, b)), count: 0 });

describe("where the browser lists a view", () => {
	it("works it out from the view's types", () => {
		expect(autoViewSpot(["campaign"], TYPES, GROUPS)).toEqual({ kind: "type", key: "campaign" });
		expect(autoViewSpot(["session", "quest"], TYPES, GROUPS)).toEqual({ kind: "group", key: "table" });
		expect(autoViewSpot(["@cast"], TYPES, GROUPS)).toEqual({ kind: "group", key: "cast" });
		expect(autoViewSpot(["@table", "session"], TYPES, GROUPS)).toEqual({ kind: "group", key: "table" });
		expect(autoViewSpot(["session", "npc"], TYPES, GROUPS)).toEqual({ kind: "views" });
		expect(autoViewSpot(["*"], TYPES, GROUPS)).toEqual({ kind: "views" });
		expect(autoViewSpot([], TYPES, GROUPS)).toEqual({ kind: "views" });
		expect(autoViewSpot(["gone"], TYPES, GROUPS)).toEqual({ kind: "views" });
	});

	it("follows place: when it names something that exists", () => {
		expect(placeSpot("views", TYPES, GROUPS)).toEqual({ kind: "views" });
		expect(placeSpot("@cast", TYPES, GROUPS)).toEqual({ kind: "group", key: "cast" });
		expect(placeSpot("campaign", TYPES, GROUPS)).toEqual({ kind: "type", key: "campaign" });
		expect(placeSpot("@gone", TYPES, GROUPS)).toBeNull();
		expect(placeSpot("gone", TYPES, GROUPS)).toBeNull();
		expect(placeSpot(null, TYPES, GROUPS)).toBeNull();
		// A place that no longer exists falls back to the automatic spot.
		expect(viewSpot(["session", "quest"], "campaign", TYPES, GROUPS)).toEqual({ kind: "type", key: "campaign" });
		expect(viewSpot(["session", "quest"], "gone", TYPES, GROUPS)).toEqual({ kind: "group", key: "table" });
	});

	it("saves a place only when moved away from the automatic spot", () => {
		expect(placeFor({ kind: "type", key: "campaign" }, ["session", "quest"], TYPES, GROUPS)).toBe("campaign");
		expect(placeFor({ kind: "group", key: "table" }, ["session", "quest"], TYPES, GROUPS)).toBeNull();
		expect(placeFor({ kind: "views" }, ["session", "quest"], TYPES, GROUPS)).toBe("views");
		expect(placeFor({ kind: "views" }, ["*"], TYPES, GROUPS)).toBeNull();
		expect(placeFor({ kind: "group", key: "cast" }, ["campaign"], TYPES, GROUPS)).toBe("@cast");
	});

	it("places views among the headings shown, falling back to the group, then Views", () => {
		const views: { view: string; spot: ViewSpot }[] = [
			{ view: "Campaign calendar", spot: { kind: "type", key: "campaign" } },
			{ view: "Quest board", spot: { kind: "type", key: "quest" } },
			{ view: "Table", spot: { kind: "group", key: "table" } },
			{ view: "NPCs", spot: { kind: "type", key: "npc" } },
			{ view: "Everything", spot: { kind: "views" } },
		];
		// Quests have no heading (no notes), and Cast has no section.
		const placed = placeViews(views, [section("table", ["campaign", "session"])], TYPES);
		expect(placed.top).toEqual(["NPCs", "Everything"]);
		expect([...placed.sections]).toEqual([["table", ["Quest board", "Table"]]]);
		expect([...placed.blocks]).toEqual([["table/campaign", ["Campaign calendar"]]]);
		// Without type headings, type-placed views go to their group's section; with one tree, to Views.
		const flat = placeViews(views, [section("table", [null]), section("cast", [null])], TYPES);
		expect(flat.sections.get("table")).toEqual(["Campaign calendar", "Quest board", "Table"]);
		expect(flat.sections.get("cast")).toEqual(["NPCs"]);
		const one = placeViews(views, [section("*", ["campaign"])], TYPES);
		expect(one.blocks.get("*/campaign")).toEqual(["Campaign calendar"]);
		expect(one.top).toEqual(["Quest board", "Table", "NPCs", "Everything"]);
	});

	it("is kept in the view block, round trip and edited in place", () => {
		const inner = "kind: calendar\ntypes: [session, quest]\ncolumns: [name]\n";
		const placed = setBlockPlace(inner, "campaign");
		expect(placed).toBe('kind: calendar\ntypes: [session, quest]\ncolumns: [name]\nplace: "campaign"');
		expect(setBlockPlace(placed, "@table")).toBe('kind: calendar\ntypes: [session, quest]\ncolumns: [name]\nplace: "@table"');
		expect(setBlockPlace(placed, null)).toBe("kind: calendar\ntypes: [session, quest]\ncolumns: [name]");
		const { def } = parseView({ kind: "table", types: ["session"], place: "@table" });
		expect(def!.place).toBe("@table");
		expect(serializeView(def!).place).toBe("@table");
		expect(serializeView(parseView({ types: ["session"] }).def!).place).toBeUndefined();
		expect(findViewBlocks("```entity-view\n" + placed + "\n```")[0].inner).toBe(placed);
	});
});
