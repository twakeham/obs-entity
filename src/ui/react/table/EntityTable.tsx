import { Menu, Notice, TFile, stringifyYaml } from "obsidian";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { FieldProblem } from "../../../model/form";
import type { FieldValue } from "../../../model/frontmatter";
import { isListValued, statusesFor, type EntityTypeDef } from "../../../model/types";
import {
	availableColumns,
	cellOf,
	cycleSort,
	filterFields,
	OPERATORS,
	prefillFromFilters,
	resolveColumn,
	runView,
	serializeView,
	sourceTypes,
	type ColumnDef,
	type ResolvedColumn,
	type ResultRow,
	type ViewDef,
} from "../../../model/views";
import { VIEW_BLOCK } from "../../../services/viewIndex";
import { TypePickerModal } from "../../components/entityPicker";
import { NameModal, RollupModal } from "../../modals/viewModals";
import { usePlugin, useRelationsVersion } from "../context";
import { HOVER_SOURCE } from "../EntityChip";
import { Icon } from "../Icon";
import { CellEditor, CellView, editTarget } from "./cells";
import { ColumnsPanel, FiltersPanel, GroupPanel, Popover, SortPanel, type ColumnChoice } from "./popovers";

/** What survives the re-render after a save, per block, for the session. */
interface Session {
	search: string;
	collapsed: string[];
	selected: string[];
	scrollTop: number;
}
const sessions = new Map<string, Session>();

const ROW_H = 34;
const HEAD_H = 34;
const SELECT_W = 36;
const DEFAULT_W: Record<string, number> = { text: 170, number: 100, date: 120, choice: 120, multi: 170, bool: 80, links: 200, folder: 180 };

type Item = { kind: "group"; key: string; label: string; count: number; open: boolean } | { kind: "row"; r: ResultRow; n: number };
type PopName = "filters" | "sort" | "group" | "columns";

export interface EntityTableProps {
	initial: ViewDef;
	/** non-fatal problems with the definition */
	warnings: string[];
	sourcePath: string;
	stateKey: string;
	save: (def: ViewDef) => Promise<void>;
	editDefinition: () => void;
	/** receives the table's "save pending changes now" function (for hosts that close before unmounting) */
	onFlushReady?: (flush: () => void) => void;
	/** fills its container (the entity view tab) instead of sitting in a note */
	fill?: boolean;
}

export function EntityTable({ initial, warnings, sourcePath, stateKey, save, editDefinition, onFlushReady, fill }: EntityTableProps) {
	const plugin = usePlugin();
	const { app } = plugin;
	const version = useRelationsVersion();
	const session = useMemo(() => sessions.get(stateKey) ?? { search: "", collapsed: [], selected: [], scrollTop: 0 }, [stateKey]);
	const [def, setDef] = useState(initial);
	const [search, setSearch] = useState(session.search);
	const [collapsed, setCollapsed] = useState(() => new Set(session.collapsed));
	const [selected, setSelected] = useState(() => new Set(session.selected));
	const [pop, setPop] = useState<{ name: PopName; anchor: DOMRect } | null>(null);
	const [editing, setEditing] = useState<{ path: string; col: string; anchor: DOMRect } | null>(null);
	const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
	const [liveWidth, setLiveWidth] = useState<{ id: string; w: number } | null>(null);
	const [dragCol, setDragCol] = useState<string | null>(null);
	const [scrollTop, setScrollTop] = useState(session.scrollTop);
	const [viewport, setViewport] = useState(600);
	const [showWarnings, setShowWarnings] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const defRef = useRef(def);
	defRef.current = def;
	/** notes edited from this table, newest last, for Ctrl/Cmd+Z */
	const edits = useRef<string[]>([]);
	const lastClicked = useRef<number | null>(null);

	useEffect(() => {
		sessions.set(stateKey, { search, collapsed: [...collapsed], selected: [...selected], scrollTop });
	});

	// ---- saving: debounced, held while a popover or cell editor is open, flushed on unmount
	const pending = useRef<ViewDef | null>(null);
	const timer = useRef(0);
	const held = useRef(false);
	held.current = !!pop || !!editing;
	const flush = () => {
		window.clearTimeout(timer.current);
		const d = pending.current;
		pending.current = null;
		if (d) void save(d);
	};
	const schedule = () => {
		window.clearTimeout(timer.current);
		if (!held.current) timer.current = window.setTimeout(flush, 500);
	};
	const update = (next: ViewDef) => {
		setDef(next);
		pending.current = next;
		schedule();
	};
	useEffect(() => {
		if (!pop && !editing && pending.current) schedule();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pop, editing]);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => () => flush(), []);
	onFlushReady?.(flush);

	// ---- data
	const lookup = useMemo(() => ({ types: plugin.settings.types, groups: plugin.settings.groups }), [plugin, version]);
	const { rows, ctx } = useMemo(() => plugin.viewData(), [plugin, version]);
	const result = useMemo(() => runView(def, rows, ctx, search), [def, rows, ctx, search]);
	const columns = result.columns;
	const sources = useMemo(() => sourceTypes(def, lookup.types), [def, lookup]);
	const available = useMemo(() => availableColumns(def, lookup), [def, lookup]);
	const choices: ColumnChoice[] = useMemo(() => {
		const out: ColumnChoice[] = columns.map((col) => ({ col, group: "In this view" }));
		const add = (list: ColumnDef[], group: string) => {
			for (const c of list) if (!out.some((o) => o.col.id === c.id)) out.push({ col: resolveColumn(c, def, lookup), group });
		};
		add(available.fields, "Fields");
		add(available.builtins, "Built-in");
		add(available.incoming, "Incoming links");
		return out;
	}, [columns, available, def, lookup]);
	const valuesOf = (id: string) => {
		const col = choices.find((c) => c.col.id === id)?.col;
		if (!col) return [];
		const keys = new Set(sources.map((t) => t.key));
		const set = new Set<string>();
		for (const r of rows) {
			if (!keys.has(r.type.key)) continue;
			const v = cellOf(r, col, ctx).value;
			for (const x of Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]) set.add(String(x));
		}
		return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	};

	const items: Item[] = useMemo(() => {
		const out: Item[] = [];
		let n = 0;
		if (result.groups) {
			for (const g of result.groups) {
				const open = !collapsed.has(g.key);
				out.push({ kind: "group", key: g.key, label: g.label, count: g.rows.length, open });
				if (open) for (const r of g.rows) out.push({ kind: "row", r, n: n++ });
			}
		} else for (const r of result.rows) out.push({ kind: "row", r, n: n++ });
		return out;
	}, [result, collapsed]);
	const rowItems = useMemo(() => items.filter((i): i is Extract<Item, { kind: "row" }> => i.kind === "row"), [items]);
	const groupCol = def.group ? result.known.get(def.group.by) : undefined;

	const problemsOf = useMemo(() => {
		const cache = new Map<string, FieldProblem[]>();
		return (path: string) => {
			let p = cache.get(path);
			if (!p) {
				const e = plugin.index.get(path);
				p = e ? plugin.problemsFor(e) : [];
				cache.set(path, p);
			}
			return p;
		};
	}, [plugin, version]);

	// ---- virtual rows
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setViewport(el.clientHeight || 600));
		ro.observe(el);
		el.scrollTop = session.scrollTop;
		return () => ro.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const first = Math.max(0, Math.floor((scrollTop - HEAD_H) / ROW_H) - 10);
	const last = Math.min(items.length, Math.ceil((scrollTop + viewport) / ROW_H) + 10);
	const visible = items.slice(first, last);

	// ---- actions
	const write = (path: string, key: string, value: unknown) => {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		edits.current.push(path);
		plugin.writeProperty(file, key, value).catch((e: Error) => new Notice(`Couldn't save ${key}: ${e.message}`));
	};
	const openPop = (name: PopName, el: HTMLElement) => setPop(pop?.name === name ? null : { name, anchor: el.getBoundingClientRect() });
	const openEditor = (path: string, col: string, el: HTMLElement) => setEditing({ path, col, anchor: el.getBoundingClientRect() });
	const widthOf = (c: ResolvedColumn) => (liveWidth?.id === c.id ? liveWidth.w : (def.widths[c.id] ?? (c.id === "name" ? 220 : (DEFAULT_W[c.kind] ?? 160))));
	const labelOf = (c: ColumnDef) => resolveColumn(c, def, lookup).label;

	const toggleColumn = (c: ColumnDef, on: boolean) => {
		if (c.id === "name") return;
		const cur = defRef.current;
		update({ ...cur, columns: on ? (cur.columns.some((x) => x.id === c.id) ? cur.columns : [...cur.columns, c]) : cur.columns.filter((x) => x.id !== c.id) });
	};
	const rollupDialog = (existing: Extract<ColumnDef, { kind: "rollup" }> | null) =>
		new RollupModal(plugin, defRef.current, existing, (col) => {
			const cur = defRef.current;
			update({ ...cur, columns: existing ? cur.columns.map((x) => (x.id === existing.id ? col : x)) : [...cur.columns, col] });
		}).open();

	const startResize = (e: MouseEvent, c: ResolvedColumn) => {
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startW = widthOf(c);
		let w = startW;
		const move = (ev: globalThis.MouseEvent) => {
			w = Math.max(60, startW + ev.clientX - startX);
			setLiveWidth({ id: c.id, w });
		};
		const up = () => {
			document.removeEventListener("mousemove", move);
			document.removeEventListener("mouseup", up);
			setLiveWidth(null);
			if (Math.round(w) !== startW) update({ ...defRef.current, widths: { ...defRef.current.widths, [c.id]: Math.round(w) } });
		};
		document.addEventListener("mousemove", move);
		document.addEventListener("mouseup", up);
	};

	const dropColumn = (target: string) => {
		if (!dragCol || dragCol === target) return;
		const cols = [...def.columns];
		const from = cols.findIndex((c) => c.id === dragCol);
		if (from < 0) return;
		const [moved] = cols.splice(from, 1);
		const to = Math.max(1, cols.findIndex((c) => c.id === target) + (from <= cols.findIndex((c) => c.id === target) ? 1 : 0));
		cols.splice(to, 0, moved);
		update({ ...def, columns: cols });
		setDragCol(null);
	};

	const headerMenu = (e: MouseEvent, c: ResolvedColumn) => {
		e.preventDefault();
		const m = new Menu();
		m.addItem((i) => i.setSection("sort").setTitle("Sort ascending").setIcon("arrow-up").onClick(() => update({ ...def, sort: [{ by: c.id, dir: "asc" }] })));
		m.addItem((i) => i.setSection("sort").setTitle("Sort descending").setIcon("arrow-down").onClick(() => update({ ...def, sort: [{ by: c.id, dir: "desc" }] })));
		if (def.sort.length) m.addItem((i) => i.setSection("sort").setTitle("Clear sorting").setIcon("x").onClick(() => update({ ...def, sort: [] })));
		if (c.id !== "name" && !c.invalid)
			m.addItem((i) =>
				i
					.setSection("view")
					.setTitle(def.group?.by === c.id ? "Stop grouping" : `Group by ${c.label}`)
					.setIcon("rows-3")
					.onClick(() => update({ ...def, group: def.group?.by === c.id ? undefined : { by: c.id } })),
			);
		if (!c.invalid)
			m.addItem((i) =>
				i
					.setSection("view")
					.setTitle(`Filter by ${c.label}…`)
					.setIcon("filter")
					.onClick(() => {
						update({ ...def, filters: { ...def.filters, items: [...def.filters.items, { field: c.id, op: OPERATORS[c.kind][0].op }] } });
						const btn = scrollRef.current?.parentElement?.querySelector<HTMLElement>("[data-pop=filters]");
						if (btn) setPop({ name: "filters", anchor: btn.getBoundingClientRect() });
					}),
			);
		if (c.def.kind === "rollup") {
			const rc = c.def;
			m.addItem((i) => i.setSection("edit").setTitle("Edit roll-up…").setIcon("pencil").onClick(() => rollupDialog(rc)));
		}
		if (c.id !== "name") m.addItem((i) => i.setSection("edit").setTitle("Hide column").setIcon("eye-off").onClick(() => toggleColumn(c.def, false)));
		m.showAtMouseEvent(e.nativeEvent);
	};

	const rowMenu = (e: MouseEvent, r: ResultRow) => {
		e.preventDefault();
		const entity = plugin.index.get(r.row.path);
		if (!entity) return;
		const m = new Menu();
		m.addItem((i) => i.setSection("open").setTitle("Open in new tab").setIcon("file-plus").onClick(() => plugin.openPath(entity.path, "tab")));
		m.addItem((i) => i.setSection("open").setTitle("Open to the right").setIcon("separator-vertical").onClick(() => plugin.openPath(entity.path, "split")));
		m.addItem((i) =>
			i
				.setSection("view")
				.setTitle("Show connections")
				.setIcon("waypoints")
				.onClick(async () => {
					await app.workspace.openLinkText(entity.path, "", false);
					await plugin.activateConnectionsView();
				}),
		);
		m.addItem((i) =>
			i
				.setSection("view")
				.setTitle("Change type…")
				.setIcon("repeat")
				.onClick(() =>
					new TypePickerModal(
						plugin,
						(t) => void plugin.factory.convertToEntity(entity.file, t),
						plugin.settings.types.filter((t) => t.key !== entity.type.key),
						`Change "${entity.name}" from ${entity.type.name.toLowerCase()} to…`,
					).open(),
				),
		);
		app.workspace.trigger("file-menu", m, entity.file, "obs-entities-table");
		m.showAtMouseEvent(e.nativeEvent);
	};

	const moreMenu = (e: MouseEvent) => {
		const file = app.vault.getAbstractFileByPath(sourcePath);
		const m = new Menu();
		m.addItem((i) =>
			i
				.setTitle("Save as…")
				.setIcon("copy-plus")
				.onClick(() => new NameModal(app, "Save view as", `${file instanceof TFile ? file.basename : "View"} copy`, "Save", (name) => void plugin.createViewNote(name, defRef.current)).open()),
		);
		if (file instanceof TFile)
			m.addItem((i) =>
				i
					.setTitle(`Rename “${file.basename}”…`)
					.setIcon("pencil")
					.onClick(() =>
						new NameModal(app, "Rename view", file.basename, "Rename", async (name) => {
							flush();
							const parent = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
							await app.fileManager.renameFile(file, `${parent}${name.replace(/[\\/:*?"<>|#^[\]]/g, " ").trim()}.md`);
						}).open(),
					),
			);
		m.addItem((i) =>
			i
				.setTitle(fill ? "Open as Markdown" : "Edit definition")
				.setIcon(fill ? "file-text" : "code")
				.onClick(() => {
					flush();
					editDefinition();
				}),
		);
		m.addItem((i) =>
			i
				.setTitle("Copy block")
				.setIcon("clipboard-copy")
				.onClick(() => {
					void navigator.clipboard.writeText(`\`\`\`${VIEW_BLOCK}\n${stringifyYaml(serializeView(defRef.current))}\`\`\`\n`);
					new Notice("Copied the view's block. Paste it into any note.");
				}),
		);
		m.showAtMouseEvent(e.nativeEvent);
	};

	const newEntity = () => {
		const pre = prefillFromFilters(def, result.known);
		const go = (t: EntityTypeDef) => {
			const fields: Record<string, FieldValue> = {};
			for (const [k, v] of Object.entries(pre.fields)) {
				const f = t.fields.find((x) => x.key === k);
				if (!f) continue;
				if (f.kind === "relation") {
					const file = app.vault.getAbstractFileByPath(String(v)) ?? app.metadataCache.getFirstLinkpathDest(String(v), "");
					if (!(file instanceof TFile)) continue;
					const lt = app.metadataCache.fileToLinktext(file, "", true);
					fields[k] = f.labelled ? [{ target: lt, label: "" }] : isListValued(f) ? [lt] : lt;
				} else fields[k] = v as FieldValue;
			}
			const status = pre.status && statusesFor(t, plugin.settings.groups).includes(pre.status) ? { status: pre.status } : {};
			plugin.openCreateModal(t, { ...status, fields });
		};
		if (sources.length === 1) go(sources[0]);
		else if (sources.length) new TypePickerModal(plugin, go, sources).open();
	};

	const selectRow = (n: number, path: string, range: boolean) => {
		const next = new Set(selected);
		const on = !next.has(path);
		if (range && lastClicked.current !== null) {
			const [a, b] = [Math.min(lastClicked.current, n), Math.max(lastClicked.current, n)];
			for (const it of rowItems) if (it.n >= a && it.n <= b) on ? next.add(it.r.row.path) : next.delete(it.r.row.path);
		} else on ? next.add(path) : next.delete(path);
		lastClicked.current = n;
		setSelected(next);
	};
	const allSelected = rowItems.length > 0 && rowItems.every((it) => selected.has(it.r.row.path));
	const toggleAll = () => {
		const next = new Set(selected);
		for (const it of rowItems) allSelected ? next.delete(it.r.row.path) : next.add(it.r.row.path);
		setSelected(next);
	};

	const reveal = (n: number) => {
		const el = scrollRef.current;
		const idx = items.findIndex((i) => i.kind === "row" && i.n === n);
		if (!el || idx < 0) return;
		const top = HEAD_H + idx * ROW_H;
		if (top < el.scrollTop + HEAD_H) el.scrollTop = top - HEAD_H;
		else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
	};
	const cellEl = (r: number, c: number) => scrollRef.current?.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (editing || pop) return;
		const t = e.target as HTMLElement;
		if (t.matches("input:not([type=checkbox]), select, textarea")) return;
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
			e.preventDefault();
			e.stopPropagation();
			const path = edits.current.pop();
			const edit = path ? plugin.undoProperty(path) : null;
			if (!edit) new Notice("Nothing to undo in this table.");
			return;
		}
		const maxR = rowItems.length - 1;
		const maxC = columns.length - 1;
		const cur = focus ?? { r: 0, c: 0 };
		const move = (r: number, c: number) => {
			e.preventDefault();
			const next = { r: Math.max(0, Math.min(maxR, r)), c: Math.max(0, Math.min(maxC, c)) };
			setFocus(next);
			reveal(next.r);
		};
		switch (e.key) {
			case "ArrowDown":
				return move(focus ? cur.r + 1 : 0, cur.c);
			case "ArrowUp":
				return move(cur.r - 1, cur.c);
			case "ArrowLeft":
				return move(cur.r, cur.c - 1);
			case "ArrowRight":
				return move(cur.r, cur.c + 1);
			case "Home":
				return move(cur.r, 0);
			case "End":
				return move(cur.r, maxC);
			case "Escape":
				setFocus(null);
				return;
			case "Enter":
			case " ": {
				if (!focus) return;
				const it = rowItems.find((i) => i.n === focus.r);
				const col = columns[focus.c];
				if (!it || !col) return;
				e.preventDefault();
				if (col.id === "name") {
					if (e.key === "Enter") plugin.openPath(it.r.row.path, e.nativeEvent);
					return;
				}
				const target = editTarget(col, it.r.row);
				if (!target) return;
				if (col.kind === "bool") write(it.r.row.path, target.key, it.r.row.frontmatter[target.key] !== true);
				else if (e.key === "Enter") {
					const el = cellEl(focus.r, focus.c);
					if (el) openEditor(it.r.row.path, col.id, el);
				}
				return;
			}
		}
	};

	const hover = (evt: MouseEvent, path: string) =>
		app.workspace.trigger("hover-link", { event: evt.nativeEvent, source: HOVER_SOURCE, hoverParent: { hoverPopover: null }, targetEl: evt.currentTarget, linktext: path, sourcePath });

	// ---- render
	const typeLabel = def.types.includes("*") ? "All entities" : def.types.map((k) => (k.startsWith("@") ? (lookup.groups.find((g) => `@${g.key}` === k)?.name ?? k) : (lookup.types.find((t) => t.key === k)?.plural ?? k))).join(", ");
	const conditions = filterFields(def.filters).length;
	const tableWidth = SELECT_W + columns.reduce((n, c) => n + widthOf(c), 0);
	const editRow = editing ? plugin.index.get(editing.path) : undefined;
	const editCol = editing ? columns.find((c) => c.id === editing.col) : undefined;

	return (
		<div className={`oe-view${fill ? " is-fill" : ""}`} data-view-kind={def.kind}>
			<div className="oe-view-toolbar">
				<span className="oe-view-source">
					<Icon name={sources.length === 1 ? sources[0].icon : "table"} />
					{typeLabel}
				</span>
				<input type="search" className="oe-view-search" placeholder="Search…" value={search} aria-label="Search this view" onChange={(e) => setSearch(e.target.value)} />
				<span className="oe-spacer" />
				<ToolButton name="filters" icon="filter" label="Filters" count={conditions} active={pop?.name === "filters"} onClick={openPop} />
				<ToolButton name="sort" icon="arrow-up-down" label="Sort" count={def.sort.length} active={pop?.name === "sort"} onClick={openPop} />
				<ToolButton name="group" icon="rows-3" label="Group" count={def.group ? 1 : 0} active={pop?.name === "group"} onClick={openPop} />
				<ToolButton name="columns" icon="columns-3" label="Columns" count={0} active={pop?.name === "columns"} onClick={openPop} />
				<button className="clickable-icon" aria-label="More options" onClick={moreMenu}>
					<Icon name="more-horizontal" />
				</button>
			</div>
			{warnings.length > 0 && (
				<div className="oe-view-warning">
					<button className="oe-pop-link" onClick={() => setShowWarnings(!showWarnings)}>
						<Icon name="alert-triangle" /> Parts of this view's definition were ignored ({warnings.length})
					</button>
					{showWarnings && (
						<ul>
							{warnings.map((w, i) => (
								<li key={i}>{w}</li>
							))}
						</ul>
					)}
				</div>
			)}
			<div ref={scrollRef} className="oe-table-scroll" tabIndex={0} onKeyDown={onKeyDown} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
				<table className="oe-table" style={{ width: `max(${tableWidth}px, 100%)` }}>
					<colgroup>
						<col style={{ width: SELECT_W }} />
						{columns.map((c) => (
							<col key={c.id} style={{ width: widthOf(c) }} />
						))}
						<col />
					</colgroup>
					<thead>
						<tr>
							<th className="oe-th-select">
								<input type="checkbox" checked={allSelected} aria-label="Select all rows" onChange={toggleAll} />
							</th>
							{columns.map((c) => {
								const s = def.sort.findIndex((x) => x.by === c.id);
								return (
									<th
										key={c.id}
										className={`oe-th${dragCol === c.id ? " is-dragging" : ""}${c.invalid ? " is-invalid" : ""}`}
										data-col={c.id}
										draggable={c.id !== "name"}
										aria-sort={s < 0 ? "none" : def.sort[s].dir === "asc" ? "ascending" : "descending"}
										onDragStart={(e) => {
											setDragCol(c.id);
											e.dataTransfer.effectAllowed = "move";
										}}
										onDragEnd={() => setDragCol(null)}
										onDragOver={(e) => dragCol && e.preventDefault()}
										onDrop={(e) => {
											e.preventDefault();
											dropColumn(c.id);
										}}
										onClick={(e) => update({ ...def, sort: cycleSort(def.sort, c.id, e.shiftKey) })}
										onContextMenu={(e) => headerMenu(e, c)}
									>
										<span className="oe-th-inner">
											<span className="oe-th-label" aria-label={c.invalid}>
												{c.label}
											</span>
											{s >= 0 && (
												<span className="oe-th-sort">
													<Icon name={def.sort[s].dir === "asc" ? "arrow-up" : "arrow-down"} />
													{def.sort.length > 1 && s + 1}
												</span>
											)}
										</span>
										<span className="oe-th-resize" onMouseDown={(e) => startResize(e, c)} onClick={(e) => e.stopPropagation()} aria-hidden="true" />
									</th>
								);
							})}
							<th className="oe-th-fill" aria-hidden="true" />
						</tr>
					</thead>
					<tbody>
						{first > 0 && (
							<tr className="oe-spacer-row">
								<td colSpan={columns.length + 2} style={{ height: first * ROW_H }} />
							</tr>
						)}
						{visible.map((it) => {
							if (it.kind === "group") {
								return (
									<tr key={`g:${it.key}`} className="oe-group-row" onClick={() => setCollapsed((s) => (s.has(it.key) ? new Set([...s].filter((k) => k !== it.key)) : new Set([...s, it.key])))}>
										<td colSpan={columns.length + 2}>
											<Icon name={it.open ? "chevron-down" : "chevron-right"} />
											<span className="oe-group-label">{it.label || `No ${(groupCol?.label ?? "value").toLowerCase()}`}</span>
											<span className="oe-group-count">{it.count}</span>
										</td>
									</tr>
								);
							}
							const r = it.r;
							const path = r.row.path;
							const problems = problemsOf(path);
							return (
								<tr key={`r:${it.n}:${path}`} className={`oe-tr${selected.has(path) ? " is-selected" : ""}`} style={{ "--oe-type-color": r.row.type.color } as CSSProperties} onContextMenu={(e) => rowMenu(e, r)}>
									<td className="oe-td-select">
										<input type="checkbox" checked={selected.has(path)} aria-label={`Select ${r.row.name}`} onChange={() => {}} onClick={(e) => selectRow(it.n, path, e.shiftKey)} />
									</td>
									{columns.map((c, ci) => {
										const target = editTarget(c, r.row);
										const problem = target ? problems.find((p) => p.key === target.key) : undefined;
										const focused = focus?.r === it.n && focus.c === ci;
										return (
											<td
												key={c.id}
												data-r={it.n}
												data-c={ci}
												className={`oe-td${focused ? " is-focused" : ""}${target ? " is-editable" : ""}${problem ? ` has-problem is-${problem.severity}` : ""}`}
												aria-label={problem?.message}
												onClick={() => {
													setFocus({ r: it.n, c: ci });
													scrollRef.current?.focus({ preventScroll: true });
												}}
												onDoubleClick={(e) => target && c.kind !== "bool" && openEditor(path, c.id, e.currentTarget)}
											>
												{c.id === "name" ? (
													<a
														className="oe-table-name"
														href="#"
														onClick={(e) => {
															e.preventDefault();
															plugin.openPath(path, e.nativeEvent);
														}}
														onAuxClick={(e) => e.button === 1 && plugin.openPath(path, "tab")}
														onMouseOver={(e) => hover(e, path)}
													>
														<Icon name={r.row.type.icon} className="oe-chip-icon" />
														<span>{r.row.name}</span>
													</a>
												) : (
													<CellView col={c} cell={r.cells[c.id]} row={r.row} onToggle={target && c.kind === "bool" ? (v) => write(path, target.key, v) : undefined} />
												)}
											</td>
										);
									})}
									<td className="oe-td-fill" />
								</tr>
							);
						})}
						{last < items.length && (
							<tr className="oe-spacer-row">
								<td colSpan={columns.length + 2} style={{ height: (items.length - last) * ROW_H }} />
							</tr>
						)}
					</tbody>
				</table>
				{result.rows.length === 0 && (
					<div className="oe-table-empty">{result.total === 0 ? `No ${sources.length === 1 ? sources[0].plural.toLowerCase() : "entities"} yet.` : "No entities match this view's filters or search."}</div>
				)}
			</div>
			<div className="oe-table-footer">
				<button className="oe-pop-link" onClick={newEntity} disabled={!sources.length}>
					<Icon name="plus" /> New
				</button>
				<span className="oe-spacer" />
				<span className="oe-table-count">
					{result.rows.length} of {result.total}
					{selected.size > 0 && ` · ${selected.size} selected`}
				</span>
			</div>

			{pop && (
				<Popover anchor={pop.anchor} onClose={() => setPop(null)} className={`oe-pop-${pop.name}`} label={pop.name}>
					{pop.name === "filters" && <FiltersPanel filters={def.filters} choices={choices} ctx={ctx} valuesOf={valuesOf} onChange={(filters) => update({ ...defRef.current, filters })} />}
					{pop.name === "sort" && <SortPanel sort={def.sort} choices={choices} onChange={(sort) => update({ ...defRef.current, sort })} />}
					{pop.name === "group" && <GroupPanel def={def} choices={choices} onChange={(group) => update({ ...defRef.current, group })} />}
					{pop.name === "columns" && (
						<ColumnsPanel
							def={def}
							available={[
								{ title: "Fields", columns: available.fields },
								{ title: "Built-in", columns: available.builtins },
								{ title: "Incoming links", columns: available.incoming },
							]}
							labelOf={labelOf}
							onToggle={toggleColumn}
							onAddRollup={() => rollupDialog(null)}
							onEditRollup={(c) => rollupDialog(c)}
						/>
					)}
				</Popover>
			)}
			{editing && editRow && editCol && (
				<Popover
					anchor={editing.anchor}
					label={`Edit ${editCol.label}`}
					className="oe-cell-pop"
					onClose={() => {
						setEditing(null);
						scrollRef.current?.focus({ preventScroll: true });
					}}
				>
					<CellEditor col={editCol} entity={editRow} problems={problemsOf(editRow.path)} onWrite={(k, v) => write(editRow.path, k, v)} />
				</Popover>
			)}
		</div>
	);
}

function ToolButton({ name, icon, label, count, active, onClick }: { name: PopName; icon: string; label: string; count: number; active: boolean; onClick: (name: PopName, el: HTMLElement) => void }) {
	return (
		<button className={`oe-view-tool${count ? " has-count" : ""}${active ? " is-active" : ""}`} data-pop={name} aria-label={label} aria-expanded={active} onClick={(e) => onClick(name, e.currentTarget)}>
			<Icon name={icon} />
			<span className="oe-view-tool-label">{label}</span>
			{count > 0 && <span className="oe-view-tool-count">{count}</span>}
		</button>
	);
}
