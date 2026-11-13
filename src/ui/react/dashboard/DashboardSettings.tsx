import { useMemo, type ReactNode } from "react";
import { CHART_KINDS, CHART_LABELS, RULE_OPS, cardName, type CardRule, type ChartKind, type DashComponent, type DashboardDef, type DashEnv, type DashSource, type Measure, type TimeStep } from "../../../model/dashboard";
import { PALETTE, PALETTE_LABELS, type PaletteColor } from "../../../model/colors";
import { summaryOptions } from "../../../model/summary";
import { availableColumns, cellOf, columnFromId, emptyView, HIGHLIGHT_ICONS, NAME_COLUMN, resolveColumn, sourceTypes, type ColumnDef, type ResolvedColumn, type ViewDef } from "../../../model/views";
import { noteless, onNotes } from "../../../model/workflows";
import { usePlugin } from "../context";
import { Icon } from "../Icon";
import { FiltersPanel, type ColumnChoice } from "../table/popovers";

type Props = {
	c: DashComponent;
	def: DashboardDef;
	env: DashEnv;
	path: string;
	onChange: (c: DashComponent) => void;
	onDelete: () => void;
	onDuplicate: () => void;
};

const KIND_TITLE: Record<DashComponent["kind"], string> = { card: "Summary card", chart: "Chart", list: "List", view: "View", text: "Text", button: "Button" };

/** The selected component's settings, on the right in edit mode. */
export function DashboardSettings({ c, def, env, path, onChange, onDelete, onDuplicate }: Props) {
	const plugin = usePlugin();
	const views = plugin.views.all().filter((f) => plugin.views.kind(f.path) !== "dashboard");
	const set = (patch: Partial<DashComponent>) => onChange({ ...c, ...patch } as DashComponent);
	return (
		<div className="oe-dash-form">
			<div className="oe-dash-panel-title">
				<span>{KIND_TITLE[c.kind]}</span>
				<span className="oe-dash-form-actions">
					<button className="clickable-icon" aria-label="Duplicate" onClick={onDuplicate}>
						<Icon name="copy" />
					</button>
					<button className="clickable-icon mod-warning" aria-label="Delete" onClick={onDelete}>
						<Icon name="trash-2" />
					</button>
				</span>
			</div>
			{c.kind !== "text" && c.kind !== "button" && (
				<Field label="Title">
					<input type="text" value={c.title ?? ""} placeholder={c.kind === "card" ? "e.g. Active quests" : ""} onChange={(e) => set({ title: e.target.value || undefined })} />
				</Field>
			)}
			{c.kind === "card" && <CardSettings c={c} def={def} env={env} views={views.map((f) => f.basename)} onChange={onChange} />}
			{c.kind === "chart" && <ChartSettings c={c} env={env} views={views.map((f) => f.basename)} onChange={onChange} />}
			{c.kind === "list" && <ListSettings c={c} env={env} views={views.map((f) => f.basename)} onChange={onChange} />}
			{c.kind === "view" && (
				<Field label="View">
					<select className="dropdown" value={c.view} onChange={(e) => set({ view: e.target.value })}>
						<option value="">Choose a view…</option>
						{views.map((f) => (
							<option key={f.path} value={f.basename}>
								{f.basename}
							</option>
						))}
					</select>
				</Field>
			)}
			{c.kind === "text" && (
				<Field label="Text" hint="Markdown: headings, lists, links and embeds.">
					<textarea rows={10} value={c.text} onChange={(e) => set({ text: e.target.value })} />
				</Field>
			)}
			{c.kind === "button" && <ButtonSettings c={c} onChange={onChange} />}
			<div className="oe-dash-hint">Drag the component to move it, and its corner to resize it.</div>
			<div className="oe-dash-hint oe-dash-id">Id: {c.id} · in {path.split("/").pop()?.replace(/\.md$/, "")}</div>
		</div>
	);
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
	return (
		<div className="oe-dash-field">
			<div className="oe-dash-field-label">{label}</div>
			{children}
			{hint && <div className="oe-dash-hint">{hint}</div>}
		</div>
	);
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

function ColumnPick({ value, choices, onChange, first }: { value: string; choices: ColumnChoice[]; onChange: (col: ResolvedColumn | null) => void; first?: string }) {
	const groups = [...new Set(choices.map((x) => x.group))];
	return (
		<select className="dropdown" value={value} onChange={(e) => onChange(choices.find((x) => x.col.id === e.target.value)?.col ?? null)}>
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

function SourceSettings({ source, env, views, onChange }: { source: DashSource | undefined; env: DashEnv; views: string[]; onChange: (s: DashSource) => void }) {
	const { ctx } = env;
	const lookup = { types: ctx.types, groups: ctx.groups };
	const mode = source?.kind ?? "query";
	const qdef = source?.kind === "query" ? source.def : emptyView();
	const choices = useMemo(() => columnChoices(qdef, lookup), [qdef, ctx]);
	const valuesOf = valuesFor(qdef, choices, env);
	const switchTo = (k: DashSource["kind"]) => onChange(k === "view" ? { kind: "view", view: views[0] ?? "" } : k === "formula" ? { kind: "formula", formula: 'notes("")' } : { kind: "query", def: emptyView() });
	const types = qdef.types.filter((t) => t !== "*");
	const label = (t: string) => (t.startsWith("@") ? `${ctx.groups.find((g) => `@${g.key}` === t)?.name ?? t} (group)` : (ctx.types.find((x) => x.key === t)?.plural ?? t));
	const setTypes = (next: string[]) => onChange({ kind: "query", def: { ...qdef, types: next.length ? next : ["*"] } });
	return (
		<>
			<Field label="Notes from">
				<select className="dropdown" value={mode} onChange={(e) => switchTo(e.target.value as DashSource["kind"])}>
					<option value="query">Types and filters</option>
					<option value="view">A saved view</option>
					<option value="formula">A formula</option>
				</select>
			</Field>
			{source?.kind === "view" && (
				<Field label="View" hint="Uses the view's types, filters and sort.">
					<select className="dropdown" value={source.view} onChange={(e) => onChange({ kind: "view", view: e.target.value })}>
						<option value="">Choose a view…</option>
						{views.map((v) => (
							<option key={v} value={v}>
								{v}
							</option>
						))}
					</select>
				</Field>
			)}
			{mode === "query" && (
				<>
					<Field label="Types">
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
						<select className="dropdown" value="" onChange={(e) => e.target.value && setTypes([...types, e.target.value])}>
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
					</Field>
					<FiltersPanel filters={qdef.filters} onChange={(filters) => onChange({ kind: "query", def: { ...qdef, filters } })} choices={choices} ctx={ctx} valuesOf={valuesOf} heading="Only notes that match" />
				</>
			)}
			{source?.kind === "formula" && (
				<Field label="Formula" hint={<>Gives notes, e.g. <code>filter(notes("quest"), prop(item, "Status") = "active")</code>.</>}>
					<textarea rows={4} className="oe-dash-code" value={source.formula} onChange={(e) => onChange({ kind: "formula", formula: e.target.value })} />
				</Field>
			)}
		</>
	);
}

function CardSettings({ c, def, env, views, onChange }: { c: Extract<DashComponent, { kind: "card" }>; def: DashboardDef; env: DashEnv; views: string[]; onChange: (c: DashComponent) => void }) {
	const { ctx } = env;
	const lookup = { types: ctx.types, groups: ctx.groups };
	const isFormula = "formula" in c.value;
	const sdef = sourceViewDef(c.source, env);
	const choices = useMemo(() => columnChoices(sdef, lookup), [sdef, ctx]);
	const column = !isFormula && "agg" in c.value ? (c.value.column ?? NAME_COLUMN) : NAME_COLUMN;
	const resolved = column.id === "name" ? resolveColumn(NAME_COLUMN, sdef, lookup) : (choices.find((x) => x.col.id === column.id)?.col ?? resolveColumn(column, sdef, lookup));
	const aggs = summaryOptions(resolved).filter((o) => o.key !== "values");
	const others = def.components.filter((x) => x.kind === "card" && x.id !== c.id).map(cardName);
	return (
		<>
			<Field label="Value">
				<select
					className="dropdown"
					value={isFormula ? "formula" : "summary"}
					onChange={(e) => onChange(e.target.value === "formula" ? { ...c, source: undefined, value: { formula: others.length ? `[${others[0]}]` : "1" } } : { ...c, source: c.source ?? { kind: "query", def: emptyView() }, value: { agg: "count" } })}
				>
					<option value="summary">A summary of some notes</option>
					<option value="formula">A formula over other cards</option>
				</select>
			</Field>
			{isFormula ? (
				<Field
					label="Formula"
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
					<textarea rows={3} className="oe-dash-code" value={"formula" in c.value ? c.value.formula : ""} onChange={(e) => onChange({ ...c, value: { formula: e.target.value } })} />
				</Field>
			) : (
				<>
					<SourceSettings source={c.source} env={env} views={views} onChange={(source) => onChange({ ...c, source })} />
					<Field label="Of">
						<ColumnPick
							value={column.id === "name" ? "" : column.id}
							choices={choices}
							first="Notes (how many)"
							onChange={(col) => {
								const next = col ? summaryOptions(col) : [{ key: "count", label: "Count" }];
								const was = "agg" in c.value ? c.value.agg : "count";
								const agg = next.some((o) => o.key === was) ? was : (next[0]?.key ?? "count");
								onChange({ ...c, value: col ? { agg, column: col.def } : { agg: "count" } });
							}}
						/>
					</Field>
					{column.id !== "name" && (
						<Field label="Summary">
							<select className="dropdown" value={"agg" in c.value ? c.value.agg : "count"} onChange={(e) => onChange({ ...c, value: { agg: e.target.value, column } })}>
								{aggs.map((o) => (
									<option key={o.key} value={o.key}>
										{o.label}
									</option>
								))}
							</select>
						</Field>
					)}
				</>
			)}
			<Field label="Format" hint="Optional: number, integer, decimal:1, currency, percent, compact, or a pattern like #,##0 h.">
				<input type="text" value={c.format ?? ""} placeholder="Automatic" onChange={(e) => onChange({ ...c, format: e.target.value.trim() || undefined })} />
			</Field>
			<RulesSettings rules={c.rules ?? []} onChange={(rules) => onChange({ ...c, rules: rules.length ? rules : undefined })} />
		</>
	);
}

/** A card's colour rules: the first that its value meets colours the value or the card, with an optional icon. */
function RulesSettings({ rules, onChange }: { rules: CardRule[]; onChange: (r: CardRule[]) => void }) {
	const set = (i: number, patch: Partial<CardRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	return (
		<Field label="Colour rules" hint="The first rule the value meets applies. Percentages compare as shown (50 for 50%).">
			{rules.map((r, i) => (
				<div key={i} className="oe-dash-rule">
					<div className="oe-dash-row">
						<span className="oe-dash-muted-label">When</span>
						<select className="dropdown oe-dash-op" value={r.op} onChange={(e) => set(i, { op: e.target.value as CardRule["op"] })}>
							{RULE_OPS.map((o) => (
								<option key={o} value={o}>
									{o}
								</option>
							))}
						</select>
						<input type="number" value={r.value} onChange={(e) => set(i, { value: Number(e.target.value) || 0 })} />
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
						<select className="dropdown" value={r.on} aria-label="What it colours" onChange={(e) => set(i, { on: e.target.value === "card" ? "card" : "value" })}>
							<option value="value">the value</option>
							<option value="card">the card</option>
						</select>
						<select className="dropdown" value={r.icon ?? ""} aria-label="Icon" onChange={(e) => set(i, { icon: e.target.value || undefined })}>
							<option value="">No icon</option>
							{HIGHLIGHT_ICONS.map((ic) => (
								<option key={ic} value={ic}>
									{ic.replace(/-/g, " ")}
								</option>
							))}
						</select>
					</div>
				</div>
			))}
			<button onClick={() => onChange([...rules, { op: "<", value: 0, color: "red", on: "value" }])}>
				<Icon name="plus" /> Add rule
			</button>
		</Field>
	);
}

function ChartSettings({ c, env, views, onChange }: { c: Extract<DashComponent, { kind: "chart" }>; env: DashEnv; views: string[]; onChange: (c: DashComponent) => void }) {
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
	return (
		<>
			<Field label="Chart">
				<select
					className="dropdown"
					value={c.chart}
					onChange={(e) => {
						const chart = e.target.value as ChartKind;
						// A line needs a date to go along; the others group by a field (status unless one's chosen).
						const by = chart === "line" ? (c.by && dates.some((d) => d.col.id === c.by!.id) ? c.by : dates[0]?.col.def) : chart === "progress" ? c.by : c.by && !dates.some((d) => d.col.id === c.by!.id) ? c.by : columnFromId("status");
						onChange({ ...c, chart, by, done: chart === "progress" ? (c.done ?? { mode: "all", items: [] }) : c.done });
					}}
				>
					{CHART_KINDS.map((k) => (
						<option key={k} value={k}>
							{CHART_LABELS[k]}
						</option>
					))}
				</select>
			</Field>
			<SourceSettings source={c.source} env={env} views={views} onChange={(source) => onChange({ ...c, source })} />
			{c.chart === "line" ? (
				<>
					<Field label="Date" hint={dates.length ? undefined : "These notes have no date fields."}>
						<ColumnPick value={c.by?.id ?? ""} choices={dates} first="Choose a date…" onChange={(col) => onChange({ ...c, by: col?.def })} />
					</Field>
					<Field label="Every">
						<select className="dropdown" value={c.every ?? "month"} onChange={(e) => onChange({ ...c, every: e.target.value as TimeStep })}>
							<option value="week">Week</option>
							<option value="month">Month</option>
							<option value="year">Year</option>
						</select>
					</Field>
				</>
			) : (
				!progress && (
					<Field label={c.chart === "donut" ? "Slices by" : "Bars by"}>
						<ColumnPick
							value={c.by?.id ?? ""}
							choices={groupChoices}
							first="Choose a field…"
							onChange={(col) => {
								// A title still saying "By <the old field>" follows the new one.
								const old = c.by ? (groupChoices.find((x) => x.col.id === c.by!.id)?.col.label ?? "") : "";
								const auto = !c.title || c.title.toLowerCase() === `by ${old.toLowerCase()}`;
								onChange({ ...c, by: col?.def, ...(auto && col ? { title: `By ${col.label.toLowerCase()}` } : {}) });
							}}
						/>
					</Field>
				)
			)}
			{c.chart === "stacked" && (
				<Field label="Split each bar by">
					<ColumnPick value={c.split?.id ?? ""} choices={groupChoices} first="Choose a field…" onChange={(col) => onChange({ ...c, split: col?.def })} />
				</Field>
			)}
			{progress && (
				<FiltersPanel
					filters={c.done ?? { mode: "all", items: [] }}
					onChange={(done) => onChange({ ...c, done })}
					choices={choices}
					ctx={ctx}
					valuesOf={valuesFor(sdef, choices, env)}
					heading="Done when a note matches"
					emptyText="Add a condition, e.g. Status is done."
				/>
			)}
			<Field label={progress ? "Measure" : "Value"}>
				<select
					className="dropdown"
					value={c.measure.agg}
					onChange={(e) => {
						const agg = e.target.value as Measure["agg"];
						onChange({ ...c, measure: agg === "count" ? { agg } : { agg, column: c.measure.column ?? numbers[0]?.col.def } });
					}}
				>
					<option value="count">How many notes</option>
					<option value="sum">Sum of a number</option>
					<option value="avg">Average of a number</option>
				</select>
				{c.measure.agg !== "count" && (
					<ColumnPick value={c.measure.column?.id ?? ""} choices={numbers} first="Choose a number field…" onChange={(col) => onChange({ ...c, measure: { agg: c.measure.agg, column: col?.def } })} />
				)}
			</Field>
			<Field label="Format" hint="Optional, for the values: number, integer, currency, compact, or a pattern like #,##0 gp.">
				<input type="text" value={c.format ?? ""} placeholder="Automatic" onChange={(e) => onChange({ ...c, format: e.target.value.trim() || undefined })} />
			</Field>
			<div className="oe-dash-hint">In view mode, click a bar, slice or point to open its notes as a table.</div>
		</>
	);
}

function ListSettings({ c, env, views, onChange }: { c: Extract<DashComponent, { kind: "list" }>; env: DashEnv; views: string[]; onChange: (c: DashComponent) => void }) {
	const { ctx } = env;
	const lookup = { types: ctx.types, groups: ctx.groups };
	const sdef = sourceViewDef(c.source, env);
	const choices = useMemo(() => columnChoices(sdef, lookup), [sdef, ctx]);
	const sort = c.sort[0];
	return (
		<>
			<SourceSettings source={c.source} env={env} views={views} onChange={(source) => onChange({ ...c, source })} />
			<Field label="Fields" hint="Shown after each note's name.">
				{c.fields.map((f, i) => (
					<div key={`${f.id}-${i}`} className="oe-dash-row">
						<ColumnPick value={f.id} choices={choices} onChange={(col) => col && onChange({ ...c, fields: c.fields.map((x, j) => (j === i ? col.def : x)) })} />
						<button className="clickable-icon" aria-label="Remove field" onClick={() => onChange({ ...c, fields: c.fields.filter((_, j) => j !== i) })}>
							<Icon name="x" />
						</button>
					</div>
				))}
				{c.fields.length < 4 && (
					<ColumnPick value="" choices={choices.filter((x) => !c.fields.some((f) => f.id === x.col.id))} first="Add a field…" onChange={(col) => col && onChange({ ...c, fields: [...c.fields, col.def] })} />
				)}
			</Field>
			<Field label="Sort by">
				<div className="oe-dash-row">
					<ColumnPick
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
			</Field>
			<Field label="Show at most">
				<input type="number" min={1} max={500} value={c.limit} onChange={(e) => onChange({ ...c, limit: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} />
			</Field>
		</>
	);
}

function ButtonSettings({ c, onChange }: { c: Extract<DashComponent, { kind: "button" }>; onChange: (c: DashComponent) => void }) {
	const plugin = usePlugin();
	const { types, workflows } = plugin.settings;
	const runnable = workflows.filter((w) => noteless(w) || onNotes(w));
	const a = c.action;
	const kind = !a ? "" : "new" in a ? "new" : "workflow" in a ? "workflow" : "open";
	return (
		<>
			<Field label="Label">
				<input type="text" value={c.label} onChange={(e) => onChange({ ...c, label: e.target.value })} />
			</Field>
			<Field label="Icon" hint="A Lucide icon name, e.g. plus, scroll, swords.">
				<input type="text" value={c.icon ?? ""} placeholder="None" onChange={(e) => onChange({ ...c, icon: e.target.value.trim() || undefined })} />
			</Field>
			<Field label="When clicked">
				<select
					className="dropdown"
					value={kind}
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
			</Field>
			{a && "new" in a && (
				<Field label="Type">
					<select className="dropdown" value={a.new} onChange={(e) => onChange({ ...c, action: { new: e.target.value } })}>
						{types.map((t) => (
							<option key={t.key} value={t.key}>
								{t.name}
							</option>
						))}
					</select>
				</Field>
			)}
			{a && "workflow" in a && (
				<Field label="Workflow" hint={runnable.length ? "Forms open their form; buttons on notes ask which note." : "No form or button workflows yet."}>
					<select className="dropdown" value={a.workflow} onChange={(e) => onChange({ ...c, action: { workflow: e.target.value } })}>
						{runnable.map((w) => (
							<option key={w.id} value={w.id}>
								{w.name}
							</option>
						))}
					</select>
				</Field>
			)}
			{a && "open" in a && (
				<Field label="Note" hint="Its name, as you'd write it in a link.">
					<input type="text" value={a.open} placeholder="e.g. Quest board" onChange={(e) => onChange({ ...c, action: { open: e.target.value } })} />
				</Field>
			)}
		</>
	);
}
