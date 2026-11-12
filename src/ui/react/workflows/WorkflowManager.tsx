import { Menu, Notice } from "obsidian";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { statusUnion } from "../../../model/bulk";
import { statusColorAmong, type ColorMap } from "../../../model/colors";
import { todayDays } from "../../../model/formConditions";
import { cloneType, COMMON_KEYS, isListValued, typeMatchesTarget, type EntityTypeDef, type GroupDef } from "../../../model/types";
import { availableColumns, compileFormula, resolveColumn, type ColumnDef, type VarSpec, type ViewDef, type ViewRow } from "../../../model/views";
import {
	cloneWorkflow,
	createLinkOptions,
	defaultFixed,
	fixedFromFormula,
	newCreateStep,
	stepScopes,
	stepTarget,
	flatSteps,
	blockOffset,
	mapStepAt,
	stepBlocks,
	stepLabel,
	stepAt,
	varGroups,
	templatePartAt,
	withBlocks,
	inScope,
	isLoop,
	linkedSources,
	loopItemTypes,
	ON_THIS,
	PLAIN_NOTE,
	formulaFromFixed,
	readsNote,
	runsOnce,
	SELECTION_VAR,
	listsValues,
	isTimed,
	nextDue,
	DEFAULT_AT,
	DEFAULT_LIMIT,
	WEEKDAYS,
	type DateTrigger,
	type ScheduleTrigger,
	movedText,
	needsScope,
	newWorkflow,
	parseTemplate,
	scopeTypes,
	STEP_LABELS,
	triggerText,
	workflowDef,
	workflowFields,
	workflowProblems,
	renameRefs,
	NO_NOTE_FORMULA_FORM,
	buttonIcon,
	buttonLabel,
	formTypeIssues,
	formType,
	noteless,
	type FormTrigger,
	type CreateField,
	type CreateLink,
	type FixedValue,
	type LinkedSource,
	type LoopStep,
	type IfStep,
	type FindStep,
	type StepScope,
	type StepKind,
	type TriggerKind,
	type WorkflowDef,
	type WorkflowField,
	type WorkflowProblem,
	type WorkflowStep,
} from "../../../model/workflows";
import type { RunRecord } from "../../../services/workflows";
import { usePlugin } from "../context";
import { Icon } from "../Icon";
import { FormulaModal } from "../../modals/formulaModal";
import { ChoiceControl } from "../EntityForm";
import { DateBox, FiltersPanel, LinkValues, type ColumnChoice } from "../table/popovers";
import { ConfirmModal, SaveActions } from "../types/TypeManager";
import { IconPicker, Row, Section, Segmented, TargetPicker, TextInput, Toggle, type SectionCollapse } from "../types/controls";
import { EditorContext, type EditorApi } from "../types/editor";
import { FieldsTab } from "../types/FieldsTab";
import { LayoutTab } from "../types/LayoutTab";
import { newUid, type FieldMeta, type SampleNote, type TypeDraft } from "../../../model/typeEditing";
import { openTryRun } from "./TryRun";
import type { FormPreviewSource } from "./FormPreview";
import { FolderPickerModal, NotePathPickerModal } from "../../modals/bulkModals";

/** The workflow editor's tabs: the workflow itself, a form's fields and layout ("Fill in a form"), and its recent runs. */
export type WorkflowTab = "edit" | "fields" | "layout" | "runs";

/**
 * The type editor's context for a workflow's form: its fields and layout as a type (`formType`), so the type editor's
 * Fields and Layout tabs edit it (in form mode). Null when the workflow isn't a form. Edits go to the workflow's draft,
 * one after another (several in one event build on each other).
 */
function useFormEditor(wf: WorkflowDef, setDraft: (wf: WorkflowDef) => void, setTab: (tab: WorkflowTab) => void): EditorApi | null {
	const plugin = usePlugin();
	const settings = plugin.settings;
	const [fieldUid, setFieldUid] = useState<string | null>(null);
	const latest = useRef(wf);
	latest.current = wf;
	const meta = useRef<FieldMeta[]>([]);
	/** each field's last label (by its bookkeeping id), so steps follow a renamed answer even through an empty label */
	const labels = useRef(new Map<string, string>());
	const t = wf.trigger.kind === "form" ? wf.trigger : null;
	const issues = useMemo(() => (t ? formTypeIssues(t, settings) : []), [t, settings.types, settings.groups]); // eslint-disable-line react-hooks/exhaustive-deps
	const sample: SampleNote = useMemo(() => ({ path: null, name: t?.title || "the form", status: "", frontmatter: {}, fromNote: false }), [t?.title]);
	if (!t) return null;
	// One bookkeeping entry per field (stable ids for the list and selection).
	if (meta.current.length !== t.fields.length) meta.current = t.fields.map((_, i) => meta.current[i] ?? { uid: newUid(), origKey: null });
	meta.current.forEach((m, i) => {
		const label = t.fields[i]?.label.trim();
		if (label && !labels.current.has(m.uid)) labels.current.set(m.uid, label);
	});
	const draft: TypeDraft = { type: formType(t), original: null, meta: meta.current };
	const update = (fn: (type: EntityTypeDef, meta: FieldMeta[]) => void) => {
		const cur = latest.current;
		if (cur.trigger.kind !== "form") return;
		const type = cloneType(formType(cur.trigger));
		const m = meta.current.map((x) => ({ ...x }));
		fn(type, m);
		meta.current = m;
		const next = cloneWorkflow(cur);
		const tr = next.trigger as FormTrigger;
		tr.fields = type.fields;
		if (type.form?.layout) tr.layout = type.form.layout;
		else delete tr.layout;
		// A field's new label: the steps' references to its answer follow ([Summary] → [What happened]).
		m.forEach((x, i) => {
			const label = type.fields[i]?.label.trim();
			if (!label) return;
			const was = labels.current.get(x.uid);
			if (was && was !== label) next.steps = renameRefs(next.steps, was, label);
			labels.current.set(x.uid, label);
		});
		latest.current = next;
		setDraft(next);
	};
	return {
		draft,
		update,
		issues,
		issuesAt: (at) => issues.filter((i) => i.at === at),
		allTypes: settings.types,
		groups: settings.groups,
		openType: (key) => void plugin.activateTypes(key),
		openGroup: () => void plugin.activateTypes(),
		fieldUid,
		setFieldUid,
		setTab: (tab) => setTab(tab === "layout" ? "layout" : "fields"),
		noteCount: 0,
		sample,
		form: true,
		historyId: `workflow-form:${wf.id}`,
	};
}

export interface WorkflowsState {
	/** a workflow id, "new:<n>" for an unsaved one, "runs" for Recent runs, or null */
	selected: string | null;
	/** the editor's tab (kept when another workflow is picked) */
	tab: WorkflowTab;
}
export const DEFAULT_WORKFLOWS_STATE: WorkflowsState = { selected: null, tab: "edit" };

/**
 * A request to open the view on something: a workflow (on a tab), a new one for a type, or a new one for no type yet
 * (`blank`).
 */
export interface WorkflowsRequest {
	open?: string;
	tab?: WorkflowTab;
	newFor?: string;
	blank?: boolean;
}

const TRIGGER_OPTIONS: { value: TriggerKind; label: string; icon: string }[] = [
	{ value: "changed", label: "Field changes", icon: "pencil" },
	{ value: "created", label: "Note created", icon: "file-plus" },
	{ value: "manual", label: "Run on notes", icon: "mouse-pointer-click" },
	{ value: "form", label: "Form", icon: "clipboard-list" },
	{ value: "schedule", label: "Schedule", icon: "clock" },
	{ value: "date", label: "Date reached", icon: "calendar-clock" },
];
const STEP_ICONS: Record<StepKind, string> = {
	set: "pencil-line",
	clear: "eraser",
	tag: "tag",
	link: "link",
	notice: "message-square",
	move: "folder-input",
	rename: "text-cursor-input",
	append: "file-text",
	create: "file-plus",
	linked: "git-fork",
	each: "repeat",
	run: "play",
	ask: "circle-check",
	input: "message-circle-question",
	var: "variable",
	if: "split",
	find: "search",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The workflow editor's folded sections (local storage: this device). */
const FOLD_KEY = "obs-entities-workflow-folded";
/** The problems each foldable section of the editor holds (by where they're reported), by its key. */
const SECTION_ATS: Record<string, (at: string) => boolean> = {
	when: (a) => a === "trigger",
	"only-if": (a) => a === "when",
	do: (a) => a === "steps" || a.startsWith("step:"),
};
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const when = (t: number) => {
	const d = new Date(t);
	const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
};
const valueText = (v: unknown) => (v === undefined || v === null || v === "" ? "empty" : Array.isArray(v) ? (v.length ? v.join(", ") : "empty") : String(v));

/**
 * The Workflows view (DESIGN §8.11): the workflow open in an editor (When / Only if / Do) with the type editor's draft
 * and save bar, or every workflow's Recent runs. The Entity Browser lists the workflows (by what starts them), with
 * Recent runs and Disable all.
 */
export function WorkflowManager({
	state,
	setState,
	request,
	onRequestDone,
	onPreview,
}: {
	state: WorkflowsState;
	setState: (p: Partial<WorkflowsState>) => void;
	request: WorkflowsRequest | null;
	onRequestDone: () => void;
	/** the side panel's preview of the open form workflow's form */
	onPreview?: (source: FormPreviewSource) => void;
}) {
	const plugin = usePlugin();
	const settings = plugin.settings;
	const [, setTick] = useState(0);
	const drafts = plugin.workflowDrafts;
	const rerender = () => setTick((t) => t + 1);
	/** After a draft changes: here, and in the Entity Browser (new, unsaved changes). */
	const refresh = () => {
		rerender();
		plugin.workflows.trigger("drafts");
	};
	useEffect(() => {
		const refs = [plugin.workflows.on("log", rerender), plugin.workflows.on("drafts", rerender)];
		return () => refs.forEach((r) => plugin.workflows.offref(r));
	}, [plugin]);

	const newDraft = (scope: string[] = []) => {
		let n = 1;
		while (drafts.has(`new:${n}`)) n++;
		const id = `new:${n}`;
		drafts.set(id, { ...newWorkflow(scope), name: "" });
		setState({ selected: id });
		refresh();
	};
	useEffect(() => {
		if (!request) return;
		if (request.newFor) newDraft([request.newFor]);
		else if (request.blank) newDraft();
		else if (request.open) setState({ selected: request.open, ...(request.tab ? { tab: request.tab } : {}) });
		onRequestDone();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [request]);

	const saved = settings.workflows;
	const listed: { id: string; wf: WorkflowDef; isNew: boolean }[] = [
		...saved.map((w) => ({ id: w.id, wf: drafts.get(w.id) ?? w, isNew: false })),
		...[...drafts.entries()].filter(([id]) => id.startsWith("new:")).map(([id, wf]) => ({ id, wf, isNew: true })),
	];
	const selected = listed.find((x) => x.id === state.selected);
	// No form workflow open: nothing to preview (an open one publishes its own).
	useEffect(() => {
		if (!selected || state.selected === "runs") onPreview?.({ api: null });
	});

	return (
		<div className="oe-tm oe-wf">
			{state.selected === "runs" ? (
				<main className="oe-tm-main">
					<header className="oe-tm-header">
						<div className="oe-tm-title">
							<span className="oe-type-icon oe-type-icon-xl">
								<Icon name="history" />
							</span>
							<div>
								<h1>Recent runs</h1>
								<div className="oe-tm-muted">The last {plural(plugin.workflows.log.length, "run")} of every workflow, newest first.</div>
							</div>
						</div>
					</header>
					<div className="oe-tm-body">
						<RunList runs={plugin.workflows.log} showWorkflow />
					</div>
				</main>
			) : selected ? (
				<WorkflowEditor
					key={selected.id}
					id={selected.id}
					wf={selected.wf}
					isNew={selected.isNew}
					saved={saved.find((w) => w.id === selected.id) ?? null}
					setDraft={(wf) => {
						drafts.set(selected.id, wf);
						refresh();
					}}
					onSaved={(id) => {
						drafts.delete(selected.id);
						setState({ selected: id });
						refresh();
					}}
					onDiscarded={() => {
						drafts.delete(selected.id);
						if (selected.isNew) setState({ selected: null });
						refresh();
					}}
					onDeleted={() => {
						drafts.delete(selected.id);
						setState({ selected: null });
					}}
					onDuplicate={(copy) => {
						let n = 1;
						while (drafts.has(`new:${n}`)) n++;
						drafts.set(`new:${n}`, copy);
						setState({ selected: `new:${n}` });
					}}
					tab={state.tab}
					setTab={(tab) => setState({ tab })}
					onPreview={onPreview}
				/>
			) : (
				<main className="oe-tm-main oe-tm-empty">
					<div className="oe-wf-intro">
						<Icon name="zap" />
						<h2>Workflows</h2>
						<p>Do things automatically when a note is created or a field changes, or add buttons that run steps on notes: set fields, add tags and links, show a notice.</p>
						<p className="oe-tm-muted">Your workflows are in the Entity Browser, under Workflows: click one to open it here.</p>
						<button className="mod-cta" onClick={() => newDraft()}>
							<Icon name="plus" /> New workflow
						</button>
					</div>
				</main>
			)}
		</div>
	);
}

/** Columns a filter over a definition's notes can use (Only if): name, fields, built-ins, incoming links. */
function columnChoices(def: ViewDef, lookup: { types: EntityTypeDef[]; groups: GroupDef[] }): ColumnChoice[] {
	const a = availableColumns(def, lookup);
	const out: ColumnChoice[] = [];
	const add = (list: ColumnDef[], group: string) => {
		for (const c of list) out.push({ col: resolveColumn(c, def, lookup), group });
	};
	add([{ kind: "builtin", id: "name", key: "name" }], "Built-in");
	add(a.fields, "Fields");
	add(a.builtins, "Built-in");
	add(a.incoming, "Incoming links");
	return out;
}

/** The values a column has in notes of these types (for a filter's value pickers). */
function columnValues(choices: ColumnChoice[], colId: string, rows: ViewRow[], types: EntityTypeDef[]): string[] {
	const col = choices.find((c) => c.col.id === colId)?.col;
	if (!col) return [];
	const keys = new Set(types.map((x) => x.key));
	const set = new Set<string>();
	for (const r of rows) {
		if (!keys.has(r.type.key)) continue;
		const v = r.frontmatter[col.def.kind === "field" ? col.def.key : col.id];
		for (const x of Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]) set.add(String(x));
	}
	return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * The editor for one workflow: header with on/off, Try and ⋯, and two tabs: Editor (Workflow, When, Only if, Do) and
 * its Recent runs.
 */
function WorkflowEditor({
	id,
	wf,
	isNew,
	saved,
	setDraft,
	onSaved,
	onDiscarded,
	onDeleted,
	onDuplicate,
	tab: wantTab,
	setTab,
	onPreview,
}: {
	id: string;
	wf: WorkflowDef;
	isNew: boolean;
	saved: WorkflowDef | null;
	setDraft: (wf: WorkflowDef) => void;
	onSaved: (id: string) => void;
	onDiscarded: () => void;
	onDeleted: () => void;
	onDuplicate: (copy: WorkflowDef) => void;
	tab: WorkflowTab;
	setTab: (tab: WorkflowTab) => void;
	onPreview?: (source: FormPreviewSource) => void;
}) {
	const plugin = usePlugin();
	const settings = plugin.settings;
	// A new workflow hasn't run: no Recent runs. Only a form has fields and a layout.
	const isForm = wf.trigger.kind === "form";
	const tab: WorkflowTab = (isNew && wantTab === "runs") || (!isForm && (wantTab === "fields" || wantTab === "layout")) ? "edit" : wantTab;
	const lookup = { types: settings.types, groups: settings.groups };
	const dirty = isNew || (!!saved && !sameJson(wf, saved));
	const [attempted, setAttempted] = useState(false);
	const edit = (fn: (x: WorkflowDef) => void) => {
		const next = cloneWorkflow(wf);
		fn(next);
		setDraft(next);
	};
	const problems = workflowProblems(wf, { ...lookup, workflows: settings.workflows });
	const formApi = useFormEditor(wf, setDraft, setTab);
	// The side panel previews a form workflow's form as it's edited.
	useEffect(() => onPreview?.(formApi && wf.trigger.kind === "form" ? { api: formApi, form: { title: wf.trigger.title.trim() || wf.name || "Form", button: wf.trigger.button, icon: buttonIcon(wf) } } : { api: null }));
	// A new workflow isn't nagged about what it hasn't got yet until Save is tried.
	const shownProblems = attempted || !isNew ? problems : problems.filter((p) => p.at !== "name" && p.at !== "steps" && p.at !== "scope");
	const at = (k: string) => shownProblems.filter((p) => p.at === k);
	const fields = workflowFields(wf, settings.types);
	const def = workflowDef(wf);
	const t = wf.trigger;

	const save = async () => {
		// A workflow with problems is saved switched off (it couldn't run anyway): it's switched on once they're fixed.
		const off = problems.length > 0;
		const fin = cloneWorkflow({ ...wf, name: wf.name.trim() || "Untitled workflow", ...(off ? { on: false } : {}) });
		const list = settings.workflows;
		const i = list.findIndex((w) => w.id === fin.id);
		if (i >= 0) list[i] = fin;
		else list.push(fin);
		await plugin.saveSettings();
		if (!off) setAttempted(false);
		onSaved(fin.id);
		new Notice(off ? `Saved “${fin.name}”, switched off: fix ${plural(problems.length, "problem")} to switch it on.` : `Saved “${fin.name}”.`);
	};
	const del = () => {
		if (isNew) return onDiscarded();
		new ConfirmModal(plugin.app, `Delete “${wf.name}”?`, "The workflow stops running. Notes it changed keep their values.", "Delete workflow", async () => {
			settings.workflows = settings.workflows.filter((w) => w.id !== id);
			await plugin.saveSettings();
			onDeleted();
			new Notice(`Deleted “${wf.name}”.`);
		}).open();
	};
	const menu = (e: ReactMouseEvent) => {
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle(noteless(wf) ? "Try it…" : "Try on a note…")
				.setIcon("flask-conical")
				.onClick(() => openTryRun(plugin, wf)),
		);
		m.addItem((i) =>
			i
				.setTitle("Duplicate")
				.setIcon("copy-plus")
				.onClick(() => onDuplicate({ ...cloneWorkflow(wf), id: newWorkflow().id, name: `${wf.name || "Workflow"} copy` })),
		);
		m.addItem((i) => i.setTitle(isNew ? "Discard" : "Delete…").setIcon("trash-2").setWarning(true).onClick(del));
		m.showAtMouseEvent(e.nativeEvent);
	};

	// Columns for Only if, and the scoped notes' values (for value pickers).
	const { rows, ctx } = useMemo(() => plugin.viewData(), [plugin]);
	const scopeKey = JSON.stringify(wf.scope);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const choices: ColumnChoice[] = useMemo(() => columnChoices(def, lookup), [scopeKey, settings.types]);
	const valuesOf = (colId: string) => columnValues(choices, colId, rows, scopeTypes(wf, settings.types));

	const dateFields = fields.filter((f) => f.kind === "date");
	const setTrigger = (kind: TriggerKind) =>
		edit((x) => {
			if (x.trigger.kind === kind) return;
			const keep = isTimed(x.trigger) ? { at: x.trigger.at, limit: x.trigger.limit } : { at: DEFAULT_AT, limit: DEFAULT_LIMIT };
			x.trigger =
				kind === "changed"
					? { kind, field: COMMON_KEYS.status }
					: kind === "created"
						? { kind }
						: kind === "schedule"
							? { kind, every: "day", day: 1, hours: 4, ...keep }
							: kind === "date"
								? { kind, field: dateFields[0]?.key ?? "", offset: 0, ...keep }
								: kind === "form"
									? { kind, title: x.name || "", button: "", fields: [] }
									: { kind, label: x.name || "Run" };
		});
	const watched = t.kind === "changed" ? fields.find((f) => f.key === t.field) : undefined;
	const valueChoices = (f: WorkflowField | undefined): { value: string; label: string }[] => {
		if (!f) return [];
		if (f.kind === "boolean")
			return [
				{ value: "true", label: "Ticked" },
				{ value: "false", label: "Unticked" },
			];
		if (f.kind === "status") return statusUnion(scopeTypes(wf, settings.types), settings.groups).map((s) => ({ value: s, label: s }));
		return (f.field?.options ?? []).map((o) => ({ value: o, label: o }));
	};
	const valueColors = (f: WorkflowField | undefined): ColorMap | undefined =>
		f?.kind === "status" ? statusColors(statusUnion(scopeTypes(wf, settings.types), settings.groups), settings.types, settings.groups) : f?.field?.colors;
	const editChanged = (fn: (tr: Extract<WorkflowDef["trigger"], { kind: "changed" }>) => void) => edit((x) => x.trigger.kind === "changed" && fn(x.trigger));
	const editManual = (fn: (tr: Extract<WorkflowDef["trigger"], { kind: "manual" }>) => void) => edit((x) => x.trigger.kind === "manual" && fn(x.trigger));
	const editTimed = (fn: (tr: ScheduleTrigger | DateTrigger) => void) => edit((x) => isTimed(x.trigger) && fn(x.trigger));
	const editSchedule = (fn: (tr: ScheduleTrigger) => void) => edit((x) => x.trigger.kind === "schedule" && fn(x.trigger));
	const editDate = (fn: (tr: DateTrigger) => void) => edit((x) => x.trigger.kind === "date" && fn(x.trigger));

	const runs = plugin.workflows.log.filter((r) => r.workflow === id);

	// Folded sections: the same for every workflow, kept on this device.
	const [folded, setFolded] = useState<string[]>(() => {
		const raw = plugin.app.loadLocalStorage(FOLD_KEY) as unknown;
		try {
			const v = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
			return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
		} catch {
			return [];
		}
	});
	/** A section's fold, its summary while folded, and whether a problem is hidden in it. */
	const fold = (key: string, summary: string): SectionCollapse => ({
		open: !folded.includes(key),
		onToggle: () => {
			const next = folded.includes(key) ? folded.filter((x) => x !== key) : [...folded, key];
			setFolded(next);
			plugin.app.saveLocalStorage(FOLD_KEY, JSON.stringify(next));
		},
		summary,
		issue: shownProblems.some((p) => !!SECTION_ATS[key]?.(p.at)),
	});
	const unfoldProblems = () => {
		const next = folded.filter((k) => !problems.some((p) => SECTION_ATS[k]?.(p.at)));
		if (next.length === folded.length) return;
		setFolded(next);
		plugin.app.saveLocalStorage(FOLD_KEY, JSON.stringify(next));
	};
	const countConditions = (g: WorkflowDef["when"]): number => g.items.reduce((n, x) => n + ("items" in x ? countConditions(x) : 1), 0);
	const conditionCount = countConditions(wf.when);

	const scopes = useMemo(() => stepScopes(wf, lookup), [wf, settings.types]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<main className="oe-tm-main oe-wf-editor" data-workflow-id={id}>
			<header className="oe-tm-header">
				<div className="oe-tm-title">
					<span className="oe-type-icon oe-type-icon-xl">
						<Icon name="zap" />
					</span>
					<div>
						<h1>{wf.name || "New workflow"}</h1>
						<div className="oe-tm-muted">{triggerText(wf, settings.types)}</div>
					</div>
					<div className="oe-tm-headactions">
						{dirty && (
							<SaveActions
								label={isNew ? "New workflow, not saved yet" : "Unsaved changes"}
								problems={attempted ? problems.length : 0}
								onProblems={() => (setAttempted(true), setTab(problems[0]?.at === "form" ? "fields" : "edit"), unfoldProblems())}
								onDiscard={onDiscarded}
								onSave={() => {
									setAttempted(true);
									if (problems.length) {
										// Saved anyway, switched off: it can be switched on once they're fixed.
										setTab("edit");
										unfoldProblems();
									}
									void save();
								}}
							/>
						)}
						<span className="oe-wf-onoff" title={problems.length && !wf.on ? `Fix ${plural(problems.length, "problem")} to switch it on` : undefined}>
							<Toggle label={wf.on ? "Workflow on" : "Workflow off"} value={wf.on} disabled={!wf.on && problems.length > 0} onChange={(v) => edit((x) => (x.on = v))} />
							{wf.on ? "On" : "Off"}
						</span>
						<button className="clickable-icon" aria-label={noteless(wf) ? "Try it… (writes nothing)" : "Try on a note… (writes nothing)"} onClick={() => openTryRun(plugin, wf)}>
							<Icon name="flask-conical" />
						</button>
						<button className="clickable-icon" aria-label="Workflow options" onClick={menu}>
							<Icon name="more-horizontal" />
						</button>
					</div>
				</div>
				<nav className="oe-tm-tabs" role="tablist">
					<button role="tab" aria-selected={tab === "edit"} data-tab="edit" className={`oe-tm-tab${tab === "edit" ? " is-active" : ""}`} onClick={() => setTab("edit")}>
						<Icon name="pencil-ruler" />
						Editor
						{shownProblems.some((p) => p.at !== "form") && <Icon name="alert-circle" className="oe-tm-issue-dot" />}
					</button>
					{formApi && (
						<button role="tab" aria-selected={tab === "fields"} data-tab="fields" className={`oe-tm-tab${tab === "fields" ? " is-active" : ""}`} onClick={() => setTab("fields")}>
							<Icon name="text-cursor-input" />
							Form fields
							<span className="oe-tm-tabcount">{formApi.draft.type.fields.length}</span>
							{formApi.issues.some((i) => i.at.startsWith("field:")) && <Icon name="alert-circle" className="oe-tm-issue-dot" />}
						</button>
					)}
					{formApi && (
						<button role="tab" aria-selected={tab === "layout"} data-tab="layout" className={`oe-tm-tab${tab === "layout" ? " is-active" : ""}`} onClick={() => setTab("layout")}>
							<Icon name="layout-dashboard" />
							Form layout
							{formApi.issues.some((i) => i.at === "form:layout") && <Icon name="alert-circle" className="oe-tm-issue-dot" />}
						</button>
					)}
					{!isNew && (
						<button role="tab" aria-selected={tab === "runs"} data-tab="runs" className={`oe-tm-tab${tab === "runs" ? " is-active" : ""}`} onClick={() => setTab("runs")}>
							<Icon name="history" />
							Recent runs
							<span className="oe-tm-tabcount">{runs.length}</span>
						</button>
					)}
				</nav>
			</header>
			{formApi && (tab === "fields" || tab === "layout") ? (
				<EditorContext.Provider value={formApi}>
					<div className={`oe-tm-body is-${tab} oe-wf-form-body`}>
						{tab === "fields" && at("form").some((p) => !formApi.issues.some((i) => i.message === p.message)) && (
							<div className="oe-wf-form-issues">
								{at("form")
									.filter((p) => !formApi.issues.some((i) => i.message === p.message))
									.map((p, i) => (
										<div key={i} className="oe-tm-issue">
											<Icon name="alert-circle" /> {p.message}
										</div>
									))}
							</div>
						)}
						{tab === "fields" ? <FieldsTab /> : <LayoutTab />}
					</div>
				</EditorContext.Provider>
			) : tab === "runs" ? (
				<div className="oe-tm-body is-runs">
					<div className="oe-tm-muted oe-wf-runs-intro">
						{runs.length ? `Its last ${plural(runs.length, "run")}, newest first (Recent runs, on the Workflows heading's right-click menu in the Entity Browser, keeps the last 200 of every workflow).` : "It hasn't run yet."} Undo puts back what a run changed, while its notes haven't changed since.
					</div>
					{runs.length > 0 && <RunList runs={runs} />}
				</div>
			) : (
				<div className="oe-tm-body">
					{problems.length > 0 && !isNew && (
						<div className="oe-wf-banner">
							<Icon name="alert-triangle" /> This workflow doesn't run until {problems.length === 1 ? "its problem is" : `its ${problems.length} problems are`} fixed.
						</div>
					)}
					<Section title="Workflow" desc="Its name, the notes it's for, and whether its changes set off other workflows." icon="sliders-horizontal" className="oe-wf-panel is-workflow">
						<Row label="Name" issues={at("name")}>
							<TextInput label="Workflow name" value={wf.name} placeholder="e.g. Completed date" autoFocus={isNew && !wf.name} invalid={at("name").length > 0} onChange={(v) => edit((x) => (x.name = v))} />
						</Row>
						<Row
							label="Applies to"
							desc={
								needsScope(t.kind)
									? "The types of note it watches."
									: t.kind === "form"
										? "Empty: the form starts on its own, with no note. With types: it's a button on those notes."
										: "The types of note it can be run on. Leave empty for any note."
							}
							issues={at("scope")}
							stacked
						>
							<TargetPicker values={wf.scope} types={settings.types} groups={settings.groups} invalid={at("scope").length > 0} onChange={(v) => edit((x) => (x.scope = v.filter((s) => s !== "*")))} />
						</Row>
						<Row
							label="Set off other workflows"
							desc={
								wf.isolated
									? "Off: the notes it changes or creates don't start other workflows (When created, When changed, dates). Its Run another workflow steps still run."
									: "The notes it changes or creates can start other workflows (When created, When changed, dates), up to 5 in a row."
							}
						>
							<Toggle label="Set off other workflows" value={!wf.isolated} onChange={(v) => edit((x) => (v ? delete x.isolated : (x.isolated = true)))} />
						</Row>
					</Section>

					<Section title="When" desc="What starts the workflow." icon="zap" className="oe-wf-panel is-when" collapse={fold("when", triggerText(wf, settings.types))}>
						<Row label="Trigger" issues={at("trigger")}>
							<Segmented label="Trigger" value={t.kind} options={TRIGGER_OPTIONS} onChange={setTrigger} />
						</Row>
						{t.kind === "created" && <div className="oe-wf-help">Runs when a note of these types is created (the Create dialog, + New, a calendar day, converting a note), or appears by sync. Not for renames.</div>}
						{t.kind === "changed" && (
							<>
								<Row label="Field" desc="Changes from anywhere count: the form, tables, boards, other workflows, or the note edited by hand.">
									<FieldSelect label="Field" value={t.field} fields={fields} onChange={(k) => edit((x) => (x.trigger = { kind: "changed", field: k }))} />
								</Row>
								{listsValues(watched) ? (
									<>
										<Row label="From" desc="Only when the old value is one of these. None picked: any.">
											<ValuePills label="From" options={valueChoices(watched)} colors={valueColors(watched)} value={t.from ?? []} onChange={(v) => editChanged((tr) => (v.length ? (tr.from = v) : delete tr.from))} />
										</Row>
										<Row label="To" desc="Only when the new value is one of these. None picked: any.">
											<ValuePills label="To" options={valueChoices(watched)} colors={valueColors(watched)} value={Array.isArray(t.to) ? t.to : []} onChange={(v) => editChanged((tr) => (v.length ? (tr.to = v) : delete tr.to))} />
										</Row>
									</>
								) : (
									<Row label="When it">
										<Segmented
											label="When it"
											value={t.to === "filled" ? "filled" : t.to === "empty" ? "empty" : "any"}
											options={[
												{ value: "any", label: "Changes" },
												{ value: "filled", label: "Is filled in" },
												{ value: "empty", label: "Is emptied" },
											]}
											onChange={(v) =>
												editChanged((tr) => {
													delete tr.from;
													if (v === "any") delete tr.to;
													else tr.to = v;
												})
											}
										/>
									</Row>
								)}
							</>
						)}
						{t.kind === "manual" && (
							<>
								<Row label="Button" desc="Shown on the note's properties form and its ⋯ menu, in tables' row menus and selection bar, and in the command palette (Run workflow on this note…).">
									<div className="oe-wf-button-row">
										<IconPicker value={t.icon ?? ""} color="var(--text-muted)" empty="zap" onChange={(v) => editManual((tr) => (v ? (tr.icon = v) : delete tr.icon))} />
										<TextInput label="Button label" value={t.label ?? ""} placeholder={wf.name || "Run"} onChange={(v) => editManual((tr) => (tr.label = v))} />
									</div>
								</Row>
								<Row label="Ask first" desc="A question to confirm before it runs, e.g. “Close this task?”. Empty: it runs straight away.">
									<TextInput label="Confirmation" value={t.confirm ?? ""} placeholder="No confirmation" onChange={(v) => editManual((tr) => (v.trim() ? (tr.confirm = v) : delete tr.confirm))} />
								</Row>
								<Row
									label="On several notes"
									desc={
										t.selection === "once"
											? `Once for the whole selection: one run, with the selected notes as [${SELECTION_VAR}] (those that match Only if). There's no single “this note”: use For each over [${SELECTION_VAR}] to change each one, e.g. create one note that links them all.`
											: "Once for each selected note: each run has its own note as “this note”."
									}
								>
									<Segmented
										label="On several notes"
										value={t.selection === "once" ? "once" : "each"}
										options={[
											{ value: "each", label: "Each note" },
											{ value: "once", label: "Once for the selection" },
										]}
										onChange={(v) => editManual((tr) => (v === "once" ? (tr.selection = "once") : delete tr.selection))}
									/>
								</Row>
							</>
						)}
						{t.kind === "form" && (
							<>
								<Row label="Title" desc="At the top of the form, and in the command palette (Fill in a form…).">
									<div className="oe-wf-button-row">
										<IconPicker value={t.icon ?? ""} color="var(--text-muted)" empty="clipboard-list" onChange={(v) => edit((x) => x.trigger.kind === "form" && (v ? (x.trigger.icon = v) : delete x.trigger.icon))} />
										<TextInput label="Form title" value={t.title} placeholder={wf.name || "e.g. Log session"} onChange={(v) => edit((x) => x.trigger.kind === "form" && (x.trigger.title = v))} />
									</div>
								</Row>
								<Row label="Button" desc="The button that sends the form.">
									<TextInput label="Send button" value={t.button} placeholder="Run" onChange={(v) => edit((x) => x.trigger.kind === "form" && (x.trigger.button = v))} />
								</Row>
								<Row label="The form" desc={t.fields.length ? `${plural(t.fields.length, "field")}: ${t.fields.map((f) => f.label || f.key).join(", ")}. Steps use each answer by its label, e.g. [${t.fields[0].label || "Date"}].` : "No fields yet: it runs straight away. Add them on the Form fields tab."}>
									<span className="oe-wf-inline">
										<button onClick={() => setTab("fields")}>
											<Icon name="text-cursor-input" /> Form fields
										</button>
										<button onClick={() => setTab("layout")}>
											<Icon name="layout-dashboard" /> Form layout
										</button>
										<button title="Show the form in the side panel, as it opens" onClick={() => void plugin.activateSidePanel()}>
											<Icon name="eye" /> Preview
										</button>
									</span>
								</Row>
								<div className="oe-wf-help">
									{wf.scope.length
										? "It runs on notes of these types, like a button: on their properties form, the ⋯ menu, tables' row menus and selection bar, and Run workflow on this note…. It asks the form first (once for all the selected notes)."
										: "With no types (Applies to) it starts on its own, with no note: from the command palette (Fill in a form…). Steps act on notes the form picks, or ones they create or find."}
								</div>
							</>
						)}
						{(t.kind === "manual" || t.kind === "form") && (
							<Row label="Command" desc={`Its own command in the command palette (“Workflow: ${buttonLabel(wf)}”), so it can have a hotkey.${t.kind === "manual" || wf.scope.length ? " It runs on the note that's open." : ""}`}>
								<Toggle label="Its own command" value={!!wf.command} onChange={(v) => edit((x) => (v ? (x.command = true) : delete x.command))} />
							</Row>
						)}
						{noteless(wf) && (
							<>
								<Row label="Ribbon icon" desc="An icon of its own in the ribbon on the left, which opens the form.">
									<Toggle label="Ribbon icon" value={!!wf.ribbon} onChange={(v) => edit((x) => (v ? (x.ribbon = true) : delete x.ribbon))} />
								</Row>
								<Row label="On view toolbars" desc="A button on the toolbar of every table, board and calendar view (several forms share a Forms menu).">
									<Toggle label="On view toolbars" value={!!wf.toolbar} onChange={(v) => edit((x) => (v ? (x.toolbar = true) : delete x.toolbar))} />
								</Row>
							</>
						)}
						{t.kind === "schedule" && (
							<>
								<Row label="Every">
									<Segmented
										label="Every"
										value={t.every}
										options={[
											{ value: "day", label: "Day" },
											{ value: "week", label: "Week" },
											{ value: "hours", label: "Few hours" },
										]}
										onChange={(v) => editSchedule((tr) => (tr.every = v))}
									/>
								</Row>
								{t.every === "week" && (
									<Row label="On">
										<select className="dropdown" aria-label="Day of the week" value={t.day} onChange={(e) => editSchedule((tr) => (tr.day = Number(e.target.value)))}>
											{[1, 2, 3, 4, 5, 6, 0].map((d) => (
												<option key={d} value={d}>
													{WEEKDAYS[d]}
												</option>
											))}
										</select>
									</Row>
								)}
								{t.every === "hours" ? (
									<Row label="Hours" desc="How many hours after it last ran (1 to 168).">
										<WholeNumber label="Hours" value={t.hours} min={1} max={168} onChange={(v) => editSchedule((tr) => (tr.hours = v))} />
									</Row>
								) : (
									<Row label="At" desc="Local time.">
										<input type="time" className="oe-wf-time" aria-label="Time" value={t.at} onChange={(e) => e.target.value && editSchedule((tr) => (tr.at = e.target.value))} />
									</Row>
								)}
								<div className="oe-wf-help">Runs on every note of these types that matches Only if, one run each.</div>
							</>
						)}
						{t.kind === "date" && (
							<>
								<Row label="Date field">
									{dateFields.length ? <FieldSelect label="Date field" value={t.field} fields={dateFields} onChange={(k) => editDate((tr) => (tr.field = k))} /> : <span className="oe-tm-muted">These types have no date fields.</span>}
								</Row>
								<Row label="When">
									<span className="oe-wf-date-when">
										{t.offset !== 0 && <WholeNumber label="Days" value={Math.abs(t.offset)} min={1} max={3650} onChange={(v) => editDate((tr) => (tr.offset = Math.sign(tr.offset) * v))} />}
										{t.offset !== 0 && <span className="oe-wf-to">{Math.abs(t.offset) === 1 ? "day" : "days"}</span>}
										<Segmented
											label="When"
											value={t.offset < 0 ? "before" : t.offset > 0 ? "after" : "on"}
											options={[
												{ value: "before", label: "Before" },
												{ value: "on", label: "On the day" },
												{ value: "after", label: "After" },
											]}
											onChange={(v) => editDate((tr) => (tr.offset = v === "on" ? 0 : (v === "before" ? -1 : 1) * Math.max(1, Math.abs(tr.offset))))}
										/>
									</span>
								</Row>
								<Row label="Check at" desc="Checked once a day, at this time (or when Obsidian next opens). Dates passed while it was closed are caught up, once per note; a date set to today after the check runs straight away.">
									<input type="time" className="oe-wf-time" aria-label="Check at" value={t.at} onChange={(e) => e.target.value && editDate((tr) => (tr.at = e.target.value))} />
								</Row>
							</>
						)}
						{isTimed(t) && (
							<>
								<Row label="At most" desc="Notes per run. When more notes match, it doesn't run at all, and Recent runs says why.">
									<span className="oe-wf-date-when">
										<WholeNumber label="At most" value={t.limit} min={1} max={10000} onChange={(v) => editTimed((tr) => (tr.limit = v))} />
										<span className="oe-wf-to">notes</span>
									</span>
								</Row>
								<TimedStatus id={id} wf={wf} isNew={isNew} />
							</>
						)}
					</Section>

					{(!noteless(wf) || wf.when.items.length > 0) && (
					<Section
						title="Only if"
						icon="filter"
						className="oe-wf-panel is-only-if"
						desc={
							noteless(wf)
								? "A form that starts on its own has no note to check: remove these conditions (an If step can test the answers)."
								: isTimed(t)
									? "Conditions on each note when it runs. None: every note of these types."
									: runsOnce(wf)
										? `Conditions on each selected note: those that don't match are left out of [${SELECTION_VAR}]. None: every selected note of these types.`
										: "Conditions on the note, after the change. None: it always runs."
						}
						collapse={fold("only-if", conditionCount ? `${plural(conditionCount, "condition")}${wf.when.items.length > 1 ? (wf.when.mode === "all" ? ", all must match" : ", any can match") : ""}` : "No conditions: it always runs.")}
					>
						{at("when").map((p, i) => (
							<div key={i} className="oe-tm-issue">
								<Icon name="alert-circle" /> {p.message}
							</div>
						))}
						<div className="oe-wf-when">
							<FiltersPanel filters={wf.when} choices={choices} ctx={ctx} valuesOf={valuesOf} heading="Run only for notes that match" emptyText="No conditions: it runs for every note." onChange={(g) => edit((x) => (x.when = g))} />
						</div>
					</Section>
					)}

					<Section
						title="Do"
						icon="list-checks"
						className="oe-wf-panel is-do"
						desc="Steps, in order. Each sees the changes of the ones before; the note is saved once at the end. If a step fails, nothing is saved."
						collapse={fold("do", wf.steps.length ? `${plural(wf.steps.length, "step")}: ${wf.steps.map((s) => STEP_LABELS[s.kind]).join(" → ")}` : "No steps yet.")}
					>
						{at("steps").map((p, i) => (
							<div key={i} className="oe-tm-issue">
								<Icon name="alert-circle" /> {p.message}
							</div>
						))}
						<StepList wf={wf} steps={wf.steps} path="" scopes={scopes} problems={shownProblems} onChange={(steps) => edit((x) => (x.steps = steps))} />
					</Section>
				</div>
			)}
		</main>
	);
}

/** A whole number box: saved when it's left or Enter is pressed; out-of-range or non-numbers go back. */
function WholeNumber({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
	const [text, setText] = useState(String(value));
	useEffect(() => setText(String(value)), [value]);
	const commit = () => {
		const n = Number(text.trim());
		if (Number.isInteger(n) && n >= min && n <= max) {
			if (n !== value) onChange(n);
		} else setText(String(value));
	};
	return (
		<input
			type="number"
			className="oe-wf-number"
			aria-label={label}
			min={min}
			max={max}
			step={1}
			value={text}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => e.key === "Enter" && commit()}
		/>
	);
}

/**
 * When a scheduled or date workflow last ran and runs next on this device, and why it might not: off on this device,
 * off or paused, or (moves and renames) Obsidian asking before it updates links.
 */
function TimedStatus({ id, wf, isNew }: { id: string; wf: WorkflowDef; isNew: boolean }) {
	const plugin = usePlugin();
	const t = wf.trigger;
	if (!isTimed(t)) return null;
	const st = isNew ? undefined : plugin.workflows.timedState()[id];
	const moves = flatSteps(wf.steps).some((s) => s.kind === "move" || s.kind === "rename");
	const warn: string[] = [];
	if (!plugin.workflows.timedHere) warn.push("Scheduled workflows don't run on this device: turn on “Run scheduled workflows on this device” in Settings → Obsidian Entities.");
	if (plugin.settings.workflowsPaused) warn.push("All workflows are paused.");
	else if (!wf.on) warn.push("It's off.");
	if (moves && !plugin.workflows.linksFollow()) warn.push("Its move and rename steps won't run on their own: Obsidian asks before updating links (Settings → Files and links → Automatically update internal links).");
	const next = st ? nextDue(t, st.last) : nextDue(t, Date.now());
	return (
		<div className="oe-wf-timed">
			<div className="oe-wf-help">
				It runs on its own while Obsidian is open on a device that runs scheduled workflows. A missed run catches up once, the next time Obsidian is open.
				{wf.on && !plugin.settings.workflowsPaused && plugin.workflows.timedHere && (
					<>
						{" "}
						{st ? `Last ${t.kind === "date" ? "checked" : "ran"} ${when(st.last)}; next ${when(next)}.` : isNew ? "Save it to start." : `First ${t.kind === "date" ? "check" : "run"}: ${when(next)}.`}
					</>
				)}
			</div>
			{warn.map((w, i) => (
				<div key={i} className="oe-wf-banner">
					<Icon name="alert-triangle" /> {w}
				</div>
			))}
		</div>
	);
}

/**
 * From / to values: the chosen ones as the form's choice pills (in their colours), with a dropdown to add more, like
 * a multiple-choice field. `options` value / label pairs (checkboxes show Ticked / Unticked).
 */
function ValuePills({ label, options, colors, value, onChange }: { label: string; options: { value: string; label: string }[]; colors?: ColorMap; value: string[]; onChange: (v: string[]) => void }) {
	const labelOf = (v: string) => options.find((o) => o.value.toLowerCase() === v.toLowerCase())?.label ?? v;
	const valueOf = (l: string) => options.find((o) => o.label === l)?.value ?? l;
	return (
		<span className="oe-wf-pills" role="group" aria-label={label}>
			<ChoiceControl
				options={options.map((o) => o.label)}
				value={value.map(labelOf)}
				editable
				multiple
				label={label}
				placeholder="Any"
				field={{ kind: "multiselect", colors }}
				onCommit={(v) => onChange((Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]).map((x) => valueOf(String(x))))}
			/>
		</span>
	);
}

/** Status colours as a choice field's colour map (for the form's pills). */
const statusColors = (statuses: string[], types: EntityTypeDef[], groups: GroupDef[]): ColorMap => {
	const out: ColorMap = {};
	for (const s of statuses) {
		const c = statusColorAmong(s, types, groups);
		if (c) out[s] = c;
	}
	return out;
};
/** A field picker like the views' column pickers: Built-in (Status, Tags) and Fields. */
function FieldSelect({ value, fields, label, onChange }: { value: string; fields: WorkflowField[]; label: string; onChange: (key: string) => void }) {
	const builtin = fields.filter((f) => f.key === COMMON_KEYS.status || f.key === COMMON_KEYS.tags);
	const own = fields.filter((f) => !builtin.includes(f));
	const opts = (list: WorkflowField[]) =>
		list.map((f) => (
			<option key={f.key} value={f.key}>
				{f.label}
			</option>
		));
	return (
		<select className="dropdown oe-pop-select oe-wf-field" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
			{!fields.some((f) => f.key === value) && <option value={value}>{value || "Choose…"}</option>}
			{builtin.length > 0 && <optgroup label="Built-in">{opts(builtin)}</optgroup>}
			{own.length > 0 && <optgroup label="Fields">{opts(own)}</optgroup>}
		</select>
	);
}

/** Names steps give notes and loop items (lower case), across the workflow: each must be unique. */
function usedNames(wf: WorkflowDef, except?: WorkflowStep): Set<string> {
	return new Set(
		flatSteps(wf.steps)
			.filter((s) => s !== except)
			.flatMap((s) => (s.kind === "create" || s.kind === "linked" || s.kind === "each" || s.kind === "find" || s.kind === "input" ? [s.as.trim().toLowerCase()] : s.kind === "var" ? [s.name.trim().toLowerCase()] : [])),
	);
}

/** A name not used yet: "Task", else "Task 2", "Task 3"… */
const uniqueName = (base: string, used: Set<string>) => {
	let n = base;
	for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base} ${i}`;
	return n;
};

/** A new step of a kind, for the note its list acts on by default (`sc`). */
function blankStep(kind: StepKind, wf: WorkflowDef, sc: StepScope, workflows: WorkflowDef[], types: EntityTypeDef[]): WorkflowStep {
	const fields = sc.fields;
	const first = fields.find((f) => f.key !== COMMON_KEYS.tags)?.key ?? COMMON_KEYS.status;
	const used = usedNames(wf);
	switch (kind) {
		case "set":
			return { kind, field: first, value: "", fixed: defaultFixed(fields.find((f) => f.key === first)) };
		case "clear":
			return { kind, field: first };
		case "tag":
			return { kind, op: "add", tag: "" };
		case "link":
			return { kind, op: "add", field: fields.find((f) => f.kind === "relation")?.key ?? "", target: "", fixed: [] };
		case "notice":
			return { kind, text: "" };
		case "ask":
			return { kind, text: "" };
		case "input":
			return { kind, text: "", as: uniqueName("Answer", used) };
		case "move":
			return { kind, to: "folder", folder: "" };
		case "rename":
			return { kind, name: "" };
		case "append":
			return { kind, text: "", where: "end", heading: "" };
		case "var":
			return { kind, name: uniqueName("Value", used), value: "" };
		case "if":
			// No single note to test (a run for the whole selection): a formula.
			return { kind, test: sc.noNote ? "formula" : "filter", when: { mode: "all", items: [] }, formula: "", steps: [], otherwise: [] };
		case "find": {
			// Notes of the kind steps act on here, to start with.
			const ts = sc.types.length === types.length ? [] : sc.types;
			return { kind, types: ts.map((t) => t.key), when: { mode: "all", items: [] }, keep: "all", as: uniqueName(`Found ${ts.length === 1 ? (ts[0].plural || ts[0].name).toLowerCase() : "notes"}`, used) };
		}
		case "create": {
			const s = newCreateStep({ scope: sc.scope, steps: [], trigger: wf.trigger }, types);
			return { ...s, as: uniqueName(s.as, used) };
		}
		case "run":
			return { kind, workflow: workflows.find((w) => w.id !== wf.id && (!sc.types.length || sc.types.some((t) => inScope(w, t))))?.id ?? "" };
		case "linked": {
			const src = linkedSources(sc.scope, types);
			const source: LinkedSource = src.in[0] ? { dir: "in", type: src.in[0].type.key, field: src.in[0].field.key } : { dir: "out", field: src.out[0]?.key ?? "" };
			const step: LoopStep = { kind, source, when: { mode: "all", items: [] }, as: "", steps: [] };
			const its = loopItemTypes(step, sc.scope, types);
			return { ...step, as: uniqueName(its.length === 1 ? its[0].name : "Note", used) };
		}
		case "each":
			// Once for the selection: a loop over the selected notes, of the workflow's type when it has one.
			if (sc.noNote && !sc.loop && sc.vars.some((v) => v.role === "selection")) return { kind, formula: `[${SELECTION_VAR}]`, items: "notes", itemType: sc.types.length === 1 ? sc.types[0].key : "", when: { mode: "all", items: [] }, as: uniqueName(sc.types.length === 1 ? sc.types[0].name : "Note", used), steps: [] };
			return { kind, formula: "", items: "values", itemType: "", when: { mode: "all", items: [] }, as: uniqueName("Item", used), steps: [] };
	}
}

/** The scope a step added at the end of a list would have (the list''s created notes included): the workflow''s steps (`path` ""), or a block of the step at `path`. */
function scopeForNew(wf: WorkflowDef, path: string, block: number, lookup: { types: EntityTypeDef[]; groups: GroupDef[] }): StepScope {
	const ph: WorkflowStep = { kind: "notice", text: "" };
	if (path === "") return stepScopes({ ...wf, steps: [...wf.steps, ph] }, lookup).get(String(wf.steps.length))!;
	let key = "";
	const steps = mapStepAt(wf.steps, path, (s) => {
		const blocks = stepBlocks(s);
		key = `${path}.${blockOffset(s, block) + (blocks[block]?.length ?? 0)}`;
		return withBlocks(
			s,
			blocks.map((b, i) => (i === block ? [...b, ph] : b)),
		);
	});
	return stepScopes({ ...wf, steps }, lookup).get(key) ?? stepScopes(wf, lookup).get(path)!;
}

/** "This note" in a workflow's conditions (loops, If, Find notes). */
const THIS_IS = "The note the workflow runs on";

/** What the formula editor needs to know about where a formula is: whether its preview notes are "This note", and what its columns are. */
const editorContext = (sc: StepScope) => ({ thisIsRow: !sc.item && !sc.noNote, ...(sc.noNote ? { noNote: true } : {}), ...(sc.item ? { columnsTitle: `Columns of ${sc.defaultLabel.toLowerCase()}` } : {}) });

/** "Add step": the kinds of step, grouped by what they do. */
const STEP_GROUPS: { title: string; kinds: StepKind[] }[] = [
	{ title: "Change the note", kinds: ["set", "clear", "tag", "link", "append", "move", "rename"] },
	{ title: "Notes", kinds: ["create", "find"] },
	{ title: "Values", kinds: ["var"] },
	{ title: "Flow", kinds: ["if", "each", "linked", "run"] },
	{ title: "Talk", kinds: ["notice", "ask", "input"] },
];

/** A step card''s part in dragging steps to reorder them. */
interface StepDrag {
	dragging: boolean;
	/** the drop line above / below this card */
	before: boolean;
	after: boolean;
	/** a step of this list is being dragged */
	active: boolean;
	start: () => void;
	over: (gap: number) => void;
	drop: () => void;
	end: () => void;
}

/**
 * Steps in order, as cards that drag to reorder by their handle, with "Add step" (a menu of step kinds, by group).
 * `path`: "" for the workflow''s steps, or the place of the step whose block (`block`: a loop''s steps) this is.
 */
function StepList({
	wf,
	steps,
	path,
	block = 0,
	empty = "No steps yet: they run for each one.",
	scopes,
	problems,
	onChange,
}: {
	wf: WorkflowDef;
	steps: WorkflowStep[];
	path: string;
	block?: number;
	/** what an empty list inside a step says ("": nothing) */
	empty?: string;
	scopes: Map<string, StepScope>;
	problems: WorkflowProblem[];
	onChange: (steps: WorkflowStep[]) => void;
}) {
	const plugin = usePlugin();
	const { types, groups, workflows } = plugin.settings;
	// `over` is the gap the dragged step would go into (0 … steps).
	const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
	const at = path ? stepAt(wf.steps, path) : undefined;
	const offset = at ? blockOffset(at, block) : 0;
	const keyOf = (i: number) => (path ? `${path}.${offset + i}` : String(i));
	const move = (from: number, to: number) => {
		if (from === to || from + 1 === to) return;
		const next = [...steps];
		const [m] = next.splice(from, 1);
		next.splice(to > from ? to - 1 : to, 0, m);
		onChange(next);
	};
	const add = (e: ReactMouseEvent) => {
		const m = new Menu();
		const sc = scopeForNew(wf, path, block, { types, groups });
		// Inside a loop, nothing that asks: it's asked once, before the loop.
		const allowed = (k: StepKind) => !(sc.loop && (k === "ask" || k === "input"));
		for (const g of STEP_GROUPS) {
			const kinds = g.kinds.filter(allowed);
			if (!kinds.length) continue;
			m.addItem((i) => i.setSection(g.title).setTitle(g.title).setIsLabel(true));
			for (const k of kinds)
				m.addItem((i) =>
					i
						.setSection(g.title)
						.setTitle(STEP_LABELS[k])
						.setIcon(STEP_ICONS[k])
						.onClick(() => onChange([...steps, blankStep(k, wf, sc, workflows, types)])),
				);
		}
		m.showAtMouseEvent(e.nativeEvent);
	};
	return (
		<>
			<div className="oe-wf-steps" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && drag && setDrag({ ...drag, over: null })}>
				{steps.map((s, i) => (
					<StepCard
						key={i}
						index={i}
						path={keyOf(i)}
						count={steps.length}
						drag={{
							dragging: drag?.from === i,
							before: !!drag && drag.over === i && drag.from !== i && drag.from !== i - 1,
							after: !!drag && drag.over === i + 1 && i === steps.length - 1 && drag.from !== i,
							active: !!drag,
							start: () => setDrag({ from: i, over: null }),
							over: (at) => drag && at !== drag.over && setDrag({ ...drag, over: at }),
							drop: () => {
								if (drag && drag.over !== null) move(drag.from, drag.over);
								setDrag(null);
							},
							end: () => setDrag(null),
						}}
						step={s}
						wf={wf}
						scopes={scopes}
						problems={problems}
						onChange={(n) => onChange(steps.map((x, j) => (j === i ? n : x)))}
						onMove={(d) => move(i, d < 0 ? i - 1 : i + 2)}
						onRemove={() => onChange(steps.filter((_, j) => j !== i))}
					/>
				))}
				{!steps.length && path && empty && <div className="oe-tm-muted oe-wf-inner-empty">{empty}</div>}
			</div>
			<button className={`oe-wf-add-step${path ? " is-inner" : ""}`} onClick={add}>
				<Icon name="plus" /> {path ? "Add a step inside" : "Add step"}
			</button>
		</>
	);
}

/** One step: its kind, its settings, problems, and drag / move / remove buttons. */
function StepCard({
	index,
	path,
	count,
	drag,
	step,
	wf,
	scopes,
	problems,
	onChange,
	onMove,
	onRemove,
}: {
	index: number;
	path: string;
	count: number;
	drag: StepDrag;
	step: WorkflowStep;
	wf: WorkflowDef;
	scopes: Map<string, StepScope>;
	problems: WorkflowProblem[];
	onChange: (s: WorkflowStep) => void;
	onMove: (d: -1 | 1) => void;
	onRemove: () => void;
}) {
	const plugin = usePlugin();
	const allTypes = plugin.settings.types;
	const sc = scopes.get(path) ?? scopeForNew(wf, "", 0, plugin.settings);
	const target = stepTarget(step, sc, allTypes) ?? { scope: [], types: [], fields: [] };
	const on = "on" in step ? step.on : undefined;
	const settable = target.fields.filter((f) => f.key !== COMMON_KEYS.tags);
	const relations = target.fields.filter((f) => f.kind === "relation");
	const mine = problems.filter((p) => p.at === `step:${path}`);
	const placing = step.kind === "move" || step.kind === "rename";
	const hasOn = step.kind === "set" || step.kind === "clear" || step.kind === "tag" || step.kind === "link" || step.kind === "append" || step.kind === "run" || placing || (step.kind === "if" && step.test === "filter");
	// Created notes are named and placed by their Create a note step: moving or renaming offers the others only. A
	// plain note has no fields to set, clear or link.
	const onChoices = placing ? sc.on.filter((o) => !o.made) : step.kind === "set" || step.kind === "clear" || step.kind === "link" ? sc.on.filter((o) => !o.plain) : sc.on;
	const changeOn = (v: string) => {
		if (!hasOn) return;
		const withOn = { ...step, on: v || undefined } as WorkflowStep;
		const t2 = stepTarget(withOn, sc, allTypes);
		// Another note may have other fields: an If's conditions start again, other steps start afresh.
		const next = (
			step.kind === "tag" || step.kind === "append" || step.kind === "run" || placing
				? { ...step }
				: step.kind === "if"
					? { ...step, when: { mode: "all", items: [] } }
					: blankStep(step.kind, wf, { ...sc, fields: t2?.fields ?? [], scope: t2?.scope ?? [] }, plugin.settings.workflows, allTypes)
		) as WorkflowStep & { on?: string };
		if (v) next.on = v;
		else delete next.on;
		onChange(next);
	};
	const onPicker =
		onChoices.length > 0 && hasOn ? (
			<span className="oe-wf-on">
				<span className="oe-wf-to">On</span>
				<select className="dropdown oe-pop-select" aria-label="On" value={on ?? ""} onChange={(e) => changeOn(e.target.value)}>
					<option value="">{sc.defaultLabel}</option>
					{onChoices.some((o) => o.value === ON_THIS) && <option value={ON_THIS}>This note</option>}
					{onChoices.some((o) => o.value !== ON_THIS && !o.made && !o.found && !o.answer) && (
						<optgroup label="Loops this is inside">
							{onChoices
								.filter((o) => o.value !== ON_THIS && !o.made && !o.found && !o.answer)
								.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
						</optgroup>
					)}
					{onChoices.some((o) => o.answer) && (
						<optgroup label="Picked on the form">
							{onChoices
								.filter((o) => o.answer)
								.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
						</optgroup>
					)}
					{onChoices.some((o) => o.found) && (
						<optgroup label="Found by earlier steps">
							{onChoices
								.filter((o) => o.found)
								.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
						</optgroup>
					)}
					{onChoices.some((o) => o.made) && (
						<optgroup label="Created by earlier steps">
							{onChoices
								.filter((o) => o.made)
								.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
						</optgroup>
					)}
					{on && !onChoices.some((o) => o.value === on) && <option value={on}>{on}</option>}
				</select>
			</span>
		) : null;
	let body: ReactNode = null;
	switch (step.kind) {
		case "set": {
			const field = settable.find((f) => f.key === step.field);
			body = (
				<>
					{onPicker}
					<FieldSelect
						label="Field"
						value={step.field}
						fields={settable}
						onChange={(k) => {
							const next = settable.find((f) => f.key === k);
							onChange(step.fixed !== undefined ? { ...step, field: k, fixed: defaultFixed(next) } : { ...step, field: k });
						}}
					/>
					<span className="oe-wf-to">to</span>
					<StepValue
						sc={sc}
						types={target.types}
						field={field}
						preview={!on && sc.loop !== "notes"}
						fixed={step.fixed}
						formula={step.value}
						title={`Set ${field?.label ?? step.field} to…`}
						placeholder={valueHint(field)}
						onChange={(v) => {
							const { fixed: _drop, ...rest } = step;
							onChange("fixed" in v ? { ...rest, value: "", fixed: v.fixed } : { ...rest, value: v.formula });
						}}
					/>
				</>
			);
			break;
		}
		case "clear":
			body = (
				<>
					{onPicker}
					<FieldSelect label="Field" value={step.field} fields={settable} onChange={(k) => onChange({ ...step, field: k })} />
				</>
			);
			break;
		case "tag":
			body = (
				<>
					{onPicker}
					<Segmented
						label="Add or remove"
						value={step.op}
						options={[
							{ value: "add", label: "Add" },
							{ value: "remove", label: "Remove" },
						]}
						onChange={(v) => onChange({ ...step, op: v })}
					/>
					<TextInput label="Tag" className="oe-wf-text" value={step.tag} placeholder="#tag" onChange={(v) => onChange({ ...step, tag: v })} />
				</>
			);
			break;
		case "link": {
			const field = relations.find((f) => f.key === step.field);
			const names = sc.vars.filter((v) => v.type === "links").map((v) => v.name);
			body = (
				<>
					{onPicker}
					<Segmented
						label="Add or remove"
						value={step.op}
						options={[
							{ value: "add", label: "Add" },
							{ value: "remove", label: "Remove" },
						]}
						onChange={(v) => onChange({ ...step, op: v })}
					/>
					{relations.length ? <FieldSelect label="Field" value={step.field} fields={relations} onChange={(k) => onChange({ ...step, field: k })} /> : <span className="oe-tm-muted">These types have no link fields.</span>}
					<StepValue
						sc={sc}
						types={target.types}
						field={field}
						multiple
						fixed={step.fixed}
						formula={step.target}
						title={`${step.op === "add" ? "Link" : "Unlink"} ${field?.label ?? "notes"}`}
						placeholder={names.length ? `e.g. [${names[names.length - 1]}] or [Project]` : 'e.g. [Project] or "Apollo"'}
						onChange={(v) => {
							const { fixed: _drop, ...rest } = step;
							onChange("fixed" in v ? { ...rest, target: "", fixed: Array.isArray(v.fixed) ? v.fixed : [] } : { ...rest, target: v.formula });
						}}
					/>
				</>
			);
			break;
		}
		case "notice":
			body = <FormulaBox sc={sc} template value={step.text} placeholder="e.g. {[Name]} is done" onChange={(v) => onChange({ ...step, text: v })} />;
			break;
		case "var":
			body = (
				<div className="oe-wf-stack">
					<div className="oe-wf-step-row">
						<TextInput label="Variable name" className="oe-wf-text" value={step.name} placeholder="e.g. Total" onChange={(v) => onChange({ ...step, name: v })} />
						<span className="oe-wf-to">to</span>
						<FormulaBox sc={sc} label="Value" title={`Set ${step.name.trim() || "the variable"} to…`} value={step.value} placeholder="e.g. 0, [Estimate] * 2 or [Total] + 1" onChange={(v) => onChange({ ...step, value: v })} />
					</div>
					<div className="oe-wf-help">
						Later steps use it as [{step.name.trim() || "name"}], after loops too. Set it again to change it, e.g. to [{step.name.trim() || "Total"}] + [Estimate] inside a loop.
					</div>
				</div>
			);
			break;
		case "ask":
			body = (
				<div className="oe-wf-stack">
					<FormulaBox sc={sc} template label="Question" value={step.text} placeholder="e.g. Also close its {count([Tasks])} tasks?" onChange={(v) => onChange({ ...step, text: v })} />
					<div className="oe-wf-help">Yes carries on with the next steps; No stops the run, and nothing is saved. Not for workflows that run on their own schedule.</div>
				</div>
			);
			break;
		case "input":
			body = (
				<div className="oe-wf-create">
					{formRow("Question", <FormulaBox sc={sc} template label="Question" value={step.text} placeholder="e.g. What's the summary for {[Name]}?" onChange={(v) => onChange({ ...step, text: v })} />)}
					{formRow(
						"Answer",
						<span className="oe-wf-inline">
							<Segmented
								label="Answer"
								value={step.multiline ? "lines" : "line"}
								options={[
									{ value: "line", label: "One line" },
									{ value: "lines", label: "Several lines" },
								]}
								onChange={(v) => {
									const { multiline: _m, ...rest } = step;
									onChange(v === "lines" ? { ...rest, multiline: true } : rest);
								}}
							/>
						</span>,
					)}
					{formRow(
						"Default",
						<FormulaBox
							sc={sc}
							template
							label="Default answer"
							value={step.default ?? ""}
							placeholder="Empty  ·  e.g. {[Summary]}"
							onChange={(v) => {
								const { default: _d, ...rest } = step;
								onChange(v ? { ...rest, default: v } : rest);
							}}
						/>,
						"What the answer box starts with (and what a test run takes as the answer).",
					)}
					{formRow(
						"Call it",
						<span className="oe-wf-inline">
							<TextInput label="Call it" className="oe-wf-text" value={step.as} placeholder="e.g. Summary" onChange={(v) => onChange({ ...step, as: v })} />
							<span className="oe-tm-muted">Later steps use the answer as [{step.as.trim() || "…"}] (text). Cancel stops the run, and nothing is saved.</span>
						</span>,
					)}
				</div>
			);
			break;
		case "append":
			body = (
				<div className="oe-wf-stack">
					{onPicker && <div className="oe-wf-step-row">{onPicker}</div>}
					<div className="oe-wf-create">
						{formRow(
							"Text",
							<div className="oe-wf-stack">
								<FormulaBox sc={sc} template multiline label="Text" value={step.text} placeholder={'e.g. - {format(today(), "D MMM")}: {[Status]}'} onChange={(v) => onChange({ ...step, text: v })} />
							</div>,
						)}
						{formRow(
							"Where",
							<span className="oe-wf-inline">
								<Segmented
									label="Where"
									value={step.where}
									options={[
										{ value: "end", label: "At the end" },
										{ value: "start", label: "At the start" },
										{ value: "heading", label: "Under a heading" },
									]}
									onChange={(v) => onChange({ ...step, where: v })}
								/>
							</span>,
						)}
						{step.where === "heading" && formRow("Heading", <FormulaBox sc={sc} template label="Heading" value={step.heading} placeholder="e.g. Log or ## Log" onChange={(v) => onChange({ ...step, heading: v })} />)}
						{formRow(
							"Spacing",
							<span className="oe-wf-inline">
								<Segmented
									label="Spacing"
									value={step.blank ? "blank" : "line"}
									options={[
										{ value: "line", label: "On its own line" },
										{ value: "blank", label: "With a blank line" },
									]}
									onChange={(v) => {
										const { blank: _b, ...rest } = step;
										onChange(v === "blank" ? { ...rest, blank: true } : rest);
									}}
								/>
							</span>,
							step.where === "start" ? "A blank line between it and the rest of the note." : "A blank line between it and what's before it.",
						)}
					</div>
					<div className="oe-wf-help">
						{step.where === "start" ? "After the note's properties. " : step.where === "heading" ? "At the end of that heading's section. “## Log” only matches a level 2 heading, “Log” any level; a note without it gets the heading added at the end. " : ""}
						It doesn't change any fields, so it doesn't set off When changed workflows. Undo takes the text out again.
					</div>
				</div>
			);
			break;
		case "move":
			body = (
				<div className="oe-wf-stack">
					<div className="oe-wf-step-row">
						{onPicker}
						<span className="oe-wf-to">to</span>
						<Segmented
							label="Move to"
							value={step.to}
							options={[
								{ value: "folder", label: "A folder" },
								{ value: "type", label: "Its type's folder" },
							]}
							onChange={(v) => onChange({ ...step, to: v })}
						/>
					</div>
					{step.to === "folder" ? (
						<FormulaBox sc={sc} template label="Folder" value={step.folder} placeholder="e.g. Archive/{year(today())}" onChange={(v) => onChange({ ...step, folder: v })}>
							<button
								className="oe-wf-fxbtn"
								title="Pick a folder"
								aria-label="Pick a folder"
								onClick={() => new FolderPickerModal(plugin, (f) => onChange({ ...step, folder: f.isRoot() ? "/" : f.path.replace(/[{}]/g, (c) => c + c) }), "Move to folder…").open()}
							>
								<Icon name="folder" />
							</button>
						</FormulaBox>
					) : (
						<div className="oe-wf-help">Where its type's folder rules put it now: its type's folder, or inside its parent's after the parent link changes.</div>
					)}
					<div className="oe-wf-help">Links to it are updated. A note already there with the same name gets “2” added.</div>
				</div>
			);
			break;
		case "rename":
			body = (
				<div className="oe-wf-stack">
					<div className="oe-wf-step-row">
						{onPicker}
						<FormulaBox sc={sc} template label="New name" value={step.name} placeholder="e.g. {[Code]} {[Name]}" onChange={(v) => onChange({ ...step, name: v })} />
					</div>
					<div className="oe-wf-help">It stays in its folder, and links to it are updated. Characters a file name can't have are left out.</div>
				</div>
			);
			break;
		case "create":
			body = <CreateBody wf={wf} sc={sc} step={step} onChange={onChange} />;
			break;
		case "run":
			body = (
				<>
					{onPicker}
					<RunBody wf={wf} types={target.types} step={step} onChange={onChange} />
				</>
			);
			break;
		case "linked":
		case "each":
			body = <LoopBody wf={wf} path={path} step={step} scopes={scopes} problems={problems} onChange={onChange} />;
			break;
		case "if":
			body = <IfBody wf={wf} path={path} step={step} sc={sc} target={target} onPicker={onPicker} scopes={scopes} problems={problems} onChange={onChange} />;
			break;
		case "find":
			body = <FindBody sc={sc} step={step} onChange={onChange} />;
			break;
	}
	const named = step.kind === "create" || step.kind === "linked" || step.kind === "each" || step.kind === "find" || step.kind === "input" ? step.as.trim() : step.kind === "var" ? step.name.trim() : "";
	const subtitle = step.kind === "run" ? plugin.settings.workflows.find((w) => w.id === step.workflow)?.name : named ? `“${named}”` : "";
	const stepNo = stepLabel(path);
	return (
		<div
			className={`oe-wf-step${mine.length ? " has-issue" : ""}${isLoop(step) ? " is-loop" : ""}${step.kind === "if" ? " is-if" : ""}${drag.dragging ? " is-dragging" : ""}${drag.before ? " drop-before" : ""}${drag.after ? " drop-after" : ""}`}
			data-step={path}
			onDragOver={(e) => {
				if (!drag.active) return;
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = "move";
				const r = e.currentTarget.getBoundingClientRect();
				drag.over(e.clientY < r.top + r.height / 2 ? index : index + 1);
			}}
			onDrop={(e) => {
				if (!drag.active) return;
				e.preventDefault();
				e.stopPropagation();
				drag.drop();
			}}
		>
			<div
				className="oe-wf-step-gutter"
				draggable
				role="button"
				aria-label={`Step ${stepNo}: drag to reorder`}
				title="Drag to reorder"
				onDragStart={(e) => {
					e.stopPropagation();
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", path);
					const card = e.currentTarget.closest(".oe-wf-step");
					if (card instanceof HTMLElement) e.dataTransfer.setDragImage(card, 16, 16);
					drag.start();
				}}
				onDragEnd={drag.end}
			>
				<span className="oe-wf-step-grip">
					<Icon name="grip-vertical" />
				</span>
				<span className="oe-wf-step-n">{stepNo}</span>
			</div>
			<div className="oe-wf-step-main">
				<div className="oe-wf-step-head">
					<Icon name={STEP_ICONS[step.kind]} />
					<span className="oe-wf-step-title">{STEP_LABELS[step.kind]}</span>
					{subtitle && <span className="oe-wf-step-as">{subtitle}</span>}
					<span className="oe-spacer" />
					<button className="clickable-icon" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
						<Icon name="arrow-up" />
					</button>
					<button className="clickable-icon" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
						<Icon name="arrow-down" />
					</button>
					<button className="clickable-icon oe-tm-danger" aria-label="Remove step" onClick={onRemove}>
						<Icon name="trash-2" />
					</button>
				</div>
				<div className={`oe-wf-step-body${step.kind === "create" || isLoop(step) || step.kind === "if" || step.kind === "find" || step.kind === "input" ? " is-create" : ""}`}>{body}</div>
				{mine.map((p, i) => (
					<div key={i} className="oe-tm-issue">
						<Icon name="alert-circle" /> {p.message}
					</div>
				))}
			</div>
		</div>
	);
}

/** Label / control rows, as in "Create a note" and the loops. */
const formRow = (label: ReactNode, control: ReactNode, desc?: string) => (
	<>
		<span className="oe-wf-create-label" title={desc}>
			{label}
		</span>
		<div className="oe-wf-create-control">{control}</div>
	</>
);

/**
 * "For linked notes" (which notes: this note''s link field, or notes linking here) and "For each" (a formula''s list, of
 * notes or values): Only if (notes), the name each one goes by, and the steps inside.
 */
function LoopBody({
	wf,
	path,
	step,
	scopes,
	problems,
	onChange,
}: {
	wf: WorkflowDef;
	path: string;
	step: LoopStep;
	scopes: Map<string, StepScope>;
	problems: WorkflowProblem[];
	onChange: (s: WorkflowStep) => void;
}) {
	const plugin = usePlugin();
	const { types, groups } = plugin.settings;
	const lookup = { types, groups };
	const sc = scopes.get(path) ?? scopeForNew(wf, "", 0, lookup);
	const its = loopItemTypes(step, sc.scope, types);
	const notesLoop = step.kind === "linked" || step.items === "notes";
	const innerDef = workflowDef({ scope: its.length === types.length ? [] : its.map((t) => t.key), when: step.when });
	const { rows, ctx } = useMemo(() => plugin.viewData(), [plugin]);
	const choices = useMemo(() => columnChoices(innerDef, lookup), [JSON.stringify(its.map((t) => t.key)), types]); // eslint-disable-line react-hooks/exhaustive-deps
	const typeName = its.length === 1 ? (its[0].plural || its[0].name).toLowerCase() : "notes";
	const set = (patch: Partial<LoopStep>) => onChange({ ...step, ...patch } as LoopStep);
	const src = step.kind === "linked" ? linkedSources(sc.scope, types) : null;
	const srcValue = step.kind === "linked" ? (step.source.dir === "out" ? `out:${step.source.field}` : `in:${step.source.type}:${step.source.field}`) : "";
	/** "For each": a links result loops over notes (of the link field''s type, when it has one); anything else, values. */
	const detect = (src2: string): Partial<LoopStep> => {
		try {
			const { compiled, refs } = compileFormula(src2, sc.def, lookup, { workflow: true, vars: sc.vars });
			if (compiled.type !== "links") return { items: "values", itemType: "" };
			const targets = [...refs.values()].map((r) => r.field?.targets).find((t) => t?.length);
			const ts = targets ? types.filter((t) => typeMatchesTarget(t, targets)) : [];
			return { items: "notes", itemType: ts.length === 1 ? ts[0].key : "" };
		} catch {
			return {};
		}
	};
	return (
		<div className="oe-wf-create oe-wf-loop">
			{step.kind === "linked" &&
				formRow(
					"Notes",
					<select
						className="dropdown oe-pop-select oe-wf-loop-source"
						aria-label="Which linked notes"
						value={srcValue}
						onChange={(e) => {
							const [dir, a, b] = e.target.value.split(":");
							const source: LinkedSource = dir === "in" ? { dir: "in", type: a, field: b } : { dir: "out", field: a };
							const next = { ...step, source, when: { mode: "all", items: [] } } as LoopStep;
							const t2 = loopItemTypes(next, sc.scope, types);
							// A name still from the old notes follows the new ones.
							const was = its.length === 1 ? its[0].name : "Note";
							const as = step.as.trim().toLowerCase().startsWith(was.toLowerCase()) && t2.length === 1 ? uniqueName(t2[0].name, usedNames(wf, step)) : step.as;
							onChange({ ...next, as });
						}}
					>
						{!src!.out.some((f) => `out:${f.key}` === srcValue) && !src!.in.some((x) => `in:${x.type.key}:${x.field.key}` === srcValue) && <option value={srcValue}>Choose…</option>}
						{src!.out.length > 0 && (
							<optgroup label={sc.loop === "notes" ? `${sc.defaultLabel}'s links` : "This note's links"}>
								{src!.out.map((f) => (
									<option key={f.key} value={`out:${f.key}`}>
										{f.label}
									</option>
								))}
							</optgroup>
						)}
						{src!.in.length > 0 && (
							<optgroup label={sc.loop === "notes" ? `Notes linking to ${sc.defaultLabel.toLowerCase()}` : "Notes linking here"}>
								{src!.in.map((x) => (
									<option key={`${x.type.key}:${x.field.key}`} value={`in:${x.type.key}:${x.field.key}`}>
										{x.label}
									</option>
								))}
							</optgroup>
						)}
					</select>,
				)}
			{step.kind === "each" && (
				<>
					{formRow(
						"List",
						<FormulaBox sc={sc} label="List formula" value={step.formula} placeholder='e.g. [Labels], [Team] or list("a", "b")' onChange={(v) => onChange({ ...step, formula: v, ...detect(v) } as LoopStep)} />,
						sc.noNote && !sc.loop ? "A formula that gives a list." : `A formula that gives a list. It reads ${sc.defaultLabel.toLowerCase()}.`,
					)}
					{formRow(
						"Items are",
						<select
							className="dropdown oe-pop-select"
							aria-label="Items are"
							value={step.items === "values" ? "values" : `notes:${step.itemType}`}
							onChange={(e) => {
								const v = e.target.value;
								set(v === "values" ? { items: "values", itemType: "", when: { mode: "all", items: [] } } : { items: "notes", itemType: v.slice("notes:".length) });
							}}
						>
							<option value="values">Values (text, numbers, dates)</option>
							<option value="notes:">Notes (any type)</option>
							<optgroup label="Notes of a type">
								{types.map((t) => (
									<option key={t.key} value={`notes:${t.key}`}>
										{t.plural || t.name}
									</option>
								))}
							</optgroup>
						</select>,
					)}
				</>
			)}
			{notesLoop &&
				formRow(
					"Only if",
					<div className="oe-wf-when oe-wf-loop-when">
						<FiltersPanel
							filters={step.when}
							choices={choices}
							ctx={ctx}
							valuesOf={(id) => columnValues(choices, id, rows, its)}
							thisNote={sc.noNote ? undefined : null}
							thisIs={sc.noNote ? undefined : THIS_IS}
							heading={`Only the ${typeName} that match`}
							emptyText={`No conditions: every one of the ${typeName}.`}
							onChange={(g) => set({ when: g })}
						/>
					</div>,
				)}
			{formRow(
				"Call each",
				<span className="oe-wf-inline">
					<TextInput label="Call each" className="oe-wf-text" value={step.as} placeholder={notesLoop ? "e.g. Task" : "e.g. Label"} onChange={(v) => set({ as: v })} />
					<span className="oe-tm-muted">
						{notesLoop
							? `Inside: steps act on each one and formulas read it; [${step.as.trim() || "…"}] is it, [This note] the workflow's note.`
							: `Inside: [${step.as.trim() || "…"}] is the value.`}
					</span>
				</span>,
			)}
			<div className="oe-wf-loop-steps">
				<StepList wf={wf} steps={step.steps} path={path} scopes={scopes} problems={problems} onChange={(steps) => set({ steps })} />
			</div>
		</div>
	);
}

/**
 * "If": the test (conditions on a note, picked with On; or a formula), then the steps for true (Then) and for false
 * (Otherwise), each a list of its own.
 */
function IfBody({
	wf,
	path,
	step,
	sc,
	target,
	onPicker,
	scopes,
	problems,
	onChange,
}: {
	wf: WorkflowDef;
	path: string;
	step: IfStep;
	sc: StepScope;
	target: { scope: string[]; types: EntityTypeDef[] };
	onPicker: ReactNode;
	scopes: Map<string, StepScope>;
	problems: WorkflowProblem[];
	onChange: (s: WorkflowStep) => void;
}) {
	const plugin = usePlugin();
	const { types, groups } = plugin.settings;
	const lookup = { types, groups };
	const def = workflowDef({ scope: target.scope, when: step.when });
	const { rows, ctx } = useMemo(() => plugin.viewData(), [plugin]);
	const choices = useMemo(() => columnChoices(def, lookup), [target.scope.join(","), types]); // eslint-disable-line react-hooks/exhaustive-deps
	const noun = target.types.length === 1 ? target.types[0].name.toLowerCase() : "note";
	const set = (patch: Partial<IfStep>) => onChange({ ...step, ...patch });
	return (
		<div className="oe-wf-create oe-wf-if">
			{formRow(
				<span className="oe-wf-if-label">
					<Icon name="split" /> If
				</span>,
				<span className="oe-wf-inline">
					<Segmented
						label="Test"
						value={step.test}
						options={[
							{ value: "filter", label: "Conditions" },
							{ value: "formula", label: "A formula" },
						]}
						onChange={(v) => {
							// A formula reads the note formulas read here: no On.
							const { on: _drop, ...rest } = step;
							onChange(v === "formula" ? { ...rest, test: v } : { ...step, test: v });
						}}
					/>
					{step.test === "filter" && onPicker}
				</span>,
			)}
			{step.test === "filter"
				? formRow(
						"",
						<div className="oe-wf-when oe-wf-loop-when">
							<FiltersPanel
								filters={step.when}
								choices={choices}
								ctx={ctx}
								valuesOf={(id) => columnValues(choices, id, rows, target.types)}
								thisNote={sc.noNote ? undefined : null}
								thisIs={sc.noNote ? undefined : THIS_IS}
								heading={`True when the ${noun} matches`}
								emptyText="No conditions yet: add one."
								onChange={(g) => set({ when: g })}
							/>
						</div>,
					)
				: formRow(
						"",
						<div className="oe-wf-stack">
							<FormulaBox sc={sc} label="Test formula" value={step.formula} placeholder="e.g. [Estimate] > 5 or [Total] = 0" onChange={(v) => set({ formula: v })} />
							<div className="oe-wf-help">True when it gives true, a number other than 0, or text or a list that isn't empty.</div>
						</div>,
					)}
			<div className="oe-wf-if-branches">
				<div className="oe-wf-if-columns">
					<div className="oe-wf-if-branch is-then">
						<span className="oe-wf-if-label">
							<Icon name="check" /> Then
						</span>
						<StepList wf={wf} steps={step.steps} path={path} block={0} empty="" scopes={scopes} problems={problems} onChange={(steps) => set({ steps })} />
					</div>
					<div className="oe-wf-if-branch is-otherwise">
						<span className="oe-wf-if-label">
							<Icon name="corner-down-right" /> Otherwise
						</span>
						<StepList wf={wf} steps={step.otherwise} path={path} block={1} empty="" scopes={scopes} problems={problems} onChange={(otherwise) => set({ otherwise })} />
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * "Find notes": which notes (types, conditions), in what order, all or the first, and the name later steps use. The
 * conditions can compare with this note (`{this}`), as a loop''s Only if can.
 */
function FindBody({ sc, step, onChange }: { sc: StepScope; step: FindStep; onChange: (s: WorkflowStep) => void }) {
	const plugin = usePlugin();
	const { types, groups } = plugin.settings;
	const lookup = { types, groups };
	const its = scopeTypes({ scope: step.types }, types);
	const def = workflowDef({ scope: step.types, when: step.when });
	const { rows, ctx } = useMemo(() => plugin.viewData(), [plugin]);
	const choices = useMemo(() => columnChoices(def, lookup), [step.types.join(","), types]); // eslint-disable-line react-hooks/exhaustive-deps
	const typeName = its.length === 1 ? (its[0].plural || its[0].name).toLowerCase() : "notes";
	const set = (patch: Partial<FindStep>) => onChange({ ...step, ...patch });
	const name = step.as.trim() || "…";
	const sortBy = step.sort?.by ?? "name";
	const sortGroups = [...new Set(choices.map((c) => c.group))];
	return (
		<div className="oe-wf-create oe-wf-find">
			{formRow(
				"Notes",
				<TargetPicker
					values={step.types}
					types={types}
					groups={groups}
					onChange={(v) => {
						// Other types, other columns: the conditions and order start again.
						const { sort: _drop, ...rest } = step;
						onChange({ ...rest, types: v.filter((x) => x !== "*"), when: { mode: "all", items: [] } });
					}}
				/>,
			)}
			{formRow(
				"That match",
				<div className="oe-wf-when oe-wf-loop-when">
					<FiltersPanel
						filters={step.when}
						choices={choices}
						ctx={ctx}
						valuesOf={(id) => columnValues(choices, id, rows, its)}
						thisNote={sc.noNote ? undefined : null}
						thisIs={sc.noNote ? undefined : THIS_IS}
						heading={`The ${typeName} that match`}
						emptyText={`No conditions: every one of the ${typeName}.`}
						onChange={(g) => set({ when: g })}
					/>
				</div>,
			)}
			{formRow(
				"Sorted by",
				<span className="oe-wf-inline">
					<select className="dropdown oe-pop-select oe-wf-find-sort" aria-label="Sorted by" value={sortBy} onChange={(e) => set({ sort: { by: e.target.value, dir: step.sort?.dir ?? "asc" } })}>
						{sortGroups.map((g) => (
							<optgroup key={g} label={g}>
								{choices
									.filter((c) => c.group === g)
									.map((c) => (
										<option key={c.col.id} value={c.col.id}>
											{c.col.label}
										</option>
									))}
							</optgroup>
						))}
						{!choices.some((c) => c.col.id === sortBy) && <option value={sortBy}>{sortBy}</option>}
					</select>
					<Segmented
						label="Order"
						value={step.sort?.dir ?? "asc"}
						options={[
							{ value: "asc", label: "Ascending" },
							{ value: "desc", label: "Descending" },
						]}
						onChange={(dir) => set({ sort: { by: sortBy, dir } })}
					/>
				</span>,
			)}
			{formRow(
				"Keep",
				<span className="oe-wf-inline">
					<Segmented
						label="Keep"
						value={step.keep}
						options={[
							{ value: "all", label: "All of them" },
							{ value: "first", label: "The first one" },
						]}
						onChange={(keep) => {
							const { limit: _drop, ...rest } = step;
							onChange(keep === "first" ? { ...rest, keep } : { ...step, keep });
						}}
					/>
					{step.keep === "all" && (
						<>
							<span className="oe-wf-to">at most</span>
							<input
								type="number"
								className="oe-wf-number"
								aria-label="At most"
								min={1}
								step={1}
								placeholder="any number"
								value={step.limit ?? ""}
								onChange={(e) => {
									const n = e.target.value === "" ? undefined : Number(e.target.value);
									const { limit: _drop, ...rest } = step;
									onChange(n === undefined || Number.isNaN(n) ? rest : { ...rest, limit: n });
								}}
							/>
						</>
					)}
				</span>,
			)}
			{formRow(
				step.keep === "first" ? "Call it" : "Call them",
				<span className="oe-wf-inline">
					<TextInput label="Call them" className="oe-wf-text" value={step.as} placeholder={step.keep === "first" ? "e.g. Inbox" : "e.g. Overdue tasks"} onChange={(v) => set({ as: v })} />
					<span className="oe-tm-muted">
						{step.keep === "first"
							? `Later steps use [${name}], and can act on it (On). If none match, steps on it are skipped.`
							: `Later steps use [${name}], a list of notes: e.g. For each over it, or count([${name}]).`}
					</span>
				</span>,
			)}
		</div>
	);
}

/** "Run another workflow": which one (the ones for this note''s types first); it runs in this run, its Only if checked. */
function RunBody({ wf, types, step, onChange }: { wf: WorkflowDef; types: EntityTypeDef[]; step: Extract<WorkflowStep, { kind: "run" }>; onChange: (s: WorkflowStep) => void }) {
	const plugin = usePlugin();
	const others = plugin.settings.workflows.filter((w) => w.id !== wf.id);
	const fits = (w: WorkflowDef) => !types.length || types.some((t) => inScope(w, t));
	const list = (ws: WorkflowDef[]) =>
		ws.map((w) => (
			<option key={w.id} value={w.id}>
				{w.name}
			</option>
		));
	return (
		<span className="oe-wf-inline">
			<select className="dropdown oe-pop-select oe-wf-run-pick" aria-label="Workflow to run" value={step.workflow} onChange={(e) => onChange({ ...step, workflow: e.target.value })}>
				{!others.some((w) => w.id === step.workflow) && <option value={step.workflow}>{step.workflow ? "(deleted)" : "Choose…"}</option>}
				{others.some(fits) && <optgroup label="For these notes">{list(others.filter(fits))}</optgroup>}
				{others.some((w) => !fits(w)) && <optgroup label="Other workflows">{list(others.filter((w) => !fits(w)))}</optgroup>}
			</select>
			<span className="oe-tm-muted">Its steps run as part of this run (one undo); its Only if is checked first.</span>
		</span>
	);
}

type CreateStep = Extract<WorkflowStep, { kind: "create" }>;

/**
 * "Create a note": its type (or a plain note, with no type), name (a template), and then, for a type: starting fields
 * (picked or formulas), the link between it and the note the step is for (this note, or each note in a loop), and the
 * type''s template; for a plain note: its folder and body. Then whether it opens, what to do when it already exists,
 * and the name later steps call it.
 */
function CreateBody({ wf, sc, step, onChange }: { wf: WorkflowDef; sc: StepScope; step: CreateStep; onChange: (s: WorkflowStep) => void }) {
	const plugin = usePlugin();
	const { types, groups } = plugin.settings;
	const plain = step.type === PLAIN_NOTE;
	const type = types.find((t) => t.key === step.type);
	const nf = type ? workflowFields({ scope: [type.key] }, types).filter((f) => f.key !== COMMON_KEYS.tags) : [];
	const links = createLinkOptions({ scope: sc.scope }, step.type, types);
	const set = (patch: Partial<CreateStep>) => onChange({ ...step, ...patch });
	const typeName = type?.name.toLowerCase() ?? "note";
	const selection = sc.vars.some((v) => v.role === "selection");
	const which = sc.loop === "notes" ? sc.defaultLabel.replace(/^Each /, "the ") : sc.noNote ? (selection ? "the selected notes" : "the form's answers") : "this note";
	const setType = (key: string) => {
		const t = types.find((x) => x.key === key);
		// Another kind of note: its fields, link, folder and body start again (not linked).
		const { link: _l, folder: _f, body: _b, ...rest } = step;
		// A name still the default for the old type follows the new one.
		const wasDefault = step.as.trim().toLowerCase().startsWith(`new ${typeName}`);
		const as = wasDefault ? uniqueName(`New ${(t?.name ?? "note").toLowerCase()}`, usedNames(wf, step)) : step.as;
		onChange({ ...rest, type: key, fields: [], as });
	};
	const linkValue = step.link ? `${step.link.dir}:${step.link.field}` : "";
	const bodyFrom = step.body?.from ?? "empty";
	return (
		<div className="oe-wf-create">
			{formRow(
				"Type",
				<select className="dropdown oe-pop-select" aria-label="Type of note" value={step.type} onChange={(e) => setType(e.target.value)}>
					<option value={PLAIN_NOTE}>Plain note (no type)</option>
					{!type && !plain && <option value={step.type}>{step.type}</option>}
					{groups.map((g) => {
						const list = types.filter((t) => t.group === g.key);
						return list.length ? (
							<optgroup key={g.key} label={g.name}>
								{list.map((t) => (
									<option key={t.key} value={t.key}>
										{t.name}
									</option>
								))}
							</optgroup>
						) : null;
					})}
				</select>,
			)}
			{formRow("Name", <FormulaBox sc={sc} template label="Note name" value={step.name} placeholder={`New ${typeName}  ·  e.g. {[Name]} kick-off`} onChange={(v) => set({ name: v })} />, `Text with {formula} parts. Empty: “New ${typeName}”.`)}
			{plain &&
				formRow(
					"Folder",
					<FormulaBox sc={sc} template label="Folder" value={step.folder ?? ""} placeholder="Obsidian's default location  ·  e.g. Inbox/{year(today())}" onChange={(v) => onChange(v ? { ...step, folder: v } : (({ folder: _f, ...rest }) => rest)(step))}>
						<button
							className="oe-wf-fxbtn"
							title="Pick a folder"
							aria-label="Pick a folder"
							onClick={() => new FolderPickerModal(plugin, (f) => set({ folder: f.isRoot() ? "/" : f.path.replace(/[{}]/g, (c) => c + c) }), "Create it in…").open()}
						>
							<Icon name="folder" />
						</button>
					</FormulaBox>,
					"Text with {formula} parts; / is the vault's top folder. Empty: where Obsidian puts new notes (Settings → Files and links).",
				)}
			{!plain &&
				formRow(
					"Fields",
					<div className="oe-wf-create-fields">
						{step.fields.map((r, i) => {
							const f = nf.find((x) => x.key === r.field);
							const setRow = (next: CreateField) => set({ fields: step.fields.map((x, j) => (j === i ? next : x)) });
							return (
								<div key={i} className="oe-wf-create-field" data-create-field={r.field}>
									<FieldSelect label="Field" value={r.field} fields={nf.filter((x) => x.key === r.field || !step.fields.some((y) => y.field === x.key))} onChange={(k) => setRow({ field: k, value: "", fixed: defaultFixed(nf.find((x) => x.key === k)) })} />
									<span className="oe-wf-to">=</span>
									<StepValue
										sc={sc}
										types={type ? [type] : []}
										field={f}
										preview={false}
										fixed={r.fixed}
										formula={r.value}
										title={`${type?.name ?? "New note"}: ${f?.label ?? r.field}`}
										placeholder={valueHint(f)}
										onChange={(v) => setRow("fixed" in v ? { field: r.field, value: "", fixed: v.fixed } : { field: r.field, value: v.formula })}
									/>
									<button className="clickable-icon" aria-label={`Remove ${f?.label ?? r.field}`} onClick={() => set({ fields: step.fields.filter((_, j) => j !== i) })}>
										<Icon name="x" />
									</button>
								</div>
							);
						})}
						{nf.some((x) => !step.fields.some((y) => y.field === x.key)) && (
							<select
								className="dropdown oe-pop-select oe-wf-add-field"
								aria-label="Add a field"
								value=""
								onChange={(e) => {
									const f = nf.find((x) => x.key === e.target.value);
									if (f) set({ fields: [...step.fields, { field: f.key, value: "", fixed: defaultFixed(f) }] });
								}}
							>
								<option value="" hidden>
									+ Add a field
								</option>
								{nf
									.filter((x) => !step.fields.some((y) => y.field === x.key))
									.map((x) => (
										<option key={x.key} value={x.key}>
											{x.label}
										</option>
									))}
							</select>
						)}
					</div>,
					`The new note's values. Formulas read ${which}.`,
				)}
			{!plain &&
				formRow(
					"Link",
					sc.noNote && !step.link ? (
						selection ? (
							<span className="oe-tm-muted">No single note to link it to here: link the selected notes to it inside a For each over [{SELECTION_VAR}] (Add or remove a link, to [{step.as.trim() || "the new note"}]).</span>
						) : (
							<span className="oe-tm-muted">The form has no note to link it to: set its link fields under Fields (e.g. to [Campaign], a note the form picks), or add a link to it on that note (Add or remove a link, On the note).</span>
						)
					) : (
						<select
							className="dropdown oe-pop-select oe-wf-create-link"
							aria-label="Link"
							value={linkValue}
							onChange={(e) => {
								const [dir, field] = e.target.value.split(":") as [CreateLink["dir"], string];
								const { link: _l, ...rest } = step;
								onChange(e.target.value ? { ...rest, link: { dir, field } } : rest);
							}}
						>
							<option value="">Don't link it to {which}</option>
							{links.fromNew.length > 0 && (
								<optgroup label={`The new ${typeName}'s field → ${which}`}>
									{links.fromNew.map((f) => (
										<option key={f.key} value={`from-new:${f.key}`}>
											{f.label}
										</option>
									))}
								</optgroup>
							)}
							{links.toNew.length > 0 && (
								<optgroup label={`${which[0].toUpperCase()}${which.slice(1)}'s field → the new ${typeName}`}>
									{links.toNew.map((f) => (
										<option key={f.key} value={`to-new:${f.key}`}>
											{f.label}
										</option>
									))}
								</optgroup>
							)}
							{step.link && !(step.link.dir === "from-new" ? links.fromNew : links.toNew).some((f) => f.key === step.link!.field) && <option value={linkValue}>{step.link.field}</option>}
						</select>
					),
				)}
			{plain
				? formRow(
						"Body",
						<div className="oe-wf-stack oe-wf-create-body">
							<Segmented
								label="Body"
								value={bodyFrom}
								options={[
									{ value: "empty", label: "Empty" },
									{ value: "template", label: "A template note" },
									{ value: "text", label: "Text" },
								]}
								onChange={(v) => {
									const { body: _b, ...rest } = step;
									onChange(v === "template" ? { ...rest, body: { from: "template", path: "" } } : v === "text" ? { ...rest, body: { from: "text", text: "" } } : rest);
								}}
							/>
							{step.body?.from === "template" && (
								<span className="oe-wf-inline">
									<button
										className="oe-wf-template-pick"
										aria-label="Choose the template note"
										onClick={() => new NotePathPickerModal(plugin, (f) => set({ body: { from: "template", path: f.path.replace(/\.md$/i, "") } }), "Template note…").open()}
									>
										<Icon name="file-text" /> {step.body.path || "Choose a note…"}
									</button>
									<span className="oe-tm-muted">Its text, with {"{{title}}"}, {"{{date}}"} and {"{{time}}"} filled in.</span>
								</span>
							)}
							{step.body?.from === "text" && (
								<FormulaBox sc={sc} template multiline label="Body text" value={step.body.text} placeholder="e.g. Notes from {[Name]}" onChange={(v) => set({ body: { from: "text", text: v } })} />
							)}
						</div>,
					)
				: formRow(
						"Body",
						<span className="oe-wf-inline">
							<Toggle label="Use the type's template" value={step.template} onChange={(v) => set({ template: v })} />
							<span className="oe-tm-muted">{step.template ? "From the type's template" : "Empty"}</span>
						</span>,
					)}
			{formRow(
				"Open it",
				<Segmented
					label="Open it"
					value={step.open}
					options={[
						{ value: "no", label: "No" },
						{ value: "tab", label: "New tab" },
						{ value: "current", label: "This tab" },
					]}
					onChange={(v) => set({ open: v })}
				/>,
			)}
			{formRow(
				"If it exists",
				<select className="dropdown oe-pop-select" aria-label="If it already exists" value={step.exists} onChange={(e) => set({ exists: e.target.value as CreateStep["exists"] })}>
					<option value="new">Create another</option>
					<option value="use">Use the existing one</option>
					<option value="stop">Stop the run</option>
				</select>,
				plain ? "A note with the same name in that folder. Create another: its name gets “ 2”, “ 3”…" : "A note of this type with the same name, where it would be created. Create another: its name gets “ 2”, “ 3”…",
			)}
			{formRow(
				"Call it",
				<span className="oe-wf-inline">
					<TextInput label="Call it" className="oe-wf-text" value={step.as} placeholder={`New ${typeName}`} onChange={(v) => set({ as: v })} />
					<span className="oe-tm-muted">Later steps: “On {step.as.trim() || "…"}”, and [{step.as.trim() || "…"}] in formulas</span>
				</span>,
			)}
		</div>
	);
}

/** A hint for a value box, by the field's kind. */
function valueHint(f: WorkflowField | undefined): string {
	switch (f?.kind) {
		case "date":
			return "e.g. today() or [Due] + 7";
		case "number":
			return "e.g. [Estimate] * 2";
		case "boolean":
			return "true or false";
		case "status":
		case "select":
			return 'e.g. "done"';
		case "relation":
			return 'e.g. "Apollo" or [Project]';
		default:
			return 'e.g. "text" or concat([Name], "!")';
	}
}

/**
 * What [ ] offers: the run's names first (this note, loop items, created and found notes, variables), then the
 * columns formulas read here, grouped like the field pickers: Built-in (Name, Status, Type, Created…) and Fields.
 */
function insertableFields(sc: StepScope, lookup: { types: EntityTypeDef[]; groups: GroupDef[] }): { group: string; labels: string[] }[] {
	const def = sc.def;
	const named = varGroups(sc.vars).map((g) => ({ group: g.title, labels: g.vars.map((v) => v.name) }));
	// No single note (a run for the whole selection): only named notes and values can be read.
	if (sc.noNote) return named;
	const cols = availableColumns(def, lookup);
	const labels = (list: ColumnDef[]) => [...new Set(list.map((c) => resolveColumn(c, def, lookup).label))];
	// In a loop of notes (or a loop inside one), the columns are each one's.
	const of = sc.item ? ` of ${sc.defaultLabel.toLowerCase()}` : "";
	return [...named, { group: `Built-in${of}`, labels: labels([{ kind: "builtin", id: "name", key: "name" } as ColumnDef, ...cols.builtins]) }, { group: `Fields${of}`, labels: labels(cols.fields) }].filter((g) => g.labels.length);
}

/**
 * The [ ] button: looks like the field pickers and opens the same grouped dropdown (a native select laid over the
 * icon); picking a field calls `onPick` with its label.
 */
function InsertFieldButton({ sc, onPick }: { sc: StepScope; onPick: (label: string) => void }) {
	const plugin = usePlugin();
	const groups = insertableFields(sc, { types: plugin.settings.types, groups: plugin.settings.groups });
	return (
		<span className="oe-wf-fxbtn oe-wf-insert" title="Insert a field">
			<Icon name="brackets" />
			<select
				className="dropdown"
				aria-label="Insert a field"
				value=""
				onChange={(e) => {
					const v = e.target.value;
					if (v) onPick(v);
				}}
			>
				<option value="" hidden>
					Insert a field
				</option>
				{groups.map((g) => (
					<optgroup key={g.group} label={g.group}>
						{g.labels.map((l) => (
							<option key={l} value={l}>
								{l}
							</option>
						))}
					</optgroup>
				))}
			</select>
		</span>
	);
}
/**
 * A step's value: picked like a filter's value (pills, a date, a number, notes…) for the field's kind, or a formula.
 * [ ] puts a field in (as a formula); ƒx opens the formula editor; ↺ goes back to a picked value.
 */
function StepValue({
	sc,
	types,
	field,
	preview = true,
	fixed,
	formula,
	title,
	placeholder,
	multiple,
	onChange,
}: {
	/** what formulas read and the names they can use */
	sc: StepScope;
	/** the types of the note the value goes in (their statuses) */
	types: EntityTypeDef[];
	field: WorkflowField | undefined;
	/** the formula editor's preview checks the value fits this note's field (not for other notes' fields) */
	preview?: boolean;
	fixed: FixedValue | undefined;
	formula: string;
	title: string;
	placeholder: string;
	/** notes to link (many, whatever the field holds) */
	multiple?: boolean;
	onChange: (v: { fixed: FixedValue } | { formula: string }) => void;
}) {
	const plugin = usePlugin();
	const editor = (src: string) =>
		FormulaModal.forWorkflow(plugin, sc.def, {
			title,
			value: src,
			vars: sc.vars,
			variables: sc.variables,
			...editorContext(sc),
			field: multiple || !preview ? undefined : field,
			done: (v) => onChange({ formula: v }),
		}).open();
	const fxButton = (src: string) => (
		<button className="oe-wf-fxbtn oe-wf-fx" aria-label="Use a formula" onClick={() => editor(src)}>
			<span className="oe-wf-fx-label">ƒx</span>
		</button>
	);
	if (fixed !== undefined && field)
		return (
			<div className="oe-wf-value">
				<FixedInput types={types} field={field} value={fixed} multiple={multiple} onChange={(v) => onChange({ fixed: v })} />
				<span className="oe-wf-value-btns">
					<InsertFieldButton sc={sc} onPick={(label) => onChange({ formula: `[${label}]` })} />
					{fxButton(formulaFromFixed(fixed, field))}
				</span>
			</div>
		);
	return (
		<FormulaBox sc={sc} value={formula} placeholder={placeholder} title={title} field={multiple || !preview ? undefined : field} onChange={(v) => onChange({ formula: v })}>
			{field && (
				<button
					className="oe-wf-fxbtn"
					aria-label="Pick a value instead"
					onClick={() => onChange({ fixed: (multiple ? undefined : fixedFromFormula(formula, field)) ?? defaultFixed(multiple ? { ...field, kind: "relation" } : field) })}
				>
					<Icon name="rotate-ccw" />
				</button>
			)}
		</FormulaBox>
	);
}

/** A picked value, with the same inputs as filter values: pills for status and choices, a date, a number, notes. */
function FixedInput({ types: noteTypes, field, value, multiple, onChange }: { types: EntityTypeDef[]; field: WorkflowField; value: FixedValue; multiple?: boolean; onChange: (v: FixedValue) => void }) {
	const plugin = usePlugin();
	const { types, groups } = plugin.settings;
	const list = Array.isArray(value) ? value : value === "" ? [] : [String(value)];
	switch (field.kind) {
		case "status":
		case "select":
		case "multiselect": {
			// The properties form's choice control: the value as a pill in its colour, a dropdown of the choices.
			const many = field.kind === "multiselect";
			const options = field.kind === "status" ? statusUnion(noteTypes, groups) : (field.field?.options ?? []);
			const choice = field.kind === "status" ? { kind: "select" as const, colors: statusColors(options, types, groups) } : field.field;
			return (
				<span className="oe-wf-pick" role="group" aria-label="Value">
					<ChoiceControl
						options={options}
						value={many ? list : (list[0] ?? null)}
						editable
						multiple={many}
						label={field.label}
						field={choice}
						onCommit={(v) => onChange(many ? (Array.isArray(v) ? v.map(String) : []) : v === null || v === undefined ? "" : String(v))}
					/>
				</span>
			);
		}
		case "boolean":
			return (
				<label className="oe-wf-check">
					<input type="checkbox" checked={value === true} aria-label="Ticked" onChange={(e) => onChange(e.target.checked)} />
					{value === true ? "Ticked" : "Not ticked"}
				</label>
			);
		case "number":
			return (
				<input
					type="text"
					inputMode="decimal"
					className="oe-pop-input is-number"
					aria-label="Value"
					value={String(value)}
					onChange={(e) => {
						const n = Number(e.target.value);
						onChange(e.target.value.trim() !== "" && Number.isFinite(n) ? n : e.target.value);
					}}
				/>
			);
		case "date":
			return <DateBox label="Date" picker value={value} ctx={{ dates: plugin.dates, today: todayDays() }} onChange={onChange} />;
		case "relation":
			return <LinkValues chips targets={field.field?.targets} value={list} single={!multiple && !!field.field && !isListValued(field.field)} onChange={onChange} />;
		case "list":
			return <ListInput value={list} onChange={onChange} />;
		default:
			return <input type="text" className="oe-pop-input oe-wf-text" aria-label="Value" value={String(value)} placeholder="Text" onChange={(e) => onChange(e.target.value)} />;
	}
}

/** A text list typed with commas ("a, b"). */
function ListInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
	const [text, setText] = useState(value.join(", "));
	const split = (s: string) =>
		s
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean);
	// Follow the value when it changes from outside (e.g. steps reordered), keeping a half-typed list otherwise.
	useEffect(() => {
		if (split(text).join("\n") !== value.join("\n")) setText(value.join(", "));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value.join("\n")]);
	return (
		<input
			type="text"
			className="oe-pop-input oe-wf-text"
			aria-label="Values, separated by commas"
			placeholder="a, b, c"
			value={text}
			onChange={(e) => {
				setText(e.target.value);
				onChange(split(e.target.value));
			}}
		/>
	);
}

/**
 * A formula (or, with `template`, text with {formula} parts) box: monospace, checked as you type, with [ ] to insert
 * a field at the cursor, and any other buttons after it.
 */
function FormulaBox({
	sc,
	value,
	placeholder,
	template,
	label,
	title,
	field,
	multiline,
	onChange,
	children,
}: {
	sc: StepScope;
	value: string;
	placeholder?: string;
	template?: boolean;
	label?: string;
	/** the formula editor's title (else from the label) */
	title?: string;
	/** the field the formula's result goes in: the formula editor's preview shows what it would store */
	field?: WorkflowField;
	/** several lines (a text box that grows), e.g. a note's body */
	multiline?: boolean;
	onChange: (v: string) => void;
	children?: ReactNode;
}) {
	const plugin = usePlugin();
	const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	const lookup = { types: plugin.settings.types, groups: plugin.settings.groups };
	const { def, vars } = sc;
	let error: string | null = null;
	if (value.trim())
		try {
			if (template) {
				for (const p of parseTemplate(value)) if ("formula" in p) compileFormula(p.formula, def, lookup, { workflow: true, vars });
			} else compileFormula(value, def, lookup, { workflow: true, vars });
			if (sc.noNote && readsNote(value, def, lookup, vars, template))
				error = sc.vars.some((v) => v.role === "selection") ? "There's no single note here, so a formula can't read its fields: use [Selected notes], or a note an earlier step creates." : NO_NOTE_FORMULA_FORM;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	// The box keeps its cursor when the dropdown takes focus: insert there.
	const insert = (label: string) => {
		const el = ref.current;
		const from = el?.selectionStart ?? value.length;
		const to = el?.selectionEnd ?? value.length;
		const text = template ? `{[${label}]}` : `[${label}]`;
		onChange(value.slice(0, from) + text + value.slice(to));
		window.setTimeout(() => {
			el?.focus();
			el?.setSelectionRange(from + text.length, from + text.length);
		}, 0);
	};
	/**
	 * ƒx: the formula editor, on the whole formula; in text, on the {…} part the cursor is in, or a new one put in at
	 * the cursor.
	 */
	const openEditor = () => {
		const el = ref.current;
		const at = el?.selectionStart ?? value.length;
		const part = template ? templatePartAt(value, at) : { from: 0, to: value.length };
		const name = label ?? (template ? "Text" : "Formula");
		FormulaModal.forWorkflow(plugin, def, {
			title: title ?? (template ? `${name}: ${part ? "a {formula} part" : "add a {formula} part"}` : name),
			value: part ? value.slice(part.from, part.to) : "",
			vars,
			variables: sc.variables,
			...editorContext(sc),
			field: template ? undefined : field,
			done: (v) => {
				if (part) return onChange(value.slice(0, part.from) + v + value.slice(part.to));
				if (!v.trim()) return;
				const end = el?.selectionEnd ?? at;
				onChange(`${value.slice(0, at)}{${v}}${value.slice(end)}`);
			},
		}).open();
	};
	return (
		<div className={`oe-wf-formula${error ? " is-invalid" : ""}`}>
			<div className={`oe-wf-formula-row${multiline ? " is-multiline" : ""}`}>
				{multiline ? (
					<textarea ref={ref} className="oe-wf-formula-input" aria-label={label ?? "Text"} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
				) : (
					<input ref={ref} type="text" className="oe-wf-formula-input" aria-label={label ?? (template ? "Text" : "Formula")} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
				)}
				<InsertFieldButton sc={sc} onPick={insert} />
				<button className="oe-wf-fxbtn oe-wf-fx" aria-label="Open the formula editor" title={template ? "Open the formula editor (for the {…} part the cursor is in, or a new one)" : "Open the formula editor"} onClick={openEditor}>
					<span className="oe-wf-fx-label">ƒx</span>
				</button>
				{children}
			</div>
			{error && <div className="oe-wf-formula-error">{error}</div>}
		</div>
	);
}
const changesText = (changes: { key: string; before: unknown; after: unknown }[]) => changes.map((c) => `${c.key}: ${valueText(c.before)} → ${valueText(c.after)}`).join("; ");
const addedText = (n: number) => (n === 1 ? "added text" : `added text (${n} times)`);

/** A note's name, opening it (Ctrl/Cmd: a new tab); struck through when it's gone (an undone created note). */
function NoteLink({ path, name }: { path: string; name: string }) {
	const plugin = usePlugin();
	const exists = !!plugin.app.vault.getAbstractFileByPath(path);
	return exists ? (
		<a
			href="#"
			className="oe-wf-run-note"
			onClick={(e) => {
				e.preventDefault();
				plugin.openPath(path, e.nativeEvent);
			}}
		>
			{name}
		</a>
	) : (
		<span className="oe-wf-run-gone">{name}</span>
	);
}

/** Runs, newest first: when, the note, what changed (or the error / why it stopped), with Undo. */
function RunList({ runs, showWorkflow, empty = "No runs yet." }: { runs: RunRecord[]; showWorkflow?: boolean; empty?: string }) {
	const plugin = usePlugin();
	if (!runs.length) return <div className="oe-tm-muted">{empty}</div>;
	return (
		<div className="oe-wf-runs">
			{runs.map((r) => {
				// A note the run moved is linked where it went (until the run is undone).
				const now = (p: string) => (r.undone ? p : (r.moved?.find((m) => m.from === p)?.to ?? p));
				const ownMove = r.moved?.find((m) => m.from === r.path);
				const otherMoves = (r.moved ?? []).filter((m) => m.from !== r.path && !r.others?.some((o) => o.path === m.from));
				const moveOf = (p: string) => r.moved?.find((m) => m.from === p);
				return (
					<div key={r.id} className={`oe-wf-run${r.error ? " is-error" : r.stopped ? " is-stopped" : ""}${r.undone ? " is-undone" : ""}`}>
						<span className="oe-wf-run-time">{when(r.time)}</span>
						<span className="oe-wf-run-what">
							{showWorkflow && <span className="oe-wf-run-name">{r.name} · </span>}
							{r.selection ? (
								<span className="oe-wf-run-note is-selection" title={r.selection.map((p) => (p.split("/").pop() ?? p).replace(/\.md$/, "")).join(", ")}>
									{r.note}
								</span>
							) : !r.path ? (
								<span className="oe-wf-run-note is-form">{r.note}</span>
							) : (
								<NoteLink path={now(r.path)} name={r.note} />
							)}
							<span className="oe-wf-run-detail">
								{r.error
									? ` — ${r.error}`
									: r.stopped
										? ` — ${r.stopped}`
										: r.changes.length || r.added
											? ` — ${[...(r.changes.length ? [changesText(r.changes)] : []), ...(r.added ? [addedText(r.added)] : [])].join("; ")}`
											: r.created?.length || r.others?.length || r.moved?.length
												? ""
												: r.notices.length
													? ` — notice: ${r.notices.join(" / ")}`
													: " — no changes"}
								{!r.error && !r.stopped && ownMove ? ` — ${movedText(ownMove.from, ownMove.to)}` : ""}
								{!r.error && !r.stopped && r.asked?.length ? ` (asked: ${r.asked.map((q) => `“${q}” Yes`).join(", ")})` : ""}
								{!r.error && !r.stopped && r.inputs?.length ? ` (answered: ${r.inputs.map((a) => `“${a.question}” “${a.answer}”`).join(", ")})` : ""}
							</span>
							{!r.error && !r.stopped && (r.created ?? []).map((n) => (
								<span key={n.path} className="oe-wf-run-detail">
									{" — created "}
									<NoteLink path={n.path} name={n.name} />
								</span>
							))}
							{!r.error && !r.stopped && (r.others ?? []).map((n) => {
								const m = moveOf(n.path);
								return (
									<span key={n.path} className="oe-wf-run-detail">
										{" — "}
										<NoteLink path={now(n.path)} name={n.name} />
										{`: ${[...(n.changes.length ? [changesText(n.changes)] : []), ...(n.added ? [addedText(n.added)] : [])].join("; ")}${m ? `, ${movedText(m.from, m.to)}` : ""}`}
									</span>
								);
							})}
							{!r.error && !r.stopped && otherMoves.map((m) => (
								<span key={m.from} className="oe-wf-run-detail">
									{" — "}
									<NoteLink path={now(m.from)} name={(m.from.split("/").pop() ?? m.from).replace(/\.md$/, "")} />
									{` ${movedText(m.from, m.to)}`}
								</span>
							))}
						</span>
						{r.undone ? (
							<span className="oe-tm-muted">undone</span>
						) : plugin.workflows.canUndo(r.id) ? (
							<button className="oe-wf-run-undo" onClick={() => void plugin.workflows.undo([r.id])}>
								Undo
							</button>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
