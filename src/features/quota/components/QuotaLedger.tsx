/**
 * Ledger view: the provider summary panel, then the current page of
 * credentials grouped by provider.
 *
 * The summary aggregates every credential in the tab scope (not just this
 * page) from whatever quota is loaded; rows show the page. Both read the same
 * provider models, so a group's columns and its summary agree on which window
 * leads. Pagination and the timeline stay with the page shell.
 *
 * Every group shares one identity width and one window-cell width (see
 * QuotaLedger.module.scss), so column N starts at the same x in every group
 * whatever each group's own number of windows.
 */

import { useId, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/hooks/useNow';
import { useRevealGroup } from '@/hooks/motion';
import type { ResolvedTheme } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import type { QuotaFileEntry } from '../logic';
import {
  buildLedgerProviderModels,
  resolveLedgerWindows,
  type LedgerProviderModel,
} from '../ledgerModel';
import { QuotaLedgerRow } from './QuotaLedgerRow';
import { QuotaLedgerSummary } from './QuotaLedgerSummary';
import styles from './QuotaLedger.module.scss';

export interface QuotaLedgerProps {
  /** Every credential in the current tab scope — the summary's population. */
  scopeEntries: readonly QuotaFileEntry[];
  /** The current page — the rows. */
  pageEntries: readonly QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  showEmails: boolean;
  canUseActions: boolean;
  resettingQuotaName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
  /**
   * Play the summary → groups cascade. Read once at mount: only the page's
   * first data render animates; later mounts appear in place.
   */
  animateEntrance?: boolean;
  /** Providers whose summary panel shows its other limits (kept by the page). */
  expandedSummaries?: ReadonlySet<QuotaProviderType>;
  onSummaryExpandedChange?: (provider: QuotaProviderType, expanded: boolean) => void;
  /** Injectable for tests; defaults to the shared minute clock. */
  now?: number;
}

/** React key and segment id: provider-qualified, like the card grid's keys. */
const ledgerEntryId = (entry: QuotaFileEntry) => `${entry.type}:${getQuotaCacheKey(entry.file)}`;

export function QuotaLedger({
  scopeEntries,
  pageEntries,
  quotaFor,
  resolvedTheme,
  showEmails,
  canUseActions,
  resettingQuotaName,
  onRefresh,
  onReset,
  animateEntrance = false,
  expandedSummaries,
  onSummaryExpandedChange,
  now: nowProp,
}: QuotaLedgerProps) {
  const { t } = useTranslation();
  const tick = useNow(nowProp === undefined);
  const now = nowProp ?? tick;
  // Summary, then each group, cascade in — only if this mount is the page's first data render.
  const [reveal] = useState(animateEntrance);
  const revealRef = useRevealGroup<HTMLDivElement>();

  const models = useMemo(
    () =>
      buildLedgerProviderModels(
        scopeEntries.map((entry) => ({
          provider: entry.type,
          id: ledgerEntryId(entry),
          windows: resolveLedgerWindows(entry.type, quotaFor(entry)),
        })),
        now
      ),
    [scopeEntries, quotaFor, now]
  );

  const groups = useMemo(() => {
    const byProvider = new Map<QuotaProviderType, QuotaFileEntry[]>();
    pageEntries.forEach((entry) => {
      const list = byProvider.get(entry.type) ?? [];
      list.push(entry);
      byProvider.set(entry.type, list);
    });
    return models
      .filter((model) => byProvider.has(model.provider))
      .map((model) => ({ model, entries: byProvider.get(model.provider) ?? [] }));
  }, [models, pageEntries]);

  return (
    <div className={styles.ledger} ref={reveal ? revealRef : undefined}>
      <QuotaLedgerSummary
        models={models}
        resolvedTheme={resolvedTheme}
        now={now}
        reveal={reveal}
        expandedProviders={expandedSummaries}
        onExpandedChange={onSummaryExpandedChange}
      />

      <div className={styles.groups} role="region" aria-label={t('quota_management.ledger_label')}>
        {groups.map(({ model, entries }) => (
          <QuotaLedgerGroup
            key={model.provider}
            model={model}
            entries={entries}
            reveal={reveal}
            quotaFor={quotaFor}
            showEmails={showEmails}
            canUseActions={canUseActions}
            resettingQuotaName={resettingQuotaName}
            onRefresh={onRefresh}
            onReset={onReset}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}

interface QuotaLedgerGroupProps {
  model: LedgerProviderModel;
  entries: readonly QuotaFileEntry[];
  reveal: boolean;
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  showEmails: boolean;
  canUseActions: boolean;
  resettingQuotaName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
  now: number;
}

function QuotaLedgerGroup({
  model,
  entries,
  reveal,
  quotaFor,
  showEmails,
  canUseActions,
  resettingQuotaName,
  onRefresh,
  onReset,
  now,
}: QuotaLedgerGroupProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // This group's own window count: it sizes the windows track, never another group's.
  const columnStyle = { '--ledger-columns': Math.max(1, model.columns.length) } as CSSProperties;

  return (
    <section className={styles.group} aria-labelledby={headingId} data-reveal={reveal || undefined}>
      <h2 id={headingId} className={styles.groupTitle}>
        {getTypeLabel(t, model.provider)}
        <span className={styles.groupCount} aria-hidden="true">
          {model.credentialCount}
        </span>
        <span className={styles.srOnly}>
          {t('quota_management.ledger_credential_count', { count: model.credentialCount })}
        </span>
      </h2>
      <ul className={styles.rows} role="list" style={columnStyle}>
        {entries.map((entry) => {
          const cacheKey = getQuotaCacheKey(entry.file);
          return (
            <QuotaLedgerRow
              key={ledgerEntryId(entry)}
              entry={entry}
              quota={quotaFor(entry)}
              columns={model.columns}
              showEmails={showEmails}
              canRefresh={canUseActions && !entry.file.disabled}
              resetting={resettingQuotaName === cacheKey}
              onRefresh={() => onRefresh(entry)}
              onReset={() => onReset(entry)}
              now={now}
            />
          );
        })}
      </ul>
    </section>
  );
}

/** Placeholder while the credential list itself is loading. */
export function QuotaLedgerSkeleton() {
  return (
    <div className={styles.ledger} aria-hidden="true">
      <Skeleton height={176} rounded={12} />
      <div className={styles.skeletonRows}>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={46} rounded={8} />
        ))}
      </div>
    </div>
  );
}
