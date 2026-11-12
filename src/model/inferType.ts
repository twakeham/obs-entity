/**
 * Working out an entity type from notes that aren't entities yet ("Create entity type from this note"): a field per
 * property, its kind guessed from the values (and Obsidian's property types), links to entities becoming relations to
 * their types, plus a name, group, statuses and template sections. Best effort: the result opens as a draft to review.
 */
import { asArray, parseLink } from "./links";
import { COMMON_KEYS, DEFAULT_STATUSES, isValidKey, toKey, type EntityTypeDef, type FieldDef, type FieldKind, type GroupDef } from "./types";

/** A note to learn from. */
export interface InferNote {
	path: string;
	frontmatter: Record<string, unknown>;
	/** its level-2 headings, in order */
	headings: string[];
}

export interface InferContext {
	types: EntityTypeDef[];
	groups: GroupDef[];
	/** where a link from a note goes (a path), or null when it goes nowhere */
	resolve: (link: string, fromPath: string) => string | null;
	/** the entity type key of the note at a path (null: not an entity) */
	typeAt: (path: string) => string | null;
	/** Obsidian's assigned property type for a key ("text", "multitext", "date", …), when known */
	widget: (key: string) => string | null;
	color: string;
}

export interface InferredType {
	type: EntityTypeDef;
	/** field key → the property it was read from (renamed to the field's final key when notes adopt the type) */
	props: Record<string, string>;
	/** the notes it was learned from (the first is the one asked about) */
	paths: string[];
}

/** Keys that aren't fields: the ones every entity has, and Obsidian's own. */
const SKIP = new Set<string>([...Object.values(COMMON_KEYS), "cssclasses", "cssclass", "position"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
const URL_RE = /^https?:\/\/\S+$/i;
const WRAPPED = /^\s*(\[\[.*\]\]|\[.*\]\(.*\))\s*$/;
/** most choices a field can have to be guessed as a choice field */
const MAX_CHOICES = 8;
/** fewest notes for a choice field to be guessed (with one note, any text could be a choice) */
const MIN_NOTES_FOR_CHOICE = 3;

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** "due_date" / "dueDate" / "due-date" → "Due date". */
export function labelOf(key: string): string {
	const words = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.toLowerCase();
	return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** "Risks" → "Risk", "Companies" → "Company", "Boxes" → "Box", "Status" stays. */
export function singular(word: string): string {
	if (/ies$/i.test(word) && word.length > 4) return word.slice(0, -3) + (word.endsWith("IES") ? "Y" : "y");
	if (/(ss|us|is)$/i.test(word)) return word;
	if (/(x|ch|sh|ss)es$/i.test(word)) return word.slice(0, -2);
	if (/s$/i.test(word) && word.length > 2) return word.slice(0, -1);
	return word;
}

/** "Risk" → "Risks", "Company" → "Companies". */
export function pluralOf(word: string): string {
	if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
	if (/(s|x|ch|sh)$/i.test(word)) return `${word}es`;
	return `${word}s`;
}

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const unique = <T>(xs: T[]) => [...new Set(xs)];

/** Scales choices are put in order by when they all belong to one (otherwise they keep the order first seen). */
const SCALES = [
	["none", "very low", "low", "medium", "moderate", "high", "very high", "critical", "extreme"],
	["trivial", "minor", "moderate", "major", "severe", "critical"],
	["xs", "s", "m", "l", "xl", "xxl"],
	["tiny", "small", "medium", "large", "huge"],
	["rare", "unlikely", "possible", "likely", "almost certain"],
	["never", "rarely", "sometimes", "often", "always"],
];

/** Choices in their natural order: numbers by value, or along a known scale. */
export function orderOptions(options: string[]): string[] {
	if (options.every((o) => o.trim() !== "" && !Number.isNaN(Number(o)))) return [...options].sort((a, b) => Number(a) - Number(b));
	const scale = SCALES.find((s) => options.every((o) => s.includes(o.trim().toLowerCase())));
	return scale ? [...options].sort((a, b) => scale.indexOf(a.trim().toLowerCase()) - scale.indexOf(b.trim().toLowerCase())) : options;
}

/** The kind of field (and its settings) for one property's values across the notes. */
function inferField(key: string, values: { value: unknown; from: string }[], notes: number, ctx: InferContext, own: Set<string>, ownKey: string): Omit<FieldDef, "key" | "label"> {
	const widget = ctx.widget(key);
	const present = values.filter((v) => !isEmpty(v.value));
	const items = present.flatMap((v) => asArray(v.value).map((x) => ({ value: x, from: v.from })));
	const anyList = present.some((v) => Array.isArray(v.value)) || widget === "multitext" || widget === "tags" || widget === "aliases";
	if (!items.length) {
		if (widget === "date" || widget === "datetime") return { kind: "date" };
		if (widget === "number") return { kind: "number" };
		if (widget === "checkbox") return { kind: "boolean" };
		return { kind: anyList ? "list" : "text" };
	}
	const all = (test: (v: unknown) => boolean) => items.every((i) => test(i.value));
	if (all((v) => typeof v === "boolean")) return { kind: "boolean" };
	if (all((v) => typeof v === "number")) return { kind: "number" };

	// Links: wrapped links to any note, or plain names of entities (which read as links too).
	const targetsOf = (wrappedOnly: boolean): string[] | null => {
		const keys: (string | null)[] = [];
		for (const i of items) {
			if (typeof i.value !== "string") return null;
			const wrapped = WRAPPED.test(i.value);
			if (wrappedOnly && !wrapped) return null;
			const link = parseLink(i.value);
			const path = link ? ctx.resolve(link.path, i.from) : null;
			const type = path ? (own.has(path) ? ownKey : ctx.typeAt(path)) : null;
			// A plain name counts only when it names an entity.
			if (!wrapped && !type) return null;
			keys.push(type);
		}
		return keys.every((k) => k) ? unique(keys as string[]) : ["*"];
	};
	const targets = targetsOf(false);
	if (targets) return { kind: "relation", targets, ...(anyList ? { multiple: true } : {}) };

	const texts = items.map((i) => (typeof i.value === "string" ? i.value.trim() : String(i.value)));
	const distinct = unique(texts);
	const choice = notes >= MIN_NOTES_FOR_CHOICE && distinct.length <= MAX_CHOICES && distinct.length < texts.length && texts.every((t) => t.length <= 40 && !t.includes("\n"));
	if (anyList) return choice ? { kind: "multiselect", options: orderOptions(distinct) } : { kind: "list" };
	if (widget === "date" || widget === "datetime" || all((v) => typeof v === "string" && ISO_DATE.test(v.trim()))) return { kind: "date" };
	if (widget === "number" && all((v) => !Number.isNaN(Number(v)))) return { kind: "number" };
	if (widget === "checkbox") return { kind: "boolean" };
	if (all((v) => typeof v === "string" && URL_RE.test(v.trim()))) return { kind: "url" };
	if (choice) return { kind: "select", options: orderOptions(distinct) };
	if (texts.some((t) => t.length > 80 || t.includes("\n"))) return { kind: "textarea" };
	return { kind: "text" as FieldKind };
}

/**
 * A type for notes that aren't entities: `notes[0]` is the note asked about, the rest notes like it (the same
 * `entity` value). Named from the `entity` value, or else from the note's folder ("Risks" → Risk); in the group named
 * like one of its folders (else the first); with the statuses in use added to the group's, and the notes' headings
 * as template sections.
 */
export function inferType(notes: InferNote[], ctx: InferContext): InferredType {
	const first = notes[0];
	const paths = notes.map((n) => n.path);
	const own = new Set(paths);
	const folders = first.path.split("/").slice(0, -1);
	const entityValue = notes.map((n) => n.frontmatter[COMMON_KEYS.type]).find((v): v is string => typeof v === "string" && !!v.trim())?.trim();
	const folder = folders[folders.length - 1];
	let name: string;
	let plural: string;
	if (entityValue) {
		name = titleCase(labelOf(entityValue));
		plural = pluralOf(name);
	} else if (folder) {
		name = titleCase(singular(folder));
		plural = name === folder ? pluralOf(name) : folder;
	} else {
		name = "New type";
		plural = "New types";
	}
	const takenTypes = ctx.types.map((t) => t.key);
	let key = toKey(entityValue ?? name) || "type";
	if (!isValidKey(key)) key = `type_${key}`.replace(/_+/g, "_");
	for (let n = 2, base = key; takenTypes.includes(key); n++) key = `${base}_${n}`;

	const lower = folders.map((f) => f.toLowerCase());
	const group = ctx.groups.find((g) => lower.includes(g.name.toLowerCase()) || lower.includes(g.key)) ?? ctx.groups[0];
	const groupStatuses = group?.statuses?.length ? group.statuses : DEFAULT_STATUSES;
	const used = unique(notes.map((n) => n.frontmatter[COMMON_KEYS.status]).filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()));
	const extra = used.filter((s) => !groupStatuses.includes(s));

	// Fields, in the order the properties first appear (the asked-about note first).
	const keys = unique(notes.flatMap((n) => Object.keys(n.frontmatter))).filter((k) => !SKIP.has(k));
	const fields: FieldDef[] = [];
	const props: Record<string, string> = {};
	const takenFields = new Set<string>(SKIP);
	for (const prop of keys) {
		let fkey = isValidKey(prop) ? prop : toKey(prop) || "field";
		if (!isValidKey(fkey)) fkey = `field_${fkey}`.replace(/_+/g, "_");
		for (let n = 2, base = fkey; takenFields.has(fkey); n++) fkey = `${base}_${n}`;
		takenFields.add(fkey);
		props[fkey] = prop;
		const values = notes.map((n) => ({ value: n.frontmatter[prop], from: n.path }));
		fields.push({ key: fkey, label: labelOf(prop), ...inferField(prop, values, notes.length, ctx, own, key) });
	}

	const sections = unique(notes.flatMap((n) => n.headings.map((h) => h.trim()).filter(Boolean)));
	const type: EntityTypeDef = {
		key,
		name,
		plural,
		icon: "file",
		color: ctx.color,
		group: group?.key ?? "",
		template: "",
		fields,
		builtIn: false,
		shortcuts: [],
		...(extra.length ? { statuses: [...groupStatuses, ...extra] } : {}),
		...(sections.length ? { sections } : {}),
	};
	return { type, props, paths };
}

/** Whether adopting would change a note (it may already name the key, with nothing to rename). */
export function adoptionNeeded(fm: Record<string, unknown>, key: string, renames: [from: string, to: string][]): boolean {
	return fm[COMMON_KEYS.type] !== key || renames.some(([from, to]) => from !== to && from in fm && !(to in fm));
}

/**
 * Make a note an entity of a type it was learned for: set `entity` (first, as new entities have it), and rename
 * properties to their fields' keys where they are.
 */
export function adoptFrontmatter(fm: Record<string, unknown>, key: string, renames: [from: string, to: string][]): void {
	const had = new Set(Object.keys(fm));
	const to = new Map(renames.filter(([f, t]) => f !== t && !had.has(t)));
	const entries = Object.entries(fm);
	for (const k of had) delete fm[k];
	fm[COMMON_KEYS.type] = key;
	for (const [k, v] of entries) if (k !== COMMON_KEYS.type) fm[to.get(k) ?? k] = v;
}
