import { Notice, TFile, TFolder, normalizePath } from "obsidian";
import { applyChange, copyName, entitiesText, type BulkChange } from "../model/bulk";
import { retype } from "../model/form";
import { uniquePath } from "../model/paths";
import { statusesFor, type EntityTypeDef } from "../model/types";
import type EntitiesPlugin from "../main";
import type { EntityRecord } from "./entityIndex";

/** Undo a bulk action (one step for every note it changed). */
export type BulkUndo = () => Promise<void>;

/** Changes to many notes at once: progress for big selections, failures collected, and one undo step. */
export class BulkActions {
	constructor(private plugin: EntitiesPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	private files(paths: string[]): TFile[] {
		return paths.map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
	}

	/** A progress notice for more than 20 items ("Updating 37 of 120…"), and the final summary with Undo and failures. */
	private progress(total: number, verb: string) {
		const notice = total > 20 ? new Notice(`${verb} 0 of ${total}…`, 0) : null;
		return {
			tick: (i: number) => notice?.setMessage(`${verb} ${i} of ${total}…`),
			done: () => notice?.hide(),
		};
	}

	private report(message: string, undo: BulkUndo | null, failed: { name: string; error: string }[]): void {
		if (message) {
			const frag = document.createDocumentFragment();
			frag.append(message);
			if (undo) {
				frag.append(" · ");
				const a = frag.appendChild(document.createElement("a"));
				a.href = "#";
				a.textContent = "Undo";
				const notice = new Notice(frag, 10000);
				a.addEventListener("click", (e) => {
					e.preventDefault();
					notice.hide();
					void undo();
				});
			} else new Notice(frag, 6000);
		}
		if (failed.length) {
			const list = failed.slice(0, 8).map((f) => `• ${f.name}: ${f.error}`);
			if (failed.length > 8) list.push(`…and ${failed.length - 8} more`);
			new Notice(`Couldn't change ${entitiesText(failed.length)}:\n${list.join("\n")}`, 15000);
		}
	}

	/**
	 * Apply a frontmatter change to each note. `changeFor` returns the change for a note (null skips it); notes it
	 * wouldn't change aren't written. Returns the undo (null when nothing changed). A null `message` reports only
	 * failures (board moves: the board shows the result, and Ctrl/Cmd+Z undoes it).
	 */
	async updateFrontmatter(
		paths: string[],
		changeFor: (entity: EntityRecord, file: TFile) => BulkChange | ((fm: Record<string, unknown>) => boolean) | null,
		message: ((changed: number, skipped: number) => string) | null,
	): Promise<BulkUndo | null> {
		const snapshots = new Map<TFile, Record<string, unknown>>();
		const failed: { name: string; error: string }[] = [];
		let skipped = 0;
		const files = this.files(paths);
		const prog = this.progress(files.length, "Updating");
		let i = 0;
		for (const file of files) {
			prog.tick(++i);
			const entity = this.plugin.index.get(file.path);
			const change = entity ? changeFor(entity, file) : null;
			if (!entity || !change) {
				skipped++;
				continue;
			}
			const mutate = typeof change === "function" ? change : (fm: Record<string, unknown>) => applyChange(fm, change);
			// Check on a copy first, so notes that wouldn't change aren't rewritten.
			const cached = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			if (!mutate(JSON.parse(JSON.stringify(cached)) as Record<string, unknown>)) continue;
			try {
				await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					const before = JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
					if (mutate(fm)) snapshots.set(file, before);
				});
			} catch (e) {
				failed.push({ name: file.basename, error: (e as Error).message });
			}
		}
		prog.done();
		const undo: BulkUndo | null = snapshots.size
			? async () => {
					for (const [file, before] of snapshots) {
						if (!this.app.vault.getAbstractFileByPath(file.path)) continue;
						await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
							for (const k of Object.keys(fm)) delete fm[k];
							Object.assign(fm, before);
						});
					}
					new Notice(`Undone: ${entitiesText(snapshots.size)} restored.`);
				}
			: null;
		if (message) this.report(snapshots.size ? message(snapshots.size, skipped) : `Nothing to change${skipped ? ` (${entitiesText(skipped)} skipped)` : ""}.`, undo, failed);
		else if (failed.length) this.report("", null, failed);
		return undo;
	}

	/** Change the type of each entity (fields added, values kept, status reset when not valid). */
	async changeType(paths: string[], type: EntityTypeDef): Promise<BulkUndo | null> {
		// Each note is first checked on a copy, so count resets per note, not per call.
		const resets = new Set<string>();
		const groups = this.plugin.settings.groups;
		return this.updateFrontmatter(
			paths,
			(entity) =>
				entity.type.key === type.key
					? null
					: (fm) => {
							if (retype(fm, type, groups).statusReset) resets.add(entity.path);
							return true;
						},
			(n, skipped) =>
				`Changed ${entitiesText(n)} to ${type.name}${skipped ? ` (${skipped} already ${type.plural || type.name})` : ""}.${resets.size ? ` Status reset to “${statusesFor(type, groups)[0]}” on ${resets.size}.` : ""}`,
		);
	}

	/** Move each note into a folder (created if needed). Undo moves them back. */
	async moveTo(paths: string[], folder: string): Promise<BulkUndo | null> {
		const files = this.files(paths);
		const moved: { file: TFile; from: string }[] = [];
		const failed: { name: string; error: string }[] = [];
		const prog = this.progress(files.length, "Moving");
		const target = normalizePath(folder || "/").replace(/^\/$/, "");
		let i = 0;
		for (const file of files) {
			prog.tick(++i);
			const parent = file.parent?.path === "/" ? "" : (file.parent?.path ?? "");
			if (parent.toLowerCase() === target.toLowerCase()) continue;
			const from = file.path;
			try {
				await this.plugin.factory.moveTo(file, target);
				moved.push({ file, from });
			} catch (e) {
				failed.push({ name: file.basename, error: (e as Error).message });
			}
		}
		prog.done();
		const undo: BulkUndo | null = moved.length
			? async () => {
					for (const m of moved) {
						if (this.app.vault.getAbstractFileByPath(m.from)) continue;
						const dir = m.from.includes("/") ? m.from.slice(0, m.from.lastIndexOf("/")) : "";
						await this.plugin.factory.ensureFolder(dir);
						await this.app.fileManager.renameFile(m.file, m.from);
					}
					new Notice(`Undone: ${entitiesText(moved.length)} moved back.`);
				}
			: null;
		this.report(moved.length ? `Moved ${entitiesText(moved.length)} to ${target || "the vault root"}/.` : "Nothing to move.", undo, failed);
		return undo;
	}

	/** Copy each note next to itself as "Name (copy)". Undo deletes the copies. */
	async duplicate(paths: string[]): Promise<BulkUndo | null> {
		const files = this.files(paths);
		const created: TFile[] = [];
		const failed: { name: string; error: string }[] = [];
		const prog = this.progress(files.length, "Duplicating");
		let i = 0;
		for (const file of files) {
			prog.tick(++i);
			try {
				const folder = file.parent ?? this.app.vault.getRoot();
				const taken = new Set(folder.children.filter((c): c is TFile => c instanceof TFile).map((c) => c.basename.toLowerCase()));
				const name = copyName(file.basename, taken);
				const dir = folder.path === "/" ? "" : folder.path;
				const path = normalizePath(uniquePath(dir, name, (p) => !!this.app.vault.getAbstractFileByPath(p)));
				created.push(await this.app.vault.create(path, await this.app.vault.read(file)));
			} catch (e) {
				failed.push({ name: file.basename, error: (e as Error).message });
			}
		}
		prog.done();
		const undo: BulkUndo | null = created.length
			? async () => {
					for (const f of created) if (this.app.vault.getAbstractFileByPath(f.path)) await this.app.fileManager.trashFile(f);
					new Notice(`Undone: ${created.length === 1 ? "the copy was" : `${created.length} copies were`} deleted.`);
				}
			: null;
		this.report(created.length ? `Duplicated ${entitiesText(created.length)}.` : "Nothing duplicated.", undo, failed);
		return undo;
	}

	/** Delete the notes (to the trash, following Obsidian's "Deleted files" setting). */
	async delete(paths: string[]): Promise<void> {
		const files = this.files(paths);
		const failed: { name: string; error: string }[] = [];
		const prog = this.progress(files.length, "Deleting");
		let i = 0;
		let done = 0;
		for (const file of files) {
			prog.tick(++i);
			try {
				await this.app.fileManager.trashFile(file);
				done++;
			} catch (e) {
				failed.push({ name: file.basename, error: (e as Error).message });
			}
		}
		prog.done();
		this.report(`Deleted ${entitiesText(done)}.`, null, failed);
	}

	/** Open each note in a new tab. */
	async open(paths: string[]): Promise<void> {
		for (const file of this.files(paths)) await this.app.workspace.getLeaf("tab").openFile(file, { active: false });
	}

	/** `[[Note A]]` lines for the clipboard. */
	async copyAsList(paths: string[]): Promise<void> {
		const lines = this.files(paths).map((f) => `[[${this.app.metadataCache.fileToLinktext(f, "", true)}]]`);
		await navigator.clipboard.writeText(lines.join("\n"));
		new Notice(`Copied ${lines.length === 1 ? "1 link" : `${lines.length} links`}.`);
	}

	/** Vault folders, for "Move to folder…". */
	folders(): TFolder[] {
		return this.app.vault.getAllFolders(true);
	}
}
