import { DEFAULT_DATE_FORMAT } from "./fieldFormats";
import { readComponents, type SavedComponent } from "./layoutClipboard";
import { STARTER_PACK, type AppDetails } from "./packs";
import { tidyDetails } from "./apps";
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
	/** The details the configuration was last exported (or imported) as an app with. */
	appDetails?: AppDetails;
	/** Which of the plugin's ribbon icons are shown. */
	ribbonIcons: Record<RibbonIconId, boolean>;
}

/** The plugin's own ribbon icons (form workflows add theirs separately). `title` is also part of each one's ribbon id. */
export const RIBBON_ICONS = [
	{ id: "create", icon: "book-plus", title: "Entities: create entity", label: "Create entity" },
	{ id: "browser", icon: "library", title: "Entities: entity browser", label: "Entity browser" },
	{ id: "side-panel", icon: "waypoints", title: "Entities: side panel (connections, preview)", label: "Side panel (connections, preview)" },
	{ id: "types", icon: "shapes", title: "Entities: entity types", label: "Entity types" },
	{ id: "workflows", icon: "zap", title: "Entities: workflows", label: "Workflows" },
] as const;
export type RibbonIconId = (typeof RIBBON_ICONS)[number]["id"];

/** Ribbon icons a new install shows. */
const RIBBON_DEFAULTS: Record<RibbonIconId, boolean> = { create: false, browser: true, "side-panel": true, types: false, workflows: false };

/** Saved ribbon choices; none saved (settings from before there were any): every icon, as it was. */
function readRibbon(raw: unknown): Record<RibbonIconId, boolean> {
	const saved = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
	return Object.fromEntries(RIBBON_ICONS.map(({ id }) => [id, saved ? (typeof saved[id] === "boolean" ? (saved[id] as boolean) : RIBBON_DEFAULTS[id]) : true])) as Record<RibbonIconId, boolean>;
}

export const SETTINGS_VERSION = 3;

/** The group a vault starts with (and always has, when every group is removed). */
export const FIRST_GROUP = (): GroupDef => ({ key: "entities", name: "Entities", icon: "shapes", statuses: [...DEFAULT_STATUSES] });

/**
 * A new vault's settings: no types yet (the first-run picker offers the packs), one empty group, and the starter types
 * marked as not wanted, so they aren't added on their own.
 */
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
		groups: [FIRST_GROUP()],
		types: [],
		deletedPackTypes: STARTER_PACK.types.map((t) => t.key),
		workflows: [],
		workflowsPaused: false,
		ribbonIcons: { ...RIBBON_DEFAULTS },
	};
}

/** Whether the settings are still as a new vault starts: no types, only the first empty group. */
export const isPristine = (s: Pick<EntitiesSettings, "types" | "groups">): boolean => s.types.length === 0 && s.groups.length === 1 && s.groups[0].key === FIRST_GROUP().key;

const isString = (v: unknown): v is string => typeof v === "string";

/**
 * Merge saved settings over defaults. On first run (nothing saved) there are no types: the first-run picker offers the
 * packs. Saved groups and types are kept as they are; starter types (settings from before the picker, or a vault that
 * installed the Starter pack) are added when missing, unless the user deleted them. There is always at least one group.
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
	merged.groups = Array.isArray(saved.groups) ? saved.groups.map(cloneGroup) : [];
	merged.types = Array.isArray(saved.types) ? saved.types.map(cloneType) : [];
	merged.workflows = readWorkflows(saved.workflows, merged.types);
	merged.workflowsPaused = saved.workflowsPaused === true;
	// Version 3: the properties form replaced the info card (whose settings are dropped).
	const legacy = merged as EntitiesSettings & { showCard?: unknown; cardCollapsed?: unknown };
	delete legacy.showCard;
	delete legacy.cardCollapsed;
	if (typeof merged.useForm !== "boolean") merged.useForm = true;

	const have = new Set(merged.types.map((t) => t.key));
	const deleted = new Set(merged.deletedPackTypes);
	for (const t of STARTER_PACK.types) {
		if (have.has(t.key) || deleted.has(t.key)) continue;
		merged.types.push({ ...cloneType(t), pack: STARTER_PACK.id });
		if (!merged.groups.some((g) => g.key === t.group)) {
			const g = STARTER_PACK.groups?.find((x) => x.key === t.group);
			if (g) merged.groups.push(cloneGroup(g));
		}
	}
	if (merged.groups.length === 0) merged.groups.push(FIRST_GROUP());
	for (const g of merged.groups) if (!Array.isArray(g.statuses) || g.statuses.length === 0) g.statuses = [...DEFAULT_STATUSES];
	if (typeof merged.folderPattern !== "string") merged.folderPattern = DEFAULT_FOLDER_PATTERN;
	if (typeof merged.viewsFolder !== "string") merged.viewsFolder = base.viewsFolder;
	if (typeof merged.openViewsAsTabs !== "boolean") merged.openViewsAsTabs = true;
	if (typeof merged.defaultCurrency !== "string" || !/^[A-Za-z]{3}$/.test(merged.defaultCurrency)) merged.defaultCurrency = "AUD";
	if (typeof merged.dateFormat !== "string" || !merged.dateFormat.trim()) merged.dateFormat = DEFAULT_DATE_FORMAT;
	merged.layoutComponents = readComponents(saved.layoutComponents);
	merged.ribbonIcons = readRibbon(saved.ribbonIcons);
	const app = saved.appDetails as Record<string, unknown> | undefined;
	const text = (v: unknown) => (typeof v === "string" ? v : undefined);
	if (app && typeof app === "object" && typeof app.name === "string" && app.name.trim()) merged.appDetails = tidyDetails({ name: app.name, version: text(app.version), author: text(app.author), description: text(app.description) });
	else delete merged.appDetails;
	return merged;
}
