import { Modal, Notice, Setting } from "obsidian";
import { appContents, appFileName, exportApp, installApp, tidyDetails, type AppMode } from "../../model/apps";
import { newComponentId } from "../../model/layoutClipboard";
import { parsePack, type AppDetails, type TypePack } from "../../model/packs";
import { typeIssues } from "../../model/validation";
import { collectPackFiles, writePackFiles } from "../../services/packFiles";
import type EntitiesPlugin from "../../main";

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const list = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "nothing"));

/** "3 types in 2 groups, 4 workflows, …" */
function contentsText(c: ReturnType<typeof appContents>): string {
	return list(
		[
			`${plural(c.types, "type")} in ${plural(c.groups, "group")}`,
			c.workflows ? plural(c.workflows, "workflow") : "",
			c.views ? plural(c.views, "view note") : "",
			c.templates ? plural(c.templates, "template") : "",
			c.components ? plural(c.components, "saved component") : "",
		].filter(Boolean),
	);
}

/**
 * Save text to a file the user picks (the system's Save dialog), in `win`: the window that was clicked, since a file
 * picker only opens in a window handling a click (Settings has a window of its own). The picker opens before
 * anything is awaited, for the same reason; `text` is made while it's open. Falls back to a download where there's
 * no picker. Returns the file name saved as, or null when cancelled.
 */
async function saveToDisk(win: Window, fileName: string, text: () => Promise<string>): Promise<string | null> {
	type Handle = { name: string; createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> };
	const picker = (win as unknown as { showSaveFilePicker?: (o: unknown) => Promise<Handle> }).showSaveFilePicker;
	if (typeof picker === "function") {
		const picked = picker.call(win, { suggestedName: fileName, types: [{ description: "Entities app", accept: { "application/json": [".json"] } }] });
		const content = text();
		// Awaited below unless the picker is cancelled first.
		content.catch(() => undefined);
		try {
			const handle = await picked;
			const w = await handle.createWritable();
			await w.write(await content);
			await w.close();
			return handle.name;
		} catch (e) {
			if ((e as { name?: string }).name === "AbortError") return null;
			throw e;
		}
	}
	const a = win.document.createElement("a");
	a.href = URL.createObjectURL(new Blob([await text()], { type: "application/json" }));
	a.download = fileName;
	a.click();
	win.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	return fileName;
}

/** Export the whole configuration as an app file: details, then the system's Save dialog. */
export class ExportAppModal extends Modal {
	private details: AppDetails;

	constructor(private plugin: EntitiesPlugin) {
		super(plugin.app);
		const last = plugin.settings.appDetails;
		this.details = { name: last?.name ?? plugin.app.vault.getName(), version: last?.version ?? "1.0", author: last?.author ?? "", description: last?.description ?? "" };
	}

	onOpen(): void {
		this.modalEl.addClass("oe-app-modal");
		this.setTitle("Export as an app");
		const { contentEl } = this;
		const s = this.plugin.settings;
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Saves every group, type, workflow, view note, template and saved component in one file. Another vault imports it with Import app… (settings, or the Entities menu in the Entity browser). Notes aren't included.",
		});
		const summary = contentEl.createEl("p", { cls: "oe-app-summary", text: "Counting…" });
		void collectPackFiles(this.plugin, s.types, "all").then((files) => {
			summary.setText(
				`Includes ${contentsText({ types: s.types.length, groups: s.groups.length, workflows: s.workflows.length, workflowsOn: 0, views: files.views.length, templates: Object.keys(files.templates).length, components: s.layoutComponents.length })}.`,
			);
		});
		new Setting(contentEl).setName("Name").addText((t) => t.setValue(this.details.name).onChange((v) => (this.details.name = v)));
		new Setting(contentEl)
			.setName("Version")
			.setDesc("Part of the file name; bump it when you export changes.")
			.addText((t) => t.setPlaceholder("1.0").setValue(this.details.version ?? "").onChange((v) => (this.details.version = v)));
		new Setting(contentEl).setName("Author").addText((t) => t.setPlaceholder("Optional").setValue(this.details.author ?? "").onChange((v) => (this.details.author = v)));
		new Setting(contentEl)
			.setName("Description")
			.setClass("oe-app-desc")
			.addTextArea((t) => t.setPlaceholder("What it's for, what it holds (optional)").setValue(this.details.description ?? "").onChange((v) => (this.details.description = v)));
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Save…")
					.setCta()
					.onClick(() => void this.save()),
			);
	}

	private async save(): Promise<void> {
		if (!this.details.name.trim()) return void new Notice("Give the app a name.");
		const s = this.plugin.settings;
		const details = tidyDetails(this.details);
		const win = this.modalEl.ownerDocument.defaultView ?? window;
		let saved: string | null;
		try {
			saved = await saveToDisk(win, appFileName(details), async () => exportApp(s, details, await collectPackFiles(this.plugin, s.types, "all")));
		} catch (e) {
			new Notice(`Couldn't save the app: ${(e as Error).message}`);
			return;
		}
		if (!saved) return;
		s.appDetails = details;
		await this.plugin.saveSettings();
		new Notice(`Saved “${details.name}” as ${saved}.`);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Import an app file: what it holds, then replace the configuration with it or add it alongside. */
export class ImportAppModal extends Modal {
	private pack: TypePack | null = null;
	private mode: AppMode = "replace";
	private keepOn = false;
	private body!: HTMLElement;

	constructor(private plugin: EntitiesPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass("oe-app-modal");
		this.setTitle("Import an app");
		const { contentEl } = this;
		contentEl.createEl("p", { cls: "setting-item-description", text: "Choose an app file exported from Obsidian Entities (Export as an app). A type pack works too." });
		const input = contentEl.createEl("input", { attr: { type: "file", accept: ".json,application/json", "aria-label": "App file" } });
		input.hide();
		new Setting(contentEl).setName("App file").addButton((b) => b.setButtonText("Choose a file…").onClick(() => input.click()));
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (file) void file.text().then((text) => this.read(text));
			input.value = "";
		});
		this.body = contentEl.createDiv({ cls: "oe-app-body" });
	}

	private read(text: string): void {
		const parsed = parsePack(text);
		this.body.empty();
		if (!parsed.ok) {
			this.pack = null;
			this.body.createDiv({ cls: "oe-import-error", text: parsed.error });
			return;
		}
		this.pack = parsed.pack;
		this.keepOn = false;
		this.render();
	}

	private render(): void {
		const pack = this.pack;
		if (!pack) return;
		const el = this.body;
		el.empty();
		const s = this.plugin.settings;
		const c = appContents(pack);
		const head = el.createDiv({ cls: "oe-app-head" });
		head.createEl("h3", { text: `${pack.app?.name ?? pack.name ?? "Type pack"}${pack.app?.version ? ` ${pack.app.version}` : ""}` });
		if (pack.app?.author) head.createDiv({ cls: "oe-app-author", text: `By ${pack.app.author}` });
		if (pack.app?.description) head.createEl("p", { cls: "oe-app-description", text: pack.app.description });
		if (!pack.app) head.createEl("p", { cls: "setting-item-description", text: "This is a type pack rather than an app; it can still be imported." });
		head.createEl("p", { cls: "oe-app-summary", text: `Holds ${contentsText(c)}.` });

		new Setting(el)
			.setName("How to import")
			.addDropdown((d) =>
				d
					.addOption("replace", "Replace the current configuration")
					.addOption("add", "Add alongside the current configuration")
					.setValue(this.mode)
					.onChange((v) => {
						this.mode = v as AppMode;
						this.render();
					}),
			);
		const notes = el.createEl("ul", { cls: "oe-app-notes" });
		const note = (text: string, warn = false) => notes.createEl("li", { text, cls: warn ? "mod-warning" : undefined });
		if (this.mode === "replace") {
			note(`Your ${contentsText({ types: s.types.length, groups: s.groups.length, workflows: s.workflows.length, workflowsOn: 0, views: 0, templates: 0, components: s.layoutComponents.length })} are replaced by the app's.`, true);
			if (c.views || c.templates) note("View notes and templates with the same names as the app's are overwritten (a copy of each changed one goes to the trash first). Other view notes and templates are left as they are.");
			const keys = new Set(pack.types.map((t) => t.key));
			const orphans = this.plugin.index.all().filter((e) => !keys.has(e.type.key)).length;
			if (orphans) note(`${plural(orphans, "note")} use types the app doesn't have. They're left as they are, but aren't entities until a type with their key exists.`, true);
			const unsaved = this.plugin.unsavedEdits();
			if (unsaved) note(`${plural(unsaved, "unsaved change")} in the Entity types and Workflows views ${unsaved === 1 ? "is" : "are"} discarded.`, true);
		} else {
			note("The app's groups, types, workflows and saved components are added beside yours. Types whose key is already taken get a numbered key (task → task_2), and everything in the app follows.");
			if (c.views || c.templates) note("Its view notes and templates are written to your views and templates folders, numbered when a name is taken.");
		}
		if (c.workflowsOn)
			new Setting(el)
				.setName("Switch on its workflows")
				.setDesc(`${plural(c.workflowsOn, "workflow")} ${c.workflowsOn === 1 ? "was" : "were"} on when the app was exported. Leave this off to check them in the Workflows view and turn them on yourself.`)
				.addToggle((t) => t.setValue(this.keepOn).onChange((v) => (this.keepOn = v)));
		else if (c.workflows) note(`Its ${plural(c.workflows, "workflow")} come in switched off.`);
		const error = el.createDiv({ cls: "oe-import-error" });
		new Setting(el)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				b.setButtonText(this.mode === "replace" ? "Replace configuration" : "Add to configuration").onClick(() => void this.install(error));
				if (this.mode === "replace") b.setWarning();
				else b.setCta();
			});
	}

	private async install(errorEl: HTMLElement): Promise<void> {
		const pack = this.pack;
		if (!pack) return;
		const s = this.plugin.settings;
		const res = installApp(pack, s, this.mode, this.keepOn, newComponentId);
		const ctx = { typeKeys: res.types.map((t) => t.key), groupKeys: res.groups.map((g) => g.key) };
		const problems = res.types.filter((t) => res.added.includes(t.key)).flatMap((t) => typeIssues(t, ctx).map((i) => `${t.name}: ${i.message}`));
		if (problems.length) {
			errorEl.setText(problems.slice(0, 5).join("\n"));
			return;
		}
		const replace = this.mode === "replace";
		if (replace) this.plugin.discardEdits();
		const added = res.types.filter((t) => res.added.includes(t.key));
		const written = await writePackFiles(this.plugin, res, added, res.workflows, replace);
		s.groups = res.groups;
		s.types = res.types;
		s.workflows = res.allWorkflows;
		s.layoutComponents = res.components;
		s.deletedPackTypes = res.deletedPackTypes;
		if (replace && pack.app) s.appDetails = { ...pack.app };
		await this.plugin.saveSettings();
		this.plugin.workflows.trigger("log");
		const name = pack.app?.name ?? pack.name ?? "the pack";
		const on = res.workflows.filter((w) => w.on).length;
		const renamed = Object.entries(res.renamed).map(([a, b]) => `${a} → ${b}`);
		new Notice(
			`${replace ? "Replaced the configuration with" : "Added"} ${name}: ${list(
				[
					plural(res.added.length, "type"),
					res.workflows.length ? `${plural(res.workflows.length, "workflow")} (${on ? `${on} on` : "switched off"})` : "",
					written.views.length ? plural(written.views.length, "view note") : "",
					written.templates.length ? plural(written.templates.length, "template") : "",
					res.componentsAdded ? plural(res.componentsAdded, "saved component") : "",
				].filter(Boolean),
			)}.` +
				(written.replaced.length ? ` Overwrote ${plural(written.replaced.length, "file")} (the old ${written.replaced.length === 1 ? "version is" : "versions are"} in the trash).` : "") +
				(renamed.length ? ` Renamed keys: ${renamed.join(", ")}.` : ""),
			10_000,
		);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
