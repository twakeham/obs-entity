/**
 * Bulk actions on several entities: which fields they share, and how a change applies to one note's frontmatter.
 * Pure: the plugin applies these per file (with progress, errors and one undo step).
 */
import { isEmptyValue } from "./frontmatter";
import { asArray } from "./links";
import { addLink, removeLink } from "./relations";
import { COMMON_KEYS, isListValued, statusesFor, type EntityTypeDef, type FieldDef, type FieldKind, type GroupDef } from "./types";

/** A field that can be set on a selection: status, tags, or a type field (by key). */
export interface BulkField {
	key: string;
	label: string;
	kind: FieldKind | "status" | "tags";
	/** the field definition (from the first type that has it with this kind) */
	field?: FieldDef;
	/** keys of the selected types it applies to */
	types: string[];
}

/**
 * Fields the selected types can be given a value for: status and tags (every type), then type fields by key in
 * first-seen order. A key whose kind differs between types applies only to the types matching the first kind.
 */
export function bulkFields(types: EntityTypeDef[]): BulkField[] {
	const all = types.map((t) => t.key);
	const out: BulkField[] = [{ key: COMMON_KEYS.status, label: "Status", kind: "status", types: all }];
	const byKey = new Map<string, BulkField>();
	for (const t of types)
		for (const f of t.fields) {
			const seen = byKey.get(f.key);
			if (!seen) {
				const b: BulkField = { key: f.key, label: f.label, kind: f.kind, field: f, types: [t.key] };
				byKey.set(f.key, b);
				out.push(b);
			} else if (seen.kind === f.kind && !seen.types.includes(t.key)) seen.types.push(t.key);
		}
	out.push({ key: COMMON_KEYS.tags, label: "Tags", kind: "tags", types: all });
	return out;
}

/** Every status of the selected types, in order of first appearance. */
export function statusUnion(types: EntityTypeDef[], groups: GroupDef[]): string[] {
	const out: string[] = [];
	for (const t of types) for (const s of statusesFor(t, groups)) if (!out.includes(s)) out.push(s);
	return out;
}

export type BulkChange =
	/** set a key (undefined or null clears it) */
	| { op: "set"; key: string; value: unknown }
	/** add a link to a relation field (`linktext` as seen from the note being changed) */
	| { op: "add-link"; key: string; linktext: string; multiple: boolean; labelled: boolean }
	/** remove links whose path matches */
	| { op: "remove-link"; key: string; matches: (linkpath: string) => boolean }
	| { op: "add-tags"; tags: string[] }
	| { op: "remove-tags"; tags: string[] };

/** Whether a change applies to an entity of `type`: it has the field (status values must be valid for the type). */
export function changeApplies(change: BulkChange, type: EntityTypeDef, groups: GroupDef[]): boolean {
	if (change.op === "add-tags" || change.op === "remove-tags") return true;
	if (change.key === COMMON_KEYS.status) {
		if (change.op !== "set") return false;
		return isEmptyValue(change.value) || statusesFor(type, groups).includes(String(change.value));
	}
	if (change.key === COMMON_KEYS.tags) return change.op === "set";
	const f = type.fields.find((x) => x.key === change.key);
	if (!f) return false;
	return change.op === "set" || f.kind === "relation";
}

const normTag = (t: string) => t.trim().replace(/^#/, "");
const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Apply a change to one note's frontmatter. Returns whether anything changed. */
export function applyChange(fm: Record<string, unknown>, change: BulkChange): boolean {
	switch (change.op) {
		case "set": {
			const before = clone(fm[change.key]);
			const v = change.value === null ? undefined : change.value;
			if (v === undefined) {
				if (!(change.key in fm)) return false;
				// Clearing keeps the key (empty) so the property stays visible, like the form does.
				fm[change.key] = Array.isArray(fm[change.key]) ? [] : null;
			} else fm[change.key] = clone(v);
			return !same(before, fm[change.key]);
		}
		case "add-link": {
			const before = clone(fm[change.key]);
			fm[change.key] = addLink(fm[change.key], change.linktext, { multiple: change.multiple, labelled: change.labelled });
			return !same(before, fm[change.key]);
		}
		case "remove-link": {
			if (fm[change.key] === undefined) return false;
			const before = clone(fm[change.key]);
			fm[change.key] = removeLink(fm[change.key], change.matches);
			return !same(before, fm[change.key]);
		}
		case "add-tags":
		case "remove-tags": {
			const before = asArray(fm[COMMON_KEYS.tags]).map(String);
			const wanted = change.tags.map(normTag).filter(Boolean);
			const lower = new Set(wanted.map((t) => t.toLowerCase()));
			const after =
				change.op === "add-tags"
					? [...before, ...wanted.filter((t, i) => !before.some((b) => normTag(b).toLowerCase() === t.toLowerCase()) && wanted.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)]
					: before.filter((b) => !lower.has(normTag(b).toLowerCase()));
			if (same(before, after)) return false;
			fm[COMMON_KEYS.tags] = after;
			return true;
		}
	}
}

/** The value a "set" would write for a field, normalised for its kind (lists stay lists, single relations one link). */
export function setValueFor(field: BulkField, value: unknown): unknown {
	if (isEmptyValue(value)) return null;
	if (field.kind === "tags" || field.kind === "list" || field.kind === "multiselect") return asArray(value).map(String);
	if (field.field?.kind === "relation") return isListValued(field.field) ? asArray(value) : (asArray(value)[0] ?? null);
	return value;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const entitiesText = (n: number) => plural(n, "entity", "entities");

/** "Set Status to “done” on 12 entities", "Cleared Due on 3 entities", "Added #urgent to 5 entities"… */
export function describeChange(change: BulkChange, label: string, valueText: string, n: number): string {
	switch (change.op) {
		case "set":
			return isEmptyValue(change.value) ? `Cleared ${label} on ${entitiesText(n)}` : `Set ${label} to “${valueText}” on ${entitiesText(n)}`;
		case "add-link":
			return `Added ${valueText} to ${label} on ${entitiesText(n)}`;
		case "remove-link":
			return `Removed ${valueText} from ${label} on ${entitiesText(n)}`;
		case "add-tags":
			return `Added ${change.tags.map((t) => `#${normTag(t)}`).join(", ")} to ${entitiesText(n)}`;
		case "remove-tags":
			return `Removed ${change.tags.map((t) => `#${normTag(t)}`).join(", ")} from ${entitiesText(n)}`;
	}
}

/** "Name (copy)", "Name (copy 2)"… not in `taken` (lower-case base names). */
export function copyName(base: string, taken: Set<string>): string {
	let name = `${base} (copy)`;
	for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (copy ${n})`;
	return name;
}
