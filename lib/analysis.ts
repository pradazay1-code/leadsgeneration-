// Full single-stock analysis for the detail page. Combines the day-trade and
// long-term scoring models with risk metrics, a strict pass/fail quality
// checklist, and an overall confidence grade. The checklist is the "minimal
// failure" discipline: every claim the page makes is backed by a named check
// the reader can see pass or fail.

import type { Candle } from "./indicators";
import { atrPercent, maxDrawdown, returnOver, rsi, sma } from "./indicators";
import type { Snapshot, SummaryExtras } from "./yahoo";
import { Pick, scoreDayTrade, scoreLongTerm } from "./scoring";
import { MIN_AVG_DOLLAR_VOLUME } from "./universe";

export interface Check {
  name: string;
  status: "pass" | "fail" | "unknown";
  detail: string;
}

export interface FullAnalysis {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  sector: string | null;
  industry: string | null;
  dayTrade: Pick | null;
  longTerm: Pick | null;
  confidence: "High" | "Medium" | "Low";
  checks: Check[];
  verdict: { shortTerm: string; longTerm: string; risk: string };
  metrics: { label: string; value: string }[];
  analyst: {
    targetMeanPrice: number | null;
    upsidePct: number | null;
    recommendationKey: string | null;
    recommendationMean: number | null;
    analysts: number | null;
  };
  // Parameters for the client-side projection calculator, derived from history.
  projection: { muAnnual: number; sigmaAnnual: number };
  // Serialized candles for the interactive chart.
  chart: { t: number; o: number; h: number; l: number; c: number; v: number }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmtPct = (v: number | null, digits = 1) =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) out.push(closes[i] / closes[i - 1] - 1);
  }
  return out;
}

function annualizedVol(closes: number[]): number | null {
  const rets = dailyReturns(closes.slice(-252));
  if (rets.length < 60) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

// Beta vs a benchmark over overlapping recent history.
function betaVs(closes: number[], benchCloses: number[]): number | null {
  const n = Math.min(closes.length, benchCloses.length, 253);
  if (n < 120) return null;
  const a = dailyReturns(closes.slice(-n));
  const b = dailyReturns(benchCloses.slice(-n));
  const len = Math.min(a.length, b.length);
  const as = a.slice(-len);
  const bs = b.slice(-len);
  const ma = as.reduce((x, y) => x + y, 0) / len;
  const mb = bs.reduce((x, y) => x + y, 0) / len;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < len; i++) {
    cov += (as[i] - ma) * (bs[i] - mb);
    varB += (bs[i] - mb) ** 2;
  }
  return varB > 0 ? cov / varB : null;
}

export function buildAnalysis(
  snap: Snapshot,
  candles: Candle[],
  benchCandles: Candle[],
  extras: SummaryExtras,
): FullAnalysis {
  const closes = candles.map((c) => c.close);
  const price = snap.price;

  const dayTrade = scoreDayTrade(snap, candles);
  const longTerm = scoreLongTerm(snap, candles);

  const r21 = returnOver(closes, 21);
  const r63 = returnOver(closes, 63);
  const r126 = returnOver(closes, 126);
  const r252 = returnOver(closes, 252);
  const benchR252 = returnOver(
    benchCandles.map((c) => c.close),
    252,
  );
  const vol = annualizedVol(closes);
  const beta = extras.beta ?? betaVs(closes, benchCandles.map((c) => c.close));
  const dd1y = candles.length >= 60 ? maxDrawdown(closes.slice(-252)) : null;
  const rsi14 = rsi(closes);
  const atr = atrPercent(candles);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const dollarVolume = snap.price * snap.avgVolume;
  const pos52w =
    snap.fiftyTwoWeekHigh !== null &&
    snap.fiftyTwoWeekLow !== null &&
    snap.fiftyTwoWeekHigh > snap.fiftyTwoWeekLow
      ? ((price - snap.fiftyTwoWeekLow) / (snap.fiftyTwoWeekHigh - snap.fiftyTwoWeekLow)) * 100
      : null;
  // CAGR from up to 2 years of history.
  const years = Math.min(candles.length / 252, 2);
  const cagr =
    years >= 0.9 && closes[closes.length - 1 - Math.round(years * 252) + 1] > 0
      ? (Math.pow(
          closes[closes.length - 1] / closes[Math.max(0, closes.length - Math.round(years * 252))],
          1 / years,
        ) -
          1) *
        100
      : null;

  // --- strict quality checklist ---
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) =>
    checks.push({ name, status, detail });

  add(
    "Data depth",
    candles.length >= 400 ? "pass" : "fail",
    `${candles.length} trading days of history (need 400+ for full confidence)`,
  );
  add(
    "Liquidity",
    dollarVolume >= MIN_AVG_DOLLAR_VOLUME ? "pass" : "fail",
    `$${(dollarVolume / 1e6).toFixed(0)}M average daily dollar volume (need $20M+)`,
  );
  add(
    "Long-term trend",
    sma200 === null ? "unknown" : price > sma200 ? "pass" : "fail",
    sma200 === null
      ? "Not enough history for a 200-day average"
      : price > sma200
        ? "Price is above its 200-day average"
        : "Price is below its 200-day average",
  );
  add(
    "Trend alignment",
    sma50 === null || sma200 === null ? "unknown" : sma50 > sma200 ? "pass" : "fail",
    sma50 !== null && sma200 !== null
      ? sma50 > sma200
        ? "50-day average above 200-day (golden alignment)"
        : "50-day average below 200-day (bearish alignment)"
      : "Not enough history",
  );
  add(
    "Volatility contained",
    vol === null ? "unknown" : vol < 45 ? "pass" : "fail",
    vol === null ? "Insufficient data" : `${vol.toFixed(0)}% annualized volatility (limit 45%)`,
  );
  add(
    "Drawdown contained",
    dd1y === null ? "unknown" : dd1y > -35 ? "pass" : "fail",
    dd1y === null ? "Insufficient data" : `Worst 1-year drawdown ${dd1y.toFixed(0)}% (limit −35%)`,
  );
  add(
    "Profitability",
    snap.epsTrailing === null ? "unknown" : snap.epsTrailing > 0 ? "pass" : "fail",
    snap.epsTrailing === null
      ? "Earnings data unavailable"
      : snap.epsTrailing > 0
        ? "Positive trailing earnings per share"
        : "Negative trailing earnings per share",
  );
  add(
    "Analyst coverage",
    extras.numberOfAnalystOpinions === null
      ? "unknown"
      : extras.numberOfAnalystOpinions >= 5
        ? "pass"
        : "fail",
    extras.numberOfAnalystOpinions === null
      ? "No analyst data available"
      : `${extras.numberOfAnalystOpinions} analysts covering`,
  );

  const passes = checks.filter((c) => c.status === "pass").length;
  const fails = checks.filter((c) => c.status === "fail").length;
  const confidence: FullAnalysis["confidence"] =
    passes >= 7 && fails === 0 ? "High" : passes >= 5 && fails <= 2 ? "Medium" : "Low";

  // --- verdict prose ---
  const trendWord =
    sma200 !== null && price > sma200
      ? sma50 !== null && sma200 !== null && sma50 > sma200
        ? "a confirmed uptrend"
        : "a tentative uptrend"
      : "a downtrend or unconfirmed trend";
  const shortTerm =
    dayTrade === null
      ? "Not enough recent data to grade a short-term setup."
      : `Short-term setup scores ${dayTrade.score}/100. ${
          dayTrade.score >= 75
            ? "Strong momentum candidate right now"
            : dayTrade.score >= 55
              ? "Decent momentum, but not a top-tier setup"
              : "Weak setup — the edge isn't there today"
        }${rsi14 !== null ? `, with RSI at ${rsi14.toFixed(0)}` : ""}${
          atr !== null ? ` and a ${atr.toFixed(1)}% average daily range` : ""
        }.`;
  const longTermText =
    longTerm === null
      ? "Not enough history to grade as a long-term holding."
      : `Long-term profile scores ${longTerm.score}/100 in ${trendWord}. ${
          r252 !== null && benchR252 !== null
            ? `Over the past year it returned ${fmtPct(r252)} vs ${fmtPct(benchR252)} for the S&P 500 (SPY)${
                r252 > benchR252 ? " — outperforming the market" : " — lagging the market"
              }.`
            : ""
        }`;
  const risk = `Risk profile: ${
    vol !== null ? `${vol.toFixed(0)}% annualized volatility` : "volatility unknown"
  }${beta !== null ? `, beta ${beta.toFixed(2)} vs the S&P 500` : ""}${
    dd1y !== null ? `, worst drawdown ${dd1y.toFixed(0)}% in the past year` : ""
  }. ${
    vol !== null && vol > 45
      ? "This is a high-volatility name — size positions small."
      : "Volatility is within a normal range for equities."
  }`;

  // --- projection parameters (deliberately conservative) ---
  // Blend the stock's own capped CAGR 50/50 with a market-like 8%/yr, so a hot
  // streak doesn't extrapolate into fantasy. Volatility drives the band width.
  const muAnnual = 0.5 * clamp((cagr ?? 8) / 100, -0.15, 0.3) + 0.5 * 0.08;
  const sigmaAnnual = clamp((vol ?? 25) / 100, 0.1, 0.8);

  const metrics: { label: string; value: string }[] = [
    { label: "1-month return", value: fmtPct(r21) },
    { label: "3-month return", value: fmtPct(r63) },
    { label: "6-month return", value: fmtPct(r126) },
    { label: "1-year return", value: fmtPct(r252) },
    { label: "1-yr vs S&P 500", value: r252 !== null && benchR252 !== null ? fmtPct(r252 - benchR252) : "—" },
    { label: "Annualized volatility", value: vol !== null ? `${vol.toFixed(0)}%` : "—" },
    { label: "Beta (vs S&P 500)", value: beta !== null ? beta.toFixed(2) : "—" },
    { label: "Worst 1-yr drawdown", value: dd1y !== null ? `${dd1y.toFixed(0)}%` : "—" },
    { label: "RSI (14-day)", value: rsi14 !== null ? rsi14.toFixed(0) : "—" },
    { label: "Avg daily range (ATR)", value: atr !== null ? `${atr.toFixed(1)}%` : "—" },
    { label: "52-week range position", value: pos52w !== null ? `${pos52w.toFixed(0)}%` : "—" },
    {
      label: "Dividend yield",
      value: extras.dividendYieldPct !== null ? `${extras.dividendYieldPct.toFixed(2)}%` : "—",
    },
    {
      label: "Profit margin",
      value: extras.profitMarginsPct !== null ? `${extras.profitMarginsPct.toFixed(1)}%` : "—",
    },
    {
      label: "Revenue growth (yoy)",
      value: extras.revenueGrowthPct !== null ? fmtPct(extras.revenueGrowthPct) : "—",
    },
    {
      label: "Forward P/E",
      value:
        snap.forwardPE !== null && snap.forwardPE > 0 ? `${snap.forwardPE.toFixed(1)}×` : "—",
    },
    {
      label: "Market cap",
      value: snap.marketCap !== null ? `$${(snap.marketCap / 1e9).toFixed(0)}B` : "—",
    },
  ];

  return {
    symbol: snap.symbol,
    name: snap.name,
    price,
    changePercent: snap.changePercent,
    sector: extras.sector,
    industry: extras.industry,
    dayTrade,
    longTerm,
    confidence,
    checks,
    verdict: { shortTerm, longTerm: longTermText, risk },
    metrics,
    analyst: {
      targetMeanPrice: extras.targetMeanPrice,
      upsidePct:
        extras.targetMeanPrice !== null && price > 0
          ? ((extras.targetMeanPrice - price) / price) * 100
          : null,
      recommendationKey: extras.recommendationKey,
      recommendationMean: extras.recommendationMean,
      analysts: extras.numberOfAnalystOpinions,
    },
    projection: { muAnnual, sigmaAnnual },
    chart: candles.map((c) => ({
      t: c.date.getTime(),
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    })),
  };
}
