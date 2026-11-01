import { MarkdownRenderChild, Notice, TFile, parseYaml, stringifyYaml, type MarkdownPostProcessorContext } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { replaceViewBlock } from "../../model/viewBlock";
import { parseView, serializeView, unknownSources, type ViewDef } from "../../model/views";
import { PluginContext } from "../react/context";
import { EntityTable } from "../react/table/EntityTable";

/**
 * One rendered `entity-view` block. The table edits a copy of the definition and saves it back into the
 * block; the note then re-renders, mounting a fresh table with the saved definition.
 */
export class ViewBlock extends MarkdownRenderChild {
	private root: Root | null = null;

	constructor(
		private plugin: EntitiesPlugin,
		private source: string,
		containerEl: HTMLElement,
		private ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
	}

	onload(): void {
		const el = this.containerEl;
		el.addClass("oe-view-host");
		let raw: unknown;
		try {
			raw = this.source.trim() ? parseYaml(this.source) : null;
		} catch (e) {
			this.showError([`The view definition isn't valid YAML: ${(e as Error).message}`]);
			return;
		}
		const { def, errors } = parseView(raw);
		const unknown = def ? unknownSources(def, this.plugin.settings.types, this.plugin.settings.groups) : [];
		if (!def || unknown.length) {
			this.showError([...errors, ...(unknown.length ? [`Unknown ${unknown.length === 1 ? "type" : "types"}: ${unknown.join(", ")}.`] : [])]);
			return;
		}
		this.root = createRoot(el);
		this.root.render(
			<PluginContext.Provider value={this.plugin}>
				<EntityTable initial={def} warnings={errors} sourcePath={this.ctx.sourcePath} stateKey={this.stateKey()} save={(d) => this.save(d)} editDefinition={() => this.editDefinition()} />
			</PluginContext.Provider>,
		);
	}

	onunload(): void {
		this.root?.unmount();
		this.root = null;
	}

	/** Session state (search, collapsed groups, scroll) survives the re-render after a save. */
	private stateKey(): string {
		const info = this.ctx.getSectionInfo(this.containerEl);
		return `${this.ctx.sourcePath}#${info?.lineStart ?? 0}`;
	}

	private showError(messages: string[]): void {
		const box = this.containerEl.createDiv({ cls: "oe-view-error" });
		box.createDiv({ cls: "oe-view-error-title", text: "This entity view can't be shown" });
		const list = box.createEl("ul");
		for (const m of messages) list.createEl("li", { text: m });
		const btn = box.createEl("button", { text: "Edit definition" });
		btn.addEventListener("click", () => this.editDefinition());
	}

	/** Write a definition back into this block. */
	async save(def: ViewDef): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
		// Gone (deleted while a change was pending): nothing to save into.
		if (!(file instanceof TFile)) return;
		const yaml = stringifyYaml(serializeView(def));
		const info = this.ctx.getSectionInfo(this.containerEl);
		let found = true;
		try {
			await this.plugin.app.vault.process(file, (text) => {
				const next = replaceViewBlock(text, { lineStart: info?.lineStart ?? null, source: this.source }, yaml);
				if (next === null) {
					found = false;
					return text;
				}
				return next;
			});
		} catch (e) {
			// The note was deleted or moved while a change was waiting to be saved.
			if (!this.plugin.app.vault.getAbstractFileByPath(file.path)) return;
			new Notice(`Couldn't save the view: ${(e as Error).message}`);
			return;
		}
		if (!found) new Notice("Couldn't save the view: its block changed in the meantime.");
		else this.source = yaml;
	}

	/** Show the block's text: Source mode for the note holding it. */
	private editDefinition(): void {
		const { workspace } = this.plugin.app;
		const leaf = workspace.getLeavesOfType("markdown").find((l) => (l.view as { file?: TFile }).file?.path === this.ctx.sourcePath);
		if (leaf) {
			void leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.getViewState().state, mode: "source", source: true } });
			workspace.setActiveLeaf(leaf, { focus: true });
		} else void workspace.openLinkText(this.ctx.sourcePath, "", true, { state: { mode: "source", source: true } });
	}
}
