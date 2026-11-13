import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import type { FieldDef } from "../../model/types";
import type { InferredType } from "../../model/inferType";
import { PluginContext } from "../react/context";
import { DEFAULT_TYPES_STATE, TypeManager, type PendingField, type PreviewSource, type TypesRequest, type TypesState } from "../react/types/TypeManager";

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
		this.publish({ api: null, group: false });
		// The Entity Browser stops marking the type that was open.
		this.plugin.typeEvents.trigger("drafts");
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
		// The Entity Browser marks the open type.
		this.plugin.typeEvents.trigger("drafts");
	};

	private pending: PendingField | null = null;
	private pendingType: InferredType | null = null;
	private request: TypesRequest | null = null;

	/** Do something asked from the Entity Browser: a new type or group, a copy of a type, an import. */
	showRequest(request: TypesRequest): void {
		this.request = request;
		this.render();
	}

	/** Open a type worked out from notes as a new draft (on its Fields tab). */
	newType(inferred: InferredType): void {
		this.pendingType = inferred;
		this.render();
	}

	/** Start the editor afresh (its drafts were dropped). */
	remount(): void {
		this.root?.unmount();
		this.root = createRoot(this.contentEl);
		this.render();
	}

	/** Open a type on its Fields tab with `field` added to its draft (or selected, if the type has it). */
	addField(typeKey: string, field: FieldDef): void {
		this.pending = { typeKey, field };
		this.render();
	}

	private render(): void {
		this.root?.render(
			<PluginContext.Provider value={this.plugin}>
				<TypeManager
					state={this.state}
					setState={this.update}
					pendingField={this.pending}
					onPendingDone={() => (this.pending = null)}
					pendingType={this.pendingType}
					onPendingTypeDone={() => (this.pendingType = null)}
					request={this.request}
					onRequestDone={() => (this.request = null)}
					onPreview={this.publish}
				/>
			</PluginContext.Provider>,
		);
	}
}
