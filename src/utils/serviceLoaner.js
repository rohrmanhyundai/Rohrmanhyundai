import { openaiRequest } from './openai';
import { loadPdfJs } from './pdfText';

// ── Service Loaner contract reader ────────────────────────────────────────────
// The signed Vehicle Use Agreement comes in as a scanner PDF — one JPEG per page,
// no text layer — so there's nothing for PDF.js to read as text. Instead the
// face page is rendered to an image and gpt-4o reads the boxes off it (same
// route as the $50 add-on screenshot reader). Everything it returns is shown
// for the advisor to check and correct before the contract is saved.

const PROMPT = `This is a scanned Hyundai dealership "VEHICLE USE AGREEMENT" (service loaner contract) face page.
Read these boxes and return ONLY a JSON object, no markdown fences:
- first_name, last_name: from the "Customer" box under CUSTOMER INFORMATION (top left). Not the additional drivers, not the signature.
- ro: the "RO#" box (top right, left of Unit# and RA#). Often left blank — then null. Never use the Unit# or RA#.
- vin: the "Vehicle VIN" box under VEHICLE INFORMATION — 17 characters. NOT the "License No." in the insurance section.
- year, make, model: the Year / Make / Model boxes under VEHICLE INFORMATION (the loaner). Model is the full model text as printed, e.g. "KONA SEL PREMIUM AWD".
- date_out: "Date and Time OUT" date, as YYYY-MM-DD.
- time_out: "Date and Time OUT" time, 24-hour HH:MM (10:46 AM → "10:46", 2:05 PM → "14:05").
Use null for anything blank or unreadable. Do not guess.
{"first_name":"","last_name":"","ro":null,"vin":"","year":"","make":"","model":"","date_out":"","time_out":""}`;

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read that file.'));
  r.readAsDataURL(file);
});

export const isPdf = (file) => /pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');

// Page 1 of the PDF as a JPEG data URL, about 1700px wide (the scan's own size).
async function pdfFirstPageImage(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, 1700 / base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const url = canvas.toDataURL('image/jpeg', 0.85);
  try { doc.destroy(); } catch {}
  return url;
}

const clean = (v) => (v == null ? '' : String(v).trim());
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

// Normalise what the model sent back into the record's field shape.
export function normaliseFields(p) {
  const vin = clean(p.vin).toUpperCase().replace(/[^A-Z0-9]/g, '');
  let date = clean(p.date_out);
  const us = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) date = `${us[3].length === 2 ? '20' + us[3] : us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';
  let time = clean(p.time_out);
  const t = time.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (t) {
    let h = Number(t[1]);
    if (t[3]) { const pm = /p/i.test(t[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    time = `${String(h).padStart(2, '0')}:${t[2]}`;
  } else time = '';
  return {
    firstName: clean(p.first_name),
    lastName: clean(p.last_name),
    ro: clean(p.ro).replace(/[^0-9A-Za-z-]/g, ''),
    vin,
    year: clean(p.year).replace(/\D/g, '').slice(0, 4),
    make: clean(p.make).toUpperCase(),
    model: clean(p.model).toUpperCase(),
    dateOut: date,
    timeOut: time,
  };
}

// What the advisor should double-check before saving.
export function fieldWarnings(f) {
  const w = [];
  if (!f.firstName || !f.lastName) w.push('Customer name');
  if (!f.ro) w.push('RO # (blank on the contract — type it in)');
  if (!VIN_RE.test(f.vin || '')) w.push('VIN (should be 17 characters)');
  if (!/^\d{4}$/.test(f.year || '')) w.push('Year');
  if (!f.make || !f.model) w.push('Make / model');
  if (!f.dateOut || !f.timeOut) w.push('Date / time out');
  return w;
}

// → { firstName, lastName, ro, vin, year, make, model, dateOut, timeOut }
export async function readLoanerContract(file) {
  let dataUrl;
  if (isPdf(file)) dataUrl = await pdfFirstPageImage(file);
  else if (/^image\//.test(file.type || '')) dataUrl = await readAsDataUrl(file);
  else throw new Error('Upload the contract as a PDF (or a photo of it).');

  const res = await openaiRequest({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0,
      max_tokens: 400,
      messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ] }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Reader error ${res.status}`);
  }
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Could not read the contract — fill the fields in by hand.'); }
  return normaliseFields(parsed || {});
}
