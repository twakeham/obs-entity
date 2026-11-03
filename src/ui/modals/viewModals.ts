import { FuzzySuggestModal, Modal, Notice, Setting, type App, type FuzzyMatch, type TFile } from "obsidian";
import { AGG_FIELD_KINDS, AGG_LABELS, calcInfo, ROLLUP_AGGS, rollupLabel, rollupSources, SHARE_AGGS, SHOW_LABELS, sourceTypes, type ColumnDef, type RollupAgg, type RollupShow, type ViewDef, type ViewKind } from "../../model/views";
import { isCalculated, toKey } from "../../model/types";
import type EntitiesPlugin from "../../main";

/** Ask for a name (Save as…, Rename, New view). */
export class NameModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private initial: string,
		private button: string,
		private done: (name: string) => void | Promise<void>,
		/** the field's label (Name), and whether an empty value is accepted */
		private opts: { label?: string; allowEmpty?: boolean; desc?: string } = {},
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		let value = this.initial;
		const s = new Setting(this.contentEl).setName(this.opts.label ?? "Name").addText((t) => {
			t.setValue(value).onChange((v) => (value = v));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					void this.submit(value);
				}
			});
			window.setTimeout(() => t.inputEl.select(), 0);
		});
		if (this.opts.desc) s.setDesc(this.opts.desc);
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText(this.button)
				.setCta()
				.onClick(() => void this.submit(value)),
		);
	}

	private async submit(v: string): Promise<void> {
		const name = v.trim();
		if (!name && !this.opts.allowEmpty) return;
		this.close();
		await this.done(name);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** New entity view: which entities it shows, as a table or a board, and its name. */
export class NewViewModal extends Modal {
	constructor(
		private plugin: EntitiesPlugin,
		private preset: string,
		private done: (name: string, source: string, kind: ViewKind) => void | Promise<void>,
		private kind: ViewKind = "table",
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const { types, groups } = this.plugin.settings;
		this.titleEl.setText("New entity view");
		this.modalEl.addClass("oe-newview-modal");
		let source = this.preset || "*";
		const sourceName = () => (source === "*" ? "Entities" : source.startsWith("@") ? (groups.find((g) => `@${g.key}` === source)?.name ?? "Entities") : (types.find((t) => t.key === source)?.plural ?? "Entities"));
		let name = sourceName();
		let nameEdited = false;
		let nameInput: HTMLInputElement | null = null;
		new Setting(this.contentEl)
			.setName("Shows")
			.setDesc("Which entities the view lists. You can add filters afterwards.")
			.addDropdown((d) => {
				d.addOption("*", "All entities");
				for (const g of groups) d.addOption(`@${g.key}`, `Every type in ${g.name}`);
				for (const t of types) d.addOption(t.key, t.plural || t.name);
				d.setValue(source).onChange((v) => {
					source = v;
					if (!nameEdited && nameInput) nameInput.value = name = sourceName();
				});
			});
		new Setting(this.contentEl)
			.setName("Layout")
			.setDesc("A table, or a board of cards in buckets (by status, for example). You can switch at any time.")
			.addDropdown((d) =>
				d
					.addOption("table", "Table")
					.addOption("board", "Board")
					.setValue(this.kind)
					.onChange((v) => (this.kind = v as ViewKind)),
			);
		new Setting(this.contentEl)
			.setName("Name")
			.setDesc(`Saved as a note in ${this.plugin.settings.viewsFolder || "the vault root"}/.`)
			.addText((t) => {
				nameInput = t.inputEl;
				t.setValue(name).onChange((v) => {
					name = v;
					nameEdited = true;
				});
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						void this.submit(name, source);
					}
				});
				window.setTimeout(() => t.inputEl.select(), 0);
			});
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText("Create")
				.setCta()
				.onClick(() => void this.submit(name, source)),
		);
	}

	private async submit(name: string, source: string): Promise<void> {
		if (!name.trim()) {
			new Notice("Give the view a name.");
			return;
		}
		this.close();
		await this.done(name.trim(), source, this.kind);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Open entity view…: a picker of view notes. */
export class OpenViewModal extends FuzzySuggestModal<TFile> {
	constructor(private plugin: EntitiesPlugin) {
		super(plugin.app);
		this.setPlaceholder(plugin.views.all().length ? "Open an entity view…" : "No views yet. Use “New entity view” to create one.");
	}

	getItems(): TFile[] {
		return this.plugin.views.all();
	}

	getItemText(f: TFile): string {
		return f.basename;
	}

	renderSuggestion(m: FuzzyMatch<TFile>, el: HTMLElement): void {
		el.addClass("oe-suggestion");
		el.createDiv({ cls: "oe-suggestion-main", text: m.item.basename });
		el.createSpan({ cls: "oe-suggestion-type", text: m.item.parent?.path ?? "" });
	}

	onChooseItem(f: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.plugin.openPath(f.path, evt);
	}
}

/** Add or edit a roll-up column: relationship → aggregation → field → label. */
export class RollupModal extends Modal {
	constructor(
		private plugin: EntitiesPlugin,
		private def: ViewDef,
		private existing: Extract<ColumnDef, { kind: "rollup" }> | null,
		private done: (col: ColumnDef) => void,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.titleEl.setText(this.existing ? "Edit roll-up" : "Add roll-up");
		this.render();
	}

	private via = "";
	private agg: RollupAgg = "count";
	private field = "";
	private label = "";
	private show: RollupShow | "" = "";
	private started = false;

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const ctx = { types: this.plugin.settings.types, groups: this.plugin.settings.groups };
		const sources = rollupSources(this.def, ctx);
		if (!sources.length) {
			contentEl.createEl("p", { text: `The ${sourceTypes(this.def, ctx.types).map((t) => t.plural.toLowerCase()).join(", ") || "view's types"} have no relationships to roll up.` });
			return;
		}
		if (!this.started) {
			this.started = true;
			const r = this.existing?.rollup;
			this.via = r?.via ?? sources[0].via;
			this.agg = r?.agg ?? "count";
			this.field = r?.field ?? "";
			this.label = this.existing?.label ?? "";
			this.show = r?.show ?? "";
		}
		const source = sources.find((s) => s.via === this.via) ?? sources[0];
		const need = AGG_FIELD_KINDS[this.agg];
		const fields: { key: string; label: string }[] = [];
		for (const t of source.linked)
			for (const f of t.fields) {
				// Calculated fields count by what they give.
				const kind = isCalculated(f) ? calcInfo(t, f, ctx).kind : f.kind;
				if ((need === "any" || (need && need.includes(kind))) && !fields.some((x) => x.key === f.key)) fields.push({ key: f.key, label: `${f.label} (${t.name})` });
			}
		if (need && !fields.some((f) => f.key === this.field)) this.field = fields[0]?.key ?? "";

		new Setting(contentEl)
			.setName("Relationship")
			.setDesc("Outgoing fields of this view's types, and links from other types (incoming).")
			.addDropdown((d) => {
				for (const s of sources) d.addOption(s.via, `${s.label}${s.via.startsWith("in:") ? " (incoming)" : ""}`);
				d.setValue(source.via).onChange((v) => {
					this.via = v;
					this.render();
				});
			});
		new Setting(contentEl).setName("Summarise as").addDropdown((d) => {
			for (const a of ROLLUP_AGGS) d.addOption(a, AGG_LABELS[a]);
			d.setValue(this.agg).onChange((v) => {
				this.agg = v as RollupAgg;
				this.render();
			});
		});
		if (need) {
			new Setting(contentEl)
				.setName("Of field")
				.setDesc(fields.length ? "" : need === "any" ? "The linked types have no fields." : `The linked types have no ${need.join(" or ")} fields.`)
				.addDropdown((d) => {
					for (const f of fields) d.addOption(f.key, f.label);
					d.setValue(this.field).onChange((v) => (this.field = v));
				});
		}
		const canShare = SHARE_AGGS.includes(this.agg);
		const show = canShare ? this.show : "";
		if (canShare)
			new Setting(contentEl)
				.setName("Show as")
				.setDesc("The value, or each row's share of the total: of the whole view, or of the row's group (swimlane on a board).")
				.addDropdown((d) => {
					d.addOption("", "Value");
					for (const s of ["total", "group"] as const) d.addOption(s, SHOW_LABELS[s]);
					d.setValue(this.show).onChange((v) => {
						this.show = v as RollupShow | "";
						this.render();
					});
				});
		const auto = rollupLabel({ via: source.via, agg: this.agg, ...(this.field && need ? { field: this.field } : {}), ...(show ? { show } : {}) }, sourceTypes(this.def, ctx.types), ctx.types);
		new Setting(contentEl).setName("Column label").addText((t) => t.setPlaceholder(auto).setValue(this.label).onChange((v) => (this.label = v)));
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(this.existing ? "Save" : "Add column")
				.setCta()
				.setDisabled(!!need && !this.field)
				.onClick(() => {
					const label = this.label.trim();
					const taken = new Set(this.def.columns.filter((c) => c !== this.existing).map((c) => c.id));
					let id = this.existing?.id ?? toKey(label || auto) ?? "rollup";
					for (let n = 2; !this.existing && taken.has(id); n++) id = `${toKey(label || auto)}_${n}`;
					this.close();
					this.done({ kind: "rollup", id, rollup: { via: source.via, agg: this.agg, ...(need ? { field: this.field } : {}), ...(show ? { show } : {}) }, ...(label ? { label } : {}) });
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
