import { asArray, parseLabelledEntry, parseLink, toLabelledWikilink, toWikilink } from "./links";
import { COMMON_KEYS, type EntityTypeDef, type FieldDef } from "./types";

/** One relationship link written in a source note's frontmatter. */
export interface Edge {
	source: string;
	/** resolved target path, or null if the link points at a note that doesn't exist */
	target: string | null;
	/** link text as written (without brackets) */
	linktext: string;
	sourceType: string;
	fieldKey: string;
	fieldLabel: string;
	inverse?: string;
	symmetric: boolean;
	labelled: boolean;
	/** per-link label for labelled relations (e.g. "mentor") */
	label?: string;
	/** generic `related:` link */
	related: boolean;
	/** allowed target types of the field (used to create unresolved targets) */
	targets?: string[];
}

export type Direction = "out" | "in" | "both";

export interface RelationItem {
	/** the other end of the relationship */
	path: string | null;
	linktext: string;
	direction: Direction;
	edge: Edge;
}

export interface RelationGroup {
	key: string;
	title: string;
	direction: Direction;
	items: RelationItem[];
	/** the relation field, when this note has outgoing links in the group */
	fieldKey?: string;
}

/**
 * Extract the relationship edges declared in one entity's frontmatter.
 * `resolve` maps a link path to a vault path (or null when unresolved).
 */
export function extractEdges(source: string, type: EntityTypeDef, fm: Record<string, unknown>, resolve: (linkpath: string) => string | null): Edge[] {
	const edges: Edge[] = [];
	const push = (field: FieldDef | null, raw: unknown) => {
		const parsed = field?.labelled
			? parseLabelledEntry(raw)
			: (() => {
					const link = parseLink(raw);
					return link ? { link, label: undefined as string | undefined } : null;
				})();
		if (!parsed) return;
		const target = resolve(parsed.link.path);
		if (target === source) return;
		edges.push({
			source,
			target,
			linktext: parsed.link.path,
			sourceType: type.key,
			fieldKey: field?.key ?? COMMON_KEYS.related,
			fieldLabel: field?.label ?? "Related",
			inverse: field?.inverse,
			symmetric: field ? !!field.symmetric : true,
			labelled: !!field?.labelled,
			label: parsed.label,
			related: !field,
			targets: field?.targets,
		});
	};
	for (const field of type.fields) {
		if (field.kind !== "relation") continue;
		for (const raw of asArray(fm[field.key])) push(field, raw);
	}
	for (const raw of asArray(fm[COMMON_KEYS.related])) push(null, raw);
	return edges;
}

function capitalise(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface GroupOptions {
	/** relation field keys of this note's type, in order: outgoing groups follow it */
	fieldOrder?: string[];
	/** display name for a type key, for incoming links without an inverse label */
	typeName?: (key: string) => string;
}

/**
 * Group the relationships of one note for display.
 *  - outgoing field links are grouped by field label ("Works for")
 *  - incoming links are grouped by the field's inverse label ("People"), merged across types;
 *    without an inverse: "<Field label> (from <Type name>)"
 *  - symmetric fields and `related` merge both directions into one group
 *  - labelled links are grouped by label: outgoing "Mentor", incoming "Mentor of"
 * Order: outgoing groups in field order, then incoming, then Related.
 */
export function groupRelations(path: string, outgoing: Edge[], incoming: Edge[], opts: GroupOptions = {}): RelationGroup[] {
	const fieldOrder = opts.fieldOrder ?? [];
	const typeName = opts.typeName ?? ((k: string) => k);
	const groups = new Map<string, RelationGroup>();
	const seen = new Map<string, Set<string>>();
	const add = (key: string, title: string, direction: Direction, item: RelationItem, fieldKey?: string) => {
		let g = groups.get(key);
		if (!g) {
			g = { key, title, direction, items: [] };
			groups.set(key, g);
			seen.set(key, new Set());
		}
		if (fieldKey && !g.fieldKey) g.fieldKey = fieldKey;
		const id = item.path ?? `?${item.linktext.toLowerCase()}`;
		if (seen.get(key)!.has(id)) return;
		seen.get(key)!.add(id);
		g.items.push(item);
	};

	for (const e of outgoing) {
		const item: RelationItem = { path: e.target, linktext: e.linktext, direction: "out", edge: e };
		if (e.related) add("sym:related", "Related", "both", item, COMMON_KEYS.related);
		else if (e.labelled && e.label) add(`lab:${e.label.toLowerCase()}`, capitalise(e.label), "out", item, e.fieldKey);
		else if (e.symmetric) add(`sym:${(e.inverse || e.fieldLabel).toLowerCase()}`, e.inverse || e.fieldLabel, "both", item, e.fieldKey);
		else add(`out:${e.fieldKey}`, e.fieldLabel, "out", item, e.fieldKey);
	}
	for (const e of incoming) {
		if (e.source === path) continue;
		const item: RelationItem = { path: e.source, linktext: e.source, direction: "in", edge: e };
		if (e.related) add("sym:related", "Related", "both", item);
		else if (e.labelled && e.label) add(`labin:${e.label.toLowerCase()}`, `${capitalise(e.label)} of`, "in", item);
		else if (e.symmetric) add(`sym:${(e.inverse || e.fieldLabel).toLowerCase()}`, e.inverse || e.fieldLabel, "both", item);
		else {
			const title = e.inverse || `${e.fieldLabel} (from ${typeName(e.sourceType)})`;
			add(`in:${title.toLowerCase()}`, title, "in", item);
		}
	}

	const rank = (g: RelationGroup): number => {
		if (g.key === "sym:related") return 3000;
		const i = g.fieldKey ? fieldOrder.indexOf(g.fieldKey) : -1;
		if (i >= 0) return i;
		return g.direction === "in" || !g.fieldKey ? 2000 : 1000;
	};
	return Array.from(groups.values()).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** Does a frontmatter entry (string or labelled object) point at `matches`? */
function entryMatches(entry: unknown, matches: (linkpath: string) => boolean): boolean {
	const parsed = parseLabelledEntry(entry);
	return !!parsed && matches(parsed.link.path);
}

/**
 * Remove links matching `matches` from a frontmatter value.
 * Returns the new value (null for an emptied single value, [] for an emptied list).
 */
export function removeLink(value: unknown, matches: (linkpath: string) => boolean): unknown {
	if (Array.isArray(value)) return value.filter((v) => !entryMatches(v, matches));
	return entryMatches(value, matches) ? null : value;
}

/**
 * Add a link to a frontmatter value. Multiple fields get the link appended (no duplicates);
 * single fields are replaced. Labelled fields store "[[Target|label]]".
 */
export function addLink(value: unknown, linktext: string, opts: { multiple: boolean; labelled?: boolean; label?: string }): unknown {
	const entry = opts.labelled ? toLabelledWikilink(linktext, opts.label) : toWikilink(linktext);
	if (!opts.multiple) return entry;
	const list = asArray(value);
	const same = (p: string) => p.toLowerCase() === linktext.toLowerCase();
	if (!opts.labelled && list.some((v) => entryMatches(v, same))) return list;
	if (opts.labelled && list.some((v) => entryMatches(v, same) && (parseLabelledEntry(v)?.label ?? "") === (opts.label?.trim() ?? ""))) return list;
	return [...list, entry];
}
