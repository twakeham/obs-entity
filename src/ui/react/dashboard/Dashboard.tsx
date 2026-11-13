import { Component, MarkdownRenderer, Notice, stringifyYaml } from "obsidian";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import {
	CHART_LABELS,
	COMPONENT_ICONS,
	COMPONENT_KINDS,
	COMPONENT_LABELS,
	DEFAULT_SIZE,
	DEFAULT_CARD_LAYOUT,
	evaluateDashboard,
	GRID_COLS,
	newComponent,
	readingOrder,
	ROW_HEIGHT,
	serializeDashboard,
	STACK_BELOW,
	type CardOut,
	type ComponentLook,
	type ChartOut,
	type ComponentKind,
	type DashComponent,
	type DashboardDef,
	type DashEnv,
	type ListOut,
} from "../../../model/dashboard";
import { ROW_TARGET, serializeView } from "../../../model/views";
import { buttonLabel, inScope, noteless, workflowProblems } from "../../../model/workflows";
import { NotePickerModal } from "../../modals/workflowModals";
import { usePlugin, useRelationsVersion } from "../context";
import { StatusDot } from "../EntityBrowser";
import { Icon } from "../Icon";
import { EntityTable } from "../table/EntityTable";
import { cssColor, hlClasses } from "../table/popovers";
import { DashboardSettings } from "./DashboardSettings";
import { Chart } from "./Chart";

const MARGIN = 10;
/** what's being dragged from the palette */
let paletteKind: ComponentKind | null = null;

/**
 * A dashboard (DESIGN §8.12): components on a grid. View mode shows them; edit mode (tab only) adds a palette, drag
 * and resize, and the selected component's settings. Edits are a draft (kept in `plugin.dashboardDrafts`) until Save.
 */
export function Dashboard({ path, initial, errors, save, openEditor }: { path: string; initial: DashboardDef; errors: string[]; save?: (def: DashboardDef) => Promise<boolean>; openEditor?: () => void }) {
	const plugin = usePlugin();
	const canEdit = !!save;
	// What's saved: the definition it opened with, then whatever it saves (the host doesn't re-render for its own save).
	const [base, setBase] = useState(initial);
	const [draft, setDraftState] = useState<DashboardDef | null>(() => (canEdit ? (plugin.dashboardDrafts.get(path) ?? null) : null));
	const [editing, setEditing] = useState(() => canEdit && (plugin.dashboardEditOnOpen.delete(path) || !!plugin.dashboardDrafts.get(path)));
	const [selected, setSelected] = useState<string | null>(null);
	const def = draft ?? base;
	const dirty = !!draft && JSON.stringify(serializeDashboard(draft)) !== JSON.stringify(serializeDashboard(base));
	const setDraft = (next: DashboardDef | null) => {
		if (next) plugin.dashboardDrafts.set(path, next);
		else plugin.dashboardDrafts.delete(path);
		setDraftState(next);
	};
	const edit = (fn: (d: DashboardDef) => DashboardDef) => setDraft(fn(draft ?? base));
	const setComponent = (c: DashComponent) => edit((d) => ({ ...d, components: d.components.map((x) => (x.id === c.id ? c : x)) }));

	// Data: the notes (per index version) and the view notes' definitions (per change to them).
	const version = useRelationsVersion();
	const [viewsVersion, setViewsVersion] = useState(0);
	useEffect(() => {
		const ref = plugin.views.on("updated", () => setViewsVersion((n) => n + 1));
		return () => plugin.views.offref(ref);
	}, [plugin]);
	const env: DashEnv = useMemo(() => {
		const { rows, ctx } = plugin.viewData();
		return {
			rows,
			ctx,
			view: (name) => {
				const p = plugin.views.find(name, path);
				return p ? plugin.views.viewDef(p) : null;
			},
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [plugin, version, viewsVersion, path]);
	const out = useMemo(() => evaluateDashboard(def, env), [def, env]);

	const doSave = async () => {
		if (!save || !draft) return;
		if (await save(draft)) {
			setBase(draft);
			setDraft(null);
			setEditing(false);
			setSelected(null);
		}
	};
	const discard = () => {
		setDraft(null);
		setEditing(false);
		setSelected(null);
	};

	const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 800 });
	const stacked = !editing && width < STACK_BELOW;
	const layout: Layout = def.components.map((c) => ({ i: c.id, ...c.at }));
	const applyLayout = (l: Layout) => {
		const moved = def.components.map((c) => {
			const it = l.find((x) => x.i === c.id);
			return it && (it.x !== c.at.x || it.y !== c.at.y || it.w !== c.at.w || it.h !== c.at.h) ? { ...c, at: { x: it.x, y: it.y, w: it.w, h: it.h } } : c;
		});
		if (moved.some((c, i) => c !== def.components[i])) edit((d) => ({ ...d, components: moved }));
	};
	const add = (kind: ComponentKind, at?: { x: number; y: number }) => {
		const c = newComponent(kind, def, at);
		edit((d) => ({ ...d, components: [...d.components, c] }));
		setSelected(c.id);
		reveal.current = c.id;
	};
	// Scroll a component just added (at the bottom) into view once it's on the grid.
	const reveal = useRef<string | null>(null);
	useEffect(() => {
		const id = reveal.current;
		if (!id) return;
		const el = containerRef.current?.querySelector<HTMLElement>(`[data-dash-id="${CSS.escape(id)}"]`);
		if (!el) return;
		reveal.current = null;
		el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});

	const box = (c: DashComponent) => {
		const look = out.looks.get(c.id);
		return (
			<div
				key={c.id}
				data-dash-id={c.id}
				className={`oe-dash-item oe-dash-${c.kind}${editing && selected === c.id ? " is-selected" : ""} ${hlClasses(look?.box)}`}
				onClick={editing ? () => setSelected(c.id) : undefined}
				style={stacked ? { height: `${c.at.h * ROW_HEIGHT + (c.at.h - 1) * MARGIN}px` } : undefined}
			>
				<ComponentBody c={c} card={out.cards.get(c.id)} list={out.lists.get(c.id)} chart={out.charts.get(c.id)} look={look} path={path} editing={editing} />
			</div>
		);
	};
	const chosen = def.components.find((c) => c.id === selected) ?? null;
	const startEdit = () => (canEdit ? setEditing(true) : openEditor?.());

	return (
		<div className={`oe-dash${editing ? " is-editing" : ""}`}>
			<div className="oe-dash-bar">
				{editing ? (
					<>
						<span className="oe-dash-bar-title">Editing dashboard</span>
						{dirty && <span className="oe-dash-dirty">Unsaved changes</span>}
						<button onClick={discard}>{dirty ? "Discard" : "Done"}</button>
						{dirty && (
							<button className="mod-cta" onClick={() => void doSave()}>
								Save
							</button>
						)}
					</>
				) : (
					<>
						<span className="oe-dash-bar-title" />
						{dirty && <span className="oe-dash-dirty">Unsaved changes</span>}
						{(canEdit || openEditor) && (
							<button className="clickable-icon oe-dash-edit" aria-label="Edit dashboard" onClick={startEdit}>
								<Icon name="pencil" />
								<span>Edit</span>
							</button>
						)}
					</>
				)}
			</div>
			{errors.length > 0 && (
				<div className="oe-dash-errors">
					{errors.map((e, i) => (
						<div key={i}>{e}</div>
					))}
				</div>
			)}
			<div className="oe-dash-main">
				{editing && (
					<div className="oe-dash-palette">
						<div className="oe-dash-panel-title">Add</div>
						{COMPONENT_KINDS.map((k) => (
							<div
								key={k}
								className="oe-dash-palette-item droppable-element"
								draggable
								onDragStart={(e) => {
									paletteKind = k;
									e.dataTransfer.setData("text/plain", "");
								}}
								onDragEnd={() => (paletteKind = null)}
								onClick={() => add(k)}
								title="Drag onto the grid, or click to add at the bottom"
							>
								<Icon name={COMPONENT_ICONS[k]} />
								<span>{COMPONENT_LABELS[k]}</span>
							</div>
						))}
					</div>
				)}
				<div className="oe-dash-grid">
					<div className="oe-dash-grid-inner" ref={containerRef}>
					{def.components.length === 0 && !editing && (
						<div className="oe-dash-empty">
							This dashboard is empty.{" "}
							{(canEdit || openEditor) && (
								<a href="#" onClick={(e) => (e.preventDefault(), startEdit())}>
									Edit it
								</a>
							)}{" "}
							to add summary cards, lists, views, text and buttons.
						</div>
					)}
					{def.components.length === 0 && editing && <div className="oe-dash-empty">Drag a component here from the left, or click one to add it.</div>}
					{stacked ? (
						<div className="oe-dash-stack">{readingOrder(def.components).map(box)}</div>
					) : (
						mounted && (
							<ReactGridLayout
								layout={layout}
								width={width}
								gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: [MARGIN, MARGIN], containerPadding: [0, 0] }}
								dragConfig={{ enabled: editing }}
								resizeConfig={{ enabled: editing }}
								dropConfig={{ enabled: editing, defaultItem: { w: 3, h: 2 }, onDragOver: () => (paletteKind ? DEFAULT_SIZE[paletteKind] : false) }}
								onLayoutChange={(l) => editing && applyLayout(l)}
								onDrop={(_l, item) => {
									if (paletteKind && item) add(paletteKind, { x: item.x, y: item.y });
									paletteKind = null;
								}}
							>
								{def.components.map(box)}
							</ReactGridLayout>
						)
					)}
					</div>
				</div>
				{editing && (
					<div className="oe-dash-settings">
						{chosen ? (
							<DashboardSettings
								key={chosen.id}
								c={chosen}
								def={def}
								env={env}
								path={path}
								card={out.cards.get(chosen.id)}
								cards={out.cards}
								look={out.looks.get(chosen.id)}
								chart={out.charts.get(chosen.id)}
								list={out.lists.get(chosen.id)}
								onChange={setComponent}
								onDelete={() => {
									edit((d) => ({ ...d, components: d.components.filter((x) => x.id !== chosen.id) }));
									setSelected(null);
								}}
								onDuplicate={() => {
									const copy = { ...structuredClone(chosen), id: newComponent(chosen.kind, def).id, at: { ...chosen.at, y: chosen.at.y + chosen.at.h } };
									edit((d) => ({ ...d, components: [...d.components, copy] }));
									setSelected(copy.id);
								}}
							/>
						) : (
							<div className="oe-dash-settings-empty">Select a component to change it. Drag a component to move it, and its bottom-right corner to resize it.</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/** A component's contents (the same in view and edit mode; in edit mode they don't take clicks). */
function ComponentBody({ c, card, list, chart, look, path, editing }: { c: DashComponent; card?: CardOut; list?: ListOut; chart?: ChartOut; look?: ComponentLook; path: string; editing: boolean }) {
	const plugin = usePlugin();
	switch (c.kind) {
		case "card":
			return <CardBox c={c} out={card} look={look} editing={editing} />;
		case "chart":
			return chart ? <Chart kind={c.chart} title={c.title || CHART_LABELS[c.chart]} icon={look?.box.icon} out={chart} open={(d) => void plugin.openDrill(d)} /> : null;
		case "list":
			return <ListBox c={c} out={list} icon={look?.box.icon} />;
		case "view":
			return <ViewBox c={c} path={path} editing={editing} />;
		case "text":
			return <TextBox text={c.text} path={path} />;
		case "button":
			return <ButtonBox c={c} />;
	}
}

function CardBox({ c, out, look, editing }: { c: Extract<DashComponent, { kind: "card" }>; out?: CardOut; look?: ComponentLook; editing: boolean }) {
	const plugin = usePlugin();
	const drill = !editing && out?.drill && out.drill.paths.length ? out.drill : null;
	const L = look?.card ?? DEFAULT_CARD_LAYOUT;
	// A rule on the value styles just the value; the card's own style (and its icon) applies otherwise.
	const icon = look?.value?.icon ?? look?.box.icon;
	const side = !!icon && L.icon === "side";
	// The side icon and the accent edge take the card's colour: the value's, else the card's (text, then fill).
	const tone = look?.value?.text ?? look?.value?.fill ?? look?.box.text ?? look?.box.fill;
	const text = out?.text || "–";
	const title = <div className="oe-dash-card-title">{c.title || out?.label || "Card"}</div>;
	return (
		<div
			className={`oe-dash-card-body${drill ? " is-clickable" : ""} is-size-${L.size} is-align-${L.align}${side ? " has-side-icon" : ""}${L.accent !== "none" ? ` is-accent-${L.accent}` : ""}`}
			style={{ ...(tone ? { "--oe-tone": cssColor(tone) } : {}), "--oe-chars": text.length + (icon && !side ? 1.3 : 0) } as CSSProperties}
			title={out?.count !== undefined ? `${out.count} note${out.count === 1 ? "" : "s"}${drill ? ": click to open them as a table" : ""}` : undefined}
			role={drill ? "button" : undefined}
			tabIndex={drill ? 0 : undefined}
			onClick={drill ? () => void plugin.openDrill(drill) : undefined}
			onKeyDown={drill ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), void plugin.openDrill(drill)) : undefined}
		>
			{side && (
				<div className="oe-dash-card-side" aria-hidden="true">
					<Icon name={icon} />
				</div>
			)}
			<div className="oe-dash-card-main">
				{L.label === "above" && title}
				{out?.error ? (
					<div className="oe-dash-problem">{out.error}</div>
				) : (
					<div className={`oe-dash-card-value ${hlClasses(look?.value)}`}>
						{icon && !side && <Icon name={icon} className="oe-hl-icon oe-dash-card-icon" />}
						<span>{text}</span>
					</div>
				)}
				{L.label === "below" && title}
				{L.caption && !out?.error && <div className="oe-dash-card-caption">{L.caption}</div>}
			</div>
		</div>
	);
}

function ListBox({ c, out, icon }: { c: Extract<DashComponent, { kind: "list" }>; out?: ListOut; icon?: string }) {
	const plugin = usePlugin();
	const rules = c.highlight ?? [];
	const styleOf = (i: number | undefined) => (i === undefined ? undefined : rules[i]?.style);
	return (
		<div className="oe-dash-list-body">
			<div className="oe-dash-head">
				{icon && <Icon name={icon} className="oe-hl-icon" />}
				<span className="oe-dash-head-title">{c.title || "List"}</span>
				{out && !out.error && <span className="oe-dash-head-count">{out.total}</span>}
			</div>
			{out?.error ? (
				<div className="oe-dash-problem">{out.error}</div>
			) : (
				<div className="oe-dash-list">
					{out?.rows.length === 0 && <div className="oe-dash-muted">No notes.</div>}
					{out?.rows.map((r) => {
						const row = styleOf(r.hl?.[ROW_TARGET]);
						return (
							<div key={r.row.path} className={`oe-dash-list-row ${hlClasses(row)}`} onClick={(e: ReactMouseEvent) => plugin.openPath(r.row.path, e.nativeEvent)}>
								<StatusDot status={r.row.status} />
								{row?.icon && <Icon name={row.icon} className="oe-hl-icon" />}
								<span className="oe-dash-list-name">{r.row.name}</span>
								{out.columns.map((col) => {
									const cell = styleOf(r.hl?.[col.id]);
									return (
										<span key={col.id} className={`oe-dash-list-field ${hlClasses(cell)}`} title={col.label}>
											{cell?.icon && <Icon name={cell.icon} className="oe-hl-icon" />}
											{r.cells[col.id]?.text ?? ""}
										</span>
									);
								})}
							</div>
						);
					})}
					{out && out.total > out.rows.length && <div className="oe-dash-muted">+{out.total - out.rows.length} more</div>}
				</div>
			)}
		</div>
	);
}

function ViewBox({ c, path, editing }: { c: Extract<DashComponent, { kind: "view" }>; path: string; editing: boolean }) {
	const plugin = usePlugin();
	const [, setTick] = useState(0);
	useEffect(() => {
		const ref = plugin.views.on("updated", () => setTick((n) => n + 1));
		return () => plugin.views.offref(ref);
	}, [plugin]);
	const at = c.view ? plugin.views.find(c.view, path) : null;
	const viewDef = at ? plugin.views.viewDef(at) : null;
	if (!c.view) return <div className="oe-dash-problem">Choose a view to show.</div>;
	if (!at || !viewDef) return <div className="oe-dash-problem">{at ? `"${c.view}" can't be shown here.` : `There's no view called "${c.view}".`}</div>;
	return (
		<div className={`oe-dash-view-body${editing ? " is-inert" : ""}`}>
			<EntityTable
				key={`${at}\u0000${JSON.stringify(serializeView(viewDef))}`}
				initial={viewDef}
				warnings={[]}
				sourcePath={at}
				stateKey={`${path}#${c.id}`}
				save={async (d) => {
					if (!(await plugin.writeViewBlock(at, stringifyYaml(serializeView(d))))) new Notice(`Couldn't save the view "${c.view}".`);
				}}
				editDefinition={() => plugin.openPath(at, "tab")}
				fill
			/>
		</div>
	);
}

function TextBox({ text, path }: { text: string; path: string }) {
	const plugin = usePlugin();
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const owner = new Component();
		owner.load();
		el.empty();
		void MarkdownRenderer.render(plugin.app, text, el, path, owner);
		return () => owner.unload();
	}, [plugin, text, path]);
	return <div className="oe-dash-text-body markdown-rendered" ref={ref} />;
}

function ButtonBox({ c }: { c: Extract<DashComponent, { kind: "button" }> }) {
	const plugin = usePlugin();
	const run = () => {
		const a = c.action;
		if (!a) return void new Notice("This button has no action yet: edit the dashboard to give it one.");
		if ("new" in a) {
			const type = plugin.getType(a.new);
			if (!type) return void new Notice(`There's no type called "${a.new}".`);
			return plugin.openCreateModal(type);
		}
		if ("open" in a) {
			const dest = plugin.app.metadataCache.getFirstLinkpathDest(a.open.replace(/^\[\[|\]\]$/g, ""), "");
			if (!dest) return void new Notice(`There's no note called "${a.open}".`);
			return plugin.openPath(dest.path);
		}
		const wf = plugin.settings.workflows.find((w) => w.id === a.workflow);
		if (!wf) return void new Notice("That workflow no longer exists.");
		if (!wf.on || plugin.settings.workflowsPaused || workflowProblems(wf, plugin.settings).length) return void new Notice(`"${wf.name}" can't run now: it's off, paused or has problems.`);
		if (noteless(wf)) return void plugin.runWorkflow(wf, []);
		const notes = plugin.index.all().filter((e) => inScope(wf, e.type));
		if (!notes.length) return void new Notice("There are no notes to run it on.");
		new NotePickerModal(plugin.app, notes, `Run “${buttonLabel(wf)}” on a note…`, (entity) => void plugin.runWorkflow(wf, [entity.path])).open();
	};
	return (
		<button className="oe-dash-button-body mod-cta" onClick={run}>
			{c.icon && <Icon name={c.icon} />}
			<span>{c.label}</span>
		</button>
	);
}
