import { Events, debounce } from "obsidian";
import { extractEdges, groupRelations, type Edge, type RelationGroup, type RelationItem } from "../model/relations";
import type EntitiesPlugin from "../main";

/**
 * Forward and computed inverse relationship edges between entities.
 * Only forward links live in frontmatter; inverses are derived here.
 * Emits "updated" after each rebuild; `version` increments so UIs can subscribe cheaply.
 */
export class RelationIndex extends Events {
	private outgoing = new Map<string, Edge[]>();
	/** keyed by resolved target path, or "?<linktext>" for unresolved targets */
	private incoming = new Map<string, Edge[]>();
	version = 0;
	private scheduleRebuild = debounce(() => this.rebuild(), 100, true);

	constructor(private plugin: EntitiesPlugin) {
		super();
	}

	load(): void {
		const { plugin } = this;
		plugin.registerEvent(plugin.index.on("updated", () => this.scheduleRebuild()));
		// New notes can turn unresolved links into resolved ones; body links feed "Mentioned in".
		plugin.registerEvent(plugin.app.metadataCache.on("resolved", () => this.scheduleRebuild()));
	}

	rebuild(): void {
		const { app } = this.plugin;
		this.outgoing.clear();
		this.incoming.clear();
		for (const entity of this.plugin.index.all()) {
			const edges = extractEdges(entity.path, entity.type, entity.frontmatter, (linkpath) => {
				return app.metadataCache.getFirstLinkpathDest(linkpath, entity.path)?.path ?? null;
			});
			this.outgoing.set(entity.path, edges);
			for (const e of edges) {
				const key = e.target ?? `?${e.linktext.toLowerCase()}`;
				const list = this.incoming.get(key);
				if (list) list.push(e);
				else this.incoming.set(key, [e]);
			}
		}
		this.version++;
		this.trigger("updated");
	}

	outgoingOf(path: string): Edge[] {
		return this.outgoing.get(path) ?? [];
	}

	incomingOf(path: string): Edge[] {
		return this.incoming.get(path) ?? [];
	}

	allEdges(): Edge[] {
		return Array.from(this.outgoing.values()).flat();
	}

	/** Grouped relationships for display (card, panel). Works for non-entity notes too (incoming only). */
	groupsFor(path: string): RelationGroup[] {
		const entity = this.plugin.index.get(path);
		return groupRelations(path, this.outgoingOf(path), this.incomingOf(path), {
			fieldOrder: entity?.type.fields.map((f) => f.key) ?? [],
			typeName: (key) => this.plugin.getType(key)?.name ?? key,
		});
	}

	/** Notes linking to `path` (anywhere, e.g. in the body) that aren't already a relationship. */
	mentions(path: string, exclude: Set<string>): RelationItem[] {
		const resolved = this.plugin.app.metadataCache.resolvedLinks;
		const items: RelationItem[] = [];
		for (const [source, targets] of Object.entries(resolved)) {
			if (source === path || exclude.has(source) || !targets[path]) continue;
			items.push({
				path: source,
				linktext: source,
				direction: "in",
				edge: {
					source,
					target: path,
					linktext: path,
					sourceType: this.plugin.index.get(source)?.type.key ?? "",
					fieldKey: "",
					fieldLabel: "Mentioned in",
					symmetric: false,
					labelled: false,
					related: false,
				},
			});
		}
		return items.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""));
	}
}
