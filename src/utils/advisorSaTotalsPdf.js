// SA Totals advisor performance .pdf parsing.
//
// Only the upsell penetration percentages live in this report — Alignment,
// Tires, Valvoline and ASR. Everything else on an advisor's snapshot comes from
// the Advisor Performance Report (.html) — see utils/advisorPerfReport.
//
// Moved out of ManagerReports so the historical backfill and the per-advisor
// "Upload Report" button on the Performance Report page share one parser.

import { loadPdfJs } from './pdfText';

const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase();

// Flatten every page into text lines, grouping items that share a baseline.
async function pdfLines(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byY = {};
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      (byY[y] = byY[y] || []).push({ x: it.transform[4], text: it.str });
    }
    Object.entries(byY).sort(([a], [b]) => Number(b) - Number(a)).forEach(([, items]) => {
      items.sort((a, b) => a.x - b.x);
      const line = items.map(i => i.text).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      if (line) allLines.push(line);
    });
  }
  return allLines;
}

// Parses an SA Totals advisor performance .pdf and returns { firstName → fields }.
// Only Alignment / Tires / Valvoline / ASR penetration % land here.
export async function parseAdvisorSaTotalsPdf(file) {
  const allLines = await pdfLines(file);

  const headerLine = allLines.find(L => {
    const u = L.toUpperCase();
    return u.includes('ALIGNMENT PEN') && u.includes('VALVOLINE PEN') && u.includes('TIRE PEN') && u.includes('ASR SOLD');
  });
  if (!headerLine) throw new Error('PDF format unexpected — missing Alignment / Tire / Valvoline / ASR headers.');

  // Right-indexed positions (from the end of the numeric sequence): the
  // SA Totals tail is ... ASR% INSP% ALIGN% BATTERY% TIRE% VALV% TOP-GUN RANK
  // A leading-cell split by PDF.js (e.g. "13.60%" → "13" + "60%") would
  // shift left-indexed positions; counting from the end keeps the upsell
  // columns stable as long as the final cells are intact.
  const FROM_END_ASR = 8, FROM_END_ALIGNMENT = 6, FROM_END_TIRE = 4, FROM_END_VALVOLINE = 3;
  const fromEnd = (arr, n) => (arr.length >= n ? arr[arr.length - n] : undefined);
  const numRe = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;
  const parsePct = (raw) => {
    const v = String(raw || '').replace(/[, $]/g, '').replace('%', '').trim();
    if (!v) return null;
    const f = parseFloat(v);
    if (isNaN(f)) return null;
    return f > 1 ? f / 100 : f;
  };

  const out = {};
  for (const line of allLines) {
    if (line === headerLine) continue;
    if (/\b(total|grand|average|all dealers|number of)\b/i.test(line)) continue;
    const nums = (line.match(numRe) || []);
    if (nums.length < FROM_END_ASR) continue;
    // Pull a likely advisor name: contiguous uppercase letters (length ≥ 3) on the line.
    const nameMatch = line.match(/\b([A-Z][A-Z'\-]{2,})\b(?:\s+[A-Z][A-Z'\-]{1,})?/);
    if (!nameMatch) continue;
    const name = nameMatch[0].trim();
    const fn = firstWord(name);
    if (!fn) continue;
    // Slice numerics after the matched name to keep header / date noise out.
    const after = line.slice(line.indexOf(nameMatch[0]) + nameMatch[0].length);
    const tailNums = (after.match(numRe) || []);
    if (tailNums.length < FROM_END_ASR) continue;
    const fields = out[fn] || (out[fn] = { reportName: name });
    const apply = (key, n) => {
      const v = parsePct(fromEnd(tailNums, n));
      if (v !== null) fields[key] = Math.round(v * 10000) / 10000;
    };
    apply('asr',       FROM_END_ASR);
    apply('align',     FROM_END_ALIGNMENT);
    apply('tires',     FROM_END_TIRE);
    apply('valvoline', FROM_END_VALVOLINE);
  }
  return out;
}
