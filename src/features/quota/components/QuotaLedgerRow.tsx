/**
 * One credential in the quota ledger: identity, one cell per window column of
 * its provider group, and the per-credential actions.
 *
 * Columns come from the provider group (see `orderLedgerColumns`), so every
 * row of a group lines up even when a credential lacks one of the windows —
 * that slot renders an em-dash. Behavioural parity with `QuotaCard`: the same
 * refresh/reset disable rules, the same error mapping, Claude observations
 * kept visible while refreshing, and the Claude reset-grant and Codex
 * reset-credit actions whenever the card would offer them.
 */

import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/hooks/useNow';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { formatQuotaIdentity } from '@/utils/quota/identity';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import {
  formatLedgerPercent,
  formatLedgerWindowLabel,
  quotaTier,
  resolveLedgerPlan,
  resolveLedgerRowState,
  type LedgerKind,
  type LedgerWindow,
} from '../ledgerModel';
import { formatQuotaText } from '../planLabels';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { QuotaLedgerReset } from './QuotaLedgerReset';
import styles from './QuotaLedgerRow.module.scss';

/** Columns from the third on are context, not the headline story. */
const FULL_EMPHASIS_COLUMNS = 2;

export interface QuotaLedgerRowProps {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  /** The provider group's shared column set. */
  columns: readonly LedgerKind[];
  showEmails: boolean;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
  /** Injectable for tests; defaults to the shared minute clock. */
  now?: number;
}

export function QuotaLedgerRow({
  entry,
  quota,
  columns,
  showEmails,
  canRefresh,
  resetting,
  onRefresh,
  onReset,
  now: nowProp,
}: QuotaLedgerRowProps) {
  const { t } = useTranslation();
  const tick = useNow(nowProp === undefined);
  const now = nowProp ?? tick;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;
  const displayName = formatQuotaIdentity(file, showEmails);
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const state = resolveLedgerRowState(entry.type, quota);

  // Same activation rules as the card: reads start once quota has been asked for.
  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh,
    displayName
  );
  // Only surface the Claude action when there is something to do (or a claim
  // to retry); the card's always-present disabled pill would crowd every row.
  const showClaudeReset =
    entry.type === 'claude' &&
    status !== 'idle' &&
    (!claudeReset.blocked || claudeReset.busy || claudeReset.buttonLabel === 'retry');
  const showCodexReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));

  const plan = resolveLedgerPlan(entry.type, quota);
  const planLabel = plan ? formatQuotaText(t, plan) : null;
  const errorMessage =
    status === 'error'
      ? t(`${adapter.i18nPrefix}.load_failed`, {
          message: resolveQuotaErrorMessage(
            t,
            quota?.errorStatus,
            quota?.error || t('common.unknown_error')
          ),
        })
      : null;

  const columnCount = Math.max(1, columns.length);
  const actionLabel = (action: string) =>
    t('quota_management.ledger_action_label', { action, name: displayName });
  const refreshLabel = t('auth_files.quota_refresh_single');

  const renderWindows = (windows: readonly LedgerWindow[]) => {
    if (columns.length === 0 || windows.length === 0) {
      return (
        <div className={`${styles.cell} ${styles.cellNote} ${styles.cellWide}`}>
          <span className={styles.note}>{t('quota_management.ledger_no_windows')}</span>
        </div>
      );
    }
    return columns.map((column, index) => {
      const window = windows.find((candidate) => candidate.key === column.key);
      const muted = index >= FULL_EMPHASIS_COLUMNS;
      return window ? (
        <LedgerWindowCell key={column.key} window={window} muted={muted} now={now} />
      ) : (
        <LedgerMissingCell
          key={column.key}
          label={formatLedgerWindowLabel(t, column.sample)}
          muted={muted}
        />
      );
    });
  };

  // Ready rows and retained Claude observations render their windows; the
  // rest render a state across the window columns.
  const visibleWindows = state.kind === 'idle' ? null : state.windows;
  let cells;
  if (visibleWindows) {
    cells = renderWindows(visibleWindows);
  } else if (state.kind === 'loading') {
    cells = (
      <>
        <span className={styles.srOnly}>{t('quota_management.ledger_loading')}</span>
        {Array.from({ length: columnCount }, (_, index) => (
          <div key={index} className={`${styles.cell} ${styles.cellSkeleton}`} aria-hidden="true">
            <Skeleton height={10} width="58%" rounded={999} />
            <Skeleton height={4} rounded={999} />
            <Skeleton height={9} width="72%" rounded={999} />
          </div>
        ))}
      </>
    );
  } else if (state.kind === 'error') {
    cells = (
      <div className={`${styles.cell} ${styles.cellError} ${styles.cellWide}`} role="alert">
        {errorMessage}
      </div>
    );
  } else {
    // Not loaded: the first column says so, the rest hold the grid's rhythm.
    cells = Array.from({ length: columnCount }, (_, index) =>
      index === 0 ? (
        <div key={index} className={`${styles.cell} ${styles.cellNote} ${styles.cellLead}`}>
          <span className={styles.note}>{t('quota_management.ledger_not_loaded')}</span>
        </div>
      ) : (
        <div
          key={index}
          className={`${styles.cell} ${styles.cellNote} ${styles.cellFiller}`}
          aria-hidden="true"
        >
          <span className={styles.placeholder}>—</span>
        </div>
      )
    );
  }

  return (
    <li className={styles.row} data-state={state.kind} aria-busy={loading || undefined}>
      <div className={styles.identity}>
        <span className={styles.name} title={showEmails ? displayName : undefined}>
          {displayName}
        </span>
        {planLabel && <span className={styles.plan}>{planLabel}</span>}
        {/* Retained Claude observations after a failed read: keep the data, flag the failure. */}
        {state.kind === 'error' && state.windows && errorMessage && (
          <span className={styles.staleError} role="status" title={errorMessage}>
            {errorMessage}
          </span>
        )}
      </div>

      {cells}

      <div className={styles.actions}>
        {showClaudeReset && (
          <button
            type="button"
            className={styles.action}
            disabled={claudeReset.blocked}
            onClick={claudeReset.confirm}
            title={claudeReset.message ? t(`claude_reset.${claudeReset.message}`) : undefined}
            aria-label={actionLabel(t(`claude_reset.${claudeReset.buttonLabel}`))}
          >
            <IconRefreshCw
              size={13}
              aria-hidden="true"
              className={claudeReset.busy ? styles.spinning : undefined}
            />
            {t(`claude_reset.${claudeReset.buttonLabel}`)}
          </button>
        )}
        {showCodexReset && (
          <button
            type="button"
            className={styles.action}
            onClick={onReset}
            disabled={!canRefresh || loading || resetting}
            aria-label={actionLabel(t('codex_quota.reset_button'))}
          >
            <IconRefreshCw
              size={13}
              aria-hidden="true"
              className={resetting ? styles.spinning : undefined}
            />
            {t('codex_quota.reset_button')}
          </button>
        )}
        <button
          type="button"
          className={styles.action}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
          title={t('auth_files.quota_refresh_hint')}
          aria-label={actionLabel(refreshLabel)}
        >
          <IconRefreshCw
            size={13}
            aria-hidden="true"
            className={loading ? styles.spinning : undefined}
          />
          {refreshLabel}
        </button>
      </div>
    </li>
  );
}

function LedgerWindowCell({
  window,
  muted,
  now,
}: {
  window: LedgerWindow;
  muted: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  const tier = quotaTier(window.remaining);
  const notReported = window.remaining === null;

  return (
    <div className={styles.cell} data-emphasis={muted ? 'muted' : undefined}>
      <div className={styles.cellHead}>
        <span className={styles.cellLabel}>{formatLedgerWindowLabel(t, window)}</span>
        <span
          className={styles.cellPercent}
          title={notReported ? t('quota_management.ledger_not_reported') : undefined}
        >
          {formatLedgerPercent(window.remaining)}
          {notReported && (
            <span className={styles.srOnly}> {t('quota_management.ledger_not_reported')}</span>
          )}
        </span>
      </div>
      <div className={styles.bar} aria-hidden="true">
        {tier && (
          <div
            className={styles.barFill}
            data-tier={tier}
            style={{ width: `${Math.round((window.remaining ?? 0) * 100) / 100}%` }}
          />
        )}
      </div>
      <QuotaLedgerReset
        resetAtMs={window.resetAtMs}
        now={now}
        className={styles.cellReset}
        relativeClassName={styles.resetRelative}
        absoluteClassName={styles.resetAbsolute}
        emptyClassName={styles.resetNone}
      />
    </div>
  );
}

function LedgerMissingCell({ label, muted }: { label: string; muted: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className={`${styles.cell} ${styles.cellNote}`}
      data-emphasis={muted ? 'muted' : undefined}
    >
      <span className={styles.placeholder} aria-hidden="true">
        —
      </span>
      <span className={styles.srOnly}>
        {t('quota_management.ledger_window_missing', { window: label })}
      </span>
    </div>
  );
}
