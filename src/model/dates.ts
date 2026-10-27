/** Converts date field values to and from something sortable and displayable. */
export interface DateAdapter {
	/** null for empty input */
	parse(raw: unknown): DateParse | null;
	format(value: number, style: "short" | "long"): string;
	placeholder: string;
}

export type DateParse = { ok: true; value: number; display: string } | { ok: false; error: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function daysFromCivil(y: number, m: number, d: number): number {
	return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function civilFromDays(days: number): [number, number, number] {
	const dt = new Date(days * 86_400_000);
	return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ISO dates (YYYY-MM-DD). Values are days since 1970-01-01. */
export const isoDateAdapter: DateAdapter = {
	placeholder: "YYYY-MM-DD",
	parse(raw: unknown): DateParse | null {
		if (raw === undefined || raw === null || raw === "") return null;
		if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
			const value = daysFromCivil(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
			return { ok: true, value, display: isoDateAdapter.format(value, "long") };
		}
		const s = String(raw).trim();
		if (!s) return null;
		const m = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(s);
		if (!m) return { ok: false, error: `"${s}" isn't a date. Use YYYY-MM-DD.` };
		const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		if (mo < 1 || mo > 12) return { ok: false, error: `Month ${mo} doesn't exist.` };
		const value = daysFromCivil(y, mo, d);
		const [y2, mo2, d2] = civilFromDays(value);
		if (y2 !== y || mo2 !== mo || d2 !== d) return { ok: false, error: `${MONTHS[mo - 1]} ${y} has no day ${d}.` };
		return { ok: true, value, display: isoDateAdapter.format(value, "long") };
	},
	format(value: number, style: "short" | "long"): string {
		const [y, m, d] = civilFromDays(value);
		return style === "short" ? `${pad(y, 4)}-${pad(m)}-${pad(d)}` : `${d} ${MONTHS[m - 1]} ${y}`;
	},
};
