import { ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { parseView, serializeView, type ViewDef } from "../../model/views";
import { PluginContext } from "../react/context";
import { EntityTable } from "../react/table/EntityTable";

export const DRILL_VIEW = "obs-entities-drill";

/**
 * The notes behind a dashboard card, bar or slice, as a table in a tab of its own (DESIGN §8.12). It isn't a note: its
 * definition and notes live in the tab's state, and ⋯ → Save as… keeps it as a view.
 */
export class DrillView extends ItemView {
	private root: Root | null = null;
	private title = "Notes";
	private def: ViewDef | null = null;
	private generation = 0;
	/** this tab's table state (search, scroll), kept per tab */
	private stateId = Math.random().toString(36).slice(2);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: EntitiesPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return DRILL_VIEW;
	}

	getDisplayText(): string {
		return this.title;
	}

	getIcon(): string {
		return "table";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("oe-entity-view-tab", "oe-drill-tab");
		this.render();
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	getState(): Record<string, unknown> {
		return { title: this.title, def: this.def ? serializeView(this.def) : null, only: this.def?.only ?? [] };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as { title?: unknown; def?: unknown; only?: unknown };
		if (typeof s.title === "string") this.title = s.title;
		const parsed = s.def ? parseView(s.def).def : null;
		if (parsed) this.def = { ...parsed, only: Array.isArray(s.only) ? s.only.filter((p): p is string => typeof p === "string") : [] };
		(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
		this.containerEl.querySelector(".view-header-title")?.setText(this.title);
		this.render();
		await super.setState(state, result);
	}

	private render(): void {
		this.root?.unmount();
		this.contentEl.empty();
		if (!this.def) return;
		const n = this.def.only?.length ?? 0;
		const bar = this.contentEl.createDiv({ cls: "oe-drill-bar" });
		bar.createSpan({ text: `${n} note${n === 1 ? "" : "s"} from a dashboard: ${this.title}` });
		bar.createSpan({ cls: "oe-drill-hint", text: "Not saved as a view: ⋯ → Save as… keeps it." });
		const host = this.contentEl.createDiv({ cls: "oe-drill-table" });
		this.root = createRoot(host);
		this.root.render(
			<PluginContext.Provider value={this.plugin}>
				<EntityTable
					key={++this.generation}
					initial={this.def}
					warnings={[]}
					sourcePath=""
					stateKey={`drill#${this.stateId}`}
					save={async (d) => {
						this.def = { ...d, only: this.def?.only };
						this.app.workspace.requestSaveLayout();
					}}
					editDefinition={() => new Notice("This table isn't a note: use ⋯ → Save as… to keep it as a view.")}
					fill
				/>
			</PluginContext.Provider>,
		);
	}
}
