import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import type { FieldDef } from "../../model/types";
import { PluginContext } from "../react/context";
import { DEFAULT_TYPES_STATE, TypeManager, type PendingField, type PreviewSource, type TypesState } from "../react/types/TypeManager";

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
		// Obsidian's status bar floats over the bottom-right of the window; keep the save bar's buttons clear of it.
		const clear = () => this.clearStatusBar();
		const { workspace } = this.app;
		this.registerEvent(workspace.on("resize", clear));
		this.registerEvent(workspace.on("layout-change", clear));
		this.registerEvent(workspace.on("active-leaf-change", clear));
		const bar = this.contentEl.ownerDocument.querySelector<HTMLElement>(".status-bar");
		if (bar) {
			const ro = new ResizeObserver(clear);
			ro.observe(bar);
			ro.observe(this.contentEl);
			this.register(() => ro.disconnect());
		}
		workspace.onLayoutReady(clear);
	}

	onResize(): void {
		this.clearStatusBar();
	}

	/** Set `--oe-statusbar-clear` to how far the status bar reaches up into this view (0 when it doesn't overlap). */
	private clearStatusBar(): void {
		const el = this.contentEl;
		const bar = el.ownerDocument.querySelector<HTMLElement>(".status-bar");
		const b = bar?.getBoundingClientRect();
		const v = el.getBoundingClientRect();
		const overlap = b && b.width > 0 && b.height > 0 && b.left < v.right && b.right > v.left && b.top < v.bottom && b.bottom > v.top ? Math.ceil(v.bottom - b.top) : 0;
		el.style.setProperty("--oe-statusbar-clear", `${overlap}px`);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
		this.publish({ api: null, group: false });
	}

	/** The selected type as edited, for the side panel's preview. */
	preview: PreviewSource = { api: null, group: false };
	private watchers = new Set<() => void>();

	/** Follow `preview`; returns the function to stop. */
	onPreview(fn: () => void): () => void {
		this.watchers.add(fn);
		return () => this.watchers.delete(fn);
	}

	private publish = (source: PreviewSource): void => {
		this.preview = source;
		for (const fn of this.watchers) fn();
	};

	getState(): Record<string, unknown> {
		const { selected, ...rest } = this.state;
		// Unsaved new types and groups don't survive a restart; don't restore a selection pointing at one.
		return { ...rest, selected: selected?.includes("new:") ? null : selected };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object") {
			const { selected, tab } = { ...DEFAULT_TYPES_STATE, ...this.state, ...(state as Partial<TypesState>) };
			this.state = { selected, tab };
			this.render();
		}
		await super.setState(state, result);
	}

	update = (patch: Partial<TypesState>): void => {
		this.state = { ...this.state, ...patch };
		this.render();
		this.app.workspace.requestSaveLayout();
	};

	private pending: PendingField | null = null;

	/** Open a type on its Fields tab with `field` added to its draft (or selected, if the type has it). */
	addField(typeKey: string, field: FieldDef): void {
		this.pending = { typeKey, field };
		this.render();
	}

	private render(): void {
		this.root?.render(
			<PluginContext.Provider value={this.plugin}>
				<TypeManager state={this.state} setState={this.update} pendingField={this.pending} onPendingDone={() => (this.pending = null)} onPreview={this.publish} />
			</PluginContext.Provider>,
		);
	}
}
