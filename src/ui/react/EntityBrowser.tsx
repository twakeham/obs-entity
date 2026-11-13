import { Menu, Notice, TFile } from "obsidian";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from "react";
import {
	branchPaths,
	buildBrowser,
	childOptions,
	DEFAULT_BROWSER_OPTIONS,
	filterBrowser,
	locate,
	type BrowserBlock,
	type BrowserOptions,
	type BrowserSection,
	type TreeNode,
} from "../../model/tree";
import { DEFAULT_STATUSES, type EntityTypeDef, type GroupDef } from "../../model/types";
import { isDirty, isGroupDirty, type GroupDraft, type TypeDraft } from "../../model/typeEditing";
import type EntitiesPlugin from "../../main";
import { PackGalleryModal } from "../modals/packGalleryModal";
import { ExportAppModal, ImportAppModal } from "../modals/appModals";
import type { EntityRecord } from "../../services/entityIndex";
import { TypePickerModal } from "../components/entityPicker";
import { usePlugin, useRelationsVersion } from "./context";
import { HOVER_SOURCE } from "./EntityChip";
import { statusClass } from "./EntityBits";
import { statusColor, type PaletteColor } from "../../model/colors";
import { Icon } from "./Icon";
import { BOARD_ICON } from "../../model/board";
import { CALENDAR_ICON, dateFields } from "../../model/calendarView";
import { VIEW_KIND_ICON } from "../../model/views";
import { buttonIcon, buttonLabel, cloneWorkflow, inScope, newTrigger, newWorkflow, noteless, onNotes, scopeTypes, triggerText, TRIGGER_ICONS, TRIGGER_LABELS, WORKFLOW_CATEGORIES, workflowProblems, type WorkflowDef } from "../../model/workflows";
import { NotePickerModal } from "../modals/workflowModals";
import { typeMatches, viewMatches, workflowMatches, type BrowserFilter } from "../../model/browserFilter";
import { placeFor, placeViews, viewSpot, type ViewSpot } from "../../model/viewPlace";
import { ViewPlaceModal } from "../modals/viewPlaceModal";
import { openTryRun } from "./workflows/TryRun";
import { ConfirmModal, copyAllTypesAsPack, type TypesRequest } from "./types/TypeManager";

export interface BrowserState extends BrowserOptions {
	/** which tab is shown: the entity notes and views, or the setup (entity types, workflows) */
	tab: "entities" | "configure";
	search: string;
	type: string;
	status: string;
	tag: string;
	/** the Configure tab's own search and type filter */
	configSearch: string;
	configType: string;
	/** expanded entity paths */
	expanded: string[];
	/**
	 * collapsed section ("s:<key>"), type-heading ("b:<key>"), Views ("v:views"), Workflows ("w:workflows") and
	 * workflow category ("w:<category>") keys
	 */
	collapsed: string[];
	/** list the entity types (the Entities section), the view notes and the workflows (View options) */
	showTypes: boolean;
	showViews: boolean;
	showWorkflows: boolean;
}

export const DEFAULT_BROWSER_STATE: BrowserState = { ...DEFAULT_BROWSER_OPTIONS, tab: "entities", search: "", type: "", status: "", tag: "", configSearch: "", configType: "", expanded: [], collapsed: [], showTypes: true, showViews: true, showWorkflows: true };

const INDENT = 14;
/** what a dragged view row carries (its path) */
const VIEW_DRAG = "application/x-oe-view";
const sKey = (s: BrowserSection) => `s:${s.key}`;
const bKey = (b: BrowserBlock) => `b:${b.key}`;

export function StatusDot({ status, color = null }: { status: string | null; color?: PaletteColor | null }) {
	return <span className={`oe-dot ${status ? statusClass(status, color) : "oe-tone-none"}`} aria-label={status ?? "no status"} />;
}

export function EntityBrowser({ state, setState, activePath }: { state: BrowserState; setState: (patch: Partial<BrowserState>) => void; activePath: string | null }) {
	const plugin = usePlugin();
	const version = useRelationsVersion();
	const listRef = useRef<HTMLDivElement>(null);
	const { types, groups } = plugin.settings;
	const opts: BrowserOptions = { sections: state.sections, typeHeadings: state.typeHeadings, crossGroup: state.crossGroup, showEmpty: state.showEmpty, children: state.children, sameTypeNesting: state.sameTypeNesting };
	const [views, setViews] = useState(() => plugin.views.all());
	useEffect(() => {
		const ref = plugin.views.on("updated", () => setViews(plugin.views.all()));
		setViews(plugin.views.all());
		return () => plugin.views.offref(ref);
	}, [plugin]);

	const { sections, tags } = useMemo(() => {
		const entities = plugin.index.all();
		const tagSet = new Set<string>();
		for (const e of entities) for (const t of e.tags) tagSet.add(t);
		return {
			sections: buildBrowser<EntityRecord>(entities, plugin.relations.allEdges(), types, groups, opts),
			tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b)),
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [version, types, groups, plugin, state.sections, state.typeHeadings, state.crossGroup, state.showEmpty, state.children, state.sameTypeNesting]);

	const statuses = useMemo(() => {
		const all = [...groups.flatMap((g) => g.statuses), ...types.flatMap((t) => t.statuses ?? [])];
		return Array.from(new Set(all.length ? all : DEFAULT_STATUSES));
	}, [groups, types]);

	// Each tab has its own search and filters: Entities (search, type, status, tag), Configure (search, type).
	const onConfig = state.tab === "configure";
	const query = state.search.trim().toLowerCase();
	const entFiltering = !!(query || state.type || state.status || state.tag);
	const cfgQuery = state.configSearch.trim().toLowerCase();
	const cfgFilter: BrowserFilter = { query: cfgQuery, type: state.configType, status: "", tag: "" };
	const cfgFiltering = !!(cfgQuery || state.configType);
	/** whether the shown tab is filtered */
	const filtering = onConfig ? cfgFiltering : entFiltering;
	const shown = useMemo(() => {
		if (!entFiltering) return sections;
		const match = (e: EntityRecord) =>
			(!query || e.name.toLowerCase().includes(query) || e.aliases.some((a) => a.toLowerCase().includes(query))) &&
			(!state.type || e.type.key === state.type) &&
			(!state.status || e.status === state.status) &&
			(!state.tag || e.tags.some((t) => t === state.tag || t.startsWith(`${state.tag}/`)));
		return filterBrowser(sections, match);
	}, [sections, entFiltering, query, state.type, state.status, state.tag]);
	const entFilter: BrowserFilter = { query, type: state.type, status: state.status, tag: state.tag };
	const shownViews = !state.showViews ? [] : entFiltering ? views.filter((f) => viewMatches(f.basename, plugin.views.types(f.path), entFilter, types)) : views;
	// Views are listed where they belong (their place:, or worked out from their types) among the headings shown.
	const placed = placeViews(
		shownViews.map((f) => ({ view: f, spot: viewSpot(plugin.views.types(f.path), plugin.views.place(f.path), types, groups) })),
		shown,
		types,
	);
	/** the headings above each placed view, to unfold when it's opened */
	const viewHeads = new Map<string, string[]>();
	for (const f of placed.top) viewHeads.set(f.path, ["v:views"]);
	for (const s of shown) {
		for (const f of placed.sections.get(s.key) ?? []) viewHeads.set(f.path, [sKey(s)]);
		for (const b of s.blocks) for (const f of placed.blocks.get(b.key) ?? []) viewHeads.set(f.path, [sKey(s), bKey(b)]);
	}
	/** Move a view to a heading (saved in its block), and unfold that heading so it shows there. */
	const moveView = (path: string, spot: ViewSpot, heads: string[]) => {
		void plugin.views.setPlace(path, placeFor(spot, plugin.views.types(path), types, groups));
		if (!filtering && heads.some((h) => collapsed.has(h))) setState({ collapsed: state.collapsed.filter((k) => !heads.includes(k)) });
	};
	const viewRows = (list: TFile[] | undefined, depth: number) => (list ?? []).map((f) => <ViewRow key={f.path} file={f} depth={depth} active={activePath === f.path} />);
	// What matches, for the count above the list.
	const matchedTypes = state.showTypes && cfgFiltering ? listedTypes(plugin).filter((x) => typeMatches(x.t, cfgFilter)).length : 0;
	const matchedWorkflows = state.showWorkflows && cfgFiltering ? [...plugin.settings.workflows.map((w) => plugin.workflowDrafts.get(w.id) ?? w), ...[...plugin.workflowDrafts.entries()].filter(([id]) => id.startsWith("new:")).map(([, w]) => w)].filter((w) => workflowMatches(w, cfgFilter, types)).length : 0;

	const expanded = useMemo(() => new Set(state.expanded), [state.expanded]);
	const collapsed = useMemo(() => new Set(state.collapsed), [state.collapsed]);

	// While filtering, everything starts expanded so matches are visible; collapses made during
	// filtering are kept separately and forgotten whenever the filter (or the tab) changes.
	const filterKey = onConfig ? `c\u0000${cfgQuery}\u0000${state.configType}` : `e\u0000${query}\u0000${state.type}\u0000${state.status}\u0000${state.tag}`;
	const [filterClosed, setFilterClosed] = useState<{ key: string; items: Set<string> }>({ key: "", items: new Set() });
	useEffect(() => setFilterClosed({ key: filterKey, items: new Set() }), [filterKey]);
	const closedNow = filterClosed.key === filterKey ? filterClosed.items : new Set<string>();

	const isOpen = (id: string) => (filtering ? !closedNow.has(id) : expanded.has(id));
	const isCollapsed = (id: string) => (filtering ? closedNow.has(id) : collapsed.has(id));
	const toggleNode = (path: string) => {
		if (filtering) toggleClosed(path);
		else setState({ expanded: expanded.has(path) ? state.expanded.filter((p) => p !== path) : [...state.expanded, path] });
	};
	const toggleHeading = (id: string) => {
		if (filtering) toggleClosed(id);
		else setState({ collapsed: collapsed.has(id) ? state.collapsed.filter((k) => k !== id) : [...state.collapsed, id] });
	};
	const toggleClosed = (id: string) => {
		const next = new Set(closedNow);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setFilterClosed({ key: filterKey, items: next });
	};
	const headingKeys = (list: BrowserSection[]) => list.flatMap((s) => [sKey(s), ...s.blocks.map(bKey)]);
	const extraKeys = ["t:types", ...groups.map((g) => `t:group:${g.key}`), "w:workflows", ...WORKFLOW_CATEGORIES.map((c) => `w:${c.key}`)];
	const isExtra = (k: string) => extraKeys.includes(k);
	// Collapse and expand all: the shown tab's headings only (and on Entities, the notes' branches).
	const collapseAll = () => {
		if (filtering) setFilterClosed({ key: filterKey, items: new Set(onConfig ? extraKeys : ["v:views", ...headingKeys(shown)]) });
		else if (onConfig) setState({ collapsed: [...new Set([...state.collapsed, ...extraKeys])] });
		else setState({ expanded: [], collapsed: [...state.collapsed.filter(isExtra), "v:views", ...headingKeys(sections)] });
	};
	const expandAll = () => {
		if (filtering) setFilterClosed({ key: filterKey, items: new Set() });
		else if (onConfig) setState({ collapsed: state.collapsed.filter((k) => !isExtra(k)) });
		else setState({ expanded: branchPaths(sections), collapsed: state.collapsed.filter(isExtra) });
	};

	// Reveal the active note once when it becomes active (not on every index update, so manual
	// collapsing sticks): open its section, type heading and ancestors, then scroll it into view.
	const revealed = useRef<string | null>(null);
	useEffect(() => {
		if (!activePath || revealed.current === activePath) return;
		if (plugin.views.has(activePath)) {
			revealed.current = activePath;
			const heads = viewHeads.get(activePath) ?? [];
			if (heads.some((h) => collapsed.has(h))) setState({ collapsed: state.collapsed.filter((k) => !heads.includes(k)) });
			return;
		}
		const at = locate(sections, activePath);
		if (!at) return;
		revealed.current = activePath;
		const missing = at.ancestors.filter((p) => !expanded.has(p));
		const heads = [`s:${at.section}`, `b:${at.block}`];
		if (missing.length || heads.some((h) => collapsed.has(h))) {
			setState({ expanded: [...state.expanded, ...missing], collapsed: state.collapsed.filter((k) => !heads.includes(k)) });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activePath, sections]);
	const pendingScroll = useRef<string | null>(null);
	useEffect(() => {
		pendingScroll.current = activePath;
	}, [activePath]);
	useEffect(() => {
		const path = pendingScroll.current;
		if (!path) return;
		const el = listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
		if (!el) return;
		el.scrollIntoView({ block: "nearest" });
		pendingScroll.current = null;
	});

	const create = (candidates: EntityTypeDef[]) => {
		if (candidates.length === 1) plugin.openCreateModal(candidates[0]);
		else if (candidates.length) new TypePickerModal(plugin, (t) => plugin.openCreateModal(t), candidates).open();
	};

	const viewMenu = (evt: MouseEvent) => {
		const m = new Menu();
		const opt = (section: string, title: string, checked: boolean, patch: Partial<BrowserState>, disabled = false) =>
			m.addItem((i) => {
				i.setSection(section).setTitle(title).setChecked(checked).onClick(() => setState(patch));
				if (disabled) i.setDisabled(true);
			});
		if (onConfig) {
			opt("show", "Show entity types", state.showTypes, { showTypes: !state.showTypes });
			opt("show", "Show workflows", state.showWorkflows, { showWorkflows: !state.showWorkflows });
			m.showAtMouseEvent(evt.nativeEvent);
			return;
		}
		opt("sections", "Sections: groups", state.sections === "groups", { sections: "groups" });
		opt("sections", "Sections: none (one tree)", state.sections === "none", { sections: "none" });
		opt("headings", "Type headings", state.typeHeadings, { typeHeadings: !state.typeHeadings });
		opt("children", "Children of other types nest under their parent", state.children === "parent", { children: "parent" });
		opt("children", "Children of other types are listed under their own type", state.children === "type", { children: "type" });
		opt("children", "Nest under parents of the same type", state.sameTypeNesting, { sameTypeNesting: !state.sameTypeNesting }, state.children !== "type");
		opt("cross", "Children in other groups stay in their own group", state.crossGroup === "own", { crossGroup: "own" }, state.sections === "none" || state.children === "type");
		opt("cross", "Children in other groups nest under their parent", state.crossGroup === "parent", { crossGroup: "parent" }, state.sections === "none" || state.children === "type");
		opt("empty", "Show empty types", state.showEmpty, { showEmpty: !state.showEmpty });
		opt("show", "Show views", state.showViews, { showViews: !state.showViews });
		m.showAtMouseEvent(evt.nativeEvent);
	};
	const newMenu = (evt: MouseEvent) => {
		const m = new Menu();
		if (onConfig) {
			m.addItem((i) => i.setTitle("New entity type").setIcon("file-plus").onClick(() => void plugin.activateTypes(null, { newType: true })));
			m.addItem((i) => i.setTitle("New group").setIcon("folder-plus").onClick(() => void plugin.activateTypes(null, { newGroup: true })));
			m.addItem((i) => i.setTitle("New workflow").setIcon("zap").onClick(() => void plugin.activateWorkflows({ blank: true })));
		} else {
			m.addItem((i) => i.setTitle("New entity…").setIcon("book-plus").onClick(() => plugin.openCreateModal(null)));
			m.addItem((i) => i.setTitle("New view").setIcon("table").onClick(() => plugin.newView()));
		}
		m.showAtMouseEvent(evt.nativeEvent);
	};

	const groupSections = state.sections === "groups";
	const base = (groupSections ? 1 : 0) + (state.typeHeadings ? 1 : 0);
	const matches = onConfig ? matchedWorkflows + matchedTypes : shown.reduce((n, s) => n + s.count, 0) + shownViews.length;
	const viewsOpen = !isCollapsed("v:views");
	const configEmpty = cfgFiltering ? matches === 0 : !state.showTypes && !state.showWorkflows;
	const tab = (key: BrowserState["tab"], icon: string, label: string) => (
		<button type="button" role="tab" aria-selected={state.tab === key} className={`oe-browser-tab${state.tab === key ? " is-active" : ""}`} onClick={() => state.tab !== key && setState({ tab: key })}>
			<Icon name={icon} />
			<span>{label}</span>
		</button>
	);

	return (
		<div className="oe-browser">
			<div className="oe-browser-tabs" role="tablist" aria-label="Entity browser">
				{tab("entities", "library", "Entities")}
				{tab("configure", "settings-2", "Configure")}
			</div>
			<div className="oe-browser-toolbar">
				{onConfig ? (
					<input type="search" className="oe-browser-search" placeholder="Search…" value={state.configSearch} onChange={(e) => setState({ configSearch: e.target.value })} aria-label="Search entity types and workflows" />
				) : (
					<input type="search" className="oe-browser-search" placeholder="Search…" value={state.search} onChange={(e) => setState({ search: e.target.value })} aria-label="Search entities and views" />
				)}
				<ToolButton icon="sliders-horizontal" label="View options" onClick={viewMenu} />
				<ToolButton icon="chevrons-down-up" label="Collapse all" onClick={collapseAll} />
				<ToolButton icon="chevrons-up-down" label="Expand all" onClick={expandAll} />
				<ToolButton icon="plus" label="New…" onClick={newMenu} />
			</div>
			<div className="oe-browser-filters">
				<select className="dropdown" value={onConfig ? state.configType : state.type} onChange={(e) => setState(onConfig ? { configType: e.target.value } : { type: e.target.value })} aria-label="Type">
					<option value="">All types</option>
					{types.map((t) => (
						<option key={t.key} value={t.key}>
							{t.name}
						</option>
					))}
				</select>
				{!onConfig && (
					<select className="dropdown" value={state.status} onChange={(e) => setState({ status: e.target.value })} aria-label="Status">
						<option value="">Any status</option>
						{statuses.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				)}
				{!onConfig && (
					<select className="dropdown" value={state.tag} onChange={(e) => setState({ tag: e.target.value })} aria-label="Tag">
						<option value="">Any tag</option>
						{tags.map((t) => (
							<option key={t} value={t}>
								#{t}
							</option>
						))}
					</select>
				)}
			</div>
			{filtering && (
				<div className="oe-browser-filterbar">
					<span>
						{matches} match{matches === 1 ? "" : "es"}
					</span>
					<a href="#" className="oe-browser-clear" onClick={(e) => (e.preventDefault(), setState(onConfig ? { configSearch: "", configType: "" } : { search: "", type: "", status: "", tag: "" }))}>
						Clear
					</a>
				</div>
			)}

			<div className="oe-browser-list" ref={listRef} role="tabpanel">
				{onConfig && state.showTypes && <TypesSection isCollapsed={isCollapsed} toggleHeading={toggleHeading} filter={cfgFilter} filtering={cfgFiltering} />}
				{/* Kept while every view is listed elsewhere (not filtering), so there's always somewhere to drop one back. */}
				{!onConfig && (placed.top.length > 0 || (shownViews.length > 0 && !entFiltering)) && (
					<section className={`oe-bsection oe-bviews${viewsOpen ? "" : " is-collapsed"}`} data-section="views">
						<Heading
							depth={0}
							open={viewsOpen}
							icon="table"
							title="Views"
							count={placed.top.length}
							className="oe-bsection-header"
							onToggle={() => toggleHeading("v:views")}
							onAdd={() => plugin.newView()}
							addLabel="New entity view"
							onDropView={(path) => moveView(path, { kind: "views" }, ["v:views"])}
						/>
						{viewsOpen && viewRows(placed.top, 1)}
						{viewsOpen && placed.top.length === 0 && (
							<div className="oe-tree-empty" style={{ paddingLeft: `${INDENT + 22}px` }}>
								Drag a view here to list it at the top
							</div>
						)}
					</section>
				)}
				{onConfig && state.showWorkflows && <WorkflowsSection isCollapsed={isCollapsed} toggleHeading={toggleHeading} filter={cfgFilter} filtering={cfgFiltering} />}
				{onConfig && configEmpty && <div className="oe-panel-empty">{cfgFiltering ? "Nothing matches." : "Nothing shown. Turn on entity types or workflows in View options."}</div>}
				{!onConfig && shown.length === 0 && (!entFiltering || shownViews.length === 0) && <div className="oe-panel-empty">{entFiltering ? "Nothing matches." : "No entities yet. Use + to create one."}</div>}
				{!onConfig && shown.map((s) => {
					const sid = sKey(s);
					const sClosed = groupSections && isCollapsed(sid);
					const sectionTypes = s.group ? types.filter((t) => t.group === s.group!.key) : groupSections ? types.filter((t) => !groups.some((g) => g.key === t.group)) : types;
					return (
						<section key={sid} className={`oe-bsection${sClosed ? " is-collapsed" : ""}`} data-section={s.key}>
							{groupSections && (
								<Heading
									depth={0}
									open={!sClosed}
									icon={s.group?.icon ?? "help-circle"}
									title={s.group?.name ?? "No group"}
									count={s.count}
									className="oe-bsection-header"
									onToggle={() => toggleHeading(sid)}
									onAdd={sectionTypes.length ? () => create(sectionTypes) : undefined}
									addLabel={`New entity in ${s.group?.name ?? "this section"}`}
									onMenu={
										s.group
											? (evt) => {
													const m = new Menu();
													for (const t of sectionTypes) m.addItem((i) => i.setSection("new").setTitle(`New ${t.name.toLowerCase()}`).setIcon(t.icon).onClick(() => plugin.openCreateModal(t)));
													m.addItem((i) => i.setSection("view").setTitle(`New table view of ${s.group!.name}`).setIcon("table").onClick(() => plugin.newView(`@${s.group!.key}`)));
													m.addItem((i) => i.setSection("view").setTitle(`New board of ${s.group!.name}`).setIcon(BOARD_ICON).onClick(() => plugin.newView(`@${s.group!.key}`, "board")));
													if (sectionTypes.some((t) => dateFields(t).length))
														m.addItem((i) => i.setSection("view").setTitle(`New calendar of ${s.group!.name}`).setIcon(CALENDAR_ICON).onClick(() => plugin.newView(`@${s.group!.key}`, "calendar")));
													m.addItem((i) => i.setSection("workflow").setTitle(`New workflow for ${s.group!.name}`).setIcon("zap").onClick(() => void plugin.activateWorkflows({ newFor: `@${s.group!.key}` })));
													m.addItem((i) => i.setSection("config").setTitle("Configure group").setIcon("settings-2").onClick(() => void plugin.activateTypes(`group:${s.group!.key}`)));
													m.showAtMouseEvent(evt.nativeEvent);
												}
											: undefined
									}
									onDropView={s.group ? (path) => moveView(path, { kind: "group", key: s.group!.key }, [sid]) : undefined}
								/>
							)}
							{!sClosed && viewRows(placed.sections.get(s.key), groupSections ? 1 : 0)}
							{!sClosed &&
								s.blocks.map((b) => {
									const bid = bKey(b);
									const bClosed = !!b.type && isCollapsed(bid);
									const t = b.type;
									// Notes of this type listed under other types' headings (sessions under their campaign).
									const elsewhere = !!t && !filtering && b.nested > 0;
									const allElsewhere = elsewhere && b.roots.length === 0;
									const plural = t ? (t.plural || t.name).toLowerCase() : "";
									const under = b.nestedUnder.map((x) => x.plural || x.name).join(" and ");
									return (
										<div key={bid} className="oe-bblock" data-block={b.key}>
											{t && (
												<Heading
													depth={groupSections ? 1 : 0}
													open={!bClosed}
													icon={t.icon}
													color={t.color}
													title={t.plural || t.name}
													count={allElsewhere ? b.nested : b.count}
													countElsewhere={allElsewhere}
													countTitle={elsewhere ? `${allElsewhere ? `All ${b.nested}` : `${b.nested} more`} ${plural} listed under ${under}` : undefined}
													className="oe-bblock-header"
													onToggle={() => toggleHeading(bid)}
													onAdd={() => plugin.openCreateModal(t)}
													addLabel={`New ${t.name.toLowerCase()}`}
													onMenu={(evt) => {
														const m = new Menu();
														m.addItem((i) => i.setSection("new").setTitle(`New ${t.name.toLowerCase()}`).setIcon(t.icon).onClick(() => plugin.openCreateModal(t)));
														m.addItem((i) => i.setSection("view").setTitle(`New table view of ${(t.plural || t.name).toLowerCase()}`).setIcon("table").onClick(() => plugin.newView(t.key)));
														m.addItem((i) => i.setSection("view").setTitle(`New board of ${(t.plural || t.name).toLowerCase()}`).setIcon(BOARD_ICON).onClick(() => plugin.newView(t.key, "board")));
														if (dateFields(t).length)
															m.addItem((i) => i.setSection("view").setTitle(`New calendar of ${(t.plural || t.name).toLowerCase()}`).setIcon(CALENDAR_ICON).onClick(() => plugin.newView(t.key, "calendar")));
														m.addItem((i) => i.setSection("workflow").setTitle(`New workflow for ${(t.plural || t.name).toLowerCase()}`).setIcon("zap").onClick(() => void plugin.activateWorkflows({ newFor: t.key })));
														m.addItem((i) => i.setSection("config").setTitle(`Configure the ${t.name} type`).setIcon("shapes").onClick(() => void plugin.activateTypes(t.key)));
														m.showAtMouseEvent(evt.nativeEvent);
													}}
													onDropView={(path) => moveView(path, { kind: "type", key: t.key }, [sid, bid])}
												/>
											)}
											{!bClosed && (
												<div className="oe-tree">
													{viewRows(placed.blocks.get(b.key), base)}
													{b.roots.map((n) => (
														<TreeRow key={n.entity.path} node={n} depth={base} isOpen={isOpen} activePath={activePath} onToggle={toggleNode} />
													))}
													{elsewhere && (
														<button className="oe-tree-elsewhere" style={{ paddingLeft: `${base * INDENT + 22}px` }} onClick={() => setState({ type: t.key })} title={`Show only ${plural}, with what they're under`}>
															{allElsewhere ? `All ${b.nested}` : `+${b.nested} more`} under {under} · <span className="oe-tree-elsewhere-link">show them</span>
														</button>
													)}
													{t && b.roots.length === 0 && !elsewhere && (
														<div className="oe-tree-empty" style={{ paddingLeft: `${base * INDENT + 22}px` }}>
															No {plural} yet
														</div>
													)}
												</div>
											)}
										</div>
									);
								})}
						</section>
					);
				})}
			</div>
		</div>
	);
}

/**
 * The Workflows section: a heading per category (what starts them: When created, When changed, Run on notes,
 * Scheduled), each with its workflows by name. A workflow shows its trigger's icon, an on dot, a
 * warning when it has problems, "new" for an unsaved one and a dot for unsaved changes (drafts in the Workflows view).
 * Click opens it there; + starts a new one for no type in particular. While searching or filtering, only matching
 * workflows show (null when none do).
 */
function WorkflowsSection({
	isCollapsed,
	toggleHeading,
	filter,
	filtering,
}: {
	isCollapsed: (key: string) => boolean;
	toggleHeading: (key: string) => void;
	filter: BrowserFilter;
	filtering: boolean;
}) {
	const plugin = usePlugin();
	const [, setTick] = useState(0);
	useEffect(() => {
		const refs = [plugin.workflows.on("log", () => setTick((t) => t + 1)), plugin.workflows.on("drafts", () => setTick((t) => t + 1))];
		return () => refs.forEach((r) => plugin.workflows.offref(r));
	}, [plugin]);
	const { settings } = plugin;
	const drafts = plugin.workflowDrafts;
	const paused = settings.workflowsPaused;
	const shownId = plugin.shownWorkflow();
	const scopeText = (wf: WorkflowDef) => (wf.scope.length ? scopeTypes(wf, settings.types).map((t) => t.plural || t.name).join(", ") || wf.scope.join(", ") : "Any note");
	const listed = [
		...settings.workflows.map((w) => ({ id: w.id, wf: drafts.get(w.id) ?? w, saved: w as WorkflowDef | null })),
		...[...drafts.entries()].filter(([id]) => id.startsWith("new:")).map(([id, wf]) => ({ id, wf, saved: null as WorkflowDef | null })),
	]
		.filter((x) => !filtering || workflowMatches(x.wf, filter, settings.types))
		.sort((a, b) => (a.wf.name || "New workflow").localeCompare(b.wf.name || "New workflow", undefined, { numeric: true }));
	if (filtering && !listed.length) return null;
	const open = !isCollapsed("w:workflows");

	const setOn = async (wf: WorkflowDef, on: boolean) => {
		wf.on = on;
		// An open draft of it follows, so saving the draft later doesn't undo this.
		const draft = drafts.get(wf.id);
		if (draft) draft.on = on;
		await plugin.saveSettings();
		plugin.workflows.trigger("log");
	};
	const remove = (wf: WorkflowDef) =>
		new ConfirmModal(plugin.app, `Delete “${wf.name}”?`, "The workflow stops running. Notes it changed keep their values.", "Delete workflow", async () => {
			settings.workflows = settings.workflows.filter((w) => w.id !== wf.id);
			drafts.delete(wf.id);
			await plugin.saveSettings();
			plugin.workflows.trigger("log");
			new Notice(`Deleted “${wf.name}”.`);
		}).open();
	const rowMenu = (evt: MouseEvent, id: string, wf: WorkflowDef, saved: WorkflowDef | null) => {
		evt.preventDefault();
		const m = new Menu();
		m.addItem((i) => i.setSection("open").setTitle("Open").setIcon("zap").onClick(() => void plugin.activateWorkflows({ open: id, tab: "edit" })));
		if (!saved) {
			// Not saved yet: it only lives in the Workflows view until it's saved or discarded.
			m.addItem((i) =>
				i
					.setSection("danger")
					.setTitle("Discard")
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => {
						drafts.delete(id);
						plugin.workflows.trigger("log");
					}),
			);
			return m.showAtMouseEvent(evt.nativeEvent);
		}
		m.addItem((i) => i.setSection("open").setTitle("Recent runs").setIcon("history").onClick(() => void plugin.activateWorkflows({ open: id, tab: "runs" })));
		// Run it from here: a form that starts on its own opens its form; buttons and forms on notes pick a note first.
		if (noteless(saved) || onNotes(saved)) {
			const runnable = saved.on && !paused && !workflowProblems(saved, settings).length;
			const why = !saved.on ? " (switch it on first)" : paused ? " (workflows are paused)" : !runnable ? " (fix its problems first)" : "";
			m.addItem((i) => {
				i.setSection("run")
					.setTitle(`${noteless(saved) ? "Fill in the form…" : "Run on a note…"}${why}`)
					.setIcon(buttonIcon(saved))
					.onClick(() => {
						if (!runnable) return;
						if (noteless(saved)) return void plugin.runWorkflow(saved, []);
						const notes = plugin.index.all().filter((e) => inScope(saved, e.type));
						if (!notes.length) return void new Notice(saved.scope.length ? "There are no notes of these types to run it on." : "There are no notes to run it on.");
						new NotePickerModal(plugin.app, notes, `Run “${buttonLabel(saved)}” on a note…`, (entity) => void plugin.runWorkflow(saved, [entity.path])).open();
					});
				if (!runnable) i.setDisabled(true);
			});
		}
		m.addItem((i) => i.setSection("open").setTitle(noteless(wf) ? "Try it…" : "Try on a note…").setIcon("flask-conical").onClick(() => openTryRun(plugin, wf)));
		// A workflow with problems can't be switched on until they're fixed (it couldn't run).
		const blocked = !saved.on && workflowProblems(saved, settings).length > 0;
		m.addItem((i) => {
			i.setSection("state")
				.setTitle(saved.on ? "Disable" : blocked ? "Enable (fix its problems first)" : "Enable")
				.setIcon(saved.on ? "toggle-left" : "toggle-right")
				.onClick(() => !blocked && void setOn(saved, !saved.on));
			if (blocked) i.setDisabled(true);
		});
		m.addItem((i) =>
			i
				.setSection("edit")
				.setTitle("Duplicate")
				.setIcon("copy-plus")
				.onClick(() => plugin.openWorkflowDraft({ ...cloneWorkflow(wf), id: newWorkflow().id, name: `${wf.name || "Workflow"} copy` })),
		);
		m.addItem((i) => i.setSection("danger").setTitle("Delete…").setIcon("trash-2").setWarning(true).onClick(() => remove(saved)));
		m.showAtMouseEvent(evt.nativeEvent);
	};
	const headingMenu = (evt: MouseEvent) => {
		const m = new Menu();
		m.addItem((i) => i.setSection("new").setTitle("New workflow").setIcon("plus").onClick(() => void plugin.activateWorkflows({ blank: true })));
		m.addItem((i) => i.setSection("open").setTitle("Recent runs").setIcon("history").onClick(() => void plugin.activateWorkflows({ open: "runs" })));
		m.addItem((i) =>
			i
				.setSection("state")
				.setTitle(paused ? "Enable all workflows" : "Disable all workflows")
				.setIcon(paused ? "play" : "pause")
				.onClick(() => void plugin.workflows.setPaused(!paused)),
		);
		m.showAtMouseEvent(evt.nativeEvent);
	};

	return (
		<section className={`oe-bsection oe-bworkflows${open ? "" : " is-collapsed"}`} data-section="workflows">
			<Heading
				depth={0}
				open={open}
				icon="zap"
				title={paused ? "Workflows (all disabled)" : "Workflows"}
				count={listed.length}
				className="oe-bsection-header"
				onToggle={() => toggleHeading("w:workflows")}
				onAdd={() => void plugin.activateWorkflows({ blank: true })}
				addLabel="New workflow"
				onMenu={headingMenu}
			/>
			{open &&
				WORKFLOW_CATEGORIES.map((c) => {
					const items = listed.filter((x) => c.kinds.includes(x.wf.trigger.kind));
					// While searching, only categories with matches.
					if (filtering && !items.length) return null;
					const key = `w:${c.key}`;
					const catOpen = !isCollapsed(key);
					const notHere = c.key === "timed" && !plugin.workflows.timedHere && items.length > 0;
					return (
						<div key={c.key} className="oe-bblock oe-bworkflow-cat" data-category={c.key}>
							<Heading
								depth={1}
								open={catOpen}
								icon={c.icon}
								title={
									<>
										{c.title}
										{notHere && (
											<span className="oe-tm-badge" title="Scheduled and date workflows don't run on this device (Settings → Workflows).">
												not here
											</span>
										)}
									</>
								}
								count={items.length}
								className="oe-bblock-header"
								onToggle={() => toggleHeading(key)}
								addLabel=""
								onMenu={(evt) => {
									// A new workflow of this category's kind (Scheduled: on a schedule, or on a date).
									const m = new Menu();
									for (const k of c.kinds)
										m.addItem((i) =>
											i
												.setTitle(`New workflow: ${TRIGGER_LABELS[k]}`)
												.setIcon(TRIGGER_ICONS[k])
												.onClick(() => plugin.openWorkflowDraft({ ...newWorkflow([], newTrigger(k)), name: "" })),
										);
									m.showAtMouseEvent(evt.nativeEvent);
								}}
							/>
							{catOpen && !items.length && (
								<div className="oe-tree-empty" style={{ paddingLeft: `${2 * INDENT + 22}px` }}>
									None yet
								</div>
							)}
							{catOpen &&
								items.map(({ id, wf, saved }) => {
									const problems = workflowProblems(wf, settings);
									const live = wf.on && !paused;
									const dirty = drafts.has(id) && (!saved || JSON.stringify(drafts.get(id)) !== JSON.stringify(saved));
									return (
										<div
											key={id}
											className={`oe-tree-row oe-workflow-row${wf.on ? "" : " is-off"}${shownId === id ? " is-active" : ""}`}
											style={{ paddingLeft: `${2 * INDENT + 4}px` }}
											data-workflow={id}
											title={`${triggerText(wf, settings.types)} · ${scopeText(wf)}${wf.on ? "" : " · disabled"}${problems.length ? ` · ${problems[0].message}` : ""}${dirty ? " · unsaved changes" : ""}`}
											onClick={() => void plugin.activateWorkflows({ open: id })}
											onContextMenu={(evt) => rowMenu(evt, id, wf, saved)}
										>
											<span className="oe-tree-toggle is-leaf" />
											<Icon name={TRIGGER_ICONS[wf.trigger.kind]} className="oe-tree-icon" />
											<span className="oe-tree-name">{wf.name || "New workflow"}</span>
											{!saved && <span className="oe-tm-badge is-new">new</span>}
											{problems.length > 0 && <Icon name="alert-triangle" className="oe-workflow-warn" />}
											{dirty && <span className="oe-tm-dirty" aria-label="Unsaved changes" />}
											<span className="oe-bend">
												<span className={`oe-wf-dot${live ? " is-on" : ""}`} aria-label={wf.on ? "On" : "Off"} />
											</span>
										</div>
									);
								})}
						</div>
					);
				})}
		</section>
	);
}

/** The entity types in the browser's Entities section: saved ones (as edited) and new drafts, with their drafts. */
function listedTypes(plugin: EntitiesPlugin) {
	const { settings, typeDrafts } = plugin;
	return [
		...settings.types.map((t) => ({ id: t.key, t: typeDrafts.get(t.key)?.type ?? t, saved: t as EntityTypeDef | null, draft: typeDrafts.get(t.key) })),
		...[...typeDrafts.entries()].filter(([id]) => id.startsWith("new:")).map(([id, d]) => ({ id, t: d.type, saved: null as EntityTypeDef | null, draft: d as TypeDraft | undefined })),
	];
}

/**
 * The Entities section: the groups and entity types themselves (their definitions), each opened in the Entity types
 * view, with new and unsaved ones marked. The heading's menu starts types and groups, and imports and exports packs.
 */
function TypesSection({
	isCollapsed,
	toggleHeading,
	filter,
	filtering,
}: {
	isCollapsed: (key: string) => boolean;
	toggleHeading: (key: string) => void;
	filter: BrowserFilter;
	filtering: boolean;
}) {
	const plugin = usePlugin();
	const [, setTick] = useState(0);
	const [dragGroup, setDragGroup] = useState<string | null>(null);
	useEffect(() => {
		const ref = plugin.typeEvents.on("drafts", () => setTick((t) => t + 1));
		return () => plugin.typeEvents.offref(ref);
	}, [plugin]);
	const { settings } = plugin;
	const shownId = plugin.shownType();
	const types = listedTypes(plugin).filter((x) => !filtering || typeMatches(x.t, filter));
	const groups = [
		...settings.groups.map((g) => {
			const id = `group:${g.key}`;
			return { id, key: g.key, g: plugin.groupDrafts.get(id)?.group ?? g, saved: g as GroupDef | null, draft: plugin.groupDrafts.get(id) };
		}),
		...[...plugin.groupDrafts.entries()].filter(([id]) => id.startsWith("group:new:")).map(([id, d]) => ({ id, key: d.group.key, g: d.group, saved: null as GroupDef | null, draft: d as GroupDraft | undefined })),
	];
	if (filtering && !types.length) return null;
	const open = !isCollapsed("t:types");
	const ungrouped = types.filter((x) => !groups.some((g) => g.key && g.key === x.t.group));

	const ask = (request: TypesRequest) => void plugin.activateTypes(null, request);
	/** Drag a group onto another to move it there. Saved straight away. */
	const moveGroup = async (fromKey: string, toKey: string) => {
		const list = settings.groups;
		const from = list.findIndex((g) => g.key === fromKey);
		const to = list.findIndex((g) => g.key === toKey);
		if (from < 0 || to < 0 || from === to) return;
		const [g] = list.splice(from, 1);
		list.splice(to, 0, g);
		await plugin.saveSettings();
		setTick((n) => n + 1);
	};
	const headingMenu = (evt: MouseEvent) => {
		const m = new Menu();
		m.addItem((i) => i.setSection("new").setTitle("New entity type").setIcon("file-plus").onClick(() => ask({ newType: true })));
		m.addItem((i) => i.setSection("new").setTitle("New group").setIcon("folder-plus").onClick(() => ask({ newGroup: true })));
		m.addItem((i) => i.setSection("pack").setTitle("Browse packs…").setIcon("package").onClick(() => new PackGalleryModal(plugin).open()));
		m.addItem((i) => i.setSection("pack").setTitle("Import pack…").setIcon("import").onClick(() => ask({ importPack: true })));
		m.addItem((i) => i.setSection("pack").setTitle("Copy all types as a pack").setIcon("clipboard-copy").onClick(() => void copyAllTypesAsPack(plugin)));
		m.addItem((i) => i.setSection("app").setTitle("Import app…").setIcon("package-open").onClick(() => new ImportAppModal(plugin).open()));
		m.addItem((i) => i.setSection("app").setTitle("Export as an app…").setIcon("package").onClick(() => new ExportAppModal(plugin).open()));
		m.showAtMouseEvent(evt.nativeEvent);
	};

	const typeRow = ({ id, t, saved, draft }: ReturnType<typeof listedTypes>[number]) => {
		const dirty = !!draft && isDirty(draft);
		const notes = saved ? plugin.index.ofType(saved.key).length : 0;
		const plural = (t.plural || t.name || "type").toLowerCase();
		const menu = (evt: MouseEvent) => {
			evt.preventDefault();
			const m = new Menu();
			m.addItem((i) => i.setSection("open").setTitle("Open").setIcon("shapes").onClick(() => void plugin.activateTypes(id)));
			if (saved) {
				m.addItem((i) => i.setSection("new").setTitle(`New ${saved.name.toLowerCase()}`).setIcon(saved.icon).onClick(() => plugin.openCreateModal(saved)));
				m.addItem((i) => i.setSection("new").setTitle(`New table view of ${plural}`).setIcon("table").onClick(() => plugin.newView(saved.key)));
				m.addItem((i) => i.setSection("new").setTitle(`New workflow for ${plural}`).setIcon("zap").onClick(() => void plugin.activateWorkflows({ newFor: saved.key })));
				m.addItem((i) => i.setSection("edit").setTitle("Duplicate type").setIcon("copy").onClick(() => ask({ duplicate: saved.key })));
			}
			m.showAtMouseEvent(evt.nativeEvent);
		};
		return (
			<div
				key={id}
				className={`oe-tree-row oe-type-row${shownId === id ? " is-active" : ""}`}
				style={{ paddingLeft: `${2 * INDENT + 4}px`, "--oe-type-color": t.color } as CSSProperties}
				data-type={t.key || id}
				title={saved ? `${t.plural || t.name} · ${t.key} · ${notes} ${notes === 1 ? "note" : "notes"}${dirty ? " · unsaved changes" : ""}` : "New type, not saved yet"}
				onClick={() => void plugin.activateTypes(id)}
				onContextMenu={menu}
			>
				<span className="oe-tree-toggle is-leaf" />
				<Icon name={t.icon || "file"} className="oe-tree-icon" />
				<span className="oe-tree-name">{t.name || "New type"}</span>
				{!saved && <span className="oe-tm-badge is-new">new</span>}
				{dirty && <span className="oe-tm-dirty" aria-label="Unsaved changes" />}
				{saved && <span className="oe-tree-count">{notes}</span>}
				<span className="oe-bend" />
			</div>
		);
	};

	return (
		<section className={`oe-bsection oe-btypes${open ? "" : " is-collapsed"}`} data-section="types">
			<Heading
				depth={0}
				open={open}
				icon="shapes"
				title="Entities"
				count={types.length}
				className="oe-bsection-header"
				onToggle={() => toggleHeading("t:types")}
				onAdd={() => ask({ newType: true })}
				addLabel="New entity type"
				onMenu={headingMenu}
			/>
			{open &&
				groups.map(({ id, key, g, saved, draft }) => {
					const members = types.filter((x) => key && x.t.group === key);
					if (filtering && !members.length) return null;
					const gKey = `t:${id}`;
					const gOpen = !isCollapsed(gKey);
					const dirty = !!draft && isGroupDirty(draft);
					const dropHere = !!dragGroup && !!saved && dragGroup !== saved.key;
					return (
						<div key={id} className="oe-bblock oe-btype-group" data-group={key || id}>
							<div
								className={`oe-tree-row oe-typegroup-row${shownId === id ? " is-active" : ""}${dropHere ? " is-drop-target" : ""}`}
								style={{ paddingLeft: `${INDENT + 4}px` }}
								draggable={!!saved}
								onDragStart={() => saved && setDragGroup(saved.key)}
								onDragEnd={() => setDragGroup(null)}
								onDragOver={(e) => dropHere && e.preventDefault()}
								onDrop={() => {
									if (dragGroup && saved) void moveGroup(dragGroup, saved.key);
									setDragGroup(null);
								}}
								title={saved ? "Click to edit the group. Drag to reorder groups." : "New group, not saved yet"}
								onClick={() => void plugin.activateTypes(id)}
								onContextMenu={(evt) => {
									evt.preventDefault();
									const m = new Menu();
									m.addItem((i) => i.setSection("open").setTitle("Edit group").setIcon("folder-cog").onClick(() => void plugin.activateTypes(id)));
									if (saved) m.addItem((i) => i.setSection("new").setTitle("New entity type in this group").setIcon("file-plus").onClick(() => ask({ newType: saved.key })));
									m.showAtMouseEvent(evt.nativeEvent);
								}}
							>
								<span
									className="oe-tree-toggle"
									onClick={(evt) => {
										evt.stopPropagation();
										toggleHeading(gKey);
									}}
								>
									<Icon name={gOpen ? "chevron-down" : "chevron-right"} className="oe-tree-chevron" />
								</span>
								<Icon name={g.icon || "folder"} className="oe-tree-icon" />
								<span className="oe-tree-name">{g.name || "New group"}</span>
								{!saved && <span className="oe-tm-badge is-new">new</span>}
								{dirty && <span className="oe-tm-dirty" aria-label="Unsaved changes" />}
								<span className="oe-tree-count">{members.length}</span>
								<span className="oe-bend" />
							</div>
							{gOpen && members.map(typeRow)}
							{gOpen && !members.length && (
								<div className="oe-tree-empty" style={{ paddingLeft: `${2 * INDENT + 22}px` }}>
									No types yet
								</div>
							)}
						</div>
					);
				})}
			{open && ungrouped.length > 0 && (
				<div className="oe-bblock oe-btype-group" data-group="">
					<div className="oe-tree-row oe-typegroup-row is-static" style={{ paddingLeft: `${INDENT + 4}px` }}>
						<span className="oe-tree-toggle is-leaf" />
						<Icon name="help-circle" className="oe-tree-icon" />
						<span className="oe-tree-name">No group</span>
						<span className="oe-tree-count">{ungrouped.length}</span>
						<span className="oe-bend" />
					</div>
					{ungrouped.map(typeRow)}
				</div>
			)}
		</section>
	);
}

function ToolButton({ icon, label, onClick }: { icon: string; label: string; onClick: (evt: MouseEvent) => void }) {
	return (
		<button className="clickable-icon oe-tool" aria-label={label} onClick={onClick}>
			<Icon name={icon} />
		</button>
	);
}

function Heading({
	depth,
	open,
	icon,
	color,
	title,
	count,
	countTitle,
	countElsewhere,
	className,
	onToggle,
	onAdd,
	addLabel,
	onMenu,
	onDropView,
}: {
	depth: number;
	open: boolean;
	icon: string;
	color?: string;
	title: ReactNode;
	count: number;
	/** the count's tooltip, and whether it counts notes listed elsewhere (shown faint) */
	countTitle?: string;
	countElsewhere?: boolean;
	className: string;
	onToggle: () => void;
	onAdd?: () => void;
	addLabel: string;
	onMenu?: (evt: MouseEvent) => void;
	/** a view row dropped here (by its path): list the view under this heading */
	onDropView?: (path: string) => void;
}) {
	// Entering a child element fires enter before the parent's leave, so count them.
	const [over, setOver] = useState(0);
	const carriesView = (e: DragEvent) => !!onDropView && e.dataTransfer.types.includes(VIEW_DRAG);
	return (
		<div
			className={`oe-bheading ${className}${over > 0 ? " is-drop-target" : ""}`}
			style={{ paddingLeft: `${depth * INDENT + 4}px`, ...(color ? { "--oe-type-color": color } : {}) } as CSSProperties}
			onClick={onToggle}
			onContextMenu={(e) => {
				if (!onMenu) return;
				e.preventDefault();
				onMenu(e);
			}}
			onDragEnter={(e) => {
				if (!carriesView(e)) return;
				e.preventDefault();
				setOver((n) => n + 1);
			}}
			onDragOver={(e) => {
				if (!carriesView(e)) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
			}}
			onDragLeave={(e) => carriesView(e) && setOver((n) => Math.max(0, n - 1))}
			onDrop={(e) => {
				if (!carriesView(e)) return;
				e.preventDefault();
				setOver(0);
				const path = e.dataTransfer.getData(VIEW_DRAG);
				if (path) onDropView!(path);
			}}
		>
			<Icon name={open ? "chevron-down" : "chevron-right"} className="oe-tree-chevron" />
			<Icon name={icon} className="oe-bheading-icon" />
			<span className="oe-bheading-title">{title}</span>
			<span className={`oe-bheading-count${countElsewhere ? " is-elsewhere" : ""}`} title={countTitle}>
				{count}
			</span>
			{/* The end slot (the + button, or nothing): the same width on every row, so the counts line up. */}
			<span className="oe-bend">
				{onAdd && (
					<button
						className="clickable-icon oe-bheading-add"
						aria-label={addLabel}
						onClick={(e) => {
							e.stopPropagation();
							onAdd();
						}}
					>
						<Icon name="plus" />
					</button>
				)}
			</span>
		</div>
	);
}

/**
 * A view note's row: its layout's icon and name. Click opens it; drag it onto a heading to list it there; right-click
 * for "Show under…" (the same, from a list) and the file menu.
 */
function ViewRow({ file, depth, active }: { file: TFile; depth: number; active: boolean }) {
	const plugin = usePlugin();
	return (
		<div
			className={`oe-tree-row oe-view-row${active ? " is-active" : ""}`}
			style={{ paddingLeft: `${depth * INDENT + 4}px` }}
			data-path={file.path}
			draggable
			onDragStart={(e) => {
				e.dataTransfer.setData(VIEW_DRAG, file.path);
				e.dataTransfer.effectAllowed = "move";
			}}
			onClick={(evt) => plugin.openPath(file.path, evt.nativeEvent)}
			onAuxClick={(evt) => evt.button === 1 && plugin.openPath(file.path, "tab")}
			onContextMenu={(evt) => {
				evt.preventDefault();
				const m = new Menu();
				m.addItem((i) => i.setSection("open").setTitle("Show under…").setIcon("folder-input").onClick(() => new ViewPlaceModal(plugin, file).open()));
				plugin.app.workspace.trigger("file-menu", m, file, "obs-entities-browser");
				m.showAtMouseEvent(evt.nativeEvent);
			}}
		>
			<span className="oe-tree-toggle is-leaf" />
			<Icon name={VIEW_KIND_ICON[plugin.views.kind(file.path) ?? "table"] ?? "table"} className="oe-tree-icon" />
			<span className="oe-tree-name">{file.basename}</span>
		</div>
	);
}

function TreeRow({
	node,
	depth,
	isOpen,
	activePath,
	onToggle,
}: {
	node: TreeNode<EntityRecord>;
	depth: number;
	isOpen: (path: string) => boolean;
	activePath: string | null;
	onToggle: (path: string) => void;
}) {
	const plugin = usePlugin();
	const { app } = plugin;
	const e = node.entity;
	const hasKids = node.children.length > 0;
	const open = hasKids && isOpen(e.path);

	const onHover = (evt: MouseEvent) =>
		app.workspace.trigger("hover-link", {
			event: evt.nativeEvent,
			source: HOVER_SOURCE,
			hoverParent: { hoverPopover: null },
			targetEl: evt.currentTarget,
			linktext: e.path,
			sourcePath: "",
		});

	const onMenu = (evt: MouseEvent) => {
		evt.preventDefault();
		const m = new Menu();
		m.addItem((i) => i.setSection("open").setTitle("Open in new tab").setIcon("file-plus").onClick(() => plugin.openPath(e.path, "tab")));
		m.addItem((i) => i.setSection("open").setTitle("Open to the right").setIcon("separator-vertical").onClick(() => plugin.openPath(e.path, "split")));
		for (const c of childOptions(e.type, plugin.settings.types)) {
			m.addItem((i) =>
				i
					.setSection("new")
					.setTitle(`New ${c.type.name.toLowerCase()} here`)
					.setIcon(c.type.icon)
					.onClick(() => plugin.createChild(e, c.type, c.field)),
			);
		}
		m.addItem((i) =>
			i
				.setSection("view")
				.setTitle("Show connections")
				.setIcon("waypoints")
				.onClick(async () => {
					await app.workspace.openLinkText(e.path, "", false);
					await plugin.activateSidePanel();
				}),
		);
		app.workspace.trigger("file-menu", m, e.file as TFile, "obs-entities-browser");
		m.addItem((i) =>
			i
				.setSection("danger")
				.setTitle("Delete")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => {
					// What's left pointing at it: notes linking to it (their links stop working), and its children here.
					const linking = Object.entries(app.metadataCache.resolvedLinks).filter(([src, to]) => src !== e.path && to[e.path]).length;
					const kids = node.children.length;
					const after = [
						linking ? `${linking === 1 ? "1 note links" : `${linking} notes link`} to it; those links will point to a missing note.` : "",
						kids ? `${kids === 1 ? "Its 1 child stays" : `Its ${kids} children stay`}, linking to it.` : "",
					].filter(Boolean);
					new ConfirmModal(
						app,
						`Delete “${e.name}”?`,
						`The note goes to the trash (following Obsidian's “Deleted files” setting), so it can be restored from there or with File recovery.${after.length ? ` ${after.join(" ")}` : ""}`,
						"Delete",
						() => plugin.bulk.delete([e.path]),
					).open();
				}),
		);
		m.showAtMouseEvent(evt.nativeEvent);
	};

	return (
		<>
			<div
				className={`oe-tree-row${activePath === e.path ? " is-active" : ""}${node.context ? " is-context" : ""}`}
				style={{ paddingLeft: `${depth * INDENT + 4}px`, "--oe-type-color": e.type.color } as CSSProperties}
				data-path={e.path}
				onClick={(evt) => {
					evt.preventDefault();
					plugin.openPath(e.path, evt.nativeEvent);
				}}
				onAuxClick={(evt) => evt.button === 1 && plugin.openPath(e.path, "tab")}
				onMouseOver={onHover}
				onContextMenu={onMenu}
				title={[node.parent ? `In ${node.parent.name}` : "", e.subtitle ?? ""].filter(Boolean).join(" · ") || undefined}
			>
				<span
					className={`oe-tree-toggle${hasKids ? "" : " is-leaf"}`}
					onClick={(evt) => {
						evt.stopPropagation();
						if (hasKids) onToggle(e.path);
					}}
				>
					{hasKids && <Icon name={open ? "chevron-down" : "chevron-right"} className="oe-tree-chevron" />}
				</span>
				<Icon name={e.type.icon} className="oe-tree-icon" />
				<span className="oe-tree-name">{e.name}</span>
				{hasKids && !open && <span className="oe-tree-count">{node.size}</span>}
				<span className="oe-bend">
					<StatusDot status={e.status} color={e.status ? statusColor(e.status, e.type, plugin.settings.groups) : null} />
				</span>
			</div>
			{open && node.children.map((c) => <TreeRow key={c.entity.path} node={c} depth={depth + 1} isOpen={isOpen} activePath={activePath} onToggle={onToggle} />)}
		</>
	);
}
