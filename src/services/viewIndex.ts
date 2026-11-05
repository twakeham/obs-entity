import { Events, TFile, debounce, normalizePath, type TAbstractFile } from "obsidian";
import type EntitiesPlugin from "../main";
import { findViewBlocks } from "../model/viewBlock";
import type { ViewKind } from "../model/views";

export const VIEW_BLOCK = "entity-view";
const FENCE = new RegExp("^(```+|~~~+)" + VIEW_BLOCK + "\\s*$", "m");

/**
 * Tracks view notes: Markdown notes in the views folder that contain an `entity-view` block.
 * Emits "updated" (debounced) when the list changes.
 */
export class ViewIndex extends Events {
	private paths = new Set<string>();
	private kinds = new Map<string, ViewKind>();
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
				this.kinds.delete(f.path);
				if (this.paths.delete(f.path)) this.notify();
			}),
		);
		this.plugin.registerEvent(
			vault.on("rename", (f, old) => {
				this.kinds.delete(old);
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
		this.kinds.clear();
		for (const f of this.plugin.app.vault.getMarkdownFiles()) {
			const kind = this.inFolder(f.path) ? await this.kindOf(f) : null;
			if (kind) {
				this.paths.add(f.path);
				this.kinds.set(f.path, kind);
			}
		}
		this.trigger("updated");
	}

	/** The layout of the note's first view block (null when it has none). */
	private async kindOf(f: TFile): Promise<ViewKind | null> {
		const text = await this.plugin.app.vault.cachedRead(f);
		if (!FENCE.test(text)) return null;
		const m = /^kind:\s*["']?(\w+)/m.exec(findViewBlocks(text)[0]?.inner ?? "");
		return m?.[1] === "board" ? "board" : m?.[1] === "calendar" ? "calendar" : "table";
	}

	private async check(f: TFile, changed = false): Promise<void> {
		if (f.extension !== "md") return;
		const kind = this.inFolder(f.path) ? await this.kindOf(f) : null;
		const was = this.kinds.get(f.path) ?? null;
		if (kind) {
			this.paths.add(f.path);
			this.kinds.set(f.path, kind);
		} else {
			this.paths.delete(f.path);
			this.kinds.delete(f.path);
		}
		if (kind !== was || changed) this.notify();
	}

	has(path: string): boolean {
		return this.paths.has(path);
	}

	/** A view note's layout (table when not known yet). */
	kind(path: string): ViewKind {
		return this.kinds.get(path) ?? "table";
	}

	/** Record a view note created just now (before the async check has read it). */
	add(path: string, kind: ViewKind = "table"): void {
		this.kinds.set(path, kind);
		if (this.paths.has(path)) return;
		this.paths.add(path);
		this.notify();
	}

	/** View notes, sorted by name. */
	all(): TFile[] {
		return [...this.paths]
			.map((p) => this.plugin.app.vault.getAbstractFileByPath(p))
			.filter((f): f is TFile => f instanceof TFile)
			.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
	}
}
