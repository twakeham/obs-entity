import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
	OPERATORS,
	dateValue,
	isGroup,
	type ColumnDef,
	type Condition,
	type FilterGroup,
	type ResolvedColumn,
	type SortLevel,
	type ViewContext,
	type ViewDef,
} from "../../../model/views";
import type { EntityRecord } from "../../../services/entityIndex";
import { DATE_PRESETS, formatDate, formatIssue, formatNumber, NUMBER_PRESETS, type MomentLike } from "../../../model/formats";
import { EntitySuggest } from "../../components/entityPicker";
import { usePlugin } from "../context";
import { Icon } from "../Icon";

/** A floating panel under an anchor. Closes on outside click, Esc or scrolling the page behind it. */
export function Popover({ anchor, onClose, className, children, label }: { anchor: DOMRect; onClose: () => void; className?: string; children: ReactNode; label: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
	const close = useRef(onClose);
	close.current = onClose;
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 8 - r.width));
		let top = anchor.bottom + 4;
		if (top + r.height > window.innerHeight - 8 && anchor.top - r.height - 4 > 8) top = anchor.top - r.height - 4;
		setPos({ left, top });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	useEffect(() => {
		const outside = (t: EventTarget | null) => t instanceof Node && !ref.current?.contains(t) && !(t instanceof Element && t.closest(".suggestion-container, .menu, .modal-container"));
		// A text box saves on blur: blur it before closing so typed values aren't lost.
		const closeNow = () => {
			const a = document.activeElement;
			if (a instanceof HTMLElement && ref.current?.contains(a)) a.blur();
			close.current();
		};
		const down = (e: MouseEvent) => outside(e.target) && closeNow();
		const scroll = (e: Event) => outside(e.target) && closeNow();
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || document.querySelector(".suggestion-container")) return;
			// Esc in a box with unsaved typing cancels the typing first.
			if (e.target instanceof HTMLElement && e.target.dataset.dirty === "1") return;
			e.stopPropagation();
			close.current();
		};
		document.addEventListener("mousedown", down, true);
		document.addEventListener("scroll", scroll, true);
		document.addEventListener("keydown", key, true);
		return () => {
			document.removeEventListener("mousedown", down, true);
			document.removeEventListener("scroll", scroll, true);
			document.removeEventListener("keydown", key, true);
		};
	}, []);
	return createPortal(
		<div ref={ref} className={`oe-popover ${className ?? ""}`} style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={label}>
			{children}
		</div>,
		document.body,
	);
}

export interface ColumnChoice {
	col: ResolvedColumn;
	group: string;
}

function ColumnSelect({ value, choices, onChange, label }: { value: string; choices: ColumnChoice[]; onChange: (id: string) => void; label: string }) {
	const groups = [...new Set(choices.map((c) => c.group))];
	const known = choices.some((c) => c.col.id === value);
	return (
		<select className="dropdown oe-pop-select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
			{!known && <option value={value}>{value || "Choose…"}</option>}
			{groups.map((g) => (
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
		</select>
	);
}

// ---------------------------------------------------------------- filters

interface FilterProps {
	choices: ColumnChoice[];
	ctx: ViewContext;
	valuesOf: (id: string) => string[];
}

export function FiltersPanel({ filters, onChange, ...rest }: FilterProps & { filters: FilterGroup; onChange: (g: FilterGroup) => void }) {
	return (
		<div className="oe-filters">
			<GroupEditor group={filters} depth={0} onChange={onChange} {...rest} />
		</div>
	);
}

function GroupEditor({ group, depth, onChange, onRemove, ...rest }: FilterProps & { group: FilterGroup; depth: number; onChange: (g: FilterGroup) => void; onRemove?: () => void }) {
	const { choices } = rest;
	const set = (i: number, item: Condition | FilterGroup | null) => onChange({ ...group, items: item ? group.items.map((x, j) => (j === i ? item : x)) : group.items.filter((_, j) => j !== i) });
	const firstCol = choices.find((c) => c.col.id !== "name" && !c.col.invalid)?.col ?? choices[0]?.col;
	const newCondition = (): Condition => ({ field: firstCol?.id ?? "name", op: OPERATORS[firstCol?.kind ?? "text"][0].op });
	return (
		<div className={`oe-filter-group${depth ? " is-nested" : ""}`}>
			<div className="oe-filter-group-head">
				<span>{depth ? "Where" : "Show entities that match"}</span>
				<select className="dropdown oe-pop-select is-narrow" value={group.mode} aria-label="Match all or any" onChange={(e) => onChange({ ...group, mode: e.target.value as "all" | "any" })}>
					<option value="all">all</option>
					<option value="any">any</option>
				</select>
				<span>of these conditions</span>
				<span className="oe-spacer" />
				{onRemove && (
					<button className="clickable-icon" aria-label="Remove group" onClick={onRemove}>
						<Icon name="x" />
					</button>
				)}
			</div>
			{group.items.length === 0 && <div className="oe-pop-empty">No conditions: every entity is shown.</div>}
			{group.items.map((item, i) =>
				isGroup(item) ? (
					<GroupEditor key={i} group={item} depth={depth + 1} onChange={(g) => set(i, g)} onRemove={() => set(i, null)} {...rest} />
				) : (
					<ConditionEditor key={i} cond={item} onChange={(c) => set(i, c)} onRemove={() => set(i, null)} {...rest} />
				),
			)}
			<div className="oe-pop-actions">
				<button className="oe-pop-link" onClick={() => onChange({ ...group, items: [...group.items, newCondition()] })}>
					<Icon name="plus" /> Add condition
				</button>
				{depth === 0 && (
					<button className="oe-pop-link" onClick={() => onChange({ ...group, items: [...group.items, { mode: "any", items: [newCondition()] }] })}>
						<Icon name="plus" /> Add group
					</button>
				)}
			</div>
		</div>
	);
}

function ConditionEditor({ cond, onChange, onRemove, choices, ctx, valuesOf }: FilterProps & { cond: Condition; onChange: (c: Condition) => void; onRemove: () => void }) {
	const col = choices.find((c) => c.col.id === cond.field)?.col;
	const ops = col ? OPERATORS[col.kind] : [];
	const op = ops.find((o) => o.op === cond.op);
	const issue = !col ? `“${cond.field}” isn't a column of this view, so this condition is ignored.` : col.invalid ? col.invalid : !op ? `“${cond.op}” doesn't apply to ${col.label}, so this condition is ignored.` : null;
	return (
		<div className={`oe-condition${issue ? " is-invalid" : ""}`}>
			<ColumnSelect
				label="Column"
				value={cond.field}
				choices={choices}
				onChange={(id) => {
					const next = choices.find((c) => c.col.id === id)?.col;
					onChange({ field: id, op: next ? OPERATORS[next.kind][0].op : cond.op });
				}}
			/>
			<select
				className="dropdown oe-pop-select"
				value={cond.op}
				aria-label="Condition"
				onChange={(e) => {
					const same = ops.find((o) => o.op === e.target.value)?.value === op?.value;
					onChange({ field: cond.field, op: e.target.value, ...(same && cond.value !== undefined ? { value: cond.value } : {}) });
				}}
			>
				{!op && <option value={cond.op}>{cond.op}</option>}
				{ops.map((o) => (
					<option key={o.op} value={o.op}>
						{o.label}
					</option>
				))}
			</select>
			{col && op && <ValueEditor kind={op.value} col={col} value={cond.value} ctx={ctx} valuesOf={valuesOf} onChange={(v) => onChange({ ...cond, value: v })} />}
			<span className="oe-spacer" />
			{issue && (
				<span className="oe-condition-issue" aria-label={issue}>
					<Icon name="alert-triangle" />
				</span>
			)}
			<button className="clickable-icon" aria-label="Remove condition" onClick={onRemove}>
				<Icon name="x" />
			</button>
		</div>
	);
}

function DateBox({ value, ctx, onChange, label }: { value: unknown; ctx: ViewContext; onChange: (v: string) => void; label: string }) {
	const text = value === undefined || value === null ? "" : String(value);
	const d = dateValue(text, ctx);
	return (
		<span className="oe-datebox">
			<input type="text" className="oe-pop-input" value={text} placeholder="2026-01-31, today, -7d, +1m" aria-label={label} onChange={(e) => onChange(e.target.value)} />
			{text && <span className={`oe-datebox-hint${d === null ? " is-invalid" : ""}`}>{d === null ? "not a date" : ctx.dates.format(d, "short")}</span>}
		</span>
	);
}

function ValueEditor({ kind, col, value, ctx, valuesOf, onChange }: { kind: string; col: ResolvedColumn; value: unknown; ctx: ViewContext; valuesOf: (id: string) => string[]; onChange: (v: unknown) => void }) {
	const plugin = usePlugin();
	switch (kind) {
		case "none":
			return null;
		case "text":
			return <input type="text" className="oe-pop-input" value={value === undefined ? "" : String(value)} placeholder={col.kind === "folder" ? "Folder path" : "Text"} aria-label="Value" onChange={(e) => onChange(e.target.value)} />;
		case "number":
			return (
				<input
					type="text"
					inputMode="decimal"
					className="oe-pop-input is-number"
					value={value === undefined ? "" : String(value)}
					aria-label="Value"
					onChange={(e) => {
						const n = Number(e.target.value);
						onChange(e.target.value.trim() !== "" && Number.isFinite(n) ? n : e.target.value);
					}}
				/>
			);
		case "date":
			return <DateBox value={value} ctx={ctx} label="Date" onChange={onChange} />;
		case "range": {
			const [a, b] = Array.isArray(value) ? value : [value, undefined];
			return (
				<span className="oe-range">
					<DateBox value={a} ctx={ctx} label="From" onChange={(v) => onChange([v, b ?? ""])} />
					<span>and</span>
					<DateBox value={b} ctx={ctx} label="To" onChange={(v) => onChange([a ?? "", v])} />
				</span>
			);
		}
		case "choices": {
			const chosen = (Array.isArray(value) ? value : value === undefined || value === "" ? [] : [value]).map(String);
			const options = col.options?.length ? col.options : valuesOf(col.id);
			const label = (o: string) => (col.def.kind === "builtin" && col.def.key === "type" ? (plugin.getType(o)?.name ?? o) : o);
			const all = [...options, ...chosen.filter((c) => !options.includes(c))];
			return (
				<span className="oe-pop-pills" role="group" aria-label="Values">
					{all.length === 0 && <span className="oe-pop-empty">No values yet.</span>}
					{all.map((o) => (
						<button key={o} className={`oe-option${chosen.includes(o) ? " is-active" : ""}`} aria-pressed={chosen.includes(o)} onClick={() => onChange(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o])}>
							{label(o)}
						</button>
					))}
				</span>
			);
		}
		case "links":
			return <LinkValues col={col} value={value} onChange={onChange} />;
	}
	return null;
}

/** Chosen notes for "links to any / none of": chips plus a picker limited to the column's targets. */
function LinkValues({ col, value, onChange }: { col: ResolvedColumn; value: unknown; onChange: (v: unknown) => void }) {
	const plugin = usePlugin();
	const ref = useRef<HTMLInputElement>(null);
	const paths = (Array.isArray(value) ? value : value ? [value] : []).map(String);
	const latest = useRef(paths);
	latest.current = paths;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const targets = col.def.kind === "incoming" ? [col.def.type] : col.field?.targets;
	useEffect(() => {
		if (!ref.current) return;
		const s = new EntitySuggest(plugin.app, ref.current, plugin, {
			targets,
			allowCreate: false,
			exclude: () => new Set(latest.current),
			onPick: (e: EntityRecord) => onChangeRef.current([...latest.current, e.path]),
		});
		return () => s.close();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return (
		<span className="oe-pop-links">
			{paths.map((p) => (
				<span key={p} className="oe-pill is-removable">
					{plugin.index.get(p)?.name ?? p.split("/").pop()?.replace(/\.md$/, "")}
					<span className="oe-pill-x" role="button" aria-label="Remove" onClick={() => onChange(paths.filter((x) => x !== p))}>
						<Icon name="x" />
					</span>
				</span>
			))}
			<input ref={ref} type="text" className="oe-pop-input" placeholder="Choose…" aria-label="Choose a note" />
		</span>
	);
}

// ---------------------------------------------------------------- sort

export function SortPanel({ sort, choices, onChange }: { sort: SortLevel[]; choices: ColumnChoice[]; onChange: (s: SortLevel[]) => void }) {
	const [drag, setDrag] = useState<number | null>(null);
	const set = (i: number, s: SortLevel | null) => onChange(s ? sort.map((x, j) => (j === i ? s : x)) : sort.filter((_, j) => j !== i));
	const unused = choices.find((c) => !c.col.invalid && !sort.some((s) => s.by === c.col.id));
	return (
		<div className="oe-sortpanel">
			{sort.length === 0 && <div className="oe-pop-empty">Not sorted: rows are in name order.</div>}
			{sort.map((s, i) => (
				<div
					key={`${s.by}:${i}`}
					className={`oe-sortlevel${drag === i ? " is-dragging" : ""}`}
					draggable
					onDragStart={() => setDrag(i)}
					onDragEnd={() => setDrag(null)}
					onDragOver={(e) => e.preventDefault()}
					onDrop={(e) => {
						e.preventDefault();
						if (drag === null || drag === i) return;
						const next = [...sort];
						const [moved] = next.splice(drag, 1);
						next.splice(i, 0, moved);
						onChange(next);
						setDrag(null);
					}}
				>
					<span className="oe-drag" aria-hidden="true">
						<Icon name="grip-vertical" />
					</span>
					<span className="oe-sortlevel-n">{i === 0 ? "Sort by" : "then by"}</span>
					<ColumnSelect label="Sort column" value={s.by} choices={choices} onChange={(by) => set(i, { ...s, by })} />
					<select className="dropdown oe-pop-select is-narrow" value={s.dir} aria-label="Direction" onChange={(e) => set(i, { ...s, dir: e.target.value as "asc" | "desc" })}>
						<option value="asc">ascending</option>
						<option value="desc">descending</option>
					</select>
					<button className="clickable-icon" aria-label="Remove sort level" onClick={() => set(i, null)}>
						<Icon name="x" />
					</button>
				</div>
			))}
			<div className="oe-pop-actions">
				<button className="oe-pop-link" disabled={!unused} onClick={() => unused && onChange([...sort, { by: unused.col.id, dir: "asc" }])}>
					<Icon name="plus" /> Add sort level
				</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- group

export function GroupPanel({ def, choices, onChange }: { def: ViewDef; choices: ColumnChoice[]; onChange: (g: ViewDef["group"]) => void }) {
	const g = def.group;
	const col = g ? choices.find((c) => c.col.id === g.by)?.col : undefined;
	const usable = choices.filter((c) => c.col.id !== "name" && !c.col.invalid);
	return (
		<div className="oe-grouppanel">
			<div className="oe-condition">
				<span>Group by</span>
				<select className="dropdown oe-pop-select" value={g?.by ?? ""} aria-label="Group by" onChange={(e) => onChange(e.target.value ? { by: e.target.value } : undefined)}>
					<option value="">None</option>
					{[...new Set(usable.map((c) => c.group))].map((grp) => (
						<optgroup key={grp} label={grp}>
							{usable
								.filter((c) => c.group === grp)
								.map((c) => (
									<option key={c.col.id} value={c.col.id}>
										{c.col.label}
									</option>
								))}
						</optgroup>
					))}
				</select>
				{col?.kind === "date" && (
					<select className="dropdown oe-pop-select is-narrow" value={g?.date ?? ""} aria-label="Date grouping" onChange={(e) => onChange({ by: g!.by, ...(e.target.value ? { date: e.target.value as "month" | "year" } : {}) })}>
						<option value="">by day</option>
						<option value="month">by month</option>
						<option value="year">by year</option>
					</select>
				)}
			</div>
			<div className="oe-pop-hint">Rows with several values (lists, links) appear in each of their groups.</div>
		</div>
	);
}

// ---------------------------------------------------------------- format

/** Display format for a number or date column: presets with examples, a custom pattern, and a live preview. */
export function FormatPanel({
	label,
	kind,
	format,
	sample,
	ctx,
	onChange,
}: {
	label: string;
	kind: "number" | "date";
	format: string | undefined;
	/** a real value from the column (a number, or a date in days), for the examples */
	sample: number;
	ctx: ViewContext;
	onChange: (format: string | undefined) => void;
}) {
	const presets = kind === "date" ? DATE_PRESETS : NUMBER_PRESETS;
	const currency = (ctx.currency ?? "AUD").toUpperCase();
	const presetOf = (f: string | undefined) => (!f ? "" : kind === "number" && f.startsWith("currency") ? "currency" : presets.some((p) => p.format === f) ? f : "custom");
	const [choice, setChoice] = useState(presetOf(format));
	const [custom, setCustom] = useState(choice === "custom" ? (format ?? "") : kind === "date" ? "D MMMM YYYY" : "#,##0.00");
	const [code, setCode] = useState(format?.startsWith("currency:") ? format.slice(9) : currency);
	const show = (f: string) => {
		try {
			return kind === "date" ? formatDate(sample, f, ctx.moment as MomentLike, ctx.today) : formatNumber(sample, f, ctx.locale ?? "en", currency);
		} catch {
			return "—";
		}
	};
	const apply = (next: string, c = custom, cur = code) => {
		setChoice(next);
		if (!next) return onChange(undefined);
		const f = next === "custom" ? c : next === "currency" ? `currency:${cur.toUpperCase()}` : next;
		if (!formatIssue(kind, f)) onChange(f);
	};
	const current = choice === "custom" ? custom : choice === "currency" ? `currency:${code.toUpperCase()}` : choice;
	const issue = choice ? formatIssue(kind, current) : null;
	const raw = kind === "date" ? ctx.dates.format(sample, "short") : String(sample);
	return (
		<div className="oe-formatpanel">
			<div className="oe-pop-heading">Format {label}</div>
			<label className="oe-format-item">
				<input type="radio" name="oe-format" checked={!choice} onChange={() => apply("")} />
				<span className="oe-columns-label">Default</span>
				<span className="oe-format-example">{raw}</span>
			</label>
			{presets.map((p) => (
				<label key={p.format} className="oe-format-item">
					<input type="radio" name="oe-format" checked={choice === p.format} onChange={() => apply(p.format)} />
					<span className="oe-columns-label">{p.label}</span>
					<span className="oe-format-example">{show(p.format === "currency" ? `currency:${code}` : p.format)}</span>
				</label>
			))}
			{choice === "currency" && (
				<div className="oe-condition oe-format-sub">
					<span>Currency code</span>
					<input
						type="text"
						className="oe-pop-input is-number"
						value={code}
						maxLength={3}
						aria-label="Currency code"
						onChange={(e) => {
							setCode(e.target.value);
							apply("currency", custom, e.target.value);
						}}
					/>
				</div>
			)}
			<label className="oe-format-item">
				<input type="radio" name="oe-format" checked={choice === "custom"} onChange={() => apply("custom")} />
				<span className="oe-columns-label">Custom</span>
			</label>
			{choice === "custom" && (
				<div className="oe-format-sub">
					<input
						type="text"
						className="oe-pop-input oe-format-input"
						value={custom}
						aria-label="Custom format"
						placeholder={kind === "date" ? "D MMMM YYYY" : "$#,##0.00"}
						onChange={(e) => {
							setCustom(e.target.value);
							apply("custom", e.target.value);
						}}
					/>
					<div className="oe-pop-hint">
						{kind === "date" ? (
							<>
								moment.js tokens, e.g. <code>ddd D MMM</code>, <code>[Week] W</code>.{" "}
								<a href="https://momentjs.com/docs/#/displaying/format/" target="_blank" rel="noopener">
									Token reference
								</a>
							</>
						) : (
							<>
								<code>#</code> and <code>0</code> are digits, <code>,</code> groups thousands, <code>.00</code> sets decimals; other text is kept, e.g. <code>$#,##0</code> or <code>#,##0 h</code>.
							</>
						)}
					</div>
				</div>
			)}
			<div className={`oe-format-preview${issue ? " is-invalid" : ""}`}>{issue ?? (choice ? `Preview: ${show(current)}` : `Preview: ${raw}`)}</div>
		</div>
	);
}

// ---------------------------------------------------------------- columns

export function ColumnsPanel({
	def,
	available,
	labelOf,
	onToggle,
	onAddRollup,
	onEditRollup,
}: {
	def: ViewDef;
	available: { title: string; columns: ColumnDef[] }[];
	labelOf: (c: ColumnDef) => string;
	onToggle: (c: ColumnDef, on: boolean) => void;
	onAddRollup: () => void;
	onEditRollup: (c: Extract<ColumnDef, { kind: "rollup" }>) => void;
}) {
	const shown = new Set(def.columns.map((c) => c.id));
	const computed = def.columns.filter((c): c is Extract<ColumnDef, { kind: "rollup" | "formula" }> => c.kind === "rollup" || c.kind === "formula");
	return (
		<div className="oe-columnspanel">
			{available
				.filter((s) => s.columns.length)
				.map((s) => (
					<div key={s.title} className="oe-columns-section">
						<div className="oe-pop-heading">{s.title}</div>
						{s.columns.map((c) => (
							<label key={c.id} className="oe-columns-item">
								<input type="checkbox" checked={shown.has(c.id)} onChange={(e) => onToggle(c, e.target.checked)} />
								<span className="oe-columns-label">{labelOf(c)}</span>
							</label>
						))}
					</div>
				))}
			<div className="oe-columns-section">
				<div className="oe-pop-heading">Roll-ups and formulas</div>
				{computed.length === 0 && <div className="oe-pop-empty">Summarise linked notes: counts, sums, latest dates…</div>}
				{computed.map((c) => (
					<div key={c.id} className="oe-columns-item">
						<input type="checkbox" checked onChange={() => onToggle(c, false)} aria-label={`Remove ${labelOf(c)}`} />
						<span className="oe-columns-label">{labelOf(c)}</span>
						{c.kind === "rollup" ? (
							<button className="clickable-icon" aria-label="Edit roll-up" onClick={() => onEditRollup(c)}>
								<Icon name="pencil" />
							</button>
						) : (
							<span className="oe-pop-hint">not supported yet</span>
						)}
					</div>
				))}
				<div className="oe-pop-actions">
					<button className="oe-pop-link" onClick={onAddRollup}>
						<Icon name="plus" /> Add roll-up…
					</button>
				</div>
			</div>
		</div>
	);
}
