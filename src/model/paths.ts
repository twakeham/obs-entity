import type { EntityTypeDef, GroupDef } from "./types";

/** Join path segments with "/", dropping empties and duplicate/trailing slashes. */
export function joinPath(...parts: string[]): string {
	return parts
		.flatMap((p) => p.split(/[\\/]+/))
		.map((p) => p.trim())
		.filter((p) => p.length > 0 && p !== ".")
		.join("/");
}

const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/** Make a string safe to use as a note file name (without extension). */
export function sanitizeFileName(name: string): string {
	return name.replace(ILLEGAL, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
}

export const DEFAULT_FOLDER_PATTERN = "Entities/{group}/{entity}";

/** Placeholders allowed in the folder pattern. */
export const FOLDER_PLACEHOLDERS = ["group", "entity"] as const;

const PLACEHOLDER = /\{\s*([^{}]*?)\s*\}/g;

/** Placeholders in a folder pattern that aren't recognised. */
export function unknownPlaceholders(pattern: string): string[] {
	const known = new Set<string>(FOLDER_PLACEHOLDERS);
	return Array.from(pattern.matchAll(PLACEHOLDER), (m) => m[1]).filter((p) => !known.has(p.toLowerCase()));
}

/** The pattern that applies to a type: its own exception if it has one (even ""), otherwise the global pattern. */
export function effectiveFolderPattern(globalPattern: string, type: EntityTypeDef): string {
	return typeof type.folderPattern === "string" ? type.folderPattern : globalPattern;
}

/**
 * Expand the folder pattern for a type: {group} → group name, {entity} → the type's plural name.
 * Values are made safe as folder names; unknown placeholders are left as written.
 */
export function expandFolderPattern(pattern: string, type: EntityTypeDef, group: GroupDef | undefined): string {
	const expanded = pattern.replace(PLACEHOLDER, (match, raw: string) => {
		switch (raw.toLowerCase()) {
			case "group":
				return sanitizeFileName(group?.name ?? "");
			case "entity":
				return sanitizeFileName(type.plural || type.name);
			default:
				return match;
		}
	});
	return joinPath(expanded);
}

/**
 * Resolve the folder a new entity note should be created in. `base` is the expanded folder pattern;
 * `parentFolder` is the folder of the note's hierarchy parent, if one is set.
 *  - "type":   <base>
 *  - "parent": <parent's folder>/<plural>, or <base> without a parent
 *  - "own":    <base>/<name>, or <parent's folder>/<name> with a parent
 */
export function resolveEntityFolder(type: EntityTypeDef, name: string, base: string, parentFolder?: string | null): string {
	switch (type.folderMode ?? "type") {
		case "parent":
			return parentFolder != null ? joinPath(parentFolder, sanitizeFileName(type.plural || type.name)) : joinPath(base);
		case "own":
			return joinPath(parentFolder != null ? parentFolder : base, sanitizeFileName(name));
		default:
			return joinPath(base);
	}
}

/** Return the first path not in `exists`, appending " 2", " 3", … before the extension. */
export function uniquePath(folder: string, baseName: string, exists: (path: string) => boolean): string {
	const make = (n: number) => joinPath(folder, `${baseName}${n > 1 ? ` ${n}` : ""}.md`);
	let n = 1;
	while (exists(make(n))) n++;
	return make(n);
}
