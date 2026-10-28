import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { PluginContext } from "../react/context";
import { DEFAULT_BROWSER_STATE, EntityBrowser, type BrowserState } from "../react/EntityBrowser";

export const BROWSER_VIEW = "obs-entities-browser";

/** Side-pane tree of all entities. Its state (view options, filters, expansion) is saved with the workspace. */
export class BrowserView extends ItemView {
	private root: Root | null = null;
	private state: BrowserState = { ...DEFAULT_BROWSER_STATE };
	private activePath: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: EntitiesPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return BROWSER_VIEW;
	}

	getDisplayText(): string {
		return "Entity browser";
	}

	getIcon(): string {
		return "library";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("oe-browser-view");
		this.root = createRoot(this.contentEl);
		this.activePath = this.app.workspace.getActiveFile()?.path ?? null;
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) return;
				this.activePath = file.path;
				this.render();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!this.state.expanded.includes(oldPath) && this.activePath !== oldPath) return;
				if (this.activePath === oldPath) this.activePath = file.path;
				this.update({ expanded: this.state.expanded.map((p) => (p === oldPath ? file.path : p)) });
			}),
		);
		this.render();
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			this.state = { ...DEFAULT_BROWSER_STATE, ...(state as Partial<BrowserState>) };
			this.render();
		}
		await super.setState(state, result);
	}

	/** Apply filters or options from outside (e.g. a command or another view). */
	applyFilter(patch: Partial<BrowserState>): void {
		this.update(patch);
	}

	private update = (patch: Partial<BrowserState>): void => {
		this.state = { ...this.state, ...patch };
		this.render();
		this.app.workspace.requestSaveLayout();
	};

	private render(): void {
		this.root?.render(
			<PluginContext.Provider value={this.plugin}>
				<EntityBrowser state={this.state} setState={this.update} activePath={this.activePath} />
			</PluginContext.Provider>,
		);
	}
}
