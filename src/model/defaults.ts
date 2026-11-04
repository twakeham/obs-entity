/**
 * Smarter defaults for new notes: a date relative to today, a value copied from a linked note (e.g. a task takes its
 * project's client), or the next number for the type (TASK-0042). Defaults only fill in new notes.
 */
import { isoDateAdapter, type DateAdapter } from "./dates";
import { defaultFieldValue, isEmptyValue, type EntityFormValues, type FieldValue } from "./frontmatter";
import { todayDays } from "./formConditions";
import { asArray, parseLink } from "./links";
import { boundDays } from "./rules";
import { isCalculated, statusesFor, typeMatchesTarget, storedFields, type EntityTypeDef, type FieldDef, type GroupDef } from "./types";

export type DefaultFrom =
	/** dates: "today", "today+14d", "today-1m" (d, w, m, y) */
	| { kind: "relative"; spec: string }
	/** copy `field` of the note this note links to through its relation field `via` */
	| { kind: "linked"; via: string; field: string }
	/** text and numbers: the next number for the type, in a pattern with {n} ("TASK-{n}"), padded with zeros */
	| { kind: "auto"; pattern?: string; pad?: number };

/** Which default kinds a field kind can have ("fixed" is the plain `default` value). */
export function defaultKinds(f: Pick<FieldDef, "kind">): ("fixed" | DefaultFrom["kind"])[] {
	if (isCalculated(f)) return [];
	const out: ("fixed" | DefaultFrom["kind"])[] = f.kind === "relation" ? [] : ["fixed"];
	if (f.kind === "date") out.push("relative");
	out.push("linked");
	if (f.kind === "text" || f.kind === "number") out.push("auto");
	return out;
}

const pad = (n: number, width = 0) => String(n).padStart(width, "0");

/** A number in an auto-number pattern: "TASK-{n}" with 4 digits → "TASK-0042". */
export function autoText(d: Extract<DefaultFrom, { kind: "auto" }>, n: number): string {
	const p = d.pattern?.includes("{n}") ? d.pattern : "{n}";
	return p.replace("{n}", pad(n, d.pad ?? 0));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The next auto number: one more than the highest already used by notes of the type (1 when none). */
export function nextAutoNumber(f: Pick<FieldDef, "kind">, d: Extract<DefaultFrom, { kind: "auto" }>, existing: unknown[]): number {
	let max = 0;
	if (f.kind === "number") {
		for (const v of existing) if (typeof v === "number" && Number.isFinite(v)) max = Math.max(max, Math.floor(v));
	} else {
		const p = d.pattern?.includes("{n}") ? d.pattern : "{n}";
		const [before, after] = p.split("{n}");
		const re = new RegExp(`^${escape(before)}(\\d+)${escape(after ?? "")}$`);
		for (const v of existing) {
			const m = typeof v === "string" ? re.exec(v.trim()) : null;
			if (m) max = Math.max(max, Number(m[1]));
		}
	}
	return max + 1;
}

/** The value an auto-number default gives: a number, or text in its pattern. */
export const autoValue = (f: Pick<FieldDef, "kind">, d: Extract<DefaultFrom, { kind: "auto" }>, n: number): string | number => (f.kind === "number" ? n : autoText(d, n));

/** A date default relative to today, as stored (YYYY-MM-DD), or null when the spec can't be read. */
export function relativeDate(spec: string, today: number, dates: DateAdapter): string | null {
	const d = boundDays(spec, today, dates);
	return d === null ? null : dates.format(d, "short");
}

/** The first link in a relation value, as a link path. */
export function firstLink(v: unknown): string | null {
	for (const e of asArray(v)) {
		const l = typeof e === "string" ? parseLink(e) : e && typeof e === "object" && "target" in e ? parseLink(String((e as { target: string }).target)) : null;
		if (l?.path) return l.path;
		if (typeof e === "string" && e.trim() && !e.includes("[[")) return e.trim();
	}
	return null;
}

/**
 * Values copied from linked notes for "from a linked note" defaults. `fields` are the new note's values so far;
 * `read(linkpath)` gives a linked note's frontmatter. Only fields in `fill` (empty, not typed in) are returned.
 */
export function linkedValues(type: EntityTypeDef, fields: Record<string, unknown>, read: (linkpath: string) => Record<string, unknown> | null, fill: (key: string) => boolean): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const f of type.fields) {
		const d = f.defaultFrom;
		if (d?.kind !== "linked" || !fill(f.key)) continue;
		const link = firstLink(fields[d.via]);
		const fm = link ? read(link) : null;
		const v = fm?.[d.field];
		if (!isEmptyValue(v)) out[f.key] = v;
	}
	return out;
}

/** The types a relation field can link to. */
export const linkedTypes = (via: FieldDef, types: EntityTypeDef[]): EntityTypeDef[] => types.filter((t) => typeMatchesTarget(t, via.targets));

/** Problems with a field's default (for the type editor), or []. */
export function defaultIssues(f: FieldDef, type: EntityTypeDef, types: EntityTypeDef[] | undefined, dates: DateAdapter): string[] {
	const d = f.defaultFrom;
	if (!d) return [];
	if (!defaultKinds(f).includes(d.kind)) return ["This kind of default doesn't suit the field."];
	switch (d.kind) {
		case "relative":
			return boundDays(d.spec, 0, dates) === null ? [`"${d.spec}" isn't "today" or "today ± N days / weeks / months / years".`] : [];
		case "auto":
			return f.kind === "text" && d.pattern && !d.pattern.includes("{n}") ? ["Put {n} in the pattern where the number goes."] : [];
		case "linked": {
			const via = type.fields.find((x) => x.key === d.via);
			if (!via || via.kind !== "relation") return [`Choose a relation field to copy from.`];
			if (!d.field) return ["Choose the field to copy."];
			if (!types) return [];
			return linkedTypes(via, types).some((t) => t.fields.some((x) => x.key === d.field)) ? [] : [`The linked notes have no “${d.field}” field.`];
		}
	}
}

/** Blank form values for a type: first status, field defaults (dates relative to today worked out). */
export function emptyFormValues(type: EntityTypeDef, groups: GroupDef[], name = "", opts: { today?: number; dates?: DateAdapter } = {}): EntityFormValues {
	const fields: Record<string, FieldValue> = {};
	for (const f of storedFields(type)) {
		if (f.defaultFrom?.kind === "relative") {
			const d = relativeDate(f.defaultFrom.spec, opts.today ?? todayDays(), opts.dates ?? isoDateAdapter);
			if (d) fields[f.key] = d;
			continue;
		}
		if (f.defaultFrom) continue;
		const d = defaultFieldValue(f);
		if (d !== undefined) fields[f.key] = d;
	}
	return { name, status: statusesFor(type, groups)[0], tags: [], fields };
}
