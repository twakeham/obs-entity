import { describe, expect, it } from "vitest";
import {
	addTab,
	allLists,
	allowedIn,
	blankNode,
	canHold,
	fieldSlots,
	insertionPoint,
	insertNode,
	layoutFields,
	layoutFromFields,
	layoutIssues,
	listKey,
	moveBy,
	moveNode,
	moveTab,
	nodeAt,
	nodeKeys,
	normaliseLayout,
	parentList,
	parseListKey,
	placeableKeys,
	placeOf,
	readableOn,
	removeNode,
	removeTab,
	renameLayoutKey,
	resolveLayout,
	setColumnCount,
	isNoteItem,
	NOTE_ITEMS,
	READ_ONLY_ITEMS,
	slotHelp,
	slotLabel,
	slotProblems,
	tabsOnPath,
	ungroupFrame,
	updateNode,
	updateTab,
	type FormLayout,
	type LayoutField,
	type LayoutList,
	type LayoutNode,
} from "../src/model/formLayout";
import { STARTER_PACK } from "../src/model/packs";
import { renameFieldRefs } from "../src/model/typeEditing";
import { cloneType } from "../src/model/types";
import { typeIssues } from "../src/model/validation";

const project = () => cloneType(STARTER_PACK.types.find((t) => t.key === "project")!);
const person = () => cloneType(STARTER_PACK.types.find((t) => t.key === "person")!);

const LAYOUT: FormLayout = {
	items: [
		{
			kind: "frame",
			caption: "Overview",
			items: [
				{ kind: "columns", columns: [[{ kind: "field", key: "client" }, { kind: "field", key: "status" }], [{ kind: "field", key: "owner" }]] },
				{ kind: "field", key: "description" },
			],
		},
		{ kind: "frame", caption: "Schedule", create: false, items: [{ kind: "columns", columns: [[{ kind: "field", key: "start" }], [{ kind: "field", key: "due" }]], widths: [2, 1] }] },
		{ kind: "heading", text: "More" },
		{ kind: "frame", caption: "Team", collapsible: true, collapsed: true, items: [{ kind: "field", key: "team", label: "beside" }] },
	],
};

describe("form layouts", () => {
	it("tidy layouts from settings or imports", () => {
		expect(normaliseLayout(LAYOUT)).toEqual(LAYOUT);
		expect(normaliseLayout(null)).toBeNull();
		expect(normaliseLayout({ items: "x" })).toBeNull();
		const messy = normaliseLayout({
			hideUnplaced: true,
			items: [
				"owner",
				{ kind: "field", key: " due ", label: "above" },
				{ kind: "frame", caption: "  ", collapsed: true, items: [{ kind: "frame", items: ["start"] }, { kind: "heading", text: "Hi" }, { kind: "mystery" }] },
				{ kind: "columns", columns: [["a"], ["b"], ["c"], ["d"], ["e"]], widths: [1, 1, 1, 1, 1] },
				{ kind: "columns", columns: [["a"]], widths: [3] },
				{ kind: "columns", columns: [["a"], ["b"]], widths: [0, 2] },
			],
		});
		expect(messy).toEqual({
			hideUnplaced: true,
			items: [
				{ kind: "field", key: "owner" },
				// "above" is the default, so it isn't kept
				{ kind: "field", key: "due" },
				// a nested frame's items are lifted; "collapsed" needs "collapsible"; blank captions go
				{ kind: "frame", items: [{ kind: "field", key: "start" }, { kind: "heading", text: "Hi" }] },
				// 4 columns at most; widths that are all equal or not positive are dropped
				{ kind: "columns", columns: [[{ kind: "field", key: "a" }], [{ kind: "field", key: "b" }], [{ kind: "field", key: "c" }], [{ kind: "field", key: "d" }]] },
				// at least 2 columns
				{ kind: "columns", columns: [[{ kind: "field", key: "a" }], []] },
				{ kind: "columns", columns: [[{ kind: "field", key: "a" }], [{ kind: "field", key: "b" }]] },
			],
		});
	});

	it("list every placed slot and what a type can place", () => {
		expect(layoutFields(LAYOUT).map((f) => f.key)).toEqual(["client", "status", "owner", "description", "start", "due", "team"]);
		expect(placeableKeys(project())).toEqual(["description", "owner", "team", "client", "start", "due", "parent_project", "status", "related", "tags", "aliases", "order", "@name", "@type", "@subtitle", "@type-subtitle", "@created", "@modified"]);
		// no parent fields: no order
		expect(placeableKeys(person())).not.toContain("order");
	});

	it("resolve against the type: unknown and repeated slots dropped, unplaced fields and built-ins listed", () => {
		const r = resolveLayout({ items: [...LAYOUT.items, { kind: "field", key: "gone" }, { kind: "field", key: "owner" }] }, project());
		expect(layoutFields({ items: r.items }).map((f) => f.key)).toEqual(["client", "status", "owner", "description", "start", "due", "team"]);
		expect(r.unplaced).toEqual(["parent_project"]);
		expect(r.unplacedBuiltins).toEqual(["related", "tags", "aliases", "order", "@name", "@type", "@subtitle", "@type-subtitle", "@created", "@modified"]);
		expect(r.placesStatus).toBe(true);
		expect(r.placesType || r.placesSubtitle).toBe(false);
		expect(resolveLayout({ items: [] }, person()).placesStatus).toBe(false);
	});

	it("follow field renames and deletions, through renameFieldRefs", () => {
		expect(layoutFields(renameLayoutKey(LAYOUT, "owner", "lead")).map((f) => f.key)).toContain("lead");
		const gone = renameLayoutKey(LAYOUT, "due", null);
		expect(layoutFields(gone).map((f) => f.key)).not.toContain("due");
		// the column stays (empty), so the frame keeps its shape
		expect((gone.items[1] as { items: { columns: unknown[][] }[] }).items[0].columns).toEqual([[{ kind: "field", key: "start" }], []]);
		const t = project();
		t.form = { layout: LAYOUT };
		renameFieldRefs(t, "client", "customer");
		renameFieldRefs(t, "team", null);
		expect(layoutFields(t.form.layout!).map((f) => f.key)).toEqual(["customer", "status", "owner", "description", "start", "due"]);
	});

	it("start from the fields, and report problems", () => {
		expect(layoutFromFields(person())).toEqual({ items: [{ kind: "frame", caption: "Person", items: person().fields.map((f) => ({ kind: "field", key: f.key })) }] });
		const t = person();
		expect(layoutIssues({ items: [{ kind: "field", key: "role" }, { kind: "field", key: "ghost" }, { kind: "field", key: "role" }, { kind: "field", key: "order" }] }, t)).toEqual([
			'The form layout places "ghost", which isn\'t a field of this type.',
			'The form layout places "role" more than once.',
			'The form layout places "order", which isn\'t a field of this type.',
		]);
		t.form = { layout: { items: [{ kind: "field", key: "ghost" }] } };
		expect(typeIssues(t, { typeKeys: ["person"], groupKeys: ["directory"] })).toContainEqual({ at: "form:layout", message: 'The form layout places "ghost", which isn\'t a field of this type.' });
	});
});

describe("tabs and frames in columns", () => {
	const TABBED: FormLayout = {
		items: [
			{ kind: "field", key: "status" },
			{
				kind: "tabs",
				tabs: [
					{ caption: "Overview", items: [{ kind: "columns", columns: [[{ kind: "frame", caption: "Who", items: [{ kind: "field", key: "client" }, { kind: "field", key: "owner" }] }], [{ kind: "frame", caption: "When", items: [{ kind: "columns", columns: [[{ kind: "field", key: "start" }], [{ kind: "field", key: "due" }]] }] }, { kind: "text", text: "Note" }]] }] },
					{ caption: "Team", icon: "users", create: false, items: [{ kind: "field", key: "team" }] },
				],
			},
		],
	};

	it("reads tabs and frames in columns, lifting what can't nest", () => {
		expect(normaliseLayout(TABBED)).toEqual(TABBED);
		const messy = normaliseLayout({
			items: [
				{ kind: "tabs", tabs: [{ caption: " ", items: [{ kind: "tabs", tabs: [{ items: ["a"] }] }, "b"] }, "nope"] },
				{ kind: "tabs", tabs: [] },
				{ kind: "frame", items: [{ kind: "tabs", tabs: [{ items: ["c"] }] }, { kind: "columns", columns: [[{ kind: "frame", items: ["d"] }, { kind: "heading", text: "x" }], ["e"]] }] },
				{ kind: "columns", columns: [[{ kind: "columns", columns: [["f"], ["g"]] }, { kind: "tabs", tabs: [{ items: ["h"] }] }], []] },
			],
		});
		expect(messy).toEqual({
			items: [
				// a tab needs a caption; a tab group in a tab is lifted; tabs that aren't objects go; an empty group goes
				{ kind: "tabs", tabs: [{ caption: "Tab 1", items: [{ kind: "field", key: "a" }, { kind: "field", key: "b" }] }] },
				// in a frame: tabs lifted; columns hold fields only (a frame's fields lifted, headings dropped)
				{ kind: "frame", items: [{ kind: "field", key: "c" }, { kind: "columns", columns: [[{ kind: "field", key: "d" }], [{ kind: "field", key: "e" }]] }] },
				// in a top-level column: columns and tabs lifted
				{ kind: "columns", columns: [[{ kind: "field", key: "f" }, { kind: "field", key: "g" }, { kind: "field", key: "h" }], []] },
			],
		});
	});

	it("walks every field, resolves, renames and finds tabs", () => {
		expect(layoutFields(TABBED).map((f) => f.key)).toEqual(["status", "client", "owner", "start", "due", "team"]);
		expect(fieldSlots(TABBED).map((s) => s.path.join("."))).toEqual(["0", "1.0.0.0.0.0", "1.0.0.0.0.1", "1.0.0.1.0.0.0.0", "1.0.0.1.0.0.1.0", "1.1.0"]);
		const r = resolveLayout({ items: [...TABBED.items, { kind: "field", key: "owner" }] }, project());
		expect(layoutFields({ items: r.items }).map((f) => f.key)).toEqual(["status", "client", "owner", "start", "due", "team"]);
		expect(r.unplaced).toEqual(["description", "priority", "budget", "parent_project"].filter((k) => project().fields.some((f) => f.key === k)));
		expect(layoutFields(renameLayoutKey(TABBED, "due", "deadline")).map((f) => f.key)).toContain("deadline");
		expect(layoutFields(renameLayoutKey(TABBED, "client", null)).map((f) => f.key)).not.toContain("client");
		expect(tabsOnPath(TABBED, [1, 0, 0, 1, 0, 0, 1, 0])).toEqual([{ group: "1", tab: 0 }]);
		expect(tabsOnPath(TABBED, [1, 1, 0])).toEqual([{ group: "1", tab: 1 }]);
		expect(tabsOnPath(TABBED, [0])).toEqual([]);
		expect(nodeKeys([TABBED.items[1]])).toEqual(["client", "owner", "start", "due", "team"]);
	});

	it("knows what each place can hold", () => {
		const tab: LayoutList = { at: [1], slot: 0 };
		const outer: LayoutList = { at: [1, 0, 0], slot: 1 };
		const frameInCol: LayoutList = { at: [1, 0, 0, 0, 0] };
		const inner: LayoutList = { at: [1, 0, 0, 1, 0, 0], slot: 0 };
		expect([tab, outer, frameInCol, inner].map((l) => placeOf(TABBED, l))).toEqual(["tab", "outer-column", "frame", "inner-column"]);
		expect(placeOf(TABBED, { at: [] })).toBe("root");
		expect(canHold(TABBED, { at: [] }, blankNode("tabs"))).toBe(true);
		expect(canHold(TABBED, tab, blankNode("tabs"))).toBe(false);
		expect(canHold(TABBED, tab, blankNode("frame"))).toBe(true);
		expect(canHold(TABBED, outer, blankNode("frame"))).toBe(true);
		expect(canHold(TABBED, outer, blankNode("heading"))).toBe(true);
		expect(canHold(TABBED, outer, blankNode("columns2"))).toBe(false);
		expect(canHold(TABBED, frameInCol, blankNode("frame"))).toBe(false);
		expect(canHold(TABBED, frameInCol, blankNode("columns2"))).toBe(true);
		expect(canHold(TABBED, inner, blankNode("text"))).toBe(false);
		// columns holding frames can't go into a frame
		expect(allowedIn("frame", (TABBED.items[1] as { tabs: { items: LayoutNode[] }[] }).tabs[0].items[0])).toBe(false);
		expect(canHold(TABBED, { at: [5] }, { kind: "field", key: "x" })).toBe(false);
	});

	it("moves frames into and out of columns and tabs", () => {
		// the "Who" frame out of its column to the top level, before the tabs
		const a = moveNode(TABBED, [1, 0, 0, 0, 0], { at: [] }, 1)!;
		expect(a.path).toEqual([1]);
		expect(nodeAt(a.layout, [1])).toMatchObject({ kind: "frame", caption: "Who" });
		expect(nodeAt(a.layout, [2, 0, 0])).toMatchObject({ kind: "columns" });
		// a top-level field into the second tab
		const b = moveNode(TABBED, [0], { at: [1], slot: 1 }, 0)!;
		expect(b.path).toEqual([0, 1, 0]);
		expect(layoutFields(b.layout).map((f) => f.key)).toEqual(["client", "owner", "start", "due", "status", "team"]);
		// can't move a node into itself
		expect(moveNode(TABBED, [1], { at: [1], slot: 1 }, 0)).toBeNull();
		expect(moveNode(TABBED, [1, 0, 0], { at: [1, 0, 0], slot: 1 }, 0)).toBeNull();
		// can't put a frame inside a frame in a column
		expect(moveNode(TABBED, [1, 0, 0, 1, 0], { at: [1, 0, 0, 0, 0] }, 0)).toBeNull();
		// ungroup a frame in a column: its rows stay in the column, unless one is columns
		expect(nodeAt(ungroupFrame(TABBED, [1, 0, 0, 0, 0])!, [1, 0, 0, 0, 1])).toEqual({ kind: "field", key: "owner" });
		expect(ungroupFrame(TABBED, [1, 0, 0, 1, 0])).toBeNull();
	});

	it("adds into a selected tab group's open tab, and the nearest list that can hold it", () => {
		const f = { kind: "field" as const, key: "priority" };
		expect(insertionPoint(TABBED, [1], f, () => 1)).toEqual({ list: { at: [1], slot: 1 }, index: 1 });
		expect(insertionPoint(TABBED, [1], blankNode("tabs"))).toEqual({ list: { at: [] }, index: 2 });
		// a frame next to a field in a frame in a column: after that frame, in the column
		expect(insertionPoint(TABBED, [1, 0, 0, 0, 0, 1], blankNode("frame"))).toEqual({ list: { at: [1, 0, 0], slot: 0 }, index: 1 });
		// columns selected in a tab: a frame goes into the shortest column
		expect(insertionPoint(TABBED, [1, 0, 0], blankNode("frame"))).toEqual({ list: { at: [1, 0, 0], slot: 0 }, index: 1 });
	});

	it("edits tabs: add, update, move, remove", () => {
		const a = addTab(TABBED, [1]);
		expect((nodeAt(a, [1]) as { tabs: { caption: string }[] }).tabs.map((t) => t.caption)).toEqual(["Overview", "Team", "Tab 3"]);
		const u = updateTab(TABBED, [1], 1, (t) => ({ ...t, caption: "People" }));
		expect((nodeAt(u, [1]) as { tabs: { caption: string }[] }).tabs[1].caption).toBe("People");
		const m = moveTab(TABBED, { group: [1], tab: 1 }, { group: [1], index: 0 })!;
		expect(m.tab).toBe(0);
		expect((nodeAt(m.layout, [1]) as { tabs: { caption: string }[] }).tabs.map((t) => t.caption)).toEqual(["Team", "Overview"]);
		const down = moveTab(TABBED, { group: [1], tab: 0 }, { group: [1], index: 2 })!;
		expect(down.tab).toBe(1);
		// to another group; the emptied group goes
		const two: FormLayout = { items: [{ kind: "tabs", tabs: [{ caption: "A", items: [] }] }, { kind: "tabs", tabs: [{ caption: "B", items: [] }] }] };
		const x = moveTab(two, { group: [0], tab: 0 }, { group: [1], index: 1 })!;
		expect(x.layout.items).toHaveLength(1);
		expect(x.group).toEqual([0]);
		expect((x.layout.items[0] as { tabs: { caption: string }[] }).tabs.map((t) => t.caption)).toEqual(["B", "A"]);
		// remove keeping contents: they go to the top level after the group
		const r = removeTab(TABBED, [1], 1, true);
		expect(r.items.map((n) => n.kind)).toEqual(["field", "tabs", "field"]);
		expect(removeTab(TABBED, [1], 1, false).items).toHaveLength(2);
		// the last tab: the group goes (contents take its place when kept)
		const one = removeTab(r, [1], 0, true);
		expect(one.items.map((n) => n.kind)).toEqual(["field", "columns", "field"]);
	});
});

describe("slot options and frame styling", () => {
	it("reads slot options, dropping defaults and bad values", () => {
		const l = normaliseLayout({
			items: [
				{ kind: "field", key: "description", label: "hidden", caption: " Summary ", placeholder: " What's it for? ", help: { text: " Keep it short " }, rows: 6, readOnly: true },
				{ kind: "field", key: "owner", label: "above", caption: "  ", placeholder: "", help: "description", rows: 5, readOnly: "yes" },
				{ kind: "field", key: "due", help: { text: "  " }, rows: 3 },
			],
		})!;
		expect(l.items).toEqual([
			{ kind: "field", key: "description", label: "hidden", caption: "Summary", placeholder: "What's it for?", help: { text: "Keep it short" }, rows: 6, readOnly: true },
			{ kind: "field", key: "owner", help: "description" },
			{ kind: "field", key: "due", rows: 3 },
		]);
	});

	it("reads frame styling", () => {
		const l = normaliseLayout({
			items: [
				{ kind: "frame", caption: "A", icon: " star ", color: "type", style: "filled", items: [] },
				{ kind: "frame", caption: "B", icon: "", color: " ", style: "fancy", items: [] },
				{ kind: "frame", caption: "C", color: "#e5484d", style: "plain", items: [] },
			],
		})!;
		expect(l.items).toEqual([
			{ kind: "frame", caption: "A", icon: "star", color: "type", style: "filled", items: [] },
			{ kind: "frame", caption: "B", items: [] },
			{ kind: "frame", caption: "C", color: "#e5484d", style: "plain", items: [] },
		]);
	});

	it("reads coloured headers, and picks readable text for them", () => {
		const l = normaliseLayout({ items: [{ kind: "frame", caption: "A", header: "solid", items: [] }, { kind: "frame", caption: "B", header: "soft", items: [] }, { kind: "frame", caption: "C", header: "loud", items: [] }] })!;
		expect(l.items.map((n) => (n as { header?: string }).header)).toEqual(["solid", "soft", undefined]);
		expect(readableOn("#f44336")).toBe("#ffffff");
		expect(readableOn("#3f51b5")).toBe("#ffffff");
		expect(readableOn("#ffc107")).toBe("#1e1e1e");
		expect(readableOn("#8bc34a")).toBe("#1e1e1e");
		expect(readableOn("#fff")).toBe("#1e1e1e");
		expect(readableOn("var(--x)")).toBe("#ffffff");
	});

	it("places the note's name, type, subtitle and dates", () => {
		const l = normaliseLayout({
			items: [
				{ kind: "field", key: "@name", label: "hidden" },
				{ kind: "field", key: "@type-subtitle", label: "above" },
				{ kind: "field", key: "@created" },
				{ kind: "field", key: "owner", label: "above" },
			],
		})!;
		// the note items' default label is hidden (so "above" is kept and "hidden" isn't)
		expect(l.items).toEqual([
			{ kind: "field", key: "@name" },
			{ kind: "field", key: "@type-subtitle", label: "above" },
			{ kind: "field", key: "@created" },
			{ kind: "field", key: "owner" },
		]);
		expect(l.items.map((n) => slotLabel(n as LayoutField))).toEqual(["hidden", "above", "hidden", "above"]);
		const r = resolveLayout(l, project());
		expect([r.placesType, r.placesSubtitle]).toEqual([true, true]);
		expect(r.unplacedBuiltins).toEqual(["status", "related", "tags", "aliases", "order", "@type", "@subtitle", "@modified"]);
		expect(resolveLayout({ items: [{ kind: "field", key: "@subtitle" }] }, project())).toMatchObject({ placesType: false, placesSubtitle: true });
		expect(layoutIssues(l, project())).toEqual([]);
		expect([NOTE_ITEMS.name, ...READ_ONLY_ITEMS].every(isNoteItem)).toBe(true);
		expect(isNoteItem("owner")).toBe(false);
	});

	it("gives a slot's help text", () => {
		expect(slotHelp(undefined, "Desc")).toBeUndefined();
		expect(slotHelp({ kind: "field", key: "a" }, "Desc")).toBeUndefined();
		expect(slotHelp({ kind: "field", key: "a", help: "description" }, "Desc")).toBe("Desc");
		expect(slotHelp({ kind: "field", key: "a", help: "description" }, " ")).toBeUndefined();
		expect(slotHelp({ kind: "field", key: "a", help: { text: "Own" } }, "Desc")).toBe("Own");
	});
});

describe("layout designer edits", () => {
	const root: LayoutList = { at: [] };
	const keys = (l: FormLayout) => layoutFields(l).map((f) => f.key);

	it("finds nodes by path", () => {
		expect(nodeAt(LAYOUT, [0])).toMatchObject({ kind: "frame", caption: "Overview" });
		expect(nodeAt(LAYOUT, [0, 1])).toEqual({ kind: "field", key: "description" });
		expect(nodeAt(LAYOUT, [0, 0, 1, 0])).toEqual({ kind: "field", key: "owner" });
		expect(nodeAt(LAYOUT, [2])).toEqual({ kind: "heading", text: "More" });
		expect(nodeAt(LAYOUT, [9])).toBeNull();
		expect(nodeAt(LAYOUT, [0, 0, 5, 0])).toBeNull();
		expect(nodeAt(LAYOUT, [0, 0, 1])).toBeNull();
		const top: FormLayout = { items: [{ kind: "columns", columns: [[{ kind: "field", key: "a" }], []] }] };
		expect(nodeAt(top, [0, 0, 0])).toEqual({ kind: "field", key: "a" });
		expect(fieldSlots(LAYOUT).map((s) => s.path.join("."))).toEqual(["0.0.0.0", "0.0.0.1", "0.0.1.0", "0.1", "1.0.0.0", "1.0.1.0", "3.0"]);
		expect(parentList(LAYOUT, [0, 0, 1, 0])).toEqual({ list: { at: [0, 0], slot: 1 }, index: 0 });
		expect(parentList(LAYOUT, [0, 1])).toEqual({ list: { at: [0] }, index: 1 });
		expect(parentList(LAYOUT, [2])).toEqual({ list: { at: [] }, index: 2 });
	});

	it("lists, keys and what they can hold", () => {
		expect(allLists(LAYOUT).map(listKey)).toEqual([":", "0:", "0.0:0", "0.0:1", "1:", "1.0:0", "1.0:1", "3:"]);
		for (const l of allLists(LAYOUT)) expect(parseListKey(listKey(l))).toEqual(l);
		expect(parseListKey("nope")).toBeNull();
		const col: LayoutList = { at: [0, 0], slot: 1 };
		expect(canHold(LAYOUT, root, blankNode("frame"))).toBe(true);
		expect(canHold(LAYOUT, { at: [0] }, blankNode("frame"))).toBe(false);
		expect(canHold(LAYOUT, { at: [0] }, blankNode("columns3"))).toBe(true);
		expect(canHold(LAYOUT, col, blankNode("columns2"))).toBe(false);
		expect(canHold(LAYOUT, col, blankNode("heading"))).toBe(false);
		expect(canHold(LAYOUT, col, { kind: "field", key: "x" })).toBe(true);
		expect(canHold(LAYOUT, { at: [2] }, { kind: "field", key: "x" })).toBe(false);
	});

	it("new components", () => {
		expect(blankNode("columns3")).toEqual({ kind: "columns", columns: [[], [], []] });
		expect(blankNode("frame")).toEqual({ kind: "frame", caption: "New frame", items: [] });
		expect(blankNode("text")).toMatchObject({ kind: "text" });
		expect(blankNode("tabs")).toEqual({ kind: "tabs", tabs: [{ caption: "Tab 1", items: [] }, { caption: "Tab 2", items: [] }] });
	});

	it("inserts and removes", () => {
		const a = insertNode(LAYOUT, { at: [0, 0], slot: 1 }, 0, { kind: "field", key: "priority" })!;
		expect(nodeAt(a, [0, 0, 1, 0])).toEqual({ kind: "field", key: "priority" });
		expect(nodeAt(LAYOUT, [0, 0, 1, 0])).toEqual({ kind: "field", key: "owner" });
		expect(insertNode(LAYOUT, { at: [0] }, 0, blankNode("frame"))).toBeNull();
		expect(insertNode(LAYOUT, { at: [2] }, 0, { kind: "field", key: "x" })).toBeNull();
		expect(insertNode(LAYOUT, root, 99, blankNode("heading"))!.items.slice(-1)[0]).toEqual({ kind: "heading", text: "Heading" });
		expect(keys(removeNode(LAYOUT, [0]))).toEqual(["start", "due", "team"]);
		expect(keys(removeNode(LAYOUT, [0, 0, 0, 1]))).toEqual(["client", "owner", "description", "start", "due", "team"]);
	});

	it("moves between lists, keeping drop positions as shown", () => {
		const m = moveNode(LAYOUT, [0, 1], root, 2)!;
		expect(m.path).toEqual([2]);
		expect(nodeAt(m.layout, [2])).toEqual({ kind: "field", key: "description" });
		expect(nodeAt(m.layout, [3])).toMatchObject({ kind: "heading" });
		// a top-level node into a later frame: the frame's index shifts once the node leaves
		const n = moveNode(LAYOUT, [2], { at: [3] }, 0)!;
		expect(n.path).toEqual([2, 0]);
		expect(nodeAt(n.layout, [2])).toMatchObject({ kind: "frame", caption: "Team", items: [{ kind: "heading" }, { kind: "field", key: "team" }] });
		const c = moveNode(LAYOUT, [0, 0, 0, 0], { at: [1, 0], slot: 1 }, 1)!;
		expect(c.path).toEqual([1, 0, 1, 1]);
		expect(keys(c.layout)).toEqual(["status", "owner", "description", "start", "due", "client", "team"]);
		const d = moveNode(LAYOUT, [0], root, 2)!;
		expect(d.layout.items.map((i) => (i.kind === "frame" ? i.caption : i.kind))).toEqual(["Schedule", "Overview", "heading", "Team"]);
		expect(d.path).toEqual([1]);
		expect(moveNode(LAYOUT, [1], { at: [0] }, 0)).toBeNull();
		expect(moveNode(LAYOUT, [0, 0], { at: [1, 0], slot: 0 }, 0)).toBeNull();
		expect(moveNode(LAYOUT, [7], root, 0)).toBeNull();
		// a top-level frame can go into a top-level column now
		const cols: FormLayout = { items: [{ kind: "columns", columns: [[], []] }, { kind: "frame", items: [] }] };
		expect(moveNode(cols, [1], { at: [0], slot: 1 }, 0)!.path).toEqual([0, 1, 0]);
	});

	it("moves up and down with the keyboard", () => {
		const up = moveBy(LAYOUT, [2], -1)!;
		expect(up.path).toEqual([1]);
		expect(up.layout.items[1]).toMatchObject({ kind: "heading" });
		const down = moveBy(LAYOUT, [0, 0, 0, 0], 1)!;
		expect(down.path).toEqual([0, 0, 0, 1]);
		expect(keys(down.layout).slice(0, 2)).toEqual(["status", "client"]);
		expect(moveBy(LAYOUT, [0], -1)).toBeNull();
		expect(moveBy(LAYOUT, [3, 0], 1)).toBeNull();
	});

	it("updates nodes, ungroups frames and changes column counts", () => {
		const u = updateNode(LAYOUT, [1], (n) => ({ ...n, caption: "Dates" }) as typeof n);
		expect(u.items[1]).toMatchObject({ caption: "Dates" });
		expect(LAYOUT.items[1]).toMatchObject({ caption: "Schedule" });
		expect(ungroupFrame(LAYOUT, [0])!.items.map((i) => i.kind)).toEqual(["columns", "field", "frame", "heading", "frame"]);
		expect(ungroupFrame(LAYOUT, [2])).toBeNull();
		const cols = { kind: "columns" as const, columns: [[{ kind: "field" as const, key: "a" }], [{ kind: "field" as const, key: "b" }], [{ kind: "field" as const, key: "c" }]], widths: [2, 1, 1] };
		expect(setColumnCount(cols, 2)).toEqual({ kind: "columns", columns: [[{ kind: "field", key: "a" }], [{ kind: "field", key: "b" }, { kind: "field", key: "c" }]], widths: [2, 1] });
		expect(setColumnCount(cols, 4)).toEqual({ ...cols, columns: [...cols.columns, []], widths: [2, 1, 1, 1] });
		expect(setColumnCount({ kind: "columns", columns: [[], []], widths: [1, 2] }, 3)).toEqual({ kind: "columns", columns: [[], [], []], widths: [1, 2, 1] });
		expect(setColumnCount({ kind: "columns", columns: [[], [], []], widths: [2, 1, 1] }, 2).widths).toEqual([2, 1]);
		expect(setColumnCount({ kind: "columns", columns: [[], [], []], widths: [1, 1, 2] }, 2).widths).toBeUndefined();
		expect(setColumnCount(cols, 9).columns).toHaveLength(4);
	});

	it("adds where the selection is", () => {
		const f = { kind: "field" as const, key: "priority" };
		expect(insertionPoint(LAYOUT, null, f)).toEqual({ list: root, index: 4 });
		expect(insertionPoint(LAYOUT, [1], f)).toEqual({ list: { at: [1] }, index: 1 });
		expect(insertionPoint(LAYOUT, [1], blankNode("frame"))).toEqual({ list: root, index: 2 });
		expect(insertionPoint(LAYOUT, [0, 1], blankNode("frame"))).toEqual({ list: root, index: 1 });
		expect(insertionPoint(LAYOUT, [0, 0], f)).toEqual({ list: { at: [0, 0], slot: 1 }, index: 1 });
		expect(insertionPoint(LAYOUT, [0, 0], blankNode("heading"))).toEqual({ list: { at: [0] }, index: 1 });
		expect(insertionPoint(LAYOUT, [0, 0, 0, 1], f)).toEqual({ list: { at: [0, 0], slot: 0 }, index: 2 });
		expect(insertionPoint(LAYOUT, [0, 0, 0, 1], blankNode("text"))).toEqual({ list: { at: [0] }, index: 1 });
		expect(insertionPoint(LAYOUT, [2], f)).toEqual({ list: root, index: 3 });
		expect(insertionPoint(LAYOUT, [8], f)).toEqual({ list: root, index: 4 });
	});

	it("flags slots for missing or repeated fields", () => {
		const l: FormLayout = { items: [{ kind: "field", key: "client" }, { kind: "frame", items: [{ kind: "field", key: "ghost" }, { kind: "columns", columns: [[{ kind: "field", key: "client" }], []] }] }] };
		expect([...slotProblems(l, project())]).toEqual([
			["1.0", "“ghost” isn't a field of this type"],
			["1.1.0.0", "“client” is placed more than once"],
		]);
	});
});