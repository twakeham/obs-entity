/**
 * Choices with values: a choice or multiple-choice field can give each choice a number (`values`, when `valued`).
 * Notes keep the label; the number is looked up from the field when calculating (formulas' value(), roll-up sums,
 * sorting and summaries in views), so changing a value needs no note changes.
 */
import { asArray } from "./links";
import type { FieldDef } from "./types";

type Valued = Pick<FieldDef, "kind" | "valued" | "values">;

/** Whether a field's choices have values (choice / multiple choice with the option on). */
export const hasValues = (f: Valued | undefined): boolean => !!f && (f.kind === "select" || f.kind === "multiselect") && !!f.valued;

/** A choice's value (null: the field has no values, or this choice has none). Matches the label exactly, else ignoring case. */
export function choiceValue(f: Valued | undefined, label: string): number | null {
	if (!f || !hasValues(f) || !f.values) return null;
	const exact = f.values[label];
	if (typeof exact === "number" && Number.isFinite(exact)) return exact;
	const lower = label.toLowerCase();
	for (const [k, v] of Object.entries(f.values)) if (k.toLowerCase() === lower && typeof v === "number" && Number.isFinite(v)) return v;
	return null;
}

/**
 * A note's value for the field, from what's stored: the choice's value, or for multiple choice the total of the
 * chosen values (null when none of them has one).
 */
export function choiceValueOf(f: Valued | undefined, raw: unknown): number | null {
	if (!hasValues(f)) return null;
	const nums = asArray(raw)
		.filter((x) => x !== null && x !== undefined && String(x) !== "")
		.map((x) => choiceValue(f, String(x)))
		.filter((n): n is number => n !== null);
	if (!nums.length) return null;
	return f!.kind === "select" ? nums[0] : nums.reduce((a, b) => a + b, 0);
}

/** A choice as its pill reads: "High: 3" when the field shows values on pills, else the label. */
export function choiceText(f: (Valued & Pick<FieldDef, "showValues">) | undefined, label: string): string {
	const n = f?.showValues ? choiceValue(f, label) : null;
	return n === null ? label : `${label}: ${n}`;
}

/** A choice pill's tooltip: "High = 3" (undefined without a value). */
export function choiceTitle(f: Valued | undefined, label: string): string | undefined {
	const n = choiceValue(f, label);
	return n === null ? undefined : `${label} = ${n}`;
}

/** Only the values of choices still listed; undefined when none are left. */
export function pruneValues(values: Record<string, number> | undefined, options: string[]): Record<string, number> | undefined {
	if (!values) return undefined;
	const keep = Object.fromEntries(Object.entries(values).filter(([k, v]) => options.includes(k) && typeof v === "number" && Number.isFinite(v)));
	return Object.keys(keep).length ? keep : undefined;
}
