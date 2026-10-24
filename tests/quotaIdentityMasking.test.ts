/**
 * Identity masking for the quota page (privacy while screen sharing).
 */

import { describe, expect, test } from 'bun:test';
import { maskEmail, maskIdentity } from '@/utils/quota/masking';
import { formatQuotaIdentity } from '@/utils/quota/identity';

describe('maskEmail', () => {
  test('keeps the first character of the mailbox and domain plus the suffix', () => {
    expect(maskEmail('theo@t3.gg')).toBe('t•••@t•••.gg');
    expect(maskEmail('someone@example.co.uk')).toBe('s•••@e•••.co.uk');
    expect(maskEmail('1password@1.dev')).toBe('1•••@1•••.dev');
  });

  test('handles a dotless domain and odd shapes without throwing', () => {
    expect(maskEmail('root@localhost')).toBe('r•••@l•••');
    expect(maskEmail('@t3.gg')).toBe('@t•••.gg');
    expect(maskEmail('theo@')).toBe('t•••@');
    expect(maskEmail('theo@.gg')).toBe('t•••@.gg');
    expect(maskEmail('')).toBe('');
    expect(maskEmail('no-at-sign')).toBe('no-at-sign');
  });

  test('masks the domain after the last @ and keeps multi-byte characters whole', () => {
    expect(maskEmail('a@b@c.com')).toBe('a•••@c•••.com');
    expect(maskEmail('😀user@例え.jp')).toBe('😀•••@例•••.jp');
  });
});

describe('maskIdentity', () => {
  test('replaces the known email wherever it occurs, case-insensitively', () => {
    expect(maskIdentity('claude-theo@t3.gg.json', 'theo@t3.gg')).toBe('claude-t•••@t•••.gg.json');
    expect(maskIdentity('codex-Theo@T3.gg.json', 'theo@t3.gg')).toBe('codex-t•••@t•••.gg.json');
    expect(maskIdentity('devin.json · theo-x@t3.gg', 'theo-x@t3.gg')).toBe(
      'devin.json · t•••@t•••.gg'
    );
  });

  test('falls back to email-shaped substrings, keeping hyphenated provider prefixes', () => {
    expect(maskIdentity('claude-theo@t3.gg.json')).toBe('claude-t•••@t•••.gg.json');
    expect(maskIdentity('claude-theo@1password.dev.json')).toBe('claude-t•••@1•••.dev.json');
    expect(maskIdentity('a@x.io and b@y.io')).toBe('a•••@x•••.io and b•••@y•••.io');
  });

  test('a mismatched known email still never leaks the address in the name', () => {
    expect(maskIdentity('claude-theo@t3.gg.json', 'other@example.com')).toBe(
      'claude-t•••@t•••.gg.json'
    );
    expect(maskIdentity('claude-theo@t3.gg.json', '  ')).toBe('claude-t•••@t•••.gg.json');
    expect(maskIdentity('claude-theo@t3.gg.json', null)).toBe('claude-t•••@t•••.gg.json');
  });

  test('passes names without an email through unchanged', () => {
    expect(maskIdentity('codex-team-01.json')).toBe('codex-team-01.json');
    expect(maskIdentity('kimi.json', 'theo@t3.gg')).toBe('kimi.json');
    expect(maskIdentity('')).toBe('');
    expect(maskIdentity('weird@')).toBe('weird@');
  });

  test('is idempotent', () => {
    const once = maskIdentity('claude-theo@t3.gg.json', 'theo@t3.gg');
    expect(maskIdentity(once)).toBe(once);
    expect(maskIdentity(once, 'theo@t3.gg')).toBe(once);
  });
});

describe('formatQuotaIdentity', () => {
  const claude = { name: 'claude-theo@t3.gg.json', type: 'claude', email: 'theo@t3.gg' };
  const devin = {
    name: 'devin.json',
    type: 'devin',
    email: 'theo@t3.gg',
    authIndex: '3',
  };

  test('masks by default and shows the raw display name on request', () => {
    expect(formatQuotaIdentity(claude, false)).toBe('claude-t•••@t•••.gg.json');
    expect(formatQuotaIdentity(claude, true)).toBe('claude-theo@t3.gg.json');
  });

  test('masks the email Devin appends to its display name', () => {
    expect(formatQuotaIdentity(devin, true)).toBe('devin.json · theo@t3.gg');
    expect(formatQuotaIdentity(devin, false)).toBe('devin.json · t•••@t•••.gg');
  });
});
