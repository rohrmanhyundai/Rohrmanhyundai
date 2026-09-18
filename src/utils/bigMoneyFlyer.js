// Big-Money LOF program flyer — a printable one-pager that outlines the contest.
// Two variants: the advisor sheet (everyone) and the lead-advisor sheet, which
// adds the private bonus layer. Same mechanics as the package flyer: open a
// self-contained HTML document in a new window and trigger the print dialog.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (v) => (Number(v || 0) * 100).toFixed(0) + '%';
const num2 = (v) => Number(v || 0).toFixed(2);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

// ── Illustrations (flat, modern, print-safe) ─────────────────────────────────
const svg = (inner, size = 64) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
const ART = {
  // Oil drop with a $50 tag
  oil: svg(`<defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#0891b2"/></linearGradient></defs>
    <path d="M32 6c9 12 15 18.5 15 27.5A15 15 0 1 1 17 33.5C17 24.5 23 18 32 6z" fill="url(#og)"/>
    <path d="M25 36a7 7 0 0 0 7 7" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/>
    <rect x="34" y="40" width="26" height="16" rx="5" fill="#facc15"/>
    <text x="47" y="52" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="11" fill="#422006">$50</text>`),
  // Rising chart / rate
  chart: svg(`<defs><linearGradient id="cg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs>
    <rect x="8" y="38" width="10" height="18" rx="3" fill="#c4b5fd"/><rect x="22" y="28" width="10" height="28" rx="3" fill="#a78bfa"/><rect x="36" y="18" width="10" height="38" rx="3" fill="#8b5cf6"/>
    <path d="M10 30L27 20 41 12 54 6" stroke="url(#cg)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M46 6h8v8" stroke="#ec4899" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`),
  // Trophy
  trophy: svg(`<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>
    <path d="M18 8h28v14a14 14 0 0 1-28 0V8z" fill="url(#tg)"/>
    <path d="M18 12H9a2 2 0 0 0-2 2c0 8 5 13 11 14M46 12h9a2 2 0 0 1 2 2c0 8-5 13-11 14" stroke="#f59e0b" stroke-width="3.5" stroke-linecap="round"/>
    <rect x="28" y="34" width="8" height="10" fill="#d97706"/><rect x="18" y="44" width="28" height="7" rx="2" fill="#b45309"/><rect x="14" y="51" width="36" height="6" rx="2" fill="#78350f"/>
    <path d="M32 14l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" fill="#fff" opacity=".9"/>`),
  // Team / handshake
  team: svg(`<circle cx="20" cy="18" r="8" fill="#34d399"/><circle cx="44" cy="18" r="8" fill="#22d3ee"/><circle cx="32" cy="14" r="8" fill="#facc15"/>
    <path d="M6 52c0-10 6-17 14-17s14 7 14 17" fill="#34d399" opacity=".85"/><path d="M30 52c0-10 6-17 14-17s14 7 14 17" fill="#22d3ee" opacity=".85"/><path d="M18 48c0-11 6-18 14-18s14 7 14 18" fill="#facc15"/>`),
  // Medal / lead advisor
  medal: svg(`<path d="M22 4h10l6 18H16z" fill="#a78bfa"/><path d="M32 4h10l6 18H32z" fill="#7c3aed"/>
    <circle cx="32" cy="40" r="17" fill="#fbbf24" stroke="#f59e0b" stroke-width="4"/>
    <path d="M32 29l3.4 7 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6-5.5-5.4 7.6-1.1z" fill="#fff"/>`),
  // Cash
  cash: svg(`<rect x="6" y="18" width="52" height="30" rx="5" fill="#16a34a"/><rect x="11" y="23" width="42" height="20" rx="3" fill="none" stroke="#bbf7d0" stroke-width="2"/>
    <circle cx="32" cy="33" r="7.5" fill="#bbf7d0"/><text x="32" y="37" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="11" fill="#14532d">$</text>
    <rect x="10" y="12" width="44" height="6" rx="3" fill="#15803d" opacity=".7"/>`),
};

function flyerHtml({ variant, contest, goals, prizes, lead, dealer, logoUrl }) {
  const isLead = variant === 'lead';
  const hasDates = !!(contest && contest.start && contest.end);
  const when = hasDates ? `${fmtDate(contest.start)} – ${fmtDate(contest.end)}` : 'Dates announced by your manager';
  const gHrs = goals.hrs_ro > 0 ? num2(goals.hrs_ro) : 'TBD';
  const gRate = goals.add_rate > 0 ? pct(goals.add_rate) : 'TBD';
  const total = prizes.full + lead.bonus;
  const title = isLead ? 'Lead Advisor Program' : 'Advisor Program';

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Big-Money LOF — ${esc(title)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; background: #0f172a; font-family: Inter, -apple-system, "Segoe UI", Arial, sans-serif; color: #0f172a; }
  .toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; justify-content: center; padding: 12px; background: rgba(15,23,42,.92); border-bottom: 1px solid rgba(255,255,255,.1); }
  .toolbar button { font: inherit; font-weight: 800; font-size: 14px; padding: 10px 18px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
  .toolbar .print { background: linear-gradient(180deg,#facc15,#f59e0b); color: #422006; }
  .toolbar .close { background: rgba(255,255,255,.08); color: #e2e8f0; border-color: rgba(255,255,255,.2); }
  .sheet { width: 8in; height: 10.5in; margin: 18px auto 30px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.5); display: flex; flex-direction: column; }

  .hero { position: relative; padding: 22px 30px 20px; color: #fff; overflow: hidden;
    background: linear-gradient(118deg, #052e16 0%, #065f46 26%, #0e7490 52%, #4c1d95 78%, #831843 100%); }
  .hero .glow { position: absolute; border-radius: 50%; filter: blur(30px); opacity: .55; }
  .hero .g1 { width: 260px; height: 260px; background: #facc15; right: -70px; top: -110px; }
  .hero .g2 { width: 220px; height: 220px; background: #22d3ee; left: -80px; bottom: -120px; }
  .hero .top { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #fde68a; }
  .brand img { height: 26px; width: auto; background: #fff; border-radius: 6px; padding: 3px 8px; }
  .tag { font-size: 11px; font-weight: 900; letter-spacing: .18em; text-transform: uppercase; color: #fde68a; background: rgba(0,0,0,.28); padding: 6px 12px; border-radius: 999px; }
  .hero .row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 14px; }
  .hero h1 { margin: 0; font-size: 42px; line-height: 1; font-weight: 1000; letter-spacing: -1px; text-shadow: 0 6px 20px rgba(0,0,0,.4); }
  .hero h1 span { color: #facc15; }
  .hero .sub { margin-top: 7px; font-size: 13.5px; line-height: 1.5; color: rgba(255,255,255,.9); max-width: 380px; }
  .hero .when { display: inline-block; margin-top: 12px; font-size: 12.5px; font-weight: 800; background: rgba(0,0,0,.3); padding: 7px 13px; border-radius: 999px; }
  .prize { text-align: center; padding: 12px 22px; border-radius: 18px; background: rgba(0,0,0,.34); border: 1.5px solid rgba(250,204,21,.6); min-width: 210px; }
  .prize .k { font-size: 11px; font-weight: 900; letter-spacing: .2em; text-transform: uppercase; color: #fde68a; }
  .prize .v { font-size: 50px; font-weight: 1000; line-height: 1; color: #facc15; text-shadow: 0 4px 16px rgba(250,204,21,.35); margin-top: 2px; }
  .prize .c { font-size: 12px; font-weight: 900; color: #fef3c7; margin-top: 4px; letter-spacing: .1em; }
  .prize .alt { margin-top: 8px; font-size: 11px; color: #fde68a; background: rgba(0,0,0,.35); border-radius: 999px; padding: 4px 10px; display: inline-block; }

  .body { padding: 16px 30px 12px; flex: 1; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  h2 { margin: 0 0 8px; font-size: 13px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; color: #64748b; }
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .step { border-radius: 14px; padding: 12px 12px 10px; background: #f8fafc; border: 1px solid #e2e8f0; position: relative; }
  .step .n { position: absolute; top: 10px; right: 12px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 900; font-size: 13px; color: #fff; }
  .step svg { display: block; margin-bottom: 6px; width: 54px; height: 54px; }
  .step .t { font-size: 14.5px; font-weight: 900; color: #0f172a; line-height: 1.2; }
  .step .d { font-size: 11.5px; color: #475569; line-height: 1.45; margin-top: 5px; }
  .step .goal { display: inline-block; margin-top: 8px; font-size: 12px; font-weight: 900; padding: 4px 10px; border-radius: 999px; }
  .s1 { border-top: 4px solid #06b6d4; } .s1 .n { background: #06b6d4; } .s1 .goal { background: #cffafe; color: #155e75; }
  .s2 { border-top: 4px solid #8b5cf6; } .s2 .n { background: #8b5cf6; } .s2 .goal { background: #ede9fe; color: #5b21b6; }
  .s3 { border-top: 4px solid #f59e0b; } .s3 .n { background: #f59e0b; } .s3 .goal { background: #fef3c7; color: #92400e; }

  .team { display: grid; grid-template-columns: 64px 1fr auto; gap: 14px; align-items: center; border-radius: 14px; padding: 11px 16px;
    background: linear-gradient(135deg, #ecfdf5, #f0fdfa); border: 1px solid #a7f3d0; }
  .team .t { font-size: 15px; font-weight: 900; color: #064e3b; }
  .team .d { font-size: 12px; color: #065f46; line-height: 1.5; margin-top: 4px; }
  .pay { display: flex; gap: 8px; }
  .pay div { text-align: center; border-radius: 12px; padding: 8px 12px; min-width: 96px; }
  .pay .hit { background: #16a34a; color: #fff; } .pay .miss { background: #fff; color: #92400e; border: 1.5px solid #fbbf24; }
  .pay .k { font-size: 10px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; opacity: .9; }
  .pay .v { font-size: 22px; font-weight: 1000; line-height: 1.1; margin-top: 2px; }

  .lead { border-radius: 14px; padding: 12px 16px; background: linear-gradient(135deg, #1e1b4b, #4c1d95 60%, #701a75); color: #fff; display: grid; grid-template-columns: 72px 1fr; gap: 16px; align-items: center; }
  .lead .t { font-size: 16px; font-weight: 1000; }
  .lead .t span { color: #fde047; }
  .lead .d { font-size: 12px; color: #e9d5ff; line-height: 1.55; margin-top: 4px; }
  .lead .d b { color: #fff; }
  .matrix { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 4px; }
  .matrix div { border-radius: 10px; padding: 7px 9px; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.14); }
  .matrix .k { font-size: 10px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; color: #c4b5fd; }
  .matrix .v { font-size: 18px; font-weight: 1000; color: #fde047; margin-top: 2px; }
  .matrix .v.zero { color: #cbd5e1; }
  .matrix .best { background: rgba(250,204,21,.18); border-color: rgba(250,204,21,.6); }

  .fine { font-size: 11px; color: #475569; line-height: 1.5; border-top: 1px dashed #cbd5e1; padding-top: 10px; margin-top: auto; }
  .fine b { color: #0f172a; }
  .foot { display: flex; align-items: center; justify-content: space-between; padding: 10px 30px; background: #0f172a; color: #cbd5e1; font-size: 11px; }
  .foot b { color: #facc15; }

  @media print {
    .toolbar { display: none; }
    html, body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; border-radius: 0; width: 8in; height: 10.5in; }
    @page { size: letter portrait; margin: 0.25in; }
  }
</style></head>
<body>
  <div class="toolbar">
    <button class="print" onclick="window.print()">🖨 Print / Save as PDF</button>
    <button class="close" onclick="window.close()">Close</button>
  </div>
  <div class="sheet">
    <div class="hero">
      <div class="glow g1"></div><div class="glow g2"></div>
      <div class="top">
        <div class="brand">${logoUrl ? `<img src="${esc(logoUrl)}" alt=""/>` : ''}<span>${esc(dealer)} · Service</span></div>
        <div class="tag">${isLead ? '🎖️ Lead Advisor Edition' : 'Advisor Contest'}</div>
      </div>
      <div class="row">
        <div>
          <h1>Big-Money <span>LOF</span></h1>
          <div class="sub">Sell the $50 add-on on every oil change. Hit both goals, top the board, and take home the cash — and lift the whole store while you do it.</div>
          <div class="when">📅 ${esc(when)}</div>
        </div>
        <div class="prize">
          <div class="k">Grand Prize</div>
          <div class="v">${money(prizes.full)}</div>
          <div class="c">💵 CASH 💵</div>
          <div class="alt">${money(prizes.reduced)} if the store misses goal</div>
        </div>
      </div>
    </div>

    <div class="body">
      <div>
        <h2>How it works</h2>
        <div class="steps">
          <div class="step s1"><div class="n">1</div>${ART.oil}
            <div class="t">Hit both $50 goals</div>
            <div class="d">You must be at or over goal on <b>$50 Add'l Hrs/RO</b> <i>and</i> <b>$50 Add Rate %</b> to qualify. One without the other doesn't count.</div>
            <span class="goal">Hrs/RO ≥ ${esc(gHrs)} · Add Rate ≥ ${esc(gRate)}</span>
          </div>
          <div class="step s2"><div class="n">2</div>${ART.trophy}
            <div class="t">Highest Hrs/RO wins</div>
            <div class="d">Among everyone who qualifies, the <b>highest $50 Add'l Hrs/RO</b> on the contest's last day takes the prize. Tie? The higher Add Rate % wins it.</div>
            <span class="goal">Judged on the final day</span>
          </div>
          <div class="step s3"><div class="n">3</div>${ART.team}
            <div class="t">Win as a team</div>
            <div class="d">The <b>store average</b> has to clear both goals too. Every advisor's numbers count — help each other sell the add-on.</div>
            <span class="goal">Full prize needs the store on goal</span>
          </div>
        </div>
      </div>

      <div class="team">
        ${ART.cash}
        <div>
          <div class="t">🤝 Team effort decides the payout</div>
          <div class="d">The winner earns the <b>full ${money(prizes.full)}</b> only if the store average is at or over goal on <b>both</b> numbers. If the store falls short on either one, the winner still gets <b>${money(prizes.reduced)}</b>.</div>
        </div>
        <div class="pay">
          <div class="hit"><div class="k">Store hits both</div><div class="v">${money(prizes.full)}</div></div>
          <div class="miss"><div class="k">Store misses</div><div class="v">${money(prizes.reduced)}</div></div>
        </div>
      </div>

      ${isLead ? `
      <div class="lead">
        ${ART.medal}
        <div>
          <div class="t">🎖️ Lead Advisor Bonus — <span>${esc(lead.name)}</span></div>
          <div class="d">As lead advisor you earn an <b>extra ${money(lead.bonus)}</b> — but <b>only if the store average meets BOTH goals</b> on the contest's last day. It does not matter whether you win the contest. If the store misses either goal, there is <b>no bonus</b>. Win the contest <i>and</i> bring the store in on goal → <b>${money(prizes.full)} + ${money(lead.bonus)} = ${money(total)}</b>.</div>
        </div>
        <div class="matrix">
          <div class="best"><div class="k">Win · store hits</div><div class="v">${money(total)}</div></div>
          <div><div class="k">Win · store misses</div><div class="v">${money(prizes.reduced)}</div></div>
          <div><div class="k">Don't win · store hits</div><div class="v">${money(lead.bonus)}</div></div>
          <div><div class="k">Don't win · store misses</div><div class="v zero">$0</div></div>
        </div>
      </div>` : ''}

      <div class="fine">
        <b>The fine print.</b> Numbers come straight from the Service Operations Dashboard (Edit Dashboard → Advisor Performance) and are judged as of the contest's last day.
        Dip under a goal and you're out of the running until you're back over it. Track where you stand any time on the <b>💵 Big-Money LOF</b> tab of your Appointment Prep Calendar —
        ✅ means you qualify, 🏆 means you're leading.${isLead ? ' The lead advisor bonus is between you and management and is not shown to other advisors.' : ''}
      </div>
    </div>

    <div class="foot">
      <span><b>${esc(dealer)}</b> · Big-Money LOF · ${esc(title)}</span>
      <span>Questions? See your service manager.</span>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 400); });
  </script>
</body></html>`;
}

// Open the program flyer in a new window and prompt to print.
//   variant – 'advisor' | 'lead'
export function openBigMoneyFlyer({ variant = 'advisor', contest, goals, prizes, lead, dealer = 'Rohrman Hyundai' }) {
  const logoUrl = `${window.location.origin}/Rohrmanhyundai/hyundai-logo.png`;
  const html = flyerHtml({ variant, contest: contest || {}, goals: goals || {}, prizes, lead, dealer, logoUrl });
  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups for this site to print the flyer.'); return false; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
