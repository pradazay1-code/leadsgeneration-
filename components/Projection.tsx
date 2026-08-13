"use client";

// Investment projection calculator ("what if I invest $50/week?").
// Uses the stock's own history — a dampened expected return (its capped 2-year
// CAGR blended 50/50 with a market-like 8%/yr) and its real volatility — to
// project three scenarios. The band is ±1 standard deviation of the annualized
// return over the chosen horizon (~68% of historical-like outcomes), which is
// an honest range, not a promise.

import { useMemo, useState } from "react";

interface Props {
  symbol: string;
  muAnnual: number; // dampened expected annual return, e.g. 0.09
  sigmaAnnual: number; // annualized volatility, e.g. 0.28
}

const FREQS = [
  { label: "per week", periodsPerYear: 52 },
  { label: "per month", periodsPerYear: 12 },
] as const;

function futureValue(
  initial: number,
  contribution: number,
  periodsPerYear: number,
  years: number,
  annualReturn: number,
): number {
  const periods = Math.round(periodsPerYear * years);
  const r = Math.pow(1 + annualReturn, 1 / periodsPerYear) - 1;
  let fv = initial;
  for (let i = 0; i < periods; i++) fv = fv * (1 + r) + contribution;
  return fv;
}

const money = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function Projection({ symbol, muAnnual, sigmaAnnual }: Props) {
  const [initial, setInitial] = useState(0);
  const [contribution, setContribution] = useState(50);
  const [freqIdx, setFreqIdx] = useState(0);
  const [years, setYears] = useState(5);

  const { contributed, scenarios } = useMemo(() => {
    const ppy = FREQS[freqIdx].periodsPerYear;
    const totalContributed = initial + contribution * Math.round(ppy * years);
    // Std deviation of the *annualized* return shrinks with horizon: σ/√T.
    const bandSigma = sigmaAnnual / Math.sqrt(Math.max(years, 0.25));
    const rates = {
      conservative: muAnnual - bandSigma,
      expected: muAnnual,
      optimistic: muAnnual + bandSigma,
    };
    return {
      contributed: totalContributed,
      scenarios: (
        [
          ["Conservative", rates.conservative],
          ["Expected", rates.expected],
          ["Optimistic", rates.optimistic],
        ] as const
      ).map(([label, rate]) => {
        const fv = futureValue(initial, contribution, ppy, years, rate);
        return {
          label,
          rate,
          value: fv,
          profit: fv - totalContributed,
        };
      }),
    };
  }, [initial, contribution, freqIdx, years, muAnnual, sigmaAnnual]);

  return (
    <div className="projection">
      <div className="proj-controls">
        <label className="proj-field">
          <span>Starting amount</span>
          <div className="proj-input">
            $
            <input
              type="number"
              min={0}
              step={10}
              value={initial}
              onChange={(e) => setInitial(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </label>
        <label className="proj-field">
          <span>Recurring investment</span>
          <div className="proj-input">
            $
            <input
              type="number"
              min={0}
              step={5}
              value={contribution}
              onChange={(e) => setContribution(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </label>
        <label className="proj-field">
          <span>Frequency</span>
          <select value={freqIdx} onChange={(e) => setFreqIdx(Number(e.target.value))}>
            {FREQS.map((f, i) => (
              <option key={f.label} value={i}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="proj-field">
          <span>Time horizon: {years} {years === 1 ? "year" : "years"}</span>
          <input
            type="range"
            min={1}
            max={15}
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
          />
        </label>
      </div>

      <p className="proj-summary">
        Investing <b>{money(contribution)}</b> {FREQS[freqIdx].label}
        {initial > 0 ? <> (starting with <b>{money(initial)}</b>)</> : null} in{" "}
        <b>{symbol}</b> for <b>{years} {years === 1 ? "year" : "years"}</b> means putting in{" "}
        <b>{money(contributed)}</b> total. Based on this stock&apos;s dampened historical return
        ({(muAnnual * 100).toFixed(1)}%/yr) and real volatility ({(sigmaAnnual * 100).toFixed(0)}%):
      </p>

      <div className="proj-grid">
        {scenarios.map((s) => (
          <div key={s.label} className={`proj-card ${s.label.toLowerCase()}`}>
            <div className="proj-label">{s.label}</div>
            <div className="proj-rate">{(s.rate * 100).toFixed(1)}%/yr</div>
            <div className="proj-value">{money(s.value)}</div>
            <div className={`proj-profit ${s.profit >= 0 ? "up" : "down"}`}>
              {s.profit >= 0 ? "+" : "−"}
              {money(Math.abs(s.profit))} vs contributions
            </div>
          </div>
        ))}
      </div>

      <p className="proj-note">
        The conservative–optimistic band covers roughly two-thirds of outcomes if the future
        resembles the past — real results can land outside it, including losing money. No
        projection is a guarantee.
      </p>
    </div>
  );
}
