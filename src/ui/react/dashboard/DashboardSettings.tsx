import { Menu } from "obsidian";
import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
	CHART_ICONS,
	CHART_KINDS,
	CHART_LABELS,
	COMPONENT_ICONS,
	COMPONENT_LABELS,
	RULE_OPS,
	cardName,
	runSource,
	type CardOut,
	type CardRule,
	type ChartKind,
	type ChartOut,
	type DashComponent,
	type DashboardDef,
	type DashEnv,
	type DashSource,
	type ListOut,
	type Measure,
	type TimeStep,
} from "../../../model/dashboard";
import { PALETTE, PALETTE_LABELS, type PaletteColor } from "../../../model/colors";
import { formatNumber } from "../../../model/formats";
import { summaryOptions } from "../../../model/summary";
import {
	availableColumns,
	cellOf,
	columnFromId,
	emptyView,
	HIGHLIGHT_ICONS,
	NAME_COLUMN,
	resolveColumn,
	sourceTypes,
	type ColumnDef,
	type ResolvedColumn,
	type ViewDef,
} from "../../../model/views";
import { noteless, onNotes } from "../../../model/workflows";
import { usePlugin } from "../context";
import { Icon } from "../Icon";
import { FiltersPanel, type ColumnChoice } from "../table/popovers";

type Props = {
	c: DashComponent;
	def: DashboardDef;
	env: DashEnv;
	path: string;
	/** the component's worked-out value or notes, for live results next to its settings */
	card?: CardOut;
	chart?: ChartOut;
	list?: ListOut;
	onChange: (c: DashComponent) => void;
	onDelete: () => void;
	onDuplicate: () => void;
};

type Tab = "data" | "style";
/** The tab last shown, kept while selecting other components. */
let lastTab: Tab = "data";
/** Folded sections, by name, kept while selecting other components. */
const folded = new Set<string>();

/**
 * The selected component's settings, on the right in edit mode (DESIGN §8.12): a header with its title and a ⋯ menu,
 * then a Data tab (where its notes come from and what it shows) and a Style tab (how it looks).
 */
export function DashboardSettings(props: Props) {
	const { c, path, onChange, onDelete, onDuplicate } = props;
	const [tab, setTabState] = useState<Tab>(lastTab);
	const setTab = (t: Tab) => {
		lastTab = t;
		setTabState(t);
	};
	const icon = c.kind === "chart" ? CHART_ICONS[c.chart] : COMPONENT_ICONS[c.kind];
	const titled = c.kind !== "text" && c.kind !== "button";
	const menu = (evt: ReactMouseEvent) => {
		const m = new Menu();
		m.addItem((i) => i.setTitle("Duplicate").setIcon("copy").onClick(onDuplicate));
		m.addItem((i) => i.setTitle("Delete").setIcon("trash-2").setWarning(true).onClick(onDelete));
		m.addSeparator();
		m.addItem((i) => i.setTitle(`Id: ${c.id} · in ${path.split("/").pop()?.replace(/\.md$/, "")}`).setDisabled(true));
		m.showAtMouseEvent(evt.nativeEvent);
	};
	return (
		<div className="oe-dash-form">
			<div className="oe-dash-form-head">
				<Icon name={icon} className="oe-dash-form-icon" />
				{titled ? (
					<input
						type="text"
						className="oe-dash-form-title"
						value={c.title ?? ""}
						placeholder={`${COMPONENT_LABELS[c.kind]} title`}
						aria-label="Title"
						onChange={(e) => onChange({ ...c, title: e.target.value || undefined } as DashComponent)}
					/>
				) : (
					<span className="oe-dash-form-title is-static">{COMPONENT_LABELS[c.kind]}</span>
				)}
				<button className="clickable-icon" aria-label="More" onClick={menu}>
					<Icon name="more-horizontal" />
				</button>
			</div>
			<div className="oe-dash-tabs" role="tablist">
				{(["data", "style"] as Tab[]).map((t) => (
					<button key={t} role="tab" aria-selected={tab === t} className={`oe-dash-tab${tab === t ? " is-active" : ""}`} onClick={() => setTab(t)}>
						{t === "data" ? "Data" : "Style"}
					</button>
				))}
			</div>
			<div className="oe-dash-tab-body" role="tabpanel">
				{tab === "data" ? <DataTab {...props} /> : <StyleTab {...props} />}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- building blocks

/** A titled part of a tab; click its heading to fold it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
	const [open, setOpen] = useState(!folded.has(title));
	const toggle = () => {
		if (open) folded.add(title);
		else folded.delete(title);
		setOpen(!open);
	};
	return (
		<div className={`oe-dash-section${open ? "" : " is-folded"}`}>
			<button className="oe-dash-section-head" aria-expanded={open} onClick={toggle}>
				<Icon name={open ? "chevron-down" : "chevron-right"} />
				<span>{title}</span>
			</button>
			{open && <div className="oe-dash-section-body">{children}</div>}
		</div>
	);
}

/** A label on the left and its control on the right; `wide` puts the control under the label. */
function Row({ label, children, hint, wide }: { label?: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
	return (
		<div className={`oe-dash-prop${wide ? " is-wide" : ""}`}>
			{label !== undefined && <div className="oe-dash-prop-label">{label}</div>}
			<div className="oe-dash-prop-control">{children}</div>
			{hint && <div className="oe-dash-hint">{hint}</div>}
		</div>
	);
}

/** Buttons for a small set of choices (icons alone when `iconsOnly`). */
function Segmented<T extends string>({ value, options, onChange, iconsOnly, label }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void; iconsOnly?: boolean; label: string }) {
	return (
		<div className={`oe-dash-seg${iconsOnly ? " is-icons" : ""}`} role="radiogroup" aria-label={label}>
			{options.map((o) => (
				<button key={o.value} role="radio" aria-checked={value === o.value} aria-label={o.label} title={iconsOnly ? o.label : undefined} className={value === o.value ? "is-active" : ""} onClick={() => onChange(o.value)}>
					{o.icon && <Icon name={o.icon} />}
					{!iconsOnly && <span>{o.label}</span>}
				</button>
			))}
		</div>
	);
}

/** A live result next to settings: what the component works out to now, or its problem. */
function Result({ text, error }: { text?: string; error?: string }) {
	if (error) return <div className="oe-dash-result is-error">{error}</div>;
	if (!text) return null;
	return <div className="oe-dash-result">= {text}</div>;
}

/** The view definition a source stands for (its types, filters and columns), for column and filter choices. */
function sourceViewDef(source: DashSource | undefined, env: DashEnv): ViewDef {
	if (!source) return emptyView();
	if (source.kind === "view") return env.view(source.view) ?? emptyView();
	if (source.kind === "query") return source.def;
	return emptyView();
}

/** Columns a source offers: the view's own (roll-ups, formulas), then fields, built-ins and incoming links. */
function columnChoices(sdef: ViewDef, lookup: { types: DashEnv["ctx"]["types"]; groups: DashEnv["ctx"]["groups"] }): ColumnChoice[] {
	const out: ColumnChoice[] = sdef.columns.filter((c) => c.id !== "name").map((c) => ({ col: resolveColumn(c, sdef, lookup), group: "In the view" }));
	const avail = availableColumns(sdef, lookup);
	const add = (list: ColumnDef[], group: string) => {
		for (const c of list) if (!out.some((o) => o.col.id === c.id)) out.push({ col: resolveColumn(c, sdef, lookup), group });
	};
	add(avail.fields, "Fields");
	add(avail.builtins.filter((c) => c.id !== "name"), "Built-in");
	add(avail.incoming, "Incoming links");
	return out;
}

function ColumnPick({ value, choices, onChange, first, label }: { value: string; choices: ColumnChoice[]; onChange: (col: ResolvedColumn | null) => void; first?: string; label: string }) {
	const groups = [...new Set(choices.map((x) => x.group))];
	return (
		<select className="dropdown" value={value} aria-label={label} onChange={(e) => onChange(choices.find((x) => x.col.id === e.target.value)?.col ?? null)}>
			{first !== undefined && <option value="">{first}</option>}
			{!choices.some((x) => x.col.id === value) && value && <option value={value}>{value}</option>}
			{groups.map((g) => (
				<optgroup key={g} label={g}>
					{choices
						.filter((x) => x.group === g)
						.map((x) => (
							<option key={x.col.id} value={x.col.id}>
								{x.col.label}
							</option>
						))}
				</optgroup>
			))}
		</select>
	);
}

/** The values a column has among a definition's notes (for filter value pickers). */
const valuesFor = (sdef: ViewDef, choices: ColumnChoice[], env: DashEnv) => (id: string) => {
	const { ctx, rows } = env;
	const col = choices.find((x) => x.col.id === id)?.col;
	if (!col) return [];
	const keys = new Set(sourceTypes(sdef, ctx.types).map((t) => t.key));
	const set = new Set<string>();
	for (const r of rows) {
		if (!keys.has(r.type.key)) continue;
		const v = cellOf(r, col, ctx).value;
		for (const x of Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]) set.add(String(x));
	}
	return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

// ---------------------------------------------------------------- the Data tab

function DataTab(props: Props) {
	const { c, env, onChange } = props;
	const plugin = usePlugin();
	const views = plugin.views
		.all()
		.filter((f) => plugin.views.kind(f.path) !== "dashboard")
		.map((f) => f.basename);
	switch (c.kind) {
		case "card":
			return <CardData {...props} c={c} views={views} />;
		case "chart":
			return <ChartData {...props} c={c} views={views} />;
		case "list":
			return <ListData {...props} c={c} views={views} />;
		case "view":
			return (
				<Section title="Show">
					<Row label="View">
						<select className="dropdown" value={c.view} aria-label="View" onChange={(e) => onChange({ ...c, view: e.target.value })}>
							<option value="">Choose a view…</option>
							{views.map((v) => (
								<option key={v} value={v}>
									{v}
								</option>
							))}
						</select>
					</Row>
				</Section>
			);
		case "text":
			return (
				<Section title="Text">
					<Row wide hint="Markdown: headings, lists, links and embeds.">
						<textarea rows={10} value={c.text} aria-label="Text" onChange={(e) => onChange({ ...c, text: e.target.value })} />
					</Row>
				</Section>
			);
		case "button":
			return <ButtonData c={c} onChange={onChange} />;
	}
	void env;
}

/** Where a card's, chart's or list's notes come from: types and filters, a saved view, or a formula. */
function NotesSection({ source, env, views, onChange }: { source: DashSource | undefined; env: DashEnv; views: string[]; onChange: (s: DashSource) => void }) {
	const { ctx } = env;
	const lookup = { types: ctx.types, groups: ctx.groups };
	const mode = source?.kind ?? "query";
	const qdef = source?.kind === "query" ? source.def : emptyView();
	const choices = useMemo(() => columnChoices(qdef, lookup), [qdef, ctx]);
	const run = useMemo(() => runSource(source, [], [], env), [source, env]);
	const switchTo = (k: DashSource["kind"]) => {
		if (k === mode) return;
		onChange(k === "view" ? { kind: "view", view: views[0] ?? "" } : k === "formula" ? { kind: "formula", formula: 'notes("")' } : { kind: "query", def: emptyView() });
	};
	const types = qdef.types.filter((t) => t !== "*");
	const label = (t: string) => (t.startsWith("@") ? `${ctx.groups.find((g) => `@${g.key}` === t)?.name ?? t} (group)` : (ctx.types.find((x) => x.key === t)?.plural ?? t));
	const setTypes = (next: string[]) => onChange({ kind: "query", def: { ...qdef, types: next.length ? next : ["*"] } });
	return (
		<Section title="Notes">
			<Row label="From">
				<Segmented
					label="Notes from"
					value={mode}
					onChange={switchTo}
					options={[
						{ value: "query", label: "Types" },
						{ value: "view", label: "View" },
						{ value: "formula", label: "Formula" },
					]}
				/>
			</Row>
			{mode === "query" && (
				<>
					<Row label="Types">
						<div className="oe-dash-chips">
							{types.length === 0 && <span className="oe-dash-chip is-all">Every type</span>}
							{types.map((t) => (
								<span key={t} className="oe-dash-chip">
									{label(t)}
									<button className="clickable-icon" aria-label={`Remove ${label(t)}`} onClick={() => setTypes(types.filter((x) => x !== t))}>
										<Icon name="x" />
									</button>
								</span>
							))}
						</div>
						<select className="dropdown" value="" aria-label="Add a type or group" onChange={(e) => e.target.value && setTypes([...types, e.target.value])}>
							<option value="">Add a type or group…</option>
							{ctx.groups.map((g) => (
								<optgroup key={g.key} label={g.name}>
									{!types.includes(`@${g.key}`) && <option value={`@${g.key}`}>All of {g.name}</option>}
									{ctx.types
										.filter((t) => t.group === g.key && !types.includes(t.key))
										.map((t) => (
											<option key={t.key} value={t.key}>
												{t.plural || t.name}
											</option>
										))}
								</optgroup>
							))}
						</select>
					</Row>
					<div className="oe-dash-filters">
						<FiltersPanel filters={qdef.filters} onChange={(filters) => onChange({ kind: "query", def: { ...qdef, filters } })} choices={choices} ctx={ctx} valuesOf={valuesFor(qdef, choices, env)} heading="Only notes matching" />
					</div>
				</>
			)}
			{source?.kind === "view" && (
				<Row label="View" hint="Uses the view's types, filters and sort.">
					<select className="dropdown" value={source.view} aria-label="View" onChange={(e) => onChange({ kind: "view", view: e.target.value })}>
						<option value="">Choose a view…</option>
						{views.map((v) => (
							<option key={v} value={v}>
								{v}
							</option>
						))}
					</select>
				</Row>
			)}
			{source?.kind === "formula" && (
				<Row wide hint={<>Gives notes, e.g. <code>filter(notes("quest"), prop(item, "Status") = "active")</code>.</>}>
					<textarea rows={3} className="oe-dash-code" aria-label="Formula" value={source.formula} onChange={(e) => onChange({ kind: "formula", formula: e.target.value })} />
				</Row>
			)}
			{"error" in run ? <Result error={run.error} /> : <div className="oe-dash-result">→ {run.result.rows.length} note{run.result.rows.length === 1 ? "" : "s"}</div>}
		</Section>
	);
}

function CardData({ c, def, env, views, card, onChange }: Props & { c: Extract<DashComponent, { kind: "card" }>; views: string[] }) {
	const { ctx } = env;
	const lookup = { types: ctx.types, groups: ctx.groups };
	const isFormula = "formula" in c.value;
	const sdef = sourceViewDef(c.source, env);
	const choices = useMemo(() => columnChoices(sdef, lookup), [sdef, ctx]);
	const column = !isFormula && "agg" in c.value ? (c.value.column ?? NAME_COLUMN) : NAME_COLUMN;
	const resolved = column.id === "name" ? resolveColumn(NAME_COLUMN, sdef, lookup) : (choices.find((x) => x.col.id === column.id)?.col ?? resolveColumn(column, sdef, lookup));
	const aggs = summaryOptions(resolved).filter((o) => o.key !== "values");
	const agg = "agg" in c.value ? c.value.agg : "count";
	const others = def.components.filter((x) => x.kind === "card" && x.id !== c.id).map(cardName);
	const setMode = (m: "summary" | "formula") => {
		if (m === (isFormula ? "formula" : "summary")) return;
		onChange(m === "formula" ? { ...c, source: undefined, value: { formula: others.length ? `[${others[0]}]` : "1" } } : { ...c, source: c.source ?? { kind: "query", def: emptyView() }, value: { agg: "count" } });
	};
	return (
		<>
			<Section title="Value">
				<Row label="From">
					<Segmented
						label="Value from"
						value={isFormula ? "formula" : "summary"}
						onChange={setMode}
						options={[
							{ value: "summary", label: "Some notes" },
							{ value: "formula", label: "Other cards" },
						]}
					/>
				</Row>
			</Section>
			{!isFormula && <NotesSection source={c.source} env={env} views={views} onChange={(source) => onChange({ ...c, source })} />}
			<Section title="Show">
				{isFormula ? (
					<Row
						wide
						hint={
							others.length ? (
								<>
									Refer to other cards by title: {others.map((n) => `[${n}]`).join(", ")}. <code>notes()</code> works here too.
								</>
							) : (
								<>
									Add other cards to refer to them by title, e.g. <code>[Done] / [All] * 100</code>.
								</>
							)
						}
					>
						<textarea rows={3} className="oe-dash-code" aria-label="Formula" value={"formula" in c.value ? c.value.formula : ""} onChange={(e) => onChange({ ...c, value: { formula: e.target.value } })} />
					</Row>
				) : (
					<>
						<Row label="Field">
							<ColumnPick
								label="Field"
								value={column.id === "name" ? "" : column.id}
								choices={choices}
								first="None: count the notes"
								onChange={(col) => {
									// The summary depends on the field: keep it if the new field has it (and one was chosen), else take the field's first.
									const next = col ? summaryOptions(col).filter((o) => o.key !== "values") : [{ key: "count", label: "Count" }];
									const keep = column.id !== "name" && next.some((o) => o.key === agg) ? agg : (next[0]?.key ?? "count");
									// A number format means nothing for a date (and the other way round): drop it when that changes.
									const format = (resolved.kind === "date") !== (col?.kind === "date") ? undefined : c.format;
									onChange({ ...c, format, value: col ? { agg: keep, column: col.def } : { agg: "count" } });
								}}
							/>
						</Row>
						{column.id !== "name" && (
							<Row label="Summary">
								<select className="dropdown" value={agg} aria-label="Summary" onChange={(e) => onChange({ ...c, value: { agg: e.target.value, column } })}>
									{aggs.map((o) => (
										<option key={o.key} value={o.key}>
											{o.label}
										</option>
									))}
								</select>
							</Row>
						)}
					</>
				)}
				<Result text={card?.text} error={card?.error} />
			</Section>
		</>
	);
}

function ChartData({ c, env, views, chart, onChange }: Props & { c: Extract<DashComponent, { kind: "chart" }>; views: string[] }) {
	const { ctx } = env;
	const lookup = { types: ctx.types, groups: ctx.groups };
	const sdef = sourceViewDef(c.source, env);
	const choices = useMemo(() => columnChoices(sdef, lookup), [sdef, ctx]);
	const dates = choices.filter((x) => x.col.kind === "date");
	const numbers = choices.filter((x) => x.col.kind === "number");
	const grouping = choices.filter((x) => x.col.kind !== "number" || x.col.field?.kind === "select");
	const builtinStatus = resolveColumn(columnFromId("status"), sdef, lookup);
	const groupChoices = grouping.some((x) => x.col.id === "status") ? grouping : [{ col: builtinStatus, group: "Built-in" }, ...grouping];
	const progress = c.chart === "progress";
	const setChart = (chart: ChartKind) => {
		// A line needs a date to go along; the others group by a field (status unless one's chosen).
		const by = chart === "line" ? (c.by && dates.some((d) => d.col.id === c.by!.id) ? c.by : dates[0]?.col.def) : chart === "progress" ? c.by : c.by && !dates.some((d) => d.col.id === c.by!.id) ? c.by : columnFromId("status");
		onChange({ ...c, chart, by, done: chart === "progress" ? (c.done ?? { mode: "all", items: [] }) : c.done });
	};
	const setBy = (col: ResolvedColumn | null) => {
		// A title still saying "By <the old field>" follows the new one.
		const old = c.by ? (groupChoices.find((x) => x.col.id === c.by!.id)?.col.label ?? "") : "";
		const auto = !c.title || c.title.toLowerCase() === `by ${old.toLowerCase()}`;
		onChange({ ...c, by: col?.def, ...(auto && col ? { title: `By ${col.label.toLowerCase()}` } : {}) });
	};
	return (
		<>
			<Section title="Chart">
				<Segmented label="Chart" iconsOnly value={c.chart} onChange={setChart} options={CHART_KINDS.map((k) => ({ value: k, label: CHART_LABELS[k], icon: CHART_ICONS[k] }))} />
				<div className="oe-dash-seg-caption">{CHART_LABELS[c.chart]}</div>
			</Section>
			<NotesSection source={c.source} env={env} views={views} onChange={(source) => onChange({ ...c, source })} />
			<Section title="Show">
				<Row label="Measure">
					<Segmented
						label="Measure"
						value={c.measure.agg}
						onChange={(agg: Measure["agg"]) => onChange({ ...c, measure: agg === "count" ? { agg } : { agg, column: c.measure.column ?? numbers[0]?.col.def } })}
						options={[
							{ value: "count", label: "Count" },
							{ value: "sum", label: "Sum" },
							{ value: "avg", label: "Average" },
						]}
					/>
				</Row>
				{c.measure.agg !== "count" && (
					<Row label="Of">
						<ColumnPick label="Number field" value={c.measure.column?.id ?? ""} choices={numbers} first="Choose a number…" onChange={(col) => onChange({ ...c, measure: { agg: c.measure.agg, column: col?.def } })} />
					</Row>
				)}
				{c.chart === "line" && (
					<>
						<Row label="By date" hint={dates.length ? undefined : "These notes have no date fields."}>
							<ColumnPick label="Date" value={c.by?.id ?? ""} choices={dates} first="Choose a date…" onChange={(col) => onChange({ ...c, by: col?.def })} />
						</Row>
						<Row label="Every">
							<Segmented
								label="Every"
								value={c.every ?? "month"}
								onChange={(every: TimeStep) => onChange({ ...c, every })}
								options={[
									{ value: "week", label: "Week" },
									{ value: "month", label: "Month" },
									{ value: "year", label: "Year" },
								]}
							/>
						</Row>
					</>
				)}
				{!progress && c.chart !== "line" && (
					<Row label={c.chart === "donut" ? "Slices by" : "Bars by"}>
						<ColumnPick label="Group by" value={c.by?.id ?? ""} choices={groupChoices} first="Choose a field…" onChange={setBy} />
					</Row>
				)}
				{c.chart === "stacked" && (
					<Row label="Split by">
						<ColumnPick label="Split by" value={c.split?.id ?? ""} choices={groupChoices} first="Choose a field…" onChange={(col) => onChange({ ...c, split: col?.def })} />
					</Row>
				)}
				{progress && (
					<div className="oe-dash-filters">
						<FiltersPanel
							filters={c.done ?? { mode: "all", items: [] }}
							onChange={(done) => onChange({ ...c, done })}
							choices={choices}
							ctx={ctx}
							valuesOf={valuesFor(sdef, choices, env)}
							heading="Done when matching"
							emptyText="Add a condition, e.g. Status is done."
						/>
					</div>
				)}
				<Result text={chart && !chart.error ? (progress && chart.progress ? `${chart.progress.doneText} of ${chart.totalText}` : `${chart.totalText} in ${chart.bars.length} ${c.chart === "line" ? "steps" : c.chart === "donut" ? "slices" : "bars"}`) : undefined} error={chart?.error} />
			</Section>
			<div className="oe-dash-hint">{progress ? "In view mode, click the bar to open the done notes as a table." : `In view mode, click a ${c.chart === "donut" ? "slice" : c.chart === "line" ? "point" : "bar"} to open its notes as a table.`}</div>
		</>
	);
}

function ListData({ c, env, views, list, onChange }: Props & { c: Extract<DashComponent, { kind: "list" }>; views: string[] }) {
	const { ctx } = env;
	const lookup = { types: ctx.types, groups: ctx.groups };
	const sdef = sourceViewDef(c.source, env);
	const choices = useMemo(() => columnChoices(sdef, lookup), [sdef, ctx]);
	const sort = c.sort[0];
	return (
		<>
			<NotesSection source={c.source} env={env} views={views} onChange={(source) => onChange({ ...c, source })} />
			<Section title="Show">
				<div className="oe-dash-sentence">
					<span>Show up to</span>
					<input type="number" min={1} max={500} aria-label="Show at most" value={c.limit} onChange={(e) => onChange({ ...c, limit: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} />
					<span>notes</span>
				</div>
				<Row label="Sorted by">
					<div className="oe-dash-row">
						<ColumnPick
							label="Sort by"
							value={sort?.by ?? ""}
							choices={[{ col: resolveColumn(NAME_COLUMN, sdef, lookup), group: "Built-in" }, ...choices]}
							first={c.source?.kind === "view" ? "The view's order" : "Name"}
							onChange={(col) => onChange({ ...c, sort: col ? [{ by: col.id, dir: sort?.dir ?? "asc" }] : [] })}
						/>
						{sort && (
							<button className="clickable-icon" aria-label={sort.dir === "asc" ? "Ascending" : "Descending"} onClick={() => onChange({ ...c, sort: [{ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" }] })}>
								<Icon name={sort.dir === "asc" ? "arrow-up" : "arrow-down"} />
							</button>
						)}
					</div>
				</Row>
				<Row label="With" hint="Up to four fields after each note's name.">
					{c.fields.map((f, i) => (
						<div key={`${f.id}-${i}`} className="oe-dash-row">
							<ColumnPick label={`Field ${i + 1}`} value={f.id} choices={choices} onChange={(col) => col && onChange({ ...c, fields: c.fields.map((x, j) => (j === i ? col.def : x)) })} />
							<button className="clickable-icon" aria-label="Remove field" onClick={() => onChange({ ...c, fields: c.fields.filter((_, j) => j !== i) })}>
								<Icon name="x" />
							</button>
						</div>
					))}
					{c.fields.length < 4 && <ColumnPick label="Add a field" value="" choices={choices.filter((x) => !c.fields.some((f) => f.id === x.col.id))} first="Add a field…" onChange={(col) => col && onChange({ ...c, fields: [...c.fields, col.def] })} />}
				</Row>
				<Result text={list && !list.error ? `${list.rows.length} of ${list.total} shown` : undefined} error={list?.error} />
			</Section>
		</>
	);
}

function ButtonData({ c, onChange }: { c: Extract<DashComponent, { kind: "button" }>; onChange: (c: DashComponent) => void }) {
	const plugin = usePlugin();
	const { types, workflows } = plugin.settings;
	const runnable = workflows.filter((w) => noteless(w) || onNotes(w));
	const a = c.action;
	const kind = !a ? "" : "new" in a ? "new" : "workflow" in a ? "workflow" : "open";
	return (
		<Section title="Button">
			<Row label="Label">
				<input type="text" value={c.label} aria-label="Label" onChange={(e) => onChange({ ...c, label: e.target.value })} />
			</Row>
			<Row label="On click">
				<select
					className="dropdown"
					value={kind}
					aria-label="When clicked"
					onChange={(e) => {
						const k = e.target.value;
						onChange({ ...c, action: k === "new" ? { new: types[0]?.key ?? "" } : k === "workflow" ? { workflow: runnable[0]?.id ?? "" } : k === "open" ? { open: "" } : undefined });
					}}
				>
					<option value="">Nothing yet</option>
					<option value="new">Create a note</option>
					<option value="workflow">Run a workflow</option>
					<option value="open">Open a note or view</option>
				</select>
			</Row>
			{a && "new" in a && (
				<Row label="Type">
					<select className="dropdown" value={a.new} aria-label="Type" onChange={(e) => onChange({ ...c, action: { new: e.target.value } })}>
						{types.map((t) => (
							<option key={t.key} value={t.key}>
								{t.name}
							</option>
						))}
					</select>
				</Row>
			)}
			{a && "workflow" in a && (
				<Row label="Workflow" hint={runnable.length ? "Forms open their form; buttons on notes ask which note." : "No form or button workflows yet."}>
					<select className="dropdown" value={a.workflow} aria-label="Workflow" onChange={(e) => onChange({ ...c, action: { workflow: e.target.value } })}>
						{runnable.map((w) => (
							<option key={w.id} value={w.id}>
								{w.name}
							</option>
						))}
					</select>
				</Row>
			)}
			{a && "open" in a && (
				<Row label="Note" hint="Its name, as you'd write it in a link.">
					<input type="text" value={a.open} aria-label="Note" placeholder="e.g. Quest board" onChange={(e) => onChange({ ...c, action: { open: e.target.value } })} />
				</Row>
			)}
		</Section>
	);
}

// ---------------------------------------------------------------- the Style tab

function StyleTab({ c, env, card, chart, onChange }: Props) {
	if (c.kind === "card")
		return (
			<>
				<Section title="Number">
					<FormatPick value={c.format} sample={card?.num} env={env} onChange={(format) => onChange({ ...c, format })} />
				</Section>
				<Section title="Colour rules">
					<RulesSettings rules={c.rules ?? []} onChange={(rules) => onChange({ ...c, rules: rules.length ? rules : undefined })} />
				</Section>
			</>
		);
	if (c.kind === "chart")
		return (
			<Section title="Values">
				<FormatPick value={c.format} sample={chart?.total} env={env} onChange={(format) => onChange({ ...c, format })} />
			</Section>
		);
	if (c.kind === "button")
		return (
			<Section title="Icon">
				<Row label="Icon" hint="A Lucide icon name, e.g. plus, scroll, swords.">
					<div className="oe-dash-row">
						{c.icon && <Icon name={c.icon} />}
						<input type="text" value={c.icon ?? ""} aria-label="Icon" placeholder="None" onChange={(e) => onChange({ ...c, icon: e.target.value.trim() || undefined })} />
					</div>
				</Row>
			</Section>
		);
	return <div className="oe-dash-settings-empty">No style options for {COMPONENT_LABELS[c.kind].toLowerCase()}s yet.</div>;
}

const FORMATS: { value: string; label: string }[] = [
	{ value: "", label: "Automatic" },
	{ value: "number", label: "Number" },
	{ value: "integer", label: "Whole number" },
	{ value: "decimal:1", label: "One decimal place" },
	{ value: "decimal:2", label: "Two decimal places" },
	{ value: "currency", label: "Currency" },
	{ value: "percent", label: "Percent" },
	{ value: "compact", label: "Compact (1.2K)" },
];
const CUSTOM = "\u0000custom";

/** A number format: a preset, or a custom pattern (e.g. #,##0 gp), with an example of how a value looks. */
function FormatPick({ value, sample, env, onChange }: { value?: string; sample?: number; env: DashEnv; onChange: (f: string | undefined) => void }) {
	const preset = FORMATS.some((f) => f.value === (value ?? ""));
	const [custom, setCustom] = useState(!preset);
	const n = typeof sample === "number" && Number.isFinite(sample) ? sample : 1234.5;
	let example = "";
	try {
		example = formatNumber(n, value || "number", env.ctx.locale ?? "en", env.ctx.currency);
	} catch {
		example = "";
	}
	return (
		<>
			<Row label="Format">
				<select
					className="dropdown"
					aria-label="Format"
					value={custom ? CUSTOM : (value ?? "")}
					onChange={(e) => {
						if (e.target.value === CUSTOM) return setCustom(true);
						setCustom(false);
						onChange(e.target.value || undefined);
					}}
				>
					{FORMATS.map((f) => (
						<option key={f.value} value={f.value}>
							{f.label}
						</option>
					))}
					<option value={CUSTOM}>Custom pattern…</option>
				</select>
			</Row>
			{custom && (
				<Row label="Pattern" hint="# for digits, 0 for a digit that's always shown, and any text around them, e.g. #,##0.00 or #,##0 gp.">
					<input type="text" aria-label="Pattern" value={value ?? ""} placeholder="#,##0" onChange={(e) => onChange(e.target.value.trim() || undefined)} />
				</Row>
			)}
			{example && <div className="oe-dash-result">Looks like: {example}</div>}
		</>
	);
}

/** A card's colour rules: the first that its value meets colours the value or the card, with an optional icon. */
function RulesSettings({ rules, onChange }: { rules: CardRule[]; onChange: (r: CardRule[]) => void }) {
	const set = (i: number, patch: Partial<CardRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	return (
		<>
			{rules.length === 0 && <div className="oe-dash-muted-label">No rules: the value shows in the usual colour.</div>}
			{rules.map((r, i) => (
				<div key={i} className="oe-dash-rule">
					<div className="oe-dash-row">
						<span className="oe-dash-muted-label">When</span>
						<select className="dropdown oe-dash-op" value={r.op} aria-label="Comparison" onChange={(e) => set(i, { op: e.target.value as CardRule["op"] })}>
							{RULE_OPS.map((o) => (
								<option key={o} value={o}>
									{o}
								</option>
							))}
						</select>
						<input type="number" value={r.value} aria-label="Value" onChange={(e) => set(i, { value: Number(e.target.value) || 0 })} />
						<button className="clickable-icon" aria-label="Remove rule" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
							<Icon name="x" />
						</button>
					</div>
					<div className="oe-dash-row">
						<select className="dropdown" value={r.color ?? ""} aria-label="Colour" onChange={(e) => set(i, { color: (e.target.value || undefined) as PaletteColor | undefined })}>
							<option value="">No colour</option>
							{PALETTE.map((p) => (
								<option key={p} value={p}>
									{PALETTE_LABELS[p]}
								</option>
							))}
						</select>
						<Segmented
							label="What it colours"
							value={r.on}
							onChange={(on: CardRule["on"]) => set(i, { on })}
							options={[
								{ value: "value", label: "Value" },
								{ value: "card", label: "Card" },
							]}
						/>
					</div>
					<div className="oe-dash-row">
						<select className="dropdown" value={r.icon ?? ""} aria-label="Icon" onChange={(e) => set(i, { icon: e.target.value || undefined })}>
							<option value="">No icon</option>
							{HIGHLIGHT_ICONS.map((ic) => (
								<option key={ic} value={ic}>
									{ic.replace(/-/g, " ")}
								</option>
							))}
						</select>
						{r.icon && <Icon name={r.icon} className={r.color ? `oe-c-${r.color} oe-dash-rule-icon` : "oe-dash-rule-icon"} />}
					</div>
				</div>
			))}
			<button onClick={() => onChange([...rules, { op: "<", value: 0, color: "red", on: "value" }])}>
				<Icon name="plus" /> Add rule
			</button>
			<div className="oe-dash-hint">The first rule the value meets applies. Percentages compare as shown (50 for 50%).</div>
		</>
	);
}
