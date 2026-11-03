/**
 * The date picker's calendar, independent of how a field shows its dates: it works in ISO days (YYYY-MM-DD) and the
 * field converts to and from its own text (a date adapter's `toPicker` / `fromPicker`, or a display format's).
 */

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A day as YYYY-MM-DD (month 1–12). */
export const isoOf = (year: number, month: number, day: number) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** The parts of a YYYY-MM-DD date (null when it isn't one, or the day doesn't exist). */
export function parseIso(iso: string | null | undefined): { year: number; month: number; day: number } | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
	if (!m) return null;
	const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const d = new Date(Date.UTC(2000, month - 1, day));
	d.setUTCFullYear(year, month - 1, day);
	if (year < 1 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
	return { year, month, day };
}

/** Today (local time) as YYYY-MM-DD. */
export const todayIso = (now = new Date()) => isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());

/** The month `delta` months from year/month (month 1–12), kept within years 1–9999. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
	const total = Math.max(12, Math.min(9999 * 12 + 11, year * 12 + (month - 1) + delta));
	return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export interface CalendarDay {
	iso: string;
	day: number;
	/** in the month shown (not the days before or after it) */
	inMonth: boolean;
}

/** Six weeks of days covering a month (month 1–12), each week starting on `firstDay` (0 Sunday … 6 Saturday). */
export function monthGrid(year: number, month: number, firstDay: number): CalendarDay[] {
	const first = new Date(Date.UTC(year, month - 1, 1));
	first.setUTCFullYear(year);
	const lead = (first.getUTCDay() - firstDay + 7) % 7;
	const start = first.getTime() - lead * 86_400_000;
	return Array.from({ length: 42 }, (_, i) => {
		const d = new Date(start + i * 86_400_000);
		return { iso: isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 };
	});
}

/** Weekday numbers (0 Sunday … 6 Saturday) in the order a week starting on `firstDay` shows them. */
export const weekdayOrder = (firstDay: number) => Array.from({ length: 7 }, (_, i) => (firstDay + i) % 7);
