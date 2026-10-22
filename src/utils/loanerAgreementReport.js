// ── Open-agreement report (Service Loaner → Contracts → 📚 Bulk Upload) ───────
// The rental system's "Agreement" report of every OPEN loaner agreement, as the
// PDF (printed rotated, like the Fleet report) or its AgreementExport.csv. One
// row per agreement: Agreement (RA #), Status, Customer, RO, Service Advisor,
// Unit, Make, Model, Odometer, Date out, Date in (due back), Days. The CSV also
// has the VIN, plate and phone; the PDF only the unit # — the VIN's last 8 —
// which is matched to the loaner fleet / contracts on file to find the VIN.
//
// The report is the system of record, so planReport UPDATES a contract on file
// wherever the report differs (not just blanks), and ADDS agreements the site
// doesn't have yet (no scanned contract — that can be attached later).

import { loadPdfJs } from './pdfText';
import { phonePlaceholder } from './serviceLoaner';

const up = (s) => String(s || '').trim().toUpperCase();
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// "10/01/2026 9:48 AM" → { date: '2026-10-01', time: '09:48' }
export function splitDateTime(s) {
  const m = clean(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M)?)?/i);
  if (!m) return { date: '', time: '' };
  const date = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (!m[4]) return { date, time: '' };
  let h = Number(m[4]);
  if (m[6]) { const pm = /p/i.test(m[6]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return { date, time: `${String(h).padStart(2, '0')}:${m[5]}` };
}
function splitName(full) {
  const parts = clean(full).replace(/[`'"]+$/, '').split(' ').filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}
function finish(r) {
  const out = splitDateTime(r.dateOut), due = splitDateTime(r.dateDue);
  return {
    raNo: up(r.raNo), status: clean(r.status), ...splitName(r.customer),
    ro: clean(r.ro).replace(/[^0-9A-Za-z-]/g, ''), roStatus: clean(r.roStatus), advisor: up(r.advisor),
    unitNo: up(r.unitNo), vin: up(r.vin).replace(/[^A-Z0-9]/g, ''), plate: up(r.plate),
    make: up(r.make), model: up(r.model), mileageOut: String(r.mileageOut || '').replace(/[^\d]/g, ''),
    dateOut: out.date, timeOut: out.time, dueDate: due.date, dueTime: due.time,
    phone: clean(r.phone), fuelOut: up(r.fuelOut),
  };
}

// ── CSV ──
function csvRows(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
export function parseAgreementCsv(text) {
  const rows = csvRows(String(text || '').replace(/^﻿/, ''));
  if (!rows.length) return null;
  const h = rows[0].map(x => x.trim().toLowerCase());
  const col = (name) => h.indexOf(name);
  if (col('agreement number') < 0) return null;
  // Excel-safe cells come as ="TU393247".
  const val = (r, name) => { const i = col(name); return i < 0 ? '' : String(r[i] || '').replace(/^="?|"$/g, '').trim(); };
  return rows.slice(1).filter(r => val(r, 'agreement number')).map(r => finish({
    raNo: val(r, 'agreement number'), status: val(r, 'status'), customer: val(r, 'customer'), ro: val(r, 'ro number'),
    roStatus: val(r, 'ro status'), advisor: val(r, 'service advisor'), unitNo: val(r, 'unit number'), vin: val(r, 'vin'),
    plate: val(r, 'license plate'), make: val(r, 'make'), model: val(r, 'model'), mileageOut: val(r, 'odometer out'),
    dateOut: val(r, 'date out'), dateDue: val(r, 'expected return date'), phone: val(r, 'mobile phone'), fuelOut: val(r, 'fuel out'),
  }));
}

// ── PDF ── items: [{ str, t }] for one page.
const HEADS = [
  ['raNo', /^agreement$/i], ['location', /^location$/i], ['status', /^status$/i], ['customer', /^customer$/i], ['ro', /^ro$/i],
  ['roStatus', /^ro status/i], ['unitNo', /^unit$/i], ['make', /^make$/i], ['model', /^model$/i], ['mileageOut', /^odometer$/i],
  ['dateOut', /^date out$/i], ['dateDue', /^date in$/i], ['days', /^days$/i],
];
export function parseAgreementPage(items) {
  const ag = items.find(i => /^agreement$/i.test(i.str.trim()) && Math.abs(i.t[0]) + Math.abs(i.t[1]) <= 9);
  if (!ag) return [];
  const rotated = Math.abs(ag.t[1]) > Math.abs(ag.t[0]);
  const col = (i) => (rotated ? i.t[5] : i.t[4]);
  const row = (i) => (rotated ? i.t[4] : -i.t[5]);
  const headRow = row(ag);
  const cols = [];
  for (const it of items) {
    if (Math.abs(row(it) - headRow) > 2) continue;
    const h = HEADS.find(([, re]) => re.test(it.str.trim()));
    if (!h) continue;
    cols.push({ key: h[0], at: col(it) });
    // "RO Status Service Advisor" is one header over two columns.
    if (h[0] === 'roStatus' && /advisor/i.test(it.str)) cols.push({ key: 'advisor', at: col(it) + 40 });
  }
  cols.sort((a, b) => a.at - b.at);
  const colOf = (it) => { let k = null; for (const c of cols) if (col(it) >= c.at - 3) k = c.key; return k; };
  const body = items.filter(it => it.str.trim() && row(it) > headRow + 8);
  const starts = body.filter(it => colOf(it) === 'raNo' && /^[A-Z]?\d{3,}$/i.test(it.str.trim()))
    .map(it => ({ at: row(it), cells: {} })).sort((a, b) => a.at - b.at);
  for (const it of body) {
    const r = row(it);
    let hit = null;
    for (const s of starts) if (s.at <= r + 1) hit = s;
    if (!hit || r - hit.at > 48) continue;
    const k = colOf(it);
    if (k) (hit.cells[k] ||= []).push({ r, s: it.str.trim() });
  }
  const text = (c, k) => (c[k] || []).sort((a, b) => a.r - b.r).map(x => x.s).join(' ');
  return starts.map(({ cells }) => finish(Object.fromEntries(HEADS.map(([k]) => [k, text(cells, k)]).concat([['advisor', text(cells, 'advisor')]]))));
}

// File (PDF or CSV) → agreement rows, or null when it isn't the report (e.g. a
// scanned PDF with no text — the caller then reads it as scanned contracts).
export async function readAgreementReport(file) {
  if (/\.csv$/i.test(file.name || '') || /csv/i.test(file.type || '')) return parseAgreementCsv(await file.text());
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const out = [];
    let found = false;
    for (let p = 1; p <= doc.numPages; p++) {
      const items = (await (await doc.getPage(p)).getTextContent()).items.map(i => ({ str: i.str, t: i.transform }));
      if (items.some(i => /^agreement$/i.test(i.str.trim()))) found = true;
      out.push(...parseAgreementPage(items));
    }
    return found ? out : null;
  } finally { try { doc.destroy(); } catch {} }
}

// The fields the report keeps right on a contract (label for the preview).
export const REPORT_FIELDS = [
  ['raNo', 'RA #'], ['firstName', 'First name'], ['lastName', 'Last name'], ['ro', 'RO #'], ['advisor', 'Advisor'],
  ['vin', 'VIN'], ['unitNo', 'Unit #'], ['plate', 'Plate'], ['year', 'Year'], ['make', 'Make'], ['model', 'Model'],
  ['mileageOut', 'Miles out'], ['dateOut', 'Date out'], ['timeOut', 'Time out'], ['dueDate', 'Due back'], ['dueTime', 'Due time'],
  ['phone', 'Phone'],
];
const same = (a, b) => up(a) === up(b);

// rows + contracts on file + loaner fleet → [{ r (row, VIN/year filled in), action: 'new'|'update'|'same',
//   target, changes: [{ k, label, from, to }] }] and `missing` (open on the site, not in the report).
export function planReport(rows, contracts, fleet = []) {
  const plan = [];
  const used = new Set();
  for (const raw of rows) {
    const r = { ...raw };
    // VIN: the report's own, else the fleet's loaner with that unit #, else a contract on file.
    const unit = up(r.unitNo);
    const veh = fleet.find(v => (r.vin && v.vin === r.vin) || (unit && (up(v.unitNo) === unit || String(v.vin || '').endsWith(unit))));
    if (!r.vin && veh) r.vin = veh.vin;
    if (!r.vin && unit) { const c = contracts.find(x => String(x.vin || '').endsWith(unit)); if (c) r.vin = c.vin; }
    if (veh && veh.year) r.year = veh.year;
    const target = contracts.find(c => !used.has(c.id) && r.raNo && same(c.raNo, r.raNo))
      || contracts.find(c => !used.has(c.id) && !c.raNo && c.dateOut && c.dateOut === r.dateOut
        && ((c.vin && r.vin && c.vin === r.vin) || (same(c.lastName, r.lastName) && c.lastName)))
      || phonePlaceholder(contracts.filter(c => !used.has(c.id)), r);
    if (!target) { plan.push({ r, action: 'new', changes: [] }); continue; }
    used.add(target.id);
    const changes = REPORT_FIELDS.filter(([k]) => r[k] && !same(target[k], r[k]))
      .map(([k, label]) => ({ k, label, from: target[k] || '', to: r[k] }));
    plan.push({ r, target, action: changes.length ? 'update' : 'same', changes });
  }
  const missing = contracts.filter(c => !used.has(c.id) && !c.completedUrl);
  return { plan, missing };
}
