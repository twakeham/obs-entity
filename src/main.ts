import { Keymap, Notice, Plugin, TFile, type PaneType, type WorkspaceLeaf } from "obsidian";
import { isoDateAdapter, type DateAdapter } from "./model/dates";
import type { EntityFormValues, FieldValue } from "./model/frontmatter";
import { mergeSettings, type EntitiesSettings } from "./model/settings";
import { typeExplicitlyTargeted, type EntityTypeDef, type RelationTarget } from "./model/types";
import { EntityFactory } from "./services/entityFactory";
import { EntityIndex } from "./services/entityIndex";
import { RelationIndex } from "./services/relationIndex";
import { EntitiesSettingTab } from "./settings/settingTab";
import { TypePickerModal, typesForTargets } from "./ui/components/entityPicker";
import { CardManager } from "./ui/header/cardManager";
import { CreateEntityModal } from "./ui/modals/createEntityModal";
import { EntitySwitcherModal } from "./ui/modals/entitySwitcherModal";
import { ImportPackModal } from "./ui/modals/importPackModal";
import { HOVER_SOURCE } from "./ui/react/EntityChip";
import { CONNECTIONS_VIEW, ConnectionsView } from "./ui/views/ConnectionsView";

/** Obsidian 1.7+ lazily loads background tabs; make sure the leaf's real view exists. */
async function loadIfDeferred(leaf: WorkspaceLeaf): Promise<void> {
	const l = leaf as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> };
	if (typeof l.loadIfDeferred === "function") await l.loadIfDeferred();
}

export default class EntitiesPlugin extends Plugin {
	settings!: EntitiesSettings;
	index!: EntityIndex;
	relations!: RelationIndex;
	factory!: EntityFactory;
	private card!: CardManager;
	/** Date handling for date fields (ISO for now; a custom calendar can replace it). */
	dates: DateAdapter = isoDateAdapter;
	private typeCommandIds = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.index = new EntityIndex(this);
		this.relations = new RelationIndex(this);
		this.factory = new EntityFactory(this);
		this.card = new CardManager(this);
		this.relations.load();
		this.index.load();
		this.card.load();

		this.registerView(CONNECTIONS_VIEW, (leaf) => new ConnectionsView(leaf, this));
		this.registerHoverLinkSource(HOVER_SOURCE, { display: "Obsidian Entities", defaultMod: true });

		this.addSettingTab(new EntitiesSettingTab(this.app, this));
		this.addRibbonIcon("book-plus", "Entities: create entity", () => this.openCreateModal(null));
		this.addRibbonIcon("waypoints", "Entities: connections", () => void this.activateConnectionsView());

		this.addCommand({
			id: "create-entity",
			name: "Create entity",
			callback: () => this.openCreateModal(null),
		});
		this.addCommand({
			id: "find-entity",
			name: "Find entity",
			callback: () => new EntitySwitcherModal(this).open(),
		});
		this.addCommand({
			id: "open-connections",
			name: "Open connections panel",
			callback: () => void this.activateConnectionsView(),
		});
		this.addCommand({
			id: "convert-to-entity",
			name: "Convert current note to entity",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.pickTypeAndConvert(file);
				return true;
			},
		});
		this.addCommand({
			id: "import-types",
			name: "Import entity types…",
			callback: () => new ImportPackModal(this).open(),
		});
		this.addCommand({
			id: "generate-templates",
			name: "Generate template files",
			callback: async () => {
				const n = await this.factory.generateTemplates();
				new Notice(n ? `Created ${n} template file${n === 1 ? "" : "s"}.` : "All template files already exist.");
			},
		});
		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild entity index",
			callback: () => {
				this.index.rebuild();
				new Notice(`Indexed ${this.index.all().length} entities.`);
			},
		});
		this.registerTypeCommands();

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				const entity = this.index.get(file.path);
				if (entity) {
					menu.addItem((item) =>
						item
							.setTitle("Change entity type…")
							.setIcon("repeat")
							.setSection("action")
							.onClick(() => this.pickTypeAndConvert(file)),
					);
					return;
				}
				menu.addItem((item) =>
					item
						.setTitle("Convert to entity…")
						.setIcon("shapes")
						.setSection("action")
						.onClick(() => this.pickTypeAndConvert(file)),
				);
			}),
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());
	}

	onunload(): void {
		this.card?.unload();
	}

	/** Show the Connections panel in the right sidebar (reusing an existing one). */
	async activateConnectionsView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(CONNECTIONS_VIEW)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: CONNECTIONS_VIEW, active: true });
			leaf = right;
		}
		await loadIfDeferred(leaf);
		await workspace.revealLeaf(leaf);
	}

	/** Open a note by path. A mouse/keyboard event with Mod opens a new tab; a pane type opens there. */
	openPath(path: string, how?: MouseEvent | KeyboardEvent | PaneType | boolean): void {
		const target = how instanceof Event ? Keymap.isModEvent(how) : (how ?? false);
		void this.app.workspace.openLinkText(path, "", target);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.registerTypeCommands();
		// Type definitions may have changed; re-resolve every entity against them.
		if (this.index?.isReady()) this.index.rebuild();
	}

	getType(key: string): EntityTypeDef | undefined {
		return this.settings.types.find((t) => t.key === key);
	}

	/** One "Create <type>" command per type. Commands for deleted types become unavailable. */
	private registerTypeCommands(): void {
		for (const type of this.settings.types) {
			const id = `create-${type.key}`;
			if (this.typeCommandIds.has(id)) continue;
			this.typeCommandIds.add(id);
			const key = type.key;
			this.addCommand({
				id,
				name: `Create ${type.name.toLowerCase()}`,
				checkCallback: (checking) => {
					const t = this.getType(key);
					if (!t) return false;
					if (!checking) this.openCreateModal(t);
					return true;
				},
			});
		}
	}

	openCreateModal(type: EntityTypeDef | null, initial: Partial<EntityFormValues> = {}): void {
		if (!type) {
			new TypePickerModal(this, (t) => this.openCreateModal(t, initial)).open();
			return;
		}
		const prefill = this.contextValues(type);
		new CreateEntityModal(this, type, {
			...initial,
			fields: { ...prefill, ...(initial.fields ?? {}) },
		}).open();
	}

	/** Create an entity for a link that doesn't resolve yet. */
	createFromUnresolved(linktext: string, targets?: RelationTarget[]): void {
		const name = linktext.split("/").pop() ?? linktext;
		const candidates = typesForTargets(this, targets);
		if (candidates.length === 1) this.openCreateModal(candidates[0], { name });
		else new TypePickerModal(this, (t) => this.openCreateModal(t, { name }), candidates.length ? candidates : undefined).open();
	}

	pickTypeAndConvert(file: TFile): void {
		const current = this.index.get(file.path);
		new TypePickerModal(
			this,
			async (t) => {
				await this.factory.convertToEntity(file, t);
				new Notice(`"${file.basename}" is now a ${t.name.toLowerCase()}.`);
			},
			current ? this.settings.types.filter((t) => t.key !== current.type.key) : undefined,
			current ? `Change "${file.basename}" from ${current.type.name.toLowerCase()} to…` : `Make "${file.basename}" a…`,
		).open();
	}

	/**
	 * Field values inferred from the active note: the first relation field (parent fields first)
	 * that names the active note's type (or its group) as a target.
	 */
	private contextValues(type: EntityTypeDef): Record<string, FieldValue> {
		const fields: Record<string, FieldValue> = {};
		if (!this.settings.prefillFromActive) return fields;
		const active = this.index.getByFile(this.app.workspace.getActiveFile());
		if (!active) return fields;
		const parents = new Set(type.parentFields ?? []);
		const candidates = type.fields
			.filter((f) => f.kind === "relation" && typeExplicitlyTargeted(active.type, f.targets))
			.sort((a, b) => Number(parents.has(b.key)) - Number(parents.has(a.key)));
		// Otherwise an "any entity" field, e.g. a note's "About".
		const field = candidates[0] ?? type.fields.find((f) => f.kind === "relation" && (f.targets ?? []).includes("*"));
		if (field) {
			const lt = this.app.metadataCache.fileToLinktext(active.file, "", true);
			fields[field.key] = field.labelled ? [{ target: lt, label: "" }] : field.multiple ? [lt] : lt;
		}
		return fields;
	}
}
