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
import { PDFDocument, StandardFonts, rgb, moveTo, lineTo, appendBezierCurve, closePath, pushGraphicsState, popGraphicsState, setFillingColor, PDFOperator, PDFOperatorNames } from 'pdf-lib';

const INK = rgb(0, 0, 0);

// The Hyundai logo (emblem + wordmark), official vector outlines from
// Wikimedia Commons "Hyundai Motor Company logo.svg", in its own units
// (371.55 × 47.79). Printed black, like the paper form.
const LOGO_EMBLEM = 'm 56.707,29.416 c 0.714,3.69 -1.22,6.755 -2.827,9.73 -1.785,2.768 -4.731,5.147 -8.272,4.791 -7.946,-0.119 -15.712,-1.339 -22.914,-3.512 -0.327,-0.089 -0.654,-0.298 -0.833,-0.595 -0.149,-0.417 0.06,-0.804 0.357,-1.071 6.577,-5.327 14.403,-7.796 22.14,-10.386 2.886,-0.833 5.952,-1.726 9.195,-1.309 1.338,0.179 2.677,1.102 3.154,2.352 z M 83.816,13.645 c 3.69,3.035 7.023,7.172 5.892,12.171 -1.845,7.38 -9.879,11.308 -16.277,13.807 -3.482,1.161 -6.993,2.352 -10.802,2.709 -0.238,-0.03 -0.625,0.029 -0.685,-0.328 l 0.089,-0.416 c 5.416,-6.101 9.522,-12.944 13.124,-19.878 1.666,-3.125 3.214,-6.338 4.642,-9.493 0.208,-0.238 0.417,-0.357 0.655,-0.446 1.338,0.118 2.291,1.16 3.362,1.874 z M 31.888,5.789 31.769,6.235 C 23.943,15.132 18.795,25.458 13.915,35.724 12.963,36.617 12.04,35.426 11.177,35.039 6.832,32.183 2.904,27.57 4.035,22.095 5.85,14.954 13.2,11.145 19.331,8.557 c 3.63,-1.369 7.41,-2.47 11.397,-3.095 0.417,-10e-4 0.952,-0.06 1.16,0.327 z m 38.835,1.428 c 0.446,0.238 0.982,0.327 1.25,0.773 0.238,0.506 -0.238,0.833 -0.506,1.161 -6.16,4.82 -13.212,7.499 -20.414,9.85 -3.661,0.893 -7.351,2.5 -11.427,1.607 -0.953,-0.238 -1.815,-0.863 -2.351,-1.786 -1.012,-2.797 0.357,-5.713 1.547,-8.153 1.577,-3.065 4.375,-6.666 8.243,-6.725 8.332,-0.06 16.188,1.19 23.658,3.273 z M 81.019,7.455 C 87.328,10.907 94.47,16.977 93.726,25.071 92.863,32.57 85.87,37.807 79.621,40.962 61.379,49.681 35.758,49.948 16.921,42.331 10.552,39.683 3.41,35.13 0.731,28.285 -1.322,22.661 1.177,16.799 5.374,12.901 14.152,4.926 25.341,2.189 36.858,0.611 c 12.499,-1.518 25.651,-0.179 36.84,3.66 2.5,0.923 4.97,1.935 7.321,3.184 z';
const LOGO_WORD = 'm 347.254,12.112 h -15.209 c -2.553,0.151 -3.266,0.784 -3.266,3.883 v 8.543 h 18.475 z m 8.098,-6.841 v 37.252 h -8.098 V 31.815 h -18.475 v 10.708 h -8.098 V 13.319 c 0,-5.16 2.09,-8.048 8.098,-8.048 z m -42.768,8.041 v 20.16 c 0,6.418 -3.605,9.044 -8.099,9.044 H 278.942 V 5.264 h 25.543 c 6.898,0 8.099,4.386 8.099,8.048 z m -8.195,2.242 c 0,-2.041 -1.244,-3.449 -3.422,-3.449 h -13.926 v 23.276 l 13.926,-10e-4 c 3.172,-0.161 3.422,-2.063 3.422,-3.572 z M 113.868,5.264 h 8.098 v 14.683 h 18.118 V 5.264 h 8.098 v 37.251 h -8.098 V 27.313 h -18.118 v 15.202 h -8.098 V 5.264 Z m 48.193,0 10.152,15.229 10.03,-15.229 h 9.833 L 176.258,29.08 v 13.436 h -8.099 V 29.078 L 152.231,5.264 Z m 75.472,0 h 26.096 c 3.719,0 7.32,0.522 7.215,8.048 v 29.204 h -8.098 V 15.988 c 0,-3.208 -0.385,-3.883 -2.902,-3.883 h -14.211 v 30.411 h -8.1 z m 134.016,0.007 v 37.252 h -8.1 V 5.271 Z M 196.126,42.516 h 26.094 c 5.188,0 7.321,-1.501 7.216,-8.981 V 5.264 h -8.098 v 26.593 c 0,3.188 -0.385,3.575 -2.902,3.575 H 204.225 L 204.224,5.264 h -8.098 z';
const LOGO_W = 371.55;

// SVG path data → absolute moveTo / lineTo / curveTo / close steps.
function svgSteps(d) {
  const toks = d.match(/[MmLlHhVvCcZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const out = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  const n = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': { const a = n(), b = n(); x = rel ? x + a : a; y = rel ? y + b : b; sx = x; sy = y; out.push(['M', x, y]); cmd = rel ? 'l' : 'L'; break; }
      case 'L': { const a = n(), b = n(); x = rel ? x + a : a; y = rel ? y + b : b; out.push(['L', x, y]); break; }
      case 'H': { const a = n(); x = rel ? x + a : a; out.push(['L', x, y]); break; }
      case 'V': { const b = n(); y = rel ? y + b : b; out.push(['L', x, y]); break; }
      case 'C': {
        const v = [n(), n(), n(), n(), n(), n()];
        const p = rel ? v.map((t, k) => t + (k % 2 ? y : x)) : v;
        out.push(['C', ...p]); x = p[4]; y = p[5]; break;
      }
      case 'Z': out.push(['Z']); x = sx; y = sy; break;
      default: i++;                               // anything unexpected: skip it
    }
  }
  return out;
}
// Draw the logo with its top-left at (left, top) from the page top, `width` wide.
function drawHyundaiLogo(page, left, top, width) {
  const k = width / LOGO_W;
  const X = (v) => left + v * k, Y = (v) => 792 - top - v * k;
  const ops = [pushGraphicsState(), setFillingColor(INK)];
  for (const d of [LOGO_EMBLEM, LOGO_WORD]) {
    for (const st of svgSteps(d)) {
      if (st[0] === 'M') ops.push(moveTo(X(st[1]), Y(st[2])));
      else if (st[0] === 'L') ops.push(lineTo(X(st[1]), Y(st[2])));
      else if (st[0] === 'C') ops.push(appendBezierCurve(X(st[1]), Y(st[2]), X(st[3]), Y(st[4]), X(st[5]), Y(st[6])));
      else ops.push(closePath());
    }
    ops.push(PDFOperator.of(PDFOperatorNames.FillEvenOdd));   // keeps the letter / emblem holes open
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}
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
  drawHyundaiLogo(page, 441, 63, 97);

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
