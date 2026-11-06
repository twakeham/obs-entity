import { Menu, Notice } from "obsidian";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { statusUnion } from "../../../model/bulk";
import { COMMON_KEYS } from "../../../model/types";
import { availableColumns, compileFormula, resolveColumn, type ColumnDef } from "../../../model/views";
import {
	cloneWorkflow,
	listsValues,
	needsScope,
	newWorkflow,
	parseTemplate,
	scopeTypes,
	STEP_LABELS,
	triggerText,
	workflowDef,
	workflowFields,
	workflowProblems,
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
import { FiltersPanel, type ColumnChoice } from "../table/popovers";
import { ConfirmModal, SaveActions } from "../types/TypeManager";
import { IconPicker, Row, Section, Segmented, TargetPicker, TextInput, Toggle } from "../types/controls";

export interface WorkflowsState {
	/** a workflow id, "new:<n>" for an unsaved one, "runs" for Recent runs, or null */
	selected: string | null;
}
export const DEFAULT_WORKFLOWS_STATE: WorkflowsState = { selected: null };

/** A request to open the view on something: a workflow, or a new one for a type. */
export interface WorkflowsRequest {
	open?: string;
	newFor?: string;
}

const TRIGGER_GROUPS: { kind: TriggerKind; title: string; icon: string }[] = [
	{ kind: "created", title: "When created", icon: "file-plus" },
	{ kind: "changed", title: "When changed", icon: "pencil" },
	{ kind: "manual", title: "Run on notes", icon: "mouse-pointer-click" },
];
const TRIGGER_OPTIONS: { value: TriggerKind; label: string; icon: string }[] = [
	{ value: "changed", label: "Field changes", icon: "pencil" },
	{ value: "created", label: "Note created", icon: "file-plus" },
	{ value: "manual", label: "Run on notes", icon: "mouse-pointer-click" },
];
const STEP_ICONS: Record<StepKind, string> = { set: "pencil-line", clear: "eraser", tag: "tag", link: "link", notice: "message-square" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const when = (t: number) => {
	const d = new Date(t);
	const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
};
const valueText = (v: unknown) => (v === undefined || v === null || v === "" ? "empty" : Array.isArray(v) ? (v.length ? v.join(", ") : "empty") : String(v));

/**
 * The Workflows view (DESIGN §8.11): every workflow in a sidebar, grouped by what starts it, with Pause all and
 * Recent runs; the selected one in an editor (When / Only if / Do) with the type editor's draft and save bar.
 */
export function WorkflowManager({ state, setState, request, onRequestDone }: { state: WorkflowsState; setState: (p: Partial<WorkflowsState>) => void; request: WorkflowsRequest | null; onRequestDone: () => void }) {
	const plugin = usePlugin();
	const settings = plugin.settings;
	const [, setTick] = useState(0);
	const [search, setSearch] = useState("");
	const drafts = plugin.workflowDrafts;
	const refresh = () => setTick((t) => t + 1);
	useEffect(() => {
		const ref = plugin.workflows.on("log", refresh);
		return () => plugin.workflows.offref(ref);
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
		else if (request.open) setState({ selected: request.open });
		onRequestDone();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [request]);

	const saved = settings.workflows;
	const listed: { id: string; wf: WorkflowDef; isNew: boolean }[] = [
		...saved.map((w) => ({ id: w.id, wf: drafts.get(w.id) ?? w, isNew: false })),
		...[...drafts.entries()].filter(([id]) => id.startsWith("new:")).map(([id, wf]) => ({ id, wf, isNew: true })),
	];
	const q = search.trim().toLowerCase();
	const shown = listed.filter((x) => !q || x.wf.name.toLowerCase().includes(q) || triggerText(x.wf, settings.types).toLowerCase().includes(q));
	const selected = listed.find((x) => x.id === state.selected);
	const scopeText = (wf: WorkflowDef) => (wf.scope.length ? scopeTypes(wf, settings.types).map((t) => t.plural || t.name).join(", ") || wf.scope.join(", ") : "Any note");

	return (
		<div className="oe-tm oe-wf">
			<aside className="oe-tm-sidebar">
				<div className="oe-tm-sidebar-head">
					<input type="search" placeholder="Search workflows…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search workflows" />
					<button className="mod-cta" onClick={() => newDraft()} aria-label="New workflow">
						<Icon name="plus" /> New
					</button>
				</div>
				<div className={`oe-wf-pause${settings.workflowsPaused ? " is-paused" : ""}`}>
					<Toggle label="Pause all workflows" value={settings.workflowsPaused} onChange={(v) => void plugin.workflows.setPaused(v).then(refresh)} />
					<span>{settings.workflowsPaused ? "All workflows are paused" : "Pause all workflows"}</span>
				</div>
				<div className="oe-tm-typelist">
					{TRIGGER_GROUPS.map((g) => {
						const items = shown.filter((x) => x.wf.trigger.kind === g.kind);
						if (!items.length && q) return null;
						return (
							<div key={g.kind} className="oe-tm-typegroup">
								<div className="oe-tm-typegroup-title is-static">
									<Icon name={g.icon} />
									<span className="oe-tm-typename">{g.title}</span>
								</div>
								{items.map(({ id, wf, isNew }) => {
									const problems = workflowProblems(wf, settings);
									const dirty = drafts.has(id) && (isNew || !sameJson(drafts.get(id), saved.find((w) => w.id === id)));
									return (
										<button key={id} data-workflow={id} className={`oe-tm-typeitem oe-wf-item${id === state.selected ? " is-selected" : ""}${wf.on ? "" : " is-off"}`} onClick={() => setState({ selected: id })}>
											<span className={`oe-wf-dot${wf.on && !settings.workflowsPaused ? " is-on" : ""}`} aria-label={wf.on ? "On" : "Off"} />
											<span className="oe-wf-item-text">
												<span className="oe-tm-typename">{wf.name || "New workflow"}</span>
												<span className="oe-wf-item-scope">{scopeText(wf)}</span>
											</span>
											{isNew && <span className="oe-tm-badge is-new">new</span>}
											{problems.length > 0 && <Icon name="alert-triangle" className="oe-wf-item-warn" />}
											{dirty && <span className="oe-tm-dirty" aria-label="Unsaved changes" />}
										</button>
									);
								})}
								{!items.length && <div className="oe-tm-muted oe-tm-typegroup-empty">None yet</div>}
							</div>
						);
					})}
				</div>
				<button className={`oe-tm-typeitem oe-wf-runs-item${state.selected === "runs" ? " is-selected" : ""}`} onClick={() => setState({ selected: "runs" })}>
					<Icon name="history" />
					<span className="oe-tm-typename">Recent runs</span>
					<span className="oe-tm-count">{plugin.workflows.log.length}</span>
				</button>
			</aside>

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
				/>
			) : (
				<main className="oe-tm-main oe-tm-empty">
					<div className="oe-wf-intro">
						<Icon name="zap" />
						<h2>Workflows</h2>
						<p>Do things automatically when a note is created or a field changes, or add buttons that run steps on notes: set fields, add tags and links, show a notice.</p>
						<button className="mod-cta" onClick={() => newDraft()}>
							<Icon name="plus" /> New workflow
						</button>
					</div>
				</main>
			)}
		</div>
	);
}

/** The editor for one workflow: header with on/off and ⋯, Applies to, When, Only if, Do, and its recent runs. */
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
}) {
	const plugin = usePlugin();
	const settings = plugin.settings;
	const lookup = { types: settings.types, groups: settings.groups };
	const dirty = isNew || (!!saved && !sameJson(wf, saved));
	const [attempted, setAttempted] = useState(false);
	const edit = (fn: (x: WorkflowDef) => void) => {
		const next = cloneWorkflow(wf);
		fn(next);
		setDraft(next);
	};
	const problems = workflowProblems(wf, lookup);
	// A new workflow isn't nagged about what it hasn't got yet until Save is tried.
	const shownProblems = attempted || !isNew ? problems : problems.filter((p) => p.at !== "name" && p.at !== "steps" && p.at !== "scope");
	const at = (k: string) => shownProblems.filter((p) => p.at === k);
	const fields = workflowFields(wf, settings.types);
	const def = workflowDef(wf);
	const t = wf.trigger;

	const save = async () => {
		const fin = cloneWorkflow({ ...wf, name: wf.name.trim() || "Untitled workflow" });
		const list = settings.workflows;
		const i = list.findIndex((w) => w.id === fin.id);
		if (i >= 0) list[i] = fin;
		else list.push(fin);
		await plugin.saveSettings();
		setAttempted(false);
		onSaved(fin.id);
		new Notice(`Saved “${fin.name}”.`);
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
	const choices: ColumnChoice[] = useMemo(() => {
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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scopeKey, settings.types]);
	const valuesOf = (colId: string) => {
		const col = choices.find((c) => c.col.id === colId)?.col;
		if (!col) return [];
		const keys = new Set(scopeTypes(wf, settings.types).map((x) => x.key));
		const set = new Set<string>();
		for (const r of rows) {
			if (!keys.has(r.type.key)) continue;
			const v = r.frontmatter[col.def.kind === "field" ? col.def.key : col.id];
			for (const x of Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]) set.add(String(x));
		}
		return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	};

	const setTrigger = (kind: TriggerKind) =>
		edit((x) => {
			if (x.trigger.kind === kind) return;
			x.trigger = kind === "changed" ? { kind, field: COMMON_KEYS.status } : kind === "created" ? { kind } : { kind, label: x.name || "Run" };
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
	const editChanged = (fn: (tr: Extract<WorkflowDef["trigger"], { kind: "changed" }>) => void) => edit((x) => x.trigger.kind === "changed" && fn(x.trigger));
	const editManual = (fn: (tr: Extract<WorkflowDef["trigger"], { kind: "manual" }>) => void) => edit((x) => x.trigger.kind === "manual" && fn(x.trigger));

	const recent = plugin.workflows.log.filter((r) => r.workflow === id).slice(0, 10);

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
								onProblems={() => setAttempted(true)}
								onDiscard={onDiscarded}
								onSave={() => {
									setAttempted(true);
									if (problems.length) new Notice(`Fix ${plural(problems.length, "problem")} before saving.`);
									else void save();
								}}
							/>
						)}
						<span className="oe-wf-onoff">
							<Toggle label={wf.on ? "Workflow on" : "Workflow off"} value={wf.on} onChange={(v) => edit((x) => (x.on = v))} />
							{wf.on ? "On" : "Off"}
						</span>
						<button className="clickable-icon" aria-label="Workflow options" onClick={menu}>
							<Icon name="more-horizontal" />
						</button>
					</div>
				</div>
			</header>
			<div className="oe-tm-body">
				{problems.length > 0 && !isNew && (
					<div className="oe-wf-banner">
						<Icon name="alert-triangle" /> This workflow doesn't run until {problems.length === 1 ? "its problem is" : `its ${problems.length} problems are`} fixed.
					</div>
				)}
				<Section title="Workflow">
					<Row label="Name" issues={at("name")}>
						<TextInput label="Workflow name" value={wf.name} placeholder="e.g. Completed date" autoFocus={isNew && !wf.name} invalid={at("name").length > 0} onChange={(v) => edit((x) => (x.name = v))} />
					</Row>
					<Row label="Applies to" desc={needsScope(t.kind) ? "The types of note it watches." : "The types of note it can be run on. Leave empty for any note."} issues={at("scope")} stacked>
						<TargetPicker values={wf.scope} types={settings.types} groups={settings.groups} invalid={at("scope").length > 0} onChange={(v) => edit((x) => (x.scope = v.filter((s) => s !== "*")))} />
					</Row>
				</Section>

				<Section title="When" desc="What starts the workflow.">
					<Row label="Trigger" issues={at("trigger")}>
						<Segmented label="Trigger" value={t.kind} options={TRIGGER_OPTIONS} onChange={setTrigger} />
					</Row>
					{t.kind === "created" && <div className="oe-wf-help">Runs when a note of these types is created (the Create dialog, + New, a calendar day, converting a note), or appears by sync. Not for renames.</div>}
					{t.kind === "changed" && (
						<>
							<Row label="Field" desc="Changes from anywhere count: the form, tables, boards, other workflows, or the note edited by hand.">
								<select className="dropdown" aria-label="Field" value={t.field} onChange={(e) => edit((x) => (x.trigger = { kind: "changed", field: e.target.value }))}>
									{fields.map((f) => (
										<option key={f.key} value={f.key}>
											{f.label}
										</option>
									))}
									{!fields.some((f) => f.key === t.field) && <option value={t.field}>{t.field}</option>}
								</select>
							</Row>
							{listsValues(watched) ? (
								<>
									<Row label="From" desc="Only when the old value is one of these. None picked: any.">
										<ValuePills label="From" options={valueChoices(watched)} value={t.from ?? []} onChange={(v) => editChanged((tr) => (v.length ? (tr.from = v) : delete tr.from))} />
									</Row>
									<Row label="To" desc="Only when the new value is one of these. None picked: any.">
										<ValuePills label="To" options={valueChoices(watched)} value={Array.isArray(t.to) ? t.to : []} onChange={(v) => editChanged((tr) => (v.length ? (tr.to = v) : delete tr.to))} />
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
						</>
					)}
				</Section>

				<Section title="Only if" desc="Conditions on the note, after the change. None: it always runs.">
					{at("when").map((p, i) => (
						<div key={i} className="oe-tm-issue">
							<Icon name="alert-circle" /> {p.message}
						</div>
					))}
					<div className="oe-wf-when">
						<FiltersPanel filters={wf.when} choices={choices} ctx={ctx} valuesOf={valuesOf} heading="Run only for notes that match" emptyText="No conditions: it runs for every note." onChange={(g) => edit((x) => (x.when = g))} />
					</div>
				</Section>

				<Section title="Do" desc="Steps, in order. Each sees the changes of the ones before; the note is saved once at the end. If a step fails, nothing is saved.">
					{at("steps").map((p, i) => (
						<div key={i} className="oe-tm-issue">
							<Icon name="alert-circle" /> {p.message}
						</div>
					))}
					<div className="oe-wf-steps">
						{wf.steps.map((s, i) => (
							<StepCard
								key={i}
								index={i}
								count={wf.steps.length}
								step={s}
								wf={wf}
								fields={fields}
								problems={shownProblems.filter((p) => p.at === `step:${i}`)}
								onChange={(n) => edit((x) => (x.steps[i] = n))}
								onMove={(d) =>
									edit((x) => {
										const [m] = x.steps.splice(i, 1);
										x.steps.splice(i + d, 0, m);
									})
								}
								onRemove={() => edit((x) => x.steps.splice(i, 1))}
							/>
						))}
					</div>
					<button
						className="oe-wf-add-step"
						onClick={(e) => {
							const m = new Menu();
							for (const k of Object.keys(STEP_LABELS) as StepKind[])
								m.addItem((i) =>
									i
										.setTitle(STEP_LABELS[k])
										.setIcon(STEP_ICONS[k])
										.onClick(() => edit((x) => x.steps.push(blankStep(k, fields)))),
								);
							m.showAtMouseEvent(e.nativeEvent);
						}}
					>
						<Icon name="plus" /> Add step
					</button>
				</Section>

				{!isNew && (
					<Section title="Recent runs">
						<RunList runs={recent} empty="It hasn't run yet." />
					</Section>
				)}
			</div>
		</main>
	);
}

function blankStep(kind: StepKind, fields: WorkflowField[]): WorkflowStep {
	const first = fields.find((f) => f.key !== COMMON_KEYS.tags)?.key ?? COMMON_KEYS.status;
	switch (kind) {
		case "set":
			return { kind, field: first, value: "" };
		case "clear":
			return { kind, field: first };
		case "tag":
			return { kind, op: "add", tag: "" };
		case "link":
			return { kind, op: "add", field: fields.find((f) => f.kind === "relation")?.key ?? "", target: "" };
		case "notice":
			return { kind, text: "" };
	}
}

/** Toggle pills for from / to values. */
function ValuePills({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
	const lower = value.map((v) => v.toLowerCase());
	const extra = value.filter((v) => !options.some((o) => o.value.toLowerCase() === v.toLowerCase()));
	return (
		<div className="oe-wf-pills" role="group" aria-label={label}>
			{[...options, ...extra.map((v) => ({ value: v, label: v }))].map((o) => {
				const on = lower.includes(o.value.toLowerCase());
				return (
					<button key={o.value} className={`oe-pill oe-wf-pill${on ? " is-active" : ""}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v.toLowerCase() !== o.value.toLowerCase()) : [...value, o.value])}>
						{o.label}
					</button>
				);
			})}
			{!options.length && !extra.length && <span className="oe-tm-muted">No values to choose from.</span>}
		</div>
	);
}

/** One step: its kind, its settings, problems, and move / remove buttons. */
function StepCard({
	index,
	count,
	step,
	wf,
	fields,
	problems,
	onChange,
	onMove,
	onRemove,
}: {
	index: number;
	count: number;
	step: WorkflowStep;
	wf: WorkflowDef;
	fields: WorkflowField[];
	problems: WorkflowProblem[];
	onChange: (s: WorkflowStep) => void;
	onMove: (d: -1 | 1) => void;
	onRemove: () => void;
}) {
	const settable = fields.filter((f) => f.key !== COMMON_KEYS.tags);
	const relations = fields.filter((f) => f.kind === "relation");
	const fieldSelect = (value: string, list: WorkflowField[], set: (k: string) => void) => (
		<select className="dropdown" aria-label="Field" value={value} onChange={(e) => set(e.target.value)}>
			{!list.some((f) => f.key === value) && <option value={value}>{value || "Choose…"}</option>}
			{list.map((f) => (
				<option key={f.key} value={f.key}>
					{f.label}
				</option>
			))}
		</select>
	);
	let body: ReactNode = null;
	switch (step.kind) {
		case "set":
			body = (
				<>
					{fieldSelect(step.field, settable, (k) => onChange({ ...step, field: k }))}
					<span className="oe-wf-to">to</span>
					<FormulaBox wf={wf} value={step.value} placeholder={valueHint(settable.find((f) => f.key === step.field))} onChange={(v) => onChange({ ...step, value: v })} />
				</>
			);
			break;
		case "clear":
			body = fieldSelect(step.field, settable, (k) => onChange({ ...step, field: k }));
			break;
		case "tag":
			body = (
				<>
					<Segmented
						label="Add or remove"
						value={step.op}
						options={[
							{ value: "add", label: "Add" },
							{ value: "remove", label: "Remove" },
						]}
						onChange={(v) => onChange({ ...step, op: v })}
					/>
					<TextInput label="Tag" value={step.tag} placeholder="#tag" onChange={(v) => onChange({ ...step, tag: v })} />
				</>
			);
			break;
		case "link":
			body = (
				<>
					<Segmented
						label="Add or remove"
						value={step.op}
						options={[
							{ value: "add", label: "Add" },
							{ value: "remove", label: "Remove" },
						]}
						onChange={(v) => onChange({ ...step, op: v })}
					/>
					{relations.length ? fieldSelect(step.field, relations, (k) => onChange({ ...step, field: k })) : <span className="oe-tm-muted">These types have no link fields.</span>}
					<FormulaBox wf={wf} value={step.target} placeholder={'e.g. "Apollo" or [Project]'} onChange={(v) => onChange({ ...step, target: v })} />
				</>
			);
			break;
		case "notice":
			body = <FormulaBox wf={wf} template value={step.text} placeholder="e.g. {[Name]} is done" onChange={(v) => onChange({ ...step, text: v })} />;
			break;
	}
	return (
		<div className={`oe-wf-step${problems.length ? " has-issue" : ""}`} data-step={index}>
			<div className="oe-wf-step-head">
				<span className="oe-wf-step-n">{index + 1}</span>
				<Icon name={STEP_ICONS[step.kind]} />
				<span className="oe-wf-step-title">{STEP_LABELS[step.kind]}</span>
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
			<div className="oe-wf-step-body">{body}</div>
			{problems.map((p, i) => (
				<div key={i} className="oe-tm-issue">
					<Icon name="alert-circle" /> {p.message}
				</div>
			))}
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
 * A formula (or, with `template`, text with {formula} parts) box: monospace, checked as you type, with a button to
 * insert a field reference at the cursor.
 */
function FormulaBox({ wf, value, placeholder, template, onChange }: { wf: WorkflowDef; value: string; placeholder?: string; template?: boolean; onChange: (v: string) => void }) {
	const plugin = usePlugin();
	const ref = useRef<HTMLInputElement>(null);
	const lookup = { types: plugin.settings.types, groups: plugin.settings.groups };
	const def = workflowDef(wf);
	let error: string | null = null;
	if (value.trim())
		try {
			if (template) {
				for (const p of parseTemplate(value)) if ("formula" in p) compileFormula(p.formula, def, lookup, { workflow: true });
			} else compileFormula(value, def, lookup, { workflow: true });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	const insert = (e: ReactMouseEvent) => {
		const m = new Menu();
		const cols = availableColumns(def, lookup);
		const add = (c: ColumnDef) => {
			const label = resolveColumn(c, def, lookup).label;
			m.addItem((i) =>
				i.setTitle(label).onClick(() => {
					const el = ref.current;
					const text = template ? `{[${label}]}` : `[${label}]`;
					const from = el?.selectionStart ?? value.length;
					const to = el?.selectionEnd ?? value.length;
					onChange(value.slice(0, from) + text + value.slice(to));
					window.setTimeout(() => {
						el?.focus();
						el?.setSelectionRange(from + text.length, from + text.length);
					}, 0);
				}),
			);
		};
		add({ kind: "builtin", id: "name", key: "name" });
		for (const c of [...cols.fields, ...cols.builtins]) add(c);
		m.showAtMouseEvent(e.nativeEvent);
	};
	return (
		<div className={`oe-wf-formula${error ? " is-invalid" : ""}`}>
			<div className="oe-wf-formula-row">
				<input ref={ref} type="text" className="oe-wf-formula-input" aria-label={template ? "Text" : "Formula"} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
				<button className="clickable-icon" aria-label="Insert a field" onClick={insert}>
					<Icon name="brackets" />
				</button>
			</div>
			{error && <div className="oe-wf-formula-error">{error}</div>}
		</div>
	);
}

/** Runs, newest first: when, the note, what changed (or the error / why it stopped), with Undo. */
function RunList({ runs, showWorkflow, empty = "No runs yet." }: { runs: RunRecord[]; showWorkflow?: boolean; empty?: string }) {
	const plugin = usePlugin();
	if (!runs.length) return <div className="oe-tm-muted">{empty}</div>;
	return (
		<div className="oe-wf-runs">
			{runs.map((r) => (
				<div key={r.id} className={`oe-wf-run${r.error ? " is-error" : r.stopped ? " is-stopped" : ""}${r.undone ? " is-undone" : ""}`}>
					<span className="oe-wf-run-time">{when(r.time)}</span>
					<span className="oe-wf-run-what">
						{showWorkflow && <span className="oe-wf-run-name">{r.name} · </span>}
						<a
							href="#"
							className="oe-wf-run-note"
							onClick={(e) => {
								e.preventDefault();
								plugin.openPath(r.path, e.nativeEvent);
							}}
						>
							{r.note}
						</a>
						<span className="oe-wf-run-detail">
							{r.error
								? ` — ${r.error}`
								: r.stopped
									? ` — ${r.stopped}`
									: r.changes.length
										? ` — ${r.changes.map((c) => `${c.key}: ${valueText(c.before)} → ${valueText(c.after)}`).join("; ")}`
										: r.notices.length
											? ` — notice: ${r.notices.join(" / ")}`
											: " — no changes"}
						</span>
					</span>
					{r.undone ? (
						<span className="oe-tm-muted">undone</span>
					) : plugin.workflows.canUndo(r.id) ? (
						<button className="oe-wf-run-undo" onClick={() => void plugin.workflows.undo([r.id])}>
							Undo
						</button>
					) : null}
				</div>
			))}
		</div>
	);
}
