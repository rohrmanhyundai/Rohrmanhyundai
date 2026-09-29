// ── Customer "Vehicle Care Plan" ──────────────────────────────────────────────
// The declined (deferred) work on a customer's car, printed as a clean,
// eye-catching one-pager an advisor can hand across the counter. Opened from
// the 🖨 Print for customer button on any deferred-work box (prep sheet, open
// pool, Shop Appointments).
//
// Every service gets the shop's line illustration (utils/packageFlyer.js), a
// colour-coded "why" tag, and a plain-English reason written for the customer
// — no op codes or labour hours on the page. Self-contained HTML in a new
// window, then the print dialog, same as the package flyer.

import { iconForService } from './packageFlyer';

const NAVY = '#0b2540';
const TEAL = '#00a5c9';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ALL-CAPS report text → "Replace Serpentine Belt".
const niceCase = (t) => {
  const s = String(t || '');
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())
    .replace(/\b(Ac|Pcv|Oem|V6|V8|Awd|Cvt|Tpms)\b/gi, w => w.toUpperCase());
};

// Why-it-matters tags. Colour + label on every card.
const TAGS = {
  safety:      { label: 'Safety',      color: '#dc2626', bg: '#fee2e2' },
  reliability: { label: 'Reliability', color: '#d97706', bg: '#fef3c7' },
  performance: { label: 'Performance', color: '#7c3aed', bg: '#ede9fe' },
  longevity:   { label: 'Engine & Drivetrain Life', color: '#0369a1', bg: '#e0f2fe' },
  comfort:     { label: 'Comfort',     color: '#0d9488', bg: '#ccfbf1' },
  efficiency:  { label: 'Fuel Economy', color: '#16a34a', bg: '#dcfce7' },
};

// Plain-English explanations, matched on the service name (first match wins).
// Written for the customer: what it does, and what waiting costs them.
const KNOWLEDGE = [
  { m: /brake fluid|bfl|brake flush/i, tag: 'safety', title: 'Brake Fluid Exchange',
    why: 'Brake fluid soaks up moisture over time, which lowers its boiling point and quietly corrodes brake parts. Fresh fluid keeps the pedal firm and every stop confident.',
    wait: 'A softer pedal, longer stops and costlier brake repairs later.' },
  { m: /pad|rotor|brake/i, tag: 'safety', title: 'Brake Pads & Rotors',
    why: 'Worn pads and rotors take longer to stop your vehicle and can start damaging other brake parts. New pads and smooth rotors bring back quiet, confident stops.',
    wait: 'Longer stopping distance, grinding, and a bigger bill when rotors are ruined.' },
  { m: /coolant|antifreeze|radiator/i, tag: 'longevity', title: 'Coolant Service',
    why: 'Coolant keeps your engine from overheating in summer and freezing in winter, and protects the cooling system from the inside. Old coolant loses that protection.',
    wait: 'Corrosion, leaks and a risk of overheating.' },
  { m: /transfer case/i, tag: 'longevity', title: 'Transfer Case Service',
    why: 'The transfer case sends power to all four wheels. Fresh fluid keeps its gears lubricated and cool so your AWD keeps working when you need it.',
    wait: 'Worn gears and an expensive AWD repair.' },
  { m: /differential|diff\b/i, tag: 'longevity', title: 'Differential Service',
    why: 'The differential lets your wheels turn at different speeds through every corner. Clean fluid protects its gears from heat and wear.',
    wait: 'Noise, wear and a costly drivetrain repair.' },
  { m: /transmission|trans\b|cvt/i, tag: 'longevity', title: 'Transmission Fluid Exchange',
    why: 'Transmission fluid cools and lubricates the gears. Fresh fluid keeps your shifts smooth and protects one of the most expensive parts of your vehicle.',
    wait: 'Rough shifting and a much larger transmission repair.' },
  { m: /fuel|injection|induction/i, tag: 'efficiency', title: 'Fuel System Cleaning',
    why: 'Carbon builds up in the fuel system over time. Cleaning it helps your engine start easily, run smoothly and get the fuel economy it was built for.',
    wait: 'Rough idle, hesitation and lower MPG.' },
  { m: /cabin/i, tag: 'comfort', title: 'Cabin Air Filter',
    why: 'Filters dust, pollen and odors from the air you and your passengers breathe, and keeps your A/C and heat blowing strong.',
    wait: 'Musty smells, allergens inside the car and weak airflow.' },
  { m: /air filter|engine air|intake/i, tag: 'efficiency', title: 'Engine Air Filter',
    why: 'Your engine breathes through this filter. A clogged one makes the engine work harder, costing power and fuel.',
    wait: 'Less power and lower fuel economy.' },
  { m: /evap|a\/?c\b|ac clean|air condition/i, tag: 'comfort', title: 'A/C Evaporator Cleaning',
    why: 'Removes the bacteria and mold that grow in the A/C system and cause that musty smell, for cleaner, fresher air.',
    wait: 'Lingering odors every time the A/C comes on.' },
  { m: /align/i, tag: 'safety', title: 'Wheel Alignment',
    why: 'Keeps your vehicle tracking straight and your tires wearing evenly — so they last longer and grip the way they should.',
    wait: 'Pulling, uneven tire wear and replacing tires early.' },
  { m: /tire/i, tag: 'safety', title: 'Tires',
    why: 'Your tires are the only thing touching the road. Good tread means shorter stops and better grip in rain and snow.',
    wait: 'Longer stops and less grip in bad weather.' },
  { m: /belt/i, tag: 'reliability', title: 'Serpentine Belt',
    why: 'This belt runs your alternator, A/C and power steering. Belts crack and stretch with age — replacing it before it snaps keeps you on the road.',
    wait: 'A snapped belt can leave you stranded.' },
  { m: /spark|plug|tune/i, tag: 'performance', title: 'Tune-Up / Spark Plugs',
    why: 'Fresh spark plugs deliver a strong, even spark for easy starts, smooth acceleration and better fuel economy.',
    wait: 'Misfires, rough running and wasted fuel.' },
  { m: /oil clean|oil flush|engine flush|efl/i, tag: 'longevity', title: 'Engine Oil Cleaning Service',
    why: 'Dissolves sludge and deposits inside the engine so fresh oil can reach and protect every moving part.',
    wait: 'Sludge buildup and faster engine wear.' },
  { m: /wiper|blade/i, tag: 'safety', title: 'Wiper Blades',
    why: 'Streak-free wipers give you a clear view in rain, sleet and snow.',
    wait: 'Smearing and poor visibility in bad weather.' },
  { m: /battery/i, tag: 'reliability', title: 'Battery',
    why: 'A weak battery is the #1 cause of no-start mornings. Replacing it on your schedule beats a tow truck on theirs.',
    wait: 'A no-start when you least expect it.' },
  { m: /engine/i, tag: 'longevity', title: null,
    why: 'Your technician recommended this to keep your engine healthy and running the way it should.',
    wait: 'Your advisor can walk you through the details.' },
];
const GENERIC = { tag: 'reliability', title: null,
  why: 'Your technician noted this item at your last visit. Your service advisor can walk you through exactly what they found.',
  wait: 'Ask your advisor what to watch for.' };

// A/C work gets its own snowflake — the package-flyer set has no A/C picture.
const ICON_AC = `<svg viewBox="0 0 48 48" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="17" fill="#e8f7fb" stroke="${NAVY}" stroke-width="2"/><g stroke="${TEAL}" stroke-width="3" stroke-linecap="round"><line x1="24" y1="11" x2="24" y2="37"/><line x1="12.7" y1="17.5" x2="35.3" y2="30.5"/><line x1="12.7" y1="30.5" x2="35.3" y2="17.5"/></g><g stroke="${NAVY}" stroke-width="2" stroke-linecap="round"><path d="M20.5 13.5L24 16.5l3.5-3"/><path d="M20.5 34.5L24 31.5l3.5 3"/></g><circle cx="24" cy="24" r="3" fill="${NAVY}"/></svg>`;
const iconFor = (name) => (/evap|a\/?c\b|air condition|ac clean/i.test(name) ? ICON_AC : iconForService(name));

function explain(item) {
  const name = String(item.desc || item.code || '');
  const k = KNOWLEDGE.find(x => x.m.test(name) || x.m.test(item.code || '')) || GENERIC;
  const title = item.desc ? niceCase(item.desc) : (k.title || 'Technician Recommendation');
  return { ...k, title };
}

// Lists uploaded before per-line prices existed: split the RO total by each
// line's hours so the breakdown still adds up (or skip it if there are none).
function withPrices(items, total) {
  if (items.every(i => i.price > 0) || !(Number(total) > 0)) return items;
  const hrs = items.reduce((n, i) => n + (Number(i.h) || 0) * (i.count || 1), 0);
  if (!(hrs > 0)) return items;
  let cents = 0;
  const out = items.map(i => {
    const price = Math.round(((Number(i.h) || 0) * (i.count || 1) / hrs) * total * 100) / 100;
    cents += Math.round(price * 100);
    return { ...i, price, priceEst: true };
  });
  const diff = Math.round(total * 100) - cents;
  if (diff) { const big = out.reduce((a, b) => (b.price > a.price ? b : a)); big.price = Math.round(big.price * 100 + diff) / 100; }
  return out;
}

function carePlanHtml({ customer, vehicle, advisor, deferred, dealer, logoUrl }) {
  const items = withPrices(deferred.items || [], deferred.amount).map(i => ({ ...i, ...explain(i) }));
  const priced = items.some(i => i.price > 0);
  const tagCounts = items.reduce((m, i) => ({ ...m, [i.tag]: (m[i.tag] || 0) + 1 }), {});
  const first = String(customer || '').trim().split(/\s+/)[0] || 'Valued Customer';
  const visit = deferred.date
    ? new Date(deferred.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const cards = items.map(i => {
    const t = TAGS[i.tag] || TAGS.reliability;
    return `
      <div class="svc">
        <div class="svc-top">
          <div class="chip">${iconFor(i.desc || i.title)}</div>
          <div class="svc-head">
            <span class="tag" style="color:${t.color};background:${t.bg};border-color:${t.color}33">${esc(t.label)}</span>
            <div class="svc-name">${esc(i.title)}${i.count > 1 ? ` <span class="x">×${i.count}</span>` : ''}</div>
          </div>
          ${i.price > 0 ? `<div class="price-tag">${money(i.price)}</div>` : ''}
        </div>
        <div class="why">${esc(i.why)}</div>
        <div class="wait"><b>If you wait:</b> ${esc(i.wait)}</div>
        <div class="decide"><span class="box"></span> Yes, let's do it <span class="box"></span> Not today</div>
      </div>`;
  }).join('');

  const summary = Object.entries(tagCounts).map(([k, n]) => {
    const t = TAGS[k] || TAGS.reliability;
    return `<span class="pill" style="color:${t.color};background:${t.bg}"><b>${n}</b> ${esc(t.label)}</span>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vehicle Care Plan — ${esc(customer || '')} — ${esc(dealer)}</title>
<style>
  * { box-sizing: border-box; }
  :root { --navy:${NAVY}; --teal:${TEAL}; }
  html, body { margin: 0; padding: 0; background: #e9eef4; color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; justify-content: center; padding: 12px;
    background: rgba(15,23,42,.92); }
  .toolbar button { font: inherit; font-weight: 800; border: none; border-radius: 10px; padding: 10px 20px; cursor: pointer; }
  .toolbar .print { background: var(--teal); color: #012; }
  .toolbar .close { background: rgba(255,255,255,.14); color: #fff; }
  .sheet { max-width: 8.5in; margin: 18px auto; background: #fff; border-radius: 16px; overflow: hidden;
    box-shadow: 0 24px 60px -30px rgba(0,0,0,.5); }

  .hero { position: relative; padding: 26px 40px 24px; color: #fff; overflow: hidden;
    background: radial-gradient(120% 160% at 100% 0%, #135c86 0%, var(--navy) 52%, #07182b 100%); }
  .hero:after { content: ''; position: absolute; right: -60px; bottom: -80px; width: 280px; height: 280px; border-radius: 50%;
    border: 38px solid rgba(0,165,201,.13); }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand .logo { width: 44px; height: 44px; border-radius: 50%; background: #fff; display: grid; place-items: center; overflow: hidden; }
  .brand .logo img { width: 34px; height: 34px; object-fit: contain; }
  .brand .name { font-weight: 900; font-size: 18px; letter-spacing: .06em; text-transform: uppercase; }
  .brand .sub { color: #9fd7e8; letter-spacing: .22em; font-size: 10px; font-weight: 800; text-transform: uppercase; }
  .kicker { margin-top: 22px; color: #7dd3f0; font-size: 12px; font-weight: 900; letter-spacing: .2em; text-transform: uppercase; }
  .hero h1 { margin: 6px 0 8px; font-size: 32px; line-height: 1.08; font-weight: 900; letter-spacing: -.01em; max-width: 86%; }
  .hero p { margin: 0; color: #cfe6f0; font-size: 14.5px; line-height: 1.5; max-width: 80%; }
  .facts { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .fact { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 999px; padding: 6px 13px; font-size: 12.5px; }
  .fact b { color: #fff; }

  .summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 16px 40px 4px; }
  .summary .lead { font-size: 13px; font-weight: 800; color: #334155; margin-right: 4px; }
  .pill { border-radius: 999px; padding: 4px 11px; font-size: 12px; font-weight: 700; }

  .services { padding: 14px 40px 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
  .svc { padding: 14px 15px 12px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fbfdfe;
    break-inside: avoid; display: flex; flex-direction: column; gap: 8px; }
  .svc-top { display: flex; gap: 12px; align-items: center; }
  .chip { flex: 0 0 auto; width: 60px; height: 60px; border-radius: 16px; display: grid; place-items: center;
    background: linear-gradient(160deg,#e8f7fb,#d3edf5); border: 1px solid #cbe7f0; }
  .chip svg { width: 44px; height: 44px; }
  .tag { display: inline-block; border: 1px solid; border-radius: 999px; padding: 2px 9px; font-size: 10.5px; font-weight: 900;
    letter-spacing: .06em; text-transform: uppercase; }
  .svc-name { margin-top: 5px; font-weight: 900; font-size: 16px; line-height: 1.2; color: #0f172a; }
  .svc-name .x { color: #64748b; font-weight: 700; font-size: 13px; }
  .svc-top { position: relative; }
  .price-tag { margin-left: auto; align-self: flex-start; background: var(--navy); color: #fff; font-weight: 900; font-size: 15px;
    padding: 5px 11px; border-radius: 10px; white-space: nowrap; box-shadow: 0 6px 14px -8px rgba(11,37,64,.8); }
  .breakdown { margin: 16px 40px 0; border: 1px solid #dbe7ef; border-radius: 14px; padding: 14px 18px 12px; background: #fcfeff; }
  .bd-head { display: flex; justify-content: space-between; font-size: 11px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: var(--teal); margin-bottom: 6px; }
  .bd-row { display: flex; align-items: baseline; gap: 8px; padding: 6px 0; font-size: 13.5px; color: #1e293b; }
  .bd-row + .bd-row { border-top: 1px solid #eef2f6; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; transform: translateY(1px); }
  .bd-name { font-weight: 700; }
  .bd-lead { flex: 1; border-bottom: 2px dotted #cbd5e1; transform: translateY(-3px); }
  .bd-amt { font-weight: 900; color: var(--navy); font-variant-numeric: tabular-nums; }
  .bd-total { display: flex; justify-content: space-between; margin-top: 8px; padding-top: 10px; border-top: 2px solid var(--navy);
    font-size: 16px; font-weight: 900; color: var(--navy); }
  .bd-note { margin-top: 6px; font-size: 10.5px; color: #94a3b8; }
  .why { font-size: 12.8px; color: #334155; line-height: 1.5; }
  .wait { font-size: 12px; color: #9a3412; background: #fff7ed; border-left: 3px solid #fb923c; border-radius: 6px; padding: 6px 9px; line-height: 1.4; }
  .wait b { color: #c2410c; }
  .decide { margin-top: auto; padding-top: 6px; border-top: 1px dashed #e2e8f0; font-size: 12px; font-weight: 700; color: #475569;
    display: flex; align-items: center; gap: 6px; }
  .box { display: inline-block; width: 15px; height: 15px; border: 2px solid #94a3b8; border-radius: 4px; margin-left: 8px; }
  .box:first-child { margin-left: 0; }

  .total { margin: 16px 40px 0; display: flex; align-items: center; gap: 22px; padding: 20px 24px; border-radius: 16px;
    background: linear-gradient(120deg,#0b2540,#12507a); color: #fff; }
  .total .left { flex: 1; min-width: 0; }
  .total .k { font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: #7dd3f0; font-weight: 900; }
  .total .v { font-size: 15px; font-weight: 700; margin-top: 4px; color: #e0f2fe; }
  .total .fine { font-size: 11px; color: #9fc3d6; margin-top: 6px; }
  .total .amt { font-size: 40px; font-weight: 900; letter-spacing: -.02em; line-height: 1; }
  .total .amt small { display: block; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #9fd7e8; font-weight: 800; margin-bottom: 4px; text-align: right; }

  .trust { display: flex; justify-content: space-between; gap: 10px; margin: 16px 40px 0; padding: 12px 16px; border-radius: 12px;
    background: #f1f8fb; border: 1px solid #d6ebf3; font-size: 12px; font-weight: 800; color: var(--navy); }
  .trust span { display: flex; align-items: center; gap: 6px; }

  .sign { display: grid; grid-template-columns: 2fr 1fr; gap: 28px; margin: 22px 40px 0; font-size: 11px; color: #64748b; font-weight: 700; }
  .sign div { border-top: 1.5px solid #94a3b8; padding-top: 5px; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding: 16px 40px 28px; margin-top: 8px; }
  .foot .thanks { font-size: 15px; font-weight: 900; color: var(--navy); }
  .foot .thanks span { display: block; font-size: 12px; font-weight: 600; color: #64748b; margin-top: 3px; }
  .foot .meta { text-align: right; font-size: 11px; color: #94a3b8; line-height: 1.55; }

  @media print {
    .toolbar { display: none; }
    html, body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; border-radius: 0; max-width: none; }
    @page { size: letter portrait; margin: 0.35in; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="print" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="close" onclick="window.close()">Close</button>
  </div>
  <div class="sheet">
    <div class="hero">
      <div class="brand">
        <div class="logo">${logoUrl ? `<img src="${esc(logoUrl)}" alt="Hyundai" />` : '🔧'}</div>
        <div><div class="name">${esc(dealer)}</div><div class="sub">Service Center</div></div>
      </div>
      <div class="kicker">Your Vehicle Care Plan</div>
      <h1>${esc(first)}, here's what your ${esc(vehicle || 'vehicle')} needs next</h1>
      <p>At your last visit our factory-trained technicians looked your vehicle over and recommended the service below.
        Taking care of it now keeps you safe on the road, protects your investment and helps avoid bigger repairs later.</p>
      <div class="facts">
        ${vehicle ? `<span class="fact">🚗&nbsp; <b>${esc(vehicle)}</b></span>` : ''}
        ${visit ? `<span class="fact">📅&nbsp; Recommended <b>${esc(visit)}</b></span>` : ''}
        ${advisor ? `<span class="fact">👤&nbsp; Your advisor <b>${esc(niceCase(advisor))}</b></span>` : ''}
      </div>
    </div>

    ${summary ? `<div class="summary"><span class="lead">${items.length} recommended item${items.length === 1 ? '' : 's'}:</span>${summary}</div>` : ''}

    <div class="services"><div class="grid">${cards}</div></div>

    ${priced ? `
    <div class="breakdown">
      <div class="bd-head"><span>Your estimate, line by line</span><span>Price</span></div>
      ${items.map(i => {
        const t = TAGS[i.tag] || TAGS.reliability;
        return `<div class="bd-row"><span class="dot" style="background:${t.color}"></span><span class="bd-name">${esc(i.title)}${i.count > 1 ? ` ×${i.count}` : ''}</span><span class="bd-lead"></span><span class="bd-amt">${i.price > 0 ? money(i.price) : '—'}</span></div>`;
      }).join('')}
      <div class="bd-total"><span>Total estimate</span><span>${money(deferred.amount)}</span></div>
      <div class="bd-note">Parts &amp; labor included · plus applicable taxes &amp; fees · prices from your recommendation and may change</div>
    </div>` : ''}

    ${deferred.amount != null ? `
    <div class="total">
      <div class="left">
        <div class="k">Estimated total</div>
        <div class="v">All ${items.length} recommended service${items.length === 1 ? '' : 's'}, parts &amp; labor</div>
        <div class="fine">Estimate from your ${esc(visit || 'last')} visit. Plus applicable taxes &amp; fees. Ask your advisor about today's specials.</div>
      </div>
      <div class="amt"><small>Estimate</small>${money(deferred.amount)}</div>
    </div>` : ''}

    <div class="trust">
      <span>🛠 Hyundai factory-trained technicians</span>
      <span>✅ Genuine Hyundai parts</span>
      <span>🤝 Done right the first time</span>
    </div>

    <div class="sign"><div>Customer approval</div><div>Date</div></div>

    <div class="foot">
      <div class="thanks">Thank you for choosing ${esc(dealer)}!<span>Questions? Your service advisor is happy to walk you through any of these.</span></div>
      <div class="meta">${deferred.ro ? `Ref. RO ${esc(deferred.ro)}<br/>` : ''}Printed ${esc(today)}</div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 500); });
  </script>
</body>
</html>`;
}

// Open the care plan in a new window and prompt to print.
//   customer, vehicle, advisor – what the header shows
//   deferred – the matched deferred snapshot ({ ro, date, amount, items: [{ code, desc, count }] })
export function openDeferredCarePlan({ customer, vehicle, advisor, deferred, dealer = 'Bob Rohrman Hyundai' }) {
  if (!deferred) return false;
  const base = `${window.location.origin}${(import.meta.env && import.meta.env.BASE_URL) || '/'}`;
  const html = carePlanHtml({ customer, vehicle, advisor, deferred, dealer, logoUrl: `${base}hyundai-logo.png` });
  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups for this site to print the care plan.'); return false; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

export { carePlanHtml };
