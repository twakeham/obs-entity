import { Menu, Modal, Notice, Setting, type App, type TFile } from "obsidian";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { subtitleOf, urlHref } from "../../model/card";
import { entityProblems, otherKeys, otherKind, parseInput, usesOrder, type FieldProblem, type OtherKind } from "../../model/form";
import { isEmptyValue } from "../../model/frontmatter";
import { asArray, parseLabelledEntry, parseLink } from "../../model/links";
import { addLink, type Edge, type RelationItem } from "../../model/relations";
import { COMMON_KEYS, isListValued, statusesFor, type EntityTypeDef, type FieldDef, type FieldKind, type RelationTarget } from "../../model/types";
import type { EntityRecord } from "../../services/entityIndex";
import { openNativePicker } from "../components/datePicker";
import { EntitySuggest, TypePickerModal } from "../components/entityPicker";
import { usePlugin, useRelationsVersion } from "./context";
import { statusTone } from "./EntityBits";
import { EntityChip } from "./EntityChip";
import { Icon } from "./Icon";
import { KIND_INFO } from "./types/editor";

/** live: Live Preview (editable); reading: Reading view (read-only until the pencil); preview: the type editor's preview */
export type FormMode = "live" | "reading" | "preview";

/** "Other properties" open or closed, shared by all notes for the session. */
let othersOpenDefault = false;

const basename = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/, "");
const Empty = () => <span className="oe-prop-empty">Empty</span>;

type Write = (key: string, value: unknown) => void;

/** The entity properties form for a note, shown in place of Obsidian's Properties block. */
export function EntityForm({ path, mode }: { path: string; mode: Exclude<FormMode, "preview"> }) {
	const plugin = usePlugin();
	useRelationsVersion();
	const [editing, setEditing] = useState(mode === "live");
	const entity = plugin.index.get(path);
	if (!entity) return null;
	return <FormView type={entity.type} fm={entity.frontmatter} path={path} file={entity.file} mode={mode} editing={editing} setEditing={setEditing} />;
}

/** Read-only form for the type editor's preview, filled with sample values. */
export function FormPreview({ type, fm, path }: { type: EntityTypeDef; fm: Record<string, unknown>; path: string }) {
	return <FormView type={type} fm={fm} path={path} file={null} mode="preview" editing={false} />;
}

interface FormViewProps {
	type: EntityTypeDef;
	fm: Record<string, unknown>;
	path: string;
	file: TFile | null;
	mode: FormMode;
	editing: boolean;
	setEditing?: (v: boolean) => void;
}

/** A value written by the form that the metadata cache hasn't caught up with yet. */
interface Pending {
	value: unknown;
	/** the saved value (JSON) when it was written: if the saved value changes to anything else, something else won */
	base: string | undefined;
}

const json = (v: unknown) => JSON.stringify(v);

function FormView({ type, fm, path, file, mode, editing, setEditing }: FormViewProps) {
	const plugin = usePlugin();
	const editable = editing && mode !== "preview" && !!file;
	const [pending, setPending] = useState<Record<string, Pending>>({});
	const [collapsed, setCollapsed] = useState(mode !== "preview" && plugin.settings.formCollapsed);
	const [showEmpty, setShowEmpty] = useState(false);
	const [othersOpen, setOthersOpen] = useState(othersOpenDefault);
	const rootRef = useRef<HTMLDivElement>(null);
	// Show written values until the saved copy has them (or another change to the same key wins), key by key.
	useEffect(
		() =>
			setPending((o) => {
				const next: Record<string, Pending> = {};
				let changed = false;
				for (const [k, p] of Object.entries(o)) {
					const saved = json(fm[k]);
					if (saved === json(p.value) || saved !== p.base) changed = true;
					else next[k] = p;
				}
				return changed ? next : o;
			}),
		[fm],
	);

	const values: Record<string, unknown> = { ...fm };
	for (const [k, p] of Object.entries(pending)) {
		if (p.value === undefined) delete values[k];
		else values[k] = p.value;
	}
	const get = (key: string) => values[key];
	const hold = (key: string, value: unknown) => setPending((o) => ({ ...o, [key]: { value, base: o[key]?.base ?? json(fm[key]) } }));

	const write: Write = (key, value) => {
		if (!file) return;
		hold(key, value);
		plugin.writeProperty(file, key, value).catch((e: Error) => new Notice(`Couldn't save ${key}: ${e.message}`));
	};

	// Checked against what's on screen, so fixes build on edits that haven't reached the index yet.
	const problems = mode === "preview" ? [] : entityProblems(type, values, plugin.checkContext(path));
	const problemsAt = (key: string) => problems.filter((p) => p.key === key);
	const fix = (p: FieldProblem) => p.fix && write(p.key, p.fix.value);

	const jumpToProblem = () => {
		setCollapsed(false);
		setShowEmpty(true);
		window.setTimeout(() => {
			const row = rootRef.current?.querySelector<HTMLElement>(".oe-status.is-invalid, .oe-prop.has-problem");
			if (!row) return;
			row.scrollIntoView({ block: "center" });
			(row.matches("select") ? row : row.querySelector<HTMLElement>(".oe-prop-value input, .oe-prop-value select, .oe-prop-value textarea, .oe-prop-value button, .oe-prop-value a"))?.focus();
		}, 0);
	};

	const toggleCollapsed = () => {
		const next = !collapsed;
		setCollapsed(next);
		plugin.settings.formCollapsed = next;
		void plugin.saveData(plugin.settings);
	};

	const headerMenu = (evt: MouseEvent) => {
		if (!file) return;
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle("Change type…")
				.setIcon("repeat")
				.onClick(() =>
					new TypePickerModal(
						plugin,
						(t) => void plugin.factory.convertToEntity(file, t),
						plugin.settings.types.filter((t) => t.key !== type.key),
						`Change "${file.basename}" from ${type.name.toLowerCase()} to…`,
					).open(),
				),
		);
		m.addItem((i) => i.setTitle(`Configure the ${type.name} type`).setIcon("shapes").onClick(() => void plugin.activateTypes(type.key)));
		m.showAtMouseEvent(evt.nativeEvent);
	};

	// Ctrl/Cmd+Z undoes the last form edit, unless a text box has unsaved typing (then the browser undoes that).
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (!file || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
		const t = e.target as HTMLElement;
		if (t.dataset.dirty === "1") return;
		e.preventDefault();
		e.stopPropagation();
		const edit = plugin.undoProperty(file.path);
		if (edit) hold(edit.key, edit.before);
		else new Notice("Nothing to undo in the properties form.");
	};

	const controlFor = (f: FieldDef): ReactNode => {
		const raw = get(f.key);
		const commit = (v: unknown) => write(f.key, v);
		const label = f.label || f.key;
		switch (f.kind) {
			case "relation":
				return (
					<RelationControl
						fieldKey={f.key}
						label={label}
						targets={f.targets}
						list={isListValued(f)}
						labelled={!!f.labelled}
						symmetric={!!f.symmetric}
						value={raw}
						editable={editable}
						path={path}
						type={type}
						live={mode !== "preview"}
						problems={problemsAt(f.key)}
						onCommit={commit}
					/>
				);
			case "boolean":
				return <CheckControl value={raw} editable={editable} label={label} onCommit={commit} />;
			case "select":
				return <SelectControl options={f.options ?? []} value={raw} editable={editable} label={label} onCommit={commit} />;
			case "multiselect":
				return <MultiControl options={f.options ?? []} value={raw} editable={editable} label={label} onCommit={commit} />;
			case "list":
				return <ListControl value={raw} editable={editable} label={label} onCommit={commit} />;
			default:
				return <TextControl kind={f.kind} value={raw} editable={editable} label={label} onCommit={commit} />;
		}
	};

	const isBlank = (kind: FieldKind | "order", raw: unknown) => isEmptyValue(raw) || (kind === "boolean" && raw !== true);
	const hideEmpty = !!type.form?.hideEmpty && !showEmpty;
	let hidden = 0;
	const rows: ReactNode[] = [];
	const row = (key: string, kind: FieldKind | "order", node: ReactNode, opts: { label: string; icon: string; required?: boolean; desc?: string }) => {
		const ps = problemsAt(key);
		const blank = isBlank(kind, get(key));
		if (hideEmpty && blank && ps.length === 0) {
			hidden++;
			return;
		}
		rows.push(
			<PropRow key={key} k={key} {...opts} problems={ps} empty={blank} editable={editable} onFix={fix}>
				{node}
			</PropRow>,
		);
	};
	for (const f of type.fields) row(f.key, f.kind, controlFor(f), { label: f.label || f.key, icon: KIND_INFO[f.kind].icon, required: f.required, desc: f.description });
	if (usesOrder(type)) {
		row(COMMON_KEYS.order, "order", <TextControl kind="number" value={get(COMMON_KEYS.order)} editable={editable} label="Order" onCommit={(v) => write(COMMON_KEYS.order, v)} />, {
			label: "Order",
			icon: "arrow-down-01",
			desc: "Sorts this note among its siblings in the browser.",
		});
	}
	row(
		COMMON_KEYS.related,
		"relation",
		<RelationControl
			fieldKey={COMMON_KEYS.related}
			label="Related"
			list
			labelled={false}
			symmetric
			value={get(COMMON_KEYS.related)}
			editable={editable}
			path={path}
			type={type}
			live={mode !== "preview"}
			problems={problemsAt(COMMON_KEYS.related)}
			onCommit={(v) => write(COMMON_KEYS.related, v)}
		/>,
		{ label: "Related", icon: "link-2", desc: "Links to any entity, shown on both notes." },
	);
	row(COMMON_KEYS.tags, "list", <ListControl value={get(COMMON_KEYS.tags)} editable={editable} label="Tags" tag onCommit={(v) => write(COMMON_KEYS.tags, v)} />, { label: "Tags", icon: "tags" });
	row(COMMON_KEYS.aliases, "list", <ListControl value={get(COMMON_KEYS.aliases)} editable={editable} label="Aliases" onCommit={(v) => write(COMMON_KEYS.aliases, v)} />, { label: "Aliases", icon: "forward" });

	const others = mode === "preview" ? [] : otherKeys(type, values);
	const subtitle = subtitleOf(type, values, plugin.dates);
	const statusProblem = problemsAt(COMMON_KEYS.status)[0];

	return (
		<div
			ref={rootRef}
			className={`oe-form${collapsed ? " is-collapsed" : ""}${editable ? " is-editing" : ""}`}
			style={{ "--oe-type-color": type.color } as CSSProperties}
			data-entity-type={type.key}
			onKeyDown={onKeyDown}
		>
			<div className="oe-form-top">
				<span className="oe-form-type">
					<Icon name={type.icon} className="oe-chip-icon" />
					{type.name}
				</span>
				<StatusControl type={type} value={get(COMMON_KEYS.status)} editable={editable} problem={statusProblem} onCommit={(v) => write(COMMON_KEYS.status, v)} />
				<span className="oe-form-subtitle" title={subtitle ?? undefined}>
					{subtitle}
				</span>
				{problems.length > 0 && (
					<button type="button" className="oe-form-problems" aria-label="Go to the first problem" onClick={jumpToProblem}>
						<Icon name="alert-circle" />
						{problems.length} {problems.length === 1 ? "problem" : "problems"}
					</button>
				)}
				{mode !== "preview" && (
					<span className="oe-form-actions">
						{mode === "reading" && setEditing && (
							<button type="button" className={`clickable-icon${editing ? " is-active" : ""}`} aria-label={editing ? "Done editing" : "Edit properties"} onClick={() => setEditing(!editing)}>
								<Icon name={editing ? "check" : "pencil"} />
							</button>
						)}
						<button type="button" className="clickable-icon" aria-label="Open connections panel" onClick={() => void plugin.activateConnectionsView()}>
							<Icon name="waypoints" />
						</button>
						<button type="button" className="clickable-icon" aria-label="More options" onClick={headerMenu}>
							<Icon name="more-horizontal" />
						</button>
						<button type="button" className="clickable-icon oe-form-collapse" aria-label={collapsed ? "Show properties" : "Hide properties"} aria-expanded={!collapsed} onClick={toggleCollapsed}>
							<Icon name={collapsed ? "chevron-down" : "chevron-up"} />
						</button>
					</span>
				)}
			</div>
			{!collapsed && (
				<div className="oe-form-body">
					<div className="oe-form-rows">{rows}</div>
					{hidden > 0 && (
						<button type="button" className="oe-form-more" onClick={() => setShowEmpty(true)}>
							Show {hidden} empty {hidden === 1 ? "field" : "fields"}
						</button>
					)}
					{type.form?.hideEmpty && showEmpty && hidden === 0 && (
						<button type="button" className="oe-form-more" onClick={() => setShowEmpty(false)}>
							Hide empty fields
						</button>
					)}
					{(others.length > 0 || editable) && (
						<div className={`oe-form-other${othersOpen ? " is-open" : ""}`}>
							<button
								type="button"
								className="oe-form-other-toggle"
								aria-expanded={othersOpen}
								onClick={() => {
									othersOpenDefault = !othersOpen;
									setOthersOpen(!othersOpen);
								}}
							>
								<Icon name={othersOpen ? "chevron-down" : "chevron-right"} />
								Other properties
								<span className="oe-form-count">{others.length}</span>
							</button>
							{othersOpen && (
								<div className="oe-form-rows">
									{others.map((k) => (
										<OtherRow key={k} k={k} value={get(k)} editable={editable} type={type} write={write} />
									))}
									{editable && <AddProperty existing={Object.keys(values)} onAdd={(k) => write(k, null)} />}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function PropRow({
	k,
	label,
	icon,
	required,
	desc,
	problems,
	empty,
	editable,
	onFix,
	menu,
	children,
}: {
	k: string;
	label: string;
	icon: string;
	required?: boolean;
	desc?: string;
	problems: FieldProblem[];
	empty: boolean;
	editable: boolean;
	onFix: (p: FieldProblem) => void;
	menu?: (evt: MouseEvent) => void;
	children: ReactNode;
}) {
	const worst = problems.find((p) => p.severity === "error") ?? problems[0];
	return (
		<div className={`oe-prop${worst ? ` has-problem is-${worst.severity}` : ""}${empty ? " is-empty" : ""}`} data-key={k}>
			<div className="oe-prop-label" aria-label={desc}>
				<Icon name={icon} className="oe-prop-icon" />
				<span className="oe-prop-name">{label}</span>
				{required && (
					<span className="oe-prop-required" aria-label="Required">
						*
					</span>
				)}
			</div>
			<div className="oe-prop-value">
				{children}
				{worst && (
					<span className="oe-prop-problem">
						<span className="oe-prop-problem-icon" aria-label={problems.map((p) => p.message).join("\n")}>
							<Icon name={worst.severity === "error" ? "alert-circle" : "alert-triangle"} />
						</span>
						{editable &&
							problems
								.filter((p) => p.fix)
								.map((p, i) => (
									<button key={i} type="button" className="oe-prop-fix" onClick={() => onFix(p)}>
										{p.fix!.label}
										{p.link ? ` (${basename(p.link)})` : ""}
									</button>
								))}
					</span>
				)}
			</div>
			{menu && (
				<button type="button" className="clickable-icon oe-prop-menu" aria-label={`${label} options`} onClick={menu}>
					<Icon name="more-horizontal" />
				</button>
			)}
		</div>
	);
}

function StatusControl({ type, value, editable, problem, onCommit }: { type: EntityTypeDef; value: unknown; editable: boolean; problem?: FieldProblem; onCommit: (v: unknown) => void }) {
	const plugin = usePlugin();
	const options = statusesFor(type, plugin.settings.groups);
	const current = typeof value === "string" ? value : isEmptyValue(value) ? "" : String(value);
	const invalid = problem ? " is-invalid" : "";
	if (!editable) {
		return current ? (
			<span className={`oe-status-pill oe-tone-${statusTone(current)}${invalid}`} aria-label={problem?.message}>
				{current}
			</span>
		) : null;
	}
	const all = current && !options.includes(current) ? [current, ...options] : options;
	return (
		<select className={`oe-status dropdown oe-tone-${statusTone(current || null)}${invalid}`} value={current} aria-label={problem ? `Status: ${problem.message}` : "Status"} onChange={(e) => onCommit(e.target.value || null)}>
			{!current && <option value="">no status</option>}
			{all.map((s) => (
				<option key={s} value={s}>
					{options.includes(s) ? s : `${s} (not a status here)`}
				</option>
			))}
		</select>
	);
}

/** Single-value text-like fields: saved on blur or Enter, Esc cancels. Invalid input isn't saved. */
function TextControl({ kind, value, editable, label, onCommit }: { kind: "text" | "textarea" | "url" | "number" | "date"; value: unknown; editable: boolean; label: string; onCommit: (v: unknown) => void }) {
	const plugin = usePlugin();
	const dates = plugin.dates;
	const display = isEmptyValue(value) ? "" : Array.isArray(value) ? value.map(String).join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
	const [text, setText] = useState(display);
	const focused = useRef(false);
	const cancelled = useRef(false);
	const pickerRef = useRef<HTMLInputElement>(null);
	const shown = useRef(display);
	// Follow outside changes (sync, undo); while focused only if the box has no typing of its own.
	useEffect(() => {
		if (!focused.current || text === shown.current) setText(display);
		shown.current = display;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [display]);

	if (!editable) {
		if (!display) return <Empty />;
		if (kind === "url") {
			const href = urlHref(display);
			return href ? (
				<a className="external-link oe-prop-text" href={href} target="_blank" rel="noopener">
					{display}
				</a>
			) : (
				<span className="oe-prop-text">{display}</span>
			);
		}
		if (kind === "date") {
			const r = dates.parse(value);
			return <span className="oe-prop-text">{r?.ok ? r.display : display}</span>;
		}
		return <span className={`oe-prop-text${kind === "textarea" ? " is-multiline" : ""}`}>{display}</span>;
	}

	const commit = (t: string) => {
		if (t === display) return;
		const r = parseInput(kind, t, dates);
		if (!r.ok) {
			new Notice(`Not saved: ${r.error}`);
			setText(display);
			return;
		}
		onCommit(r.value);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			cancelled.current = true;
			e.currentTarget.blur();
		} else if (e.key === "Enter" && !e.nativeEvent.isComposing && (kind !== "textarea" || e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			e.currentTarget.blur();
		}
	};
	const props = {
		className: "oe-prop-input",
		"aria-label": label,
		value: text,
		placeholder: kind === "date" ? dates.placeholder : "Empty",
		"data-dirty": text !== display ? "1" : undefined,
		onChange: (e: { target: { value: string } }) => setText(e.target.value),
		onFocus: () => {
			focused.current = true;
		},
		onBlur: () => {
			focused.current = false;
			if (cancelled.current) {
				cancelled.current = false;
				setText(display);
				return;
			}
			commit(text);
		},
		onKeyDown,
	};
	if (kind === "textarea") return <textarea {...props} rows={Math.min(8, Math.max(1, text.split("\n").length))} />;
	const input = <input type="text" inputMode={kind === "number" ? "decimal" : kind === "url" ? "url" : undefined} {...props} />;
	if (kind === "date" && dates.toPicker && dates.fromPicker) {
		const { toPicker, fromPicker } = dates;
		return (
			<span className="oe-prop-inline">
				{input}
				<span className="oe-datepick">
					<button type="button" className="clickable-icon oe-datepick-btn" aria-label="Pick a date" onClick={() => pickerRef.current && openNativePicker(pickerRef.current, toPicker.call(dates, text))}>
						<Icon name="calendar" />
					</button>
					<input
						ref={pickerRef}
						type="date"
						className="oe-datepick-native"
						tabIndex={-1}
						aria-hidden="true"
						onChange={(e) => {
							if (!e.target.value) return;
							const v = fromPicker.call(dates, e.target.value);
							setText(v);
							commit(v);
						}}
					/>
				</span>
			</span>
		);
	}
	if (kind === "url") {
		const href = urlHref(display);
		return (
			<span className="oe-prop-inline">
				{input}
				{href && (
					<a className="clickable-icon oe-prop-open" href={href} target="_blank" rel="noopener" aria-label="Open link">
						<Icon name="external-link" />
					</a>
				)}
			</span>
		);
	}
	return input;
}

function CheckControl({ value, editable, label, onCommit }: { value: unknown; editable: boolean; label: string; onCommit: (v: unknown) => void }) {
	if (!editable) return value === true ? <span className="oe-prop-text">Yes</span> : value === false ? <span className="oe-prop-text">No</span> : <Empty />;
	return <input type="checkbox" className="oe-prop-check" aria-label={label} checked={value === true} onChange={(e) => onCommit(e.target.checked)} />;
}

function SelectControl({ options, value, editable, label, onCommit }: { options: string[]; value: unknown; editable: boolean; label: string; onCommit: (v: unknown) => void }) {
	const current = isEmptyValue(value) ? "" : Array.isArray(value) ? String(value[0] ?? "") : String(value);
	if (!editable) return current ? <span className="oe-prop-text">{current}</span> : <Empty />;
	const all = current && !options.includes(current) ? [current, ...options] : options;
	return (
		<select className="dropdown oe-prop-select" aria-label={label} value={current} onChange={(e) => onCommit(e.target.value || null)}>
			<option value="">—</option>
			{all.map((o) => (
				<option key={o} value={o}>
					{options.includes(o) ? o : `${o} (not an option)`}
				</option>
			))}
		</select>
	);
}

function MultiControl({ options, value, editable, label, onCommit }: { options: string[]; value: unknown; editable: boolean; label: string; onCommit: (v: unknown) => void }) {
	const chosen = asArray(value).map(String);
	const extra = chosen.filter((c) => !options.includes(c));
	if (!editable) {
		return chosen.length ? (
			<span className="oe-prop-pills">
				{chosen.map((c) => (
					<span key={c} className="oe-pill">
						{c}
					</span>
				))}
			</span>
		) : (
			<Empty />
		);
	}
	const toggle = (o: string) => onCommit(chosen.includes(o) ? chosen.filter((x) => x !== o) : [...options.filter((x) => x === o || chosen.includes(x)), ...extra]);
	return (
		<span className="oe-prop-options" role="group" aria-label={label}>
			{options.map((o) => (
				<button key={o} type="button" className={`oe-option${chosen.includes(o) ? " is-active" : ""}`} aria-pressed={chosen.includes(o)} onClick={() => toggle(o)}>
					{o}
				</button>
			))}
			{extra.map((o) => (
				<button key={`x:${o}`} type="button" className="oe-option is-active is-invalid" aria-label={`Remove “${o}” (not an option)`} onClick={() => onCommit(chosen.filter((x) => x !== o))}>
					{o} ×
				</button>
			))}
		</span>
	);
}

/**
 * Keyboard for chip rows: ←/→ move between chips and the add box, Backspace/Delete removes the focused chip,
 * Backspace in an empty add box removes the last chip.
 */
function chipKeys(remove: (chip: HTMLElement) => void) {
	return (e: KeyboardEvent<HTMLElement>) => {
		const container = e.currentTarget;
		const stops = Array.from(container.querySelectorAll<HTMLElement>(".oe-prop-chip > a.oe-chip, .oe-pill[tabindex], input.oe-prop-add"));
		const active = document.activeElement as HTMLElement | null;
		const i = active ? stops.indexOf(active) : -1;
		if (i < 0) return;
		const inInput = active instanceof HTMLInputElement;
		if (inInput && active.value) return;
		const chipOf = (el: HTMLElement) => el.closest<HTMLElement>("[data-chip]");
		const focusAfterRemoval = (idx: number) =>
			window.setTimeout(() => {
				const now = Array.from(container.querySelectorAll<HTMLElement>(".oe-prop-chip > a.oe-chip, .oe-pill[tabindex], input.oe-prop-add"));
				now[Math.min(idx, now.length - 1)]?.focus();
			}, 50);
		if (e.key === "ArrowLeft" && i > 0) {
			e.preventDefault();
			stops[i - 1].focus();
		} else if (e.key === "ArrowRight" && i < stops.length - 1 && !inInput) {
			e.preventDefault();
			stops[i + 1].focus();
		} else if ((e.key === "Backspace" || e.key === "Delete") && !inInput) {
			const chip = chipOf(active!);
			if (!chip) return;
			e.preventDefault();
			remove(chip);
			focusAfterRemoval(i);
		} else if (e.key === "Backspace" && inInput && i > 0) {
			const chip = chipOf(stops[i - 1]);
			if (!chip) return;
			e.preventDefault();
			remove(chip);
		}
	};
}

/** Free lists (list fields, tags, aliases): chips plus an add box (Enter or comma adds). */
function ListControl({ value, editable, label, tag, onCommit }: { value: unknown; editable: boolean; label: string; tag?: boolean; onCommit: (v: unknown) => void }) {
	const items = asArray(value).map(String);
	const [text, setText] = useState("");
	const show = (t: string) => (tag ? `#${t.replace(/^#/, "")}` : t);
	if (!editable) {
		return items.length ? (
			<span className="oe-prop-pills">
				{items.map((t, i) => (
					<span key={i} className={`oe-pill${tag ? " is-tag" : ""}`}>
						{show(t)}
					</span>
				))}
			</span>
		) : (
			<Empty />
		);
	}
	const clean = (s: string) => (tag ? s.trim().replace(/^#/, "") : s).trim();
	const add = (s: string) => {
		const parts = s
			.split(",")
			.map(clean)
			.filter((p, i, all) => p && !items.includes(p) && all.indexOf(p) === i);
		if (parts.length) onCommit([...items, ...parts]);
		setText("");
	};
	const removeAt = (i: number) => onCommit(items.filter((_, j) => j !== i));
	return (
		<span className="oe-prop-chips" onKeyDown={chipKeys((chip) => removeAt(Number(chip.dataset.chip)))}>
			{items.map((t, i) => (
				<span key={`${i}:${t}`} className={`oe-pill is-removable${tag ? " is-tag" : ""}`} data-chip={i} tabIndex={0} aria-label={`${show(t)}. Press Delete to remove.`}>
					{show(t)}
					<span className="oe-pill-x" role="button" aria-label={`Remove ${show(t)}`} onClick={() => removeAt(i)}>
						<Icon name="x" />
					</span>
				</span>
			))}
			<input
				className="oe-prop-add"
				value={text}
				placeholder={items.length ? "Add…" : "Empty"}
				aria-label={`Add to ${label}`}
				data-dirty={text ? "1" : undefined}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if ((e.key === "Enter" || e.key === ",") && text.trim()) {
						e.preventDefault();
						add(text);
					} else if (e.key === "Escape") {
						setText("");
						e.currentTarget.blur();
					}
				}}
				onBlur={() => text.trim() && add(text)}
			/>
		</span>
	);
}

/** Ask for an optional label for a labelled link ("mentor"). Closing the dialog cancels. */
class LabelModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private done: (label: string | undefined) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		let value = "";
		new Setting(this.contentEl)
			.setName("Label")
			.setDesc("Optional, e.g. mentor or rival.")
			.addText((t) => {
				t.onChange((v) => (value = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						this.submit(value);
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText("Add link")
				.setCta()
				.onClick(() => this.submit(value)),
		);
	}

	private submit(v: string): void {
		this.close();
		this.done(v.trim() || undefined);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Show `message` with an Undo link. */
function undoNotice(message: string, undo: () => void): void {
	const frag = document.createDocumentFragment();
	frag.append(`${message} `);
	const a = frag.appendChild(document.createElement("a"));
	a.href = "#";
	a.textContent = "Undo";
	const notice = new Notice(frag, 8000);
	a.addEventListener("click", (e) => {
		e.preventDefault();
		notice.hide();
		undo();
	});
}

/**
 * Relation fields (and Related): chips for this note's links, chips for links set on other notes when the field
 * reads both ways, and a picker limited to the allowed types. Picking in a single-link field replaces the link.
 */
function RelationControl({
	fieldKey,
	label,
	targets,
	list,
	labelled,
	symmetric,
	value,
	editable,
	path,
	type,
	live,
	problems,
	onCommit,
}: {
	fieldKey: string;
	label: string;
	targets?: RelationTarget[];
	list: boolean;
	labelled: boolean;
	symmetric: boolean;
	value: unknown;
	editable: boolean;
	path: string;
	type: EntityTypeDef;
	/** a real note (not the type editor preview): include links set on other notes */
	live: boolean;
	problems: FieldProblem[];
	onCommit: (v: unknown) => void;
}) {
	const plugin = usePlugin();
	const { app } = plugin;
	const inputRef = useRef<HTMLInputElement>(null);
	const latest = useRef(value);
	latest.current = value;
	const related = fieldKey === COMMON_KEYS.related;

	const entries = asArray(value);
	const items: { index: number; item: RelationItem; name: string }[] = [];
	entries.forEach((raw, index) => {
		const parsed = labelled ? parseLabelledEntry(raw) : (() => {
			const link = parseLink(raw);
			return link ? { link, label: undefined as string | undefined } : null;
		})();
		if (!parsed) return;
		const target = app.metadataCache.getFirstLinkpathDest(parsed.link.path, path)?.path ?? null;
		const edge: Edge = {
			source: path,
			target,
			linktext: parsed.link.path,
			sourceType: type.key,
			fieldKey,
			fieldLabel: label,
			symmetric,
			labelled,
			label: parsed.label,
			related,
			targets,
		};
		items.push({ index, item: { path: target, linktext: parsed.link.path, direction: "out", edge }, name: target ? basename(target) : (parsed.link.path.split("/").pop() ?? parsed.link.path) });
	});
	const mine = new Set(items.map((x) => x.item.path).filter(Boolean));
	const incoming =
		live && symmetric
			? plugin.relations
					.incomingOf(path)
					.filter((e) => e.source !== path && !mine.has(e.source) && (related ? e.related : !e.related && e.symmetric && e.fieldKey === fieldKey))
					.filter((e, i, all) => all.findIndex((x) => x.source === e.source) === i)
			: [];

	const pick = (entity: EntityRecord) => {
		const linktext = app.metadataCache.fileToLinktext(entity.file, path, true);
		const finish = (lab?: string) => onCommit(addLink(latest.current, linktext, { multiple: list, labelled, label: lab }));
		if (labelled) new LabelModal(app, `${label}: ${entity.name}`, finish).open();
		else finish();
	};
	// The picker lives as long as the input; it reads the field's current settings (they change when the type is edited or the note changes type).
	const current = useRef({ pick, list, labelled, targets, related });
	current.current = { pick, list, labelled, targets, related };
	useEffect(() => {
		if (!editable || !inputRef.current) return;
		const suggest = new EntitySuggest(app, inputRef.current, plugin, {
			get targets() {
				return current.current.related ? undefined : current.current.targets;
			},
			exclude: () => {
				const { list: many, labelled: lab } = current.current;
				const paths = new Set<string>([path]);
				for (const raw of asArray(latest.current)) {
					const link = lab ? parseLabelledEntry(raw)?.link : parseLink(raw);
					const file = link ? app.metadataCache.getFirstLinkpathDest(link.path, path) : null;
					if (file && many) paths.add(file.path);
				}
				return paths;
			},
			onPick: (e) => current.current.pick(e),
		});
		return () => suggest.close();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editable]);

	const removeAt = (index: number, name: string) => {
		const before = latest.current;
		const next = Array.isArray(before) ? before.filter((_, j) => j !== index) : list ? [] : null;
		onCommit(next);
		undoNotice(`Removed ${name} from ${label}.`, () => onCommit(before));
	};
	const removeIncoming = (source: string) => {
		const edge = incoming.find((e) => e.source === source);
		if (edge) void plugin.factory.removeRelation(edge);
	};

	if (!editable && items.length === 0 && incoming.length === 0) return <Empty />;
	const problemFor = (linkpath: string) => problems.find((p) => p.link === linkpath);
	return (
		<span
			className="oe-prop-chips"
			onKeyDown={chipKeys((chip) => {
				if (chip.dataset.source) removeIncoming(chip.dataset.source);
				else {
					const x = items.find((it) => String(it.index) === chip.dataset.chip);
					if (x) removeAt(x.index, x.name);
				}
			})}
		>
			{items.map(({ index, item, name }) => {
				const p = problemFor(item.linktext);
				return (
					<span key={`o${index}`} className={`oe-prop-chip${p ? ` has-problem is-${p.severity}` : ""}`} data-chip={index} aria-label={p?.message}>
						<EntityChip item={item} sourcePath={path} onRemove={editable ? () => removeAt(index, name) : undefined} removeLabel={`Remove ${name}`} />
					</span>
				);
			})}
			{incoming.map((e) => (
				<span key={`i:${e.source}`} className="oe-prop-chip is-incoming" data-chip={`in:${e.source}`} data-source={e.source} aria-label={`Set on ${basename(e.source)}`}>
					<EntityChip
						item={{ path: e.source, linktext: e.source, direction: "in", edge: e }}
						sourcePath={path}
						onRemove={editable ? () => removeIncoming(e.source) : undefined}
						removeLabel={`Remove ${basename(e.source)} (edits ${basename(e.source)})`}
					/>
				</span>
			))}
			{editable && <input ref={inputRef} className="oe-prop-add" placeholder={items.length === 0 ? "Empty" : list ? "Add…" : "Change…"} aria-label={list ? `Add to ${label}` : `Choose ${label}`} />}
		</span>
	);
}

const OTHER_ICONS: Record<OtherKind, string> = { text: "type", number: "hash", boolean: "check-square", date: "calendar", list: "list" };

/** A property the type doesn't define, edited by its Obsidian property type (or its value's shape). */
function OtherRow({ k, value, editable, type, write }: { k: string; value: unknown; editable: boolean; type: EntityTypeDef; write: Write }) {
	const plugin = usePlugin();
	const kind = otherKind(value, plugin.propertyWidget(k));
	const commit = (v: unknown) => write(k, v);
	const complex = value !== null && typeof value === "object" && !Array.isArray(value);
	const control = complex ? (
		<span className="oe-prop-text oe-prop-code">{JSON.stringify(value)}</span>
	) : kind === "boolean" ? (
		<CheckControl value={value} editable={editable} label={k} onCommit={commit} />
	) : kind === "list" ? (
		<ListControl value={value} editable={editable} label={k} onCommit={commit} />
	) : (
		<TextControl kind={kind} value={value} editable={editable} label={k} onCommit={commit} />
	);
	const menu = (evt: MouseEvent) => {
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle(`Add to the ${type.name} type`)
				.setIcon("list-plus")
				.onClick(() => void plugin.addPropertyToType(type.key, k, value)),
		);
		m.addItem((i) =>
			i
				.setTitle("Remove")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => {
					write(k, undefined);
					undoNotice(`Removed the “${k}” property.`, () => write(k, value));
				}),
		);
		m.showAtMouseEvent(evt.nativeEvent);
	};
	return (
		<PropRow k={k} label={k} icon={OTHER_ICONS[kind]} problems={[]} empty={isEmptyValue(value)} editable={editable} onFix={() => {}} menu={editable ? menu : undefined}>
			{control}
		</PropRow>
	);
}

function AddProperty({ existing, onAdd }: { existing: string[]; onAdd: (key: string) => void }) {
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");
	if (!adding) {
		return (
			<button type="button" className="oe-form-addprop" onClick={() => setAdding(true)}>
				<Icon name="plus" />
				Add property
			</button>
		);
	}
	const submit = () => {
		const k = name.trim();
		if (k && existing.includes(k)) {
			new Notice(`This note already has a “${k}” property.`);
			return;
		}
		if (k) onAdd(k);
		setName("");
		setAdding(false);
	};
	return (
		<input
			autoFocus
			className="oe-prop-input oe-form-addprop-input"
			placeholder="Property name"
			aria-label="New property name"
			value={name}
			data-dirty={name ? "1" : undefined}
			onChange={(e) => setName(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					submit();
				} else if (e.key === "Escape") {
					setName("");
					setAdding(false);
				}
			}}
			onBlur={submit}
		/>
	);
}
