import moment from "moment";
import { describe, expect, it } from "vitest";
import { formatDate, formatIssue, formatNumber, parseNumberPattern, relativeDays, type MomentLike } from "../src/model/formats";

const m = moment as unknown as MomentLike;
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const TODAY = day("2026-11-01");

describe("date formats", () => {
	it("formats with moment patterns", () => {
		expect(formatDate(day("2026-11-01"), "YYYY-MM-DD", m, TODAY)).toBe("2026-11-01");
		expect(formatDate(day("2026-03-05"), "D MMM YYYY", m, TODAY)).toBe("5 Mar 2026");
		expect(formatDate(day("2026-03-05"), "ddd D MMM", m, TODAY)).toBe("Thu 5 Mar");
		expect(formatDate(day("2026-03-05"), "DD/MM/YYYY", m, TODAY)).toBe("05/03/2026");
		expect(formatDate(day("2026-03-05"), "[Week] W, YYYY", m, TODAY)).toBe("Week 10, 2026");
		expect(formatDate(day("1815-12-10"), "MMMM YYYY", m, TODAY)).toBe("December 1815");
	});

	it("formats relative to today", () => {
		expect(relativeDays(TODAY, TODAY)).toBe("today");
		expect(relativeDays(TODAY + 1, TODAY)).toBe("tomorrow");
		expect(relativeDays(TODAY - 1, TODAY)).toBe("yesterday");
		expect(relativeDays(TODAY + 3, TODAY)).toBe("in 3 days");
		expect(relativeDays(TODAY - 21, TODAY)).toBe("3 weeks ago");
		expect(relativeDays(TODAY + 90, TODAY)).toBe("in 3 months");
		expect(relativeDays(TODAY - 800, TODAY)).toBe("2 years ago");
		expect(formatDate(TODAY + 7, "relative", m, TODAY)).toBe("in 7 days");
	});
});

describe("number formats", () => {
	const f = (n: number, fmt: string) => formatNumber(n, fmt, "en-AU", "AUD").replace(/\u00a0/g, " ");
	it("formats presets", () => {
		expect(f(1234.567, "number")).toBe("1,234.57");
		expect(f(1234.5, "integer")).toBe("1,235");
		expect(f(1234.5, "decimal:2")).toBe("1,234.50");
		expect(f(1234.5, "decimal:0")).toBe("1,235");
		expect(f(180000, "currency")).toBe("$180,000.00");
		expect(f(180000, "currency:USD")).toBe("USD 180,000.00");
		expect(formatNumber(180000, "currency:EUR", "de-DE").replace(/\u00a0/g, " ")).toBe("180.000,00 €");
		expect(f(1234567, "compact")).toBe("1.2M");
		expect(f(42.25, "percent")).toBe("42.3%");
		expect(f(5, "currency:XYZ")).toBe("XYZ 5.00");
	});

	it("formats spreadsheet-style patterns with text around them", () => {
		expect(f(180000, "$#,##0")).toBe("$180,000");
		expect(f(12.5, "#,##0 h")).toBe("13 h");
		expect(f(12.25, "0.0 kg")).toBe("12.3 kg");
		expect(f(1234.5, "#,##0.00")).toBe("1,234.50");
		expect(f(1234.5, "0.##")).toBe("1234.5");
		expect(f(3, "Sprint 0")).toBe("Sprint 3");
		expect(f(3, "no digits")).toBe("3");
		expect(parseNumberPattern("€ #,##0.00 ex GST")).toEqual({ prefix: "€ ", suffix: " ex GST", grouping: true, min: 2, max: 2 });
	});

	it("reports unusable formats", () => {
		expect(formatIssue("number", "currency:dollars")).toBe("Currency codes have three letters, e.g. AUD.");
		expect(formatIssue("number", "hours")).toBe("A number pattern needs # or 0, e.g. #,##0.00.");
		expect(formatIssue("number", "#,##0 h")).toBeNull();
		expect(formatIssue("date", "")).toBe("Enter a format.");
	});
});
