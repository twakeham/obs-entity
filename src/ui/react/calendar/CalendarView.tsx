import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { isBucketColumn } from "../../../model/board";
import {
	agendaDays,
	calendarEntries,
	calendarOf,
	cardModeOf,
	shownFieldIds,
	withCardMode,
	entriesOn,
	layoutOf,
	longDate,
	monthWeeks,
	movedBy,
	partsOfDay,
	periodTitle,
	resizedTo,
	shiftPeriod,
	shortDate,
	weekDays,
	weekdayOf,
	weekOverflow,
	weekSegments,
	weekStartOf,
	WEEKDAY_SHORT,
	type CalEntry,
	type Segment,
} from "../../../model/calendarView";
import { choiceColor, statusColor } from "../../../model/colors";
import { highlightOf, ROW_TARGET, type CalendarLayout, type CardMode, type ResolvedColumn, type ResultRow, type ViewContext, type ViewDef, type ViewResult } from "../../../model/views";
import { CardFields, type LaneTarget } from "../board/Board";
import { usePlugin } from "../context";
import { GroupValue, statusTone } from "../EntityBits";
import { Icon } from "../Icon";
import { hlClasses, Popover } from "../table/popovers";

/** What a calendar keeps for the session: whether the No date list is open. */
export interface CalendarMemory {
	undated?: boolean;
}

/** A dragged entry's new days (and swimlane), or an undated note dropped on a day. */
export interface CalendarMove {
	entry: CalEntry | null;
	row: ResultRow;
	start: number;
	end: number;
	lane: LaneTarget | null;
}

export interface CalendarViewProps {
	def: ViewDef;
	update: (d: ViewDef) => void;
	result: ViewResult;
	ctx: ViewContext;
	/** the day the calendar shows around */
	anchor: number;
	setAnchor: (day: number) => void;
	memory: CalendarMemory;
	rowMenu: (at: { x: number; y: number }, r: ResultRow, entry: CalEntry | null) => void;
	hover: (e: MouseEvent, path: string) => void;
	move: (m: CalendarMove) => Promise<void>;
	newOn: (day: number, lane: LaneTarget | null) => void;
	onCommonKey: (e: KeyboardEvent<HTMLDivElement>) => boolean;
	chooseDates: (el: HTMLElement) => void;
	/** no source type can be on the calendar (none has a date field, or the dates aren't real dates) */
	noDates: string | null;
}

const TONE_EDGE: Record<string, string> = { done: "var(--color-green)", active: "var(--color-blue)", hold: "var(--color-orange)", closed: "var(--text-faint)" };
const paletteEdge = (c: string) => (c === "grey" ? "var(--text-muted)" : `var(--color-${c})`);
const LAYOUTS: { id: CalendarLayout; label: string }[] = [
	{ id: "month", label: "Month" },
	{ id: "week", label: "Week" },
	{ id: "agenda", label: "Agenda" },
];
const CARD_MODES: { id: CardMode; label: string; hint: string }[] = [
	{ id: "minimal", label: "Minimal", hint: "Cards show only their title" },
	{ id: "extended", label: "Extended", hint: "Cards show their fields too (Card fields in the toolbar)" },
];

interface Drag {
	path: string;
	entry: CalEntry | null;
	row: ResultRow;
	mode: "move" | "start" | "end";
	/** the day grabbed (moving keeps the entry's offset from it) */
	grab: number | null;
	x: number;
	y: number;
	active: boolean;
	pointer: number;
}

interface Preview {
	path: string;
	start: number;
	end: number;
	/** the swimlane it's over (null: no swimlanes, or it can't change) */
	lane: string | null;
}

interface Lane {
	key: string | null;
	label: string;
	paths: Set<string> | null;
}

const laneValue = (col: ResolvedColumn, key: string): string | boolean | null => (key === "" ? null : col.kind === "bool" ? key === "yes" : key);

/**
 * The calendar layout of a view: Month (weeks of days, bars in lanes, "+n more" past four), Week (seven days, every
 * entry, optional swimlanes) or Agenda (days with entries, from the anchor). Entries are dragged to move them, by
 * their ends to change the start or end; undated notes are dragged from the No date list onto a day.
 */
export function CalendarView(p: CalendarViewProps) {
	const plugin = usePlugin();
	const { def, result, ctx, anchor } = p;
	const cal = calendarOf(def);
	const layout = layoutOf(def);
	const weekStart = weekStartOf(def);
	const today = ctx.today;
	const data = useMemo(() => calendarEntries(result.rows, def, ctx.dates, ctx.groups), [result, def, ctx]);
	const cardMode = cardModeOf(def, layout);
	const cardFields = shownFieldIds(def, layout).flatMap((id) => result.known.get(id) ?? []);
	const colorCol = cal.colorBy && cal.colorBy !== "none" ? (result.known.get(cal.colorBy) ?? null) : null;
	const [undatedOpen, setUndatedOpen] = useState(p.memory.undated ?? data.undated.length > 0);
	p.memory.undated = undatedOpen;
	const [more, setMore] = useState<{ day: number; anchor: DOMRect } | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const previewRef = useRef<Preview | null>(null);
	previewRef.current = preview;
	const drag = useRef<Drag | null>(null);
	const justDragged = useRef(false);
	const rootRef = useRef<HTMLDivElement>(null);
	// A dropped entry stays where it was dropped until the note's new dates come back from the index.
	useEffect(() => {
		if (!drag.current) setPreview(null);
	}, [data]);

	// Swimlanes (Week only): one per group of the swimlane column.
	const laneCol = layout === "week" && cal.swimlanes ? (result.known.get(cal.swimlanes.by) ?? null) : null;
	const laneWritable = !!laneCol && isBucketColumn(laneCol) && !cal.swimlanes?.date;
	const lanes: Lane[] = useMemo(
		() => (layout === "week" && result.groups ? result.groups.map((g) => ({ key: g.key, label: g.label, paths: new Set(g.rows.map((r) => r.row.path)) })) : [{ key: null, label: "", paths: null }]),
		[result, layout],
	);

	// The entries as drawn: a dragged one at its new days (an undated note being dropped shows on its day).
	const entries = useMemo(() => {
		if (!preview) return data.entries;
		const out = data.entries.map((e) => (e.r.row.path === preview.path ? { ...e, start: preview.start, end: preview.end } : e));
		if (!data.entries.some((e) => e.r.row.path === preview.path)) {
			const r = data.undated.find((u) => u.row.path === preview.path);
			if (r) out.push({ r, start: preview.start, end: preview.end, dates: { start: "" }, hasEnd: false });
		}
		return out;
	}, [data, preview]);
	const laneEntries = (lane: Lane) => {
		if (!lane.paths) return entries;
		return entries.filter((e) => (preview?.path === e.r.row.path && preview.lane !== null ? preview.lane === lane.key : lane.paths!.has(e.r.row.path)));
	};

	// ---- dragging (pointer events, so a bar can be grabbed by its body or its ends)
	const dayAt = (x: number, y: number): { day: number; lane: string | null } | null => {
		const el = document.elementFromPoint(x, y);
		const week = el instanceof Element ? el.closest<HTMLElement>("[data-week]") : null;
		if (!week || !rootRef.current?.contains(week)) return null;
		const r = week.getBoundingClientRect();
		const col = Math.max(0, Math.min(6, Math.floor(((x - r.left) / r.width) * 7)));
		return { day: Number(week.dataset.week) + col, lane: week.dataset.lane ?? null };
	};
	const onPointerDown = (e: RPointerEvent<HTMLElement>, row: ResultRow, entry: CalEntry | null, mode: Drag["mode"]) => {
		if (e.button !== 0 || layout === "agenda") return;
		e.stopPropagation();
		drag.current = { path: row.row.path, entry, row, mode, grab: dayAt(e.clientX, e.clientY)?.day ?? null, x: e.clientX, y: e.clientY, active: false, pointer: e.pointerId };
	};
	const live = useRef({ laneCol, laneWritable, lanes, move: p.move });
	live.current = { laneCol, laneWritable, lanes, move: p.move };
	useEffect(() => {
		const stop = () => {
			drag.current = null;
			document.body.classList.remove("oe-calv-dragging");
		};
		const onMove = (e: PointerEvent) => {
			const d = drag.current;
			if (!d || e.pointerId !== d.pointer) return;
			if (!d.active) {
				if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 5) return;
				d.active = true;
				document.body.classList.add("oe-calv-dragging");
			}
			const at = dayAt(e.clientX, e.clientY);
			if (!at) return setPreview(null);
			const next = !d.entry ? { start: at.day, end: at.day } : d.mode === "move" ? movedBy(d.entry, at.day - (d.grab ?? d.entry.start)) : resizedTo(d.entry, d.mode, at.day);
			const lane = d.mode === "move" && live.current.laneWritable ? at.lane : null;
			setPreview((cur) => (cur && cur.path === d.path && cur.start === next.start && cur.end === next.end && cur.lane === lane ? cur : { path: d.path, ...next, lane }));
		};
		const onUp = (e: PointerEvent) => {
			const d = drag.current;
			if (!d || e.pointerId !== d.pointer) return;
			stop();
			if (!d.active) return;
			justDragged.current = true;
			window.setTimeout(() => (justDragged.current = false), 0);
			const pv = previewRef.current;
			if (!pv || pv.path !== d.path) return setPreview(null);
			const { laneCol: lc, lanes: ls, move } = live.current;
			const fromLane = ls.find((l) => l.paths?.has(d.path))?.key ?? null;
			const lane = lc && pv.lane !== null && pv.lane !== fromLane ? { col: lc, value: laneValue(lc, pv.lane) } : null;
			const same = d.entry && pv.start === d.entry.start && pv.end === d.entry.end;
			if (same && !lane) return setPreview(null);
			void move({ entry: d.entry, row: d.row, start: pv.start, end: pv.end, lane }).catch(() => setPreview(null));
			// In case the note doesn't change (e.g. its type can't take the swimlane's value).
			window.setTimeout(() => setPreview((cur) => (cur === pv ? null : cur)), 2000);
		};
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Escape" || !drag.current?.active) return;
			e.stopPropagation();
			stop();
			setPreview(null);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			window.removeEventListener("keydown", onKey, true);
			document.body.classList.remove("oe-calv-dragging");
		};
	}, []);

	// ---- an entry
	/** The colour of an entry's left edge: its status's (set colour, else by name) or its Colour by choice's. */
	const edgeOf = (r: ResultRow): string | undefined => {
		if (cal.colorBy === "none") return undefined;
		if (cal.colorBy) {
			if (!colorCol) return undefined;
			const f = colorCol.def.kind === "field" ? r.row.type.fields.find((x) => x.key === (colorCol.def as { key: string }).key) : undefined;
			const v = r.cells[colorCol.id]?.value;
			const c = f && typeof v === "string" ? choiceColor(f, v) : null;
			return c ? paletteEdge(c) : undefined;
		}
		const s = r.row.status;
		if (!s) return undefined;
		const c = statusColor(s, r.row.type, ctx.groups);
		return c ? paletteEdge(c) : TONE_EDGE[statusTone(s)];
	};
	const spanText = (e: CalEntry) => (e.end > e.start ? `${shortDate(e.start)} – ${shortDate(e.end)}` : "");
	const entryEl = (r: ResultRow, e: CalEntry | null, opts: { seg?: Segment; key?: string; style?: CSSProperties; list?: boolean } = {}) => {
		const path = r.row.path;
		const subtitle = cal.cardSubtitle && cardMode === "extended" ? (r.row.subtitle ?? plugin.index.get(path)?.subtitle) : null;
		const rowRule = r.hl?.[ROW_TARGET] !== undefined ? def.highlight[r.hl[ROW_TARGET]] : undefined;
		const nameRule = r.hl?.name !== undefined ? def.highlight[r.hl.name] : undefined;
		const titleHl = r.hl ? highlightOf(def, r, "name") : null;
		const edge = edgeOf(r);
		const s = opts.seg;
		const resizable = !!e?.dates.end && !!s && layout !== "agenda";
		const cls = [
			"oe-card",
			"oe-calv-entry",
			cardFields.length || subtitle ? "" : "is-compact",
			opts.list ? "is-list" : "",
			s?.before ? "is-cut-start" : "",
			s?.after ? "is-cut-end" : "",
			preview?.path === path ? "is-dragging" : "",
			edge ? "has-edge" : "",
			rowRule ? hlClasses({ ...rowRule.style, icon: undefined }) : "",
		]
			.filter(Boolean)
			.join(" ");
		return (
			<div
				key={opts.key ?? path}
				className={cls}
				data-entry={path}
				style={{ ...opts.style, ...(edge ? { "--oe-calv-edge": edge } : {}), "--oe-type-color": r.row.type.color } as CSSProperties}
				onPointerDown={(ev) => onPointerDown(ev, r, e, "move")}
				// Links inside (card fields) would start the browser's own drag, cancelling ours.
				onDragStart={(ev) => ev.preventDefault()}
				onClickCapture={(ev) => {
					if (!justDragged.current) return;
					ev.preventDefault();
					ev.stopPropagation();
				}}
				onClick={(ev) => {
					ev.stopPropagation();
					// A link among the card fields opens itself.
					if (ev.target instanceof Element && ev.target.closest(".oe-card-fields a, .oe-card-fields .oe-chip")) return;
					plugin.openPath(path, ev.nativeEvent);
				}}
				onAuxClick={(ev) => ev.button === 1 && plugin.openPath(path, "tab")}
				onDoubleClick={(ev) => ev.stopPropagation()}
				onMouseOver={(ev) => p.hover(ev, path)}
				onContextMenu={(ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					p.rowMenu({ x: ev.clientX, y: ev.clientY }, r, e);
				}}
			>
				{resizable && !s?.before && <span className="oe-calv-resize is-start" aria-hidden="true" onPointerDown={(ev) => onPointerDown(ev, r, e, "start")} />}
				<div className={`oe-card-title${nameRule ? ` ${hlClasses({ ...nameRule.style, icon: undefined, fill: undefined })}` : ""}`}>
					{titleHl?.style.icon && (
						<span className="oe-hl-icon" aria-label={titleHl.iconRule?.name}>
							<Icon name={titleHl.style.icon} />
						</span>
					)}
					<a className="oe-table-name oe-card-name" href="#" draggable={false} tabIndex={-1} onClick={(ev) => ev.preventDefault()}>
						<Icon name={r.row.type.icon} className="oe-chip-icon" />
						<span>{r.row.name}</span>
					</a>
					{opts.list && e && e.end > e.start && <span className="oe-calv-entry-span">{spanText(e)}</span>}
				</div>
				{subtitle && <div className="oe-card-subtitle">{subtitle}</div>}
				<CardFields def={def} r={r} fields={cardFields} labels={!!cal.cardLabels} />
				{resizable && !s?.after && <span className="oe-calv-resize is-end" aria-hidden="true" onPointerDown={(ev) => onPointerDown(ev, r, e, "end")} />}
			</div>
		);
	};

	// ---- a week row (Month and Week): the days underneath, entries as bars in lanes on top
	const month = partsOfDay(anchor).month;
	const weekRow = (days: number[], lane: Lane, kind: "month" | "week") => {
		const from = days[0];
		const segs = weekSegments(laneEntries(lane), from);
		const { lanes: shown, more: hidden } = kind === "month" ? weekOverflow(segs) : { lanes: Math.max(0, ...segs.map((s) => s.lane + 1)), more: days.map(() => 0) };
		const laneTarget = laneCol && lane.key !== null && laneWritable ? { col: laneCol, value: laneValue(laneCol, lane.key) } : null;
		const add = (d: number) => (
			<button
				className="clickable-icon oe-calv-add"
				aria-label={`New on ${shortDate(d, true)}`}
				onClick={(e) => {
					e.stopPropagation();
					p.newOn(d, laneTarget);
				}}
			>
				<Icon name="plus" />
			</button>
		);
		return (
			<div
				key={`${lane.key ?? ""}|${from}`}
				className={`oe-calv-week is-${kind}${preview?.lane !== null && preview?.lane === lane.key && lane.key !== null ? " is-drop-lane" : ""}`}
				data-week={from}
				data-lane={lane.key ?? undefined}
			>
				<div className="oe-calv-days">
					{days.map((d) => {
						const outside = kind === "month" && partsOfDay(d).month !== month;
						const wd = weekdayOf(d);
						return (
							<div
								key={d}
								className={`oe-calv-day${d === today ? " is-today" : ""}${outside ? " is-outside" : ""}${wd === 0 || wd === 6 ? " is-weekend" : ""}`}
								data-day={d}
								onDoubleClick={() => p.newOn(d, laneTarget)}
							>
								<div className="oe-calv-day-head">
									{kind === "month" && <span className="oe-calv-daynum">{partsOfDay(d).date === 1 ? shortDate(d) : partsOfDay(d).date}</span>}
									{add(d)}
								</div>
							</div>
						);
					})}
				</div>
				<div className="oe-calv-bars">
					{segs
						.filter((s) => s.lane < shown)
						.map((s) => entryEl(s.e.r, s.e, { seg: s, key: `${s.e.r.row.path}@${from}`, style: { gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 1 } }))}
					{hidden.map((n, i) =>
						n ? (
							<button
								key={`more${i}`}
								className="oe-calv-more"
								style={{ gridColumn: i + 1, gridRow: shown + 1 }}
								onClick={(e) => {
									e.stopPropagation();
									setMore({ day: days[i], anchor: e.currentTarget.getBoundingClientRect() });
								}}
							>
								+{n} more
							</button>
						) : null,
					)}
				</div>
			</div>
		);
	};

	const weekdayHeads = (days: number[], dates: boolean) => (
		<div className="oe-calv-weekdays">
			{days.map((d) => (
				<div key={d} className={`oe-calv-weekday${dates && d === today ? " is-today" : ""}`}>
					<span>{WEEKDAY_SHORT[weekdayOf(d)]}</span>
					{dates && <span className="oe-calv-weekday-date">{partsOfDay(d).date}</span>}
				</div>
			))}
		</div>
	);

	let body: ReactNode;
	if (p.noDates) {
		body = (
			<div className="oe-table-empty oe-calv-empty">
				{p.noDates}{" "}
				<button className="oe-pop-link" onClick={(e) => p.chooseDates(e.currentTarget)}>
					Choose date fields…
				</button>
			</div>
		);
	} else if (layout === "month") {
		const weeks = monthWeeks(anchor, weekStart);
		body = (
			<div className="oe-calv-grid is-month">
				{weekdayHeads(weeks[0], false)}
				<div className="oe-calv-weeks">{weeks.map((w) => weekRow(w, lanes[0], "month"))}</div>
			</div>
		);
	} else if (layout === "week") {
		const days = weekDays(anchor, weekStart);
		body = (
			<div className="oe-calv-grid is-week">
				{weekdayHeads(days, true)}
				<div className="oe-calv-weeks">
					{lanes.map((lane) => (
						<div key={lane.key ?? ""} className="oe-calv-lane">
							{lane.key !== null && (
								<div className="oe-calv-lane-head">
									<span className="oe-group-label">
										{def.groupFieldNames !== false && <span className="oe-group-field">{laneCol?.label ?? cal.swimlanes?.by}:</span>}{" "}
										{lane.label ? <GroupValue col={laneCol} text={lane.label} /> : <span className="oe-group-none">none</span>}
									</span>
									<span className="oe-group-count">{laneEntries(lane).filter((e) => e.start <= days[6] && e.end >= days[0]).length}</span>
								</div>
							)}
							{weekRow(days, lane, "week")}
						</div>
					))}
				</div>
			</div>
		);
	} else {
		const list = agendaDays(entries, anchor, today);
		body = (
			<div className="oe-calv-agenda">
				{list.length === 0 && <div className="oe-table-empty">Nothing in these 30 days.</div>}
				{list.map(({ day, entries: es }) => (
					<section key={day} className={`oe-calv-agenda-day${day === today ? " is-today" : ""}`} data-day={day} onDoubleClick={() => p.newOn(day, null)}>
						<div className="oe-calv-agenda-head">
							<span className="oe-calv-agenda-date">{longDate(day)}</span>
							{day === today && <span className="oe-calv-today-badge">Today</span>}
							<span className="oe-spacer" />
							<button className="clickable-icon oe-calv-add" aria-label={`New on ${shortDate(day, true)}`} onClick={() => p.newOn(day, null)}>
								<Icon name="plus" />
							</button>
						</div>
						{es.length === 0 ? <div className="oe-calv-agenda-none">Nothing planned</div> : <div className="oe-calv-agenda-cards">{es.map((e) => entryEl(e.r, e, { key: `${e.r.row.path}@${day}`, list: true }))}</div>}
					</section>
				))}
			</div>
		);
	}

	const setLayout = (l: CalendarLayout) => {
		const { layout: _, ...rest } = calendarOf(def);
		p.update({ ...def, calendar: l === "month" ? rest : { ...rest, layout: l } });
	};
	const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
		if (p.onCommonKey(e)) return;
		if (e.target !== e.currentTarget) return;
		if (e.key === "PageUp" || e.key === "PageDown") {
			e.preventDefault();
			p.setAnchor(shiftPeriod(layout, anchor, e.key === "PageUp" ? -1 : 1));
		} else if (e.key === "Home") {
			e.preventDefault();
			p.setAnchor(today);
		}
	};
	const span = layout === "agenda" ? "30 days" : layout;

	return (
		<div ref={rootRef} className={`oe-calv is-${layout} is-${cardMode}${preview ? " is-dragging" : ""}`} tabIndex={0} onKeyDown={onKey}>
			<div className="oe-calv-nav">
				<button className="clickable-icon" aria-label={`Previous ${span}`} onClick={() => p.setAnchor(shiftPeriod(layout, anchor, -1))}>
					<Icon name="chevron-left" />
				</button>
				<button className="oe-calv-today" onClick={() => p.setAnchor(today)}>
					Today
				</button>
				<button className="clickable-icon" aria-label={`Next ${span}`} onClick={() => p.setAnchor(shiftPeriod(layout, anchor, 1))}>
					<Icon name="chevron-right" />
				</button>
				<span className="oe-calv-title">{periodTitle(layout, anchor, weekStart)}</span>
				<span className="oe-spacer" />
				<div className="oe-layout-toggle oe-calv-layouts" role="group" aria-label="Calendar layout">
					{LAYOUTS.map((l) => (
						<button key={l.id} className={`oe-layout-btn${layout === l.id ? " is-active" : ""}`} aria-pressed={layout === l.id} onClick={() => setLayout(l.id)}>
							{l.label}
						</button>
					))}
				</div>
				<div className="oe-layout-toggle oe-calv-layouts oe-calv-cardmode" role="group" aria-label="Cards">
					{CARD_MODES.map((m) => (
						<button
							key={m.id}
							className={`oe-layout-btn${cardMode === m.id ? " is-active" : ""}`}
							aria-pressed={cardMode === m.id}
							title={m.hint}
							onClick={() => p.update({ ...def, calendar: withCardMode(calendarOf(def), layout, m.id) })}
						>
							{m.label}
						</button>
					))}
				</div>
				{!p.noDates && (
					<button className={`oe-view-tool oe-calv-undated-btn${undatedOpen ? " is-active" : ""}`} aria-pressed={undatedOpen} aria-label="No date" onClick={() => setUndatedOpen(!undatedOpen)}>
						<Icon name="calendar-x" />
						<span className="oe-view-tool-label">No date</span>
						{data.undated.length > 0 && <span className="oe-view-tool-count">{data.undated.length}</span>}
					</button>
				)}
			</div>
			<div className="oe-calv-body">
				<div className="oe-calv-main">{body}</div>
				{undatedOpen && !p.noDates && (
					<aside className="oe-calv-undated" aria-label="Notes without a date">
						<div className="oe-calv-undated-head">
							<span>No date</span>
							<span className="oe-group-count">{data.undated.length}</span>
							<span className="oe-spacer" />
							<button className="clickable-icon" aria-label="Hide the No date list" onClick={() => setUndatedOpen(false)}>
								<Icon name="x" />
							</button>
						</div>
						{data.undated.length === 0 ? (
							<div className="oe-calv-undated-none">Every note here has a date.</div>
						) : (
							<>
								<div className="oe-calv-undated-hint">{layout === "agenda" ? "Switch to Month or Week to drag these onto a day." : "Drag onto a day to give it that date."}</div>
								<div className="oe-calv-undated-list">{data.undated.map((r) => entryEl(r, null, { key: r.row.path, list: true }))}</div>
							</>
						)}
					</aside>
				)}
			</div>
			{more && (
				<Popover anchor={more.anchor} onClose={() => setMore(null)} className="oe-calv-day-pop" label={longDate(more.day)}>
					<div className="oe-pop-heading">{longDate(more.day)}</div>
					<div className="oe-calv-day-list">{entriesOn(entries, more.day).map((e) => entryEl(e.r, e, { key: e.r.row.path, list: true }))}</div>
				</Popover>
			)}
		</div>
	);
}

/** Toolbar → Dates: each source type's date field (and end date field), the week start and what colours entries. */
export function DatesPanel({
	def,
	types,
	colorChoices,
	onChange,
}: {
	def: ViewDef;
	types: { key: string; name: string; fields: { key: string; label: string }[]; current: { start: string; end?: string } | null }[];
	colorChoices: { id: string; label: string }[];
	onChange: (patch: Partial<ReturnType<typeof calendarOf>>) => void;
}) {
	const cal = calendarOf(def);
	const setDates = (type: string, v: { start: string; end?: string } | null) => onChange({ dates: { ...cal.dates, [type]: v } });
	return (
		<div className="oe-datespanel">
			<div className="oe-pop-heading">Dates</div>
			{types.map((t) => (
				<div key={t.key} className="oe-datespanel-type" data-type={t.key}>
					<span className="oe-datespanel-name">{t.name}</span>
					{t.fields.length === 0 ? (
						<span className="oe-datespanel-none">No date fields</span>
					) : (
						<>
							<select
								className="dropdown oe-pop-select"
								aria-label={`${t.name} date`}
								value={t.current?.start ?? ""}
								onChange={(e) => setDates(t.key, e.target.value ? { start: e.target.value, ...(t.current?.end && t.current.end !== e.target.value ? { end: t.current.end } : {}) } : null)}
							>
								<option value="">Not shown</option>
								{t.fields.map((f) => (
									<option key={f.key} value={f.key}>
										{f.label}
									</option>
								))}
							</select>
							{t.current && (
								<select
									className="dropdown oe-pop-select"
									aria-label={`${t.name} end date`}
									value={t.current.end ?? ""}
									onChange={(e) => setDates(t.key, { start: t.current!.start, ...(e.target.value ? { end: e.target.value } : {}) })}
								>
									<option value="">No end date</option>
									{t.fields
										.filter((f) => f.key !== t.current!.start)
										.map((f) => (
											<option key={f.key} value={f.key}>
												Until {f.label}
											</option>
										))}
								</select>
							)}
						</>
					)}
				</div>
			))}
			<div className="oe-pop-hint">With an end date, notes span the days from one to the other. Dragging an entry changes these fields.</div>
			<div className="oe-datespanel-row">
				<span className="oe-datespanel-name">Week starts on</span>
				<select className="dropdown oe-pop-select" aria-label="Week starts on" value={cal.weekStart ?? 1} onChange={(e) => onChange({ weekStart: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}>
					{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((n, i) => (
						<option key={n} value={i}>
							{n}
						</option>
					))}
				</select>
			</div>
			<div className="oe-datespanel-row">
				<span className="oe-datespanel-name">Colour by</span>
				<select className="dropdown oe-pop-select" aria-label="Colour by" value={cal.colorBy ?? ""} onChange={(e) => onChange({ colorBy: e.target.value || undefined })}>
					<option value="">Status</option>
					{colorChoices.map((c) => (
						<option key={c.id} value={c.id}>
							{c.label}
						</option>
					))}
					<option value="none">Nothing</option>
				</select>
			</div>
		</div>
	);
}
