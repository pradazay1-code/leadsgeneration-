// Scoring models. Each produces a 0–100 score plus human-readable signals
// explaining exactly why a stock ranked where it did.
//
// Day-trade score rewards: unusual volume, strong momentum with trend
// alignment, healthy (not exhausted) RSI, rising MACD, and enough daily
// range (ATR) to actually make an intraday move worth trading.
//
// Long-term score rewards: durable uptrends (price > 50dma > 200dma),
// strong-but-consistent 6m/12m returns, shallow drawdowns, reasonable
// valuation, and real profitability.

import type { Candle } from "./indicators";
import {
  atrPercent,
  macd,
  maxDrawdown,
  positiveMonthShare,
  relativeVolume,
  returnOver,
  rsi,
  sma,
} from "./indicators";
import type { Snapshot } from "./yahoo";

export interface Pick {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  score: number;
  signals: string[];
  warnings: string[];
  thesis: string;
  spark: number[]; // recent closes for the dashboard sparkline
  stats: Record<string, string>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// Linearly maps value from [lo, hi] onto [0, points].
const scale = (v: number, lo: number, hi: number, points: number) =>
  clamp(((v - lo) / (hi - lo)) * points, 0, points);

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export function scoreDayTrade(snap: Snapshot, candles: Candle[]): Pick | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const relVol = relativeVolume(volumes) ?? 1;
  const r1 = returnOver(closes, 1) ?? 0;
  const r5 = returnOver(closes, 5) ?? 0;
  const rsi14 = rsi(closes) ?? 50;
  const m = macd(closes);
  const atrPct = atrPercent(candles) ?? 0;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const price = snap.price;

  let score = 0;
  const signals: string[] = [];
  const warnings: string[] = [];

  // Unusual volume (up to 25 pts) — volume precedes price.
  score += scale(relVol, 1, 3, 25);
  if (relVol >= 2) signals.push(`Volume surge: ${relVol.toFixed(1)}× the 20-day average`);
  else if (relVol >= 1.3) signals.push(`Elevated volume: ${relVol.toFixed(1)}× average`);

  // Momentum (up to 25 pts): today's move plus the 5-day trend.
  score += scale(r1, 0, 5, 13) + scale(r5, 0, 10, 12);
  if (r1 > 2) signals.push(`Strong day: ${pct(r1)} today`);
  if (r5 > 4) signals.push(`5-day momentum: ${pct(r5)}`);
  if (r5 < -5) warnings.push(`Falling knife risk: ${pct(r5)} over 5 days`);

  // Trend alignment (up to 20 pts).
  if (sma20 !== null && price > sma20) {
    score += 10;
    if (sma50 !== null && sma20 > sma50) {
      score += 10;
      signals.push("Uptrend intact: price > 20-day > 50-day average");
    }
  } else {
    warnings.push("Trading below its 20-day average");
  }

  // RSI sweet spot (up to 15 pts): momentum without exhaustion.
  if (rsi14 >= 55 && rsi14 <= 75) {
    score += 15;
    signals.push(`RSI ${rsi14.toFixed(0)}: strong but not overbought`);
  } else if (rsi14 > 75) {
    score += 5;
    warnings.push(`RSI ${rsi14.toFixed(0)}: overbought — chase risk`);
  } else if (rsi14 >= 45) {
    score += 8;
  }

  // MACD (up to 10 pts): bullish and accelerating.
  if (m && m.histogram > 0) {
    score += m.histogram > m.histogramPrev ? 10 : 6;
    if (m.histogram > m.histogramPrev) signals.push("MACD bullish and accelerating");
  }

  // Volatility (up to 5 pts): needs range to be worth trading intraday.
  score += scale(atrPct, 1, 4, 5);
  if (atrPct >= 3) signals.push(`High daily range: ${atrPct.toFixed(1)}% ATR`);

  const top = signals[0] ?? "mixed technicals";
  return {
    symbol: snap.symbol,
    name: snap.name,
    price,
    changePercent: snap.changePercent,
    score: Math.round(clamp(score, 0, 100)),
    signals,
    warnings,
    thesis: `Short-term momentum setup — ${top.charAt(0).toLowerCase()}${top.slice(1)}.`,
    spark: closes.slice(-30),
    stats: {
      "Rel. volume": `${relVol.toFixed(1)}×`,
      "5-day": pct(r5),
      RSI: rsi14.toFixed(0),
      ATR: `${atrPct.toFixed(1)}%`,
    },
  };
}

export function scoreLongTerm(snap: Snapshot, candles: Candle[]): Pick | null {
  if (candles.length < 200) return null;
  const closes = candles.map((c) => c.close);
  const price = snap.price;

  const r126 = returnOver(closes, 126) ?? 0; // ~6 months
  const r252 = returnOver(closes, 252) ?? returnOver(closes, closes.length - 2) ?? 0; // ~1 year
  const dd = maxDrawdown(closes.slice(-252));
  const monthShare = positiveMonthShare(candles) ?? 0.5;
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const offHigh =
    snap.fiftyTwoWeekHigh && snap.fiftyTwoWeekHigh > 0
      ? ((price - snap.fiftyTwoWeekHigh) / snap.fiftyTwoWeekHigh) * 100
      : null;

  let score = 0;
  const signals: string[] = [];
  const warnings: string[] = [];

  // Durable trend (up to 25 pts).
  if (sma200 !== null && price > sma200) {
    score += 13;
    signals.push("Above its 200-day average — long-term uptrend");
    if (sma50 !== null && sma50 > sma200) {
      score += 12;
      signals.push("Golden alignment: 50-day above 200-day average");
    }
  } else {
    warnings.push("Below its 200-day average — trend not confirmed");
  }

  // Performance (up to 30 pts): steady compounding beats parabolic spikes.
  score += scale(r252, 0, 40, 18) + scale(r126, 0, 20, 12);
  if (r252 > 15) signals.push(`1-year return: ${pct(r252)}`);
  if (r126 > 10) signals.push(`6-month return: ${pct(r126)}`);
  if (r252 > 120) warnings.push("Parabolic 1-year run — expect volatility");

  // Consistency (up to 20 pts): shallow drawdowns, mostly-positive months.
  score += scale(dd, -40, -10, 10); // dd is negative; -10% ⇒ full points
  score += scale(monthShare, 0.4, 0.75, 10);
  if (dd > -15) signals.push(`Shallow drawdowns: worst ${dd.toFixed(0)}% this year`);
  if (dd < -35) warnings.push(`Deep drawdown this year: ${dd.toFixed(0)}%`);
  if (monthShare >= 0.65) signals.push(`Consistent: ${(monthShare * 100).toFixed(0)}% of months positive`);

  // Near highs (up to 10 pts): strength begets strength.
  if (offHigh !== null) {
    score += scale(offHigh, -25, -2, 10);
    if (offHigh > -5) signals.push("Trading within 5% of its 52-week high");
  }

  // Fundamentals (up to 15 pts): profitable, sanely valued, institutional-size.
  if (snap.epsTrailing !== null) {
    if (snap.epsTrailing > 0) score += 5;
    else warnings.push("Not currently profitable (negative trailing EPS)");
  }
  const pe = snap.forwardPE ?? snap.trailingPE;
  if (pe !== null && pe > 0) {
    if (pe < 35) {
      score += 6;
      signals.push(`Reasonable valuation: ${pe.toFixed(0)}× forward earnings`);
    } else if (pe < 60) {
      score += 3;
    } else {
      warnings.push(`Rich valuation: ${pe.toFixed(0)}× earnings`);
    }
  }
  if (snap.marketCap !== null && snap.marketCap > 10_000_000_000) score += 4;

  const top = signals[0] ?? "steady technical profile";
  return {
    symbol: snap.symbol,
    name: snap.name,
    price,
    changePercent: snap.changePercent,
    score: Math.round(clamp(score, 0, 100)),
    signals,
    warnings,
    thesis: `Long-term compounder candidate — ${top.charAt(0).toLowerCase()}${top.slice(1)}.`,
    spark: closes.filter((_, i) => i % 4 === 0).slice(-40),
    stats: {
      "1-year": pct(r252),
      "6-month": pct(r126),
      "Max DD": `${dd.toFixed(0)}%`,
      "Fwd P/E": pe && pe > 0 ? pe.toFixed(0) : "—",
    },
  };
}
