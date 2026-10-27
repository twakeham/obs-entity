import type { EntityTypeDef } from "./types";

export interface ParsedQuery {
	type: EntityTypeDef | null;
	text: string;
	/** how the type was given: "colon" ("person: ada") or "shortcut" ("p ada") */
	via?: "colon" | "shortcut";
}

/**
 * Parse a switcher query with an optional type prefix:
 *  - "person: ada", "people:", "p: ada": a type key, name, plural or shortcut followed by ":" (prefixes allowed)
 *  - "p ada": an exact shortcut followed by a space
 */
export function parseTypedQuery(query: string, types: EntityTypeDef[]): ParsedQuery {
	const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(query);
	if (m) {
		const type = findTypeByPrefix(m[1], types);
		if (type) return { type, text: m[2].trim(), via: "colon" };
	}
	const s = /^\s*(\S+)\s+(.+)$/.exec(query);
	if (s) {
		const word = s[1].toLowerCase();
		const type = types.find((t) => (t.shortcuts ?? []).some((x) => x.toLowerCase() === word));
		if (type) return { type, text: s[2].trim(), via: "shortcut" };
	}
	return { type: null, text: query.trim() };
}

export function findTypeByPrefix(prefix: string, types: EntityTypeDef[]): EntityTypeDef | null {
	const p = prefix.trim().toLowerCase();
	if (!p) return null;
	const names = (t: EntityTypeDef) => [t.key, t.name, t.plural, ...(t.shortcuts ?? [])].map((s) => s.toLowerCase());
	return types.find((t) => names(t).includes(p)) ?? types.find((t) => names(t).some((n) => n.startsWith(p))) ?? null;
}
