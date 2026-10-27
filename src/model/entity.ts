import type { EntityTypeDef } from "./types";

/** Plain entity data used by pure logic. */
export interface EntityInfo {
	path: string;
	name: string;
	type: EntityTypeDef;
	status: string | null;
	/** one-line description from the type's card.subtitle fields */
	subtitle: string | null;
	/** tags without "#", from frontmatter and body */
	tags: string[];
	/** last modified time (ms) */
	mtime: number;
	/** creation time (ms), when known */
	ctime?: number;
	/** manual sort key among siblings (`order` frontmatter), null if unset */
	order: number | null;
	frontmatter: Record<string, unknown>;
}

export function normaliseTags(values: unknown[]): string[] {
	const out = new Set<string>();
	for (const v of values) {
		if (typeof v !== "string") continue;
		for (const t of v.split(/[\s,]+/)) {
			const tag = t.replace(/^#/, "").trim();
			if (tag) out.add(tag);
		}
	}
	return Array.from(out).sort((a, b) => a.localeCompare(b));
}

export function toOrder(v: unknown): number | null {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
	return null;
}

export function toStringList(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
	if (typeof v === "string" && v.trim()) return [v];
	return [];
}
