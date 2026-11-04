import {
	AbstractInputSuggest,
	FuzzySuggestModal,
	prepareFuzzySearch,
	renderResults,
	setIcon,
	SuggestModal,
	type App,
	type FuzzyMatch,
	type SearchResult,
} from "obsidian";
import type { EntityRecord } from "../../services/entityIndex";
import { emptyFormValues } from "../../model/defaults";
import { groupOf, typeMatchesTarget, type EntityTypeDef, type RelationTarget } from "../../model/types";
import type EntitiesPlugin from "../../main";

export function renderTypeIcon(parent: HTMLElement, type: EntityTypeDef, cls = "oe-type-icon"): HTMLElement {
	const el = parent.createSpan({ cls });
	el.style.setProperty("--oe-type-color", type.color);
	setIcon(el, type.icon || "file");
	return el;
}

export interface EntityMatch {
	entity: EntityRecord;
	match: SearchResult | null;
	/** the alias that matched, if the match was on an alias rather than the name */
	alias?: string;
}

/** Fuzzy-search entities by name and aliases. Empty text returns most recently modified first. */
export function searchEntities(entities: EntityRecord[], text: string, limit = 50): EntityMatch[] {
	const q = text.trim();
	if (!q) {
		return [...entities]
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, limit)
			.map((entity) => ({ entity, match: null }));
	}
	const fuzzy = prepareFuzzySearch(q);
	const results: EntityMatch[] = [];
	for (const entity of entities) {
		let best: EntityMatch | null = null;
		const nameMatch = fuzzy(entity.name);
		if (nameMatch) best = { entity, match: nameMatch };
		for (const alias of entity.aliases) {
			const m = fuzzy(alias);
			if (m && (!best || (best.match && m.score > best.match.score))) best = { entity, match: m, alias };
		}
		if (best) results.push(best);
	}
	results.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
	return results.slice(0, limit);
}

/** Icon, name (with match highlight), subtitle (or folder) and type name. */
export function renderEntityMatch(el: HTMLElement, m: EntityMatch): void {
	el.addClass("oe-suggestion");
	renderTypeIcon(el, m.entity.type);
	const main = el.createDiv({ cls: "oe-suggestion-main" });
	const title = main.createDiv({ cls: "oe-suggestion-title" });
	if (m.match && !m.alias) renderResults(title, m.entity.name, m.match);
	else title.setText(m.entity.name);
	if (m.alias && m.match) {
		const aliasEl = title.createSpan({ cls: "oe-suggestion-alias" });
		renderResults(aliasEl, m.alias, m.match);
	}
	if (m.entity.subtitle) main.createDiv({ cls: "oe-suggestion-note", text: m.entity.subtitle });
	else if (m.entity.file.parent?.path && m.entity.file.parent.path !== "/") {
		main.createDiv({ cls: "oe-suggestion-note oe-suggestion-folder", text: m.entity.file.parent.path });
	}
	el.createSpan({ cls: "oe-suggestion-type", text: m.entity.type.name });
}

export type EntitySuggestion =
	| ({ kind: "entity" } & EntityMatch)
	| { kind: "create"; type: EntityTypeDef | null; name: string; candidates: EntityTypeDef[] }
	| ({ kind: "extra" } & ExtraSuggestion);

/** A choice listed before the notes (e.g. "This note" in a view's filters), shown when it matches what's typed. */
export interface ExtraSuggestion {
	label: string;
	icon: string;
	note?: string;
	onPick: () => void;
}

export interface EntitySuggestOptions {
	targets?: RelationTarget[];
	/** paths to hide from suggestions (already chosen, or the note itself) */
	exclude?: () => Set<string>;
	onPick: (entity: EntityRecord) => void;
	allowCreate?: boolean;
	/** a choice to list first (null: none just now) */
	extra?: () => ExtraSuggestion | null;
}

/** Concrete entity types that satisfy a relation's targets. */
export function typesForTargets(plugin: EntitiesPlugin, targets: RelationTarget[] | undefined): EntityTypeDef[] {
	return plugin.settings.types.filter((t) => typeMatchesTarget(t, targets));
}

/** Inline fuzzy picker attached to a text input, filtered by relation target types. */
export class EntitySuggest extends AbstractInputSuggest<EntitySuggestion> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private plugin: EntitiesPlugin,
		private opts: EntitySuggestOptions,
	) {
		super(app, inputEl);
		this.limit = 30;
	}

	getSuggestions(query: string): EntitySuggestion[] {
		const exclude = this.opts.exclude?.() ?? new Set<string>();
		const pool = this.plugin.index.matching(this.opts.targets).filter((e) => !exclude.has(e.path));
		const results: EntitySuggestion[] = searchEntities(pool, query, 30).map((m) => ({ kind: "entity", ...m }));
		const extra = this.opts.extra?.();
		if (extra && extra.label.toLowerCase().includes(query.trim().toLowerCase())) results.unshift({ kind: "extra", ...extra });
		const name = query.trim();
		const exact = this.plugin.index.matching(this.opts.targets).some((e) => e.name.toLowerCase() === name.toLowerCase());
		if ((this.opts.allowCreate ?? true) && name && !exact) {
			const candidates = typesForTargets(this.plugin, this.opts.targets);
			if (candidates.length > 0 && candidates.length <= 3) {
				for (const type of candidates) results.push({ kind: "create", type, name, candidates });
			} else if (candidates.length > 3) {
				results.push({ kind: "create", type: null, name, candidates });
			}
		}
		return results;
	}

	renderSuggestion(s: EntitySuggestion, el: HTMLElement): void {
		if (s.kind === "entity") {
			renderEntityMatch(el, s);
			return;
		}
		if (s.kind === "extra") {
			el.addClass("oe-suggestion", "oe-suggestion-extra");
			setIcon(el.createSpan({ cls: "oe-type-icon" }), s.icon);
			const main = el.createDiv({ cls: "oe-suggestion-main" });
			main.createDiv({ cls: "oe-suggestion-title", text: s.label });
			if (s.note) main.createDiv({ cls: "oe-suggestion-note", text: s.note });
			return;
		}
		el.addClass("oe-suggestion", "oe-suggestion-create");
		const icon = el.createSpan({ cls: "oe-type-icon" });
		setIcon(icon, "plus");
		if (s.type) icon.style.setProperty("--oe-type-color", s.type.color);
		el.createDiv({
			cls: "oe-suggestion-main",
			text: s.type ? `Create ${s.type.name.toLowerCase()} "${s.name}"` : `Create "${s.name}" as…`,
		});
	}

	selectSuggestion(s: EntitySuggestion): void {
		this.setValue("");
		this.close();
		if (s.kind === "entity") {
			this.opts.onPick(s.entity);
			return;
		}
		if (s.kind === "extra") {
			s.onPick();
			return;
		}
		const create = async (type: EntityTypeDef) => {
			const file = await this.plugin.factory.createEntity(type, emptyFormValues(type, this.plugin.settings.groups, s.name), { open: false });
			const entity = this.plugin.index.get(file.path);
			if (entity) this.opts.onPick(entity);
		};
		if (s.type) void create(s.type);
		else new TypePickerModal(this.plugin, (type) => void create(type), s.candidates).open();
	}
}

/** Fuzzy modal to choose an entity type. */
export class TypePickerModal extends FuzzySuggestModal<EntityTypeDef> {
	constructor(
		private plugin: EntitiesPlugin,
		private onChoose: (type: EntityTypeDef) => void,
		private only?: EntityTypeDef[],
		placeholder = "Choose an entity type…",
	) {
		super(plugin.app);
		this.setPlaceholder(placeholder);
	}

	getItems(): EntityTypeDef[] {
		return this.only ?? this.plugin.settings.types;
	}

	getItemText(t: EntityTypeDef): string {
		return [t.name, t.plural, ...(t.shortcuts ?? [])].join(" ");
	}

	renderSuggestion(item: FuzzyMatch<EntityTypeDef>, el: HTMLElement): void {
		el.addClass("oe-suggestion");
		renderTypeIcon(el, item.item);
		el.createDiv({ cls: "oe-suggestion-main", text: item.item.name });
		el.createSpan({ cls: "oe-suggestion-type", text: groupOf(item.item, this.plugin.settings.groups)?.name ?? "" });
	}

	onChooseItem(t: EntityTypeDef): void {
		this.onChoose(t);
	}
}
