/**
 * Provider summary panel above the ledger: one cell per provider in scope.
 *
 * Each cell leads with the provider's headline window — the longest, most
 * constrained one — as a total across credentials against its capacity
 * (`409% of 500%`), a segmented bar with one segment per credential, and the
 * soonest reset. The next most constrained window sits in the footer; the
 * rest are one click away.
 *
 * Past `SEGMENT_LIMIT` credentials one segment each would no longer fit the
 * cell, so the bar becomes a single stacked meter of how many credentials
 * sit in each tier; the accessible summary stays the same.
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
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from '../constants';
import {
  formatLedgerKindLabel,
  formatLedgerPercent,
  quotaTier,
  type LedgerKind,
  type LedgerProviderModel,
  type LedgerSegment,
  type QuotaTier,
} from '../ledgerModel';
import type { QuotaProviderType } from '../providers/types';
import { QuotaLedgerReset } from './QuotaLedgerReset';
import styles from './QuotaLedgerSummary.module.scss';

export interface QuotaLedgerSummaryProps {
  models: readonly LedgerProviderModel[];
  resolvedTheme: ResolvedTheme;
  now: number;
  /** Mark the panel for the ledger's entrance cascade. */
  reveal?: boolean;
  /** Providers whose other limits are shown; uncontrolled when omitted. */
  expandedProviders?: ReadonlySet<QuotaProviderType>;
  onExpandedChange?: (provider: QuotaProviderType, expanded: boolean) => void;
}

export function QuotaLedgerSummary({
  models,
  resolvedTheme,
  now,
  reveal = false,
  expandedProviders,
  onExpandedChange,
}: QuotaLedgerSummaryProps) {
  const { t } = useTranslation();
  if (models.length === 0) return null;

  return (
    <section
      className={styles.panel}
      aria-label={t('quota_management.ledger_summary_label')}
      data-reveal={reveal || undefined}
    >
      <ul className={styles.grid} role="list">
        {models.map((model) => (
          <QuotaLedgerSummaryCell
            key={model.provider}
            model={model}
            resolvedTheme={resolvedTheme}
            now={now}
            expanded={expandedProviders ? expandedProviders.has(model.provider) : undefined}
            onExpandedChange={
              onExpandedChange
                ? (expanded) => onExpandedChange(model.provider, expanded)
                : undefined
            }
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Most credentials one segment each can show: at the 1px dense gap a
 * 220px-minimum cell still gives every segment a few pixels. Beyond it the
 * bar switches to the tier distribution.
 */
export const SEGMENT_LIMIT = 40;

/** Denser segment gaps once there are too many credentials for 6px gutters. */
const segmentDensity = (count: number): 'compact' | 'dense' | undefined =>
  count > 24 ? 'dense' : count > 10 ? 'compact' : undefined;

type DistributionTier = QuotaTier | 'unknown';

const DISTRIBUTION_ORDER: readonly DistributionTier[] = ['high', 'medium', 'low', 'unknown'];

/** Credentials per tier, healthiest first; empty tiers are left out. */
function segmentDistribution(
  segments: readonly LedgerSegment[]
): Array<{ tier: DistributionTier; count: number }> {
  const counts = new Map<DistributionTier, number>();
  segments.forEach((segment) => {
    const tier = quotaTier(segment.remaining) ?? 'unknown';
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  });
  return DISTRIBUTION_ORDER.filter((tier) => counts.has(tier)).map((tier) => ({
    tier,
    count: counts.get(tier) ?? 0,
  }));
}

export interface QuotaLedgerSummaryCellProps {
  model: LedgerProviderModel;
  resolvedTheme: ResolvedTheme;
  now: number;
  /** Controlled expansion of the other limits; local state when omitted. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export function QuotaLedgerSummaryCell({
  model,
  resolvedTheme,
  now,
  expanded: expandedProp,
  onExpandedChange,
}: QuotaLedgerSummaryCellProps) {
  const { t } = useTranslation();
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = expandedProp ?? localExpanded;
  const toggleExpanded = () => {
    if (onExpandedChange) onExpandedChange(!expanded);
    else setLocalExpanded(!expanded);
  };
  const nameId = useId();
  const othersId = useId();

  const provider = model.provider;
  const providerLabel = getTypeLabel(t, provider);
  const iconSrc = getAuthFileIcon(provider, resolvedTheme);
  const headline = model.headline;
  const labelFor = (kind: LedgerKind) => formatLedgerKindLabel(t, kind);

  const windowLabel = headline
    ? labelFor(headline)
    : model.loadedCount === 0
      ? t('quota_management.ledger_not_loaded')
      : t('quota_management.ledger_no_windows');
  const notReported = t('quota_management.ledger_not_reported');
  // Nothing loaded (or no windows): the label above already says so, and a
  // spoken list of "not reported" per credential would only add noise.
  const segmentsLabel = headline
    ? t('quota_management.ledger_segments_label', {
        window: windowLabel,
        values: model.segments
          .map((segment) =>
            segment.remaining === null ? notReported : formatLedgerPercent(segment.remaining)
          )
          .join(', '),
      })
    : null;
  // Tiers come from the unrounded value, as in every QuotaMeter, so the ranges
  // are half-open: 69.6 (shown as 70%) is "30% to under 70%", not "30–69%".
  const tierRange = (tier: DistributionTier) => {
    switch (tier) {
      case 'high':
        return t('quota_management.ledger_tier_high', { min: QUOTA_PROGRESS_HIGH_THRESHOLD });
      case 'medium':
        return t('quota_management.ledger_tier_medium', {
          min: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          max: QUOTA_PROGRESS_HIGH_THRESHOLD,
        });
      case 'low':
        return t('quota_management.ledger_tier_low', { max: QUOTA_PROGRESS_MEDIUM_THRESHOLD });
      default:
        return notReported;
    }
  };
  const distribute = model.segments.length > SEGMENT_LIMIT;
  const barA11y = segmentsLabel
    ? { role: 'img' as const, 'aria-label': segmentsLabel }
    : { 'aria-hidden': true as const };

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

      <p className={styles.windowLabel} title={windowLabel}>
        {windowLabel}
      </p>

      <p className={styles.aggregate}>
        <span className={styles.total}>{formatLedgerPercent(headline?.total ?? null)}</span>{' '}
        <span className={styles.capacity}>
          {t('quota_management.ledger_capacity', { value: `${model.capacity}%` })}
        </span>
      </p>

      {distribute ? (
        <div className={styles.segments} data-mode="distribution" {...barA11y}>
          {segmentDistribution(model.segments).map(({ tier, count }) => (
            <span
              key={tier}
              className={styles.share}
              data-tier={tier === 'unknown' ? undefined : tier}
              style={{ flexGrow: count } as CSSProperties}
              title={t('quota_management.ledger_distribution_part', {
                count,
                range: tierRange(tier),
              })}
            />
          ))}
        </div>
      ) : (
        <div
          className={styles.segments}
          data-density={segmentDensity(model.segments.length)}
          {...barA11y}
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
      )}

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
            <span className={styles.otherLabel} title={labelFor(firstOther)}>
              {labelFor(firstOther)}
            </span>
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
                onClick={toggleExpanded}
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
                  <span className={styles.otherLabel} title={labelFor(kind)}>
                    {labelFor(kind)}
                  </span>
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
