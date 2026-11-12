import { ItemView, MarkdownView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { ConnectionsPanel } from "../react/ConnectionsPanel";
import { PluginContext } from "../react/context";
import { EditorContext } from "../react/types/editor";
import { PreviewPane, type PreviewMode } from "../react/types/Preview";
import { TypesView } from "./TypesView";
import { WorkflowsView } from "./WorkflowsView";
import { FormPreviewPane } from "../react/workflows/FormPreview";

/** The id is the old Connections panel's, so a Connections tab saved in the workspace opens as this panel. */
export const SIDE_PANEL_VIEW = "obs-entities-connections";

const PREVIEW_MODES: PreviewMode[] = ["dialog", "picker", "form"];

/** What the panel shows, from the last active tab in the main area. */
type Target = { kind: "note"; path: string | null } | { kind: "types"; view: TypesView } | { kind: "workflows"; view: WorkflowsView } | { kind: "none" };

/**
 * The plugin's one right-sidebar panel. It follows the last active tab in the main area (focusing the sidebar
 * doesn't change it): a note shows its connections, the Entity types editor shows the selected type's preview, the
 * Workflows view the open form workflow's form.
 */
export class SidePanelView extends ItemView {
	private root: Root | null = null;
	private target: Target = { kind: "none" };
	/** the main-area tab being followed */
	private followed: WorkspaceLeaf | null = null;
	private unwatch: (() => void) | null = null;
	private previewMode: PreviewMode = "dialog";

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: EntitiesPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return SIDE_PANEL_VIEW;
	}

	getDisplayText(): string {
		return this.target.kind === "types" || this.target.kind === "workflows" ? "Preview" : this.target.kind === "note" ? "Connections" : "Entities";
	}

	getIcon(): string {
		return this.target.kind === "types" || this.target.kind === "workflows" ? "eye" : "waypoints";
	}

	getState(): Record<string, unknown> {
		return { previewMode: this.previewMode };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const mode = state && typeof state === "object" ? (state as { previewMode?: unknown }).previewMode : undefined;
		// The info card preview became the properties form preview.
		const m = mode === "card" ? "form" : mode;
		if (PREVIEW_MODES.includes(m as PreviewMode)) {
			this.previewMode = m as PreviewMode;
			this.render();
		}
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("oe-connections-view", "oe-side-panel");
		this.root = createRoot(this.contentEl);
		const { workspace, vault } = this.app;
		this.registerEvent(workspace.on("active-leaf-change", (leaf) => leaf && this.follow(leaf)));
		// The followed tab opened another note, or a tab closed.
		this.registerEvent(workspace.on("file-open", () => this.follow(this.followed)));
		this.registerEvent(workspace.on("layout-change", () => this.follow(this.followed && this.isOpen(this.followed) ? this.followed : null)));
		this.registerEvent(vault.on("rename", () => this.follow(this.followed)));
		this.registerEvent(vault.on("delete", () => this.follow(this.followed)));
		workspace.onLayoutReady(() => this.follow(null));
		this.follow(null);
	}

	async onClose(): Promise<void> {
		this.unwatch?.();
		this.unwatch = null;
		this.root?.unmount();
		this.root = null;
	}

	private inSidebar(leaf: WorkspaceLeaf): boolean {
		const root = leaf.getRoot();
		return root === this.app.workspace.leftSplit || root === this.app.workspace.rightSplit;
	}

	private isOpen(leaf: WorkspaceLeaf): boolean {
		let open = false;
		this.app.workspace.iterateAllLeaves((l) => {
			if (l === leaf) open = true;
		});
		return open;
	}

	/** Follow a main-area tab (null: the most recent one). Sidebar tabs are ignored. */
	private follow(leaf: WorkspaceLeaf | null): void {
		if (leaf && this.inSidebar(leaf)) return;
		const tab = leaf ?? this.app.workspace.getMostRecentLeaf();
		this.followed = tab && !this.inSidebar(tab) ? tab : null;
		const view = this.followed?.view;
		const next: Target =
			view instanceof TypesView
				? { kind: "types", view }
				: view instanceof WorkflowsView
					? { kind: "workflows", view }
					: view instanceof MarkdownView
						? { kind: "note", path: view.file?.path ?? null }
						: !view || view.getViewType() === "empty"
							? { kind: "note", path: null }
							: { kind: "none" };
		const prev = this.target;
		// The editor view being followed (its preview), if any.
		const source = (x: Target) => (x.kind === "types" || x.kind === "workflows" ? x.view : null);
		const prevSource = source(prev);
		const nextSource = source(next);
		if (prevSource !== nextSource) {
			this.unwatch?.();
			this.unwatch = nextSource ? nextSource.onPreview(() => this.render()) : null;
		}
		const same = prev.kind === next.kind && (prev.kind !== "note" || prev.path === (next as { path: string | null }).path) && prevSource === nextSource;
		this.target = next;
		if (same) return;
		if (prev.kind !== next.kind) (this.leaf as unknown as { updateHeader?(): void }).updateHeader?.();
		this.render();
	}

	private setPreviewMode = (m: PreviewMode): void => {
		this.previewMode = m;
		this.render();
		this.app.workspace.requestSaveLayout();
	};

	private render(): void {
		const t = this.target;
		let body;
		if (t.kind === "note") {
			body = (
				<StrictMode>
					<ConnectionsPanel path={t.path} />
				</StrictMode>
			);
		} else if (t.kind === "types") {
			const { api, group } = t.view.preview;
			body = api ? (
				<EditorContext.Provider value={api}>
					<PreviewPane mode={this.previewMode} setMode={this.setPreviewMode} />
				</EditorContext.Provider>
			) : (
				<div className="oe-panel-empty">{group ? "A group is selected. Select a type to preview it." : "Select a type to preview it."}</div>
			);
		} else if (t.kind === "workflows") {
			const { api, form } = t.view.preview;
			body =
				api && form ? (
					<EditorContext.Provider value={api}>
						<FormPreviewPane form={form} />
					</EditorContext.Provider>
				) : (
					<div className="oe-panel-empty">Open a form workflow (Fill in a form) to preview its form here.</div>
				);
		} else {
			body = <div className="oe-panel-empty">Nothing to show here. Open a note to see its connections, or the Entity types editor to preview a type.</div>;
		}
		this.root?.render(<PluginContext.Provider value={this.plugin}>{body}</PluginContext.Provider>);
	}
}