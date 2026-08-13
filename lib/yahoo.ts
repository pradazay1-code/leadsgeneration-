// Thin wrappers around yahoo-finance2 with batching, concurrency limits,
// and defensive error handling (a single bad symbol must never kill a scan).

import yahooFinance from "yahoo-finance2";
import type { Candle } from "./indicators";

yahooFinance.suppressNotices(["yahooSurvey"]);

export interface Snapshot {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  epsTrailing: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Batched quotes for many symbols in a single request.
export async function fetchSnapshots(symbols: string[]): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  const BATCH = 50;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const quotes = await yahooFinance.quote(batch);
      const arr = Array.isArray(quotes) ? quotes : [quotes];
      for (const q of arr) {
        const price = num(q.regularMarketPrice);
        if (!q.symbol || price === null) continue;
        out.push({
          symbol: q.symbol,
          name: q.shortName ?? q.longName ?? q.symbol,
          price,
          changePercent: num(q.regularMarketChangePercent) ?? 0,
          volume: num(q.regularMarketVolume) ?? 0,
          avgVolume: num(q.averageDailyVolume3Month) ?? 0,
          marketCap: num(q.marketCap),
          trailingPE: num(q.trailingPE),
          forwardPE: num(q.forwardPE),
          epsTrailing: num(q.epsTrailingTwelveMonths),
          fiftyTwoWeekHigh: num(q.fiftyTwoWeekHigh),
          fiftyTwoWeekLow: num(q.fiftyTwoWeekLow),
          fiftyDayAverage: num(q.fiftyDayAverage),
          twoHundredDayAverage: num(q.twoHundredDayAverage),
        });
      }
    } catch (err) {
      console.error(`quote batch failed (${batch[0]}…):`, (err as Error).message);
    }
  }
  return out;
}

// Daily candles for roughly the past `days` calendar days.
export async function fetchDailyCandles(symbol: string, days: number): Promise<Candle[]> {
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const res = await yahooFinance.chart(symbol, { period1, interval: "1d" });
    return (res.quotes ?? [])
      .filter(
        (q) =>
          q.close != null && q.open != null && q.high != null && q.low != null && q.volume != null,
      )
      .map((q) => ({
        date: new Date(q.date),
        open: q.open as number,
        high: q.high as number,
        low: q.low as number,
        close: q.close as number,
        volume: q.volume as number,
      }));
  } catch (err) {
    console.error(`chart failed for ${symbol}:`, (err as Error).message);
    return [];
  }
}

// Fallback: derive a snapshot from chart data alone. The chart endpoint needs
// no cookie/crumb, so this keeps scans alive if Yahoo's quote API is blocked.
// Fundamentals are unavailable in this mode; scoring already tolerates nulls.
export function snapshotFromCandles(symbol: string, candles: Candle[]): Snapshot | null {
  if (candles.length < 60) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const year = candles.slice(-252);
  const avgVol =
    candles.slice(-63).reduce((a, c) => a + c.volume, 0) / Math.min(63, candles.length);
  const avg = (n: number) =>
    candles.length >= n
      ? candles.slice(-n).reduce((a, c) => a + c.close, 0) / n
      : null;
  return {
    symbol,
    name: symbol,
    price: last.close,
    changePercent: prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
    volume: last.volume,
    avgVolume: avgVol,
    marketCap: null,
    trailingPE: null,
    forwardPE: null,
    epsTrailing: null,
    fiftyTwoWeekHigh: Math.max(...year.map((c) => c.high)),
    fiftyTwoWeekLow: Math.min(...year.map((c) => c.low)),
    fiftyDayAverage: avg(50),
    twoHundredDayAverage: avg(200),
  };
}

// Yahoo predefined screeners — surfaces fresh momentum names beyond the core universe.
export async function fetchScreenerSymbols(
  scrIds: "most_actives" | "day_gainers",
  count: number,
): Promise<string[]> {
  try {
    const res = await yahooFinance.screener(
      { scrIds, count },
      { validateResult: false },
    );
    return (res.quotes ?? [])
      .map((q: { symbol?: string }) => q.symbol)
      .filter((s: string | undefined): s is string => typeof s === "string" && !s.includes("."));
  } catch (err) {
    console.error(`screener ${scrIds} failed:`, (err as Error).message);
    return [];
  }
}

// Run async jobs with bounded concurrency.
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
