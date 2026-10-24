/**
 * The quota page's email visibility (masked by default, session-scoped).
 *
 * Notifications are built after a request settles, often seconds after the
 * click. `noticeNameFor` therefore reads the visibility at the moment it is
 * called, never the value captured when the action started: hiding emails
 * while a refresh is in flight must not let its toast print the address.
 * Hiding also dismisses toasts already on screen that name a credential
 * unmasked.
 */

import { useCallback, useRef, useState } from 'react';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem, Notification } from '@/types';
import { formatQuotaIdentity } from '@/utils/quota/identity';
import { writeQuotaUiState } from '../uiState';

/** Unmasked identities that masking would change — what must leave the screen on hide. */
export function revealedIdentities(files: readonly AuthFileItem[]): string[] {
  const identities = new Set<string>();
  files.forEach((file) => {
    const raw = formatQuotaIdentity(file, true);
    if (raw && raw !== formatQuotaIdentity(file, false)) identities.add(raw);
  });
  return [...identities];
}

/** Ids of notifications whose text names one of `identities`. */
export function notificationsNaming(
  notifications: readonly Notification[],
  identities: readonly string[]
): string[] {
  if (identities.length === 0) return [];
  return notifications
    .filter((notification) =>
      identities.some((identity) => notification.message.includes(identity))
    )
    .map((notification) => notification.id);
}

export function useEmailVisibility(initial: () => boolean, files: readonly AuthFileItem[]) {
  const [showEmails, setShowEmails] = useState(initial);
  // Source of truth for callbacks; updated in the event handler, before any re-render.
  const showEmailsRef = useRef(showEmails);

  const toggleEmails = useCallback(() => {
    const next = !showEmailsRef.current;
    showEmailsRef.current = next;
    setShowEmails(next);
    writeQuotaUiState({ showEmails: next });
    if (!next) {
      const { notifications, removeNotification } = useNotificationStore.getState();
      notificationsNaming(notifications, revealedIdentities(files)).forEach(removeNotification);
    }
  }, [files]);

  const noticeNameFor = useCallback(
    (file: AuthFileItem) => formatQuotaIdentity(file, showEmailsRef.current),
    []
  );

  return { showEmails, toggleEmails, noticeNameFor };
}
