import { describe, expect, it } from "vitest";
import { fieldSlots, nodeAt, type FormLayout, type LayoutNode } from "../src/model/formLayout";
import { clipOfNode, clipOfTab, clipSummary, clipText, placeNode, placeTab, planPaste, preparePaste, readClip, readComponents } from "../src/model/layoutClipboard";
import { mergeSettings } from "../src/model/settings";
import type { EntityTypeDef, FieldDef } from "../src/model/types";

const fld = (key: string, label: string, kind: FieldDef["kind"] = "text", extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const type = (key: string, fields: FieldDef[], extra: Partial<EntityTypeDef> = {}): EntityTypeDef => ({ key, name: key, plural: key, icon: "x", color: "", group: "g", fields, ...extra }) as EntityTypeDef;

const person = type("person", [fld("email", "Email", "url", { format: "domain" }), fld("phone", "Phone"), fld("role", "Role")]);
const contact: LayoutNode = {
	kind: "frame",
	caption: "Contact",
	style: "filled",
	items: [
		{ kind: "columns", columns: [[{ kind: "field", key: "email", label: "beside" }], [{ kind: "field", key: "phone" }]] },
		{ kind: "field", key: "status" },
		{ kind: "field", key: "role", when: { all: [{ field: "email", op: "not-empty" }] } },
	],
} as LayoutNode;

describe("layout clipboard", () => {
	it("copies a node with the fields it places, and reads it back from text", () => {
		const clip = clipOfNode(contact, person);
		expect(clip.fields.map((f) => f.key)).toEqual(["email", "phone", "role"]);
		expect(clip.fields[0].format).toBe("domain");
		const back = readClip(clipText(clip));
		expect(back?.node).toEqual(contact);
		expect(back?.fields).toHaveLength(3);
		expect(readClip("just some text")).toBeNull();
		expect(readClip('{"other": 1}')).toBeNull();
		expect(readClip('{"obsEntitiesLayout": 1, "node": {"kind": "nonsense"}}')).toBeNull();
		expect(clipSummary(clip)).toBe("Frame “Contact” · 4 fields: Email, Phone, Status, Role");
	});

	it("matches fields by key, then label; lists missing and already-placed ones", () => {
		const client = type("client", [fld("mail", "email", "url"), fld("phone", "Phone number")]);
		const layout: FormLayout = { items: [{ kind: "field", key: "phone" }] };
		const plan = planPaste(clipOfNode(contact, person), client, layout);
		expect(plan.map).toEqual({ email: "mail", phone: "phone", status: "status" });
		expect(plan.missing.map((f) => f.key)).toEqual(["role"]);
		expect(plan.placed).toEqual(["phone"]);
	});

	it("prepares a paste: renames keys (and conditions), leaves out missing / placed fields unless asked", () => {
		const client = type("client", [fld("mail", "Email", "url"), fld("phone", "Phone")]);
		const layout: FormLayout = { items: [{ kind: "field", key: "phone" }] };
		const clip = clipOfNode(contact, person);
		const plan = planPaste(clip, client, layout);
		const keys = (n: LayoutNode | undefined) => fieldSlots({ items: n ? [n] : [] }).map((s) => s.field.key);
		const plain = preparePaste(clip, plan, { add: false, move: false });
		expect(keys(plain.node)).toEqual(["mail", "status"]);
		// The structure stays: both columns, the frame's style.
		expect(plain.node?.kind === "frame" && plain.node.style).toBe("filled");
		const all = preparePaste(clip, plan, { add: true, move: true });
		expect(keys(all.node)).toEqual(["mail", "phone", "status", "role"]);
		const role = all.node?.kind === "frame" ? all.node.items[2] : null;
		expect(role?.kind === "field" && role.when).toEqual({ all: [{ field: "mail", op: "not-empty" }] });
	});

	it("swaps keys without collisions", () => {
		const a = type("a", [fld("x", "First"), fld("y", "Second")]);
		const b = type("b", [fld("y", "First"), fld("x", "Second")]);
		const node: LayoutNode = { kind: "frame", items: [{ kind: "field", key: "x" }, { kind: "field", key: "y" }] } as LayoutNode;
		// Key match wins over label match: x → x, y → y.
		const same = preparePaste(clipOfNode(node, a), planPaste(clipOfNode(node, a), b, { items: [] }), { add: false, move: false });
		expect(fieldSlots({ items: [same.node!] }).map((s) => s.field.key)).toEqual(["x", "y"]);
		const c = type("c", [fld("p", "First"), fld("q", "Second")]);
		const clip = { node, fields: [fld("x", "Second"), fld("y", "First")] };
		const swapped = preparePaste(clip, planPaste(clip, c, { items: [] }), { add: false, move: false });
		expect(fieldSlots({ items: [swapped.node!] }).map((s) => s.field.key)).toEqual(["q", "p"]);
	});

	it("places a node, moving already-placed slots out of their old spot", () => {
		const layout: FormLayout = { items: [{ kind: "field", key: "phone" }, { kind: "frame", caption: "Old", items: [{ kind: "field", key: "email" }] }] } as FormLayout;
		const node = { kind: "frame", caption: "New", items: [{ kind: "field", key: "email", label: "hidden" }] } as LayoutNode;
		const r = placeNode(layout, { at: [] }, 1, node, ["email"])!;
		expect(r.path).toEqual([1]);
		expect(nodeAt(r.layout, [1])).toMatchObject({ caption: "New" });
		const slots = fieldSlots(r.layout);
		expect(slots.map((s) => s.field.key)).toEqual(["phone", "email"]);
		expect(slots[1].field.label).toBe("hidden");
		// The old frame stays (empty).
		expect(nodeAt(r.layout, [2])).toMatchObject({ caption: "Old", items: [] });
		// Moving a slot from before the new node shifts its path.
		const r2 = placeNode(layout, { at: [] }, 2, { kind: "field", key: "phone" } as LayoutNode, ["phone"])!;
		expect(r2.path).toEqual([1]);
		expect(fieldSlots(r2.layout).map((s) => s.field.key)).toEqual(["email", "phone"]);
		// A frame can't go in a frame.
		expect(placeNode(layout, { at: [1] }, 0, node, [])).toBeNull();
	});

	it("copies and places a tab", () => {
		const layout: FormLayout = { items: [{ kind: "tabs", tabs: [{ caption: "Main", items: [{ kind: "field", key: "phone" }] }, { caption: "More", items: [] }] }] } as FormLayout;
		const tab = (layout.items[0] as Extract<LayoutNode, { kind: "tabs" }>).tabs[0];
		const clip = clipOfTab(tab, person);
		expect(clipSummary(clip)).toBe("Tab “Main” · 1 field: Phone");
		const back = readClip(clipText(clip))!;
		const r = placeTab(layout, [0], 2, { ...back.tab!, caption: "Copy" }, ["phone"])!;
		expect(r.tab).toBe(2);
		const g = r.layout.items[0] as Extract<LayoutNode, { kind: "tabs" }>;
		expect(g.tabs.map((t) => t.caption)).toEqual(["Main", "More", "Copy"]);
		expect(g.tabs[0].items).toEqual([]);
		expect(g.tabs[2].items).toEqual([{ kind: "field", key: "phone" }]);
	});

	it("leaves out keys the type can't place (Order without parent fields)", () => {
		const clip = { node: { kind: "field", key: "order" } as LayoutNode, fields: [] };
		const plan = planPaste(clip, type("t", []), { items: [] });
		expect(plan.unusable).toEqual(["order"]);
		expect(preparePaste(clip, plan, { add: true, move: true }).node).toBeUndefined();
	});

	it("keeps saved components in settings, dropping unusable ones", () => {
		const clip = clipOfNode(contact, person);
		const saved = mergeSettings({ layoutComponents: [{ id: "c1", name: "Contact", icon: "phone", clip }, { id: "c2", name: "Broken", clip: { node: { kind: "?" } } }, "junk"] } as never);
		expect(saved.layoutComponents.map((c) => c.name)).toEqual(["Contact"]);
		expect(saved.layoutComponents[0].clip.node).toEqual(contact);
		expect(mergeSettings(null).layoutComponents).toEqual([]);
		expect(readComponents([{ id: "x", name: "No icon", clip }])[0].icon).toBe("package");
	});
});
