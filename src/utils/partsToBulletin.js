// ── Parts to Bulletin ────────────────────────────────────────────────────────
// Type a part number, find every TSB and recall whose Warranty Information table
// lists it as the CAUSAL PART. Read straight from the stored `searchText` with
// the same table parser the Op Code Generator uses, so nothing is re-downloaded
// and nothing new has to be indexed — a bulletin uploaded today is searchable now.
//
// Matching ignores dashes, spaces and case ("96641 k2100" = "96641-K2100"), and
// works off the 5-character part BASE as well as the full number: Hyundai part
// numbers are BASE-SUFFIX, and the base names the part (96641 = horn), so
// "96641-K2100" also lists the other horn bulletins as the same part family, and
// typing just "96641" lists them all.

import { norm, normSpaced, subjectFor } from './pdfText';
import { extractWarrantyDraft } from '../components/OpCodeTool';

export const BASE_LEN = 5;

const BULLETIN_RE = /\b\d{2}\s*-\s*[A-Z0-9]{2,3}\s*-\s*\d{2,3}\s*[A-Z]?(?:\s*-\s*\d)?\b/i;

// The bulletin number as printed ("26-BE-021H"). From the title first, which
// is clean; the PDF text spaces it out ("2 6 - BE - 021 H").
export function bulletinNumber(item) {
  const m = BULLETIN_RE.exec(item.label || '') || BULLETIN_RE.exec(item.searchText || '');
  return m ? m[0].replace(/\s+/g, '').toUpperCase() : '';
}

// Parsed warranty rows per bulletin, cached by filename (ids repeat across the
// two libraries). Manager-entered op codes are verified against the bulletin,
// so they win over the auto-read table when present.
const rowCache = new Map();
function warrantyFor(item) {
  const key = (item.filename || item.id) + '|' + (item.searchText || '').length + '|' + JSON.stringify(item.opData?.entries || []).length;
  if (rowCache.has(key)) return rowCache.get(key);
  const draft = extractWarrantyDraft(item.searchText || '');
  const manual = (item.opData?.entries || []).filter(e => e.causalPart || e.opCode);
  const rows = (manual.length ? manual : draft.entries).map(e => ({
    model: e.model || '', opCode: e.opCode || '', operation: e.operation || '',
    opTime: e.opTime || '', causalPart: e.causalPart || '', p: norm(e.causalPart),
  }));
  // The table's own text, squeezed: catches a causal part the parser couldn't
  // split into a row ("546 30 - 3Q010" on a second model with no op code).
  const out = { rows, table: norm(draft.rawText) };
  rowCache.set(key, out);
  return out;
}

// 'exact' — the part typed (or, for a bare 5-character base, its whole family)
//           is this row's causal part. A colour/trim suffix on either side
//           still counts ("96641-K2100QQH" vs "96641-K2100").
// 'family' — same 5-character base, different suffix.
function rowMatch(p, q) {
  if (!p || p.length < BASE_LEN) return '';
  if (q.length === BASE_LEN) return p.startsWith(q) ? 'exact' : '';
  if (p === q || p.startsWith(q) || (q.startsWith(p) && p.length >= 2 * BASE_LEN)) return 'exact';
  return p.slice(0, BASE_LEN) === q.slice(0, BASE_LEN) ? 'family' : '';
}

// items: both libraries, each tagged _kind ('hot-repairs' | 'recalls').
// Returns { query, exact, family, mentioned } — each a list of
// { item, kind, number, subject, rows } (rows = the matching table rows; empty
// when the part was found in the table text but not in a parsed row).
export function findBulletinsForPart(items, input) {
  const q = norm(input);
  const out = { query: q, exact: [], family: [], mentioned: [] };
  if (q.length < BASE_LEN) return out;
  const base = q.slice(0, BASE_LEN);
  const seen = new Set();

  for (const item of items || []) {
    const key = (item._kind || '') + ':' + (item.filename || item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const { rows, table } = warrantyFor(item);
    const hit = { exact: [], family: [] };
    for (const r of rows) {
      const m = rowMatch(r.p, q);
      if (m) hit[m].push(r);
    }
    const info = () => ({ item, kind: item._kind, number: bulletinNumber(item), subject: subjectFor(item) || item.label || '' });
    if (hit.exact.length) { out.exact.push({ ...info(), rows: dedupe(hit.exact) }); continue; }
    // In the warranty table but on no parsed row — still the causal part.
    if (q.length > BASE_LEN && table.includes(q)) { out.exact.push({ ...info(), rows: [] }); continue; }
    if (hit.family.length) { out.family.push({ ...info(), rows: dedupe(hit.family) }); continue; }
    // Anywhere else in the bulletin: the Parts Information table (often the NEW
    // replacement part), a related-parts note… A bare base must stand as its own
    // word so "96641" can't hit inside some longer number.
    const text = item.searchText || '';
    const inBody = q.length === BASE_LEN ? normSpaced(text).includes(' ' + base + ' ') : norm(text).includes(q);
    if (inBody) out.mentioned.push({ ...info(), rows: [] });
  }
  return out;
}

// One row per op code + causal part: the carried-forward table rows repeat.
function dedupe(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const k = r.model + '|' + r.opCode + '|' + r.p;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}
