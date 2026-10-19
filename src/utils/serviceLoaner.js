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
- ra_no: the RA# in that header row (the RIGHTMOST of RO# / Unit# / RA#), e.g. "A1275".
- date_in, time_in: the "Date and Time IN" box (filled in when the loaner comes back) — same formats as out. null if blank.
- unit_no: the Unit# in that header row (the MIDDLE one), e.g. "TA540230".
- due_date, due_time: the "Date and Time DUE IN" box — same formats as out.
- advisor: the "Service Advisor" box (top right, under the RO# row), e.g. "MATTHEW CLARK".
- miles_out: "Mileage OUT Customer" (or "Mileage OUT Delivery" if that is the one filled in) — digits only.
- plate: the "Plate/Tag No." box under VEHICLE INFORMATION, e.g. "227M29".
- phone: the customer's "Telephone" box under CUSTOMER INFORMATION — digits as printed.
- is_face_page: true if this image is the contract FACE page (customer / vehicle information boxes); false for a terms page, a blank page or anything else.
Use null for anything blank or unreadable. Do not guess.
{"first_name":"","last_name":"","ro":null,"vin":"","year":"","make":"","model":"","date_out":"","time_out":"","ra_no":null,"unit_no":null,"date_in":null,"time_in":null,"due_date":null,"due_time":null,"advisor":null,"miles_out":null,"plate":null,"phone":null,"is_face_page":true}`;

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
  try { return await pdfPageImages(doc, 1); } finally { try { doc.destroy(); } catch {} }
}
// One page of an open pdf.js document → [full page JPEG, header close-up JPEG].
async function pdfPageImages(doc, pageNo) {
  const page = await doc.getPage(pageNo);
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
  canvas.width = canvas.height = 0;
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

const normDate = (v) => {
  let date = clean(v);
  const us = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) date = `${us[3].length === 2 ? '20' + us[3] : us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
};
const normTime = (v) => {
  const t = clean(v).match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!t) return '';
  let h = Number(t[1]);
  if (t[3]) { const pm = /p/i.test(t[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return `${String(h).padStart(2, '0')}:${t[2]}`;
};

// Normalise what the model sent back into the record's field shape.
export function normaliseFields(p) {
  const vin = clean(p.vin).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const date = normDate(p.date_out);
  const time = normTime(p.time_out);
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
    raNo: clean(p.ra_no).toUpperCase().replace(/[^0-9A-Z-]/g, ''),
    dateIn: normDate(p.date_in),
    timeIn: normTime(p.time_in),
    unitNo: clean(p.unit_no).toUpperCase().replace(/[^0-9A-Z]/g, ''),
    dueDate: normDate(p.due_date),
    dueTime: normTime(p.due_time),
    advisor: clean(p.advisor).toUpperCase(),
    mileageOut: clean(p.miles_out).replace(/[^\d]/g, ''),
    plate: clean(p.plate).toUpperCase().replace(/\s+/g, ''),
    phone: clean(p.phone),
  };
}

// Check a read contract against the loaner fleet (Loaner Inventory). The Unit #
// (the VIN's last 8) or a VIN off by a misread character or two picks out the
// loaner; its VIN, year, make and model are then used — the fleet's are right,
// a scan read can slip. Returns { fields, fixed: ['VIN', …] }.
export function fixWithFleet(f, fleet = []) {
  if (!fleet.length) return { fields: f, fixed: [] };
  const vin = f.vin || '', unit = f.unitNo || '';
  const diff = (a, b) => { let n = 0; for (let i = 0; i < 17; i++) if (a[i] !== b[i]) n++; return n; };
  const v = fleet.find(x => x.vin && x.vin === vin)
    || (unit.length >= 6 && fleet.find(x => (x.unitNo && x.unitNo.toUpperCase() === unit) || (x.vin && x.vin.endsWith(unit))))
    || (vin.length >= 8 && fleet.find(x => x.vin && x.vin.endsWith(vin.slice(-8))))
    || (vin.length === 17 && fleet.find(x => x.vin && x.vin.length === 17 && diff(x.vin, vin) <= 2));
  if (!v) return { fields: f, fixed: [] };
  const out = { ...f }, fixed = [];
  if (v.vin && v.vin !== vin) { out.vin = v.vin; fixed.push('VIN'); }
  if (v.year && v.year !== f.year) { out.year = v.year; fixed.push('year'); }
  if (v.make && !f.make) out.make = v.make;
  if (v.model && !f.model) out.model = v.model;
  if (!out.unitNo && v.unitNo) out.unitNo = v.unitNo;
  return { fields: out, fixed };
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
// Images of one contract page → the raw JSON the reader returned.
async function readImages(images) {
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
  try { return JSON.parse(text) || {}; } catch { throw new Error('Could not read the contract — fill the fields in by hand.'); }
}

export async function readLoanerContract(file) {
  let images;
  if (isPdf(file)) images = await pdfFirstPageImages(file);
  else if (/^image\//.test(file.type || '')) images = await imageFileImages(file);
  else throw new Error('Upload the contract as a PDF (or a photo of it).');
  return normaliseFields(await readImages(images));
}

// ── Bulk upload ───────────────────────────────────────────────────────────────
// One scanned PDF holding many contracts, one face page each (terms / blank
// pages are spotted and skipped). Every page is read like a single upload;
// planBulk then matches each to a contract already on file, and the page
// itself is split out (splitPdfPage) and stored only when the user applies.

// file → [{ page, fields, isFace, thumb, error }] in page order. Reads `conc`
// pages at a time; onProgress(done, total).
export async function readLoanerContractPages(file, onProgress, conc = 3) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const total = doc.numPages;
  const out = new Array(total);
  let next = 1, done = 0;
  const worker = async () => {
    while (next <= total) {
      const n = next++;
      try {
        const images = await pdfPageImages(doc, n);
        const raw = await readImages(images);
        out[n - 1] = { page: n, fields: normaliseFields(raw), isFace: raw.is_face_page !== false, thumb: images[0] };
      } catch (e) {
        out[n - 1] = { page: n, error: e.message || 'Could not read this page.' };
      }
      done++;
      if (onProgress) onProgress(done, total);
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(conc, total) }, worker)); }
  finally { try { doc.destroy(); } catch {} }
  return out;
}

// Page n (1-based) of a PDF as its own one-page PDF File.
export async function splitPdfPage(file, n, name) {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const one = await PDFDocument.create();
  const [pg] = await one.copyPages(src, [n - 1]);
  one.addPage(pg);
  return new File([await one.save()], name, { type: 'application/pdf' });
}

const BULK_FIELDS = ['firstName', 'lastName', 'ro', 'raNo', 'unitNo', 'vin', 'year', 'make', 'model', 'dateOut', 'timeOut', 'dateIn', 'timeIn', 'dueDate', 'dueTime', 'advisor', 'mileageOut', 'plate', 'phone'];
const up = (v) => String(v || '').trim().toUpperCase();
function sameContract(a, f) {
  if (up(a.raNo) && up(f.raNo)) return up(a.raNo) === up(f.raNo);
  if (a.vin && f.vin && a.dateOut && f.dateOut) return a.vin === f.vin && a.dateOut === f.dateOut;
  return !!(up(a.lastName) && up(a.lastName) === up(f.lastName) && a.dateOut && a.dateOut === f.dateOut
    && (!a.vin || !f.vin || a.vin === f.vin));
}

// pages (from readLoanerContractPages) + contracts on file → one row per page:
//   { page, fields, thumb, action: 'new' | 'update' | 'same' | 'skip', why,
//     target (existing contract) | joinPage (earlier page of this upload),
//     fill: { field: value } — only fields blank on file (a checked/corrected
//     contract is never overwritten),
//     attach: which copy this page becomes — 'original' | 'completed' | null; a
//     new contract's page is 'original', or 'both' when it is already returned
//     ('original+' / 'completed+' once another page of the upload took the other copy) }
// A page with a Date IN is the returned copy: it goes on as the completed copy.
export function planBulk(pages, contracts) {
  const rows = [];
  const pending = [];     // new contracts made earlier in this same upload
  for (const p of pages) {
    if (!p) continue;
    if (p.error) { rows.push({ page: p.page, action: 'skip', why: p.error }); continue; }
    const f = p.fields;
    if (!p.isFace || (!f.firstName && !f.lastName && !f.vin)) { rows.push({ page: p.page, thumb: p.thumb, fields: f, action: 'skip', why: 'Not a contract face page' }); continue; }
    const returned = !!f.dateIn;
    const target = contracts.find(c => sameContract(c, f));
    if (target) {
      const fill = {};
      for (const k of BULK_FIELDS) if (f[k] && !String(target[k] || '').trim()) fill[k] = f[k];
      const attach = returned ? (target.completedUrl ? null : 'completed') : (target.fileUrl ? null : 'original');
      const action = Object.keys(fill).length || attach ? 'update' : 'same';
      rows.push({ page: p.page, thumb: p.thumb, fields: f, action, target, fill, attach,
        why: action === 'same' ? (returned ? 'Already has its returned copy' : 'Already on file') : '' });
      continue;
    }
    // The out copy and the returned copy of a new contract, both in this upload.
    const earlier = pending.find(r => sameContract(r.fields, f));
    if (earlier) {
      const join = (attach) => rows.push({ page: p.page, thumb: p.thumb, fields: f, action: 'update', joinPage: earlier.page, attach, fill: {}, why: '' });
      if (returned && earlier.attach === 'original') { earlier.attach = 'original+'; join('completed'); }
      else if (!returned && earlier.attach === 'both') { earlier.attach = 'completed+'; join('original'); }
      else rows.push({ page: p.page, thumb: p.thumb, fields: f, action: 'skip', why: `Same contract as page ${earlier.page}` });
      continue;
    }
    const row = { page: p.page, thumb: p.thumb, fields: f, action: 'new', attach: returned ? 'both' : 'original', why: '' };
    pending.push(row);
    rows.push(row);
  }
  return rows;
}
