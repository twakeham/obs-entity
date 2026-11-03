/**
 * Display formats for a type's fields: how number, date, checkbox and URL values are shown (the stored value never
 * changes), and how typed dates and numbers are read back.
 */
import type { DateAdapter } from "./dates";
import type { InputResult } from "./form";
import { formatDate, formatIssue, formatNumber, RELATIVE, type MomentLike } from "./formats";
import type { FieldDef, FieldKind } from "./types";

/** Everything needed to show and read formatted values. */
export interface FormatEnv {
	dates: DateAdapter;
	/** moment.js (Obsidian's), for date patterns; without it dates use the adapter's own display */
	moment?: MomentLike;
	/** number locale (separators) */
	locale: string;
	/** the Default currency setting */
	currency: string;
	/** today, in days since 1970-01-01 (for relative dates) */
	today: number;
	/** the Date display format setting: dates without a format of their own */
	dateFormat: string;
}

export type FormattedKind = "number" | "date" | "boolean" | "url";

export const formattedKind = (kind: FieldKind): FormattedKind | null => (kind === "number" || kind === "date" || kind === "boolean" || kind === "url" ? kind : null);

/** The Date display format setting's starting value. */
export const DEFAULT_DATE_FORMAT = "DD/MM/YYYY";

/** Date presets for fields and the Date display format setting (moment.js patterns, or "relative"). */
export const FIELD_DATE_PRESETS: string[] = ["YYYY-MM-DD", "D MMM YYYY", "D MMMM YYYY", "ddd D MMM", "dddd, D MMMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "MMMM YYYY", RELATIVE];

/** Dropdown labels for date presets: the example, with the pattern added where two examples look the same (May). */
export function datePresetLabels(example: (pattern: string) => string): { pattern: string; label: string }[] {
	const shown = FIELD_DATE_PRESETS.map((p) => ({ pattern: p, text: example(p) }));
	return shown.map(({ pattern, text }) => ({
		pattern,
		label: pattern === RELATIVE ? `Relative (${text})` : shown.filter((s) => s.text === text).length > 1 ? `${text} (${pattern})` : text,
	}));
}

export const FIELD_NUMBER_PRESETS: { format: string; label: string }[] = [
	{ format: "number", label: "Separators" },
	{ format: "integer", label: "Whole number" },
	{ format: "decimal:2", label: "2 decimals" },
	{ format: "currency", label: "Currency" },
	{ format: "percent", label: "Percent" },
	{ format: "compact", label: "Compact" },
];

export const BOOLEAN_FORMATS: { format: string; label: string }[] = [
	{ format: "checkbox", label: "Checkbox" },
	{ format: "yesno", label: "Yes / No" },
	{ format: "check", label: "✓ / blank" },
];

export const URL_FORMATS: { format: string; label: string }[] = [
	{ format: "full", label: "Full address" },
	{ format: "domain", label: "Domain only" },
	{ format: "text", label: "Custom text" },
];

/** A URL format showing fixed text: "text:Website". */
export const urlText = (format: string | undefined): string | null => (format?.startsWith("text:") ? format.slice(5) : null);

/** Why a field's format can't be used, or null (also null when it has none). */
export function fieldFormatIssue(kind: FieldKind, format: string | undefined): string | null {
	if (format === undefined) return null;
	switch (formattedKind(kind)) {
		case "number":
			return formatIssue("number", format);
		case "date":
			return format.trim() ? null : "Enter a date format.";
		case "boolean":
			return BOOLEAN_FORMATS.some((b) => b.format === format) ? null : "Unknown checkbox format.";
		case "url": {
			if (format === "full" || format === "domain") return null;
			const t = urlText(format);
			return t === null ? "Unknown link format." : t.trim() ? null : "Enter the text to show.";
		}
		default:
			return "This kind of field has no display format.";
	}
}

/** The field's format when it's usable, else undefined. */
function ownFormat(field: Pick<FieldDef, "kind" | "format">): string | undefined {
	return field.format !== undefined && !fieldFormatIssue(field.kind, field.format) ? field.format : undefined;
}

/** The date pattern a date field shows: its own, or the Date display format setting. */
export const datePattern = (field: Pick<FieldDef, "kind" | "format"> | null, env: Pick<FormatEnv, "dateFormat">): string => (field && ownFormat(field)) ?? env.dateFormat ?? DEFAULT_DATE_FORMAT;

/** Date formats are real dates only when the adapter maps to the calendar (ISO); custom calendars keep their own display. */
const datesFormattable = (env: FormatEnv) => !!env.moment && !!env.dates.toPicker;

/** A date (days since 1970-01-01) in a pattern, falling back to the adapter's display. */
export function showDate(days: number, pattern: string, env: FormatEnv): string {
	if (pattern === RELATIVE || datesFormattable(env)) {
		try {
			return formatDate(days, pattern, env.moment as MomentLike, env.today);
		} catch {
			// fall through
		}
	}
	return env.dates.format(days, "long");
}

/** The host of a URL ("github.com"), or the text itself when it isn't one. */
export function urlDomain(raw: string): string {
	const s = raw.trim();
	try {
		const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
		if (u.protocol === "mailto:") return u.pathname.split("@").pop() ?? s;
		return u.hostname.replace(/^www\./, "") || s;
	} catch {
		return s;
	}
}

/**
 * A field value as text in its display format (for read-only places: the subtitle, cards, tables, Reading view).
 * Empty values give "". Values that can't be read are shown as they are.
 */
export function formatValue(field: Pick<FieldDef, "kind" | "format">, raw: unknown, env: FormatEnv): string {
	if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) return "";
	const own = ownFormat(field);
	switch (field.kind) {
		case "number": {
			const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
			if (!Number.isFinite(n)) return String(raw);
			return own ? formatNumber(n, own, env.locale, env.currency) : String(n);
		}
		case "date": {
			const p = env.dates.parse(raw);
			if (!p) return "";
			return p.ok ? showDate(p.value, datePattern(field, env), env) : String(raw);
		}
		case "boolean": {
			const on = raw === true || raw === "true";
			if (own === "yesno") return on ? "Yes" : raw === false || raw === "false" ? "No" : "";
			if (own === "check") return on ? "✓" : "";
			return on ? "Yes" : "";
		}
		case "url": {
			const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
			if (own === "domain") return urlDomain(s);
			const t = urlText(own);
			return t !== null ? t : s;
		}
		default:
			return Array.isArray(raw) ? raw.map(String).join(", ") : String(raw);
	}
}

/** Whether a date pattern can be typed back in full: it has a 4-digit year, a month and a day of the month. */
export function isTypeablePattern(pattern: string): boolean {
	if (pattern === RELATIVE) return false;
	const p = pattern.replace(/\[[^\]]*\]/g, "");
	return /YYYY/.test(p) && /M/.test(p) && /(^|[^D])(D{1,2}|Do)(?!D)/.test(p);
}

/** The pattern a date field is edited in: its display pattern when that can be typed back, else YYYY-MM-DD. */
export function editPattern(field: Pick<FieldDef, "kind" | "format"> | null, env: FormatEnv): string {
	const p = datePattern(field, env);
	return datesFormattable(env) && isTypeablePattern(p) ? p : "YYYY-MM-DD";
}

/** The text a number or date box starts with when you click in to edit it. Other kinds: the value as it is. */
export function editText(field: Pick<FieldDef, "kind" | "format">, raw: unknown, env: FormatEnv): string {
	if (raw === undefined || raw === null || raw === "") return "";
	if (field.kind === "date") {
		const p = env.dates.parse(raw);
		if (!p?.ok) return String(raw);
		const pattern = editPattern(field, env);
		return datesFormattable(env) ? formatDate(p.value, pattern, env.moment as MomentLike, env.today) : String(raw);
	}
	if (field.kind === "number" && typeof raw === "number") return String(raw);
	return Array.isArray(raw) ? raw.map(String).join(", ") : String(raw);
}

/** The locale's thousands and decimal separators. */
function separators(locale: string): { group: string; decimal: string } {
	try {
		const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
		return { group: parts.find((p) => p.type === "group")?.value ?? ",", decimal: parts.find((p) => p.type === "decimal")?.value ?? "." };
	} catch {
		return { group: ",", decimal: "." };
	}
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A typed number, allowing what formats add: currency symbols and codes, thousands separators, a trailing %, units
 * ("32 h"); with the compact format also K / M / B for thousands, millions and billions. Null when there's no number.
 */
export function parseNumberText(text: string, locale: string, format?: string): number | null {
	const s = text.trim();
	if (!s) return null;
	const direct = Number(s);
	if (Number.isFinite(direct)) return direct;
	const { group, decimal } = separators(locale);
	const scale = format === "compact" ? /\d\s*([kmb])\s*$/i.exec(s) : null;
	const negative = /^[^\d]*[-−(]/.test(s);
	let body = s.replace(new RegExp(escape(group) + "(?=\\d{3})", "g"), "");
	// The thin / narrow spaces some locales group with.
	body = body.replace(/(\d)[\s\u00a0\u202f](?=\d{3})/g, "$1");
	if (decimal !== ".") body = body.replace(new RegExp(escape(decimal), "g"), ".");
	const m = /\d+(?:\.\d+)?|\.\d+/.exec(body);
	if (!m) return null;
	let n = Number(m[0]);
	if (scale) n *= { k: 1e3, m: 1e6, b: 1e9 }[scale[1].toLowerCase() as "k" | "m" | "b"];
	return negative ? -n : n;
}

/** Typed text in a number or date box as the value to store, or why it can't be used. */
export function parseTyped(field: Pick<FieldDef, "kind" | "format">, text: string, env: FormatEnv): InputResult {
	const s = text.trim();
	if (!s) return { ok: true, value: null };
	if (field.kind === "number") {
		const n = parseNumberText(s, env.locale, ownFormat(field));
		return n === null ? { ok: false, error: `"${s}" isn't a number.` } : { ok: true, value: n };
	}
	if (field.kind === "date") {
		const r = env.dates.parse(s);
		if (r?.ok) return { ok: true, value: s };
		const pattern = editPattern(field, env);
		if (pattern !== "YYYY-MM-DD" && env.moment && env.dates.fromPicker) {
			const m = env.moment.utc(s, pattern, true);
			if (m.isValid?.()) return { ok: true, value: env.dates.fromPicker(m.format("YYYY-MM-DD")) };
			return { ok: false, error: `"${s}" isn't a date. Use ${pattern} or YYYY-MM-DD.` };
		}
		return { ok: false, error: r && !r.ok ? r.error : `"${s}" isn't a date.` };
	}
	return { ok: true, value: s };
}
