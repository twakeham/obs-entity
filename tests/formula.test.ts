import { describe, expect, it } from "vitest";
import { compile, DateVal, evaluate, FormulaError, FUNCTIONS, parse, toDisplay, toStored, tokenize, type EvalEnv, type FValue, type RefColumn } from "../src/model/formula";
import type { LinkValue } from "../src/model/views";

const DAY = 86_400_000;
const d = (iso: string) => new DateVal(Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY));
const iso = (v: FValue) => (v instanceof DateVal ? new Date(v.days * DAY).toISOString().slice(0, 10) : v);
const link = (name: string): LinkValue => ({ path: `${name}.md`, linktext: name, name });

const COLUMNS: RefColumn[] = [
	{ id: "name", label: "Name", type: "text" },
	{ id: "status", label: "Status", type: "text" },
	{ id: "due", label: "Due", type: "date" },
	{ id: "start", label: "Start", type: "date" },
	{ id: "budget", label: "Budget", type: "number" },
	{ id: "tasks", label: "Tasks", type: "number" },
	{ id: "hours", label: "Estimate (h)", type: "number" },
	{ id: "team", label: "Team", type: "links" },
	{ id: "tags", label: "Tags", type: "list" },
	{ id: "done", label: "Done", type: "bool" },
	{ id: "empty_n", label: "Nothing", type: "number" },
];
const ROW: Record<string, FValue> = {
	name: "Mobile Banking App",
	status: "active",
	due: d("2026-12-15"),
	start: d("2026-04-15"),
	budget: 320000,
	tasks: 11,
	hours: 91,
	team: [link("Ethan Brooks"), link("Sofia Alvarez")],
	tags: ["urgent", "mobile"],
	done: false,
	empty_n: null,
};
const PROPS: Record<string, Record<string, FValue>> = { "Ethan Brooks.md": { Role: "Engineer", Capacity: 40 }, "Sofia Alvarez.md": { Role: "Designer", Capacity: 32 } };
const env: EvalEnv = {
	col: (id) => ROW[id] ?? null,
	today: d("2026-11-01").days,
	prop: (l, f) => PROPS[l.path ?? ""]?.[f] ?? null,
	dateText: (days) => new Date(days * DAY).toISOString().slice(0, 10),
	parseDate: (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY) : null),
	format: (v, p) => (v instanceof DateVal ? `${p}:${new Date(v.days * DAY).toISOString().slice(0, 10)}` : `${p}:${v}`),
};
const run = (src: string) => iso(evaluate(compile(src, COLUMNS).ast, env));
const err = (src: string) => {
	try {
		const c = compile(src, COLUMNS);
		evaluate(c.ast, env);
	} catch (e) {
		return e instanceof FormulaError ? `${e.message} @${e.from}-${e.to}` : String(e);
	}
	return "no error";
};

describe("formula: lexing and parsing", () => {
	it("tokenizes references, strings, numbers and operators", () => {
		expect(tokenize('[Estimate (h)] >= 1.5 & "a \\"b\\"" <> x').map((t) => `${t.t}:${t.v}`)).toEqual(["ref:Estimate (h)", "op:>=", "num:1.5", "op:&", 'str:a "b"', "op:<>", "id:x", "eof:"]);
	});

	it("follows precedence: not < comparison < & < + < *, and unary minus", () => {
		const show = (n: ReturnType<typeof parse>): string =>
			n.k === "bin" ? `(${show(n.a)} ${n.op} ${show(n.b)})` : n.k === "un" ? `(${n.op} ${show(n.a)})` : n.k === "num" ? String(n.v) : n.k === "ref" ? `[${n.name}]` : n.k === "call" ? `${n.fn}(${n.args.map(show).join(",")})` : n.k;
		expect(show(parse("1 + 2 * 3 - -4"))).toBe("((1 + (2 * 3)) - (- 4))");
		expect(show(parse("not [A] = 1 and [B] > 2 or [C]"))).toBe("(((not ([A] = 1)) and ([B] > 2)) or [C])");
		expect(show(parse("[A] & 1 + 2 = [B]"))).toBe("(([A] & (1 + 2)) = [B])");
		expect(show(parse("if([A] == 1 && [B] != 2, max(1, 2), 3)"))).toBe("if((([A] = 1) and ([B] != 2)),max(1,2),3)");
	});

	it("reports syntax errors with their position", () => {
		expect(err("[Budget] / ")).toBe("The formula ends too early. @11-11");
		expect(err("round([Budget] 2)")).toBe("Expected “,” or “)”, found “2”. @15-16");
		expect(err('"open')).toBe("This text is missing its closing quote. @0-5");
		expect(err("[Budget")).toBe("This column reference is missing its closing ]. @0-7");
		expect(err("1 2")).toBe("Unexpected “2”: is an operator or comma missing? @2-3");
		expect(err("[] + 1")).toBe("Empty column reference: write a column name between [ and ]. @0-2");
		expect(err("")).toBe("Write a formula, e.g. [Budget] / [Tasks]. @0-0");
	});
});

describe("formula: compiling", () => {
	it("resolves references by label or id, collects them, and infers the type", () => {
		const c = compile("[budget] / [Tasks] + [Estimate (h)]", COLUMNS);
		expect(c.refs).toEqual(["budget", "tasks", "hours"]);
		expect(c.type).toBe("number");
		const types = (s: string) => compile(s, COLUMNS).type;
		expect(types("[Due] - today()")).toBe("number");
		expect(types("[Due] + 7")).toBe("date");
		expect(types('if([Done], "✓", "")')).toBe("text");
		expect(types("if([Done], 1, \"x\")")).toBe("any");
		expect(types("[Due] < today() and not [Done]")).toBe("bool");
		expect(types("map([Team], name(item))")).toBe("list");
		expect(types('filter([Team], prop(item, "Capacity") > 35)')).toBe("links");
		expect(types("max([Due], [Start])")).toBe("date");
	});

	it("reports unknown columns, names and functions, and wrong argument counts", () => {
		expect(err("[Dew] - today()")).toBe("Unknown column [Dew]. @0-5");
		expect(err("budget * 2")).toBe("Unknown name “budget”. Column references go in brackets, e.g. [budget]. @0-6");
		expect(err("today + 1")).toBe("today is a function: write today(…). @0-5");
		expect(err("frobnicate(1)")).toBe("Unknown function frobnicate(). @0-10");
		expect(err("round()")).toBe("round() needs 1–2 arguments: round(number, places?). @0-7");
		expect(err('dateDiff([Start], [Due])')).toBe('dateDiff() needs 3 arguments: dateDiff(start, end, "days|weeks|months|years"). @0-24');
		expect(err("item + 1")).toBe("item can only be used inside map() or filter(). @0-4");
	});

	it("converts references between labels and ids, keeping the rest", () => {
		const shown = '[Budget]/[Tasks] & " [x] " & [Estimate (h)]';
		const stored = toStored(shown, COLUMNS);
		expect(stored).toBe('[budget]/[tasks] & " [x] " & [hours]');
		expect(toDisplay(stored, COLUMNS)).toBe(shown);
		expect(toStored("[Unknown] + 1", COLUMNS)).toBe("[Unknown] + 1");
		expect(toDisplay('broken "', COLUMNS)).toBe('broken "');
	});

	it("documents every function, with an example that compiles", () => {
		for (const f of FUNCTIONS) {
			expect(f.sig.toLowerCase().startsWith(`${f.name}(`), f.name).toBe(true);
			expect(f.desc && f.example, f.name).toBeTruthy();
			const extra = [...f.example.matchAll(/\[([^\]]+)\]/g)].map((m) => ({ id: m[1], label: m[1], type: "any" as const }));
			expect(() => compile(f.example, [...COLUMNS, ...extra], { workflow: !!f.workflow }), f.name).not.toThrow();
		}
	});

	it("keeps old() and new() to workflows, on a column", () => {
		expect(() => compile("old([Budget])", COLUMNS)).toThrow(/only works in workflows/);
		expect(() => compile("old(1)", COLUMNS, { workflow: true })).toThrow(/needs a column/);
		expect(compile("new([Budget]) - old([Budget])", COLUMNS, { workflow: true }).type).toBe("number");
	});
});

describe("formula: evaluating", () => {
	it("does arithmetic, dates and comparisons", () => {
		expect(run("[Budget] / [Tasks]")).toBeCloseTo(29090.909, 2);
		expect(run("[Due] - today()")).toBe(44);
		expect(run("[Due] + 7")).toBe("2026-12-22");
		expect(run("today() - 1")).toBe("2026-10-31");
		expect(run("[Due] > today() and [Status] = \"active\"")).toBe(true);
		expect(run('[Due] < "2027-01-01"')).toBe(true);
		expect(run("[Tasks] % 4")).toBe(3);
		expect(run("[Nothing] + 1")).toBeNull();
		expect(run("[Nothing] > 1")).toBe(false);
		expect(run('[Name] & " (" & [Status] & ")"')).toBe("Mobile Banking App (active)");
		expect(run('"2" + 3')).toBe(5);
	});

	it("reports runtime problems", () => {
		expect(err("[Budget] / 0")).toBe("Division by zero. @0-12");
		expect(err('[Name] + 1')).toBe('Use & to join text, e.g. [Name] & " " & [Status]. @0-10');
		expect(err("[Due] + [Start]")).toBe("Can't add two dates; subtract them to get days, or add a number of days. @0-15");
		expect(err('[Due] > 5')).toBe("Can't compare a date with a number. @0-9");
		expect(err('dateAdd([Due], 1, "fortnights")')).toBe('The unit should be "days", "weeks", "months", "years". @18-30');
		expect(err('prop([Name], "Role")')).toBe("prop() needs a link, got text. @5-11");
	});

	it("logic", () => {
		expect(run('if([Done], "✓", "…")')).toBe("…");
		expect(run('ifs([Budget] > 500000, "Large", [Budget] > 100000, "Medium", "Small")')).toBe("Medium");
		expect(run('ifs([Budget] > 500000, "Large")')).toBeNull();
		expect(run("and(true, [Tasks] > 3)")).toBe(true);
		expect(run("or(false, empty([Nothing]))")).toBe(true);
		expect(run("not(empty([Team]))")).toBe(true);
		expect(run("coalesce([Nothing], [Tasks])")).toBe(11);
		// lazy: the unused branch isn't evaluated
		expect(run("if(true, 1, [Budget] / 0)")).toBe(1);
	});

	it("maths", () => {
		expect(run("round([Budget] / [Tasks], 2)")).toBe(29090.91);
		expect(run("round(2.5)")).toBe(3);
		expect([run("floor(7.9)"), run("ceil(7.1)"), run("abs(-3)"), run("sqrt(16)"), run("pow(2, 10)"), run("mod(10, 4)")]).toEqual([7, 8, 3, 4, 1024, 2]);
		expect(run("min(3, [Tasks], 20)")).toBe(3);
		expect(run("max([Due], [Start])")).toBe("2026-12-15");
		expect(run("sum([Tasks], [Hours], [Nothing])".replace("[Hours]", "[Estimate (h)]"))).toBe(102);
		expect(run("avg(1, 2, 6)")).toBe(3);
		expect(run('number("1,250")')).toBe(1250);
		expect(run('number("x")')).toBeNull();
	});

	it("text", () => {
		expect(run('concat([Status], "-", [Tasks])')).toBe("active-11");
		expect([run("upper([Status])"), run('lower("AB")'), run('trim("  x ")'), run("len([Name])")]).toEqual(["ACTIVE", "ab", "x", 18]);
		expect([run("left([Name], 6)"), run("right([Name], 3)"), run("mid([Name], 8, 7)")]).toEqual(["Mobile", "App", "Banking"]);
		expect(run('replace([Name], " ", "-")')).toBe("Mobile-Banking-App");
		expect([run('contains([Name], "BANK")'), run('startsWith([Name], "mob")')]).toEqual([true, true]);
		expect(run('format([Budget], "currency")')).toBe("currency:320000");
		expect(run('format([Due], "D MMM")')).toBe("D MMM:2026-12-15");
		expect(run("text([Due])")).toBe("2026-12-15");
	});

	it("dates", () => {
		expect([run("year([Due])"), run("month([Due])"), run("day([Due])"), run("weekday([Due])")]).toEqual([2026, 12, 15, 2]);
		expect(run("date(2027, 2, 30)")).toBe("2027-03-02");
		expect(run('date("2026-01-31")')).toBe("2026-01-31");
		expect(run('dateAdd(date("2026-01-31"), 1, "month")')).toBe("2026-02-28");
		expect(run('dateAdd([Due], -2, "weeks")')).toBe("2026-12-01");
		expect(run('dateAdd([Due], 1, "years")')).toBe("2027-12-15");
		expect(run('dateDiff([Start], [Due], "days")')).toBe(244);
		expect(run('dateDiff([Start], [Due], "weeks")')).toBe(34);
		expect(run('dateDiff([Start], [Due], "months")')).toBe(8);
		// consistent with dateAdd: 31 Jan + 1 month = 28 Feb
		expect(run('dateDiff(date("2026-01-31"), date("2026-02-28"), "months")')).toBe(1);
		expect(run('dateDiff(date("2026-01-31"), date("2026-02-27"), "months")')).toBe(0);
		expect(run('dateDiff([Due], [Start], "months")')).toBe(-8);
		expect(run('dateDiff(date(2020, 2, 29), date(2026, 2, 28), "years")')).toBe(6);
		expect(run('dateDiff(date(2020, 3, 1), date(2026, 2, 28), "years")')).toBe(5);
		expect(run('startOf([Due], "week")')).toBe("2026-12-14");
		expect(run('endOf([Due], "week")')).toBe("2026-12-20");
		expect(run('startOf([Due], "month")')).toBe("2026-12-01");
		expect(run('endOf(date("2026-02-10"), "month")')).toBe("2026-02-28");
		expect(run('endOf([Due], "year")')).toBe("2026-12-31");
	});

	it("lists and links", () => {
		expect([run("count([Team])"), run("count([Nothing])"), run("count([Status])")]).toEqual([2, 0, 1]);
		expect(run("first([Tags])")).toBe("urgent");
		expect(run("name(last([Team]))")).toBe("Sofia Alvarez");
		expect(run('join([Tags], " · ")')).toBe("urgent · mobile");
		expect(run("join([Team])")).toBe("Ethan Brooks, Sofia Alvarez");
		expect([run('includes([Tags], "URGENT")'), run('includes([Team], "sofia alvarez")'), run('includes([Tags], "x")')]).toEqual([true, true, false]);
		expect(run('sort(map([Team], prop(item, "Role")))')).toEqual(["Designer", "Engineer"]);
		expect(run('unique(map([Team], "x"))')).toEqual(["x"]);
		expect(run("name([Team])")).toEqual(["Ethan Brooks", "Sofia Alvarez"]);
		expect(run('sum(map([Team], prop(item, "Capacity")))')).toBe(72);
		expect(run('join(map(filter([Team], prop(item, "Capacity") > 35), name(item)))')).toBe("Ethan Brooks");
		expect(run('prop(first([Team]), "Role")')).toBe("Engineer");
	});
});
