import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../Icon";
import type { PaletteColor } from "../../../model/colors";
import type { ChartBar, ChartKind, ChartOut, ChartPart, Drill, chartLook } from "../../../model/dashboard";

type Look = ReturnType<typeof chartLook>;

/** Colours for groups without one of their own (donut slices, stacked parts), in order. */
const CYCLE: PaletteColor[] = ["blue", "green", "orange", "purple", "red", "yellow", "pink", "grey"];

/** The fill class for a colour: a palette colour, the n-th in the cycle, or the accent colour (null). */
const fillClass = (color: PaletteColor | null, i: number | null) => {
	const c = color ?? (i === null ? null : CYCLE[i % CYCLE.length]);
	return c ? `oe-chart-fill oe-c-${c}` : "oe-chart-fill";
};

/**
 * How the i-th of n bars, slices or parts is filled, by the chart's colouring: the field's colours (`own`, else the
 * cycle when `cycle`, else the accent colour), one colour, a palette colour each, or shades of one colour (fading).
 */
function paint(look: Look, own: PaletteColor | null, i: number, n: number, cycle: boolean): { className: string; style?: CSSProperties } {
	const c = look.colors === "field" ? (own ?? (cycle ? CYCLE[i % CYCLE.length] : null)) : look.colors === "palette" ? CYCLE[i % CYCLE.length] : (look.color ?? null);
	return { className: fillClass(c, null), ...(look.colors === "shades" && n > 1 ? { style: { fillOpacity: 1 - (i / (n - 1)) * 0.7 } } : {}) };
}

const BAR_SHARE = { thin: 0.4, normal: 0.7, wide: 0.9 };
const BAR_MAX = { thin: 28, normal: 56, wide: 84 };
const HOLE = { pie: 0, thick: 0.45, normal: 0.6, thin: 0.78 };

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

export function Chart({ kind, title, icon, look, out, open }: { kind: ChartKind; title: string; icon?: string; look: Look; out: ChartOut; open: (d: Drill) => void }) {
	const { ref, w, h } = useSize();
	let body: ReactNode = null;
	if (!out.error && w > 0 && h > 0) {
		if (kind === "progress") body = <Progress out={out} look={look} open={open} />;
		else if (!out.bars.length) body = <div className="oe-dash-muted">No notes.</div>;
		else if (kind === "donut") body = <Donut out={out} look={look} w={w} h={h} open={open} />;
		else if (kind === "hbar") body = <HBars out={out} look={look} w={w} h={h} open={open} />;
		else if (kind === "line") body = <Line out={out} look={look} w={w} h={h} open={open} />;
		else body = <Bars out={out} look={look} w={w} h={h} open={open} stacked={kind === "stacked"} />;
	}
	// A line or progress bar is drawn in one colour.
	const tone = (kind === "line" || kind === "progress") && look.color ? ` oe-c-${look.color}` : "";
	return (
		<div className={`oe-dash-chart-body${tone}`}>
			<div className="oe-dash-head">
				{icon && <Icon name={icon} className="oe-hl-icon" />}
				<span className="oe-dash-head-title">{title}</span>
				{!out.error && kind !== "progress" && <span className="oe-dash-head-count" title={out.measureLabel}>{out.totalText}</span>}
			</div>
			{kind === "stacked" && look.legend && out.series.length > 0 && !out.error && (
				<div className="oe-chart-legend">
					{out.series.map((s, i) => (
						<span key={s.key} className="oe-chart-key">
							<svg width="10" height="10" aria-hidden="true">
								<rect width="10" height="10" rx="2" {...paint(look, s.color, i, out.series.length, true)} />
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

function Bars({ out, look, w, h, open, stacked }: { out: ChartOut; look: Look; w: number; h: number; open: (d: Drill) => void; stacked: boolean }) {
	const scale = scaleOf(out.bars.map((b) => b.value));
	const max = scale.top;
	const left = look.grid ? LEFT : 8;
	const plotW = Math.max(10, w - left - 8);
	const plotH = Math.max(10, h - TOP - BOTTOM);
	const band = plotW / out.bars.length;
	const bw = Math.min(BAR_MAX[look.thickness], band * BAR_SHARE[look.thickness]);
	const rx = look.rounded ? Math.min(6, bw / 3) : 2;
	const y = (v: number) => TOP + plotH - (v / max) * plotH;
	const labelChars = Math.max(3, Math.floor(band / 7));
	return (
		<svg width={w} height={h} role="img" aria-label={`${out.measureLabel} by group`}>
			{look.grid && <Grid scale={scale} top={TOP} height={plotH} left={left} width={plotW} fmt={short} />}
			{out.bars.map((b, i) => {
				const x = left + i * band + (band - bw) / 2;
				let acc = 0;
				return (
					<g key={b.key}>
						{stacked && b.parts.length ? (
							b.parts.map((p, j) => {
								const y0 = y(acc);
								acc += p.value;
								const y1 = y(acc);
								const f = paint(look, p.color, j, b.parts.length, true);
								return (
									<rect key={p.key} x={x} y={y1} width={bw} height={Math.max(0, y0 - y1)} rx={look.rounded ? 2 : 0} className={f.className + hit(p.drill.paths.length)} style={f.style} {...act(p.drill, open, p.drill.paths.length)}>
										<title>{`${b.label} · ${p.label}: ${p.text}`}</title>
									</rect>
								);
							})
						) : (
							<rect x={x} y={y(b.value)} width={bw} height={Math.max(0, y(0) - y(b.value))} rx={rx} {...withHit(paint(look, b.color, i, out.bars.length, false), b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
								<title>{`${b.label}: ${b.text}`}</title>
							</rect>
						)}
						{look.values && band > 24 && (
							<text className="oe-chart-value" x={x + bw / 2} y={y(b.value) - 4} textAnchor="middle">
								{b.text}
							</text>
						)}
						<text className="oe-chart-label" x={left + i * band + band / 2} y={h - 6} textAnchor="middle">
							{clip(b.label, labelChars)}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

/** A painted shape's class and style, marked as opening its notes. */
const withHit = (f: { className: string; style?: CSSProperties }, n: number) => ({ className: f.className + hit(n), style: f.style });

function HBars({ out, look, w, h, open }: { out: ChartOut; look: Look; w: number; h: number; open: (d: Drill) => void }) {
	const max = Math.max(...out.bars.map((b) => b.value), 0) || 1;
	const row = Math.max(20, Math.min(30, h / out.bars.length));
	const labelW = Math.min(150, Math.round(w * 0.35));
	const valueW = look.values ? 56 : 8;
	const plotW = Math.max(10, w - labelW - valueW - 8);
	const height = Math.max(h, row * out.bars.length);
	const bh = Math.min(row * { thin: 0.4, normal: 0.62, wide: 0.85 }[look.thickness], BAR_MAX[look.thickness]);
	const rx = look.rounded ? Math.min(6, bh / 3) : 2;
	return (
		<svg width={w} height={height} role="img" aria-label={`${out.measureLabel} by group`}>
			{out.bars.map((b, i) => {
				const y = i * row;
				return (
					<g key={b.key}>
						<text className="oe-chart-label" x={labelW - 6} y={y + row / 2} dy="0.32em" textAnchor="end">
							{clip(b.label, Math.floor(labelW / 7))}
						</text>
						<rect x={labelW} y={y + (row - bh) / 2} width={Math.max(b.value > 0 ? 2 : 0, (b.value / max) * plotW)} height={bh} rx={rx} {...withHit(paint(look, b.color, i, out.bars.length, false), b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
							<title>{`${b.label}: ${b.text}`}</title>
						</rect>
						{look.values && (
							<text className="oe-chart-value" x={labelW + (b.value / max) * plotW + 6} y={y + row / 2} dy="0.32em">
								{b.text}
							</text>
						)}
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

function Donut({ out, look, w, h, open }: { out: ChartOut; look: Look; w: number; h: number; open: (d: Drill) => void }) {
	const legend = look.legend;
	const side = legend && (look.legendAt ? look.legendAt === "right" : w > h * 1.5);
	const size = Math.max(40, !legend ? Math.min(w, h) - 12 : Math.min(side ? h - 12 : w - 24, side ? w * 0.55 : h - 12 - 20 * Math.ceil(out.bars.length / 2)));
	const r = size / 2 - 4;
	const r0 = r * HOLE[look.hole];
	const sum = out.bars.reduce((n, b) => n + Math.max(0, b.value), 0) || 1;
	const n = out.bars.length;
	let a = 0;
	return (
		<div className={`oe-chart-donut${side ? " is-side" : ""}${legend ? "" : " is-alone"}`}>
			<svg width={size} height={size} role="img" aria-label={`${out.measureLabel} by group`}>
				{out.bars.map((b, i) => {
					const a0 = a;
					a += (Math.max(0, b.value) / sum) * Math.PI * 2;
					if (b.value <= 0) return null;
					return (
						<path key={b.key} d={arc(size / 2, size / 2, r, r0, a0, a)} {...withHit(paint(look, b.color, i, n, true), b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
							<title>{`${b.label}: ${b.text} (${Math.round((b.value / sum) * 100)}%)`}</title>
						</path>
					);
				})}
				{look.total && look.hole !== "pie" && (
					<text className="oe-chart-total" x={size / 2} y={size / 2} dy="0.35em" textAnchor="middle">
						{out.totalText}
					</text>
				)}
			</svg>
			{legend && (
				<div className="oe-chart-legend is-list">
					{out.bars.map((b, i) => (
						<span key={b.key} className={"oe-chart-key" + hit(b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
							<svg width="10" height="10" aria-hidden="true">
								<rect width="10" height="10" rx="2" {...paint(look, b.color, i, n, true)} />
							</svg>
							<span className="oe-chart-key-label">{b.label}</span>
							{look.values && <span className="oe-chart-key-value">{b.text}</span>}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * A path through points: straight lines, or (`smooth`) a monotone cubic curve (Fritsch–Carlson), which never
 * overshoots the points, so it doesn't dip below zero or above a peak.
 */
function linePath(pts: [number, number][], smooth: boolean): string {
	if (!pts.length) return "";
	if (!smooth || pts.length < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
	const n = pts.length;
	const d = pts.slice(0, -1).map(([x, y], i) => (pts[i + 1][1] - y) / (pts[i + 1][0] - x || 1));
	const m = pts.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
	for (let i = 0; i < n - 1; i++) {
		if (d[i] === 0) {
			m[i] = m[i + 1] = 0;
			continue;
		}
		const a = m[i] / d[i];
		const b = m[i + 1] / d[i];
		const s = a * a + b * b;
		if (s > 9) {
			const t = 3 / Math.sqrt(s);
			m[i] = t * a * d[i];
			m[i + 1] = t * b * d[i];
		}
	}
	let path = `M ${pts[0][0]} ${pts[0][1]}`;
	for (let i = 0; i < n - 1; i++) {
		const [x0, y0] = pts[i];
		const [x1, y1] = pts[i + 1];
		const h = (x1 - x0) / 3;
		path += ` C ${x0 + h} ${y0 + m[i] * h} ${x1 - h} ${y1 - m[i + 1] * h} ${x1} ${y1}`;
	}
	return path;
}

function Line({ out, look, w, h, open }: { out: ChartOut; look: Look; w: number; h: number; open: (d: Drill) => void }) {
	const scale = scaleOf(out.bars.map((b) => b.value));
	const max = scale.top;
	const left = look.grid ? LEFT : 12;
	const plotW = Math.max(10, w - left - 16);
	const plotH = Math.max(10, h - TOP - BOTTOM);
	const n = out.bars.length;
	const x = (i: number) => left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
	const y = (v: number) => TOP + plotH - (v / max) * plotH;
	const pts = out.bars.map((b, i): [number, number] => [x(i), y(b.value)]);
	const line = linePath(pts, look.smooth);
	const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
	// Values above the points, thinned out like the labels when they'd crowd.
	const valueEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 36))));
	return (
		<svg width={w} height={h} role="img" aria-label={`${out.measureLabel} over time`}>
			{look.grid && <Grid scale={scale} top={TOP} height={plotH} left={left} width={plotW} fmt={short} />}
			{look.area && <path className="oe-chart-area-fill" d={`${line} L ${x(n - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`} />}
			<path className="oe-chart-line" d={line} />
			{out.bars.map((b: ChartBar | ChartPart, i) => (
				<g key={b.key}>
					<circle cx={x(i)} cy={y(b.value)} r={look.dots ? (n > 40 ? 2 : 3.5) : 6} className={"oe-chart-point" + (look.dots ? "" : " is-hidden") + hit(b.drill.paths.length)} {...act(b.drill, open, b.drill.paths.length)}>
						<title>{`${b.label}: ${b.text}`}</title>
					</circle>
					{look.values && i % valueEvery === 0 && (
						<text className="oe-chart-value" x={x(i)} y={y(b.value) - 8} textAnchor="middle">
							{b.text}
						</text>
					)}
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

function Progress({ out, look, open }: { out: ChartOut; look: Look; open: (d: Drill) => void }) {
	const p = out.progress;
	if (!p) return null;
	const pct = Math.round(p.share * 100);
	return (
		<div className={`oe-chart-progress is-${look.thickness}` + hit(p.drill.paths.length)} {...act(p.drill, open, p.drill.paths.length)} title={`${p.doneText} of ${out.totalText} (${out.measureLabel})`}>
			{look.show !== "count" && <div className="oe-chart-progress-pct">{pct}%</div>}
			<div className="oe-chart-progress-track">
				<div className="oe-chart-progress-done" style={{ width: `${Math.min(100, Math.max(0, p.share * 100))}%` }} />
			</div>
			{look.show !== "percent" && (
				<div className="oe-chart-progress-text">
					{p.doneText} of {out.totalText}
				</div>
			)}
		</div>
	);
}
