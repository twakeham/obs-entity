import { MarkdownRenderChild, Notice, TFile, parseYaml, stringifyYaml, type MarkdownPostProcessorContext } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { replaceViewBlock } from "../../model/viewBlock";
import { isWideAlt } from "../../model/viewEmbed";
import { removeWideButton, wideButton } from "./embedWide";
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
		this.watchFit();
		this.root.render(
			<PluginContext.Provider value={this.plugin}>
				<EntityTable initial={def} warnings={errors} sourcePath={this.ctx.sourcePath} stateKey={this.stateKey()} save={(d) => this.save(d)} editDefinition={() => this.editDefinition()} />
			</PluginContext.Provider>,
		);
	}

	onunload(): void {
		this.root?.unmount();
		this.root = null;
		this.unfit();
	}

	// ---- full-tab layout: a view directly in a note spans the pane, not just the readable line width

	private sizeObserver: ResizeObserver | null = null;
	private paneObserver: ResizeObserver | null = null;
	private pane: HTMLElement | null = null;
	private fitted: HTMLElement | null = null;
	/** the embed this view fills (marked `oe-view-embed`) */
	private embed: HTMLElement | null = null;
	/** watches the embed's `alt` (its display text, e.g. `wide`) */
	private altObserver: MutationObserver | null = null;

	/** Start fitting once the block is in the page (post-processors run before it's attached). */
	private watchFit(): void {
		this.sizeObserver = new ResizeObserver(() => this.fit());
		this.sizeObserver.observe(this.containerEl);
	}

	private fit(): void {
		const el = this.containerEl;
		if (!el.isConnected) return;
		const embed = el.closest<HTMLElement>(".markdown-embed");
		if (embed) return this.fitEmbed(embed);
		// Callouts and hover previews keep their normal size.
		if (el.closest(".internal-embed, .callout, .popover, .hover-popover")) return;
		const pane = el.closest<HTMLElement>(".cm-scroller, .markdown-preview-view");
		if (!pane) return;
		// Only our own element is resized: changing CodeMirror's widget (.cm-embed-block) makes the editor redraw it.
		el.addClass("is-full");
		this.spread(el, pane);
	}

	/**
	 * An embedded view note (nothing but this block) loses the embed's border and indent, so it fills the width, and
	 * gets a Full width button. With `|wide` the whole embed spans the pane.
	 */
	private fitEmbed(embed: HTMLElement): void {
		if (!this.isWholeNote()) return;
		embed.addClass("oe-view-embed");
		this.embed = embed;
		// Embeds in callouts, hover previews and other embeds stay as they are.
		if (embed.closest(".callout, .popover, .hover-popover") || embed.parentElement?.closest(".internal-embed")) return;
		wideButton(this.plugin.app, embed);
		// Obsidian keeps the embed when its link changes (`|wide` on or off), updating only `alt`.
		if (!this.altObserver) {
			this.altObserver = new MutationObserver(() => this.fit());
			this.altObserver.observe(embed, { attributes: true, attributeFilter: ["alt"] });
		}
		const wide = isWideAlt(embed.getAttribute("alt"));
		embed.toggleClass("is-wide", wide);
		const pane = embed.parentElement?.closest<HTMLElement>(".cm-scroller, .markdown-preview-view");
		if (wide && pane) this.spread(embed, pane);
		else this.unspread(embed);
	}

	/** Size `target` to span `pane` (20px in from each side), and follow the pane's size. */
	private spread(target: HTMLElement, pane: HTMLElement): void {
		if (pane !== this.pane) {
			this.paneObserver?.disconnect();
			this.paneObserver = new ResizeObserver(() => this.fit());
			this.paneObserver.observe(pane);
			this.pane = pane;
		}
		const parent = target.parentElement;
		if (!parent) return;
		this.fitted = target;
		const pad = 20;
		const p = pane.getBoundingClientRect();
		const left = p.left + pane.clientLeft + pad;
		const width = Math.max(200, pane.clientWidth - 2 * pad);
		const pr = parent.getBoundingClientRect();
		const margin = `${Math.round(left - (pr.left + parent.clientLeft + parseFloat(getComputedStyle(parent).paddingLeft || "0")))}px`;
		const w = `${Math.round(width)}px`;
		if (target.style.marginLeft !== margin || target.style.width !== w) {
			// Live Preview pins its top-level blocks' margins (`margin: 0 !important`), which an embed is.
			target.style.maxWidth = "none";
			target.style.setProperty("margin-left", margin, "important");
			target.style.setProperty("margin-right", "0", "important");
			target.style.width = w;
		}
		// The table's scroll area can grow to the pane's height (minus toolbar and footer).
		this.containerEl.style.setProperty("--oe-view-max-height", `${Math.max(240, pane.clientHeight - 110)}px`);
	}

	/** Undo `spread` on `t` (an embed going back to normal width; an earlier render may have spread it). */
	private unspread(t: HTMLElement | null = this.fitted): void {
		if (t) for (const k of ["max-width", "margin-left", "margin-right", "width"]) t.style.removeProperty(k);
		this.containerEl.style.removeProperty("--oe-view-max-height");
		this.fitted = null;
		this.paneObserver?.disconnect();
		this.paneObserver = null;
		this.pane = null;
	}

	private unfit(): void {
		this.sizeObserver?.disconnect();
		this.sizeObserver = null;
		this.altObserver?.disconnect();
		this.altObserver = null;
		// A re-rendered embed may already hold the new block, which keeps the embed as it is.
		const embed = this.embed;
		const replaced = !!embed && [...embed.querySelectorAll(".oe-view-host")].some((h) => h !== this.containerEl);
		if (embed && !replaced) this.unspread(embed);
		else {
			this.paneObserver?.disconnect();
			this.paneObserver = null;
			this.pane = null;
			this.fitted = null;
		}
		if (embed && !replaced) {
			embed.removeClass("oe-view-embed", "is-wide");
			removeWideButton(embed);
		}
		this.embed = null;
	}
	/** Whether this block is the whole note (apart from frontmatter), like the notes in the views folder. */
	private isWholeNote(): boolean {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
		const sections = file instanceof TFile ? this.plugin.app.metadataCache.getFileCache(file)?.sections : undefined;
		return !!sections && sections.filter((s) => s.type !== "yaml").length === 1;
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
