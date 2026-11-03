import moment from "moment";
import { describe, expect, it } from "vitest";
import { isoDateAdapter } from "../src/model/dates";
import {
	datePresetLabels,
	DEFAULT_DATE_FORMAT,
	editPattern,
	editText,
	fieldFormatIssue,
	formatValue,
	isTypeablePattern,
	parseNumberText,
	parseTyped,
	urlDomain,
	type FormatEnv,
} from "../src/model/fieldFormats";
import type { MomentLike } from "../src/model/formats";
import { mergeSettings } from "../src/model/settings";
import { typeIssues } from "../src/model/validation";
import { defaultFormat, formatCell, type ResolvedColumn } from "../src/model/views";
import type { EntityTypeDef, FieldDef } from "../src/model/types";

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const env: FormatEnv = { dates: isoDateAdapter, moment: moment as unknown as MomentLike, locale: "en-AU", currency: "AUD", today: day("2026-12-02"), dateFormat: DEFAULT_DATE_FORMAT };
const f = (kind: FieldDef["kind"], format?: string): FieldDef => ({ key: "x", label: "X", kind, ...(format !== undefined ? { format } : {}) });

describe("field display formats", () => {
	it("shows dates in the field's format, or the Date display format setting", () => {
		expect(formatValue(f("date"), "2026-12-05", env)).toBe("05/12/2026");
		expect(formatValue(f("date", "D MMM YYYY"), "2026-12-05", env)).toBe("5 Dec 2026");
		expect(formatValue(f("date", "relative"), "2026-12-05", env)).toBe("in 3 days");
		expect(formatValue(f("date"), "2026-12-05", { ...env, dateFormat: "dddd, D MMMM YYYY" })).toBe("Saturday, 5 December 2026");
		expect(formatValue(f("date"), "soon", env)).toBe("soon");
		expect(formatValue(f("date"), "", env)).toBe("");
		// Without moment (or with a custom calendar) the adapter's own display is used.
		expect(formatValue(f("date", "D MMM YYYY"), "2026-12-05", { ...env, moment: undefined })).toBe("5 December 2026");
	});

	it("shows numbers in their format; plain without one", () => {
		expect(formatValue(f("number"), 1240.5, env)).toBe("1240.5");
		expect(formatValue(f("number", "currency"), 1240.5, env)).toBe("$1,240.50");
		expect(formatValue(f("number", "percent"), 45, env)).toBe("45%");
		expect(formatValue(f("number", "#,##0 h"), 1240, env)).toBe("1,240 h");
		expect(formatValue(f("number", "currency"), "lots", env)).toBe("lots");
		// An unusable format is ignored.
		expect(formatValue(f("number", "nonsense"), 3, env)).toBe("3");
	});

	it("shows checkboxes and links", () => {
		expect(formatValue(f("boolean"), true, env)).toBe("Yes");
		expect(formatValue(f("boolean"), false, env)).toBe("");
		expect(formatValue(f("boolean", "yesno"), false, env)).toBe("No");
		expect(formatValue(f("boolean", "check"), true, env)).toBe("✓");
		expect(formatValue(f("url", "domain"), "https://www.github.com/obsidianmd", env)).toBe("github.com");
		expect(formatValue(f("url", "text:Website"), "https://example.com", env)).toBe("Website");
		expect(formatValue(f("url"), "example.com/a", env)).toBe("example.com/a");
		expect(urlDomain("mailto:ada@example.com")).toBe("example.com");
		expect(urlDomain("not a url")).toBe("not a url");
	});

	it("edits dates in a typeable format, else ISO", () => {
		expect(isTypeablePattern("DD/MM/YYYY")).toBe(true);
		expect(isTypeablePattern("D MMM YYYY")).toBe(true);
		expect(isTypeablePattern("dddd, D MMMM YYYY")).toBe(true);
		expect(isTypeablePattern("ddd D MMM")).toBe(false);
		expect(isTypeablePattern("MMMM YYYY")).toBe(false);
		expect(isTypeablePattern("relative")).toBe(false);
		expect(isTypeablePattern("DDDD YYYY MM")).toBe(false);
		expect(editPattern(f("date"), env)).toBe("DD/MM/YYYY");
		expect(editPattern(f("date", "relative"), env)).toBe("YYYY-MM-DD");
		expect(editText(f("date"), "2026-12-05", env)).toBe("05/12/2026");
		expect(editText(f("date", "MMMM YYYY"), "2026-12-05", env)).toBe("2026-12-05");
		expect(editText(f("number", "currency"), 1240.5, env)).toBe("1240.5");
	});

	it("reads typed dates in the edit format or ISO", () => {
		expect(parseTyped(f("date"), "05/12/2026", env)).toEqual({ ok: true, value: "2026-12-05" });
		expect(parseTyped(f("date"), "2026-12-05", env)).toEqual({ ok: true, value: "2026-12-05" });
		expect(parseTyped(f("date", "D MMM YYYY"), "5 Dec 2026", env)).toEqual({ ok: true, value: "2026-12-05" });
		expect(parseTyped(f("date"), "", env)).toEqual({ ok: true, value: null });
		const bad = parseTyped(f("date"), "31/02/2026", env);
		expect(bad.ok).toBe(false);
		expect(!bad.ok && bad.error).toContain("DD/MM/YYYY or YYYY-MM-DD");
		// Not typeable: only ISO, with the adapter's message.
		expect(parseTyped(f("date", "relative"), "05/12/2026", env).ok).toBe(false);
	});

	it("reads typed numbers with symbols, separators and units", () => {
		expect(parseNumberText("1240.5", "en-AU")).toBe(1240.5);
		expect(parseNumberText("$1,240.50", "en-AU")).toBe(1240.5);
		expect(parseNumberText("45%", "en-AU")).toBe(45);
		expect(parseNumberText("32 h", "en-AU")).toBe(32);
		expect(parseNumberText("-$5", "en-AU")).toBe(-5);
		expect(parseNumberText("(1,000)", "en-AU")).toBe(-1000);
		expect(parseNumberText("1.240,5 €", "de-DE")).toBe(1240.5);
		expect(parseNumberText("abc", "en-AU")).toBeNull();
		// K / M / B only with the compact format, so "5 m" (metres) stays 5.
		expect(parseNumberText("1.2K", "en-AU", "compact")).toBe(1200);
		expect(parseNumberText("5 m", "en-AU")).toBe(5);
		expect(parseTyped(f("number", "currency"), "$1,240.50", env)).toEqual({ ok: true, value: 1240.5 });
		expect(parseTyped(f("number"), "lots", env).ok).toBe(false);
	});

	it("checks formats and flags them on the type", () => {
		expect(fieldFormatIssue("number", "currency:AU")).toContain("three letters");
		expect(fieldFormatIssue("date", " ")).toContain("Enter");
		expect(fieldFormatIssue("boolean", "maybe")).toBeTruthy();
		expect(fieldFormatIssue("url", "text: ")).toContain("text");
		expect(fieldFormatIssue("url", "text:Site")).toBeNull();
		expect(fieldFormatIssue("text", "x")).toBeTruthy();
		expect(fieldFormatIssue("text", undefined)).toBeNull();
		const t: EntityTypeDef = { key: "t", name: "T", plural: "Ts", icon: "x", color: "", group: "g", fields: [f("number", "#")] } as unknown as EntityTypeDef;
		t.fields[0].format = "currency:12";
		expect(typeIssues(t, { typeKeys: [], groupKeys: ["g"] }).some((i) => i.at === "field:0:format")).toBe(true);
	});

	it("starts the Date display format setting at DD/MM/YYYY", () => {
		expect(mergeSettings(null).dateFormat).toBe("DD/MM/YYYY");
		expect(mergeSettings({ dateFormat: "" } as never).dateFormat).toBe("DD/MM/YYYY");
		expect(mergeSettings({ dateFormat: "relative" } as never).dateFormat).toBe("relative");
	});

	it("labels date presets by example, adding the pattern where two look the same", () => {
		const may = datePresetLabels((p) => formatValue(f("date", p), "2027-05-31", env));
		expect(may.find((p) => p.pattern === "D MMM YYYY")!.label).toBe("31 May 2027 (D MMM YYYY)");
		expect(may.find((p) => p.pattern === "D MMMM YYYY")!.label).toBe("31 May 2027 (D MMMM YYYY)");
		expect(may.find((p) => p.pattern === "DD/MM/YYYY")!.label).toBe("31/05/2027");
		const dec = datePresetLabels((p) => formatValue(f("date", p), "2026-12-05", env));
		expect(dec.find((p) => p.pattern === "D MMM YYYY")!.label).toBe("5 Dec 2026");
		expect(dec.find((p) => p.pattern === "relative")!.label).toBe("Relative (in 3 days)");
	});

	it("is the default for view columns; the view's own format wins", () => {
		const ctx = { moment: env.moment, locale: "en-AU", currency: "AUD", today: env.today, dateFormat: "DD/MM/YYYY" };
		const col = (kind: "number" | "date", field?: FieldDef) => ({ id: "c", kind, label: "C", def: { kind: "field", key: "x" }, field }) as unknown as ResolvedColumn;
		const cell = (v: number) => ({ value: v, text: String(v), sort: v });
		expect(defaultFormat(col("number", f("number", "currency")), ctx)).toBe("currency");
		expect(formatCell(cell(1240.5), col("number", f("number", "currency")), undefined, ctx).text).toBe("$1,240.50");
		expect(formatCell(cell(1240.5), col("number", f("number", "currency")), "integer", ctx).text).toBe("1,241");
		expect(formatCell(cell(1240.5), col("number", f("number")), undefined, ctx).text).toBe("1240.5");
		// Dates: the field's format, else the setting; without the setting, unchanged.
		expect(formatCell(cell(day("2026-12-05")), col("date", f("date", "D MMM YYYY")), undefined, ctx).text).toBe("5 Dec 2026");
		expect(formatCell(cell(day("2026-12-05")), col("date"), undefined, ctx).text).toBe("05/12/2026");
		expect(formatCell(cell(day("2026-12-05")), col("date"), undefined, { ...ctx, dateFormat: undefined }).text).toBe(String(day("2026-12-05")));
	});
});
