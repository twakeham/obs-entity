import { useMemo, type CSSProperties } from "react";
import { subtitleOf } from "../../../model/card";
import { emptyFormValues } from "../../../services/entityFactory";
import { usePlugin } from "../context";
import { CreateForm } from "../CreateForm";
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

/** The create dialog as it shows for this type (the real one, with nothing created). */
function DialogPreview() {
	const { draft, groups } = useEditor();
	const t = draft.type;
	const initial = useMemo(() => emptyFormValues(t, groups), [t, groups]);
	return (
		<div className="oe-tm-mockmodal">
			{/* Remount when the draft changes, so the preview starts from the type's defaults. */}
			<CreateForm key={JSON.stringify(t)} type={t} initial={initial} preview />
			<div className="oe-tm-muted oe-tm-card-note">Preview only: nothing is created. Fields not in the dialog are under “Show more fields”.</div>
		</div>
	);
}
