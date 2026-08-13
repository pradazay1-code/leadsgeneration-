"use client";

// Interactive price chart: range tabs, close line + 50/200-day moving
// averages (direct-labeled), volume bars, and a crosshair tooltip.
// Palette (validated for the dark surface): price #388bfd, 50d #bb8009,
// 200d #a371f7. Identity is never color-alone — lines carry direct labels
// and the tooltip names every series.

import { useMemo, useRef, useState } from "react";

export interface ChartPoint {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const RANGES: { label: string; days: number }[] = [
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "6M", days: 126 },
  { label: "1Y", days: 252 },
  { label: "2Y", days: 504 },
];

const W = 860;
const PRICE_H = 300;
const VOL_H = 70;
const PAD_R = 56;
const PAD_L = 8;
const GAP = 14;
const H = PRICE_H + GAP + VOL_H;

function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

const fmtMoney = (v: number) =>
  v >= 1000 ? `$${v.toFixed(0)}` : v >= 100 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`;
const fmtVol = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`;
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function StockChart({ data, symbol }: { data: ChartPoint[]; symbol: string }) {
  const [rangeIdx, setRangeIdx] = useState(3); // default 1Y
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { window: win, sma50Win, sma200Win } = useMemo(() => {
    const closes = data.map((d) => d.c);
    const s50 = smaSeries(closes, 50);
    const s200 = smaSeries(closes, 200);
    const days = Math.min(RANGES[rangeIdx].days, data.length);
    const start = data.length - days;
    return {
      window: data.slice(start),
      sma50Win: s50.slice(start),
      sma200Win: s200.slice(start),
    };
  }, [data, rangeIdx]);

  if (win.length < 2) return <div className="notice">Not enough chart data.</div>;

  const overlayVals = [...sma50Win, ...sma200Win].filter((v): v is number => v !== null);
  const lows = win.map((d) => d.l);
  const highs = win.map((d) => d.h);
  const min = Math.min(...lows, ...overlayVals);
  const max = Math.max(...highs, ...overlayVals);
  const span = max - min || 1;
  const maxVol = Math.max(...win.map((d) => d.v)) || 1;
  const plotW = W - PAD_L - PAD_R;

  const x = (i: number) => PAD_L + (i / (win.length - 1)) * plotW;
  const y = (v: number) => 6 + (1 - (v - min) / span) * (PRICE_H - 12);
  const yVol = (v: number) => PRICE_H + GAP + (1 - v / maxVol) * VOL_H;

  const linePath = (vals: (number | null)[]) => {
    let path = "";
    vals.forEach((v, i) => {
      if (v === null) return;
      path += `${path === "" ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return path;
  };

  const pricePath = linePath(win.map((d) => d.c));
  const areaPath = `${pricePath}L${x(win.length - 1).toFixed(1)},${PRICE_H}L${x(0).toFixed(1)},${PRICE_H}Z`;

  // Y-axis ticks (4 levels) and sparse date ticks.
  const yTicks = [0, 1, 2, 3].map((i) => min + (span * i) / 3);
  const tickEvery = Math.max(1, Math.floor(win.length / 5));
  const xTicks = win.map((d, i) => ({ i, t: d.t })).filter(({ i }) => i % tickEvery === 0 && i < win.length - 2);

  const periodReturn = ((win[win.length - 1].c - win[0].c) / win[0].c) * 100;

  function locate(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    const i = Math.round(frac * (win.length - 1));
    setHover(Math.max(0, Math.min(win.length - 1, i)));
  }

  const h = hover !== null ? win[hover] : null;
  const label50 = sma50Win[sma50Win.length - 1];
  const label200 = sma200Win[sma200Win.length - 1];

  return (
    <div className="chart-wrap">
      <div className="chart-bar">
        <div className="range-tabs" role="tablist" aria-label="Chart range">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              role="tab"
              aria-selected={i === rangeIdx}
              className={`range-tab${i === rangeIdx ? " active" : ""}`}
              onClick={() => {
                setRangeIdx(i);
                setHover(null);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className={`period-return ${periodReturn >= 0 ? "up" : "down"}`}>
          {periodReturn >= 0 ? "+" : ""}
          {periodReturn.toFixed(1)}% over {RANGES[rangeIdx].label}
        </div>
      </div>

      <div className="chart-legend">
        <span className="lg"><i style={{ background: "#388bfd" }} /> Close</span>
        <span className="lg"><i style={{ background: "#bb8009" }} /> 50-day avg</span>
        <span className="lg"><i style={{ background: "#a371f7" }} /> 200-day avg</span>
      </div>

      <div className="chart-svg-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H + 22}`}
          className="stock-chart"
          role="img"
          aria-label={`${symbol} price chart, ${RANGES[rangeIdx].label} range`}
          onMouseMove={(e) => locate(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchMove={(e) => locate(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          <defs>
            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#388bfd" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#388bfd" stopOpacity="0" />
            </linearGradient>
          </defs>

          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="gridline" />
              <text x={W - PAD_R + 6} y={y(v) + 4} className="axis-label">
                {fmtMoney(v)}
              </text>
            </g>
          ))}
          {xTicks.map(({ i, t }) => (
            <text key={t} x={x(i)} y={H + 14} className="axis-label mid">
              {new Date(t).toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
            </text>
          ))}

          <path d={areaPath} fill="url(#areaFill)" />
          <path d={linePath(sma200Win)} fill="none" stroke="#a371f7" strokeWidth="2" />
          <path d={linePath(sma50Win)} fill="none" stroke="#bb8009" strokeWidth="2" />
          <path d={pricePath} fill="none" stroke="#388bfd" strokeWidth="2" strokeLinejoin="round" />

          {label50 !== null && label50 >= min && label50 <= max && (
            <text x={W - PAD_R + 6} y={y(label50) + 4} className="line-label" fill="#bb8009">
              50d
            </text>
          )}
          {label200 !== null && label200 >= min && label200 <= max && (
            <text x={W - PAD_R + 6} y={y(label200) + 4} className="line-label" fill="#a371f7">
              200d
            </text>
          )}

          {win.map((d, i) => (
            <rect
              key={d.t}
              x={x(i) - Math.max(0.5, (plotW / win.length) * 0.35)}
              width={Math.max(1, (plotW / win.length) * 0.7)}
              y={yVol(d.v)}
              height={PRICE_H + GAP + VOL_H - yVol(d.v)}
              className={d.c >= d.o ? "vol-bar up" : "vol-bar down"}
            />
          ))}

          {h && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="crosshair" />
              <circle cx={x(hover)} cy={y(h.c)} r="4.5" fill="#388bfd" stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}
        </svg>

        {h && hover !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > win.length / 2 ? "translateX(-105%)" : "translateX(8px)" }}
          >
            <div className="tt-date">{fmtDate(h.t)}</div>
            <div>Close <b>{fmtMoney(h.c)}</b></div>
            <div>Open {fmtMoney(h.o)} · High {fmtMoney(h.h)} · Low {fmtMoney(h.l)}</div>
            <div>Volume {fmtVol(h.v)}</div>
            {sma50Win[hover] !== null && <div>50-day {fmtMoney(sma50Win[hover]!)}</div>}
            {sma200Win[hover] !== null && <div>200-day {fmtMoney(sma200Win[hover]!)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
