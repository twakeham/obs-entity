import { COMMON_KEYS, isListValued, type EntityTypeDef, type FieldDef } from "./types";

/** Obsidian property types the plugin manages, so the Properties panel shows the right editor. */
export type PropertyType = "date" | "number" | "checkbox" | "multitext";

/** The Obsidian property type for a field, or null to leave it as text. */
export function propertyTypeFor(f: FieldDef): PropertyType | null {
	switch (f.kind) {
		case "date":
			return "date";
		case "number":
			return "number";
		case "boolean":
			return "checkbox";
		case "list":
		case "multiselect":
			return "multitext";
		case "relation":
			return isListValued(f) ? "multitext" : null;
		default:
			return null;
	}
}

/**
 * Obsidian property types for every type's fields (plus `related` and `order`).
 * Property types are vault-wide by name, so a key that different types want as different kinds
 * (e.g. a number in one type and a date in another, or text in one and a list in another) is left alone.
 */
export function propertyTypes(types: EntityTypeDef[]): { types: Record<string, PropertyType>; conflicts: string[] } {
	const wanted = new Map<string, Set<PropertyType | null>>([
		[COMMON_KEYS.related, new Set<PropertyType | null>(["multitext"])],
		[COMMON_KEYS.order, new Set<PropertyType | null>(["number"])],
	]);
	for (const t of types) {
		for (const f of t.fields) {
			if (!f.key) continue;
			const set = wanted.get(f.key) ?? new Set<PropertyType | null>();
			set.add(propertyTypeFor(f));
			wanted.set(f.key, set);
		}
	}
	const out: Record<string, PropertyType> = {};
	const conflicts: string[] = [];
	for (const [key, set] of wanted) {
		if (set.size > 1) conflicts.push(key);
		else {
			const [only] = set;
			if (only) out[key] = only;
		}
	}
	return { types: out, conflicts: conflicts.sort() };
}
