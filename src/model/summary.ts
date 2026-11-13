import { formatNumber } from "./formats";
import { hasValues } from "./choiceValues";
import { defaultFormat, formatCell, type Cell, type LinkValue, type ResolvedColumn, type ResultRow, type ViewContext } from "./views";

/** A summary for one column over some rows: a short label ("Sum") and the value text ("$1,240.00"). */
export interface SummaryResult {
	label: string;
	text: string;
	/** the number behind the text (percentages as a fraction, dates as days), for formulas over summaries; unset for lists of values */
	value?: number;
	/** `value` is a date */
	date?: true;
}

export interface SummaryOption {
	key: string;
	label: string;
}

const COMMON: SummaryOption[] = [
	{ key: "count", label: "Count" },
	{ key: "empty", label: "Empty" },
	{ key: "filled", label: "Filled" },
	{ key: "percent-filled", label: "% filled" },
	{ key: "unique", label: "Unique" },
];
const NUMBER: SummaryOption[] = [
	{ key: "sum", label: "Sum" },
	{ key: "avg", label: "Average" },
	{ key: "median", label: "Median" },
	{ key: "min", label: "Min" },
	{ key: "max", label: "Max" },
	{ key: "range", label: "Range" },
];
const DATE: SummaryOption[] = [
	{ key: "earliest", label: "Earliest" },
	{ key: "latest", label: "Latest" },
	{ key: "range", label: "Range" },
];
const BOOL: SummaryOption[] = [
	{ key: "checked", label: "Checked" },
	{ key: "unchecked", label: "Unchecked" },
	{ key: "percent-checked", label: "% checked" },
];

/** Aggregations a column offers, in menu order (kind-specific first). `values` lists the column's choices for "% <value>". */
export function summaryOptions(col: ResolvedColumn, values: string[] = []): SummaryOption[] {
	if (col.id === "name") return [{ key: "count", label: "Count" }];
	switch (col.kind) {
		case "number":
			return [...NUMBER, ...COMMON];
		case "date":
			return [...DATE, ...COMMON];
		case "bool":
			return [...BOOL, { key: "count", label: "Count" }];
		case "choice":
			// Choices with values add up too.
			return [{ key: "values", label: "Count each value" }, ...values.map((v) => ({ key: `percent:${v}`, label: `% ${v}` })), ...(hasValues(col.field) ? NUMBER : []), ...COMMON];
		case "multi":
		case "links":
			return [{ key: "links", label: "Total values" }, ...(hasValues(col.field) ? NUMBER : []), ...COMMON];
		default:
			return COMMON;
	}
}

/** Whether an aggregation applies to a column (unknown or mismatched ones show nothing). */
export function summaryApplies(col: ResolvedColumn, agg: string): boolean {
	if (agg.startsWith("percent:")) return col.kind === "choice" && agg.length > 8;
	return summaryOptions(col).some((o) => o.key === agg);
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const frac = (n: number, of: number) => (of ? { value: n / of } : {});

/** Values of a list or links cell, as keys for counting distinct values. */
function keysOf(v: unknown): string[] {
	if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? ((x as LinkValue).path ?? `?${(x as LinkValue).linktext}`) : String(x)));
	return isEmpty(v) ? [] : [String(v)];
}

/** "12 days", "3 weeks", "4 months", "2 years" for a span of days. */
export function spanText(days: number): string {
	const d = Math.abs(Math.round(days));
	const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
	if (d < 14) return unit(d, "day");
	if (d < 60) return unit(Math.round(d / 7), "week");
	if (d < 730) return unit(Math.round(d / 30.44), "month");
	return unit(Math.round((d / 365.25) * 10) / 10, "year");
}

/**
 * One column's summary over `rows` (each counted once). Number and date results use the column's display
 * format; counts and percentages are plain. Null when the aggregation doesn't apply to the column.
 */
export function summarize(
	rows: ResultRow[],
	col: ResolvedColumn,
	agg: string,
	ctx: Pick<ViewContext, "dates" | "today" | "moment" | "locale" | "currency" | "dateFormat">,
	format?: string,
): SummaryResult | null {
	if (col.invalid || !summaryApplies(col, agg)) return null;
	const cells: Cell[] = rows.map((r) => r.cells[col.id] ?? { value: null, text: "", sort: null });
	const values = cells.map((c) => c.value);
	const filled = values.filter((v) => !isEmpty(v));
	const total = rows.length;
	const plain = (n: number) => formatNumber(n, "number", ctx.locale ?? "en");
	const isPercentRollup = col.def.kind === "rollup" && (col.def.rollup.agg === "percent-done" || !!col.def.rollup.show);
	// The column's format (the view's, else the field's / the Date display format setting).
	const fmt = format ?? defaultFormat(col, ctx);
	const num = (n: number) => {
		if (fmt) return formatCell({ value: n, text: String(n), sort: n }, col, fmt, ctx).text;
		return isPercentRollup ? `${Math.round(n)}%` : plain(n);
	};
	const date = (d: number) => (fmt ? formatCell({ value: d, text: "", sort: d }, col, fmt, ctx).text : ctx.dates.format(d, "short"));
	// A choice field with values: its numbers (each note's choice value, or total for multiple choice).
	const numbers = (hasValues(col.field) ? cells.map((c) => c.num) : values).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
	const sorted = [...numbers].sort((a, b) => a - b);

	if (agg.startsWith("percent:")) {
		const want = agg.slice(8);
		const n = values.filter((v) => v === want).length;
		return { label: want, text: pct(n, total), ...frac(n, total) };
	}
	switch (agg) {
		case "count":
			{
			const n = col.id === "name" ? total : filled.length;
			return { label: "Count", text: plain(n), value: n };
		}
		case "empty":
			return { label: "Empty", text: plain(total - filled.length), value: total - filled.length };
		case "filled":
			return { label: "Filled", text: `${filled.length}/${total}`, value: filled.length };
		case "percent-filled":
			return { label: "Filled", text: pct(filled.length, total), ...frac(filled.length, total) };
		case "unique":
			{
			const n = new Set(values.flatMap(keysOf)).size;
			return { label: "Unique", text: plain(n), value: n };
		}
		case "links":
			{
			const n = values.reduce<number>((k, v) => k + keysOf(v).length, 0);
			return { label: "Total", text: plain(n), value: n };
		}
		case "checked":
			return { label: "Checked", text: plain(values.filter((v) => v === true).length), value: values.filter((v) => v === true).length };
		case "unchecked":
			return { label: "Unchecked", text: plain(values.filter((v) => v !== true).length), value: values.filter((v) => v !== true).length };
		case "percent-checked":
			return { label: "Checked", text: pct(values.filter((v) => v === true).length, total), ...frac(values.filter((v) => v === true).length, total) };
		case "values": {
			const counts = new Map<string, { n: number; order: number; text: string }>();
			for (const c of cells) {
				if (isEmpty(c.value)) continue;
				const k = String(c.value);
				const e = counts.get(k) ?? { n: 0, order: typeof c.sort === "number" ? c.sort : Infinity, text: c.text || k };
				e.n++;
				counts.set(k, e);
			}
			const list = [...counts.values()].sort((a, b) => a.order - b.order || b.n - a.n || a.text.localeCompare(b.text));
			return { label: "", text: list.length ? list.map((e) => `${e.n} ${e.text}`).join(" · ") : "–" };
		}
	}
	if (!sorted.length) return { label: labelOf(agg), text: "–" };
	const sum = sorted.reduce((n, x) => n + x, 0);
	if (col.kind === "date") {
		switch (agg) {
			case "earliest":
				return { label: "Earliest", text: date(sorted[0]), value: sorted[0], date: true };
			case "latest":
				return { label: "Latest", text: date(sorted[sorted.length - 1]), value: sorted[sorted.length - 1], date: true };
			case "range":
				return { label: "Range", text: spanText(sorted[sorted.length - 1] - sorted[0]), value: sorted[sorted.length - 1] - sorted[0] };
		}
		return null;
	}
	switch (agg) {
		case "sum":
			return { label: "Sum", text: num(sum), value: sum };
		case "avg":
			return { label: "Avg", text: num(sum / sorted.length), value: sum / sorted.length };
		case "median": {
			const m = sorted.length >> 1;
			const med = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
			return { label: "Median", text: num(med), value: med };
		}
		case "min":
			return { label: "Min", text: num(sorted[0]), value: sorted[0] };
		case "max":
			return { label: "Max", text: num(sorted[sorted.length - 1]), value: sorted[sorted.length - 1] };
		case "range":
			return { label: "Range", text: num(sorted[sorted.length - 1] - sorted[0]), value: sorted[sorted.length - 1] - sorted[0] };
	}
	return null;
}

function labelOf(agg: string): string {
	return { sum: "Sum", avg: "Avg", median: "Median", min: "Min", max: "Max", range: "Range", earliest: "Earliest", latest: "Latest" }[agg] ?? agg;
}
