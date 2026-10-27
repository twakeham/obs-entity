import { Modal, Notice, Setting } from "obsidian";
import { COMMON_KEYS, isListValued, type FieldDef } from "../../model/types";
import type { EntityRecord } from "../../services/entityIndex";
import type EntitiesPlugin from "../../main";
import { EntitySuggest } from "../components/entityPicker";

const RELATED_FIELD: FieldDef = {
	key: COMMON_KEYS.related,
	label: "Related",
	kind: "relation",
	multiple: true,
	targets: ["*"],
};

/** Add a relationship link from an entity: choose field, pick (or create) target, optional label. */
export class AddRelationModal extends Modal {
	private field: FieldDef;
	private target: EntityRecord | null = null;
	private label = "";

	constructor(
		private plugin: EntitiesPlugin,
		private entity: EntityRecord,
		fieldKey?: string,
	) {
		super(plugin.app);
		const fields = this.fields();
		this.field = fields.find((f) => f.key === fieldKey) ?? fields[0];
	}

	private fields(): FieldDef[] {
		return [...this.entity.type.fields.filter((f) => f.kind === "relation"), RELATED_FIELD];
	}

	onOpen(): void {
		this.modalEl.addClass("oe-add-relation-modal");
		this.setTitle(`Link from ${this.entity.name}`);
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName("Relationship").addDropdown((d) => {
			for (const f of this.fields()) {
				const current = this.entity.frontmatter[f.key];
				const single = !isListValued(f) && f.key !== COMMON_KEYS.related;
				d.addOption(f.key, single && current ? `${f.label} (replaces current)` : f.label);
			}
			d.setValue(this.field.key).onChange((key) => {
				this.field = this.fields().find((f) => f.key === key)!;
				this.target = null;
				this.render();
			});
		});

		let input: HTMLInputElement | null = null;
		let labelInput: HTMLInputElement | null = null;
		new Setting(contentEl).setName("Link to").addText((t) => {
			input = t.inputEl;
			t.setPlaceholder(this.target ? this.target.name : "Search…");
			new EntitySuggest(this.app, t.inputEl, this.plugin, {
				targets: this.field.targets,
				exclude: () => new Set([this.entity.path]),
				onPick: (e) => {
					this.target = e;
					t.setValue(e.name);
					if (this.field.labelled) labelInput?.focus();
					else void this.submit();
				},
			});
		});

		if (this.field.labelled) {
			new Setting(contentEl)
				.setName("Label")
				.setDesc("e.g. mentor, friend, rival")
				.addText((t) => {
					labelInput = t.inputEl;
					t.setValue(this.label).onChange((v) => (this.label = v.trim()));
					t.inputEl.addEventListener("keydown", (evt) => {
						if (evt.key === "Enter") {
							evt.preventDefault();
							void this.submit();
						}
					});
				});
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Add link")
					.setCta()
					.onClick(() => void this.submit()),
			);

		window.setTimeout(() => (input as HTMLInputElement | null)?.focus(), 0);
	}

	private async submit(): Promise<void> {
		if (!this.target) {
			new Notice("Pick a note to link to.");
			return;
		}
		try {
			await this.plugin.factory.addRelation(this.entity.file, this.field.key, this.target.file, this.label || undefined);
			this.close();
		} catch (e) {
			new Notice(`Could not add link: ${(e as Error).message}`);
		}
	}
}
