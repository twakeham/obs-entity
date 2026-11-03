import { moment, Scope } from "obsidian";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent } from "react";
import { createPortal } from "react-dom";
import { monthGrid, parseIso, shiftMonth, todayIso, weekdayOrder } from "../../model/calendar";
import { PluginContext } from "./context";
import { Icon } from "./Icon";

type LocaleData = { firstDayOfWeek(): number; months(): string[]; monthsShort(): string[]; weekdaysMin(): string[] };
const localeData = () => (moment as unknown as { localeData(): LocaleData }).localeData();

/**
 * A calendar under a date field. It never takes focus, so typing in the field carries on while it's open; it follows the
 * typed date. It works in ISO days (YYYY-MM-DD): the field converts to and from its own text.
 */
export function CalendarPopover({
	anchor,
	value,
	onPick,
	onClear,
	onClose,
}: {
	/** the field it opens under */
	anchor: HTMLElement;
	/** the date in the field (YYYY-MM-DD), or null when it's empty or not a date yet */
	value: string | null;
	onPick: (iso: string) => void;
	onClear?: () => void;
	/** Esc: close just the calendar */
	onClose: () => void;
}) {
	// Obsidian's keymap sees Esc before React does (a modal would close), so the calendar takes Esc while it's open.
	const app = useContext(PluginContext)?.app;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	useEffect(() => {
		if (!app) return;
		const scope = new Scope(app.scope);
		scope.register([], "Escape", () => {
			closeRef.current();
			return false;
		});
		app.keymap.pushScope(scope);
		return () => app.keymap.popScope(scope);
	}, [app]);
	const today = todayIso();
	const t = parseIso(today)!;
	const sel = parseIso(value);
	const [view, setView] = useState(() => (sel ? { year: sel.year, month: sel.month } : { year: t.year, month: t.month }));
	const [mode, setMode] = useState<"days" | "months">("days");
	// Follow the date being typed.
	useEffect(() => {
		const p = parseIso(value);
		if (p) setView({ year: p.year, month: p.month });
	}, [value]);

	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	useLayoutEffect(() => {
		const place = () => {
			const el = ref.current;
			if (!el) return;
			const b = anchor.getBoundingClientRect();
			const win = anchor.ownerDocument.defaultView ?? window;
			const m = 8;
			const w = el.offsetWidth;
			const h = el.offsetHeight;
			const left = Math.max(m, Math.min(b.left, win.innerWidth - w - m));
			let top = b.bottom + 4;
			if (top + h > win.innerHeight - m) top = b.top - 4 - h >= m ? b.top - 4 - h : Math.max(m, win.innerHeight - h - m);
			setPos((cur) => (cur && cur.left === left && cur.top === top ? cur : { left, top }));
		};
		place();
		const win = anchor.ownerDocument.defaultView ?? window;
		win.addEventListener("resize", place);
		win.document.addEventListener("scroll", place, true);
		return () => {
			win.removeEventListener("resize", place);
			win.document.removeEventListener("scroll", place, true);
		};
	}, [anchor, mode]);

	const loc = localeData();
	const firstDay = loc.firstDayOfWeek();
	const months = loc.months();
	const weekdays = loc.weekdaysMin();
	// Keep focus in the field: clicks in the calendar don't take it.
	const hold = (e: RMouseEvent) => e.preventDefault();
	const step = (delta: number) => setView((v) => shiftMonth(v.year, v.month, mode === "days" ? delta : delta * 12));

	return createPortal(
		<div ref={ref} className="oe-cal" role="dialog" aria-label="Calendar" onMouseDown={hold} style={pos ? { left: pos.left, top: pos.top } : { left: -10000, top: 0 }}>
			<div className="oe-cal-head">
				<button type="button" className="clickable-icon" tabIndex={-1} aria-label={mode === "days" ? "Previous month" : "Previous year"} onClick={() => step(-1)}>
					<Icon name="chevron-left" />
				</button>
				<button type="button" className="oe-cal-title" tabIndex={-1} aria-label={mode === "days" ? "Choose month and year" : "Back to days"} onClick={() => setMode(mode === "days" ? "months" : "days")}>
					{mode === "days" ? `${months[view.month - 1]} ${view.year}` : view.year}
				</button>
				<button type="button" className="clickable-icon" tabIndex={-1} aria-label={mode === "days" ? "Next month" : "Next year"} onClick={() => step(1)}>
					<Icon name="chevron-right" />
				</button>
			</div>
			{mode === "days" ? (
				<div className="oe-cal-grid" role="grid">
					{weekdayOrder(firstDay).map((d) => (
						<span key={`w${d}`} className="oe-cal-weekday" role="columnheader">
							{weekdays[d]}
						</span>
					))}
					{monthGrid(view.year, view.month, firstDay).map((d) => (
						<button
							key={d.iso}
							type="button"
							tabIndex={-1}
							data-iso={d.iso}
							className={`oe-cal-day${d.inMonth ? "" : " is-out"}${d.iso === today ? " is-today" : ""}${d.iso === value ? " is-selected" : ""}`}
							aria-label={d.iso}
							aria-pressed={d.iso === value}
							onClick={() => onPick(d.iso)}
						>
							{d.day}
						</button>
					))}
				</div>
			) : (
				<div className="oe-cal-months">
					{loc.monthsShort().map((name, i) => (
						<button
							key={name}
							type="button"
							tabIndex={-1}
							className={`oe-cal-month${view.month === i + 1 ? " is-selected" : ""}`}
							onClick={() => {
								setView({ year: view.year, month: i + 1 });
								setMode("days");
							}}
						>
							{name}
						</button>
					))}
				</div>
			)}
			<div className="oe-cal-foot">
				<button type="button" tabIndex={-1} onClick={() => onPick(today)}>
					Today
				</button>
				{onClear && (
					<button type="button" tabIndex={-1} onClick={onClear}>
						Clear
					</button>
				)}
			</div>
		</div>,
		anchor.ownerDocument.body,
	);
}
