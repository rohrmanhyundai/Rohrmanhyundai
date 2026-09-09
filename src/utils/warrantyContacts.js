import { findPhoneMatch, findPhone, findEmail } from './contactPatterns';

/* Turn the lines of an uploaded contacts document into warranty companies.
 *
 * The document is written for people, not for a parser, so this reads the way a
 * person would: a line carrying a phone number or an email is a company's line,
 * and whatever text is left on it once those are lifted out is the name. A name
 * on its own line immediately above such a line is used when the line itself has
 * no name left — a common shape for a table with the company on one row.
 */

// Words a line consists of when it is a heading rather than a company.
const HEADINGS = /^(company|companies|name|phone|telephone|tel|email|e-?mail|contact|contacts|warranty|aftermarket|claims?|fax|notes?|address)\b[\s:|-]*$/i;

const clean = (s) => String(s || '')
  .replace(/^[\s|,;:•\-–—()]+/, '')
  .replace(/[\s|,;:•\-–—()]+$/, '')
  .replace(/\s+/g, ' ')
  .trim();

// Labels sitting next to the value, e.g. "Phone: 800-555-1212".
const stripLabels = (s) => clean(String(s || '')
  .replace(/\b(phone|telephone|tel|ph|fax|email|e-?mail|contact|claims?)\b\s*[:#-]?\s*/gi, ' '));

function looksLikeName(text) {
  const t = clean(text);
  if (t.length < 2 || t.length > 60) return false;
  if (HEADINGS.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;         // digits alone are never a name
  return true;
}

/* Lines in, contacts out. Every field is editable afterwards — a wrong guess
 * costs a correction, not a lost contact. */
export function parseContactLines(lines) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(lines) ? lines : [];

  for (let i = 0; i < list.length; i++) {
    const line = list[i];
    const hit = findPhoneMatch(line);
    const phone = hit ? hit.phone : '';
    const email = findEmail(line);
    if (!phone && !email) continue;              // nothing to hang a contact on

    // What's left once the phone and email are lifted out is the name. The phone
    // is cut out by position so every character that matched goes, brackets and
    // a leading country code included.
    // The phone is cut first, by position, while the index still refers to this
    // exact string — removing the email first would shift it whenever the email
    // comes earlier in the line.
    let rest = line;
    if (hit) rest = rest.slice(0, hit.index) + ' ' + rest.slice(hit.index + hit.raw.length);
    if (email) rest = rest.split(email).join(' ');
    let name = clean(stripLabels(rest.split('\t').filter(p => looksLikeName(p))[0] || rest));

    // Nothing usable on the line — try the line above, which is often the
    // company name on its own row.
    if (!looksLikeName(name)) {
      const above = clean(stripLabels(list[i - 1] || ''));
      name = looksLikeName(above) && !findPhone(above) && !findEmail(above) ? above : '';
    }
    if (!name) continue;                         // a phone with no company is no use

    const key = name.toUpperCase();
    const existing = seen.has(key) ? out.find(c => c.name.toUpperCase() === key) : null;
    if (existing) {
      // A company listed twice — keep the fuller entry rather than the last one.
      if (!existing.phone && phone) existing.phone = phone;
      if (!existing.email && email) existing.email = email;
      continue;
    }
    seen.add(key);
    out.push({ name, phone, email });
  }
  return out;
}

// Merge imported contacts into the saved directory. Imported details win where
// they exist, and a company already saved keeps anything the document leaves
// blank, so an import can't blank out a phone someone typed by hand.
export function mergeContacts(directory, contacts) {
  const dir = { ...(directory || {}) };
  let added = 0;
  let updated = 0;
  for (const c of contacts || []) {
    const key = (c.name || '').trim().toUpperCase();
    if (!key) continue;
    const prev = dir[key];
    const next = {
      name: c.name.trim(),
      phone: c.phone || (prev && prev.phone) || '',
      email: c.email || (prev && prev.email) || '',
    };
    if (!prev) added++;
    else if (prev.name !== next.name || prev.phone !== next.phone || prev.email !== next.email) updated++;
    dir[key] = next;
  }
  return { directory: dir, added, updated };
}
