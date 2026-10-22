// Hyundai "Rental Claim Form" (RCF 3/20/2018), redrawn as a clean one-page
// letter PDF with the answers written on the blanks. Same wording, order,
// fonts (Times), indents and spacing as the paper form — the scan itself is
// crooked and speckled, so it is drawn rather than stamped on.
//
// claim fields (dates 'YYYY-MM-DD', time 'HH:MM'):
//   ro, arrived, diagFrom, diagTo, partsOrdered, partsArrived, addlOrdered,
//   addlReason, addlArrived, fseFrom, fseTo, bodySent, bodyBack, headSent,
//   headBack, completed, pickedUp, delayReason, notifiedDate, notifiedTime,
//   managerName, managerSign
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const INK = rgb(0, 0, 0);
const FILL = rgb(0.05, 0.16, 0.55);          // answers in blue ink, like a filled-in form
const SIZE = 13;

// Every question on the form, in order — the "Create new form" screen asks these.
export const CLAIM_QUESTIONS = [
  { key: 'ro', label: 'R.O. Number', type: 'text' },
  { key: 'arrived', label: 'When vehicle arrived', type: 'date' },
  { key: 'diagFrom', label: 'Vehicle was diagnosed', type: 'date', pair: 'diagTo' },
  { key: 'partsOrdered', label: 'Parts were ordered', type: 'date' },
  { key: 'partsArrived', label: 'Parts arrived', type: 'date' },
  { key: 'addlOrdered', label: 'Additional parts ordered', type: 'date' },
  { key: 'addlReason', label: 'Reason additional parts were needed', type: 'text' },
  { key: 'addlArrived', label: 'Parts arrived (additional parts)', type: 'date' },
  { key: 'fseFrom', label: 'Waiting for FSE', type: 'date', pair: 'fseTo' },
  { key: 'bodySent', label: 'Vehicle sent to body shop', type: 'date' },
  { key: 'bodyBack', label: 'Date vehicle came back from body shop', type: 'date' },
  { key: 'headSent', label: 'Head sent to machine shop', type: 'date' },
  { key: 'headBack', label: 'Head back from machine shop', type: 'date' },
  { key: 'completed', label: 'When vehicle was completed', type: 'date' },
  { key: 'pickedUp', label: 'When customer picked up', type: 'date' },
];
export const DELAY_QUESTIONS = [
  { key: 'delayReason', label: "Customer's reason for delay", type: 'text' },
  { key: 'notifiedDate', label: 'Date customer was notified', type: 'date' },
  { key: 'notifiedTime', label: 'Time', type: 'time' },
  { key: 'managerName', label: 'Service Manager name (print)', type: 'text' },
  { key: 'managerSign', label: 'Service Manager (sign) — type the name to sign', type: 'text' },
];

const parts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? [m[2], m[3], m[1]] : null;
};
export const fmtDate = (iso) => { const p = parts(iso); return p ? p.join('/') : ''; };
export const fmtTime = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

export async function rentalClaimPdfBytes(c = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Rental Claim Form${c.ro ? ` — RO ${c.ro}` : ''}`);
  doc.setAuthor('Bob Rohrman Hyundai');
  const page = doc.addPage([612, 792]);
  const F = {
    rm: await doc.embedFont(StandardFonts.TimesRoman),
    it: await doc.embedFont(StandardFonts.TimesRomanItalic),
    bi: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    hv: await doc.embedFont(StandardFonts.Helvetica),
    hb: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    hbx: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const Y = (top) => 792 - top;               // measure from the top like the paper form
  const text = (s, x, top, font = F.rm, size = SIZE, color = INK) => {
    page.drawText(s, { x, y: Y(top), font, size, color });
    return x + font.widthOfTextAtSize(s, size);
  };
  const rule = (x, top, w) => page.drawLine({ start: { x, y: Y(top) - 2 }, end: { x: x + w, y: Y(top) - 2 }, thickness: 0.7, color: INK });
  // An answer sitting on its blank, shrunk to fit if it's long.
  const answer = (s, x, top, w, center = false) => {
    if (!s) return;
    let size = 12;
    while (size > 7 && F.hv.widthOfTextAtSize(s, size) > w - 2) size -= 0.5;
    const tw = F.hv.widthOfTextAtSize(s, size);
    page.drawText(s, { x: center ? x + (w - tw) / 2 : x + 2, y: Y(top) + 1, font: F.hv, size, color: FILL });
  };
  // "___/___/______" with the date's month / day / year on its three blanks.
  const date = (iso, x, top) => {
    const p = parts(iso) || ['', '', ''];
    const seg = [20, 20, 40], slash = F.rm.widthOfTextAtSize('/', SIZE) + 1;
    let cx = x;
    seg.forEach((w, i) => {
      rule(cx, top, w);
      answer(p[i], cx, top, w, true);
      cx += w;
      if (i < 2) { text('/', cx, top); cx += slash; }
    });
    return cx;
  };
  const line = (val, x, top, w) => { rule(x, top, w); answer(val, x, top, w); return x + w; };
  const sp = 5;

  // ── Header ──
  text('Rental Claim Form', 214, 80, F.rm, 23);
  // Hyundai logo: the slanted H in an oval, then the word mark.
  page.drawEllipse({ x: 458, y: Y(72), xScale: 15, yScale: 9.5, borderColor: INK, borderWidth: 2.2 });
  text('H', 452.5, 77.5, F.hb, 13);
  text('HYUNDAI', 477, 77.5, F.hbx, 14.5);

  // ── Questions ──
  let x;
  x = text('R.O. Number', 108, 97); line(c.ro, x + sp, 97, 82);
  text('Please enter dates (mm/dd/yyyy) for each ', 108, 124, F.it);
  {
    const lx = 108 + F.it.widthOfTextAtSize('Please enter dates (mm/dd/yyyy) for each ', SIZE);
    const ex = text('applicable', lx, 124, F.it);
    page.drawLine({ start: { x: lx, y: Y(124) - 1.5 }, end: { x: ex, y: Y(124) - 1.5 }, thickness: 0.6, color: INK });
    text(' field.', ex, 124, F.it);
  }
  x = text('When vehicle arrived', 108, 147); date(c.arrived, x + sp, 147);
  x = text('Vehicle was diagnosed', 108, 172); x = date(c.diagFrom, x + sp, 172); x = text('through', x + sp, 172); date(c.diagTo, x + sp, 172);
  x = text('Parts were ordered', 108, 195); date(c.partsOrdered, x + sp, 195);
  x = text('Parts arrived', 108, 219); date(c.partsArrived, x + sp, 219);
  x = text('Additional parts ordered', 108, 245); date(c.addlOrdered, x + sp, 245);
  x = text('Reason additional parts were needed', 129, 265); line(c.addlReason, x + sp, 265, 528 - x - sp);
  x = text('Parts arrived', 108, 287); date(c.addlArrived, x + sp, 287);
  x = text('Waiting for FSE', 108, 314); x = date(c.fseFrom, x + sp, 314); x = text('through', x + sp, 314); date(c.fseTo, x + sp, 314);
  x = text('Vehicle sent to body shop', 108, 338); date(c.bodySent, x + sp, 338);
  x = text('Date vehicle came back from body shop', 108, 362); date(c.bodyBack, x + sp, 362);
  x = text('Head sent to machine shop', 108, 385); date(c.headSent, x + sp, 385);
  x = text('Head back from machine shop', 108, 409); date(c.headBack, x + sp, 409);
  x = text('When vehicle was completed', 108, 433); date(c.completed, x + sp, 433);
  x = text('When customer picked up', 108, 457); date(c.pickedUp, x + sp, 457);

  // ── Delay in pick up ──
  text('*If delay in pick up, please fill out the following:', 108, 482);
  x = text('Customer’s reason for delay:', 123, 503); line(c.delayReason, x + sp, 503, 524 - x - sp);
  x = text('Date customer was notified', 123, 524); x = date(c.notifiedDate, x + sp, 524); x = text('Time', x + 12, 524); line(fmtTime(c.notifiedTime), x + sp, 524, 66);
  x = text('Service Manager name ', 123, 545); x = text('(print)', x, 545, F.rm, 11); x = line(c.managerName, x + sp, 545, 100);
  x = text('(sign)', x + 1, 545, F.rm, 11);
  rule(x + 2, 545, 524 - x - 2);
  if (c.managerSign) {                         // typed signature, in script-like italic
    let size = 15;
    while (size > 9 && F.it.widthOfTextAtSize(c.managerSign, size) > 524 - x - 8) size -= 0.5;
    page.drawText(c.managerSign, { x: x + 6, y: Y(545) + 1, font: F.it, size, color: FILL });
  }

  // ── Not covered ──
  text('Refer to Warranty P&P manual section 5.0.8 for details about what is not covered:', 100, 572, F.bi, 12.5);
  const q = [
    '“The rental vehicle is kept beyond the completion of warranty repairs to the eligible vehicle.',
    'When the warranty repairs are completed and the customer is notified, continued use of the rental',
    'vehicle is at the expense of the customer or dealership.  Any warranty claim submitted to Hyundai',
    'should not include charges for continued use.”',
  ];
  q.forEach((s, i) => text(s, 135, 591 + i * 17, F.rm, 10.5));
  x = text('Also note: ', 96, 662, F.bi, 12);
  text('“Dealer scheduling/time issues or delays in servicing the vehicle are not valid reasons for', x, 662, F.rm, 10.5);
  text('submitting extended rental coverage.”', 96, 679, F.rm, 10.5);

  text('RCF 3/20/2018', 482, 734, F.hv, 11);
  return doc.save();
}

export async function rentalClaimBlobUrl(c) {
  return URL.createObjectURL(new Blob([await rentalClaimPdfBytes(c)], { type: 'application/pdf' }));
}
export const rentalClaimFileName = (c) => `Rental_Claim_Form_${(c && c.ro) || 'blank'}.pdf`.replace(/[^\w.-]+/g, '_');
