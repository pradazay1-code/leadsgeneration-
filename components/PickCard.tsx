import Link from "next/link";
import type { Pick } from "@/lib/scoring";

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 300;
  const h = 44;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = values[values.length - 1] >= values[0];
  const color = rising ? "var(--up)" : "var(--down)";
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function PickCard({ pick }: { pick: Pick }) {
  const scoreClass = pick.score >= 75 ? "score-hi" : pick.score >= 55 ? "score-mid" : "score-lo";
  const chgClass = pick.changePercent >= 0 ? "up" : "down";
  const chgSign = pick.changePercent >= 0 ? "+" : "";
  return (
    <Link href={`/stock/${encodeURIComponent(pick.symbol)}`} className="card-link">
    <article className="card">
      <div className="card-top">
        <div>
          <div className="ticker">{pick.symbol}</div>
          <div className="company">{pick.name}</div>
          <div className="price-line">
            <span className="price">${pick.price.toFixed(2)}</span>
            <span className={`chg ${chgClass}`}>
              {chgSign}
              {pick.changePercent.toFixed(2)}% today
            </span>
          </div>
        </div>
        <div className={`score-badge ${scoreClass}`}>
          <span className="num">{pick.score}</span>
          <span className="lbl">score</span>
        </div>
      </div>

      <Sparkline values={pick.spark} label={`${pick.symbol} recent price trend`} />

      <div className="stats">
        {Object.entries(pick.stats).map(([k, v]) => (
          <div className="stat" key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>

      <ul className="signals">
        {pick.signals.slice(0, 4).map((s) => (
          <li key={s}>{s}</li>
        ))}
        {pick.warnings.slice(0, 2).map((s) => (
          <li className="warn" key={s}>
            {s}
          </li>
        ))}
      </ul>

      <div className="thesis">{pick.thesis}</div>
      <div className="card-cta">Full analysis, chart &amp; projections →</div>
    </article>
    </Link>
  );
}
