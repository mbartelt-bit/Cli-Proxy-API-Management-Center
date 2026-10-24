/**
 * 单卡额度操作：刷新 + Codex 重置积分。
 * 流程 1:1 移植旧 QuotaSection（confirm modal、resetting 再入守卫、
 * generation-guarded commit、成功/失败通知），仅把 config 换成 adapter。
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { enrichQuotaInBackground } from '../quotaEnrichment';
import { getQuotaMap, getQuotaSetter, type QuotaAdapter, type QuotaCardState } from '../providers';

const getQuotaState = (adapter: QuotaAdapter, file: AuthFileItem): QuotaCardState | undefined =>
  getQuotaMap(adapter)[getQuotaCacheKey(file)];

const rawFileName = (file: AuthFileItem) => file.name;

/**
 * @param nameFor how notifications and confirmations name a credential — the
 * quota page passes its (possibly masked) display identity. It is called when
 * the text is shown, through the latest formatter passed in, so a toast that
 * lands after the user hides emails names the credential masked.
 */
export function useQuotaActions(
  disableControls: boolean,
  nameFor: (file: AuthFileItem) => string = rawFileName
) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);
  const nameForRef = useRef(nameFor);
  useLayoutEffect(() => {
    nameForRef.current = nameFor;
  }, [nameFor]);
  const currentNameFor = useCallback((file: AuthFileItem) => nameForRef.current(file), []);

  const refreshQuota = useCallback(
    async (file: AuthFileItem, adapter: QuotaAdapter) => {
      if (disableControls || file.disabled) return;
      const cacheKey = getQuotaCacheKey(file);
      if (resettingQuotaName === cacheKey) return;
      if (getQuotaState(adapter, file)?.status === 'loading') return;
      const cacheGeneration = captureQuotaCacheGeneration(file.name);
      const setQuota = getQuotaSetter(adapter);

      setQuota((prev) => ({
        ...prev,
        [cacheKey]: adapter.buildLoadingState(),
      }));

      try {
        const data = await adapter.fetchQuota(file, t);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          const successState = adapter.buildSuccessState(data);
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: successState,
          }));
          void enrichQuotaInBackground(adapter, file, data, successState, t);
          showNotification(
            t('auth_files.quota_refresh_success', { name: currentNameFor(file) }),
            'success'
          );
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: adapter.buildErrorState(message, status),
          }));
          showNotification(
            t('auth_files.quota_refresh_failed', { name: currentNameFor(file), message }),
            'error'
          );
        });
      }
    },
    [currentNameFor, disableControls, resettingQuotaName, showNotification, t]
  );

  const resetQuota = useCallback(
    (file: AuthFileItem, adapter: QuotaAdapter) => {
      const resetQuotaFn = adapter.resetQuota;
      if (!resetQuotaFn) return;
      if (disableControls || file.disabled) return;
      const cacheKey = getQuotaCacheKey(file);
      if (getQuotaState(adapter, file)?.status === 'loading') return;
      if (resettingQuotaName === cacheKey) return;

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', { name: currentNameFor(file) }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          const cacheGeneration = captureQuotaCacheGeneration(file.name);
          const setQuota = getQuotaSetter(adapter);
          setResettingQuotaName(cacheKey);
          try {
            const data = await resetQuotaFn(file, t);
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => ({
                ...prev,
                [cacheKey]: adapter.buildSuccessState(data),
              }));
              showNotification(
                t('codex_quota.reset_success', { name: currentNameFor(file) }),
                'success'
              );
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              showNotification(
                t('codex_quota.reset_failed', { name: currentNameFor(file), message }),
                'error'
              );
            });
          } finally {
            setResettingQuotaName((current) => (current === cacheKey ? null : current));
          }
        },
      });
    },
    [currentNameFor, disableControls, resettingQuotaName, showConfirmation, showNotification, t]
  );

  return { resettingQuotaName, refreshQuota, resetQuota };
}
