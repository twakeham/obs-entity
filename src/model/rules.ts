/**
 * Validation rules on a type's fields: limits on numbers, text, dates and lists, a pattern, unique values, and
 * "required when". A value that breaks a rule is still saved; it's reported as a problem (the create dialog waits).
 */
import type { DateAdapter } from "./dates";
import { asArray } from "./links";
import { isEmptyValue } from "./frontmatter";
import type { LayoutWhen } from "./formLayout";
import { isListValued, type FieldDef, type FieldKind } from "./types";

export type DateCompareOp = "before" | "not-after" | "after" | "not-before";

export interface FieldRules {
	/** number: limits (inclusive), and whole numbers only */
	min?: number;
	max?: number;
	integer?: boolean;
	/** text, long text, URL: length limits and a pattern (a regular expression) with its own message */
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	patternMessage?: string;
	/** date: bounds, "YYYY-MM-DD" or relative to today ("today", "today+14d", "today-1y"; d, w, m, y) */
	earliest?: string;
	latest?: string;
	/** date: compared with another date field of the note */
	compare?: { op: DateCompareOp; field: string };
	/** lists, multiple choice, multi-link relations: how many items */
	minItems?: number;
	maxItems?: number;
	/** no two notes of the type have the same value */
	unique?: boolean;
	/** required when these conditions hold (like "show only when") */
	requiredWhen?: LayoutWhen;
}

export const DATE_COMPARE_LABELS: Record<DateCompareOp, string> = { before: "before", "not-after": "on or before", after: "after", "not-before": "on or after" };

/** Which rule groups a field kind has. */
export function ruleGroups(f: Pick<FieldDef, "kind" | "multiple" | "labelled">): { number: boolean; text: boolean; date: boolean; items: boolean } {
	const k: FieldKind = f.kind;
	return {
		number: k === "number",
		text: k === "text" || k === "textarea" || k === "url",
		date: k === "date",
		items: k === "list" || k === "multiselect" || (k === "relation" && isListValued(f as FieldDef)),
	};
}

/** Whether "unique" makes sense for the kind (not checkboxes or calculated fields). */
export const takesUnique = (k: FieldKind) => k !== "boolean" && k !== "rollup" && k !== "formula";

/** Drops the rules the field's (new) kind can't use; removes `rules` when none are left. */
export function pruneRules(f: FieldDef): void {
	const r = f.rules;
	if (!r) return;
	const g = ruleGroups(f);
	const keep: FieldRules = {};
	if (g.number) Object.assign(keep, { min: r.min, max: r.max, integer: r.integer });
	if (g.text) Object.assign(keep, { minLength: r.minLength, maxLength: r.maxLength, pattern: r.pattern, patternMessage: r.patternMessage });
	if (g.date) Object.assign(keep, { earliest: r.earliest, latest: r.latest, compare: r.compare });
	if (g.items) Object.assign(keep, { minItems: r.minItems, maxItems: r.maxItems });
	if (takesUnique(f.kind)) keep.unique = r.unique;
	if (f.kind !== "rollup" && f.kind !== "formula") keep.requiredWhen = r.requiredWhen;
	for (const k of Object.keys(keep) as (keyof FieldRules)[]) if (keep[k] === undefined || keep[k] === false) delete keep[k];
	if (Object.keys(keep).length) f.rules = keep;
	else delete f.rules;
}

const DAY = 86_400_000;

/** A date bound in days since 1970-01-01, or null when it can't be read. */
export function boundDays(spec: string, today: number, dates: DateAdapter): number | null {
	const s = spec.trim().toLowerCase().replace(/\s+/g, "");
	const m = /^today(?:([+-])(\d+)([dwmy]))?$/.exec(s);
	if (m) {
		if (!m[1]) return today;
		const n = Number(m[2]) * (m[1] === "-" ? -1 : 1);
		if (m[3] === "d") return today + n;
		if (m[3] === "w") return today + n * 7;
		const d = new Date(today * DAY);
		if (m[3] === "m") d.setUTCMonth(d.getUTCMonth() + n);
		else d.setUTCFullYear(d.getUTCFullYear() + n);
		return Math.floor(d.getTime() / DAY);
	}
	const p = dates.parse(spec.trim());
	return p?.ok ? p.value : null;
}

/** A bound as words: "today", "today + 14 days", or the date. */
export function boundText(spec: string, show: (days: number) => string, today: number, dates: DateAdapter): string {
	const s = spec.trim().toLowerCase().replace(/\s+/g, "");
	const m = /^today(?:([+-])(\d+)([dwmy]))?$/.exec(s);
	if (m) {
		if (!m[1]) return "today";
		const unit = { d: "day", w: "week", m: "month", y: "year" }[m[3] as "d"]!;
		return `today ${m[1] === "-" ? "−" : "+"} ${m[2]} ${unit}${m[2] === "1" ? "" : "s"}`;
	}
	const d = boundDays(spec, today, dates);
	return d === null ? spec : show(d);
}

/** Problems with a field's rules (for the type editor), or []. */
export function rulesIssues(f: FieldDef, others: FieldDef[], dates: DateAdapter): string[] {
	const r = f.rules;
	if (!r) return [];
	const out: string[] = [];
	if (r.min !== undefined && r.max !== undefined && r.min > r.max) out.push("The minimum is more than the maximum.");
	if (r.minLength !== undefined && r.maxLength !== undefined && r.minLength > r.maxLength) out.push("The minimum length is more than the maximum.");
	if (r.minItems !== undefined && r.maxItems !== undefined && r.minItems > r.maxItems) out.push("The minimum number of items is more than the maximum.");
	if (r.pattern) {
		try {
			new RegExp(r.pattern, "u");
		} catch (e) {
			out.push(`The pattern isn't a valid regular expression: ${(e as Error).message}`);
		}
	}
	for (const [name, spec] of [
		["earliest", r.earliest],
		["latest", r.latest],
	] as const)
		if (spec !== undefined && boundDays(spec, 0, dates) === null) out.push(`The ${name} date "${spec}" isn't a date or "today ± N days / weeks / months / years".`);
	if (r.compare) {
		const o = others.find((x) => x.key === r.compare!.field);
		if (!o) out.push(`The date it's compared with ("${r.compare.field}") isn't a field of this type.`);
		else if (o.kind !== "date") out.push(`“${o.label || o.key}” isn't a date field.`);
	}
	return out;
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : JSON.stringify(v));

export interface RuleContext {
	dates: DateAdapter;
	today: number;
	/** a date as the form shows it */
	showDate: (days: number) => string;
	/** the note's own values (for comparisons with another field) */
	values: Record<string, unknown>;
	labelOf: (key: string) => string;
	/** other notes of the type with a value for the key (for "unique"), when known */
	others?: (key: string) => { name: string; value: unknown }[];
}

/** Messages for a value that breaks its field's rules (nothing for empty values; "required when" is checked elsewhere). */
export function ruleMessages(f: FieldDef, raw: unknown, ctx: RuleContext): string[] {
	const r = f.rules;
	if (!r || isEmptyValue(raw)) return [];
	const out: string[] = [];
	const g = ruleGroups(f);
	if (g.number && typeof raw === "number") {
		if (r.integer && !Number.isInteger(raw)) out.push("Must be a whole number.");
		const lo = r.min !== undefined && raw < r.min;
		const hi = r.max !== undefined && raw > r.max;
		if (lo || hi) out.push(r.min !== undefined && r.max !== undefined ? `Must be between ${r.min} and ${r.max}.` : lo ? `Must be at least ${r.min}.` : `Must be at most ${r.max}.`);
	}
	if (g.text && typeof raw === "string") {
		const n = [...raw].length;
		if (r.minLength !== undefined && n < r.minLength) out.push(`Must be at least ${r.minLength} character${r.minLength === 1 ? "" : "s"} (it has ${n}).`);
		if (r.maxLength !== undefined && n > r.maxLength) out.push(`Must be at most ${r.maxLength} character${r.maxLength === 1 ? "" : "s"} (it has ${n}).`);
		if (r.pattern) {
			let re: RegExp | null = null;
			try {
				re = new RegExp(r.pattern, "u");
			} catch {
				// a broken pattern is reported in the type editor
			}
			if (re && !re.test(raw)) out.push(r.patternMessage?.trim() || `Doesn't match the pattern ${r.pattern}`);
		}
	}
	if (g.date) {
		const p = ctx.dates.parse(raw);
		if (p?.ok) {
			const d = p.value;
			const early = r.earliest !== undefined ? boundDays(r.earliest, ctx.today, ctx.dates) : null;
			const late = r.latest !== undefined ? boundDays(r.latest, ctx.today, ctx.dates) : null;
			const words = (spec: string, days: number) => {
				const t = boundText(spec, ctx.showDate, ctx.today, ctx.dates);
				return t.startsWith("today") && t !== "today" ? `${t} (${ctx.showDate(days)})` : t;
			};
			if (early !== null && d < early) out.push(`Must be on or after ${words(r.earliest!, early)}.`);
			if (late !== null && d > late) out.push(`Must be on or before ${words(r.latest!, late)}.`);
			if (r.compare) {
				const o = ctx.dates.parse(ctx.values[r.compare.field]);
				if (o?.ok) {
					const ok = r.compare.op === "before" ? d < o.value : r.compare.op === "not-after" ? d <= o.value : r.compare.op === "after" ? d > o.value : d >= o.value;
					if (!ok) out.push(`Must be ${DATE_COMPARE_LABELS[r.compare.op]} ${ctx.labelOf(r.compare.field)} (${ctx.showDate(o.value)}).`);
				}
			}
		}
	}
	if (g.items) {
		const n = asArray(raw).filter((v) => !isEmptyValue(v)).length;
		if (r.minItems !== undefined && n < r.minItems) out.push(`Needs at least ${r.minItems} item${r.minItems === 1 ? "" : "s"} (it has ${n}).`);
		if (r.maxItems !== undefined && n > r.maxItems) out.push(`Can have at most ${r.maxItems} item${r.maxItems === 1 ? "" : "s"} (it has ${n}).`);
	}
	if (r.unique && ctx.others) {
		const same = ctx.others(f.key).filter((o) => !isEmptyValue(o.value) && norm(o.value) === norm(raw));
		if (same.length) out.push(`Must be unique: ${same.length === 1 ? `“${same[0].name}” has` : `${same.length} other notes have`} the same value.`);
	}
	return out;
}
