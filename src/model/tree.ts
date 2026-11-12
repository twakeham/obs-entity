import type { EntityInfo } from "./entity";
import type { Edge } from "./relations";
import { typeMatchesTarget, type EntityTypeDef, type GroupDef } from "./types";

export interface TreeNode<E extends EntityInfo = EntityInfo> {
	entity: E;
	children: TreeNode<E>[];
	/** number of descendants */
	size: number;
	/** shown only because a descendant matches the filter */
	context?: boolean;
}

/** How the browser arranges entities (the View menu). */
export interface BrowserOptions {
	/** "groups": one section per group; "none": a single section */
	sections: "groups" | "none";
	/** a heading per type inside each section */
	typeHeadings: boolean;
	/** with group sections, whether children nest under a parent in another group */
	crossGroup: "own" | "parent";
	/** show types (and groups) that have no entities, so they can be created from their heading */
	showEmpty: boolean;
}

export const DEFAULT_BROWSER_OPTIONS: BrowserOptions = { sections: "groups", typeHeadings: true, crossGroup: "own", showEmpty: false };

/** A run of trees inside a section: under a type heading, or all roots when type headings are off. */
export interface BrowserBlock<E extends EntityInfo = EntityInfo> {
	/** "<sectionKey>/<typeKey>", or "<sectionKey>/*" without type headings */
	key: string;
	type: EntityTypeDef | null;
	roots: TreeNode<E>[];
	count: number;
	/** notes of this type listed under other types' headings (nested under a parent of another type), not here */
	nested: number;
	/** the types whose headings those notes are under (their trees' top-level types), in type order */
	nestedUnder: EntityTypeDef[];
}

export interface BrowserSection<E extends EntityInfo = EntityInfo> {
	/** group key, or "*" for the single section */
	key: string;
	group: GroupDef | null;
	blocks: BrowserBlock<E>[];
	count: number;
}

/** Sort siblings by type order, then `order`, then name (numeric-aware: "Chapter 2" before "Chapter 10"). */
export function compareSiblings(typeOrder: string[]) {
	return (a: EntityInfo, b: EntityInfo) => {
		const ta = typeOrder.indexOf(a.type.key);
		const tb = typeOrder.indexOf(b.type.key);
		if (ta !== tb) return ta - tb;
		const oa = a.order ?? Number.POSITIVE_INFINITY;
		const ob = b.order ?? Number.POSITIVE_INFINITY;
		if (oa !== ob) return oa - ob;
		return a.name.localeCompare(b.name, undefined, { numeric: true });
	};
}

/**
 * Map each entity to its parent: the target of the first of its type's parent fields that links to another
 * entity in `entities` (and that `allow` accepts).
 */
export function parentMap<E extends EntityInfo>(entities: E[], edges: Edge[], allow: (child: E, parent: E) => boolean = () => true): Map<string, string> {
	const byPath = new Map(entities.map((e) => [e.path, e]));
	const bySource = new Map<string, Edge[]>();
	for (const e of edges) {
		if (!byPath.has(e.source)) continue;
		const list = bySource.get(e.source);
		if (list) list.push(e);
		else bySource.set(e.source, [e]);
	}
	const parent = new Map<string, string>();
	for (const entity of entities) {
		const out = bySource.get(entity.path) ?? [];
		for (const field of entity.type.parentFields ?? []) {
			const hit = out.find((e) => e.fieldKey === field && e.target && e.target !== entity.path && byPath.has(e.target) && allow(entity, byPath.get(e.target)!));
			if (hit) {
				parent.set(entity.path, hit.target!);
				break;
			}
		}
	}
	return parent;
}

/**
 * Build a forest from a parent map. Cycles are broken: nodes only reachable through a cycle become roots.
 */
export function buildForest<E extends EntityInfo>(entities: E[], parent: Map<string, string>, typeOrder: string[] = []): TreeNode<E>[] {
	const byPath = new Map(entities.map((e) => [e.path, e]));
	const children = new Map<string, E[]>();
	for (const [child, p] of parent) {
		if (!byPath.has(child) || !byPath.has(p)) continue;
		const list = children.get(p);
		if (list) list.push(byPath.get(child)!);
		else children.set(p, [byPath.get(child)!]);
	}
	const cmp = compareSiblings(typeOrder);
	const visited = new Set<string>();
	const build = (e: E): TreeNode<E> => {
		visited.add(e.path);
		const kids = (children.get(e.path) ?? []).filter((c) => !visited.has(c.path)).sort(cmp);
		const nodes = kids.map(build);
		return { entity: e, children: nodes, size: nodes.reduce((n, c) => n + 1 + c.size, 0) };
	};
	const isRoot = (e: E) => !parent.has(e.path) || !byPath.has(parent.get(e.path)!);
	const roots = entities.filter(isRoot).sort(cmp).map(build);
	// Anything unvisited is part of a cycle; promote it to a root, in its sorted place.
	for (const e of [...entities].sort(cmp)) if (!visited.has(e.path)) roots.push(build(e));
	return roots.sort((a, b) => cmp(a.entity, b.entity));
}

export function countForest(roots: TreeNode[]): number {
	return roots.reduce((n, r) => n + 1 + r.size, 0);
}

/**
 * Arrange entities into sections and blocks for the browser, following the View options.
 * Groups and types appear in the order given.
 */
export function buildBrowser<E extends EntityInfo>(entities: E[], edges: Edge[], types: EntityTypeDef[], groups: GroupDef[], opts: BrowserOptions): BrowserSection<E>[] {
	const typeOrder = types.map((t) => t.key);
	const known = new Set(groups.map((g) => g.key));
	const groupOf = (t: EntityTypeDef) => (known.has(t.group) ? t.group : "");
	const sameGroupOnly = opts.sections === "groups" && opts.crossGroup === "own";
	const parent = parentMap(entities, edges, sameGroupOnly ? (c, p) => groupOf(c.type) === groupOf(p.type) : undefined);
	const roots = buildForest(entities, parent, typeOrder);

	// Where each note is listed: under the heading of its tree's top-level type. A note whose top is of another type
	// (a session under its campaign) is "nested" for its own type's heading.
	const topType = new Map<string, EntityTypeDef>();
	const mark = (n: TreeNode<E>, top: EntityTypeDef) => {
		topType.set(n.entity.path, top);
		for (const c of n.children) mark(c, top);
	};
	for (const r of roots) mark(r, r.entity.type);
	const nestedOf = new Map<string, { count: number; under: Set<string> }>();
	for (const e of entities) {
		const top = topType.get(e.path);
		if (!top || top.key === e.type.key) continue;
		const x = nestedOf.get(e.type.key) ?? { count: 0, under: new Set<string>() };
		x.count++;
		x.under.add(top.key);
		nestedOf.set(e.type.key, x);
	}
	const nestedFor = (type: EntityTypeDef) => {
		const x = nestedOf.get(type.key);
		return { nested: x?.count ?? 0, nestedUnder: x ? types.filter((t) => x.under.has(t.key)) : [] };
	};

	const sectionDefs: { key: string; group: GroupDef | null; types: EntityTypeDef[] }[] =
		opts.sections === "groups"
			? [
					...groups.map((g) => ({ key: g.key, group: g, types: types.filter((t) => t.group === g.key) })),
					{ key: "", group: null, types: types.filter((t) => !known.has(t.group)) },
				]
			: [{ key: "*", group: null, types }];

	const sections: BrowserSection<E>[] = [];
	for (const def of sectionDefs) {
		const inSection = opts.sections === "groups" ? roots.filter((r) => groupOf(r.entity.type) === def.key) : roots;
		let blocks: BrowserBlock<E>[];
		if (opts.typeHeadings) {
			blocks = def.types.map((type) => {
				const r = inSection.filter((n) => n.entity.type.key === type.key);
				return { key: `${def.key}/${type.key}`, type, roots: r, count: countForest(r), ...nestedFor(type) };
			});
			// A type whose notes are all under other headings isn't empty: its heading stays (with where they are).
			if (!opts.showEmpty) blocks = blocks.filter((b) => b.roots.length > 0 || b.nested > 0);
		} else {
			blocks = inSection.length || opts.showEmpty ? [{ key: `${def.key}/*`, type: null, roots: inSection, count: countForest(inSection), nested: 0, nestedUnder: [] }] : [];
		}
		const count = blocks.reduce((n, b) => n + b.count, 0);
		const keep = count > 0 || blocks.some((b) => b.nested > 0) || (opts.showEmpty && def.group !== null) || (opts.showEmpty && opts.sections === "none");
		if (keep) sections.push({ key: def.key, group: def.group, blocks, count });
	}
	return sections;
}

/**
 * Keep nodes that match, plus the ancestors of matching nodes (marked `context`) so the hierarchy stays visible.
 */
export function filterForest<E extends EntityInfo>(roots: TreeNode<E>[], match: (e: E) => boolean): TreeNode<E>[] {
	const out: TreeNode<E>[] = [];
	for (const node of roots) {
		const kids = filterForest(node.children, match);
		const hit = match(node.entity);
		if (hit || kids.length > 0) {
			out.push({ entity: node.entity, children: kids, size: kids.reduce((n, c) => n + 1 + c.size, 0), ...(hit ? {} : { context: true }) });
		}
	}
	return out;
}

/** Filter every block of every section, dropping empty blocks and sections. */
export function filterBrowser<E extends EntityInfo>(sections: BrowserSection<E>[], match: (e: E) => boolean): BrowserSection<E>[] {
	return sections
		.map((s) => {
			const blocks = s.blocks
				.map((b) => {
					const roots = filterForest(b.roots, match);
					return { ...b, roots, count: countMatches(roots) };
				})
				.filter((b) => b.roots.length > 0);
			return { ...s, blocks, count: blocks.reduce((n, b) => n + b.count, 0) };
		})
		.filter((s) => s.blocks.length > 0);
}

/** Matching (non-context) nodes in a filtered forest. */
export function countMatches(roots: TreeNode[]): number {
	return roots.reduce((n, r) => n + (r.context ? 0 : 1) + countMatches(r.children), 0);
}

/** Paths of the ancestors of `path` in a forest (root first), or null if not found. */
export function ancestorsOf(roots: TreeNode[], path: string): string[] | null {
	for (const node of roots) {
		if (node.entity.path === path) return [];
		const sub = ancestorsOf(node.children, path);
		if (sub) return [node.entity.path, ...sub];
	}
	return null;
}

/** Where a note sits in the browser: its section, block and ancestors. */
export function locate(sections: BrowserSection[], path: string): { section: string; block: string; ancestors: string[] } | null {
	for (const s of sections) {
		for (const b of s.blocks) {
			const anc = ancestorsOf(b.roots, path);
			if (anc) return { section: s.key, block: b.key, ancestors: anc };
		}
	}
	return null;
}

/** Paths of every node that has children (for "Expand all"). */
export function branchPaths(sections: BrowserSection[]): string[] {
	const out: string[] = [];
	const walk = (nodes: TreeNode[]) => {
		for (const n of nodes) {
			if (n.children.length) {
				out.push(n.entity.path);
				walk(n.children);
			}
		}
	};
	for (const s of sections) for (const b of s.blocks) walk(b.roots);
	return out;
}

export interface ChildOption {
	type: EntityTypeDef;
	/** the child type's parent field that will point at the parent */
	field: string;
}

/**
 * Types that can be created as children of an entity of `parent`: types with a parent field whose
 * targets accept `parent` (e.g. Note → Project via "project", Project → Project via "parent_project").
 */
export function childOptions(parent: EntityTypeDef, types: EntityTypeDef[]): ChildOption[] {
	const out: ChildOption[] = [];
	for (const t of types) {
		for (const key of t.parentFields ?? []) {
			const f = t.fields.find((x) => x.key === key && x.kind === "relation");
			if (f && typeMatchesTarget(parent, f.targets)) {
				out.push({ type: t, field: key });
				break;
			}
		}
	}
	return out;
}
