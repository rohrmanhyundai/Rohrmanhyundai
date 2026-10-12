// VMPI (video multi-point inspection) — the group's "SERVICE TECHNICIAN VIDEO
// REPORT" .csv. It covers every store in the group; each store's techs get a
// total row where the TECHNICIAN column has the tech's name, "ID TECH" is the
// dealer id + name (e.g. "1715GAVEN LAUGHNER"), and "Video Utilization Per Ro"
// holds their % (ROs with a video attached ÷ RO count). We keep only our
// store's techs (DEALER NAME containing ROHRMAN HYUNDAI → dealer id 1715).

export const OUR_STORE = /ROHRMAN\s+HYUNDAI/i;

// Minimal RFC-4180 CSV reader (quoted fields, doubled quotes, CRLF).
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
const pctOf = (s) => { const n = parseFloat(String(s || '').replace(/[%,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 10000 : null; };
const numOf = (s) => { const n = parseFloat(String(s || '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// → { stamp, store, dealerId, rows: [{ name, first, ros, withVideo, videos, pct }] }
export function parseVmpiReport(text) {
  const all = parseCsv(text);
  const hi = all.findIndex(r => r.some(c => norm(c) === 'VIDEO UTILIZATION PER RO'));
  if (hi < 0) throw new Error('This doesn\'t look like the Service Technician Video Report — no "Video Utilization Per Ro" column.');
  const h = all[hi].map(norm);
  const col = (name) => h.indexOf(name);
  const C = {
    util: col('VIDEO UTILIZATION PER RO'), attached: col("RO'S W/VIDEOS ATTACHED"), videos: col('QTY OF VIDEOS CAPTUREED'),
    roCnt: col('RO CNT'), tech: col('TECHNICIAN'), idTech: col('ID TECH'), dealerId: col('DEALER ID'), dealerName: col('DEALER NAME'),
  };
  if (C.tech < 0 || C.idTech < 0) throw new Error('Couldn\'t find the TECHNICIAN / ID TECH columns in this report.');
  const g = (r, i) => (i >= 0 && i < r.length ? r[i] : '');
  // The generated time sits in the title rows above the header.
  let stamp = '';
  for (const r of all.slice(0, hi)) for (const c of r) if (!stamp && /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d\d/.test(c.trim())) stamp = c.trim();

  // Our store's dealer id, from any detail line with the dealer name on it.
  let dealerId = '', store = '';
  for (const r of all.slice(hi + 1)) {
    const name = g(r, C.dealerName);
    if (OUR_STORE.test(name) && !/NO TECH ASSIGNED/i.test(name)) { dealerId = String(g(r, C.dealerId)).trim(); store = name.trim(); break; }
  }
  if (!dealerId) throw new Error('Bob Rohrman Hyundai isn\'t on this report.');

  const rows = [];
  for (const r of all.slice(hi + 1)) {
    const util = g(r, C.util);
    const tech = String(g(r, C.tech)).trim();
    const idTech = String(g(r, C.idTech)).trim();
    if (!String(util).trim() || !tech || /NO TECH ASSIGNED/i.test(tech)) continue;
    if (!idTech.startsWith(dealerId)) continue;
    const pct = pctOf(util);
    if (pct == null) continue;
    rows.push({
      name: tech, first: tech.split(/\s+/)[0].toUpperCase(),
      ros: numOf(g(r, C.roCnt)), withVideo: numOf(g(r, C.attached)), videos: numOf(g(r, C.videos)), pct,
    });
  }
  if (!rows.length) throw new Error(`No technician totals found for ${store || 'our store'}.`);
  return { stamp, store, dealerId, rows };
}
