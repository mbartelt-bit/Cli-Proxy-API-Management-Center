/**
 * `in 1 day · 09/12, 23:00` — a reset as the ledger shows it: the countdown to
 * react to, then the instant to plan around. No instant reads `No reset
 * pending` (an unused window has nothing scheduled). Unstyled on its own; each
 * host passes the classes for its density.
 */

import { useTranslation } from 'react-i18next';
import { formatInstantMonthDayTime, formatRelativeInstant, toInstantMs } from '@/utils/quota';

export interface QuotaLedgerResetProps {
  resetAtMs: number | null;
  now: number;
  className?: string;
  relativeClassName?: string;
  absoluteClassName?: string;
  emptyClassName?: string;
}

export function QuotaLedgerReset({
  resetAtMs,
  now,
  className,
  relativeClassName,
  absoluteClassName,
  emptyClassName,
}: QuotaLedgerResetProps) {
  const { t, i18n } = useTranslation();

  if (resetAtMs === null || toInstantMs(resetAtMs) === null) {
    return (
      <span className={[className, emptyClassName].filter(Boolean).join(' ') || undefined}>
        {t('quota_management.ledger_no_reset')}
      </span>
    );
  }

  return (
    <span className={className}>
      <span className={relativeClassName}>
        {formatRelativeInstant(resetAtMs, now, i18n.resolvedLanguage)}
      </span>
      <span className={absoluteClassName}>
        {' · '}
        <time dateTime={new Date(resetAtMs).toISOString()}>
          {formatInstantMonthDayTime(resetAtMs)}
        </time>
      </span>
    </span>
  );
}
