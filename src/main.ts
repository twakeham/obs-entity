import { debounce, Keymap, MarkdownView, Menu, Notice, Plugin, TFile, WorkspaceLeaf, moment, normalizePath, stringifyYaml, type PaneType, type ViewState } from "obsidian";
import type { MomentLike } from "./model/formats";
import { showDate, type FormatEnv } from "./model/fieldFormats";
import { isoDateAdapter, type DateAdapter } from "./model/dates";
import type { EntityFormValues, FieldValue } from "./model/frontmatter";
import { mergeSettings, RIBBON_ICONS, type EntitiesSettings, type RibbonIconId } from "./model/settings";
import { propertyTypes } from "./model/propertyTypes";
import { subtitleOf } from "./model/card";
import { isCalculated, isListValued, typeExplicitlyTargeted, type EntityTypeDef, type FieldDef, type RelationTarget } from "./model/types";
import { EditHistory, entityProblems, fieldKindFor, writeKey, type CheckContext, type FieldProblem, type FormEdit } from "./model/form";
import { EntityFactory } from "./services/entityFactory";
import { BulkActions } from "./services/bulkActions";
import { EntityIndex } from "./services/entityIndex";
import { RelationIndex } from "./services/relationIndex";
import { EntitiesSettingTab } from "./settings/settingTab";
import { TypePickerModal, typesForTargets } from "./ui/components/entityPicker";
import { FormManager } from "./ui/header/formManager";
import { CheckEntitiesModal } from "./ui/modals/checkEntitiesModal";
import { CreateEntityModal } from "./ui/modals/createEntityModal";
import { EntitySwitcherModal } from "./ui/modals/entitySwitcherModal";
import { ImportPackModal } from "./ui/modals/importPackModal";
import { PackGalleryModal } from "./ui/modals/packGalleryModal";
import { HOVER_SOURCE } from "./ui/react/EntityChip";
import { SIDE_PANEL_VIEW, SidePanelView } from "./ui/views/SidePanelView";
import { BROWSER_VIEW, BrowserView } from "./ui/views/BrowserView";
import type { EntityRecord } from "./services/entityIndex";
import { TYPES_VIEW, TypesView } from "./ui/views/TypesView";
import { PALETTE } from "./ui/react/types/controls";
import { inferType, type InferNote } from "./model/inferType";
import { isDirty, isGroupDirty, type GroupDraft, type TypeDraft } from "./model/typeEditing";
import { calcCell, emptyBoard, emptyView, fieldColumn, formatCell, resolveColumn, serializeView, sourceTypes, typeViewDef, type ViewContext, type ViewDef, type ViewKind, type ViewRow, columnFromId } from "./model/views";
import { defaultBuckets } from "./model/board";
import { BIG_RUN, buttonIcon, buttonLabel, formsFor, inScope, moveViewPath, noteless, onNotes, runsOnce, workflowProblems, type FormTrigger, type WorkflowDef } from "./model/workflows";
import { WorkflowEngine } from "./services/workflows";
import { WORKFLOWS_VIEW, WorkflowsView } from "./ui/views/WorkflowsView";
import type { WorkflowsRequest } from "./ui/react/workflows/WorkflowManager";
import { confirmRun, WorkflowPickerModal } from "./ui/modals/workflowModals";
import { askForm } from "./ui/modals/workflowFormModal";
import { initialDates } from "./model/calendarView";
import { VIEW_BLOCK, ViewIndex } from "./services/viewIndex";
import { NewViewModal, OpenViewModal } from "./ui/modals/viewModals";
import { ViewBlock } from "./ui/views/viewBlock";
import { ENTITY_VIEW, EntityViewView } from "./ui/views/EntityViewView";

/**
 * Locale for number formats: Obsidian's language, refined by the system's region when they share a language
 * (Obsidian's "en" + a system "en-AU" gives "en-AU", so AUD shows as "$" and separators match the region).
 */
function numberLocale(): string {
	const app = moment.locale() || "en";
	let system = typeof navigator !== "undefined" ? navigator.language : "";
	try {
		// Desktop: the OS regional format (navigator.language is Chromium's UI language, often en-US).
		const req = (window as unknown as { require?: (m: string) => { remote?: { app?: { getSystemLocale?: () => string } } } }).require;
		system = req?.("electron").remote?.app?.getSystemLocale?.() || system;
	} catch {
		// not available (mobile): keep navigator.language
	}
	return system && system.toLowerCase().split("-")[0] === app.toLowerCase().split("-")[0] ? system : app;
}

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
	/** Actions on several selected entities (set field, tags, move, delete…). */
	bulk!: BulkActions;
	private form!: FormManager;
	/** View notes (notes with an `entity-view` block in the views folder). */
	views!: ViewIndex;
	/** Runs workflows (DESIGN §8.11). */
	workflows!: WorkflowEngine;
	/** Ctrl/Cmd+Z history for properties-form edits, per note. */
	formHistory = new EditHistory(20);
	/** Date handling for date fields (ISO for now; a custom calendar can replace it). */
	dates: DateAdapter = isoDateAdapter;
	private typeCommandIds = new Set<string>();
	/** Entity Types view drafts, kept for the session so closing the view doesn't lose edits. */
	typeDrafts = new Map<string, TypeDraft>();
	/** Workflows view drafts, kept for the session. */
	workflowDrafts = new Map<string, WorkflowDef>();
	groupDrafts = new Map<string, GroupDraft>();
	/** Nothing was saved when the plugin loaded: a new vault, offered the packs to start from. */
	private firstRun = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.index = new EntityIndex(this);
		this.relations = new RelationIndex(this);
		this.factory = new EntityFactory(this);
		this.bulk = new BulkActions(this);
		this.form = new FormManager(this);
		this.views = new ViewIndex(this);
		this.workflows = new WorkflowEngine(this);
		this.relations.load();
		this.index.load();
		this.workflows.load();
		// Subtitles with calculated fields need every note indexed; fill them in once the index settles.
		const calcSubtitles = debounce(() => this.refreshCalcSubtitles(), 300, true);
		this.registerEvent(this.index.on("updated", calcSubtitles));
		this.registerEvent(this.index.on("updated", () => this.uniqueCache.clear()));
		this.form.load();
		this.views.load();
		// A new vault (nothing saved yet): offer the packs to start from.
		if (this.firstRun) this.app.workspace.onLayoutReady(() => new PackGalleryModal(this, true).open());
		this.registerMarkdownCodeBlockProcessor(VIEW_BLOCK, (source, el, ctx) => ctx.addChild(new ViewBlock(this, source, el, ctx)));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.formHistory.rename(oldPath, file.path)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.formHistory.clear(file.path)));
		// Workflows offered on views follow a renamed view note, and drop a deleted one (drafts too).
		const followView = (from: string, to: string | null) => {
			moveViewPath([...this.workflowDrafts.values()], from, to);
			if (moveViewPath(this.settings.workflows, from, to)) void this.saveSettings().then(() => this.workflows.trigger("drafts"));
		};
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => followView(oldPath, file.path)));
		this.registerEvent(this.app.vault.on("delete", (file) => followView(file.path, null)));
		this.app.workspace.onLayoutReady(() => this.syncPropertyTypes());

		this.registerView(SIDE_PANEL_VIEW, (leaf) => new SidePanelView(leaf, this));
		this.registerView(TYPES_VIEW, (leaf) => new TypesView(leaf, this));
		this.registerView(BROWSER_VIEW, (leaf) => new BrowserView(leaf, this));
		this.registerView(ENTITY_VIEW, (leaf) => new EntityViewView(leaf, this));
		this.registerView(WORKFLOWS_VIEW, (leaf) => new WorkflowsView(leaf, this));
		this.patchViewNotes();
		const refresh = () => this.refreshViewActions();
		this.registerEvent(this.app.workspace.on("file-open", refresh));
		this.registerEvent(this.app.workspace.on("layout-change", refresh));
		this.registerEvent(this.views.on("updated", refresh));
		this.registerHoverLinkSource(HOVER_SOURCE, { display: "Obsidian Entities", defaultMod: true });

		this.addSettingTab(new EntitiesSettingTab(this.app, this));
		this.syncRibbon();

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
			name: "Open side panel (connections, preview)",
			callback: () => void this.activateSidePanel(),
		});
		this.addCommand({
			id: "open-browser",
			name: "Open entity browser",
			callback: () => void this.activateBrowser(),
		});
		this.addCommand({
			id: "configure-entity-types",
			name: "Configure entity types",
			callback: () => {
				const active = this.index.getByFile(this.app.workspace.getActiveFile());
				void this.activateTypes(active?.type.key);
			},
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
			id: "type-from-note",
			name: "Create entity type from current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!this.canInferType(file)) return false;
				if (!checking) void this.typeFromNote(file);
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
			id: "check-entities",
			name: "Check entities",
			callback: () => {
				const items = this.index
					.all()
					.map((entity) => ({ entity, problems: this.problemsFor(entity) }))
					.filter((x) => x.problems.length > 0);
				if (items.length === 0) new Notice(`No problems found in ${this.index.all().length} entities.`);
				else new CheckEntitiesModal(this, items).open();
			},
		});
		this.addCommand({
			id: "new-table-view",
			name: "New entity view (table or board)",
			callback: () => this.newView(this.index.getByFile(this.app.workspace.getActiveFile())?.type.key ?? ""),
		});
		this.addCommand({
			id: "open-entity-view",
			name: "Open entity view…",
			callback: () => new OpenViewModal(this).open(),
		});
		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild entity index",
			callback: () => {
				this.index.rebuild();
				new Notice(`Indexed ${this.index.all().length} entities.`);
			},
		});
		this.addCommand({
			id: "run-workflow",
			name: "Run workflow on this note…",
			checkCallback: (checking) => {
				const entity = this.index.getByFile(this.app.workspace.getActiveFile());
				const list = this.workflows.manualFor(entity);
				if (!entity || !list.length) return false;
				if (!checking) new WorkflowPickerModal(this, list, (wf) => void this.runWorkflow(wf, [entity.path])).open();
				return true;
			},
		});
		this.addCommand({
			id: "fill-in-form",
			name: "Fill in a form…",
			checkCallback: (checking) => {
				const list = this.settings.workflows.filter((w) => w.on && noteless(w));
				if (!list.length) return false;
				if (!checking) new WorkflowPickerModal(this, list, (wf) => void this.runWorkflow(wf, []), "Fill in a form…").open();
				return true;
			},
		});
		this.addCommand({
			id: "open-workflows",
			name: "Open workflows",
			callback: () => void this.activateWorkflows(),
		});
		this.addCommand({
			id: "undo-workflow-run",
			name: "Undo last workflow run",
			callback: () => void this.workflows.undoLast(),
		});
		this.addCommand({
			id: "toggle-workflows",
			name: "Pause or resume workflows",
			callback: async () => {
				await this.workflows.setPaused(!this.workflows.paused);
				new Notice(this.workflows.paused ? "Workflows paused." : "Workflows resumed.");
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
							.setTitle(`Configure the ${entity.type.name} type`)
							.setIcon("shapes")
							.setSection("action")
							.onClick(() => void this.activateTypes(entity.type.key)),
					);
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
				if (this.canInferType(file))
					menu.addItem((item) =>
						item
							.setTitle("Create entity type from this note…")
							.setIcon("sparkles")
							.setSection("action")
							.onClick(() => void this.typeFromNote(file)),
					);
			}),
		);
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.firstRun = !saved;
		this.settings = mergeSettings(saved);
		// Persist migrations right away so data.json matches what's in use.
		if (saved && saved.settingsVersion !== this.settings.settingsVersion) await this.saveData(this.settings);
	}

	onunload(): void {
		this.form?.unload();
		this.clearRibbon();
		this.clearWorkflowRibbon();
	}

	/** Re-place or remove the properties form in open notes (after its setting changes). */
	refreshForms(): void {
		this.form?.refreshAll();
	}

	/**
	 * Tell Obsidian's Properties panel which editor to use for each field: a date picker for date fields,
	 * number, checkbox, or list. Keys that different types use for different kinds are left alone.
	 */
	syncPropertyTypes(): void {
		const mtm = (this.app as unknown as { metadataTypeManager?: { setType?(name: string, type: string): void; getAssignedWidget?(name: string): string | null | undefined } })
			.metadataTypeManager;
		if (typeof mtm?.setType !== "function") return;
		for (const [key, type] of Object.entries(propertyTypes(this.settings.types).types)) {
			if (mtm.getAssignedWidget?.(key) !== type) mtm.setType(key, type);
		}
	}

	/** Show the side panel (connections, type preview) in the right sidebar, reusing the existing one. */
	async activateSidePanel(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(SIDE_PANEL_VIEW)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return;
			await right.setViewState({ type: SIDE_PANEL_VIEW, active: true });
			leaf = right;
		}
		await loadIfDeferred(leaf);
		await workspace.revealLeaf(leaf);
	}

	/** Show the entity browser in the left sidebar (reusing an existing one). */
	async activateBrowser(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(BROWSER_VIEW)[0];
		if (!leaf) {
			const left = workspace.getLeftLeaf(false);
			if (!left) return;
			await left.setViewState({ type: BROWSER_VIEW, active: true });
			leaf = left;
		}
		await loadIfDeferred(leaf);
		await workspace.revealLeaf(leaf);
	}

	/** "New <type> here": create a note whose parent field links to `parent` (and so is filed by its folder rule). */
	createChild(parent: EntityRecord, type: EntityTypeDef, fieldKey: string): void {
		const field = type.fields.find((f) => f.key === fieldKey);
		const lt = this.app.metadataCache.fileToLinktext(parent.file, "", true);
		const value: FieldValue = field?.labelled ? [{ target: lt, label: "" }] : field && isListValued(field) ? [lt] : lt;
		this.openCreateModal(type, { fields: { [fieldKey]: value } });
	}

	/** Open the Entity Types view in the main area (reusing an existing tab), optionally on one type. */
	async activateTypes(typeKey?: string | null): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(TYPES_VIEW)[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: TYPES_VIEW, active: true });
		}
		await loadIfDeferred(leaf);
		if (typeKey && leaf.view instanceof TypesView) leaf.view.update({ selected: typeKey });
		await workspace.revealLeaf(leaf);
		workspace.setActiveLeaf(leaf, { focus: true });
	}

	/** Open the Workflows view in the main area (reusing an existing tab), optionally on a workflow or a new one for a type. */
	async activateWorkflows(request: WorkflowsRequest = {}): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(WORKFLOWS_VIEW)[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: WORKFLOWS_VIEW, active: true });
		}
		await loadIfDeferred(leaf);
		if ((request.open || request.newFor || request.blank) && leaf.view instanceof WorkflowsView) leaf.view.showRequest(request);
		await workspace.revealLeaf(leaf);
		workspace.setActiveLeaf(leaf, { focus: true });
	}

	/** What the Workflows view shows ("new:<n>" for an unsaved one, "runs" for Recent runs), or null (no view, nothing open). */
	shownWorkflow(): string | null {
		const view = this.app.workspace.getLeavesOfType(WORKFLOWS_VIEW)[0]?.view;
		return view instanceof WorkflowsView ? view.state.selected : null;
	}

	/** Start an unsaved workflow (a copy, or a new one) and open it in the Workflows view. */
	openWorkflowDraft(wf: WorkflowDef): void {
		let n = 1;
		while (this.workflowDrafts.has(`new:${n}`)) n++;
		this.workflowDrafts.set(`new:${n}`, wf);
		void this.activateWorkflows({ open: `new:${n}`, tab: "edit" });
	}

	/** Open a note by path. A mouse/keyboard event with Mod opens a new tab; a pane type opens there. */
	openPath(path: string, how?: MouseEvent | KeyboardEvent | PaneType | boolean): void {
		const target = how instanceof Event ? Keymap.isModEvent(how) : (how ?? false);
		void this.app.workspace.openLinkText(path, "", target);
	}

	/** Write one frontmatter key from the properties form (undefined removes it), recording it for Ctrl/Cmd+Z. */
	async writeProperty(file: TFile, key: string, value: unknown, record = true): Promise<void> {
		let before: unknown;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			before = fm[key] === undefined ? undefined : JSON.parse(JSON.stringify(fm[key]));
			writeKey(fm, key, value);
		});
		if (record) this.formHistory.push(file.path, { key, before, after: value });
	}

	/** Undo the last properties-form edit on a note: starts writing the old value (or undoing a workflow run) and returns the edit (null when there's nothing to undo). */
	undoProperty(path: string): FormEdit | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		const edit = this.formHistory.pop(path);
		if (!edit) return null;
		if (edit.undo) {
			edit.undo().catch((e: Error) => new Notice(`Couldn't undo the workflow: ${e.message}`));
			return edit;
		}
		this.writeProperty(file, edit.key, edit.before, false).catch((e: Error) => new Notice(`Couldn't undo: ${e.message}`));
		return edit;
	}

	/** How links from `sourcePath` resolve, for checking an entity's values. */
	private uniqueCache = new Map<string, { path: string; name: string; value: unknown }[]>();
	checkContext(sourcePath: string): CheckContext {
		const env = this.formatEnv();
		return {
			types: this.settings.types,
			groups: this.settings.groups,
			dates: this.dates,
			resolve: (linkpath) => {
				const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
				return file ? { path: file.path, type: this.index.get(file.path)?.type ?? null } : null;
			},
			path: sourcePath,
			others: (typeKey, key) => {
				// Cached until the index changes (a table checks every row against every other).
				const id = `${typeKey}\u0000${key}`;
				let list = this.uniqueCache.get(id);
				if (!list) this.uniqueCache.set(id, (list = this.index.ofType(typeKey).map((e) => ({ path: e.path, name: e.name, value: e.frontmatter[key] }))));
				return list;
			},
			showDate: (d) => showDate(d, env.dateFormat, env),
		};
	}

	problemsFor(entity: EntityRecord): FieldProblem[] {
		return entityProblems(entity.type, entity.frontmatter, this.checkContext(entity.path));
	}

	/** Obsidian's assigned property type for a key ("text", "multitext", "date", …), when known. */
	propertyWidget(key: string): string | null {
		const mtm = (this.app as unknown as { metadataTypeManager?: { getAssignedWidget?(name: string): string | null | undefined } }).metadataTypeManager;
		return mtm?.getAssignedWidget?.(key) ?? null;
	}

	/** Whether a note can have a type worked out from it: not an entity, with properties. */
	canInferType(file: TFile | null): file is TFile {
		if (!file || file.extension !== "md" || this.index.get(file.path)) return false;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return !!fm && Object.keys(fm).some((k) => k !== "position");
	}

	/**
	 * "Create entity type from this note": work out a type from the note's properties (and, when it has an `entity`
	 * value, every other note with the same one) and open it as a new draft in the Entity types view. Saving it makes
	 * those notes its entities.
	 */
	async typeFromNote(file: TFile): Promise<void> {
		const cache = this.app.metadataCache;
		const sample = (f: TFile): InferNote => {
			const c = cache.getFileCache(f);
			const { position: _position, ...frontmatter } = (c?.frontmatter ?? {}) as Record<string, unknown>;
			return { path: f.path, frontmatter, headings: (c?.headings ?? []).filter((h) => h.level === 2).map((h) => h.heading) };
		};
		const notes = [sample(file)];
		const value = notes[0].frontmatter.entity;
		if (typeof value === "string" && value.trim())
			for (const f of this.app.vault.getMarkdownFiles())
				if (f !== file && !this.index.get(f.path) && cache.getFileCache(f)?.frontmatter?.entity === value) notes.push(sample(f));
		const inferred = inferType(notes, {
			types: this.settings.types,
			groups: this.settings.groups,
			resolve: (link, from) => cache.getFirstLinkpathDest(link, from)?.path ?? null,
			typeAt: (path) => this.index.get(path)?.type.key ?? null,
			widget: (key) => this.propertyWidget(key),
			color: PALETTE[this.settings.types.length % PALETTE.length],
		});
		await this.activateTypes();
		const leaf = this.app.workspace.getLeavesOfType(TYPES_VIEW)[0];
		if (leaf?.view instanceof TypesView) leaf.view.newType(inferred);
		new Notice(`Worked out the ${inferred.type.name} type from ${notes.length === 1 ? "this note" : `${notes.length} notes`}. Check its fields, then save it.`);
	}

	/** "Add to type": open the type editor with a draft field for an extra property of a note. */
	async addPropertyToType(typeKey: string, key: string, value: unknown): Promise<void> {
		const kind = fieldKindFor(value, this.propertyWidget(key));
		const label = key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
		const field: FieldDef = { key, label, kind };
		if (kind === "relation") {
			field.targets = ["*"];
			field.multiple = Array.isArray(value);
		}
		await this.activateTypes();
		const leaf = this.app.workspace.getLeavesOfType(TYPES_VIEW)[0];
		if (leaf?.view instanceof TypesView) leaf.view.addField(typeKey, field);
	}

	/** Subtitles that use calculated fields (the index leaves those parts out): worked out with every note in view. */
	refreshCalcSubtitles(): void {
		const uses = (t: EntityTypeDef) => !!t.card?.subtitle?.some((k) => isCalculated(t.fields.find((f) => f.key === k)));
		if (!this.settings.types.some(uses)) return;
		const { rows, ctx } = this.viewData();
		const env = this.formatEnv();
		for (const r of rows) {
			if (!uses(r.type)) continue;
			const rec = this.index.get(r.path);
			if (!rec) continue;
			rec.subtitle = subtitleOf(r.type, r.frontmatter, env, (f) => formatCell(calcCell(r, f, ctx), resolveColumn(fieldColumn(f.key), typeViewDef(r.type), ctx), undefined, ctx).text);
		}
	}

	/** How field values are shown and read: display formats, the Date display format setting, number locale. */
	formatEnv(): FormatEnv {
		const now = new Date();
		return {
			dates: this.dates,
			moment: moment as unknown as MomentLike,
			locale: numberLocale(),
			currency: this.settings.defaultCurrency,
			today: Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000),
			dateFormat: this.settings.dateFormat,
		};
	}

	/** Rows and context for entity views, built from the current index. */
	viewData(): { rows: ViewRow[]; ctx: ViewContext } {
		const rows: ViewRow[] = this.index.all().map((e) => ({ ...e, folder: e.file.parent && e.file.parent.path !== "/" ? e.file.parent.path : "" }));
		const byPath = new Map(rows.map((r) => [r.path, r]));
		const now = new Date();
		const ctx: ViewContext = {
			types: this.settings.types,
			groups: this.settings.groups,
			dates: this.dates,
			today: Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000),
			resolve: (linkpath, sourcePath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null,
			row: (path) => byPath.get(path),
			incoming: (path) => this.relations.incomingOf(path).map((e) => ({ source: e.source, sourceType: e.sourceType, fieldKey: e.fieldKey })),
			moment: moment as unknown as MomentLike,
			locale: numberLocale(),
			currency: this.settings.defaultCurrency,
			dateFormat: this.settings.dateFormat,
		};
		return { rows, ctx };
	}

	/** Starting columns for a new view: name, type (when several), status, then up to four fields. A board starts with status buckets, a calendar with each type's date fields. */
	defaultView(source: string, kind: ViewKind = "table"): ViewDef {
		const def = emptyView([source || "*"]);
		const types = sourceTypes(def, this.settings.types);
		const ids = ["name", ...(types.length > 1 ? ["type"] : []), "status"];
		const fields = types.length === 1 ? [...types[0].fields.filter((f) => f.inModal), ...types[0].fields.filter((f) => !f.inModal)] : [];
		def.columns = ids.map(columnFromId);
		for (const f of fields.slice(0, 4)) def.columns.push(fieldColumn(f.key));
		if (types.length > 1) def.columns.push(columnFromId("modified"));
		if (kind === "board") {
			def.kind = "board";
			const lookup = { types: this.settings.types, groups: this.settings.groups };
			def.board = { ...emptyBoard(), buckets: defaultBuckets(def, lookup) };
		}
		if (kind === "calendar") {
			def.kind = "calendar";
			def.calendar = { dates: initialDates(types) };
		}
		return def;
	}

	/** Create a view note in the views folder and open it. */
	async createViewNote(name: string, def: ViewDef): Promise<TFile> {
		const file = await this.writeViewNote(name, def);
		const leaf = this.app.workspace.getLeaf(this.settings.openInNewTab);
		await leaf.openFile(file);
		// Put the cursor after the block, so Live Preview shows the table rather than its source.
		const view = leaf.view;
		if (view instanceof MarkdownView) view.editor.setCursor(view.editor.lastLine(), 0);
		return file;
	}

	/** Write a view note in the views folder (numbered when the name is taken). */
	async writeViewNote(name: string, def: ViewDef): Promise<TFile> {
		const first = await this.viewNotePath(name);
		const stem = first.slice(0, -".md".length);
		let path = first;
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${stem} ${n}.md`;
		const file = await this.app.vault.create(path, this.viewNoteText(def));
		this.views.add(file.path, def.kind);
		return file;
	}

	/** Where a view note of this name goes in the views folder (made if missing), before any numbering. */
	async viewNotePath(name: string): Promise<string> {
		const folder = await this.factory.ensureFolder(normalizePath(this.settings.viewsFolder.trim() || "/").replace(/^\/$/, ""));
		const base = name.replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || "View";
		return normalizePath(`${folder ? `${folder}/` : ""}${base}.md`);
	}

	/** A view note's text: the view's block. */
	viewNoteText(def: ViewDef): string {
		return `\`\`\`${VIEW_BLOCK}\n${stringifyYaml(serializeView(def))}\`\`\`\n`;
	}

	/** "New entity view": ask for the source, layout and name, then create the note. */
	newView(preset = "", kind: ViewKind = "table"): void {
		new NewViewModal(
			this,
			preset,
			async (name, source, k) => {
				await this.createViewNote(name, this.defaultView(source, k));
			},
			kind,
		).open();
	}

	/** Tabs showing a view note as Markdown on purpose ("Open as Markdown"): leaf → that note's path. */
	viewAsMarkdown = new WeakMap<WorkspaceLeaf, string>();
	private viewActions = new WeakMap<MarkdownView, HTMLElement>();

	/**
	 * Open view notes as entity view tabs: a Markdown open of a view note becomes an entity view, unless the tab
	 * asked for Markdown for that note. (The approach Kanban uses for its board notes.)
	 */
	private patchViewNotes(): void {
		const plugin = this;
		const proto = WorkspaceLeaf.prototype as WorkspaceLeaf & { setViewState(state: ViewState, eState?: unknown): Promise<void> };
		const original = proto.setViewState;
		proto.setViewState = function (this: WorkspaceLeaf, state: ViewState, eState?: unknown) {
			const path = (state?.state as { file?: unknown } | undefined)?.file;
			if (state?.type === "markdown" && typeof path === "string") {
				const forced = plugin.viewAsMarkdown.get(this);
				if (forced && forced !== path) plugin.viewAsMarkdown.delete(this);
				if (plugin.settings.openViewsAsTabs && forced !== path && plugin.views?.has(path)) state = { ...state, type: ENTITY_VIEW, state: { file: path } };
			}
			return original.call(this, state, eState);
		};
		this.register(() => {
			proto.setViewState = original;
		});
	}

	/** Show a view note as an entity view tab. */
	async openAsEntityView(leaf: WorkspaceLeaf, path: string): Promise<void> {
		this.viewAsMarkdown.delete(leaf);
		await leaf.setViewState({ type: ENTITY_VIEW, state: { file: path } });
	}

	/** View notes shown as Markdown get an "Open as entity view" button in their header. */
	private refreshViewActions(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			const path = view.file?.path;
			const isView = !!path && this.views.has(path);
			const el = this.viewActions.get(view);
			if (isView && !el) this.viewActions.set(view, view.addAction("table", "Open as entity view", () => view.file && void this.openAsEntityView(leaf, view.file.path)));
			else if (!isView && el) {
				el.remove();
				this.viewActions.delete(view);
			}
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.registerTypeCommands();
		this.syncPropertyTypes();
		// Type definitions may have changed; re-resolve every entity against them.
		if (this.index?.isReady()) this.index.rebuild();
	}

	/** Unsaved edits in the Entity types and Workflows views (types, groups and workflows new or changed). */
	unsavedEdits(): number {
		const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
		const types = [...this.typeDrafts.values()].filter((d) => !d.original || isDirty(d)).length;
		const groups = [...this.groupDrafts.values()].filter((d) => !d.original || isGroupDirty(d)).length;
		const wfs = [...this.workflowDrafts.entries()].filter(([id, w]) => {
			const saved = this.settings.workflows.find((x) => x.id === id);
			return !saved || !same(saved, w);
		}).length;
		return types + groups + wfs;
	}

	/** Drop every unsaved edit in the Entity types and Workflows views, and show them afresh. */
	discardEdits(): void {
		this.typeDrafts = new Map();
		this.groupDrafts = new Map();
		this.workflowDrafts.clear();
		for (const leaf of this.app.workspace.getLeavesOfType(TYPES_VIEW)) if (leaf.view instanceof TypesView) leaf.view.remount();
		this.workflows.trigger("drafts");
	}

	/**
	 * Run a button or form workflow on notes (none: a form that starts on its own). A form asks its questions first
	 * (once, for every note); a button its confirmation; a big selection asks too.
	 */
	async runWorkflow(wf: WorkflowDef, paths: string[]): Promise<void> {
		const confirm = wf.trigger.kind === "manual" ? wf.trigger.confirm : undefined;
		const many = paths.length > BIG_RUN;
		if (confirm || many) {
			const body = [confirm, many ? (runsOnce(wf) ? `It runs once, on all ${paths.length} notes together. You can undo it afterwards.` : `It runs on ${paths.length} notes, one run each. You can undo them afterwards.`) : ""].filter(Boolean).join(" ");
			if (!(await confirmRun(this.app, buttonLabel(wf), body))) return;
		}
		let form: Record<string, unknown> | undefined;
		if (wf.trigger.kind === "form") {
			if (this.workflows.paused) return void new Notice("Workflows are paused.");
			const problems = workflowProblems(wf, this.settings);
			if (problems.length) return void new Notice(`“${wf.name}” can't run: ${problems[0].message}`);
			if (wf.trigger.fields.length) {
				const answers = await askForm(this, wf as WorkflowDef & { trigger: FormTrigger });
				if (!answers) return;
				form = answers;
			} else form = {};
		}
		await this.workflows.runOn(wf, paths, form);
	}

	/** Workflows run from buttons (and forms) that apply to every one of these types (each type once). */
	manualWorkflows(types: EntityTypeDef[]): WorkflowDef[] {
		if (!types.length) return [];
		return this.settings.workflows.filter((w) => w.on && onNotes(w) && types.every((t) => inScope(w, t)));
	}

	/** Add a "run" item per button workflow that applies to all these notes (row menus, the selection, the form's ⋯). */
	addWorkflowItems(m: Menu, entities: EntityRecord[], section = "workflows"): void {
		const list = this.manualWorkflows([...new Set(entities.map((e) => e.type))]);
		const paths = entities.map((e) => e.path);
		for (const wf of list)
			m.addItem((i) =>
				i
					.setSection(section)
					.setTitle(buttonLabel(wf))
					.setIcon(buttonIcon(wf))
					.onClick(() => void this.runWorkflow(wf, paths)),
			);
	}

	getType(key: string): EntityTypeDef | undefined {
		return this.settings.types.find((t) => t.key === key);
	}

	/** One "Create <type>" command per type. Commands for deleted types become unavailable. */
	private registerTypeCommands(): void {
		this.registerWorkflowCommands();
		this.syncWorkflowRibbon();
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

	/** Ribbon icons of forms set to have one, by workflow id: the icon element and what it shows (icon + title). */
	private workflowRibbon = new Map<string, { el: HTMLElement; shows: string }>();
	/** The plugin's own ribbon icons now shown, by id. */
	private ribbonEls = new Map<RibbonIconId, HTMLElement>();

	private get leftRibbon() {
		return (this.app.workspace as unknown as { leftRibbon?: { addRibbonItemButton?: (id: string, icon: string, title: string, cb: (evt: MouseEvent) => unknown) => HTMLElement; removeRibbonAction?: (id: string) => void } }).leftRibbon;
	}

	/**
	 * The plugin's ribbon icons, as the settings choose (`ribbonIcons`): added and removed as they're switched on and
	 * off. Each keeps the id Obsidian gave it before ("obs-entities:<title>"), so where it's been moved to stays.
	 */
	syncRibbon(): void {
		const run: Record<RibbonIconId, () => void> = {
			create: () => this.openCreateModal(null),
			browser: () => void this.activateBrowser(),
			"side-panel": () => void this.activateSidePanel(),
			types: () => void this.activateTypes(),
			workflows: () => void this.activateWorkflows(),
		};
		const ribbon = this.leftRibbon;
		for (const r of RIBBON_ICONS) {
			const want = this.settings.ribbonIcons[r.id];
			const el = this.ribbonEls.get(r.id);
			if (want && !el) this.ribbonEls.set(r.id, ribbon?.addRibbonItemButton ? ribbon.addRibbonItemButton(`${this.manifest.id}:${r.title}`, r.icon, r.title, run[r.id]) : this.addRibbonIcon(r.icon, r.title, run[r.id]));
			else if (!want && el) {
				el.detach();
				ribbon?.removeRibbonAction?.(`${this.manifest.id}:${r.title}`);
				this.ribbonEls.delete(r.id);
			}
		}
	}

	/** Take the plugin's ribbon icons away (the plugin is unloading). */
	private clearRibbon(): void {
		for (const [id, el] of this.ribbonEls) {
			el.detach();
			this.leftRibbon?.removeRibbonAction?.(`${this.manifest.id}:${RIBBON_ICONS.find((r) => r.id === id)!.title}`);
		}
		this.ribbonEls.clear();
	}

	/**
	 * An icon in the ribbon for each form that starts on its own, is on and is set to have one (`ribbon`); it opens the
	 * form. Kept in step with the settings: added, re-made when its icon or title changes, removed when it's no longer
	 * wanted. Each has a stable id (`obs-entities:workflow-<id>`), so where it's been moved to (or hidden) stays.
	 */
	private syncWorkflowRibbon(): void {
		const ribbon = this.leftRibbon;
		const ribbonId = (id: string) => `${this.manifest.id}:workflow-${id}`;
		const want = new Map(formsFor(this.settings.workflows, "ribbon").map((w) => [w.id, w]));
		const showsOf = (w: WorkflowDef) => `${buttonIcon(w)}|${buttonLabel(w)}`;
		for (const [id, r] of this.workflowRibbon) {
			const w = want.get(id);
			if (w && showsOf(w) === r.shows) continue;
			r.el.detach();
			ribbon?.removeRibbonAction?.(ribbonId(id));
			this.workflowRibbon.delete(id);
		}
		for (const w of want.values()) {
			if (this.workflowRibbon.has(w.id)) continue;
			const id = w.id;
			const run = () => {
				const cur = this.settings.workflows.find((x) => x.id === id);
				if (cur) void this.runWorkflow(cur, []);
			};
			const title = `Entities: ${buttonLabel(w)}`;
			const el = ribbon?.addRibbonItemButton ? ribbon.addRibbonItemButton(ribbonId(id), buttonIcon(w), title, run) : this.addRibbonIcon(buttonIcon(w), title, run);
			this.workflowRibbon.set(id, { el, shows: showsOf(w) });
		}
	}

	/** Take the forms' ribbon icons away (the plugin is unloading). */
	private clearWorkflowRibbon(): void {
		const ribbon = (this.app.workspace as unknown as { leftRibbon?: { removeRibbonAction?: (id: string) => void } }).leftRibbon;
		for (const [id, r] of this.workflowRibbon) {
			r.el.detach();
			ribbon?.removeRibbonAction?.(`${this.manifest.id}:workflow-${id}`);
		}
		this.workflowRibbon.clear();
	}

	/**
	 * A command per button or form workflow set to have one ("Workflow: Log session"), so it can have a hotkey; its name
	 * follows the workflow's. A form that starts on its own opens its form; others run on the active note when it's
	 * one of theirs. Commands of workflows deleted, switched off or no longer set to have one are unavailable.
	 */
	private registerWorkflowCommands(): void {
		for (const wf of this.settings.workflows) {
			if (!wf.command || !(onNotes(wf) || noteless(wf))) continue;
			const id = wf.id;
			this.addCommand({
				id: `workflow-${id}`,
				name: `Workflow: ${buttonLabel(wf)}`,
				checkCallback: (checking) => {
					const w = this.settings.workflows.find((x) => x.id === id);
					if (!w || !w.on || !w.command) return false;
					if (noteless(w)) {
						if (!checking) void this.runWorkflow(w, []);
						return true;
					}
					const entity = this.index.getByFile(this.app.workspace.getActiveFile());
					if (!onNotes(w) || !entity || !inScope(w, entity.type)) return false;
					if (!checking) void this.runWorkflow(w, [entity.path]);
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
