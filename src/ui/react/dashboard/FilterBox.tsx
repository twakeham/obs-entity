import { useEffect, useMemo, useState } from "react";
import { COMPONENT_LABELS, type DashComponent, type DashEnv } from "../../../model/dashboard";
import { DATE_PRESETS, isEmptyFilter, type DatePreset, type FilterValue } from "../../../model/dashboardFilters";
import { cellOf, columnFromId, emptyView, resolveColumn } from "../../../model/views";
import { choiceColor, statusColorAmong } from "../../../model/colors";
import { colorClass } from "../EntityBits";
import { Icon } from "../Icon";
import { DateBox, LinkValues } from "../table/popovers";

type FilterC = Extract<DashComponent, { kind: "filter" }>;

/**
 * A dashboard filter (DESIGN §8.12, D3): its title, its control, and a clear button. What's picked is the
 * dashboard's to keep (remembered on this device); components use it in their conditions, formulas and captions.
 */
export function FilterBox({ c, value, env, icon, onChange }: { c: FilterC; value: FilterValue | undefined; env: DashEnv; icon?: string; onChange: (v: FilterValue | undefined) => void }) {
	const empty = isEmptyFilter(value);
	// A note filter cleared on purpose stays cleared (rather than starting on the note it's shown on again).
	const clear = () => onChange(c.control === "note" ? { kind: "note", paths: [] } : undefined);
	return (
		<div className={`oe-dash-filter-body is-${c.control}`}>
			<span className="oe-dash-filter-label">
				{icon && <Icon name={icon} className="oe-hl-icon" />}
				{c.title || COMPONENT_LABELS.filter}
			</span>
			<div className="oe-dash-filter-control">
				<FilterControl c={c} value={value} env={env} onChange={onChange} />
			</div>
			<button className="clickable-icon oe-dash-filter-clear" aria-label={`Clear ${c.title || "the filter"}`} title="Clear: show everything" disabled={empty} onClick={clear}>
				<Icon name="x" />
			</button>
		</div>
	);
}

function FilterControl({ c, value, env, onChange }: { c: FilterC; value: FilterValue | undefined; env: DashEnv; onChange: (v: FilterValue | undefined) => void }) {
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
			return <ChoicePills c={c} value={value?.kind === "choice" ? value.values : []} env={env} onChange={(values) => onChange(values.length ? { kind: "choice", values } : undefined)} />;
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
					<span>to</span>
					{box("max", "At most")}
				</span>
			);
		}
		case "toggle": {
			const on = value?.kind === "toggle" ? value.on : null;
			return (
				<div className="oe-dash-seg" role="radiogroup" aria-label={c.title || "Yes or no"}>
					{[
						[true, "Yes"],
						[false, "No"],
					].map(([v, label]) => (
						<button key={String(v)} role="radio" aria-checked={on === v} className={on === v ? "is-active" : ""} onClick={() => onChange(on === v ? undefined : { kind: "toggle", on: v as boolean })}>
							<span>{label as string}</span>
						</button>
					))}
				</div>
			);
		}
	}
}

/** A choice filter's values as pills (in their colours); one, or several when it allows. */
function ChoicePills({ c, value, env, onChange }: { c: FilterC; value: string[]; env: DashEnv; onChange: (v: string[]) => void }) {
	const { ctx, rows } = env;
	const { col, options } = useMemo(() => {
		const def = { ...emptyView(), types: c.types?.length ? c.types : ["*"] };
		const col = resolveColumn(c.field ?? columnFromId("status"), def, ctx);
		if (col.options?.length) return { col, options: col.options };
		// No fixed values (e.g. a text field): the values the notes have.
		const seen = new Set<string>();
		for (const r of rows) for (const v of [cellOf(r, col, ctx).value].flat()) if (typeof v === "string" && v.trim()) seen.add(v);
		return { col, options: [...seen].sort((a, b) => a.localeCompare(b)) };
	}, [c.types, c.field, ctx, rows]);
	const tint = (o: string) =>
		colorClass(col.def.kind === "builtin" && col.def.key === "status" ? statusColorAmong(o, ctx.types, ctx.groups) : col.field?.kind === "select" || col.field?.kind === "multiselect" ? choiceColor(col.field, o) : null);
	if (col.invalid) return <span className="oe-dash-muted">{col.invalid}</span>;
	return (
		<span className="oe-pop-pills" role="group" aria-label={col.label}>
			{options.length === 0 && <span className="oe-pop-empty">No values yet.</span>}
			{options.map((o) => {
				const on = value.includes(o);
				return (
					<button key={o} className={`oe-option${on ? " is-active" : ""}${tint(o)}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : c.multiple ? [...value, o] : [o])}>
						{o}
					</button>
				);
			})}
		</span>
	);
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
				<>
					<DateBox value={value?.from ?? ""} ctx={env.ctx} label="From" picker onChange={(from) => onChange({ kind: "dates", preset: "custom", from, to: value?.to })} />
					<DateBox value={value?.to ?? ""} ctx={env.ctx} label="To" picker onChange={(to) => onChange({ kind: "dates", preset: "custom", from: value?.from, to })} />
				</>
			)}
		</span>
	);
}
