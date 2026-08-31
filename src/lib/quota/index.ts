import "server-only";
import { getStore } from "../db";
import {
  QUOTA_LIMITS,
  currentPeriods,
  effectiveCap,
  reserveWith,
  type QuotaDecision,
  type QuotaKey,
} from "./limits";

export interface QuotaState {
  key: QuotaKey;
  label: string;
  monthlyUsed: number;
  dailyUsed: number;
  monthlyCap?: number;
  dailyCap?: number;
  /** True when either cap is exhausted. */
  blocked: boolean;
  blockedReason?: string;
  /** 0-1, the tighter of the two ratios. */
  utilisation: number;
  freeTierNote: string;
  /** ISO date the daily counter rolls over. */
  resetsDaily: string;
  resetsMonthly: string;
}

/**
 * Reserve one API call against a quota.
 *
 * Returns false when the call must not be made. Reservation happens *before*
 * the request so a burst of parallel calls can't collectively overshoot, which
 * is the whole point — the counter is the thing that keeps usage inside the
 * free tier, not the vendor's own limit.
 */
export async function reserve(key: QuotaKey, count = 1): Promise<QuotaDecision> {
  const store = await getStore();
  return reserveWith(store, key, count);
}

/** Check without consuming — used by diagnostics and the UI. */
export async function peek(key: QuotaKey): Promise<QuotaState> {
  const limit = QUOTA_LIMITS[key];
  const cap = effectiveCap(key);
  const { month, day } = currentPeriods();
  const store = await getStore();

  const [monthlyUsed, dailyUsed] = await Promise.all([
    store.getUsage(key, "month", month),
    store.getUsage(key, "day", day),
  ]);

  const monthlyRatio = cap.monthly ? monthlyUsed / cap.monthly : 0;
  const dailyRatio = cap.daily ? dailyUsed / cap.daily : 0;

  const monthlyBlocked = cap.monthly !== undefined && monthlyUsed >= cap.monthly;
  const dailyBlocked = cap.daily !== undefined && dailyUsed >= cap.daily;

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextMonth = new Date();
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);

  return {
    key,
    label: limit.label,
    monthlyUsed,
    dailyUsed,
    monthlyCap: cap.monthly,
    dailyCap: cap.daily,
    blocked: monthlyBlocked || dailyBlocked,
    blockedReason: monthlyBlocked
      ? cap.monthly === 0
        ? "Disabled (cap set to 0)"
        : "Monthly cap reached"
      : dailyBlocked
        ? "Daily cap reached"
        : undefined,
    utilisation: Math.min(1, Math.max(monthlyRatio, dailyRatio)),
    freeTierNote: limit.freeTier.note,
    resetsDaily: tomorrow.toISOString().slice(0, 10),
    resetsMonthly: nextMonth.toISOString().slice(0, 10),
  };
}

/** Every quota, for the Settings page. */
export async function allQuotas(): Promise<QuotaState[]> {
  const keys = Object.keys(QUOTA_LIMITS) as QuotaKey[];
  return Promise.all(keys.map((k) => peek(k)));
}

export { QUOTA_LIMITS, QUOTA_FOR_SOURCE, effectiveCap, evaluateQuota, reserveWith } from "./limits";
export type { QuotaKey, QuotaDecision, UsageCounter } from "./limits";

/** Raised when a provider is asked to run with no budget left. */
export class QuotaExceededError extends Error {
  constructor(
    message: string,
    readonly quotaKey: QuotaKey,
  ) {
    super(message);
    this.name = "QuotaExceededError";
  }
}
