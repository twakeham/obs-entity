import { typeFolder, type EntityTypeDef } from "./types";

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

/**
 * Resolve the folder a new entity note should be created in.
 *  - "type":   <group root>/<type folder>
 *  - "parent": <parent's folder>/<type folder>, or as "type" without a parent
 *  - "own":    (<parent's folder> or <group root>/<type folder>)/<name>
 * `parentFolder` is the folder of the note's hierarchy parent, if one is set.
 */
export function resolveEntityFolder(type: EntityTypeDef, name: string, groupRoot: string, parentFolder?: string | null): string {
	const folder = typeFolder(type);
	switch (type.folderMode ?? "type") {
		case "parent":
			return parentFolder != null ? joinPath(parentFolder, folder) : joinPath(groupRoot, folder);
		case "own":
			return parentFolder != null ? joinPath(parentFolder, sanitizeFileName(name)) : joinPath(groupRoot, folder, sanitizeFileName(name));
		default:
			return joinPath(groupRoot, folder);
	}
}

/** Return the first path not in `exists`, appending " 2", " 3", … before the extension. */
export function uniquePath(folder: string, baseName: string, exists: (path: string) => boolean): string {
	const make = (n: number) => joinPath(folder, `${baseName}${n > 1 ? ` ${n}` : ""}.md`);
	let n = 1;
	while (exists(make(n))) n++;
	return make(n);
}
