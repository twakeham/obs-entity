/**
 * Workflows (DESIGN §8.11): when something happens to a note, if it matches some conditions, do a list of steps.
 * Pure parts: definitions and reading them from settings, matching triggers to changes, problems, templates, turning
 * formula results into stored values, and running the steps on a copy of a note's frontmatter. The engine
 * (services/workflows.ts) listens to the index, writes notes, chains, undoes and logs.
 */
import { applyChange, type BulkChange } from "./bulk";
import { writeDay } from "./calendarView";
import { DateVal, FormulaError, isLink, toText, truthy, type FValue } from "./formula";
import { isEmptyValue } from "./frontmatter";
import { asArray, parseLink, toWikilink } from "./links";
import { COMMON_KEYS, isCalculated, isListValued, statusesFor, typeMatchesTarget, type EntityTypeDef, type FieldDef, type GroupDef } from "./types";
import { compileFormula, emptyView, evaluateFormula, filterFields, runView, withThisNote, type FilterGroup, type ViewContext, type ViewDef, type ViewRow } from "./views";

// ---------------------------------------------------------------- definitions

/** A `changed` trigger's target values: listed values (status, choices, checkboxes), or filled / emptied. */
export type ChangedTo = string[] | "filled" | "empty";

export type WorkflowTrigger =
	| { kind: "created" }
	| { kind: "changed"; field: string; from?: string[]; to?: ChangedTo }
	| { kind: "manual"; label?: string; icon?: string; confirm?: string };

export type WorkflowStep =
	| { kind: "set"; field: string; value: string }
	| { kind: "clear"; field: string }
	| { kind: "tag"; op: "add" | "remove"; tag: string }
	| { kind: "link"; op: "add" | "remove"; field: string; target: string }
	| { kind: "notice"; text: string };

export type TriggerKind = WorkflowTrigger["kind"];
export type StepKind = WorkflowStep["kind"];

export interface WorkflowDef {
	/** stable, generated */
	id: string;
	name: string;
	on: boolean;
	/** type keys or "@group" (empty: any note; only for manual workflows) */
	scope: string[];
	trigger: WorkflowTrigger;
	/** "Only if": a view filter group */
	when: FilterGroup;
	steps: WorkflowStep[];
}

export const TRIGGER_LABELS: Record<TriggerKind, string> = { created: "When a note is created", changed: "When a field changes", manual: "Run on notes" };
export const STEP_LABELS: Record<StepKind, string> = { set: "Set a field", clear: "Clear a field", tag: "Add or remove a tag", link: "Add or remove a link", notice: "Show a notice" };
/** The most chained runs (a run's changes starting others) before the chain stops. */
export const MAX_CHAIN = 5;

export const newWorkflowId = () => `wf-${Math.random().toString(36).slice(2, 8)}`;

export function newWorkflow(scope: string[] = [], trigger: WorkflowTrigger = { kind: "changed", field: COMMON_KEYS.status }): WorkflowDef {
	return { id: newWorkflowId(), name: "New workflow", on: true, scope, trigger, when: { mode: "all", items: [] }, steps: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function readTrigger(raw: unknown): WorkflowTrigger {
	if (!isObj(raw)) return { kind: "manual" };
	if (raw.kind === "created") return { kind: "created" };
	if (raw.kind === "changed") {
		const to = raw.to === "filled" || raw.to === "empty" ? raw.to : Array.isArray(raw.to) ? strList(raw.to) : undefined;
		const from = Array.isArray(raw.from) ? strList(raw.from) : undefined;
		return { kind: "changed", field: str(raw.field) || COMMON_KEYS.status, ...(from?.length ? { from } : {}), ...(to && (to === "filled" || to === "empty" || to.length) ? { to } : {}) };
	}
	return { kind: "manual", ...(str(raw.label) ? { label: str(raw.label) } : {}), ...(str(raw.icon) ? { icon: str(raw.icon) } : {}), ...(str(raw.confirm) ? { confirm: str(raw.confirm) } : {}) };
}

function readStep(raw: unknown): WorkflowStep | null {
	if (!isObj(raw)) return null;
	switch (raw.kind) {
		case "set":
			return { kind: "set", field: str(raw.field), value: str(raw.value) };
		case "clear":
			return { kind: "clear", field: str(raw.field) };
		case "tag":
			return { kind: "tag", op: raw.op === "remove" ? "remove" : "add", tag: str(raw.tag) };
		case "link":
			return { kind: "link", op: raw.op === "remove" ? "remove" : "add", field: str(raw.field), target: str(raw.target) };
		case "notice":
			return { kind: "notice", text: str(raw.text) };
	}
	return null;
}

function readGroup(raw: unknown): FilterGroup {
	if (!isObj(raw) || !Array.isArray(raw.items)) return { mode: "all", items: [] };
	return { mode: raw.mode === "any" ? "any" : "all", items: raw.items as FilterGroup["items"] };
}

/** Saved workflows, tidied (unknown parts dropped, ids made unique). */
export function readWorkflows(raw: unknown): WorkflowDef[] {
	const out: WorkflowDef[] = [];
	for (const w of Array.isArray(raw) ? raw : []) {
		if (!isObj(w)) continue;
		let id = str(w.id) || newWorkflowId();
		while (out.some((x) => x.id === id)) id = newWorkflowId();
		out.push({
			id,
			name: str(w.name) || "Workflow",
			on: w.on !== false,
			scope: strList(w.scope),
			trigger: readTrigger(w.trigger),
			when: readGroup(w.when),
			steps: (Array.isArray(w.steps) ? w.steps : []).map(readStep).filter((s): s is WorkflowStep => !!s),
		});
	}
	return out;
}

export const cloneWorkflow = (w: WorkflowDef): WorkflowDef => JSON.parse(JSON.stringify(w)) as WorkflowDef;

// ---------------------------------------------------------------- scope and fields

/** Whether a workflow applies to notes of a type (no scope: any note). */
export const inScope = (wf: Pick<WorkflowDef, "scope">, type: EntityTypeDef): boolean => !wf.scope.length || typeMatchesTarget(type, wf.scope);

/** The types a workflow applies to. */
export const scopeTypes = (wf: Pick<WorkflowDef, "scope">, types: EntityTypeDef[]): EntityTypeDef[] => (wf.scope.length ? types.filter((t) => typeMatchesTarget(t, wf.scope)) : types);

/** The view definition a workflow's formulas and conditions are read against (its scope's columns). */
export const workflowDef = (wf: Pick<WorkflowDef, "scope" | "when">): ViewDef => ({ ...emptyView(wf.scope.length ? wf.scope : ["*"]), filters: wf.when });

/** Triggers that need types (they react to notes of those types). */
export const needsScope = (k: TriggerKind) => k === "created" || k === "changed";

/** A field a workflow can set or watch: status, tags (watch only) or one of the scoped types' stored fields. */
export interface WorkflowField {
	key: string;
	label: string;
	kind: FieldDef["kind"] | "status" | "tags";
	field?: FieldDef;
}

/** Fields of the scoped types (stored ones, first-seen order), with status first and tags last. */
export function workflowFields(wf: Pick<WorkflowDef, "scope">, types: EntityTypeDef[]): WorkflowField[] {
	const out: WorkflowField[] = [{ key: COMMON_KEYS.status, label: "Status", kind: "status" }];
	for (const t of scopeTypes(wf, types)) for (const f of t.fields) if (!isCalculated(f) && !out.some((x) => x.key === f.key)) out.push({ key: f.key, label: f.label, kind: f.kind, field: f });
	out.push({ key: COMMON_KEYS.tags, label: "Tags", kind: "tags" });
	return out;
}

/** A field's label for sentences (the key when it's unknown). */
export const fieldLabel = (key: string, types: EntityTypeDef[]): string =>
	key === COMMON_KEYS.status ? "Status" : key === COMMON_KEYS.tags ? "Tags" : (types.flatMap((t) => t.fields).find((f) => f.key === key)?.label ?? key);

/** Whether a `changed` trigger on this field can list from / to values (status, choices, checkboxes). */
export const listsValues = (f: WorkflowField | undefined) => !!f && (f.kind === "status" || f.kind === "select" || f.kind === "boolean");

// ---------------------------------------------------------------- matching changes

/** A value as the trigger compares it: empty → null, checkboxes "true" / "false", lists as their items. */
function norm(v: unknown, kind?: string): string | null {
	if (kind === "boolean") return v === true ? "true" : "false";
	if (isEmptyValue(v)) return null;
	if (Array.isArray(v)) return JSON.stringify(v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
	return typeof v === "string" ? v : JSON.stringify(v);
}

const inList = (v: string | null, list: string[]) => v !== null && list.some((x) => x.toLowerCase() === v.toLowerCase());

/**
 * Whether a field change matches a `changed` trigger: the value differs, and (when set) the old value is one of
 * `from` and the new one of `to`, or it became filled / empty.
 */
export function changeMatches(trigger: Extract<WorkflowTrigger, { kind: "changed" }>, before: Record<string, unknown>, after: Record<string, unknown>, type: EntityTypeDef): boolean {
	const kind = trigger.field === COMMON_KEYS.status ? "status" : type.fields.find((f) => f.key === trigger.field)?.kind;
	if (trigger.field !== COMMON_KEYS.status && trigger.field !== COMMON_KEYS.tags && !kind) return false;
	const a = norm(before[trigger.field], kind);
	const b = norm(after[trigger.field], kind);
	if (a === b) return false;
	if (trigger.from?.length && !inList(a, trigger.from)) return false;
	const to = trigger.to;
	if (to === "filled") return a === null && b !== null && !(kind === "boolean" && b === "false");
	if (to === "empty") return (b === null || (kind === "boolean" && b === "false")) && a !== null;
	if (Array.isArray(to) && to.length && !inList(b, to)) return false;
	return true;
}

/** Whether a note passes a workflow's "Only if" (empty: always). `{this}` is the note; unusable conditions are ignored, as in views. */
export function passesWhen(wf: WorkflowDef, row: ViewRow, ctx: ViewContext): boolean {
	if (!wf.when.items.length) return true;
	return runView(withThisNote({ ...workflowDef(wf), types: [row.type.key] }, row.path), [row], ctx).rows.length > 0;
}

// ---------------------------------------------------------------- templates

export type TemplatePart = { text: string } | { formula: string; from: number };

/** Text with {formula} placeholders ({{ for a literal brace). Quotes inside a placeholder may hold braces. */
export function parseTemplate(src: string): TemplatePart[] {
	const out: TemplatePart[] = [];
	let text = "";
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === "{" && src[i + 1] === "{") {
			text += "{";
			i += 2;
			continue;
		}
		if (ch === "}" && src[i + 1] === "}") {
			text += "}";
			i += 2;
			continue;
		}
		if (ch !== "{") {
			text += ch;
			i++;
			continue;
		}
		let j = i + 1;
		let quote: string | null = null;
		for (; j < src.length; j++) {
			const c = src[j];
			if (quote) {
				if (c === quote) quote = null;
			} else if (c === '"' || c === "'") quote = c;
			else if (c === "}") break;
		}
		if (j >= src.length) throw new FormulaError("A { has no closing }.", i, src.length);
		if (text) out.push({ text });
		text = "";
		out.push({ formula: src.slice(i + 1, j), from: i + 1 });
		i = j + 1;
	}
	if (text) out.push({ text });
	return out;
}

// ---------------------------------------------------------------- problems

export interface WorkflowProblem {
	/** "name", "scope", "trigger", "when", "steps" or "step:<i>" */
	at: string;
	message: string;
}

type Lookup = Pick<ViewContext, "types" | "groups">;

const formulaError = (src: string, def: ViewDef, lookup: Lookup): string | null => {
	try {
		compileFormula(src, def, lookup, { workflow: true });
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
};

const templateError = (src: string, def: ViewDef, lookup: Lookup): string | null => {
	try {
		for (const p of parseTemplate(src)) if ("formula" in p) compileFormula(p.formula, def, lookup, { workflow: true });
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
};

/** What's wrong with a workflow (it doesn't run while there are problems). */
export function workflowProblems(wf: WorkflowDef, lookup: Lookup): WorkflowProblem[] {
	const out: WorkflowProblem[] = [];
	const add = (at: string, message: string) => out.push({ at, message });
	if (!wf.name.trim()) add("name", "Give the workflow a name.");
	const known = (s: string) => s === "*" || (s.startsWith("@") ? lookup.groups.some((g) => `@${g.key}` === s) : lookup.types.some((t) => t.key === s));
	for (const s of wf.scope) if (!known(s)) add("scope", `“${s}” isn't a type or group.`);
	if (needsScope(wf.trigger.kind) && !wf.scope.length) add("scope", "Choose the types this workflow watches.");
	const types = scopeTypes(wf, lookup.types);
	const fields = workflowFields(wf, lookup.types);
	const def = workflowDef(wf);
	const t = wf.trigger;
	if (t.kind === "changed") {
		const calc = types.flatMap((x) => x.fields).find((f) => f.key === t.field && isCalculated(f));
		if (calc) add("trigger", `${calc.label} is calculated, so it never changes in the note: watch the fields it's worked out from.`);
		else if (!fields.some((f) => f.key === t.field)) add("trigger", `None of the types has a “${t.field}” field.`);
	}
	if (t.kind === "manual" && t.label !== undefined && !t.label.trim()) add("trigger", "Give the button a label.");
	for (const id of filterFields(wf.when)) if (!formulaColumnOk(id, def, lookup)) add("when", `A condition uses “${id}”, which isn't a column of these types.`);
	if (!wf.steps.length) add("steps", "Add a step.");
	wf.steps.forEach((s, i) => {
		const at = `step:${i}`;
		const fieldOk = (key: string, what: string) => {
			if (!key) return add(at, `Choose the field to ${what}.`);
			const calc = types.flatMap((x) => x.fields).find((f) => f.key === key && isCalculated(f));
			if (calc) return add(at, `${calc.label} is calculated: it can't be ${what === "set" ? "set" : "changed"}.`);
			if (key === COMMON_KEYS.tags) return add(at, "Use “Add or remove a tag” for tags.");
			if (!fields.some((f) => f.key === key)) add(at, `None of the types has a “${key}” field.`);
		};
		switch (s.kind) {
			case "set": {
				fieldOk(s.field, "set");
				if (!s.value.trim()) add(at, "Write the value, e.g. today() or \"done\".");
				else {
					const e = formulaError(s.value, def, lookup);
					if (e) add(at, e);
				}
				break;
			}
			case "clear":
				fieldOk(s.field, "clear");
				break;
			case "tag":
				if (!s.tag.trim().replace(/^#/, "")) add(at, "Write the tag.");
				break;
			case "link": {
				const f = fields.find((x) => x.key === s.field);
				if (!s.field) add(at, "Choose the link field.");
				else if (f?.kind !== "relation") add(at, f ? `${f.label} isn't a link field.` : `None of the types has a “${s.field}” field.`);
				if (!s.target.trim()) add(at, "Write the note to link, e.g. [Project] or \"Apollo\".");
				else {
					const e = formulaError(s.target, def, lookup);
					if (e) add(at, e);
				}
				break;
			}
			case "notice": {
				if (!s.text.trim()) add(at, "Write the notice.");
				else {
					const e = templateError(s.text, def, lookup);
					if (e) add(at, e);
				}
				break;
			}
		}
		if (s.kind !== "notice" && s.kind !== "tag" && !wf.scope.length) add(at, "Choose the types this runs on, so its fields are known.");
	});
	return out;
}

const formulaColumnOk = (id: string, def: ViewDef, lookup: Lookup) => formulaError(`[${id}]`, def, lookup) === null;

// ---------------------------------------------------------------- values

/** A note path's link text as seen from the note being changed (for `[[…]]`). */
export type LinkTextOf = (path: string) => string;

/** The notes a formula result points at: links, or names / link text resolved from the note. */
function targetPaths(v: FValue, row: ViewRow, ctx: ViewContext): { paths: string[]; unknown: string[] } {
	const paths: string[] = [];
	const unknown: string[] = [];
	for (const x of asArray(v) as FValue[]) {
		if (x === null || x === "") continue;
		if (isLink(x)) {
			if (x.path) paths.push(x.path);
			else unknown.push(x.linktext);
			continue;
		}
		const s = toText(x, { dateText: (d) => ctx.dates.format(d, "short") }).trim();
		const target = (parseLink(s)?.path ?? s).trim();
		const path = target ? ctx.resolve(target, row.path) : null;
		if (path) paths.push(path);
		else if (target) unknown.push(target);
	}
	return { paths: [...new Set(paths)], unknown };
}

const valueText = (v: FValue, ctx: ViewContext) => toText(v, { dateText: (d) => ctx.dates.format(d, "short") });

/**
 * A formula result as the value a field stores, or why it can't be: numbers, dates (through the date adapter),
 * checkboxes, choices (matching a choice, ignoring case), lists, links (`[[…]]`), status (one the type has).
 */
export function storedValue(field: WorkflowField, v: FValue, row: ViewRow, ctx: ViewContext, linkText: LinkTextOf): { value: unknown } | { error: string } {
	const empty = v === null || v === "" || (Array.isArray(v) && v.length === 0);
	const text = () => valueText(v, ctx);
	switch (field.kind) {
		case "status": {
			if (empty) return { value: null };
			const statuses = statusesFor(row.type, ctx.groups);
			const s = statuses.find((x) => x.toLowerCase() === text().toLowerCase());
			return s ? { value: s } : { error: `${row.type.name} has no status “${text()}”.` };
		}
		case "number": {
			if (empty) return { value: null };
			const n = typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : Number(text());
			return Number.isFinite(n) ? { value: n } : { error: `“${text()}” isn't a number.` };
		}
		case "date": {
			if (empty) return { value: null };
			const days = v instanceof DateVal ? v.days : ((p) => (p?.ok ? p.value : null))(ctx.dates.parse(text()));
			return days === null ? { error: `“${text()}” isn't a date.` } : { value: writeDay(ctx.dates, days) };
		}
		case "boolean":
			return { value: truthy(v) };
		case "select": {
			if (empty) return { value: null };
			const o = (field.field?.options ?? []).find((x) => x.toLowerCase() === text().toLowerCase());
			return o ? { value: o } : { error: `“${text()}” isn't one of ${field.label}'s choices.` };
		}
		case "multiselect":
		case "list": {
			const items = (asArray(v) as FValue[]).map((x) => valueText(x, ctx)).filter((s) => s !== "");
			if (field.kind === "list") return { value: items };
			const opts = field.field?.options ?? [];
			const out: string[] = [];
			for (const s of items) {
				const o = opts.find((x) => x.toLowerCase() === s.toLowerCase());
				if (!o) return { error: `“${s}” isn't one of ${field.label}'s choices.` };
				if (!out.includes(o)) out.push(o);
			}
			return { value: out };
		}
		case "relation": {
			if (field.field?.labelled) return { error: `${field.label} has labelled links: use “Add or remove a link”.` };
			if (empty) return { value: isListValued(field.field!) ? [] : null };
			const { paths, unknown } = targetPaths(v, row, ctx);
			if (unknown.length) return { error: `No note called “${unknown[0]}”.` };
			const links = paths.map((p) => toWikilink(linkText(p)));
			return { value: isListValued(field.field!) ? links : (links[0] ?? null) };
		}
		default:
			return { value: empty ? null : text() };
	}
}

// ---------------------------------------------------------------- running

export interface StepEnv {
	ctx: ViewContext;
	/** the note, as it is now (the change already made) */
	row: ViewRow;
	/** the note before the change (changed triggers), for old() */
	old?: ViewRow;
	linkText: LinkTextOf;
}

export interface FieldChange {
	key: string;
	before: unknown;
	after: unknown;
}

export interface RunResult {
	/** the note's frontmatter after the steps (unchanged when there's an error) */
	fm: Record<string, unknown>;
	changes: FieldChange[];
	notices: string[];
	/** the step that failed, and why: nothing is written */
	error?: { step: number; message: string };
}

const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** The row with new frontmatter (status and tags follow it, so later steps see earlier ones). */
function withFrontmatter(row: ViewRow, fm: Record<string, unknown>): ViewRow {
	const status = fm[COMMON_KEYS.status];
	const fmTags = asArray(fm[COMMON_KEYS.tags]).map((t) => String(t).replace(/^#/, ""));
	return { ...row, frontmatter: fm, status: typeof status === "string" ? status : null, tags: [...new Set([...fmTags, ...row.tags.filter((t) => !asArray(row.frontmatter[COMMON_KEYS.tags]).map(String).includes(t))])] };
}

/** Render a template for a note. */
export function renderTemplate(src: string, row: ViewRow, def: ViewDef, env: Pick<StepEnv, "ctx" | "old">): string {
	return parseTemplate(src)
		.map((p) => ("text" in p ? p.text : valueText(evaluateFormula(p.formula, row, def, env.ctx, { workflow: true, old: env.old }), env.ctx)))
		.join("");
}

/**
 * Run a workflow's steps on a copy of the note's frontmatter, in order (each sees the ones before). A step that
 * fails stops the run: the result has the error and the frontmatter as it was.
 */
export function runSteps(wf: WorkflowDef, env: StepEnv): RunResult {
	const start = copy(env.row.frontmatter);
	const fm = copy(env.row.frontmatter);
	const def = workflowDef(wf);
	const fields = workflowFields(wf, env.ctx.types);
	const notices: string[] = [];
	let row = env.row;
	const evalAt = (src: string) => evaluateFormula(src, row, def, env.ctx, { workflow: true, old: env.old });
	for (let i = 0; i < wf.steps.length; i++) {
		const s = wf.steps[i];
		try {
			let change: BulkChange | null = null;
			switch (s.kind) {
				case "set":
				case "clear": {
					const f = fields.find((x) => x.key === s.field);
					if (!f) throw new Error(`None of the types has a “${s.field}” field.`);
					if (f.key !== COMMON_KEYS.status && !row.type.fields.some((x) => x.key === f.key)) continue;
					if (s.kind === "clear") change = { op: "set", key: f.key, value: null };
					else {
						// The note's own type's definition of the field (choices, link settings).
						const own = row.type.fields.find((x) => x.key === f.key);
						const r = storedValue(own ? { ...f, kind: own.kind, field: own } : f, evalAt(s.value), row, env.ctx, env.linkText);
						if ("error" in r) throw new Error(r.error);
						change = { op: "set", key: f.key, value: r.value };
					}
					break;
				}
				case "tag": {
					const tag = s.tag.trim().replace(/^#/, "");
					change = { op: s.op === "add" ? "add-tags" : "remove-tags", tags: [tag] };
					break;
				}
				case "link": {
					const f = row.type.fields.find((x) => x.key === s.field);
					if (!f) continue;
					if (f.kind !== "relation") throw new Error(`${f.label} isn't a link field.`);
					const { paths, unknown } = targetPaths(evalAt(s.target), row, env.ctx);
					if (s.op === "add" && unknown.length) throw new Error(`No note called “${unknown[0]}”.`);
					for (const p of paths) {
						const c: BulkChange =
							s.op === "add"
								? { op: "add-link", key: f.key, linktext: env.linkText(p), multiple: isListValued(f), labelled: !!f.labelled }
								: { op: "remove-link", key: f.key, matches: (lp) => env.ctx.resolve(lp, row.path) === p };
						applyChange(fm, c);
					}
					row = withFrontmatter(row, fm);
					continue;
				}
				case "notice":
					notices.push(renderTemplate(s.text, row, def, { ctx: env.ctx, old: env.old }));
					continue;
			}
			if (change) {
				applyChange(fm, change);
				row = withFrontmatter(row, fm);
			}
		} catch (e) {
			return { fm: start, changes: [], notices: [], error: { step: i, message: e instanceof Error ? e.message : String(e) } };
		}
	}
	const keys = new Set([...Object.keys(start), ...Object.keys(fm)]);
	const changes: FieldChange[] = [];
	for (const key of keys) if (JSON.stringify(start[key] ?? null) !== JSON.stringify(fm[key] ?? null)) changes.push({ key, before: start[key], after: fm[key] });
	return { fm, changes, notices };
}

// ---------------------------------------------------------------- in words

const quoted = (vs: string[]) => vs.map((v) => `“${v}”`).join(" or ");

/** A trigger in words: "When Status changes to “done”", "When a Task is created", "Button: Start next session". */
export function triggerText(wf: WorkflowDef, types: EntityTypeDef[]): string {
	const t = wf.trigger;
	const scope = scopeTypes(wf, types);
	const what = wf.scope.length === 1 && scope.length === 1 ? scope[0].name.toLowerCase() : "note";
	switch (t.kind) {
		case "created":
			return `When a ${what} is created`;
		case "changed": {
			const label = fieldLabel(t.field, types);
			if (t.to === "filled") return `When ${label} is filled in`;
			if (t.to === "empty") return `When ${label} is emptied`;
			const from = t.from?.length ? ` from ${quoted(t.from)}` : "";
			return Array.isArray(t.to) && t.to.length ? `When ${label} changes${from} to ${quoted(t.to)}` : `When ${label} changes${from}`;
		}
		case "manual":
			return `Button: ${t.label || wf.name}`;
	}
}
