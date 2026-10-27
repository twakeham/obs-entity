import { Notice, TFile, TFolder, moment, normalizePath } from "obsidian";
import { buildFrontmatter, defaultFieldValue, fieldDisplay, mergeFrontmatter, type EntityFormValues, type FieldValue, type LabelledValue } from "../model/frontmatter";
import { parseLink } from "../model/links";
import { joinPath, resolveEntityFolder, sanitizeFileName, uniquePath } from "../model/paths";
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

	async ensureFolder(path: string): Promise<void> {
		if (!path) return;
		let current = "";
		for (const part of normalizePath(path).split("/")) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(`"${current}" exists and is not a folder.`);
			await this.app.vault.createFolder(current);
		}
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

	/** Folder a new note of this type would be created in. */
	folderFor(type: EntityTypeDef, values: EntityFormValues): string {
		const root = groupOf(type, this.plugin.settings.groups)?.root ?? "";
		return resolveEntityFolder(type, values.name.trim(), root, this.parentFolder(type, values));
	}

	async createEntity(type: EntityTypeDef, values: EntityFormValues, opts: CreateOptions = {}): Promise<TFile> {
		const name = values.name.trim();
		if (!name) throw new Error("A name is required.");
		const baseName = sanitizeFileName(name);
		if (!baseName) throw new Error("The name contains no usable characters.");

		const folder = this.folderFor(type, values);
		await this.ensureFolder(folder);
		const path = normalizePath(uniquePath(folder, baseName, (p) => !!this.app.vault.getAbstractFileByPath(p)));

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
