import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { PluginContext } from "../react/context";
import { DEFAULT_WORKFLOWS_STATE, WorkflowManager, type WorkflowsRequest, type WorkflowsState } from "../react/workflows/WorkflowManager";

export const WORKFLOWS_VIEW = "obs-entities-workflows";

/** The Workflows view (DESIGN §8.11): the list of workflows and the editor. State is saved with the workspace layout. */
export class WorkflowsView extends ItemView {
	private root: Root | null = null;
	state: WorkflowsState = { ...DEFAULT_WORKFLOWS_STATE };
	private request: WorkflowsRequest | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: EntitiesPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return WORKFLOWS_VIEW;
	}

	getDisplayText(): string {
		return "Workflows";
	}

	getIcon(): string {
		return "zap";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("oe-types-view", "oe-workflows-view");
		this.root = createRoot(this.contentEl);
		this.render();
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	getState(): Record<string, unknown> {
		// Unsaved new workflows don't survive a restart; don't restore a selection pointing at one.
		return { selected: this.state.selected?.startsWith("new:") ? null : this.state.selected };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			this.state = { ...DEFAULT_WORKFLOWS_STATE, ...this.state, ...(state as Partial<WorkflowsState>) };
			this.render();
		}
		await super.setState(state, result);
	}

	update = (patch: Partial<WorkflowsState>): void => {
		this.state = { ...this.state, ...patch };
		this.render();
		this.app.workspace.requestSaveLayout();
	};

	/** Show a workflow, or start a new one for a type. (Not `open`: that's View's own.) */
	showRequest(request: WorkflowsRequest): void {
		this.request = request;
		this.render();
	}

	private render(): void {
		this.root?.render(
			<PluginContext.Provider value={this.plugin}>
				<WorkflowManager state={this.state} setState={this.update} request={this.request} onRequestDone={() => (this.request = null)} />
			</PluginContext.Provider>,
		);
	}
}
