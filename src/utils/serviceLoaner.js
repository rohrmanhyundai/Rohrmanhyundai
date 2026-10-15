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
- ro: the repair order number in the "RO#" box — the top-right header row reads "RO#  Unit#  RA#"; RO# is the LEFTMOST of the three.
  It may be printed or HANDWRITTEN (often 5–6 digits, sometimes written right next to or under the "RO#" label). The SECOND image is a
  close-up of that header row — read the RO from it. Never use the Unit# (e.g. TU393247) or RA# (e.g. A1275). null only if the box is truly empty.
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

// Page 1 of the PDF as a JPEG data URL, about 1700px wide (the scan's own size),
// plus a sharper close-up of the top-right RO# / Unit# / RA# row — the RO is
// often a small handwritten number the full-page read misses.
const HEADER_CROP = { x: 0.57, y: 0.06, w: 0.43, h: 0.075 };
function cropImage(source, w, h, scaleUp) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * HEADER_CROP.w * scaleUp);
  c.height = Math.round(h * HEADER_CROP.h * scaleUp);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, w * HEADER_CROP.x, h * HEADER_CROP.y, w * HEADER_CROP.w, h * HEADER_CROP.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92);
}
async function pdfFirstPageImages(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  // Render at twice the working size so the header close-up has real detail.
  const viewport = page.getViewport({ scale: Math.min(6, 3400 / base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const full = document.createElement('canvas');
  full.width = Math.round(canvas.width / 2);
  full.height = Math.round(canvas.height / 2);
  full.getContext('2d').drawImage(canvas, 0, 0, full.width, full.height);
  const page1 = full.toDataURL('image/jpeg', 0.85);
  const header = cropImage(canvas, canvas.width, canvas.height, 1);
  try { doc.destroy(); } catch {}
  return [page1, header];
}

async function imageFileImages(file) {
  const url = await readAsDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Could not open that image.')); i.src = url;
  });
  return [url, cropImage(img, img.naturalWidth, img.naturalHeight, 2)];
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
  let images;
  if (isPdf(file)) images = await pdfFirstPageImages(file);
  else if (/^image\//.test(file.type || '')) images = await imageFileImages(file);
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
        ...images.map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
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
