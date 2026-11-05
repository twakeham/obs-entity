import { describe, expect, it } from "vitest";
import {
	agendaDays,
	autoDates,
	calendarEntries,
	calendarFieldIds,
	calendarRunDef,
	cardModeOf,
	shownFieldIds,
	withCardMode,
	dateWrites,
	datesFor,
	dayOfIso,
	isoOfDay,
	monthWeeks,
	movedBy,
	periodRange,
	periodTitle,
	resizedTo,
	shiftPeriod,
	startOfWeek,
	weekdayOf,
	weekOverflow,
	weekSegments,
	type CalEntry,
} from "../src/model/calendarView";
import { isoDateAdapter } from "../src/model/dates";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import { emptyCalendar, parseView, serializeView, type ResultRow, type ViewDef } from "../src/model/views";

const GROUPS: GroupDef[] = [{ key: "work", name: "Work", icon: "x", statuses: ["todo", "doing", "done"] }];
const f = (key: string, label: string, kind: FieldDef["kind"]): FieldDef => ({ key, label, kind });
const type = (key: string, fields: FieldDef[]): EntityTypeDef => ({ key, name: key, plural: `${key}s`, icon: "x", color: "", group: "work", template: "", fields }) as EntityTypeDef;
const TASK = type("task", [f("due", "Due", "date"), f("priority", "Priority", "select")]);
const PROJECT = type("project", [f("budget", "Budget", "number"), f("start_date", "Start date", "date"), f("due", "Due", "date")]);
const NOTE = type("note", [f("text", "Text", "text")]);
const d = (iso: string) => dayOfIso(iso)!;
const row = (name: string, t: EntityTypeDef, fm: Record<string, unknown>, status = "todo"): ResultRow => ({
	row: { path: `${name}.md`, name, type: t, status, subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null, frontmatter: fm },
	cells: {},
});
const view = (raw: Record<string, unknown>): ViewDef => parseView({ kind: "calendar", ...raw }).def!;

describe("calendar days", () => {
	it("convert between days and dates", () => {
		expect(isoOfDay(d("2026-11-05"))).toBe("2026-11-05");
		expect(dayOfIso("2026-02-30")).toBeNull();
		expect(weekdayOf(d("2026-11-05"))).toBe(4);
		expect(isoOfDay(startOfWeek(d("2026-11-05"), 1))).toBe("2026-11-02");
		expect(isoOfDay(startOfWeek(d("2026-11-05"), 0))).toBe("2026-11-01");
	});

	it("cover a month with whole weeks from the week start", () => {
		const weeks = monthWeeks(d("2026-11-15"), 1);
		expect(isoOfDay(weeks[0][0])).toBe("2026-10-26");
		expect(isoOfDay(weeks[weeks.length - 1][6])).toBe("2026-12-06");
		expect(weeks.length).toBe(6);
		expect(monthWeeks(d("2027-02-10"), 1).length).toBe(4);
	});

	it("step between periods and title them", () => {
		expect(isoOfDay(shiftPeriod("month", d("2027-01-31"), 1))).toBe("2027-02-28");
		expect(isoOfDay(shiftPeriod("month", d("2026-11-05"), -1))).toBe("2026-10-05");
		expect(isoOfDay(shiftPeriod("week", d("2026-11-05"), 1))).toBe("2026-11-12");
		expect(isoOfDay(shiftPeriod("agenda", d("2026-11-05"), 1))).toBe("2026-12-05");
		expect(periodTitle("month", d("2026-11-05"), 1)).toBe("November 2026");
		expect(periodTitle("week", d("2026-11-05"), 1)).toBe("2 – 8 Nov 2026");
		expect(periodTitle("week", d("2026-12-30"), 1)).toBe("28 Dec 2026 – 3 Jan 2027");
		expect(periodTitle("agenda", d("2026-11-05"), 1)).toBe("5 Nov – 4 Dec 2026");
		expect(periodRange("week", d("2026-11-05"), 0)).toEqual({ from: d("2026-11-01"), to: d("2026-11-07") });
	});
});

describe("calendar settings", () => {
	it("read and write the calendar block, leaving out defaults", () => {
		const def = view({ calendar: { dates: { task: "due", project: { start: "start_date", end: "due" }, note: "none" }, layout: "week", weekStart: "sunday", colorBy: "priority", cardFields: ["priority"], swimlanes: "status", cardSubtitle: true, cardLabels: true } });
		expect(def.kind).toBe("calendar");
		expect(def.calendar).toEqual({ dates: { task: { start: "due" }, project: { start: "start_date", end: "due" }, note: null }, layout: "week", weekStart: 0, colorBy: "priority", cardFields: ["priority"], swimlanes: { by: "status" }, cardSubtitle: true, cardLabels: true });
		const out = serializeView(def).calendar as Record<string, unknown>;
		expect(out).toEqual({ dates: { task: "due", project: { start: "start_date", end: "due" }, note: "none" }, layout: "week", weekStart: "sunday", colorBy: "priority", cardFields: ["priority"], swimlanes: "status", cardSubtitle: true, cardLabels: true });
		expect(view({ calendar: { layout: "month", weekStart: "monday", colorBy: "status" } }).calendar).toEqual(emptyCalendar());
		expect(serializeView(view({ calendar: { layout: "month" } })).calendar).toBeUndefined();
		expect(parseView({ kind: "calendar", calendar: { layout: "year", weekStart: "someday" } }).errors).toHaveLength(2);
	});

	it("pick date fields: a start / end pair, else the first date field", () => {
		expect(autoDates(TASK)).toEqual({ start: "due" });
		expect(autoDates(PROJECT)).toEqual({ start: "start_date", end: "due" });
		expect(autoDates(NOTE)).toBeNull();
		const cal = { dates: { task: null, project: { start: "gone" } } };
		expect(datesFor(cal, TASK)).toBeNull();
		expect(datesFor(cal, PROJECT)).toEqual({ start: "start_date", end: "due" });
		expect(datesFor({ dates: { project: { start: "due", end: "budget" } } }, PROJECT)).toEqual({ start: "due" });
	});

	it("run the name, card fields and colour column, with a swimlane only in Week", () => {
		const base = { types: ["task"], columns: ["name", "status", "priority", "due", "assignee"] };
		expect(calendarFieldIds(view(base))).toEqual(["status", "priority", "due"]);
		expect(shownFieldIds(view(base))).toEqual([]);
		expect(shownFieldIds(view({ ...base, calendar: { layout: "week" } }))).toEqual(["status", "priority", "due"]);
		const run = calendarRunDef(view({ ...base, calendar: { colorBy: "priority", cardFields: ["assignee"], swimlanes: "status", cards: { month: "extended" } } }));
		expect(run.columns.map((c) => c.id)).toEqual(["name", "assignee", "priority"]);
		expect(run.group).toEqual([]);
		expect(calendarRunDef(view({ ...base, calendar: { layout: "week", swimlanes: "status" } })).group).toEqual([{ by: "status" }]);
	});

	it("keep each layout's Minimal / Extended cards, writing only what differs from the default", () => {
		const def = view({ calendar: { cards: { month: "extended", week: "extended", agenda: "minimal" } } });
		expect(def.calendar!.cards).toEqual({ month: "extended", agenda: "minimal" });
		expect(serializeView(def).calendar).toEqual({ cards: { month: "extended", agenda: "minimal" } });
		expect([cardModeOf(def, "month"), cardModeOf(def, "week"), cardModeOf(def, "agenda")]).toEqual(["extended", "extended", "minimal"]);
		expect(cardModeOf(view({}), "month")).toBe("minimal");
		expect(withCardMode(def.calendar!, "month", "minimal")).toEqual({ dates: {}, cards: { agenda: "minimal" } });
		expect(withCardMode({ dates: {}, cards: { agenda: "minimal" } }, "agenda", "extended")).toEqual({ dates: {} });
		expect(parseView({ kind: "calendar", calendar: { cards: { month: "huge", year: "minimal" } } }).errors).toHaveLength(2);
	});
});

describe("calendar entries", () => {
	const rows = [
		row("Done task", TASK, { due: "2026-11-05" }, "done"),
		row("Todo task", TASK, { due: "2026-11-05" }),
		row("Undated", TASK, {}),
		row("Bad date", TASK, { due: "soon" }),
		row("Launch", PROJECT, { start_date: "2026-11-03", due: "2026-11-10" }),
		row("Backwards", PROJECT, { start_date: "2026-11-03", due: "2026-11-01" }),
		row("Memo", NOTE, {}),
	];

	it("place notes by their dates, in status order without a sort", () => {
		const data = calendarEntries(rows, view({ types: ["*"] }), isoDateAdapter, GROUPS);
		expect(data.entries.map((e) => `${e.r.row.name}:${isoOfDay(e.start)}-${isoOfDay(e.end)}:${e.hasEnd}`)).toEqual([
			"Backwards:2026-11-03-2026-11-03:false",
			"Launch:2026-11-03-2026-11-10:true",
			"Todo task:2026-11-05-2026-11-05:false",
			"Done task:2026-11-05-2026-11-05:false",
		]);
		expect(data.undated.map((r) => r.row.name)).toEqual(["Bad date", "Undated"]);
		expect(data.off).toBe(1);
		const sorted = calendarEntries(rows, view({ types: ["*"], sort: [{ by: "name" }] }), isoDateAdapter, GROUPS);
		expect(sorted.entries.map((e) => e.r.row.name)).toEqual(["Done task", "Todo task", "Launch", "Backwards"]);
	});

	const entry = (name: string, start: string, end = start): CalEntry => ({ r: row(name, TASK, {}), start: d(start), end: d(end), dates: { start: "due", end: "end" }, hasEnd: end !== start });

	it("lay bars into lanes within a week, longer ones first", () => {
		const week = d("2026-11-02");
		const segs = weekSegments([entry("A", "2026-11-04"), entry("Long", "2026-10-30", "2026-11-04"), entry("B", "2026-11-04"), entry("Next", "2026-11-07", "2026-11-12")], week);
		expect(segs.map((s) => `${s.e.r.row.name}@${s.col}+${s.span}#${s.lane}${s.before ? "<" : ""}${s.after ? ">" : ""}`)).toEqual(["Long@0+3#0<", "A@2+1#1", "B@2+1#2", "Next@5+2#0>"]);
		expect(weekOverflow(segs, 4)).toEqual({ lanes: 3, more: [0, 0, 0, 0, 0, 0, 0] });
		expect(weekOverflow(segs, 2)).toEqual({ lanes: 1, more: [0, 0, 2, 0, 0, 0, 0] });
	});

	it("list agenda days with entries, and today; spanning notes once, on their first day in range", () => {
		const es = [entry("A", "2026-11-06"), entry("Span", "2026-11-07", "2026-11-08"), entry("Ongoing", "2026-11-01", "2026-11-20"), entry("Past", "2026-11-02")];
		expect(agendaDays(es, d("2026-11-05"), d("2026-11-05"), 5).map((x) => `${isoOfDay(x.day)}:${x.entries.map((e) => e.r.row.name).join(",")}`)).toEqual([
			"2026-11-05:Ongoing",
			"2026-11-06:A",
			"2026-11-07:Span",
		]);
	});

	it("work out what moving and resizing writes", () => {
		const one = entry("One", "2026-11-05");
		expect(dateWrites(one, movedBy(one, 2), isoDateAdapter)).toEqual({ due: "2026-11-07" });
		expect(dateWrites(one, resizedTo(one, "end", d("2026-11-08")), isoDateAdapter)).toEqual({ end: "2026-11-08" });
		const span = entry("Span", "2026-11-05", "2026-11-07");
		expect(dateWrites(span, movedBy(span, -1), isoDateAdapter)).toEqual({ due: "2026-11-04", end: "2026-11-06" });
		expect(resizedTo(span, "start", d("2026-11-09"))).toEqual({ start: d("2026-11-07"), end: d("2026-11-07") });
		expect(dateWrites(span, movedBy(span, 0), isoDateAdapter)).toEqual({});
	});
});
