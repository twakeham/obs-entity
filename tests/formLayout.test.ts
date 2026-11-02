import { describe, expect, it } from "vitest";
import {
	allLists,
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
	nodeAt,
	normaliseLayout,
	parseListKey,
	placeableKeys,
	removeNode,
	renameLayoutKey,
	resolveLayout,
	setColumnCount,
	slotProblems,
	ungroupFrame,
	updateNode,
	type FormLayout,
	type LayoutList,
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
		expect(placeableKeys(project())).toEqual(["description", "owner", "team", "client", "start", "due", "parent_project", "status", "related", "tags", "aliases", "order"]);
		// no parent fields: no order
		expect(placeableKeys(person())).not.toContain("order");
	});

	it("resolve against the type: unknown and repeated slots dropped, unplaced fields and built-ins listed", () => {
		const r = resolveLayout({ items: [...LAYOUT.items, { kind: "field", key: "gone" }, { kind: "field", key: "owner" }] }, project());
		expect(layoutFields({ items: r.items }).map((f) => f.key)).toEqual(["client", "status", "owner", "description", "start", "due", "team"]);
		expect(r.unplaced).toEqual(["parent_project"]);
		expect(r.unplacedBuiltins).toEqual(["related", "tags", "aliases", "order"]);
		expect(r.placesStatus).toBe(true);
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

describe("layout designer edits", () => {
	const root: LayoutList = { kind: "root" };
	const keys = (l: FormLayout) => layoutFields(l).map((f) => f.key);

	it("finds nodes by path", () => {
		expect(nodeAt(LAYOUT, [0])).toMatchObject({ kind: "frame", caption: "Overview" });
		expect(nodeAt(LAYOUT, [0, 1])).toEqual({ kind: "field", key: "description" });
		expect(nodeAt(LAYOUT, [0, 0, 1, 0])).toEqual({ kind: "field", key: "owner" });
		expect(nodeAt(LAYOUT, [2])).toEqual({ kind: "heading", text: "More" });
		expect(nodeAt(LAYOUT, [9])).toBeNull();
		expect(nodeAt(LAYOUT, [0, 0, 5, 0])).toBeNull();
		const top: FormLayout = { items: [{ kind: "columns", columns: [[{ kind: "field", key: "a" }], []] }] };
		expect(nodeAt(top, [0, 0, 0])).toEqual({ kind: "field", key: "a" });
		expect(fieldSlots(LAYOUT).map((s) => s.path.join("."))).toEqual(["0.0.0.0", "0.0.0.1", "0.0.1.0", "0.1", "1.0.0.0", "1.0.1.0", "3.0"]);
	});

	it("lists, keys and what they can hold", () => {
		expect(allLists(LAYOUT).map(listKey)).toEqual(["root", "frame:0", "column:0.0:0", "column:0.0:1", "frame:1", "column:1.0:0", "column:1.0:1", "frame:3"]);
		for (const l of allLists(LAYOUT)) expect(parseListKey(listKey(l))).toEqual(l);
		expect(parseListKey("nope")).toBeNull();
		const col: LayoutList = { kind: "column", at: [0, 0], col: 1 };
		expect(canHold(root, blankNode("frame"))).toBe(true);
		expect(canHold({ kind: "frame", frame: 0 }, blankNode("frame"))).toBe(false);
		expect(canHold({ kind: "frame", frame: 0 }, blankNode("columns3"))).toBe(true);
		expect(canHold(col, blankNode("columns2"))).toBe(false);
		expect(canHold(col, blankNode("heading"))).toBe(false);
		expect(canHold(col, { kind: "field", key: "x" })).toBe(true);
	});

	it("new components", () => {
		expect(blankNode("columns3")).toEqual({ kind: "columns", columns: [[], [], []] });
		expect(blankNode("frame")).toEqual({ kind: "frame", caption: "New frame", items: [] });
		expect(blankNode("text")).toMatchObject({ kind: "text" });
	});

	it("inserts and removes", () => {
		const a = insertNode(LAYOUT, { kind: "column", at: [0, 0], col: 1 }, 0, { kind: "field", key: "priority" })!;
		expect(nodeAt(a, [0, 0, 1, 0])).toEqual({ kind: "field", key: "priority" });
		expect(nodeAt(LAYOUT, [0, 0, 1, 0])).toEqual({ kind: "field", key: "owner" });
		expect(insertNode(LAYOUT, { kind: "frame", frame: 0 }, 0, blankNode("frame"))).toBeNull();
		expect(insertNode(LAYOUT, { kind: "frame", frame: 2 }, 0, { kind: "field", key: "x" })).toBeNull();
		expect(insertNode(LAYOUT, root, 99, blankNode("heading"))!.items.slice(-1)[0]).toEqual({ kind: "heading", text: "Heading" });
		const b = removeNode(LAYOUT, [0]);
		expect(keys(b)).toEqual(["start", "due", "team"]);
		expect(keys(removeNode(LAYOUT, [0, 0, 0, 1]))).toEqual(["client", "owner", "description", "start", "due", "team"]);
	});

	it("moves between lists, keeping drop positions as shown", () => {
		// description (frame 0, row 1) to the top level, before the heading
		const m = moveNode(LAYOUT, [0, 1], root, 2)!;
		expect(m.path).toEqual([2]);
		expect(nodeAt(m.layout, [2])).toEqual({ kind: "field", key: "description" });
		expect(nodeAt(m.layout, [3])).toMatchObject({ kind: "heading" });
		// a top-level node into a later frame: the frame's index shifts once the node leaves
		const n = moveNode(LAYOUT, [2], { kind: "frame", frame: 3 }, 0)!;
		expect(n.path).toEqual([2, 0]);
		expect(nodeAt(n.layout, [2])).toMatchObject({ kind: "frame", caption: "Team", items: [{ kind: "heading" }, { kind: "field", key: "team" }] });
		// a field between columns of different frames
		const c = moveNode(LAYOUT, [0, 0, 0, 0], { kind: "column", at: [1, 0], col: 1 }, 1)!;
		expect(c.path).toEqual([1, 0, 1, 1]);
		expect(keys(c.layout)).toEqual(["status", "owner", "description", "start", "due", "client", "team"]);
		// down within the same list: lands where the drop line was
		const d = moveNode(LAYOUT, [0], root, 2)!;
		expect(d.layout.items.map((i) => (i.kind === "frame" ? i.caption : i.kind))).toEqual(["Schedule", "Overview", "heading", "Team"]);
		expect(d.path).toEqual([1]);
		// not allowed
		expect(moveNode(LAYOUT, [1], { kind: "frame", frame: 0 }, 0)).toBeNull();
		expect(moveNode(LAYOUT, [0, 0], { kind: "column", at: [1, 0], col: 0 }, 0)).toBeNull();
		expect(moveNode(LAYOUT, [7], root, 0)).toBeNull();
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
		const g = ungroupFrame(LAYOUT, 0);
		expect(g.items.map((i) => i.kind)).toEqual(["columns", "field", "frame", "heading", "frame"]);
		expect(ungroupFrame(LAYOUT, 2)).toBe(LAYOUT);
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
		expect(insertionPoint(LAYOUT, [1], f)).toEqual({ list: { kind: "frame", frame: 1 }, index: 1 });
		expect(insertionPoint(LAYOUT, [1], blankNode("frame"))).toEqual({ list: root, index: 2 });
		expect(insertionPoint(LAYOUT, [0, 1], blankNode("frame"))).toEqual({ list: root, index: 1 });
		expect(insertionPoint(LAYOUT, [0, 0], f)).toEqual({ list: { kind: "column", at: [0, 0], col: 1 }, index: 1 });
		expect(insertionPoint(LAYOUT, [0, 0], blankNode("heading"))).toEqual({ list: { kind: "frame", frame: 0 }, index: 1 });
		expect(insertionPoint(LAYOUT, [0, 0, 0, 1], f)).toEqual({ list: { kind: "column", at: [0, 0], col: 0 }, index: 2 });
		expect(insertionPoint(LAYOUT, [0, 0, 0, 1], blankNode("text"))).toEqual({ list: { kind: "frame", frame: 0 }, index: 1 });
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
