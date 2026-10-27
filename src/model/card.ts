import type { DateAdapter } from "./dates";
import { isEmptyValue } from "./frontmatter";
import { parseLink } from "./links";
import type { EntityTypeDef, FieldDef } from "./types";

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
