/**
 * Quota page interactions that outlive a render: notification names, the
 * email toggle, and the tab row's scroll fade.
 *
 * There is no browser DOM harness, so hooks are run once through
 * `renderToStaticMarkup` and the callbacks they return are driven directly —
 * which is exactly the situation under test: a callback invoked after the
 * render that created it.
 */

import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { formatQuotaIdentity } from '@/utils/quota/identity';
import { QUOTA_ADAPTERS, type QuotaAdapter } from '@/features/quota/providers';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import {
  notificationsNaming,
  revealedIdentities,
  useEmailVisibility,
} from '@/features/quota/hooks/useEmailVisibility';
import { resolveScrollEdges, scrollFadeAttribute } from '@/features/quota/hooks/useScrollEdges';

const FILE: AuthFileItem = {
  name: 'codex-theo@t3.gg.json',
  type: 'codex',
  email: 'theo@t3.gg',
};
const MASKED = formatQuotaIdentity(FILE, false);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  useQuotaStore.getState().clearQuotaCache();
  useNotificationStore.setState({ notifications: [] });
});

/** Run a hook once and hand back what it returned. */
function captureHook<T>(useHook: () => T): T {
  let captured: T | undefined;
  function Probe() {
    captured = useHook();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (captured === undefined) throw new Error('hook did not run');
  return captured;
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const toastMessages = () => useNotificationStore.getState().notifications.map((n) => n.message);

describe('quota action notifications', () => {
  const adapterWith = (fetchQuota: QuotaAdapter['fetchQuota']): QuotaAdapter =>
    ({ ...QUOTA_ADAPTERS.codex, fetchQuota, enrichQuota: undefined }) as QuotaAdapter;

  test('a refresh toast names the credential as the page shows it when the toast lands', async () => {
    // Emails shown at click time, hidden while the request is in flight.
    let showEmails = true;
    const actions = captureHook(() =>
      useQuotaActions(false, (file) => formatQuotaIdentity(file, showEmails))
    );
    const pending = deferred<unknown>();
    const refresh = actions.refreshQuota(
      FILE,
      adapterWith(() => pending.promise as never)
    );

    showEmails = false;
    pending.resolve({ windows: [] });
    await refresh;

    expect(toastMessages()).toEqual([`Quota refreshed for "${MASKED}"`]);
    expect(toastMessages().join(' ')).not.toContain('theo@t3.gg');
  });

  test('a failure toast reads the visibility at the same moment', async () => {
    let showEmails = true;
    const actions = captureHook(() =>
      useQuotaActions(false, (file) => formatQuotaIdentity(file, showEmails))
    );
    const pending = deferred<unknown>();
    const refresh = actions.refreshQuota(
      FILE,
      adapterWith(() => pending.promise as never)
    );

    showEmails = false;
    pending.reject(new Error('upstream down'));
    await refresh;

    expect(toastMessages()).toHaveLength(1);
    expect(toastMessages()[0]).toContain(MASKED);
    expect(toastMessages()[0]).not.toContain('theo@t3.gg');
  });
});

describe('email visibility', () => {
  test('hiding takes effect for notification names at once, without waiting for a render', () => {
    const visibility = captureHook(() => useEmailVisibility(() => true, [FILE]));
    expect(visibility.showEmails).toBe(true);
    expect(visibility.noticeNameFor(FILE)).toBe('codex-theo@t3.gg.json');

    visibility.toggleEmails();
    // Same callback instance, captured before the toggle.
    expect(visibility.noticeNameFor(FILE)).toBe(MASKED);

    visibility.toggleEmails();
    expect(visibility.noticeNameFor(FILE)).toBe('codex-theo@t3.gg.json');
  });

  test('hiding dismisses toasts already on screen that name a credential unmasked', () => {
    const other: AuthFileItem = { name: 'plain-key.json', type: 'codex' };
    const { showNotification } = useNotificationStore.getState();
    showNotification(`Quota refreshed for "${FILE.name}"`, 'success');
    showNotification(`Quota refreshed for "${MASKED}"`, 'success');
    showNotification('Quota refreshed for "plain-key.json"', 'success');

    const visibility = captureHook(() => useEmailVisibility(() => true, [FILE, other]));
    visibility.toggleEmails();

    expect(toastMessages()).toEqual([
      `Quota refreshed for "${MASKED}"`,
      'Quota refreshed for "plain-key.json"',
    ]);
  });

  test('only identities masking would change count as revealed', () => {
    const plain: AuthFileItem = { name: 'plain-key.json', type: 'codex' };
    expect(revealedIdentities([FILE, plain, FILE])).toEqual([FILE.name]);
    expect(
      notificationsNaming(
        [
          { id: 'a', message: `x ${FILE.name} y`, type: 'success' },
          { id: 'b', message: 'unrelated', type: 'info' },
        ],
        [FILE.name]
      )
    ).toEqual(['a']);
    expect(notificationsNaming([{ id: 'a', message: 'x', type: 'info' }], [])).toEqual([]);
  });
});

describe('tab row scroll fade', () => {
  test('fades only the side(s) that still hide tabs', () => {
    const at = (scrollLeft: number) =>
      resolveScrollEdges({ scrollLeft, clientWidth: 968, scrollWidth: 1057 });
    expect(at(0)).toEqual({ start: false, end: true });
    expect(at(40)).toEqual({ start: true, end: true });
    // Scrolled to the end: nothing left to reveal there.
    expect(at(89)).toEqual({ start: true, end: false });
    expect(at(88.5)).toEqual({ start: true, end: false });
    // Everything fits: no fade at all.
    expect(resolveScrollEdges({ scrollLeft: 0, clientWidth: 968, scrollWidth: 968 })).toEqual({
      start: false,
      end: false,
    });
    expect(resolveScrollEdges({ scrollLeft: 0, clientWidth: 968, scrollWidth: 968.6 })).toEqual({
      start: false,
      end: false,
    });
  });

  test('maps edges to the data-fade attribute the stylesheet keys off', () => {
    expect(scrollFadeAttribute({ start: false, end: false })).toBeUndefined();
    expect(scrollFadeAttribute({ start: false, end: true })).toBe('end');
    expect(scrollFadeAttribute({ start: true, end: false })).toBe('start');
    expect(scrollFadeAttribute({ start: true, end: true })).toBe('both');
  });

  test('the quota page masks the strip only under data-fade, leaving ProviderTabs alone', () => {
    const pageCss = readFileSync('src/features/quota/QuotaPage.module.scss', 'utf8');
    const masks = [...pageCss.matchAll(/^(.*)\n\s*mask-image:/gm)].map(([, selector]) =>
      selector.trim()
    );
    expect(masks).toEqual([
      "&[data-fade='end'] > :first-child {",
      "&[data-fade='start'] > :first-child {",
      "&[data-fade='both'] > :first-child {",
    ]);
    const tabsCss = readFileSync(
      'src/features/authFiles/components/ProviderTabs.module.scss',
      'utf8'
    );
    expect(tabsCss).not.toContain('mask-image');
    const page = readFileSync('src/features/quota/QuotaPage.tsx', 'utf8');
    expect(page).toContain('data-fade={scrollFadeAttribute(tabEdges)}');
  });
});
