import { Events, TFile, debounce, getAllTags, type CachedMetadata } from "obsidian";
import { subtitleOf } from "../model/card";
import { normaliseTags, toOrder, toStringList, type EntityInfo } from "../model/entity";
import { parseLink } from "../model/links";
import { COMMON_KEYS, typeMatchesTarget, type RelationTarget } from "../model/types";
import type EntitiesPlugin from "../main";

export interface EntityRecord extends EntityInfo {
	file: TFile;
	aliases: string[];
}

/**
 * Tracks every note whose frontmatter `entity` names a known type.
 * Emits "updated" (debounced) whenever the set of entities or their metadata changes.
 */
export class EntityIndex extends Events {
	private byPath = new Map<string, EntityRecord>();
	private ready = false;
	private notify = debounce(() => this.trigger("updated"), 150, true);

	constructor(private plugin: EntitiesPlugin) {
		super();
	}

	load(): void {
		const { app } = this.plugin;
		this.plugin.registerEvent(
			app.metadataCache.on("changed", (file, _data, cache) => {
				if (this.update(file, cache)) this.notify();
			}),
		);
		this.plugin.registerEvent(
			app.vault.on("delete", (file) => {
				if (this.byPath.delete(file.path)) this.notify();
			}),
		);
		this.plugin.registerEvent(
			app.vault.on("rename", (file, oldPath) => {
				const old = this.byPath.get(oldPath);
				const had = this.byPath.delete(oldPath);
				if (file instanceof TFile) {
					if (this.update(file)) return this.notify();
					// The metadata cache may not have the new path yet: keep the entity (a rename doesn't change its
					// frontmatter) under its new path, and read it again shortly.
					if (old && file.extension === "md") {
						this.byPath.set(file.path, { ...old, file, path: file.path, name: file.basename });
						this.notify();
						window.setTimeout(() => {
							const meta = app.metadataCache.getFileCache(file);
							if (meta && this.update(file, meta)) this.notify();
						}, 500);
						return;
					}
				}
				if (had) this.notify();
			}),
		);
		app.workspace.onLayoutReady(() => this.rebuild());
	}

	isReady(): boolean {
		return this.ready;
	}

	rebuild(): void {
		this.byPath.clear();
		for (const file of this.plugin.app.vault.getMarkdownFiles()) this.update(file);
		this.ready = true;
		this.trigger("updated");
	}

	/** Re-index one file. Returns true if the index changed. */
	update(file: TFile, cache?: CachedMetadata | null): boolean {
		if (file.extension !== "md") return false;
		const meta = cache ?? this.plugin.app.metadataCache.getFileCache(file);
		const fm = meta?.frontmatter;
		const typeKey = fm?.[COMMON_KEYS.type];
		const type = typeof typeKey === "string" ? this.plugin.getType(typeKey) : undefined;
		if (!fm || !type) return this.byPath.delete(file.path);
		const status = fm[COMMON_KEYS.status];
		this.byPath.set(file.path, {
			file,
			path: file.path,
			name: file.basename,
			type,
			status: typeof status === "string" ? status : null,
			subtitle: subtitleOf(type, fm, this.plugin.formatEnv()),
			aliases: toStringList(fm[COMMON_KEYS.aliases]),
			tags: normaliseTags(meta ? (getAllTags(meta) ?? []) : []),
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			order: toOrder(fm[COMMON_KEYS.order]),
			frontmatter: fm,
		});
		return true;
	}

	get(path: string): EntityRecord | undefined {
		return this.byPath.get(path);
	}

	getByFile(file: TFile | null | undefined): EntityRecord | undefined {
		return file ? this.byPath.get(file.path) : undefined;
	}

	all(): EntityRecord[] {
		return Array.from(this.byPath.values());
	}

	ofType(typeKey: string): EntityRecord[] {
		return this.all().filter((e) => e.type.key === typeKey);
	}

	matching(targets: RelationTarget[] | undefined): EntityRecord[] {
		return this.all().filter((e) => typeMatchesTarget(e.type, targets));
	}

	/** Resolve a frontmatter link value (e.g. "[[Acme]]") to an entity. */
	resolveLink(value: unknown, sourcePath = ""): EntityRecord | undefined {
		const link = parseLink(value);
		if (!link) return undefined;
		const file = this.plugin.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath);
		return file ? this.byPath.get(file.path) : undefined;
	}
}
