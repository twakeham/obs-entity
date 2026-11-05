/**
 * Calendar views: notes placed by a date field (and an optional end date field, for notes spanning days), shown as a
 * month grid, a week or an agenda list. Days are whole days since 1970-01-01 (UTC), read from a field through the
 * date adapter's picker form (YYYY-MM-DD), so a calendar needs an adapter that maps to real dates.
 */
import { isoOf, parseIso } from "./calendar";
import type { DateAdapter } from "./dates";
import { statusesFor, type EntityTypeDef, type FieldDef, type GroupDef } from "./types";
import {
	columnFromId,
	emptyCalendar,
	NAME_COLUMN,
	natural,
	type CalendarDates,
	type CalendarDef,
	type CalendarLayout,
	type ColumnDef,
	type ResultRow,
	type ViewDef,
} from "./views";

/** Lucide icon for calendars (views, the layout toggle). */
export const CALENDAR_ICON = "calendar-days";
/** Days the agenda lists at a time. */
export const AGENDA_DAYS = 30;
/** Card fields Week and Agenda show by default (the table's first few columns). */
export const DEFAULT_CALENDAR_FIELDS = 3;
/** Entries a month day shows before "+n more". */
export const MONTH_LANES = 4;

const DAY_MS = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const calendarOf = (def: ViewDef): CalendarDef => def.calendar ?? emptyCalendar();
export const layoutOf = (def: ViewDef): CalendarLayout => calendarOf(def).layout ?? "month";
export const weekStartOf = (def: ViewDef): number => calendarOf(def).weekStart ?? 1;

// ---------------------------------------------------------------- days

/** A day as YYYY-MM-DD. */
export function isoOfDay(day: number): string {
	const d = new Date(day * DAY_MS);
	return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The day of a YYYY-MM-DD date (null when it isn't one). */
export function dayOfIso(iso: string | null | undefined): number | null {
	const p = parseIso(iso);
	if (!p) return null;
	const d = new Date(0);
	d.setUTCFullYear(p.year, p.month - 1, p.day);
	return Math.floor(d.getTime() / DAY_MS);
}

/** The parts of a day (month 1–12). */
export function partsOfDay(day: number): { year: number; month: number; date: number; weekday: number } {
	const d = new Date(day * DAY_MS);
	return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** 0 Sunday … 6 Saturday (1970-01-01 was a Thursday). */
export const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;

/** The first day of the week holding `day`. */
export const startOfWeek = (day: number, weekStart: number) => day - ((weekdayOf(day) - weekStart + 7) % 7);

/** Whether the calendar can show this adapter's dates (it needs the YYYY-MM-DD picker form). */
export const canCalendar = (dates: DateAdapter) => !!dates.toPicker;

/** A stored date value as a day (null: empty, or not a date the calendar can place). */
export function readDay(dates: DateAdapter, raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === "" || !dates.toPicker) return null;
	return dayOfIso(dates.toPicker(Array.isArray(raw) ? raw[0] : raw));
}

/** A day as the value to store in a date field. */
export const writeDay = (dates: DateAdapter, day: number): string => (dates.fromPicker ? dates.fromPicker(isoOfDay(day)) : isoOfDay(day));

// ---------------------------------------------------------------- which fields

/** The date fields a type can put on the calendar (stored date fields; calculated ones can't be moved). */
export const dateFields = (t: EntityTypeDef): FieldDef[] => t.fields.filter((f) => f.kind === "date");

const words = (f: FieldDef) => `${f.key} ${f.label}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
const STARTS = ["start", "starts", "begin", "begins", "from", "opens"];
const ENDS = ["end", "ends", "finish", "finishes", "until", "closes", "due", "deadline"];

/**
 * The date fields a type gets automatically: a Start / End pair when it has one (named like start, begin, from and
 * end, finish, until, due), else its first date field. Null when it has none.
 */
export function autoDates(t: EntityTypeDef): CalendarDates | null {
	const fields = dateFields(t);
	if (!fields.length) return null;
	const start = fields.find((f) => words(f).some((w) => STARTS.includes(w)));
	const end = start && fields.find((f) => f !== start && words(f).some((w) => ENDS.includes(w)));
	if (start && end) return { start: start.key, end: end.key };
	return { start: fields[0].key };
}

/**
 * A type's date fields on this calendar: the saved choice (null: left off), else the automatic one. A saved field
 * that's gone or isn't a date falls back to the automatic choice; an unusable end field is dropped.
 */
export function datesFor(cal: CalendarDef, t: EntityTypeDef): CalendarDates | null {
	const saved = cal.dates[t.key];
	if (saved === null) return null;
	const ok = (k: string | undefined) => !!k && dateFields(t).some((f) => f.key === k);
	if (!saved || !ok(saved.start)) return autoDates(t);
	return ok(saved.end) && saved.end !== saved.start ? { start: saved.start, end: saved.end } : { start: saved.start };
}

/** Every source type's date fields, as saved when a view first becomes a calendar (so later changes are explicit). */
export function initialDates(types: EntityTypeDef[]): Record<string, CalendarDates | null> {
	return Object.fromEntries(types.map((t) => [t.key, autoDates(t)]));
}

/** A type's date field label(s) for the toolbar: "Due", "Start → End". */
export function datesLabel(t: EntityTypeDef, d: CalendarDates | null): string {
	if (!d) return "Not shown";
	const label = (k: string) => t.fields.find((f) => f.key === k)?.label ?? k;
	return d.end ? `${label(d.start)} → ${label(d.end)}` : label(d.start);
}

// ---------------------------------------------------------------- what the calendar runs

const defFor = (def: ViewDef, id: string): ColumnDef => def.columns.find((c) => c.id === id) ?? columnFromId(id);

/** Card fields: the calendar's own list, or in Week and Agenda the table's first few columns. */
export function calendarFieldIds(def: ViewDef, layout: CalendarLayout = layoutOf(def)): string[] {
	const c = calendarOf(def);
	if (c.cardFields) return c.cardFields.filter((id) => id !== "name");
	if (layout === "month") return [];
	return def.columns
		.map((x) => x.id)
		.filter((id) => id !== "name" && id !== c.swimlanes?.by)
		.slice(0, DEFAULT_CALENDAR_FIELDS);
}

/**
 * The definition `runView` runs for a calendar: name, the card fields and the colour column, with the swimlane (in
 * Week) as the only grouping level. Filters, search, sort and highlight rules are the view's own.
 */
export function calendarRunDef(def: ViewDef): ViewDef {
	const c = calendarOf(def);
	const layout = layoutOf(def);
	const color = c.colorBy && c.colorBy !== "none" ? [c.colorBy] : [];
	const ids = [...calendarFieldIds(def, layout), ...color];
	return { ...def, columns: [NAME_COLUMN, ...[...new Set(ids)].map((id) => defFor(def, id))], group: layout === "week" && c.swimlanes ? [c.swimlanes] : [] };
}

// ---------------------------------------------------------------- entries

export interface CalEntry {
	r: ResultRow;
	start: number;
	/** the last day (the start for one-day notes) */
	end: number;
	dates: CalendarDates;
	/** the note has its own end date (else it's a one-day note) */
	hasEnd: boolean;
}

export interface CalendarData {
	/** notes with a date, in the view's order (status order then name when the view isn't sorted) */
	entries: CalEntry[];
	/** notes whose type is on the calendar but have no date (or one the calendar can't read) */
	undated: ResultRow[];
	/** notes whose type isn't on the calendar */
	off: number;
}

/**
 * The view's rows as calendar entries. An end date before the start is ignored (a one-day note). Without a sort the
 * order within a day is the type's status order, then the name.
 */
export function calendarEntries(rows: ResultRow[], def: ViewDef, dates: DateAdapter, groups: GroupDef[]): CalendarData {
	const cal = calendarOf(def);
	const byType = new Map<string, CalendarDates | null>();
	const fieldsOf = (t: EntityTypeDef) => {
		if (!byType.has(t.key)) byType.set(t.key, datesFor(cal, t));
		return byType.get(t.key)!;
	};
	const entries: CalEntry[] = [];
	const undated: ResultRow[] = [];
	let off = 0;
	for (const r of rows) {
		const d = fieldsOf(r.row.type);
		if (!d) {
			off++;
			continue;
		}
		const start = readDay(dates, r.row.frontmatter[d.start]);
		if (start === null) {
			undated.push(r);
			continue;
		}
		const endDay = d.end ? readDay(dates, r.row.frontmatter[d.end]) : null;
		const hasEnd = endDay !== null && endDay >= start;
		entries.push({ r, start, end: hasEnd ? endDay : start, dates: d, hasEnd });
	}
	if (!def.sort.length) {
		const rank = new Map<string, string[]>();
		const statusAt = (r: ResultRow) => {
			const t = r.row.type;
			if (!rank.has(t.key)) rank.set(t.key, statusesFor(t, groups));
			const i = rank.get(t.key)!.indexOf(r.row.status ?? "");
			return i < 0 ? 999 : i;
		};
		const cmp = (a: ResultRow, b: ResultRow) => statusAt(a) - statusAt(b) || natural(a.row.name, b.row.name);
		entries.sort((a, b) => cmp(a.r, b.r));
		undated.sort(cmp);
	}
	return { entries, undated, off };
}

// ---------------------------------------------------------------- periods

/** The weeks (7 days each, from the week start) covering the month holding `anchor`. */
export function monthWeeks(anchor: number, weekStart: number): number[][] {
	const { year, month } = partsOfDay(anchor);
	const first = dayOfIso(isoOf(year, month, 1))!;
	const next = month === 12 ? dayOfIso(isoOf(year + 1, 1, 1))! : dayOfIso(isoOf(year, month + 1, 1))!;
	const weeks: number[][] = [];
	for (let w = startOfWeek(first, weekStart); w < next; w += 7) weeks.push(Array.from({ length: 7 }, (_, i) => w + i));
	return weeks;
}

/** The days of the week holding `anchor`. */
export const weekDays = (anchor: number, weekStart: number): number[] => Array.from({ length: 7 }, (_, i) => startOfWeek(anchor, weekStart) + i);

/** The first and last day a layout shows around `anchor`. */
export function periodRange(layout: CalendarLayout, anchor: number, weekStart: number): { from: number; to: number } {
	if (layout === "week") {
		const from = startOfWeek(anchor, weekStart);
		return { from, to: from + 6 };
	}
	if (layout === "agenda") return { from: anchor, to: anchor + AGENDA_DAYS - 1 };
	const weeks = monthWeeks(anchor, weekStart);
	return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
}

/** The anchor one period earlier (-1) or later (+1): a month (the same date, kept within the month), a week, or the agenda's span. */
export function shiftPeriod(layout: CalendarLayout, anchor: number, dir: -1 | 1): number {
	if (layout === "week") return anchor + 7 * dir;
	if (layout === "agenda") return anchor + AGENDA_DAYS * dir;
	const { year, month, date } = partsOfDay(anchor);
	const total = year * 12 + (month - 1) + dir;
	const [y, m] = [Math.floor(total / 12), (total % 12) + 1];
	for (let d = date; d >= 28; d--) {
		const day = dayOfIso(isoOf(y, m, d));
		if (day !== null) return day;
	}
	return dayOfIso(isoOf(y, m, Math.min(date, 28)))!;
}

/** A short date: "5 Nov", with the year when asked. */
export function shortDate(day: number, year = false): string {
	const p = partsOfDay(day);
	return `${p.date} ${SHORT_MONTHS[p.month - 1]}${year ? ` ${p.year}` : ""}`;
}

/** A long date for headings: "Thursday 5 November". */
export function longDate(day: number): string {
	const p = partsOfDay(day);
	return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][p.weekday]} ${p.date} ${MONTHS[p.month - 1]}`;
}

/** The toolbar's title for a period: "November 2026", "2 – 8 Nov 2026", "5 Nov – 4 Dec 2026". */
export function periodTitle(layout: CalendarLayout, anchor: number, weekStart: number): string {
	if (layout === "month") {
		const p = partsOfDay(anchor);
		return `${MONTHS[p.month - 1]} ${p.year}`;
	}
	const { from, to } = periodRange(layout, anchor, weekStart);
	const a = partsOfDay(from);
	const b = partsOfDay(to);
	if (a.year !== b.year) return `${shortDate(from, true)} – ${shortDate(to, true)}`;
	if (a.month !== b.month) return `${shortDate(from)} – ${shortDate(to, true)}`;
	return `${a.date} – ${b.date} ${SHORT_MONTHS[b.month - 1]} ${b.year}`;
}

/** A month name (for the footer: "12 in November"). */
export const monthName = (day: number) => MONTHS[partsOfDay(day).month - 1];

/** The first and last day of the month holding `day`. */
export function monthRange(day: number): { from: number; to: number } {
	const { year, month } = partsOfDay(day);
	const from = dayOfIso(isoOf(year, month, 1))!;
	return { from, to: shiftPeriod("month", from, 1) - 1 };
}

// ---------------------------------------------------------------- laying out bars

/** An entry's piece within one week row: from column `col` for `span` days, in lane `lane` (0 at the top). */
export interface Segment {
	e: CalEntry;
	col: number;
	span: number;
	lane: number;
	/** the entry carries on from the week before / into the week after */
	before: boolean;
	after: boolean;
}

/**
 * The entries overlapping the `days`-day row starting on `from`, as bars in lanes: each takes the first lane free
 * for all its days. Earlier starts go first, then longer bars, then the given order.
 */
export function weekSegments(entries: CalEntry[], from: number, days = 7): Segment[] {
	const to = from + days - 1;
	const pieces = entries
		.map((e, i) => ({ e, i, a: Math.max(e.start, from), b: Math.min(e.end, to) }))
		.filter((p) => p.a <= p.b)
		.sort((x, y) => x.a - y.a || y.b - y.a - (x.b - x.a) || x.i - y.i);
	const lanes: number[] = [];
	return pieces.map((p) => {
		let lane = lanes.findIndex((last) => last < p.a);
		if (lane < 0) lane = lanes.length;
		lanes[lane] = p.b;
		return { e: p.e, col: p.a - from, span: p.b - p.a + 1, lane, before: p.e.start < from, after: p.e.end > to };
	});
}

/**
 * Which bars a month week shows when days hold at most `limit` entries: the lanes shown (all of them, or one fewer
 * to leave room for "+n more"), and per day how many entries are left out.
 */
export function weekOverflow(segs: Segment[], limit = MONTH_LANES, days = 7): { lanes: number; more: number[] } {
	const count = Array.from({ length: days }, (_, d) => segs.filter((s) => d >= s.col && d < s.col + s.span).length);
	const max = Math.max(0, ...count);
	const lanes = max > limit ? limit - 1 : max;
	const more = Array.from({ length: days }, (_, d) => segs.filter((s) => s.lane >= lanes && d >= s.col && d < s.col + s.span).length);
	return { lanes, more };
}

/** The entries on one day (spanning ones included), in order. */
export const entriesOn = (entries: CalEntry[], day: number) => entries.filter((e) => e.start <= day && e.end >= day);

/**
 * The agenda: days from `from` for `count` days that have entries, plus today when it's in range. A note spanning
 * days is listed once, on its first day in range (it shows its span).
 */
export function agendaDays(entries: CalEntry[], from: number, today: number, count = AGENDA_DAYS): { day: number; entries: CalEntry[] }[] {
	const out: { day: number; entries: CalEntry[] }[] = [];
	for (let d = from; d < from + count; d++) {
		const on = entries.filter((e) => e.end >= from && Math.max(e.start, from) === d);
		if (on.length || d === today) out.push({ day: d, entries: on });
	}
	return out;
}

// ---------------------------------------------------------------- moving

/** An entry's new days after moving it `delta` days (both ends move). */
export const movedBy = (e: CalEntry, delta: number) => ({ start: e.start + delta, end: e.end + delta });

/** An entry's new days after dragging one edge to `day` (it can't pass the other edge). */
export function resizedTo(e: CalEntry, edge: "start" | "end", day: number): { start: number; end: number } {
	return edge === "start" ? { start: Math.min(day, e.end), end: e.end } : { start: e.start, end: Math.max(day, e.start) };
}

/**
 * The fields to write for an entry's new days: the start, and the end when the note has one or now spans days.
 * Empty when nothing changes.
 */
export function dateWrites(e: CalEntry, next: { start: number; end: number }, dates: DateAdapter): Record<string, string> {
	const out: Record<string, string> = {};
	if (next.start !== e.start) out[e.dates.start] = writeDay(dates, next.start);
	if (e.dates.end && (e.hasEnd || next.end !== next.start) && (next.end !== e.end || !e.hasEnd)) out[e.dates.end] = writeDay(dates, next.end);
	return out;
}
