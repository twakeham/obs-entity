/**
 * Copying layout items (a node with everything inside it, or a tab) to the clipboard and pasting them into a type's
 * layout, possibly another type's or another vault's. A copy carries the definitions of the fields it places, so
 * fields the target type doesn't have can be added. Also the saved "My components".
 */
import { canHold, childPath, isNoteItem, isWorkflowItem, LAYOUT_BUILTINS, listItems, nodeAt, nodeKeys, normaliseLayout, parentList, pathOfNode, placeableKeys, renameLayoutKey, fieldSlots, type FormLayout, type LayoutList, type LayoutNode, type LayoutPath, type LayoutTab } from "./formLayout";
import { FIELD_KINDS, isValidKey, type EntityTypeDef, type FieldDef } from "./types";

/** A copied item: one node or one tab, and the fields it places. */
export interface LayoutClip {
	node?: LayoutNode;
	tab?: LayoutTab;
	fields: FieldDef[];
}

/** A saved component in the palette's "My components" (plugin settings, shared by every type). */
export interface SavedComponent {
	id: string;
	name: string;
	icon: string;
	clip: LayoutClip;
}

/** Marks clipboard text as a copied layout item. */
export const CLIP_MARK = "obsEntitiesLayout";

/** A new saved component's id. */
export const newComponentId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** The nodes a clip pastes as: its node, or a tab group holding its tab. */
export const clipNodes = (clip: LayoutClip): LayoutNode[] => (clip.node ? [clip.node] : clip.tab ? [{ kind: "tabs", tabs: [clip.tab] }] : []);

const fieldsFor = (nodes: LayoutNode[], type: EntityTypeDef): FieldDef[] => {
	const keys = new Set(nodeKeys(nodes));
	return type.fields.filter((f) => keys.has(f.key)).map(clone);
};

/** A copy of a node with the definitions of the fields in it. */
export const clipOfNode = (node: LayoutNode, type: EntityTypeDef): LayoutClip => ({ node: clone(node), fields: fieldsFor([node], type) });

/** A copy of a tab with the definitions of the fields in it. */
export const clipOfTab = (tab: LayoutTab, type: EntityTypeDef): LayoutClip => ({ tab: clone(tab), fields: fieldsFor(tab.items, type) });

/** Clipboard text for a clip. */
export const clipText = (clip: LayoutClip): string => JSON.stringify({ [CLIP_MARK]: 1, ...clip }, null, 2);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** A field definition from a clip, or null when it isn't usable. */
function readField(x: unknown): FieldDef | null {
	if (!isObj(x) || typeof x.key !== "string" || !isValidKey(x.key) || typeof x.kind !== "string" || !FIELD_KINDS.includes(x.kind as FieldDef["kind"])) return null;
	const f = clone(x) as unknown as FieldDef;
	if (typeof f.label !== "string") f.label = f.key;
	return f;
}

/** A clip from saved data (tidied the way layouts are), or null. */
export function readClipObject(raw: unknown): LayoutClip | null {
	if (!isObj(raw)) return null;
	const fields = Array.isArray(raw.fields) ? raw.fields.map(readField).filter((f): f is FieldDef => !!f) : [];
	if (raw.node !== undefined) {
		const node = normaliseLayout({ items: [raw.node] })?.items[0];
		return node ? { node, fields } : null;
	}
	if (raw.tab !== undefined) {
		const group = normaliseLayout({ items: [{ kind: "tabs", tabs: [raw.tab] }] })?.items[0];
		const tab = group?.kind === "tabs" ? group.tabs[0] : undefined;
		return tab ? { tab, fields } : null;
	}
	return null;
}

/** A clip from clipboard text, or null when the text isn't a copied layout item. */
export function readClip(text: string): LayoutClip | null {
	const t = text.trim();
	if (!t.startsWith("{") || !t.includes(CLIP_MARK)) return null;
	try {
		const raw = JSON.parse(t);
		return isObj(raw) && raw[CLIP_MARK] ? readClipObject(raw) : null;
	} catch {
		return null;
	}
}

/** How a clip's fields fit a type and its layout. */
export interface PastePlan {
	/** a clip key → this type's key (matched by key, then by label ignoring case) */
	map: Record<string, string>;
	/** fields the type doesn't have (they're left out unless added) */
	missing: FieldDef[];
	/** this type's keys the clip places that the layout already places */
	placed: string[];
	/** keys this type can't place at all (e.g. Order without parent fields): always left out */
	unusable: string[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function planPaste(clip: LayoutClip, type: EntityTypeDef, layout: FormLayout): PastePlan {
	const placeable = new Set(placeableKeys(type));
	const onCanvas = new Set(fieldSlots(layout).map((s) => s.field.key));
	const plan: PastePlan = { map: {}, missing: [], placed: [], unusable: [] };
	for (const key of [...new Set(nodeKeys(clipNodes(clip)))]) {
		if (isNoteItem(key) || (LAYOUT_BUILTINS as readonly string[]).includes(key)) {
			if (placeable.has(key)) plan.map[key] = key;
			else plan.unusable.push(key);
		} else if (isWorkflowItem(key)) {
			// A workflow's button: kept as it is (the Layout tab flags it when that workflow isn't a button for this type).
			plan.map[key] = key;
		} else {
			const def = clip.fields.find((f) => f.key === key);
			const target = type.fields.find((f) => f.key === key) ?? (def?.label ? type.fields.find((f) => norm(f.label) === norm(def.label)) : undefined);
			if (target) plan.map[key] = target.key;
			else plan.missing.push(def ?? { key, label: key, kind: "text" });
		}
		const to = plan.map[key];
		if (to && onCanvas.has(to)) plan.placed.push(to);
	}
	return plan;
}

/**
 * The clip's contents ready to place: keys renamed to this type's, and slots left out for fields that aren't added
 * (`add` false), already placed fields that aren't moved (`move` false), and keys the type can't place. Conditions
 * follow renamed fields.
 */
export function preparePaste(clip: LayoutClip, plan: PastePlan, opts: { add: boolean; move: boolean }): LayoutClip {
	let l: FormLayout = { items: clone(clipNodes(clip)) };
	const pairs = Object.entries(plan.map).filter(([from, to]) => from !== to);
	// Through placeholders, so swaps (a → b, b → a) don't collide.
	pairs.forEach(([from], i) => (l = renameLayoutKey(l, from, `zz_paste_${i}`)));
	pairs.forEach(([, to], i) => (l = renameLayoutKey(l, `zz_paste_${i}`, to)));
	const drop = [...plan.unusable, ...(opts.add ? [] : plan.missing.map((f) => f.key)), ...(opts.move ? [] : plan.placed)];
	for (const k of drop) l = renameLayoutKey(l, k, null);
	const node = l.items[0];
	return clip.tab && node?.kind === "tabs" ? { tab: node.tabs[0], fields: clip.fields } : { node, fields: clip.fields };
}

/** Remove the slots for some keys, except inside `keep` (on the layout itself, which must be a copy). */
function dropSlots(layout: FormLayout, keys: string[], keep: () => LayoutPath | null): void {
	for (const key of keys) {
		for (;;) {
			const k = keep();
			const slot = fieldSlots(layout).find((s) => s.field.key === key && !(k && s.path.length >= k.length && k.every((v, i) => s.path[i] === v)));
			if (!slot) break;
			const { list, index } = parentList(layout, slot.path);
			listItems(layout, list).splice(index, 1);
		}
	}
}

/**
 * Put a prepared node into a list, taking the slots for `moveKeys` out of where they were. Returns the layout and the
 * new node's path, or null when the list can't hold it.
 */
export function placeNode(layout: FormLayout, list: LayoutList, index: number, node: LayoutNode, moveKeys: string[]): { layout: FormLayout; path: LayoutPath } | null {
	if (!canHold(layout, list, node)) return null;
	const next = clone(layout);
	const items = listItems(next, list);
	const at = Math.max(0, Math.min(index, items.length));
	items.splice(at, 0, clone(node));
	const placed = nodeAt(next, childPath(list, at))!;
	dropSlots(next, moveKeys, () => pathOfNode(next, placed));
	return { layout: next, path: pathOfNode(next, placed)! };
}

/** Put a prepared tab into a tab group at `index`, taking the slots for `moveKeys` out of where they were. */
export function placeTab(layout: FormLayout, group: LayoutPath, index: number, tab: LayoutTab, moveKeys: string[]): { layout: FormLayout; group: LayoutPath; tab: number } | null {
	const next = clone(layout);
	const g = nodeAt(next, group);
	if (g?.kind !== "tabs") return null;
	const copy = clone(tab);
	g.tabs.splice(Math.max(0, Math.min(index, g.tabs.length)), 0, copy);
	const groupPath = () => pathOfNode(next, g);
	dropSlots(next, moveKeys, () => {
		const gp = groupPath();
		return gp ? [...gp, g.tabs.indexOf(copy)] : null;
	});
	return { layout: next, group: groupPath()!, tab: g.tabs.indexOf(copy) };
}

/** A short description: "Frame “Contact”", "2 columns", "Tab “Notes”", "Field Budget"… plus the fields it places. */
export function clipSummary(clip: LayoutClip, labelOf: (key: string) => string = (k) => clip.fields.find((f) => f.key === k)?.label || k.replace(/^@/, "").replace(/^./, (c) => c.toUpperCase())): string {
	const n = clip.node;
	const what = clip.tab
		? `Tab “${clip.tab.caption}”`
		: !n
			? "Nothing"
			: n.kind === "frame"
				? n.caption
					? `Frame “${n.caption}”`
					: "Frame"
				: n.kind === "columns"
					? `${n.columns.length} columns`
					: n.kind === "tabs"
						? `Tabs (${n.tabs.map((t) => t.caption).join(", ")})`
						: n.kind === "field"
							? `Field ${labelOf(n.key)}`
							: n.kind === "heading"
								? `Heading “${n.text}”`
								: "Text";
	const keys = [...new Set(nodeKeys(clipNodes(clip)))];
	if (n?.kind === "field" || !keys.length) return what;
	const names = keys.map(labelOf);
	return `${what} · ${keys.length} field${keys.length === 1 ? "" : "s"}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}`;
}

/** Saved components from settings: usable ones kept, tidied. */
export function readComponents(raw: unknown): SavedComponent[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((c): SavedComponent[] => {
		if (!isObj(c) || typeof c.id !== "string" || typeof c.name !== "string") return [];
		const clip = readClipObject(c.clip);
		return clip ? [{ id: c.id, name: c.name, icon: typeof c.icon === "string" && c.icon ? c.icon : "package", clip }] : [];
	});
}
