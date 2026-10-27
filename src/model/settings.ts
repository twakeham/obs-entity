import { STARTER_PACK } from "./packs";
import { DEFAULT_FOLDER_PATTERN } from "./paths";
import { cloneGroup, cloneType, DEFAULT_STATUSES, type EntityTypeDef, type GroupDef } from "./types";

export interface EntitiesSettings {
	settingsVersion: number;
	/** Where new entities go: {group} → group name, {entity} → the type's plural name. */
	folderPattern: string;
	/** Folder of editable Markdown templates, one per type. */
	templatesFolder: string;
	/** Open newly created notes in a new tab instead of the current one. */
	openInNewTab: boolean;
	/** Prefill a matching relation field from the active note when creating an entity. */
	prefillFromActive: boolean;
	/** Show the info card at the top of entity notes (off by default: the Connections panel covers it). */
	showCard: boolean;
	/** Info card collapsed state (shared by all notes). */
	cardCollapsed: boolean;
	groups: GroupDef[];
	types: EntityTypeDef[];
	/** Starter-pack type keys the user deleted, so newer plugin versions don't add them back. */
	deletedPackTypes: string[];
}

export const SETTINGS_VERSION = 2;

export function defaultSettings(): EntitiesSettings {
	return {
		settingsVersion: SETTINGS_VERSION,
		folderPattern: DEFAULT_FOLDER_PATTERN,
		templatesFolder: "_templates/entities",
		openInNewTab: false,
		prefillFromActive: true,
		showCard: false,
		cardCollapsed: false,
		groups: (STARTER_PACK.groups ?? []).map(cloneGroup),
		types: STARTER_PACK.types.map((t) => ({ ...cloneType(t), pack: STARTER_PACK.id })),
		deletedPackTypes: [],
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
	// Version 2: the Connections panel replaces the in-note card by default; turn the card off once.
	if ((saved.settingsVersion ?? 1) < 2) merged.showCard = false;

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
	return merged;
}
