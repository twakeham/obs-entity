import { describe, expect, it } from "vitest";
import { layoutFields, layoutFromFields, layoutIssues, normaliseLayout, placeableKeys, renameLayoutKey, resolveLayout, type FormLayout } from "../src/model/formLayout";
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
