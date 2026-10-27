import { setIcon, type TFile } from "obsidian";
import { isListValued, type FieldDef } from "../../model/types";
import type { FieldValue, LabelledValue } from "../../model/frontmatter";
import type { EntityRecord } from "../../services/entityIndex";
import type EntitiesPlugin from "../../main";
import { EntitySuggest, renderTypeIcon } from "./entityPicker";

/**
 * Chip-based relation editor for the create dialog.
 * Values are link texts: string (single), string[] (multiple) or LabelledValue[] (labelled).
 */
export class RelationInput {
	private chipsEl: HTMLElement;
	private inputEl: HTMLInputElement;
	private many: boolean;

	constructor(
		container: HTMLElement,
		private plugin: EntitiesPlugin,
		private field: FieldDef,
		private getValue: () => FieldValue | undefined,
		private setValue: (v: FieldValue) => void,
	) {
		this.many = isListValued(field);
		container.addClass("oe-relation-input");
		this.chipsEl = container.createDiv({ cls: "oe-chips" });
		this.inputEl = container.createEl("input", {
			type: "text",
			cls: "oe-relation-search",
			attr: { placeholder: this.placeholder() },
		});
		new EntitySuggest(plugin.app, this.inputEl, plugin, {
			targets: field.targets,
			exclude: () => new Set(this.linktexts().map((l) => this.resolve(l)?.path).filter((p): p is string => !!p)),
			onPick: (entity) => this.add(entity),
		});
		this.render();
	}

	private placeholder(): string {
		const targets = this.field.targets ?? [];
		if (targets.length === 0 || targets.includes("*")) return "Search entities…";
		const names = this.plugin.settings.types
			.filter((t) => targets.includes(t.key) || targets.includes(`@${t.group}`))
			.map((t) => t.plural.toLowerCase());
		return names.length && names.length <= 3 ? `Search ${names.join(" / ")}…` : "Search entities…";
	}

	private linktext(file: TFile): string {
		return this.plugin.app.metadataCache.fileToLinktext(file, "", true);
	}

	private resolve(linktext: string): TFile | null {
		return this.plugin.app.metadataCache.getFirstLinkpathDest(linktext, "");
	}

	private linktexts(): string[] {
		const v = this.getValue();
		if (!v) return [];
		if (typeof v === "string") return [v];
		if (Array.isArray(v)) return (v as (string | LabelledValue)[]).map((x) => (typeof x === "string" ? x : x.target));
		return [];
	}

	private add(entity: EntityRecord): void {
		const lt = this.linktext(entity.file);
		if (!this.many) {
			this.setValue(lt);
		} else if (this.field.labelled) {
			const cur = (Array.isArray(this.getValue()) ? this.getValue() : []) as LabelledValue[];
			this.setValue([...cur, { target: lt, label: "" }]);
		} else {
			const cur = (Array.isArray(this.getValue()) ? this.getValue() : []) as string[];
			if (!cur.includes(lt)) this.setValue([...cur, lt]);
		}
		this.render();
		if (this.field.labelled) {
			const labels = this.chipsEl.querySelectorAll<HTMLInputElement>("input.oe-chip-label");
			labels[labels.length - 1]?.focus();
		} else if (this.many) {
			this.inputEl.focus();
		}
	}

	private remove(index: number): void {
		if (!this.many) {
			this.setValue(null);
		} else {
			const cur = [...((this.getValue() as unknown[]) ?? [])];
			cur.splice(index, 1);
			this.setValue(cur as FieldValue);
		}
		this.render();
	}

	render(): void {
		this.chipsEl.empty();
		const v = this.getValue();
		const entries: (string | LabelledValue)[] = v == null || v === "" ? [] : Array.isArray(v) ? (v as (string | LabelledValue)[]) : [String(v)];
		entries.forEach((entry, i) => {
			const lt = typeof entry === "string" ? entry : entry.target;
			const file = this.resolve(lt);
			const entity = this.plugin.index.getByFile(file);
			const chip = this.chipsEl.createDiv({ cls: "oe-chip" });
			if (entity) {
				chip.style.setProperty("--oe-type-color", entity.type.color);
				renderTypeIcon(chip, entity.type, "oe-chip-icon");
			}
			chip.createSpan({ cls: "oe-chip-text", text: file?.basename ?? lt });
			if (this.field.labelled && typeof entry !== "string") {
				const label = chip.createEl("input", {
					type: "text",
					cls: "oe-chip-label",
					attr: { placeholder: "label (e.g. mentor)" },
					value: entry.label,
				});
				label.addEventListener("input", () => {
					entry.label = label.value;
				});
			}
			const x = chip.createSpan({ cls: "oe-chip-remove", attr: { "aria-label": "Remove" } });
			setIcon(x, "x");
			x.addEventListener("click", () => this.remove(i));
		});
		this.inputEl.toggle(this.many || entries.length === 0);
	}
}
