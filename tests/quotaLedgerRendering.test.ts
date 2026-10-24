/**
 * Ledger summary cells and ledger rows rendered as static markup.
 *
 * Under `bun test` a `.module.scss` import is the raw stylesheet string, so
 * class names are absent here; these cases pin text, ARIA, and the data
 * attributes the stylesheets key off instead.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaLedgerSummaryCell } from '@/features/quota/components/QuotaLedgerSummary';
import { QuotaLedgerRow } from '@/features/quota/components/QuotaLedgerRow';
import { QuotaLedger } from '@/features/quota/components/QuotaLedger';
import { QuotaHeader } from '@/features/quota/components/QuotaHeader';
import { QuotaLedgerReset } from '@/features/quota/components/QuotaLedgerReset';
import {
  buildLedgerProviderModel,
  extractLedgerWindows,
  type LedgerProviderModel,
} from '@/features/quota/ledgerModel';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import { formatInstantMonthDayTime } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const NOW = Date.parse('2099-09-11T12:00:00Z');

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const claudeWindow = (
  id: string,
  labelKey: string,
  usedPercent: number,
  resetAtMs: number | null,
  periodHours: number
) => ({ id, label: labelKey, labelKey, usedPercent, resetLabel: '-', resetAtMs, periodHours });

const claudeQuota = (fableUsed: number, sevenUsed: number, fiveUsed: number, resetMs: number) =>
  ({
    status: 'success',
    planType: 'plan_max',
    windows: [
      claudeWindow('five-hour', 'claude_quota.five_hour', fiveUsed, null, 5),
      claudeWindow('seven-day', 'claude_quota.seven_day', sevenUsed, resetMs, 168),
      claudeWindow('seven-day-fable', 'claude_quota.seven_day_fable', fableUsed, resetMs, 168),
    ],
  }) as QuotaCardState;

const referenceQuotas = [
  claudeQuota(42, 21, 0, NOW + DAY_MS + 11 * HOUR_MS),
  claudeQuota(0, 0, 0, NOW + 4 * DAY_MS),
  claudeQuota(0, 0, 0, NOW + 5 * DAY_MS),
  claudeQuota(49, 25, 1, NOW + DAY_MS),
  claudeQuota(0, 0, 0, NOW + 6 * DAY_MS),
];

const claudeModel = (): LedgerProviderModel =>
  buildLedgerProviderModel(
    'claude',
    referenceQuotas.map((quota, index) => ({
      id: `claude-${index}`,
      windows: extractLedgerWindows('claude', quota),
    })),
    NOW
  );

const renderCell = (model: LedgerProviderModel) =>
  renderToStaticMarkup(
    createElement(QuotaLedgerSummaryCell, { model, resolvedTheme: 'dark', now: NOW })
  );

describe('ledger summary cell', () => {
  test('renders the reference Claude headline, segments, reset, and footer', () => {
    const markup = renderCell(claudeModel());

    expect(markup).toContain('Claude');
    expect(markup).toContain('5 credentials');
    expect(markup).toContain('7-day Fable 5');
    expect(markup).toContain('409%');
    expect(markup).toContain('of 500%');
    expect(markup).toContain(
      'role="img" aria-label="7-day Fable 5 remaining per credential: 58%, 100%, 100%, 51%, 100%"'
    );
    // One segment per credential, coloured by tier.
    expect(markup.match(/data-tier="/g)).toHaveLength(5);
    expect(markup).toContain('data-tier="medium" style="width:58%"');
    expect(markup).toContain('data-tier="high" style="width:100%"');
    // Soonest reset of the headline window.
    expect(markup).toContain('in 1 day');
    expect(markup).toContain(formatInstantMonthDayTime(NOW + DAY_MS));
    // Next most constrained window in the footer; the rest behind Show.
    expect(markup).toContain('7-day limit');
    expect(markup).toContain('454%');
    expect(markup).toMatch(
      /<button type="button"[^>]*aria-expanded="false"[^>]*aria-label="Show other limits for Claude"[^>]*>Show<\/button>/
    );
    expect(markup).toMatch(/<div id="[^"]+" [^>]*hidden="">[\s\S]*5-hour limit[\s\S]*499%/);
  });

  test('one credential reads singular and a lone window has no footer', () => {
    const model = buildLedgerProviderModel(
      'kimi',
      [
        {
          id: 'kimi',
          windows: [
            {
              key: 'kimi_quota.weekly_limit',
              label: '',
              labelKey: 'kimi_quota.weekly_limit',
              remaining: 100,
              resetAtMs: NOW + 5 * DAY_MS + HOUR_MS,
              periodHours: 168,
            },
          ],
        },
      ],
      NOW
    );
    const markup = renderCell(model);
    expect(markup).toContain('1 credential<');
    expect(markup).toContain('Weekly limit');
    expect(markup).toContain('100%');
    expect(markup).toContain('of 100%');
    expect(markup).toContain('in 5 days');
    expect(markup).not.toContain('aria-expanded');
  });

  test('unknown usage reads -- of capacity and an empty, labelled segment', () => {
    const model = buildLedgerProviderModel(
      'xai',
      [
        {
          id: 'xai',
          windows: extractLedgerWindows('xai', {
            status: 'success',
            billing: {
              mode: 'billing',
              periodType: 'weekly',
              usagePercent: null,
              periodEnd: new Date(NOW + 5 * DAY_MS).toISOString(),
              productUsage: [],
              resetAtMs: NOW + 5 * DAY_MS + HOUR_MS,
            },
          }),
        },
      ],
      NOW
    );
    const markup = renderCell(model);
    expect(markup).toContain('xAI');
    expect(markup).toContain('Weekly limit');
    expect(markup).toContain('>--<');
    expect(markup).toContain('of 100%');
    expect(markup).toContain('title="not reported"');
    expect(markup).not.toContain('data-tier=');
    expect(markup).toContain('in 5 days');
  });

  test('nothing loaded says so and has no reset pending', () => {
    const model = buildLedgerProviderModel('codex', [{ id: 'a', windows: null }], NOW);
    const markup = renderCell(model);
    expect(markup).toContain('Not loaded');
    expect(markup).toContain('No reset pending');
    expect(markup).toContain('of 100%');
  });
});

/* ------------------------------------------------------------------ rows */

const claudeEntry: QuotaFileEntry = {
  type: 'claude',
  file: { name: 'claude-theo@t3.gg.json', type: 'claude', email: 'theo@t3.gg' },
};

const renderRow = (
  props: Partial<Parameters<typeof QuotaLedgerRow>[0]> & { entry?: QuotaFileEntry } = {}
) =>
  renderToStaticMarkup(
    createElement(QuotaLedgerRow, {
      entry: claudeEntry,
      quota: referenceQuotas[0],
      columns: claudeModel().columns,
      showEmails: false,
      canRefresh: true,
      resetting: false,
      onRefresh: () => undefined,
      onReset: () => undefined,
      now: NOW,
      ...props,
    })
  );

describe('ledger row', () => {
  test('masks the identity by default and shows the plan', () => {
    const markup = renderRow();
    expect(markup).toContain('claude-t•••@t•••.gg.json');
    expect(markup).not.toContain('theo@t3.gg');
    // The full value is only offered as a tooltip once emails are shown.
    expect(markup).not.toContain('title="claude-');
    expect(markup).toContain('>Max<');
  });

  test('shows the raw identity with a tooltip when emails are shown', () => {
    const markup = renderRow({ showEmails: true });
    expect(markup).toContain('title="claude-theo@t3.gg.json"');
    expect(markup).toContain('aria-label="Refresh quota: claude-theo@t3.gg.json"');
  });

  test('renders window cells in column order with emphasis past the second column', () => {
    const markup = renderRow();
    const fable = markup.indexOf('7-day Fable 5');
    const fiveHour = markup.indexOf('5-hour limit');
    const sevenDay = markup.indexOf('7-day limit');
    expect(fable).toBeGreaterThan(-1);
    expect(fiveHour).toBeGreaterThan(fable);
    expect(sevenDay).toBeGreaterThan(fiveHour);

    expect(markup).toContain('58%');
    expect(markup).toContain('79%');
    expect(markup.match(/data-emphasis="muted"/g)).toHaveLength(1);
    expect(markup.indexOf('data-emphasis="muted"')).toBeLessThan(sevenDay);
    expect(markup.indexOf('data-emphasis="muted"')).toBeGreaterThan(fiveHour);
    // The unused 5-hour window has nothing scheduled.
    expect(markup).toContain('No reset pending');
    expect(markup).toContain('in 1 day');
    expect(markup).toContain(
      `<time dateTime="${new Date(NOW + DAY_MS + 11 * HOUR_MS).toISOString()}">${formatInstantMonthDayTime(NOW + DAY_MS + 11 * HOUR_MS)}</time>`
    );
    expect(markup).toContain('data-state="ready"');
  });

  test('a reset instant outside the Date range reads no reset pending instead of throwing', () => {
    // Bypasses the model's range check: the component must not throw on its own.
    const render = (resetAtMs: number | null) =>
      renderToStaticMarkup(createElement(QuotaLedgerReset, { resetAtMs, now: NOW }));
    expect(() => render(1.7e18)).not.toThrow();
    expect(render(1.7e18)).toContain('No reset pending');
    expect(render(1.7e18)).not.toContain('NaN');
    expect(render(NOW + DAY_MS)).toContain('in 1 day');

    // End to end through a row: a nanosecond epoch from upstream still renders.
    const markup = renderRow({
      quota: {
        status: 'success',
        windows: [claudeWindow('seven-day-fable', 'claude_quota.seven_day_fable', 10, 1.7e18, 168)],
      } as QuotaCardState,
    });
    expect(markup).toContain('90%');
    expect(markup).toContain('No reset pending');
  });

  test('a window the credential lacks keeps its column as an em-dash', () => {
    const markup = renderRow({
      quota: {
        status: 'success',
        windows: [claudeWindow('five-hour', 'claude_quota.five_hour', 10, null, 5)],
      } as QuotaCardState,
    });
    expect(markup.match(/>—</g)).toHaveLength(2);
    expect(markup).toContain('7-day Fable 5: not reported');
    expect(markup).toContain('7-day limit: not reported');
    expect(markup).toContain('90%');
  });

  test('idle rows say Not loaded and keep refresh as the click-to-load action', () => {
    const markup = renderRow({ quota: undefined });
    expect(markup).toContain('data-state="idle"');
    expect(markup).toContain('Not loaded');
    expect(markup).toMatch(
      /<button type="button"[^>]*title="Refresh quota only for this credential"/
    );
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Refresh quota/);
  });

  test('refresh follows the card disable rules', () => {
    expect(renderRow({ canRefresh: false })).toMatch(
      /<button type="button"[^>]*disabled=""[^>]*aria-label="Refresh quota: /
    );
    expect(renderRow({ resetting: true })).toMatch(
      /<button type="button"[^>]*disabled=""[^>]*aria-label="Refresh quota: /
    );
  });

  test('loading rows render skeleton cells and announce busy', () => {
    const markup = renderRow({
      entry: { type: 'codex', file: { name: 'codex-a.json', type: 'codex' } },
      quota: { status: 'loading' } as QuotaCardState,
    });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Loading quota…');
    expect(markup).toContain('data-state="loading"');
    expect(markup).toMatch(/<button type="button"[^>]*disabled=""[^>]*aria-label="Refresh quota/);
  });

  test('retained Claude observations stay visible while refreshing', () => {
    const markup = renderRow({ quota: { ...referenceQuotas[0], status: 'loading' } });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('58%');
    expect(markup).not.toContain('Loading quota…');
  });

  test('errors use the card mapping across the window columns', () => {
    const markup = renderRow({
      entry: { type: 'codex', file: { name: 'codex-a.json', type: 'codex' } },
      quota: { status: 'error', error: 'raw upstream', errorStatus: 403 } as QuotaCardState,
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(i18n.t('common.quota_check_credential'));
    expect(markup).not.toContain('raw upstream');
    expect(markup).toContain('data-state="error"');
  });

  test('a group-scoped column reads the same in every row and in the summary', () => {
    const bucket = (id: string, remainingFraction: number) => ({
      id,
      label: 'Weekly Limit',
      window: 'weekly',
      remainingFraction,
      resetAtMs: NOW + 3 * DAY_MS,
      periodHours: 168,
    });
    const gemini = (fraction: number) => ({
      id: 'gemini-models',
      label: 'Gemini Models',
      buckets: [bucket('gemini-weekly', fraction)],
    });
    // One credential sees a single group, the other two: labels must not follow suit.
    const quotas = [
      { status: 'success', groups: [gemini(0.4)] },
      {
        status: 'success',
        groups: [
          gemini(0.6),
          { id: 'claude-gpt', label: 'Claude and GPT Models', buckets: [bucket('cg', 0.9)] },
        ],
      },
    ] as QuotaCardState[];
    const model = buildLedgerProviderModel(
      'antigravity',
      quotas.map((quota, index) => ({
        id: `ag-${index}`,
        windows: extractLedgerWindows('antigravity', quota),
      })),
      NOW
    );
    const qualified = 'Gemini models · Weekly limit';
    expect(renderCell(model)).toContain(qualified);
    quotas.forEach((quota) => {
      const markup = renderRow({
        entry: { type: 'antigravity', file: { name: 'antigravity-a.json', type: 'antigravity' } },
        quota,
        columns: model.columns,
      });
      expect(markup).toContain(qualified);
      expect(markup).not.toMatch(/>Weekly limit</);
    });
  });

  test('a Codex credential with reset credits keeps its reset action', () => {
    const markup = renderRow({
      entry: { type: 'codex', file: { name: 'codex-a.json', type: 'codex' } },
      columns: [],
      quota: {
        status: 'success',
        windows: [],
        rateLimitResetCreditsAvailableCount: 1,
      } as QuotaCardState,
    });
    expect(markup).toContain('aria-label="Reset quota: codex-a.json"');
    expect(markup).toContain('No quota windows');
  });
});

describe('ledger view', () => {
  test('groups the page by provider with shared columns and a summary of the scope', () => {
    const entries: QuotaFileEntry[] = referenceQuotas.map((_, index) => ({
      type: 'claude',
      file: { name: `claude-user${index}@example.dev.json`, type: 'claude' },
    }));
    const quotas = new Map(entries.map((entry, index) => [entry, referenceQuotas[index]]));
    const markup = renderToStaticMarkup(
      createElement(QuotaLedger, {
        scopeEntries: entries,
        pageEntries: entries.slice(0, 2),
        quotaFor: (entry) => quotas.get(entry),
        resolvedTheme: 'light',
        showEmails: false,
        canUseActions: true,
        resettingQuotaName: null,
        onRefresh: () => undefined,
        onReset: () => undefined,
        now: NOW,
      })
    );

    expect(markup).toContain('aria-label="Provider quota summary"');
    // Summary covers the whole scope, rows only the page.
    expect(markup).toContain('409%');
    expect(markup.match(/data-state="ready"/g)).toHaveLength(2);
    expect(markup).toMatch(/<h2 id="[^"]+"[^>]*>Claude<span aria-hidden="true">5<\/span>/);
    expect(markup).toContain('style="--ledger-columns:3"');
    expect(markup).toContain('claude-u•••@e•••.dev.json');
    expect(markup).not.toContain('user0@');
  });

  test('every group shares the widest group track count so columns line up', () => {
    const claude: QuotaFileEntry = {
      type: 'claude',
      file: { name: 'claude-a.json', type: 'claude' },
    };
    const codex: QuotaFileEntry = {
      type: 'codex',
      file: { name: 'codex-a.json', type: 'codex' },
    };
    const codexQuota = {
      status: 'success',
      windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 40 }],
    } as QuotaCardState;
    const quotas = new Map<QuotaFileEntry, QuotaCardState>([
      [claude, referenceQuotas[0]],
      [codex, codexQuota],
    ]);
    const markup = renderToStaticMarkup(
      createElement(QuotaLedger, {
        scopeEntries: [claude, codex],
        pageEntries: [claude, codex],
        quotaFor: (entry) => quotas.get(entry),
        resolvedTheme: 'light',
        showEmails: false,
        canUseActions: true,
        resettingQuotaName: null,
        onRefresh: () => undefined,
        onReset: () => undefined,
        now: NOW,
      })
    );

    // Claude has three window columns, Codex one: both groups get three tracks.
    expect(markup.match(/style="--ledger-columns:3"/g)).toHaveLength(2);
  });
});

describe('quota header', () => {
  const render = (showEmails: boolean) =>
    renderToStaticMarkup(
      createElement(QuotaHeader, {
        totalCount: 10,
        loadedCount: 10,
        attentionCount: 0,
        refreshing: false,
        disableControls: false,
        showEmails,
        onToggleEmails: () => undefined,
        onRefreshAll: () => undefined,
      })
    );

  test('the email toggle sits before refresh and reflects its state', () => {
    const masked = render(false);
    expect(masked).toMatch(/aria-pressed="false"[^>]*>Show emails<\/button>/);
    expect(masked.indexOf('Show emails')).toBeLessThan(masked.indexOf('Refresh all credentials'));
    expect(render(true)).toMatch(/aria-pressed="true"[^>]*>Hide emails<\/button>/);
  });
});
