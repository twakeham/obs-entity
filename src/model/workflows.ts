/**
 * Workflows (DESIGN §8.11): when something happens to a note, if it matches some conditions, do a list of steps.
 * Pure parts: definitions and reading them from settings, matching triggers to changes, problems, templates, turning
 * formula results into stored values, and running the steps on a copy of a note's frontmatter. The engine
 * (services/workflows.ts) listens to the index, writes notes, chains, undoes and logs.
 */
import { applyChange, type BulkChange } from "./bulk";
import { writeDay } from "./calendarView";
import { DateVal, FormulaError, isLink, toText, truthy, type FType, type FValue } from "./formula";
import { isEmptyValue } from "./frontmatter";
import { asArray, parseLink, toWikilink } from "./links";
import type { DateAdapter } from "./dates";
import { joinPath } from "./paths";
import { COMMON_KEYS, isCalculated, isListValued, statusesFor, typeExplicitlyTargeted, typeMatchesTarget, type EntityTypeDef, type FieldDef, type GroupDef } from "./types";
import { compileFormula, dateValue, emptyView, evaluateFormula, formulaRefColumns, filterFields, runView, withThisNote, type FilterGroup, type LinkValue, type SortLevel, type VarSpec, type ViewContext, type ViewDef, type ViewRow } from "./views";

// ---------------------------------------------------------------- definitions

/** A `changed` trigger's target values: listed values (status, choices, checkboxes), or filled / emptied. */
export type ChangedTo = string[] | "filled" | "empty";

export type WorkflowTrigger =
	| { kind: "created" }
	| { kind: "changed"; field: string; from?: string[]; to?: ChangedTo }
	| { kind: "manual"; label?: string; icon?: string; confirm?: string; selection?: "once" }
	| ScheduleTrigger
	| DateTrigger;

/**
 * "On a schedule": every day at a time, every week on a day at a time, or every N hours; one run per scoped note
 * matching Only if, at most `limit` notes (else it doesn't run).
 */
export interface ScheduleTrigger {
	kind: "schedule";
	every: "day" | "week" | "hours";
	/** "HH:MM", local time (day, week) */
	at: string;
	/** 0 Sunday … 6 Saturday (week) */
	day: number;
	/** every N hours (hours) */
	hours: number;
	limit: number;
}

/** "On a date": when a date field (moved by `offset` days: -3 is three days before) reaches today; checked daily at `at`. */
export interface DateTrigger {
	kind: "date";
	field: string;
	offset: number;
	at: string;
	limit: number;
}

/** Triggers that run on their own: nobody may be there to answer a question. */
export const isTimed = (t: WorkflowTrigger): t is ScheduleTrigger | DateTrigger => t.kind === "schedule" || t.kind === "date";
/** The most notes a scheduled run goes through by default. */
export const DEFAULT_LIMIT = 50;
export const DEFAULT_AT = "09:00";

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
/** A plain note's body (unset: empty): a template note's text ({{title}}, {{date}}, {{time}}), or text with {formula} parts. */
export type CreateBody = { from: "template"; path: string } | { from: "text"; text: string };
/** "Create a note" with no type: a plain note, placed in `folder`, its body `body`; no fields or link. */
export const PLAIN_NOTE = "";
/** What a plain note is for the rows runs work on: a type with no fields, which nothing else has. */
export const PLAIN_TYPE: EntityTypeDef = { key: PLAIN_NOTE, name: "Note", plural: "Notes", icon: "file", color: "", group: "", template: "", fields: [], builtIn: false };

/** `on` for the workflow's own note, inside a loop (where unset means each linked note). */
export const ON_THIS = "@this";
/** "This note" in formulas inside a loop of notes: the note the workflow runs on. */
export const THIS_NOTE_VAR = "This note";
/** In a run once for a whole selection: the selected notes (that match Only if), as links. */
export const SELECTION_VAR = "Selected notes";

/** A button workflow run once for all the selected notes together (no single "this note"), rather than once for each. */
export const runsOnce = (wf: Pick<WorkflowDef, "trigger">): boolean => wf.trigger.kind === "manual" && wf.trigger.selection === "once";

/** Why a step can't act on (or read) "this note" in a run for a whole selection. */
export const NO_NOTE = "A run for the whole selection has no single note: put this inside a For each over [Selected notes], or make it act on a note an earlier step creates.";

/** Where "For linked notes" gets its notes: this note's link field, or another type's link field pointing here. */
export type LinkedSource = { dir: "out"; field: string } | { dir: "in"; type: string; field: string };

/**
 * Steps that act on one note, or none. `set` and `link` use `fixed` when it's there, else the formula in `value` /
 * `target`. `on`: the note a step acts on: unset for the default (this note; each linked note inside a loop), `ON_THIS`
 * for the workflow's note inside a loop, or the name a "Create a note" step gave its note. `var`: "Set a variable", a
 * value (a formula's) later steps use by its name, for the rest of the run (after loops too); setting it again changes it.
 */
export type NoteStep =
	| { kind: "set"; field: string; value: string; fixed?: FixedValue; on?: string }
	| { kind: "clear"; field: string; on?: string }
	| { kind: "tag"; op: "add" | "remove"; tag: string; on?: string }
	| { kind: "link"; op: "add" | "remove"; field: string; target: string; fixed?: string[]; on?: string }
	| { kind: "notice"; text: string }
	| { kind: "create"; type: string; name: string; fields: CreateField[]; link?: CreateLink; template: boolean; open: CreateOpen; exists: CreateExists; as: string; folder?: string; body?: CreateBody }
	| { kind: "run"; workflow: string; on?: string }
	| { kind: "ask"; text: string }
	| { kind: "input"; text: string; as: string; default?: string; multiline?: true }
	| { kind: "move"; to: MoveTo; folder: string; on?: string }
	| { kind: "rename"; name: string; on?: string }
	| { kind: "var"; name: string; value: string };

/** "Move the note": to a folder (a template, e.g. "Archive/{year(today())}"), or where its type's folder rules put it now. */
export type MoveTo = "folder" | "type";

/**
 * Loops, with steps inside (loops too, to any depth). "For linked notes": the notes in a link field of the note steps
 * act on, or linking to it. "For each": the items of a formula's list: notes, or values (text, numbers, dates). Inside
 * a loop of notes, formulas read each note and steps act on it; `as` names it (and a value, in a loop of values).
 */
export type LoopStep =
	| { kind: "linked"; source: LinkedSource; when: FilterGroup; as: string; steps: WorkflowStep[] }
	| { kind: "each"; formula: string; items: "notes" | "values"; itemType: string; when: FilterGroup; as: string; steps: WorkflowStep[] };

/**
 * "If": `steps` when it's true, else `otherwise`. The test is conditions on a note (`when`, a view filter on the note
 * it's `on`, as other steps), or a formula that's true or false.
 */
export type IfStep = { kind: "if"; test: "filter" | "formula"; when: FilterGroup; formula: string; on?: string; steps: WorkflowStep[]; otherwise: WorkflowStep[] };

/**
 * "Find notes": the notes of some types (`types`, as a scope: [] any) that match `when`, in `sort` order, as `[as]`
 * for the rest of the run (like a variable): all of them (at most `limit`, when it's set), or the first only, which
 * steps can then act on ("On").
 */
export type FindStep = { kind: "find"; types: string[]; when: FilterGroup; sort?: SortLevel; limit?: number; keep: "all" | "first"; as: string };

export type WorkflowStep = NoteStep | LoopStep | IfStep | FindStep;

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
	/**
	 * Its changes don't set off other workflows (When created, When changed, dates): its writes are silent, like undo's.
	 * "Run another workflow" steps still run, as part of it.
	 */
	isolated?: true;
}

export const TRIGGER_LABELS: Record<TriggerKind, string> = { created: "When a note is created", changed: "When a field changes", manual: "Run on notes", schedule: "On a schedule", date: "On a date" };
export const TRIGGER_ICONS: Record<TriggerKind, string> = { created: "file-plus", changed: "pencil", manual: "mouse-pointer-click", schedule: "clock", date: "calendar-clock" };
export const STEP_LABELS: Record<StepKind, string> = {
	set: "Set a field",
	clear: "Clear a field",
	tag: "Add or remove a tag",
	link: "Add or remove a link",
	notice: "Show a notice",
	move: "Move the note",
	rename: "Rename the note",
	create: "Create a note",
	linked: "For linked notes",
	each: "For each",
	run: "Run another workflow",
	ask: "Confirm",
	input: "Ask a question",
	var: "Set a variable",
	if: "If",
	find: "Find notes",
};
/** The most notes (or values) loops go through in one run; past it the run stops. */
export const MAX_LOOP_ITEMS = 200;
/** How deep "Run another workflow" goes (a workflow running one that runs one…). */
export const MAX_RUN_DEPTH = 3;
/** The most chained runs (a run's changes starting others) before the chain stops. */
export const MAX_CHAIN = 5;
/** A run (or a selection to run on) bigger than this asks first. */
export const BIG_RUN = 20;

export const newWorkflowId = () => `wf-${Math.random().toString(36).slice(2, 8)}`;

export function newWorkflow(scope: string[] = [], trigger: WorkflowTrigger = { kind: "changed", field: COMMON_KEYS.status }): WorkflowDef {
	return { id: newWorkflowId(), name: "New workflow", on: true, scope, trigger, when: { mode: "all", items: [] }, steps: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const wholeIn = (v: unknown, min: number, max: number, dflt: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : dflt);

function readTrigger(raw: unknown): WorkflowTrigger {
	if (!isObj(raw)) return { kind: "manual" };
	if (raw.kind === "created") return { kind: "created" };
	if (raw.kind === "schedule")
		return {
			kind: "schedule",
			every: raw.every === "week" || raw.every === "hours" ? raw.every : "day",
			at: isTime(raw.at) ? raw.at : DEFAULT_AT,
			day: wholeIn(raw.day, 0, 6, 1),
			hours: wholeIn(raw.hours, 1, 168, 4),
			limit: wholeIn(raw.limit, 1, 10000, DEFAULT_LIMIT),
		};
	if (raw.kind === "date") return { kind: "date", field: str(raw.field), offset: wholeIn(raw.offset, -3650, 3650, 0), at: isTime(raw.at) ? raw.at : DEFAULT_AT, limit: wholeIn(raw.limit, 1, 10000, DEFAULT_LIMIT) };
	if (raw.kind === "changed") {
		const to = raw.to === "filled" || raw.to === "empty" ? raw.to : Array.isArray(raw.to) ? strList(raw.to) : undefined;
		const from = Array.isArray(raw.from) ? strList(raw.from) : undefined;
		return { kind: "changed", field: str(raw.field) || COMMON_KEYS.status, ...(from?.length ? { from } : {}), ...(to && (to === "filled" || to === "empty" || to.length) ? { to } : {}) };
	}
	return {
		kind: "manual",
		...(str(raw.label) ? { label: str(raw.label) } : {}),
		...(str(raw.icon) ? { icon: str(raw.icon) } : {}),
		...(str(raw.confirm) ? { confirm: str(raw.confirm) } : {}),
		...(raw.selection === "once" ? { selection: "once" as const } : {}),
	};
}

function readFixed(v: unknown): FixedValue | undefined {
	if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return v;
	return Array.isArray(v) ? strList(v) : undefined;
}

const readSteps = (raw: unknown): WorkflowStep[] => (Array.isArray(raw) ? raw : []).map(readStep).filter((s): s is WorkflowStep => !!s);

function readStep(raw: unknown): WorkflowStep | null {
	if (!isObj(raw)) return null;
	const on = str(raw.on) ? { on: str(raw.on) } : {};
	switch (raw.kind) {
		case "linked": {
			const sr = raw.source;
			const source: LinkedSource = isObj(sr) && sr.dir === "in" ? { dir: "in", type: str(sr.type), field: str(sr.field) } : { dir: "out", field: isObj(sr) ? str(sr.field) : "" };
			return { kind: "linked", source, when: readGroup(raw.when), as: str(raw.as), steps: readSteps(raw.steps) };
		}
		case "each":
			return { kind: "each", formula: str(raw.formula), items: raw.items === "notes" ? "notes" : "values", itemType: str(raw.itemType), when: readGroup(raw.when), as: str(raw.as), steps: readSteps(raw.steps) };
		case "run":
			return { kind: "run", workflow: str(raw.workflow), ...on };
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
		case "ask":
			return { kind: "ask", text: str(raw.text) };
		case "input":
			return { kind: "input", text: str(raw.text), as: str(raw.as), ...(str(raw.default) ? { default: str(raw.default) } : {}), ...(raw.multiline === true ? { multiline: true as const } : {}) };
		case "move":
			return { kind: "move", to: raw.to === "type" ? "type" : "folder", folder: str(raw.folder), ...on };
		case "rename":
			return { kind: "rename", name: str(raw.name), ...on };
		case "var":
			return { kind: "var", name: str(raw.name), value: str(raw.value) };
		case "if":
			return { kind: "if", test: raw.test === "formula" ? "formula" : "filter", when: readGroup(raw.when), formula: str(raw.formula), ...on, steps: readSteps(raw.steps), otherwise: readSteps(raw.otherwise) };
		case "find": {
			const so = raw.sort;
			const sort = isObj(so) && str(so.by) ? { sort: { by: str(so.by), dir: so.dir === "desc" ? ("desc" as const) : ("asc" as const) } } : {};
			const limit = typeof raw.limit === "number" && raw.limit > 0 ? { limit: raw.limit } : {};
			return { kind: "find", types: strList(raw.types), when: readGroup(raw.when), ...sort, ...limit, keep: raw.keep === "first" ? "first" : "all", as: str(raw.as) };
		}
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
				...(str(raw.type) === PLAIN_NOTE ? plainParts(raw) : {}),
			};
		}
	}
	return null;
}

/** A plain note's folder and body, as saved. */
function plainParts(raw: Record<string, unknown>): { folder?: string; body?: CreateBody } {
	const b = raw.body;
	const body: CreateBody | undefined = isObj(b) && b.from === "template" ? { from: "template", path: str(b.path) } : isObj(b) && b.from === "text" ? { from: "text", text: typeof b.text === "string" ? b.text : "" } : undefined;
	return { ...(str(raw.folder) ? { folder: str(raw.folder) } : {}), ...(body ? { body } : {}) };
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
			steps: readSteps(w.steps),
			...(w.isolated === true ? { isolated: true as const } : {}),
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
export const needsScope = (k: TriggerKind) => k === "created" || k === "changed" || k === "schedule" || k === "date";

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

/** A step's blocks of steps inside it: a loop's one; an If's two (then, otherwise); none for other steps. */
export const stepBlocks = (s: WorkflowStep): WorkflowStep[][] => (isLoop(s) ? [s.steps] : s.kind === "if" ? [s.steps, s.otherwise] : []);
/** The step with new blocks (as many as it has). */
export const withBlocks = (s: WorkflowStep, blocks: WorkflowStep[][]): WorkflowStep =>
	isLoop(s) ? { ...s, steps: blocks[0] ?? [] } : s.kind === "if" ? { ...s, steps: blocks[0] ?? [], otherwise: blocks[1] ?? [] } : s;
/** Where a block's steps start in its step's numbering: steps inside step "2" are "2.0", "2.1"…, through all its blocks. */
export const blockOffset = (s: WorkflowStep, block: number): number => stepBlocks(s).slice(0, block).reduce((n, b) => n + b.length, 0);
/** Steps and every step inside them, in order. */
export const flatSteps = (steps: WorkflowStep[]): WorkflowStep[] => steps.flatMap((s) => [s, ...flatSteps(stepBlocks(s).flat())]);
export const isLoop = (s: WorkflowStep): s is LoopStep => s.kind === "linked" || s.kind === "each";
/** A step's number for people: "3", or "3.2" for the second step inside step 3. */
export const stepLabel = (key: string): string =>
	key
		.split(".")
		.map((n) => Number(n) + 1)
		.join(".");
/** The step at `key` ("2", "2.0"…). */
export function stepAt(steps: WorkflowStep[], key: string): WorkflowStep | undefined {
	const [head, ...rest] = key.split(".").map(Number);
	const s = steps[head];
	return s && rest.length ? stepAt(stepBlocks(s).flat(), rest.join(".")) : s;
}
/** The steps with the one at `key` ("2", "2.0"…) replaced. */
export function mapStepAt(steps: WorkflowStep[], key: string, fn: (s: WorkflowStep) => WorkflowStep): WorkflowStep[] {
	const [head, ...rest] = key.split(".").map(Number);
	return steps.map((s, i) => {
		if (i !== head) return s;
		if (!rest.length) return fn(s);
		// The child's place across the blocks: which block, and where in it.
		let j = rest[0];
		const blocks = stepBlocks(s).map((b) => {
			const mine = j >= 0 && j < b.length;
			const out = mine ? mapStepAt(b, [j, ...rest.slice(1)].join("."), fn) : b;
			j -= b.length;
			return out;
		});
		return withBlocks(s, blocks);
	});
}
/** Whether a workflow stops to ask something ("Confirm", "Ask a question"). */
export const asksQuestion = (wf: Pick<WorkflowDef, "steps">): boolean => flatSteps(wf.steps).some((s) => s.kind === "ask" || s.kind === "input");

/** "For linked notes" choices: this note's link fields, and other types' link fields that point at these types. */
export function linkedSources(scope: string[], types: EntityTypeDef[]): { out: WorkflowField[]; in: { type: EntityTypeDef; field: FieldDef; label: string }[] } {
	const st = scopeTypes({ scope }, types);
	const out = workflowFields({ scope }, types).filter((f) => f.kind === "relation");
	const into: { type: EntityTypeDef; field: FieldDef; label: string }[] = [];
	if (scope.length)
		for (const t of types)
			for (const f of t.fields)
				if (f.kind === "relation" && st.every((x) => typeExplicitlyTargeted(x, f.targets))) into.push({ type: t, field: f, label: `${t.plural || t.name} (${f.label})` });
	return { out, in: into };
}

/** The types of a loop's notes (none for a loop of values). */
export function loopItemTypes(s: LoopStep, scope: string[], types: EntityTypeDef[]): EntityTypeDef[] {
	if (s.kind === "linked") {
		if (s.source.dir === "in") return types.filter((t) => t.key === (s.source as { type: string }).type);
		const f = workflowFields({ scope }, types).find((x) => x.key === s.source.field && x.kind === "relation")?.field;
		return f ? types.filter((t) => typeMatchesTarget(t, f.targets)) : [];
	}
	if (s.items !== "notes") return [];
	return s.itemType ? types.filter((t) => t.key === s.itemType) : types;
}

/** The scope keys for a set of types: [] when it's every type (any note). */
const keysOf = (ts: EntityTypeDef[], all: EntityTypeDef[]) => (ts.length === all.length ? [] : ts.map((t) => t.key));

/** Headings for a run's names, in the order pickers list them (names with no role last, as "Notes and values"). */
const VAR_GROUPS: { role: VarSpec["role"]; title: string }[] = [
	{ role: "this", title: "This note" },
	{ role: "selection", title: "The selection" },
	{ role: "item", title: "Loop items" },
	{ role: "created", title: "Created notes" },
	{ role: "found", title: "Found notes" },
	{ role: "answer", title: "Answers" },
	{ role: "variable", title: "Variables" },
	{ role: undefined, title: "Notes and values" },
];

/** A run's names (a step's `vars`) by what they are: this note or the selection, loop items, created and found notes, variables. */
export function varGroups(vars: (string | VarSpec)[]): { title: string; vars: VarSpec[] }[] {
	const specs = vars.map((v): VarSpec => (typeof v === "string" ? { name: v, type: "links" } : v));
	return VAR_GROUPS.map((g) => ({ title: g.title, vars: specs.filter((v) => v.role === g.role) })).filter((g) => g.vars.length);
}

/** What a step can see and act on (DESIGN §8.11). */
export interface StepScope {
	/** the columns formulas read */
	def: ViewDef;
	/** the note steps act on when `on` is unset: its scope (as in a workflow''s; [] any note), types and fields */
	scope: string[];
	types: EntityTypeDef[];
	fields: WorkflowField[];
	/** names formulas can use besides columns (`role` says what each is): this note or the selection, loop items, created and found notes, variables */
	vars: VarSpec[];
	/** which of `vars` have no value until the run: variables and answers ("Set a variable", "Ask a question" before this step) */
	variables?: string[];
	/** "On" choices besides the default: stored value, label, the note''s types; `made`: a note this run creates (`plain`: with no type); `found`: a "Find notes" step's first */
	on: { value: string; label: string; types: EntityTypeDef[]; made?: true; plain?: true; found?: true }[];
	/** the default note in the On picker: "This note", or "Each <name>" in a loop of notes */
	defaultLabel: string;
	/** inside a loop (of notes, or of values) */
	loop?: "notes" | "values";
	/** in a loop of notes: the note steps act on by default (its name, its types), for loops inside to act on */
	item?: { name: string; types: EntityTypeDef[] };
	/** no single note here (a run once for a whole selection, outside a loop of notes): steps can't act on one, nor formulas read one */
	noNote?: true;
}

/**
 * Each step''s scope, by its place: "3", or "3.1" for the second step inside step 3 (and "3.1.0" inside that). Created
 * notes are seen by the steps after them in the same list, and inside those (not after the loop: they're made once
 * per item). In a loop of notes formulas read each note, and steps act on it. A run once for a whole selection has
 * no "this note": `[Selected notes]` instead, and loops over them.
 */
export function stepScopes(wf: Pick<WorkflowDef, "scope" | "when" | "steps"> & Partial<Pick<WorkflowDef, "trigger">>, lookup: Lookup): Map<string, StepScope> {
	const all = lookup.types;
	const out = new Map<string, StepScope>();
	const once = !!wf.trigger && runsOnce({ trigger: wf.trigger });
	const top: StepScope = once
		? { def: workflowDef(wf), scope: wf.scope, types: scopeTypes(wf, all), fields: workflowFields(wf, all), vars: [{ name: SELECTION_VAR, type: "links", role: "selection" }], on: [], defaultLabel: "No single note", noNote: true }
		: { def: workflowDef(wf), scope: wf.scope, types: scopeTypes(wf, all), fields: workflowFields(wf, all), vars: [{ name: THIS_NOTE_VAR, type: "links", role: "this" }], on: [], defaultLabel: "This note" };
	const withCreated = (sc: StepScope, s: WorkflowStep): StepScope =>
		s.kind === "create" && s.as.trim()
			? { ...sc, vars: [...sc.vars, { name: s.as.trim(), type: "links", role: "created" }], on: [...sc.on, { value: s.as.trim(), label: s.as.trim(), types: all.filter((t) => t.key === s.type), made: true, ...(s.type === PLAIN_NOTE ? { plain: true as const } : {}) }] }
			: sc;
	/** The scope inside a loop. */
	const loopScope = (s: LoopStep, cur: StepScope): StepScope => {
		const as = s.as.trim() || "Item";
		if (s.kind === "each" && s.items === "values") return { ...cur, vars: [...cur.vars, { name: as, type: "any", role: "item" }], loop: "values" };
		const its = loopItemTypes(s, cur.scope, all);
		const scope = keysOf(its, all);
		const hasThis = cur.on.some((o) => o.value === ON_THIS);
		return {
			def: workflowDef({ scope, when: s.when }),
			scope,
			types: its,
			fields: workflowFields({ scope }, all),
			vars: [...cur.vars, { name: as, type: "links", role: "item" }],
			// Inside a loop inside another: the outer loop's note, by its name.
			on: [...(once || hasThis ? [] : [{ value: ON_THIS, label: "This note", types: scopeTypes(wf, all) }]), ...cur.on, ...(cur.item ? [{ value: cur.item.name, label: cur.item.name, types: cur.item.types }] : [])],
			defaultLabel: `Each ${as.toLowerCase()}`,
			loop: "notes",
			item: { name: as, types: its },
		};
	};
	const walk = (steps: WorkflowStep[], keyOf: (i: number) => string, start: StepScope) => {
		let cur = start;
		steps.forEach((s, i) => {
			const key = keyOf(i);
			// Variables are seen by every step after the first that sets them, in or out of loops; so are found notes.
			const sc =
				globals.length || globalOn.length
					? {
							...cur,
							vars: [...cur.vars, ...globals.filter((g) => !cur.vars.some((v) => v.name === g.name))],
							variables: globals.filter((g) => g.role === "variable" || g.role === "answer").map((g) => g.name),
							on: [...cur.on, ...globalOn.filter((g) => !cur.on.some((o) => o.value === g.value))],
						}
					: cur;
			out.set(key, sc);
			if (s.kind === "var" && s.name.trim()) setVar(s.name.trim(), varType(s.value, sc), "variable");
			if (s.kind === "input" && s.as.trim()) setVar(s.as.trim(), "text", "answer");
			if (s.kind === "find" && s.as.trim()) {
				setVar(s.as.trim(), "links", "found");
				if (s.keep === "first" && !globalOn.some((g) => g.value === s.as.trim())) globalOn.push({ value: s.as.trim(), label: s.as.trim(), types: scopeTypes({ scope: s.types }, all), found: true });
			}
			const inner = isLoop(s) ? loopScope(s, cur) : cur;
			let offset = 0;
			for (const b of stepBlocks(s)) {
				const o = offset;
				walk(b, (j) => `${key}.${o + j}`, inner);
				offset += b.length;
			}
			cur = withCreated(cur, s);
		});
	};
	/** Variables so far, in the order they're first set. */
	const globals: VarSpec[] = [];
	/** Notes "Find notes" steps found first (keep: first), so far. */
	const globalOn: StepScope["on"] = [];
	const varType = (src: string, sc: StepScope): FType => {
		try {
			return compileFormula(src, sc.def, lookup, { workflow: true, vars: sc.vars }).compiled.type;
		} catch {
			return "any";
		}
	};
	// Set again with another kind of value: it can be either.
	const setVar = (name: string, type: FType, role: "variable" | "found" | "answer") => {
		const had = globals.find((g) => g.name.toLowerCase() === name.toLowerCase());
		if (!had) globals.push({ name, type, role });
		else if (had.type !== type) had.type = "any";
	};
	walk(wf.steps, String, top);
	return out;
}

/** The note a step acts on, in its scope: its types and fields (null: `on` names nothing before it). */
export function stepTarget(s: WorkflowStep, sc: StepScope, all: EntityTypeDef[]): { scope: string[]; types: EntityTypeDef[]; fields: WorkflowField[] } | null {
	const on = "on" in s ? s.on : undefined;
	if (on === undefined) return { scope: sc.scope, types: sc.types, fields: sc.fields };
	const o = sc.on.find((x) => x.value === on);
	if (!o) return null;
	// A plain note has no fields: only tags.
	if (o.plain) return { scope: [PLAIN_NOTE], types: [], fields: [{ key: COMMON_KEYS.tags, label: "Tags", kind: "tags" }] };
	const scope = keysOf(o.types, all);
	return { scope, types: o.types, fields: workflowFields({ scope }, all) };
}

/** Workflows a workflow runs ("Run another workflow"), directly. */
const runsOf = (wf: Pick<WorkflowDef, "steps">): string[] => flatSteps(wf.steps).flatMap((s) => (s.kind === "run" ? [s.workflow] : []));

/** A chain of workflows that leads back to `wf` through "Run another workflow" (names), or null. */
export function runCycle(wf: WorkflowDef, all: WorkflowDef[]): string[] | null {
	const byId = new Map(all.map((w) => [w.id, w]));
	byId.set(wf.id, wf);
	const visit = (id: string, path: string[]): string[] | null => {
		for (const next of runsOf(byId.get(id) ?? { steps: [] })) {
			if (next === wf.id) return [...path, wf.name];
			if (path.length > MAX_RUN_DEPTH + 2 || !byId.has(next) || path.includes(byId.get(next)!.name)) continue;
			const found = visit(next, [...path, byId.get(next)!.name]);
			if (found) return found;
		}
		return null;
	};
	return visit(wf.id, [wf.name]);
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

/**
 * A new "Create a note" step: a type that can link to this note (another type than the workflow's, if there is one),
 * named for later steps; not linked and not opened to start with.
 */
export function newCreateStep(wf: Pick<WorkflowDef, "scope" | "steps" | "trigger">, types: EntityTypeDef[]): Extract<WorkflowStep, { kind: "create" }> {
	const scope = new Set(scopeTypes(wf, types).map((t) => t.key));
	const linkable = types.filter((t) => createLinkOptions(wf, t.key, types).fromNew.length);
	const type = linkable.find((t) => !scope.has(t.key)) ?? linkable[0] ?? types.find((t) => !scope.has(t.key)) ?? types[0];
	const used = new Set(wf.steps.flatMap((s) => (s.kind === "create" ? [s.as.trim().toLowerCase()] : [])));
	const base = `New ${(type?.name ?? "note").toLowerCase()}`;
	let as = base;
	for (let n = 2; used.has(as.toLowerCase()); n++) as = `${base} ${n}`;
	return { kind: "create", type: type?.key ?? PLAIN_NOTE, name: "", fields: [], template: true, open: "no", exists: "new", as };
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

// ---------------------------------------------------------------- time

const HOUR = 3_600_000;
const hm = (at: string): [number, number] => {
	const [h, m] = (isTime(at) ? at : DEFAULT_AT).split(":").map(Number);
	return [h, m];
};

/**
 * The time a schedule is due at, if it's due: the latest time it should have run in (since, now] (once, however
 * many were missed), or null. Day and week schedules use local time; "every N hours" is due N hours after it last ran.
 */
export function dueAt(t: ScheduleTrigger, since: number, now: number): number | null {
	if (t.every === "hours") return now - since >= Math.max(1, t.hours) * HOUR ? now : null;
	const [h, m] = hm(t.at);
	const d = new Date(now);
	d.setHours(h, m, 0, 0);
	if (t.every === "day") {
		if (d.getTime() > now) d.setDate(d.getDate() - 1);
	} else {
		d.setDate(d.getDate() - ((d.getDay() - t.day + 7) % 7));
		if (d.getTime() > now) d.setDate(d.getDate() - 7);
	}
	return d.getTime() > since ? d.getTime() : null;
}

/** When a schedule (or a date trigger's daily check) runs next, after it last ran at `since`. */
export function nextDue(t: ScheduleTrigger | DateTrigger, since: number): number {
	if (t.kind === "schedule" && t.every === "hours") return since + Math.max(1, t.hours) * HOUR;
	const [h, m] = hm(t.at);
	const d = new Date(since);
	d.setHours(h, m, 0, 0);
	while (d.getTime() <= since || (t.kind === "schedule" && t.every === "week" && d.getDay() !== t.day)) d.setDate(d.getDate() + 1);
	return d.getTime();
}

/** Whether a date trigger's daily check is due: it's past its time today, and today hasn't been checked. */
export function dateCheckDue(t: DateTrigger, lastDay: number, today: number, now: number): boolean {
	if (lastDay >= today) return false;
	const [h, m] = hm(t.at);
	const d = new Date(now);
	return d.getHours() * 60 + d.getMinutes() >= h * 60 + m;
}

/** Whether a note's date (moved by the trigger's offset) falls in (after, today]: reached since the last check. */
export function dateReached(t: DateTrigger, raw: unknown, dates: DateAdapter, after: number, today: number): boolean {
	const p = dates.parse(raw);
	if (!p || !p.ok || typeof p.value !== "number") return false;
	const d = p.value + t.offset;
	return d > after && d <= today;
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

/**
 * The `{formula}` part of a template the cursor (`pos`) is in, from just inside its `{` to just after its `}`: where
 * its formula starts and ends. Null outside one, or when the template can't be read.
 */
export function templatePartAt(src: string, pos: number): { from: number; to: number } | null {
	try {
		for (const p of parseTemplate(src)) if ("formula" in p && pos >= p.from && pos <= p.from + p.formula.length + 1) return { from: p.from, to: p.from + p.formula.length };
	} catch {
		// An unclosed { : no part to edit.
	}
	return null;
}

// ---------------------------------------------------------------- problems

export interface WorkflowProblem {
	/** "name", "scope", "trigger", "when", "steps" or "step:<key>" ("step:2", "step:2.0" inside it) */
	at: string;
	message: string;
}

type Lookup = Pick<ViewContext, "types" | "groups">;

/** A formula that reads a note's columns where there's no single note (`noNote`): only named notes and values can be read. */
const NO_NOTE_FORMULA = "There's no single note here, so a formula can't read its fields: use [Selected notes] (e.g. count([Selected notes])), or a note an earlier step creates.";

const formulaError = (src: string, def: ViewDef, lookup: Lookup, vars: VarSpec[] = [], noNote = false): string | null => {
	try {
		const { refs } = compileFormula(src, def, lookup, { workflow: true, vars });
		return noNote && refs.size ? NO_NOTE_FORMULA : null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
};

const templateError = (src: string, def: ViewDef, lookup: Lookup, vars: VarSpec[] = [], noNote = false): string | null => {
	try {
		for (const p of parseTemplate(src))
			if ("formula" in p) {
				const { refs } = compileFormula(p.formula, def, lookup, { workflow: true, vars });
				if (noNote && refs.size) return NO_NOTE_FORMULA;
			}
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
};

/** Whether a formula reads a note's columns (not only named notes and values); unreadable formulas don't. */
export function readsNote(src: string, def: ViewDef, lookup: Lookup, vars: VarSpec[], template = false): boolean {
	try {
		const parts = template ? parseTemplate(src).flatMap((p) => ("formula" in p ? [p.formula] : [])) : [src];
		return parts.some((f) => compileFormula(f, def, lookup, { workflow: true, vars }).refs.size > 0);
	} catch {
		return false;
	}
}

/** What's wrong with a workflow (it doesn't run while there are problems). `lookup.workflows`: for "Run another workflow". */
export function workflowProblems(wf: WorkflowDef, lookup: Lookup & { workflows?: WorkflowDef[] }, checking: string[] = []): WorkflowProblem[] {
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
	const once = runsOnce(wf);
	if (t.kind === "changed") {
		const calc = types.flatMap((x) => x.fields).find((f) => f.key === t.field && isCalculated(f));
		if (calc) add("trigger", `${calc.label} is calculated, so it never changes in the note: watch the fields it's worked out from.`);
		else if (!fields.some((f) => f.key === t.field)) add("trigger", `None of the types has a “${t.field}” field.`);
	}
	if (t.kind === "manual" && t.label !== undefined && !t.label.trim()) add("trigger", "Give the button a label.");
	if (t.kind === "schedule") {
		if (t.every !== "hours" && !isTime(t.at)) add("trigger", "Choose the time, e.g. 09:00.");
		if (t.every === "hours" && !(Number.isInteger(t.hours) && t.hours >= 1 && t.hours <= 168)) add("trigger", "Every 1 to 168 hours.");
	}
	if (t.kind === "date") {
		const f = fields.find((x) => x.key === t.field);
		if (!t.field) add("trigger", "Choose the date field.");
		else if (!f) add("trigger", `None of the types has a “${t.field}” field.`);
		else if (f.kind !== "date") add("trigger", `${f.label} isn't a date field.`);
		if (!isTime(t.at)) add("trigger", "Choose the time to check, e.g. 09:00.");
		if (!Number.isInteger(t.offset)) add("trigger", "The number of days must be a whole number.");
	}
	if (isTimed(t) && !(Number.isInteger(t.limit) && t.limit >= 1)) add("trigger", "Allow at least 1 note per run.");
	for (const id of filterFields(wf.when)) if (!formulaColumnOk(id, def, lookup)) add("when", `A condition uses “${id}”, which isn't a column of these types.`);
	if (!wf.steps.length) add("steps", "Add a step.");
	const scopes = stepScopes(wf, lookup);
	const names = new Set<string>();
	const varNames = new Set<string>();
	const reserved = (lower: string) => lower === THIS_NOTE_VAR.toLowerCase() || lower === SELECTION_VAR.toLowerCase();
	const isField = (lower: string, sc: StepScope) => formulaRefColumns(sc.def, lookup).some((c) => c.label.toLowerCase() === lower);
	/** A name later steps use (a created note, a loop's item): unique, and not a column's label. */
	const nameOk = (at: string, raw: string, sc: StepScope, what: string) => {
		const as = raw.trim();
		if (!as) return add(at, `Name ${what} for later steps (Call it).`);
		if (names.has(as.toLowerCase()) || varNames.has(as.toLowerCase()) || reserved(as.toLowerCase())) add(at, `Another step already uses the name “${as}”: choose another.`);
		else if (isField(as.toLowerCase(), sc)) add(at, `“${as}” is already a field's name: choose another.`);
		names.add(as.toLowerCase());
	};
	const checkOne = (s: WorkflowStep, key: string) => {
		const at = `step:${key}`;
		const sc = scopes.get(key);
		if (!sc) return;
		// A run for a whole selection has no "this note" to act on.
		if (once && "on" in s && s.on === ON_THIS) return add(at, NO_NOTE);
		const target = stepTarget(s, sc, lookup.types);
		if (!target) return add(at, `No earlier step creates or finds “${(s as { on?: string }).on}”.`);
		const tTypes = target.types;
		const tFields = target.fields;
		const fErr = (src: string) => formulaError(src, sc.def, lookup, sc.vars, !!sc.noNote);
		const tErr = (src: string) => templateError(src, sc.def, lookup, sc.vars, !!sc.noNote);
		if (sc.noNote && !("on" in s && s.on !== undefined) && (s.kind === "set" || s.kind === "clear" || s.kind === "tag" || s.kind === "link" || s.kind === "move" || s.kind === "rename" || s.kind === "run" || (s.kind === "if" && s.test === "filter"))) add(at, NO_NOTE);
		if (sc.noNote && s.kind === "create" && s.link && s.type !== PLAIN_NOTE) add(at, "There's no single note to link the new note to: link it inside a For each over [Selected notes], or leave Link empty.");
		if (sc.noNote && s.kind === "linked") add(at, "For linked notes starts from a note: use For each over [Selected notes] instead.");
		const fieldOk = (fkey: string, what: string) => {
			if (!fkey) return add(at, `Choose the field to ${what}.`);
			const calc = tTypes.flatMap((x) => x.fields).find((f) => f.key === fkey && isCalculated(f));
			if (calc) return add(at, `${calc.label} is calculated: it can't be ${what === "set" ? "set" : "changed"}.`);
			if (fkey === COMMON_KEYS.tags) return add(at, "Use “Add or remove a tag” for tags.");
			if (!tFields.some((f) => f.key === fkey)) add(at, tTypes.length === 1 ? `${tTypes[0].name} has no “${fkey}” field.` : `None of the types has a “${fkey}” field.`);
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
					const e = tErr(s.text);
					if (e) add(at, e);
				}
				break;
			}
			case "ask":
			case "input": {
				const what = s.kind === "ask" ? "confirm" : "ask a question";
				if (sc.loop) add(at, `It can't ${what} inside a loop: ${s.kind === "ask" ? "confirm" : "ask"} before the loop.`);
				if (isTimed(wf.trigger)) add(at, `A workflow that runs on its own can't ${what}: nobody may be there to answer.`);
				if (!s.text.trim()) add(at, s.kind === "ask" ? "Write the question, e.g. Also close its tasks?" : "Write the question, e.g. What's the summary?");
				else {
					const e = tErr(s.text);
					if (e) add(at, e);
				}
				if (s.kind === "input") {
					const de = s.default?.trim() ? tErr(s.default) : null;
					if (de) add(at, `Default answer: ${de}`);
					nameOk(at, s.as, sc, "the answer");
				}
				break;
			}
			case "find": {
				for (const k of s.types) if (!known(k)) add(at, `“${k}” isn't a type or group.`);
				const fDef = workflowDef({ scope: s.types, when: s.when });
				for (const id of filterFields(s.when)) if (!formulaColumnOk(id, fDef, lookup)) add(at, `A condition uses “${id}”, which isn't a column of these notes.`);
				if (s.sort && !formulaColumnOk(s.sort.by, fDef, lookup)) add(at, `It's sorted by “${s.sort.by}”, which isn't a column of these notes.`);
				if (s.limit !== undefined && !(Number.isInteger(s.limit) && s.limit >= 1)) add(at, "At most: a whole number, 1 or more.");
				nameOk(at, s.as, sc, s.keep === "first" ? "the note it finds" : "the notes it finds");
				break;
			}
			case "if": {
				if (s.test === "formula") {
					if (!s.formula.trim()) add(at, "Write the formula, e.g. [Estimate] > 5 or [Total] = 0.");
					else {
						const e = fErr(s.formula);
						if (e) add(at, e);
					}
				} else {
					if (!s.when.items.length) add(at, "Add a condition.");
					const tDef = workflowDef({ scope: target.scope, when: s.when });
					for (const id of filterFields(s.when)) if (!formulaColumnOk(id, tDef, lookup)) add(at, `A condition uses “${id}”, which isn't a column of ${tTypes.length === 1 ? (tTypes[0].plural || tTypes[0].name) : "these notes"}.`);
				}
				if (!s.steps.length && !s.otherwise.length) add(at, "Add a step, under Then or Otherwise.");
				break;
			}
			case "var": {
				const name = s.name.trim();
				const lower = name.toLowerCase();
				// Setting a variable again is fine; its name can't be a note's, a loop item's or a field's.
				if (!name) add(at, "Name the variable, e.g. Total.");
				else if (names.has(lower) || reserved(lower)) add(at, `“${name}” is already the name of a note or loop item: choose another.`);
				else if (isField(lower, sc)) add(at, `“${name}” is already a field's name: choose another.`);
				else if (/[[\]{}]/.test(name)) add(at, "A variable's name can't have brackets or braces in it.");
				if (name) varNames.add(lower);
				if (!s.value.trim()) add(at, "Write the formula, e.g. 0, [Estimate] * 2 or [Total] + 1.");
				else {
					const e = fErr(s.value);
					if (e) add(at, e);
				}
				break;
			}
			case "move":
			case "rename": {
				if (s.on !== undefined && sc.on.some((o) => o.value === s.on && o.made)) add(at, `“${s.on}” is a note this workflow creates: its Create a note step names it, and its type's folder rules place it.`);
				const src = s.kind === "move" ? (s.to === "folder" ? s.folder : "") : s.name;
				if (s.kind === "move" && s.to === "folder" && !src.trim()) add(at, "Choose the folder, e.g. Archive or Archive/{year(today())}.");
				else if (s.kind === "rename" && !src.trim()) add(at, "Write the new name, e.g. {[Code]} {[Name]}.");
				else if (src.trim()) {
					const e = tErr(src);
					if (e) add(at, e);
				}
				break;
			}
			case "create": {
				const nt = lookup.types.find((x) => x.key === s.type);
				const nameErr = s.name.trim() ? tErr(s.name) : null;
				if (s.type === PLAIN_NOTE) {
					if (nameErr) add(at, `Name: ${nameErr}`);
					const fe = s.folder?.trim() ? tErr(s.folder) : null;
					if (fe) add(at, `Folder: ${fe}`);
					if (s.body?.from === "template" && !s.body.path.trim()) add(at, "Choose the template note for its body.");
					if (s.body?.from === "text" && s.body.text.trim()) {
						const be = tErr(s.body.text);
						if (be) add(at, `Body: ${be}`);
					}
				} else if (!nt) add(at, `“${s.type}” isn't a type.`);
				else {
					if (nameErr) add(at, `Name: ${nameErr}`);
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
						const o = createLinkOptions({ scope: sc.scope }, nt.key, lookup.types);
						if (!(s.link.dir === "from-new" ? o.fromNew : o.toNew).some((f) => f.key === s.link!.field)) add(at, `“${s.link.field}” can't link the new note and this one.`);
					}
				}
				nameOk(at, s.as, sc, "the note");
				break;
			}
			case "run": {
				const sub = lookup.workflows?.find((w) => w.id === s.workflow);
				if (!s.workflow) add(at, "Choose the workflow to run.");
				else if (s.workflow === wf.id) add(at, "A workflow can't run itself.");
				else if (!sub) add(at, "The workflow it runs has been deleted.");
				else {
					if (tTypes.length && !tTypes.some((x) => inScope(sub, x))) add(at, `“${sub.name}” doesn't apply to ${tTypes.length === 1 ? (tTypes[0].plural || tTypes[0].name) : "these notes"}.`);
					if (asksQuestion(sub)) add(at, `“${sub.name}” stops to ask you something, so it can't be run from another workflow.`);
					if (!checking.includes(sub.id) && workflowProblems(sub, lookup, [...checking, wf.id]).length) add(at, `“${sub.name}” has problems, so it can't run.`);
				}
				break;
			}
			case "linked":
			case "each": {
				if (s.kind === "linked") {
					const src = linkedSources(sc.scope, lookup.types);
					const so = s.source;
					const ok = so.dir === "out" ? src.out.some((f) => f.key === so.field) : src.in.some((x) => x.type.key === so.type && x.field.key === so.field);
					if (!(so.dir === "out" ? so.field : so.field && so.type)) add(at, "Choose which linked notes.");
					else if (!ok) add(at, "Those notes aren't linked to these types any more: choose again.");
				} else {
					if (!s.formula.trim()) add(at, "Write the formula that gives the list.");
					else {
						const e = fErr(s.formula);
						if (e) add(at, e);
					}
					if (s.items === "notes" && s.itemType && !lookup.types.some((x) => x.key === s.itemType)) add(at, `“${s.itemType}” isn't a type.`);
				}
				const innerDef = workflowDef({ scope: keysOf(loopItemTypes(s, sc.scope, lookup.types), lookup.types), when: s.when });
				if (s.kind === "linked" || s.items === "notes")
					for (const id of filterFields(s.when)) if (!formulaColumnOk(id, innerDef, lookup)) add(at, `A condition uses “${id}”, which isn't a column of these notes.`);
				nameOk(at, s.as, sc, s.kind === "linked" || s.items === "notes" ? "each note" : "each value");
				if (!s.steps.length) add(at, "Add a step inside the loop.");
				break;
			}
		}
		const def0 = !("on" in s) || s.on === undefined;
		if ((s.kind === "set" || s.kind === "clear" || s.kind === "link") && def0 && !sc.scope.length && sc.loop !== "notes" && !sc.noNote) add(at, "Choose the types this runs on, so its fields are known.");
	};
	const check = (s: WorkflowStep, key: string) => {
		checkOne(s, key);
		let offset = 0;
		for (const b of stepBlocks(s)) {
			const o = offset;
			b.forEach((x, j) => check(x, `${key}.${o + j}`));
			offset += b.length;
		}
	};
	wf.steps.forEach((s, i) => check(s, String(i)));
	if (lookup.workflows && !checking.length) {
		const cycle = runCycle(wf, lookup.workflows);
		if (cycle) add("steps", `It runs itself: ${cycle.join(" → ")}.`);
	}
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
	/** a plain note (no type): the folder it goes in ("/": the vault's top folder; "": where Obsidian puts new notes), not a type's folder rules */
	plain?: { folder: string };
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
	/** every workflow, for "Run another workflow" */
	workflows?: WorkflowDef[];
	/** every note, for "Find notes" (without it, Find finds only notes this run makes) */
	rows?: ViewRow[];
	/**
	 * Confirmations answered Yes ("Confirm"), by step ("2", "4.1"): one not in it pauses the run (`pending`); "all"
	 * answers every one Yes, and every question with its default answer (a test run).
	 */
	answers?: Set<string> | "all";
	/** Answers to "Ask a question" steps, by step: one not in it pauses the run (`pending`, with `input`). */
	inputs?: Map<string, string>;
	/**
	 * A run once for a whole selection: the selected notes (`row` is only the first, for link text): no "this note",
	 * the notes as [Selected notes].
	 */
	selection?: ViewRow[];
}

/** Where "Move the note" / "Rename the note" send a note: a folder (vault root ""), its type's folder rules, a new name. */
export interface NoteMove {
	folder?: string;
	byType?: true;
	name?: string;
}

export interface FieldChange {
	key: string;
	before: unknown;
	after: unknown;
}

/** A note other than the one the workflow runs on: one it created, or an existing one it changed (a linked note, "Use the existing one"). */
export interface OtherNote {
	path: string;
	name: string;
	/** set when the run created it: its frontmatter is `fm`; a plain note (type "") has its body here too */
	created?: { type: string; template: boolean; open: CreateOpen; body?: { path: string } | { text: string } };
	fm: Record<string, unknown>;
	changes: FieldChange[];
	/** where it moves to (and its new name), when a step moves or renames it */
	move?: NoteMove;
}

export interface RunResult {
	/** the note's frontmatter after the steps (unchanged when there's an error) */
	fm: Record<string, unknown>;
	changes: FieldChange[];
	notices: string[];
	/** notes created or changed besides this one, in the order the steps reached them */
	others: OtherNote[];
	/** workflows "Run another workflow" ran (names) */
	via: string[];
	/** where this note moves to (and its new name) */
	move?: NoteMove;
	/** the confirmations asked and answered Yes (or taken as Yes, in a test run) */
	asked: string[];
	/** the questions asked ("Ask a question") and their answers (the default answers, in a test run) */
	inputs: { question: string; answer: string }[];
	/**
	 * Something not answered yet: the run stopped there, and runs again once it's answered (a confirmation Yes; a
	 * question, with `input`, its answer: the default answer to offer, and whether it takes several lines).
	 */
	pending?: { step: string; text: string; input?: { default: string; multiline: boolean } };
	/** the step that failed ("2", or "2.0" inside it: see stepLabel), and why: nothing is written */
	error?: { step: string; message: string };
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
export function renderTemplate(src: string, row: ViewRow, def: ViewDef, env: Pick<StepEnv, "ctx" | "old"> & { vars?: Record<string, FValue> }): string {
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
/** A step acting on a note a "Find notes" step didn't find: the step is skipped. */
class SkipStep extends Error {}
/** Something not answered yet ("Confirm", "Ask a question"): the run stops there, to run again once it's answered. */
class AskFirst extends Error {
	constructor(
		readonly step: string,
		readonly text: string,
		readonly input?: { default: string; multiline: boolean },
	) {
		super(text);
	}
}

/** A folder from a template: slashes tidied, each part made safe ("" is the vault root). */
export function folderPath(raw: string): string {
	return joinPath(...raw.split(/[\\/]+/).map((p) => p.replace(/[:*?"<>|]/g, "").trim()));
}

/** A note a run is working on: this one, one a step created, or another it changes (a linked note, an existing one). */
interface RunNote {
	path: string;
	row: ViewRow;
	start: Record<string, unknown>;
	fm: Record<string, unknown>;
	created?: OtherNote["created"];
	move?: NoteMove;
}

/** Where steps run: the workflow (its note, columns), the note formulas read, a loop's note, and the names in use. */
interface Frame {
	wf: WorkflowDef;
	/** the workflow's note ("This note") */
	main: RunNote;
	/** the note formulas read: the workflow's, or each note in a loop of notes */
	reader: RunNote;
	def: ViewDef;
	/** the types of the note steps act on by default (the workflow's; a loop's notes') */
	scope: string[];
	/** in a loop of notes: the note steps act on by default */
	item?: RunNote;
	vars: Record<string, FValue>;
	/** variables ("Set a variable"): one object for the whole run of this workflow, so loops' changes last */
	globals: Record<string, FValue>;
	/** the notes "Find notes" steps found first, by name (null: it found none), for "On"; whole-run, like `globals` */
	found: Map<string, RunNote | null>;
	/** notes by the names steps give them ("On") */
	named: Map<string, RunNote>;
	old?: ViewRow;
	depth: number;
	/** workflows running, outermost first (a workflow can't run itself) */
	stack: string[];
	/** inside a loop (of notes or of values) */
	inLoop?: true;
}

/**
 * Run a workflow's steps on copies of the notes' frontmatter, in order (each sees the ones before). "Create a note"
 * plans new notes (placed by `env.place`); loops go through linked notes or a list; "Run another workflow" runs that
 * workflow's steps on a note in the same run. Every note is collected once, so the engine writes each once. A step
 * that fails stops the run: the result has the error, the frontmatter as it was and no other notes.
 */
export function runSteps(wf: WorkflowDef, env: StepEnv): RunResult {
	// Once for a whole selection: no "this note" (a stand-in with no path or fields), the selection as [Selected notes].
	const noMain = !!env.selection;
	const mainRow: ViewRow = noMain ? { ...env.row, path: "", name: "", status: null, subtitle: null, tags: [], aliases: [], folder: "", frontmatter: {} } : env.row;
	const start = copy(mainRow.frontmatter);
	const notices: string[] = [];
	const asked: string[] = [];
	const inputs: RunResult["inputs"] = [];
	/** the workflow's own step running ("2", "2.0"…): a step's error, or its question, is reported there */
	let at = "0";
	const via: string[] = [];
	const main: RunNote = { path: mainRow.path, row: mainRow, start, fm: copy(mainRow.frontmatter) };
	const notes = new Map<string, RunNote>(noMain ? [] : [[main.path, main]]);
	const order: RunNote[] = [];
	const taken = new Set<string>();
	let items = 0;
	const byName = (lp: string) => [...notes.values()].find((n) => n.path === lp || n.path === `${lp}.md` || n.row.name.toLowerCase() === lp.toLowerCase())?.path ?? null;
	// Formulas see the notes this run changes and makes (prop([New session], "Date")) as they are so far.
	const ctx: ViewContext = { ...env.ctx, row: (p) => notes.get(p)?.row ?? env.ctx.row(p), resolve: (lp, src) => env.ctx.resolve(lp, src) ?? byName(lp) };
	const noteAt = (path: string): RunNote | null => {
		const have = notes.get(path);
		if (have) return have;
		const r = env.ctx.row(path);
		if (!r) return null;
		const n: RunNote = { path, row: r, start: copy(r.frontmatter), fm: copy(r.frontmatter) };
		notes.set(path, n);
		order.push(n);
		return n;
	};
	const linkOf = (n: RunNote): LinkValue => ({ path: n.path, linktext: env.linkText(n.path), name: n.row.name });
	const sync = (n: RunNote) => (n.row = withFrontmatter(n.row, n.fm));
	const allFields = workflowFields({ scope: [] }, ctx.types);
	/** The names formulas can use here: variables, then created notes and loop items. */
	const varsOf = (f: Frame): Record<string, FValue> => ({ ...f.globals, ...f.vars });
	/** A workflow's variables, all empty until a step sets them (one that doesn't run leaves its variable empty). */
	/** A workflow's notes found first: none until its Find notes step runs. */
	const foundOf = (w: WorkflowDef) => new Map<string, RunNote | null>(flatSteps(w.steps).flatMap((s) => (s.kind === "find" && s.keep === "first" && s.as.trim() ? [[s.as.trim(), null] as const] : [])));
	const globalsOf = (w: WorkflowDef): Record<string, FValue> =>
		Object.fromEntries(
			flatSteps(w.steps).flatMap((s) =>
				(s.kind === "var" || s.kind === "input") && (s.kind === "var" ? s.name : s.as).trim()
					? [[(s.kind === "var" ? s.name : s.as).trim(), null as FValue] as const]
					: s.kind === "find" && s.as.trim()
						? [[s.as.trim(), [] as FValue] as const]
						: [],
			),
		);
	const evalIn = (f: Frame, src: string) => evaluateFormula(src, f.reader.row, f.def, ctx, { workflow: true, old: f.reader === f.main ? f.old : undefined, vars: varsOf(f) });
	/** A picked value or formula, as the note's field stores it (the note's own type's definition of the field). */
	const valueFor = (f: Frame, wfield: WorkflowField, n: RunNote, fixed: FixedValue | undefined, formula: string): unknown => {
		const own = n.row.type.fields.find((x) => x.key === wfield.key);
		const target = own ? { ...wfield, kind: own.kind, field: own } : wfield;
		const r = storedValue(target, fixed !== undefined ? fixedToValue(fixed, target.kind, n.row, ctx) : evalIn(f, formula), n.row, ctx, env.linkText);
		if ("error" in r) throw new Error(r.error);
		return r.value;
	};
	const addLink = (n: RunNote, fd: FieldDef, path: string) => {
		applyChange(n.fm, { op: "add-link", key: fd.key, linktext: env.linkText(path), multiple: isListValued(fd), labelled: !!fd.labelled });
		sync(n);
	};
	/** The note a step acts on (null: one a Find notes step didn't find). */
	const noteFor = (f: Frame, on: string | undefined): RunNote | null => {
		const n = on === undefined ? (f.item ?? f.main) : on === ON_THIS ? f.main : (f.named.get(on) ?? f.found.get(on));
		if (n === null) return null;
		if (!n) throw new Error(`No earlier step created “${on}”.`);
		if (noMain && n === main) throw new Error(NO_NOTE);
		return n;
	};
	const targetOf = (f: Frame, on: string | undefined): RunNote => {
		const n = noteFor(f, on);
		if (!n) throw new SkipStep();
		return n;
	};
	/** The notes a link value points at (paths), including notes this run made. */
	const linkedPaths = (raw: unknown, from: string): string[] =>
		asArray(raw).flatMap((v) => {
			const s = typeof v === "string" ? v : isObj(v) && typeof v.target === "string" ? v.target : String(v ?? "");
			const lp = (parseLink(s)?.path ?? s).trim();
			const p = lp ? ctx.resolve(lp, from) : null;
			return p ? [p] : [];
		});
	const passes = (when: FilterGroup, n: RunNote, f: Frame) => !when.items.length || runView(withThisNote({ ...emptyView([n.row.type.key]), filters: when }, f.main.path), [n.row], ctx).rows.length > 0;
	const loopFrame = (f: Frame, s: LoopStep, n: RunNote, def: ViewDef, scope: string[]): Frame => {
		const as = s.as.trim() || "Item";
		// The note goes by its name too, so loops inside can act on it ("On").
		const named = new Map(f.named).set(as, n);
		return { ...f, item: n, reader: n, def, scope, vars: { ...f.vars, [THIS_NOTE_VAR]: linkOf(f.main), [as]: linkOf(n) }, named, inLoop: true };
	};
	const count = (as: string) => {
		if (++items > MAX_LOOP_ITEMS) throw new Error(`More than ${MAX_LOOP_ITEMS} items in the loops (“${as}”): stopped.`);
	};

	/** Run a list of steps; `key`: the place of the list's first step in this workflow (none in another one it runs). */
	const exec = (steps: WorkflowStep[], f: Frame, keyOf?: (i: number) => string) => {
		steps.forEach((s, i) => {
			const key = keyOf?.(i);
			if (key !== undefined) at = key;
			try {
				step(s, f, key);
			} catch (e) {
				if (!(e instanceof SkipStep)) throw e;
			}
		});
	};
	/** Run a step's blocks of steps (a loop's, for one item). */
	const execBlock = (s: WorkflowStep, block: number, f: Frame, key: string | undefined) => {
		const o = blockOffset(s, block);
		exec(stepBlocks(s)[block], f, key === undefined ? undefined : (j) => `${key}.${o + j}`);
		// Back at the step itself (its next item, say).
		if (key !== undefined) at = key;
	};
	const step = (s: WorkflowStep, f: Frame, key: string | undefined) => {
		switch (s.kind) {
			case "set":
			case "clear": {
				const note = targetOf(f, s.on);
				const wfield = s.field === COMMON_KEYS.status ? { key: s.field, label: "Status", kind: "status" as const } : allFields.find((x) => x.key === s.field);
				if (!wfield) throw new Error(`None of the types has a “${s.field}” field.`);
				// Fields the note's type doesn't have are left alone (a workflow for several types).
				if (wfield.key !== COMMON_KEYS.status && !note.row.type.fields.some((x) => x.key === wfield.key)) return;
				applyChange(note.fm, { op: "set", key: wfield.key, value: s.kind === "clear" ? null : valueFor(f, wfield, note, s.fixed, s.value) });
				sync(note);
				return;
			}
			case "tag": {
				const note = targetOf(f, s.on);
				applyChange(note.fm, { op: s.op === "add" ? "add-tags" : "remove-tags", tags: [s.tag.trim().replace(/^#/, "")] });
				sync(note);
				return;
			}
			case "link": {
				const note = targetOf(f, s.on);
				const fd = note.row.type.fields.find((x) => x.key === s.field);
				if (!fd) return;
				if (fd.kind !== "relation") throw new Error(`${fd.label} isn't a link field.`);
				const { paths, unknown } = targetPaths(s.fixed !== undefined ? fixedToValue(s.fixed, "relation", note.row, ctx) : evalIn(f, s.target), note.row, ctx);
				if (s.op === "add" && unknown.length) throw new Error(`No note called “${unknown[0]}”.`);
				for (const p of paths)
					applyChange(
						note.fm,
						s.op === "add"
							? { op: "add-link", key: fd.key, linktext: env.linkText(p), multiple: isListValued(fd), labelled: !!fd.labelled }
							: { op: "remove-link", key: fd.key, matches: (lp) => ctx.resolve(lp, note.path) === p },
					);
				sync(note);
				return;
			}
			case "notice":
				notices.push(renderTemplate(s.text, f.reader.row, f.def, { ctx, old: f.reader === f.main ? f.old : undefined, vars: varsOf(f) }));
				return;
			case "var":
				f.globals[s.name.trim()] = evalIn(f, s.value);
				return;
			case "find": {
				const as = s.as.trim();
				// Sorted by name unless it says: "the first" is then the same each time.
				const def: ViewDef = { ...workflowDef({ scope: s.types, when: s.when }), sort: [s.sort ?? { by: "name", dir: "asc" }] };
				// Every note as this run has it so far: changed ones as they are now, created ones too.
				const pool = new Map<string, ViewRow>();
				for (const r of env.rows ?? []) pool.set(r.path, notes.get(r.path)?.row ?? r);
				for (const n of notes.values()) if (n.created) pool.set(n.path, n.row);
				const rows = runView(withThisNote(def, noMain ? null : f.main.path), [...pool.values()], ctx).rows.map((r) => r.row);
				const kept = rows.slice(0, s.keep === "first" ? 1 : (s.limit ?? rows.length));
				f.globals[as] = kept.map((r): LinkValue => ({ path: r.path, linktext: env.linkText(r.path), name: r.name }));
				if (s.keep === "first") f.found.set(as, kept[0] ? noteAt(kept[0].path) : null);
				return;
			}
			case "if": {
				// Conditions on a note Find notes didn't find: not true.
				const n = s.test === "filter" ? noteFor(f, s.on) : null;
				const yes = s.test === "formula" ? truthy(evalIn(f, s.formula)) : !!n && passes(s.when, n, f);
				// Notes created inside are for the steps after them inside, as in loops.
				execBlock(s, yes ? 0 : 1, { ...f, vars: { ...f.vars }, named: new Map(f.named) }, key);
				return;
			}
			case "ask": {
				if (f.inLoop) throw new Error("It can't confirm inside a loop.");
				if (f.depth > 0) throw new Error(`“${f.wf.name}” stops to ask you something, so it can't be run from another workflow.`);
				const text = renderTemplate(s.text, f.reader.row, f.def, { ctx, old: f.old, vars: varsOf(f) }).trim() || "Carry on?";
				if (env.answers !== "all" && !env.answers?.has(key ?? at)) throw new AskFirst(key ?? at, text);
				asked.push(text);
				return;
			}
			case "input": {
				if (f.inLoop) throw new Error("It can't ask a question inside a loop.");
				if (f.depth > 0) throw new Error(`“${f.wf.name}” stops to ask you something, so it can't be run from another workflow.`);
				const tx = (src: string) => renderTemplate(src, f.reader.row, f.def, { ctx, old: f.old, vars: varsOf(f) });
				const question = tx(s.text).trim() || "Your answer?";
				const k = key ?? at;
				let answer = env.inputs?.get(k);
				if (answer === undefined) {
					const def = s.default?.trim() ? tx(s.default) : "";
					// A test run takes the default answer.
					if (env.answers !== "all") throw new AskFirst(k, question, { default: def, multiline: !!s.multiline });
					answer = def;
				}
				f.globals[s.as.trim()] = answer;
				inputs.push({ question, answer });
				return;
			}
			case "move":
			case "rename": {
				const note = targetOf(f, s.on);
				if (note.created) throw new Error("A note this workflow creates is named and placed by its Create a note step.");
				const text = (src: string) => renderTemplate(src, f.reader.row, f.def, { ctx, old: f.reader === f.main ? f.old : undefined, vars: varsOf(f) });
				if (s.kind === "rename") {
					const name = text(s.name).trim();
					if (!name) throw new Error("The new name is empty.");
					note.move = { ...note.move, name };
				} else if (s.to === "type") note.move = { ...(note.move?.name !== undefined ? { name: note.move.name } : {}), byType: true };
				else note.move = { ...(note.move?.name !== undefined ? { name: note.move.name } : {}), folder: folderPath(text(s.folder)) };
				return;
			}
			case "create": {
				if (!env.place) throw new Error("Notes can't be created here.");
				const plain = s.type === PLAIN_NOTE;
				const type = plain ? PLAIN_TYPE : ctx.types.find((x) => x.key === s.type);
				if (!type) throw new Error(`“${s.type}” isn't a type.`);
				const base = f.item ?? f.main;
				const link = plain ? undefined : s.link;
				if (link && noMain && base === main) throw new Error("There's no single note to link the new note to.");
				const text = (src: string) => renderTemplate(src, f.reader.row, f.def, { ctx, old: f.reader === f.main ? f.old : undefined, vars: varsOf(f) });
				const name = (s.name.trim() ? text(s.name) : "").trim() || `New ${type.name.toLowerCase()}`;
				const fm: Record<string, unknown> = {};
				const draft: RunNote = { path: "", row: { path: "", name, type, status: null, subtitle: null, tags: [], aliases: [], folder: "", mtime: 0, order: null, frontmatter: fm }, start: {}, fm };
				const nf = workflowFields({ scope: [type.key] }, ctx.types);
				for (const r of plain ? [] : s.fields) {
					const wfield = nf.find((x) => x.key === r.field);
					if (!wfield) throw new Error(`${type.name} has no “${r.field}” field.`);
					fm[wfield.key] = valueFor(f, wfield, draft, r.fixed, r.value);
					sync(draft);
				}
				const fromNew = link?.dir === "from-new" ? type.fields.find((x) => x.key === link.field && x.kind === "relation") : undefined;
				if (fromNew) addLink(draft, fromNew, base.path);
				const dest = s.folder?.trim() ? text(s.folder).trim() : "";
				const placed = env.place({ type, name, fm, exists: s.exists, taken, ...(plain ? { plain: { folder: dest === "/" ? "/" : folderPath(dest) } } : {}) });
				if ("stop" in placed) throw new StopRun(placed.stop);
				let made: RunNote;
				if (placed.existing) {
					// "Use the existing one": no new note; its link is still made, its fields left as they are.
					made = noteAt(placed.path) ?? { path: placed.path, row: placed.existing, start: copy(placed.existing.frontmatter), fm: copy(placed.existing.frontmatter) };
					if (fromNew) addLink(made, fromNew, base.path);
				} else {
					taken.add(placed.path.toLowerCase());
					const body = !plain || !s.body ? undefined : s.body.from === "template" ? { path: s.body.path } : { text: text(s.body.text) };
					made = { ...draft, path: placed.path, row: { ...draft.row, path: placed.path, name: baseName(placed.path) }, created: { type: type.key, template: !plain && s.template, open: s.open, ...(body ? { body } : {}) } };
					notes.set(made.path, made);
					order.push(made);
				}
				const as = s.as.trim();
				f.named.set(as, made);
				f.vars[as] = linkOf(made);
				if (link?.dir === "to-new") {
					const fd = base.row.type.fields.find((x) => x.key === link.field && x.kind === "relation");
					if (fd) addLink(base, fd, made.path);
				}
				return;
			}
			case "run": {
				const note = targetOf(f, s.on);
				const sub = env.workflows?.find((w) => w.id === s.workflow);
				if (!sub) throw new Error("The workflow it runs has been deleted.");
				if (f.stack.includes(sub.id)) throw new Error(`“${sub.name}” would run itself.`);
				if (f.depth >= MAX_RUN_DEPTH) throw new Error(`Workflows ran each other more than ${MAX_RUN_DEPTH} deep.`);
				if (!inScope(sub, note.row.type) || !passesWhen(sub, note.row, ctx)) return;
				via.push(sub.name);
				exec(sub.steps, { wf: sub, main: note, reader: note, def: workflowDef(sub), scope: sub.scope, vars: { [THIS_NOTE_VAR]: linkOf(note) }, globals: globalsOf(sub), found: foundOf(sub), named: new Map(), depth: f.depth + 1, stack: [...f.stack, sub.id] });
				return;
			}
			case "linked": {
				if (noMain && f.item === undefined) throw new Error("For linked notes starts from a note: use For each over [Selected notes] instead.");
				// From the note steps act on here: the workflow's, or a loop's.
				const base = f.item ?? f.main;
				const scope = keysOf(loopItemTypes(s, f.scope, ctx.types), ctx.types);
				const def = workflowDef({ scope, when: s.when });
				let paths: string[];
				const so = s.source;
				if (so.dir === "out") paths = linkedPaths(base.fm[so.field], base.path);
				else {
					// Notes of the type whose field links here: the index's, and notes this run has changed or made.
					const cands = new Set([...env.ctx.incoming(base.path).filter((l) => l.sourceType === so.type && l.fieldKey === so.field).map((l) => l.source), ...[...notes.values()].filter((n) => n.row.type.key === so.type).map((n) => n.path)]);
					paths = [...cands].filter((p) => {
						const n = notes.get(p) ?? env.ctx.row(p);
						const fm = n ? ("fm" in n ? n.fm : n.frontmatter) : undefined;
						return !!fm && linkedPaths(fm[so.field], p).includes(base.path);
					});
				}
				for (const p of [...new Set(paths)].sort()) {
					const n = noteAt(p);
					if (!n || n === base || !passes(s.when, n, f)) continue;
					count(s.as);
					execBlock(s, 0, loopFrame(f, s, n, def, scope), key);
				}
				return;
			}
			case "each": {
				const v = evalIn(f, s.formula);
				if (s.items === "values") {
					const as = s.as.trim() || "Item";
					for (const x of asArray(v) as FValue[]) {
						if (x === null || x === "") continue;
						count(as);
						execBlock(s, 0, { ...f, vars: { ...f.vars, [as]: x }, named: new Map(f.named), inLoop: true }, key);
					}
					return;
				}
				const scope = keysOf(loopItemTypes(s, f.scope, ctx.types), ctx.types);
				const def = workflowDef({ scope, when: s.when });
				const { paths, unknown } = targetPaths(v, f.reader.row, ctx);
				if (unknown.length) throw new Error(`No note called “${unknown[0]}”.`);
				for (const p of paths) {
					const n = noteAt(p);
					if (!n || (s.itemType && n.row.type.key !== s.itemType) || !passes(s.when, n, f)) continue;
					count(s.as);
					execBlock(s, 0, loopFrame(f, s, n, def, scope), key);
				}
				return;
			}
		}
	};

	// [Selected notes] in a run for the whole selection; else [This note], the note it runs on.
	const selected: Record<string, FValue> = env.selection ? { [SELECTION_VAR]: env.selection.map((r): LinkValue => ({ path: r.path, linktext: env.linkText(r.path), name: r.name })) } : { [THIS_NOTE_VAR]: linkOf(main) };
	const top: Frame = { wf, main, reader: main, def: workflowDef(wf), scope: wf.scope, vars: selected, globals: globalsOf(wf), found: foundOf(wf), named: new Map(), old: env.old, depth: 0, stack: [wf.id] };
	try {
		exec(wf.steps, top, String);
	} catch (e) {
		const none = { fm: start, changes: [], notices: [], others: [], via: [], asked, inputs };
		if (e instanceof AskFirst) return { ...none, pending: { step: e.step, text: e.text, ...(e.input ? { input: e.input } : {}) } };
		if (e instanceof StopRun) return { ...none, stopped: e.message };
		return { ...none, error: { step: at, message: e instanceof Error ? e.message : String(e) } };
	}
	return {
		fm: main.fm,
		changes: diffOf(start, main.fm),
		notices,
		via: [...new Set(via)],
		...(main.move ? { move: main.move } : {}),
		asked,
		inputs,
		others: order
			.map((n): OtherNote => ({ path: n.path, name: n.row.name, ...(n.created ? { created: n.created } : {}), fm: n.fm, changes: diffOf(n.start, n.fm), ...(n.move ? { move: n.move } : {}) }))
			.filter((o) => o.created || o.changes.length || o.move),
	};
}
/** How many notes a run would write: existing notes it changes or moves (its own included) and notes it creates. */
export function runReach(res: Pick<RunResult, "changes" | "others" | "move">): { changed: number; created: number } {
	const created = res.others.filter((o) => o.created).length;
	return { changed: (res.changes.length || res.move ? 1 : 0) + res.others.filter((o) => !o.created && (o.changes.length || o.move)).length, created };
}

/** A run that would write more than BIG_RUN notes asks first. */
export const isBigRun = (reach: { changed: number; created: number }): boolean => reach.changed + reach.created > BIG_RUN;

/** "change 24 notes and create 3", "create a note", "make no changes". */
export function reachText({ changed, created }: { changed: number; created: number }): string {
	const n = (k: number) => (k === 1 ? "a note" : `${k} notes`);
	const parts = [...(changed ? [`change ${n(changed)}`] : []), ...(created ? [`create ${n(created)}`] : [])];
	return parts.length ? parts.join(" and ") : "make no changes";
}

// ---------------------------------------------------------------- in words

/** A move in words: "renamed to X" (same folder), "moved to Archive" (same name), else "moved to Archive/X". */
export function movedText(from: string, to: string): string {
	const split = (p: string) => {
		const i = p.lastIndexOf("/");
		return { folder: i < 0 ? "" : p.slice(0, i), name: p.slice(i + 1).replace(/\.md$/, "") };
	};
	const a = split(from);
	const b = split(to);
	if (a.folder === b.folder) return `renamed to ${b.name}`;
	if (a.name === b.name) return `moved to ${b.folder || "the vault's top folder"}`;
	return `moved to ${to.replace(/\.md$/, "")}`;
}

const quoted =  (vs: string[]) => vs.map((v) => `“${v}”`).join(" or ");

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
			return `Button: ${t.label || wf.name}${t.selection === "once" ? " (once for the selection)" : ""}`;
		case "schedule": {
			if (t.every === "hours") return t.hours === 1 ? "Every hour" : `Every ${t.hours} hours`;
			return t.every === "day" ? `Every day at ${t.at}` : `Every ${WEEKDAYS[t.day] ?? "week"} at ${t.at}`;
		}
		case "date": {
			const label = fieldLabel(t.field, types);
			const n = Math.abs(t.offset);
			const days = `${n} day${n === 1 ? "" : "s"}`;
			return `${t.offset === 0 ? `When ${label} is today` : t.offset < 0 ? `${days} before ${label}` : `${days} after ${label}`}, at ${t.at}`;
		}
	}
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
