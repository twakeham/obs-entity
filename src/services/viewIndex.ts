import { Events, TFile, debounce, normalizePath, parseYaml, type TAbstractFile } from "obsidian";
import type EntitiesPlugin from "../main";
import { asArray } from "../model/links";
import { findViewBlocks, replaceViewBlock, setBlockPlace } from "../model/viewBlock";
import { DASHBOARD_ICON } from "../model/dashboard";
import { parseView, VIEW_KIND_ICON, type ViewDef, type ViewKind } from "../model/views";

/** What a view note shows: a table / board / calendar layout, or a dashboard. */
export type NoteViewKind = ViewKind | "dashboard";

export const VIEW_BLOCK = "entity-view";
const FENCE = new RegExp("^(```+|~~~+)" + VIEW_BLOCK + "\\s*$", "m");

/**
 * Tracks view notes: Markdown notes in the views folder that contain an `entity-view` block, with their layout, the
 * types they show (for the Entity Browser's Type filter) and where the browser lists them (`place:`). Emits "updated"
 * (debounced) when the list changes.
 */
export class ViewIndex extends Events {
	private paths = new Set<string>();
	private kinds = new Map<string, NoteViewKind>();
	private typeKeys = new Map<string, string[]>();
	private places = new Map<string, string>();
	/** each view note's first block's content, for its definition */
	private inners = new Map<string, string>();
	private defs = new Map<string, { inner: string; def: ViewDef | null }>();
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
				this.typeKeys.delete(f.path);
				this.places.delete(f.path);
				this.inners.delete(f.path);
				if (this.paths.delete(f.path)) this.notify();
			}),
		);
		this.plugin.registerEvent(
			vault.on("rename", (f, old) => {
				this.kinds.delete(old);
				this.typeKeys.delete(old);
				this.places.delete(old);
				this.inners.delete(old);
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
		this.typeKeys.clear();
		this.places.clear();
		this.inners.clear();
		for (const f of this.plugin.app.vault.getMarkdownFiles()) {
			const read = this.inFolder(f.path) ? await this.read(f) : null;
			if (read) {
				this.paths.add(f.path);
				this.kinds.set(f.path, read.kind);
				this.typeKeys.set(f.path, read.types);
				if (read.place) this.places.set(f.path, read.place);
				this.inners.set(f.path, read.inner);
			}
		}
		this.trigger("updated");
	}

	/** The layout, types and browser place of the note's first view block (null when it has none). */
	private async read(f: TFile): Promise<{ kind: NoteViewKind; types: string[]; place: string | null; inner: string } | null> {
		const text = await this.plugin.app.vault.cachedRead(f);
		if (!FENCE.test(text)) return null;
		const inner = findViewBlocks(text)[0]?.inner ?? "";
		const m = /^kind:\s*["']?(\w+)/m.exec(inner);
		const kind: NoteViewKind = m?.[1] === "board" ? "board" : m?.[1] === "calendar" ? "calendar" : m?.[1] === "dashboard" ? "dashboard" : "table";
		let types: string[] = ["*"];
		let place: string | null = null;
		try {
			const raw = parseYaml(inner) as { types?: unknown; place?: unknown } | null;
			if (raw?.types !== undefined) types = asArray(raw.types).map(String).filter(Boolean);
			if (typeof raw?.place === "string" && raw.place.trim()) place = raw.place.trim();
		} catch {
			// A block that doesn't parse shows its error in the note; here it's taken as every type.
		}
		return { kind, types: types.length ? types : ["*"], place, inner };
	}

	private async check(f: TFile, changed = false): Promise<void> {
		if (f.extension !== "md") return;
		const read = this.inFolder(f.path) ? await this.read(f) : null;
		const was = this.kinds.get(f.path) ?? null;
		const wasTypes = JSON.stringify(this.typeKeys.get(f.path) ?? null);
		const wasPlace = this.places.get(f.path) ?? null;
		const wasInner = this.inners.get(f.path) ?? null;
		if (read) {
			this.paths.add(f.path);
			this.kinds.set(f.path, read.kind);
			this.typeKeys.set(f.path, read.types);
			if (read.place) this.places.set(f.path, read.place);
			else this.places.delete(f.path);
			this.inners.set(f.path, read.inner);
		} else {
			this.paths.delete(f.path);
			this.kinds.delete(f.path);
			this.typeKeys.delete(f.path);
			this.places.delete(f.path);
			this.inners.delete(f.path);
		}
		// A changed definition counts too: dashboards built on the view show it.
		if ((read?.inner ?? null) !== wasInner || (read?.kind ?? null) !== was || JSON.stringify(read?.types ?? null) !== wasTypes || (read?.place ?? null) !== wasPlace || changed) this.notify();
	}

	has(path: string): boolean {
		return this.paths.has(path);
	}

	/** A view note's layout, or dashboard (table when not known yet). */
	kind(path: string): NoteViewKind {
		return this.kinds.get(path) ?? "table";
	}

	/** The icon for a view note: its layout's, or the dashboard icon. */
	icon(path: string): string {
		const k = this.kind(path);
		return k === "dashboard" ? DASHBOARD_ICON : (VIEW_KIND_ICON[k] ?? "table");
	}

	/** The types a view note shows (type keys, "@group" or "*"; every type when not known yet). */
	types(path: string): string[] {
		return this.typeKeys.get(path) ?? ["*"];
	}

	/** A table / board / calendar view note's definition (null for a dashboard, or a block that doesn't parse). */
	viewDef(path: string): ViewDef | null {
		const inner = this.inners.get(path);
		if (inner === undefined || this.kind(path) === "dashboard") return null;
		const hit = this.defs.get(path);
		if (hit && hit.inner === inner) return hit.def;
		let def: ViewDef | null = null;
		try {
			def = parseView(inner.trim() ? parseYaml(inner) : null).def;
		} catch {
			def = null;
		}
		this.defs.set(path, { inner, def });
		return def;
	}

	/** A view note by name (a link, resolved from `from`) or path; null when it's not a view note. */
	find(name: string, from = ""): string | null {
		const n = name.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0];
		if (!n) return null;
		const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(n, from)?.path;
		if (dest && this.paths.has(dest)) return dest;
		const lower = n.toLowerCase().replace(/\.md$/, "");
		return this.all().find((f) => f.basename.toLowerCase() === lower || f.path.toLowerCase().replace(/\.md$/, "") === lower)?.path ?? null;
	}

	/** Where the Entity Browser lists a view note (its block's `place:`; null when unset). */
	place(path: string): string | null {
		return this.places.get(path) ?? null;
	}

	/** Save where the Entity Browser lists a view note (null: worked out from its types). */
	async setPlace(path: string, place: string | null): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		await this.plugin.app.vault.process(file, (text) => {
			const block = findViewBlocks(text)[0];
			if (!block) return text;
			return replaceViewBlock(text, { lineStart: block.start, source: block.inner }, setBlockPlace(block.inner, place)) ?? text;
		});
		if (place) this.places.set(path, place);
		else this.places.delete(path);
		this.notify();
	}

	/** Record a view note created just now (before the async check has read it). */
	add(path: string, kind: NoteViewKind = "table"): void {
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
