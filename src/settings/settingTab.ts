import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type EntitiesPlugin from "../main";
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
		for (const group of s.groups) {
			const types = s.types.filter((t) => t.group === group.key).map((t) => t.plural);
			new Setting(containerEl)
				.setName(`${group.name} folder`)
				.setDesc(types.length ? `Root folder for ${types.join(", ")}.` : "No types in this group yet.")
				.addText((t) =>
					t.setValue(group.root).onChange(async (v) => {
						group.root = v.trim();
						await this.plugin.saveSettings();
					}),
				);
		}
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
