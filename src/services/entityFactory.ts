import { Notice, TFile, TFolder, moment, normalizePath } from "obsidian";
import { buildFrontmatter, defaultFieldValue, fieldDisplay, mergeFrontmatter, type EntityFormValues, type FieldValue, type LabelledValue } from "../model/frontmatter";
import { parseLink } from "../model/links";
import { effectiveFolderPattern, expandFolderPattern, joinPath, resolveEntityFolder, sanitizeFileName, uniquePath } from "../model/paths";
import { defaultTemplate, renderTemplate } from "../model/templates";
import { COMMON_KEYS, groupOf, statusesFor, type EntityTypeDef, type GroupDef } from "../model/types";
import type EntitiesPlugin from "../main";

export interface CreateOptions {
	/** Open the new note after creating it. Default true. */
	open?: boolean;
	newTab?: boolean;
}

/** Blank form values for a type: first status, field defaults. */
export function emptyFormValues(type: EntityTypeDef, groups: GroupDef[], name = ""): EntityFormValues {
	const fields: Record<string, FieldValue> = {};
	for (const f of type.fields) {
		const d = defaultFieldValue(f);
		if (d !== undefined) fields[f.key] = d;
	}
	return { name, status: statusesFor(type, groups)[0], tags: [], fields };
}

function firstLinktext(value: FieldValue | undefined): string | null {
	if (typeof value === "string") return value || null;
	if (Array.isArray(value) && value.length > 0) {
		const v = value[0] as string | LabelledValue;
		return typeof v === "string" ? v : v.target || null;
	}
	return null;
}

export class EntityFactory {
	constructor(private plugin: EntitiesPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	templatePath(type: EntityTypeDef): string {
		return normalizePath(joinPath(this.plugin.settings.templatesFolder, type.template || `${type.name}.md`));
	}

	async loadTemplate(type: EntityTypeDef): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(this.templatePath(type));
		if (file instanceof TFile) return this.app.vault.cachedRead(file);
		return defaultTemplate(type);
	}

	/** Write the built-in templates for any type that has no template file yet. Returns the number written. */
	async generateTemplates(): Promise<number> {
		let count = 0;
		for (const type of this.plugin.settings.types) {
			const path = this.templatePath(type);
			if (this.app.vault.getAbstractFileByPath(path)) continue;
			await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
			await this.app.vault.create(path, defaultTemplate(type));
			count++;
		}
		return count;
	}

	/**
	 * Create any missing folders along `path`, reusing existing folders whose names differ only in case
	 * (the file system may be case-insensitive). Returns the path with the existing folders' casing.
	 */
	async ensureFolder(path: string): Promise<string> {
		if (!path) return "";
		let current = "";
		for (const part of normalizePath(path).split("/")) {
			const parent = current ? this.app.vault.getAbstractFileByPath(current) : this.app.vault.getRoot();
			const sibling = parent instanceof TFolder ? parent.children.find((c) => c.name.toLowerCase() === part.toLowerCase()) : undefined;
			const next = current ? `${current}/${sibling?.name ?? part}` : (sibling?.name ?? part);
			if (sibling instanceof TFolder) {
				current = next;
				continue;
			}
			if (sibling) throw new Error(`"${next}" exists and is not a folder.`);
			await this.app.vault.createFolder(next);
			current = next;
		}
		return current;
	}

	/** Folder of the note's hierarchy parent: the first parent field (in priority order) with a resolvable link. */
	parentFolder(type: EntityTypeDef, values: EntityFormValues): string | null {
		for (const key of type.parentFields ?? []) {
			const linktext = firstLinktext(values.fields[key]);
			if (!linktext) continue;
			const file = this.app.metadataCache.getFirstLinkpathDest(parseLink(linktext)?.path ?? linktext, "");
			if (file) return file.parent?.path ?? "";
		}
		return null;
	}

	/** The folder pattern (global, or the type's exception) expanded for a type: where "type"-mode notes go. */
	baseFolder(type: EntityTypeDef): string {
		const pattern = effectiveFolderPattern(this.plugin.settings.folderPattern, type);
		return expandFolderPattern(pattern, type, groupOf(type, this.plugin.settings.groups));
	}

	/** Folder a new note of this type would be created in, using existing folders' casing where they exist. */
	folderFor(type: EntityTypeDef, values: EntityFormValues): string {
		return this.matchExistingCase(resolveEntityFolder(type, values.name.trim(), this.baseFolder(type), this.parentFolder(type, values)));
	}

	/** Rewrite the leading segments of `path` that match existing folders case-insensitively to their real names. */
	matchExistingCase(path: string): string {
		let folder: TFolder | null = this.app.vault.getRoot();
		const out: string[] = [];
		for (const part of path.split("/").filter(Boolean)) {
			const match: TFolder | undefined = folder?.children.find((c): c is TFolder => c instanceof TFolder && c.name.toLowerCase() === part.toLowerCase());
			out.push(match?.name ?? part);
			folder = match ?? null;
		}
		return out.join("/");
	}

	async createEntity(type: EntityTypeDef, values: EntityFormValues, opts: CreateOptions = {}): Promise<TFile> {
		const name = values.name.trim();
		if (!name) throw new Error("A name is required.");
		const baseName = sanitizeFileName(name);
		if (!baseName) throw new Error("The name contains no usable characters.");

		const folder = await this.ensureFolder(this.folderFor(type, values));
		const folderObj = folder ? this.app.vault.getAbstractFileByPath(folder) : this.app.vault.getRoot();
		const taken = new Set(folderObj instanceof TFolder ? folderObj.children.map((c) => c.path.toLowerCase()) : []);
		const path = normalizePath(uniquePath(folder, baseName, (p) => taken.has(p.toLowerCase())));

		const fieldStrings: Record<string, string> = {};
		for (const f of type.fields) fieldStrings[f.key] = fieldDisplay(values.fields[f.key]);
		const content = renderTemplate(await this.loadTemplate(type), {
			name,
			type,
			fields: fieldStrings,
			formatDate: (fmt) => (moment as unknown as () => { format(f: string): string })().format(fmt),
		});

		const file = await this.app.vault.create(path, content);
		const generated = buildFrontmatter(type, values);
		if (baseName !== name) generated[COMMON_KEYS.aliases] = [name];
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => mergeFrontmatter(fm, generated));
		// Index immediately so the new entity can be picked before the metadata cache catches up.
		this.plugin.index.update(file, { frontmatter: generated } as never);

		if (opts.open ?? true) {
			await this.app.workspace.getLeaf(opts.newTab ?? this.plugin.settings.openInNewTab).openFile(file);
		}
		return file;
	}

	/** Turn an existing note into an entity of the given type, adding any missing fields. Existing values win. */
	async convertToEntity(file: TFile, type: EntityTypeDef): Promise<void> {
		const values = emptyFormValues(type, this.plugin.settings.groups, file.basename);
		const generated = buildFrontmatter(type, values);
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const previousType = fm[COMMON_KEYS.type];
			mergeFrontmatter(fm, generated, true);
			fm[COMMON_KEYS.type] = type.key;
			if (previousType && previousType !== type.key) {
				new Notice(`Changed entity type from "${String(previousType)}" to "${type.key}".`);
			}
		});
	}
}
