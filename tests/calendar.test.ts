import { describe, expect, it } from "vitest";
import { isoOf, monthGrid, parseIso, shiftMonth, todayIso, weekdayOrder } from "../src/model/calendar";

describe("calendar", () => {
	it("reads and writes ISO days", () => {
		expect(isoOf(2026, 3, 5)).toBe("2026-03-05");
		expect(isoOf(812, 12, 31)).toBe("0812-12-31");
		expect(parseIso("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
		expect(parseIso("2026-02-29")).toBeNull();
		expect(parseIso("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
		expect(parseIso("2026-13-01")).toBeNull();
		expect(parseIso("0000-01-01")).toBeNull();
		expect(parseIso("0050-03-15")).toEqual({ year: 50, month: 3, day: 15 });
		expect(parseIso("26-1-1")).toBeNull();
		expect(parseIso(null)).toBeNull();
		expect(todayIso(new Date(2026, 10, 3, 23, 59))).toBe("2026-11-03");
	});

	it("moves between months and years", () => {
		expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
		expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
		expect(shiftMonth(2026, 5, 12)).toEqual({ year: 2027, month: 5 });
		expect(shiftMonth(2026, 5, -25)).toEqual({ year: 2024, month: 4 });
		expect(shiftMonth(1, 1, -1)).toEqual({ year: 1, month: 1 });
		expect(shiftMonth(9999, 12, 1)).toEqual({ year: 9999, month: 12 });
	});

	it("lays out six weeks from the locale's first day", () => {
		// November 2026 starts on a Sunday.
		const sun = monthGrid(2026, 11, 0);
		expect(sun).toHaveLength(42);
		expect(sun[0]).toEqual({ iso: "2026-11-01", day: 1, inMonth: true });
		expect(sun[29]).toEqual({ iso: "2026-11-30", day: 30, inMonth: true });
		expect(sun[30]).toEqual({ iso: "2026-12-01", day: 1, inMonth: false });
		const mon = monthGrid(2026, 11, 1);
		expect(mon[0]).toEqual({ iso: "2026-10-26", day: 26, inMonth: false });
		expect(mon[6]).toEqual({ iso: "2026-11-01", day: 1, inMonth: true });
		// February 2026 has 28 days, from a Sunday.
		expect(monthGrid(2026, 2, 0).filter((d) => d.inMonth)).toHaveLength(28);
		// early years
		expect(monthGrid(50, 1, 1).find((d) => d.inMonth)?.iso).toBe("0050-01-01");
		expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
		expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
	});
});
