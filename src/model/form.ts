import type { DateAdapter } from "./dates";
import { defaultFieldValue, isEmptyValue, mergeFrontmatter, toYamlValue } from "./frontmatter";
import { asArray, parseLabelledEntry, parseLink, toWikilink } from "./links";
import { evalWhen, todayDays, typeHiddenFields, whenText } from "./formConditions";
import { ruleMessages, type RuleContext } from "./rules";
import { COMMON_KEYS, isCalculated, isListValued, statusesFor, storedFields, typeMatchesTarget, type EntityTypeDef, type FieldDef, type FieldKind, type GroupDef } from "./types";

/** A one-click repair: write `value` to the problem's key (undefined removes the key). */
export interface FormFix {
	label: string;
	value: unknown;
}

/** Something wrong with one frontmatter value of an entity. */
export interface FieldProblem {
	key: string;
	message: string;
	/** errors are values the type can't use; warnings are allowed but worth a look (e.g. an empty required field) */
	severity: "error" | "warning";
	fix?: FormFix;
	/** relation problems: the link path the problem is about, so its chip can be marked */
	link?: string;
	/** a required field with no value */
	missing?: true;
	/** breaks one of the field's validation rules (or "required when") */
	rule?: true;
}

/** A link resolved to a note: its path and, when it's an entity, its type. */
export interface LinkInfo {
	path: string;
	type: EntityTypeDef | null;
}

export interface CheckContext {
	types: EntityTypeDef[];
	groups: GroupDef[];
	dates: DateAdapter;
	/** resolve a link path to a note; null when no note exists */
	resolve(linkpath: string): LinkInfo | null;
	/** today as a day number, for "show only when" conditions on dates (default: the real today) */
	today?: number;
	/** the note being checked (left out of "unique" comparisons) */
	path?: string;
	/** other notes of a type with their value for a key, for "unique" rules */
	others?: (typeKey: string, key: string) => { path: string; name: string; value: unknown }[];
	/** a date as shown (in rule messages; default: the date adapter's long form) */
	showDate?: (days: number) => string;
}

const quote = (v: unknown) => `“${typeof v === "string" ? v : JSON.stringify(v)}”`;
const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
const isWrappedLink = (v: unknown) => typeof v === "string" && /^\s*(\[\[.*\]\]|\[.*\]\(.*\))\s*$/.test(v);

/** "people or organisations" for a relation's targets. */
export function targetNames(targets: string[] | undefined, types: EntityTypeDef[]): string {
	if (!targets?.length || targets.includes("*")) return "any entity";
	const names = types.filter((t) => typeMatchesTarget(t, targets)).map((t) => (t.plural || t.name).toLowerCase());
	if (names.length === 0) return "no existing type";
	return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function checkLinks(key: string, label: string, raw: unknown, opts: { list: boolean; labelled: boolean; targets?: string[]; required?: boolean }, ctx: CheckContext): FieldProblem[] {
	const out: FieldProblem[] = [];
	if (isEmptyValue(raw)) return out;
	const entries = asArray(raw);
	if (!opts.list && Array.isArray(raw)) {
		if (raw.length <= 1) out.push({ key, severity: "error", message: `${label} holds one link, but it's written as a list.`, fix: { label: "Use a single link", value: raw[0] ?? null } });
		else out.push({ key, severity: "error", message: `${label} holds one link, but has ${raw.length}.`, fix: { label: "Keep the first", value: raw[0] } });
	}
	if (opts.list && !Array.isArray(raw)) out.push({ key, severity: "error", message: `${label} should be a list.`, fix: { label: "Make it a list", value: [raw] } });

	const without = (i: number) => (Array.isArray(raw) ? raw.filter((_, j) => j !== i) : opts.list ? [] : null);
	const restricted = !!opts.targets?.length && !opts.targets.includes("*");
	entries.forEach((entry, i) => {
		const parsed = opts.labelled ? parseLabelledEntry(entry) : (() => {
			const link = parseLink(entry);
			return link ? { link } : null;
		})();
		if (!parsed) {
			out.push({ key, severity: "error", message: `${quote(entry)} isn't a link.`, fix: { label: "Remove it", value: without(i) } });
			return;
		}
		const path = parsed.link.path;
		if (typeof entry === "string" && !isWrappedLink(entry)) {
			const fixed = toWikilink(path);
			const value = Array.isArray(raw) ? raw.map((v, j) => (j === i ? fixed : v)) : fixed;
			out.push({ key, link: path, severity: "warning", message: `${quote(entry)} isn't written as a link, so Obsidian won't track it.`, fix: { label: "Make it a link", value } });
		}
		const info = ctx.resolve(path);
		if (!info || !restricted) return;
		const name = path.split("/").pop() ?? path;
		if (!info.type) {
			out.push({ key, link: path, severity: "warning", message: `${quote(name)} isn't an entity. ${label} links to ${targetNames(opts.targets, ctx.types)}.`, fix: { label: "Remove the link", value: without(i) } });
		} else if (!typeMatchesTarget(info.type, opts.targets)) {
			out.push({
				key,
				link: path,
				severity: "error",
				message: `${quote(name)} is ${withArticle(info.type.name.toLowerCase())}, but ${label} links to ${targetNames(opts.targets, ctx.types)}.`,
				fix: { label: "Remove the link", value: without(i) },
			});
		}
	});
	return out;
}

/** Problems with one field's value. */
export function checkField(field: FieldDef, raw: unknown, ctx: CheckContext): FieldProblem[] {
	const key = field.key;
	const label = field.label || key;
	const out: FieldProblem[] = [];
	const err = (message: string, fix?: FormFix) => out.push({ key, severity: "error", message, ...(fix ? { fix } : {}) });
	// Calculated fields aren't stored, so there's nothing to check.
	if (isCalculated(field)) return out;

	if (isEmptyValue(raw) || (field.kind === "boolean" && raw === false)) {
		if (field.required && !(field.kind === "boolean")) out.push({ key, severity: "warning", message: `${label} is required.`, missing: true });
		return out;
	}
	switch (field.kind) {
		case "relation":
			return checkLinks(key, label, raw, { list: isListValued(field), labelled: !!field.labelled, targets: field.targets }, ctx);
		case "number":
			if (typeof raw === "number") break;
			if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) err(`${label} is a number written as text.`, { label: "Make it a number", value: Number(raw) });
			else err(`${quote(raw)} isn't a number.`);
			break;
		case "boolean":
			if (typeof raw === "boolean") break;
			if (raw === "true" || raw === "false") err(`${label} is a yes/no value written as text.`, { label: `Make it ${raw === "true" ? "yes" : "no"}`, value: raw === "true" });
			else err(`${quote(raw)} isn't yes or no.`);
			break;
		case "date": {
			if (Array.isArray(raw)) {
				err(`${label} holds one date, but it's written as a list.`, raw.length === 1 ? { label: "Use a single value", value: raw[0] } : undefined);
				break;
			}
			const r = ctx.dates.parse(raw);
			if (r && !r.ok) err(r.error);
			break;
		}
		case "select":
			if (Array.isArray(raw)) {
				err(`${label} holds one choice, but it's written as a list.`, raw.length === 1 ? { label: "Use a single value", value: raw[0] } : undefined);
				break;
			}
			if (!(field.options ?? []).includes(String(raw))) err(`${quote(raw)} isn't one of the options for ${label}.`);
			break;
		case "multiselect": {
			const list = asArray(raw);
			if (!Array.isArray(raw)) {
				err(`${label} should be a list.`, { label: "Make it a list", value: list });
				break;
			}
			const bad = list.filter((v) => !(field.options ?? []).includes(String(v)));
			if (bad.length) err(`${bad.map(quote).join(", ")} ${bad.length === 1 ? "isn't one of the options" : "aren't options"} for ${label}.`, { label: "Remove", value: list.filter((v) => !bad.includes(v)) });
			break;
		}
		case "list":
			if (!Array.isArray(raw)) err(`${label} should be a list.`, { label: "Make it a list", value: [raw] });
			break;
		default:
			if (Array.isArray(raw)) err(`${label} holds one value, but it's written as a list.`, { label: raw.length === 1 ? "Use a single value" : "Join the values", value: raw.map(String).join(", ") });
			else if (typeof raw === "object") err(`${label} has a value that isn't text.`);
	}
	return out;
}

/** Problems with an entity's frontmatter against its type: status, every field, and the common list keys. */
export function entityProblems(type: EntityTypeDef, fm: Record<string, unknown>, ctx: CheckContext): FieldProblem[] {
	const out: FieldProblem[] = [];
	const status = fm[COMMON_KEYS.status];
	if (!isEmptyValue(status)) {
		const statuses = statusesFor(type, ctx.groups);
		if (typeof status !== "string" || !statuses.includes(status)) {
			out.push({ key: COMMON_KEYS.status, severity: "error", message: `${quote(status)} isn't a status for ${type.plural.toLowerCase()}. Choose one of: ${statuses.join(", ")}.` });
		}
	}
	for (const f of type.fields) {
		const own = checkField(f, fm[f.key], ctx);
		out.push(...own);
		// Rules apply to values the type can read (a broken value is reported as that instead).
		if (!f.rules || own.some((p) => p.severity === "error")) continue;
		const label = f.label || f.key;
		const today = ctx.today ?? todayDays();
		const rctx: RuleContext = {
			dates: ctx.dates,
			today,
			showDate: ctx.showDate ?? ((d) => ctx.dates.format(d, "long")),
			values: fm,
			labelOf: (k) => type.fields.find((x) => x.key === k)?.label || k,
			...(ctx.others ? { others: (k: string) => ctx.others!(type.key, k).filter((o) => o.path !== ctx.path) } : {}),
		};
		for (const message of ruleMessages(f, fm[f.key], rctx)) out.push({ key: f.key, severity: "error", message, rule: true });
		// Required when…: only when the conditions hold for the values as they are.
		if (f.rules.requiredWhen && !f.required && isEmptyValue(fm[f.key])) {
			const wctx = { types: ctx.types, groups: ctx.groups, dates: ctx.dates, today, resolve: (lp: string) => ctx.resolve(lp)?.path ?? null };
			if (evalWhen(f.rules.requiredWhen, type, fm, wctx)) out.push({ key: f.key, severity: "warning", message: `${label} is required when ${whenText(f.rules.requiredWhen, type, wctx)}.`, missing: true, rule: true });
		}
	}
	for (const key of [COMMON_KEYS.tags, COMMON_KEYS.aliases]) {
		const v = fm[key];
		if (isEmptyValue(v) || Array.isArray(v)) continue;
		const list = key === COMMON_KEYS.tags && typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : [v];
		out.push({ key, severity: "error", message: `${key === COMMON_KEYS.tags ? "Tags" : "Aliases"} should be a list.`, fix: { label: "Make it a list", value: list } });
	}
	out.push(...checkLinks(COMMON_KEYS.related, "Related", fm[COMMON_KEYS.related], { list: true, labelled: false }, ctx));
	// A required field the layout hides ("show only when…" doesn't hold) isn't required just now.
	const hidden = out.some((p) => p.missing) ? typeHiddenFields(type, fm, { types: ctx.types, groups: ctx.groups, dates: ctx.dates, today: ctx.today ?? todayDays(), resolve: (lp) => ctx.resolve(lp)?.path ?? null }) : null;
	if (hidden?.size) return out.filter((p) => !(p.missing && hidden.has(p.key))).concat(orderProblems(type, fm));
	return out.concat(orderProblems(type, fm));
}

function orderProblems(type: EntityTypeDef, fm: Record<string, unknown>): FieldProblem[] {
	const out: FieldProblem[] = [];
	if (type.parentFields?.length && !isEmptyValue(fm[COMMON_KEYS.order])) {
		const o = fm[COMMON_KEYS.order];
		if (typeof o !== "number") {
			if (typeof o === "string" && Number.isFinite(Number(o))) out.push({ key: COMMON_KEYS.order, severity: "error", message: "Order is a number written as text.", fix: { label: "Make it a number", value: Number(o) } });
			else out.push({ key: COMMON_KEYS.order, severity: "error", message: `${quote(o)} isn't a number.` });
		}
	}
	return out;
}

/** Whether `order` is a form field for this type (it is when the type nests under a parent). */
export const usesOrder = (type: EntityTypeDef): boolean => !!type.parentFields?.length;

/**
 * Frontmatter keys the form lists under "Other properties": everything the type doesn't define,
 * minus the common keys it shows itself. `order` counts as other when the type doesn't use it and it has a value.
 */
export function otherKeys(type: EntityTypeDef, fm: Record<string, unknown>): string[] {
	const own = new Set(type.fields.map((f) => f.key));
	const common = new Set<string>([COMMON_KEYS.type, COMMON_KEYS.status, COMMON_KEYS.tags, COMMON_KEYS.aliases, COMMON_KEYS.related]);
	return Object.keys(fm).filter((k) => {
		if (own.has(k) || common.has(k)) return false;
		if (k === COMMON_KEYS.order) return !usesOrder(type) && !isEmptyValue(fm[k]);
		return true;
	});
}

export type OtherKind = "text" | "number" | "boolean" | "date" | "list";

/** Obsidian property widget → how "Other properties" edits it. */
const WIDGET_KINDS: Record<string, OtherKind> = {
	text: "text",
	multitext: "list",
	tags: "list",
	aliases: "list",
	number: "number",
	checkbox: "boolean",
	date: "date",
};

/** How to edit an extra property: from Obsidian's assigned property type when known, else from the value. */
export function otherKind(value: unknown, widget?: string | null): OtherKind {
	if (widget && WIDGET_KINDS[widget]) return WIDGET_KINDS[widget];
	if (Array.isArray(value)) return "list";
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "number") return "number";
	return "text";
}

/** The field kind "Add to type" proposes for an extra property. */
export function fieldKindFor(value: unknown, widget?: string | null): FieldKind {
	const kind = otherKind(value, widget);
	if (kind === "list") return asArray(value).length > 0 && asArray(value).every(isWrappedLink) ? "relation" : "list";
	if (kind === "text" && isWrappedLink(value)) return "relation";
	return kind;
}

export type InputResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Turn typed text into the stored value for a single-value field, or explain why it can't be used. */
export function parseInput(kind: "text" | "textarea" | "url" | "number" | "date", text: string, dates: DateAdapter): InputResult {
	const s = kind === "textarea" ? text.replace(/\s+$/, "") : text.trim();
	if (!s) return { ok: true, value: null };
	switch (kind) {
		case "number": {
			const n = Number(s);
			return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `${quote(s)} isn't a number.` };
		}
		case "date": {
			const r = dates.parse(s);
			return !r || r.ok ? { ok: true, value: s } : { ok: false, error: r.error };
		}
		default:
			return { ok: true, value: s };
	}
}

/**
 * Change an entity's type in place: set `entity`, add the new type's missing fields (with defaults),
 * keep every existing value (fields the new type doesn't use become "other properties"), and reset the
 * status to the first one when it isn't valid for the new type. Returns whether the status was reset.
 */
export function retype(fm: Record<string, unknown>, to: EntityTypeDef, groups: GroupDef[]): { statusReset: boolean } {
	const statuses = statusesFor(to, groups);
	const generated: Record<string, unknown> = { [COMMON_KEYS.type]: to.key, [COMMON_KEYS.status]: statuses[0] };
	if (usesOrder(to)) generated[COMMON_KEYS.order] = null;
	for (const f of storedFields(to)) generated[f.key] = toYamlValue(f, defaultFieldValue(f));
	generated[COMMON_KEYS.related] = [];
	generated[COMMON_KEYS.tags] = [];
	const hadStatus = !isEmptyValue(fm[COMMON_KEYS.status]);
	mergeFrontmatter(fm, generated, true);
	fm[COMMON_KEYS.type] = to.key;
	const status = fm[COMMON_KEYS.status];
	if (typeof status !== "string" || !statuses.includes(status)) {
		fm[COMMON_KEYS.status] = statuses[0];
		return { statusReset: hadStatus };
	}
	return { statusReset: false };
}

/**
 * One form edit: a key's value before and after (undefined = the key didn't exist). A workflow run caused by an
 * edit is an entry too: `undo` restores every note it changed (the key is "").
 */
export interface FormEdit {
	key: string;
	before: unknown;
	after: unknown;
	undo?: () => Promise<void>;
}

const copy = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Per-note undo history for form edits, newest last, capped at `limit` steps per note. */
export class EditHistory {
	private stacks = new Map<string, FormEdit[]>();
	constructor(private limit = 20) {}

	push(path: string, edit: FormEdit): void {
		if (!edit.undo && JSON.stringify(edit.before) === JSON.stringify(edit.after)) return;
		const stack = this.stacks.get(path) ?? [];
		stack.push(edit.undo ? { key: "", before: undefined, after: undefined, undo: edit.undo } : { key: edit.key, before: copy(edit.before), after: copy(edit.after) });
		if (stack.length > this.limit) stack.splice(0, stack.length - this.limit);
		this.stacks.set(path, stack);
	}

	pop(path: string): FormEdit | undefined {
		const stack = this.stacks.get(path);
		const edit = stack?.pop();
		if (stack && stack.length === 0) this.stacks.delete(path);
		return edit;
	}

	size(path: string): number {
		return this.stacks.get(path)?.length ?? 0;
	}

	rename(from: string, to: string): void {
		const stack = this.stacks.get(from);
		if (!stack) return;
		this.stacks.delete(from);
		this.stacks.set(to, stack);
	}

	clear(path: string): void {
		this.stacks.delete(path);
	}
}

/** Set or remove (undefined) a frontmatter key. */
export function writeKey(fm: Record<string, unknown>, key: string, value: unknown): void {
	if (value === undefined) delete fm[key];
	else fm[key] = value;
}
