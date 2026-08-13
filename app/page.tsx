import PickCard from "@/components/PickCard";
import { runScan, ScanResult } from "@/lib/scanner";

// Re-scan at most every 15 minutes; every visitor in between gets the cached page.
export const revalidate = 900;
export const maxDuration = 60;

export default async function Home() {
  let result: ScanResult | null = null;
  let error: string | null = null;
  try {
    result = await runScan();
  } catch (err) {
    error = (err as Error).message;
  }

  const updated = result
    ? new Date(result.generatedAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      })
    : null;

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <h1>📈 Stock Wizard</h1>
          <span className="tag">daily trades · long-term compounders</span>
        </div>
        <div className="meta">
          {updated ? (
            <>
              Last scan: {updated} ET
              <br />
              {result!.universeSize} symbols in universe · {result!.scanned} deep-analyzed
            </>
          ) : (
            "Scan unavailable"
          )}
        </div>
      </header>

      {error && (
        <div className="notice">
          Market data is temporarily unavailable ({error}). Refresh in a minute — the scanner
          retries automatically.
        </div>
      )}

      {result && (
        <>
          <section className="section">
            <div className="section-head">
              <h2>⚡ Today&apos;s Day-Trade Candidates</h2>
              <p className="sub">
                Momentum setups for short-term trades: unusual volume, trend alignment, healthy
                RSI, accelerating MACD, and enough daily range to be worth trading. Highest
                conviction first.
              </p>
            </div>
            {result.dayTrades.length > 0 ? (
              <div className="grid">
                {result.dayTrades.map((p) => (
                  <PickCard key={p.symbol} pick={p} />
                ))}
              </div>
            ) : (
              <div className="notice">
                No setups clear the quality bar right now — that is a signal too. Forcing trades
                on weak days is how accounts bleed. Check back after the next scan.
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <h2>🏛️ Long-Term Investment Picks</h2>
              <p className="sub">
                Durable uptrends for buy-and-hold: above the 200-day average, strong 6–12 month
                performance, shallow drawdowns, consistent months, real profits, and sane
                valuations.
              </p>
            </div>
            {result.longTerm.length > 0 ? (
              <div className="grid">
                {result.longTerm.map((p) => (
                  <PickCard key={p.symbol} pick={p} />
                ))}
              </div>
            ) : (
              <div className="notice">No long-term candidates cleared the bar this scan.</div>
            )}
          </section>
        </>
      )}

      <section className="how">
        <div>
          <h3>How the scan works</h3>
          <p>
            Every scan pulls live quotes for ~150 liquid large-caps plus Yahoo&apos;s most-active
            and top-gainer screeners, filters for liquidity ($5+ price, $20M+ daily dollar
            volume), then downloads 18 months of daily candles for the strongest candidates and
            scores them 0–100 across volume, momentum, trend, RSI, MACD, volatility, drawdown,
            consistency, and valuation.
          </p>
        </div>
        <div>
          <h3>Always on</h3>
          <p>
            The dashboard re-scans automatically every 15 minutes. A scheduled job runs every
            weekday before the market opens (8:45 AM ET) and texts the top picks straight to
            your phone via SMS.
          </p>
        </div>
        <div>
          <h3>Read the score</h3>
          <p>
            75+ (green) is a high-conviction setup, 55–74 (blue) is solid, below 55 is
            marginal. Every card lists the exact signals and warnings behind its score — never
            trade a ticker without reading its warnings.
          </p>
        </div>
      </section>

      <footer className="disclaimer">
        ⚠️ Educational tool, not financial advice. Scores are derived from historical prices and
        public data; past performance does not predict future results. Day trading in particular
        carries a high risk of loss — most retail day traders lose money. Never invest money you
        cannot afford to lose, and consider consulting a licensed financial advisor.
      </footer>
    </main>
  );
}
