import { Menu, TFile } from "obsidian";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
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
import { DEFAULT_STATUSES, type EntityTypeDef } from "../../model/types";
import type { EntityRecord } from "../../services/entityIndex";
import { TypePickerModal } from "../components/entityPicker";
import { usePlugin, useRelationsVersion } from "./context";
import { HOVER_SOURCE } from "./EntityChip";
import { statusTone } from "./EntityBits";
import { Icon } from "./Icon";

export interface BrowserState extends BrowserOptions {
	search: string;
	type: string;
	status: string;
	tag: string;
	/** expanded entity paths */
	expanded: string[];
	/** collapsed section ("s:<key>") and type-heading ("b:<key>") keys */
	collapsed: string[];
}

export const DEFAULT_BROWSER_STATE: BrowserState = { ...DEFAULT_BROWSER_OPTIONS, search: "", type: "", status: "", tag: "", expanded: [], collapsed: [] };

const INDENT = 14;
const sKey = (s: BrowserSection) => `s:${s.key}`;
const bKey = (b: BrowserBlock) => `b:${b.key}`;

export function StatusDot({ status }: { status: string | null }) {
	return <span className={`oe-dot oe-tone-${status ? statusTone(status) : "none"}`} aria-label={status ?? "no status"} />;
}

export function EntityBrowser({ state, setState, activePath }: { state: BrowserState; setState: (patch: Partial<BrowserState>) => void; activePath: string | null }) {
	const plugin = usePlugin();
	const version = useRelationsVersion();
	const listRef = useRef<HTMLDivElement>(null);
	const { types, groups } = plugin.settings;
	const opts: BrowserOptions = { sections: state.sections, typeHeadings: state.typeHeadings, crossGroup: state.crossGroup, showEmpty: state.showEmpty };

	const { sections, tags } = useMemo(() => {
		const entities = plugin.index.all();
		const tagSet = new Set<string>();
		for (const e of entities) for (const t of e.tags) tagSet.add(t);
		return {
			sections: buildBrowser<EntityRecord>(entities, plugin.relations.allEdges(), types, groups, opts),
			tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b)),
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [version, types, groups, plugin, state.sections, state.typeHeadings, state.crossGroup, state.showEmpty]);

	const statuses = useMemo(() => {
		const all = [...groups.flatMap((g) => g.statuses), ...types.flatMap((t) => t.statuses ?? [])];
		return Array.from(new Set(all.length ? all : DEFAULT_STATUSES));
	}, [groups, types]);

	const query = state.search.trim().toLowerCase();
	const filtering = !!(query || state.type || state.status || state.tag);
	const shown = useMemo(() => {
		if (!filtering) return sections;
		const match = (e: EntityRecord) =>
			(!query || e.name.toLowerCase().includes(query) || e.aliases.some((a) => a.toLowerCase().includes(query))) &&
			(!state.type || e.type.key === state.type) &&
			(!state.status || e.status === state.status) &&
			(!state.tag || e.tags.some((t) => t === state.tag || t.startsWith(`${state.tag}/`)));
		return filterBrowser(sections, match);
	}, [sections, filtering, query, state.type, state.status, state.tag]);

	const expanded = useMemo(() => new Set(state.expanded), [state.expanded]);
	const collapsed = useMemo(() => new Set(state.collapsed), [state.collapsed]);

	// While filtering, everything starts expanded so matches are visible; collapses made during
	// filtering are kept separately and forgotten whenever the filter changes.
	const filterKey = `${query}\u0000${state.type}\u0000${state.status}\u0000${state.tag}`;
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
	const collapseAll = () => {
		if (filtering) setFilterClosed({ key: filterKey, items: new Set(headingKeys(shown)) });
		else setState({ expanded: [], collapsed: headingKeys(sections) });
	};
	const expandAll = () => {
		if (filtering) setFilterClosed({ key: filterKey, items: new Set() });
		else setState({ expanded: branchPaths(sections), collapsed: [] });
	};

	// Reveal the active note once when it becomes active (not on every index update, so manual
	// collapsing sticks): open its section, type heading and ancestors, then scroll it into view.
	const revealed = useRef<string | null>(null);
	useEffect(() => {
		if (!activePath || revealed.current === activePath) return;
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
		opt("sections", "Sections: groups", state.sections === "groups", { sections: "groups" });
		opt("sections", "Sections: none (one tree)", state.sections === "none", { sections: "none" });
		opt("headings", "Type headings", state.typeHeadings, { typeHeadings: !state.typeHeadings });
		opt("cross", "Children in other groups stay in their own group", state.crossGroup === "own", { crossGroup: "own" }, state.sections === "none");
		opt("cross", "Children in other groups nest under their parent", state.crossGroup === "parent", { crossGroup: "parent" }, state.sections === "none");
		opt("empty", "Show empty types", state.showEmpty, { showEmpty: !state.showEmpty });
		m.showAtMouseEvent(evt.nativeEvent);
	};

	const filters = [state.type, state.status, state.tag].filter(Boolean).length;
	const groupSections = state.sections === "groups";
	const base = (groupSections ? 1 : 0) + (state.typeHeadings ? 1 : 0);

	return (
		<div className="oe-browser">
			<div className="oe-browser-toolbar">
				<input type="search" className="oe-browser-search" placeholder="Search entities…" value={state.search} onChange={(e) => setState({ search: e.target.value })} aria-label="Search entities" />
				<ToolButton icon="sliders-horizontal" label="View options" onClick={viewMenu} />
				<ToolButton icon="chevrons-down-up" label="Collapse all" onClick={collapseAll} />
				<ToolButton icon="chevrons-up-down" label="Expand all" onClick={expandAll} />
				<ToolButton icon="plus" label="New entity" onClick={() => plugin.openCreateModal(null)} />
			</div>
			<div className="oe-browser-filters">
				<select className="dropdown" value={state.type} onChange={(e) => setState({ type: e.target.value })} aria-label="Type">
					<option value="">All types</option>
					{types.map((t) => (
						<option key={t.key} value={t.key}>
							{t.name}
						</option>
					))}
				</select>
				<select className="dropdown" value={state.status} onChange={(e) => setState({ status: e.target.value })} aria-label="Status">
					<option value="">Any status</option>
					{statuses.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
				<select className="dropdown" value={state.tag} onChange={(e) => setState({ tag: e.target.value })} aria-label="Tag">
					<option value="">Any tag</option>
					{tags.map((t) => (
						<option key={t} value={t}>
							#{t}
						</option>
					))}
				</select>
			</div>
			{(filters > 0 || query) && (
				<div className="oe-browser-filterbar">
					<span>
						{shown.reduce((n, s) => n + s.count, 0)} match{shown.reduce((n, s) => n + s.count, 0) === 1 ? "" : "es"}
					</span>
					<a href="#" className="oe-browser-clear" onClick={(e) => (e.preventDefault(), setState({ search: "", type: "", status: "", tag: "" }))}>
						Clear
					</a>
				</div>
			)}

			<div className="oe-browser-list" ref={listRef}>
				{shown.length === 0 && <div className="oe-panel-empty">{filtering ? "No matching entities." : "No entities yet. Use + to create one."}</div>}
				{shown.map((s) => {
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
													m.addItem((i) => i.setSection("config").setTitle("Configure group").setIcon("settings-2").onClick(() => void plugin.activateTypes(`group:${s.group!.key}`)));
													m.showAtMouseEvent(evt.nativeEvent);
												}
											: undefined
									}
								/>
							)}
							{!sClosed &&
								s.blocks.map((b) => {
									const bid = bKey(b);
									const bClosed = !!b.type && isCollapsed(bid);
									const t = b.type;
									return (
										<div key={bid} className="oe-bblock" data-block={b.key}>
											{t && (
												<Heading
													depth={groupSections ? 1 : 0}
													open={!bClosed}
													icon={t.icon}
													color={t.color}
													title={t.plural || t.name}
													count={b.count}
													className="oe-bblock-header"
													onToggle={() => toggleHeading(bid)}
													onAdd={() => plugin.openCreateModal(t)}
													addLabel={`New ${t.name.toLowerCase()}`}
													onMenu={(evt) => {
														const m = new Menu();
														m.addItem((i) => i.setSection("new").setTitle(`New ${t.name.toLowerCase()}`).setIcon(t.icon).onClick(() => plugin.openCreateModal(t)));
														m.addItem((i) => i.setSection("config").setTitle(`Configure the ${t.name} type`).setIcon("shapes").onClick(() => void plugin.activateTypes(t.key)));
														m.showAtMouseEvent(evt.nativeEvent);
													}}
												/>
											)}
											{!bClosed && (
												<div className="oe-tree">
													{b.roots.map((n) => (
														<TreeRow key={n.entity.path} node={n} depth={base} isOpen={isOpen} activePath={activePath} onToggle={toggleNode} />
													))}
													{t && b.roots.length === 0 && (
														<div className="oe-tree-empty" style={{ paddingLeft: `${base * INDENT + 22}px` }}>
															No {(t.plural || t.name).toLowerCase()} yet
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
	className,
	onToggle,
	onAdd,
	addLabel,
	onMenu,
}: {
	depth: number;
	open: boolean;
	icon: string;
	color?: string;
	title: ReactNode;
	count: number;
	className: string;
	onToggle: () => void;
	onAdd?: () => void;
	addLabel: string;
	onMenu?: (evt: MouseEvent) => void;
}) {
	return (
		<div
			className={`oe-bheading ${className}`}
			style={{ paddingLeft: `${depth * INDENT + 4}px`, ...(color ? { "--oe-type-color": color } : {}) } as CSSProperties}
			onClick={onToggle}
			onContextMenu={(e) => {
				if (!onMenu) return;
				e.preventDefault();
				onMenu(e);
			}}
		>
			<Icon name={open ? "chevron-down" : "chevron-right"} className="oe-tree-chevron" />
			<Icon name={icon} className="oe-bheading-icon" />
			<span className="oe-bheading-title">{title}</span>
			<span className="oe-bheading-count">{count}</span>
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
					await plugin.activateConnectionsView();
				}),
		);
		app.workspace.trigger("file-menu", m, e.file as TFile, "obs-entities-browser");
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
				title={e.subtitle || undefined}
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
				<StatusDot status={e.status} />
			</div>
			{open && node.children.map((c) => <TreeRow key={c.entity.path} node={c} depth={depth + 1} isOpen={isOpen} activePath={activePath} onToggle={onToggle} />)}
		</>
	);
}
