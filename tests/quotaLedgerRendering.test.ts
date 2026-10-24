/**
 * Ledger summary cells and ledger rows rendered as static markup.
 *
 * Under `bun test` a `.module.scss` import is the raw stylesheet string, so
 * class names are absent here; these cases pin text, ARIA, and the data
 * attributes the stylesheets key off instead.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import {
  QuotaLedgerSummary,
  QuotaLedgerSummaryCell,
  SEGMENT_LIMIT,
} from '@/features/quota/components/QuotaLedgerSummary';
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

  test('an unloaded bar is hidden from assistive tech instead of a garbled label', () => {
    // Click-to-load: this is every cell on a fresh page.
    const model = buildLedgerProviderModel(
      'claude',
      Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, windows: null })),
      NOW
    );
    const markup = renderCell(model);
    expect(markup).not.toContain('role="img"');
    expect(markup).not.toContain('remaining per credential');
    expect(markup).toMatch(/<div aria-hidden="true"><span title="not reported">/);
    // The visible label still states the condition once.
    expect(markup).toContain('>Not loaded</p>');
  });

  test('long window labels carry their full text as a tooltip', () => {
    const markup = renderCell(claudeModel());
    expect(markup).toContain('title="7-day Fable 5">7-day Fable 5</p>');
    expect(markup).toContain('<span title="7-day limit">7-day limit</span>');
    expect(markup).toContain('<span title="5-hour limit">5-hour limit</span>');
    expect(markup).toMatch(/<span title="in 1 day · [^"]+"><span>in 1 day<\/span>/);
  });

  test('the Show/Hide state can be held by the page, so remounts keep it', () => {
    const model = claudeModel();
    const open = renderToStaticMarkup(
      createElement(QuotaLedgerSummaryCell, {
        model,
        resolvedTheme: 'dark',
        now: NOW,
        expanded: true,
        onExpandedChange: () => undefined,
      })
    );
    expect(open).toMatch(/aria-expanded="true"[^>]*aria-label="Hide other limits for Claude"/);
    expect(open).not.toContain('hidden=""');

    const viaPanel = renderToStaticMarkup(
      createElement(QuotaLedgerSummary, {
        models: [model],
        resolvedTheme: 'dark',
        now: NOW,
        expandedProviders: new Set(['claude' as const]),
        onExpandedChange: () => undefined,
      })
    );
    expect(viaPanel).toContain('aria-expanded="true"');
    expect(renderCell(model)).toContain('aria-expanded="false"');
  });
});

describe('ledger summary segments for large pools', () => {
  const pool = (count: number) =>
    buildLedgerProviderModel(
      'codex',
      Array.from({ length: count }, (_, index) => ({
        id: `codex-${index}`,
        windows: [
          {
            key: 'weekly',
            label: 'Weekly',
            // 0, 1, …: a spread across every tier, with every seventh unreported.
            remaining: index % 7 === 6 ? null : (index * 13) % 101,
            resetAtMs: NOW + DAY_MS,
            periodHours: 168,
          },
        ],
      })),
      NOW
    );

  test(`up to ${SEGMENT_LIMIT} credentials keep one segment each`, () => {
    const markup = renderCell(pool(SEGMENT_LIMIT));
    expect(markup).toContain('data-density="dense"');
    expect(markup).not.toContain('data-mode="distribution"');
    expect(markup.match(/<span title="/g)!.length).toBeGreaterThanOrEqual(SEGMENT_LIMIT);
  });

  test('beyond the limit the bar becomes one stacked tier meter with the same summary', () => {
    const count = 120;
    const model = pool(count);
    const markup = renderCell(model);
    expect(markup).toContain('data-mode="distribution"');
    expect(markup).not.toContain('data-density=');

    // One part per tier, healthiest first, each as wide as its share.
    const parts = [
      ...markup.matchAll(/<span (?:data-tier="(\w+)" )?style="flex-grow:(\d+)" title="([^"]+)"/g),
    ];
    const tiers = parts.map(([, tier]) => tier ?? 'unknown');
    expect(tiers).toEqual(['high', 'medium', 'low', 'unknown']);
    const counts = parts.map(([, , grow]) => Number(grow));
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(count);
    const expected = { high: 0, medium: 0, low: 0, unknown: 0 };
    model.segments.forEach(({ remaining }) => {
      if (remaining === null) expected.unknown += 1;
      else if (remaining >= 70) expected.high += 1;
      else if (remaining >= 30) expected.medium += 1;
      else expected.low += 1;
    });
    expect(counts).toEqual([expected.high, expected.medium, expected.low, expected.unknown]);
    expect(parts[0][3]).toBe(`${expected.high} credentials: 70% or more left`);
    expect(parts[1][3]).toBe(`${expected.medium} credentials: 30–69% left`);
    expect(parts[2][3]).toBe(`${expected.low} credentials: under 30% left`);
    expect(parts[3][3]).toBe(`${expected.unknown} credentials: not reported`);

    // The accessible summary is unchanged: every credential's value, in order.
    const label = markup.match(/role="img" aria-label="([^"]+)"/)?.[1] ?? '';
    expect(label.startsWith('Weekly remaining per credential: 0%, 13%, 26%')).toBe(true);
    expect(label.split(', ')).toHaveLength(count);
  });

  test('the segment bar can never paint past its cell', () => {
    const css = readFileSync(
      'src/features/quota/components/QuotaLedgerSummary.module.scss',
      'utf8'
    );
    expect(css).toMatch(/\.segments \{[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.segment \{[^}]*min-width: 0;/);
    expect(css).not.toMatch(/\.segment \{[^}]*min-width: [1-9]/);
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
    // The window name leads, so a cut-short label loses the qualifier, not the window.
    const qualified = 'Weekly limit · Gemini models';
    expect(renderCell(model)).toContain(`title="${qualified}">${qualified}</p>`);
    quotas.forEach((quota) => {
      const markup = renderRow({
        entry: { type: 'antigravity', file: { name: 'antigravity-a.json', type: 'antigravity' } },
        quota,
        columns: model.columns,
      });
      // Rows put the group on a line of its own above the window name, and
      // offer the full label as a tooltip.
      expect(markup).toMatch(
        /<span title="Gemini models">Gemini models<\/span><div><span title="Weekly limit · Gemini models">Weekly limit<\/span>/
      );
    });
  });

  test('window labels and reset lines offer their full text as a tooltip', () => {
    const markup = renderRow();
    expect(markup).toContain('<span title="7-day Fable 5">7-day Fable 5</span>');
    expect(markup).toContain('<span title="No reset pending">No reset pending</span>');
    const reset = `in 1 day · ${formatInstantMonthDayTime(NOW + DAY_MS + 11 * HOUR_MS)}`;
    expect(markup).toContain(`<span title="${reset}">`);
    // Unscoped providers reserve no group line.
    expect(markup).not.toMatch(/<span aria-hidden="true"><\/span><div>/);
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

  test('each group sizes its own windows track; no page-wide track count', () => {
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

    // Claude has three window columns, Codex one: Codex no longer inherits
    // Claude's three tracks (which squeezed every small group).
    expect(markup.match(/style="--ledger-columns:\d+"/g)).toEqual([
      'style="--ledger-columns:3"',
      'style="--ledger-columns:1"',
    ]);
  });
});

describe('ledger entrance', () => {
  const entries: QuotaFileEntry[] = referenceQuotas.map((_, index) => ({
    type: 'claude',
    file: { name: `claude-user${index}@example.dev.json`, type: 'claude' },
  }));
  const renderLedger = (animateEntrance?: boolean) =>
    renderToStaticMarkup(
      createElement(QuotaLedger, {
        scopeEntries: entries,
        pageEntries: entries,
        quotaFor: (entry) => referenceQuotas[entries.indexOf(entry)],
        resolvedTheme: 'dark',
        showEmails: false,
        canUseActions: true,
        resettingQuotaName: null,
        onRefresh: () => undefined,
        onReset: () => undefined,
        animateEntrance,
        now: NOW,
      })
    );

  test("only the page's first data render marks the cascade", () => {
    // Summary + one group.
    expect(renderLedger(true).match(/data-reveal="true"/g)).toHaveLength(2);
    // Any later mount (view switch, empty-tab round trip) appears in place.
    expect(renderLedger(false)).not.toContain('data-reveal');
    expect(renderLedger()).not.toContain('data-reveal');
  });
});

describe('ledger layout and contrast contracts', () => {
  const ledgerCss = readFileSync('src/features/quota/components/QuotaLedger.module.scss', 'utf8');
  const rowCss = readFileSync('src/features/quota/components/QuotaLedgerRow.module.scss', 'utf8');
  const themes = readFileSync('src/styles/themes.scss', 'utf8');

  test('every group shares one identity width and one window width', () => {
    const group = ledgerCss.match(/\.group \{[^}]*\}/)?.[0] ?? '';
    expect(group).toMatch(/--ledger-identity: clamp\(/);
    expect(group).toMatch(/--ledger-window: clamp\(/);
    // The template is identity | windows | actions, from those shared widths,
    // with this group's own column count only sizing its windows track.
    expect(ledgerCss).toMatch(
      /grid-template-columns:\s*var\(--ledger-identity\)\s*minmax\(min\(var\(--ledger-windows-need\), var\(--ledger-windows-room\)\), 1fr\)\s*auto;/
    );
    expect(ledgerCss).toMatch(
      /--ledger-windows-need: calc\(\s*var\(--ledger-columns, 1\) \* var\(--ledger-window\)/
    );
    // No fractional window tracks: those shrank with the page's widest group.
    expect(ledgerCss).not.toMatch(/repeat\(var\(--ledger-columns/);
    expect(rowCss).not.toMatch(/repeat\(var\(--ledger-columns/);
    // Cells keep the shared width and wrap rather than shrink to fit.
    expect(rowCss).toMatch(/\.windows \{[^}]*flex-wrap: wrap;/);
    expect(rowCss).toMatch(/\.cell \{[^}]*flex: 0 1 var\(--ledger-window\);/);
  });

  const themeBlock = (selector: string) => {
    const start = themes.indexOf(`${selector} {`);
    return themes.slice(start, themes.indexOf('\n}', start));
  };
  const token = (block: string, name: string) =>
    block.match(new RegExp(`${name}: (#[0-9a-f]{6})`, 'i'))?.[1] ?? '';
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  test('quiet text actions reach 4.5:1 in the light, white and dark themes', () => {
    // Row actions and the summary toggle share one resting colour.
    expect(rowCss).toMatch(
      /\.action \{[^}]*color: var\(--ledger-action, var\(--text-secondary\)\);/
    );
    const summaryCss = readFileSync(
      'src/features/quota/components/QuotaLedgerSummary.module.scss',
      'utf8'
    );
    expect(summaryCss).toMatch(
      /\.toggle \{[^}]*color: var\(--ledger-action, var\(--text-secondary\)\);/
    );

    const ledger = ledgerCss.match(/\.ledger \{[\s\S]*?\n\}/)?.[0] ?? '';
    const lightAction = ledger.match(/^ {2}--ledger-action: var\((--[\w-]+)\);/m)?.[1];
    const darkAction = ledger.match(
      /\[data-theme='dark'\] & \{[^}]*--ledger-action: var\((--[\w-]+)\);/
    )?.[1];
    expect(lightAction).toBeDefined();
    expect(darkAction).toBeDefined();

    const cases: Array<[string, string]> = [
      [':root', lightAction!],
      ["[data-theme='white']", lightAction!],
      ["[data-theme='dark']", darkAction!],
    ];
    for (const [selector, tokenName] of cases) {
      const block = themeBlock(selector);
      const fg = token(block, tokenName);
      // The page (--bg-secondary) and the panel/card surface (--bg-primary).
      for (const surface of ['--bg-secondary', '--bg-primary']) {
        const bg = token(block, surface);
        expect({ selector, surface, fg, ok: contrast(fg, bg) >= 4.5 }).toEqual({
          selector,
          surface,
          fg,
          ok: true,
        });
      }
    }
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

  test('the email toggle sits before refresh and names the action it performs', () => {
    const masked = render(false);
    expect(masked).toMatch(/<button type="button"[^>]*>Show emails<\/button>/);
    expect(masked.indexOf('Show emails')).toBeLessThan(masked.indexOf('Refresh all credentials'));
    expect(render(true)).toMatch(/<button type="button"[^>]*>Hide emails<\/button>/);
  });

  test('the email toggle is a plain button: its label changes, so no aria-pressed', () => {
    // "Hide emails, toggle button, pressed" reads as if hiding were on.
    for (const showEmails of [false, true]) {
      const markup = render(showEmails);
      const toggle = markup.match(/<button[^>]*>(Show|Hide) emails<\/button>/)?.[0] ?? '';
      expect(toggle).not.toBe('');
      expect(toggle).not.toContain('aria-pressed');
    }
  });
});
