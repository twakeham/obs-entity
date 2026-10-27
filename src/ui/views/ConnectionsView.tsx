import { ItemView, TFile, type WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { ConnectionsPanel } from "../react/ConnectionsPanel";
import { PluginContext } from "../react/context";

export const CONNECTIONS_VIEW = "obs-entities-connections";

/** Side-pane view showing the active note's relationships. Follows the active note. */
export class ConnectionsView extends ItemView {
	private root: Root | null = null;
	private path: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: EntitiesPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return CONNECTIONS_VIEW;
	}

	getDisplayText(): string {
		return "Connections";
	}

	getIcon(): string {
		return "waypoints";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("oe-connections-view");
		this.root = createRoot(this.contentEl);
		this.registerEvent(this.app.workspace.on("file-open", (file) => file && this.setPath(file.path)));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (oldPath === this.path) this.setPath(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file.path === this.path) this.setPath(null);
			}),
		);
		this.setPath(this.app.workspace.getActiveFile()?.path ?? null, true);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	/** Follow a note; non-Markdown files (images, PDFs, canvases) are ignored. */
	private setPath(path: string | null, force = false): void {
		if (!force && path === this.path) return;
		const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
		if (path && !(file instanceof TFile && file.extension === "md")) return;
		this.path = path;
		this.render();
	}

	private render(): void {
		this.root?.render(
			<StrictMode>
				<PluginContext.Provider value={this.plugin}>
					<ConnectionsPanel path={this.path} />
				</PluginContext.Provider>
			</StrictMode>,
		);
	}
}
