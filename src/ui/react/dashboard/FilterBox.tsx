import { Menu } from "obsidian";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { COMPONENT_LABELS, DEFAULT_FILTER_LAYOUT, type DashComponent, type DashEnv } from "../../../model/dashboard";
import { DATE_PRESETS, filterText, isEmptyFilter, presetRange, type DatePreset, type FilterValue } from "../../../model/dashboardFilters";
import { cellOf, columnFromId, emptyView, resolveColumn, type ResolvedColumn } from "../../../model/views";
import { choiceColor, statusColorAmong } from "../../../model/colors";
import { colorClass } from "../EntityBits";
import { Icon } from "../Icon";
import { DateBox, LinkValues } from "../table/popovers";

type FilterC = Extract<DashComponent, { kind: "filter" }>;
type Layout = Required<NonNullable<FilterC["layout"]>>;

/**
 * A dashboard filter (DESIGN §8.12, D3): its title, its control, a clear button and (optionally) a summary of
 * what's picked. Side by side or stacked (`auto`: side by side when it's one grid row high); the control fills the
 * space it has. What's picked is the dashboard's to keep (remembered on this device).
 */
export function FilterBox({ c, value, env, icon, onChange }: { c: FilterC; value: FilterValue | undefined; env: DashEnv; icon?: string; onChange: (v: FilterValue | undefined) => void }) {
	const L: Layout = { ...DEFAULT_FILTER_LAYOUT, ...c.layout };
	const vertical = L.direction === "vertical" || (L.direction === "auto" && c.at.h > 1);
	const empty = isEmptyFilter(value);
	const choice = useChoiceOptions(c, env);
	// A note filter cleared on purpose stays cleared (rather than starting on the note it's shown on again).
	const clear = () => onChange(c.control === "note" ? { kind: "note", paths: [] } : undefined);
	const label = L.label ? (
		<span className="oe-dash-filter-label">
			{icon && <Icon name={icon} className="oe-hl-icon" />}
			{c.title || COMPONENT_LABELS.filter}
		</span>
	) : null;
	const clearButton = (
		<button className="clickable-icon oe-dash-filter-clear" aria-label={`Clear ${c.title || "the filter"}`} title="Clear: show everything" disabled={empty} onClick={clear}>
			<Icon name="x" />
		</button>
	);
	return (
		<div className={`oe-dash-filter-body is-${c.control} is-${vertical ? "vertical" : "horizontal"} is-size-${L.size}${L.plain ? " is-plain" : ""}`}>
			{vertical ? (
				<div className="oe-dash-filter-head">
					{label}
					<span className="oe-spacer" />
					{clearButton}
				</div>
			) : (
				label
			)}
			<div className="oe-dash-filter-main">
				<div className="oe-dash-filter-control">
					<FilterControl c={c} L={L} vertical={vertical} value={value} env={env} choice={choice} onChange={onChange} />
				</div>
				{L.summary && <div className="oe-dash-filter-summary">{summaryOf(c, value, env, choice?.options.length)}</div>}
			</div>
			{!vertical && clearButton}
		</div>
	);
}

function FilterControl({ c, L, vertical, value, env, choice, onChange }: { c: FilterC; L: Layout; vertical: boolean; value: FilterValue | undefined; env: DashEnv; choice: ChoiceOptions | null; onChange: (v: FilterValue | undefined) => void }) {
	switch (c.control) {
		case "note":
			return (
				<LinkValues
					targets={c.types?.length ? c.types : undefined}
					value={value?.kind === "note" ? value.paths : []}
					single={!c.multiple}
					chips
					onChange={(paths) => onChange({ kind: "note", paths })}
				/>
			);
		case "choice":
			return choice ? (
				<ChoiceValues
					options={choice.options}
					col={choice.col}
					env={env}
					multiple={!!c.multiple}
					mode={L.choices}
					vertical={vertical}
					label={c.title || choice.col.label}
					value={value?.kind === "choice" ? value.values : []}
					onChange={(values) => onChange(values.length ? { kind: "choice", values } : undefined)}
				/>
			) : null;
		case "search":
			return <SearchBox value={value?.kind === "search" ? value.text : ""} onChange={(text) => onChange(text.trim() ? { kind: "search", text } : undefined)} />;
		case "dates":
			return <DatesPick value={value?.kind === "dates" ? value : undefined} env={env} onChange={onChange} />;
		case "number": {
			const v = value?.kind === "number" ? value : { kind: "number" as const };
			const set = (patch: { min?: number; max?: number }) => {
				const next = { ...v, ...patch };
				onChange(next.min === undefined && next.max === undefined ? undefined : next);
			};
			const box = (key: "min" | "max", label: string) => (
				<input
					type="number"
					className="oe-dash-filter-num"
					aria-label={label}
					placeholder={key === "min" ? "From" : "To"}
					value={v[key] ?? ""}
					onChange={(e) => set({ [key]: e.target.value === "" || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value) })}
				/>
			);
			return (
				<span className="oe-dash-filter-range">
					{box("min", "At least")}
					<span className="oe-dash-filter-to">to</span>
					{box("max", "At most")}
				</span>
			);
		}
		case "toggle": {
			const on = value?.kind === "toggle" ? value.on : null;
			const set = (v: boolean | null) => onChange(v === null ? undefined : { kind: "toggle", on: v });
			if (L.choices === "dropdown")
				return (
					<select className="dropdown" aria-label={c.title || "Yes or no"} value={on === null ? "" : String(on)} onChange={(e) => set(e.target.value === "" ? null : e.target.value === "true")}>
						<option value="">Either</option>
						<option value="true">Yes</option>
						<option value="false">No</option>
					</select>
				);
			if (L.choices === "list")
				return (
					<div className="oe-dash-filter-list" role="radiogroup" aria-label={c.title || "Yes or no"}>
						{(
							[
								[null, "Either"],
								[true, "Yes"],
								[false, "No"],
							] as const
						).map(([v, label]) => (
							<label key={String(v)}>
								<input type="radio" checked={on === v} onChange={() => set(v)} />
								<span>{label}</span>
							</label>
						))}
					</div>
				);
			return (
				<div className="oe-dash-seg" role="radiogroup" aria-label={c.title || "Yes or no"}>
					{(
						[
							[true, "Yes"],
							[false, "No"],
						] as const
					).map(([v, label]) => (
						<button key={String(v)} role="radio" aria-checked={on === v} className={on === v ? "is-active" : ""} onClick={() => set(on === v ? null : v)}>
							<span>{label}</span>
						</button>
					))}
				</div>
			);
		}
	}
}

type ChoiceOptions = { col: ResolvedColumn; options: string[] };

/** A choice filter's field, and the values it offers (the field's own, or those the notes have). */
function useChoiceOptions(c: FilterC, env: DashEnv): ChoiceOptions | null {
	const { ctx, rows } = env;
	return useMemo(() => {
		if (c.control !== "choice") return null;
		const def = { ...emptyView(), types: c.types?.length ? c.types : ["*"] };
		const col = resolveColumn(c.field ?? columnFromId("status"), def, ctx);
		if (col.options?.length) return { col, options: col.options };
		const seen = new Set<string>();
		for (const r of rows) for (const v of [cellOf(r, col, ctx).value].flat()) if (typeof v === "string" && v.trim()) seen.add(v);
		return { col, options: [...seen].sort((a, b) => a.localeCompare(b)) };
	}, [c.control, c.types, c.field, ctx, rows]);
}

/**
 * Choice values as pills (in their colours), a drop-down, or a list of tick boxes; `auto` shows pills while they fit
 * the space (one line side by side, the lines there are when stacked), else a drop-down.
 */
function ChoiceValues({
	options,
	col,
	env,
	multiple,
	mode,
	vertical,
	label,
	value,
	onChange,
}: {
	options: string[];
	col: ResolvedColumn;
	env: DashEnv;
	multiple: boolean;
	mode: Layout["choices"];
	vertical: boolean;
	label: string;
	value: string[];
	onChange: (v: string[]) => void;
}) {
	const { ctx } = env;
	const tint = (o: string) =>
		colorClass(col.def.kind === "builtin" && col.def.key === "status" ? statusColorAmong(o, ctx.types, ctx.groups) : col.field?.kind === "select" || col.field?.kind === "multiselect" ? choiceColor(col.field, o) : null);
	const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : multiple ? [...value, o] : [o]);
	const fits = useFits(mode === "auto", vertical, options.join("\u0000"));
	if (col.invalid) return <span className="oe-dash-muted">{col.invalid}</span>;
	if (options.length === 0) return <span className="oe-pop-empty">No values yet.</span>;
	const pills = (measure?: boolean) => (
		<span className={`oe-pop-pills${measure ? " oe-dash-filter-measure" : ""}`} role={measure ? undefined : "group"} aria-label={measure ? undefined : label} aria-hidden={measure || undefined}>
			{options.map((o) => {
				const on = value.includes(o);
				return (
					<button key={o} tabIndex={measure ? -1 : undefined} className={`oe-option${on ? " is-active" : ""}${tint(o)}`} aria-pressed={measure ? undefined : on} onClick={measure ? undefined : () => toggle(o)}>
						{o}
					</button>
				);
			})}
		</span>
	);
	const show = mode === "auto" ? (fits.ok ? "pills" : "dropdown") : mode;
	let body: ReactNode;
	if (show === "list")
		body = (
			<div className="oe-dash-filter-list" role="group" aria-label={label}>
				{options.map((o) => (
					<label key={o}>
						<input type={multiple ? "checkbox" : "radio"} checked={value.includes(o)} onChange={() => toggle(o)} />
						<span className={`oe-dash-filter-listname${tint(o)}`}>{o}</span>
					</label>
				))}
			</div>
		);
	else if (show === "dropdown")
		body = multiple ? (
			<button
				className="dropdown oe-dash-filter-multi"
				aria-label={label}
				onClick={(e) => {
					const menu = new Menu();
					for (const o of options) menu.addItem((i) => i.setTitle(o).setChecked(value.includes(o)).onClick(() => toggle(o)));
					menu.showAtMouseEvent(e.nativeEvent);
				}}
			>
				{value.length === 0 ? "All" : value.length <= 2 ? value.join(", ") : `${value.length} chosen`}
			</button>
		) : (
			<select className="dropdown" aria-label={label} value={value[0] ?? ""} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
				<option value="">All</option>
				{options.map((o) => (
					<option key={o} value={o}>
						{o}
					</option>
				))}
			</select>
		);
	else body = pills();
	return (
		<span ref={fits.ref} className="oe-dash-filter-choices">
			{body}
			{/* the pills as they'd be, unseen, to tell whether they fit */}
			{mode === "auto" && <span className="oe-dash-filter-measure-box">{pills(true)}</span>}
		</span>
	);
}

/**
 * Whether pills fit their box: their one-line width against its width (times the lines its height has room for,
 * when stacked). Watches the box's size, so it follows the component being resized.
 */
function useFits(on: boolean, vertical: boolean, key: string): { ref: React.RefObject<HTMLSpanElement | null>; ok: boolean } {
	const ref = useRef<HTMLSpanElement>(null);
	const [ok, setOk] = useState(true);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!on || !el) return;
		const box = el.closest<HTMLElement>(".oe-dash-filter-control") ?? el;
		const check = () => {
			const measure = el.querySelector<HTMLElement>(".oe-dash-filter-measure");
			if (!measure) return;
			const need = measure.scrollWidth;
			const pill = measure.firstElementChild?.getBoundingClientRect().height ?? 24;
			const lines = vertical ? Math.max(1, Math.floor((box.clientHeight + 4) / (pill + 4))) : 1;
			// Wrapping wastes some of each line.
			setOk(need <= box.clientWidth * lines * (lines > 1 ? 0.85 : 1));
		};
		check();
		const ro = new ResizeObserver(check);
		ro.observe(box);
		return () => ro.disconnect();
	}, [on, vertical, key]);
	return { ref, ok };
}

/** A search box: the filter follows the typing, a moment after it stops. */
function SearchBox({ value, onChange }: { value: string; onChange: (text: string) => void }) {
	const [text, setText] = useState(value);
	useEffect(() => setText(value), [value]);
	useEffect(() => {
		if (text === value) return;
		const t = window.setTimeout(() => onChange(text), 250);
		return () => window.clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [text]);
	return (
		<span className="oe-dash-filter-search">
			<Icon name="search" />
			<input type="search" value={text} placeholder="Search names…" aria-label="Search" onChange={(e) => setText(e.target.value)} />
		</span>
	);
}

/** A date range: a preset (this week, last 30 days…) or custom from / to dates. */
function DatesPick({ value, env, onChange }: { value: Extract<FilterValue, { kind: "dates" }> | undefined; env: DashEnv; onChange: (v: FilterValue | undefined) => void }) {
	const preset = value?.preset ?? "";
	return (
		<span className="oe-dash-filter-dates">
			<select className="dropdown" aria-label="Dates" value={preset} onChange={(e) => onChange(e.target.value ? { kind: "dates", preset: e.target.value as DatePreset, ...(e.target.value === "custom" ? { from: value?.from, to: value?.to } : {}) } : undefined)}>
				<option value="">Any time</option>
				{DATE_PRESETS.map(([k, label]) => (
					<option key={k} value={k}>
						{label}
					</option>
				))}
			</select>
			{preset === "custom" && (
				<span className="oe-dash-filter-range">
					<DateBox value={value?.from ?? ""} ctx={env.ctx} label="From" picker onChange={(from) => onChange({ kind: "dates", preset: "custom", from, to: value?.to })} />
					<DateBox value={value?.to ?? ""} ctx={env.ctx} label="To" picker onChange={(to) => onChange({ kind: "dates", preset: "custom", from: value?.from, to })} />
				</span>
			)}
		</span>
	);
}

/** What's picked, in words, for the summary line: "2 of 4", "9 Nov – 15 Nov", "All notes"… */
function summaryOf(c: FilterC, value: FilterValue | undefined, env: DashEnv, options?: number): string {
	const { ctx } = env;
	if (isEmptyFilter(value) || !value)
		return { note: "All notes", choice: options ? `All ${options}` : "All", search: "No search", dates: "Any time", number: "Any number", toggle: "Either" }[c.control];
	switch (value.kind) {
		case "choice":
			return options ? `${value.values.length} of ${options}: ${value.values.join(", ")}` : value.values.join(", ");
		case "note":
			return value.paths.length === 1 ? filterText(value, ctx) : `${value.paths.length} notes: ${filterText(value, ctx)}`;
		case "dates": {
			if (value.preset !== "custom") {
				const [a, b] = presetRange(value.preset, ctx.today);
				return a === b ? ctx.dates.format(a, "short") : `${ctx.dates.format(a, "short")} – ${ctx.dates.format(b, "short")}`;
			}
			return filterText(value, ctx);
		}
		case "search":
			return `Names containing ${filterText(value, ctx)}`;
		default:
			return filterText(value, ctx);
	}
}
