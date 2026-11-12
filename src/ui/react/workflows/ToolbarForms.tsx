import { Menu } from "obsidian";
import { useEffect, useState } from "react";
import { buttonIcon, buttonLabel, formsFor, type WorkflowDef } from "../../../model/workflows";
import { usePlugin } from "../context";
import { Icon } from "../Icon";

/** The forms to offer on views' toolbars (on, starting on their own, set to show there), kept up to date as workflows change. */
function useToolbarForms(): WorkflowDef[] {
	const plugin = usePlugin();
	const list = () => formsFor(plugin.settings.workflows, "toolbar");
	const keyOf = (ws: WorkflowDef[]) => ws.map((w) => `${w.id}|${buttonIcon(w)}|${buttonLabel(w)}`).join("\n");
	const [key, setKey] = useState(() => keyOf(list()));
	useEffect(() => {
		// Saving, switching on or off and deleting workflows all end in one of these.
		const check = () => setKey(keyOf(list()));
		const refs = [plugin.workflows.on("drafts", check), plugin.workflows.on("log", check)];
		return () => refs.forEach((r) => plugin.workflows.offref(r));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [plugin]);
	void key;
	return list();
}

/**
 * A view toolbar's forms: one form is a button with its icon and title; several are a Forms button with a menu. Each
 * opens its form (Fill in a form). Nothing when no form is set to show on toolbars.
 */
export function ToolbarForms() {
	const plugin = usePlugin();
	const forms = useToolbarForms();
	if (!forms.length) return null;
	if (forms.length === 1) {
		const wf = forms[0];
		return (
			<button className="oe-view-tool oe-view-form" aria-label={`${buttonLabel(wf)} (fill in the form)`} onClick={() => void plugin.runWorkflow(wf, [])}>
				<Icon name={buttonIcon(wf)} />
				<span className="oe-view-tool-label">{buttonLabel(wf)}</span>
			</button>
		);
	}
	return (
		<button
			className="oe-view-tool oe-view-form"
			aria-label="Forms"
			onClick={(e) => {
				const m = new Menu();
				for (const wf of forms) m.addItem((i) => i.setTitle(buttonLabel(wf)).setIcon(buttonIcon(wf)).onClick(() => void plugin.runWorkflow(wf, [])));
				const r = e.currentTarget.getBoundingClientRect();
				m.showAtPosition({ x: r.left, y: r.bottom + 4 });
			}}
		>
			<Icon name="clipboard-list" />
			<span className="oe-view-tool-label">Forms</span>
			<span className="oe-view-tool-count">{forms.length}</span>
		</button>
	);
}
