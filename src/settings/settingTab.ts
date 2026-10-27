import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type EntitiesPlugin from "../main";
import { DEFAULT_FOLDER_PATTERN, unknownPlaceholders } from "../model/paths";
import { ImportPackModal } from "../ui/modals/importPackModal";

export class EntitiesSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: EntitiesPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName("Folders").setHeading();
		let preview: HTMLElement;
		const renderPreview = () => {
			preview.empty();
			const unknown = unknownPlaceholders(s.folderPattern);
			if (unknown.length) {
				preview.createDiv({ cls: "oe-folder-warning", text: `Unknown placeholder${unknown.length === 1 ? "" : "s"}: ${unknown.map((u) => `{${u}}`).join(", ")}. Use {group} or {entity}.` });
			}
			const list = preview.createEl("ul", { cls: "oe-folder-preview" });
			for (const type of s.types) {
				const base = this.plugin.factory.matchExistingCase(this.plugin.factory.baseFolder(type));
				const li = list.createEl("li");
				li.createSpan({ cls: "oe-folder-preview-type", text: type.plural });
				const where =
					type.folderMode === "own"
						? `${base || "(vault root)"}/<name>/, or inside its parent's folder`
						: type.folderMode === "parent"
							? `<parent's folder>/${type.plural}/, or ${base || "(vault root)"}/ without a parent`
							: `${base || "(vault root)"}/`;
				li.createSpan({ cls: "oe-folder-preview-path", text: where });
			}
		};
		new Setting(containerEl)
			.setName("Entity folder")
			.setDesc(
				createFragment((f) => {
					f.appendText("Where new entities are created. ");
					f.createEl("code", { text: "{group}" });
					f.appendText(" is the group name and ");
					f.createEl("code", { text: "{entity}" });
					f.appendText(" the type's plural name, e.g. ");
					f.createEl("code", { text: DEFAULT_FOLDER_PATTERN });
					f.appendText(".");
				}),
			)
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_FOLDER_PATTERN)
					.setValue(s.folderPattern)
					.onChange(async (v) => {
						s.folderPattern = v.trim();
						renderPreview();
						// Only affects where new notes go: no need to re-index.
						await this.plugin.saveData(s);
					}),
			);
		preview = containerEl.createDiv({ cls: "oe-folder-preview-box" });
		renderPreview();
		new Setting(containerEl)
			.setName("Templates folder")
			.setDesc("Editable Markdown templates, one per entity type. Built-in templates are used until these files exist.")
			.addText((t) =>
				t.setValue(s.templatesFolder).onChange(async (v) => {
					s.templatesFolder = v.trim();
					await this.plugin.saveSettings();
				}),
			)
			.addButton((b) =>
				b.setButtonText("Generate templates").onClick(async () => {
					const n = await this.plugin.factory.generateTemplates();
					new Notice(n ? `Created ${n} template file${n === 1 ? "" : "s"}.` : "All template files already exist.");
				}),
			);

		new Setting(containerEl).setName("Behaviour").setHeading();
		new Setting(containerEl).setName("Open new entities in a new tab").addToggle((t) =>
			t.setValue(s.openInNewTab).onChange(async (v) => {
				s.openInNewTab = v;
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl)
			.setName("Prefill links from the active note")
			.setDesc("E.g. creating a person while viewing an organisation sets 'Works for' to that organisation.")
			.addToggle((t) =>
				t.setValue(s.prefillFromActive).onChange(async (v) => {
					s.prefillFromActive = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Entity types").setHeading();
		const custom = s.types.filter((t) => !t.builtIn).length;
		new Setting(containerEl)
			.setName("Types")
			.setDesc(`${s.types.length} types (${custom} custom) in ${s.groups.length} group${s.groups.length === 1 ? "" : "s"}: ${s.types.map((t) => t.name).join(", ")}.`)
			.addButton((b) =>
				b.setButtonText("Import types…").onClick(() => {
					const modal = new ImportPackModal(this.plugin);
					modal.onClose = () => {
						modal.contentEl.empty();
						this.display();
					};
					modal.open();
				}),
			);
	}
}
