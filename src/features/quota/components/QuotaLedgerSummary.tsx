/**
 * Provider summary panel above the ledger: one cell per provider in scope.
 *
 * Each cell leads with the provider's headline window — the longest, most
 * constrained one — as a total across credentials against its capacity
 * (`409% of 500%`), a segmented bar with one segment per credential, and the
 * soonest reset. The next most constrained window sits in the footer; the
 * rest are one click away.
 */

import { useId, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import {
  formatLedgerPercent,
  formatLedgerWindowLabel,
  quotaTier,
  type LedgerKind,
  type LedgerProviderModel,
} from '../ledgerModel';
import { QuotaLedgerReset } from './QuotaLedgerReset';
import styles from './QuotaLedgerSummary.module.scss';

export interface QuotaLedgerSummaryProps {
  models: readonly LedgerProviderModel[];
  resolvedTheme: ResolvedTheme;
  now: number;
}

export function QuotaLedgerSummary({ models, resolvedTheme, now }: QuotaLedgerSummaryProps) {
  const { t } = useTranslation();
  if (models.length === 0) return null;

  return (
    <section
      className={styles.panel}
      aria-label={t('quota_management.ledger_summary_label')}
      data-reveal
    >
      <ul className={styles.grid} role="list">
        {models.map((model) => (
          <QuotaLedgerSummaryCell
            key={model.provider}
            model={model}
            resolvedTheme={resolvedTheme}
            now={now}
          />
        ))}
      </ul>
    </section>
  );
}

/** Denser segment gaps once there are too many credentials for 6px gutters. */
const segmentDensity = (count: number): 'compact' | 'dense' | undefined =>
  count > 24 ? 'dense' : count > 10 ? 'compact' : undefined;

export interface QuotaLedgerSummaryCellProps {
  model: LedgerProviderModel;
  resolvedTheme: ResolvedTheme;
  now: number;
}

export function QuotaLedgerSummaryCell({ model, resolvedTheme, now }: QuotaLedgerSummaryCellProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const nameId = useId();
  const othersId = useId();

  const provider = model.provider;
  const providerLabel = getTypeLabel(t, provider);
  const iconSrc = getAuthFileIcon(provider, resolvedTheme);
  const headline = model.headline;
  const labelFor = (kind: LedgerKind) => formatLedgerWindowLabel(t, kind.sample);

  const windowLabel = headline
    ? labelFor(headline)
    : model.loadedCount === 0
      ? t('quota_management.ledger_not_loaded')
      : t('quota_management.ledger_no_windows');
  const notReported = t('quota_management.ledger_not_reported');
  const segmentsLabel = t('quota_management.ledger_segments_label', {
    window: windowLabel,
    values: model.segments
      .map((segment) =>
        segment.remaining === null ? notReported : formatLedgerPercent(segment.remaining)
      )
      .join(', '),
  });

  const [firstOther, ...moreOthers] = model.others;

  return (
    <li className={styles.cell} aria-labelledby={nameId}>
      <div className={styles.head}>
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(provider)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
          aria-hidden="true"
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{providerLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span id={nameId} className={styles.name}>
          {providerLabel}
        </span>
        <span className={styles.count}>
          {t('quota_management.ledger_credential_count', { count: model.credentialCount })}
        </span>
      </div>

      <p className={styles.windowLabel}>{windowLabel}</p>

      <p className={styles.aggregate}>
        <span className={styles.total}>{formatLedgerPercent(headline?.total ?? null)}</span>{' '}
        <span className={styles.capacity}>
          {t('quota_management.ledger_capacity', { value: `${model.capacity}%` })}
        </span>
      </p>

      <div
        className={styles.segments}
        role="img"
        aria-label={segmentsLabel}
        data-density={segmentDensity(model.segments.length)}
      >
        {model.segments.map((segment) => {
          const tier = quotaTier(segment.remaining);
          return (
            <span
              key={segment.id}
              className={styles.segment}
              title={
                segment.remaining === null ? notReported : formatLedgerPercent(segment.remaining)
              }
            >
              {tier && (
                <span
                  className={styles.segmentFill}
                  data-tier={tier}
                  style={{ width: `${segment.remaining}%` } as CSSProperties}
                />
              )}
            </span>
          );
        })}
      </div>

      <QuotaLedgerReset
        resetAtMs={headline?.soonestResetAtMs ?? null}
        now={now}
        className={styles.reset}
        relativeClassName={styles.resetRelative}
        absoluteClassName={styles.resetAbsolute}
        emptyClassName={styles.resetNone}
      />

      {firstOther && (
        <div className={styles.footer}>
          <div className={styles.otherRow}>
            <span className={styles.otherLabel}>{labelFor(firstOther)}</span>
            <span className={styles.otherValue}>{formatLedgerPercent(firstOther.total)}</span>
            {moreOthers.length > 0 && (
              <button
                type="button"
                className={styles.toggle}
                aria-expanded={expanded}
                aria-controls={othersId}
                aria-label={t(
                  expanded
                    ? 'quota_management.ledger_show_less_label'
                    : 'quota_management.ledger_show_more_label',
                  { provider: providerLabel }
                )}
                onClick={() => setExpanded((value) => !value)}
              >
                {t(
                  expanded
                    ? 'quota_management.ledger_show_less'
                    : 'quota_management.ledger_show_more'
                )}
              </button>
            )}
          </div>
          {moreOthers.length > 0 && (
            <div id={othersId} className={styles.otherMore} hidden={!expanded}>
              {moreOthers.map((kind) => (
                <div key={kind.key} className={styles.otherRow}>
                  <span className={styles.otherLabel}>{labelFor(kind)}</span>
                  <span className={styles.otherValue}>{formatLedgerPercent(kind.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
