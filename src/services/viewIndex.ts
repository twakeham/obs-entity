import { Events, TFile, debounce, normalizePath, type TAbstractFile } from "obsidian";
import type EntitiesPlugin from "../main";

export const VIEW_BLOCK = "entity-view";
const FENCE = new RegExp("^(```+|~~~+)" + VIEW_BLOCK + "\\s*$", "m");

/**
 * Tracks view notes: Markdown notes in the views folder that contain an `entity-view` block.
 * Emits "updated" (debounced) when the list changes.
 */
export class ViewIndex extends Events {
	private paths = new Set<string>();
	private notify = debounce(() => this.trigger("updated"), 100, true);

	constructor(private plugin: EntitiesPlugin) {
		super();
	}

	load(): void {
		const { vault } = this.plugin.app;
		const check = (f: TAbstractFile) => {
			if (f instanceof TFile) void this.check(f);
		};
		this.plugin.registerEvent(vault.on("create", check));
		this.plugin.registerEvent(vault.on("modify", check));
		this.plugin.registerEvent(
			vault.on("delete", (f) => {
				if (this.paths.delete(f.path)) this.notify();
			}),
		);
		this.plugin.registerEvent(
			vault.on("rename", (f, old) => {
				const had = this.paths.delete(old);
				if (f instanceof TFile) void this.check(f, had);
				else if (had) this.notify();
			}),
		);
		this.plugin.app.workspace.onLayoutReady(() => void this.rebuild());
	}

	get folder(): string {
		return normalizePath(this.plugin.settings.viewsFolder.trim() || "/");
	}

	inFolder(path: string): boolean {
		const f = this.folder;
		return f === "/" || path.toLowerCase().startsWith(`${f.toLowerCase()}/`);
	}

	async rebuild(): Promise<void> {
		this.paths.clear();
		for (const f of this.plugin.app.vault.getMarkdownFiles()) if (this.inFolder(f.path) && (await this.hasBlock(f))) this.paths.add(f.path);
		this.trigger("updated");
	}

	private async hasBlock(f: TFile): Promise<boolean> {
		return FENCE.test(await this.plugin.app.vault.cachedRead(f));
	}

	private async check(f: TFile, changed = false): Promise<void> {
		if (f.extension !== "md") return;
		const is = this.inFolder(f.path) && (await this.hasBlock(f));
		const was = this.paths.has(f.path);
		if (is) this.paths.add(f.path);
		else this.paths.delete(f.path);
		if (is !== was || changed) this.notify();
	}

	/** View notes, sorted by name. */
	all(): TFile[] {
		return [...this.paths]
			.map((p) => this.plugin.app.vault.getAbstractFileByPath(p))
			.filter((f): f is TFile => f instanceof TFile)
			.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
	}
}
