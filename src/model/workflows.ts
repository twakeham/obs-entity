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
import { compileFormula, dateValue, emptyView, evaluateFormula, formulaRefColumns, filterFields, runView, withThisNote, type FilterGroup, type LinkValue, type ViewContext, type ViewDef, type ViewRow } from "./views";

// ---------------------------------------------------------------- definitions

/** A `changed` trigger's target values: listed values (status, choices, checkboxes), or filled / emptied. */
export type ChangedTo = string[] | "filled" | "empty";

export type WorkflowTrigger =
	| { kind: "created" }
	| { kind: "changed"; field: string; from?: string[]; to?: ChangedTo }
	| { kind: "manual"; label?: string; icon?: string; confirm?: string };

/**
 * A value picked in the editor instead of written as a formula: text, a number, a checkbox, choices, a date (as in
 * filters: "2026-01-31", "today", "+7d", "-1m") or notes (paths).
 */
export type FixedValue = string | number | boolean | string[];

/** "Create a note" when its note already exists: create another (" 2"), use the existing one, or stop the run. */
export type CreateExists = "new" | "use" | "stop";
/** Where a created note opens: not at all, in a new tab, or in the current one. */
export type CreateOpen = "no" | "tab" | "current";
/** A field a created note starts with: picked (`fixed`) or a formula (`value`), as in "Set a field". */
export interface CreateField {
	field: string;
	value: string;
	fixed?: FixedValue;
}
/** Linking a created note and this one: its field to this note ("from-new"), or this note's field to it ("to-new"). */
export interface CreateLink {
	dir: "from-new" | "to-new";
	field: string;
}

/**
 * `set` and `link` steps use `fixed` when it's there, else the formula in `value` / `target`. `on`: the note a step
 * acts on, by the name an earlier "Create a note" step gave it (unset: this note).
 */
export type WorkflowStep =
	| { kind: "set"; field: string; value: string; fixed?: FixedValue; on?: string }
	| { kind: "clear"; field: string; on?: string }
	| { kind: "tag"; op: "add" | "remove"; tag: string; on?: string }
	| { kind: "link"; op: "add" | "remove"; field: string; target: string; fixed?: string[]; on?: string }
	| { kind: "notice"; text: string }
	| { kind: "create"; type: string; name: string; fields: CreateField[]; link?: CreateLink; template: boolean; open: CreateOpen; exists: CreateExists; as: string };

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
export const STEP_LABELS: Record<StepKind, string> = { set: "Set a field", clear: "Clear a field", tag: "Add or remove a tag", link: "Add or remove a link", notice: "Show a notice", create: "Create a note" };
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

function readFixed(v: unknown): FixedValue | undefined {
	if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return v;
	return Array.isArray(v) ? strList(v) : undefined;
}

function readStep(raw: unknown): WorkflowStep | null {
	if (!isObj(raw)) return null;
	const on = str(raw.on) ? { on: str(raw.on) } : {};
	switch (raw.kind) {
		case "set": {
			const fixed = readFixed(raw.fixed);
			return { kind: "set", field: str(raw.field), value: str(raw.value), ...(fixed !== undefined ? { fixed } : {}), ...on };
		}
		case "clear":
			return { kind: "clear", field: str(raw.field), ...on };
		case "tag":
			return { kind: "tag", op: raw.op === "remove" ? "remove" : "add", tag: str(raw.tag), ...on };
		case "link":
			return { kind: "link", op: raw.op === "remove" ? "remove" : "add", field: str(raw.field), target: str(raw.target), ...(Array.isArray(raw.fixed) ? { fixed: strList(raw.fixed) } : {}), ...on };
		case "notice":
			return { kind: "notice", text: str(raw.text) };
		case "create": {
			const l = raw.link;
			const link = isObj(l) && (l.dir === "from-new" || l.dir === "to-new") && str(l.field) ? ({ dir: l.dir, field: str(l.field) } as CreateLink) : undefined;
			const fields = (Array.isArray(raw.fields) ? raw.fields : []).filter(isObj).map((x): CreateField => {
				const fixed = readFixed(x.fixed);
				return { field: str(x.field), value: str(x.value), ...(fixed !== undefined ? { fixed } : {}) };
			});
			return {
				kind: "create",
				type: str(raw.type),
				name: str(raw.name),
				fields,
				...(link ? { link } : {}),
				template: raw.template !== false,
				open: raw.open === "tab" || raw.open === "current" ? raw.open : "no",
				exists: raw.exists === "use" || raw.exists === "stop" ? raw.exists : "new",
				as: str(raw.as),
			};
		}
	}
	return null;
}

function readGroup(raw: unknown): FilterGroup {
	if (!isObj(raw) || !Array.isArray(raw.items)) return { mode: "all", items: [] };
	return { mode: raw.mode === "any" ? "any" : "all", items: raw.items as FilterGroup["items"] };
}

/**
 * Saved workflows, tidied (unknown parts dropped, ids made unique). With the types, "Set a field" steps whose formula
 * is a plain value (`"High"`, `5`, `true`, `today() + 7`) become fixed values.
 */
export function readWorkflows(raw: unknown, types?: EntityTypeDef[]): WorkflowDef[] {
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
	if (types)
		for (const wf of out) {
			const fields = workflowFields(wf, types);
			wf.steps = wf.steps.map((s) => {
				if (s.kind !== "set" || s.fixed !== undefined) return s;
				const fixed = fixedFromFormula(s.value, fields.find((f) => f.key === s.field));
				return fixed === undefined ? s : { ...s, value: "", fixed };
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

/** A button workflow's label and icon (its name and a lightning bolt when not set). */
export const buttonLabel = (wf: WorkflowDef): string => (wf.trigger.kind === "manual" && wf.trigger.label?.trim()) || wf.name || "Run workflow";
export const buttonIcon = (wf: WorkflowDef): string => (wf.trigger.kind === "manual" && wf.trigger.icon) || "zap";

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

/** The notes "Create a note" steps before step `i` make, by the name later steps use. */
export function createdBefore(wf: Pick<WorkflowDef, "steps">, i: number): { as: string; type: string }[] {
	return wf.steps.slice(0, i).flatMap((s) => (s.kind === "create" && s.as.trim() ? [{ as: s.as.trim(), type: s.type }] : []));
}

/** The fields step `i` can use: this note's (the scope's), or, with `on`, the created note's type's. */
export function stepFields(wf: Pick<WorkflowDef, "scope" | "steps">, i: number, types: EntityTypeDef[]): WorkflowField[] {
	const s = wf.steps[i];
	const on = s && "on" in s ? s.on : undefined;
	if (!on) return workflowFields(wf, types);
	const made = createdBefore(wf, i).find((x) => x.as === on);
	return made && types.some((t) => t.key === made.type) ? workflowFields({ scope: [made.type] }, types) : [];
}

/**
 * How a created note of a type and this note can be linked: the new type's link fields that can point at every one of
 * this workflow's types ("from-new"), and this note's link fields that can point at the new type ("to-new").
 */
export function createLinkOptions(wf: Pick<WorkflowDef, "scope">, typeKey: string, types: EntityTypeDef[]): { fromNew: WorkflowField[]; toNew: WorkflowField[] } {
	const t = types.find((x) => x.key === typeKey);
	if (!t) return { fromNew: [], toNew: [] };
	const scope = scopeTypes(wf, types);
	const anyNote = (f: FieldDef) => !f.targets?.length || f.targets.includes("*");
	const fromNew = t.fields
		.filter((f) => f.kind === "relation" && (wf.scope.length ? scope.every((st) => typeMatchesTarget(st, f.targets)) : anyNote(f)))
		.map((f): WorkflowField => ({ key: f.key, label: f.label, kind: f.kind, field: f }));
	const toNew = workflowFields(wf, types).filter((f) => f.kind === "relation" && f.field && typeMatchesTarget(t, f.field.targets));
	return { fromNew, toNew };
}

/** A new "Create a note" step: a type that can link to this note (its link set), named for later steps. */
export function newCreateStep(wf: Pick<WorkflowDef, "scope" | "steps" | "trigger">, types: EntityTypeDef[]): Extract<WorkflowStep, { kind: "create" }> {
	const scope = new Set(scopeTypes(wf, types).map((t) => t.key));
	const linkable = types.filter((t) => createLinkOptions(wf, t.key, types).fromNew.length);
	const type = linkable.find((t) => !scope.has(t.key)) ?? linkable[0] ?? types.find((t) => !scope.has(t.key)) ?? types[0];
	const opts = type ? createLinkOptions(wf, type.key, types) : { fromNew: [], toNew: [] };
	const link: CreateLink | undefined = opts.fromNew[0] ? { dir: "from-new", field: opts.fromNew[0].key } : opts.toNew[0] ? { dir: "to-new", field: opts.toNew[0].key } : undefined;
	const used = new Set(wf.steps.flatMap((s) => (s.kind === "create" ? [s.as.trim().toLowerCase()] : [])));
	const base = `New ${(type?.name ?? "note").toLowerCase()}`;
	let as = base;
	for (let n = 2; used.has(as.toLowerCase()); n++) as = `${base} ${n}`;
	return { kind: "create", type: type?.key ?? "", name: "", fields: [], ...(link ? { link } : {}), template: true, open: wf.trigger.kind === "manual" ? "tab" : "no", exists: "new", as };
}

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

const formulaError = (src: string, def: ViewDef, lookup: Lookup, vars: string[] = []): string | null => {
	try {
		compileFormula(src, def, lookup, { workflow: true, vars });
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
};

const templateError = (src: string, def: ViewDef, lookup: Lookup, vars: string[] = []): string | null => {
	try {
		for (const p of parseTemplate(src)) if ("formula" in p) compileFormula(p.formula, def, lookup, { workflow: true, vars });
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
	const columnLabels = new Set(formulaRefColumns(def, lookup).map((c) => c.label.toLowerCase()));
	const names = new Set<string>();
	wf.steps.forEach((s, i) => {
		const at = `step:${i}`;
		const made = createdBefore(wf, i);
		const vars = made.map((x) => x.as);
		// The note the step acts on: this one, or one an earlier step created.
		const on = "on" in s ? s.on : undefined;
		const onType = on ? lookup.types.find((x) => x.key === made.find((m) => m.as === on)?.type) : undefined;
		if (on && !made.some((m) => m.as === on)) return add(at, `No earlier step creates “${on}”.`);
		const tTypes = on ? (onType ? [onType] : []) : types;
		const tFields = on ? (onType ? workflowFields({ scope: [onType.key] }, lookup.types) : []) : fields;
		const fErr = (src: string) => formulaError(src, def, lookup, vars);
		const fieldOk = (key: string, what: string) => {
			if (!key) return add(at, `Choose the field to ${what}.`);
			const calc = tTypes.flatMap((x) => x.fields).find((f) => f.key === key && isCalculated(f));
			if (calc) return add(at, `${calc.label} is calculated: it can't be ${what === "set" ? "set" : "changed"}.`);
			if (key === COMMON_KEYS.tags) return add(at, "Use “Add or remove a tag” for tags.");
			if (!tFields.some((f) => f.key === key)) add(at, on && onType ? `${onType.name} has no “${key}” field.` : `None of the types has a “${key}” field.`);
		};
		switch (s.kind) {
			case "set": {
				fieldOk(s.field, "set");
				if (s.fixed !== undefined) {
					const p = fixedProblem(s.fixed, tFields.find((f) => f.key === s.field), tTypes, lookup.groups);
					if (p) add(at, p);
				} else if (!s.value.trim()) add(at, "Write the formula, e.g. today() or [Start] + 7.");
				else {
					const e = fErr(s.value);
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
				const f = tFields.find((x) => x.key === s.field);
				if (!s.field) add(at, "Choose the link field.");
				else if (f?.kind !== "relation") add(at, f ? `${f.label} isn't a link field.` : `None of the types has a “${s.field}” field.`);
				if (s.fixed !== undefined) {
					if (!s.fixed.length) add(at, "Choose the note to link.");
				} else if (!s.target.trim()) add(at, "Write the note to link, e.g. [Project] or \"Apollo\".");
				else {
					const e = fErr(s.target);
					if (e) add(at, e);
				}
				break;
			}
			case "notice": {
				if (!s.text.trim()) add(at, "Write the notice.");
				else {
					const e = templateError(s.text, def, lookup, vars);
					if (e) add(at, e);
				}
				break;
			}
			case "create": {
				const nt = lookup.types.find((x) => x.key === s.type);
				if (!nt) add(at, s.type ? `“${s.type}” isn't a type.` : "Choose the type of note to create.");
				else {
					const e = s.name.trim() ? templateError(s.name, def, lookup, vars) : null;
					if (e) add(at, `Name: ${e}`);
					const nf = workflowFields({ scope: [nt.key] }, lookup.types);
					for (const r of s.fields) {
						const f = nf.find((x) => x.key === r.field && x.kind !== "tags");
						if (!f) {
							add(at, r.field ? `${nt.name} has no “${r.field}” field.` : "Choose the field to fill in.");
							continue;
						}
						if (r.fixed !== undefined) {
							const p = fixedProblem(r.fixed, f, [nt], lookup.groups);
							if (p) add(at, `${f.label}: ${p}`);
						} else if (!r.value.trim()) add(at, `${f.label}: write the formula, or pick a value.`);
						else {
							const fe = fErr(r.value);
							if (fe) add(at, `${f.label}: ${fe}`);
						}
					}
					if (s.link) {
						const o = createLinkOptions(wf, nt.key, lookup.types);
						if (!(s.link.dir === "from-new" ? o.fromNew : o.toNew).some((f) => f.key === s.link!.field)) add(at, `“${s.link.field}” can't link the new note and this one.`);
					}
				}
				const as = s.as.trim();
				if (!as) add(at, "Name the note for later steps (Call it).");
				else if (names.has(as.toLowerCase())) add(at, `Another step already creates “${as}”: choose another name.`);
				else if (columnLabels.has(as.toLowerCase())) add(at, `“${as}” is already a field's name: choose another.`);
				names.add(as.toLowerCase());
				break;
			}
		}
		if ((s.kind === "set" || s.kind === "clear" || s.kind === "link") && !on && !wf.scope.length) add(at, "Choose the types this runs on, so its fields are known.");
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

// ---------------------------------------------------------------- fixed values

/** Whether a fixed value is empty (nothing picked or typed). Checkboxes and numbers never are. */
export const isEmptyFixed = (v: FixedValue | undefined): boolean => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** A field's starting fixed value: ticked for checkboxes, none for lists and links, else empty. */
export const defaultFixed = (f: WorkflowField | undefined): FixedValue =>
	f?.kind === "boolean" ? true : f?.kind === "multiselect" || f?.kind === "list" || f?.kind === "relation" ? [] : "";

const STRING_LIT = /^"((?:[^"\\]|\\.)*)"$|^'([^'\\]*)'$/;

/**
 * A formula as a fixed value for a field, when it's just a value of the field's kind: `"High"` for text and
 * choices, `5` for numbers, `true` / `false` for checkboxes, `today()`, `today() + 7` or `"2026-01-31"` for dates.
 * Anything else (references, functions, links) stays a formula: undefined.
 */
export function fixedFromFormula(src: string, f: WorkflowField | undefined): FixedValue | undefined {
	const s = src.trim();
	if (!f || !s) return undefined;
	const m = STRING_LIT.exec(s);
	let text: string | null = null;
	if (m)
		try {
			text = m[1] !== undefined ? (JSON.parse(`"${m[1]}"`) as string) : m[2];
		} catch {
			text = null;
		}
	switch (f.kind) {
		case "status":
		case "select":
		case "text":
		case "textarea":
		case "url":
			return text ?? undefined;
		case "multiselect":
		case "list":
			return text ? [text] : undefined;
		case "number":
			return /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : undefined;
		case "boolean":
			return /^(true|false)$/i.test(s) ? s.toLowerCase() === "true" : undefined;
		case "date": {
			const rel = /^today\(\)(?:\s*([+-])\s*(\d+))?$/i.exec(s);
			if (rel) return rel[2] && Number(rel[2]) ? `${rel[1]}${Number(rel[2])}d` : "today";
			return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
		}
	}
	return undefined;
}

const lit = (s: string) => JSON.stringify(s);
const notePath = (p: string) => p.replace(/\.md$/i, "");

/** A fixed value written as a formula (to carry on in the formula editor). */
export function formulaFromFixed(v: FixedValue | undefined, f: WorkflowField | undefined): string {
	if (v === undefined || isEmptyFixed(v)) return "";
	if (f?.kind === "relation") {
		const items = (Array.isArray(v) ? v : [String(v)]).map((p) => lit(notePath(p)));
		return items.length === 1 ? items[0] : `list(${items.join(", ")})`;
	}
	if (Array.isArray(v)) return v.length === 1 ? lit(v[0]) : `list(${v.map(lit).join(", ")})`;
	if (typeof v !== "string") return String(v);
	if (f?.kind === "date") {
		const s = v.trim().toLowerCase();
		if (s === "today") return "today()";
		const m = /^([+-]?\d+)\s*([dwmy])$/.exec(s);
		if (m) {
			const n = Number(m[1]);
			if (m[2] === "d" || m[2] === "w") {
				const days = m[2] === "w" ? 7 * n : n;
				return days === 0 ? "today()" : `today() ${days < 0 ? "-" : "+"} ${Math.abs(days)}`;
			}
			return `dateAdd(today(), ${n}, "${m[2] === "m" ? "months" : "years"}")`;
		}
	}
	return lit(v);
}

/** A fixed value as a formula result for a field of this kind: dates worked out from today, notes as links. */
export function fixedToValue(v: FixedValue, kind: WorkflowField["kind"], row: ViewRow, ctx: ViewContext): FValue {
	if (kind === "date" && typeof v === "string") {
		const d = dateValue(v, ctx);
		return d === null ? v : new DateVal(d);
	}
	if (kind === "relation") {
		return (Array.isArray(v) ? v : [String(v)]).map((p) => {
			const path = ctx.resolve(p, row.path) ?? ctx.resolve(notePath(p), row.path);
			const name = notePath(p).split("/").pop() ?? p;
			return path ? { path, linktext: notePath(p), name } : name;
		});
	}
	return v;
}

/** What's wrong with a fixed value for a field (status and choices the types don't have), or null. */
function fixedProblem(v: FixedValue | undefined, f: WorkflowField | undefined, types: EntityTypeDef[], groups: GroupDef[]): string | null {
	if (!f) return null;
	if (f.kind !== "boolean" && isEmptyFixed(v)) return f.kind === "relation" ? "Choose the note." : "Choose or write the value.";
	const items = Array.isArray(v) ? v : [String(v)];
	if (f.kind === "status") {
		const all = types.flatMap((t) => statusesFor(t, groups)).map((s) => s.toLowerCase());
		const bad = items.find((s) => !all.includes(s.toLowerCase()));
		if (bad) return `None of these types has the status “${bad}”.`;
	}
	if (f.kind === "select" || f.kind === "multiselect") {
		const opts = (f.field?.options ?? []).map((o) => o.toLowerCase());
		const bad = items.find((s) => !opts.includes(s.toLowerCase()));
		if (bad) return `“${bad}” isn't one of ${f.label}'s choices.`;
	}
	if (f.kind === "number" && typeof v !== "number") return `“${String(v)}” isn't a number.`;
	return null;
}

// ---------------------------------------------------------------- running

/** Where a "Create a note" step's note would go: the engine works it out (folder rules, names already taken). */
export interface PlaceRequest {
	type: EntityTypeDef;
	name: string;
	/** the new note's frontmatter so far (its parent link decides the folder) */
	fm: Record<string, unknown>;
	exists: CreateExists;
	/** paths (lower case) of notes this run creates before this one */
	taken: Set<string>;
}
/** The new note's path; or, with "Use the existing one", the existing note; or why the run stops. */
export type Placed = { path: string; existing?: ViewRow } | { stop: string };

export interface StepEnv {
	ctx: ViewContext;
	/** the note, as it is now (the change already made) */
	row: ViewRow;
	/** the note before the change (changed triggers), for old() */
	old?: ViewRow;
	linkText: LinkTextOf;
	/** places created notes; without it, "Create a note" steps fail */
	place?: (req: PlaceRequest) => Placed;
}

export interface FieldChange {
	key: string;
	before: unknown;
	after: unknown;
}

/** A note other than the one the workflow runs on: one it created, or an existing one it changed ("Use the existing one"). */
export interface OtherNote {
	path: string;
	name: string;
	/** set when the run created it: its frontmatter is `fm` */
	created?: { type: string; template: boolean; open: CreateOpen };
	fm: Record<string, unknown>;
	changes: FieldChange[];
}

export interface RunResult {
	/** the note's frontmatter after the steps (unchanged when there's an error) */
	fm: Record<string, unknown>;
	changes: FieldChange[];
	notices: string[];
	/** notes created or changed besides this one, in the order the steps made them */
	others: OtherNote[];
	/** the step that failed, and why: nothing is written */
	error?: { step: number; message: string };
	/** why the run stopped before doing anything ("If it already exists: Stop the run") */
	stopped?: string;
}

const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const baseName = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** The row with new frontmatter (status and tags follow it, so later steps see earlier ones). */
function withFrontmatter(row: ViewRow, fm: Record<string, unknown>): ViewRow {
	const status = fm[COMMON_KEYS.status];
	const fmTags = asArray(fm[COMMON_KEYS.tags]).map((t) => String(t).replace(/^#/, ""));
	return { ...row, frontmatter: fm, status: typeof status === "string" ? status : null, tags: [...new Set([...fmTags, ...row.tags.filter((t) => !asArray(row.frontmatter[COMMON_KEYS.tags]).map(String).includes(t))])] };
}

/** Render a template for a note (`vars`: notes earlier steps created, by name). */
export function renderTemplate(src: string, row: ViewRow, def: ViewDef, env: Pick<StepEnv, "ctx" | "old"> & { vars?: Record<string, LinkValue> }): string {
	return parseTemplate(src)
		.map((p) => ("text" in p ? p.text : valueText(evaluateFormula(p.formula, row, def, env.ctx, { workflow: true, old: env.old, vars: env.vars }), env.ctx)))
		.join("");
}

const diffOf = (start: Record<string, unknown>, fm: Record<string, unknown>): FieldChange[] => {
	const out: FieldChange[] = [];
	for (const key of new Set([...Object.keys(start), ...Object.keys(fm)])) if (JSON.stringify(start[key] ?? null) !== JSON.stringify(fm[key] ?? null)) out.push({ key, before: start[key], after: fm[key] });
	return out;
};

class StopRun extends Error {}

/** A note a run is working on: this one, or one a step created (or reused). */
interface RunNote {
	path: string;
	row: ViewRow;
	start: Record<string, unknown>;
	fm: Record<string, unknown>;
	created?: OtherNote["created"];
}

/**
 * Run a workflow's steps on a copy of the note's frontmatter, in order (each sees the ones before). "Create a note"
 * steps plan new notes (placed by `env.place`) that later steps can act on (`on`) or refer to (`[Name]`). A step
 * that fails stops the run: the result has the error, the frontmatter as it was and no other notes.
 */
export function runSteps(wf: WorkflowDef, env: StepEnv): RunResult {
	const start = copy(env.row.frontmatter);
	const def = workflowDef(wf);
	const notices: string[] = [];
	const main: RunNote = { path: env.row.path, row: env.row, start, fm: copy(env.row.frontmatter) };
	const named = new Map<string, RunNote>();
	const others: RunNote[] = [];
	const taken = new Set<string>();
	const vars: Record<string, LinkValue> = {};
	// Formulas see the notes this run is making (prop([New session], "Date")) as they are so far.
	const noteAt = (p: string) => (p === main.path ? main : others.find((n) => n.path === p));
	const ctx: ViewContext = {
		...env.ctx,
		row: (p) => noteAt(p)?.row ?? env.ctx.row(p),
		resolve: (lp, src) => env.ctx.resolve(lp, src) ?? others.find((n) => n.path === lp || n.path === `${lp}.md` || n.row.name.toLowerCase() === lp.toLowerCase())?.path ?? null,
	};
	const evalAt = (src: string) => evaluateFormula(src, main.row, def, ctx, { workflow: true, old: env.old, vars });
	const fieldsOf = (n: RunNote) => (n === main ? workflowFields(wf, ctx.types) : workflowFields({ scope: [n.row.type.key] }, ctx.types));
	const sync = (n: RunNote) => (n.row = withFrontmatter(n.row, n.fm));
	/** A picked value or formula, as the note's field stores it (the note's own type's definition of the field). */
	const valueFor = (f: WorkflowField, n: RunNote, fixed: FixedValue | undefined, formula: string): unknown => {
		const own = n.row.type.fields.find((x) => x.key === f.key);
		const target = own ? { ...f, kind: own.kind, field: own } : f;
		const r = storedValue(target, fixed !== undefined ? fixedToValue(fixed, target.kind, n.row, ctx) : evalAt(formula), n.row, ctx, env.linkText);
		if ("error" in r) throw new Error(r.error);
		return r.value;
	};
	const addLink = (n: RunNote, f: FieldDef, path: string) => {
		applyChange(n.fm, { op: "add-link", key: f.key, linktext: env.linkText(path), multiple: isListValued(f), labelled: !!f.labelled });
		sync(n);
	};
	for (let i = 0; i < wf.steps.length; i++) {
		const s = wf.steps[i];
		try {
			const on = "on" in s ? s.on : undefined;
			const note = on ? named.get(on) : main;
			if (!note) throw new Error(`No earlier step created “${on}”.`);
			let change: BulkChange | null = null;
			switch (s.kind) {
				case "set":
				case "clear": {
					const f = fieldsOf(note).find((x) => x.key === s.field);
					if (!f) throw new Error(`None of the types has a “${s.field}” field.`);
					if (f.key !== COMMON_KEYS.status && !note.row.type.fields.some((x) => x.key === f.key)) continue;
					change = { op: "set", key: f.key, value: s.kind === "clear" ? null : valueFor(f, note, s.fixed, s.value) };
					break;
				}
				case "tag": {
					const tag = s.tag.trim().replace(/^#/, "");
					change = { op: s.op === "add" ? "add-tags" : "remove-tags", tags: [tag] };
					break;
				}
				case "link": {
					const f = note.row.type.fields.find((x) => x.key === s.field);
					if (!f) continue;
					if (f.kind !== "relation") throw new Error(`${f.label} isn't a link field.`);
					const { paths, unknown } = targetPaths(s.fixed !== undefined ? fixedToValue(s.fixed, "relation", note.row, ctx) : evalAt(s.target), note.row, ctx);
					if (s.op === "add" && unknown.length) throw new Error(`No note called “${unknown[0]}”.`);
					for (const p of paths) {
						const c: BulkChange =
							s.op === "add"
								? { op: "add-link", key: f.key, linktext: env.linkText(p), multiple: isListValued(f), labelled: !!f.labelled }
								: { op: "remove-link", key: f.key, matches: (lp) => ctx.resolve(lp, note.path) === p };
						applyChange(note.fm, c);
					}
					sync(note);
					continue;
				}
				case "notice":
					notices.push(renderTemplate(s.text, main.row, def, { ctx, old: env.old, vars }));
					continue;
				case "create": {
					if (!env.place) throw new Error("Notes can't be created here.");
					const type = ctx.types.find((x) => x.key === s.type);
					if (!type) throw new Error(s.type ? `“${s.type}” isn't a type.` : "Choose the type of note to create.");
					const name = (s.name.trim() ? renderTemplate(s.name, main.row, def, { ctx, old: env.old, vars }) : "").trim() || `New ${type.name.toLowerCase()}`;
					const fm: Record<string, unknown> = {};
					const draft: RunNote = {
						path: "",
						row: { path: "", name, type, status: null, subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null, frontmatter: fm },
						start: {},
						fm,
					};
					const nf = workflowFields({ scope: [type.key] }, ctx.types);
					for (const r of s.fields) {
						const f = nf.find((x) => x.key === r.field);
						if (!f) throw new Error(`${type.name} has no “${r.field}” field.`);
						fm[f.key] = valueFor(f, draft, r.fixed, r.value);
						sync(draft);
					}
					const fromNew = s.link?.dir === "from-new" ? type.fields.find((x) => x.key === s.link!.field && x.kind === "relation") : undefined;
					if (fromNew) addLink(draft, fromNew, main.path);
					const placed = env.place({ type, name, fm, exists: s.exists, taken });
					if ("stop" in placed) throw new StopRun(placed.stop);
					let made: RunNote;
					if (placed.existing) {
						// "Use the existing one": no new note; its link is still made, its fields left as they are.
						made = noteAt(placed.path) ?? { path: placed.path, row: placed.existing, start: copy(placed.existing.frontmatter), fm: copy(placed.existing.frontmatter) };
						if (made !== main && !others.includes(made)) others.push(made);
						if (fromNew) addLink(made, fromNew, main.path);
					} else {
						taken.add(placed.path.toLowerCase());
						made = { ...draft, path: placed.path, row: { ...draft.row, path: placed.path, name: baseName(placed.path) }, created: { type: type.key, template: s.template, open: s.open } };
						others.push(made);
					}
					const as = s.as.trim();
					named.set(as, made);
					vars[as] = { path: made.path, linktext: env.linkText(made.path), name: made.row.name };
					if (s.link?.dir === "to-new") {
						const f = main.row.type.fields.find((x) => x.key === s.link!.field && x.kind === "relation");
						if (f) addLink(main, f, made.path);
					}
					continue;
				}
			}
			if (change) {
				applyChange(note.fm, change);
				sync(note);
			}
		} catch (e) {
			if (e instanceof StopRun) return { fm: start, changes: [], notices: [], others: [], stopped: e.message };
			return { fm: start, changes: [], notices: [], others: [], error: { step: i, message: e instanceof Error ? e.message : String(e) } };
		}
	}
	return {
		fm: main.fm,
		changes: diffOf(start, main.fm),
		notices,
		others: others
			.map((n): OtherNote => ({ path: n.path, name: n.row.name, ...(n.created ? { created: n.created } : {}), fm: n.fm, changes: diffOf(n.start, n.fm) }))
			.filter((o) => o.created || o.changes.length),
	};
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
