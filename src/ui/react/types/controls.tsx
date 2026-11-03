import { getIconIds } from "obsidian";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DateAdapter } from "../../../model/dates";
import { targetName } from "../../../model/typeEditing";
import { openNativePicker } from "../../components/datePicker";
import type { TypeIssue } from "../../../model/validation";
import type { EntityTypeDef, GroupDef, RelationTarget } from "../../../model/types";
import { Icon } from "../Icon";

/** A labelled setting row: label + description on the left, control on the right, issues underneath. */
export function Row({
	label,
	desc,
	issues,
	children,
	stacked,
}: {
	label: ReactNode;
	desc?: ReactNode;
	issues?: TypeIssue[];
	children: ReactNode;
	/** put the control under the label (for wide controls) */
	stacked?: boolean;
}) {
	return (
		<div className={`oe-tm-row${stacked ? " is-stacked" : ""}${issues?.length ? " has-issue" : ""}`}>
			<div className="oe-tm-row-info">
				<div className="oe-tm-row-label">{label}</div>
				{desc && <div className="oe-tm-row-desc">{desc}</div>}
			</div>
			<div className="oe-tm-row-control">{children}</div>
			{issues && issues.length > 0 && <Issues issues={issues} />}
		</div>
	);
}

export function Issues({ issues }: { issues: TypeIssue[] }) {
	return (
		<div className="oe-tm-issues">
			{issues.map((i, n) => (
				<div key={n} className="oe-tm-issue">
					<Icon name="alert-circle" /> {i.message}
				</div>
			))}
		</div>
	);
}

/** Obsidian-style toggle switch. */
export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
	return (
		<div
			className={`checkbox-container${value ? " is-enabled" : ""}${disabled ? " is-disabled" : ""}`}
			role="switch"
			aria-checked={value}
			aria-label={label}
			tabIndex={disabled ? -1 : 0}
			onClick={() => !disabled && onChange(!value)}
			onKeyDown={(e) => {
				if (!disabled && (e.key === " " || e.key === "Enter")) {
					e.preventDefault();
					onChange(!value);
				}
			}}
		>
			<input type="checkbox" checked={value} readOnly tabIndex={-1} />
		</div>
	);
}

export function TextInput({
	value,
	onChange,
	placeholder,
	label,
	disabled,
	invalid,
	className,
	onFocus,
	autoFocus,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	label: string;
	disabled?: boolean;
	invalid?: boolean;
	className?: string;
	onFocus?: (el: HTMLInputElement) => void;
	autoFocus?: boolean;
}) {
	return (
		<input
			type="text"
			aria-label={label}
			className={`${className ?? ""}${invalid ? " is-invalid" : ""}`}
			value={value}
			placeholder={placeholder}
			disabled={disabled}
			autoFocus={autoFocus}
			spellCheck={false}
			onChange={(e) => onChange(e.target.value)}
			onFocus={(e) => onFocus?.(e.currentTarget)}
		/>
	);
}

export function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
	disabled,
}: {
	value: T;
	options: { value: T; label: string; icon?: string }[];
	onChange: (v: T) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<div className="oe-segmented oe-tm-segmented" role="group" aria-label={label}>
			{options.map((o) => (
				<button key={o.value} data-value={o.value} disabled={disabled} className={o.value === value ? "is-active" : ""} onClick={() => onChange(o.value)}>
					{o.icon && <Icon name={o.icon} />}
					{o.label}
				</button>
			))}
		</div>
	);
}

/** Editable list of short strings shown as chips (select options, shortcuts). Drag chips to reorder. */
export function ChipsInput({
	values,
	onChange,
	placeholder,
	label,
	invalid,
}: {
	values: string[];
	onChange: (v: string[]) => void;
	placeholder: string;
	label: string;
	invalid?: boolean;
}) {
	const [text, setText] = useState("");
	const [dragFrom, setDragFrom] = useState<number | null>(null);
	const add = () => {
		const parts = text
			.split(",")
			.map((s) => s.trim())
			.filter((s, i, a) => s && !values.includes(s) && a.indexOf(s) === i);
		if (parts.length) onChange([...values, ...parts]);
		setText("");
	};
	const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" || e.key === ",") {
			e.preventDefault();
			add();
		} else if (e.key === "Backspace" && !text && values.length) {
			onChange(values.slice(0, -1));
		}
	};
	return (
		<div className={`oe-tm-chips${invalid ? " is-invalid" : ""}`} data-label={label}>
			{values.map((v, i) => (
				<span
					key={v}
					className="oe-tm-chip"
					draggable
					onDragStart={() => setDragFrom(i)}
					onDragOver={(e) => e.preventDefault()}
					onDrop={() => {
						if (dragFrom === null || dragFrom === i) return;
						const next = [...values];
						const [m] = next.splice(dragFrom, 1);
						next.splice(i, 0, m);
						onChange(next);
						setDragFrom(null);
					}}
				>
					{v}
					<button className="oe-tm-chip-x clickable-icon" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
						<Icon name="x" />
					</button>
				</span>
			))}
			<input
				type="text"
				aria-label={label}
				value={text}
				placeholder={values.length ? "Add…" : placeholder}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={onKey}
				onBlur={add}
			/>
		</div>
	);
}

/** Choose which entity types a relation can point at. */
export function TargetPicker({
	values,
	onChange,
	types,
	groups,
	invalid,
}: {
	values: RelationTarget[];
	onChange: (v: RelationTarget[]) => void;
	types: EntityTypeDef[];
	groups: GroupDef[];
	invalid?: boolean;
}) {
	const anyOf: { key: RelationTarget; name: string }[] = [{ key: "*", name: "Any entity" }, ...groups.map((g) => ({ key: `@${g.key}`, name: `Any ${g.name} entity` }))];
	const avail = (list: { key: string; name: string }[]) => list.filter((x) => !values.includes(x.key));
	return (
		<div className={`oe-tm-chips oe-tm-targets${invalid ? " is-invalid" : ""}`}>
			{values.length === 0 && <span className="oe-tm-muted">Any entity</span>}
			{values.map((v) => {
				const t = types.find((x) => x.key === v);
				const name = targetName(v, types, false, groups);
				return (
					<span key={v} className="oe-tm-chip is-type" style={t ? ({ "--oe-type-color": t.color } as CSSProperties) : undefined}>
						<Icon name={t ? t.icon : v.startsWith("@") ? "folder" : "asterisk"} className="oe-chip-icon" />
						{name}
						<button className="oe-tm-chip-x clickable-icon" aria-label={`Remove ${name}`} onClick={() => onChange(values.filter((x) => x !== v))}>
							<Icon name="x" />
						</button>
					</span>
				);
			})}
			<select
				className="dropdown oe-tm-add-target"
				aria-label="Add target type"
				value=""
				onChange={(e) => {
					const v = e.target.value;
					if (!v) return;
					// "Any entity" replaces specific choices; a specific choice replaces "Any entity".
					onChange(v === "*" ? ["*"] : [...values.filter((x) => x !== "*"), v]);
				}}
			>
				<option value="">+ Add…</option>
				<optgroup label="Any">
					{avail(anyOf).map((g) => (
						<option key={g.key} value={g.key}>
							{g.name}
						</option>
					))}
				</optgroup>
				{groups.map((g) => {
					const list = avail(types.filter((t) => t.group === g.key && t.key).map((t) => ({ key: t.key, name: t.name })));
					return list.length ? (
						<optgroup key={g.key} label={g.name}>
							{list.map((a) => (
								<option key={a.key} value={a.key}>
									{a.name}
								</option>
							))}
						</optgroup>
					) : null;
				})}
			</select>
		</div>
	);
}

export const PALETTE = ["#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5", "#2196f3", "#03a9f4", "#009688", "#4caf50", "#8bc34a", "#ffc107", "#ff9800", "#ff5722", "#795548", "#9e9e9e", "#607d8b"];

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	const v = value.toLowerCase();
	const custom = !PALETTE.includes(v);
	return (
		<div className="oe-tm-colors" role="radiogroup" aria-label="Colour">
			{PALETTE.map((c) => (
				<button
					key={c}
					role="radio"
					aria-checked={v === c}
					aria-label={c}
					className={`oe-tm-swatch${v === c ? " is-active" : ""}`}
					style={{ backgroundColor: c }}
					onClick={() => onChange(c)}
				/>
			))}
			<label className={`oe-tm-swatch oe-tm-swatch-custom${custom ? " is-active" : ""}`} title="Custom colour" style={custom ? { backgroundColor: value } : undefined}>
				{!custom && <Icon name="pipette" />}
				<input type="color" aria-label="Custom colour" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#888888"} onChange={(e) => onChange(e.target.value)} />
			</label>
		</div>
	);
}

const ICON_LIMIT = 168;

/** Icon button that opens a searchable grid of Lucide icons. */
/** `empty`: what to show when no icon is chosen (default: the "file" icon, which types fall back to) */
export function IconPicker({ value, color, onChange, empty }: { value: string; color: string; onChange: (v: string) => void; empty?: string }) {
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState("");
	const ref = useRef<HTMLDivElement>(null);
	const btnRef = useRef<HTMLButtonElement>(null);
	const popRef = useRef<HTMLDivElement>(null);
	/** where the popover sits (fixed, in the window), once measured */
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const all = useMemo(() => Array.from(new Set(getIconIds().map((id) => id.replace(/^lucide-/, "")))).sort(), []);
	const matches = useMemo(() => {
		const s = q.trim().toLowerCase().replace(/\s+/g, "-");
		if (!s) return all;
		const list = all.filter((id) => id.includes(s));
		return [...list.filter((id) => id.startsWith(s)), ...list.filter((id) => !id.startsWith(s))];
	}, [all, q]);
	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => {
			const t = e.target as Node;
			if (!ref.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, [open]);
	// The popover lives on the document body (so scrolling panes don't clip it), placed by the button: below it (above
	// when there's no room), left-aligned (right-aligned when that fits better), and always inside the window.
	useLayoutEffect(() => {
		if (!open) {
			setPos(null);
			return;
		}
		const place = () => {
			const b = btnRef.current?.getBoundingClientRect();
			const p = popRef.current;
			if (!b || !p) return;
			const win = p.ownerDocument.defaultView ?? window;
			const m = 8;
			const w = p.offsetWidth;
			const h = p.offsetHeight;
			let left = b.left + w <= win.innerWidth - m ? b.left : b.right - w;
			left = Math.max(m, Math.min(left, win.innerWidth - w - m));
			let top = b.bottom + 4;
			if (top + h > win.innerHeight - m) top = b.top - 4 - h >= m ? b.top - 4 - h : Math.max(m, win.innerHeight - h - m);
			setPos((cur) => (cur && cur.left === left && cur.top === top ? cur : { left, top }));
		};
		place();
		const input = popRef.current?.querySelector("input");
		if (input && popRef.current?.ownerDocument.activeElement !== input) input.focus();
		const win = btnRef.current?.ownerDocument.defaultView ?? window;
		win.addEventListener("resize", place);
		win.document.addEventListener("scroll", place, true);
		return () => {
			win.removeEventListener("resize", place);
			win.document.removeEventListener("scroll", place, true);
		};
	}, [open, matches.length]);
	const pick = (id: string) => {
		onChange(id);
		setOpen(false);
		setQ("");
	};
	return (
		<div className="oe-tm-iconpicker" ref={ref}>
			<button ref={btnRef} className="oe-tm-iconbtn" aria-label="Choose icon" aria-expanded={open} onClick={() => setOpen(!open)} style={{ "--oe-type-color": color } as CSSProperties}>
				<span className="oe-type-icon">{value || !empty ? <Icon name={value} /> : null}</span>
				<span className="oe-tm-iconname">{value || empty || "file"}</span>
				<Icon name="chevron-down" />
			</button>
			{open &&
				createPortal(
					<div ref={popRef} className="oe-tm-popover" role="dialog" aria-label="Icons" style={pos ? { left: pos.left, top: pos.top } : { left: -10000, top: 0 }}
						onKeyDown={(e) => {
							if (e.key !== "Escape") return;
							e.preventDefault();
							e.stopPropagation();
							setOpen(false);
							btnRef.current?.focus();
						}}
					>
						<input
							type="search"
							autoFocus
							placeholder="Search icons: ship, sword, crown…"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && matches[0]) pick(matches[0]);
							}}
						/>
						<div className="oe-tm-icongrid" style={{ "--oe-type-color": color } as CSSProperties}>
							{matches.slice(0, ICON_LIMIT).map((id) => (
								<button key={id} className={`oe-tm-iconcell${id === value ? " is-active" : ""}`} title={id} aria-label={id} onClick={() => pick(id)}>
									<Icon name={id} />
								</button>
							))}
						</div>
						<div className="oe-tm-muted oe-tm-iconcount">
							{matches.length > ICON_LIMIT ? `Showing ${ICON_LIMIT} of ${matches.length} — type to narrow down` : `${matches.length} icon${matches.length === 1 ? "" : "s"}`}
						</div>
					</div>,
				(btnRef.current?.ownerDocument ?? document).body,
			)}
		</div>
	);
}

/** Section heading inside a tab. */
export function Section({ title, desc, children, actions }: { title: string; desc?: ReactNode; children: ReactNode; actions?: ReactNode }) {
	return (
		<section className="oe-tm-section">
			<div className="oe-tm-section-head">
				<h3>{title}</h3>
				{actions}
			</div>
			{desc && <div className="oe-tm-section-desc">{desc}</div>}
			{children}
		</section>
	);
}

/** An ordered choice from a fixed set of options: chosen items as chips (drag to reorder), plus an "Add…" dropdown. */
export function OrderedPicker({
	values,
	options,
	onChange,
	label,
	empty,
	invalid,
}: {
	values: string[];
	options: { value: string; label: string; icon?: string }[];
	onChange: (v: string[]) => void;
	label: string;
	empty: string;
	invalid?: boolean;
}) {
	const [dragFrom, setDragFrom] = useState<number | null>(null);
	const nameOf = (v: string) => options.find((o) => o.value === v);
	const rest = options.filter((o) => !values.includes(o.value));
	return (
		<div className={`oe-tm-chips oe-tm-ordered${invalid ? " is-invalid" : ""}`} data-label={label}>
			{values.length === 0 && <span className="oe-tm-muted">{empty}</span>}
			{values.map((v, i) => {
				const o = nameOf(v);
				return (
					<span
						key={v}
						className={`oe-tm-chip${o ? "" : " is-missing"}`}
						draggable
						data-value={v}
						onDragStart={() => setDragFrom(i)}
						onDragOver={(e) => e.preventDefault()}
						onDrop={() => {
							if (dragFrom === null || dragFrom === i) return;
							const next = [...values];
							const [m] = next.splice(dragFrom, 1);
							next.splice(i, 0, m);
							onChange(next);
							setDragFrom(null);
						}}
					>
						{values.length > 1 && <span className="oe-tm-chip-n">{i + 1}</span>}
						{o?.icon && <Icon name={o.icon} className="oe-chip-icon" />}
						{o?.label ?? v}
						<button className="oe-tm-chip-x clickable-icon" aria-label={`Remove ${o?.label ?? v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
							<Icon name="x" />
						</button>
					</span>
				);
			})}
			{rest.length > 0 && (
				<select className="dropdown oe-tm-add-target" aria-label={`Add to ${label}`} value="" onChange={(e) => e.target.value && onChange([...values, e.target.value])}>
					<option value="">+ Add…</option>
					{rest.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			)}
		</div>
	);
}

/** Text box for a date plus a calendar button that opens the browser's date picker (when the date adapter has one). */
export function DateInput({ value, onChange, label, dates, invalid }: { value: string; onChange: (v: string) => void; label: string; dates: DateAdapter; invalid?: boolean }) {
	const ref = useRef<HTMLInputElement>(null);
	const { toPicker, fromPicker } = dates;
	return (
		<div className="oe-tm-inline oe-date-control">
			<TextInput label={label} value={value} placeholder={dates.placeholder} invalid={invalid} onChange={onChange} />
			{toPicker && fromPicker && (
				<span className="oe-datepick">
					<button className="clickable-icon oe-datepick-btn" aria-label="Pick a date" onClick={() => ref.current && openNativePicker(ref.current, toPicker.call(dates, value))}>
						<Icon name="calendar" />
					</button>
					<input ref={ref} type="date" className="oe-datepick-native" tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.value && onChange(fromPicker.call(dates, e.target.value))} />
				</span>
			)}
		</div>
	);
}
