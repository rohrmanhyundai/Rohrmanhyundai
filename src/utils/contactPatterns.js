/* Finding a phone number and an email in a line of text.
 *
 * The resume reader worked these out first; the warranty contacts importer needs
 * exactly the same job done, so they live here rather than being copied and
 * drifting apart.
 */

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// US numbers as people actually write them: (765) 555-0142, 765-555-0142,
// 765.555.0142, 7655550142, +1 765 555 0142.
//
// The separator allows up to three characters because a PDF often stores one
// number as several text pieces — "…IN | 773", "220", "1749 | email" — which
// rejoin as "773 - 220 - 1749". Matching a single separator missed those.
export const PHONE_RE = /(?:\+?1[\s.\-–]{0,3})?(?:\(\s*\d{3}\s*\)|\d{3})[\s.\-–]{0,3}\d{3}[\s.\-–]{0,3}\d{4}/;

// An 800-number written as 1-800-GOT-JUNK is a phone too, but it isn't digits,
// so it is left alone rather than mangled.
export function tidyPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return String(raw).trim();
  return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/* The first phone number in a string that isn't part of a longer run of digits —
 * an account number or a zip+fax block shouldn't become someone's phone.
 *
 * The raw match and its position come back too. A caller stripping the number
 * out of a line has to remove exactly the characters that matched: rebuilding a
 * pattern from the tidied digits left "(" behind from "(877)" and "1-" from
 * "1-800-", and those ended up glued to the company name. */
export function findPhoneMatch(text) {
  const s = String(text || '');
  for (const m of s.matchAll(new RegExp(PHONE_RE, 'gi'))) {
    const before = s[m.index - 1] || '';
    const after = s[m.index + m[0].length] || '';
    if (/\d/.test(before) || /\d/.test(after)) continue;
    return { phone: tidyPhone(m[0]), raw: m[0], index: m.index };
  }
  return null;
}

export function findPhone(text) {
  const m = findPhoneMatch(text);
  return m ? m.phone : '';
}

export function findEmail(text) {
  return (String(text || '').match(EMAIL_RE) || [''])[0].trim();
}
