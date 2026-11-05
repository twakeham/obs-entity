import { Notice, TextFileView, parseYaml, stringifyYaml, type Menu, type TFile, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { findViewBlocks, replaceViewBlock } from "../../model/viewBlock";
import { parseView, serializeView, unknownSources, VIEW_KIND_ICON, type ViewDef, type ViewKind } from "../../model/views";
import { PluginContext } from "../react/context";
import { EntityTable } from "../react/table/EntityTable";

export const ENTITY_VIEW = "obs-entities-view";

/**
 * A view note opened as its own tab: the note's first `entity-view` block, rendered edge to edge like the
 * Entity Types editor. The note stays the source of truth: changes are written back into its block.
 * "Open as Markdown" shows the note itself.
 */
export class EntityViewView extends TextFileView {
	private root: Root | null = null;
	/** the block as last rendered or saved: its line and content */
	private block: { start: number; inner: string } | null = null;
	private generation = 0;
	private flushTable: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: EntitiesPlugin,
	) {
		super(leaf);
		this.addAction("file-text", "Open as Markdown", () => this.openAsMarkdown());
	}

	getViewType(): string {
		return ENTITY_VIEW;
	}

	getIcon(): string {
		return VIEW_KIND_ICON[this.kind] ?? "table";
	}

	/** The layout shown, for the tab icon (it changes with the Table / Board / Calendar toggle). */
	private kind: ViewKind = "table";
	private setKind(kind: ViewKind): void {
		if (kind === this.kind) return;
		this.kind = kind;
		(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Entity view";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("oe-entity-view-tab");
	}

	async onClose(): Promise<void> {
		this.unmount();
	}

	getViewData(): string {
		return this.data;
	}

	setViewData(data: string, clear: boolean): void {
		this.data = data;
		const b = findViewBlocks(data)[0];
		// Our own save coming back (or an edit elsewhere in the note): keep the table and its state.
		if (!clear && this.root && b && this.block && b.inner.trim() === this.block.inner.trim()) {
			this.block = { start: b.start, inner: b.inner };
			return;
		}
		this.block = b ? { start: b.start, inner: b.inner } : null;
		this.render();
	}

	clear(): void {
		this.unmount();
		this.block = null;
	}

	/** Save pending table changes into the note before the file is unloaded (the save happens first). */
	async onUnloadFile(file: TFile): Promise<void> {
		this.flushTable?.();
		await super.onUnloadFile(file);
	}

	onPaneMenu(menu: Menu, source: string): void {
		menu.addItem((i) =>
			i
				.setSection("pane")
				.setTitle("Open as Markdown")
				.setIcon("file-text")
				.onClick(() => this.openAsMarkdown()),
		);
		super.onPaneMenu(menu, source);
	}

	/** Show the note itself in this tab (until another file is opened in it). */
	openAsMarkdown(): void {
		this.flushTable?.();
		const file = this.file;
		if (!file) return;
		this.requestSave();
		this.plugin.viewAsMarkdown.set(this.leaf, file.path);
		void this.leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source", source: false } });
	}

	private unmount(): void {
		this.flushTable = null;
		this.root?.unmount();
		this.root = null;
	}

	private render(): void {
		this.unmount();
		const el = this.contentEl;
		el.empty();
		if (!this.block) {
			this.message("This note has no entity-view block.", []);
			return;
		}
		let raw: unknown;
		try {
			raw = this.block.inner.trim() ? parseYaml(this.block.inner) : null;
		} catch (e) {
			this.message("This entity view can't be shown", [`The view definition isn't valid YAML: ${(e as Error).message}`]);
			return;
		}
		const { def, errors } = parseView(raw);
		const unknown = def ? unknownSources(def, this.plugin.settings.types, this.plugin.settings.groups) : [];
		if (!def || unknown.length) {
			this.message("This entity view can't be shown", [...errors, ...(unknown.length ? [`Unknown ${unknown.length === 1 ? "type" : "types"}: ${unknown.join(", ")}.`] : [])]);
			return;
		}
		const path = this.file?.path ?? "";
		this.setKind(def.kind);
		this.root = createRoot(el);
		this.root.render(
			<PluginContext.Provider value={this.plugin}>
				<EntityTable
					key={++this.generation}
					initial={def}
					warnings={errors}
					sourcePath={path}
					stateKey={`${path}#tab`}
					save={(d) => this.saveDef(d)}
					editDefinition={() => this.openAsMarkdown()}
					onFlushReady={(f) => (this.flushTable = f)}
					fill
				/>
			</PluginContext.Provider>,
		);
	}

	private message(title: string, lines: string[]): void {
		const box = this.contentEl.createDiv({ cls: "oe-view-error oe-entity-view-message" });
		box.createDiv({ cls: "oe-view-error-title", text: title });
		if (lines.length) {
			const list = box.createEl("ul");
			for (const l of lines) list.createEl("li", { text: l });
		}
		box.createEl("button", { text: "Open as Markdown" }).addEventListener("click", () => this.openAsMarkdown());
	}

	/**
	 * Write a definition into the note's block and save it now. The table already debounces; leaving it to
	 * `requestSave` (≈2 s) lets an outside change to the note arrive first, and Obsidian's merge of the two
	 * can duplicate lines and break the YAML.
	 */
	private async saveDef(def: ViewDef): Promise<void> {
		if (!this.block) return;
		this.setKind(def.kind);
		const yaml = stringifyYaml(serializeView(def));
		const next = replaceViewBlock(this.data, { lineStart: this.block.start, source: this.block.inner }, yaml);
		if (next === null) {
			new Notice("Couldn't save the view: its block changed in the meantime.");
			return;
		}
		this.data = next;
		this.block = { start: this.block.start, inner: yaml.replace(/\n+$/, "") };
		await this.save();
	}
}
