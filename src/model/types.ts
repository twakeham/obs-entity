import type { FormLayout } from "./formLayout";
import type { FType } from "./formula";
import type { FieldRules } from "./rules";
import type { DefaultFrom } from "./defaults";
import type { ColorMap } from "./colors";
import type { RollupDef } from "./views";

export type FieldKind =
	| "text"
	| "textarea"
	| "number"
	| "date"
	| "select"
	| "multiselect"
	| "list"
	| "boolean"
	| "url"
	| "relation"
	| "rollup"
	| "formula";

export const FIELD_KINDS: FieldKind[] = ["text", "textarea", "number", "date", "select", "multiselect", "list", "boolean", "url", "relation", "rollup", "formula"];

/** Calculated fields: worked out when shown (from linked notes, or a formula), never stored in the note. */
export const isCalculated = (f: Pick<FieldDef, "kind"> | undefined | null): boolean => f?.kind === "rollup" || f?.kind === "formula";

/** The fields a note stores (calculated ones left out). */
export const storedFields = (t: Pick<EntityTypeDef, "fields">): FieldDef[] => t.fields.filter((f) => !isCalculated(f));

/** Relation targets: entity type keys, "*" for any entity, or "@<groupKey>" for any type in a group. */
export type RelationTarget = string;

export interface FieldDef {
	key: string;
	label: string;
	kind: FieldKind;
	/** help text shown under the control */
	description?: string;
	/** select / multiselect options */
	options?: string[];
	/** prefilled value in the create dialog */
	default?: unknown;
	/** show this field in the create dialog (otherwise it sits under "Show N more fields") */
	inModal?: boolean;
	required?: boolean;
	/** relation: allowed target types */
	targets?: RelationTarget[];
	/** relation: store a list of links (implied by labelled) */
	multiple?: boolean;
	/** relation: label shown on the target note for the computed inverse */
	inverse?: string;
	/** relation: the link reads the same both ways (e.g. allies) */
	symmetric?: boolean;
	/** relation: each link has its own label, stored as the wikilink alias */
	labelled?: boolean;
	/**
	 * Display format (number, date, checkbox and URL fields; the stored value never changes). Number: the view
	 * column formats ("currency:AUD", "#,##0 h"…). Date: a moment.js pattern or "relative" (unset: the Date display
	 * format setting). Checkbox: "checkbox" | "yesno" | "check". URL: "full" | "domain" | "text:<label>".
	 */
	format?: string;
	/** roll-up field: what to work out from linked notes */
	rollup?: RollupDef;
	/** formula field: the formula (stored form, with column ids) */
	formula?: string;
	/** formula field: the result type, when set by hand (otherwise inferred) */
	formulaType?: FType;
	/** validation rules (limits, pattern, unique, required when…); breaking one is a problem, not a refusal */
	rules?: FieldRules;
	/** a smarter default for new notes (relative date, from a linked note, auto number); replaces `default` */
	defaultFrom?: DefaultFrom;
	/** choice / multiple-choice fields: a colour per choice (unset choices keep the standard look) */
	colors?: ColorMap;
	/** choice / multiple-choice fields: each choice has a number (`values`), used by calculations */
	valued?: boolean;
	/** the choices' numbers, by label (with `valued`) */
	values?: Record<string, number>;
	/** show "High: 3" on the choices' pills (with `valued`) */
	showValues?: boolean;
}

export type FolderMode = "type" | "parent" | "own";

/** What compact displays (properties form header, pickers, switcher) show for a type. */
export interface CardConfig {
	/** non-relation field keys whose values form the one-line description, joined with " · " */
	subtitle?: string[];
}

/** How the entity properties form shows notes of a type. */
export interface FormConfig {
	/** hide fields with no value (default false: every field is listed, empty ones faintly) */
	hideEmpty?: boolean;
	/** a custom layout: frames, columns and field slots (unset: one list in field order) */
	layout?: FormLayout;
}

export interface EntityTypeDef {
	/** written into notes as `entity: <key>`; immutable once saved */
	key: string;
	name: string;
	plural: string;
	/** Lucide icon id */
	icon: string;
	/** #rrggbb */
	color: string;
	/** GroupDef.key */
	group: string;
	/** exception to the global folder pattern, with the same placeholders; undefined = use the global pattern */
	folderPattern?: string;
	/** "type" (default): the folder pattern; "parent": inside the parent's folder; "own": a folder of its own */
	folderMode?: FolderMode;
	/** template file name inside the templates folder */
	template: string;
	/** headings for the built-in default template */
	sections?: string[];
	/** extra switcher prefixes, e.g. "p" for person */
	shortcuts?: string[];
	/** overrides the group's statuses */
	statuses?: string[];
	/** with its own statuses: a colour per status (over the group's; unset: coloured by name) */
	statusColors?: ColorMap;
	/** relation field keys that point at this entity's parent, in priority order */
	parentFields?: string[];
	card?: CardConfig;
	form?: FormConfig;
	fields: FieldDef[];
	/** id of the pack this type was installed from */
	pack?: string;
	builtIn: boolean;
}

export interface GroupDef {
	key: string;
	name: string;
	/** Lucide icon id */
	icon: string;
	/** first status = draft / not started */
	statuses: string[];
	/** a colour per status (unset: coloured by name) */
	statusColors?: ColorMap;
}

/** Fixed frontmatter keys managed for every entity regardless of type. */
export const COMMON_KEYS = {
	type: "entity",
	status: "status",
	tags: "tags",
	aliases: "aliases",
	related: "related",
	order: "order",
} as const;

export const RESERVED_KEYS: ReadonlySet<string> = new Set(Object.values(COMMON_KEYS));

export const DEFAULT_STATUSES = ["draft", "active", "done"];

/** The key of the stand-in type a workflow's form is edited and shown as (no real type's key starts with "@"). */
export const FORM_TYPE_KEY = "@form";
/** Whether a type is a workflow's form (fields and a layout only: no notes, status, tags or note items). */
export const isFormType = (t: Pick<EntityTypeDef, "key">): boolean => t.key === FORM_TYPE_KEY;

export function typeMatchesTarget(type: EntityTypeDef, targets: RelationTarget[] | undefined): boolean {
	if (!targets || targets.length === 0) return true;
	return targets.some((t) => t === "*" || t === type.key || t === `@${type.group}`);
}

/** Like typeMatchesTarget, but ignores "*" (any entity) and empty targets: the type is named explicitly. */
export function typeExplicitlyTargeted(type: EntityTypeDef, targets: RelationTarget[] | undefined): boolean {
	return (targets ?? []).some((t) => t === type.key || t === `@${type.group}`);
}

export function relationFields(type: EntityTypeDef): FieldDef[] {
	return type.fields.filter((f) => f.kind === "relation");
}

/** Relation fields store lists when multiple or labelled; list-like kinds always do. */
export function isListValued(f: FieldDef): boolean {
	if (f.kind === "relation") return !!f.multiple || !!f.labelled;
	return f.kind === "list" || f.kind === "multiselect";
}

export function statusesFor(type: EntityTypeDef, groups: GroupDef[]): string[] {
	if (type.statuses && type.statuses.length > 0) return type.statuses;
	const group = groups.find((g) => g.key === type.group);
	return group && group.statuses.length > 0 ? group.statuses : DEFAULT_STATUSES;
}

export function groupOf(type: EntityTypeDef, groups: GroupDef[]): GroupDef | undefined {
	return groups.find((g) => g.key === type.group);
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

export function isValidKey(key: string): boolean {
	return KEY_RE.test(key);
}

export function toKey(label: string): string {
	return label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/^(\d)/, "_$1");
}

export function cloneType(t: EntityTypeDef): EntityTypeDef {
	const copy = JSON.parse(JSON.stringify(t));
	// Per-type folders were replaced by the global folder pattern.
	delete copy.folder;
	// The info card was replaced by the properties form; only the subtitle remains.
	if (copy.card) {
		for (const k of ["show", "fields", "incoming", "showEmpty", "maxChips"]) delete copy.card[k];
		if (Object.keys(copy.card).length === 0) delete copy.card;
	}
	return copy;
}

export function cloneGroup(g: GroupDef): GroupDef {
	const copy = JSON.parse(JSON.stringify(g));
	// Per-group root folders were replaced by the global folder pattern.
	delete copy.root;
	return copy;
}
