import { unknownPlaceholders } from "./paths";
import { fieldFormatIssue } from "./fieldFormats";
import { todayDays, whenColumns, whenIssues } from "./formConditions";
import { layoutIssues, normaliseLayout, whenParts } from "./formLayout";
import { RESERVED_KEYS, isCalculated, isValidKey, type EntityTypeDef, type GroupDef } from "./types";
import { calcInfo, columnFromId, conditionText, NEEDS_VALUE, rollupFilterColumns, rollupIgnored, rollupLinkedTypes } from "./views";
import { rulesIssues } from "./rules";
import { defaultIssues } from "./defaults";
import { isoDateAdapter } from "./dates";

/** A problem with a type definition, tied to the control it belongs to. */
export interface TypeIssue {
	/**
	 * Where: "key", "name", "group", "statuses", "folderPattern", "parentFields", "card:subtitle", "card:fields", "form:layout",
	 * "field:<i>:key", "field:<i>:options", "field:<i>:targets", "field:<i>:default", "field:<i>:format", "field:<i>:calc".
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
	/** every type and group (as edited), to check calculated fields; without them they aren't checked */
	types?: EntityTypeDef[];
	groups?: GroupDef[];
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
	if (typeof t.folderPattern === "string") {
		const unknown = unknownPlaceholders(t.folderPattern);
		if (unknown.length) add("folderPattern", `Unknown placeholder${unknown.length === 1 ? "" : "s"} in the folder: ${unknown.map((u) => `{${u}}`).join(", ")}. Use {group} or {entity}.`);
	}

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
		const defaultProblem = isCalculated(f) ? null : checkDefault(f.kind, f.default, f.options);
		if (defaultProblem) add(`field:${i}:default`, defaultProblem);
		const formatProblem = isCalculated(f) ? null : fieldFormatIssue(f.kind, f.format);
		if (formatProblem) add(`field:${i}:format`, formatProblem);
		for (const m of rulesIssues(f, t.fields, isoDateAdapter)) add(`field:${i}:rules`, m);
		for (const m of defaultIssues(f, t, ctx.types ? [...ctx.types.filter((x) => x.key !== t.key), t] : undefined, isoDateAdapter)) add(`field:${i}:default`, m);
		if (f.rules?.requiredWhen) {
			const ids = new Set(whenColumns(t, { groups: ctx.groups ?? [] }).map((c) => c.id));
			for (const c of whenParts(f.rules.requiredWhen).items) {
				if (ids.has(c.field)) continue;
				const col = columnFromId(c.field);
				add(`field:${i}:rules`, `“Required when” uses “${col.kind === "field" ? col.key : c.field}”, which isn't a field of this type. It's ignored until it's fixed.`);
			}
		}
		// Calculated fields: checked against every type (as edited), when the caller has them.
		if (isCalculated(f) && ctx.types && f.key) {
			const types = [...ctx.types.filter((x) => x.key !== t.key), t];
			const calc = calcInfo(t, f, { types, groups: ctx.groups ?? [] });
			if (calc.invalid) add(`field:${i}:calc`, `${f.label || f.key}: ${calc.invalid}`);
			// Roll-up filters: broken conditions (ones still waiting for a value are only noted in the builder).
			if (f.kind === "rollup" && f.rollup?.where) {
				const cols = { types, groups: ctx.groups ?? [], dates: isoDateAdapter, today: todayDays() };
				const linked = rollupLinkedTypes(f.rollup, [t], types);
				const known = new Map(rollupFilterColumns(linked, cols).map((c) => [c.col.id, c.col]));
				for (const x of rollupIgnored(f.rollup, [t], cols))
					if (x.issue !== NEEDS_VALUE) add(`field:${i}:calc`, `${f.label || f.key}: the condition “${conditionText(x.cond, known)}” is ignored: ${x.issue}`);
			}
		}
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
	const layout = t.form?.layout ? normaliseLayout(t.form.layout) : null;
	if (layout) for (const m of [...layoutIssues(layout, t), ...whenIssues(layout, t, [])]) add("form:layout", m);
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
		case "date":
			return /^-?\d{1,6}-\d{1,2}-\d{1,2}$/.test(String(value)) ? null : `Default "${String(value)}" isn't a date. Use YYYY-MM-DD.`;
		case "boolean":
			return typeof value === "boolean" ? null : "Default must be true or false.";
		case "relation":
			return "Relation fields can't have a default.";
		default:
			return null;
	}
}
