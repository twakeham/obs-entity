import { useMemo } from "react";
import { emptyFormValues } from "../../../model/defaults";
import { todayDays } from "../../../model/formConditions";
import { usePlugin } from "../context";
import { CreateForm } from "../CreateForm";
import { Icon } from "../Icon";
import { useEditor, type EditorApi } from "../types/editor";

/** What the Workflows view shows in the side panel: the open form workflow's form (null: none open). */
export interface FormPreviewSource {
	api: EditorApi | null;
	/** the form's title, send button and icon */
	form?: { title: string; button: string; icon: string };
}

/** A form workflow's form as it opens (the real dialog, with its defaults; nothing runs), for the side panel. */
export function FormPreviewPane({ form }: { form: NonNullable<FormPreviewSource["form"]> }) {
	const plugin = usePlugin();
	const { draft, groups } = useEditor();
	const t = draft.type;
	const initial = useMemo(() => emptyFormValues(t, groups, "", { today: todayDays(), dates: plugin.dates }), [t, groups, plugin]);
	return (
		<div className="oe-panel oe-preview-pane">
			<div className="oe-panel-header">
				<Icon name={form.icon} className="oe-type-icon oe-type-icon-lg" />
				<div className="oe-panel-title">
					<div className="oe-panel-name">{form.title}</div>
					<div className="oe-panel-meta">Preview of the form · its default answers</div>
				</div>
			</div>
			<div className="oe-preview-body" data-mode="dialog">
				<div className="oe-tm-mockmodal">
					{/* Remount when the form changes, so the preview starts from its defaults. */}
					<CreateForm key={JSON.stringify(t)} type={t} initial={initial} preview workflowForm={form} />
					<div className="oe-tm-muted oe-tm-card-note">Preview only: nothing runs. Try it… (the flask) shows what the steps would do with these answers.</div>
				</div>
			</div>
		</div>
	);
}
