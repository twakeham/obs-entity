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
		const warning = (pattern: string) => {
			const unknown = unknownPlaceholders(pattern);
			return unknown.length ? `Unknown placeholder${unknown.length === 1 ? "" : "s"}: ${unknown.map((u) => `{${u}}`).join(", ")}. Use {group} or {entity}.` : "";
		};
		// Folder settings only affect where new notes go: save without re-indexing.
		const save = () => this.plugin.saveData(s);

		let preview: HTMLElement;
		const renderPreview = () => {
			preview.empty();
			const text = warning(s.folderPattern);
			if (text) preview.createDiv({ cls: "oe-folder-warning", text });
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
				if (typeof type.folderPattern === "string") li.createSpan({ cls: "oe-folder-preview-badge", text: "exception" });
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
						await save();
					}),
			);

		let exceptionsEl: HTMLElement;
		let addButton: { setDisabled(d: boolean): unknown } | null = null;
		const free = () => s.types.filter((t) => typeof t.folderPattern !== "string");
		const renderExceptions = () => {
			exceptionsEl.empty();
			for (const type of s.types.filter((t) => typeof t.folderPattern === "string")) {
				let current = type;
				const row = new Setting(exceptionsEl).setClass("oe-folder-exception");
				const warn = row.descEl.createDiv({ cls: "oe-folder-warning", text: warning(type.folderPattern ?? "") });
				row.addDropdown((d) => {
					for (const t of [type, ...free()]) d.addOption(t.key, t.plural);
					d.setValue(type.key).onChange(async (key) => {
						const next = s.types.find((t) => t.key === key);
						if (!next || next === current) return;
						next.folderPattern = current.folderPattern;
						delete current.folderPattern;
						current = next;
						renderExceptions();
						renderPreview();
						await save();
					});
				});
				row.addText((t) => {
					t.inputEl.addClass("oe-folder-exception-pattern");
					t.setPlaceholder("(vault root)")
						.setValue(type.folderPattern ?? "")
						.onChange(async (v) => {
							current.folderPattern = v.trim();
							warn.setText(warning(current.folderPattern));
							renderPreview();
							await save();
						});
				});
				row.addExtraButton((b) =>
					b
						.setIcon("x")
						.setTooltip("Remove exception")
						.onClick(async () => {
							delete current.folderPattern;
							renderExceptions();
							renderPreview();
							await save();
						}),
				);
			}
			addButton?.setDisabled(free().length === 0);
		};
		new Setting(containerEl)
			.setName("Folder exceptions")
			.setDesc("Give a type its own folder pattern instead of the one above. Same placeholders.")
			.addButton((b) => {
				addButton = b;
				b.setButtonText("Add exception").onClick(async () => {
					const type = free()[0];
					if (!type) return;
					type.folderPattern = s.folderPattern;
					renderExceptions();
					renderPreview();
					await save();
					exceptionsEl.querySelector<HTMLInputElement>(".oe-folder-exception:last-child input")?.focus();
				});
			});
		exceptionsEl = containerEl.createDiv({ cls: "oe-folder-exceptions" });
		preview = containerEl.createDiv({ cls: "oe-folder-preview-box" });
		renderExceptions();
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
		new Setting(containerEl)
			.setName("Show entity info card")
			.setDesc("A compact card with type, status, key fields and relationships at the top of entity notes. Each type chooses what its card shows.")
			.addToggle((t) =>
				t.setValue(s.showCard).onChange(async (v) => {
					s.showCard = v;
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
