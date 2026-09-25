// "Estimated Completion Time" sign — a full-page, color sign an advisor prints
// and puts on/in the car so the tech sees when it's promised.
//
// A self-contained HTML page loaded into a hidden frame on the current page,
// which prints itself — no pop-up window. The sign is one SVG sized to a Letter page; the
// clock hands point at the chosen time. Long text (e.g. "12:45 PM", long day
// names) is scaled down in the page to fit before printing.

const ORANGE = '#f36f14';
const HOT = '#ff5a00';
const YELLOW = '#ffe500';
const INK = '#111111';
const W = 1100, H = 1425; // Letter, 8.5 × 11

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "14:05" → { label: '2:05 PM', h: 14, m: 5 }
export function formatSignTime(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(n => parseInt(n, 10) || 0);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { label: `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, h, m };
}

// "2026-09-25" → "FRIDAY, SEPTEMBER 25"
export function formatSignDate(ymd) {
  const [y, mo, d] = String(ymd || '').split('-').map(n => parseInt(n, 10));
  if (!y || !mo || !d) return '';
  return new Date(y, mo - 1, d)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();
}

function polar(cx, cy, r, deg) {
  const t = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(t), cy - r * Math.cos(t)];
}

function dial(h, m) {
  const cx = 550, cy = 778;
  let out = '';
  // Rings over the top half only, like a gauge.
  out += `<path d="M ${cx - 280} ${cy} A 280 280 0 0 1 ${cx + 280} ${cy}" fill="none" stroke="${HOT}" stroke-width="16"/>`;
  out += `<path d="M ${cx - 252} ${cy} A 252 252 0 0 1 ${cx + 252} ${cy}" fill="none" stroke="${YELLOW}" stroke-width="34"/>`;
  // Minute ticks on the upper half; hour marks in white, the rest warm colors.
  for (let i = 0; i < 60; i++) {
    const deg = i * 6;
    if (Math.cos((deg * Math.PI) / 180) < -0.01) continue;
    const major = i % 5 === 0;
    const [x1, y1] = polar(cx, cy, 214, deg);
    const [x2, y2] = polar(cx, cy, major ? 160 : 188, deg);
    const color = major ? '#ffffff' : (i % 2 ? '#ffb020' : HOT);
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${major ? 17 : 7}" stroke-linecap="round"/>`;
  }
  const [mx, my] = polar(cx, cy, 165, m * 6);
  const [hx, hy] = polar(cx, cy, 178, ((h % 12) + m / 60) * 30);
  out += `<line x1="${cx}" y1="${cy}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#ffffff" stroke-width="20" stroke-linecap="round"/>`;
  out += `<line x1="${cx}" y1="${cy}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${HOT}" stroke-width="24" stroke-linecap="round"/>`;
  out += `<circle cx="${cx}" cy="${cy}" r="26" fill="${HOT}" stroke="#ffffff" stroke-width="9"/>`;
  return out;
}

// Speed streaks on the black band, pointing in at the dial.
function streaks() {
  let out = '';
  const rows = [505, 540, 575, 610, 645];
  rows.forEach((y, i) => {
    const len = [200, 250, 170, 230, 150][i];
    const c = i % 2 ? YELLOW : HOT;
    out += `<polygon points="0,${y} ${len},${y + 5} 0,${y + 12}" fill="${c}"/>`;
    out += `<polygon points="${W},${y} ${W - len},${y + 5} ${W},${y + 12}" fill="${c}"/>`;
  });
  return out;
}

// Burst wedges in the top corners, behind the heading.
function bursts() {
  const L = [
    [[20, 70], [190, 165], [60, 130], INK],
    [[30, 160], [185, 205], [40, 205], YELLOW],
    [[80, 20], [205, 140], [130, 40], YELLOW],
    [[20, 250], [180, 250], [30, 290], INK],
  ];
  let out = '';
  for (const [a, b, c, fill] of L) {
    out += `<polygon points="${a} ${b} ${c}" fill="${fill}"/>`;
    const m = p => `${W - p[0]},${p[1]}`;
    out += `<polygon points="${m(a)} ${m(b)} ${m(c)}" fill="${fill}"/>`;
  }
  return out;
}

// A row of hazard stripes at both ends with a bar between them.
function hazard(y) {
  let out = `<rect x="300" y="${y + 14}" width="500" height="14" rx="3" fill="${HOT}"/>`;
  for (let k = 0; k < 4; k++) {
    const fill = k % 2 ? HOT : YELLOW;
    const x = 40 + k * 58;
    out += `<polygon points="${x},${y + 42} ${x + 26},${y} ${x + 56},${y} ${x + 30},${y + 42}" fill="${fill}"/>`;
    const rx = W - 40 - k * 58;
    out += `<polygon points="${rx},${y + 42} ${rx - 26},${y} ${rx - 56},${y} ${rx - 30},${y + 42}" fill="${fill}"/>`;
  }
  return out;
}

function signSvg(timeLabel, h, m, dateLabel) {
  const font = `font-family="Anton, Impact, 'Arial Narrow', sans-serif"`;
  return `
<svg class="sign" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${ORANGE}"/>
  ${bursts()}
  <g transform="translate(550 255) skewX(-8)">
    <g data-fit="930"><text ${font} font-size="235" text-anchor="middle" fill="#ffffff" stroke="${INK}" stroke-width="24" stroke-linejoin="round" paint-order="stroke">ESTIMATED</text></g>
  </g>
  <g transform="translate(550 440)">
    <g data-fit="1010"><text ${font} font-size="178" text-anchor="middle" fill="${YELLOW}" stroke="${INK}" stroke-width="22" stroke-linejoin="round" paint-order="stroke">COMPLETION TIME</text></g>
  </g>

  <rect x="0" y="480" width="${W}" height="690" fill="${INK}"/>
  ${streaks()}
  ${dial(h, m)}

  <g transform="translate(550 1118)">
    <g data-fit="1020">
      <text ${font} font-size="420" text-anchor="middle" fill="none" stroke="#ffffff" stroke-width="60" stroke-linejoin="round">${esc(timeLabel)}</text>
      <text ${font} font-size="420" text-anchor="middle" fill="${YELLOW}" stroke="${INK}" stroke-width="28" stroke-linejoin="round" paint-order="stroke">${esc(timeLabel)}</text>
    </g>
  </g>

  <rect x="0" y="1168" width="${W}" height="26" fill="${ORANGE}"/>
  <rect x="0" y="1194" width="${W}" height="${H - 1194}" fill="${INK}"/>
  ${hazard(1208)}
  <g transform="translate(550 1350) skewX(-8)">
    <g data-fit="980"><text ${font} font-size="112" text-anchor="middle" fill="#ffffff">${esc(dateLabel)}</text></g>
  </g>
  ${hazard(1370)}
</svg>`;
}

export function completionSignHtml({ date, time }) {
  const t = formatSignTime(time);
  const d = formatSignDate(date);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>Estimated Completion ${esc(t.label)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Anton&display=block" rel="stylesheet" />
<style>
  @page { size: letter portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #333; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sign { display: block; width: 8.5in; height: 11in; margin: 16px auto; box-shadow: 0 6px 30px rgba(0,0,0,.5); }
  .toolbar { text-align: center; padding: 14px; font: 600 15px system-ui, sans-serif; }
  .toolbar button { background: ${YELLOW}; color: ${INK}; border: 0; border-radius: 8px; padding: 10px 22px; font: inherit; font-weight: 800; cursor: pointer; }
  @media screen { .sign { width: min(8.5in, 94vw); height: auto; } }
  @media print {
    html, body { background: none; }
    .toolbar { display: none; }
    .sign { margin: 0; box-shadow: none; width: 8.5in; height: 11in; }
  }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨 Print again</button></div>
  ${signSvg(t.label, t.h, t.m, d)}
  <script>
    function fit() {
      document.querySelectorAll('[data-fit]').forEach(function (g) {
        g.removeAttribute('transform');
        var w = g.getBBox().width, max = +g.getAttribute('data-fit');
        if (w > max) g.setAttribute('transform', 'scale(' + (max / w).toFixed(4) + ')');
      });
    }
    var printed = false;
    function go() { if (printed) return; printed = true; fit(); setTimeout(function () { try { window.print(); } catch (e) {} }, 150); }
    // Wait for the display font so the fit is measured on the real letters.
    (document.fonts && document.fonts.load ? document.fonts.load('100px Anton') : Promise.resolve())
      .then(function () { return document.fonts ? document.fonts.ready : null; })
      .then(go, go);
    setTimeout(go, 3000);
  </script>
</body></html>`;
}

// Load the sign into an off-screen frame; it opens the print dialog itself once
// the font is in. The frame is laid out at full page size (just off-screen, not
// display:none) so the text can be measured, and removed after printing.
const FRAME_ID = 'completion-sign-frame';
export function printCompletionSign({ date, time }) {
  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement('iframe');
  frame.id = FRAME_ID;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:8.5in;height:11in;border:0;';
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  win.document.open();
  win.document.write(completionSignHtml({ date, time }));
  win.document.close();
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanup);
  setTimeout(() => frame.isConnected && frame.remove(), 5 * 60 * 1000);
  return true;
}
