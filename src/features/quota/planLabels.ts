/**
 * Plan labels shared by the provider card bodies and the quota ledger.
 *
 * Returned as descriptors — an i18n key or a raw upstream string — rather than
 * translated text, so this stays React-free and the ledger model can carry a
 * plan without a `t` in hand. One source of truth keeps a row's "Pro 200" from
 * drifting away from the card's.
 */

import type { AntigravityQuotaSubscription, XaiBillingSummary } from '@/types';
import { normalizePlanType, PREMIUM_CODEX_PLAN_TYPES } from '@/utils/quota';

/** Display text: translate `key` (with `params`) or show `text` verbatim. */
export type QuotaText =
  { key: string; params?: Record<string, string | number> } | { text: string };

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const formatQuotaText = (t: Translate, value: QuotaText): string =>
  'key' in value ? t(value.key, value.params) : value.text;

export function resolveCodexPlanLabel(planType: string | null | undefined): QuotaText | null {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'self_serve_business_prolite') {
    return { key: 'codex_quota.plan_business_premium' };
  }
  if (normalized === 'pro') return { key: 'codex_quota.plan_pro' };
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return { key: 'codex_quota.plan_prolite' };
  if (normalized === 'plus') return { key: 'codex_quota.plan_plus' };
  if (normalized === 'team') return { key: 'codex_quota.plan_team' };
  if (normalized === 'free') return { key: 'codex_quota.plan_free' };
  return { text: planType || normalized };
}

export function resolveAntigravityPlanLabel(
  subscription: AntigravityQuotaSubscription | null | undefined
): QuotaText | null {
  if (!subscription) return null;
  if (subscription.plan === 'free') return { key: 'antigravity_subscription.plan_free' };
  if (subscription.plan === 'pro') return { key: 'antigravity_subscription.plan_pro' };
  if (subscription.plan === 'ultra') return { key: 'antigravity_subscription.plan_ultra' };
  if (subscription.plan === 'ultra-lite') {
    return { key: 'antigravity_subscription.plan_ultra_lite' };
  }
  const raw = subscription.tierName || subscription.tierId;
  if (raw) return { text: raw };
  return subscription.plan === 'unknown' ? { key: 'antigravity_subscription.plan_unknown' } : null;
}

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

/** SuperGrok tiers are recognisable only by their monthly included credit. */
export function resolveXaiPlan(
  monthlyLimitCents: number | null
): { labelKey: string; premium: boolean } | null {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok', premium: false };
  }
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok_heavy', premium: true };
  }
  return null;
}

export function resolveXaiPlanLabel(
  billing: XaiBillingSummary | null | undefined
): QuotaText | null {
  if (!billing) return null;
  if (billing.planLabel) return { text: billing.planLabel };
  if (billing.mode === 'paid-health') return { key: 'xai_quota.plan_paid' };
  const plan = resolveXaiPlan(billing.monthlyLimitCents);
  return plan ? { key: `xai_quota.${plan.labelKey}` } : null;
}
