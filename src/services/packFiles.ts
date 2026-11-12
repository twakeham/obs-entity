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
	/** files that were there with other text: overwritten, a copy of each in the trash (replace) */
	replaced: string[];
}

/**
 * Write an imported pack's templates and view notes. A template whose file already exists with other text is written
 * numbered ("Person 2.md") and its type (in `types`) points at it; one with the same text is left. Workflows' view
 * lists (in `workflows`) follow the view notes written. `replace` (an app replacing the configuration): a view note or
 * template already at the same name with other text is overwritten in place, a copy of it going to the trash first
 * (overwriting rather than deleting keeps links to it, and workflows' view lists, pointing at it).
 */
export async function writePackFiles(plugin: EntitiesPlugin, res: Pick<InstallResult, "views" | "templates">, types: EntityTypeDef[], workflows: WorkflowDef[], replace = false): Promise<PackFilesWritten> {
	const { vault } = plugin.app;
	const out: PackFilesWritten = { templates: [], views: [], replaced: [] };
	const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
	/** Overwrite `file` with `text` (a copy of it to the trash); false when it already has that text. */
	const overwrite = async (file: TFile, text: string): Promise<boolean> => {
		const old = await vault.read(file);
		if (norm(old) === norm(text)) return false;
		await trashCopy(plugin, `${file.basename} (before import).${file.extension}`, old);
		await vault.modify(file, text);
		out.replaced.push(file.path);
		return true;
	};
	for (const [key, text] of Object.entries(res.templates)) {
		const type = types.find((t) => t.key === key);
		if (!type) continue;
		type.template = type.template || `${type.name}.md`;
		let path = plugin.factory.templatePath(type);
		const existing = vault.getAbstractFileByPath(path);
		if (existing instanceof TFile && (replace || norm(await vault.cachedRead(existing)) === norm(text))) {
			if (replace && (await overwrite(existing, text))) out.templates.push(path);
			continue;
		}
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
		const there = replace ? vault.getAbstractFileByPath(await plugin.viewNotePath(v.name)) : null;
		let file: TFile;
		if (there instanceof TFile) {
			file = there;
			if (await overwrite(there, plugin.viewNoteText(v.def))) out.views.push(file.path);
		} else {
			file = await plugin.writeViewNote(v.name, v.def);
			out.views.push(file.path);
		}
		if (v.path) moved.set(normalizePath(v.path), file.path);
	}
	remapWorkflowViews(workflows, moved, (p) => plugin.views.has(p));
	return out;
}

/**
 * Put `text` in the trash as a file named `name`, following the vault's trash setting (system trash, the vault's
 * .trash folder, or none). Written first in the plugin's own folder, outside the vault's notes, so no note appears
 * and disappears (which the vault's indexers would try to read).
 */
async function trashCopy(plugin: EntitiesPlugin, name: string, text: string): Promise<void> {
	const { adapter, configDir } = plugin.app.vault;
	const tmp = normalizePath(`${configDir}/plugins/${plugin.manifest.id}/${name}`);
	await adapter.write(tmp, text);
	const option = (plugin.app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.("trashOption");
	if (option === "none") await adapter.remove(tmp);
	else if (option === "local" || !(await adapter.trashSystem(tmp))) await adapter.trashLocal(tmp);
}

/** "2 view notes and 1 template" for a notice ("" when nothing was written). */
export function describeWritten(w: PackFilesWritten): string {
	const n = (k: number, s: string) => `${k} ${s}${k === 1 ? "" : "s"}`;
	return [w.views.length ? n(w.views.length, "view note") : "", w.templates.length ? n(w.templates.length, "template") : ""].filter(Boolean).join(" and ");
}
