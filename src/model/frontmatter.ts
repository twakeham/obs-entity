import { parseLabelledEntry, toLabelledWikilink, toWikilink } from "./links";
import { COMMON_KEYS, isCalculated, isListValued, type EntityTypeDef, type FieldDef } from "./types";

export interface LabelledValue {
	target: string;
	label: string;
}

export type FieldValue = string | number | boolean | string[] | LabelledValue[] | null;

export interface EntityFormValues {
	name: string;
	status: string;
	tags: string[];
	/** Relation values are link texts (as produced by metadataCache.fileToLinktext). */
	fields: Record<string, FieldValue>;
}

export function isEmptyValue(v: unknown): boolean {
	return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function splitList(value: FieldValue): string[] {
	if (Array.isArray(value)) return (value as unknown[]).map((v) => String(v).trim()).filter(Boolean);
	return String(value)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export function toYamlValue(field: FieldDef, value: FieldValue | undefined): unknown {
	if (value === undefined || isEmptyValue(value)) {
		if (field.kind === "boolean") return false;
		return isListValued(field) ? [] : null;
	}
	switch (field.kind) {
		case "relation": {
			const arr = (Array.isArray(value) ? value : [value]) as (string | LabelledValue)[];
			const out = arr
				.map((v) => {
					if (typeof v === "string") return v.trim() ? toWikilink(v.trim()) : null;
					if (!v.target) return null;
					return field.labelled ? toLabelledWikilink(v.target, v.label) : toWikilink(v.target);
				})
				.filter((v): v is string => v !== null);
			return isListValued(field) ? out : (out[0] ?? null);
		}
		case "list":
		case "multiselect":
			return splitList(value);
		case "number": {
			const n = typeof value === "number" ? value : Number(value);
			return Number.isFinite(n) ? n : null;
		}
		case "boolean":
			return typeof value === "string" ? value === "true" : Boolean(value);
		default:
			return Array.isArray(value) ? value.join(", ") : String(value).trim() || null;
	}
}

/** Starting values for a field in the create dialog (its default, if any). */
export function defaultFieldValue(field: FieldDef): FieldValue | undefined {
	const d = field.default;
	if (d === undefined || d === null || field.kind === "relation") return undefined;
	if (Array.isArray(d)) return d.map(String);
	if (typeof d === "string" || typeof d === "number" || typeof d === "boolean") return d;
	return undefined;
}

/**
 * Build the frontmatter for a new entity. Every type field is included (empty if unset)
 * so it appears in Obsidian's Properties panel ready to fill in.
 */
export function buildFrontmatter(type: EntityTypeDef, values: EntityFormValues): Record<string, unknown> {
	const fm: Record<string, unknown> = {
		[COMMON_KEYS.type]: type.key,
		[COMMON_KEYS.status]: values.status || null,
	};
	if (type.parentFields && type.parentFields.length > 0) fm[COMMON_KEYS.order] = null;
	for (const field of type.fields) if (!isCalculated(field)) fm[field.key] = toYamlValue(field, values.fields[field.key]);
	fm[COMMON_KEYS.related] = [];
	fm[COMMON_KEYS.tags] = values.tags;
	return fm;
}

/**
 * Merge generated frontmatter into existing frontmatter (e.g. from a template).
 * By default generated non-empty values win and existing values are kept when the generated value is empty.
 * With `preferExisting`, existing non-empty values always win (used when converting an existing note).
 * Tags are always unioned.
 */
export function mergeFrontmatter(existing: Record<string, unknown>, generated: Record<string, unknown>, preferExisting = false): void {
	for (const [key, value] of Object.entries(generated)) {
		if (key === COMMON_KEYS.tags && Array.isArray(value)) {
			const prev = Array.isArray(existing[key]) ? (existing[key] as unknown[]) : isEmptyValue(existing[key]) ? [] : [existing[key]];
			existing[key] = Array.from(new Set([...prev, ...value]));
			continue;
		}
		if (!isEmptyValue(existing[key]) && (preferExisting || isEmptyValue(value))) continue;
		existing[key] = value;
	}
}

/** Display string for a form value, used for template placeholders. */
export function fieldDisplay(value: FieldValue | undefined): string {
	if (value === undefined || isEmptyValue(value)) return "";
	if (Array.isArray(value)) {
		return (value as (string | LabelledValue)[])
			.map((v) => (typeof v === "string" ? v : v.label ? `${v.target} (${v.label})` : v.target))
			.join(", ");
	}
	return String(value);
}

/**
 * The create dialog's field values (relations as link texts, see `EntityFormValues`) as the properties form's
 * controls hold them: relations as frontmatter wikilinks, a list when the field holds several.
 */
export function toFormFields(type: EntityTypeDef, fields: Record<string, FieldValue>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...fields };
	for (const f of type.fields) {
		if (f.kind !== "relation" || isEmptyValue(fields[f.key])) continue;
		const v = toYamlValue(f, fields[f.key]);
		if (v === null || (Array.isArray(v) && v.length === 0)) delete out[f.key];
		else out[f.key] = v;
	}
	return out;
}

/** The reverse of `toFormFields`: wikilinks back to link texts (labelled fields: `{ target, label }`). */
export function fromFormFields(type: EntityTypeDef, fields: Record<string, unknown>): Record<string, FieldValue> {
	const out: Record<string, FieldValue> = {};
	for (const [k, v] of Object.entries(fields)) {
		const f = type.fields.find((x) => x.key === k);
		if (f?.kind !== "relation") {
			out[k] = v as FieldValue;
			continue;
		}
		const entries = (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]).flatMap((raw) => {
			const p = parseLabelledEntry(raw);
			return p ? [p] : [];
		});
		if (f.labelled) out[k] = entries.map((p) => ({ target: p.link.path, label: p.label ?? "" }));
		else if (isListValued(f)) out[k] = entries.map((p) => p.link.path);
		else out[k] = entries[0]?.link.path ?? null;
	}
	return out;
}
