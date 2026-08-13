// Technical indicator math. All functions take arrays ordered oldest → newest.

export interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

function emaSeries(values: number[], period: number): number[] {
  const out: number[] = [];
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(e);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

// Wilder-smoothed RSI.
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
  histogramPrev: number;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult | null {
  if (closes.length < slow + signalPeriod + 1) return null;
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  const offset = fastSeries.length - slowSeries.length;
  const macdLine = slowSeries.map((s, i) => fastSeries[i + offset] - s);
  const signalSeries = emaSeries(macdLine, signalPeriod);
  if (signalSeries.length < 2) return null;
  const m = macdLine[macdLine.length - 1];
  const mPrev = macdLine[macdLine.length - 2];
  const s = signalSeries[signalSeries.length - 1];
  const sPrev = signalSeries[signalSeries.length - 2];
  return { macd: m, signal: s, histogram: m - s, histogramPrev: mPrev - sPrev };
}

// Average True Range as a percentage of the last close — a volatility gauge.
export function atrPercent(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  const lastClose = candles[candles.length - 1].close;
  return lastClose > 0 ? (atr / lastClose) * 100 : null;
}

// Percent return over the last n trading days.
export function returnOver(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const then = closes[closes.length - 1 - days];
  const now = closes[closes.length - 1];
  return then > 0 ? ((now - then) / then) * 100 : null;
}

// Today's volume relative to the trailing average (excluding today).
export function relativeVolume(volumes: number[], period = 20): number | null {
  if (volumes.length < period + 1) return null;
  const today = volumes[volumes.length - 1];
  const avg = sma(volumes.slice(0, -1), period);
  return avg && avg > 0 ? today / avg : null;
}

// Worst peak-to-trough drawdown (%) across the series.
export function maxDrawdown(closes: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = ((c - peak) / peak) * 100;
    if (dd < worst) worst = dd;
  }
  return worst;
}

// Share of positive months — a consistency measure for long-term holds.
export function positiveMonthShare(candles: Candle[]): number | null {
  if (candles.length < 40) return null;
  const byMonth = new Map<string, { first: number; last: number }>();
  for (const c of candles) {
    const key = `${c.date.getUTCFullYear()}-${c.date.getUTCMonth()}`;
    const entry = byMonth.get(key);
    if (!entry) byMonth.set(key, { first: c.close, last: c.close });
    else entry.last = c.close;
  }
  const months = [...byMonth.values()];
  if (months.length < 3) return null;
  const positive = months.filter((m) => m.last > m.first).length;
  return positive / months.length;
}
