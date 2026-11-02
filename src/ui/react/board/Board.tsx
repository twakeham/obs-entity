import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as RPointerEvent, type ReactNode, type UIEvent } from "react";
import { BUCKET_NONE, BUCKET_PAGE, bucketsOf, boardOf, cardWidth, isBucketColumn, orderRows, reorder, type Bucket } from "../../../model/board";
import { highlightOf, ROW_TARGET, type Cell, type GroupBy, type ResolvedColumn, type ResultGroup, type ResultRow, type ViewContext, type ViewDef, type ViewResult } from "../../../model/views";
import type { SummaryResult } from "../../../model/summary";
import { usePlugin } from "../context";
import { statusTone } from "../EntityBits";
import { Icon } from "../Icon";
import { CellView } from "../table/cells";
import { cssColor, hlClasses, scaleFill, type ColumnChoice } from "../table/popovers";

/** What a board keeps for the session (scroll positions survive the re-render after a save). */
export interface BoardMemory {
	left: number;
	top: number;
	bodies: Record<string, number>;
}

/** A swimlane (a group of the swimlane column), or the one lane of a board without swimlanes. */
interface Lane {
	key: string;
	label: string;
	group: ResultGroup | null;
	rows: ResultRow[];
}

/** Where a dragged card would land. */
interface DropTarget {
	lane: string;
	bucket: string;
	/** the card it goes before (null: the end) */
	before: string | null;
	ok: boolean;
	why?: string;
}

/** A value to write into a swimlane's column. */
export type LaneTarget = { col: ResolvedColumn; value: string | boolean | null };

export interface CardMove {
	paths: string[];
	bucket: Bucket;
	/** set when the cards change swimlane (and the swimlane column can be written) */
	lane: LaneTarget | null;
	/** the bucket's new manual order, when it changes */
	order: { bucket: string; paths: string[] } | null;
}

export interface BoardProps {
	def: ViewDef;
	update: (d: ViewDef) => void;
	result: ViewResult;
	bucketCol: ResolvedColumn | null;
	/** columns that can be buckets (none: the board can't be shown) */
	bucketChoices: ResolvedColumn[];
	ctx: ViewContext;
	selected: Set<string>;
	setSelected: (s: Set<string>) => void;
	collapsedLanes: Set<string>;
	toggleLane: (key: string) => void;
	summarize: (rows: ResultRow[]) => Record<string, SummaryResult | null>;
	rowMenu: (at: { x: number; y: number }, r: ResultRow) => void;
	bucketMenu: (at: { x: number; y: number }, bucket: Bucket) => void;
	laneMenu: (at: { x: number; y: number }) => void;
	hover: (e: MouseEvent, path: string) => void;
	move: (m: CardMove) => Promise<void>;
	newCard: (bucket: Bucket, lane: LaneTarget | null) => void;
	onCommonKey: (e: KeyboardEvent<HTMLDivElement>) => boolean;
	chooseBuckets: (el: HTMLElement) => void;
	memory: BoardMemory;
	/** renders a summary result (the table's) */
	SummaryText: (p: { s: SummaryResult | null | undefined }) => ReactNode;
}

const laneValue = (col: ResolvedColumn, key: string): string | boolean | null => (key === "" ? null : col.kind === "bool" ? key === "yes" : key);
const isEmptyCell = (c: Cell | undefined) =>
	!c || (!c.error && (c.value === null || c.value === undefined || c.value === "" || c.value === false || (Array.isArray(c.value) && c.value.length === 0)) && !c.text);

export function Board(p: BoardProps) {
	const plugin = usePlugin();
	const { def, result, bucketCol, ctx, selected } = p;
	const board = boardOf(def);
	const sorted = def.sort.length > 0;
	const scrollRef = useRef<HTMLDivElement>(null);
	const [focus, setFocus] = useState<string | null>(null);
	const [pages, setPages] = useState<Record<string, number>>({});
	const [dragging, setDragging] = useState<string[] | null>(null);
	const [drop, setDrop] = useState<DropTarget | null>(null);
	const [announce, setAnnounce] = useState("");

	// ---- layout: lanes × buckets, each cell's cards in order
	const laneCol = board.swimlanes ? (result.known.get(board.swimlanes.by) ?? null) : null;
	const laneWritable = !!laneCol && isBucketColumn(laneCol) && !board.swimlanes?.date;
	const lanes: Lane[] = useMemo(
		() => (result.groups ? result.groups.map((g) => ({ key: g.key, label: g.label, group: g, rows: g.rows })) : [{ key: "", label: "", group: null, rows: result.rows }]),
		[result],
	);
	const buckets = useMemo(() => (bucketCol ? bucketsOf(bucketCol, result.rows, board).filter((b) => !b.hidden) : []), [bucketCol, result, board]);
	/** a bucket's cards (every lane) in their shown order */
	const bucketOrder = (b: Bucket) => (sorted ? b.rows : orderRows(b.rows, board.order[b.key]));
	const cells = useMemo(() => {
		const out = new Map<string, ResultRow[]>();
		if (!bucketCol) return out;
		for (const lane of lanes) {
			const inLane = new Set(lane.rows.map((r) => r.row.path));
			for (const b of buckets) out.set(`${lane.key}|${b.key}`, bucketOrder(b).filter((r) => inLane.has(r.row.path)));
		}
		return out;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [lanes, buckets, bucketCol, sorted, board.order]);
	const cardFields = result.columns.filter((c) => c.id !== "name" && c.id !== bucketCol?.id);
	const collapsed = new Set(board.collapsedBuckets);
	const shownOf = (cellKey: string) => pages[cellKey] ?? BUCKET_PAGE;

	// ---- scroll memory
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollLeft = p.memory.left;
		el.scrollTop = p.memory.top;
		el.querySelectorAll<HTMLElement>("[data-body]").forEach((b) => (b.scrollTop = p.memory.bodies[b.dataset.body!] ?? 0));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// With swimlanes, cards scrolled into view (focus, drops) must clear the sticky row of bucket headers.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		const heads = el?.querySelector<HTMLElement>(".oe-board-heads");
		if (el) el.style.scrollPaddingTop = heads ? `${heads.offsetHeight + 8}px` : "";
	});
	const remember = (e: UIEvent<HTMLElement>) => {
		const t = e.currentTarget;
		if (t === scrollRef.current) {
			p.memory.left = t.scrollLeft;
			p.memory.top = t.scrollTop;
		} else if (t.dataset.body) p.memory.bodies[t.dataset.body] = t.scrollTop;
	};

	// ---- selection and focus
	const cardKey = (lane: string, path: string) => `${lane}|${path}`;
	const toggleSelect = (path: string) => {
		const next = new Set(selected);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		p.setSelected(next);
	};
	/** the cards a drag or keyboard move takes: the selection when the card is part of it, in board order */
	const movingFor = (path: string) => (selected.has(path) && selected.size > 1 ? result.rows.map((x) => x.row.path).filter((x) => selected.has(x)) : [path]);
	useEffect(() => {
		if (!focus) return;
		const el = scrollRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus)}"]`);
		// Refocus after the card is redrawn elsewhere (moved to another bucket), unless focus went somewhere else.
		const a = document.activeElement;
		const ours = !a || a === document.body || !!scrollRef.current?.contains(a);
		if (el && a !== el && ours) el.focus();
	}, [focus, cells]);

	// ---- drag and drop (pointer events: mouse, pen, and touch after a long press)
	const drag = useRef<{
		paths: string[];
		lane: string;
		el: HTMLElement;
		x0: number;
		y0: number;
		dx: number;
		dy: number;
		x: number;
		y: number;
		touch: boolean;
		active: boolean;
		timer: number;
		ghost: HTMLElement | null;
		frame: number;
	} | null>(null);
	const justDragged = useRef(false);

	const targetAt = (x: number, y: number): DropTarget | null => {
		const d = drag.current;
		if (!d) return null;
		const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
		if (!zone || !scrollRef.current?.contains(zone)) return null;
		const lane = zone.dataset.lane ?? "";
		const bucket = zone.dataset.bucket ?? "";
		let before: string | null = null;
		if (!sorted)
			for (const c of zone.querySelectorAll<HTMLElement>("[data-card]")) {
				if (d.paths.includes(c.dataset.card!)) continue;
				const r = c.getBoundingClientRect();
				if (y < r.top + r.height / 2) {
					before = c.dataset.card!;
					break;
				}
			}
		const ok = lane === d.lane || laneWritable;
		return { lane, bucket, before, ok, ...(ok ? {} : { why: `Cards can't be dragged to another ${laneCol?.label ?? "swimlane"}` }) };
	};
	const setTarget = (t: DropTarget | null) => setDrop((cur) => (cur?.lane === t?.lane && cur?.bucket === t?.bucket && cur?.before === t?.before && cur?.ok === t?.ok ? cur : t));

	/** Scroll the board (and the bucket under the pointer) when dragging near their edges. */
	const autoScroll = () => {
		const d = drag.current;
		if (!d?.active) return;
		const edge = 48;
		const speed = (dist: number) => Math.ceil(((edge - Math.max(0, dist)) / edge) * 18);
		let moved = false;
		const nudge = (el: HTMLElement, horizontal: boolean) => {
			const r = el.getBoundingClientRect();
			const before = horizontal ? el.scrollLeft : el.scrollTop;
			if (horizontal) {
				if (d.x < r.left + edge) el.scrollLeft -= speed(d.x - r.left);
				else if (d.x > r.right - edge) el.scrollLeft += speed(r.right - d.x);
			} else if (d.y < r.top + edge) el.scrollTop -= speed(d.y - r.top);
			else if (d.y > r.bottom - edge) el.scrollTop += speed(r.bottom - d.y);
			if ((horizontal ? el.scrollLeft : el.scrollTop) !== before) moved = true;
		};
		const sc = scrollRef.current;
		if (sc) {
			nudge(sc, true);
			nudge(sc, false);
		}
		const body = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>("[data-body]");
		if (body) nudge(body, false);
		if (moved) setTarget(targetAt(d.x, d.y));
		d.frame = requestAnimationFrame(autoScroll);
	};

	const startDrag = () => {
		const d = drag.current;
		if (!d || d.active) return;
		d.active = true;
		const r = d.el.getBoundingClientRect();
		const ghost = d.el.cloneNode(true) as HTMLElement;
		ghost.classList.add("oe-card-ghost");
		ghost.classList.remove("is-focused", "is-selected");
		ghost.removeAttribute("data-card");
		ghost.removeAttribute("data-key");
		ghost.style.width = `${r.width}px`;
		ghost.style.left = `${d.x - d.dx}px`;
		ghost.style.top = `${d.y - d.dy}px`;
		ghost.style.setProperty("--oe-card-w", `${r.width}px`);
		if (d.paths.length > 1) ghost.dataset.count = String(d.paths.length);
		document.body.appendChild(ghost);
		d.ghost = ghost;
		window.getSelection()?.removeAllRanges();
		setDragging(d.paths);
		setTarget(targetAt(d.x, d.y));
		d.frame = requestAnimationFrame(autoScroll);
	};

	const endDrag = (commit: boolean) => {
		const d = drag.current;
		// Work out the drop before letting go of the drag (targetAt reads it).
		const target = commit && d?.active ? targetAt(d.x, d.y) : null;
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
		if (target?.ok) void dropOn(d.paths, d.lane, target);
	};
	const onMove = (e: PointerEvent) => {
		const d = drag.current;
		if (!d) return;
		d.x = e.clientX;
		d.y = e.clientY;
		const far = Math.hypot(d.x - d.x0, d.y - d.y0);
		if (!d.active) {
			// Touch: moving before the long press scrolls instead. Mouse and pen: a small move starts the drag.
			if (d.touch) {
				if (far > 8) endDrag(false);
			} else if (far > 5) startDrag();
			return;
		}
		if (d.ghost) {
			d.ghost.style.left = `${d.x - d.dx}px`;
			d.ghost.style.top = `${d.y - d.dy}px`;
		}
		setTarget(targetAt(d.x, d.y));
	};
	const onUp = () => endDrag(true);
	const onCancel = () => endDrag(false);
	const blockTouch = (e: TouchEvent) => {
		if (drag.current?.active) e.preventDefault();
	};
	const onDragKey = (e: globalThis.KeyboardEvent) => {
		if (e.key !== "Escape" || !drag.current?.active) return;
		e.preventDefault();
		e.stopPropagation();
		endDrag(false);
	};
	useEffect(() => () => endDrag(false), []); // eslint-disable-line react-hooks/exhaustive-deps

	const onCardPointerDown = (e: RPointerEvent<HTMLElement>, r: ResultRow, lane: string) => {
		if (e.button !== 0 || (e.target as HTMLElement).closest("input, button")) return;
		if (drag.current) endDrag(false);
		const rect = e.currentTarget.getBoundingClientRect();
		const touch = e.pointerType === "touch";
		drag.current = { paths: movingFor(r.row.path), lane, el: e.currentTarget, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, touch, active: false, timer: 0, ghost: null, frame: 0 };
		if (touch) drag.current.timer = window.setTimeout(startDrag, 350);
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onCancel);
		document.addEventListener("touchmove", blockTouch, { passive: false });
		document.addEventListener("keydown", onDragKey, true);
	};

	/** Put cards in a bucket (and swimlane): write the fields that change, and the manual order. */
	const dropOn = async (paths: string[], fromLane: string, t: DropTarget) => {
		const bucket = buckets.find((b) => b.key === t.bucket);
		if (!bucket) return;
		let order: CardMove["order"] = null;
		if (!sorted) {
			const current = bucketOrder(bucket).map((r) => r.row.path);
			const next = reorder(current, paths, t.before);
			// Save an order only when the cards wouldn't land there anyway (new cards go by name, or at the end of a saved order).
			const members = new Set([...current, ...paths]);
			const natural = orderRows(
				result.rows.filter((r) => members.has(r.row.path)),
				board.order[bucket.key],
			).map((r) => r.row.path);
			if (next.join("\n") !== natural.join("\n")) order = { bucket: bucket.key, paths: next };
		}
		const lane = laneCol && laneWritable && t.lane !== fromLane ? { col: laneCol, value: laneValue(laneCol, t.lane) } : null;
		await p.move({ paths, bucket, lane, order });
	};

	// ---- keyboard: arrows move focus, Ctrl/Cmd+Shift+←/→ moves the card, Enter opens, Space selects
	const openBuckets = buckets.filter((b) => !collapsed.has(b.key));
	const listAt = (lane: string, bi: number) => {
		const ck = `${lane}|${openBuckets[bi]?.key}`;
		return (cells.get(ck) ?? []).slice(0, shownOf(ck));
	};
	const locate = (key: string) => {
		const sep = key.indexOf("|");
		const lane = key.slice(0, sep);
		const path = key.slice(sep + 1);
		for (let bi = 0; bi < openBuckets.length; bi++) {
			const list = listAt(lane, bi);
			const i = list.findIndex((r) => r.row.path === path);
			if (i >= 0) return { lane, bi, i, r: list[i] };
		}
		return null;
	};
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if ((e.target as HTMLElement).matches("input:not([type=checkbox]), select, textarea")) return;
		const at = focus ? locate(focus) : null;
		const firstCard = () => {
			for (const lane of lanes) {
				if (p.collapsedLanes.has(lane.key)) continue;
				for (let bi = 0; bi < openBuckets.length; bi++) {
					const l = listAt(lane.key, bi);
					if (l.length) return cardKey(lane.key, l[0].row.path);
				}
			}
			return null;
		};
		const arrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
		if (arrow && (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
			e.preventDefault();
			if (!at) return;
			// To the neighbouring bucket (collapsed ones included), at its end.
			const from = buckets.findIndex((b) => b.key === openBuckets[at.bi].key);
			const to = buckets[from + (e.key === "ArrowLeft" ? -1 : 1)];
			if (!to) return;
			const paths = movingFor(at.r.row.path);
			void dropOn(paths, at.lane, { lane: at.lane, bucket: to.key, before: null, ok: true }).then(() =>
				setAnnounce(`Moved ${paths.length > 1 ? `${paths.length} cards` : at.r.row.name} to ${to.key === BUCKET_NONE ? `no ${bucketCol?.label.toLowerCase() ?? "value"}` : to.label}.`),
			);
			return;
		}
		if (arrow) {
			e.preventDefault();
			if (!at) {
				const f = firstCard();
				if (f) setFocus(f);
				return;
			}
			if (e.key === "ArrowUp" || e.key === "ArrowDown") {
				const n = listAt(at.lane, at.bi)[at.i + (e.key === "ArrowUp" ? -1 : 1)];
				if (n) setFocus(cardKey(at.lane, n.row.path));
				return;
			}
			const step = e.key === "ArrowLeft" ? -1 : 1;
			for (let bi = at.bi + step; bi >= 0 && bi < openBuckets.length; bi += step) {
				const list = listAt(at.lane, bi);
				if (list.length) {
					setFocus(cardKey(at.lane, list[Math.min(at.i, list.length - 1)].row.path));
					return;
				}
			}
			return;
		}
		if (at && e.key === "Enter") {
			e.preventDefault();
			plugin.openPath(at.r.row.path, e.nativeEvent);
			return;
		}
		if (at && e.key === " ") {
			e.preventDefault();
			toggleSelect(at.r.row.path);
			return;
		}
		if (at && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
			e.preventDefault();
			const r = scrollRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus!)}"]`)?.getBoundingClientRect();
			p.rowMenu({ x: r ? r.left + 16 : 0, y: r ? r.top + 16 : 0 }, at.r);
			return;
		}
		if (p.onCommonKey(e)) return;
		if (e.key === "Escape" && focus) {
			setFocus(null);
			scrollRef.current?.focus();
		}
	};

	// ---- rendering
	if (!bucketCol)
		return (
			<div className="oe-board-scroll is-empty">
				{p.bucketChoices.length ? (
					<div className="oe-table-empty">
						<p>Choose the field whose values are the board's buckets.</p>
						<button className="mod-cta" onClick={(e) => p.chooseBuckets(e.currentTarget)}>
							Choose buckets…
						</button>
					</div>
				) : (
					<div className="oe-table-empty">These types have no status, choice, checkbox or single-link field to make buckets from.</div>
				)}
			</div>
		);

	const bucketTitle = (b: Bucket) => (b.key === BUCKET_NONE ? `No ${bucketCol.label.toLowerCase()}` : bucketCol.kind === "bool" ? `${bucketCol.label}: ${b.label}` : b.label);
	const bucketLabel = (b: Bucket) => {
		if (b.key === BUCKET_NONE) return <span className="oe-bucket-none">{bucketTitle(b)}</span>;
		if (bucketCol.def.kind === "builtin") return <span className={`oe-status-pill oe-tone-${statusTone(b.label)}`}>{b.label}</span>;
		if (bucketCol.kind === "bool")
			return (
				<span className="oe-bucket-bool">
					<Icon name={b.value ? "check-square" : "square"} />
					{bucketTitle(b)}
				</span>
			);
		if (bucketCol.kind === "links") {
			const t = ctx.row(b.key)?.type;
			return (
				<span className="oe-bucket-link" style={t ? ({ "--oe-type-color": t.color } as CSSProperties) : undefined}>
					{t && <Icon name={t.icon} className="oe-chip-icon" />}
					{b.label}
				</span>
			);
		}
		return <span className="oe-pill">{b.label}</span>;
	};
	const count = (b: Bucket) => {
		const limit = board.limits[b.key];
		const over = limit !== undefined && b.rows.length > limit;
		return (
			<span className={`oe-bucket-count${over ? " is-over" : ""}`} aria-label={limit !== undefined ? `${b.rows.length} cards, limit ${limit}` : `${b.rows.length} cards`}>
				{b.rows.length}
				{limit !== undefined && ` / ${limit}`}
			</span>
		);
	};
	const toggleBucket = (b: Bucket) => {
		const has = board.collapsedBuckets.includes(b.key);
		p.update({ ...def, board: { ...board, collapsedBuckets: has ? board.collapsedBuckets.filter((k) => k !== b.key) : [...board.collapsedBuckets, b.key] } });
	};
	const sumLine = (rows: ResultRow[]) => {
		const shown = cardFields.filter((c) => def.summary[c.id]);
		if (!shown.length) return null;
		const s = p.summarize(rows);
		return (
			<span className="oe-bucket-sums">
				{shown.map((c) => (
					<span key={c.id} className="oe-bucket-sum" aria-label={c.label}>
						<p.SummaryText s={s[c.id]} />
					</span>
				))}
			</span>
		);
	};
	const menuAt = (e: MouseEvent, b: Bucket) => {
		e.preventDefault();
		p.bucketMenu({ x: e.clientX, y: e.clientY }, b);
	};
	const head = (b: Bucket) =>
		collapsed.has(b.key) ? (
			<div className="oe-bucket-head is-collapsed" data-head={b.key} onContextMenu={(e) => menuAt(e, b)}>
				<button className="clickable-icon" aria-label={`Expand ${bucketTitle(b)}`} onClick={() => toggleBucket(b)}>
					<Icon name="chevron-right" />
				</button>
				{count(b)}
				<span className="oe-bucket-vlabel">{bucketTitle(b)}</span>
			</div>
		) : (
			<div className="oe-bucket-head" data-head={b.key} onContextMenu={(e) => menuAt(e, b)}>
				<div className="oe-bucket-title">
					<button className="clickable-icon oe-bucket-chevron" aria-label={`Collapse ${bucketTitle(b)}`} onClick={() => toggleBucket(b)}>
						<Icon name="chevron-down" />
					</button>
					{bucketLabel(b)}
					{count(b)}
					<span className="oe-spacer" />
					<button className="clickable-icon" aria-label={`Add a card to ${bucketTitle(b)}`} onClick={() => p.newCard(b, null)}>
						<Icon name="plus" />
					</button>
					<button className="clickable-icon" aria-label={`${bucketTitle(b)} options`} onClick={(e) => menuAt(e, b)}>
						<Icon name="more-horizontal" />
					</button>
				</div>
				{sumLine(b.rows)}
			</div>
		);

	const card = (r: ResultRow, lane: string, bucket: Bucket) => {
		const path = r.row.path;
		const key = cardKey(lane, path);
		const rowRule = r.hl?.[ROW_TARGET] !== undefined ? def.highlight[r.hl[ROW_TARGET]] : undefined;
		const titleHl = r.hl ? highlightOf(def, r, "name") : null;
		const nameRule = r.hl?.name !== undefined ? def.highlight[r.hl.name] : undefined;
		const isSel = selected.has(path);
		const subtitle = board.cardSubtitle ? (r.row.subtitle ?? plugin.index.get(path)?.subtitle) : null;
		return (
			<div
				key={key}
				data-card={path}
				data-key={key}
				className={`oe-card${isSel ? " is-selected" : ""}${focus === key ? " is-focused" : ""}${dragging?.includes(path) ? " is-dragging" : ""}${rowRule ? ` ${hlClasses({ ...rowRule.style, icon: undefined })}` : ""}`}
				style={{ "--oe-type-color": r.row.type.color } as CSSProperties}
				tabIndex={focus === key ? 0 : -1}
				role="group"
				aria-roledescription="card"
				onPointerDown={(e) => onCardPointerDown(e, r, lane)}
				onClickCapture={(e) => {
					if (!justDragged.current) return;
					e.preventDefault();
					e.stopPropagation();
				}}
				onClick={(e) => {
					if (e.ctrlKey || e.metaKey) toggleSelect(path);
					setFocus(key);
				}}
				onFocus={(e) => e.target === e.currentTarget && focus !== key && setFocus(key)}
				onContextMenu={(e) => {
					e.preventDefault();
					if (!drag.current?.active) p.rowMenu({ x: e.clientX, y: e.clientY }, r);
				}}
			>
				<div className={`oe-card-title${nameRule ? ` ${hlClasses({ ...nameRule.style, icon: undefined, fill: undefined })}` : ""}`}>
					{titleHl?.style.icon && (
						<span className="oe-hl-icon" aria-label={titleHl.iconRule?.name}>
							<Icon name={titleHl.style.icon} />
						</span>
					)}
					<a
						className="oe-table-name oe-card-name"
						href="#"
						draggable={false}
						tabIndex={-1}
						onClick={(e) => {
							e.preventDefault();
							if (e.ctrlKey || e.metaKey || e.shiftKey) return;
							plugin.openPath(path, e.nativeEvent);
						}}
						onAuxClick={(e) => e.button === 1 && plugin.openPath(path, "tab")}
						onMouseOver={(e) => p.hover(e, path)}
					>
						<Icon name={r.row.type.icon} className="oe-chip-icon" />
						<span>{r.row.name}</span>
					</a>
					<input type="checkbox" className="oe-card-check" checked={isSel} tabIndex={-1} aria-label={`Select ${r.row.name}`} onChange={() => toggleSelect(path)} />
				</div>
				{/* For screen readers (an aria-label would show as Obsidian's tooltip on hover). */}
				<span className="oe-sr-only">
					{bucketCol.label}: {bucketTitle(bucket)}
				</span>
				{subtitle && <div className="oe-card-subtitle">{subtitle}</div>}
				{cardFields.length > 0 && (
					<div className="oe-card-fields">
						{cardFields.map((c) => {
							const cell = r.cells[c.id];
							const viz = r.viz?.[c.id];
							if (isEmptyCell(cell)) return null;
							const ci = r.hl?.[c.id];
							const cellRule = ci !== undefined ? def.highlight[ci] : undefined;
							const barRule = viz?.bar ? def.highlight[viz.bar.rule] : undefined;
							const scaleRule = viz?.scale ? def.highlight[viz.scale.rule] : undefined;
							const scaleBg = viz?.scale && scaleRule?.scale && !(ci !== undefined && ci < viz.scale.rule && cellRule?.style.fill) ? scaleFill(scaleRule.scale.colors, viz.scale.t) : undefined;
							const bar =
								viz?.bar && barRule ? (
									<span
										className={`oe-bar${barRule.bar?.gradient ? " is-gradient" : ""}`}
										aria-hidden="true"
										style={{ left: `${viz.bar.start * 100}%`, width: `${(viz.bar.end - viz.bar.start) * 100}%`, "--oe-bar": cssColor(viz.bar.negative ? (barRule.bar?.negative ?? "red") : (barRule.bar?.color ?? "blue")) } as CSSProperties}
									/>
								) : null;
							return (
								<div
									key={c.id}
									className={`oe-card-field${cellRule ? ` ${hlClasses({ ...cellRule.style, icon: undefined })}` : ""}${scaleBg ? " has-scale" : ""}`}
									style={scaleBg ? { backgroundColor: scaleBg } : undefined}
									data-col={c.id}
								>
									{board.cardLabels && <span className="oe-card-label">{c.label}</span>}
									<span className={`oe-card-value${bar ? " has-bar" : ""}${bar && barRule?.bar?.barOnly ? " is-bar-only" : ""}`} aria-label={bar && barRule?.bar?.barOnly ? cell?.text : undefined}>
										{bar}
										{cellRule?.style.icon && (
											<span className="oe-hl-icon" aria-label={cellRule.name}>
												<Icon name={cellRule.style.icon} />
											</span>
										)}
										<span className="oe-bar-value">
											<CellView col={c} cell={cell} row={r.row} />
										</span>
									</span>
								</div>
							);
						})}
					</div>
				)}
			</div>
		);
	};

	const body = (lane: Lane, b: Bucket, single: boolean) => {
		const ck = `${lane.key}|${b.key}`;
		const here = drop && drop.lane === lane.key && drop.bucket === b.key ? drop : null;
		const zone = { "data-drop": "", "data-lane": lane.key, "data-bucket": b.key, title: here && !here.ok ? here.why : undefined };
		const dropCls = here ? (here.ok ? " is-drop" : " is-no-drop") : "";
		if (collapsed.has(b.key)) return <div key={ck} className={`oe-bucket-cell is-collapsed${dropCls}`} {...zone} />;
		const list = cells.get(ck) ?? [];
		const shown = list.slice(0, shownOf(ck));
		const line = here?.ok && !sorted ? <div className="oe-drop-line" aria-hidden="true" /> : null;
		const laneTarget = laneCol && lane.group && laneWritable ? { col: laneCol, value: laneValue(laneCol, lane.key) } : null;
		return (
			<div key={ck} className={`oe-bucket-cell${dropCls}${single ? " is-single" : ""}`} {...zone} data-body={single ? b.key : undefined} onScroll={single ? remember : undefined}>
				{shown.map((r) => (
					<CardSlot key={r.row.path} line={here?.before === r.row.path ? line : null}>
						{card(r, lane.key, b)}
					</CardSlot>
				))}
				{here && here.before === null && line}
				{list.length > shown.length && (
					<button className="oe-pop-link oe-bucket-more" onClick={() => setPages({ ...pages, [ck]: shownOf(ck) + BUCKET_PAGE })}>
						Show {Math.min(BUCKET_PAGE, list.length - shown.length)} more… <span className="oe-bucket-more-n">({list.length - shown.length} not shown)</span>
					</button>
				)}
				<button className="oe-bucket-add" onClick={() => p.newCard(b, laneTarget)}>
					<Icon name="plus" /> Add card
				</button>
			</div>
		);
	};

	const style = { "--oe-card-w": `${cardWidth(def)}px` } as CSSProperties;
	const colCls = (b: Bucket) => (collapsed.has(b.key) ? " is-collapsed" : "");
	const hasLanes = !!lanes[0]?.group;
	return (
		<div
			ref={scrollRef}
			className={`oe-board-scroll${hasLanes ? " has-lanes" : ""}${dragging ? " is-dragging" : ""}`}
			style={style}
			tabIndex={0}
			onKeyDown={onKeyDown}
			onScroll={remember}
			role="region"
			aria-label="Board"
		>
			{hasLanes ? (
				<>
					<div className="oe-board-heads">
						{buckets.map((b) => (
							<div key={b.key} className={`oe-bucket${colCls(b)}`}>
								{head(b)}
							</div>
						))}
					</div>
					{lanes.map((lane) => {
						const open = !p.collapsedLanes.has(lane.key);
						return (
							<section key={lane.key} className="oe-lane" data-lane={lane.key}>
								<div className="oe-lane-head" onClick={() => p.toggleLane(lane.key)} onContextMenu={(e) => (e.preventDefault(), p.laneMenu({ x: e.clientX, y: e.clientY }))}>
									<span className="oe-lane-label">
										<Icon name={open ? "chevron-down" : "chevron-right"} />
										<LaneLabel def={def} col={laneCol} lane={lane} by={board.swimlanes!} />
										<span className="oe-group-count">{lane.rows.length}</span>
										{def.groupSummaries !== false && sumLine(lane.rows)}
									</span>
								</div>
								{open && <div className="oe-lane-row">{buckets.map((b) => body(lane, b, false))}</div>}
							</section>
						);
					})}
				</>
			) : (
				<div className="oe-lane-row is-single">
					{buckets.map((b) => {
						// A collapsed bucket is one strip: all of it takes drops.
						const here = drop && drop.lane === "" && drop.bucket === b.key ? drop : null;
						const zone = collapsed.has(b.key) ? { "data-drop": "", "data-lane": "", "data-bucket": b.key, title: here && !here.ok ? here.why : undefined } : {};
						return (
							<div key={b.key} className={`oe-bucket is-single${colCls(b)}${collapsed.has(b.key) && here ? " is-drop" : ""}`} {...zone}>
								{head(b)}
								{!collapsed.has(b.key) && body(lanes[0], b, true)}
							</div>
						);
					})}
				</div>
			)}
			{result.rows.length === 0 && <div className="oe-board-note">{result.total === 0 ? "No entities yet." : "No entities match this view's filters or search."}</div>}
			<div className="oe-sr-only" aria-live="polite">
				{announce}
			</div>
		</div>
	);
}

function CardSlot({ line, children }: { line: ReactNode; children: ReactNode }) {
	return (
		<>
			{line}
			{children}
		</>
	);
}

function LaneLabel({ def, col, lane, by }: { def: ViewDef; col: ResolvedColumn | null; lane: Lane; by: GroupBy }) {
	const label = col?.label ?? by.by;
	return def.groupFieldNames !== false ? (
		<span className="oe-group-label">
			<span className="oe-group-field">{label}:</span> {lane.label || <span className="oe-group-none">none</span>}
		</span>
	) : (
		<span className="oe-group-label">{lane.label || `No ${label.toLowerCase()}`}</span>
	);
}

// ---------------------------------------------------------------- panels

/** Toolbar → Buckets: which field the buckets come from. */
export function BucketsPanel({ value, choices, onChange }: { value: string | undefined; choices: ResolvedColumn[]; onChange: (id: string) => void }) {
	return (
		<div className="oe-bucketspanel" role="radiogroup" aria-label="Buckets">
			<div className="oe-pop-heading">Buckets by</div>
			{choices.map((c) => (
				<label key={c.id} className="oe-columns-item">
					<input type="radio" name="oe-buckets" checked={value === c.id} onChange={() => onChange(c.id)} />
					<span className="oe-columns-label">{c.label}</span>
					<span className="oe-bucketspanel-kind">{c.def.kind === "builtin" ? "status" : c.kind === "bool" ? "checkbox" : c.kind === "links" ? "link" : "choice"}</span>
				</label>
			))}
			<div className="oe-pop-hint">Dragging a card to another bucket changes this field. Only the entities' own status, choice, checkbox and single-link fields can be buckets.</div>
		</div>
	);
}

/** Toolbar → Group on a board: one level of swimlanes. */
export function SwimlanePanel({
	def,
	choices,
	onChange,
}: {
	def: ViewDef;
	choices: ColumnChoice[];
	onChange: (swimlanes: GroupBy | undefined, groupSummaries: false | undefined, groupFieldNames: false | undefined) => void;
}) {
	const b = boardOf(def);
	const lane = b.swimlanes;
	const usable = choices.filter((c) => c.col.id !== "name" && !c.col.invalid && c.col.id !== b.buckets);
	const col = usable.find((c) => c.col.id === lane?.by)?.col;
	const groups = [...new Set(usable.map((c) => c.group))];
	return (
		<div className="oe-grouppanel">
			<div className="oe-sortlevel">
				<span className="oe-sortlevel-n">Swimlanes</span>
				<select
					className="dropdown oe-pop-select"
					aria-label="Swimlanes by"
					value={lane?.by ?? ""}
					onChange={(e) => onChange(e.target.value ? { by: e.target.value } : undefined, def.groupSummaries, def.groupFieldNames)}
				>
					<option value="">None</option>
					{groups.map((g) => (
						<optgroup key={g} label={g}>
							{usable
								.filter((c) => c.group === g)
								.map((c) => (
									<option key={c.col.id} value={c.col.id}>
										{c.col.label}
									</option>
								))}
						</optgroup>
					))}
				</select>
				{col?.kind === "date" && lane && (
					<select className="dropdown oe-pop-select is-narrow" value={lane.date ?? ""} aria-label="Date grouping" onChange={(e) => onChange({ by: lane.by, ...(e.target.value ? { date: e.target.value as "month" | "year" } : {}) }, def.groupSummaries, def.groupFieldNames)}>
						<option value="">by day</option>
						<option value="month">by month</option>
						<option value="year">by year</option>
					</select>
				)}
			</div>
			<div className="oe-pop-hint">
				Swimlanes split the board into rows, one per value.{" "}
				{col ? (isBucketColumn(col) && !lane?.date ? "Dragging a card to another swimlane changes its value too." : `Cards stay in their own ${col.label} swimlane when dragged: dragging can't change this column.`) : ""}
			</div>
			{lane && (
				<>
					<label className="oe-columns-item">
						<input type="checkbox" checked={def.groupFieldNames !== false} onChange={(e) => onChange(lane, def.groupSummaries, e.target.checked ? undefined : false)} />
						<span className="oe-columns-label">Show field names in swimlane headers</span>
					</label>
					<label className="oe-columns-item">
						<input type="checkbox" checked={def.groupSummaries !== false} onChange={(e) => onChange(lane, e.target.checked ? undefined : false, def.groupFieldNames)} />
						<span className="oe-columns-label">Show summaries in swimlane headers</span>
					</label>
				</>
			)}
		</div>
	);
}
