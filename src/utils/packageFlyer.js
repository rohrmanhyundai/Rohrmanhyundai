// Customer-facing package flyer — a clean, modern one-pager an advisor can print
// from the View Menu to show a customer and help sell a service package.
//
// It opens a self-contained HTML document in a new window and triggers the print
// dialog. Every service gets an auto-matched line illustration (no photos needed)
// and its menu description; a discounted package shows the regular price struck
// through next to the customer's price with an eye-catching "You Save" badge.

const NAVY = '#0b2540';
const TEAL = '#00a5c9';

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const money = (n) => `$${round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Built-in service illustrations ────────────────────────────────────────────
// Simple, consistent duotone line art (navy lines + teal accent). Each returns an
// SVG string sized to fit a 64px chip.
function svg(inner) {
  return `<svg viewBox="0 0 48 48" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}
const ICONS = {
  oil: svg(`<path d="M24 7c6.5 8.6 10.5 12.9 10.5 19.2a10.5 10.5 0 1 1-21 0C13.5 19.9 17.5 15.6 24 7z" fill="${TEAL}" stroke="${NAVY}" stroke-width="2"/><path d="M19.5 27.5a4.5 4.5 0 0 0 4.5 4.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`),
  tire: svg(`<circle cx="24" cy="24" r="17" fill="${NAVY}"/><circle cx="24" cy="24" r="7.5" fill="${TEAL}"/><circle cx="24" cy="24" r="2.5" fill="#fff"/><g stroke="#fff" stroke-width="2" stroke-linecap="round"><line x1="24" y1="9" x2="24" y2="14"/><line x1="24" y1="34" x2="24" y2="39"/><line x1="9" y1="24" x2="14" y2="24"/><line x1="34" y1="24" x2="39" y2="24"/></g>`),
  brake: svg(`<circle cx="21" cy="24" r="14" fill="none" stroke="${NAVY}" stroke-width="2.6"/><circle cx="21" cy="24" r="5.5" fill="${TEAL}"/><g stroke="${NAVY}" stroke-width="1.8" stroke-linecap="round"><line x1="21" y1="12" x2="21" y2="15"/><line x1="21" y1="33" x2="21" y2="36"/><line x1="9" y1="24" x2="12" y2="24"/></g><path d="M33 15v18a3 3 0 0 1-3 3h-2V12h2a3 3 0 0 1 3 3z" fill="${TEAL}" stroke="${NAVY}" stroke-width="2"/>`),
  gear: svg(`<path d="M24 5l2.4 4.3 4.9-.9 1 4.9 4.9 1.1-.9 4.8L40 24l-3.7 3.7.9 4.8-4.9 1.1-1 4.9-4.9-.9L24 43l-2.4-4.3-4.9.9-1-4.9-4.9-1.1.9-4.8L8 24l3.7-3.7-.9-4.8 4.9-1.1 1-4.9 4.9.9z" fill="${TEAL}" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="24" cy="24" r="6" fill="#fff" stroke="${NAVY}" stroke-width="2"/>`),
  coolant: svg(`<path d="M24 8a4 4 0 0 1 4 4v14.3a8 8 0 1 1-8 0V12a4 4 0 0 1 4-4z" fill="#fff" stroke="${NAVY}" stroke-width="2.4"/><circle cx="24" cy="33" r="5.5" fill="${TEAL}"/><rect x="22.6" y="15" width="2.8" height="15" rx="1.4" fill="${TEAL}"/>`),
  fuel: svg(`<rect x="11" y="9" width="17" height="31" rx="3" fill="${TEAL}" stroke="${NAVY}" stroke-width="2"/><rect x="15" y="13" width="9" height="7" rx="1.5" fill="#fff"/><path d="M28 17l5 4.5V33a3 3 0 0 0 6 0V21l-5-5" fill="none" stroke="${NAVY}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><line x1="11" y1="40" x2="28" y2="40" stroke="${NAVY}" stroke-width="2.4" stroke-linecap="round"/>`),
  filter: svg(`<rect x="8" y="14" width="32" height="20" rx="3.5" fill="${TEAL}" stroke="${NAVY}" stroke-width="2"/><g stroke="#fff" stroke-width="2.2" stroke-linecap="round"><line x1="14" y1="14" x2="14" y2="34"/><line x1="20" y1="14" x2="20" y2="34"/><line x1="26" y1="14" x2="26" y2="34"/><line x1="32" y1="14" x2="32" y2="34"/></g>`),
  wiper: svg(`<path d="M7 32c7-13 27-13 34 0" fill="none" stroke="${NAVY}" stroke-width="2.6" stroke-linecap="round"/><line x1="24" y1="34" x2="15" y2="17" stroke="${TEAL}" stroke-width="3.4" stroke-linecap="round"/><line x1="12.5" y1="20" x2="19" y2="16" stroke="${NAVY}" stroke-width="2.4" stroke-linecap="round"/><circle cx="24" cy="34" r="2.4" fill="${NAVY}"/>`),
  battery: svg(`<rect x="7" y="16" width="34" height="21" rx="3" fill="${TEAL}" stroke="${NAVY}" stroke-width="2"/><rect x="13" y="11" width="7" height="5" rx="1.5" fill="${NAVY}"/><rect x="28" y="11" width="7" height="5" rx="1.5" fill="${NAVY}"/><g stroke="#fff" stroke-width="2.4" stroke-linecap="round"><line x1="16" y1="26.5" x2="22" y2="26.5"/><line x1="19" y1="23.5" x2="19" y2="29.5"/><line x1="27" y1="26.5" x2="33" y2="26.5"/></g>`),
  spark: svg(`<rect x="20" y="6" width="8" height="13" rx="1.5" fill="${TEAL}" stroke="${NAVY}" stroke-width="2"/><g stroke="${NAVY}" stroke-width="2" stroke-linecap="round"><line x1="19" y1="21" x2="29" y2="21"/><line x1="20" y1="24" x2="28" y2="24"/><line x1="20" y1="27" x2="28" y2="27"/></g><path d="M24 30v6l-3 3" fill="none" stroke="${NAVY}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  align: svg(`<circle cx="24" cy="24" r="15" fill="none" stroke="${NAVY}" stroke-width="2.6"/><circle cx="24" cy="24" r="5" fill="${TEAL}"/><g stroke="${NAVY}" stroke-width="2.4" stroke-linecap="round"><line x1="24" y1="9" x2="24" y2="19"/><line x1="12" y1="31" x2="20" y2="27"/><line x1="36" y1="31" x2="28" y2="27"/></g>`),
  inspect: svg(`<rect x="12" y="8" width="24" height="32" rx="3" fill="#fff" stroke="${NAVY}" stroke-width="2.4"/><rect x="18" y="5" width="12" height="6" rx="2" fill="${TEAL}" stroke="${NAVY}" stroke-width="1.6"/><path d="M17 23l4 4 8-9" stroke="${TEAL}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><line x1="18" y1="32" x2="30" y2="32" stroke="${NAVY}" stroke-width="2" stroke-linecap="round"/>`),
  wrench: svg(`<path d="M32 10a7.5 7.5 0 0 0-9.4 9.4L9 33l6 6 13.6-13.6A7.5 7.5 0 0 0 38 16l-5 5-4-1-1-4z" fill="${TEAL}" stroke="${NAVY}" stroke-width="2" stroke-linejoin="round"/>`),
};

// Map a service name to the best-fitting illustration.
export function iconForService(name) {
  const n = String(name || '').toLowerCase();
  const has = (...w) => w.some(x => n.includes(x));
  if (has('cabin', 'air filter', 'intake', 'filter')) return ICONS.filter;
  if (has('oil')) return ICONS.oil;
  if (has('brake')) return ICONS.brake;
  if (has('rotat', 'tire', 'wheel', 'balance')) return has('align') ? ICONS.align : ICONS.tire;
  if (has('align')) return ICONS.align;
  if (has('coolant', 'antifreeze', 'radiator')) return ICONS.coolant;
  if (has('fuel', 'injection', 'induction', 'gas')) return ICONS.fuel;
  if (has('transmission', 'trans', 'gear', 'differential', 'diff')) return ICONS.gear;
  if (has('wiper', 'blade')) return ICONS.wiper;
  if (has('battery')) return ICONS.battery;
  if (has('spark', 'plug', 'tune', 'ignition')) return ICONS.spark;
  if (has('inspect', 'multi', 'point', 'check')) return ICONS.inspect;
  if (has('flush', 'fluid', 'service')) return ICONS.oil;
  return ICONS.wrench;
}

// ── Flyer document ────────────────────────────────────────────────────────────
function flyerHtml({ pkg, lines, pricing, dealer }) {
  const { hasDiscount, before, after, savings, taxRate } = pricing;
  const taxNote = taxRate > 0
    ? `Price includes ${round2(taxRate)}% tax.`
    : 'Plus applicable taxes &amp; fees.';
  const savePctRaw = hasDiscount && before > 0 ? Math.round((savings / before) * 100) : 0;

  const cards = lines.map(l => `
      <div class="svc">
        <div class="chip">${iconForService(l.name)}</div>
        <div class="svc-body">
          <div class="svc-name">${esc(l.name)}</div>
          ${l.desc ? `<div class="svc-desc">${esc(l.desc)}</div>` : ''}
        </div>
      </div>`).join('');

  const priceBlock = hasDiscount ? `
      <div class="price-tags">
        <div class="reg"><span>Regular price</span><s>${money(before)}</s></div>
        <div class="your"><span>Your price today</span><b>${money(after)}</b></div>
      </div>
      <div class="save">You save ${money(savings)}${savePctRaw >= 5 ? ` &middot; ${savePctRaw}% off` : ''}</div>
  ` : `
      <div class="price-tags">
        <div class="your solo"><span>Package price</span><b>${money(after)}</b></div>
      </div>
  `;

  const when = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(pkg.name || 'Service Package')} — ${esc(dealer)}</title>
<style>
  * { box-sizing: border-box; }
  :root { --navy:${NAVY}; --teal:${TEAL}; }
  html, body { margin: 0; padding: 0; background: #eef2f6; color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 10px; justify-content: center;
    padding: 12px; background: rgba(15,23,42,.9); backdrop-filter: blur(4px); }
  .toolbar button { font: inherit; font-weight: 800; border: none; border-radius: 10px; padding: 10px 20px; cursor: pointer; }
  .toolbar .print { background: var(--teal); color: #012; }
  .toolbar .close { background: rgba(255,255,255,.14); color: #fff; }
  .sheet { max-width: 8.5in; margin: 18px auto; background: #fff; border-radius: 16px; overflow: hidden;
    box-shadow: 0 24px 60px -30px rgba(0,0,0,.5); }

  .hero { position: relative; padding: 30px 44px 26px; color: #fff; overflow: hidden;
    background: radial-gradient(120% 140% at 100% 0%, #12507a 0%, var(--navy) 55%); }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 900; letter-spacing: .14em;
    text-transform: uppercase; font-size: 13px; }
  .brand .mark { width: 30px; height: 30px; border-radius: 50%; background: var(--teal);
    display: grid; place-items: center; color: var(--navy); font-size: 17px; }
  .brand .sub { color: #9fd7e8; letter-spacing: .18em; font-size: 10px; margin-top: 1px; }
  .hero h1 { margin: 20px 0 6px; font-size: 34px; line-height: 1.08; letter-spacing: -.01em; font-weight: 900; max-width: 80%; }
  .hero p { margin: 0; color: #cfe6f0; font-size: 15px; line-height: 1.5; max-width: 78%; }
  .offer { position: absolute; top: 22px; right: -46px; transform: rotate(45deg);
    background: linear-gradient(90deg,#f43f5e,#e11d48); color: #fff; font-weight: 900; letter-spacing: .12em;
    font-size: 11px; padding: 7px 60px; box-shadow: 0 6px 16px -6px rgba(0,0,0,.6); }

  .services { padding: 26px 40px 6px; }
  .services h2 { margin: 0 0 14px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--teal); font-weight: 900; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
  .svc { display: flex; gap: 13px; align-items: flex-start; padding: 12px 14px; border: 1px solid #e2e8f0;
    border-radius: 13px; background: #fbfdfe; break-inside: avoid; }
  .chip { flex: 0 0 auto; width: 58px; height: 58px; border-radius: 14px; display: grid; place-items: center;
    background: linear-gradient(160deg,#e8f7fb,#d3edf5); border: 1px solid #cbe7f0; }
  .svc-body { min-width: 0; padding-top: 2px; }
  .svc-name { font-weight: 800; font-size: 15px; color: #0f172a; line-height: 1.2; }
  .svc-desc { margin-top: 4px; font-size: 12.5px; color: #55657a; line-height: 1.42; }

  .footerwrap { padding: 12px 40px 34px; }
  .price { display: flex; align-items: center; gap: 24px; padding: 22px 26px; border-radius: 16px;
    background: linear-gradient(120deg, #f1f8fb, #e7f3f8); border: 1px solid #cfe6ef; }
  .price .left { flex: 1; min-width: 0; }
  .price .left .k { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--teal); font-weight: 900; }
  .price .left .v { font-size: 18px; font-weight: 800; color: var(--navy); margin-top: 3px; }
  .price .left .tax { font-size: 11.5px; color: #64748b; margin-top: 8px; }
  .price .right { text-align: right; flex: 0 0 auto; }
  .price-tags { display: grid; gap: 2px; }
  .reg { color: #8a97a7; font-size: 13px; font-weight: 700; }
  .reg span { margin-right: 8px; }
  .reg s { font-size: 17px; }
  .your { color: var(--navy); }
  .your span { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #64748b; font-weight: 800; }
  .your b { font-size: 40px; font-weight: 900; letter-spacing: -.02em; line-height: 1; color: var(--navy); }
  .your.solo b { color: var(--navy); }
  .save { margin-top: 12px; display: inline-block; float: right; clear: both;
    background: linear-gradient(90deg,#059669,#10b981); color: #fff; font-weight: 900; font-size: 15px;
    letter-spacing: .01em; padding: 9px 18px; border-radius: 999px; box-shadow: 0 8px 18px -8px rgba(16,185,129,.9); }

  .cta { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 18px;
    padding-top: 16px; border-top: 1px dashed #cbd5e1; }
  .cta .msg { font-size: 13.5px; color: #334155; font-weight: 600; }
  .cta .msg b { color: var(--navy); }
  .cta .meta { text-align: right; font-size: 11px; color: #94a3b8; line-height: 1.5; white-space: nowrap; }
  .cta .op { display: inline-block; font-weight: 900; color: var(--teal); letter-spacing: .05em; }

  @media print {
    .toolbar { display: none; }
    html, body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; border-radius: 0; max-width: none; }
    @page { size: letter portrait; margin: 0.45in; }
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="print" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="close" onclick="window.close()">Close</button>
  </div>
  <div class="sheet">
    <div class="hero">
      ${hasDiscount ? `<div class="offer">SPECIAL OFFER</div>` : ''}
      <div class="brand">
        <span class="mark">🛞</span>
        <span>${esc(dealer)}<span class="sub">Service Center</span></span>
      </div>
      <h1>${esc(pkg.name || 'Service Package')}</h1>
      ${pkg.desc ? `<p>${esc(pkg.desc)}</p>` : ''}
    </div>

    <div class="services">
      <h2>What's included</h2>
      <div class="grid">${cards}</div>
    </div>

    <div class="footerwrap">
      <div class="price">
        <div class="left">
          <div class="k">Complete package</div>
          <div class="v">${lines.length} service${lines.length === 1 ? '' : 's'} bundled together</div>
          <div class="tax">${taxNote}</div>
        </div>
        <div class="right">
          ${priceBlock}
        </div>
      </div>
      <div class="cta">
        <div class="msg">Ready to book? <b>See your service advisor to schedule today.</b></div>
        <div class="meta">
          ${pkg.opCode ? `Op code <span class="op">${esc(pkg.opCode)}</span><br/>` : ''}
          ${esc(when)}
        </div>
      </div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 400); });
  </script>
</body>
</html>`;
}

// Open the flyer in a new window and prompt to print.
//   pkg      – the package object
//   lines    – [{ name, desc }] one per included service
//   pricing  – { hasDiscount, before, after, savings, taxRate }
//   dealer   – dealership name
export function openPackageFlyer({ pkg, lines, pricing, dealer = 'Rohrman Hyundai' }) {
  const html = flyerHtml({ pkg, lines: lines || [], pricing, dealer });
  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow pop-ups for this site to print the package flyer.');
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
