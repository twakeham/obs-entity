/**
 * Formula columns: a small spreadsheet-style expression language, evaluated by this interpreter (never as JS).
 *
 *   [Budget] / [Tasks]
 *   if([Status] = "done", "✓", "")
 *   dateDiff(today(), [Due], "days")
 *   join(map([Team], name(item)), ", ")
 *
 * Column references are written `[Name]` and resolved by label or id; formulas are stored with ids
 * (`toStored`) and shown with labels (`toDisplay`). Pure: no Obsidian dependency.
 */
import type { LinkValue } from "./views";

// ---------------------------------------------------------------- values and types

export type FType = "number" | "text" | "bool" | "date" | "list" | "links" | "any";
export const FTYPES: FType[] = ["number", "text", "bool", "date", "list", "links"];
export const FTYPE_LABEL: Record<FType, string> = { number: "Number", text: "Text", bool: "True/false", date: "Date", list: "List", links: "Links", any: "Any" };

/** A date: whole days since 1970-01-01 (UTC), like the view's date cells. */
export class DateVal {
	constructor(readonly days: number) {}
}
export type FValue = number | string | boolean | DateVal | LinkValue | FValue[] | null;

export const isLink = (v: unknown): v is LinkValue => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof DateVal) && "linktext" in (v as object);
const isEmptyV = (v: FValue): boolean => v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** A formula problem, with the source range it's about (for underlines). */
export class FormulaError extends Error {
	constructor(
		message: string,
		readonly from = 0,
		readonly to = 0,
	) {
		super(message);
	}
}

// ---------------------------------------------------------------- lexer

export type TokKind = "num" | "str" | "ref" | "id" | "op" | "(" | ")" | "," | "eof";
export interface Token {
	t: TokKind;
	v: string;
	from: number;
	to: number;
}

const OPS = ["<=", ">=", "!=", "<>", "==", "&&", "||", "=", "<", ">", "+", "-", "*", "/", "%", "&", "!"];

/** Tokens of a formula. Unterminated strings and references are errors. */
export function tokenize(src: string): Token[] {
	const out: Token[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		const from = i;
		if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
			const m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
			i += m[0].length;
			out.push({ t: "num", v: m[0], from, to: i });
		} else if (c === '"' || c === "'" || c === "“" || c === "”") {
			const close = c === "“" ? "”" : c;
			let s = "";
			i++;
			while (i < src.length && src[i] !== close && !(c === "”" && src[i] === "”")) {
				if (src[i] === "\\" && i + 1 < src.length) {
					const e = src[i + 1];
					s += e === "n" ? "\n" : e === "t" ? "\t" : e;
					i += 2;
				} else s += src[i++];
			}
			if (i >= src.length) throw new FormulaError("This text is missing its closing quote.", from, src.length);
			i++;
			out.push({ t: "str", v: s, from, to: i });
		} else if (c === "[") {
			const end = src.indexOf("]", i + 1);
			if (end < 0) throw new FormulaError("This column reference is missing its closing ].", from, src.length);
			out.push({ t: "ref", v: src.slice(i + 1, end).trim(), from, to: end + 1 });
			i = end + 1;
		} else if (/[A-Za-z_]/.test(c)) {
			const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
			i += m[0].length;
			out.push({ t: "id", v: m[0], from, to: i });
		} else if (c === "(" || c === ")" || c === ",") {
			i++;
			out.push({ t: c, v: c, from, to: i });
		} else {
			const op = OPS.find((o) => src.startsWith(o, i));
			if (!op) throw new FormulaError(`Unexpected “${c}”.`, from, from + 1);
			i += op.length;
			out.push({ t: "op", v: op, from, to: i });
		}
	}
	out.push({ t: "eof", v: "", from: src.length, to: src.length });
	return out;
}

// ---------------------------------------------------------------- parser

export type Node =
	| { k: "num"; v: number; from: number; to: number }
	| { k: "str"; v: string; from: number; to: number }
	| { k: "bool"; v: boolean; from: number; to: number }
	| { k: "ref"; name: string; id: string | null; from: number; to: number }
	| { k: "var"; name: string; from: number; to: number }
	| { k: "call"; fn: string; args: Node[]; from: number; to: number; nameTo: number }
	| { k: "un"; op: "-" | "not"; a: Node; from: number; to: number }
	| { k: "bin"; op: string; a: Node; b: Node; from: number; to: number };

const BIN_LEVELS: string[][] = [["or"], ["and"], ["=", "!=", "<", "<=", ">", ">="], ["&"], ["+", "-"], ["*", "/", "%"]];
const OP_ALIAS: Record<string, string> = { "==": "=", "<>": "!=", "&&": "and", "||": "or", "!": "not" };

/** Parse a formula into a tree. References keep their written name; `compile` resolves them. */
export function parse(src: string): Node {
	const toks = tokenize(src);
	let p = 0;
	const peek = () => toks[p];
	const opOf = (t: Token) => (t.t === "op" ? (OP_ALIAS[t.v] ?? t.v) : t.t === "id" && /^(and|or|not)$/i.test(t.v) ? t.v.toLowerCase() : null);
	const expect = (t: TokKind, what: string) => {
		const tok = peek();
		if (tok.t !== t) throw new FormulaError(tok.t === "eof" ? `Expected ${what} at the end.` : `Expected ${what}, found “${tok.v}”.`, tok.from, Math.max(tok.to, tok.from + 1));
		p++;
		return tok;
	};
	// Levels: 0 or, 1 and, (not), 2 comparison, 3 &, 4 + -, 5 * / %, then unary minus.
	const level = (n: number): Node => {
		if (n === BIN_LEVELS.length) return unary();
		const operand = () => (n === 1 ? notLevel() : level(n + 1));
		let a = operand();
		for (;;) {
			const op = opOf(peek());
			if (!op || !BIN_LEVELS[n].includes(op)) return a;
			p++;
			const b = operand();
			a = { k: "bin", op, a, b, from: a.from, to: b.to };
		}
	};
	// `not` binds looser than comparison: not [A] = 1  →  not ([A] = 1)
	const notLevel = (): Node => {
		const t = peek();
		if (opOf(t) === "not" && !(t.t === "id" && toks[p + 1]?.t === "(")) {
			p++;
			const a = notLevel();
			return { k: "un", op: "not", a, from: t.from, to: a.to };
		}
		return level(2);
	};
	const unary = (): Node => {
		const t = peek();
		if (t.t === "op" && (t.v === "-" || t.v === "+")) {
			p++;
			const a = unary();
			return t.v === "-" ? { k: "un", op: "-", a, from: t.from, to: a.to } : a;
		}
		return primary();
	};
	const primary = (): Node => {
		const t = peek();
		switch (t.t) {
			case "num":
				p++;
				return { k: "num", v: Number(t.v), from: t.from, to: t.to };
			case "str":
				p++;
				return { k: "str", v: t.v, from: t.from, to: t.to };
			case "ref":
				p++;
				if (!t.v) throw new FormulaError("Empty column reference: write a column name between [ and ].", t.from, t.to);
				return { k: "ref", name: t.v, id: null, from: t.from, to: t.to };
			case "(": {
				p++;
				const e = level(0);
				expect(")", "“)”");
				return e;
			}
			case "id": {
				p++;
				const lower = t.v.toLowerCase();
				if (peek().t === "(") {
					p++;
					const args: Node[] = [];
					if (peek().t !== ")") {
						for (;;) {
							args.push(level(0));
							if (peek().t === ",") {
								p++;
								continue;
							}
							break;
						}
					}
					const close = expect(")", "“,” or “)”");
					return { k: "call", fn: lower, args, from: t.from, to: close.to, nameTo: t.to };
				}
				if (lower === "true" || lower === "false") return { k: "bool", v: lower === "true", from: t.from, to: t.to };
				return { k: "var", name: lower, from: t.from, to: t.to };
			}
			case "eof":
				throw new FormulaError("The formula ends too early.", t.from, t.from);
			default:
				throw new FormulaError(`Unexpected “${t.v}”.`, t.from, t.to);
		}
	};
	const tree = level(0);
	const rest = peek();
	if (rest.t !== "eof") throw new FormulaError(`Unexpected “${rest.v}”: is an operator or comma missing?`, rest.from, rest.to);
	return tree;
}

// ---------------------------------------------------------------- functions

export type FnCategory = "Logic" | "Maths" | "Text" | "Dates" | "Lists" | "Links" | "Workflows";

export interface FnDef {
	name: string;
	cat: FnCategory;
	/** e.g. "round(number, places?)" */
	sig: string;
	desc: string;
	example: string;
	min: number;
	max: number;
	/** result type from the argument types */
	ret: FType | ((args: FType[]) => FType);
	/** only in workflow formulas (compile with `{ workflow: true }`) */
	workflow?: true;
}

const same = (args: FType[], from = 0, step = 1): FType => {
	const ts = args.filter((_, i) => i >= from && (i - from) % step === 0).filter((t) => t !== "any");
	return ts.length && ts.every((t) => t === ts[0]) ? ts[0] : "any";
};

export const FUNCTIONS: FnDef[] = [
	// Logic
	{ name: "if", cat: "Logic", sig: "if(condition, then, else)", desc: "The second value when the condition is true, otherwise the third.", example: 'if([Status] = "done", "✓", "")', min: 2, max: 3, ret: (a) => (a.length < 3 ? a[1] : same([a[1], a[2]])) },
	{ name: "ifs", cat: "Logic", sig: "ifs(condition1, value1, condition2, value2, …, else?)", desc: "The value after the first true condition; the last value if none are true.", example: 'ifs([Budget] > 200000, "Large", [Budget] > 50000, "Medium", "Small")', min: 2, max: Infinity, ret: (a) => same([...a.filter((_, i) => i % 2 === 1), ...(a.length % 2 ? [a[a.length - 1]] : [])]) },
	{ name: "and", cat: "Logic", sig: "and(a, b, …)", desc: "True when every value is true. You can also write a and b.", example: 'and([Status] != "done", [Due] < today())', min: 1, max: Infinity, ret: "bool" },
	{ name: "or", cat: "Logic", sig: "or(a, b, …)", desc: "True when any value is true. You can also write a or b.", example: 'or([Priority] = "High", [Priority] = "Critical")', min: 1, max: Infinity, ret: "bool" },
	{ name: "not", cat: "Logic", sig: "not(value)", desc: "True when the value is false or empty.", example: "not(empty([Owner]))", min: 1, max: 1, ret: "bool" },
	{ name: "empty", cat: "Logic", sig: "empty(value)", desc: "True when the value is empty: no text, no number, no date or an empty list.", example: "empty([Due])", min: 1, max: 1, ret: "bool" },
	{ name: "coalesce", cat: "Logic", sig: "coalesce(a, b, …)", desc: "The first value that isn't empty.", example: "coalesce([Due], [Start], today())", min: 1, max: Infinity, ret: (a) => same(a) },
	// Maths
	{ name: "round", cat: "Maths", sig: "round(number, places?)", desc: "Rounds to a number of decimal places (0 by default).", example: "round([Budget] / [Tasks], 2)", min: 1, max: 2, ret: "number" },
	{ name: "floor", cat: "Maths", sig: "floor(number)", desc: "Rounds down to a whole number.", example: "floor([Estimate (h)] / 8)", min: 1, max: 1, ret: "number" },
	{ name: "ceil", cat: "Maths", sig: "ceil(number)", desc: "Rounds up to a whole number.", example: "ceil([Estimate (h)] / 8)", min: 1, max: 1, ret: "number" },
	{ name: "abs", cat: "Maths", sig: "abs(number)", desc: "The number without its sign.", example: "abs([Due] - today())", min: 1, max: 1, ret: "number" },
	{ name: "min", cat: "Maths", sig: "min(a, b, …)", desc: "The smallest number or earliest date. Lists are included item by item.", example: "min([Due], [Start])", min: 1, max: Infinity, ret: (a) => (a.every((t) => t === "date") ? "date" : "number") },
	{ name: "max", cat: "Maths", sig: "max(a, b, …)", desc: "The largest number or latest date. Lists are included item by item.", example: "max(0, [Due] - today())", min: 1, max: Infinity, ret: (a) => (a.every((t) => t === "date") ? "date" : "number") },
	{ name: "sum", cat: "Maths", sig: "sum(a, b, …)", desc: "Adds numbers. Lists are included item by item; empty values are skipped.", example: "sum([Estimate (h)], [Extra])", min: 1, max: Infinity, ret: "number" },
	{ name: "avg", cat: "Maths", sig: "avg(a, b, …)", desc: "The average of the numbers. Lists are included item by item; empty values are skipped.", example: "avg([Q1], [Q2], [Q3])", min: 1, max: Infinity, ret: "number" },
	{ name: "pow", cat: "Maths", sig: "pow(number, power)", desc: "A number raised to a power.", example: "pow(1.05, 3)", min: 2, max: 2, ret: "number" },
	{ name: "sqrt", cat: "Maths", sig: "sqrt(number)", desc: "The square root.", example: "sqrt([Area])", min: 1, max: 1, ret: "number" },
	{ name: "mod", cat: "Maths", sig: "mod(number, divisor)", desc: "The remainder after dividing (also written a % b).", example: "mod([Order], 2)", min: 2, max: 2, ret: "number" },
	{ name: "number", cat: "Maths", sig: "number(value)", desc: "Converts text (or true/false) to a number; empty if it isn't one.", example: 'number("42")', min: 1, max: 1, ret: "number" },
	{
		name: "value",
		cat: "Maths",
		sig: "value([Choice field])",
		desc: "The number a choice stands for (the field's values, set on its Choices tab); for multiple choice, the total of the chosen values. Empty when the choice has no value.",
		example: "value([Likelihood]) * value([Impact])",
		min: 1,
		max: 1,
		ret: "number",
	},
	// Text
	{ name: "concat", cat: "Text", sig: "concat(a, b, …)", desc: "Joins values into one text (also written a & b).", example: 'concat([Name], " (", [Status], ")")', min: 1, max: Infinity, ret: "text" },
	{ name: "text", cat: "Text", sig: "text(value)", desc: "The value as text.", example: "text([Budget])", min: 1, max: 1, ret: "text" },
	{ name: "upper", cat: "Text", sig: "upper(text)", desc: "In capitals.", example: "upper([Status])", min: 1, max: 1, ret: "text" },
	{ name: "lower", cat: "Text", sig: "lower(text)", desc: "In lower case.", example: "lower([Name])", min: 1, max: 1, ret: "text" },
	{ name: "trim", cat: "Text", sig: "trim(text)", desc: "Without spaces at the start and end.", example: "trim([Code])", min: 1, max: 1, ret: "text" },
	{ name: "len", cat: "Text", sig: "len(text)", desc: "The number of characters (or items, for a list).", example: "len([Description])", min: 1, max: 1, ret: "number" },
	{ name: "left", cat: "Text", sig: "left(text, count)", desc: "The first characters.", example: "left([Name], 3)", min: 2, max: 2, ret: "text" },
	{ name: "right", cat: "Text", sig: "right(text, count)", desc: "The last characters.", example: "right([Code], 4)", min: 2, max: 2, ret: "text" },
	{ name: "mid", cat: "Text", sig: "mid(text, start, count)", desc: "Characters from a position (1 is the first).", example: "mid([Code], 3, 2)", min: 3, max: 3, ret: "text" },
	{ name: "replace", cat: "Text", sig: "replace(text, find, with)", desc: "Replaces every occurrence of some text.", example: 'replace([Name], "-", " ")', min: 3, max: 3, ret: "text" },
	{ name: "contains", cat: "Text", sig: "contains(text, find)", desc: "True when the text contains the other text (ignoring case).", example: 'contains([Name], "audit")', min: 2, max: 2, ret: "bool" },
	{ name: "startswith", cat: "Text", sig: "startsWith(text, start)", desc: "True when the text starts with the other text (ignoring case).", example: 'startsWith([Code], "PRJ")', min: 2, max: 2, ret: "bool" },
	{ name: "format", cat: "Text", sig: "format(value, pattern)", desc: 'A number or date as text, using a column format pattern: "currency", "#,##0.00", "D MMM YYYY", "relative"…', example: 'format([Due], "D MMM")', min: 2, max: 2, ret: "text" },
	// Dates
	{ name: "today", cat: "Dates", sig: "today()", desc: "Today's date.", example: "[Due] - today()", min: 0, max: 0, ret: "date" },
	{ name: "now", cat: "Dates", sig: "now()", desc: "Today's date (dates have no time of day).", example: "now()", min: 0, max: 0, ret: "date" },
	{ name: "date", cat: "Dates", sig: "date(year, month, day) or date(text)", desc: "A date from its parts, or from text such as 2026-12-31.", example: "date(2026, 12, 31)", min: 1, max: 3, ret: "date" },
	{ name: "year", cat: "Dates", sig: "year(date)", desc: "The year.", example: "year([Due])", min: 1, max: 1, ret: "number" },
	{ name: "month", cat: "Dates", sig: "month(date)", desc: "The month, 1–12.", example: "month([Due])", min: 1, max: 1, ret: "number" },
	{ name: "day", cat: "Dates", sig: "day(date)", desc: "The day of the month.", example: "day([Due])", min: 1, max: 1, ret: "number" },
	{ name: "weekday", cat: "Dates", sig: "weekday(date)", desc: "The day of the week: 1 Monday … 7 Sunday.", example: "weekday([Due]) >= 6", min: 1, max: 1, ret: "number" },
	{ name: "dateadd", cat: "Dates", sig: 'dateAdd(date, amount, "days|weeks|months|years")', desc: "A date moved by an amount of time (negative to go back).", example: 'dateAdd([Start], 2, "weeks")', min: 3, max: 3, ret: "date" },
	{ name: "datediff", cat: "Dates", sig: 'dateDiff(start, end, "days|weeks|months|years")', desc: "Whole units from the start date to the end date (negative if the end is earlier).", example: 'dateDiff(today(), [Due], "weeks")', min: 3, max: 3, ret: "number" },
	{ name: "startof", cat: "Dates", sig: 'startOf(date, "week|month|year")', desc: "The first day of the date's week (Monday), month or year.", example: 'startOf([Due], "month")', min: 2, max: 2, ret: "date" },
	{ name: "endof", cat: "Dates", sig: 'endOf(date, "week|month|year")', desc: "The last day of the date's week (Sunday), month or year.", example: 'endOf(today(), "month")', min: 2, max: 2, ret: "date" },
	// Lists
	{ name: "list", cat: "Lists", sig: "list(a, b, …)", desc: "A list of the values (lists inside are flattened).", example: 'list("urgent", "design")', min: 0, max: Infinity, ret: "list" },
	{ name: "count", cat: "Lists", sig: "count(list)", desc: "The number of items (1 for a single value, 0 when empty).", example: "count([Team])", min: 1, max: 1, ret: "number" },
	{ name: "first", cat: "Lists", sig: "first(list)", desc: "The first item.", example: "first([Tags])", min: 1, max: 1, ret: (a) => (a[0] === "links" ? "links" : "any") },
	{ name: "last", cat: "Lists", sig: "last(list)", desc: "The last item.", example: "last([Tags])", min: 1, max: 1, ret: (a) => (a[0] === "links" ? "links" : "any") },
	{ name: "join", cat: "Lists", sig: 'join(list, separator?)', desc: 'The items as text, separated by ", " or the given separator.', example: 'join([Tags], " · ")', min: 1, max: 2, ret: "text" },
	{ name: "includes", cat: "Lists", sig: "includes(list, value)", desc: "True when the list has the value (links match by name or path; text ignores case).", example: 'includes([Tags], "urgent")', min: 2, max: 2, ret: "bool" },
	{ name: "unique", cat: "Lists", sig: "unique(list)", desc: "The list without repeats.", example: "unique(map([Team], prop(item, \"Team\")))", min: 1, max: 1, ret: (a) => (a[0] === "links" ? "links" : "list") },
	{ name: "sort", cat: "Lists", sig: "sort(list)", desc: "The list in order (numbers, dates or text, naturally).", example: "sort([Tags])", min: 1, max: 1, ret: (a) => (a[0] === "links" ? "links" : "list") },
	{ name: "map", cat: "Lists", sig: "map(list, expression)", desc: "Each item transformed by the expression, where item is the current item.", example: "map([Team], name(item))", min: 2, max: 2, ret: "list" },
	{ name: "filter", cat: "Lists", sig: "filter(list, condition)", desc: "The items for which the condition is true, where item is the current item.", example: 'filter([Tasks], prop(item, "Status") != "done")', min: 2, max: 2, ret: (a) => (a[0] === "links" ? "links" : "list") },
	// Links
	{ name: "name", cat: "Links", sig: "name(link)", desc: "The linked note's name (a list of names for several links).", example: "name([Owner])", min: 1, max: 1, ret: "text" },
	{ name: "prop", cat: "Links", sig: 'prop(link, "Field")', desc: "A field of the linked note, by its label or key (a list for several links).", example: 'prop([Project], "Due")', min: 2, max: 2, ret: "any" },
	{
		name: "notes",
		cat: "Links",
		sig: 'notes("type")',
		desc: 'Links to every note of a type (its key or name), of a group ("@group"), or every entity (notes()). Use with filter, count, sum and prop.',
		example: 'count(filter(notes("quest"), prop(item, "Status") = "active"))',
		min: 0,
		max: 1,
		ret: "links",
	},
	// Workflows
	{ name: "old", cat: "Workflows", sig: "old([Field])", desc: "The field's value before the change that started the workflow (the current value for other triggers).", example: 'old([Status]) = "blocked"', min: 1, max: 1, ret: (a) => a[0], workflow: true },
	{ name: "new", cat: "Workflows", sig: "new([Field])", desc: "The field's value after the change (the same as [Field]).", example: "new([Estimate]) - old([Estimate])", min: 1, max: 1, ret: (a) => a[0], workflow: true },
];
const FN = new Map(FUNCTIONS.map((f) => [f.name, f]));
export const functionDef = (name: string): FnDef | undefined => FN.get(name.toLowerCase());

// ---------------------------------------------------------------- compiling: references and checks

export interface RefColumn {
	id: string;
	label: string;
	type: FType;
}

export interface Compiled {
	ast: Node;
	/** referenced column ids */
	refs: string[];
	type: FType;
}

/** Find a referenced column: by label (ignoring case) first, then by id. */
export function findColumn(name: string, columns: RefColumn[]): RefColumn | undefined {
	const n = name.trim().toLowerCase();
	return columns.find((c) => c.label.toLowerCase() === n) ?? columns.find((c) => c.id.toLowerCase() === n);
}

/**
 * Parse and check a formula: resolve references (unknown columns are errors), check function names and
 * argument counts, and infer the result type. Throws the first problem as a FormulaError. Workflow-only
 * functions (old, new) need `{ workflow: true }`.
 */
export function compile(src: string, columns: RefColumn[], opts: { workflow?: boolean } = {}): Compiled {
	if (!src.trim()) throw new FormulaError("Write a formula, e.g. [Budget] / [Tasks].", 0, 0);
	const ast = parse(src);
	const refs = new Set<string>();
	const typeOf = (n: Node, inLambda: boolean): FType => {
		switch (n.k) {
			case "num":
				return "number";
			case "str":
				return "text";
			case "bool":
				return "bool";
			case "ref": {
				const c = findColumn(n.name, columns);
				if (!c) throw new FormulaError(`Unknown column [${n.name}].`, n.from, n.to);
				n.id = c.id;
				refs.add(c.id);
				return c.type;
			}
			case "var":
				if (n.name === "item") {
					if (!inLambda) throw new FormulaError("item can only be used inside map() or filter().", n.from, n.to);
					return "any";
				}
				if (functionDef(n.name)) throw new FormulaError(`${n.name} is a function: write ${n.name}(…).`, n.from, n.to);
				throw new FormulaError(`Unknown name “${n.name}”. Column references go in brackets, e.g. [${n.name}].`, n.from, n.to);
			case "un":
				typeOf(n.a, inLambda);
				return n.op === "-" ? "number" : "bool";
			case "bin": {
				const a = typeOf(n.a, inLambda);
				const b = typeOf(n.b, inLambda);
				switch (n.op) {
					case "+":
						return a === "date" || b === "date" ? "date" : "number";
					case "-":
						return a === "date" && b === "date" ? "number" : a === "date" ? "date" : "number";
					case "*":
					case "/":
					case "%":
						return "number";
					case "&":
						return "text";
					default:
						return "bool";
				}
			}
			case "call": {
				const f = functionDef(n.fn);
				if (!f) throw new FormulaError(`Unknown function ${n.fn}().`, n.from, n.nameTo);
				if (n.args.length < f.min || n.args.length > f.max) {
					const want = f.min === f.max ? `${f.min}` : f.max === Infinity ? `at least ${f.min}` : `${f.min}–${f.max}`;
					throw new FormulaError(`${f.sig.split("(")[0]}() needs ${want} argument${f.min === 1 && f.max === 1 ? "" : "s"}: ${f.sig}.`, n.from, n.to);
				}
				const lambda = f.name === "map" || f.name === "filter";
				if (f.workflow && !opts.workflow) throw new FormulaError(`${f.name}() only works in workflows.`, n.from, n.nameTo);
				// value(), old() and new() read the field behind a column, so they need a column themselves.
				if ((f.name === "value" || f.workflow) && n.args[0]?.k !== "ref") throw new FormulaError(`${f.name}() needs a column, e.g. ${f.name}([${f.name === "value" ? "Priority" : "Status"}]).`, n.from, n.to);
				const args = n.args.map((x, i) => typeOf(x, inLambda || (lambda && i === 1)));
				if (f.name === "map") return "list";
				return typeof f.ret === "function" ? f.ret(args) : f.ret;
			}
		}
	};
	const type = typeOf(ast, false);
	return { ast, refs: [...refs], type };
}

/** Rewrite references with `pick` (used to switch between ids and labels), keeping everything else as written. */
export function rewriteRefs(src: string, pick: (name: string) => string | undefined): string {
	let toks: Token[];
	try {
		toks = tokenize(src);
	} catch {
		return src;
	}
	let out = "";
	let at = 0;
	for (const t of toks) {
		if (t.t !== "ref") continue;
		const to = pick(t.v);
		if (to === undefined) continue;
		out += src.slice(at, t.from) + `[${to}]`;
		at = t.to;
	}
	return out + src.slice(at);
}

/** The formula as stored: references by column id. */
export const toStored = (src: string, columns: RefColumn[]) => rewriteRefs(src, (name) => findColumn(name, columns)?.id);

/** The formula as shown: references by column label (ids first, so a stored formula reads naturally). */
export const toDisplay = (src: string, columns: RefColumn[]) =>
	rewriteRefs(src, (name) => (columns.find((c) => c.id === name) ?? findColumn(name, columns))?.label);

// ---------------------------------------------------------------- evaluating

export interface EvalEnv {
	/** a referenced column's value for the current row */
	col: (id: string) => FValue;
	/** value([Column]): a choice's number (choices with values), else the column's number; null when there's none */
	value?: (id: string) => FValue;
	/** old([Column]) in workflows: the value before the change (the current value when unset) */
	old?: (id: string) => FValue;
	/** today, in days */
	today: number;
	/** a field of a linked note, by label or key */
	prop: (link: LinkValue, field: string) => FValue;
	/** text for a date */
	dateText: (days: number) => string;
	/** parse a date from text (days), or null */
	parseDate: (s: string) => number | null;
	/** format a number or date with a column format pattern */
	format: (v: number | DateVal, pattern: string) => string;
	/** notes("type"): links to every note of a type key or name, "@group", or (null) every entity; unset where there are no notes to ask */
	notes?: (target: string | null) => FValue;
}

const MS_DAY = 86_400_000;
const utc = (days: number) => new Date(days * MS_DAY);
const fromUtc = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m, d) / MS_DAY);
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The value as text (dates in the view's date format). */
export function toText(v: FValue, env: Pick<EvalEnv, "dateText">): string {
	if (v === null) return "";
	if (typeof v === "number") return String(Math.round(v * 1e10) / 1e10);
	if (typeof v === "boolean") return v ? "true" : "false";
	if (v instanceof DateVal) return env.dateText(v.days);
	if (Array.isArray(v)) return v.map((x) => toText(x, env)).join(", ");
	if (isLink(v)) return v.name;
	return v;
}

const typeName = (v: FValue) => (v === null ? "empty" : typeof v === "number" ? "a number" : typeof v === "boolean" ? "true/false" : typeof v === "string" ? "text" : v instanceof DateVal ? "a date" : Array.isArray(v) ? "a list" : "a link");

export function truthy(v: FValue): boolean {
	if (v === null) return false;
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
	if (typeof v === "string") return v !== "";
	if (Array.isArray(v)) return v.length > 0;
	return true;
}

function equals(a: FValue, b: FValue): boolean {
	if (isEmptyV(a) || isEmptyV(b)) return isEmptyV(a) && isEmptyV(b);
	if (a instanceof DateVal && b instanceof DateVal) return a.days === b.days;
	if (isLink(a) || isLink(b)) {
		const key = (x: FValue) => (isLink(x) ? [x.path, x.name.toLowerCase()] : [String(x).toLowerCase()]);
		return key(a).some((k) => k !== null && key(b).includes(k));
	}
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equals(x, b[i]));
	if (Array.isArray(a) && a.length === 1) return equals(a[0], b);
	if (Array.isArray(b) && b.length === 1) return equals(a, b[0]);
	if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b))) return a === Number(b);
	if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a))) return b === Number(a);
	return a === b;
}

function compare(a: FValue, b: FValue, n: Node): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (a instanceof DateVal && b instanceof DateVal) return a.days - b.days;
	if (typeof a === "string" && typeof b === "string") return natural.compare(a, b);
	if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
	throw new FormulaError(`Can't compare ${typeName(a)} with ${typeName(b)}.`, n.from, n.to);
}

const flat = (args: FValue[]): FValue[] => args.flatMap((a) => (Array.isArray(a) ? flat(a) : [a]));
const asList = (v: FValue): FValue[] => (v === null ? [] : Array.isArray(v) ? v : [v]);

function num(v: FValue, n: Node, what = "a number"): number | null {
	if (v === null || v === "") return null;
	if (typeof v === "number") return v;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
	if (Array.isArray(v) && v.length === 1) return num(v[0], n, what);
	throw new FormulaError(`Expected ${what}, got ${typeName(v)}.`, n.from, n.to);
}

function dateOf(v: FValue, n: Node, env: EvalEnv): DateVal | null {
	if (v === null || v === "") return null;
	if (v instanceof DateVal) return v;
	if (typeof v === "string") {
		const d = env.parseDate(v);
		if (d !== null) return new DateVal(d);
	}
	if (Array.isArray(v) && v.length === 1) return dateOf(v[0], n, env);
	throw new FormulaError(`Expected a date, got ${typeName(v)}.`, n.from, n.to);
}

const UNITS = ["days", "weeks", "months", "years"];
function unitOf(v: FValue, n: Node, allowed = UNITS): string {
	const u = String(v ?? "").toLowerCase().replace(/s?$/, "s");
	if (!allowed.includes(u)) throw new FormulaError(`The unit should be ${allowed.map((x) => `"${x}"`).join(", ")}.`, n.from, n.to);
	return u;
}

function addMonths(days: number, months: number): number {
	const d = utc(days);
	const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	return fromUtc(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay));
}

function monthsBetween(a: number, b: number): number {
	const x = utc(a);
	const y = utc(b);
	let m = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth());
	// whole months only: back off one if the end day hasn't reached the start day
	if (m > 0 && addMonths(a, m) > b) m--;
	if (m < 0 && addMonths(a, m) < b) m++;
	return m;
}

/** Evaluate a compiled formula for one row. Runtime problems throw a FormulaError. */
export function evaluate(ast: Node, env: EvalEnv): FValue {
	const ev = (n: Node, item: FValue | undefined): FValue => {
		switch (n.k) {
			case "num":
				return n.v;
			case "str":
				return n.v;
			case "bool":
				return n.v;
			case "ref":
				return env.col(n.id ?? n.name);
			case "var":
				if (n.name === "item" && item !== undefined) return item;
				throw new FormulaError(`Unknown name “${n.name}”.`, n.from, n.to);
			case "un": {
				const a = ev(n.a, item);
				if (n.op === "not") return !truthy(a);
				const x = num(a, n.a);
				return x === null ? null : -x;
			}
			case "bin":
				return binary(n, item);
			case "call":
				return call(n, item);
		}
	};

	const binary = (n: Extract<Node, { k: "bin" }>, item: FValue | undefined): FValue => {
		if (n.op === "and") return truthy(ev(n.a, item)) && truthy(ev(n.b, item));
		if (n.op === "or") return truthy(ev(n.a, item)) || truthy(ev(n.b, item));
		const a = ev(n.a, item);
		const b = ev(n.b, item);
		switch (n.op) {
			case "&":
				return toText(a, env) + toText(b, env);
			case "=":
				return equals(a, b);
			case "!=":
				return !equals(a, b);
			case "<":
			case "<=":
			case ">":
			case ">=": {
				if (isEmptyV(a) || isEmptyV(b)) return false;
				const aa = Array.isArray(a) && a.length === 1 ? a[0] : a;
				const bb = Array.isArray(b) && b.length === 1 ? b[0] : b;
				// a date compared with text that reads as a date
				const c =
					aa instanceof DateVal && typeof bb === "string" ? compare(aa, dateOf(bb, n.b, env), n) : bb instanceof DateVal && typeof aa === "string" ? compare(dateOf(aa, n.a, env), bb, n) : compare(aa, bb, n);
				return n.op === "<" ? c < 0 : n.op === "<=" ? c <= 0 : n.op === ">" ? c > 0 : c >= 0;
			}
		}
		if (isEmptyV(a) || isEmptyV(b)) return null;
		const da = a instanceof DateVal ? a : null;
		const db = b instanceof DateVal ? b : null;
		if (n.op === "+") {
			const nonNumeric = (v: FValue) => typeof v === "string" && Number.isNaN(Number(v));
			if (nonNumeric(a) || nonNumeric(b)) throw new FormulaError('Use & to join text, e.g. [Name] & " " & [Status].', n.from, n.to);
			if (da && db) throw new FormulaError("Can't add two dates; subtract them to get days, or add a number of days.", n.from, n.to);
			if (da) return new DateVal(da.days + Math.round(num(b, n.b)!));
			if (db) return new DateVal(db.days + Math.round(num(a, n.a)!));
			return num(a, n.a)! + num(b, n.b)!;
		}
		if (n.op === "-") {
			if (da && db) return da.days - db.days;
			if (da) return new DateVal(da.days - Math.round(num(b, n.b)!));
			if (db) throw new FormulaError("Can't subtract a date from a number.", n.from, n.to);
			return num(a, n.a)! - num(b, n.b)!;
		}
		const x = num(a, n.a)!;
		const y = num(b, n.b)!;
		if (n.op === "*") return x * y;
		if (y === 0) throw new FormulaError("Division by zero.", n.from, n.to);
		return n.op === "/" ? x / y : x % y;
	};

	const call = (n: Extract<Node, { k: "call" }>, item: FValue | undefined): FValue => {
		const A = n.args;
		const arg = (i: number) => ev(A[i], item);
		const all = () => A.map((x) => ev(x, item));
		const text = (i: number) => toText(arg(i), env);
		const number = (i: number) => num(arg(i), A[i]);
		const date = (i: number) => dateOf(arg(i), A[i], env);
		switch (n.fn) {
			// logic (lazy)
			case "if":
				return truthy(arg(0)) ? arg(1) : A.length > 2 ? arg(2) : null;
			case "ifs": {
				for (let i = 0; i + 1 < A.length; i += 2) if (truthy(arg(i))) return arg(i + 1);
				return A.length % 2 ? arg(A.length - 1) : null;
			}
			case "and":
				return A.every((_, i) => truthy(arg(i)));
			case "or":
				return A.some((_, i) => truthy(arg(i)));
			case "not":
				return !truthy(arg(0));
			case "empty":
				return isEmptyV(arg(0));
			case "coalesce": {
				for (let i = 0; i < A.length; i++) {
					const v = arg(i);
					if (!isEmptyV(v)) return v;
				}
				return null;
			}
			// workflows
			case "old":
			case "new": {
				const ref = A[0];
				if (ref.k !== "ref") return null;
				const id = ref.id ?? ref.name;
				return n.fn.toLowerCase() === "old" && env.old ? env.old(id) : env.col(id);
			}
			// maths
			case "value": {
				const ref = A[0];
				if (ref.k !== "ref") return null;
				const id = ref.id ?? ref.name;
				if (env.value) return env.value(id);
				const v = env.col(id);
				return typeof v === "number" ? v : null;
			}
			case "round": {
				const x = number(0);
				if (x === null) return null;
				const p = Math.pow(10, A.length > 1 ? (number(1) ?? 0) : 0);
				return Math.round(x * p + Math.sign(x) * Number.EPSILON) / p;
			}
			case "floor":
			case "ceil":
			case "abs":
			case "sqrt": {
				const x = number(0);
				if (x === null) return null;
				if (n.fn === "sqrt" && x < 0) throw new FormulaError("Square root of a negative number.", n.from, n.to);
				return Math[n.fn](x);
			}
			case "min":
			case "max": {
				const vs = flat(all()).filter((v) => !isEmptyV(v));
				if (!vs.length) return null;
				if (vs.every((v) => v instanceof DateVal)) {
					const ds = vs.map((v) => (v as DateVal).days);
					return new DateVal(n.fn === "min" ? Math.min(...ds) : Math.max(...ds));
				}
				const xs = vs.map((v) => num(v, n)!);
				return n.fn === "min" ? Math.min(...xs) : Math.max(...xs);
			}
			case "sum":
			case "avg": {
				const xs = flat(all())
					.filter((v) => !isEmptyV(v))
					.map((v) => num(v, n)!);
				if (!xs.length) return n.fn === "sum" ? 0 : null;
				const s = xs.reduce((a, b) => a + b, 0);
				return n.fn === "sum" ? s : s / xs.length;
			}
			case "pow": {
				const x = number(0);
				const y = number(1);
				return x === null || y === null ? null : Math.pow(x, y);
			}
			case "mod": {
				const x = number(0);
				const y = number(1);
				if (x === null || y === null) return null;
				if (y === 0) throw new FormulaError("Division by zero.", n.from, n.to);
				return x % y;
			}
			case "number": {
				const v = arg(0);
				if (typeof v === "number") return v;
				if (typeof v === "boolean") return v ? 1 : 0;
				if (v instanceof DateVal) return v.days;
				const s = toText(v, env).trim().replace(/[,\s]/g, "");
				return s !== "" && !Number.isNaN(Number(s)) ? Number(s) : null;
			}
			// text
			case "concat":
				return all()
					.map((v) => toText(v, env))
					.join("");
			case "text":
				return text(0);
			case "upper":
				return text(0).toUpperCase();
			case "lower":
				return text(0).toLowerCase();
			case "trim":
				return text(0).trim();
			case "len": {
				const v = arg(0);
				return Array.isArray(v) ? v.length : toText(v, env).length;
			}
			case "left":
				return text(0).slice(0, Math.max(0, number(1) ?? 0));
			case "right": {
				const k = Math.max(0, number(1) ?? 0);
				const s = text(0);
				return k ? s.slice(-k) : "";
			}
			case "mid": {
				const s = text(0);
				const start = Math.max(1, number(1) ?? 1);
				return s.substr(start - 1, Math.max(0, number(2) ?? 0));
			}
			case "replace": {
				const find = text(1);
				return find ? text(0).split(find).join(text(2)) : text(0);
			}
			case "contains":
				return text(0).toLowerCase().includes(text(1).toLowerCase());
			case "startswith":
				return text(0).toLowerCase().startsWith(text(1).toLowerCase());
			case "format": {
				const v = arg(0);
				if (isEmptyV(v)) return "";
				const pattern = text(1);
				if (v instanceof DateVal || typeof v === "number") return env.format(v, pattern);
				const d = typeof v === "string" ? env.parseDate(v) : null;
				if (d !== null) return env.format(new DateVal(d), pattern);
				const x = num(v, A[0], "a number or date");
				return x === null ? "" : env.format(x, pattern);
			}
			// dates
			case "today":
			case "now":
				return new DateVal(env.today);
			case "date": {
				if (A.length === 1) return date(0);
				if (A.length !== 3) throw new FormulaError("date() needs a text date, or year, month and day.", n.from, n.to);
				const [y, m, d] = [number(0), number(1), number(2)];
				return y === null || m === null || d === null ? null : new DateVal(fromUtc(y, m - 1, d));
			}
			case "year":
			case "month":
			case "day":
			case "weekday": {
				const d = date(0);
				if (!d) return null;
				const t = utc(d.days);
				return n.fn === "year" ? t.getUTCFullYear() : n.fn === "month" ? t.getUTCMonth() + 1 : n.fn === "day" ? t.getUTCDate() : ((t.getUTCDay() + 6) % 7) + 1;
			}
			case "dateadd": {
				const d = date(0);
				const k = number(1);
				if (!d || k === null) return null;
				const u = unitOf(arg(2), A[2]);
				const amount = Math.round(k);
				return new DateVal(u === "days" ? d.days + amount : u === "weeks" ? d.days + 7 * amount : addMonths(d.days, u === "months" ? amount : 12 * amount));
			}
			case "datediff": {
				const a = date(0);
				const b = date(1);
				if (!a || !b) return null;
				const u = unitOf(arg(2), A[2]);
				if (u === "days") return b.days - a.days;
				if (u === "weeks") return Math.trunc((b.days - a.days) / 7);
				const m = monthsBetween(a.days, b.days);
				return u === "months" ? m : Math.trunc(m / 12);
			}
			case "startof":
			case "endof": {
				const d = date(0);
				if (!d) return null;
				const u = unitOf(arg(1), A[1], ["weeks", "months", "years"]);
				const t = utc(d.days);
				const start =
					u === "weeks" ? d.days - ((t.getUTCDay() + 6) % 7) : u === "months" ? fromUtc(t.getUTCFullYear(), t.getUTCMonth(), 1) : fromUtc(t.getUTCFullYear(), 0, 1);
				if (n.fn === "startof") return new DateVal(start);
				return new DateVal(u === "weeks" ? start + 6 : u === "months" ? addMonths(start, 1) - 1 : fromUtc(t.getUTCFullYear() + 1, 0, 1) - 1);
			}
			// lists
			case "list":
				return A.flatMap((_, i) => asList(arg(i))).filter((v) => !isEmptyV(v));
			case "count":
				return asList(arg(0)).filter((v) => !isEmptyV(v)).length;
			case "first":
			case "last": {
				const l = asList(arg(0));
				return l.length ? (n.fn === "first" ? l[0] : l[l.length - 1]) : null;
			}
			case "join":
				return asList(arg(0))
					.map((v) => toText(v, env))
					.filter((s) => s !== "")
					.join(A.length > 1 ? text(1) : ", ");
			case "includes": {
				const want = arg(1);
				return asList(arg(0)).some((v) => (typeof v === "string" && typeof want === "string" ? v.toLowerCase() === want.toLowerCase() : equals(v, want)));
			}
			case "unique": {
				const out: FValue[] = [];
				for (const v of asList(arg(0))) if (!out.some((x) => equals(x, v))) out.push(v);
				return out;
			}
			case "sort": {
				const l = [...asList(arg(0))];
				const key = (v: FValue) => (v instanceof DateVal ? v.days : typeof v === "number" ? v : toText(v, env));
				return l.sort((a, b) => {
					const x = key(a);
					const y = key(b);
					return typeof x === "number" && typeof y === "number" ? x - y : natural.compare(String(x), String(y));
				});
			}
			case "map":
				return asList(arg(0)).map((v) => ev(A[1], v));
			case "filter":
				return asList(arg(0)).filter((v) => truthy(ev(A[1], v)));
			// links
			case "name": {
				const v = arg(0);
				const one = (x: FValue) => (isLink(x) ? x.name : toText(x, env));
				return Array.isArray(v) ? v.map(one) : v === null ? null : one(v);
			}
			case "prop": {
				const v = arg(0);
				const field = text(1);
				const one = (x: FValue): FValue => {
					if (!isLink(x)) throw new FormulaError(`prop() needs a link, got ${typeName(x)}.`, A[0].from, A[0].to);
					return env.prop(x, field);
				};
				if (v === null) return null;
				return Array.isArray(v) ? v.map(one) : one(v);
			}
			case "notes": {
				if (!env.notes) throw new FormulaError("notes() can't be used here.", n.from, n.to);
				const target = A.length ? text(0).trim() : "";
				try {
					return env.notes(target || null);
				} catch (e) {
					throw new FormulaError(e instanceof Error ? e.message : String(e), A[0]?.from ?? n.from, A[0]?.to ?? n.to);
				}
			}
		}
		throw new FormulaError(`Unknown function ${n.fn}().`, n.from, n.nameTo);
	};

	return ev(ast, undefined);
}
