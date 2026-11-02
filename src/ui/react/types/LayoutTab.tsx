import { FuzzySuggestModal, Menu, type App } from "obsidian";
import { useEffect, useMemo, useRef, useState, type FocusEvent as RFocusEvent, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import {
	allLists,
	blankNode,
	canHold,
	childPath,
	fieldSlots,
	insertionPoint,
	insertNode,
	layoutFromFields,
	listItems,
	listKey,
	MAX_COLUMNS,
	MIN_COLUMNS,
	moveBy,
	moveNode,
	nodeAt,
	normaliseLayout,
	parentList,
	parseListKey,
	placeableKeys,
	removeNode,
	sameList,
	setColumnCount,
	slotProblems,
	ungroupFrame,
	updateNode,
	type FormLayout,
	type LayoutColumns,
	type LayoutComponent,
	type LayoutField,
	type LayoutFrame,
	type LayoutList,
	type LayoutNode,
	type LayoutPath,
} from "../../../model/formLayout";
import { COMMON_KEYS } from "../../../model/types";
import { usePlugin } from "../context";
import { Icon } from "../Icon";
import { Issues, Segmented, Toggle } from "./controls";
import { KIND_INFO, useEditor } from "./editor";

const BUILTINS: Record<string, { label: string; icon: string; kind: string }> = {
	[COMMON_KEYS.status]: { label: "Status", icon: "circle-dot", kind: "Status" },
	[COMMON_KEYS.related]: { label: "Related", icon: "link-2", kind: "Links to any entity" },
	[COMMON_KEYS.tags]: { label: "Tags", icon: "tags", kind: "Tags" },
	[COMMON_KEYS.aliases]: { label: "Aliases", icon: "forward", kind: "Other names" },
	[COMMON_KEYS.order]: { label: "Order", icon: "arrow-down-01", kind: "Number" },
};

const COMPONENTS: { kind: LayoutComponent; label: string; icon: string; desc: string }[] = [
	{ kind: "frame", label: "Frame", icon: "square", desc: "A captioned box of rows" },
	{ kind: "columns2", label: "2 columns", icon: "columns-2", desc: "Fields side by side" },
	{ kind: "columns3", label: "3 columns", icon: "columns-3", desc: "Fields side by side" },
	{ kind: "columns4", label: "4 columns", icon: "columns-4", desc: "Fields side by side" },
	{ kind: "heading", label: "Heading", icon: "heading", desc: "A caption between rows" },
	{ kind: "text", label: "Text", icon: "text", desc: "Help text between rows" },
];

const pk = (p: LayoutPath) => p.join(".");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Undo history per type, kept while switching tabs (dropped when the draft's layout changes elsewhere). */
interface History {
	past: (FormLayout | null)[];
	future: (FormLayout | null)[];
	/** the layout the history ends at, to tell whether it still applies */
	current: string;
	/** text edits to the same box are one undo step */
	tag?: string;
}
const histories = new Map<string, History>();

type DragSource = { from: "palette"; node: LayoutNode } | { from: "canvas"; path: LayoutPath; node: LayoutNode };
type DropTarget = { list: LayoutList; index: number } | { remove: true };

/** Pick a property to place (Add field here…). */
class PlaceModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private keys: string[],
		private labelOf: (k: string) => string,
		private done: (k: string) => void,
	) {
		super(app);
		this.setPlaceholder("Add a field that isn't placed yet…");
	}
	getItems(): string[] {
		return this.keys;
	}
	getItemText(k: string): string {
		return this.labelOf(k);
	}
	onChooseItem(k: string): void {
		this.done(k);
	}
}

/**
 * The Layout tab: a palette (fields not placed yet, and components), a canvas laid out like the form, and the
 * selected part's settings. Drag to place and move; drag back to the palette (or Delete) to remove. Keyboard:
 * Alt+↑/↓ to move, the ⋯ menu to move elsewhere or add fields, Ctrl/Cmd+Z to undo.
 */
export function LayoutTab() {
	const plugin = usePlugin();
	const { draft, update, issuesAt, setTab, setFieldUid } = useEditor();
	const type = draft.type;
	const raw = type.form?.layout;
	const layout = useMemo(() => (raw ? normaliseLayout(raw) : null), [raw]);
	const base: FormLayout = layout ?? { items: [] };
	const histId = draft.original?.key ?? `new:${type.key}`;
	const [sel, setSel] = useState<LayoutPath | null>(null);
	const [, setTick] = useState(0);
	const canvasRef = useRef<HTMLDivElement>(null);
	const paletteRef = useRef<HTMLDivElement>(null);
	const focusNext = useRef<LayoutPath | null>(null);

	const selected = sel ? nodeAt(base, sel) : null;
	useEffect(() => {
		if (sel && !selected) setSel(null);
	}, [sel, selected]);
	useEffect(() => {
		const p = focusNext.current;
		if (!p) return;
		focusNext.current = null;
		const el = canvasRef.current?.querySelector<HTMLElement>(`[data-ld-path="${pk(p)}"]`);
		el?.focus();
		el?.scrollIntoView({ block: "nearest" });
	});

	// ---- history
	const json = JSON.stringify(layout);
	const hist = (): History => {
		let h = histories.get(histId);
		if (!h || h.current !== json) {
			h = { past: [], future: [], current: json };
			histories.set(histId, h);
		}
		return h;
	};
	const write = (next: FormLayout | null) =>
		update((t) => {
			const f = { ...(t.form ?? {}) };
			if (next) f.layout = next;
			else delete f.layout;
			if (Object.keys(f).length) t.form = f;
			else delete t.form;
		});
	/** Change the layout (one undo step; `tag`: repeated edits of the same text box join one step). */
	const commit = (raw: FormLayout | null, opts: { select?: LayoutPath | null; focus?: boolean; tag?: string } = {}) => {
		// Store layouts tidied, so the history matches what the draft reads back.
		const next = raw ? normaliseLayout(raw) : null;
		const h = hist();
		const nextJson = JSON.stringify(next);
		if (nextJson === h.current) return;
		if (!opts.tag || h.tag !== opts.tag) h.past.push(layout);
		h.future = [];
		h.tag = opts.tag;
		h.current = nextJson;
		write(next);
		if (opts.select !== undefined) setSel(opts.select);
		if (opts.focus && opts.select) focusNext.current = opts.select;
	};
	const undo = () => {
		const h = hist();
		if (!h.past.length) return;
		const prev = h.past.pop()!;
		h.future.push(layout);
		h.tag = undefined;
		h.current = JSON.stringify(prev);
		write(prev);
		setTick((n) => n + 1);
	};
	const redo = () => {
		const h = hist();
		if (!h.future.length) return;
		const next = h.future.pop()!;
		h.past.push(layout);
		h.tag = undefined;
		h.current = JSON.stringify(next);
		write(next);
		setTick((n) => n + 1);
	};
	const h = histories.get(histId);
	const canUndo = !!h && h.current === json && h.past.length > 0;
	const canRedo = !!h && h.current === json && h.future.length > 0;

	// ---- what's placed
	const placeable = placeableKeys(type);
	const slots = fieldSlots(base);
	const placedAt = new Map<string, LayoutPath>();
	for (const s of slots) if (!placedAt.has(s.field.key)) placedAt.set(s.field.key, s.path);
	const problems = slotProblems(base, type);
	const fieldOf = (k: string) => type.fields.find((f) => f.key === k);
	const labelOf = (k: string) => {
		const f = fieldOf(k);
		return f ? f.label || f.key : (BUILTINS[k]?.label ?? k);
	};
	const iconOf = (k: string) => {
		const f = fieldOf(k);
		return f ? KIND_INFO[f.kind].icon : (BUILTINS[k]?.icon ?? "help-circle");
	};
	const notPlaced = placeable.filter((k) => !placedAt.has(k));
	const unplacedFields = type.fields.filter((f) => !placedAt.has(f.key)).map((f) => f.key);

	// ---- edits
	const add = (node: LayoutNode, at?: { list: LayoutList; index: number }) => {
		const where = at ?? insertionPoint(base, sel, node);
		const next = insertNode(base, where.list, where.index, node);
		if (next) commit(next, { select: childPath(where.list, Math.min(where.index, listItems(base, where.list).length)), focus: true });
	};
	const remove = (path: LayoutPath) => {
		const next = removeNode(base, path);
		const { list, index } = parentList(path);
		const left = listItems(next, list).length;
		const after = left ? childPath(list, Math.min(index, left - 1)) : list.kind === "root" ? null : list.kind === "frame" ? [list.frame] : list.at;
		commit(next, { select: after, focus: !!after });
	};
	const move = (path: LayoutPath, to: LayoutList, index: number, focus = true) => {
		const r = moveNode(base, path, to, index);
		if (r) commit(r.layout, { select: r.path, focus });
	};
	const change = (path: LayoutPath, fn: (n: LayoutNode) => LayoutNode, tag?: string) => commit(updateNode(base, path, fn), { tag });

	// ---- labels for lists (Move to…)
	const frameName = (i: number) => {
		const f = base.items[i];
		return f?.kind === "frame" && f.caption ? `“${f.caption}”` : `Frame ${i + 1}`;
	};
	const listLabel = (l: LayoutList) => {
		if (l.kind === "root") return "Top level";
		if (l.kind === "frame") return frameName(l.frame);
		const where = l.at.length === 1 ? "Top-level columns" : frameName(l.at[0]);
		const siblings: LayoutNode[] = l.at.length === 1 ? base.items : listItems(base, { kind: "frame", frame: l.at[0] });
		const rows = siblings.filter((n) => n.kind === "columns");
		const row = rows.length > 1 ? ` (columns ${(rows as LayoutNode[]).indexOf(siblings[l.at[l.at.length - 1]]) + 1})` : "";
		return `${where}${row} › column ${l.col + 1}`;
	};

	const nodeMenu = (path: LayoutPath, menu: Menu) => {
		const node = nodeAt(base, path);
		if (!node) return;
		const { list, index } = parentList(path);
		const count = listItems(base, list).length;
		menu.addItem((i) =>
			i
				.setTitle("Move up")
				.setIcon("arrow-up")
				.setDisabled(index === 0)
				.onClick(() => move(path, list, index - 1)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Move down")
				.setIcon("arrow-down")
				.setDisabled(index >= count - 1)
				.onClick(() => move(path, list, index + 2)),
		);
		const targets = allLists(base).filter((l) => !sameList(l, list) && canHold(l, node) && !(node.kind === "columns" && l.kind === "column"));
		if (targets.length) {
			menu.addSeparator();
			for (const l of targets)
				menu.addItem((i) =>
					i
						.setTitle(`Move to ${listLabel(l)}`)
						.setIcon("corner-down-right")
						.onClick(() => move(path, l, listItems(base, l).length)),
				);
		}
		if ((node.kind === "frame" || node.kind === "columns") && notPlaced.length) {
			menu.addSeparator();
			menu.addItem((i) =>
				i
					.setTitle("Add field here…")
					.setIcon("plus")
					.onClick(() => new PlaceModal(plugin.app, notPlaced, labelOf, (k) => add({ kind: "field", key: k }, insertionPoint(base, path, { kind: "field", key: k }))).open()),
			);
		}
		menu.addSeparator();
		if (node.kind === "frame") {
			menu.addItem((i) =>
				i
					.setTitle("Remove frame, keep its contents")
					.setIcon("ungroup")
					.onClick(() => commit(ungroupFrame(base, path[0]), { select: node.items.length ? [path[0]] : null, focus: node.items.length > 0 })),
			);
			menu.addItem((i) =>
				i
					.setTitle("Remove frame and its contents")
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => remove(path)),
			);
		} else
			menu.addItem((i) =>
				i
					.setTitle(node.kind === "field" ? "Remove from layout" : "Remove")
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => remove(path)),
			);
	};
	const openMenu = (path: LayoutPath, at: { x: number; y: number }) => {
		const m = new Menu();
		nodeMenu(path, m);
		m.showAtPosition(at);
	};

	// ---- keyboard
	const onNodeKey = (e: RKeyboardEvent<HTMLElement>, path: LayoutPath) => {
		if (e.target !== e.currentTarget) return;
		const node = nodeAt(base, path);
		if (!node) return;
		if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
			e.preventDefault();
			e.stopPropagation();
			const r = moveBy(base, path, e.key === "ArrowUp" ? -1 : 1);
			if (r) commit(r.layout, { select: r.path, focus: true });
			return;
		}
		if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation();
			const all = [...(canvasRef.current?.querySelectorAll<HTMLElement>("[data-ld-path]") ?? [])];
			const i = all.indexOf(e.currentTarget);
			all[i + (e.key === "ArrowUp" ? -1 : 1)]?.focus();
			return;
		}
		if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			e.stopPropagation();
			remove(path);
			return;
		}
		if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
			e.preventDefault();
			e.stopPropagation();
			const r = e.currentTarget.getBoundingClientRect();
			openMenu(path, { x: r.left + 16, y: r.top + 24 });
			return;
		}
		if (e.key === "Escape") {
			e.stopPropagation();
			setSel(null);
			e.currentTarget.blur();
		}
	};
	const onRootKey = (e: RKeyboardEvent<HTMLElement>) => {
		const t = e.target as HTMLElement;
		if (t.matches("input, textarea, select, [contenteditable]")) return;
		const mod = e.ctrlKey || e.metaKey;
		if (mod && !e.altKey && e.key.toLowerCase() === "z") {
			e.preventDefault();
			e.stopPropagation();
			if (e.shiftKey) redo();
			else undo();
		} else if (mod && !e.altKey && e.key.toLowerCase() === "y") {
			e.preventDefault();
			e.stopPropagation();
			redo();
		}
	};

	// ---- dragging (pointer events, so it works with mouse, pen and touch)
	const [dragging, setDragging] = useState<DragSource | null>(null);
	const [drop, setDrop] = useState<DropTarget | null>(null);
	const drag = useRef<{ src: DragSource; el: HTMLElement; x0: number; y0: number; x: number; y: number; dx: number; dy: number; touch: boolean; active: boolean; timer: number; ghost: HTMLElement | null; frame: number } | null>(null);
	const justDragged = useRef(false);

	const targetAt = (x: number, y: number): DropTarget | null => {
		const d = drag.current;
		if (!d) return null;
		const hit = document.elementFromPoint(x, y);
		if (!hit) return null;
		if (d.src.from === "canvas" && paletteRef.current?.contains(hit)) return { remove: true };
		if (!canvasRef.current?.contains(hit)) return null;
		let listEl = hit.closest<HTMLElement>("[data-ld-list]");
		while (listEl && canvasRef.current.contains(listEl)) {
			const list = parseListKey(listEl.dataset.ldList!);
			if (list && canHold(list, d.src.node)) {
				const kids = [...listEl.querySelectorAll<HTMLElement>(":scope > [data-ld-path]")];
				let index = kids.length;
				for (let i = 0; i < kids.length; i++) {
					const r = kids[i].getBoundingClientRect();
					if (y < r.top + r.height / 2) {
						index = i;
						break;
					}
				}
				return { list, index };
			}
			listEl = listEl.parentElement?.closest<HTMLElement>("[data-ld-list]") ?? null;
		}
		return null;
	};
	const sameTarget = (a: DropTarget | null, b: DropTarget | null) => JSON.stringify(a) === JSON.stringify(b);
	const setTarget = (t: DropTarget | null) => setDrop((cur) => (sameTarget(cur, t) ? cur : t));

	const autoScroll = () => {
		const d = drag.current;
		if (!d?.active) return;
		const sc = canvasRef.current;
		if (sc) {
			const r = sc.getBoundingClientRect();
			const edge = 40;
			const before = sc.scrollTop;
			if (d.y < r.top + edge) sc.scrollTop -= Math.ceil(((edge - Math.max(0, d.y - r.top)) / edge) * 14);
			else if (d.y > r.bottom - edge) sc.scrollTop += Math.ceil(((edge - Math.max(0, r.bottom - d.y)) / edge) * 14);
			if (sc.scrollTop !== before) setTarget(targetAt(d.x, d.y));
		}
		d.frame = requestAnimationFrame(autoScroll);
	};
	const startDrag = () => {
		const d = drag.current;
		if (!d || d.active) return;
		d.active = true;
		const r = d.el.getBoundingClientRect();
		const ghost = d.el.cloneNode(true) as HTMLElement;
		ghost.classList.add("oe-ld-ghost");
		ghost.classList.remove("is-selected");
		ghost.removeAttribute("data-ld-path");
		ghost.style.width = `${Math.min(r.width, 360)}px`;
		ghost.style.left = `${d.x - Math.min(d.dx, 340)}px`;
		ghost.style.top = `${d.y - d.dy}px`;
		document.body.appendChild(ghost);
		d.ghost = ghost;
		window.getSelection()?.removeAllRanges();
		setDragging(d.src);
		setTarget(targetAt(d.x, d.y));
		d.frame = requestAnimationFrame(autoScroll);
	};
	const endDrag = (commitDrop: boolean) => {
		const d = drag.current;
		const target = commitDrop && d?.active ? targetAt(d.x, d.y) : null;
		drag.current = null;
		document.removeEventListener("pointermove", onMove);
		document.removeEventListener("pointerup", onUp);
		document.removeEventListener("pointercancel", onCancel);
		document.removeEventListener("touchmove", blockTouch);
		document.removeEventListener("keydown", onDragKey, true);
		if (!d) return;
		window.clearTimeout(d.timer);
		cancelAnimationFrame(d.frame);
		d.ghost?.remove();
		if (d.active) {
			justDragged.current = true;
			window.setTimeout(() => (justDragged.current = false), 0);
			setDragging(null);
			setDrop(null);
		}
		if (!target) return;
		if ("remove" in target) {
			if (d.src.from === "canvas") remove(d.src.path);
		} else if (d.src.from === "canvas") move(d.src.path, target.list, target.index);
		else add(d.src.node, target);
	};
	const onMove = (e: PointerEvent) => {
		const d = drag.current;
		if (!d) return;
		d.x = e.clientX;
		d.y = e.clientY;
		if (!d.active) {
			const far = Math.hypot(d.x - d.x0, d.y - d.y0);
			if (d.touch) {
				if (far > 8) endDrag(false);
			} else if (far > 5) startDrag();
			return;
		}
		if (d.ghost) {
			d.ghost.style.left = `${d.x - Math.min(d.dx, 340)}px`;
			d.ghost.style.top = `${d.y - d.dy}px`;
		}
		setTarget(targetAt(d.x, d.y));
	};
	const onUp = () => endDrag(true);
	const onCancel = () => endDrag(false);
	const blockTouch = (e: TouchEvent) => {
		if (drag.current?.active) e.preventDefault();
	};
	const onDragKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || !drag.current?.active) return;
		e.preventDefault();
		e.stopPropagation();
		endDrag(false);
	};
	// The drop handlers read the latest layout through closures made at the last render; keep them current.
	const handlers = useRef({ endDrag });
	handlers.current = { endDrag };
	useEffect(() => () => handlers.current.endDrag(false), []);

	const startPointer = (e: RPointerEvent<HTMLElement>, src: DragSource) => {
		if (e.button !== 0 || (e.target as HTMLElement).closest("input, textarea, select, .oe-ld-more")) return;
		e.stopPropagation();
		if (drag.current) endDrag(false);
		const rect = e.currentTarget.getBoundingClientRect();
		const touch = e.pointerType === "touch";
		drag.current = { src, el: e.currentTarget, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, touch, active: false, timer: 0, ghost: null, frame: 0 };
		if (touch) drag.current.timer = window.setTimeout(startDrag, 350);
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onCancel);
		document.addEventListener("touchmove", blockTouch, { passive: false });
		document.addEventListener("keydown", onDragKey, true);
	};

	// ---- canvas
	const dropCls = (list: LayoutList, i: number, count: number) => {
		if (!drop || "remove" in drop || !sameList(drop.list, list)) return "";
		if (drop.index === i) return " is-drop-before";
		if (i === count - 1 && drop.index === count) return " is-drop-after";
		return "";
	};
	const listCls = (list: LayoutList, count: number) => (drop && !("remove" in drop) && sameList(drop.list, list) && count === 0 ? " is-drop-target" : "");
	const isDragged = (p: LayoutPath) => dragging?.from === "canvas" && pk(dragging.path) === pk(p);

	const nodeProps = (path: LayoutPath, node: LayoutNode, cls: string, list: LayoutList, i: number, count: number) => ({
		"data-ld-path": pk(path),
		tabIndex: 0,
		className: `oe-ld-node ${cls}${sel && pk(sel) === pk(path) ? " is-selected" : ""}${isDragged(path) ? " is-dragging" : ""}${dropCls(list, i, count)}`,
		"aria-selected": !!sel && pk(sel) === pk(path),
		onFocus: (e: RFocusEvent) => {
			e.stopPropagation();
			setSel(path);
		},
		onClick: (e: RMouseEvent) => {
			e.stopPropagation();
			if (!justDragged.current) setSel(path);
		},
		onContextMenu: (e: RMouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setSel(path);
			openMenu(path, { x: e.clientX, y: e.clientY });
		},
		onKeyDown: (e: RKeyboardEvent<HTMLElement>) => onNodeKey(e, path),
		"data-kind": node.kind,
	});
	const moreBtn = (path: LayoutPath, label: string) => (
		<button
			type="button"
			className="clickable-icon oe-ld-more"
			aria-label={`${label}: options`}
			tabIndex={-1}
			onClick={(e) => {
				e.stopPropagation();
				setSel(path);
				const r = e.currentTarget.getBoundingClientRect();
				openMenu(path, { x: r.left, y: r.bottom + 4 });
			}}
		>
			<Icon name="more-horizontal" />
		</button>
	);

	const renderField = (f: LayoutField, path: LayoutPath, list: LayoutList, i: number, count: number) => {
		const def = fieldOf(f.key);
		const problem = problems.get(pk(path));
		const label = labelOf(f.key);
		const p = nodeProps(path, f, `oe-ld-field${f.label === "beside" ? " is-beside" : ""}${problem ? " has-problem" : ""}`, list, i, count);
		return (
			<div key={pk(path)} {...p} onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: f })} title={problem}>
				<span className="oe-ld-label">
					<Icon name={problem ? "alert-triangle" : iconOf(f.key)} />
					<span className="oe-ld-label-text">{label}</span>
					{def?.required && <span className="oe-prop-required">*</span>}
				</span>
				<span className="oe-ld-control">{problem ?? (def ? KIND_INFO[def.kind].label : (BUILTINS[f.key]?.kind ?? ""))}</span>
				{moreBtn(path, label)}
			</div>
		);
	};
	const renderItem = (n: LayoutNode, path: LayoutPath, list: LayoutList, i: number, count: number): ReactNode => {
		if (n.kind === "field") return renderField(n, path, list, i, count);
		if (n.kind === "heading" || n.kind === "text") {
			const p = nodeProps(path, n, `oe-ld-${n.kind}`, list, i, count);
			return (
				<div key={pk(path)} {...p} onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: n })}>
					<span className="oe-ld-textval">{n.text || <span className="oe-ld-faint">{n.kind === "heading" ? "Empty heading" : "Empty text"}</span>}</span>
					{moreBtn(path, n.kind === "heading" ? "Heading" : "Text")}
				</div>
			);
		}
		if (n.kind === "columns") {
			const p = nodeProps(path, n, "oe-ld-columns", list, i, count);
			return (
				<div key={pk(path)} {...p}>
					<div className="oe-ld-head" onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: n })}>
						<Icon name="grip-vertical" className="oe-ld-grip" />
						<Icon name={`columns-${n.columns.length}`} />
						<span className="oe-ld-head-text">{n.columns.length} columns</span>
						{n.widths && <span className="oe-ld-badge">{n.widths.join(" : ")}</span>}
						{moreBtn(path, "Columns")}
					</div>
					<div className="oe-ld-grid" style={{ gridTemplateColumns: n.columns.map((_, ci) => `minmax(0, ${n.widths?.[ci] ?? 1}fr)`).join(" ") }}>
						{n.columns.map((col, ci) => {
							const cl: LayoutList = { kind: "column", at: path, col: ci };
							return (
								<div key={ci} className={`oe-ld-list oe-ld-column${listCls(cl, col.length)}`} data-ld-list={listKey(cl)}>
									{col.map((f, k) => renderField(f, [...path, ci, k], cl, k, col.length))}
									{!col.length && <div className="oe-ld-empty">Drop fields here</div>}
								</div>
							);
						})}
					</div>
				</div>
			);
		}
		return null;
	};
	const renderFrame = (fr: LayoutFrame, i: number, count: number) => {
		const path = [i];
		const root: LayoutList = { kind: "root" };
		const fl: LayoutList = { kind: "frame", frame: i };
		const p = nodeProps(path, fr, "oe-ld-frame", root, i, count);
		return (
			<section key={pk(path)} {...p}>
				<div className="oe-ld-head" onPointerDown={(e) => startPointer(e, { from: "canvas", path, node: fr })}>
					<Icon name="grip-vertical" className="oe-ld-grip" />
					{fr.collapsible && <Icon name={fr.collapsed ? "chevron-right" : "chevron-down"} />}
					<span className="oe-ld-caption">{fr.caption || <span className="oe-ld-faint">No caption</span>}</span>
					{fr.create === false && (
						<span className="oe-ld-badge" title="Not in the create dialog">
							<Icon name="eye-off" /> Create dialog
						</span>
					)}
					{moreBtn(path, fr.caption || "Frame")}
				</div>
				<div className={`oe-ld-list oe-ld-rows${listCls(fl, fr.items.length)}`} data-ld-list={listKey(fl)}>
					{fr.items.map((it, j) => renderItem(it, [i, j], fl, j, fr.items.length))}
					{!fr.items.length && <div className="oe-ld-empty">Drop fields, columns or text here</div>}
				</div>
			</section>
		);
	};

	// ---- palette
	const paletteField = (k: string) => {
		const at = placedAt.get(k);
		const def = fieldOf(k);
		return (
			<button
				key={k}
				type="button"
				className={`oe-ld-pal-item${at ? " is-placed" : ""}`}
				data-key={k}
				title={at ? "Placed: click to find it" : "Drag onto the layout, or click to add it"}
				onPointerDown={at ? undefined : (e) => startPointer(e, { from: "palette", node: { kind: "field", key: k } })}
				onClick={() => {
					if (justDragged.current) return;
					if (at) {
						setSel(at);
						focusNext.current = at;
						setTick((n) => n + 1);
					} else add({ kind: "field", key: k });
				}}
			>
				<Icon name={iconOf(k)} />
				<span className="oe-ld-pal-label">{labelOf(k)}</span>
				{def?.required && <span className="oe-prop-required">*</span>}
				{at && <Icon name="check" className="oe-ld-pal-check" />}
			</button>
		);
	};
	const builtinKeys = placeable.filter((k) => !fieldOf(k));

	// ---- properties of the selection
	const props = (): ReactNode => {
		if (!sel || !selected) {
			return (
				<>
					<div className="oe-ld-props-title">Layout</div>
					<p className="oe-tm-muted">Select a frame, columns or field on the layout to change it.</p>
					{layout && (
						<>
							<div className="oe-ld-prop-row">
								<span>Hide fields that aren't placed</span>
								<Toggle label="Hide fields that aren't placed" value={!!layout.hideUnplaced} onChange={(v) => commit({ ...base, ...(v ? { hideUnplaced: true as const } : { hideUnplaced: undefined }) })} />
							</div>
							<p className="oe-tm-muted oe-ld-note">
								{unplacedFields.length
									? layout.hideUnplaced
										? `${plural(unplacedFields.length, "field")} not placed: they don't show on the form (notes keep their values).`
										: `${plural(unplacedFields.length, "field")} not placed: listed under “Other fields” at the end.`
									: "Every field is placed."}
							</p>
						</>
					)}
				</>
			);
		}
		const removeBtn = (label = "Remove") => (
			<button type="button" className="mod-warning" onClick={() => remove(sel)}>
				<Icon name="trash-2" /> {label}
			</button>
		);
		if (selected.kind === "frame") {
			const fr = selected;
			return (
				<>
					<div className="oe-ld-props-title">Frame</div>
					<label className="oe-ld-prop-col">
						<span>Caption</span>
						<LocalText value={fr.caption ?? ""} placeholder="No caption" label="Caption" onChange={(v) => change(sel, (n) => ({ ...(n as LayoutFrame), caption: v.trim() ? v : undefined }), `caption:${pk(sel)}`)} />
					</label>
					<div className="oe-ld-prop-row">
						<span>Can be collapsed</span>
						<Toggle label="Can be collapsed" value={!!fr.collapsible} onChange={(v) => change(sel, (n) => ({ ...(n as LayoutFrame), collapsible: v ? true : undefined, collapsed: undefined }))} />
					</div>
					<div className="oe-ld-prop-row">
						<span>Starts collapsed</span>
						<Toggle label="Starts collapsed" disabled={!fr.collapsible} value={!!fr.collapsed} onChange={(v) => change(sel, (n) => ({ ...(n as LayoutFrame), collapsed: v ? true : undefined }))} />
					</div>
					<div className="oe-ld-prop-row">
						<span>Show in the create dialog</span>
						<Toggle label="Show in the create dialog" value={fr.create !== false} onChange={(v) => change(sel, (n) => ({ ...(n as LayoutFrame), create: v ? undefined : false }))} />
					</div>
					<p className="oe-tm-muted oe-ld-note">Required fields are always asked for when creating a note.</p>
					<div className="oe-ld-prop-buttons">
						<button type="button" onClick={() => commit(ungroupFrame(base, sel[0]), { select: fr.items.length ? [sel[0]] : null })}>
							<Icon name="ungroup" /> Remove frame, keep contents
						</button>
						{removeBtn("Remove with contents")}
					</div>
				</>
			);
		}
		if (selected.kind === "columns") {
			const c = selected;
			const widths = c.widths ?? c.columns.map(() => 1);
			const setWidths = (w: number[]) => change(sel, (n) => ({ ...(n as LayoutColumns), widths: new Set(w).size > 1 ? w : undefined }));
			return (
				<>
					<div className="oe-ld-props-title">Columns</div>
					<div className="oe-ld-prop-col">
						<span>Number of columns</span>
						<Segmented
							label="Number of columns"
							value={String(c.columns.length)}
							options={Array.from({ length: MAX_COLUMNS - MIN_COLUMNS + 1 }, (_, i) => ({ value: String(i + MIN_COLUMNS), label: String(i + MIN_COLUMNS) }))}
							onChange={(v) => change(sel, (n) => setColumnCount(n as LayoutColumns, Number(v)))}
						/>
					</div>
					{c.columns.length > MIN_COLUMNS && (
						<p className="oe-tm-muted oe-ld-note">With fewer columns, fields in the ones that go move to the last column.</p>
					)}
					<div className="oe-ld-prop-col">
						<span>Relative widths</span>
						<div className="oe-ld-widths">
							{widths.map((w, i) => (
								<input
									key={i}
									type="number"
									min={1}
									max={12}
									step={1}
									value={w}
									aria-label={`Column ${i + 1} width`}
									onChange={(e) => {
										const v = Math.max(1, Math.min(12, Math.round(Number(e.target.value) || 1)));
										setWidths(widths.map((x, j) => (j === i ? v : x)));
									}}
								/>
							))}
							{c.widths && (
								<button type="button" onClick={() => setWidths(widths.map(() => 1))}>
									Equal
								</button>
							)}
						</div>
						<span className="oe-tm-muted oe-ld-note">E.g. 2 and 1: the first column is twice as wide. Columns stack in narrow places.</span>
					</div>
					<div className="oe-ld-prop-buttons">{removeBtn("Remove with fields")}</div>
				</>
			);
		}
		if (selected.kind === "field") {
			const f = selected;
			const def = fieldOf(f.key);
			const problem = problems.get(pk(sel));
			return (
				<>
					<div className="oe-ld-props-title">
						<Icon name={iconOf(f.key)} /> {labelOf(f.key)}
					</div>
					<p className="oe-tm-muted oe-ld-note">
						{def ? `${KIND_INFO[def.kind].label} field` : BUILTINS[f.key] ? "Built-in property" : "Not a field of this type"} · <code>{f.key}</code>
					</p>
					{problem && <Issues issues={[{ at: "form:layout", message: problem }]} />}
					<div className="oe-ld-prop-col">
						<span>Label</span>
						<Segmented
							label="Label position"
							value={f.label ?? "above"}
							options={[
								{ value: "above", label: "Above", icon: "arrow-up-to-line" },
								{ value: "beside", label: "Beside", icon: "arrow-left-to-line" },
							]}
							onChange={(v) => change(sel, (n) => ({ ...(n as LayoutField), label: v === "beside" ? "beside" : undefined }))}
						/>
					</div>
					<div className="oe-ld-prop-buttons">
						{def && (
							<button
								type="button"
								onClick={() => {
									const i = type.fields.indexOf(def);
									setFieldUid(draft.meta[i]?.uid ?? null);
									setTab("fields");
								}}
							>
								<Icon name="pencil" /> Edit field
							</button>
						)}
						{removeBtn("Remove from layout")}
					</div>
				</>
			);
		}
		const t = selected;
		return (
			<>
				<div className="oe-ld-props-title">{t.kind === "heading" ? "Heading" : "Text"}</div>
				<label className="oe-ld-prop-col">
					<span>{t.kind === "heading" ? "Heading" : "Text"}</span>
					<LocalText multiline={t.kind === "text"} value={t.text} label={t.kind === "heading" ? "Heading" : "Text"} onChange={(v) => change(sel, (n) => ({ ...(n as typeof t), text: v }), `text:${pk(sel)}`)} />
				</label>
				<div className="oe-ld-prop-buttons">{removeBtn()}</div>
			</>
		);
	};

	const layoutIssues = issuesAt("form:layout");
	const root: LayoutList = { kind: "root" };
	const count = base.items.length;
	return (
		<div className={`oe-ld${dragging ? " is-dragging" : ""}`} onKeyDown={onRootKey}>
			<aside ref={paletteRef} className={`oe-ld-palette${drop && "remove" in drop ? " is-drop-remove" : ""}`}>
				{dragging?.from === "canvas" && (
					<div className="oe-ld-remove-hint">
						<Icon name="trash-2" /> Drop here to remove
					</div>
				)}
				<div className="oe-ld-pal-title">
					Fields <span className="oe-tm-muted">{notPlaced.filter((k) => fieldOf(k)).length ? `${notPlaced.filter((k) => fieldOf(k)).length} not placed yet` : "all placed"}</span>
				</div>
				{type.fields.length ? type.fields.map((f) => paletteField(f.key)) : <div className="oe-tm-muted oe-ld-note">No fields yet.</div>}
				<div className="oe-ld-pal-title">Properties</div>
				{builtinKeys.map(paletteField)}
				<p className="oe-tm-muted oe-ld-note">Not placed, status shows in the form's header and the others at the end.</p>
				<div className="oe-ld-pal-title">Layout</div>
				{COMPONENTS.map((c) => (
					<button
						key={c.kind}
						type="button"
						className="oe-ld-pal-item is-component"
						data-component={c.kind}
						title={`${c.desc}. Drag onto the layout, or click to add it.`}
						onPointerDown={(e) => startPointer(e, { from: "palette", node: blankNode(c.kind) })}
						onClick={() => !justDragged.current && add(blankNode(c.kind))}
					>
						<Icon name={c.icon} />
						<span className="oe-ld-pal-label">{c.label}</span>
					</button>
				))}
			</aside>

			<div className="oe-ld-main">
				<div className="oe-ld-toolbar">
					<button type="button" className="clickable-icon" aria-label="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}>
						<Icon name="undo-2" />
					</button>
					<button type="button" className="clickable-icon" aria-label="Redo (Ctrl/Cmd+Shift+Z)" disabled={!canRedo} onClick={redo}>
						<Icon name="redo-2" />
					</button>
					<span className="oe-ld-toolbar-note oe-tm-muted">{layout ? `${plural(base.items.filter((n) => n.kind === "frame").length, "frame")}, ${plural(placedAt.size, "property", "properties")} placed` : "No custom layout"}</span>
					<span className="oe-spacer" />
					<button type="button" onClick={() => commit(layoutFromFields(type), { select: null })}>
						<Icon name="list-restart" /> {layout ? "Start again from fields" : "Start from fields"}
					</button>
					{layout && (
						<button type="button" onClick={() => commit(null, { select: null })}>
							<Icon name="rotate-ccw" /> Reset layout
						</button>
					)}
				</div>
				{layoutIssues.length > 0 && <Issues issues={layoutIssues} />}
				<div
					ref={canvasRef}
					className={`oe-ld-canvas oe-ld-list${listCls(root, count)}`}
					data-ld-list="root"
					onClick={(e) => e.target === e.currentTarget && setSel(null)}
				>
					{base.items.map((n, i) => (n.kind === "frame" ? renderFrame(n, i, count) : renderItem(n, [i], root, i, count)))}
					{!layout && (
						<div className="oe-ld-start">
							<p>No custom layout: the form lists every field in field order.</p>
							<p className="oe-tm-muted">Drag fields and frames here, or start from the fields.</p>
							<div className="oe-ld-prop-buttons">
								<button type="button" className="mod-cta" onClick={() => commit(layoutFromFields(type), { select: null })}>
									Start from fields
								</button>
								<button type="button" onClick={() => add(blankNode("frame"))}>
									Start with an empty frame
								</button>
							</div>
						</div>
					)}
					{layout && !layout.hideUnplaced && unplacedFields.length > 0 && (
						<div className="oe-ld-other" aria-hidden="true">
							<div className="oe-ld-other-caption">Other fields</div>
							<div className="oe-ld-faint">{unplacedFields.map(labelOf).join(", ")}</div>
						</div>
					)}
					{layout && count === 0 && <div className="oe-ld-empty">Drag fields, frames or columns here</div>}
				</div>
				<div className="oe-ld-hint oe-tm-muted">
					Drag to place and move · Alt+↑/↓ moves the selection · Delete removes it · right-click or ⋯ for more · Ctrl/Cmd+Z undoes
				</div>
			</div>

			<aside className="oe-ld-props">
				{props()}
			</aside>
		</div>
	);
}

/** A text box that keeps what's typed (spaces included) while the layout tidies the saved value. */
function LocalText({ value, onChange, label, placeholder, multiline }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; multiline?: boolean }) {
	const [text, setText] = useState(value);
	const focused = useRef(false);
	useEffect(() => {
		if (!focused.current) setText(value);
	}, [value]);
	const common = {
		"aria-label": label,
		value: text,
		placeholder,
		onFocus: () => (focused.current = true),
		onBlur: () => {
			focused.current = false;
			setText(value);
		},
		onChange: (e: { target: { value: string } }) => {
			setText(e.target.value);
			onChange(e.target.value);
		},
	};
	return multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />;
}

