import { FuzzySuggestModal, type FuzzyMatch, type TFile } from "obsidian";
import type EntitiesPlugin from "../../main";
import { autoViewSpot, placeFor, sameSpot, viewSpot, type ViewSpot } from "../../model/viewPlace";

interface Spot {
	spot: ViewSpot;
	label: string;
	depth: number;
}

/** "Show under…": choose where the Entity Browser lists a view note (the Views section, a group, or a type). */
export class ViewPlaceModal extends FuzzySuggestModal<Spot> {
	constructor(
		private plugin: EntitiesPlugin,
		private file: TFile,
	) {
		super(plugin.app);
		this.setPlaceholder(`Where should "${file.basename}" be listed?`);
	}

	getItems(): Spot[] {
		const { types, groups } = this.plugin.settings;
		const out: Spot[] = [{ spot: { kind: "views" }, label: "Views", depth: 0 }];
		for (const g of groups) {
			out.push({ spot: { kind: "group", key: g.key }, label: g.name, depth: 0 });
			for (const t of types.filter((x) => x.group === g.key)) out.push({ spot: { kind: "type", key: t.key }, label: t.plural || t.name, depth: 1 });
		}
		for (const t of types.filter((x) => !groups.some((g) => g.key === x.group))) out.push({ spot: { kind: "type", key: t.key }, label: t.plural || t.name, depth: 0 });
		return out;
	}

	getItemText(item: Spot): string {
		return item.label;
	}

	renderSuggestion(match: FuzzyMatch<Spot>, el: HTMLElement): void {
		const { types, groups } = this.plugin.settings;
		const viewTypes = this.plugin.views.types(this.file.path);
		const now = viewSpot(viewTypes, this.plugin.views.place(this.file.path), types, groups);
		const item = match.item;
		el.addClass("oe-place-suggestion");
		el.style.paddingLeft = `calc(var(--size-4-3) + ${item.depth * 18}px)`;
		super.renderSuggestion(match, el);
		const notes: string[] = [];
		if (sameSpot(item.spot, now)) notes.push("here now");
		if (sameSpot(item.spot, autoViewSpot(viewTypes, types, groups))) notes.push("automatic");
		if (notes.length) el.createSpan({ cls: "oe-place-note", text: ` · ${notes.join(", ")}` });
	}

	onChooseItem(item: Spot): void {
		const { types, groups } = this.plugin.settings;
		void this.plugin.views.setPlace(this.file.path, placeFor(item.spot, this.plugin.views.types(this.file.path), types, groups));
	}
}
