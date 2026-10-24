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

/*
 * Filenames exactly as CLIProxyAPI writes them (internal/auth/*: claude and
 * codex filename.go, antigravity filename.go, xai token.go, meta meta.go,
 * devin record.go; Kimi and Vertex embed no email). Each must hide the address
 * while the provider prefix and any identity hash stay readable — with the
 * account email known, and without it.
 */
describe('maskIdentity: backend credential filenames', () => {
  const cases: {
    provider: string;
    name: string;
    email: string;
    masked: string;
    /** Expected without the email, when the fallback cannot match the known-email result. */
    withoutEmail?: string;
  }[] = [
    // claude-<email>.json and claude-<sha256(org|account)[:8]>-<email>.json
    {
      provider: 'claude',
      name: 'claude-theo@t3.gg.json',
      email: 'theo@t3.gg',
      masked: 'claude-t•••@t•••.gg.json',
    },
    {
      provider: 'claude',
      name: 'claude-3f2a9c1d-theo@t3.gg.json',
      email: 'theo@t3.gg',
      masked: 'claude-3f2a9c1d-t•••@t•••.gg.json',
    },
    // codex-[<hash8>-]<email>[-<plan>].json
    {
      provider: 'codex',
      name: 'codex-theo@t3.gg-plus.json',
      email: 'theo@t3.gg',
      masked: 'codex-t•••@t•••.gg-plus.json',
    },
    {
      provider: 'codex',
      name: 'codex-1a2b3c4d-john-smith@acme.com-team.json',
      email: 'john-smith@acme.com',
      masked: 'codex-1a2b3c4d-j•••@a•••.com-team.json',
    },
    {
      provider: 'codex',
      name: 'codex-1a2b3c4d-theo@t3.gg.json',
      email: 'theo@t3.gg',
      masked: 'codex-1a2b3c4d-t•••@t•••.gg.json',
    },
    // antigravity-<email>.json
    {
      provider: 'antigravity',
      name: 'antigravity-theo@gmail.com.json',
      email: 'theo@gmail.com',
      masked: 'antigravity-t•••@g•••.com.json',
    },
    // xai-<email with runes outside [A-Za-z0-9@._-] as "-", "-" trimmed>.json
    {
      provider: 'xai',
      name: 'xai-mary-jane@example.org.json',
      email: 'mary-jane@example.org',
      masked: 'xai-m•••@e•••.org.json',
    },
    {
      provider: 'xai',
      name: 'xai-jane.doe-work@acme.com.json',
      email: 'jane.doe+work@acme.com',
      masked: 'xai-j•••@a•••.com.json',
    },
    {
      provider: 'xai',
      name: 'xai-jos-@t3.gg.json',
      email: 'josé@t3.gg',
      masked: 'xai-j•••@t•••.gg.json',
    },
    {
      provider: 'xai',
      name: 'xai-lodie@x.fr.json',
      email: 'élodie@x.fr',
      masked: 'xai-l•••@x•••.fr.json',
    },
    // meta-<email with runes outside [A-Za-z0-9._-] as "_", 120 max>-<sha256[:8] hex>.json
    {
      provider: 'meta',
      name: 'meta-theo_t3.gg-191b52b8bb642103.json',
      email: 'theo@t3.gg',
      masked: 'meta-t•••_t•••.gg-191b52b8bb642103.json',
    },
    {
      provider: 'meta',
      name: 'meta-jane.doe_work_acme.com-632e12eae30b7002.json',
      email: 'jane.doe+work@acme.com',
      masked: 'meta-j•••_a•••.com-632e12eae30b7002.json',
    },
    {
      provider: 'meta',
      name: 'meta-jos__t3.gg-8a92907e80d44f67.json',
      email: 'josé@t3.gg',
      masked: 'meta-j•••_t•••.gg-8a92907e80d44f67.json',
    },
    {
      provider: 'meta',
      name: `meta-j${'x'.repeat(99)}_example-company-sub-2fe2468c01c57981.json`,
      email: `j${'x'.repeat(99)}@example-company-subdomain.co.uk`,
      masked: 'meta-j•••_e•••-2fe2468c01c57981.json',
    },
    // devin-<user name>.json; the quota page appends the email to tell identities apart.
    {
      provider: 'devin',
      name: 'devin-theo.json · theo@t3.gg',
      email: 'theo@t3.gg',
      masked: 'devin-theo.json · t•••@t•••.gg',
    },
    {
      provider: 'devin',
      name: 'devin-theo@t3.gg.json · theo@t3.gg',
      email: 'theo@t3.gg',
      masked: 'devin-t•••@t•••.gg.json · t•••@t•••.gg',
    },
  ];

  test.each(cases)('$name', ({ provider, name, email, masked, withoutEmail }) => {
    const local = email.slice(0, email.lastIndexOf('@'));
    expect(maskIdentity(name, email, provider)).toBe(masked);
    expect(maskIdentity(name, email)).toBe(masked);
    // Matched case-insensitively; the mask itself is drawn from the known email.
    expect(maskIdentity(name, email.toUpperCase(), provider).toLowerCase()).toBe(
      masked.toLowerCase()
    );

    // Without the email (or with a stale one) the address still never shows.
    for (const fallback of [
      maskIdentity(name, null, provider),
      maskIdentity(name, undefined),
      maskIdentity(name, 'someone-else@example.com', provider),
    ]) {
      if (withoutEmail !== undefined) expect(fallback).toBe(withoutEmail);
      expect(fallback).not.toContain(`${local}@`);
      expect(fallback).not.toContain(email);
    }

    // Idempotent: re-masking a masked name changes nothing.
    expect(maskIdentity(masked, email, provider)).toBe(masked);
    expect(maskIdentity(masked)).toBe(masked);
  });

  test('without the email, prefixes and identity hashes stay readable', () => {
    expect(maskIdentity('claude-3f2a9c1d-theo@t3.gg.json', null, 'claude')).toBe(
      'claude-3f2a9c1d-t•••@t•••.gg.json'
    );
    expect(maskIdentity('codex-1a2b3c4d-john-smith@acme.com-team.json')).toBe(
      'codex-1a2b3c4d-j•••@a•••.com-team.json'
    );
    expect(maskIdentity('xai-mary-jane@example.org.json')).toBe('xai-m•••@e•••.org.json');
    expect(maskIdentity('meta-theo_t3.gg-191b52b8bb642103.json')).toBe(
      'meta-t•••_t•••.gg-191b52b8bb642103.json'
    );
    expect(maskIdentity('meta-jane.doe_work_acme.com-632e12eae30b7002.json')).toBe(
      'meta-j•••_a•••.com-632e12eae30b7002.json'
    );
  });

  test('names the backend writes without an email pass through unchanged', () => {
    for (const name of [
      'kimi-1761307200000.json',
      'kimi-ai-1761307200000.json',
      'vertex-my-project.json',
      'meta-191b52b8bb642103.json',
      'meta-oauth.json',
      'xai-1761307200000.json',
      'devin-user-0123456789abcdef.json',
      'antigravity.json',
    ]) {
      expect(maskIdentity(name, null, name.split('-')[0])).toBe(name);
    }
  });
});

describe('maskIdentity: fallback pattern', () => {
  test('masks hyphenated mailboxes whole while keeping a known provider prefix', () => {
    expect(maskIdentity('claude-mary-jane@example.org.json')).toBe('claude-m•••@e•••.org.json');
    expect(maskIdentity('devin.json · theo-x@t3.gg')).toBe('devin.json · t•••@t•••.gg');
    // An unknown leading word is not assumed to be a prefix: masked with the mailbox.
    expect(maskIdentity('backup-theo@t3.gg.json')).toBe('b•••@t•••.gg.json');
  });

  test("the credential's type keeps its own prefix readable", () => {
    expect(maskIdentity('acme-theo@x.io.json', null, 'acme')).toBe('acme-t•••@x•••.io.json');
    expect(maskIdentity('acme-theo@x.io.json', null, ' ACME ')).toBe('acme-t•••@x•••.io.json');
    expect(maskIdentity('acme-theo@x.io.json')).toBe('a•••@x•••.io.json');
    // A legacy filename the v8 backend no longer writes, recognised through its type.
    expect(maskIdentity('gemini-theo@gmail.com-my-project.json', null, 'gemini')).toBe(
      'gemini-t•••@g•••.com-my-project.json'
    );
  });

  test('is Unicode-aware: accented mailboxes, IDN domains, non-Latin scripts', () => {
    expect(maskIdentity('claude-josé@t3.gg.json')).toBe('claude-j•••@t•••.gg.json');
    expect(maskIdentity('claude-theo@bücher.de.json')).toBe('claude-t•••@b•••.de.json');
    expect(maskIdentity('devin.json · josé@t3.gg', null)).toBe('devin.json · j•••@t•••.gg');
    expect(maskIdentity('codex-пользователь@пример.рф.json')).toBe('codex-п•••@п•••.рф.json');
    expect(maskIdentity("codex-o'brien@acme.com.json")).toBe('codex-o•••@a•••.com.json');
  });

  test('matches across Unicode normalization forms', () => {
    const nfdName = 'claude-josé@t3.gg.json'.normalize('NFD');
    expect(maskIdentity(nfdName, 'josé@t3.gg')).toBe('claude-j•••@t•••.gg.json');
    expect(maskIdentity(nfdName, 'josé@t3.gg'.normalize('NFD'))).toBe('claude-j•••@t•••.gg.json');
    expect(maskIdentity(nfdName)).toBe('claude-j•••@t•••.gg.json');
    // Nothing to mask: the original string comes back untouched, not re-normalized.
    const nfdPlain = 'codex-équipe.json'.normalize('NFD');
    expect(maskIdentity(nfdPlain, 'josé@t3.gg')).toBe(nfdPlain);
  });

  test('case-insensitive replacement stays aligned when lower-casing changes length', () => {
    // "İ" lower-cases to two code units; indices from a lower-cased copy drift.
    expect(maskIdentity('İİ-claude-theo@t3.gg.json', 'theo@t3.gg')).toBe(
      'İİ-claude-t•••@t•••.gg.json'
    );
    expect(maskIdentity('İ-THEO@T3.GG-İ.json', 'theo@t3.gg')).toBe('İ-t•••@t•••.gg-İ.json');
  });

  test('a known email with regex characters is matched literally', () => {
    expect(maskIdentity('claude-a.b+c@t3.gg.json', 'a.b+c@t3.gg')).toBe('claude-a•••@t•••.gg.json');
    expect(maskIdentity('claude-axb+c@t3.gg.json', 'a.b+c@t3.gg', 'claude')).toBe(
      'claude-a•••@t•••.gg.json'
    );
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

  test('masks the sanitized email in a Meta filename', () => {
    const meta = {
      name: 'meta-theo_t3.gg-191b52b8bb642103.json',
      type: 'meta',
      email: 'theo@t3.gg',
    };
    expect(formatQuotaIdentity(meta, false)).toBe('meta-t•••_t•••.gg-191b52b8bb642103.json');
    expect(formatQuotaIdentity({ ...meta, email: undefined }, false)).toBe(
      'meta-t•••_t•••.gg-191b52b8bb642103.json'
    );
    expect(formatQuotaIdentity(meta, true)).toBe(meta.name);
  });

  test("keeps the credential type's own filename prefix readable", () => {
    const file = { name: 'acme-theo@x.io.json', type: 'acme' };
    expect(formatQuotaIdentity(file, false)).toBe('acme-t•••@x•••.io.json');
    expect(formatQuotaIdentity({ ...file, type: undefined, provider: 'acme' }, false)).toBe(
      'acme-t•••@x•••.io.json'
    );
  });
});
