import { Notice, TFile, TFolder, moment, normalizePath } from "obsidian";
import { buildFrontmatter, defaultFieldValue, fieldDisplay, mergeFrontmatter, type EntityFormValues, type FieldValue, type LabelledValue } from "../model/frontmatter";
import { parseLink } from "../model/links";
import { effectiveFolderPattern, expandFolderPattern, joinPath, resolveEntityFolder, sanitizeFileName, uniquePath } from "../model/paths";
import { defaultTemplate, renderTemplate } from "../model/templates";
import { retype } from "../model/form";
import { addLink, removeLink, type Edge } from "../model/relations";
import { COMMON_KEYS, groupOf, isListValued, statusesFor, storedFields, type EntityTypeDef, type GroupDef } from "../model/types";
import type EntitiesPlugin from "../main";

export interface CreateOptions {
	/** Open the new note after creating it. Default true. */
	open?: boolean;
	newTab?: boolean;
}

/** Blank form values for a type: first status, field defaults. */
export function emptyFormValues(type: EntityTypeDef, groups: GroupDef[], name = ""): EntityFormValues {
	const fields: Record<string, FieldValue> = {};
	for (const f of storedFields(type)) {
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

	/**
	 * Add a relationship link to a source note's frontmatter.
	 * `fieldKey` is a relation field of the source type, or "related".
	 */
	async addRelation(source: TFile, fieldKey: string, target: TFile, label?: string): Promise<void> {
		const entity = this.plugin.index.get(source.path);
		const field = entity?.type.fields.find((f) => f.key === fieldKey && f.kind === "relation");
		const isRelated = fieldKey === COMMON_KEYS.related;
		if (!field && !isRelated) throw new Error(`"${fieldKey}" is not a relation field of this note.`);
		const linktext = this.app.metadataCache.fileToLinktext(target, source.path, true);
		await this.app.fileManager.processFrontMatter(source, (fm: Record<string, unknown>) => {
			fm[fieldKey] = addLink(fm[fieldKey], linktext, {
				multiple: isRelated || (!!field && isListValued(field)),
				labelled: !!field?.labelled,
				label,
			});
		});
	}

	/**
	 * Remove the frontmatter link that produced `edge` (written on edge.source, which may be another note).
	 * Shows a notice with Undo, which restores the field's previous value. Returns the change made, if any.
	 */
	async removeRelation(edge: Edge): Promise<{ path: string; key: string; before: unknown; after: unknown } | null> {
		const source = this.app.vault.getAbstractFileByPath(edge.source);
		if (!(source instanceof TFile) || !edge.fieldKey) return null;
		const matches = (linkpath: string) => {
			const resolved = this.app.metadataCache.getFirstLinkpathDest(linkpath, source.path)?.path ?? null;
			return edge.target ? resolved === edge.target : !resolved && linkpath.toLowerCase() === edge.linktext.toLowerCase();
		};
		let previous: unknown;
		let next: unknown;
		let changed = false;
		await this.app.fileManager.processFrontMatter(source, (fm: Record<string, unknown>) => {
			if (fm[edge.fieldKey] === undefined) return;
			previous = JSON.parse(JSON.stringify(fm[edge.fieldKey]));
			next = removeLink(fm[edge.fieldKey], matches);
			changed = JSON.stringify(next) !== JSON.stringify(previous);
			fm[edge.fieldKey] = next;
		});
		if (!changed) return null;
		const targetName = edge.target ? (this.app.vault.getAbstractFileByPath(edge.target)?.name.replace(/\.md$/, "") ?? edge.linktext) : edge.linktext;
		const frag = document.createDocumentFragment();
		frag.append(`Removed ${source.basename} → ${targetName} (${edge.label ?? edge.fieldLabel}). `);
		const undo = frag.appendChild(document.createElement("a"));
		undo.href = "#";
		undo.textContent = "Undo";
		const notice = new Notice(frag, 8000);
		undo.addEventListener("click", (e) => {
			e.preventDefault();
			notice.hide();
			void this.app.fileManager.processFrontMatter(source, (fm: Record<string, unknown>) => {
				fm[edge.fieldKey] = previous;
			});
		});
		return { path: source.path, key: edge.fieldKey, before: previous, after: next };
	}

	/**
	 * Make a note an entity of `type`, or change an entity's type: adds the type's missing fields, keeps every
	 * existing value, and resets a status that isn't valid for the type. Tells the user what changed.
	 */
	async convertToEntity(file: TFile, type: EntityTypeDef): Promise<void> {
		let previousType: unknown;
		let statusReset = false;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			previousType = fm[COMMON_KEYS.type];
			statusReset = retype(fm, type, this.plugin.settings.groups).statusReset;
		});
		const was = typeof previousType === "string" ? this.plugin.getType(previousType) : undefined;
		const an = (n: string) => `${/^[aeiou]/i.test(n) ? "an" : "a"} ${n}`;
		const message = was && was.key !== type.key ? `"${file.basename}" is now ${an(type.name.toLowerCase())} (was ${an(was.name.toLowerCase())}).` : `"${file.basename}" is now ${an(type.name.toLowerCase())}.`;
		const reset = statusReset ? ` Its status was reset to “${statusesFor(type, this.plugin.settings.groups)[0]}”.` : "";
		this.offerMove(file, type, message + reset);
	}

	/** Where a note of `type` would be filed now, given its frontmatter (for "Move to …" after changing type). */
	folderForExisting(file: TFile, type: EntityTypeDef): string {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const values: EntityFormValues = { name: file.basename, status: "", tags: [], fields: fm as Record<string, FieldValue> };
		return this.folderFor(type, values);
	}

	/** Show `message`, adding "Move to <folder>" when the note isn't where the folder pattern puts its type. */
	private offerMove(file: TFile, type: EntityTypeDef, message: string): void {
		// The metadata cache may not have the new frontmatter yet; parent links are unchanged by a type change anyway.
		const target = this.folderForExisting(file, type);
		const current = file.parent?.path === "/" ? "" : (file.parent?.path ?? "");
		if (target.toLowerCase() === current.toLowerCase()) {
			new Notice(message);
			return;
		}
		const frag = document.createDocumentFragment();
		frag.append(`${message} `);
		const move = frag.appendChild(document.createElement("a"));
		move.href = "#";
		move.textContent = `Move to ${target || "the vault root"}/`;
		const notice = new Notice(frag, 10000);
		move.addEventListener("click", (e) => {
			e.preventDefault();
			notice.hide();
			void this.moveTo(file, target);
		});
	}

	/** Move a note into `folder` (created if needed), keeping its name unless taken. */
	async moveTo(file: TFile, folder: string): Promise<void> {
		const dest = await this.ensureFolder(folder);
		const folderObj = dest ? this.app.vault.getAbstractFileByPath(dest) : this.app.vault.getRoot();
		const taken = new Set(folderObj instanceof TFolder ? folderObj.children.map((c) => c.path.toLowerCase()) : []);
		const path = normalizePath(uniquePath(dest, file.basename, (p) => taken.has(p.toLowerCase())));
		await this.app.fileManager.renameFile(file, path);
	}
}
