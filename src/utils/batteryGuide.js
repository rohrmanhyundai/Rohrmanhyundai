// ── Hyundai Battery Guide ─────────────────────────────────────────────────────
// Reads the "Hyundai Factory Installed and Replacement Battery Information" PDF
// (Hyundai Battery Guide) into rows, and finds the battery for a year + model.
// The PDF has a real text layer: one table row per line, columns at fixed x:
//   MODEL | MODEL CODE | MODEL YEAR | ENGINE | FACTORY TYPE | CCA | RC | REPLACEMENT P/N | CCA | RC
// Quirks handled: model names that wrap onto a line above + below the row
// ("SANTA FE PLUGIN" / "HYBRID"), open years ("2021-"), short years ("2015-17"),
// and the "Integrated 12V Lithium Battery. Order through WebDCS." rows that have
// a note instead of a battery (printed a point off the row's own line).
// Data lives in public/data/battery-guide.json → { updatedAt, by, fileName, rows }.

const YEAR_RE = /^(\d{4})(?:\s*-\s*(\d{2}|\d{4})?)?$/;

// Column by x (PDF points). Bounds sit between the guide's column starts.
function column(x) {
  if (x < 120) return 'model';
  if (x < 180) return 'code';
  if (x < 245) return 'year';
  if (x < 330) return 'engine';
  if (x < 375) return 'type';
  if (x < 410) return 'cca';
  if (x < 440) return 'rc';
  if (x < 505) return 'pn';
  if (x < 545) return 'replCca';
  return 'replRc';
}

export function parseYears(text) {
  const m = String(text || '').trim().match(YEAR_RE);
  if (!m) return null;
  const from = Number(m[1]);
  let to;
  if (m[2] === undefined) to = /-\s*$/.test(text) ? null : from;   // "2021-" open, "2025" single
  else to = m[2].length === 2 ? Number(String(from).slice(0, 2) + m[2]) : Number(m[2]);
  return { from, to };
}

// pages: [[{ x, y, s }]] — every text item with its PDF position. → rows.
export function parseBatteryGuideItems(pages) {
  const rows = [];
  for (const items of pages) {
    // 1) Lines: items within 2.5pt of each other's baseline.
    const lines = [];
    for (const it of items.filter(i => String(i.s).trim()).sort((a, b) => b.y - a.y)) {
      const line = lines.find(l => Math.abs(l.y - it.y) <= 2.5);
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
    // 2) Data lines carry a model year in the year column.
    const isData = (l) => l.items.some(i => column(i.x) === 'year' && parseYears(i.s));
    const data = lines.filter(isData);
    const used = new Set(data);
    for (const l of data) {
      const r = { model: '', code: '', yearText: '', engine: '', type: '', cca: '', rc: '', pn: '', replCca: '', replRc: '', note: '' };
      for (const it of l.items) {
        const col = column(it.x);
        const s = String(it.s).trim();
        if (col === 'type' && it.x >= 345 && /[a-z]/.test(s) && s.length > 12) r.note = s;
        else if (col === 'year') r.yearText = s;
        else r[col] = r[col] ? `${r[col]} ${s}` : s;
      }
      // The lithium note sits a point off its row — pick it up from a nearby line.
      const noteLine = lines.find(o => o !== l && !isData(o) && Math.abs(o.y - l.y) <= 3 && o.items.some(i => i.x >= 345 && /Lithium|WebDCS|Order/i.test(i.s)));
      if (noteLine && !r.note) { r.note = noteLine.items.map(i => i.s).join(' ').trim(); used.add(noteLine); }
      rows.push({ ...r, _y: l.y, _lines: lines });
    }
    // 3) Wrapped model names: a model-only line just above / below a row.
    for (const l of lines) {
      if (used.has(l)) continue;
      if (!l.items.every(i => column(i.x) === 'model')) continue;
      const text = l.items.map(i => i.s).join(' ').trim();
      if (!text || /^(MODEL|VEHICLE)$/i.test(text)) continue;
      let best = null;
      for (const r of rows) {
        if (r._lines !== lines) continue;
        const d = Math.abs(r._y - l.y);
        if (d <= 8 && (!best || d < Math.abs(best._y - l.y))) best = r;
      }
      if (!best) continue;
      if (l.y > best._y) best._above = [...(best._above || []), { y: l.y, text }];
      else best._below = [...(best._below || []), { y: l.y, text }];
    }
  }
  const join = (a, b) => (!a ? b : !b ? a : a.endsWith('/') ? a + b : `${a} ${b}`);
  return rows.map(r => {
    let model = r.model;
    (r._above || []).sort((a, b) => b.y - a.y).forEach(p => { model = join(p.text, model); });
    // Model sitting on the line above with nothing on the row itself.
    if (!r.model && r._above) model = r._above.sort((a, b) => b.y - a.y).map(p => p.text).reduce(join, '');
    (r._below || []).sort((a, b) => b.y - a.y).forEach(p => { model = join(model, p.text); });
    const years = parseYears(r.yearText);
    const num = (v) => (String(v).match(/^\d+$/) ? Number(v) : null);
    return {
      model: model.replace(/\s+/g, ' ').trim().toUpperCase(), code: r.code.trim(),
      yearFrom: years ? years.from : null, yearTo: years ? years.to : null, yearText: r.yearText,
      engine: r.engine.trim(), type: r.type.trim(), cca: num(r.cca), rc: num(r.rc),
      pn: r.pn.trim(), replCca: num(r.replCca), replRc: num(r.replRc), note: r.note.trim(),
    };
  }).filter(r => r.model && r.yearFrom);
}

// Browser: read the PDF with PDF.js → rows.
export async function readBatteryGuidePdf(file, loadPdfJs) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      pages.push(tc.items.map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str })));
    }
  } finally { try { doc.destroy(); } catch {} }
  const rows = parseBatteryGuideItems(pages);
  if (rows.length < 5) throw new Error("That doesn't look like the Hyundai Battery Guide — no battery rows were found.");
  return rows;
}

// ── Lookup ────────────────────────────────────────────────────────────────────
export const coversYear = (r, y) => y >= r.yearFrom && (r.yearTo == null || y <= r.yearTo);
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Electrified kind of a guide row, from its model name / engine.
export function rowKind(r) {
  const t = `${r.model} ${r.engine} ${r.code}`.toUpperCase();
  if (/FUEL CELL|FCV/.test(t)) return 'FCV';
  if (/PLUGIN|PHEV/.test(t)) return 'PHEV';
  if (/HYBRID|HEV/.test(t)) return 'HEV';
  if (/\bEV\b|IONIQ [569]\b/.test(t)) return 'EV';
  return 'ICE';
}

// Rows for a decoded VIN (year + model, plus electrification / engine size when
// NHTSA gives them), best match first. Each row gets `score` and `why`.
export function matchVehicle(rows, { year, model, kind, displacement }) {
  const y = Number(year);
  const want = norm(model).replace(/\bHYBRID\b|\bPLUG IN\b|\bPLUGIN\b|\bELECTRIC\b/g, '').trim();
  if (!y || !want) return [];
  const out = [];
  for (const r of rows) {
    if (!coversYear(r, y)) continue;
    const m = norm(r.model);
    if (!(m === want || m.startsWith(`${want} `) || m.startsWith(`${want}/`))) continue;
    let score = 0;
    const why = [];
    const rk = rowKind(r);
    const base = m.replace(/\/XL$/, '');
    if (base === want || (rk !== 'ICE' && kind === rk)) { score += 3; }
    if (kind) {
      if (rk === kind) { score += 4; why.push(kind === 'ICE' ? 'gas engine' : kind); } else score -= 3;
    }
    if (displacement) {
      const d = Number(displacement).toFixed(1);
      if (new RegExp(`\\b${d.replace('.', '\\.')}\\s*(L|T)\\b`, 'i').test(r.engine)) { score += 2; why.push(`${d}L`); }
      else if (/^ALL$/i.test(r.engine) || !r.engine) score += 0;
      else score -= 1;
    }
    out.push({ ...r, score, why });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Years and models for the manual pickers.
export function yearsIn(rows) {
  const now = new Date().getFullYear() + 1;
  const ys = new Set();
  rows.forEach(r => { for (let y = r.yearFrom; y <= (r.yearTo || now); y++) ys.add(y); });
  return [...ys].sort((a, b) => b - a);
}
export const modelsFor = (rows, year) => [...new Set(rows.filter(r => coversYear(r, year)).map(r => r.model))].sort();
