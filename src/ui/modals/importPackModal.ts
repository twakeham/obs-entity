import { Modal, Notice, Setting } from "obsidian";
import { CRM_PACK, installPack, parsePack } from "../../model/packs";
import { typeIssues } from "../../model/validation";
import type EntitiesPlugin from "../../main";

/** Paste a type pack (JSON) and add its types. Until the Entity Types view exists, this is how types are added. */
export class ImportPackModal extends Modal {
	private text = "";
	private errorEl!: HTMLElement;
	private textarea!: HTMLTextAreaElement;

	constructor(private plugin: EntitiesPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass("oe-import-modal");
		this.setTitle("Import entity types");
		const { contentEl } = this;
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Paste a type pack, a single type, or a list of types as JSON. Types whose key is already taken get a numbered key.",
		});
		this.textarea = contentEl.createEl("textarea", { cls: "oe-import-text", attr: { placeholder: '{ "types": [ … ] }', spellcheck: "false" } });
		this.textarea.addEventListener("input", () => {
			this.text = this.textarea.value;
			this.errorEl.setText("");
		});
		this.errorEl = contentEl.createDiv({ cls: "oe-import-error" });

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Load example: Basic CRM").onClick(() => {
					this.text = JSON.stringify(CRM_PACK, null, 2);
					this.textarea.value = this.text;
				}),
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Import")
					.setCta()
					.onClick(() => void this.import()),
			);
	}

	private async import(): Promise<void> {
		const parsed = parsePack(this.text);
		if (!parsed.ok) {
			this.errorEl.setText(parsed.error);
			return;
		}
		const s = this.plugin.settings;
		const res = installPack(parsed.pack, s.groups, s.types, s.workflows);
		const ctx = { typeKeys: res.types.map((t) => t.key), groupKeys: res.groups.map((g) => g.key) };
		const problems = res.types.filter((t) => res.added.includes(t.key)).flatMap((t) => typeIssues(t, ctx).map((i) => `${t.name}: ${i.message}`));
		if (problems.length) {
			this.errorEl.setText(problems.slice(0, 5).join("\n"));
			return;
		}
		s.groups = res.groups;
		s.types = res.types;
		// Switched off: they start running once you've looked them over and turned them on.
		s.workflows = [...s.workflows, ...res.workflows];
		await this.plugin.saveSettings();
		const renamed = Object.entries(res.renamed).map(([a, b]) => `${a} → ${b}`);
		new Notice(
			`Added ${res.added.length} type${res.added.length === 1 ? "" : "s"}` +
				(res.addedGroups.length ? ` and ${res.addedGroups.length} group${res.addedGroups.length === 1 ? "" : "s"}` : "") +
				(res.workflows.length ? `, and ${res.workflows.length} workflow${res.workflows.length === 1 ? "" : "s"} (switched off: turn them on in the Workflows view)` : "") +
				(renamed.length ? `. Renamed keys: ${renamed.join(", ")}` : "") +
				".",
		);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
