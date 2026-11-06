import { inScope, triggerText, workflowProblems, type WorkflowDef } from "../../../model/workflows";
import { usePlugin } from "../context";
import { Icon } from "../Icon";
import { Section } from "./controls";
import { useEditor } from "./editor";

/** The type editor's Workflows tab (DESIGN §8.11): the workflows that run on this type, opened in the Workflows view. */
export function WorkflowsTab() {
	const plugin = usePlugin();
	const { draft, allTypes, groups } = useEditor();
	const t = draft.type;
	const saved = plugin.settings.types.some((x) => x.key === t.key);
	const all = plugin.settings.workflows;
	const own = all.filter((w) => w.scope.length && inScope(w, t));
	const anyNote = all.filter((w) => !w.scope.length);
	const name = t.plural || t.name || "this type";

	const list = (items: WorkflowDef[], empty: string) =>
		items.length === 0 ? (
			<div className="oe-tm-empty">{empty}</div>
		) : (
			<div className="oe-tm-rellist">
				{items.map((w) => {
					const problems = workflowProblems(w, { types: allTypes, groups });
					return (
						<button key={w.id} className={`oe-tm-relrow oe-wf-typerow${w.on ? "" : " is-off"}`} data-workflow={w.id} onClick={() => void plugin.activateWorkflows({ open: w.id })}>
							<span className={`oe-wf-dot${w.on && !plugin.settings.workflowsPaused ? " is-on" : ""}`} aria-label={w.on ? "On" : "Off"} />
							<span className="oe-tm-relname">{w.name}</span>
							<span className="oe-tm-relnote">{triggerText(w, allTypes)}</span>
							{problems.length > 0 && <span title={`${problems.length} problems`}><Icon name="alert-triangle" className="oe-wf-item-warn" /></span>}
							<Icon name="arrow-up-right" className="oe-tm-muted" />
						</button>
					);
				})}
			</div>
		);

	return (
		<div className="oe-tm-workflows">
			<Section
				title={`Workflows for ${name}`}
				desc="Steps that run when one of these notes is created or a field changes, or from a button. They're edited in the Workflows view."
				actions={
					<button className="mod-cta" disabled={!saved} onClick={() => void plugin.activateWorkflows({ newFor: t.key })}>
						<Icon name="plus" /> New workflow for this type
					</button>
				}
			>
				{!saved && <div className="oe-tm-empty">Save the type first to add workflows to it.</div>}
				{list(own, "No workflows yet.")}
			</Section>
			{anyNote.length > 0 && <Section title="Also runs on every note">{list(anyNote, "")}</Section>}
		</div>
	);
}
