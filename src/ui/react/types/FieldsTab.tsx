import { Menu } from "obsidian";
import { useState, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import { newUid, renameFieldRefs, targetName } from "../../../model/typeEditing";
import { toKey, type EntityTypeDef, type FieldDef, type FieldKind } from "../../../model/types";
import { BOOLEAN_FORMATS, datePresetLabels, FIELD_DATE_PRESETS, FIELD_NUMBER_PRESETS, formattedKind, formatValue, urlText } from "../../../model/fieldFormats";
import { usePlugin } from "../context";
import { Icon } from "../Icon";
import { ChipsInput, DateInput, Issues, Row, Segmented, TargetPicker, TextInput, Toggle } from "./controls";
import { KIND_INFO, KIND_ORDER, useEditor } from "./editor";

/** Menu of field kinds for "+ Add field". */
export function addFieldMenu(evt: MouseEvent, add: (kind: FieldKind) => void, addRelationship?: () => void) {
	const menu = new Menu();
	for (const kind of KIND_ORDER) {
		if (kind === "relation" && addRelationship) continue;
		menu.addItem((i) => i.setTitle(`${KIND_INFO[kind].label} — ${KIND_INFO[kind].desc}`).setIcon(KIND_INFO[kind].icon).onClick(() => add(kind)));
	}
	if (addRelationship) {
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Relationship… — links to other entities").setIcon("link").onClick(addRelationship));
	}
	menu.showAtMouseEvent(evt.nativeEvent);
}

export function useAddField() {
	const { update, setFieldUid } = useEditor();
	return (kind: FieldKind) => {
		const uid = newUid();
		update((t, meta) => {
			const f: FieldDef = { key: "", label: "", kind, inModal: true };
			if (kind === "list") f.multiple = true;
			if (kind === "select" || kind === "multiselect") f.options = [];
			if (kind === "relation") f.targets = ["*"];
			t.fields.push(f);
			meta.push({ uid, origKey: null });
		});
		setFieldUid(uid);
	};
}

export function FieldsTab({ addRelationship }: { addRelationship: () => void }) {
	const { draft, update, issues, fieldUid, setFieldUid } = useEditor();
	const fields = draft.type.fields;
	const addField = useAddField();
	const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
	const selected = fieldUid ? draft.meta.findIndex((m) => m.uid === fieldUid) : -1;

	const move = (from: number, to: number) => {
		if (from === to || from + 1 === to) return;
		update((t, meta) => {
			const [f] = t.fields.splice(from, 1);
			const [m] = meta.splice(from, 1);
			const at = to > from ? to - 1 : to;
			t.fields.splice(at, 0, f);
			meta.splice(at, 0, m);
		});
	};
	const onDragOver = (e: DragEvent, i: number) => {
		if (!drag) return;
		e.preventDefault();
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const over = e.clientY < r.top + r.height / 2 ? i : i + 1;
		if (over !== drag.over) setDrag({ ...drag, over });
	};

	return (
		<div className="oe-tm-fields">
			<div className="oe-tm-fieldlist">
				<div className="oe-tm-fieldlist-head">
					<span className="oe-tm-muted">
						{fields.length} field{fields.length === 1 ? "" : "s"} · drag to reorder
					</span>
					<button className="mod-cta" onClick={(e) => addFieldMenu(e, addField, addRelationship)}>
						<Icon name="plus" /> Add field
					</button>
				</div>
				{fields.length === 0 && <div className="oe-tm-empty">No fields yet. Every note still gets a name, status and tags.</div>}
				<div className="oe-tm-rows" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && drag && setDrag({ ...drag, over: null })}>
					{fields.map((f, i) => {
						const uid = draft.meta[i]?.uid ?? String(i);
						const hasIssue = issues.some((x) => x.at.startsWith(`field:${i}:`));
						const info = KIND_INFO[f.kind];
						return (
							<div
								key={uid}
								data-field={f.key}
								className={`oe-tm-fieldrow${i === selected ? " is-selected" : ""}${hasIssue ? " has-issue" : ""}${drag?.from === i ? " is-dragging" : ""}${drag?.over === i ? " drop-before" : ""}${drag?.over === i + 1 && i === fields.length - 1 ? " drop-after" : ""}`}
								draggable
								onDragStart={(e) => {
									e.dataTransfer.effectAllowed = "move";
									e.dataTransfer.setData("text/plain", f.key);
									setDrag({ from: i, over: null });
								}}
								onDragOver={(e) => onDragOver(e, i)}
								onDrop={(e) => {
									e.preventDefault();
									if (drag?.over !== null && drag?.over !== undefined) move(drag.from, drag.over);
									setDrag(null);
								}}
								onDragEnd={() => setDrag(null)}
								onClick={() => setFieldUid(uid)}
							>
								<Icon name="grip-vertical" className="oe-tm-grip" />
								<span className="oe-tm-kind" title={info.label}>
									<Icon name={info.icon} />
								</span>
								<span className="oe-tm-fieldname">
									{f.label || <em className="oe-tm-muted">Untitled field</em>}
									<span className="oe-tm-fieldkey">{f.key}</span>
								</span>
								<FieldBadges field={f} />
								{hasIssue && <Icon name="alert-circle" className="oe-tm-issue-dot" />}
							</div>
						);
					})}
				</div>
			</div>
			<div className="oe-tm-details">
				{selected >= 0 ? (
					<FieldDetails index={selected} />
				) : (
					<div className="oe-tm-empty oe-tm-details-empty">
						<Icon name="mouse-pointer-click" />
						<div>Select a field to edit it.</div>
					</div>
				)}
			</div>
		</div>
	);
}

function FieldBadges({ field: f }: { field: FieldDef }) {
	const { allTypes, groups, draft } = useEditor();
	const card = draft.type.card;
	const badges: { text: string; cls?: string; style?: CSSProperties; icon?: string }[] = [];
	if (f.kind === "relation") {
		const targets = f.targets?.length ? f.targets : ["*"];
		for (const t of targets.slice(0, 2)) {
			const type = allTypes.find((x) => x.key === t);
			badges.push({ text: targetName(t, allTypes, false, groups), cls: "is-target", icon: type?.icon ?? (t.startsWith("@") ? "folder" : "asterisk"), style: type ? ({ "--oe-type-color": type.color } as CSSProperties) : undefined });
		}
		if (targets.length > 2) badges.push({ text: `+${targets.length - 2}` });
		if (f.multiple) badges.push({ text: "many" });
	}
	if (f.required) badges.push({ text: "required", cls: "is-required" });
	if (f.inModal) badges.push({ text: "in create dialog", icon: "square-pen" });
	if (card?.subtitle?.includes(f.key)) badges.push({ text: "subtitle", icon: "text" });
	return (
		<span className="oe-tm-badges">
			{badges.map((b, i) => (
				<span key={i} className={`oe-tm-badge ${b.cls ?? ""}`} style={b.style}>
					{b.icon && <Icon name={b.icon} />}
					{b.text}
				</span>
			))}
		</span>
	);
}

function FieldDetails({ index }: { index: number }) {
	const { draft, update, issuesAt, allTypes, groups, setFieldUid } = useEditor();
	const f = draft.type.fields[index];
	const meta = draft.meta[index];
	const set = (fn: (f: FieldDef) => void) => update((t) => fn(t.fields[index]));
	/** Change the key, keeping subtitle / parent references pointing at this field. */
	const setKey = (t: EntityTypeDef, key: string) => {
		const old = t.fields[index].key;
		t.fields[index].key = key;
		if (old && !t.fields.some((x, i) => i !== index && x.key === old)) renameFieldRefs(t, old, key);
	};
	const autoKey = !f.key || f.key === toKey(f.label);
	const info = KIND_INFO[f.kind];

	return (
		<div className="oe-tm-fielddetails" data-field-index={index}>
			<div className="oe-tm-details-head">
				<span className="oe-tm-kind is-large">
					<Icon name={info.icon} />
				</span>
				<div className="oe-tm-details-title">
					<div className="oe-tm-details-name">{f.label || "Untitled field"}</div>
					<div className="oe-tm-muted">{info.desc}</div>
				</div>
				<button
					className="clickable-icon"
					aria-label="Move up"
					disabled={index === 0}
					onClick={() =>
						update((t, m) => {
							t.fields.splice(index - 1, 0, ...t.fields.splice(index, 1));
							m.splice(index - 1, 0, ...m.splice(index, 1));
						})
					}
				>
					<Icon name="arrow-up" />
				</button>
				<button
					className="clickable-icon"
					aria-label="Move down"
					disabled={index === draft.type.fields.length - 1}
					onClick={() =>
						update((t, m) => {
							t.fields.splice(index + 1, 0, ...t.fields.splice(index, 1));
							m.splice(index + 1, 0, ...m.splice(index, 1));
						})
					}
				>
					<Icon name="arrow-down" />
				</button>
				<button
					className="clickable-icon oe-tm-danger"
					aria-label="Delete field"
					onClick={() => {
						update((t, m) => {
							const [gone] = t.fields.splice(index, 1);
							m.splice(index, 1);
							if (gone?.key && !t.fields.some((x) => x.key === gone.key)) renameFieldRefs(t, gone.key, null);
						});
						setFieldUid(null);
					}}
				>
					<Icon name="trash-2" />
				</button>
			</div>

			<Row label="Label" desc="Shown in the create dialog and the properties form.">
				<TextInput
					label="Field label"
					value={f.label}
					autoFocus={!f.label}
					onChange={(v) =>
						update((t) => {
							t.fields[index].label = v;
							if (autoKey) setKey(t, toKey(v));
						})
					}
				/>
			</Row>
			<Row
				label="Frontmatter key"
				desc={
					meta?.origKey && meta.origKey !== f.key ? (
						<>
							Was <code>{meta.origKey}</code>. You can update existing notes when you save.
						</>
					) : (
						"The property name in each note's frontmatter."
					)
				}
				issues={issuesAt(`field:${index}:key`)}
			>
				<TextInput label="Frontmatter key" className="oe-tm-mono" value={f.key} invalid={issuesAt(`field:${index}:key`).length > 0} onChange={(v) => update((t) => setKey(t, v.trim()))} />
			</Row>
			<Row label="Kind">
				<select
					className="dropdown"
					aria-label="Kind"
					value={f.kind}
					onChange={(e) =>
						update((t) => {
							const x = t.fields[index];
							x.kind = e.target.value as FieldKind;
							delete x.default;
							// Formats belong to a kind (a date pattern means nothing to a number).
							delete x.format;
							if (x.kind === "list") x.multiple = true;
							if (x.kind === "relation" && !x.targets) x.targets = ["*"];
							if ((x.kind === "select" || x.kind === "multiselect") && !x.options) x.options = [];
							// Relation fields can't be part of the subtitle.
							if (x.kind === "relation" && t.card?.subtitle) t.card.subtitle = t.card.subtitle.filter((k) => k !== x.key);
						})
					}
				>
					{KIND_ORDER.map((k) => (
						<option key={k} value={k}>
							{KIND_INFO[k].label}
						</option>
					))}
				</select>
			</Row>
			<Row label="Description" desc="Help text shown under the field in the create dialog.">
				<TextInput label="Description" value={f.description ?? ""} placeholder="Optional" onChange={(v) => set((x) => (v.trim() ? (x.description = v) : delete x.description))} />
			</Row>

			{formattedKind(f.kind) && <FormatRow key={`${index}:${f.kind}`} field={f} index={index} />}

			{(f.kind === "select" || f.kind === "multiselect") && (
				<Row label="Choices" desc="Type a choice and press Enter. Drag to reorder." issues={issuesAt(`field:${index}:options`)} stacked>
					<ChipsInput label="Choices" placeholder="e.g. small, medium, large" values={f.options ?? []} invalid={issuesAt(`field:${index}:options`).length > 0} onChange={(v) => set((x) => (x.options = v))} />
				</Row>
			)}

			{f.kind === "relation" && (
				<>
					<Row label="Links to" desc="Which kinds of entity this field can point at." issues={issuesAt(`field:${index}:targets`)} stacked>
						<TargetPicker values={f.targets ?? []} types={allTypes} groups={groups} invalid={issuesAt(`field:${index}:targets`).length > 0} onChange={(v) => set((x) => (x.targets = v))} />
					</Row>
					<Row label="Shown on the other note as" desc={f.symmetric ? "Optional: the link reads the same both ways." : "E.g. “Members” for a “Member of” field. Leave empty to show the field name."}>
						<TextInput label="Inverse label" value={f.inverse ?? ""} placeholder={f.symmetric ? f.label : `${f.label || "Field"} (from ${draft.type.name || "type"})`} onChange={(v) => set((x) => (x.inverse = v.trim() ? v : undefined))} />
					</Row>
					<Row label="How many links">
						<Segmented
							label="How many links"
							value={f.multiple || f.labelled ? "many" : "one"}
							disabled={f.labelled}
							options={[
								{ value: "one", label: "One" },
								{ value: "many", label: "Many" },
							]}
							onChange={(v) => set((x) => (x.multiple = v === "many"))}
						/>
					</Row>
					<Row label="Reads both ways" desc="Like partners: if A is B's partner, B is A's partner.">
						<Toggle label="Reads both ways" value={!!f.symmetric} onChange={(v) => set((x) => (x.symmetric = v || undefined))} />
					</Row>
					<Row label="Each link has its own label" desc="Like contacts: Ada — account owner, Grace — technical lead.">
						<Toggle
							label="Each link has its own label"
							value={!!f.labelled}
							onChange={(v) =>
								set((x) => {
									x.labelled = v || undefined;
									if (v) x.multiple = true;
								})
							}
						/>
					</Row>
				</>
			)}

			{f.kind !== "relation" && <DefaultRow field={f} index={index} />}

			<Row label="Show in the create dialog" desc="Otherwise it's under “Show more fields”.">
				<Toggle label="Show in the create dialog" value={!!f.inModal} onChange={(v) => set((x) => (x.inModal = v))} />
			</Row>
			<Row label="Required" desc="Must be filled in when creating a note. Notes where it's empty show a warning.">
				<Toggle label="Required" value={!!f.required} onChange={(v) => set((x) => (x.required = v || undefined))} />
			</Row>
			{issuesAt(`field:${index}:other`).length > 0 && <Issues issues={issuesAt(`field:${index}:other`)} />}
		</div>
	);
}

/** Default value for the create dialog, with a control that suits the field kind. */
function DefaultRow({ field: f, index }: { field: FieldDef; index: number }) {
	const plugin = usePlugin();
	const { update, issuesAt } = useEditor();
	const set = (v: unknown) =>
		update((t) => {
			const x = t.fields[index];
			if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete x.default;
			else x.default = v;
		});
	const issues = issuesAt(`field:${index}:default`);
	let control;
	switch (f.kind) {
		case "boolean":
			control = <Toggle label="Default" value={f.default === true} onChange={(v) => set(v || undefined)} />;
			break;
		case "select":
			control = (
				<select className="dropdown" aria-label="Default" value={typeof f.default === "string" ? f.default : ""} onChange={(e) => set(e.target.value)}>
					<option value="">None</option>
					{(f.options ?? []).map((o) => (
						<option key={o} value={o}>
							{o}
						</option>
					))}
				</select>
			);
			break;
		case "multiselect":
		case "list":
			control = (
				<ChipsInput
					label="Default"
					placeholder={f.kind === "multiselect" ? "One of the choices" : "Values"}
					values={Array.isArray(f.default) ? f.default.map(String) : []}
					invalid={issues.length > 0}
					onChange={(v) => set(v)}
				/>
			);
			break;
		case "number":
			control = <TextInput label="Default" value={f.default === undefined ? "" : String(f.default)} invalid={issues.length > 0} placeholder="None" onChange={(v) => set(v.trim() === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : v)} />;
			break;
		case "date":
			control = <DateInput label="Default" value={typeof f.default === "string" ? f.default : ""} dates={plugin.dates} invalid={issues.length > 0} onChange={(v) => set(v.trim())} />;
			break;
		default:
			control = <TextInput label="Default" value={typeof f.default === "string" ? f.default : ""} placeholder="None" onChange={(v) => set(v)} />;
	}
	return (
		<Row label="Default" desc="Prefilled when creating a note." issues={issues} stacked={f.kind === "multiselect" || f.kind === "list"}>
			{control}
		</Row>
	);
}

/** A value to show the format examples with: the sample note's, else a made-up one. */
function exampleValue(f: FieldDef, sampled: unknown): unknown {
	const has = sampled !== undefined && sampled !== null && sampled !== "";
	switch (f.kind) {
		case "number":
			return has && Number.isFinite(Number(sampled)) ? Number(sampled) : 1240.5;
		case "date":
			return has && typeof sampled === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sampled) ? sampled : new Date().toISOString().slice(0, 10);
		case "boolean":
			return true;
		case "url":
			return has ? String(sampled) : "https://www.example.com/page";
		default:
			return sampled;
	}
}

/**
 * Display format for number, date, checkbox and URL fields: presets with an example from the sample note, and a
 * custom pattern (dates, numbers) or text (URLs) with a preview. The stored value never changes.
 */
function FormatRow({ field: f, index }: { field: FieldDef; index: number }) {
	const plugin = usePlugin();
	const { update, issuesAt, sample } = useEditor();
	const env = plugin.formatEnv();
	const kind = formattedKind(f.kind)!;
	const value = exampleValue(f, sample.frontmatter[f.key]);
	const show = (format: string | undefined) => {
		try {
			return formatValue({ kind: f.kind, format }, value, env) || "—";
		} catch {
			return "—";
		}
	};
	const set = (format: string | undefined) =>
		update((t) => {
			const x = t.fields[index];
			if (format === undefined) delete x.format;
			else x.format = format;
		});
	const issues = issuesAt(`field:${index}:format`);
	const fmt = f.format;

	// The options in the dropdown: [value, text]. "" is Default; "custom" opens the pattern / text box.
	let options: [string, string][];
	let choice: string;
	switch (kind) {
		case "date":
			options = [["", `Default (${show(undefined)})`], ...datePresetLabels((p) => show(p)).map((p): [string, string] => [p.pattern, p.label]), ["custom", "Custom…"]];
			choice = fmt === undefined ? "" : FIELD_DATE_PRESETS.includes(fmt) ? fmt : "custom";
			break;
		case "number":
			options = [["", `Default (as typed: ${show(undefined)})`], ...FIELD_NUMBER_PRESETS.map((p): [string, string] => [p.format, `${p.label} (${show(p.format)})`]), ["custom", "Custom…"]];
			choice = fmt === undefined ? "" : fmt.startsWith("currency") ? "currency" : FIELD_NUMBER_PRESETS.some((p) => p.format === fmt) ? fmt : "custom";
			break;
		case "boolean":
			options = BOOLEAN_FORMATS.map((b): [string, string] => [b.format === "checkbox" ? "" : b.format, b.label]);
			choice = fmt === undefined || fmt === "checkbox" ? "" : fmt;
			break;
		case "url":
			options = [["", `Full address (${show(undefined)})`], ["domain", `Domain only (${show("domain")})`], ["custom", "Custom text…"]];
			choice = fmt === undefined || fmt === "full" ? "" : fmt === "domain" ? "domain" : "custom";
			break;
	}
	const [custom, setCustom] = useState(() => (choice === "custom" ? (kind === "url" ? (urlText(fmt) ?? "") : (fmt ?? "")) : kind === "date" ? "ddd D MMM YYYY" : kind === "url" ? "Website" : "#,##0.00"));
	const customFormat = (text: string) => (kind === "url" ? `text:${text}` : text);
	const code = fmt?.startsWith("currency:") ? fmt.slice(9) : "";

	return (
		<Row label="Display format" desc="How the value is shown. The note keeps the plain value." issues={issues} stacked={choice === "custom" || choice === "currency"}>
			<div className="oe-tm-format">
				<select
					className="dropdown"
					aria-label="Display format"
					value={choice}
					onChange={(e) => {
						const v = e.target.value;
						set(v === "" ? undefined : v === "custom" ? customFormat(custom) : v);
					}}
				>
					{options.map(([v, text]) => (
						<option key={v || "default"} value={v}>
							{text}
						</option>
					))}
				</select>
				{choice === "currency" && (
					<TextInput
						label="Currency code"
						className="oe-tm-mono oe-tm-format-code"
						value={code}
						placeholder={plugin.settings.defaultCurrency}
						invalid={issues.length > 0}
						onChange={(v) => set(v.trim() ? `currency:${v.trim().toUpperCase()}` : "currency")}
					/>
				)}
				{choice === "custom" && (
					<>
						<TextInput
							label={kind === "url" ? "Text to show" : "Custom format"}
							className={kind === "url" ? undefined : "oe-tm-mono"}
							value={custom}
							invalid={issues.length > 0}
							onChange={(v) => {
								setCustom(v);
								set(customFormat(v));
							}}
						/>
						<div className="oe-tm-muted oe-tm-format-hint">
							{kind === "date" ? (
								<>
									<code>D</code> day, <code>DD</code> 05, <code>ddd</code> Thu, <code>dddd</code> Thursday, <code>M</code> 12, <code>MMM</code> Dec, <code>MMMM</code> December, <code>YY</code> 26, <code>YYYY</code> 2026, <code>[text]</code> as written.{" "}
									<a href="https://momentjs.com/docs/#/displaying/format/" target="_blank" rel="noopener">
										All tokens
									</a>
								</>
							) : kind === "number" ? (
								<>
									<code>#</code> and <code>0</code> are digits, <code>,</code> groups thousands, <code>.00</code> sets decimals; other text is kept, e.g. <code>$#,##0</code> or <code>#,##0 h</code>.
								</>
							) : (
								"Clicking it still opens the full address."
							)}
						</div>
					</>
				)}
				{(choice === "custom" || choice === "currency") && !issues.length && <div className="oe-tm-muted oe-tm-format-preview">Preview: {show(fmt)}</div>}
			</div>
		</Row>
	);
}