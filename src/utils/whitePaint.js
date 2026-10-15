import { loadPdfJs } from './pdfText';

// ── White Paint waiting list ──────────────────────────────────────────────────
// The paint list PDF is a printed spreadsheet with a real text layer:
//   FIRST | LAST | VIN | PHONE | date | EST PROVIDED | (free-text notes)
// Column x-positions shift between pages, so a row is read by what each piece
// of text looks like (17-char VIN, phone digits, m/d/yy date) rather than by
// where it sits. Names are the words left of the VIN/phone/date. Lines with no
// name (note overflow such as "at the body shop now") are skipped.

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
const YESNO_RE = /^(yes|no|y|n|0)$/i;
const NAME_MAX_X = 210;   // names always sit in the two left-hand columns

export const isPdf = (f) => /pdf/i.test(f?.type || '') || /\.pdf$/i.test(f?.name || '');

export const cleanVin = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();
export const phoneDigits = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
};
// (765) 555-1234 when it's a normal 10-digit number; otherwise as typed.
export function fmtPhone(p) {
  const d = phoneDigits(p);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || '').trim();
}
// "jack" / "JACK" → "Jack"; mixed case ("McCormack") is left alone.
export function tidyName(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-/'])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
// m/d/yy or m/d/yyyy → yyyy-mm-dd ('' if not a date)
export function isoDate(s) {
  const m = String(s || '').trim().match(DATE_RE);
  if (!m) return '';
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : '';
}
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Group a page's text items into lines (top to bottom), each sorted left → right.
function pageLines(items) {
  const pts = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const p of pts) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(cur.y - p.y) <= 4) cur.items.push(p);
    else lines.push({ y: p.y, items: [p] });
  }
  return lines.map(l => l.items.sort((a, b) => a.x - b.x));
}

function parseLine(items) {
  const row = { firstName: '', lastName: '', vin: '', phone: '', dateAdded: '', notes: '' };
  const names = [];
  const notes = [];
  let seenData = false, seenEst = false;
  for (const { x, s } of items) {
    const compact = s.replace(/\s+/g, '');
    if (!row.vin && VIN_RE.test(compact)) { row.vin = compact.toUpperCase(); seenData = true; continue; }
    if (!row.dateAdded && !seenEst && isoDate(compact)) { row.dateAdded = isoDate(compact); seenData = true; continue; }
    if (!row.phone && !seenEst && /^[+\d()\-.\s]+$/.test(s) && s.replace(/\D/g, '').length >= 7) { row.phone = s.replace(/\s+/g, ' ').trim(); seenData = true; continue; }
    if (!seenData && x < NAME_MAX_X && /[a-z]/i.test(s)) { names.push(s); continue; }
    if (seenData && !seenEst && YESNO_RE.test(compact)) { seenEst = true; continue; }
    if (seenData) notes.push(s);
  }
  if (!names.length || !seenData) return null;
  row.firstName = tidyName(names[0]);
  row.lastName = tidyName(names.slice(1).join(' '));
  row.notes = notes.join(' ').replace(/\s+/g, ' ').trim();
  return row;
}

// Every customer row in the PDF, in the PDF's own order.
export async function readPaintPdf(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    for (const line of pageLines(items)) {
      if (line.some(i => /^first$/i.test(i.s)) && line.some(i => /^last$/i.test(i.s))) continue; // header
      const row = parseLine(line);
      if (row) rows.push(row);
    }
  }
  if (!rows.length) throw new Error('No customers found in this PDF. Is it the white paint list (with a text layer, not a scan)?');
  return rows;
}

// Same customer? VIN when both have one; otherwise name + phone.
const nameKey = (r) => `${String(r.firstName || '').toLowerCase().replace(/[^a-z]/g, '')}|${String(r.lastName || '').toLowerCase().replace(/[^a-z]/g, '')}`;
export function sameCustomer(a, b) {
  const va = cleanVin(a.vin), vb = cleanVin(b.vin);
  if (va && vb) return va === vb;
  return nameKey(a) === nameKey(b) && phoneDigits(a.phone) === phoneDigits(b.phone);
}

export const newId = () => `wp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Merge PDF rows into the stored list.
//  • Duplicate VINs inside the PDF: the first row wins, later ones are reported.
//  • Matches an entry already painted → left off (reported).
//  • Matches a waiting entry → name / phone / date / notes refreshed in place;
//    its spot in line is kept.
//  • New → added to the bottom, in PDF order.
//  • Entries not in the PDF are kept as they are.
export function planImport(rows, store, by) {
  const queue = (store.queue || []).map(e => ({ ...e }));
  const done = store.done || [];
  const seen = [];
  const report = { added: [], updated: [], unchanged: 0, dupes: [], painted: [] };
  const at = new Date().toISOString();
  for (const r of rows) {
    const twin = seen.find(s => sameCustomer(s, r));
    if (twin) { report.dupes.push({ row: r, kept: twin }); continue; }
    seen.push(r);
    if (done.some(d => sameCustomer(d, r))) { report.painted.push(r); continue; }
    const i = queue.findIndex(e => sameCustomer(e, r));
    if (i >= 0) {
      const e = queue[i];
      const next = {
        firstName: r.firstName || e.firstName, lastName: r.lastName || e.lastName,
        vin: r.vin || e.vin, phone: r.phone || e.phone,
        dateAdded: r.dateAdded || e.dateAdded, notes: r.notes || e.notes || '',
      };
      const changed = Object.keys(next).some(k => (next[k] || '') !== (e[k] || ''));
      if (changed) { queue[i] = { ...e, ...next, updatedAt: at, updatedBy: by }; report.updated.push(queue[i]); }
      else report.unchanged++;
    } else {
      const rec = { id: newId(), ...r, source: 'pdf', addedAt: at, addedBy: by };
      queue.push(rec);
      report.added.push(rec);
    }
  }
  return { queue, report };
}
