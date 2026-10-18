// ── Loaner fleet PDF (Service Loaner → Loaner Inventory → 📄 Upload fleet PDF) ─
// The manufacturer's "Fleet" report: one row per loaner — Unit Number, VIN,
// Year, Make, Model, Trim, Location, Fuel Level, Odometer + Status, Idle Days +
// Service Start Date. The page is printed rotated, so pdf.js hands back text
// whose column runs along one axis and rows along the other; we find the
// header labels, then slot each piece of text under the nearest header and
// into the row whose VIN starts at or before it. Cells wrap onto extra lines
// (Model "PALISADE / CALLIGRAP / HY AWD"), which is why the importer prefers
// the VIN decoder's model and only falls back to this text.

import { loadPdfJs } from './pdfText';

const HEADERS = [
  ['unit', /^unit number$/i], ['vin', /^vin$/i], ['year', /^year$/i], ['make', /^make$/i], ['model', /^model$/i],
  ['trim', /^trim$/i], ['location', /^location$/i], ['fuel', /^fuel level$/i], ['odometer', /^odometer$/i],
  ['status', /^status$/i], ['idle', /^idle days/i],
];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

// items: [{ str, t: [a, b, c, d, e, f] }] for one page → loaner rows.
export function parseFleetPage(items) {
  const vinHead = items.find(i => /^vin$/i.test(i.str.trim()));
  if (!vinHead) return [];
  // Rotated text (b ≠ 0): columns run along f, rows along e. Upright: columns
  // along e, rows down the page (−f).
  const rotated = Math.abs(vinHead.t[1]) > Math.abs(vinHead.t[0]);
  const col = (i) => (rotated ? i.t[5] : i.t[4]);
  const row = (i) => (rotated ? i.t[4] : -i.t[5]);
  const headRow = row(vinHead);
  const cols = [];
  for (const it of items) {
    if (Math.abs(row(it) - headRow) > 2) continue;
    const h = HEADERS.find(([, re]) => re.test(it.str.trim()));
    if (h) cols.push({ key: h[0], at: col(it) });
  }
  cols.sort((a, b) => a.at - b.at);
  const colOf = (it) => {
    let k = null;
    for (const c of cols) if (col(it) >= c.at - 3) k = c.key;
    return k;
  };
  const body = items.filter(it => it.str.trim() && row(it) > headRow + 14);
  const starts = body.filter(it => colOf(it) === 'vin' && VIN_RE.test(it.str.trim().toUpperCase()))
    .map(it => ({ at: row(it), vin: it.str.trim().toUpperCase(), cells: {} }))
    .sort((a, b) => a.at - b.at);
  for (const it of body) {
    const r = row(it);
    let hit = null;
    for (const s of starts) if (s.at <= r + 1) hit = s;
    if (!hit || r - hit.at > 36) continue;      // a row is 1–4 lines; anything further is footer text
    const k = colOf(it);
    if (!k) continue;
    (hit.cells[k] ||= []).push({ r, s: it.str.trim() });
  }
  const text = (cells, k) => (cells[k] || []).sort((a, b) => a.r - b.r).map(x => x.s).join(' ').replace(/\s+/g, ' ').trim();
  return starts.map(({ vin, cells }) => {
    const odo = text(cells, 'odometer') + ' ' + text(cells, 'status');
    const idle = text(cells, 'idle');
    const d = idle.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return {
      vin,
      unitNo: text(cells, 'unit'),
      year: (text(cells, 'year').match(/\d{4}/) || [''])[0],
      make: text(cells, 'make').toUpperCase(),
      model: text(cells, 'model').toUpperCase(),
      mileage: (odo.match(/\d[\d,]*/) || [''])[0].replace(/,/g, ''),
      serviceStart: d ? `${d[3]}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}` : '',
    };
  });
}

// A File / ArrayBuffer of the fleet PDF → [{ vin, unitNo, year, make, model, mileage, serviceStart }].
export async function readFleetPdf(fileOrBuf) {
  const buf = fileOrBuf instanceof ArrayBuffer ? fileOrBuf : await fileOrBuf.arrayBuffer();
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    out.push(...parseFleetPage(content.items.map(i => ({ str: i.str, t: i.transform }))));
  }
  const seen = new Set();
  return out.filter(v => !seen.has(v.vin) && seen.add(v.vin));
}

// "2026-05-01" → "05/01/2026"
export const fmtServiceStart = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
};
