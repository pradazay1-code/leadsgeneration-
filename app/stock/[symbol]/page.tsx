import Link from "next/link";
import type { Metadata } from "next";
import StockChart from "@/components/StockChart";
import Projection from "@/components/Projection";
import SearchBox from "@/components/SearchBox";
import { buildAnalysis } from "@/lib/analysis";
import { BENCHMARK } from "@/lib/universe";
import { fetchDailyCandles, fetchSnapshots, fetchSummaryExtras, snapshotFromCandles } from "@/lib/yahoo";

export const revalidate = 600;
export const maxDuration = 60;

interface Props {
  params: Promise<{ symbol: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  return {
    title: `${sym} — Full Analysis | Stock Wizard`,
    description: `Interactive chart, technical and fundamental analysis, quality checklist, and investment projections for ${sym}.`,
  };
}

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase().slice(0, 12);

  const [candles, benchCandles, snapshots, extras] = await Promise.all([
    fetchDailyCandles(sym, 800),
    fetchDailyCandles(BENCHMARK, 800),
    fetchSnapshots([sym]),
    fetchSummaryExtras(sym),
  ]);

  const snap = snapshots[0] ?? (candles.length >= 60 ? snapshotFromCandles(sym, candles) : null);

  if (!snap || candles.length < 30) {
    return (
      <main className="container">
        <header className="header">
          <div className="brand">
            <Link href="/" className="back-link">← Stock Wizard</Link>
          </div>
          <SearchBox />
        </header>
        <div className="notice" style={{ marginTop: 32 }}>
          Couldn&apos;t load data for <b>{sym}</b>. Double-check the ticker symbol, or try again
          in a minute if the data provider is briefly unavailable.
        </div>
      </main>
    );
  }

  const a = buildAnalysis(snap, candles, benchCandles, extras);
  const chgClass = a.changePercent >= 0 ? "up" : "down";
  const confClass =
    a.confidence === "High" ? "conf-high" : a.confidence === "Medium" ? "conf-mid" : "conf-low";

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <Link href="/" className="back-link">← Stock Wizard</Link>
        </div>
        <SearchBox />
      </header>

      <section className="detail-head">
        <div>
          <h1 className="detail-title">
            {a.symbol} <span className="detail-name">{a.name}</span>
          </h1>
          {(a.sector || a.industry) && (
            <div className="detail-sector">
              {[a.sector, a.industry].filter(Boolean).join(" · ")}
            </div>
          )}
          <div className="detail-price">
            <span className="price-big">${a.price.toFixed(2)}</span>
            <span className={`chg ${chgClass}`}>
              {a.changePercent >= 0 ? "+" : ""}
              {a.changePercent.toFixed(2)}% today
            </span>
          </div>
        </div>
        <div className="verdict-badges">
          <div className="v-badge">
            <span className="num">{a.dayTrade?.score ?? "—"}</span>
            <span className="lbl">Day-trade score</span>
          </div>
          <div className="v-badge">
            <span className="num">{a.longTerm?.score ?? "—"}</span>
            <span className="lbl">Long-term score</span>
          </div>
          <div className={`v-badge ${confClass}`}>
            <span className="num">{a.confidence}</span>
            <span className="lbl">Confidence</span>
          </div>
        </div>
      </section>

      <section className="section">
        <StockChart data={a.chart} symbol={a.symbol} />
      </section>

      <section className="section">
        <h2 className="h2">📋 The Verdict</h2>
        <div className="verdict-panels">
          <div className="verdict-panel">
            <h3>Short-term</h3>
            <p>{a.verdict.shortTerm}</p>
            {a.dayTrade && (
              <ul className="signals">
                {a.dayTrade.signals.slice(0, 3).map((s) => <li key={s}>{s}</li>)}
                {a.dayTrade.warnings.slice(0, 2).map((s) => <li className="warn" key={s}>{s}</li>)}
              </ul>
            )}
          </div>
          <div className="verdict-panel">
            <h3>Long-term</h3>
            <p>{a.verdict.longTerm}</p>
            {a.longTerm && (
              <ul className="signals">
                {a.longTerm.signals.slice(0, 3).map((s) => <li key={s}>{s}</li>)}
                {a.longTerm.warnings.slice(0, 2).map((s) => <li className="warn" key={s}>{s}</li>)}
              </ul>
            )}
          </div>
          <div className="verdict-panel">
            <h3>Risk</h3>
            <p>{a.verdict.risk}</p>
            {a.analyst.targetMeanPrice !== null && (
              <p className="analyst-line">
                Wall Street: {a.analyst.analysts ?? "?"} analysts, average target{" "}
                <b>${a.analyst.targetMeanPrice.toFixed(2)}</b> (
                {a.analyst.upsidePct !== null && (
                  <span className={a.analyst.upsidePct >= 0 ? "up" : "down"}>
                    {a.analyst.upsidePct >= 0 ? "+" : ""}
                    {a.analyst.upsidePct.toFixed(1)}%
                  </span>
                )}
                {a.analyst.recommendationKey && <> · rating: {a.analyst.recommendationKey.replace("_", " ")}</>}
                )
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="h2">✅ Quality Checklist</h2>
        <p className="sub">
          The strict process behind the confidence grade — every check must be visible, and
          High confidence requires zero failures.
        </p>
        <div className="checklist">
          {a.checks.map((c) => (
            <div key={c.name} className={`check ${c.status}`}>
              <span className="check-icon">
                {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "?"}
              </span>
              <div>
                <div className="check-name">{c.name}</div>
                <div className="check-detail">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="h2">📊 Key Metrics</h2>
        <div className="metric-grid">
          {a.metrics.map((m) => (
            <div className="metric" key={m.label}>
              <div className="k">{m.label}</div>
              <div className="v">{m.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="h2">🔮 Investment Projection</h2>
        <p className="sub">
          Model a recurring investment in {a.symbol} — e.g. &quot;$50 a week for 5 years&quot; —
          using its own dampened historical return and real volatility.
        </p>
        <Projection symbol={a.symbol} muAnnual={a.projection.muAnnual} sigmaAnnual={a.projection.sigmaAnnual} />
      </section>

      <footer className="disclaimer">
        ⚠️ Educational analysis, not financial advice. All scores, checks, and projections are
        computed from historical prices and public data; past performance does not predict
        future results. Never invest money you cannot afford to lose.
      </footer>
    </main>
  );
}
