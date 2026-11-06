import { DEFAULT_DATE_FORMAT } from "./fieldFormats";
import { readComponents, type SavedComponent } from "./layoutClipboard";
import { STARTER_PACK } from "./packs";
import { DEFAULT_FOLDER_PATTERN } from "./paths";
import { cloneGroup, cloneType, DEFAULT_STATUSES, type EntityTypeDef, type GroupDef } from "./types";
import { readWorkflows, type WorkflowDef } from "./workflows";

export interface EntitiesSettings {
	settingsVersion: number;
	/** Where new entities go: {group} → group name, {entity} → the type's plural name. */
	folderPattern: string;
	/** Folder of editable Markdown templates, one per type. */
	templatesFolder: string;
	/** Folder of entity view notes (notes holding an `entity-view` block). */
	viewsFolder: string;
	/** Open view notes as full-tab entity views (rather than as notes with the table inside). */
	openViewsAsTabs: boolean;
	/** Currency code the "Currency" column format starts with (ISO 4217, e.g. AUD). */
	defaultCurrency: string;
	/** How dates without a format of their own are shown: a moment.js pattern or "relative". */
	dateFormat: string;
	/** Layout items saved as components (the Layout tab's "My components"), shared by every type. */
	layoutComponents: SavedComponent[];
	/** Open newly created notes in a new tab instead of the current one. */
	openInNewTab: boolean;
	/** Prefill a matching relation field from the active note when creating an entity. */
	prefillFromActive: boolean;
	/** Replace Obsidian's Properties block on entity notes with the entity properties form. */
	useForm: boolean;
	/** Properties form collapsed state (shared by all notes). */
	formCollapsed: boolean;
	groups: GroupDef[];
	types: EntityTypeDef[];
	/** Starter-pack type keys the user deleted, so newer plugin versions don't add them back. */
	deletedPackTypes: string[];
	/** Workflows (DESIGN §8.11). */
	workflows: WorkflowDef[];
	/** The master switch: no workflow runs while paused. */
	workflowsPaused: boolean;
}

export const SETTINGS_VERSION = 3;

export function defaultSettings(): EntitiesSettings {
	return {
		settingsVersion: SETTINGS_VERSION,
		folderPattern: DEFAULT_FOLDER_PATTERN,
		templatesFolder: "_templates/entities",
		viewsFolder: "Entities/Views",
		openViewsAsTabs: true,
		defaultCurrency: "AUD",
		dateFormat: DEFAULT_DATE_FORMAT,
		layoutComponents: [],
		openInNewTab: false,
		prefillFromActive: true,
		useForm: true,
		formCollapsed: false,
		groups: (STARTER_PACK.groups ?? []).map(cloneGroup),
		types: STARTER_PACK.types.map((t) => ({ ...cloneType(t), pack: STARTER_PACK.id })),
		deletedPackTypes: [],
		workflows: [],
		workflowsPaused: false,
	};
}

const isString = (v: unknown): v is string => typeof v === "string";

/**
 * Merge saved settings over defaults. On first run (nothing saved) the starter pack is installed.
 * Saved groups and types are kept as they are; starter types added in newer plugin versions are
 * appended unless the user deleted them. There is always at least one group.
 */
export function mergeSettings(saved: Partial<EntitiesSettings> | null | undefined): EntitiesSettings {
	const base = defaultSettings();
	if (!saved) return base;
	const merged: EntitiesSettings = {
		...base,
		...saved,
		settingsVersion: SETTINGS_VERSION,
		deletedPackTypes: Array.isArray(saved.deletedPackTypes) ? saved.deletedPackTypes.filter(isString) : [],
	};
	merged.groups = Array.isArray(saved.groups) ? saved.groups.map(cloneGroup) : base.groups;
	merged.types = Array.isArray(saved.types) ? saved.types.map(cloneType) : base.types;
	merged.workflows = readWorkflows(saved.workflows);
	merged.workflowsPaused = saved.workflowsPaused === true;
	// Version 3: the properties form replaced the info card (whose settings are dropped).
	const legacy = merged as EntitiesSettings & { showCard?: unknown; cardCollapsed?: unknown };
	delete legacy.showCard;
	delete legacy.cardCollapsed;
	if (typeof merged.useForm !== "boolean") merged.useForm = true;

	const have = new Set(merged.types.map((t) => t.key));
	const deleted = new Set(merged.deletedPackTypes);
	for (const t of base.types) {
		if (have.has(t.key) || deleted.has(t.key)) continue;
		merged.types.push(t);
		if (!merged.groups.some((g) => g.key === t.group)) {
			const g = base.groups.find((x) => x.key === t.group);
			if (g) merged.groups.push(g);
		}
	}
	if (merged.groups.length === 0) {
		merged.groups.push({ key: "entities", name: "Entities", icon: "shapes", statuses: [...DEFAULT_STATUSES] });
	}
	for (const g of merged.groups) if (!Array.isArray(g.statuses) || g.statuses.length === 0) g.statuses = [...DEFAULT_STATUSES];
	if (typeof merged.folderPattern !== "string") merged.folderPattern = DEFAULT_FOLDER_PATTERN;
	if (typeof merged.viewsFolder !== "string") merged.viewsFolder = base.viewsFolder;
	if (typeof merged.openViewsAsTabs !== "boolean") merged.openViewsAsTabs = true;
	if (typeof merged.defaultCurrency !== "string" || !/^[A-Za-z]{3}$/.test(merged.defaultCurrency)) merged.defaultCurrency = "AUD";
	if (typeof merged.dateFormat !== "string" || !merged.dateFormat.trim()) merged.dateFormat = DEFAULT_DATE_FORMAT;
	merged.layoutComponents = readComponents(saved.layoutComponents);
	return merged;
}
