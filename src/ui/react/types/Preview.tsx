import { type CSSProperties, type ReactNode } from "react";
import { subtitleOf } from "../../../model/card";
import { statusesFor, type FieldDef } from "../../../model/types";
import { usePlugin } from "../context";
import { FormPreview } from "../EntityForm";
import { Icon } from "../Icon";
import { Segmented } from "./controls";
import { useEditor } from "./editor";

export type PreviewMode = "dialog" | "picker" | "form";

export function PreviewPanel({ open, setOpen, mode, setMode }: { open: boolean; setOpen: (v: boolean) => void; mode: PreviewMode; setMode: (m: PreviewMode) => void }) {
	const { sample } = useEditor();
	return (
		<div className={`oe-tm-preview${open ? " is-open" : ""}`}>
			<div className="oe-tm-preview-head">
				<button className="oe-tm-preview-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
					<Icon name={open ? "chevron-down" : "chevron-up"} />
					Preview
				</button>
				{open && (
					<>
						<Segmented
							label="Preview"
							value={mode}
							onChange={setMode}
							options={[
								{ value: "dialog", label: "Create dialog", icon: "square-pen" },
								{ value: "picker", label: "Picker row", icon: "search" },
								{ value: "form", label: "Properties form", icon: "panel-top" },
							]}
						/>
						<span className="oe-tm-muted oe-tm-preview-source">{sample.fromNote ? <>Using “{sample.name}”</> : "Using made-up values"}</span>
					</>
				)}
			</div>
			{open && (
				<div className="oe-tm-preview-body">
					{mode === "dialog" && <DialogPreview />}
					{mode === "picker" && <PickerPreview />}
					{mode === "form" && <FormPreviewPane />}
				</div>
			)}
		</div>
	);
}

/** The sample's subtitle, using the draft type. */
function useSubtitle(): string | null {
	const plugin = usePlugin();
	const { draft, sample } = useEditor();
	return subtitleOf(draft.type, sample.frontmatter, plugin.dates);
}

/** How a note of this type looks in link pickers and Find entity. */
function PickerPreview() {
	const { draft, sample } = useEditor();
	const t = draft.type;
	const subtitle = useSubtitle();
	return (
		<div className="oe-tm-mockpicker">
			<div className="suggestion-item is-selected oe-suggestion">
				<span className="oe-type-icon" style={{ "--oe-type-color": t.color } as CSSProperties}>
					<Icon name={t.icon} />
				</span>
				<div className="oe-suggestion-main">
					<div className="oe-suggestion-title">{sample.name}</div>
					{subtitle ? <div className="oe-suggestion-note">{subtitle}</div> : <div className="oe-suggestion-note oe-suggestion-folder">Folder path (no subtitle fields)</div>}
				</div>
				<span className="oe-suggestion-type">{t.name || "Type"}</span>
			</div>
			<div className="oe-tm-muted oe-tm-card-note">Subtitle fields are set on the Display tab.</div>
		</div>
	);
}

/** The properties form as it shows on a note of this type (read-only, with sample values). */
function FormPreviewPane() {
	const { draft, sample } = useEditor();
	return (
		<div className="oe-tm-formpreview">
			<FormPreview type={draft.type} fm={{ ...sample.frontmatter, status: sample.status }} path={sample.path ?? `__sample__/${sample.name}.md`} />
		</div>
	);
}

function MockRow({ name, desc, children }: { name: ReactNode; desc?: string; children: ReactNode }) {
	return (
		<div className="setting-item">
			<div className="setting-item-info">
				<div className="setting-item-name">{name}</div>
				{desc && <div className="setting-item-description">{desc}</div>}
			</div>
			<div className="setting-item-control">{children}</div>
		</div>
	);
}

function DialogPreview() {
	const plugin = usePlugin();
	const { draft, groups } = useEditor();
	const t = draft.type;
	const subtitle = new Set(t.card?.subtitle ?? []);
	const visible = t.fields.filter((f) => f.inModal || f.required || subtitle.has(f.key));
	const hidden = t.fields.length - visible.length;
	const control = (f: FieldDef) => {
		switch (f.kind) {
			case "textarea":
				return <textarea disabled rows={2} />;
			case "select":
				return (
					<select className="dropdown" disabled>
						<option>{typeof f.default === "string" ? f.default : "—"}</option>
					</select>
				);
			case "multiselect":
				return (
					<span className="oe-multiselect">
						{(f.options ?? []).slice(0, 4).map((o) => (
							<button key={o} className="oe-option" disabled>
								{o}
							</button>
						))}
					</span>
				);
			case "boolean":
				return (
					<div className="checkbox-container">
						<input type="checkbox" disabled />
					</div>
				);
			case "relation":
				return (
					<span className="oe-tm-mockrel">
						<Icon name="search" /> {f.multiple || f.labelled ? "Add links…" : "Choose…"}
					</span>
				);
			case "date":
				return <input type="text" disabled placeholder={plugin.dates.placeholder} />;
			case "url":
				return <input type="text" disabled placeholder="https://…" />;
			case "number":
				return <input type="number" disabled />;
			default:
				return <input type="text" disabled />;
		}
	};
	return (
		<div className="oe-tm-mockmodal">
			<div className="oe-modal-header">
				<span className="oe-type-icon oe-type-icon-lg" style={{ "--oe-type-color": t.color } as CSSProperties}>
					<Icon name={t.icon} />
				</span>
				<h2>New {(t.name || "entity").toLowerCase()}</h2>
			</div>
			<MockRow name="Name">
				<input type="text" disabled placeholder={`${t.name || "Entity"} name`} />
			</MockRow>
			<MockRow name="Status">
				<select className="dropdown" disabled>
					<option>{statusesFor(t, groups)[0]}</option>
				</select>
			</MockRow>
			{visible.map((f) => (
				<MockRow
					key={f.key}
					name={
						<>
							{f.label || f.key}
							{f.required && <span className="oe-tm-required"> *</span>}
						</>
					}
					desc={f.description}
				>
					{control(f)}
				</MockRow>
			))}
			{hidden > 0 && (
				<div className="oe-more-fields">
					<a>
						Show {hidden} more field{hidden === 1 ? "" : "s"}
					</a>
				</div>
			)}
			<MockRow name="Tags" desc="Comma-separated.">
				<input type="text" disabled />
			</MockRow>
			<div className="oe-tm-muted oe-tm-card-note">Preview only. Fields not in the dialog are under “Show more fields”.</div>
		</div>
	);
}
