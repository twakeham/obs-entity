/**
 * Apps: a whole configuration (every group, type, workflow, view note, template and saved component) in one file, with
 * details (name, version, author, description). Imported by replacing the configuration here or by adding alongside it.
 */
import { DEFAULT_STATUSES, type EntityTypeDef, type GroupDef } from "./types";
import { cloneWorkflow, type WorkflowDef } from "./workflows";
import type { SavedComponent } from "./layoutClipboard";
import { STARTER_PACK, installPack, type AppDetails, type InstallResult, type PackView, type TypePack } from "./packs";
import { exportPack } from "./typeEditing";

export type AppMode = "replace" | "add";

/** The parts of the settings an app holds. */
export interface AppConfig {
	groups: GroupDef[];
	types: EntityTypeDef[];
	workflows: WorkflowDef[];
	layoutComponents: SavedComponent[];
	deletedPackTypes: string[];
}

/** The whole configuration as an app file's text. */
export function exportApp(config: AppConfig, details: AppDetails, files: { views: PackView[]; templates: Record<string, string> }): string {
	const app = tidyDetails(details);
	return exportPack(config.types, config.groups, app.name, config.workflows, { ...files, app, components: config.layoutComponents, allGroups: true });
}

/** Details with blanks left out and the rest trimmed. */
export function tidyDetails(d: AppDetails): AppDetails {
	const out: AppDetails = { name: d.name.trim() || "Untitled app" };
	for (const k of ["version", "author", "description"] as const) {
		const v = d[k]?.trim();
		if (v) out[k] = v;
	}
	return out;
}

/** The file an app is saved as: "Project tracker 1.2.json". */
export function appFileName(d: AppDetails): string {
	const base = `${d.name.trim() || "App"}${d.version?.trim() ? ` ${d.version.trim()}` : ""}`.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
	return `${base}.json`;
}

/** What an app (or any pack) holds, counted. */
export function appContents(pack: TypePack): { types: number; groups: number; workflows: number; workflowsOn: number; views: number; templates: number; components: number } {
	const wfs = pack.workflows ?? [];
	return {
		types: pack.types.length,
		groups: pack.groups?.length ?? 0,
		workflows: wfs.length,
		workflowsOn: wfs.filter((w) => (w as { on?: unknown }).on !== false).length,
		views: pack.views?.length ?? 0,
		templates: Object.keys(pack.templates ?? {}).length,
		components: pack.components?.length ?? 0,
	};
}

/** Saved components added to a list: new ids when theirs are taken; ones already here (same name and contents) skipped. */
export function mergeComponents(existing: SavedComponent[], incoming: SavedComponent[], newId: () => string): { list: SavedComponent[]; added: number } {
	const list = existing.map((c) => ({ ...c }));
	let added = 0;
	for (const c of incoming) {
		const clip = JSON.stringify(c.clip);
		if (list.some((x) => x.name === c.name && JSON.stringify(x.clip) === clip)) continue;
		let id = c.id;
		while (list.some((x) => x.id === id)) id = newId();
		list.push({ ...JSON.parse(JSON.stringify(c)), id });
		added++;
	}
	return { list, added };
}

export interface AppInstall extends InstallResult {
	/** the saved components to keep */
	components: SavedComponent[];
	componentsAdded: number;
	/** every workflow to keep (`workflows`: the app's, to write view notes for) */
	allWorkflows: WorkflowDef[];
	deletedPackTypes: string[];
}

/**
 * Install an app. "replace": its groups, types, workflows and components take the place of the ones here, keys and ids
 * as they are; starter types it doesn't have are marked deleted, so they aren't added back. "add": like a pack, beside
 * the ones here (clashing keys and ids renamed), with its components added. Workflows come in off unless `keepOn`.
 */
export function installApp(pack: TypePack, current: AppConfig, mode: AppMode, keepOn: boolean, newId: () => string): AppInstall {
	const p: TypePack = { ...pack, id: undefined };
	if (mode === "replace") {
		// A configuration needs a group: an app without any gets the usual fallback.
		const base: GroupDef[] = p.groups?.length ? [] : [{ key: "entities", name: "Entities", icon: "shapes", statuses: [...DEFAULT_STATUSES] }];
		const res = installPack(p, base, [], [], { keepOn });
		const keys = new Set(res.types.map((t) => t.key));
		const deleted = [...new Set([...current.deletedPackTypes, ...STARTER_PACK.types.map((t) => t.key)])].filter((k) => !keys.has(k));
		const components = (pack.components ?? []).map((c) => JSON.parse(JSON.stringify(c)) as SavedComponent);
		return { ...res, components, componentsAdded: components.length, allWorkflows: res.workflows, deletedPackTypes: deleted };
	}
	const res = installPack(p, current.groups, current.types, current.workflows, { keepOn });
	const merged = mergeComponents(current.layoutComponents, pack.components ?? [], newId);
	return {
		...res,
		components: merged.list,
		componentsAdded: merged.added,
		allWorkflows: [...current.workflows.map(cloneWorkflow), ...res.workflows],
		deletedPackTypes: [...current.deletedPackTypes],
	};
}
