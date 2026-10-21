import { openaiRequest } from './openai';

// ── Oil capacity / fluid specs ────────────────────────────────────────────────
// public/data/fluid-specs.json → { updatedAt, vehicles: [{ id, make, model, code,
//   yearFrom, yearTo, source: { fileName, uploadedAt, by },
//   fluids: [{ fluid, engine, volume, spec, partNumber, note }] }] }
// Spec sheets come in two shapes: owner's-manual pages with a real text layer
// (e.g. the Palisade "Maintenance Specs") and HMA fluid-spec articles whose text
// is drawn as outlines — no text at all (e.g. the Sonata one, several model
// generations in one file). So every page is rendered to a picture and gpt-4o
// reads the tables (plus the text layer when there is one). Nothing is saved
// until a person checks it on Settings — year / make / model are often only in
// the file name, or missing.

const PROMPT = `These pages are Hyundai fluid-capacity / fluid-specification tables (an owner's-manual "Lubricant / Volume / Classification" page or an HMA "Fluid Specification" article).
Return ONLY JSON: {"vehicles":[{"make":"","model":"","code":"","year_from":null,"year_to":null,"fluids":[{"fluid":"","engine":"","volume":"","spec":"","part_number":"","note":""}]}]}
Rules:
- One "vehicles" entry per model / generation section (e.g. "Sonata (LFA) 2015-2019 Fluid Specification" is its own entry). A table that continues onto the next page belongs to the same entry.
- make: usually HYUNDAI. model: e.g. "SONATA", "SONATA HYBRID", "PALISADE". code: the generation code in brackets, e.g. "LFA", "DN8 HEV" ("" if none).
- year_from / year_to: from the section title (e.g. 2015-2019). If the page itself has no year/model, use the FILE NAME hint below; if still unknown use null / "".
- fluids: one row per fluid per engine. "fluid" = the lubricant name (Engine Oil, Automatic Transmission Fluid, Coolant, Brake Fluid, Refrigerant, …). "engine" = the engine size / variant for that row ("" if the row is for all engines). Keep any years printed in the engine cell, e.g. "2021 1.6T GDI".
- When one cell spans several rows (a classification or part number shared by several engines, a volume shared by two engines), REPEAT it on every row it covers. A value printed once, vertically BETWEEN two engine rows (centred on the line between them), belongs to BOTH rows — e.g. "5W-30" printed between the 1.6T and 2.0T rows applies to 1.6T and 2.0T, and the next value down starts with the following engine. Never shift values down a row to fill gaps.
- When a cell holds two values for one engine (e.g. two volumes stacked for the same engine), keep both in that one row joined with " or ".
- When a row lists two choices (e.g. DOT 3 and DOT 4 with different part numbers), make two rows.
- volume: exactly as printed incl. units and metric in brackets, e.g. "5.07 US qt (4.8 L)". spec: the classification / specification text. part_number: the OEM part number, or the printed text such as "Refer to the Hyundai Lubricants Program". note: any footnote that changes what to use (keep it short), else "".
- Copy values exactly; do not invent anything. Skip marketing text, warnings and table headers.`;

const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read that file.'));
  r.readAsDataURL(blob);
});

// PDF → [{ image (JPEG data URL), text }] per page (up to 8 pages).
async function pdfPages(file, loadPdfJs) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 8); p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.2, 1700 / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const text = (await page.getTextContent()).items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      out.push({ image: canvas.toDataURL('image/jpeg', 0.82), text });
      canvas.width = canvas.height = 0;
    }
  } finally { try { doc.destroy(); } catch {} }
  return out;
}

const s = (v) => (v == null ? '' : String(v).trim());
const yr = (v) => { const n = parseInt(v, 10); return n >= 1990 && n <= 2100 ? n : null; };

// Read a spec PDF (or a photo of one) → draft vehicles for the review step.
export async function readFluidSpecPdf(file, loadPdfJs) {
  let pages;
  if (/pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '')) pages = await pdfPages(file, loadPdfJs);
  else if (/^image\//.test(file.type || '')) pages = [{ image: await readAsDataUrl(file), text: '' }];
  else throw new Error('Upload the spec sheet as a PDF (or a photo of it).');
  const text = pages.map((p, i) => (p.text ? `--- page ${i + 1} text ---\n${p.text}` : '')).filter(Boolean).join('\n').slice(0, 12000);
  const res = await openaiRequest({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: `${PROMPT}\n\nFILE NAME hint: "${file.name || ''}"${text ? `\n\nText layer (may be incomplete):\n${text}` : ''}` },
        ...pages.map(p => ({ type: 'image_url', image_url: { url: p.image, detail: 'high' } })),
      ] }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Reader error ${res.status}`);
  }
  const data = await res.json();
  let parsed;
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { throw new Error("Couldn't read the tables — add the vehicle by hand on Settings."); }
  const vehicles = (parsed.vehicles || []).map(v => ({
    make: s(v.make).toUpperCase() || 'HYUNDAI',
    model: s(v.model).toUpperCase(),
    code: s(v.code),
    yearFrom: yr(v.year_from), yearTo: yr(v.year_to) || yr(v.year_from),
    fluids: (v.fluids || []).map(f => ({ fluid: s(f.fluid), engine: s(f.engine), volume: s(f.volume), spec: s(f.spec), partNumber: s(f.part_number), note: s(f.note) }))
      .filter(f => f.fluid || f.volume),
  })).filter(v => v.fluids.length);
  if (!vehicles.length) throw new Error('No fluid tables were found in that file.');
  return vehicles;
}

// What a draft still needs before it can be saved.
export function missingFields(v) {
  const m = [];
  if (!s(v.make)) m.push('make');
  if (!s(v.model)) m.push('model');
  if (!v.yearFrom) m.push('year from');
  if (!v.yearTo) m.push('year to');
  if (v.yearFrom && v.yearTo && v.yearTo < v.yearFrom) m.push('years (to is before from)');
  return m;
}

// ── Lookup ────────────────────────────────────────────────────────────────────
const norm = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const coversYear = (v, y) => y >= v.yearFrom && y <= (v.yearTo || v.yearFrom);

// An engine cell can carry its own years: "2021 1.6T GDI", "2022-2023 2.5 GDI",
// "2020 Model SmartStream G 2.5 GDI". A row for other years is hidden.
export function engineYearOk(engine, year) {
  const m = String(engine || '').match(/^\s*(\d{4})(?:\s*[-–]\s*(\d{4}))?(?:\s+Model)?\b/i);
  if (!m || !year) return true;
  const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
  return year >= from && year <= to;
}

// Does this engine cell match a decoded displacement (e.g. 1.6 → "1.6T GDI")?
export function engineMatches(engine, displacement) {
  if (!displacement) return false;
  const d = Number(displacement).toFixed(1);
  return new RegExp(`(^|[^0-9.])${d.replace('.', '\\.')}(?![0-9])`).test(String(engine || '').replace(/^\s*\d{4}(\s*[-–]\s*\d{4})?(\s+Model)?\s+/i, ''));
}

// Vehicles for a VIN (year + model), hybrids steered by the decoder's kind.
export function vehiclesFor(vehicles, { year, model, kind }) {
  const y = Number(year);
  const want = norm(model).replace(/\b(HYBRID|PLUG IN|PLUGIN|ELECTRIC)\b/g, '').trim();
  if (!y || !want) return [];
  return vehicles
    .filter(v => coversYear(v, y) && (norm(v.model) === want || norm(v.model).startsWith(`${want} `)))
    .map(v => {
      const hybrid = /HYBRID|HEV/.test(`${norm(v.model)} ${norm(v.code)}`);
      let score = norm(v.model) === want ? 2 : 0;
      if (kind) score += (kind === 'HEV' || kind === 'PHEV') === hybrid ? 3 : -3;
      return { ...v, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function yearsIn(vehicles) {
  const ys = new Set();
  vehicles.forEach(v => { for (let y = v.yearFrom; y <= (v.yearTo || v.yearFrom); y++) ys.add(y); });
  return [...ys].sort((a, b) => b - a);
}
export const modelsFor = (vehicles, year) => [...new Set(vehicles.filter(v => coversYear(v, year)).map(v => v.model))].sort();
export const isEngineOil = (f) => /ENGINE OIL/i.test(f.fluid);
