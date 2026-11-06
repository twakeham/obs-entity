import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type EntitiesPlugin from "../main";
import { datePresetLabels, FIELD_DATE_PRESETS, showDate } from "../model/fieldFormats";
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
		new Setting(containerEl)
			.setName("Views folder")
			.setDesc("Where entity views (notes with an entity-view block) are saved. Open entity view… lists the views in this folder.")
			.addText((t) =>
				t.setValue(s.viewsFolder).onChange(async (v) => {
					s.viewsFolder = v.trim();
					await this.plugin.saveSettings();
					void this.plugin.views.rebuild();
				}),
			);
		new Setting(containerEl)
			.setName("Open view notes as entity views")
			.setDesc("Show a view note as a full-tab table, like the Entity types editor. Off: view notes open as normal notes with the table inside. Either way, “Open as Markdown” / “Open as entity view” switch a tab.")
			.addToggle((t) =>
				t.setValue(s.openViewsAsTabs).onChange(async (v) => {
					s.openViewsAsTabs = v;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Default currency")
			.setDesc("The currency the “Currency” column format starts with, as a three-letter code (AUD, USD, EUR…). Each column can choose its own.")
			.addText((t) =>
				t
					.setPlaceholder("AUD")
					.setValue(s.defaultCurrency)
					.onChange(async (v) => {
						if (!/^[A-Za-z]{3}$/.test(v.trim())) return;
						s.defaultCurrency = v.trim().toUpperCase();
						await this.plugin.saveSettings();
					}),
			);
		this.dateFormatSetting(containerEl);

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
			.setName("Use the entity properties form")
			.setDesc(
				"On entity notes, replace Obsidian's Properties block with a form built from the note's type: only valid values can be entered, links are limited to the allowed types, and problems are flagged. Turn off to use Obsidian's Properties block. Source mode always shows the raw YAML.",
			)
			.addToggle((t) =>
				t.setValue(s.useForm).onChange(async (v) => {
					s.useForm = v;
					await this.plugin.saveSettings();
					this.plugin.refreshForms();
				}),
			);

		new Setting(containerEl).setName("Entity types").setHeading();
		const custom = s.types.filter((t) => !t.builtIn).length;
		new Setting(containerEl)
			.setName("Types")
			.setDesc(`${s.types.length} types (${custom} custom) in ${s.groups.length} group${s.groups.length === 1 ? "" : "s"}: ${s.types.map((t) => t.name).join(", ")}. Edit fields, relationships, groups and how types look in the Entity types view.`)
			.addButton((b) =>
				b.setButtonText("Import types…").onClick(() => {
					const modal = new ImportPackModal(this.plugin);
					modal.onClose = () => {
						modal.contentEl.empty();
						this.display();
					};
					modal.open();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText("Open entity types")
					.setCta()
					.onClick(() => {
						(this.app as unknown as { setting?: { close(): void } }).setting?.close();
						void this.plugin.activateTypes();
					}),
			);

		new Setting(containerEl).setName("Workflows").setHeading();
		const wfOn = s.workflows.filter((w) => w.on).length;
		new Setting(containerEl)
			.setName("Workflows")
			.setDesc(
				`${s.workflows.length} workflow${s.workflows.length === 1 ? "" : "s"} (${wfOn} on)${s.workflowsPaused ? ", all paused" : ""}. Set fields, tags and links automatically when notes are created or changed, or from buttons.`,
			)
			.addButton((b) =>
				b.setButtonText("Open workflows").onClick(() => {
					(this.app as unknown as { setting?: { close(): void } }).setting?.close();
					void this.plugin.activateWorkflows();
				}),
			);
		new Setting(containerEl)
			.setName("Pause all workflows")
			.setDesc("Nothing runs, automatically or from buttons, until you turn this off. Also in the Workflows view and the command palette.")
			.addToggle((t) =>
				t.setValue(s.workflowsPaused).onChange(async (v) => {
					await this.plugin.workflows.setPaused(v);
					this.display();
				}),
			);
	}

	/** Date display format: presets (shown for today) or a custom moment.js pattern. */
	private dateFormatSetting(containerEl: HTMLElement): void {
		const s = this.plugin.settings;
		const env = this.plugin.formatEnv();
		const example = (p: string) => showDate(env.today, p, env);
		const isPreset = FIELD_DATE_PRESETS.includes(s.dateFormat);
		let custom = isPreset ? "ddd D MMM YYYY" : s.dateFormat;
		const setting = new Setting(containerEl).setName("Date display format");
		const describe = () => setting.setDesc(`How dates are shown when a field (or view column) doesn't set its own format. Today: ${example(s.dateFormat)}. Notes always store YYYY-MM-DD.`);
		describe();
		let box: HTMLInputElement | null = null;
		setting.addDropdown((d) => {
			for (const p of datePresetLabels(example)) d.addOption(p.pattern, p.label);
			d.addOption("custom", "Custom…");
			d.setValue(isPreset ? s.dateFormat : "custom").onChange(async (v) => {
				s.dateFormat = v === "custom" ? custom : v;
				if (box) box.toggleClass("oe-hidden", v !== "custom");
				describe();
				await this.plugin.saveSettings();
			});
		});
		setting.addText((t) => {
			box = t.inputEl;
			t.inputEl.toggleClass("oe-hidden", isPreset);
			t.inputEl.setAttr("aria-label", "Custom date format");
			t.setPlaceholder("ddd D MMM YYYY")
				.setValue(custom)
				.onChange(async (v) => {
					if (!v.trim()) return;
					custom = v;
					s.dateFormat = v;
					describe();
					await this.plugin.saveSettings();
				});
		});
	}
}
