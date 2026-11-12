import { Menu } from "obsidian";
import { useEffect, useState } from "react";
import { buttonIcon, buttonLabel, toolbarTarget, viewWorkflows, type WorkflowDef } from "../../../model/workflows";
import type { EntityRecord } from "../../../services/entityIndex";
import { usePlugin } from "../context";
import { Icon } from "../Icon";

/** The workflows a view offers (its Views tab picks), kept up to date as workflows are saved, switched on or off and deleted. */
function useViewWorkflows(viewPath: string): WorkflowDef[] {
	const plugin = usePlugin();
	const list = () => viewWorkflows(plugin.settings.workflows, viewPath);
	const keyOf = (ws: WorkflowDef[]) => ws.map((w) => `${w.id}|${buttonIcon(w)}|${buttonLabel(w)}|${w.scope.join(",")}`).join("\n");
	const [, setKey] = useState(() => keyOf(list()));
	useEffect(() => {
		const check = () => setKey(keyOf(list()));
		const refs = [plugin.workflows.on("drafts", check), plugin.workflows.on("log", check)];
		check();
		return () => refs.forEach((r) => plugin.workflows.offref(r));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [plugin, viewPath]);
	return list();
}

interface Props {
	/** the view note's path */
	viewPath: string;
	/** the view's selected notes (buttons on notes run on those they apply to) */
	selected: EntityRecord[];
}

/** Run a workflow from a view: a form that starts on its own opens its form; others run on the selected notes they apply to. */
function run(plugin: ReturnType<typeof usePlugin>, wf: WorkflowDef, selected: EntityRecord[]): void {
	const t = toolbarTarget(wf, selected);
	if (t.why) return;
	void plugin.runWorkflow(wf, t.paths);
}

/** The view's workflows as a **Workflows** menu button in the toolbar (when the view doesn't show the workflow toolbar). */
export function ViewWorkflowsMenu({ viewPath, selected }: Props) {
	const plugin = usePlugin();
	const list = useViewWorkflows(viewPath);
	if (!list.length) return null;
	return (
		<button
			className="oe-view-tool oe-view-workflows"
			aria-label="Workflows"
			onClick={(e) => {
				const m = new Menu();
				for (const wf of list) {
					const t = toolbarTarget(wf, selected);
					m.addItem((i) => {
						i.setTitle(t.why ? `${buttonLabel(wf)} (${t.why.toLowerCase()})` : buttonLabel(wf))
							.setIcon(buttonIcon(wf))
							.onClick(() => run(plugin, wf, selected));
						if (t.why) i.setDisabled(true);
					});
				}
				const r = e.currentTarget.getBoundingClientRect();
				m.showAtPosition({ x: r.left, y: r.bottom + 4 });
			}}
		>
			<Icon name="zap" />
			<span className="oe-view-tool-label">Workflows</span>
			<span className="oe-view-tool-count">{list.length}</span>
		</button>
	);
}

/** The view's workflows as a row of buttons under the toolbar (the view's ⋯ → Show workflow toolbar). */
export function ViewWorkflowsBar({ viewPath, selected }: Props) {
	const plugin = usePlugin();
	const list = useViewWorkflows(viewPath);
	if (!list.length) return null;
	return (
		<div className="oe-view-workflowbar" role="toolbar" aria-label="Workflows">
			{list.map((wf) => {
				const t = toolbarTarget(wf, selected);
				return (
					<button key={wf.id} className="oe-view-tool" disabled={!!t.why} title={t.why ?? (t.paths.length ? `Run on ${t.paths.length === 1 ? "the selected note" : `the ${t.paths.length} selected notes`}` : "Fill in the form")} onClick={() => run(plugin, wf, selected)}>
						<Icon name={buttonIcon(wf)} />
						<span className="oe-view-tool-label">{buttonLabel(wf)}</span>
					</button>
				);
			})}
		</div>
	);
}
