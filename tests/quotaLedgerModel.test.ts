/**
 * Quota ledger model: per-provider window extraction, provider aggregation
 * (headline, column order, totals, soonest reset, segments) and formatting.
 *
 * States are built through the real provider builders where one exists, so
 * these cases break if a parser change silently moves a window.
 */

import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { buildClaudeQuotaWindows } from '@/features/quota/providers/claude/data';
import { buildCodexQuotaWindows } from '@/features/quota/providers/codex/data';
import {
  buildLedgerProviderModel,
  buildLedgerProviderModels,
  collectLedgerKinds,
  extractLedgerWindows,
  formatLedgerPercent,
  formatLedgerWindowLabel,
  orderLedgerColumns,
  pickHeadlineKind,
  quotaTier,
  resolveLedgerPlan,
  resolveLedgerRowState,
  resolveLedgerWindows,
  type LedgerCredentialInput,
  type LedgerWindow,
} from '@/features/quota/ledgerModel';
import { parseMetaQuotaPayload } from '@/services/api/metaQuota';
import { buildKimiQuotaRows } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type { ClaudeQuotaState, CodexQuotaState, MetaQuotaState } from '@/types';
import { metaQuotaResponse } from './fixtures/metaQuota';

const t = ((key: string) => key) as TFunction;
const NOW = Date.parse('2099-09-11T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

/* ---------------------------------------------------------------- Claude */

interface ClaudeSpec {
  fableUsed: number;
  sevenUsed: number;
  fiveUsed: number;
  fableResetMs?: number | null;
  sevenResetMs?: number | null;
  fiveResetMs?: number | null;
}

const claudeState = (spec: ClaudeSpec): ClaudeQuotaState => ({
  status: 'success',
  planType: 'plan_max',
  windows: buildClaudeQuotaWindows(
    {
      five_hour: {
        utilization: spec.fiveUsed,
        resets_at: spec.fiveResetMs ? iso(spec.fiveResetMs) : null,
      },
      seven_day: {
        utilization: spec.sevenUsed,
        resets_at: spec.sevenResetMs ? iso(spec.sevenResetMs) : null,
      },
      limits: [
        {
          kind: 'weekly_scoped',
          percent: spec.fableUsed,
          resets_at: spec.fableResetMs ? iso(spec.fableResetMs) : null,
          is_active: true,
          scope: { model: { id: null, display_name: 'Fable 5' } },
        },
      ],
    },
    t
  ),
  dollarWindows: [
    {
      key: 'iguana_necktie',
      limitDollars: 100,
      usedDollars: 5,
      remainingDollars: 95,
      utilization: 5,
      resetsAt: iso(NOW + DAY_MS),
    },
  ],
});

/** The reference account set: five Max credentials. */
const referenceClaude = (): LedgerCredentialInput[] =>
  [
    claudeState({
      fableUsed: 42,
      sevenUsed: 21,
      fiveUsed: 0,
      fableResetMs: NOW + DAY_MS + 11 * HOUR_MS,
      sevenResetMs: NOW + DAY_MS + 11 * HOUR_MS,
    }),
    claudeState({
      fableUsed: 0,
      sevenUsed: 0,
      fiveUsed: 0,
      fableResetMs: NOW + 4 * DAY_MS,
      sevenResetMs: NOW + 4 * DAY_MS,
    }),
    claudeState({
      fableUsed: 0,
      sevenUsed: 0,
      fiveUsed: 0,
      fableResetMs: NOW + 5 * DAY_MS,
      sevenResetMs: NOW + 5 * DAY_MS,
    }),
    claudeState({
      fableUsed: 49,
      sevenUsed: 25,
      fiveUsed: 1,
      fableResetMs: NOW + DAY_MS,
      sevenResetMs: NOW + DAY_MS,
      fiveResetMs: NOW + 3 * HOUR_MS,
    }),
    claudeState({
      fableUsed: 0,
      sevenUsed: 0,
      fiveUsed: 0,
      fableResetMs: NOW + 6 * DAY_MS,
      sevenResetMs: NOW + 6 * DAY_MS,
    }),
  ].map((quota, index) => ({
    id: `claude-${index}`,
    windows: extractLedgerWindows('claude', quota),
  }));

describe('extractLedgerWindows: Claude', () => {
  test('normalizes percent used to remaining and keeps stable window keys', () => {
    const windows = extractLedgerWindows(
      'claude',
      claudeState({
        fableUsed: 42,
        sevenUsed: 21,
        fiveUsed: 0,
        fableResetMs: NOW + DAY_MS,
        sevenResetMs: NOW + 2 * DAY_MS,
      })
    );

    expect(windows).toEqual([
      {
        key: 'five-hour',
        label: 'claude_quota.five_hour',
        labelKey: 'claude_quota.five_hour',
        labelParams: undefined,
        remaining: 100,
        resetAtMs: null,
        periodHours: 5,
      },
      {
        key: 'seven-day',
        label: 'claude_quota.seven_day',
        labelKey: 'claude_quota.seven_day',
        labelParams: undefined,
        remaining: 79,
        resetAtMs: NOW + 2 * DAY_MS,
        periodHours: 168,
      },
      {
        key: 'seven-day-fable',
        label: 'claude_quota.seven_day_fable',
        labelKey: 'claude_quota.seven_day_fable',
        labelParams: undefined,
        remaining: 58,
        resetAtMs: NOW + DAY_MS,
        periodHours: 168,
      },
    ]);
  });

  test('dollar balances are not columns', () => {
    const keys = extractLedgerWindows(
      'claude',
      claudeState({ fableUsed: 0, sevenUsed: 0, fiveUsed: 0 })
    )?.map((window) => window.key);
    expect(keys).not.toContain('iguana_necktie');
  });

  test('is null unless the quota is in the success state', () => {
    const quota = claudeState({ fableUsed: 0, sevenUsed: 0, fiveUsed: 0 });
    expect(extractLedgerWindows('claude', undefined)).toBeNull();
    expect(extractLedgerWindows('claude', { ...quota, status: 'loading' })).toBeNull();
    expect(extractLedgerWindows('claude', { ...quota, status: 'error' })).toBeNull();
    expect(extractLedgerWindows('claude', { status: 'idle', windows: [] })).toBeNull();
  });

  test('retained Claude observations stay displayable while refreshing or after a failure', () => {
    const quota = claudeState({ fableUsed: 10, sevenUsed: 0, fiveUsed: 0 });
    const retained = { ...quota, status: 'loading' as const };
    expect(resolveLedgerWindows('claude', retained)?.map((window) => window.key)).toEqual([
      'five-hour',
      'seven-day',
      'seven-day-fable',
    ]);
    expect(resolveLedgerRowState('claude', retained)).toMatchObject({ kind: 'loading' });
    expect(resolveLedgerRowState('claude', { ...quota, status: 'error' }).kind).toBe('error');
    expect(
      (resolveLedgerRowState('claude', { ...quota, status: 'error' }) as { windows: unknown })
        .windows
    ).not.toBeNull();

    // Other providers never retain: a loading Codex row has nothing to show.
    expect(resolveLedgerWindows('codex', { status: 'loading', windows: [] })).toBeNull();
    expect(resolveLedgerRowState('codex', { status: 'loading' })).toEqual({
      kind: 'loading',
      windows: null,
    });
    expect(resolveLedgerRowState('codex', undefined)).toEqual({ kind: 'idle' });
    expect(resolveLedgerRowState('codex', { status: 'idle' })).toEqual({ kind: 'idle' });
  });

  test('the real OAuth usage fixture yields only percentage windows', async () => {
    const fixture = await Bun.file(
      new URL('./fixtures/claude-oauth-usage.json', import.meta.url)
    ).json();
    const windows = extractLedgerWindows('claude', {
      status: 'success',
      windows: buildClaudeQuotaWindows(fixture, t),
    });
    expect(windows?.map((window) => [window.key, window.remaining, window.periodHours])).toEqual([
      ['five-hour', 57.5, 5],
      ['seven-day', 84, 168],
      ['seven-day-sonnet', 90, 168],
      ['cloud-session-credits', 94.956405, null],
    ]);
  });
});

/* ------------------------------------------------------- provider models */

describe('Claude provider model (reference numbers)', () => {
  const model = buildLedgerProviderModel('claude', referenceClaude(), NOW);

  test('7-day Fable 5 is the headline: same period as 7-day, lower average', () => {
    expect(model.headline?.key).toBe('seven-day-fable');
    expect(model.headline?.total).toBe(409);
    expect(model.headline?.average).toBeCloseTo(81.8, 5);
    expect(model.capacity).toBe(500);
  });

  test('columns: headline, then the 5-hour session window, then native order', () => {
    expect(model.columns.map((kind) => kind.key)).toEqual([
      'seven-day-fable',
      'five-hour',
      'seven-day',
    ]);
  });

  test('others run most constrained first', () => {
    expect(model.others.map((kind) => [kind.key, kind.total])).toEqual([
      ['seven-day', 454],
      ['five-hour', 499],
    ]);
  });

  test('segments follow credential order for the headline window', () => {
    expect(model.segments.map((segment) => segment.remaining)).toEqual([58, 100, 100, 51, 100]);
    expect(model.segments.map((segment) => segment.id)).toEqual([
      'claude-0',
      'claude-1',
      'claude-2',
      'claude-3',
      'claude-4',
    ]);
  });

  test('soonest reset is the earliest future reset of that window', () => {
    expect(model.headline?.soonestResetAtMs).toBe(NOW + DAY_MS);
    // Unused 5-hour windows report no reset; only the one in use counts.
    expect(model.kinds.find((kind) => kind.key === 'five-hour')?.soonestResetAtMs).toBe(
      NOW + 3 * HOUR_MS
    );
  });

  test('loaded and credential counts', () => {
    expect(model.credentialCount).toBe(5);
    expect(model.loadedCount).toBe(5);
  });
});

describe('provider aggregation rules', () => {
  const window = (overrides: Partial<LedgerWindow> & { key: string }): LedgerWindow => ({
    label: overrides.key,
    remaining: null,
    resetAtMs: null,
    periodHours: null,
    ...overrides,
  });

  test('unloaded credentials still count toward capacity and render empty segments', () => {
    const model = buildLedgerProviderModel(
      'codex',
      [
        { id: 'a', windows: [window({ key: 'weekly', remaining: 17, periodHours: 168 })] },
        { id: 'b', windows: null },
        { id: 'c', windows: [window({ key: 'weekly', remaining: null, periodHours: 168 })] },
      ],
      NOW
    );
    expect(model.capacity).toBe(300);
    expect(model.headline?.total).toBe(17);
    expect(model.headline?.reported).toBe(1);
    expect(model.loadedCount).toBe(2);
    expect(model.segments.map((segment) => segment.remaining)).toEqual([17, null, null]);
  });

  test('a provider with nothing loaded has no kinds, no headline and an empty bar', () => {
    const model = buildLedgerProviderModel('kimi', [{ id: 'a', windows: null }], NOW);
    expect(model.kinds).toEqual([]);
    expect(model.headline).toBeNull();
    expect(model.columns).toEqual([]);
    expect(model.others).toEqual([]);
    expect(model.capacity).toBe(100);
    expect(model.segments).toEqual([{ id: 'a', remaining: null }]);
  });

  test('kinds nobody reports are headline only when nothing reports a value', () => {
    const onlyUnknown = collectLedgerKinds(
      [
        {
          id: 'a',
          windows: [window({ key: 'weekly', periodHours: 168, resetAtMs: NOW + 5 * DAY_MS })],
        },
      ],
      NOW
    );
    const headline = pickHeadlineKind(onlyUnknown);
    expect(headline?.key).toBe('weekly');
    expect(headline?.total).toBeNull();
    expect(headline?.soonestResetAtMs).toBe(NOW + 5 * DAY_MS);

    const mixed = collectLedgerKinds(
      [
        {
          id: 'a',
          windows: [
            window({ key: 'monthly', periodHours: 720 }),
            window({ key: 'five-hour', periodHours: 5, remaining: 40 }),
          ],
        },
      ],
      NOW
    );
    expect(pickHeadlineKind(mixed)?.key).toBe('five-hour');
  });

  test('an unknown period ranks below any known period', () => {
    const kinds = collectLedgerKinds(
      [
        {
          id: 'a',
          windows: [
            window({ key: 'credits', periodHours: null, remaining: 1 }),
            window({ key: 'five-hour', periodHours: 5, remaining: 90 }),
          ],
        },
      ],
      NOW
    );
    expect(pickHeadlineKind(kinds)?.key).toBe('five-hour');
  });

  test('ties fall back to native order', () => {
    const kinds = collectLedgerKinds(
      [
        {
          id: 'a',
          windows: [
            window({ key: 'first', periodHours: 168, remaining: 50 }),
            window({ key: 'second', periodHours: 168, remaining: 50 }),
          ],
        },
      ],
      NOW
    );
    expect(pickHeadlineKind(kinds)?.key).toBe('first');
  });

  test('kinds are the union of keys in order of first appearance across credentials', () => {
    const kinds = collectLedgerKinds(
      [
        { id: 'a', windows: [window({ key: 'weekly', periodHours: 168 })] },
        {
          id: 'b',
          windows: [
            window({ key: 'five-hour', periodHours: 5 }),
            window({ key: 'weekly', periodHours: 168 }),
          ],
        },
      ],
      NOW
    );
    expect(kinds.map((kind) => [kind.key, kind.order])).toEqual([
      ['weekly', 0],
      ['five-hour', 1],
    ]);
  });

  test('a kind borrows its period from the first credential that reports one', () => {
    const kinds = collectLedgerKinds(
      [
        { id: 'a', windows: [window({ key: 'weekly', periodHours: null })] },
        { id: 'b', windows: [window({ key: 'weekly', periodHours: 168 })] },
      ],
      NOW
    );
    expect(kinds[0].periodHours).toBe(168);
  });

  test('past resets never count as the soonest', () => {
    const kinds = collectLedgerKinds(
      [
        { id: 'a', windows: [window({ key: 'weekly', resetAtMs: NOW - HOUR_MS })] },
        { id: 'b', windows: [window({ key: 'weekly', resetAtMs: NOW })] },
      ],
      NOW
    );
    expect(kinds[0].soonestResetAtMs).toBeNull();
  });

  test('a session window that is the headline is not repeated in the columns', () => {
    const kinds = collectLedgerKinds(
      [
        {
          id: 'a',
          windows: [
            window({ key: 'daily', periodHours: 24 }),
            window({ key: 'five-hour', periodHours: 5, remaining: 10 }),
          ],
        },
      ],
      NOW
    );
    const headline = pickHeadlineKind(kinds);
    expect(headline?.key).toBe('five-hour');
    expect(orderLedgerColumns(kinds, headline).map((kind) => kind.key)).toEqual([
      'five-hour',
      'daily',
    ]);
    expect(orderLedgerColumns(kinds, null).map((kind) => kind.key)).toEqual(['daily', 'five-hour']);
  });

  test('models follow tab order and skip providers without credentials', () => {
    const models = buildLedgerProviderModels(
      [
        { provider: 'kimi', id: 'k', windows: null },
        { provider: 'claude', id: 'c1', windows: null },
        { provider: 'codex', id: 'x', windows: null },
        { provider: 'claude', id: 'c2', windows: null },
      ],
      NOW
    );
    expect(models.map((model) => [model.provider, model.credentialCount])).toEqual([
      ['claude', 2],
      ['codex', 1],
      ['kimi', 1],
    ]);
    expect(models[0].segments.map((segment) => segment.id)).toEqual(['c1', 'c2']);
  });
});

/* ------------------------------------------------------ other providers */

describe('extractLedgerWindows: other providers', () => {
  test('Codex: weekly is the headline over the 5-hour window; reference 17% of 300%', () => {
    const codexState = (weeklyUsed: number): CodexQuotaState => ({
      status: 'success',
      planType: 'plus',
      subscriptionActiveUntil: iso(NOW + 20 * DAY_MS),
      windows: buildCodexQuotaWindows(
        {
          rate_limit: {
            primary_window: {
              used_percent: 10,
              limit_window_seconds: 18000,
              reset_at: Math.floor((NOW + 2 * HOUR_MS) / 1000),
            },
            secondary_window: {
              used_percent: weeklyUsed,
              limit_window_seconds: 604800,
              reset_at: Math.floor((NOW + 2 * DAY_MS) / 1000),
            },
          },
          additional_rate_limits: [
            {
              limit_name: 'GPT-5.3-Codex-Spark',
              rate_limit: {
                primary_window: { used_percent: 0, limit_window_seconds: 604800 },
              },
            },
          ],
        },
        t
      ),
    });

    const first = extractLedgerWindows('codex', codexState(83));
    expect(first?.map((window) => [window.key, window.remaining, window.periodHours])).toEqual([
      ['five-hour', 90, 5],
      ['weekly', 17, 168],
      ['gpt-5-3-codex-spark-weekly-0', 100, 168],
    ]);
    // The subscription renewal date is never a window.
    expect(first?.some((window) => window.resetAtMs === NOW + 20 * DAY_MS)).toBe(false);

    const model = buildLedgerProviderModel(
      'codex',
      [83, 100, 100].map((used, index) => ({
        id: `codex-${index}`,
        windows: extractLedgerWindows('codex', codexState(used)),
      })),
      NOW
    );
    expect(model.headline?.key).toBe('weekly');
    expect(model.headline?.total).toBe(17);
    expect(model.capacity).toBe(300);
    expect(model.columns.map((kind) => kind.key)).toEqual([
      'weekly',
      'five-hour',
      'gpt-5-3-codex-spark-weekly-0',
    ]);
  });

  test('xAI: the weekly limit is a window even when usage is unavailable', () => {
    const weekly = extractLedgerWindows('xai', {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: null,
        periodEnd: iso(NOW + 5 * DAY_MS),
        productUsage: [],
        resetAtMs: NOW + 5 * DAY_MS,
        periodHours: null,
      },
    });
    expect(weekly).toEqual([
      {
        key: 'weekly',
        label: 'weekly',
        labelKey: 'xai_quota.weekly_limit',
        remaining: null,
        resetAtMs: NOW + 5 * DAY_MS,
        periodHours: 168,
      },
    ]);

    const model = buildLedgerProviderModel('xai', [{ id: 'x', windows: weekly }], NOW);
    expect(model.headline?.key).toBe('weekly');
    expect(model.headline?.total).toBeNull();
    expect(model.headline?.soonestResetAtMs).toBe(NOW + 5 * DAY_MS);
    expect(model.capacity).toBe(100);
  });

  test('xAI: a monthly billing rollover and a paid-health account expose no window', () => {
    expect(
      extractLedgerWindows('xai', {
        status: 'success',
        billing: {
          mode: 'billing',
          periodType: 'monthly',
          usagePercent: 30,
          productUsage: [],
          resetAtMs: NOW + 9 * DAY_MS,
        },
      })
    ).toEqual([]);
    expect(
      extractLedgerWindows('xai', {
        status: 'success',
        billing: { mode: 'paid-health', periodType: 'unknown', productUsage: [] },
      })
    ).toEqual([]);
    expect(extractLedgerWindows('xai', { status: 'success', billing: null })).toEqual([]);
    expect(
      extractLedgerWindows('xai', {
        status: 'success',
        billing: { mode: 'billing', periodType: 'weekly', usagePercent: 20, productUsage: [] },
      })?.[0]?.remaining
    ).toBe(80);
  });

  test('Kimi: keys come from what a row means, not its position', () => {
    const rows = buildKimiQuotaRows({
      usage: { used: '0', limit: '100', resetTime: iso(NOW + 5 * DAY_MS) },
      limits: [
        {
          window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
          detail: { used: '25', limit: '100', resetTime: iso(NOW + 2 * HOUR_MS) },
        },
      ],
    });
    const windows = extractLedgerWindows('kimi', { status: 'success', rows });
    expect(windows?.map((window) => [window.key, window.remaining, window.resetAtMs])).toEqual([
      ['kimi_quota.limit_window:duration=5h', 75, NOW + 2 * HOUR_MS],
      ['kimi_quota.weekly_limit', 100, NOW + 5 * DAY_MS],
    ]);
    expect(windows?.[0].labelParams).toEqual({ duration: '5h' });
  });

  test('Kimi: a zero limit with usage reads as exhausted, with neither as unknown', () => {
    const windows = extractLedgerWindows('kimi', {
      status: 'success',
      rows: [
        { id: 'a', label: 'Spent', used: 3, limit: 0 },
        { id: 'b', label: 'Unknown', used: 0, limit: 0 },
      ],
    });
    expect(windows?.map((window) => [window.key, window.remaining])).toEqual([
      ['label:Spent', 0],
      ['label:Unknown', null],
    ]);
  });

  test('Antigravity: fractions become percents and repeated labels are qualified by group', () => {
    const windows = extractLedgerWindows('antigravity', {
      status: 'success',
      groups: [
        {
          id: 'gemini-models',
          label: 'Gemini Models',
          buckets: [
            {
              id: 'gemini-weekly',
              label: 'Weekly Limit Remaining',
              window: 'weekly',
              remainingFraction: 0.25,
              resetAtMs: NOW + 3 * DAY_MS,
              periodHours: 168,
            },
          ],
        },
        {
          id: 'claude-and-gpt-models',
          label: 'Claude and GPT Models',
          buckets: [
            {
              id: 'claude-5h',
              label: 'Something new',
              window: '5h',
              remainingFraction: 1,
              resetAtMs: null,
              periodHours: 5,
            },
          ],
        },
      ],
    });
    expect(windows).toEqual([
      {
        key: 'gemini-models/gemini-weekly',
        label: 'Weekly Limit Remaining',
        labelKey: 'antigravity_quota.weekly_limit',
        scope: { label: 'Gemini Models', labelKey: 'antigravity_quota.group_gemini_models' },
        remaining: 25,
        resetAtMs: NOW + 3 * DAY_MS,
        periodHours: 168,
      },
      {
        key: 'claude-and-gpt-models/claude-5h',
        label: 'Something new',
        labelKey: 'antigravity_quota.five_hour_limit',
        scope: {
          label: 'Claude and GPT Models',
          labelKey: 'antigravity_quota.group_claude_gpt_models',
        },
        remaining: 100,
        resetAtMs: null,
        periodHours: 5,
      },
    ]);
    expect(formatLedgerWindowLabel(t, windows![0])).toBe(
      'antigravity_quota.group_gemini_models · antigravity_quota.weekly_limit'
    );
  });

  test('plugin buckets keep their raw labels; a single group is not qualified', () => {
    const windows = extractLedgerWindows('plugin', {
      status: 'success',
      summary: [],
      groups: [
        {
          id: 'g',
          label: 'Plan',
          buckets: [
            { id: 'daily', label: 'Daily tokens', remainingFraction: 0.5, periodHours: 24 },
          ],
        },
      ],
    });
    expect(windows).toEqual([
      {
        key: 'g/daily',
        label: 'Daily tokens',
        labelKey: undefined,
        scope: undefined,
        remaining: 50,
        resetAtMs: null,
        periodHours: 24,
      },
    ]);
    expect(formatLedgerWindowLabel(t, windows![0])).toBe('Daily tokens');
  });

  test('Devin: remaining percent windows keyed by id', () => {
    expect(
      extractLedgerWindows('devin', {
        status: 'success',
        windows: [
          { id: 'daily', remainingPercent: 40, resetAtMs: NOW + HOUR_MS, periodHours: 24 },
          { id: 'weekly', remainingPercent: null, resetAtMs: null, periodHours: 168 },
        ],
      })
    ).toEqual([
      {
        key: 'daily',
        label: 'daily',
        labelKey: 'devin_quota.daily',
        remaining: 40,
        resetAtMs: NOW + HOUR_MS,
        periodHours: 24,
      },
      {
        key: 'weekly',
        label: 'weekly',
        labelKey: 'devin_quota.weekly',
        remaining: null,
        resetAtMs: null,
        periodHours: 168,
      },
    ]);
  });

  test('Meta: the fixture yields a 5-hour window and a weekly window in Unix seconds', () => {
    const data = parseMetaQuotaPayload(metaQuotaResponse);
    const quota: MetaQuotaState = { status: 'success', data: data ?? undefined };
    const windows = extractLedgerWindows('meta', quota);
    expect(windows).toEqual([
      {
        key: 'window',
        label: 'window',
        labelKey: 'meta_quota.window_duration_hours',
        labelParams: { hours: 5 },
        remaining: 98,
        resetAtMs: 1789678120 * 1000,
        periodHours: 5,
      },
      {
        key: 'weekly',
        label: 'weekly',
        labelKey: 'meta_quota.weekly',
        labelParams: undefined,
        remaining: 100,
        resetAtMs: 1789948800 * 1000,
        periodHours: 168,
      },
    ]);
    expect(buildLedgerProviderModel('meta', [{ id: 'm', windows }], NOW).headline?.key).toBe(
      'weekly'
    );
  });

  test('a key repeated within one credential is disambiguated', () => {
    const windows = extractLedgerWindows('codex', {
      status: 'success',
      windows: [
        { id: 'weekly', label: 'A', usedPercent: 0 },
        { id: 'weekly', label: 'B', usedPercent: 0 },
      ],
    });
    expect(windows?.map((window) => window.key)).toEqual(['weekly', 'weekly#2']);
  });
});

/* ------------------------------------------------------- reset instants */

describe('reset instants outside the Date range', () => {
  const NANOSECOND_EPOCH = 1.7e18;

  test('are dropped for every provider rather than reaching a formatter', () => {
    const codex = extractLedgerWindows('codex', {
      status: 'success',
      windows: buildCodexQuotaWindows(
        {
          rate_limit: {
            secondary_window: {
              used_percent: 40,
              limit_window_seconds: 604800,
              reset_at: NANOSECOND_EPOCH,
            },
          },
        },
        t
      ),
    });
    expect(codex?.map((window) => [window.key, window.remaining, window.resetAtMs])).toEqual([
      ['weekly', 60, null],
    ]);

    const claude = extractLedgerWindows('claude', {
      status: 'success',
      windows: [{ id: 'seven-day', usedPercent: 10, resetAtMs: -9e15, periodHours: 168 }],
    });
    expect(claude?.[0].resetAtMs).toBeNull();

    const devin = extractLedgerWindows('devin', {
      status: 'success',
      windows: [{ id: 'daily', remainingPercent: 50, resetAtMs: NANOSECOND_EPOCH }],
    });
    expect(devin?.[0].resetAtMs).toBeNull();

    const xai = extractLedgerWindows('xai', {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 10,
        productUsage: [],
        resetAtMs: NANOSECOND_EPOCH,
      },
    });
    expect(xai?.[0].resetAtMs).toBeNull();

    const bucket = extractLedgerWindows('plugin', {
      status: 'success',
      groups: [
        {
          id: 'g',
          label: 'Plan',
          buckets: [{ id: 'b', label: 'Daily', remainingFraction: 0.5, resetAtMs: Infinity }],
        },
      ],
    });
    expect(bucket?.[0].resetAtMs).toBeNull();

    const kimi = extractLedgerWindows('kimi', {
      status: 'success',
      rows: [{ id: 'a', label: 'Weekly', used: 1, limit: 2, resetAtMs: 1e16 }],
    });
    expect(kimi?.[0].resetAtMs).toBeNull();

    // Meta reports Unix seconds; the range check applies after scaling to ms.
    const meta = extractLedgerWindows('meta', {
      status: 'success',
      data: {
        windows: [
          { id: 'weekly', usedPercent: 0, resetAt: 9e12 },
          { id: 'window', usedPercent: 0, resetAt: 8.64e12, durationMinutes: 300 },
        ],
      },
    });
    expect(meta?.map((window) => window.resetAtMs)).toEqual([null, 8.64e15]);
  });

  test('never become the soonest reset of a kind', () => {
    const windows = extractLedgerWindows('codex', {
      status: 'success',
      windows: [{ id: 'weekly', usedPercent: 0, resetAtMs: NANOSECOND_EPOCH, periodHours: 168 }],
    });
    const model = buildLedgerProviderModel('codex', [{ id: 'c', windows }], NOW);
    expect(model.headline?.soonestResetAtMs).toBeNull();
  });
});

/* ---------------------------------------------------------------- plans */

describe('resolveLedgerPlan', () => {
  test('reuses the card plan labels', () => {
    expect(resolveLedgerPlan('claude', { planType: 'plan_max' })).toEqual({
      key: 'claude_quota.plan_max',
    });
    expect(resolveLedgerPlan('claude', { planType: null })).toBeNull();
    expect(resolveLedgerPlan('codex', { planType: 'pro' })).toEqual({
      key: 'codex_quota.plan_pro',
    });
    expect(resolveLedgerPlan('codex', { planType: 'prolite' })).toEqual({
      key: 'codex_quota.plan_prolite',
    });
    expect(resolveLedgerPlan('codex', { planType: 'enterprise_custom' })).toEqual({
      text: 'enterprise_custom',
    });
    expect(
      resolveLedgerPlan('antigravity', {
        subscription: { plan: 'ultra', tierName: null, tierId: null },
      })
    ).toEqual({ key: 'antigravity_subscription.plan_ultra' });
    expect(
      resolveLedgerPlan('xai', {
        billing: { mode: 'billing', monthlyLimitCents: 150_000, planLabel: undefined },
      })
    ).toEqual({ key: 'xai_quota.plan_supergrok_heavy' });
    expect(
      resolveLedgerPlan('xai', { billing: { mode: 'paid-health', monthlyLimitCents: null } })
    ).toEqual({ key: 'xai_quota.plan_paid' });
    expect(resolveLedgerPlan('devin', { plan: ' Teams ' })).toEqual({ text: 'Teams' });
    expect(resolveLedgerPlan('meta', { data: { planName: 'Muse Pro', windows: [] } })).toEqual({
      text: 'Muse Pro',
    });
    expect(
      resolveLedgerPlan('plugin', { subscription: { tierName: '', plan: 'gold', tierId: null } })
    ).toEqual({ text: 'gold' });
    expect(resolveLedgerPlan('kimi', { rows: [] })).toBeNull();
    expect(resolveLedgerPlan('claude', undefined)).toBeNull();
  });
});

/* ----------------------------------------------------------- formatting */

describe('ledger formatting', () => {
  test('tiers match the QuotaMeter thresholds', () => {
    expect(quotaTier(100)).toBe('high');
    expect(quotaTier(70)).toBe('high');
    expect(quotaTier(69.9)).toBe('medium');
    expect(quotaTier(30)).toBe('medium');
    expect(quotaTier(29)).toBe('low');
    expect(quotaTier(0)).toBe('low');
    expect(quotaTier(null)).toBeNull();
    expect(quotaTier(Number.NaN)).toBeNull();
  });

  test('percent rounds and unknown reads --', () => {
    expect(formatLedgerPercent(409)).toBe('409%');
    expect(formatLedgerPercent(57.5)).toBe('58%');
    expect(formatLedgerPercent(null)).toBe('--');
  });

  test('labels prefer the translation key and fall back to the stored label', () => {
    const translate = (key: string, params?: Record<string, string | number>) =>
      params ? `${key}(${JSON.stringify(params)})` : `T:${key}`;
    expect(
      formatLedgerWindowLabel(translate, {
        key: 'k',
        label: 'Stored',
        labelKey: 'kimi_quota.limit_window',
        labelParams: { duration: '5h' },
        remaining: null,
        resetAtMs: null,
        periodHours: null,
      })
    ).toBe('kimi_quota.limit_window({"duration":"5h"})');
    expect(
      formatLedgerWindowLabel(translate, {
        key: 'k',
        label: 'Stored',
        remaining: null,
        resetAtMs: null,
        periodHours: null,
      })
    ).toBe('Stored');
  });
});
