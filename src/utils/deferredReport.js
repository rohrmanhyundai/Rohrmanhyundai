// Deferred Services report (.pdf) — "Bob Rohrman Hyundai Genesis Deferred
// Services". One repair order per line:
//
//   1715 1715779182 | 8/27/26 Alexandrea Povpin | noemail@hmausa.com | 6305288386
//   | 779182 DAVID RILEY | KM8J3CA25JU634567 | 2018 Hyundai | Tucson | 31.4
//   | $22,229.82 | REC, REC
//
// PDF.js hands the text back as positioned fragments; we rebuild each line by
// its y position and then classify the fragments by WHAT they look like (a date
// + name, an email, a 10-digit phone, "RO ADVISOR", a 17-char VIN, "YEAR MAKE",
// hours, $amount, an all-caps op-code list) rather than by x, so a slightly
// different column width on a future export doesn't break it. Model is the one
// fragment with no signature, so it's whatever sits between year/make and hours.

let pdfjsPromise = null;
export function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

const RE_ROWID = /^\d{3,5}\s+\d{8,12}$/;                 // "1715 1715779182"
const RE_DATE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(.*)$/;   // "8/27/26 Name"
const RE_PHONE = /^\d{10}$/;
const RE_RO_ADV = /^(\d{5,8})\s+(.+)$/;                   // "779182 DAVID RILEY"
// 17 chars normally; the report has the odd 16-char typo, so accept 15–17 as
// long as it mixes letters and digits (op codes like TEK05051301 are shorter).
const RE_VIN = /^(?=.*[A-Z])(?=.*\d)[A-HJ-NPR-Z0-9]{15,17}$/i;
const RE_YEAR_MAKE = /^((?:19|20)\d{2})\s+(.+)$/;
const RE_HOURS = /^\d+(\.\d+)?$/;
const RE_MONEY = /^\$?[\d,]+(\.\d{2})?$/;
const RE_CODES = /^[A-Z0-9]+(\s*,\s*[A-Z0-9]+)*$/;

// "8/27/26" → "2026-08-27"
export function isoDate(mdy) {
  const m = String(mdy || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

// Fragments of one text line (x-sorted strings) → row object, or null.
// Different PDF.js builds cut the line differently — one gives "1715 1715779182"
// and "779182 DAVID RILEY" as single fragments, another gives each cell on its
// own — so this walks the cells left to right and classifies as it goes.
const RE_STORE = /^\d{3,5}$/, RE_ROWNUM = /^\d{8,12}$/, RE_DATE_ONLY = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const RE_RO_ONLY = /^\d{5,8}$/, RE_YEAR_ONLY = /^(?:19|20)\d{2}$/;
const looksLike = (s) => ({
  email: s.includes('@'), phone: RE_PHONE.test(s), vin: RE_VIN.test(s), money: RE_MONEY.test(s) && s.includes('$'),
  hours: RE_HOURS.test(s), codes: RE_CODES.test(s) && s.length > 2, ro: RE_RO_ADV.test(s) && !RE_YEAR_MAKE.test(s), roOnly: RE_RO_ONLY.test(s),
});
export function parseLine(frags) {
  const items = frags.map(s => String(s).trim()).filter(Boolean);
  if (!items.length) return null;
  // Row id: "1715 1715779182" or "1715" + "1715779182".
  let i = 0, rowId = '';
  if (RE_ROWID.test(items[0])) { rowId = items[0]; i = 1; }
  else if (RE_STORE.test(items[0]) && items[1] && RE_ROWNUM.test(items[1])) { rowId = `${items[0]} ${items[1]}`; i = 2; }
  else return null;
  const row = { rowId, date: '', customer: '', email: '', phone: '', ro: '', advisor: '', vin: '', year: '', make: '', model: '', hours: null, amount: null, codes: [] };
  const rest = [];
  let m;
  for (; i < items.length; i++) {
    const s = items[i];
    const L = looksLike(s);
    if (!row.date && (m = s.match(RE_DATE))) {
      row.date = isoDate(m[1]);
      if (m[2].trim()) row.customer = m[2].trim();
      else if (items[i + 1] && !looksLike(items[i + 1]).email && !looksLike(items[i + 1]).phone && items[i + 1] !== '0') { row.customer = items[i + 1]; i++; }
      continue;
    }
    if (!row.email && L.email) { row.email = s.replace(/^0\s+/, ''); continue; }
    if (!row.phone && L.phone) { row.phone = s; continue; }
    if (!row.ro && L.ro) { m = s.match(RE_RO_ADV); row.ro = m[1]; row.advisor = m[2].trim().toUpperCase(); continue; }
    if (!row.ro && L.roOnly && row.phone) {
      row.ro = s;
      // Advisor name is the next cell(s) up to the VIN.
      const adv = [];
      while (items[i + 1] && !looksLike(items[i + 1]).vin && !RE_YEAR_ONLY.test(items[i + 1]) && !RE_YEAR_MAKE.test(items[i + 1])) { adv.push(items[i + 1]); i++; }
      row.advisor = adv.join(' ').toUpperCase();
      continue;
    }
    if (!row.vin && L.vin) { row.vin = s.toUpperCase(); continue; }
    if (!row.year && (m = s.match(RE_YEAR_MAKE))) { row.year = m[1]; row.make = m[2].trim(); continue; }
    if (!row.year && RE_YEAR_ONLY.test(s) && row.vin) { row.year = s; if (items[i + 1] && !looksLike(items[i + 1]).hours && !looksLike(items[i + 1]).money) { row.make = items[i + 1]; i++; } continue; }
    if (row.hours == null && L.hours && row.year) { row.hours = parseFloat(s); continue; }
    if (row.amount == null && L.money) { row.amount = parseFloat(s.replace(/[$,]/g, '')); continue; }
    if (L.codes && row.amount != null) { row.codes = s.split(/\s*,\s*/).filter(Boolean); continue; }
    rest.push(s);
  }
  // Whatever wasn't claimed: the model (between year/make and hours), or a
  // stray customer-number "0" the report prints when the name is blank.
  const leftovers = rest.filter(s => s !== '0');
  if (!row.model && leftovers.length) row.model = leftovers.join(' ');
  // "Ioniq Plug-In Hybrid 5.9": a long model name can run into the hours cell.
  if (row.hours == null) {
    m = row.model.match(/^(.*\S)\s+(\d+(?:\.\d+)?)$/);
    if (m) { row.model = m[1]; row.hours = parseFloat(m[2]); }
  }
  if (!row.ro) return null;
  row.customer = row.customer.replace(/\s+/g, ' ').trim();
  row.vehicle = [row.year, row.make, row.model].filter(Boolean).join(' ');
  return row;
}

// Whole PDF → { rows, lastUpdate, warnings }
export async function parseDeferredPdf(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const rows = [];
  const warnings = [];
  let lastUpdate = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      // Fragments within 2pt vertically are the same printed line.
      let key = y;
      for (const k of lines.keys()) if (Math.abs(k - y) <= 2) { key = k; break; }
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push([x, it.str]);
    }
    for (const frags of lines.values()) {
      const ordered = frags.sort((a, b) => a[0] - b[0]).map(f => f[1]);
      const joined = ordered.join(' ');
      const lu = joined.match(/LAST UPDATE\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (lu) lastUpdate = isoDate(lu[1]);
      const row = parseLine(ordered);
      if (row) rows.push(row);
      else if (RE_ROWID.test(ordered[0] || '')) warnings.push(`Page ${p}: could not read a row starting "${ordered[0]}"`);
    }
  }
  if (!rows.length) throw new Error('No deferred-service rows found. Is this the "Deferred Services" PDF?');
  return { rows, lastUpdate, warnings };
}

// Merge a new upload into the stored set, keyed by RO. Later uploads win for
// an RO that appears again (its deferred list may have changed).
export function mergeRows(existing, incoming, uploadedAt) {
  const byRo = { ...(existing || {}) };
  let added = 0, updated = 0;
  for (const r of incoming) {
    if (byRo[r.ro]) updated++; else added++;
    byRo[r.ro] = { ...r, uploadedAt };
  }
  return { byRo, added, updated };
}
