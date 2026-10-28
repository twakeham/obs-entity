import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { PluginContext } from "../react/context";
import { DEFAULT_TYPES_STATE, TypeManager, type TypesState } from "../react/types/TypeManager";

export const TYPES_VIEW = "obs-entities-types";

/** Entity type manager: list of types + tabbed editor. State is saved with the workspace layout. */
export class TypesView extends ItemView {
	private root: Root | null = null;
	state: TypesState = { ...DEFAULT_TYPES_STATE };

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: EntitiesPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TYPES_VIEW;
	}

	getDisplayText(): string {
		return "Entity types";
	}

	getIcon(): string {
		return "shapes";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("oe-types-view");
		this.root = createRoot(this.contentEl);
		this.render();
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	getState(): Record<string, unknown> {
		const { selected, ...rest } = this.state;
		// Unsaved new types and groups don't survive a restart; don't restore a selection pointing at one.
		return { ...rest, selected: selected?.includes("new:") ? null : selected };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			this.state = { ...DEFAULT_TYPES_STATE, ...this.state, ...(state as Partial<TypesState>) };
			this.render();
		}
		await super.setState(state, result);
	}

	update = (patch: Partial<TypesState>): void => {
		this.state = { ...this.state, ...patch };
		this.render();
		this.app.workspace.requestSaveLayout();
	};

	private render(): void {
		this.root?.render(
			<PluginContext.Provider value={this.plugin}>
				<TypeManager state={this.state} setState={this.update} />
			</PluginContext.Provider>,
		);
	}
}
