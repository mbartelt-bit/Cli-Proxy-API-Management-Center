/**
 * Quota ledger model: one normalized row per credential, one summary per
 * provider.
 *
 * Pure, React-free and store-free — `nowMs` is always injected — so every
 * rule here is pinned directly by tests/quotaLedgerModel.test.ts.
 *
 * The provider states disagree about where a window lives and what its
 * percentage means (Claude/Codex/Meta/xAI report percent USED, Antigravity and
 * plugins a remaining fraction, Kimi raw used/limit counts, Devin a remaining
 * percent). `quotaTimelineModel.ts` and `resetSchedule.ts` read those shapes
 * structurally for their own selection rules; this module reads them the same
 * way but keeps *every* rate-limit window, normalized to remaining percent, so
 * the ledger can line windows up in columns and sum them per provider.
 *
 * Excluded, as in `resetSchedule.ts`: xAI's monthly billing rollover and the
 * Codex subscription renewal (spend caps turning over, not capacity coming
 * back) and Claude dollar balances (amounts, not percentage windows).
 */

import { toInstantMs } from '@/utils/quota/resetInstants';
import type { QuotaProviderType } from './providers/types';
import {
  QUOTA_PROGRESS_HIGH_THRESHOLD,
  QUOTA_PROGRESS_MEDIUM_THRESHOLD,
  QUOTA_TAB_ORDER,
} from './constants';
import {
  resolveAntigravityBucketLabelKey,
  resolveAntigravityGroupLabelKey,
} from './providers/antigravity/labels';
import {
  resolveAntigravityPlanLabel,
  resolveCodexPlanLabel,
  resolveXaiPlanLabel,
  type QuotaText,
} from './planLabels';

/** One rate-limit window of one credential, normalized for the ledger. */
export interface LedgerWindow {
  /** Stable across credentials of one provider — the column identity. */
  key: string;
  /** Label as stored on the state (already localized at fetch time, or raw). */
  label: string;
  /** i18n key that re-localizes the label at render time when present. */
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  /**
   * The model group a bucket belongs to, for providers whose windows repeat
   * per group. Always attached when known; whether a label shows it is decided
   * once per provider (`LedgerKind.qualifyScope`), never per credential.
   */
  scope?: { label: string; labelKey?: string };
  /** Remaining percent, 0..100; null when the window reports no usage. */
  remaining: number | null;
  /** Epoch ms inside the `Date` range, or null. */
  resetAtMs: number | null;
  periodHours: number | null;
}

/* ------------------------------------------------------------ extraction */

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const positiveOrNull = (value: unknown): number | null => {
  const numeric = finiteOrNull(value);
  return numeric !== null && numeric > 0 ? numeric : null;
};

/**
 * A reset instant the UI can format, or null. Every `resetAtMs` goes through
 * here: upstream parsers pass any positive number, and one nanosecond epoch
 * outside the `Date` range would otherwise make `toISOString()` throw and
 * blank the page.
 */
const instantOrNull = toInstantMs;

/** Percent-used providers: remaining is the complement, clamped. */
const remainingFromUsed = (used: unknown): number | null => {
  const numeric = finiteOrNull(used);
  return numeric === null ? null : clampPercent(100 - numeric);
};

const WEEK_HOURS = 24 * 7;
const SESSION_PERIOD_HOURS = 5;

/**
 * Window length implied by a bucket's `window`, for buckets whose state has
 * no period. The bucket builder only knows 5-hour and weekly periods, yet
 * plugins also report daily and monthly windows, which would otherwise rank
 * last in the "longest window governs" headline rule. Same spellings as the
 * Antigravity label resolver (`BUCKET_WINDOW_KEYS`).
 */
const BUCKET_WINDOW_HOURS = new Map<string, number>([
  ['5h', SESSION_PERIOD_HOURS],
  ['five-hour', SESSION_PERIOD_HOURS],
  ['five_hour', SESSION_PERIOD_HOURS],
  ['daily', 24],
  ['day', 24],
  ['weekly', WEEK_HOURS],
  ['week', WEEK_HOURS],
  ['monthly', 24 * 30],
  ['month', 24 * 30],
]);

const bucketWindowHours = (window: string | undefined): number | null =>
  typeof window === 'string'
    ? (BUCKET_WINDOW_HOURS.get(window.trim().toLowerCase().replace(/\s+/g, ' ')) ?? null)
    : null;

interface PercentUsedWindowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface DevinWindowLike {
  id: string;
  label?: string;
  remainingPercent: number | null;
  resetAtMs: number | null;
  periodHours?: number | null;
}

interface XaiBillingLike {
  mode?: string;
  periodType?: string;
  usagePercent?: number | null;
  periodEnd?: string;
  productUsage?: unknown[];
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface BucketGroupLike {
  id?: string;
  label?: string;
  buckets?: {
    id?: string;
    label?: string;
    window?: string;
    remainingFraction?: number | null;
    resetAtMs?: number | null;
    periodHours?: number | null;
  }[];
}

interface KimiRowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  used: number;
  limit: number;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface MetaWindowLike {
  id: string;
  usedPercent: number | null;
  /** Unix seconds from the upstream Meta contract. */
  resetAt?: number;
  durationMinutes?: number;
}

const stableParams = (params: Record<string, string | number>): string =>
  Object.keys(params)
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join(',');

/** A key from what a window *means*: its label key plus any parameters. */
const semanticKey = (labelKey: string, params?: Record<string, string | number>): string =>
  params && Object.keys(params).length > 0 ? `${labelKey}:${stableParams(params)}` : labelKey;

type WindowKeyFn = (window: PercentUsedWindowLike, index: number) => string;

const windowIdKey: WindowKeyFn = (window, index) => window.id || `window-${index}`;

/**
 * Codex model-scoped windows (`additional_rate_limits`) carry their position
 * in that list in the id (`gpt-5-3-codex-spark-weekly-0`), and accounts list
 * those limits in different orders. They are the only Codex windows with label
 * parameters (the model name), so those are keyed by meaning — label key and
 * name — the way Kimi rows are. The fixed windows keep their semantic ids.
 */
const codexWindowKey: WindowKeyFn = (window, index) =>
  window.labelKey && window.labelParams && Object.keys(window.labelParams).length > 0
    ? semanticKey(window.labelKey, window.labelParams)
    : windowIdKey(window, index);

const fromPercentUsedWindows = (
  windows: readonly PercentUsedWindowLike[],
  keyFor: WindowKeyFn
): LedgerWindow[] =>
  windows.map((window, index) => ({
    key: keyFor(window, index),
    label: window.label ?? '',
    labelKey: window.labelKey,
    labelParams: window.labelParams,
    remaining: remainingFromUsed(window.usedPercent),
    resetAtMs: instantOrNull(window.resetAtMs),
    periodHours: positiveOrNull(window.periodHours),
  }));

const fromDevinWindows = (windows: readonly DevinWindowLike[]): LedgerWindow[] =>
  windows.map((window): LedgerWindow => {
    const remaining = finiteOrNull(window.remainingPercent);
    return {
      key: window.id,
      label: window.label ?? window.id,
      labelKey: `devin_quota.${window.id}`,
      remaining: remaining === null ? null : clampPercent(remaining),
      resetAtMs: instantOrNull(window.resetAtMs),
      periodHours: positiveOrNull(window.periodHours),
    };
  });

/**
 * Only the weekly limit is a quota window. The monthly figure is a billing
 * cycle; paid-health accounts expose no window at all. Mirrors the card's
 * `hasWeeklyData`, so a weekly limit with unavailable usage still shows (as
 * `--` with its reset) exactly as the card shows it.
 */
const fromXaiBilling = (billing: XaiBillingLike | null | undefined): LedgerWindow[] => {
  if (!billing || billing.mode === 'paid-health' || billing.periodType !== 'weekly') return [];
  const used = finiteOrNull(billing.usagePercent);
  const hasWeeklyData =
    used !== null || Boolean(billing.periodEnd) || (billing.productUsage?.length ?? 0) > 0;
  if (!hasWeeklyData) return [];
  return [
    {
      key: 'weekly',
      label: 'weekly',
      labelKey: 'xai_quota.weekly_limit',
      remaining: used === null ? null : clampPercent(100 - used),
      resetAtMs: instantOrNull(billing.resetAtMs),
      periodHours: positiveOrNull(billing.periodHours) ?? WEEK_HOURS,
    },
  ];
};

/**
 * Bucket labels repeat per model group ("Weekly limit" twice), so every bucket
 * carries its group as `scope`. Whether labels show it depends on how many
 * groups the *provider* has across all credentials — see `collectLedgerKinds`
 * — so a column reads the same in every row and in the summary.
 */
const fromBucketGroups = (
  provider: 'antigravity' | 'plugin',
  groups: readonly BucketGroupLike[]
): LedgerWindow[] =>
  groups.flatMap((group, groupIndex) => {
    const groupLabel = (group.label ?? '').trim();
    const groupLabelKey =
      provider === 'antigravity' ? resolveAntigravityGroupLabelKey(groupLabel) : null;
    const scope = groupLabel
      ? {
          label: groupLabel,
          labelKey: groupLabelKey ? `antigravity_quota.${groupLabelKey}` : undefined,
        }
      : undefined;
    return (group.buckets ?? []).map((bucket, bucketIndex): LedgerWindow => {
      const bucketLabelKey =
        provider === 'antigravity'
          ? resolveAntigravityBucketLabelKey(bucket.label ?? '', bucket.window)
          : null;
      const fraction = finiteOrNull(bucket.remainingFraction);
      return {
        key: `${group.id || `group-${groupIndex}`}/${bucket.id || `bucket-${bucketIndex}`}`,
        label: bucket.label ?? '',
        labelKey: bucketLabelKey ? `antigravity_quota.${bucketLabelKey}` : undefined,
        scope,
        // Remaining FRACTION, the inverse of the percent-used providers.
        remaining: fraction === null ? null : clampPercent(fraction * 100),
        resetAtMs: instantOrNull(bucket.resetAtMs),
        periodHours: positiveOrNull(bucket.periodHours) ?? bucketWindowHours(bucket.window),
      };
    });
  });

/**
 * Kimi row ids are positional (`limit-0`), so the key comes from what the row
 * *means* — its label key and parameters — which is what lines up across
 * accounts. Remaining follows the card's arithmetic exactly.
 */
const fromKimiRows = (rows: readonly KimiRowLike[]): LedgerWindow[] =>
  rows.map((row, index): LedgerWindow => {
    const key = row.labelKey
      ? semanticKey(row.labelKey, row.labelParams)
      : row.label
        ? `label:${row.label}`
        : row.id || `row-${index}`;
    const remaining =
      row.limit > 0
        ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100))
        : row.used > 0
          ? 0
          : null;
    return {
      key,
      label: row.label ?? '',
      labelKey: row.labelKey,
      labelParams: row.labelParams,
      remaining,
      resetAtMs: instantOrNull(row.resetAtMs),
      periodHours: positiveOrNull(row.periodHours),
    };
  });

const fromMetaWindows = (windows: readonly MetaWindowLike[]): LedgerWindow[] =>
  windows.map((window): LedgerWindow => {
    const minutes = window.id === 'window' ? positiveOrNull(window.durationMinutes) : null;
    const resetAt = finiteOrNull(window.resetAt);
    return {
      key: window.id,
      label: window.id,
      labelKey:
        minutes === null
          ? `meta_quota.${window.id}`
          : minutes % 60 === 0
            ? 'meta_quota.window_duration_hours'
            : 'meta_quota.window_duration',
      labelParams:
        minutes === null ? undefined : minutes % 60 === 0 ? { hours: minutes / 60 } : { minutes },
      remaining: remainingFromUsed(window.usedPercent),
      resetAtMs: resetAt === null ? null : instantOrNull(resetAt * 1000),
      // The upstream weekly bucket has no duration field; its scope defines it.
      periodHours: window.id === 'weekly' ? WEEK_HOURS : minutes === null ? null : minutes / 60,
    };
  });

/** Disambiguate a key that repeats within one credential (`key`, `key#2`, …). */
const withUniqueKeys = (windows: LedgerWindow[]): LedgerWindow[] => {
  const seen = new Map<string, number>();
  return windows.map((window) => {
    const count = (seen.get(window.key) ?? 0) + 1;
    seen.set(window.key, count);
    return count === 1 ? window : { ...window, key: `${window.key}#${count}` };
  });
};

/**
 * Every rate-limit window of one credential, or null unless its quota is in
 * the 'success' state.
 */
export function extractLedgerWindows(
  provider: QuotaProviderType,
  quota: unknown
): LedgerWindow[] | null {
  const state = quota as { status?: string } | null | undefined;
  if (!state || state.status !== 'success') return null;

  switch (provider) {
    case 'claude':
    case 'codex':
      return withUniqueKeys(
        fromPercentUsedWindows(
          (quota as { windows?: PercentUsedWindowLike[] }).windows ?? [],
          provider === 'codex' ? codexWindowKey : windowIdKey
        )
      );
    case 'devin':
      return withUniqueKeys(
        fromDevinWindows((quota as { windows?: DevinWindowLike[] }).windows ?? [])
      );
    case 'xai':
      return fromXaiBilling((quota as { billing?: XaiBillingLike | null }).billing);
    case 'antigravity':
    case 'plugin':
      return withUniqueKeys(
        fromBucketGroups(provider, (quota as { groups?: BucketGroupLike[] }).groups ?? [])
      );
    case 'kimi':
      return withUniqueKeys(fromKimiRows((quota as { rows?: KimiRowLike[] }).rows ?? []));
    case 'meta':
      return withUniqueKeys(
        fromMetaWindows((quota as { data?: { windows?: MetaWindowLike[] } }).data?.windows ?? [])
      );
    default:
      return [];
  }
}

/**
 * Windows the ledger should display for a credential.
 *
 * Same as `extractLedgerWindows`, plus one deliberate exception: the Claude
 * store keeps the last observed windows on a credential while it refreshes or
 * after a failed read (the card keeps showing them too), so those retained
 * observations stay visible rather than collapsing to a skeleton or an error.
 */
export function resolveLedgerWindows(
  provider: QuotaProviderType,
  quota: unknown
): LedgerWindow[] | null {
  const state = quota as { status?: string; windows?: unknown[] } | null | undefined;
  if (!state) return null;
  if (state.status === 'success') return extractLedgerWindows(provider, quota);
  if (
    provider === 'claude' &&
    (state.status === 'loading' || state.status === 'error') &&
    Array.isArray(state.windows) &&
    state.windows.length > 0
  ) {
    return extractLedgerWindows(provider, { ...state, status: 'success' });
  }
  return null;
}

/** Row presentation state for one credential. */
export type LedgerRowState =
  | { kind: 'idle' }
  | { kind: 'loading'; windows: LedgerWindow[] | null }
  | { kind: 'error'; windows: LedgerWindow[] | null }
  | { kind: 'ready'; windows: LedgerWindow[] };

export function resolveLedgerRowState(
  provider: QuotaProviderType,
  quota: { status?: string } | null | undefined
): LedgerRowState {
  const status = quota?.status ?? 'idle';
  if (status === 'success') {
    return { kind: 'ready', windows: extractLedgerWindows(provider, quota) ?? [] };
  }
  if (status === 'loading')
    return { kind: 'loading', windows: resolveLedgerWindows(provider, quota) };
  if (status === 'error') return { kind: 'error', windows: resolveLedgerWindows(provider, quota) };
  return { kind: 'idle' };
}

/** The plan a credential is on, as the provider card labels it; null if unknown. */
export function resolveLedgerPlan(provider: QuotaProviderType, quota: unknown): QuotaText | null {
  if (!quota || typeof quota !== 'object') return null;
  const nonEmpty = (value: unknown): QuotaText | null =>
    typeof value === 'string' && value.trim() ? { text: value.trim() } : null;

  switch (provider) {
    case 'claude': {
      const planType = (quota as { planType?: string | null }).planType;
      return planType ? { key: `claude_quota.${planType}` } : null;
    }
    case 'codex':
      return resolveCodexPlanLabel((quota as { planType?: string | null }).planType);
    case 'antigravity':
      return resolveAntigravityPlanLabel(
        (quota as { subscription?: Parameters<typeof resolveAntigravityPlanLabel>[0] }).subscription
      );
    case 'plugin': {
      const subscription = (
        quota as {
          subscription?: { tierName?: string | null; plan?: string | null; tierId?: string | null };
        }
      ).subscription;
      return nonEmpty(subscription?.tierName || subscription?.plan || subscription?.tierId);
    }
    case 'xai':
      return resolveXaiPlanLabel(
        (quota as { billing?: Parameters<typeof resolveXaiPlanLabel>[0] }).billing
      );
    case 'devin':
      return nonEmpty((quota as { plan?: string | null }).plan);
    case 'meta':
      return nonEmpty((quota as { data?: { planName?: string } }).data?.planName);
    default:
      return null;
  }
}

/* ---------------------------------------------------------- aggregation */

/** A window kind across a provider's credentials, with its aggregates. */
export interface LedgerKind {
  key: string;
  /** First window seen with this key — carries the label. */
  sample: LedgerWindow;
  periodHours: number | null;
  /** Position of first appearance: the provider's native window order. */
  order: number;
  /** Sum of known remaining percents; null when no credential reports one. */
  total: number | null;
  /** Credentials reporting a known remaining percent for this kind. */
  reported: number;
  average: number | null;
  /** Earliest reset still in the future, across credentials. */
  soonestResetAtMs: number | null;
  /**
   * Whether this column's label names its group (`sample.scope`). Decided once
   * per provider — true when its credentials span more than one group — so
   * every cell of a column and the summary share one label.
   */
  qualifyScope: boolean;
}

export interface LedgerCredentialInput {
  id: string;
  /** Null when the credential is not loaded (or failed without data). */
  windows: readonly LedgerWindow[] | null;
}

export interface LedgerSegment {
  id: string;
  remaining: number | null;
}

export interface LedgerProviderModel {
  provider: QuotaProviderType;
  credentialCount: number;
  /** Credentials contributing windows. */
  loadedCount: number;
  /** Native order. */
  kinds: LedgerKind[];
  headline: LedgerKind | null;
  /** Row column order: headline, the 5-hour session kind, then native order. */
  columns: LedgerKind[];
  /** Non-headline kinds, most constrained (lowest average remaining) first. */
  others: LedgerKind[];
  /** Window labels name their group: the credentials span more than one group. */
  qualifyScopes: boolean;
  /** 100 × credentials in scope — the denominator of the headline total. */
  capacity: number;
  /** One per credential in input order: its remaining for the headline kind. */
  segments: LedgerSegment[];
}

const scopeIdentity = (window: LedgerWindow): string | null =>
  window.scope ? window.scope.labelKey || window.scope.label || null : null;

/**
 * Whether window labels must name their group: only when the provider's
 * credentials, taken together, span more than one group. Deciding this per
 * credential made one column read "Weekly limit" in one row and "Gemini ·
 * Weekly limit" in the next, and the summary label depend on row order.
 */
const spansScopes = (credentials: readonly LedgerCredentialInput[]): boolean => {
  const scopes = new Set<string>();
  for (const credential of credentials) {
    for (const window of credential.windows ?? []) {
      const scope = scopeIdentity(window);
      if (scope !== null) scopes.add(scope);
      if (scopes.size > 1) return true;
    }
  }
  return false;
};

/** Union of window keys across credentials, in order of first appearance. */
export function collectLedgerKinds(
  credentials: readonly LedgerCredentialInput[],
  nowMs: number
): LedgerKind[] {
  const qualify = spansScopes(credentials);
  const kinds = new Map<string, LedgerKind>();
  for (const credential of credentials) {
    for (const window of credential.windows ?? []) {
      let kind = kinds.get(window.key);
      if (!kind) {
        kind = {
          key: window.key,
          sample: window,
          periodHours: window.periodHours,
          order: kinds.size,
          total: null,
          reported: 0,
          average: null,
          soonestResetAtMs: null,
          qualifyScope: qualify && window.scope !== undefined,
        };
        kinds.set(window.key, kind);
      }
      if (kind.periodHours === null && window.periodHours !== null) {
        kind.periodHours = window.periodHours;
      }
      if (window.remaining !== null) {
        kind.total = (kind.total ?? 0) + window.remaining;
        kind.reported += 1;
      }
      if (
        window.resetAtMs !== null &&
        window.resetAtMs > nowMs &&
        (kind.soonestResetAtMs === null || window.resetAtMs < kind.soonestResetAtMs)
      ) {
        kind.soonestResetAtMs = window.resetAtMs;
      }
    }
  }
  return [...kinds.values()].map((kind) => ({
    ...kind,
    average: kind.total === null || kind.reported === 0 ? null : kind.total / kind.reported,
  }));
}

/** Longest period first (unknown last), then lowest average (unknown last), then native order. */
const compareHeadline = (a: LedgerKind, b: LedgerKind): number => {
  const periodA = a.periodHours ?? -Infinity;
  const periodB = b.periodHours ?? -Infinity;
  if (periodA !== periodB) return periodB > periodA ? 1 : -1;
  const averageA = a.average ?? Infinity;
  const averageB = b.average ?? Infinity;
  if (averageA !== averageB) return averageA < averageB ? -1 : 1;
  return a.order - b.order;
};

/**
 * The window that best represents a provider's capacity.
 *
 * The longest window governs: a fresh 5-hour window says little when the
 * weekly one is nearly spent. Among equally long windows, the one with the
 * least left on average is the binding constraint. Kinds nobody reports a
 * value for are only considered when nothing reports one — then the summary
 * still names the window and shows its reset, just with no aggregate.
 */
export function pickHeadlineKind(kinds: readonly LedgerKind[]): LedgerKind | null {
  if (kinds.length === 0) return null;
  const known = kinds.filter((kind) => kind.reported > 0);
  const pool = known.length > 0 ? known : kinds;
  return [...pool].sort(compareHeadline)[0];
}

const isSessionKind = (kind: LedgerKind) =>
  kind.periodHours !== null && Math.abs(kind.periodHours - SESSION_PERIOD_HOURS) < 0.01;

/** `[headline, the 5-hour session kind, ...rest in native order]`. */
export function orderLedgerColumns(
  kinds: readonly LedgerKind[],
  headline: LedgerKind | null
): LedgerKind[] {
  if (!headline) return [...kinds];
  const rest = kinds.filter((kind) => kind.key !== headline.key);
  const session = rest.find(isSessionKind);
  return [headline, ...(session ? [session] : []), ...rest.filter((kind) => kind !== session)];
}

const compareConstraint = (a: LedgerKind, b: LedgerKind): number => {
  const averageA = a.average ?? Infinity;
  const averageB = b.average ?? Infinity;
  if (averageA !== averageB) return averageA < averageB ? -1 : 1;
  return a.order - b.order;
};

export function buildLedgerProviderModel(
  provider: QuotaProviderType,
  credentials: readonly LedgerCredentialInput[],
  nowMs: number
): LedgerProviderModel {
  const kinds = collectLedgerKinds(credentials, nowMs);
  const headline = pickHeadlineKind(kinds);
  return {
    provider,
    credentialCount: credentials.length,
    loadedCount: credentials.filter((credential) => credential.windows !== null).length,
    kinds,
    headline,
    columns: orderLedgerColumns(kinds, headline),
    others: kinds.filter((kind) => kind.key !== headline?.key).sort(compareConstraint),
    qualifyScopes: kinds.some((kind) => kind.qualifyScope),
    capacity: 100 * credentials.length,
    segments: credentials.map((credential) => ({
      id: credential.id,
      remaining:
        headline === null
          ? null
          : (credential.windows?.find((window) => window.key === headline.key)?.remaining ?? null),
    })),
  };
}

export interface LedgerEntryInput extends LedgerCredentialInput {
  provider: QuotaProviderType;
}

/**
 * One model per provider that has at least one credential in scope, in tab
 * order. Credentials keep their input order within a provider, so segments
 * line up with the rows below them.
 */
export function buildLedgerProviderModels(
  entries: readonly LedgerEntryInput[],
  nowMs: number,
  providerOrder: readonly QuotaProviderType[] = QUOTA_TAB_ORDER
): LedgerProviderModel[] {
  const byProvider = new Map<QuotaProviderType, LedgerCredentialInput[]>();
  for (const entry of entries) {
    const list = byProvider.get(entry.provider) ?? [];
    list.push({ id: entry.id, windows: entry.windows });
    byProvider.set(entry.provider, list);
  }
  return providerOrder
    .filter((provider) => (byProvider.get(provider)?.length ?? 0) > 0)
    .map((provider) => buildLedgerProviderModel(provider, byProvider.get(provider) ?? [], nowMs));
}

/* ----------------------------------------------------------- formatting */

export type QuotaTier = 'high' | 'medium' | 'low';

/** The QuotaMeter three tiers; null when there is nothing to colour. */
export function quotaTier(remaining: number | null): QuotaTier | null {
  if (remaining === null || !Number.isFinite(remaining)) return null;
  if (remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD) return 'high';
  if (remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

/** `58%`, or `--` when unknown. */
export function formatLedgerPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '--' : `${Math.round(value)}%`;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The window's own localized name (`Weekly limit`), without its group. */
export function formatLedgerWindowName(t: Translate, window: LedgerWindow): string {
  return window.labelKey ? t(window.labelKey, window.labelParams) : window.label;
}

/**
 * The window's localized group (`Gemini models`) when `qualifyScope` says
 * labels name it; null otherwise. Pass the column's `LedgerKind.qualifyScope`
 * — a provider-level decision — so every cell of a column reads the same.
 */
export function formatLedgerWindowScope(
  t: Translate,
  window: LedgerWindow,
  qualifyScope: boolean
): string | null {
  if (!qualifyScope || !window.scope) return null;
  const scope = window.scope.labelKey ? t(window.scope.labelKey) : window.scope.label;
  return scope || null;
}

/**
 * Localized window label, followed by its group when `qualifyScope` says so:
 * `Weekly limit · Gemini models`. The window name leads so that, where the
 * label is cut short, the qualifier goes first and the window stays legible.
 */
export function formatLedgerWindowLabel(
  t: Translate,
  window: LedgerWindow,
  qualifyScope: boolean
): string {
  const name = formatLedgerWindowName(t, window);
  const scope = formatLedgerWindowScope(t, window, qualifyScope);
  return scope ? `${name} · ${scope}` : name;
}

/** The label every cell of a column, and the summary, show for it. */
export function formatLedgerKindLabel(t: Translate, kind: LedgerKind): string {
  return formatLedgerWindowLabel(t, kind.sample, kind.qualifyScope);
}
