/**
 * Dashboard filters (DESIGN §8.12, D3): a filter component holds a value someone picks (notes, choices, text, a
 * date range, a number range or yes / no). Components use it explicitly: a condition's value can be the filter
 * (`{<filter id>}`), and card formulas, captions and formula sources can name it by title (`[Campaign]`). A filter
 * with nothing picked does nothing: conditions using it are left out.
 */
import { DateVal, type FValue } from "./formula";
import { isGroup, THIS_NOTE, type Condition, type FilterGroup, type LinkValue, type ViewContext, type ViewDef } from "./views";

export const FILTER_CONTROLS = ["note", "choice", "search", "dates", "number", "toggle"] as const;
export type FilterControl = (typeof FILTER_CONTROLS)[number];
export const FILTER_CONTROL_LABELS: Record<FilterControl, string> = { note: "Note", choice: "Choice", search: "Search", dates: "Dates", number: "Number", toggle: "Yes / no" };
export const FILTER_CONTROL_ICONS: Record<FilterControl, string> = { note: "file-search", choice: "list-checks", search: "search", dates: "calendar-range", number: "sliders-horizontal", toggle: "toggle-left" };

/** Which control fills a condition value of each kind (`OPERATORS[...].value`). */
export const CONTROL_FOR_VALUE: Partial<Record<string, FilterControl>> = { links: "note", choices: "choice", text: "search", range: "dates", numrange: "number", bool: "toggle" };

export const DATE_PRESETS = [
	["today", "Today"],
	["this-week", "This week"],
	["this-month", "This month"],
	["this-year", "This year"],
	["last-7", "Last 7 days"],
	["last-30", "Last 30 days"],
	["next-7", "Next 7 days"],
	["next-30", "Next 30 days"],
	["custom", "Custom…"],
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number][0];

/** What's picked in a filter. A filter with nothing picked has no value (undefined). */
export type FilterValue =
	| { kind: "note"; paths: string[] }
	| { kind: "choice"; values: string[] }
	| { kind: "search"; text: string }
	| { kind: "dates"; preset: DatePreset; from?: string; to?: string }
	| { kind: "number"; min?: number; max?: number }
	| { kind: "toggle"; on: boolean };

export type FilterValues = Record<string, FilterValue | undefined>;

/** Whether a value picks nothing (and so filters nothing). */
export function isEmptyFilter(v: FilterValue | undefined): boolean {
	if (!v) return true;
	switch (v.kind) {
		case "note":
			return v.paths.length === 0;
		case "choice":
			return v.values.length === 0;
		case "search":
			return !v.text.trim();
		case "dates":
			return v.preset === "custom" && !v.from?.trim() && !v.to?.trim();
		case "number":
			return v.min === undefined && v.max === undefined;
		case "toggle":
			return false;
	}
}

/** A condition value standing for a filter. */
export const filterToken = (id: string) => `{${id}}`;

/** The filter id a condition value stands for (`{id}`, alone or as a one-item list), else null. "{this}" isn't one. */
export function tokenOf(value: unknown): string | null {
	const v = Array.isArray(value) && value.length === 1 ? value[0] : value;
	if (typeof v !== "string" || v === THIS_NOTE) return null;
	const m = /^\{([^{}]+)\}$/.exec(v.trim());
	return m ? m[1] : null;
}

const DAY_MS = 86_400_000;

/** A date range preset as [first, last] day (days since 1970), from today. */
export function presetRange(preset: Exclude<DatePreset, "custom">, today: number): [number, number] {
	const d = new Date(today * DAY_MS);
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth();
	const day = (ms: number) => Math.floor(ms / DAY_MS);
	switch (preset) {
		case "today":
			return [today, today];
		case "this-week": {
			const monday = today - ((d.getUTCDay() + 6) % 7);
			return [monday, monday + 6];
		}
		case "this-month":
			return [day(Date.UTC(y, m, 1)), day(Date.UTC(y, m + 1, 0))];
		case "this-year":
			return [day(Date.UTC(y, 0, 1)), day(Date.UTC(y, 11, 31))];
		case "last-7":
			return [today - 6, today];
		case "last-30":
			return [today - 29, today];
		case "next-7":
			return [today, today + 6];
		case "next-30":
			return [today, today + 29];
	}
}

/** The value a condition takes from a filter that has something picked. */
export function conditionValue(v: FilterValue, today: number): unknown {
	switch (v.kind) {
		case "note":
			return v.paths;
		case "choice":
			return v.values;
		case "search":
			return v.text.trim();
		case "dates": {
			if (v.preset === "custom") return [v.from?.trim() ?? "", v.to?.trim() ?? ""];
			// As days from today ("-6d"), which date conditions read whatever the date format.
			const [a, b] = presetRange(v.preset, today);
			return [`${a - today}d`, `${b - today}d`];
		}
		case "number":
			return [v.min ?? "", v.max ?? ""];
		case "toggle":
			return v.on;
	}
}

/**
 * A filter group with filters filled in: a condition whose value is a filter takes what's picked in it, and is left
 * out when nothing is (or there's no such filter), so an empty filter doesn't narrow anything.
 */
export function groupWithFilters(g: FilterGroup, values: FilterValues, today: number): FilterGroup {
	const items: (Condition | FilterGroup)[] = [];
	for (const i of g.items) {
		if (isGroup(i)) {
			items.push(groupWithFilters(i, values, today));
			continue;
		}
		const id = tokenOf(i.value);
		if (id === null) {
			items.push(i);
			continue;
		}
		const v = values[id];
		if (!isEmptyFilter(v)) items.push({ ...i, value: conditionValue(v!, today) });
	}
	return { ...g, items };
}

/** Whether a filter group uses a filter. */
export function usesFilters(g: FilterGroup): boolean {
	return g.items.some((i) => (isGroup(i) ? usesFilters(i) : tokenOf(i.value) !== null));
}

/** A view definition with filters filled in, in its filters, highlight rules and roll-up columns' filters. */
export function withFilters(def: ViewDef, values: FilterValues, today: number): ViewDef {
	const uses = usesFilters(def.filters) || (def.highlight ?? []).some((r) => usesFilters(r.when)) || def.columns.some((c) => c.kind === "rollup" && !!c.rollup.where && usesFilters(c.rollup.where));
	if (!uses) return def;
	const group = (g: FilterGroup) => groupWithFilters(g, values, today);
	return {
		...def,
		filters: group(def.filters),
		columns: def.columns.map((c) => (c.kind === "rollup" && c.rollup.where ? { ...c, rollup: { ...c.rollup, where: group(c.rollup.where) } } : c)),
		...(def.highlight ? { highlight: def.highlight.map((r) => ({ ...r, when: group(r.when) })) } : {}),
	};
}

const linkOf = (path: string, ctx: ViewContext): LinkValue => ({ path, linktext: path.replace(/\.md$/, "").split("/").pop() ?? path, name: ctx.row(path)?.name ?? path.replace(/\.md$/, "").split("/").pop() ?? path });

/**
 * A filter's value in formulas (`[Campaign]`): the note (or a list of notes), the choice (or a list), the text,
 * [from, to] dates, [min, max] numbers, or true / false. Nothing picked: empty (null).
 */
export function filterFValue(v: FilterValue | undefined, ctx: ViewContext): FValue {
	if (!v || isEmptyFilter(v)) return null;
	switch (v.kind) {
		case "note":
			return v.paths.length === 1 ? linkOf(v.paths[0], ctx) : v.paths.map((p) => linkOf(p, ctx));
		case "choice":
			return v.values.length === 1 ? v.values[0] : v.values;
		case "search":
			return v.text.trim();
		case "dates": {
			const [a, b] =
				v.preset === "custom"
					? [v.from, v.to].map((x) => {
							const p = x?.trim() ? ctx.dates.parse(x.trim()) : null;
							return p?.ok ? p.value : null;
						})
					: presetRange(v.preset, ctx.today);
			return [a === null ? null : new DateVal(a), b === null ? null : new DateVal(b)];
		}
		case "number":
			return [v.min ?? null, v.max ?? null];
		case "toggle":
			return v.on;
	}
}

/** A filter's value as text (captions, descriptions): what's picked, or "All". */
export function filterText(v: FilterValue | undefined, ctx: ViewContext): string {
	if (!v || isEmptyFilter(v)) return "All";
	switch (v.kind) {
		case "note":
			return v.paths.map((p) => linkOf(p, ctx).name).join(", ");
		case "choice":
			return v.values.join(", ");
		case "search":
			return `“${v.text.trim()}”`;
		case "dates": {
			if (v.preset !== "custom") return DATE_PRESETS.find(([k]) => k === v.preset)![1];
			const f = v.from?.trim();
			const t = v.to?.trim();
			return f && t ? `${f} – ${t}` : f ? `from ${f}` : `until ${t}`;
		}
		case "number":
			return v.min !== undefined && v.max !== undefined ? `${v.min}–${v.max}` : v.min !== undefined ? `≥ ${v.min}` : `≤ ${v.max}`;
		case "toggle":
			return v.on ? "Yes" : "No";
	}
}

/** Read a stored value (remembered on this device), keeping only a well-formed one of the filter's kind. */
export function parseFilterValue(raw: unknown, control: FilterControl): FilterValue | undefined {
	if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== control) return undefined;
	const r = raw as Record<string, unknown>;
	const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
	const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
	switch (control) {
		case "note":
			return { kind: "note", paths: strings(r.paths) };
		case "choice":
			return { kind: "choice", values: strings(r.values) };
		case "search":
			return typeof r.text === "string" ? { kind: "search", text: r.text } : undefined;
		case "dates": {
			const preset = DATE_PRESETS.find(([k]) => k === r.preset)?.[0];
			if (!preset) return undefined;
			return { kind: "dates", preset, ...(typeof r.from === "string" ? { from: r.from } : {}), ...(typeof r.to === "string" ? { to: r.to } : {}) };
		}
		case "number":
			return { kind: "number", ...(num(r.min) !== undefined ? { min: num(r.min) } : {}), ...(num(r.max) !== undefined ? { max: num(r.max) } : {}) };
		case "toggle":
			return typeof r.on === "boolean" ? { kind: "toggle", on: r.on } : undefined;
	}
}
