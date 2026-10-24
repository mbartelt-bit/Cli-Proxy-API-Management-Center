import type { QuotaProviderType } from './providers/types';

/** tab 顺序 = 旧页五分区的纵向顺序，'全部' tab 下卡片也按此分组排列。 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
  'plugin',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/**
 * Tabs the quota page always lists, even with no credentials — the row the
 * ledger was designed around. Providers added since (Devin, Meta, plugins)
 * only get a tab once they have a credential (or are the active tab), so an
 * empty tab never pushes the row under the view select.
 */
export const QUOTA_ALWAYS_VISIBLE_TABS: readonly QuotaTabId[] = [
  'all',
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
];

/** 页级分页固定 20/页，同时把「刷新全部」的上游并发限制在 20。 */
export const QUOTA_PAGE_SIZE = 20;

/** 卡片排序：默认 = provider 分组序；soonest = 最快恢复优先。 */
export const QUOTA_SORT_MODES = ['default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** Page layout: the provider-grouped ledger (default) or the per-credential card grid. */
export const QUOTA_VIEW_MODES = ['ledger', 'cards'] as const;

export type QuotaViewMode = (typeof QUOTA_VIEW_MODES)[number];

export const DEFAULT_QUOTA_VIEW_MODE: QuotaViewMode = 'ledger';

/**
 * Remaining-percent tiers shared by every quota meter: ≥70 healthy, ≥30
 * watch, below that low. Kept React-free so pure models can classify too.
 */
export const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
export const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;
