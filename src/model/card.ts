import type { DateAdapter } from "./dates";
import { isEmptyValue } from "./frontmatter";
import { parseLink } from "./links";
import type { RelationGroup } from "./relations";
import { COMMON_KEYS, type EntityTypeDef, type FieldDef } from "./types";

/**
 * Display string for a non-relation frontmatter value.
 * Textareas contribute their first line; lists are comma-joined; dates use the adapter's long form.
 */
export function valueDisplay(field: FieldDef, raw: unknown, dates: DateAdapter): string {
	if (isEmptyValue(raw)) return "";
	switch (field.kind) {
		case "boolean":
			return raw === true || raw === "true" ? "Yes" : "";
		case "date": {
			const parsed = dates.parse(raw);
			return parsed?.ok ? parsed.display : String(raw);
		}
		case "textarea":
			return String(raw).trim().split(/\r?\n/)[0].trim();
		case "list":
		case "multiselect":
			return (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean).join(", ");
		case "relation":
			return (Array.isArray(raw) ? raw : [raw])
				.map((v) => parseLink(v)?.path.split("/").pop() ?? "")
				.filter(Boolean)
				.join(", ");
		default:
			return Array.isArray(raw) ? raw.map(String).join(", ") : String(raw).trim();
	}
}

/** The one-line description of an entity: its type's subtitle fields, joined with " · ". */
export function subtitleOf(type: EntityTypeDef, fm: Record<string, unknown>, dates: DateAdapter): string | null {
	const keys = type.card?.subtitle ?? [];
	const parts: string[] = [];
	for (const key of keys) {
		const field = type.fields.find((f) => f.key === key);
		if (!field || field.kind === "relation") continue;
		const text = valueDisplay(field, fm[key], dates);
		if (text) parts.push(text);
	}
	return parts.length ? parts.join(" · ") : null;
}

export const DEFAULT_MAX_CHIPS = 6;

export type CardSection =
	| { kind: "field"; key: string; label: string; value: string; empty?: boolean; href?: string }
	| { kind: "relation"; group: RelationGroup }
	| { kind: "empty-relation"; key: string; label: string };

/** Link target for a url field value: web/mail URLs as-is, bare emails as mailto:, bare domains as https. */
export function urlHref(value: string): string | undefined {
	const v = value.trim();
	if (!v) return undefined;
	if (/^(https?|mailto|obsidian):/i.test(v)) return v;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
	if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
	return undefined;
}

/**
 * What the info card body shows, in order, following the type's `card` settings:
 *  - default (no `card.fields`): filled non-relation fields in field order (subtitle fields excluded),
 *    then relation groups (outgoing in field order, then incoming, then Related)
 *  - with `card.fields`: those fields in that order; relation fields become their relation groups in place,
 *    then, if `card.incoming` isn't false, incoming / both-way groups not already shown
 * `card.incoming: false` hides groups that only come from other notes.
 */
export function cardSections(type: EntityTypeDef, fm: Record<string, unknown>, groups: RelationGroup[], dates: DateAdapter): CardSection[] {
	const card = type.card ?? {};
	const incoming = card.incoming !== false;
	const out: CardSection[] = [];
	const shown = new Set<RelationGroup>();
	const fieldLine = (f: FieldDef, showEmpty: boolean) => {
		const value = valueDisplay(f, fm[f.key], dates);
		if (value) out.push({ kind: "field", key: f.key, label: f.label, value, ...(f.kind === "url" && urlHref(value) ? { href: urlHref(value) } : {}) });
		else if (showEmpty) out.push({ kind: "field", key: f.key, label: f.label, value: "—", empty: true });
	};
	const ownGroup = (g: RelationGroup) => g.fieldKey !== undefined && g.items.some((i) => i.direction === "out");

	if (!card.fields) {
		const subtitle = new Set(card.subtitle ?? []);
		for (const f of type.fields) if (f.kind !== "relation" && !subtitle.has(f.key)) fieldLine(f, false);
		for (const g of groups) if (incoming || ownGroup(g)) out.push({ kind: "relation", group: g });
		return out;
	}

	const byKey = new Map(type.fields.map((f) => [f.key, f]));
	for (const key of card.fields) {
		if (key === COMMON_KEYS.related) {
			const g = groups.find((x) => x.key === "sym:related");
			if (g) {
				out.push({ kind: "relation", group: g });
				shown.add(g);
			} else if (card.showEmpty) out.push({ kind: "empty-relation", key, label: "Related" });
			continue;
		}
		const f = byKey.get(key);
		if (!f) continue;
		if (f.kind !== "relation") {
			fieldLine(f, !!card.showEmpty);
			continue;
		}
		const mine = groups.filter((g) => g.fieldKey === key);
		for (const g of mine) {
			out.push({ kind: "relation", group: g });
			shown.add(g);
		}
		if (mine.length === 0 && card.showEmpty) out.push({ kind: "empty-relation", key, label: f.label });
	}
	if (incoming) {
		for (const g of groups) if (!shown.has(g) && g.direction !== "out" && !ownGroup(g)) out.push({ kind: "relation", group: g });
	}
	return out;
}
