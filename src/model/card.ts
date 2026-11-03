import type { DateAdapter } from "./dates";
import { DEFAULT_DATE_FORMAT, formatValue, type FormatEnv } from "./fieldFormats";
import { isEmptyValue } from "./frontmatter";
import { parseLink } from "./links";
import type { EntityTypeDef, FieldDef } from "./types";

/** A format environment; a bare date adapter gives unformatted values (dates in the adapter's long form). */
export const formatEnvOf = (x: FormatEnv | DateAdapter): FormatEnv => ("dates" in x ? x : { dates: x, locale: "en", currency: "AUD", today: 0, dateFormat: DEFAULT_DATE_FORMAT });

/**
 * Display string for a non-relation frontmatter value, in the field's display format (numbers, dates, checkboxes
 * and URLs). Textareas contribute their first line; lists are comma-joined.
 */
export function valueDisplay(field: FieldDef, raw: unknown, fmt: FormatEnv | DateAdapter): string {
	if (isEmptyValue(raw)) return "";
	switch (field.kind) {
		case "boolean":
		case "number":
		case "url":
		case "date":
			return formatValue(field, raw, formatEnvOf(fmt));
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
export function subtitleOf(type: EntityTypeDef, fm: Record<string, unknown>, fmt: FormatEnv | DateAdapter): string | null {
	const keys = type.card?.subtitle ?? [];
	const parts: string[] = [];
	for (const key of keys) {
		const field = type.fields.find((f) => f.key === key);
		if (!field || field.kind === "relation") continue;
		const text = valueDisplay(field, fm[key], fmt);
		if (text) parts.push(text);
	}
	return parts.length ? parts.join(" · ") : null;
}

/** Link target for a url field value: web/mail URLs as-is, bare emails as mailto:, bare domains as https. */
export function urlHref(value: string): string | undefined {
	const v = value.trim();
	if (!v) return undefined;
	if (/^(https?|mailto|obsidian):/i.test(v)) return v;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
	if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
	return undefined;
}
