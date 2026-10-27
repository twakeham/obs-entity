import { COMMON_KEYS, RESERVED_KEYS, isValidKey, type EntityTypeDef } from "./types";

/** A problem with a type definition, tied to the control it belongs to. */
export interface TypeIssue {
	/**
	 * Where: "key", "name", "group", "statuses", "parentFields", "card:subtitle", "card:fields",
	 * "field:<i>:key", "field:<i>:options", "field:<i>:targets", "field:<i>:default".
	 */
	at: string;
	message: string;
}

export interface ValidationContext {
	/** keys of all types (including this one, if saved) */
	typeKeys: string[];
	/** keys of all groups */
	groupKeys: string[];
	/** true when the type isn't saved yet, so its key must not be taken */
	isNew?: boolean;
}

/** Validate a type definition, locating each problem. */
export function typeIssues(t: EntityTypeDef, ctx: ValidationContext): TypeIssue[] {
	const problems: TypeIssue[] = [];
	const add = (at: string, message: string) => problems.push({ at, message });

	if (!isValidKey(t.key)) add("key", `Type key "${t.key}" must be lowercase letters, digits or underscores.`);
	else if (ctx.isNew && ctx.typeKeys.includes(t.key)) add("key", `A type with the key "${t.key}" already exists.`);
	if (!t.name.trim()) add("name", "Type name is required.");
	if (!ctx.groupKeys.includes(t.group)) add("group", "Choose a group.");
	if (t.statuses && t.statuses.some((s) => !s.trim())) add("statuses", "Statuses can't be blank.");

	const seen = new Set<string>();
	t.fields.forEach((f, i) => {
		if (!f.key) add(`field:${i}:key`, "Give this field a label.");
		else if (!isValidKey(f.key)) add(`field:${i}:key`, `Field key "${f.key}" must be lowercase letters, digits or underscores.`);
		else if (RESERVED_KEYS.has(f.key)) add(`field:${i}:key`, `Field key "${f.key}" is reserved.`);
		if (f.key && seen.has(f.key)) add(`field:${i}:key`, `Duplicate field key "${f.key}".`);
		seen.add(f.key);

		if (f.kind === "relation") {
			for (const target of f.targets ?? []) {
				if (target === "*") continue;
				if (target.startsWith("@")) {
					if (!ctx.groupKeys.includes(target.slice(1))) add(`field:${i}:targets`, `Field "${f.key}" targets unknown group "${target.slice(1)}".`);
				} else if (!ctx.typeKeys.includes(target) && target !== t.key) {
					add(`field:${i}:targets`, `Field "${f.key}" targets unknown type "${target}".`);
				}
			}
		}
		if ((f.kind === "select" || f.kind === "multiselect") && (!f.options || f.options.length === 0)) {
			add(`field:${i}:options`, `Choice field "${f.key}" needs at least one option.`);
		}
		const defaultProblem = checkDefault(f.kind, f.default, f.options);
		if (defaultProblem) add(`field:${i}:default`, defaultProblem);
	});

	const byKey = new Map(t.fields.map((f) => [f.key, f]));
	for (const key of t.parentFields ?? []) {
		const f = byKey.get(key);
		if (!f) add("parentFields", `Parent field "${key}" doesn't exist.`);
		else if (f.kind !== "relation") add("parentFields", `Parent field "${key}" isn't a relation field.`);
	}
	for (const key of t.card?.subtitle ?? []) {
		const f = byKey.get(key);
		if (!f) add("card:subtitle", `Subtitle field "${key}" doesn't exist.`);
		else if (f.kind === "relation") add("card:subtitle", `Relation fields can't be used in the subtitle ("${key}").`);
	}
	const cardSeen = new Set<string>();
	for (const key of t.card?.fields ?? []) {
		if (!byKey.has(key) && key !== COMMON_KEYS.related) add("card:fields", `Card field "${key}" doesn't exist.`);
		if (cardSeen.has(key)) add("card:fields", `Card field "${key}" is listed twice.`);
		cardSeen.add(key);
	}
	return problems;
}

/** Validate a type definition. Returns a list of human-readable problems. */
export function validateType(t: EntityTypeDef, ctx: ValidationContext): string[] {
	return typeIssues(t, ctx).map((i) => i.message);
}

function checkDefault(kind: string, value: unknown, options: string[] | undefined): string | null {
	if (value === undefined || value === null || value === "") return null;
	switch (kind) {
		case "select":
			return options?.includes(String(value)) ? null : `Default "${String(value)}" isn't one of the options.`;
		case "multiselect": {
			const bad = (Array.isArray(value) ? value : [value]).filter((v) => !options?.includes(String(v)));
			return bad.length ? `Default "${bad.join(", ")}" isn't one of the options.` : null;
		}
		case "number":
			return typeof value === "number" || Number.isFinite(Number(value)) ? null : `Default "${String(value)}" isn't a number.`;
		case "boolean":
			return typeof value === "boolean" ? null : "Default must be true or false.";
		case "relation":
			return "Relation fields can't have a default.";
		default:
			return null;
	}
}
