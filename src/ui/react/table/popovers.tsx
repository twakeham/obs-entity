import { Menu } from "obsidian";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
	HIGHLIGHT_COLORS,
	HIGHLIGHT_ICONS,
	OPERATORS,
	ROW_TARGET,
	dateValue,
	columnFromId,
	conditionIssue,
	NEEDS_VALUE,
	THIS_NOTE,
	thisNoteCondition,
	isGroup,
	type ColumnDef,
	type Condition,
	type FilterGroup,
	type GroupBy,
	type HighlightColor,
	type HighlightRule,
	type HighlightStyle,
	type BarOptions,
	type ScaleBound,
	type ScaleOptions,
	type ResolvedColumn,
	type SortLevel,
	type ViewContext,
	type ViewDef,
} from "../../../model/views";
import type { EntityRecord } from "../../../services/entityIndex";
import { DATE_PRESETS, formatDate, formatIssue, formatNumber, NUMBER_PRESETS, type MomentLike } from "../../../model/formats";
import { EntitySuggest } from "../../components/entityPicker";
import { CONTROL_FOR_VALUE, filterToken, tokenOf, type FilterControl } from "../../../model/dashboardFilters";
import { choiceColor, statusColorAmong } from "../../../model/colors";
import { colorClass } from "../EntityBits";
import { usePlugin } from "../context";
import { CalendarPopover } from "../Calendar";
import { Icon } from "../Icon";
import { IconPicker } from "../types/controls";

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
		const outside = (t: EventTarget | null) => t instanceof Node && !ref.current?.contains(t) && !(t instanceof Element && t.closest(".suggestion-container, .menu, .modal-container, .oe-tm-popover"));
		// A text box saves on blur: blur it before closing so typed values aren't lost.
		const closeNow = () => {
			const a = document.activeElement;
			if (a instanceof HTMLElement && ref.current?.contains(a)) a.blur();
			close.current();
		};
		const down = (e: MouseEvent) => outside(e.target) && closeNow();
		// Close when the user scrolls the page, not when the page scrolls by itself: in Live Preview an embedded
		// view's editor shifts its scroll as the view opens a panel or changes height (e.g. a filter edit).
		const scroll = (e: Event) => outside(e.target) && closeNow();
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || document.querySelector(".suggestion-container, .oe-tm-popover")) return;
			// Esc in a box with unsaved typing cancels the typing first.
			if (e.target instanceof HTMLElement && e.target.dataset.dirty === "1") return;
			e.stopPropagation();
			close.current();
		};
		document.addEventListener("mousedown", down, true);
		document.addEventListener("wheel", scroll, { capture: true, passive: true });
		document.addEventListener("touchmove", scroll, { capture: true, passive: true });
		document.addEventListener("keydown", key, true);
		return () => {
			document.removeEventListener("mousedown", down, true);
			document.removeEventListener("wheel", scroll, true);
			document.removeEventListener("touchmove", scroll, true);
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
	/** top-level heading and empty text (filters by default) */
	heading?: string;
	emptyText?: string;
	/** conditions only, no nested groups (a form layout's "show only when") */
	noGroups?: boolean;
	/**
	 * Offer "this note" for link conditions (views): the note the view is shown on, or null where there's none (the
	 * view note open on its own). Undefined: not offered.
	 */
	thisNote?: string | null;
	/** what "this note" is where it's always there (a workflow's note): it's never ignored, and is described so */
	thisIs?: string;
	/**
	 * A dashboard's filters: a condition's value can be one (stored as `{id}`), taking what's picked in it. Offered
	 * where the filter's control fits the value (a note filter for links, a choice filter for choices…).
	 */
	dashFilters?: { id: string; label: string; control: FilterControl }[];
}

export function FiltersPanel({ filters, onChange, ...rest }: FilterProps & { filters: FilterGroup; onChange: (g: FilterGroup) => void }) {
	return (
		<div className="oe-filters">
			<GroupEditor group={filters} depth={0} onChange={onChange} {...rest} />
		</div>
	);
}

/** A first condition for a new filter or rule: on `field` if given, else the first usable column. */
function firstCondition(choices: ColumnChoice[], field?: string): Condition {
	const col = (field ? choices.find((c) => c.col.id === field)?.col : undefined) ?? choices.find((c) => c.col.id !== "name" && !c.col.invalid)?.col ?? choices[0]?.col;
	return { field: col?.id ?? "name", op: OPERATORS[col?.kind ?? "text"][0].op };
}

function GroupEditor({ group, depth, onChange, onRemove, ...rest }: FilterProps & { group: FilterGroup; depth: number; onChange: (g: FilterGroup) => void; onRemove?: () => void }) {
	const { choices, heading, emptyText, noGroups } = rest;
	const set = (i: number, item: Condition | FilterGroup | null) => onChange({ ...group, items: item ? group.items.map((x, j) => (j === i ? item : x)) : group.items.filter((_, j) => j !== i) });
	const newCondition = (): Condition => firstCondition(choices);
	return (
		<div className={`oe-filter-group${depth ? " is-nested" : ""}`}>
			<div className="oe-filter-group-head">
				<span>{depth ? "Where" : (heading ?? "Show entities that match")}</span>
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
			{group.items.length === 0 && <div className="oe-pop-empty">{emptyText ?? "No conditions: every entity is shown."}</div>}
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
				{depth === 0 && !noGroups && (
					<button className="oe-pop-link" onClick={() => onChange({ ...group, items: [...group.items, { mode: "any", items: [newCondition()] }] })}>
						<Icon name="plus" /> Add group
					</button>
				)}
			</div>
		</div>
	);
}

function ConditionEditor({ cond, onChange, onRemove, choices, ctx, valuesOf, thisNote, thisIs, dashFilters: filters }: FilterProps & { cond: Condition; onChange: (c: Condition) => void; onRemove: () => void }) {
	const col = choices.find((c) => c.col.id === cond.field)?.col;
	const ops = col ? OPERATORS[col.kind] : [];
	const op = ops.find((o) => o.op === cond.op);
	// A dashboard filter as the value: the filters whose control fits this kind of value, and the one chosen.
	const control = op ? CONTROL_FOR_VALUE[op.value] : undefined;
	const fitting = (filters ?? []).filter((f) => f.control === control);
	const token = tokenOf(cond.value);
	const tokenFilter = token === null ? undefined : filters?.find((f) => f.id === token);
	// Checked as it runs: "this note" is the note the view is on (always there in a workflow: any stand-in will do).
	const issue =
		token !== null && filters
			? tokenFilter
				? null
				: `There's no filter “${token}” on this dashboard.`
			: conditionIssue(thisNote === undefined ? cond : thisNoteCondition(cond, thisIs ? "this-note" : thisNote), new Map(choices.map((c) => [c.col.id, c.col])), ctx);
	const incomplete = issue === NEEDS_VALUE;
	const useFilter = (id: string) => onChange({ ...cond, value: control === "note" || control === "choice" ? [filterToken(id)] : filterToken(id) });
	return (
		<div className={`oe-condition${issue ? (incomplete ? " is-incomplete" : " is-invalid") : ""}`}>
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
			{col && op && token !== null && filters ? (
				<span className="oe-pill oe-cond-filter is-removable" title="Takes what's picked in this filter on the dashboard. Nothing picked: the condition is left out.">
					<Icon name="filter" />
					<span>{tokenFilter?.label ?? token}</span>
					<span className="oe-pill-x" role="button" aria-label="Stop using the filter" onClick={() => onChange({ field: cond.field, op: cond.op })}>
						<Icon name="x" />
					</span>
				</span>
			) : (
				col && op && <ValueEditor kind={op.value} col={col} value={cond.value} ctx={ctx} valuesOf={valuesOf} thisNote={thisNote} thisIs={thisIs} onChange={(v) => onChange({ ...cond, value: v })} />
			)}
			{token === null && fitting.length > 0 && (
				<button
					className="clickable-icon oe-cond-usefilter"
					aria-label={fitting.length === 1 ? `Use the filter “${fitting[0].label}”` : "Use a filter"}
					title={fitting.length === 1 ? `Use the filter “${fitting[0].label}”` : "Use a filter"}
					onClick={(e) => {
						if (fitting.length === 1) return useFilter(fitting[0].id);
						const menu = new Menu();
						for (const f of fitting) menu.addItem((i) => i.setTitle(f.label).setIcon("filter").onClick(() => useFilter(f.id)));
						menu.showAtMouseEvent(e.nativeEvent);
					}}
				>
					<Icon name="filter" />
				</button>
			)}
			<span className="oe-spacer" />
			<button className="clickable-icon" aria-label="Remove condition" onClick={onRemove}>
				<Icon name="x" />
			</button>
			{issue && (
				<div className="oe-condition-issue" role="note">
					<Icon name={incomplete ? "info" : "alert-triangle"} />
					<span>
						{issue} {incomplete ? "Until then, this condition is ignored." : "This condition is ignored."}
					</span>
				</div>
			)}
		</div>
	);
}

/**
 * A date as in filters: a date, or relative to today ("today", "-7d", "+1m"), with what it means now. With `picker`,
 * a button opens a calendar (dates the adapter can show in one); typing carries on while it's open.
 */
export function DateBox({ value, ctx, onChange, label, picker }: { value: unknown; ctx: Pick<ViewContext, "dates" | "today">; onChange: (v: string) => void; label: string; picker?: boolean }) {
	const text = value === undefined || value === null ? "" : String(value);
	const d = dateValue(text, ctx);
	const inputRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const { toPicker, fromPicker } = ctx.dates;
	const canPick = picker && !!toPicker && !!fromPicker;
	const iso = d === null ? null : new Date(d * 86_400_000).toISOString().slice(0, 10);
	return (
		<span className="oe-datebox">
			<input
				ref={inputRef}
				type="text"
				className="oe-pop-input"
				value={text}
				placeholder="2026-01-31, today, -7d, +1m"
				aria-label={label}
				onChange={(e) => onChange(e.target.value)}
				onBlur={() => setOpen(false)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && open) setOpen(false);
				}}
			/>
			{canPick && (
				<button
					type="button"
					className={`oe-datebox-pick${open ? " is-active" : ""}`}
					aria-label="Pick a date"
					// Keep focus in the box, so the calendar stays open while typing.
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => {
						inputRef.current?.focus();
						setOpen(!open);
					}}
				>
					<Icon name="calendar" />
				</button>
			)}
			{text && <span className={`oe-datebox-hint${d === null ? " is-invalid" : ""}`}>{d === null ? "not a date" : ctx.dates.format(d, "short")}</span>}
			{canPick && open && inputRef.current && (
				<CalendarPopover
					anchor={inputRef.current}
					value={iso}
					onPick={(day) => {
						onChange(fromPicker!.call(ctx.dates, day));
						setOpen(false);
					}}
					onClear={() => {
						onChange("");
						setOpen(false);
					}}
					onClose={() => setOpen(false)}
				/>
			)}
		</span>
	);
}

function ValueEditor({ kind, col, value, ctx, valuesOf, thisNote, thisIs, onChange }: { kind: string; col: ResolvedColumn; value: unknown; ctx: ViewContext; valuesOf: (id: string) => string[]; thisNote?: string | null; thisIs?: string; onChange: (v: unknown) => void }) {
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
		case "numrange": {
			const [a, b] = Array.isArray(value) ? value : [value, undefined];
			const box = (v: unknown, label: string, set: (x: unknown) => void) => (
				<input
					type="text"
					inputMode="decimal"
					className="oe-pop-input is-number"
					value={v === undefined || v === null ? "" : String(v)}
					placeholder="any"
					aria-label={label}
					onChange={(e) => {
						const n = Number(e.target.value);
						set(e.target.value.trim() !== "" && Number.isFinite(n) ? n : e.target.value);
					}}
				/>
			);
			return (
				<span className="oe-range">
					{box(a, "From", (x) => onChange([x, b ?? ""]))}
					<span>and</span>
					{box(b, "To", (x) => onChange([a ?? "", x]))}
				</span>
			);
		}
		case "bool":
			return (
				<select className="dropdown oe-pop-select" aria-label="Value" value={value === true || value === "true" ? "true" : value === false || value === "false" ? "false" : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}>
					<option value="">Choose…</option>
					<option value="true">Yes</option>
					<option value="false">No</option>
				</select>
			);
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
			// Coloured choices and statuses keep their colour here too.
			const tint = (o: string) =>
				colorClass(col.def.kind === "builtin" && col.def.key === "status" ? statusColorAmong(o, ctx.types, ctx.groups) : col.field?.kind === "select" || col.field?.kind === "multiselect" ? choiceColor(col.field, o) : null);
			const all = [...options, ...chosen.filter((c) => !options.includes(c))];
			return (
				<span className="oe-pop-pills" role="group" aria-label="Values">
					{all.length === 0 && <span className="oe-pop-empty">No values yet.</span>}
					{all.map((o) => (
						<button key={o} className={`oe-option${chosen.includes(o) ? " is-active" : ""}${tint(o)}`} aria-pressed={chosen.includes(o)} onClick={() => onChange(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o])}>
							{label(o)}
						</button>
					))}
				</span>
			);
		}
		case "links":
			return <LinkValues targets={col.def.kind === "incoming" ? [col.def.type] : col.field?.targets} value={value} thisNote={thisNote} thisIs={thisIs} onChange={onChange} />;
	}
	return null;
}

/**
 * Chosen notes for "links to any / none of": chips plus a picker limited to the column's targets. In views the
 * picker offers "This note" first (stored as `{this}`).
 */
export function LinkValues({
	targets,
	value,
	thisNote,
	thisIs,
	single,
	chips,
	onChange,
}: {
	targets: string[] | undefined;
	value: unknown;
	thisNote?: string | null;
	/** what "this note" is, when it isn't the note a view is on (a workflow's note) */
	thisIs?: string;
	/** one note: picking another replaces it */
	single?: boolean;
	/** show the notes as the properties form's entity chips (type icon and colour) */
	chips?: boolean;
	onChange: (v: string[]) => void;
}) {
	const plugin = usePlugin();
	const ref = useRef<HTMLInputElement>(null);
	const paths = (Array.isArray(value) ? value : value ? [value] : []).map(String);
	const latest = useRef(paths);
	latest.current = paths;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const offerThis = useRef(thisNote !== undefined);
	offerThis.current = thisNote !== undefined;
	const thisName = thisNote ? (plugin.index.get(thisNote)?.name ?? thisNote.split("/").pop()?.replace(/\.md$/, "")) : null;
	const about = thisIs ?? (thisName ? `The note the view is on (here: ${thisName})` : "The note the view is on");
	const thisText = useRef(about);
	thisText.current = about;
	const singleRef = useRef(single);
	singleRef.current = single;
	useEffect(() => {
		if (!ref.current) return;
		const s = new EntitySuggest(plugin.app, ref.current, plugin, {
			targets,
			allowCreate: false,
			exclude: () => new Set(latest.current),
			onPick: (e: EntityRecord) => onChangeRef.current(singleRef.current ? [e.path] : [...latest.current, e.path]),
			extra: () =>
				offerThis.current && !latest.current.includes(THIS_NOTE)
					? {
							label: "This note",
							icon: "file",
							note: thisText.current,
							onPick: () => onChangeRef.current([THIS_NOTE, ...latest.current]),
						}
					: null,
		});
		return () => s.close();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return (
		<span className={chips ? "oe-prop-chips oe-pop-links" : "oe-pop-links"}>
			{chips &&
				paths.map((p) => {
					const e = plugin.index.get(p);
					const name = e?.name ?? p.split("/").pop()?.replace(/\.md$/, "") ?? p;
					return (
						<span key={p} className="oe-prop-chip">
							<span className={`oe-chip oe-chip-link${e ? "" : " is-unresolved"}`} style={e ? ({ "--oe-type-color": e.type.color } as CSSProperties) : undefined} data-path={p}>
								<Icon name={e ? e.type.icon : "file-question"} className="oe-chip-icon" />
								<span className="oe-chip-text">{name}</span>
								<span className="oe-chip-remove" role="button" aria-label={`Remove ${name}`} onClick={() => onChange(paths.filter((x) => x !== p))}>
									<Icon name="x" />
								</span>
							</span>
						</span>
					);
				})}
			{!chips && paths.map((p) => (
				<span key={p} className={`oe-pill is-removable${p === THIS_NOTE ? " is-this-note" : ""}`} title={p === THIS_NOTE ? (thisIs ?? (thisName ? `Here: ${thisName}` : "The note the view is on")) : undefined}>
					{p === THIS_NOTE ? (
						<>
							<Icon name="file" /> This note
						</>
					) : (
						(plugin.index.get(p)?.name ?? p.split("/").pop()?.replace(/\.md$/, ""))
					)}
					<span className="oe-pill-x" role="button" aria-label="Remove" onClick={() => onChange(paths.filter((x) => x !== p))}>
						<Icon name="x" />
					</span>
				</span>
			))}
			<input ref={ref} type="text" className={chips ? "oe-prop-add" : "oe-pop-input"} placeholder={single && paths.length ? "Change…" : chips && paths.length ? "Add…" : "Choose…"} aria-label="Choose a note" />
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

export function GroupPanel({
	def,
	choices,
	onChange,
}: {
	def: ViewDef;
	choices: ColumnChoice[];
	onChange: (group: GroupBy[], groupSummaries: false | undefined, groupFieldNames: false | undefined) => void;
}) {
	const levels = def.group;
	const [drag, setDrag] = useState<number | null>(null);
	const usable = choices.filter((c) => c.col.id !== "name" && !c.col.invalid);
	const emit = (next: GroupBy[]) => onChange(next, def.groupSummaries, def.groupFieldNames);
	const set = (i: number, g: GroupBy | null) => emit(g ? levels.map((x, j) => (j === i ? g : x)) : levels.filter((_, j) => j !== i));
	const unused = usable.find((c) => !levels.some((g) => g.by === c.col.id));
	return (
		<div className="oe-grouppanel">
			{levels.length === 0 && <div className="oe-pop-empty">Not grouped.</div>}
			{levels.map((g, i) => {
				const col = choices.find((c) => c.col.id === g.by)?.col;
				// A column can only be one level: hide those used by the other levels.
				const options = choices.filter((c) => c.col.id === g.by || usable.includes(c)).filter((c) => c.col.id === g.by || !levels.some((x) => x.by === c.col.id));
				return (
					<div
						key={`${g.by}:${i}`}
						className={`oe-sortlevel${drag === i ? " is-dragging" : ""}`}
						draggable
						onDragStart={() => setDrag(i)}
						onDragEnd={() => setDrag(null)}
						onDragOver={(e) => e.preventDefault()}
						onDrop={(e) => {
							e.preventDefault();
							if (drag === null || drag === i) return;
							const next = [...levels];
							const [moved] = next.splice(drag, 1);
							next.splice(i, 0, moved);
							emit(next);
							setDrag(null);
						}}
					>
						<span className="oe-drag" aria-hidden="true">
							<Icon name="grip-vertical" />
						</span>
						<span className="oe-sortlevel-n">{i === 0 ? "Group by" : "then by"}</span>
						<ColumnSelect label={`Group level ${i + 1}`} value={g.by} choices={options} onChange={(by) => set(i, { by })} />
						{col?.kind === "date" && (
							<select className="dropdown oe-pop-select is-narrow" value={g.date ?? ""} aria-label="Date grouping" onChange={(e) => set(i, { by: g.by, ...(e.target.value ? { date: e.target.value as "month" | "year" } : {}) })}>
								<option value="">by day</option>
								<option value="month">by month</option>
								<option value="year">by year</option>
							</select>
						)}
						<button className="clickable-icon" aria-label="Remove group level" onClick={() => set(i, null)}>
							<Icon name="x" />
						</button>
					</div>
				);
			})}
			<div className="oe-pop-actions">
				<button className="oe-pop-link" disabled={!unused} onClick={() => unused && emit([...levels, { by: unused.col.id }])}>
					<Icon name="plus" /> Add level
				</button>
			</div>
			<div className="oe-pop-hint">Grouped columns are hidden from the table: their value is in the group header. Rows with several values (lists, links) appear in each of their groups.</div>
			{levels.length > 0 && (
				<>
					<label className="oe-columns-item">
						<input type="checkbox" checked={def.groupFieldNames !== false} onChange={(e) => onChange(levels, def.groupSummaries, e.target.checked ? undefined : false)} />
						<span className="oe-columns-label">Show field names in group headers</span>
					</label>
					<label className="oe-columns-item">
						<input type="checkbox" checked={def.groupSummaries !== false} onChange={(e) => onChange(levels, e.target.checked ? undefined : false, def.groupFieldNames)} />
						<span className="oe-columns-label">Show summaries in group headers</span>
					</label>
				</>
			)}
		</div>
	);
}
// ---------------------------------------------------------------- format

/** Display format for a number or date column: presets with examples, a custom pattern, and a live preview. */
export function FormatPanel({
	label,
	kind,
	format,
	fallback,
	sample,
	ctx,
	onChange,
}: {
	label: string;
	kind: "number" | "date";
	format: string | undefined;
	/** the format "Default" stands for (the field's, or the Date display format setting) */
	fallback?: string;
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
	const raw = fallback ? show(fallback) : kind === "date" ? ctx.dates.format(sample, "short") : String(sample);
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

// ---------------------------------------------------------------- highlight

const COLOR_LABEL: Record<HighlightColor, string> = { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple", pink: "Pink", grey: "Grey" };
const ICON_LABEL: Record<string, string> = {
	"alert-triangle": "Warning",
	"alert-circle": "Alert",
	"check-circle": "Done",
	clock: "Clock",
	flag: "Flag",
	star: "Star",
	flame: "Flame",
	"circle-dot": "Dot",
	"x-circle": "Cross",
	lock: "Lock",
};

/** CSS classes for a highlight style (on a table cell, a sample, later a card). */
export function hlClasses(style: HighlightStyle | undefined): string {
	if (!style) return "";
	const c: string[] = [];
	if (style.fill) c.push("oe-hl-fill", `oe-hl-fill-${style.fill}`);
	if (style.text) c.push("oe-hl-text", `oe-hl-text-${style.text}`);
	if (style.bold) c.push("oe-hl-bold");
	if (style.italic) c.push("oe-hl-italic");
	if (style.strike) c.push("oe-hl-strike");
	return c.join(" ");
}

/** A new rule for a target: one condition on that column (or the first usable one), highlighted yellow. */
export function newHighlightRule(target: string, choices: ColumnChoice[]): HighlightRule {
	return { target, when: { mode: "all", items: [firstCondition(choices, target === ROW_TARGET ? undefined : target)] }, style: { fill: "yellow" } };
}

/** CSS colour for a palette colour (theme variables, so light and dark themes both work). */
export const cssColor = (c: HighlightColor) => (c === "grey" ? "var(--text-muted)" : `var(--color-${c})`);

/** A colour scale's cell fill at position t (0–1): mixed between its 2 or 3 colours, as a tint like highlight fills. */
export function scaleFill(colors: HighlightColor[], t: number, strength = 30): string {
	const [a, b, c] = colors.map(cssColor);
	let mixed: string;
	if (colors.length === 3) mixed = t <= 0.5 ? `color-mix(in srgb, ${b} ${Math.round(t * 200)}%, ${a})` : `color-mix(in srgb, ${c} ${Math.round((t - 0.5) * 200)}%, ${b})`;
	else mixed = `color-mix(in srgb, ${b} ${Math.round(t * 100)}%, ${a})`;
	return `color-mix(in srgb, ${mixed} ${strength}%, var(--background-primary))`;
}

export const SCALE_PRESETS: { label: string; colors: HighlightColor[] }[] = [
	{ label: "Red → Yellow → Green", colors: ["red", "yellow", "green"] },
	{ label: "Green → Yellow → Red", colors: ["green", "yellow", "red"] },
	{ label: "Grey → Blue", colors: ["grey", "blue"] },
	{ label: "Red → Green", colors: ["red", "green"] },
];

const isMeasurable = (c: ResolvedColumn) => !c.invalid && (c.kind === "number" || c.kind === "date");

/** A data bar (blue, automatic range) or colour scale (red → yellow → green) on a number or date column. */
export function newVizRule(kind: "bar" | "scale", target: string): HighlightRule {
	return kind === "bar"
		? { kind, target, when: { mode: "all", items: [] }, style: {}, bar: { color: "blue" } }
		: { kind, target, when: { mode: "all", items: [] }, style: {}, scale: { colors: ["red", "yellow", "green"] } };
}

/** "Status is any of done, review" (+ how many more conditions) for a rule without a name. */
function ruleSummary(r: HighlightRule, choices: ColumnChoice[], filters?: FilterProps["dashFilters"]): string {
	if (r.kind === "bar" || r.kind === "scale") {
		const col = choices.find((x) => x.col.id === r.target)?.col.label ?? r.target;
		return `${r.kind === "bar" ? "Data bar" : "Colour scale"} on ${col}`;
	}
	const all: Condition[] = [];
	const walk = (g: FilterGroup) => g.items.forEach((i) => (isGroup(i) ? walk(i) : all.push(i)));
	walk(r.when);
	if (!all.length) return "Every row";
	const c = all[0];
	const col = choices.find((x) => x.col.id === c.field)?.col;
	const op = col ? OPERATORS[col.kind].find((o) => o.op === c.op) : undefined;
	const token = tokenOf(c.value);
	const value =
		token !== null
			? `[${filters?.find((f) => f.id === token)?.label ?? token}]`
			: Array.isArray(c.value)
				? c.value.map((v) => String(v).replace(/^.*\//, "").replace(/\.md$/, "")).join(", ")
				: c.value === undefined
					? ""
					: String(c.value);
	const first = [col?.label ?? c.field, op?.label ?? c.op, value].filter(Boolean).join(" ");
	return all.length > 1 ? `${first} +${all.length - 1}` : first;
}

/** A data bar's or colour scale's end point: automatic, a fixed value (a number, or a date / "today" / "+30d" for dates), or a percentile. */
function BoundEditor({ value, label, isDate, auto, onChange }: { value: ScaleBound | undefined; label: string; isDate: boolean; auto: string; onChange: (v: ScaleBound | undefined) => void }) {
	const mode = value === undefined || value === "auto" ? "auto" : typeof value === "string" && /^p\d/i.test(value) ? "pct" : "fixed";
	const text = mode === "pct" ? String(value).slice(1) : mode === "fixed" ? String(value) : "";
	return (
		<span className="oe-condition">
			<select
				className="dropdown oe-pop-select"
				value={mode}
				aria-label={`${label} kind`}
				onChange={(e) => onChange(e.target.value === "auto" ? undefined : e.target.value === "pct" ? "p50" : isDate ? "today" : 0)}
			>
				<option value="auto">{auto}</option>
				<option value="fixed">{isDate ? "Date" : "Number"}</option>
				<option value="pct">Percentile</option>
			</select>
			{mode !== "auto" && (
				<input
					type="text"
					className="oe-pop-input is-number"
					value={text}
					aria-label={label}
					placeholder={mode === "pct" ? "50" : isDate ? "today, +30d" : "0"}
					onChange={(e) => {
						const t = e.target.value.trim();
						if (mode === "pct") onChange(`p${t}`);
						else if (isDate) onChange(t || "today");
						else onChange(t !== "" && Number.isFinite(Number(t)) ? Number(t) : t);
					}}
				/>
			)}
			{mode === "pct" && <span className="oe-pop-hint">th</span>}
		</span>
	);
}

function ColourPick({ value, onChange, label }: { value: HighlightColor; onChange: (c: HighlightColor) => void; label: string }) {
	return (
		<span className="oe-hl-swatches" role="radiogroup" aria-label={label}>
			{HIGHLIGHT_COLORS.map((c) => (
				<button key={c} className={`oe-hl-swatch is-fill oe-hl-fill-${c}${value === c ? " is-active" : ""}`} role="radio" aria-checked={value === c} aria-label={`${COLOR_LABEL[c]} ${label.toLowerCase()}`} onClick={() => onChange(c)} />
			))}
		</span>
	);
}

/** Options for a data bar or colour scale rule. */
function VizBody({ r, columns, onChange }: { r: HighlightRule; columns: ResolvedColumn[]; onChange: (r: HighlightRule) => void }) {
	const col = columns.find((c) => c.id === r.target);
	const isDate = col?.kind === "date";
	const targets = columns.filter(isMeasurable);
	const hidden = !col;
	const target = (
		<span className="oe-condition">
			<select className="dropdown oe-pop-select" value={r.target} aria-label="Column" onChange={(e) => onChange({ ...r, target: e.target.value })}>
				{targets.map((c) => (
					<option key={c.id} value={c.id}>
						{c.label}
					</option>
				))}
				{hidden && <option value={r.target}>{r.target} (not shown)</option>}
			</select>
			{hidden && <span className="oe-pop-hint">That column isn't shown, so this rule has no effect.</span>}
			{col && !isMeasurable(col) && <span className="oe-pop-hint">Data bars and colour scales need a number or date column.</span>}
		</span>
	);
	if (r.kind === "bar") {
		const b = r.bar ?? {};
		const setBar = (patch: Partial<BarOptions>) => {
			const bar = { ...b, ...patch };
			for (const k of Object.keys(bar) as (keyof BarOptions)[]) if (bar[k] === undefined || bar[k] === false) delete bar[k];
			onChange({ ...r, bar });
		};
		return (
			<div className="oe-hl-grid">
				<span className="oe-hl-label">Column</span>
				{target}
				<span className="oe-hl-label">Colour</span>
				<ColourPick label="Bar colour" value={b.color ?? "blue"} onChange={(color) => setBar({ color })} />
				<span className="oe-hl-label">Negative</span>
				<ColourPick label="Negative colour" value={b.negative ?? "red"} onChange={(negative) => setBar({ negative })} />
				<span className="oe-hl-label">Minimum</span>
				<BoundEditor label="Minimum" isDate={isDate} auto={isDate ? "Earliest" : "Automatic (0 or lowest)"} value={b.min} onChange={(min) => setBar({ min })} />
				<span className="oe-hl-label">Maximum</span>
				<BoundEditor label="Maximum" isDate={isDate} auto={isDate ? "Latest" : "Automatic (highest)"} value={b.max} onChange={(max) => setBar({ max })} />
				<span className="oe-hl-label">Look</span>
				<span className="oe-condition">
					<label className="oe-columns-item">
						<input type="checkbox" checked={!!b.gradient} onChange={(e) => setBar({ gradient: e.target.checked })} />
						<span>Gradient</span>
					</label>
					<label className="oe-columns-item">
						<input type="checkbox" checked={!!b.barOnly} onChange={(e) => setBar({ barOnly: e.target.checked })} />
						<span>Bar only (hide the value)</span>
					</label>
				</span>
			</div>
		);
	}
	const s = r.scale ?? { colors: ["red", "yellow", "green"] as HighlightColor[] };
	const setScale = (patch: Partial<ScaleOptions>) => {
		const scale = { ...s, ...patch };
		for (const k of ["min", "mid", "max"] as const) if (scale[k] === undefined) delete scale[k];
		if (scale.colors.length !== 3) delete scale.mid;
		onChange({ ...r, scale });
	};
	return (
		<div className="oe-hl-grid">
			<span className="oe-hl-label">Column</span>
			{target}
			<span className="oe-hl-label">Preset</span>
			<span className="oe-hl-swatches">
				{SCALE_PRESETS.map((p) => (
					<button key={p.label} className={`oe-scale-preset${p.colors.join() === s.colors.join() ? " is-active" : ""}`} aria-label={p.label} style={{ background: `linear-gradient(90deg, ${p.colors.map(cssColor).join(", ")})` }} onClick={() => setScale({ colors: p.colors })} />
				))}
			</span>
			<span className="oe-hl-label">Colours</span>
			<span className="oe-condition">
				<select className="dropdown oe-pop-select is-narrow" value={s.colors.length} aria-label="Number of colours" onChange={(e) => setScale({ colors: e.target.value === "3" ? [s.colors[0], "yellow", s.colors[s.colors.length - 1]] : [s.colors[0], s.colors[s.colors.length - 1]] })}>
					<option value={2}>2 colours</option>
					<option value={3}>3 colours</option>
				</select>
			</span>
			{s.colors.map((c, k) => (
				<Fragment key={k}>
					<span className="oe-hl-label">{k === 0 ? "Low" : k === s.colors.length - 1 ? "High" : "Middle"}</span>
					<ColourPick label={`${k === 0 ? "Low" : k === s.colors.length - 1 ? "High" : "Middle"} colour`} value={c} onChange={(nc) => setScale({ colors: s.colors.map((x, j) => (j === k ? nc : x)) })} />
				</Fragment>
			))}
			<span className="oe-hl-label">Low at</span>
			<BoundEditor label="Low value" isDate={isDate} auto={isDate ? "Earliest" : "Lowest"} value={s.min} onChange={(min) => setScale({ min })} />
			{s.colors.length === 3 && (
				<>
					<span className="oe-hl-label">Middle at</span>
					<BoundEditor label="Middle value" isDate={isDate} auto="Median (50th percentile)" value={s.mid} onChange={(mid) => setScale({ mid })} />
				</>
			)}
			<span className="oe-hl-label">High at</span>
			<BoundEditor label="High value" isDate={isDate} auto={isDate ? "Latest" : "Highest"} value={s.max} onChange={(max) => setScale({ max })} />
		</div>
	);
}

export function Swatches({ value, kind, onChange }: { value: HighlightColor | undefined; kind: "fill" | "text"; onChange: (c: HighlightColor | undefined) => void }) {
	return (
		<span className="oe-hl-swatches" role="radiogroup" aria-label={kind === "fill" ? "Fill colour" : "Text colour"}>
			<button className={`oe-hl-swatch is-none${!value ? " is-active" : ""}`} role="radio" aria-checked={!value} aria-label="None" onClick={() => onChange(undefined)}>
				<Icon name="ban" />
			</button>
			{HIGHLIGHT_COLORS.map((c) => (
				<button
					key={c}
					className={`oe-hl-swatch is-${kind} oe-hl-${kind}-${c}${value === c ? " is-active" : ""}`}
					role="radio"
					aria-checked={value === c}
					aria-label={`${COLOR_LABEL[c]} ${kind === "fill" ? "fill" : "text"}`}
					onClick={() => onChange(c)}
				>
					{kind === "text" ? "A" : ""}
				</button>
			))}
		</span>
	);
}

/** The words a highlight panel uses (a view's rows by default; a dashboard component says "card" and "matches"). */
export interface HighlightWording {
	empty: string;
	whole: string;
	parts: string;
	when: string;
	whenEmpty: string;
	unit: (n: number) => string;
	wholeHint: string;
	partHint: string;
	add: string;
}
const ROW_WORDING: HighlightWording = {
	empty: "No rules yet. Colour the rows or cells that match conditions, e.g. overdue tasks in red.",
	whole: "Whole row",
	parts: "Cells in column",
	when: "Apply when rows match",
	whenEmpty: "No conditions: every row matches.",
	unit: (n) => (n === 1 ? "1 row" : `${n} rows`),
	wholeHint: "Row icons show before the name.",
	partHint: "Anything this rule leaves unset (e.g. no fill) comes from the row's rule.",
	add: "Highlight rule",
};

/** A highlight style's controls: fill and text colours, bold / italic / strikethrough, and an icon (unless `noIcon`). */
export function StyleFields({ style, onChange, noIcon }: { style: HighlightStyle; onChange: (patch: Partial<HighlightStyle>) => void; noIcon?: boolean }) {
	return (
		<div className="oe-hl-grid">
			<span className="oe-hl-label">Fill</span>
			<Swatches kind="fill" value={style.fill} onChange={(fill) => onChange({ fill })} />
			<span className="oe-hl-label">Text</span>
			<Swatches kind="text" value={style.text} onChange={(text) => onChange({ text })} />
			<span className="oe-hl-label">Style</span>
			<span className="oe-hl-swatches">
				{(
					[
						["bold", "bold", "Bold"],
						["italic", "italic", "Italic"],
						["strike", "strikethrough", "Strikethrough"],
					] as const
				).map(([k, icon, label]) => (
					<button key={k} className={`clickable-icon oe-hl-toggle${style[k] ? " is-active" : ""}`} aria-label={label} aria-pressed={!!style[k]} onClick={() => onChange({ [k]: !style[k] })}>
						<Icon name={icon} />
					</button>
				))}
			</span>
			{!noIcon && (
				<>
					<span className="oe-hl-label">Icon</span>
					<span className="oe-hl-swatches">
						<button className={`clickable-icon oe-hl-toggle${!style.icon ? " is-active" : ""}`} aria-label="No icon" onClick={() => onChange({ icon: undefined })}>
							<Icon name="ban" />
						</button>
						{HIGHLIGHT_ICONS.map((ic) => (
							<button key={ic} className={`clickable-icon oe-hl-toggle${style.icon === ic ? " is-active" : ""}`} aria-label={ICON_LABEL[ic] ?? ic} onClick={() => onChange({ icon: ic })}>
								<Icon name={ic} />
							</button>
						))}
						<IconPicker compact value={style.icon ?? ""} active={!!style.icon && !(HIGHLIGHT_ICONS as readonly string[]).includes(style.icon)} color="var(--text-normal)" onChange={(icon) => onChange({ icon: icon || undefined })} />
					</span>
				</>
			)}
		</div>
	);
}

/**
 * Conditional formatting rules: an ordered list, first match wins; each rule expands to its editor. `wording` changes
 * its words (dashboards); `viz: false` leaves out data bars and colour scales.
 */
export function HighlightPanel({
	rules,
	counts,
	columns,
	initialOpen,
	onChange,
	wording,
	viz = true,
	ruleExtra,
	...rest
}: FilterProps & {
	rules: HighlightRule[];
	counts: number[];
	columns: ResolvedColumn[];
	initialOpen?: number;
	onChange: (rules: HighlightRule[]) => void;
	wording?: Partial<HighlightWording>;
	viz?: boolean;
	/** more settings at the end of a highlight rule (a dashboard card's layout) */
	ruleExtra?: (r: HighlightRule, onChange: (r: HighlightRule) => void) => ReactNode;
}) {
	const w = { ...ROW_WORDING, ...wording };
	const { choices } = rest;
	const [open, setOpen] = useState<number | null>(initialOpen ?? (rules.length === 1 ? 0 : null));
	const [drag, setDrag] = useState<number | null>(null);
	const set = (i: number, r: HighlightRule | null) => onChange(r ? rules.map((x, j) => (j === i ? r : x)) : rules.filter((_, j) => j !== i));
	const setStyle = (i: number, patch: Partial<HighlightStyle>) => {
		const style = { ...rules[i].style, ...patch };
		for (const k of Object.keys(style) as (keyof HighlightStyle)[]) if (style[k] === undefined || style[k] === false) delete style[k];
		set(i, { ...rules[i], style });
	};
	const targetLabel = (t: string) => (t === ROW_TARGET ? w.whole : (columns.find((c) => c.id === t)?.label ?? t));
	return (
		<div className="oe-hlpanel">
			{rules.length === 0 && <div className="oe-pop-empty">{w.empty}</div>}
			{rules.length > 1 && <div className="oe-pop-hint">The first matching rule wins. Drag to reorder.</div>}
			{rules.map((r, i) => {
				const isOpen = open === i;
				const hidden = r.target !== ROW_TARGET && !columns.some((c) => c.id === r.target);
				const n = counts[i] ?? 0;
				return (
					<div
						key={i}
						className={`oe-hl-rule${isOpen ? " is-open" : ""}${r.off ? " is-off" : ""}${drag === i ? " is-dragging" : ""}`}
						onDragOver={(e) => drag !== null && e.preventDefault()}
						onDrop={(e) => {
							e.preventDefault();
							if (drag === null || drag === i) return;
							const next = [...rules];
							const [moved] = next.splice(drag, 1);
							next.splice(i, 0, moved);
							onChange(next);
							if (open === drag) setOpen(i);
							setDrag(null);
						}}
					>
						<div className="oe-hl-head" draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)}>
							<span className="oe-drag" aria-hidden="true">
								<Icon name="grip-vertical" />
							</span>
							<input type="checkbox" checked={!r.off} aria-label="Rule on" title={r.off ? "Off: tick to turn this rule on" : "On: untick to turn this rule off"} onChange={(e) => set(i, { ...r, off: e.target.checked ? undefined : true })} />
							{r.kind === "bar" ? (
								<span className="oe-hl-sample is-bar" aria-hidden="true">
									<span style={{ background: cssColor(r.bar?.color ?? "blue") }} />
								</span>
							) : r.kind === "scale" ? (
								<span className="oe-hl-sample is-scale" aria-hidden="true" style={{ background: `linear-gradient(90deg, ${(r.scale?.colors ?? ["red", "green"]).map(cssColor).join(", ")})` }} />
							) : (
								<span className={`oe-hl-sample ${hlClasses(r.style)}`} aria-hidden="true">
									{r.style.icon && <Icon name={r.style.icon} className="oe-hl-icon" />}
									<span>Aa</span>
								</span>
							)}
							<button className="oe-hl-title" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)}>
								<span className="oe-hl-name">{r.name || ruleSummary(r, choices, rest.dashFilters)}</span>
								<span className="oe-hl-meta">
									{targetLabel(r.target)} · {r.off ? "off" : w.unit(n)}
								</span>
							</button>
							<button className="clickable-icon oe-hl-caret" aria-label={isOpen ? "Collapse rule" : "Expand rule"} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)}>
								<Icon name={isOpen ? "chevron-down" : "chevron-right"} />
							</button>
							<button className="clickable-icon" aria-label="Remove rule" onClick={() => (set(i, null), setOpen(null))}>
								<Icon name="x" />
							</button>
						</div>
						{isOpen && (r.kind === "bar" || r.kind === "scale") && (
							<div className="oe-hl-body">
								<div className="oe-hl-grid">
									<span className="oe-hl-label">Name</span>
									<input type="text" className="oe-pop-input" value={r.name ?? ""} placeholder="Optional" aria-label="Rule name" onChange={(e) => set(i, { ...r, name: e.target.value || undefined })} />
								</div>
								<VizBody r={r} columns={columns} onChange={(nr) => set(i, nr)} />
								<GroupEditor group={r.when} depth={0} onChange={(when) => set(i, { ...r, when })} {...rest} heading="Only rows that match" emptyText="No conditions: every row with a value." />
								<div className="oe-pop-hint">Automatic ranges come from the rows shown (after filters and search) that this rule applies to.</div>
							</div>
						)}
						{isOpen && r.kind !== "bar" && r.kind !== "scale" && (
							<div className="oe-hl-body">
								<div className="oe-hl-grid">
									<span className="oe-hl-label">Name</span>
									<input type="text" className="oe-pop-input" value={r.name ?? ""} placeholder="Optional, e.g. Overdue" aria-label="Rule name" onChange={(e) => set(i, { ...r, name: e.target.value || undefined })} />
									{(columns.length > 0 || hidden) && (
										<>
											<span className="oe-hl-label">Apply to</span>
											<span className="oe-condition">
												<select className="dropdown oe-pop-select" value={r.target} aria-label="Apply to" onChange={(e) => set(i, { ...r, target: e.target.value })}>
													<option value={ROW_TARGET}>{w.whole}</option>
													<optgroup label={w.parts}>
														{columns.map((c) => (
															<option key={c.id} value={c.id}>
																{c.label}
															</option>
														))}
														{hidden && <option value={r.target}>{r.target} (not shown)</option>}
													</optgroup>
												</select>
												{hidden && <span className="oe-pop-hint">That column isn't shown, so this rule has no effect.</span>}
											</span>
										</>
									)}
								</div>
								<GroupEditor group={r.when} depth={0} onChange={(when) => set(i, { ...r, when })} {...rest} heading={w.when} emptyText={w.whenEmpty} />
								<StyleFields style={r.style} onChange={(patch) => setStyle(i, patch)} />
								{ruleExtra?.(r, (nr) => set(i, nr))}
								<div className="oe-pop-hint">{r.target === ROW_TARGET ? w.wholeHint : w.partHint}</div>
							</div>
						)}
					</div>
				);
			})}
			<div className="oe-pop-actions">
				<button
					className="oe-pop-link"
					onClick={() => {
						onChange([...rules, newHighlightRule(ROW_TARGET, choices)]);
						setOpen(rules.length);
					}}
				>
					<Icon name="plus" /> {w.add}
				</button>
				{(viz ? (["bar", "scale"] as const) : []).map((k) => {
					const first = columns.find(isMeasurable);
					return (
						<button
							key={k}
							className="oe-pop-link"
							disabled={!first}
							aria-label={first ? undefined : "Needs a number or date column"}
							onClick={() => {
								if (!first) return;
								onChange([...rules, newVizRule(k, first.id)]);
								setOpen(rules.length);
							}}
						>
							<Icon name={k === "bar" ? "bar-chart-horizontal" : "palette"} /> {k === "bar" ? "Data bar" : "Colour scale"}
						</button>
					);
				})}
			</div>
		</div>
	);
}

/**
 * Picked columns in order (a board's card fields): drag the handle to reorder, or Alt+↑/↓ on a row. A line shows
 * where the dragged one will go. Unticking removes it from the list.
 */
function OrderedColumns({
	ids,
	defOf,
	labelOf,
	onToggle,
	onReorder,
	editButton: actions,
}: {
	ids: string[];
	defOf: (id: string) => ColumnDef;
	labelOf: (c: ColumnDef) => string;
	onToggle: (c: ColumnDef, on: boolean) => void;
	onReorder: (ids: string[]) => void;
	editButton: (c: ColumnDef) => ReactNode;
}) {
	const [drag, setDrag] = useState<number | null>(null);
	const [over, setOver] = useState<number | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const move = (from: number, to: number) => {
		if (from === to || to < 0 || to >= ids.length) return;
		const next = [...ids];
		const [m] = next.splice(from, 1);
		next.splice(to, 0, m);
		onReorder(next);
	};
	return (
		<div className="oe-columns-section">
			<div className="oe-pop-heading">On cards</div>
			{ids.length === 0 && <div className="oe-pop-empty">Only the name. Tick fields below to add them.</div>}
			<div ref={listRef} className="oe-ordered-list">
				{ids.map((id, i) => {
					const c = defOf(id);
					const label = labelOf(c);
					// The dragged item lands where the target is: below it when moving down, above when moving up.
					const line = drag !== null && over === i && drag !== i ? (drag < i ? " is-drop-after" : " is-drop-before") : "";
					return (
						<div
							key={id}
							className={`oe-columns-item oe-ordered-item${drag === i ? " is-dragging" : ""}${line}`}
							data-col={id}
							draggable
							onDragStart={(e) => {
								setDrag(i);
								e.dataTransfer.effectAllowed = "move";
								e.dataTransfer.setData("text/plain", id);
							}}
							onDragEnd={() => {
								setDrag(null);
								setOver(null);
							}}
							onDragOver={(e) => {
								if (drag === null) return;
								e.preventDefault();
								if (over !== i) setOver(i);
							}}
							onDrop={(e) => {
								e.preventDefault();
								if (drag !== null) move(drag, i);
								setDrag(null);
								setOver(null);
							}}
							onKeyDown={(e) => {
								if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
								e.preventDefault();
								const to = i + (e.key === "ArrowUp" ? -1 : 1);
								move(i, to);
								// Keep focus on the moved row's checkbox.
								window.setTimeout(() => listRef.current?.querySelector<HTMLInputElement>(`[data-col="${CSS.escape(id)}"] input`)?.focus(), 0);
							}}
						>
							<span className="oe-drag" aria-hidden="true" title="Drag to reorder">
								<Icon name="grip-vertical" />
							</span>
							<input type="checkbox" checked onChange={() => onToggle(c, false)} aria-label={`Hide ${label} (Alt+↑/↓ to move)`} />
							<span className="oe-columns-label">
								{c.kind === "formula" && <Icon name="sigma" className="oe-columns-kind" />}
								{label}
							</span>
							<span className="oe-ordered-actions">{actions(c)}</span>
						</div>
					);
				})}
			</div>
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
	onAddFormula,
	onEditFormula,
	shown: shownIds,
	hint,
	onReorder,
	formatOf,
	onFormat,
}: {
	def: ViewDef;
	available: { title: string; columns: ColumnDef[] }[];
	labelOf: (c: ColumnDef) => string;
	onToggle: (c: ColumnDef, on: boolean) => void;
	onAddRollup: () => void;
	onEditRollup: (c: Extract<ColumnDef, { kind: "rollup" }>) => void;
	onAddFormula: () => void;
	onEditFormula: (c: Extract<ColumnDef, { kind: "formula" }>) => void;
	/** the ticked columns (default: the view's columns) — a board's card fields */
	shown?: string[];
	hint?: string;
	/** with `shown`: list the ticked columns first, in order, to drag into a new order (a board's card fields) */
	onReorder?: (ids: string[]) => void;
	/** in the ordered list: a Format button for number and date columns (null: no format applies) */
	formatOf?: (id: string) => { kind: "number" | "date"; set: boolean } | null;
	onFormat?: (id: string) => void;
}) {
	const shown = new Set(shownIds ?? def.columns.map((c) => c.id));
	const computed = def.columns.filter((c): c is Extract<ColumnDef, { kind: "rollup" | "formula" }> => c.kind === "rollup" || c.kind === "formula");
	const ordered = onReorder && shownIds ? shownIds : null;
	// With an ordered list on top, the sections below offer only what isn't picked yet.
	const offered = (c: ColumnDef) => !ordered || !shown.has(c.id);
	const defOf = (id: string): ColumnDef => def.columns.find((c) => c.id === id) ?? available.flatMap((s) => s.columns).find((c) => c.id === id) ?? columnFromId(id);
	const editButton = (c: ColumnDef) =>
		c.kind === "rollup" ? (
			<button className="clickable-icon" aria-label="Edit roll-up" onClick={() => onEditRollup(c)}>
				<Icon name="pencil" />
			</button>
		) : c.kind === "formula" ? (
			<button className="clickable-icon" aria-label="Edit formula" onClick={() => onEditFormula(c)}>
				<Icon name="pencil" />
			</button>
		) : null;
	/** an ordered row's buttons: Format (numbers and dates), then Edit (roll-ups and formulas) */
	const rowActions = (c: ColumnDef) => {
		const f = onFormat ? formatOf?.(c.id) : null;
		return (
			<>
				{f && (
					<button
						className={`clickable-icon oe-columns-format${f.set ? " is-set" : ""}`}
						aria-label={`${f.set ? "Format (custom)" : "Format"}: ${labelOf(c)}`}
						onClick={() => onFormat!(c.id)}
					>
						<Icon name={f.kind === "date" ? "calendar-cog" : "hash"} />
					</button>
				)}
				{editButton(c)}
			</>
		);
	};
	return (
		<div className="oe-columnspanel">
			{hint && <div className="oe-pop-hint">{hint}</div>}
			{ordered && onReorder && <OrderedColumns ids={ordered} defOf={defOf} labelOf={labelOf} onToggle={onToggle} onReorder={onReorder} editButton={rowActions} />}
			{available
				.map((s) => ({ ...s, columns: s.columns.filter(offered) }))
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
				{computed.length === 0 && <div className="oe-pop-empty">Summarise linked notes (counts, sums, latest dates…) or calculate values with a formula.</div>}
				{computed.filter(offered).map((c) => (
					<div key={c.id} className="oe-columns-item">
						<input type="checkbox" checked={shown.has(c.id)} onChange={(e) => onToggle(c, e.target.checked)} aria-label={shownIds ? `${shown.has(c.id) ? "Hide" : "Show"} ${labelOf(c)}` : `Remove ${labelOf(c)}`} />
						<span className="oe-columns-label">
							{c.kind === "formula" && <Icon name="sigma" className="oe-columns-kind" />}
							{labelOf(c)}
						</span>
						{editButton(c)}
					</div>
				))}
				<div className="oe-pop-actions">
					<button className="oe-pop-link" onClick={onAddRollup}>
						<Icon name="plus" /> Add roll-up…
					</button>
					<button className="oe-pop-link" onClick={onAddFormula}>
						<Icon name="plus" /> Add formula…
					</button>
				</div>
			</div>
		</div>
	);
}
