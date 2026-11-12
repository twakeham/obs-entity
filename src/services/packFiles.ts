import { TFile, normalizePath, parseYaml } from "obsidian";
import { asArray } from "../model/links";
import { numberedFile, remapWorkflowViews, viewOnlyOver, type InstallResult, type PackView } from "../model/packs";
import type { EntityTypeDef } from "../model/types";
import { findViewBlocks } from "../model/viewBlock";
import type { WorkflowDef } from "../model/workflows";
import type EntitiesPlugin from "../main";

/** Which view notes go into a pack: every one, those showing only some types (and groups), or none. */
export type ViewPick = "all" | "none" | { types: Set<string>; groups: Set<string> };

/** The view notes and template files to export with some types. */
export async function collectPackFiles(plugin: EntitiesPlugin, types: EntityTypeDef[], pick: ViewPick): Promise<{ views: PackView[]; templates: Record<string, string> }> {
	const { vault } = plugin.app;
	const templates: Record<string, string> = {};
	for (const t of types) {
		const file = vault.getAbstractFileByPath(plugin.factory.templatePath(t));
		if (file instanceof TFile) templates[t.key] = await vault.cachedRead(file);
	}
	const views: PackView[] = [];
	if (pick !== "none")
		for (const file of plugin.views.all()) {
			const inner = findViewBlocks(await vault.cachedRead(file))[0]?.inner;
			if (inner === undefined) continue;
			let raw: unknown;
			try {
				raw = parseYaml(inner) ?? {};
			} catch {
				continue;
			}
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
			const shows = (raw as { types?: unknown }).types === undefined ? ["*"] : asArray((raw as { types?: unknown }).types).map(String);
			if (pick !== "all" && !viewOnlyOver(shows, pick.types, pick.groups)) continue;
			views.push({ name: file.basename, path: file.path, view: raw as Record<string, unknown> });
		}
	return { views, templates };
}

export interface PackFilesWritten {
	/** templates written (paths) */
	templates: string[];
	/** view notes written (paths) */
	views: string[];
}

/**
 * Write an imported pack's templates and view notes. A template whose file already exists with other text is written
 * numbered ("Person 2.md") and its type (in `types`) points at it; one with the same text is left. Workflows' view
 * lists (in `workflows`) follow the view notes written.
 */
export async function writePackFiles(plugin: EntitiesPlugin, res: Pick<InstallResult, "views" | "templates">, types: EntityTypeDef[], workflows: WorkflowDef[]): Promise<PackFilesWritten> {
	const { vault } = plugin.app;
	const out: PackFilesWritten = { templates: [], views: [] };
	const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
	for (const [key, text] of Object.entries(res.templates)) {
		const type = types.find((t) => t.key === key);
		if (!type) continue;
		type.template = type.template || `${type.name}.md`;
		let path = plugin.factory.templatePath(type);
		const existing = vault.getAbstractFileByPath(path);
		if (existing instanceof TFile && norm(await vault.cachedRead(existing)) === norm(text)) continue;
		if (existing) {
			type.template = numberedFile(type.template, (n) => !!vault.getAbstractFileByPath(plugin.factory.templatePath({ ...type, template: n })));
			path = plugin.factory.templatePath(type);
		}
		await plugin.factory.ensureFolder(path.split("/").slice(0, -1).join("/"));
		await vault.create(path, text);
		out.templates.push(path);
	}
	const moved = new Map<string, string>();
	for (const v of res.views) {
		const file = await plugin.writeViewNote(v.name, v.def);
		if (v.path) moved.set(normalizePath(v.path), file.path);
		out.views.push(file.path);
	}
	remapWorkflowViews(workflows, moved, (p) => plugin.views.has(p));
	return out;
}

/** "2 view notes and 1 template" for a notice ("" when nothing was written). */
export function describeWritten(w: PackFilesWritten): string {
	const n = (k: number, s: string) => `${k} ${s}${k === 1 ? "" : "s"}`;
	return [w.views.length ? n(w.views.length, "view note") : "", w.templates.length ? n(w.templates.length, "template") : ""].filter(Boolean).join(" and ");
}
