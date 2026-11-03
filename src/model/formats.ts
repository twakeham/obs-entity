/** Display formats for view columns: moment.js date patterns and number presets / spreadsheet-style patterns. */

/** The bit of moment.js the formats need (Obsidian's `moment`, or the npm package in tests). */
export interface MomentLike {
	/** a time in ms; or text read strictly in a pattern (check `isValid`) */
	utc(input: number | string, pattern?: string, strict?: boolean): { format(pattern: string): string; isValid?(): boolean };
	locale(): string;
}

export const RELATIVE = "relative";

export const DATE_PRESETS: { format: string; label: string }[] = [
	{ format: "YYYY-MM-DD", label: "ISO" },
	{ format: "D MMM YYYY", label: "Day month year" },
	{ format: "D MMMM YYYY", label: "Day month name year" },
	{ format: "ddd D MMM", label: "Weekday" },
	{ format: "dddd, D MMMM YYYY", label: "Long" },
	{ format: "DD/MM/YYYY", label: "Day first" },
	{ format: "MM/DD/YYYY", label: "Month first" },
	{ format: "MMMM YYYY", label: "Month" },
	{ format: RELATIVE, label: "Relative" },
];

export const NUMBER_PRESETS: { format: string; label: string }[] = [
	{ format: "number", label: "Number" },
	{ format: "integer", label: "Integer" },
	{ format: "decimal:2", label: "2 decimals" },
	{ format: "currency", label: "Currency" },
	{ format: "compact", label: "Compact" },
	{ format: "percent", label: "Percent (0–100)" },
];

const MS_PER_DAY = 86_400_000;

/** "in 3 days", "2 weeks ago", "today"… relative to `today` (both in days). */
export function relativeDays(days: number, today: number): string {
	const diff = days - today;
	if (diff === 0) return "today";
	if (diff === 1) return "tomorrow";
	if (diff === -1) return "yesterday";
	const n = Math.abs(diff);
	const [amount, unit] = n < 14 ? [n, "day"] : n < 60 ? [Math.round(n / 7), "week"] : n < 365 ? [Math.round(n / 30.44), "month"] : [Math.round(n / 365.25), "year"];
	const text = `${amount} ${unit}${amount === 1 ? "" : "s"}`;
	return diff > 0 ? `in ${text}` : `${text} ago`;
}

/** A date (days since 1970-01-01) in a moment.js pattern, or "relative". */
export function formatDate(days: number, format: string, moment: MomentLike, today: number): string {
	if (format === RELATIVE) return relativeDays(days, today);
	return moment.utc(days * MS_PER_DAY).format(format);
}

interface Pattern {
	prefix: string;
	suffix: string;
	grouping: boolean;
	min: number;
	max: number;
}

/** Read a spreadsheet-style pattern: text, then `#,##0.00`, then text. Null when there's no number part. */
export function parseNumberPattern(format: string): Pattern | null {
	const m = /[#0][#0,]*(?:\.[#0]+)?|\.[#0]+/.exec(format);
	if (!m) return null;
	const body = m[0];
	const decimals = body.includes(".") ? body.slice(body.indexOf(".") + 1) : "";
	return {
		prefix: format.slice(0, m.index),
		suffix: format.slice(m.index + body.length),
		grouping: body.includes(","),
		min: (decimals.match(/0/g) ?? []).length,
		max: decimals.length,
	};
}

/**
 * A number in a format: "number", "integer", "decimal:N", "currency" / "currency:CODE", "compact", "percent",
 * or a pattern such as "$#,##0.00" or "#,##0 h".
 */
export function formatNumber(n: number, format: string, locale: string, defaultCurrency = "AUD"): string {
	const nf = (opts: Intl.NumberFormatOptions) => {
		try {
			return new Intl.NumberFormat(locale, opts).format(n);
		} catch {
			return new Intl.NumberFormat(undefined, opts).format(n);
		}
	};
	const [kind, arg] = format.split(":");
	switch (kind) {
		case "number":
			return nf({ maximumFractionDigits: 2 });
		case "integer":
			return nf({ maximumFractionDigits: 0 });
		case "decimal": {
			const d = Math.max(0, Math.min(10, Number(arg ?? 2) || 0));
			return nf({ minimumFractionDigits: d, maximumFractionDigits: d });
		}
		case "currency": {
			const code = (arg || defaultCurrency).toUpperCase();
			try {
				return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(n);
			} catch {
				return `${nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
			}
		}
		case "compact":
			return nf({ notation: "compact", maximumFractionDigits: 1 });
		case "percent":
			return `${nf({ maximumFractionDigits: 1 })}%`;
	}
	const p = parseNumberPattern(format);
	if (!p) return String(n);
	return `${p.prefix}${nf({ useGrouping: p.grouping, minimumFractionDigits: p.min, maximumFractionDigits: p.max })}${p.suffix}`;
}

/** Why a format can't be used, or null. */
export function formatIssue(kind: "number" | "date", format: string): string | null {
	if (!format.trim()) return "Enter a format.";
	if (kind === "number") {
		const [k, arg] = format.split(":");
		if (k === "currency" && arg && !/^[A-Za-z]{3}$/.test(arg)) return "Currency codes have three letters, e.g. AUD.";
		if (["number", "integer", "decimal", "currency", "compact", "percent"].includes(k)) return null;
		return parseNumberPattern(format) ? null : "A number pattern needs # or 0, e.g. #,##0.00.";
	}
	return null;
}
