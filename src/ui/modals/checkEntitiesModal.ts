import { FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import type { FieldProblem } from "../../model/form";
import type { EntityRecord } from "../../services/entityIndex";
import type EntitiesPlugin from "../../main";
import { renderTypeIcon } from "../components/entityPicker";

interface Item {
	entity: EntityRecord;
	problems: FieldProblem[];
}

/** "Check entities": every entity whose values don't fit its type. Choosing one opens it. */
export class CheckEntitiesModal extends FuzzySuggestModal<Item> {
	constructor(
		private plugin: EntitiesPlugin,
		private items: Item[],
	) {
		super(plugin.app);
		this.modalEl.addClass("oe-check-modal");
		const notes = items.length === 1 ? "1 entity has" : `${items.length} entities have`;
		this.setPlaceholder(`${notes} problems. Type to filter, Enter to open.`);
		this.limit = 500;
	}

	getItems(): Item[] {
		return [...this.items].sort((a, b) => a.entity.name.localeCompare(b.entity.name));
	}

	getItemText(item: Item): string {
		return `${item.entity.name} ${item.entity.type.name} ${item.problems.map((p) => p.message).join(" ")}`;
	}

	renderSuggestion(match: FuzzyMatch<Item>, el: HTMLElement): void {
		const { entity, problems } = match.item;
		el.addClass("oe-suggestion", "oe-check-item");
		renderTypeIcon(el, entity.type);
		const main = el.createDiv({ cls: "oe-suggestion-main" });
		main.createDiv({ cls: "oe-suggestion-title", text: entity.name });
		const list = main.createEl("ul", { cls: "oe-check-problems" });
		for (const p of problems.slice(0, 3)) list.createEl("li", { cls: `is-${p.severity}`, text: p.message });
		if (problems.length > 3) list.createEl("li", { cls: "oe-check-more", text: `and ${problems.length - 3} more` });
		el.createSpan({ cls: "oe-suggestion-type", text: `${problems.length} ${problems.length === 1 ? "problem" : "problems"}` });
	}

	onChooseItem(item: Item, evt: MouseEvent | KeyboardEvent): void {
		this.plugin.openPath(item.entity.path, evt);
	}
}
