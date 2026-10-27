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
	| "relation";

export const FIELD_KINDS: FieldKind[] = ["text", "textarea", "number", "date", "select", "multiselect", "list", "boolean", "url", "relation"];

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
}

export type FolderMode = "type" | "parent" | "own";

/** What compact displays (info card, pickers, switcher) show for a type. */
export interface CardConfig {
	/** inject the info card on notes of this type (default true) */
	show?: boolean;
	/** non-relation field keys whose values form the one-line description, joined with " · " */
	subtitle?: string[];
	/** field keys shown in the card body, in this order; undefined = all filled fields */
	fields?: string[];
	/** also show incoming / inverse and Related groups (default true) */
	incoming?: boolean;
	/** show listed fields even when empty (default false) */
	showEmpty?: boolean;
	/** chips per relation row before "+N more" (default 6) */
	maxChips?: number;
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
	/** relative folder; missing = plural, "" = directly in the group root (or the parent's folder) */
	folder?: string;
	folderMode?: FolderMode;
	/** template file name inside the templates folder */
	template: string;
	/** headings for the built-in default template */
	sections?: string[];
	/** extra switcher prefixes, e.g. "p" for person */
	shortcuts?: string[];
	/** overrides the group's statuses */
	statuses?: string[];
	/** relation field keys that point at this entity's parent, in priority order */
	parentFields?: string[];
	card?: CardConfig;
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
	/** root folder for the group's types */
	root: string;
	/** first status = draft / not started */
	statuses: string[];
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

/** The type's folder relative to its root: missing = plural, "" = none. */
export function typeFolder(type: EntityTypeDef): string {
	return type.folder === undefined ? type.plural : type.folder;
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
	return JSON.parse(JSON.stringify(t));
}

export function cloneGroup(g: GroupDef): GroupDef {
	return JSON.parse(JSON.stringify(g));
}
