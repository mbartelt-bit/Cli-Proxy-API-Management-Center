/**
 * Identity masking for screen sharing.
 *
 * Credential filenames usually embed the account email (`claude-theo@t3.gg.json`),
 * so the quota page masks them by default. Masking keeps just enough shape to
 * tell credentials apart at a glance — the first character of the mailbox and
 * of the domain, plus the full suffix — without putting the address on screen.
 * The provider prefix the backend writes in front of the email stays readable,
 * and so does an identity hash when the account email is known. Without it, a
 * hash cannot be told apart from the start of a mailbox, so it is masked too.
 *
 * Pure string helpers: search and every request keep using the raw values.
 */

const MASK = '•••';

const firstChar = (value: string): string => Array.from(value)[0] ?? '';

/**
 * `local` + `separator` + `domain` with the mailbox reduced to its first
 * character and the domain to the first character of its first label plus
 * everything from the first dot on.
 */
const maskAddressParts = (local: string, separator: string, domain: string): string => {
  const dot = domain.indexOf('.');
  const firstLabel = dot < 0 ? domain : domain.slice(0, dot);
  const suffix = dot < 0 ? '' : domain.slice(dot);
  const maskedLocal = local ? `${firstChar(local)}${MASK}` : '';
  const maskedDomain = `${firstLabel ? `${firstChar(firstLabel)}${MASK}` : ''}${suffix}`;
  return `${maskedLocal}${separator}${maskedDomain}`;
};

/**
 * `theo@t3.gg` → `t•••@t•••.gg`.
 *
 * The mailbox keeps its first character; the domain keeps the first character
 * of its first label and everything from the first dot on. Input without an
 * `@` is returned unchanged — there is nothing email-shaped to hide.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return email;
  return maskAddressParts(email.slice(0, at), '@', email.slice(at + 1));
}

/* ------------------------------------------------- backend email spellings */

/** One way the backend may have written a known email into a filename. */
interface EmailSpelling {
  text: string;
  mask: string;
}

/**
 * A sanitized spelling and its mask. The backend sanitizers map one rune to
 * one ASCII character, so the email's `@` sits at the same code-point index
 * in the sanitized text (shifted only by characters trimmed from the front).
 */
const sanitizedSpelling = (text: string, separatorIndex: number): EmailSpelling => ({
  text,
  mask:
    separatorIndex < 0 || separatorIndex >= text.length
      ? text
        ? `${firstChar(text)}${MASK}`
        : ''
      : maskAddressParts(
          text.slice(0, separatorIndex),
          text.charAt(separatorIndex),
          text.slice(separatorIndex + 1)
        ),
});

const META_KEPT_RUNE = /^[A-Za-z0-9._-]$/;
const META_MAX_SANITIZED_LENGTH = 120;

/**
 * Meta: `meta-<sanitized>-<16 hex>.json`, where every rune outside
 * `[A-Za-z0-9._-]` (the `@` included) becomes `_`, truncated to 120 bytes —
 * all ASCII by then, so 120 characters. Mirrors `CredentialFileName` in
 * CLIProxyAPI internal/auth/meta/meta.go.
 */
const metaSpelling = (email: string): EmailSpelling => {
  const runes = Array.from(email);
  const at = runes.lastIndexOf('@');
  const text = runes
    .map((rune) => (META_KEPT_RUNE.test(rune) ? rune : '_'))
    .join('')
    .slice(0, META_MAX_SANITIZED_LENGTH);
  return sanitizedSpelling(text, at);
};

const XAI_KEPT_RUNE = /^[A-Za-z0-9@._-]$/;

/**
 * xAI: `xai-<sanitized>.json`, where every rune outside `[A-Za-z0-9@._-]`
 * becomes `-` and leading/trailing `-` are trimmed. Mirrors
 * `sanitizeFileSegment` in CLIProxyAPI internal/auth/xai/token.go.
 */
const xaiSpelling = (email: string): EmailSpelling => {
  const mapped = Array.from(email)
    .map((rune) => (XAI_KEPT_RUNE.test(rune) ? rune : '-'))
    .join('');
  const text = mapped.replace(/^-+|-+$/g, '');
  return sanitizedSpelling(text, text.lastIndexOf('@'));
};

/**
 * Every spelling of `email` a backend-written filename can contain, longest
 * first. Claude, Codex and Antigravity embed the trimmed email verbatim; Meta
 * and xAI sanitize it (see above); Devin, Kimi and Vertex never embed it. The
 * sanitizers run on the email exactly as stored and on both Unicode
 * normalization forms, since a sanitized rune count depends on composition.
 */
const knownEmailSpellings = (email: string): EmailSpelling[] => {
  const spellings = new Map<string, string>();
  const add = ({ text, mask }: EmailSpelling) => {
    if (text && !spellings.has(text)) spellings.set(text, mask);
  };
  const composed = email.normalize('NFC');
  add({ text: composed, mask: maskEmail(composed) });
  for (const form of new Set([email, composed, email.normalize('NFD')])) {
    add(metaSpelling(form));
    add(xaiSpelling(form));
  }
  return [...spellings]
    .map(([text, mask]) => ({ text, mask }))
    .sort((a, b) => b.text.length - a.text.length);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Characters a mailbox may start with, Unicode-aware: letters, digits, marks
 * and symbols in any script plus RFC 5322 atext. Past its first character a
 * mailbox may also contain `.` and `-`.
 */
const MAILBOX_LEAD = "\\p{L}\\p{N}\\p{M}\\p{So}!#$%&'*+/=?^_`{|}~";

/**
 * Replace every case-insensitive occurrence of any spelling in one pass over
 * the original string. Matching with a RegExp rather than indexing into a
 * lower-cased copy keeps offsets right when lower-casing changes length
 * (`İ` lower-cases to two code units).
 *
 * A spelling only matches at the start of a token: never right after a
 * mailbox character or `.`, so only at the start of the name or after a
 * space, a `-` or other punctuation. Otherwise a spelling could start inside
 * the text before it: the NFD xAI spelling of `Ícaro@…` (`I-caro@…`) would
 * eat the `i-` of `xai-`, and a stale `theo@…` would leave the `ann.` of
 * `ann.theo@…` readable.
 */
const replaceSpellings = (haystack: string, spellings: readonly EmailSpelling[]): string => {
  if (spellings.length === 0) return haystack;
  const alternation = spellings.map((spelling) => `(${escapeRegExp(spelling.text)})`).join('|');
  // Non-capturing wrapper, so group i + 1 is still spellings[i].
  const pattern = new RegExp(`(?<![${MAILBOX_LEAD}.])(?:${alternation})`, 'giu');
  return haystack.replace(pattern, (...args: unknown[]) => {
    const index = args.slice(1, 1 + spellings.length).findIndex((group) => group !== undefined);
    return spellings[index]?.mask ?? MASK;
  });
};

/* ------------------------------------------------------------- fallbacks */

/**
 * Meta's filename shape, for a Meta credential whose email is unknown or no
 * longer matches: the account part between the prefix and the identity hash
 * is a sanitized email (no `@` left to find). The last `_` stands in for the
 * `@`; if it was really a sanitized domain character, the mask still hides
 * all but two characters and the dotted suffix.
 */
const META_FILE_SHAPE = /^(meta-)(.+)(-[0-9a-f]{16}\.json)$/i;

const maskMetaFileShape = (name: string): string => {
  const match = META_FILE_SHAPE.exec(name);
  if (!match) return name;
  const [, prefix, account, suffix] = match;
  // Already masked, or an address the general pattern handles.
  if (account.includes(MASK) || account.includes('@')) return name;
  return `${prefix}${sanitizedSpelling(account, account.lastIndexOf('_')).mask}${suffix}`;
};

/**
 * Leading tokens the backend writes in front of an email (CLIProxyAPI
 * internal/auth/{antigravity,claude,codex,devin,meta,xai} filename builders,
 * plus Kimi and Vertex), longest first so `kimi-ai` wins over `kimi`.
 */
const CREDENTIAL_FILE_PREFIXES = [
  'antigravity',
  'kimi-ai',
  'claude',
  'vertex',
  'codex',
  'devin',
  'kimi',
  'meta',
  'xai',
];

const PROVIDER_TOKEN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The readable head of a credential name: the provider prefix, trying the
 * credential's own type first, then the backend's known prefixes. Empty when
 * none leads.
 *
 * The 8-hex identity hash Claude and Codex may write after the prefix is not
 * kept here. Their older names put the mailbox right after the prefix, so
 * without the email `claude-deadbeef-x@…` could be a hash or a mailbox. It is
 * masked with the mailbox; with the email known, only the email is replaced
 * and the hash stays readable.
 */
const readablePrefix = (name: string, provider?: string | null): string => {
  const hint = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  const candidates = PROVIDER_TOKEN.test(hint)
    ? [hint, ...CREDENTIAL_FILE_PREFIXES]
    : CREDENTIAL_FILE_PREFIXES;
  for (const candidate of candidates) {
    const token = `${candidate}-`;
    // Compare a slice of the original so offsets never come from a case-mapped copy.
    if (name.slice(0, token.length).toLowerCase() === token) return name.slice(0, token.length);
  }
  return '';
};

/**
 * Email-shaped substring, Unicode-aware. The mailbox takes `MAILBOX_LEAD`
 * characters (`-` and `.` too, but not as its first character), so a
 * hyphenated or accented mailbox is masked whole; the domain swallows any
 * trailing dotted suffix (`.json`, `.com-team.json`), which the mask keeps
 * verbatim anyway. Provider prefixes are protected by `readablePrefix`, not
 * by the pattern stopping at a `-`.
 */
const DOMAIN_LABEL = '[\\p{L}\\p{N}\\p{M}-]+';
const EMAIL_PATTERN = new RegExp(
  `[${MAILBOX_LEAD}][${MAILBOX_LEAD}.-]*@${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+`,
  'gu'
);

/**
 * Mask the identity a credential is displayed under.
 *
 * A known account email is replaced wherever it starts a token in `name` —
 * verbatim or in the sanitized spelling Meta and xAI filenames use,
 * case-insensitively and after Unicode NFC normalization — leaving the
 * provider prefix and any identity hash readable. Then, for an unknown or
 * mismatched `email`, a Meta-shaped name has its account part masked and any
 * remaining email-shaped substring is masked by pattern, identity hash
 * included; `provider` (the credential's type) keeps its prefix readable in
 * front of it.
 *
 * Known gap: a stale `email` that is a hyphen-separated suffix of the address
 * in the name is still replaced where it starts, because the backend uses the
 * same `-` after its prefix. The mailbox head before it stays readable:
 * `theo@t3.gg` against `claude-ann-theo@t3.gg.json` gives
 * `claude-ann-t•••@t•••.gg.json`.
 *
 * Masked output contains no match of its own, so masking is idempotent.
 * Names without an email pass through unchanged.
 */
export function maskIdentity(
  name: string,
  email?: string | null,
  provider?: string | null
): string {
  if (!name) return name;
  const normalized = name.normalize('NFC');
  let result = normalized;

  const known = typeof email === 'string' ? email.trim() : '';
  if (known.includes('@')) {
    result = replaceSpellings(result, knownEmailSpellings(known));
  }

  result = maskMetaFileShape(result);

  const prefix = readablePrefix(result, provider);
  result = prefix + result.slice(prefix.length).replace(EMAIL_PATTERN, (match) => maskEmail(match));

  return result === normalized ? name : result;
}
