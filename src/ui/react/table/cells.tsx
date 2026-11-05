import { useEffect, useRef, useState, type CSSProperties } from "react";
import { urlHref } from "../../../model/card";
import type { FieldProblem } from "../../../model/form";
import type { Edge, RelationItem } from "../../../model/relations";
import { isListValued, type FieldDef } from "../../../model/types";
import type { Cell, LinkValue, ResolvedColumn, ViewRow } from "../../../model/views";
import type { EntityRecord } from "../../../services/entityIndex";
import { usePlugin } from "../context";
import { colorClass, statusClass } from "../EntityBits";
import { choiceColor, statusColor } from "../../../model/colors";
import { EntityChip } from "../EntityChip";
import { CheckControl, ListControl, MultiControl, RelationControl, SelectControl, StatusControl, TextControl } from "../EntityForm";
import { Icon } from "../Icon";

/** The field a cell edits on this row (null when the column isn't editable for the row's type). */
export function editTarget(col: ResolvedColumn, row: Pick<ViewRow, "type">): { key: string; field?: FieldDef } | null {
	if (!col.editable || col.invalid) return null;
	if (col.def.kind === "builtin") return col.def.key === "status" || col.def.key === "tags" ? { key: col.def.key } : null;
	if (col.def.kind !== "field") return null;
	const key = col.def.key;
	const field = row.type.fields.find((f) => f.key === key);
	return field ? { key, field } : null;
}

const chipItem = (l: LinkValue, source: string): RelationItem => {
	const edge: Edge = { source, target: l.path, linktext: l.linktext, sourceType: "", fieldKey: "", fieldLabel: "", symmetric: false, labelled: !!l.label, label: l.label, related: false };
	return { path: l.path, linktext: l.linktext, direction: "out", edge };
};

/** A read-only cell, rendered like the properties form shows values. */
export function CellView({ col, cell, row, onToggle }: { col: ResolvedColumn; cell: Cell | undefined; row: ViewRow; onToggle?: (v: boolean) => void }) {
	const plugin = usePlugin();
	if (col.invalid) return <span className="oe-cell-muted" aria-label={col.invalid}>—</span>;
	if (!cell) return null;
	if (cell.error) return <span className="oe-cell-muted oe-cell-error" aria-label={cell.error}>–</span>;
	const v = cell.value;
	const d = col.def;
	if (col.kind === "links") {
		const ls = (Array.isArray(v) ? v : []) as LinkValue[];
		return (
			<span className="oe-cell-chips">
				{ls.map((l, i) => (
					<EntityChip key={`${l.path ?? l.linktext}:${i}`} item={chipItem(l, row.path)} sourcePath={row.path} />
				))}
			</span>
		);
	}
	if (col.kind === "bool") {
		if (d.kind === "formula") return <input type="checkbox" className="oe-cell-check" checked={v === true} disabled aria-label={col.label} />;
		const field = d.kind === "field" ? row.type.fields.find((f) => f.key === d.key) : undefined;
		if (!field) return null;
		// "Yes / No" and "✓" formats show as text; the checkbox format (the default) stays a checkbox.
		if (field.format === "yesno" || field.format === "check") return <span className="oe-cell-text">{cell.text}</span>;
		return <input type="checkbox" className="oe-cell-check" checked={v === true} disabled={!onToggle} aria-label={col.label} onChange={(e) => onToggle?.(e.target.checked)} onClick={(e) => e.stopPropagation()} />;
	}
	if (d.kind === "builtin" && d.key === "status") return cell.text ? <span className={`oe-status-pill ${statusClass(cell.text, statusColor(cell.text, row.type, plugin.settings.groups))}`}>{cell.text}</span> : null;
	if (d.kind === "builtin" && d.key === "type") {
		const t = row.type;
		return (
			<span className="oe-cell-type" style={{ "--oe-type-color": t.color } as CSSProperties}>
				<Icon name={t.icon} className="oe-chip-icon" />
				{t.name}
			</span>
		);
	}
	if (col.kind === "multi") {
		const tags = d.kind === "builtin" && d.key === "tags";
		// A multiple-choice field's choices can have colours (the row's own type's field).
		const field = d.kind === "field" ? row.type.fields.find((f) => f.key === d.key) : undefined;
		return (
			<span className="oe-cell-pills">
				{((v as string[]) ?? []).map((s, i) => {
					const tint = colorClass(choiceColor(field, s));
					return (
						<span key={`${s}:${i}`} className={`oe-pill${tags ? " is-tag" : ""}${tint ? ` oe-choice${tint}` : ""}`}>
							{tags ? `#${s}` : s}
						</span>
					);
				})}
			</span>
		);
	}
	if (col.kind === "choice" && d.kind === "field" && cell.text) {
		const tint = colorClass(choiceColor(row.type.fields.find((f) => f.key === d.key), cell.text));
		if (tint) return <span className={`oe-pill oe-choice${tint}`}>{cell.text}</span>;
	}
	if (d.kind === "rollup" && d.rollup.agg === "percent-done" && typeof v === "number") {
		return (
			<span className="oe-cell-progress" aria-label={`${v}% done`}>
				<span className="oe-cell-bar">
					<span style={{ width: `${v}%` }} />
				</span>
				{v}%
			</span>
		);
	}
	if (col.field?.kind === "url" && cell.text) {
		// The value is the address; the text is its display format (domain, custom text).
		const address = typeof v === "string" ? v : cell.text;
		const href = urlHref(address);
		if (href)
			return (
				<a className="external-link" href={href} target="_blank" rel="noopener" title={address !== cell.text ? address : undefined} onClick={(e) => e.stopPropagation()}>
					{cell.text}
				</a>
			);
	}
	if (col.kind === "number") return <span className="oe-cell-number">{cell.text}</span>;
	if (col.field?.kind === "date" && typeof v === "number") return <span title={plugin.dates.format(v, "long")}>{cell.text}</span>;
	return <span className="oe-cell-text">{cell.text}</span>;
}

/**
 * Edits one cell with the properties form's control for that field. Keeps its own copy of the value so several
 * quick changes (adding chips) build on each other before the index catches up.
 */
export function CellEditor({ col, entity, problems, onWrite }: { col: ResolvedColumn; entity: EntityRecord; problems: FieldProblem[]; onWrite: (key: string, value: unknown) => void }) {
	const target = editTarget(col, entity);
	const [value, setValue] = useState<unknown>(target ? entity.frontmatter[target.key] : undefined);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		window.setTimeout(() => ref.current?.querySelector<HTMLElement>("input:not([type=date]):not([tabindex='-1']), select, textarea, button")?.focus(), 0);
	}, []);
	if (!target) return null;
	const commit = (v: unknown) => {
		setValue(v);
		onWrite(target.key, v);
	};
	const f = target.field;
	const label = col.label;
	let control;
	if (!f) {
		control =
			target.key === "status" ? (
				<StatusControl type={entity.type} value={value} editable problem={problems.find((p) => p.key === "status")} onCommit={commit} />
			) : (
				<ListControl value={value} editable label="Tags" tag onCommit={commit} />
			);
	} else {
		switch (f.kind) {
			case "relation":
				control = (
					<RelationControl
						fieldKey={f.key}
						label={label}
						targets={f.targets}
						list={isListValued(f)}
						labelled={!!f.labelled}
						symmetric={!!f.symmetric}
						value={value}
						editable
						path={entity.path}
						type={entity.type}
						live
						problems={problems.filter((p) => p.key === f.key)}
						onCommit={commit}
					/>
				);
				break;
			case "boolean":
				control = <CheckControl value={value} editable label={label} onCommit={commit} />;
				break;
			case "select":
				control = <SelectControl options={f.options ?? []} value={value} editable label={label} onCommit={commit} />;
				break;
			case "multiselect":
				control = <MultiControl options={f.options ?? []} value={value} editable label={label} onCommit={commit} />;
				break;
			case "list":
				control = <ListControl value={value} editable label={label} onCommit={commit} />;
				break;
			case "rollup":
			case "formula":
				// Calculated: not editable (their columns aren't editable, so this isn't reached).
				control = null;
				break;
			default:
				control = <TextControl kind={f.kind} value={value} editable label={label} onCommit={commit} />;
		}
	}
	const issues = problems.filter((p) => p.key === target.key);
	return (
		<div ref={ref} className="oe-form oe-cell-editor is-editing">
			<div className="oe-cell-editor-head">
				<span className="oe-cell-editor-name">{entity.name}</span>
				<span className="oe-cell-editor-label">{label}</span>
			</div>
			<div className="oe-prop-value">{control}</div>
			{issues.map((p, i) => (
				<div key={i} className={`oe-cell-editor-issue is-${p.severity}`}>
					<Icon name={p.severity === "error" ? "alert-circle" : "alert-triangle"} />
					{p.message}
					{p.fix && (
						<button className="oe-prop-fix" onClick={() => commit(p.fix!.value)}>
							{p.fix.label}
						</button>
					)}
				</div>
			))}
		</div>
	);
}
