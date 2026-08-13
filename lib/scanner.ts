// Scan orchestration. Two-stage funnel keeps runtime inside serverless limits:
//   1. Batched quotes for the whole universe (+ Yahoo screener additions),
//      filtered by liquidity and pre-ranked by cheap momentum/valuation hints.
//   2. Full daily-candle download + indicator scoring for the top candidates.

import {
  CORE_UNIVERSE,
  MAX_DEEP_DIVE,
  MAX_SCREENER_ADDS,
  MIN_AVG_DOLLAR_VOLUME,
  MIN_PRICE,
  TOP_PICKS,
} from "./universe";
import {
  fetchDailyCandles,
  fetchScreenerSymbols,
  fetchSnapshots,
  mapLimit,
  Snapshot,
  snapshotFromCandles,
} from "./yahoo";
import { Pick, scoreDayTrade, scoreLongTerm } from "./scoring";
import type { Candle } from "./indicators";

export interface ScanResult {
  generatedAt: string;
  dayTrades: Pick[];
  longTerm: Pick[];
  universeSize: number;
  scanned: number;
}

function liquid(s: Snapshot): boolean {
  return s.price >= MIN_PRICE && s.price * s.avgVolume >= MIN_AVG_DOLLAR_VOLUME;
}

export async function runScan(): Promise<ScanResult> {
  // Stage 1a: expand the universe with today's most active names and gainers.
  const [actives, gainers] = await Promise.all([
    fetchScreenerSymbols("most_actives", MAX_SCREENER_ADDS),
    fetchScreenerSymbols("day_gainers", MAX_SCREENER_ADDS),
  ]);
  const universe = [...new Set([...CORE_UNIVERSE, ...actives, ...gainers])];

  // Stage 1b: one batched quote pass over everything.
  const snapshots = (await fetchSnapshots(universe)).filter(liquid);
  const prefetchedCandles = new Map<string, Candle[]>();

  // Fallback: if the quote API is unreachable (cookie/crumb blocked), rebuild
  // snapshots from chart data, which needs no authentication.
  if (snapshots.length === 0) {
    const fallbackSyms = CORE_UNIVERSE.slice(0, 90);
    const fetched = await mapLimit(fallbackSyms, 8, async (sym) => ({
      sym,
      candles: await fetchDailyCandles(sym, 550),
    }));
    for (const { sym, candles } of fetched) {
      const snap = snapshotFromCandles(sym, candles);
      if (snap && liquid(snap)) {
        snapshots.push(snap);
        prefetchedCandles.set(sym, candles);
      }
    }
  }

  const bySymbol = new Map(snapshots.map((s) => [s.symbol, s]));

  // Stage 2 candidates — day-trade side: rank by today's move × volume unusualness.
  const dayCandidates = [...snapshots]
    .sort((a, b) => {
      const heat = (s: Snapshot) =>
        Math.abs(s.changePercent) * 2 + (s.avgVolume > 0 ? s.volume / s.avgVolume : 0);
      return heat(b) - heat(a);
    })
    .slice(0, MAX_DEEP_DIVE)
    .map((s) => s.symbol);

  // Long-term side: core universe names above their 200-day average, nearest highs first.
  const ltCandidates = snapshots
    .filter(
      (s) =>
        CORE_UNIVERSE.includes(s.symbol) &&
        s.twoHundredDayAverage !== null &&
        s.price > s.twoHundredDayAverage,
    )
    .sort((a, b) => {
      const strength = (s: Snapshot) =>
        s.fiftyTwoWeekHigh && s.fiftyTwoWeekHigh > 0 ? s.price / s.fiftyTwoWeekHigh : 0;
      return strength(b) - strength(a);
    })
    .slice(0, MAX_DEEP_DIVE)
    .map((s) => s.symbol);

  // One candle download per unique candidate (18 months covers both models).
  const uniqueSymbols = [...new Set([...dayCandidates, ...ltCandidates])];
  const candleMap = new Map(
    (
      await mapLimit(uniqueSymbols, 6, async (sym) => ({
        sym,
        candles: prefetchedCandles.get(sym) ?? (await fetchDailyCandles(sym, 550)),
      }))
    ).map((r) => [r.sym, r.candles]),
  );

  const dayTrades = dayCandidates
    .map((sym) => {
      const snap = bySymbol.get(sym);
      const candles = candleMap.get(sym);
      return snap && candles ? scoreDayTrade(snap, candles) : null;
    })
    .filter((p): p is Pick => p !== null && p.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_PICKS);

  const longTerm = ltCandidates
    .map((sym) => {
      const snap = bySymbol.get(sym);
      const candles = candleMap.get(sym);
      return snap && candles ? scoreLongTerm(snap, candles) : null;
    })
    .filter((p): p is Pick => p !== null && p.score >= 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_PICKS);

  return {
    generatedAt: new Date().toISOString(),
    dayTrades,
    longTerm,
    universeSize: universe.length,
    scanned: uniqueSymbols.length,
  };
}
