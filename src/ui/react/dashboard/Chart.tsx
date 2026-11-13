import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PaletteColor } from "../../../model/colors";
import type { ChartBar, ChartKind, ChartOut, ChartPart, Drill } from "../../../model/dashboard";

/** Colours for groups without one of their own (donut slices, stacked parts), in order. */
const CYCLE: PaletteColor[] = ["blue", "green", "orange", "purple", "red", "yellow", "pink", "grey"];

/** The fill class for a colour: a palette colour, the n-th in the cycle, or the accent colour (null). */
const fillClass = (color: PaletteColor | null, i: number | null) => {
	const c = color ?? (i === null ? null : CYCLE[i % CYCLE.length]);
	return c ? `oe-chart-fill oe-c-${c}` : "oe-chart-fill";
};

/** A round step (1, 2, 2.5, 5 × 10ⁿ; whole numbers only for counts) and the top of a scale with about four steps. */
export function niceScale(v: number, whole: boolean): { top: number; step: number } {
	if (v <= 0) return { top: whole ? 1 : 1, step: whole ? 1 : 0.25 };
	const rough = v / 4;
	const p = 10 ** Math.floor(Math.log10(rough));
	let step = 10 * p;
	for (const m of whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]) {
		if (m * p >= rough) {
			step = m * p;
			break;
		}
	}
	if (whole) step = Math.max(1, Math.round(step));
	return { top: Math.ceil(v / step) * step, step };
}

/** A round number at or above the largest value. */
export const niceMax = (v: number) => niceScale(v, false).top;

function useSize() {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
		ro.observe(el);
		setSize({ w: el.clientWidth, h: el.clientHeight });
		return () => ro.disconnect();
	}, []);
	return { ref, ...size };
}

/** What clicking (or Enter on) a bar, slice or point does: open its notes. */
const act = (drill: Drill, open: (d: Drill) => void, n: number) => ({
	role: "button",
	tabIndex: 0,
	onClick: () => n > 0 && open(drill),
	onKeyDown: (e: KeyboardEvent) => {
		if ((e.key === "Enter" || e.key === " ") && n > 0) {
			e.preventDefault();
			open(drill);
		}
	},
});
/** Classes for something that opens its notes (faint and inert when it has none). */
const hit = (n: number) => (n > 0 ? " oe-chart-hit" : " oe-chart-hit is-empty");

const clip = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, Math.max(1, chars - 1))}…` : s);

export function Chart({ kind, title, out, open }: { kind: ChartKind; title: string; out: ChartOut; open: (d: Drill) => void }) {
	const { ref, w, h } = useSize();
	let body: ReactNode = null;
	if (!out.error && w > 0 && h > 0) {
		if (kind === "progress") body = <Progress out={out} open={open} />;
		else if (!out.bars.length) body = <div className="oe-dash-muted">No notes.</div>;
		else if (kind === "donut") body = <Donut out={out} w={w} h={h} open={open} />;
		else if (kind === "hbar") body = <HBars out={out} w={w} h={h} open={open} />;
		else if (kind === "line") body = <Line out={out} w={w} h={h} open={open} />;
		else body = <Bars out={out} w={w} h={h} open={open} stacked={kind === "stacked"} />;
	}
	return (
		<div className="oe-dash-chart-body">
			<div className="oe-dash-head">
				<span className="oe-dash-head-title">{title}</span>
				{!out.error && kind !== "progress" && <span className="oe-dash-head-count" title={out.measureLabel}>{out.totalText}</span>}
			</div>
			{kind === "stacked" && out.series.length > 0 && !out.error && (
				<div className="oe-chart-legend">
					{out.series.map((s, i) => (
						<span key={s.key} className="oe-chart-key">
							<svg width="10" height="10" aria-hidden="true">
								<rect width="10" height="10" rx="2" className={fillClass(s.color, i)} />
							</svg>
							{s.label}
						</span>
					))}
				</div>
			)}
			{out.error ? (
				<div className="oe-dash-problem">{out.error}</div>
			) : (
				<div className="oe-chart-area" ref={ref}>
					{body}
				</div>
			)}
		</div>
	);
}

const LEFT = 40;
const BOTTOM = 22;
const TOP = 16;

/** Gridlines and their labels for a value scale from 0 to `top` in `step`s, `height` tall from `top`. */
function Grid({ scale, top, height, left, width, fmt }: { scale: { top: number; step: number }; top: number; height: number; left: number; width: number; fmt: (n: number) => string }) {
	const ticks: number[] = [];
	for (let v = 0; v <= scale.top + scale.step / 2; v += scale.step) ticks.push(v);
	return (
		<g className="oe-chart-grid" aria-hidden="true">
			{ticks.map((v) => {
				const y = top + height - (v / scale.top) * height;
				return (
					<g key={v}>
						<line x1={left} x2={left + width} y1={y} y2={y} />
						<text x={left - 6} y={y} dy="0.32em" textAnchor="end">
							{fmt(v)}
						</text>
					</g>
				);
			})}
		</g>
	);
}

/** The scale for some bars: whole steps when every value is whole (counts). */
const scaleOf = (values: number[]) => niceScale(Math.max(0, ...values), values.every((v) => Number.isInteger(v)));

const short = (n: number) => (Math.abs(n) >= 1000 ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n) : String(Math.round(n * 100) / 100));

function Bars({ out, w, h, open, stacked }: { out: ChartOut; w: number; h: number; open: (d: Drill) => void; stacked: boolean }) {
	const scale = scaleOf(out.bars.map((b) => b.value));
	const max = scale.top;
	const plotW = Math.max(10, w - LEFT - 8);
	const plotH = Math.max(10, h - TOP - BOTTOM);
	const band = plotW / out.bars.length;
	const bw = Math.min(56, band * 0.7);
	const y = (v: number) => TOP + plotH - (v / max) * plotH;
	const labelChars = Math.max(3, Math.floor(band / 7));
	return (
		<svg width={w} height={h} role="img" aria-label={`${out.measureLabel} by group`}>
			<Grid scale={scale} top={TOP} height={plotH} left={LEFT} width={plotW} fmt={short} />
			{out.bars.map((b, i) => {
				const x = LEFT + i * band + (band - bw) / 2;
				let acc = 0;
				return (
					<g key={b.key}>
						{stacked && b.parts.length ? (
							b.parts.map((p, j) => {
								const y0 = y(acc);
								acc += p.value;
								const y1 = y(acc);
								return (
									<rect key={p.key} x={x} y={y1} width={bw} height={Math.max(0, y0 - y1)} className={fillClass(p.color, j) + hit(p.drill.paths.length)} {...act(p.drill, open, p.drill.paths.length)}>
										<title>{`${b.label} · ${p.label}: ${p.text}`}</title>
									</rect>
								);
							})
						) : (
							<rect x={x} y={y(b.value)} width={bw} height={Math.max(0, y(0) - y(b.value))} rx={2} className={fillClass(b.color, null) + hit(b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
								<title>{`${b.label}: ${b.text}`}</title>
							</rect>
						)}
						{band > 24 && (
							<text className="oe-chart-value" x={x + bw / 2} y={y(b.value) - 4} textAnchor="middle">
								{b.text}
							</text>
						)}
						<text className="oe-chart-label" x={LEFT + i * band + band / 2} y={h - 6} textAnchor="middle">
							{clip(b.label, labelChars)}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

function HBars({ out, w, h, open }: { out: ChartOut; w: number; h: number; open: (d: Drill) => void }) {
	const max = Math.max(...out.bars.map((b) => b.value), 0) || 1;
	const row = Math.max(20, Math.min(30, h / out.bars.length));
	const labelW = Math.min(150, Math.round(w * 0.35));
	const valueW = 56;
	const plotW = Math.max(10, w - labelW - valueW - 8);
	const height = Math.max(h, row * out.bars.length);
	return (
		<svg width={w} height={height} role="img" aria-label={`${out.measureLabel} by group`}>
			{out.bars.map((b, i) => {
				const y = i * row;
				const bh = row * 0.62;
				return (
					<g key={b.key}>
						<text className="oe-chart-label" x={labelW - 6} y={y + row / 2} dy="0.32em" textAnchor="end">
							{clip(b.label, Math.floor(labelW / 7))}
						</text>
						<rect x={labelW} y={y + (row - bh) / 2} width={Math.max(b.value > 0 ? 2 : 0, (b.value / max) * plotW)} height={bh} rx={2} className={fillClass(b.color, null) + hit(b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
							<title>{`${b.label}: ${b.text}`}</title>
						</rect>
						<text className="oe-chart-value" x={labelW + (b.value / max) * plotW + 6} y={y + row / 2} dy="0.32em">
							{b.text}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

function arc(cx: number, cy: number, r: number, r0: number, a0: number, a1: number): string {
	// A full circle can't be one arc: draw it as two halves.
	if (a1 - a0 >= Math.PI * 2 - 1e-6) return `${arc(cx, cy, r, r0, a0, a0 + Math.PI)} ${arc(cx, cy, r, r0, a0 + Math.PI, a1)}`;
	const p = (rad: number, a: number) => `${cx + rad * Math.sin(a)} ${cy - rad * Math.cos(a)}`;
	const large = a1 - a0 > Math.PI ? 1 : 0;
	return `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

function Donut({ out, w, h, open }: { out: ChartOut; w: number; h: number; open: (d: Drill) => void }) {
	const side = w > h * 1.5;
	const size = Math.max(40, Math.min(side ? h - 12 : w - 24, side ? w * 0.55 : h - 12 - 20 * Math.ceil(out.bars.length / 2)));
	const r = size / 2 - 4;
	const r0 = r * 0.6;
	const sum = out.bars.reduce((n, b) => n + Math.max(0, b.value), 0) || 1;
	let a = 0;
	return (
		<div className={`oe-chart-donut${side ? " is-side" : ""}`}>
			<svg width={size} height={size} role="img" aria-label={`${out.measureLabel} by group`}>
				{out.bars.map((b, i) => {
					const a0 = a;
					a += (Math.max(0, b.value) / sum) * Math.PI * 2;
					if (b.value <= 0) return null;
					return (
						<path key={b.key} d={arc(size / 2, size / 2, r, r0, a0, a)} className={fillClass(b.color, i) + hit(b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
							<title>{`${b.label}: ${b.text} (${Math.round((b.value / sum) * 100)}%)`}</title>
						</path>
					);
				})}
				<text className="oe-chart-total" x={size / 2} y={size / 2} dy="0.35em" textAnchor="middle">
					{out.totalText}
				</text>
			</svg>
			<div className="oe-chart-legend is-list">
				{out.bars.map((b, i) => (
					<span key={b.key} className={"oe-chart-key" + hit(b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
						<svg width="10" height="10" aria-hidden="true">
							<rect width="10" height="10" rx="2" className={fillClass(b.color, i)} />
						</svg>
						<span className="oe-chart-key-label">{b.label}</span>
						<span className="oe-chart-key-value">{b.text}</span>
					</span>
				))}
			</div>
		</div>
	);
}

function Line({ out, w, h, open }: { out: ChartOut; w: number; h: number; open: (d: Drill) => void }) {
	const scale = scaleOf(out.bars.map((b) => b.value));
	const max = scale.top;
	const plotW = Math.max(10, w - LEFT - 16);
	const plotH = Math.max(10, h - TOP - BOTTOM);
	const n = out.bars.length;
	const x = (i: number) => LEFT + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
	const y = (v: number) => TOP + plotH - (v / max) * plotH;
	const pts = out.bars.map((b, i) => `${x(i)},${y(b.value)}`).join(" ");
	const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
	return (
		<svg width={w} height={h} role="img" aria-label={`${out.measureLabel} over time`}>
			<Grid scale={scale} top={TOP} height={plotH} left={LEFT} width={plotW} fmt={short} />
			<polygon className="oe-chart-area-fill" points={`${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`} />
			<polyline className="oe-chart-line" points={pts} />
			{out.bars.map((b: ChartBar | ChartPart, i) => (
				<g key={b.key}>
					<circle cx={x(i)} cy={y(b.value)} r={n > 40 ? 2 : 3.5} className={"oe-chart-point" + hit(b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
						<title>{`${b.label}: ${b.text}`}</title>
					</circle>
					{i % every === 0 && (
						<text className="oe-chart-label" x={x(i)} y={h - 6} textAnchor={n > 1 && i === n - 1 ? "end" : n > 1 && i === 0 ? "start" : "middle"}>
							{b.label}
						</text>
					)}
				</g>
			))}
		</svg>
	);
}

function Progress({ out, open }: { out: ChartOut; open: (d: Drill) => void }) {
	const p = out.progress;
	if (!p) return null;
	const pct = Math.round(p.share * 100);
	return (
		<div className={"oe-chart-progress" + hit(p.drill.paths.length)} {...act(p.drill, open, p.drill.paths.length)} title={`${p.doneText} of ${out.totalText} (${out.measureLabel})`}>
			<div className="oe-chart-progress-pct">{pct}%</div>
			<div className="oe-chart-progress-track">
				<div className="oe-chart-progress-done" style={{ width: `${Math.min(100, Math.max(0, p.share * 100))}%` }} />
			</div>
			<div className="oe-chart-progress-text">
				{p.doneText} of {out.totalText}
			</div>
		</div>
	);
}
