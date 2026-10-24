/**
 * Identity masking for screen sharing.
 *
 * Credential filenames usually embed the account email (`claude-theo@t3.gg.json`),
 * so the quota page masks them by default. Masking keeps just enough shape to
 * tell credentials apart at a glance — the first character of the mailbox and
 * of the domain, plus the full suffix — without putting the address on screen.
 *
 * Pure string helpers: search and every request keep using the raw values.
 */

const MASK = '•••';

/**
 * Email-shaped substring. The local part deliberately excludes `-` so a
 * provider prefix such as `claude-` survives in front of the masked mailbox,
 * and the domain swallows any trailing dotted suffix (`.json`), which the mask
 * keeps verbatim anyway.
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const firstChar = (value: string): string => Array.from(value)[0] ?? '';

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

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  const firstLabel = dot < 0 ? domain : domain.slice(0, dot);
  const suffix = dot < 0 ? '' : domain.slice(dot);

  const maskedLocal = local ? `${firstChar(local)}${MASK}` : '';
  const maskedDomain = `${firstLabel ? `${firstChar(firstLabel)}${MASK}` : ''}${suffix}`;
  return `${maskedLocal}@${maskedDomain}`;
}

/** Replace every case-insensitive occurrence of `needle` in `haystack`. */
const replaceAllInsensitive = (haystack: string, needle: string, replacement: string): string => {
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let result = '';
  let cursor = 0;
  let index = lowerHaystack.indexOf(lowerNeedle);
  while (index >= 0) {
    result += haystack.slice(cursor, index) + replacement;
    cursor = index + needle.length;
    index = lowerHaystack.indexOf(lowerNeedle, cursor);
  }
  return result + haystack.slice(cursor);
};

/**
 * Mask the identity a credential is displayed under.
 *
 * A known account email is replaced wherever it occurs in `name` (case
 * insensitive — filenames are often lower-cased). Any remaining email-shaped
 * substring is then masked by pattern, so an unknown or mismatched `email`
 * still never leaks an address. The masked form contains no pattern match of
 * its own, so masking is idempotent. Names without an email pass through.
 */
export function maskIdentity(name: string, email?: string | null): string {
  if (!name) return name;
  let result = name;
  const known = typeof email === 'string' ? email.trim() : '';
  if (known.includes('@')) {
    result = replaceAllInsensitive(result, known, maskEmail(known));
  }
  return result.replace(EMAIL_PATTERN, (match) => maskEmail(match));
}
