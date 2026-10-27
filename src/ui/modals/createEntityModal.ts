import { Modal, Notice, Setting, setIcon, type TFile } from "obsidian";
import { isEmptyValue, type EntityFormValues, type FieldValue } from "../../model/frontmatter";
import { statusesFor, type EntityTypeDef, type FieldDef } from "../../model/types";
import { emptyFormValues } from "../../services/entityFactory";
import type EntitiesPlugin from "../../main";
import { RelationInput } from "../components/relationInput";
import { TypePickerModal, renderTypeIcon } from "../components/entityPicker";

export class CreateEntityModal extends Modal {
	private values: EntityFormValues;
	private showAll = false;

	constructor(
		private plugin: EntitiesPlugin,
		private type: EntityTypeDef,
		initial: Partial<EntityFormValues> = {},
		private onCreated?: (file: TFile) => void,
	) {
		super(plugin.app);
		const blank = emptyFormValues(type, plugin.settings.groups);
		this.values = { ...blank, ...initial, fields: { ...blank.fields, ...(initial.fields ?? {}) } };
	}

	onOpen(): void {
		this.modalEl.addClass("oe-create-modal");
		this.scope.register(["Mod"], "Enter", (evt) => {
			evt.preventDefault();
			void this.submit();
			return false;
		});
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ cls: "oe-modal-header" });
		renderTypeIcon(header, this.type, "oe-type-icon oe-type-icon-lg");
		header.createEl("h2", { text: `New ${this.type.name.toLowerCase()}` });
		const change = header.createEl("button", { cls: "clickable-icon oe-change-type", attr: { "aria-label": "Change type" } });
		setIcon(change, "repeat");
		change.addEventListener("click", () => {
			new TypePickerModal(this.plugin, (t) => {
				this.type = t;
				const blank = emptyFormValues(t, this.plugin.settings.groups);
				this.values.status = blank.status;
				this.values.fields = { ...blank.fields, ...this.values.fields };
				this.render();
			}).open();
		});

		let nameInput: HTMLInputElement | null = null;
		new Setting(contentEl).setName("Name").addText((t) => {
			nameInput = t.inputEl;
			t.setPlaceholder(`${this.type.name} name`)
				.setValue(this.values.name)
				.onChange((v) => {
					this.values.name = v;
					this.updateFolder();
				});
			t.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter" && !evt.isComposing) {
					evt.preventDefault();
					void this.submit();
				}
			});
		});

		new Setting(contentEl).setName("Status").addDropdown((d) => {
			const statuses = statusesFor(this.type, this.plugin.settings.groups);
			for (const s of statuses) d.addOption(s, s);
			if (!statuses.includes(this.values.status)) this.values.status = statuses[0];
			d.setValue(this.values.status).onChange((v) => (this.values.status = v));
		});

		const subtitle = new Set(this.type.card?.subtitle ?? []);
		const fields = this.type.fields;
		const visible = fields.filter((f) => this.showAll || f.inModal || f.required || subtitle.has(f.key) || this.hasValue(f));
		for (const field of visible) this.renderField(contentEl, field);

		const hidden = fields.length - visible.length;
		if (hidden > 0 || this.showAll) {
			const toggle = contentEl.createDiv({ cls: "oe-more-fields" });
			toggle
				.createEl("a", {
					text: this.showAll ? "Show fewer fields" : `Show ${hidden} more field${hidden === 1 ? "" : "s"}`,
					href: "#",
				})
				.addEventListener("click", (evt) => {
					evt.preventDefault();
					this.showAll = !this.showAll;
					this.render();
				});
		}

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Comma-separated.")
			.addText((t) =>
				t.setValue(this.values.tags.join(", ")).onChange((v) => {
					this.values.tags = v
						.split(",")
						.map((s) => s.trim().replace(/^#/, ""))
						.filter(Boolean);
				}),
			);

		const folder = contentEl.createDiv({ cls: "oe-create-folder" });
		const updateFolder = () => {
			const path = this.plugin.factory.folderFor(this.type, { ...this.values, name: this.values.name || this.type.name });
			folder.setText(`Will be created in ${path || "the vault root"}/`);
		};
		updateFolder();
		this.updateFolder = updateFolder;

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Create")
					.setCta()
					.onClick(() => void this.submit()),
			);

		window.setTimeout(() => (nameInput as HTMLInputElement | null)?.focus(), 0);
	}

	private updateFolder: () => void = () => {};

	private hasValue(f: FieldDef): boolean {
		return !isEmptyValue(this.values.fields[f.key]);
	}

	private renderField(parent: HTMLElement, field: FieldDef): void {
		const setting = new Setting(parent).setName(field.label + (field.required ? " *" : ""));
		if (field.description) setting.setDesc(field.description);
		const get = () => this.values.fields[field.key];
		const set = (v: FieldValue) => (this.values.fields[field.key] = v);

		switch (field.kind) {
			case "relation": {
				setting.settingEl.addClass("oe-relation-setting");
				new RelationInput(setting.controlEl, this.plugin, field, get, (v) => {
					set(v);
					if (this.type.parentFields?.includes(field.key)) this.updateFolder();
				});
				break;
			}
			case "textarea":
				setting.addTextArea((t) => t.setValue(String(get() ?? "")).onChange(set));
				break;
			case "number":
				setting.addText((t) => {
					t.inputEl.type = "number";
					t.setValue(get() == null ? "" : String(get())).onChange((v) => set(v === "" ? null : Number(v)));
				});
				break;
			case "boolean":
				setting.addToggle((t) => t.setValue(get() === true).onChange(set));
				break;
			case "select":
				setting.addDropdown((d) => {
					d.addOption("", "—");
					for (const o of field.options ?? []) d.addOption(o, o);
					d.setValue(String(get() ?? "")).onChange((v) => set(v || null));
				});
				break;
			case "multiselect": {
				setting.settingEl.addClass("oe-multiselect-setting");
				const box = setting.controlEl.createDiv({ cls: "oe-multiselect" });
				const chosen = () => (Array.isArray(get()) ? (get() as string[]) : []);
				for (const o of field.options ?? []) {
					const btn = box.createEl("button", { cls: "oe-option", text: o });
					btn.toggleClass("is-active", chosen().includes(o));
					btn.addEventListener("click", (evt) => {
						evt.preventDefault();
						const cur = chosen();
						const next = cur.includes(o) ? cur.filter((x) => x !== o) : (field.options ?? []).filter((x) => x === o || cur.includes(x));
						set(next);
						btn.toggleClass("is-active", next.includes(o));
					});
				}
				break;
			}
			case "list":
				setting.setDesc(field.description ?? "Comma-separated.");
				setting.addText((t) =>
					t.setValue(Array.isArray(get()) ? (get() as string[]).join(", ") : "").onChange((v) =>
						set(
							v
								.split(",")
								.map((s) => s.trim())
								.filter(Boolean),
						),
					),
				);
				break;
			case "url":
				setting.addText((t) => {
					t.inputEl.inputMode = "url";
					t.setPlaceholder("https://…").setValue(String(get() ?? "")).onChange((v) => set(v.trim() || null));
				});
				break;
			case "date": {
				const dates = this.plugin.dates;
				const base = field.description ?? "";
				const describe = (v: string) => {
					const r = dates.parse(v);
					setting.descEl.empty();
					setting.descEl.removeClass("oe-date-error");
					if (!r) {
						setting.descEl.setText(base);
						return;
					}
					if (r.ok) setting.descEl.setText(`→ ${r.display}`);
					else {
						setting.descEl.addClass("oe-date-error");
						setting.descEl.setText(r.error);
					}
				};
				setting.addText((t) =>
					t
						.setPlaceholder(dates.placeholder)
						.setValue(String(get() ?? ""))
						.onChange((v) => {
							set(v.trim() || null);
							describe(v);
						}),
				);
				describe(String(get() ?? ""));
				break;
			}
			default:
				setting.addText((t) => t.setValue(String(get() ?? "")).onChange((v) => set(v)));
		}
	}

	private async submit(): Promise<void> {
		if (!this.values.name.trim()) {
			new Notice("Please enter a name.");
			return;
		}
		const missing = this.type.fields.filter((f) => f.required && !this.hasValue(f)).map((f) => f.label);
		if (missing.length) {
			new Notice(`Required: ${missing.join(", ")}`);
			return;
		}
		const badDates = this.type.fields.filter((f) => f.kind === "date" && this.plugin.dates.parse(this.values.fields[f.key])?.ok === false);
		if (badDates.length) {
			new Notice(`Check the date in: ${badDates.map((f) => f.label).join(", ")}`);
			return;
		}
		try {
			const file = await this.plugin.factory.createEntity(this.type, this.values);
			this.close();
			this.onCreated?.(file);
		} catch (e) {
			new Notice(`Could not create ${this.type.name.toLowerCase()}: ${(e as Error).message}`);
		}
	}
}
