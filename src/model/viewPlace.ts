import type { BrowserSection } from "./tree";
import type { EntityTypeDef, GroupDef } from "./types";

/** Where the Entity Browser lists a view note: the Views section (at the bottom), a group's section, or under a type's heading. */
export type ViewSpot = { kind: "views" } | { kind: "group"; key: string } | { kind: "type"; key: string };

/** The `place:` value for the Views section. */
export const PLACE_VIEWS = "views";

/**
 * Where a view belongs on its own showing, from its types: one type → under that type's heading; types (or
 * "@group"s) all in one group → that group's section; anything else (several groups, or every type) → Views.
 */
export function autoViewSpot(viewTypes: string[], types: EntityTypeDef[], groups: GroupDef[]): ViewSpot {
	const list = viewTypes.length ? viewTypes : ["*"];
	if (list.includes("*")) return { kind: "views" };
	if (list.length === 1 && types.some((t) => t.key === list[0])) return { kind: "type", key: list[0] };
	const inGroups = new Set<string>();
	for (const x of list) {
		if (x.startsWith("@")) inGroups.add(x.slice(1));
		else {
			const t = types.find((y) => y.key === x);
			if (t) inGroups.add(t.group);
		}
	}
	if (inGroups.size === 1) {
		const [key] = inGroups;
		if (groups.some((g) => g.key === key)) return { kind: "group", key };
	}
	return { kind: "views" };
}

/** The spot a `place:` value names, or null when it's unset or names a type or group that doesn't exist. */
export function placeSpot(place: string | null | undefined, types: EntityTypeDef[], groups: GroupDef[]): ViewSpot | null {
	const p = place?.trim();
	if (!p) return null;
	if (p === PLACE_VIEWS) return { kind: "views" };
	if (p.startsWith("@")) return groups.some((g) => g.key === p.slice(1)) ? { kind: "group", key: p.slice(1) } : null;
	return types.some((t) => t.key === p) ? { kind: "type", key: p } : null;
}

/** Where a view belongs: its `place:`, or else worked out from its types. */
export function viewSpot(viewTypes: string[], place: string | null | undefined, types: EntityTypeDef[], groups: GroupDef[]): ViewSpot {
	return placeSpot(place, types, groups) ?? autoViewSpot(viewTypes, types, groups);
}

/** The `place:` value for a spot. */
export function spotPlace(spot: ViewSpot): string {
	return spot.kind === "views" ? PLACE_VIEWS : spot.kind === "group" ? `@${spot.key}` : spot.key;
}

export function sameSpot(a: ViewSpot, b: ViewSpot): boolean {
	return a.kind === b.kind && (a.kind === "views" || a.key === (b as { key: string }).key);
}

/** The `place:` to save when a view is moved to `spot`: none when that's where it goes anyway. */
export function placeFor(spot: ViewSpot, viewTypes: string[], types: EntityTypeDef[], groups: GroupDef[]): string | null {
	return sameSpot(spot, autoViewSpot(viewTypes, types, groups)) ? null : spotPlace(spot);
}

/** Where the browser shows each view, given the sections it's showing. */
export interface PlacedViews<V> {
	/** the Views section, after the groups */
	top: V[];
	/** by section key: listed first in that section, under its heading */
	sections: Map<string, V[]>;
	/** by block key: listed first under that type heading */
	blocks: Map<string, V[]>;
}

/**
 * Put each view where it belongs, among the sections shown. A view whose type heading isn't shown (type headings
 * off, no notes, filtered out) goes to its type's group section; one whose group section isn't shown goes to Views.
 */
export function placeViews<V>(views: { view: V; spot: ViewSpot }[], shown: BrowserSection[], types: EntityTypeDef[]): PlacedViews<V> {
	const out: PlacedViews<V> = { top: [], sections: new Map(), blocks: new Map() };
	const add = <K>(m: Map<K, V[]>, k: K, v: V) => m.set(k, [...(m.get(k) ?? []), v]);
	const groupSection = (key: string) => shown.find((s) => s.group?.key === key);
	for (const { view, spot } of views) {
		if (spot.kind === "type") {
			const block = shown.flatMap((s) => s.blocks).find((b) => b.type?.key === spot.key);
			if (block) {
				add(out.blocks, block.key, view);
				continue;
			}
			const section = groupSection(types.find((t) => t.key === spot.key)?.group ?? "");
			if (section) add(out.sections, section.key, view);
			else out.top.push(view);
		} else if (spot.kind === "group") {
			const section = groupSection(spot.key);
			if (section) add(out.sections, section.key, view);
			else out.top.push(view);
		} else out.top.push(view);
	}
	return out;
}
