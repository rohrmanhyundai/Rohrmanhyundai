import * as XLSX from 'xlsx';
import { canonicalAdvisorFirst } from './advisorAliases';
import { newestPerVehicle } from './deferredVehicles';
import { loadDeferredRows, loadDeferredCodes, updateAppointmentList } from './github';

// DMS "Appointment List" export → the day's appointments, for the prep sheet.
//
// The export is one sheet with a header row (Time, Customer Comments,
// Appointment Source, Appointment Number, Contact/Customer, Vehicle, Services,
// Transport, Service Advisor, Appointment Created time, Status …). Time carries
// the date too ("Tue Sep 29 2026 7:00 AM"), so one file can hold several days
// and each row is filed under its own date.
//
// Stored per day at data/appointments/YYYY-MM-DD.json:
//   { date, uploadedAt, uploadedBy, appts: [...], claims: { [apptNo]: { advisor, by, at } } }
// "Any Service Advisor" appointments have no owner until an advisor moves one
// onto their calendar — that's a claim, and claims survive a re-upload.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

// Header text → field. Matched loosely (lower-case, punctuation squashed) so a
// column renamed slightly in the DMS still lands.
const COLS = {
  time: ['time', 'appointment time'],
  comments: ['customer comments', 'comments'],
  source: ['appointment source', 'source'],
  apptNo: ['appointment number', 'appointment #', 'appt number', 'appointment no'],
  customer: ['contact/customer', 'customer', 'contact'],
  vehicle: ['vehicle'],
  services: ['services', 'service'],
  transport: ['transport', 'transportation'],
  advisorRaw: ['service advisor', 'advisor'],
  createdAt: ['appointment created time', 'created'],
  status: ['status'],
};
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(norm);
    if (cells.includes('vehicle') && cells.some(c => c === 'contact/customer' || c === 'customer')) return i;
  }
  return -1;
}

// "Tue Sep 29 2026 7:00 AM" → { date: '2026-09-29', time: '7:00 AM' }
export function parseApptTime(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}:\d{2})\s*([AP]M)?/i);
  if (m && MONTHS[m[1].toLowerCase()]) {
    return { date: `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`, time: `${m[4]}${m[5] ? ' ' + m[5].toUpperCase() : ''}` };
  }
  const d = new Date(s);
  if (!isNaN(d)) {
    const h = d.getHours(), mi = d.getMinutes();
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${h % 12 || 12}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}` };
  }
  return null;
}

// "ROLLIN MCCOART" / "thomas hughes" → "Rollin Mccoart" / "Thomas Hughes".
// Mixed-case names are left exactly as typed.
function tidyName(s) {
  const t = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase());
}

// "Any Service Advisor" (or blank) → '' = open pool.
export function dmsAdvisor(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /^any\b/i.test(s) || s === '-') return '';
  return canonicalAdvisorFirst(s);
}

// Parse the export. Returns { byDate: { 'YYYY-MM-DD': [appt, …] }, skipped }.
export async function parseAppointmentFile(file) {
  const buf = await file.arrayBuffer();
  return parseAppointmentBuffer(buf);
}

export function parseAppointmentBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const hi = findHeader(rows);
  if (hi === -1) throw new Error('This doesn\'t look like the DMS Appointment List — no "Contact/Customer" and "Vehicle" header row found.');
  const hdr = rows[hi].map(norm);
  const idx = {};
  for (const [field, names] of Object.entries(COLS)) {
    const i = hdr.findIndex(h => names.includes(h));
    if (i !== -1) idx[field] = i;
  }
  if (idx.time == null || idx.customer == null) throw new Error('The Appointment List is missing its Time or Contact/Customer column.');

  const byDate = {};
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    if (!(r || []).some(c => String(c ?? '').trim())) continue;
    const get = (f) => (idx[f] == null ? '' : String(r[idx[f]] ?? '').trim());
    const when = parseApptTime(get('time'));
    if (!when || /cancel/i.test(get('status'))) { skipped++; continue; }
    const comments = get('comments');
    const services = get('services').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      // Online bookings repeat the customer's comment as a service line.
      .filter(s => !comments || s !== comments);
    const appt = {
      apptNo: get('apptNo') || `${when.date}-${when.time}-${get('customer')}`,
      time: when.time,
      customer: tidyName(get('customer')),
      vehicle: get('vehicle'),
      services,
      comments,
      transport: get('transport').toUpperCase(),
      advisorRaw: get('advisorRaw'),
      advisor: dmsAdvisor(get('advisorRaw')),
      source: get('source'),
      createdAt: get('createdAt'),
    };
    (byDate[when.date] = byDate[when.date] || []).push(appt);
  }
  return { byDate, skipped };
}

// Who an appointment belongs to: its DMS advisor, else whoever claimed it,
// else nobody ('' = still in the open pool).
export function ownerOf(appt, claims) {
  if (appt.advisor) return appt.advisor;
  return (claims && claims[appt.apptNo] && claims[appt.apptNo].advisor) || '';
}

// Prep flags read out of the services / vehicle text.
export function apptTags(a) {
  const text = [...(a.services || []), a.comments || ''].join('\n');
  const tags = [];
  const add = (key, label, color, title) => tags.push({ key, label, color, title });
  const campaigns = text.match(/\(\d{2}-\d{2}-\d{3}[A-Z]?\)/g);
  if (campaigns) add('campaign', `⚠ Campaign ${campaigns.map(c => c.slice(1, -1)).join(', ')}`, '#f87171', 'Recall / campaign — confirm parts are here');
  if (/parts?\s+in\b|\bsop\b/i.test(text)) add('sop', '📦 Parts in SOP', '#fbbf24', 'Special-order parts — make sure they\'re actually on the shelf');
  if (/customer states|check and advise|\bcel\b|light[s]? on|noise|will not|won'?t|not working|leak/i.test(text)) add('diag', '🔍 Diagnosis', '#c4b5fd', 'Customer concern — plan diag time and set expectations');
  if (/warranty/i.test(text)) add('warranty', '🛡 Warranty', '#6ee7f9');
  if (/\$\s?50 oil/i.test(text)) add('lof50', '💵 $50 LOF', '#4ade80', 'Online $50 oil change special');
  if (/\btow/i.test(text)) add('tow', '🚚 Tow-in', '#fb923c');
  if (/pre[\s-]?pa(y|id)/i.test(text)) add('prepay', '💳 Prepaid', '#4ade80');
  if (/\bother\b/i.test(a.vehicle || '') || (a.vehicle && !/hyundai|genesis/i.test(a.vehicle))) add('nonhyundai', '🚙 Non-Hyundai', '#94a3b8');
  if (a.comments) add('comment', '💬 Customer comment', '#93c5fd', a.comments);
  return tags;
}

// ── Deferred work ────────────────────────────────────────────────────────────
// The appointment export has no VIN, so a deferred-service RO is matched to an
// appointment by customer (first + last name) and vehicle (year + model). Only
// each vehicle's newest deferred RO counts — that's the current list.
const nameKey = (s) => {
  const t = String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return t.length ? `${t[0]}|${t[t.length - 1]}` : '';
};
const modelWord = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)[0] || '';

// deferredRows: rows.json byRo values; codes: codes.json ({ CODE: { description } }).
// Returns a Map apptNo → deferred snapshot (stored on the appointment).
export function matchDeferred(appts, deferredRows, codes) {
  const { rows } = newestPerVehicle(deferredRows || []);
  const byName = new Map();
  for (const r of rows) {
    const k = nameKey(r.customer);
    if (k) (byName.get(k) || byName.set(k, []).get(k)).push(r);
  }
  const out = new Map();
  for (const a of appts || []) {
    const cands = byName.get(nameKey(a.customer)) || [];
    const veh = String(a.vehicle || '').toLowerCase();
    const yr = (veh.match(/\b(19|20)\d{2}\b/) || [''])[0];
    const hit = cands
      .filter(r => (!r.year || !yr || String(r.year) === yr) && (!modelWord(r.model) || veh.includes(modelWord(r.model))))
      .sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')))[0];
    if (!hit) continue;
    // Collapse repeated op codes ("REC, REC") into one line with a count.
    const items = [];
    for (const c of hit.codes || []) {
      const ex = items.find(i => i.code === c);
      if (ex) ex.count++;
      else items.push({ code: c, desc: (codes && codes[c] && codes[c].description) || '', count: 1 });
    }
    out.set(a.apptNo, {
      ro: hit.ro, date: hit.date || '', advisorFull: hit.advisor || '', advisor: canonicalAdvisorFirst(hit.advisor),
      amount: hit.amount ?? null, hours: hit.hours ?? null, phone: hit.phone || '', vin: hit.vin || '', items,
    });
  }
  return out;
}

// ── Upload ───────────────────────────────────────────────────────────────────
// Parse the export, match deferred work, and save each day it covers. Used by
// the prep sheet and by Manager Hub → Upload Reports.
// Each day in the file replaces that day's list. Claims on appointments still
// listed are kept, so re-uploading later in the day is safe. An "Any Service
// Advisor" appointment with deferred work goes to the advisor who wrote that
// deferred RO — if they're still on the roster — but never overrides a claim
// and never re-assigns one sent back to the pool.
export async function uploadAppointmentFile(file, { advisorList = [], by = '' } = {}) {
  const { byDate } = await parseAppointmentFile(file);
  const dates = Object.keys(byDate).sort();
  if (dates.length === 0) throw new Error('No appointments found in that file.');
  // A failed deferred read just means no matches this time — the list still uploads.
  const [defRows, defCodes] = await Promise.all([
    loadDeferredRows().catch(() => null), loadDeferredCodes().catch(() => null),
  ]);
  const deferredRows = Object.values((defRows && defRows.byRo) || {});
  const roster = new Set((advisorList || []).map(n => String(n || '').trim().split(/\s+/)[0].toUpperCase()));
  const saved = {};
  let autoCount = 0, defCount = 0;
  for (const d of dates) {
    const matches = matchDeferred(byDate[d], deferredRows, defCodes || {});
    const appts = byDate[d].map(a => (matches.has(a.apptNo) ? { ...a, deferred: matches.get(a.apptNo) } : a));
    defCount += matches.size;
    let auto = 0;
    saved[d] = await updateAppointmentList(d, (cur) => {
      auto = 0; // the mutate can retry on a conflict — count the attempt that lands
      const keep = new Set(appts.map(a => a.apptNo));
      const claims = Object.fromEntries(Object.entries(cur.claims).filter(([k]) => keep.has(k)));
      for (const a of appts) {
        const who = a.deferred && a.deferred.advisor;
        if (a.advisor || claims[a.apptNo] || !who || !roster.has(who)) continue;
        claims[a.apptNo] = { advisor: who, by: 'AUTO', reason: 'deferred', at: new Date().toISOString() };
        auto++;
      }
      return { ...cur, date: d, appts, claims, uploadedAt: new Date().toISOString(), uploadedBy: by };
    }, `Appointment list ${d}: ${appts.length} appts (${by})`);
    autoCount += auto;
  }
  return { dates, byDate, saved, defCount, autoCount };
}

export const shortMD = (iso) => { const [, m, d] = String(iso).split('-'); return `${+m}/${+d}`; };
