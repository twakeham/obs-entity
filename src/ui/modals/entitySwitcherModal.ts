import { Keymap, SuggestModal, setIcon } from "obsidian";
import { parseTypedQuery } from "../../model/search";
import type { EntityTypeDef } from "../../model/types";
import type EntitiesPlugin from "../../main";
import { renderEntityMatch, searchEntities, type EntityMatch } from "../components/entityPicker";

type SwitcherItem = ({ kind: "entity" } & EntityMatch) | { kind: "create"; type: EntityTypeDef | null; name: string };

/** Quick switcher over entities only. Supports type prefixes like "person: ada", "people:" or "p ada". */
export class EntitySwitcherModal extends SuggestModal<SwitcherItem> {
	constructor(private plugin: EntitiesPlugin) {
		super(plugin.app);
		this.limit = 50;
		this.setPlaceholder("Find an entity… (filter by type with person: or a shortcut like p ada)");
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to open" },
			{ command: "ctrl/cmd ↵", purpose: "to open in new tab" },
			{ command: "type:", purpose: "to filter by type" },
			{ command: "esc", purpose: "to dismiss" },
		]);
		this.scope.register(["Mod"], "Enter", (evt) => {
			// SuggestModal only binds plain Enter; route Mod+Enter through the (internal) chooser.
			const chooser = (this as unknown as { chooser?: { useSelectedItem(e: KeyboardEvent): boolean } }).chooser;
			chooser?.useSelectedItem(evt);
			return false;
		});
	}

	getSuggestions(query: string): SwitcherItem[] {
		let { type, text, via } = parseTypedQuery(query, this.plugin.settings.types);
		let pool = type ? this.plugin.index.ofType(type.key) : this.plugin.index.all();
		let matches = searchEntities(pool, text, this.limit);
		// "p ada" might just be a name starting with "p": fall back to searching everything.
		if (via === "shortcut" && matches.length === 0) {
			type = null;
			text = query.trim();
			pool = this.plugin.index.all();
			matches = searchEntities(pool, text, this.limit);
		}
		const items: SwitcherItem[] = matches.map((m) => ({ kind: "entity", ...m }));
		if (text && !pool.some((e) => e.name.toLowerCase() === text.toLowerCase())) {
			items.push({ kind: "create", type, name: text });
		}
		return items;
	}

	renderSuggestion(item: SwitcherItem, el: HTMLElement): void {
		if (item.kind === "entity") {
			renderEntityMatch(el, item);
			return;
		}
		el.addClass("oe-suggestion", "oe-suggestion-create");
		const icon = el.createSpan({ cls: "oe-type-icon" });
		setIcon(icon, "plus");
		if (item.type) icon.style.setProperty("--oe-type-color", item.type.color);
		el.createDiv({
			cls: "oe-suggestion-main",
			text: item.type ? `Create ${item.type.name.toLowerCase()} "${item.name}"` : `Create entity "${item.name}"…`,
		});
	}

	onChooseSuggestion(item: SwitcherItem, evt: MouseEvent | KeyboardEvent): void {
		if (item.kind === "entity") {
			const newTab = Keymap.isModEvent(evt) ? "tab" : false;
			void this.app.workspace.getLeaf(newTab).openFile(item.entity.file);
			return;
		}
		this.plugin.openCreateModal(item.type, { name: item.name });
	}
}
