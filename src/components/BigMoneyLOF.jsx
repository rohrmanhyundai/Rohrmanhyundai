import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { loadBigMoney, updateBigMoney } from '../utils/github';
import { trackPage, trackAction } from '../utils/activityTracker';
import {
  STATUS, DEFAULT_PRIZE, DEFAULT_REDUCED_PRIZE, DEFAULT_LEAD_ADVISOR, DEFAULT_LEAD_BONUS,
  prizeFor, leadFor, leadPayout, isLeadViewer, contestStatus, standingsFor, computeStandings,
  fmtContestDate, daysLeft, todayKey,
} from '../utils/bigMoney';

// ── Big-Money LOF ─────────────────────────────────────────────────────────────
// Advisor contest run off the dashboard's two $50 add-on numbers. Managers set
// the window (and prize) from the Manager Hub tile; advisors open it from their
// Appointment Prep Calendar to see where they stand. The numbers themselves are
// never entered here — they're whatever Edit Dashboard → Advisor Performance
// holds, so the board moves the moment the manager updates the dashboard.

const firstName = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (v) => (Number(v || 0) * 100).toFixed(1) + '%';
const num2 = (v) => Number(v || 0).toFixed(2);

// Rolling snapshot cadence while live — every viewer refreshes it, so keep the
// shared-token writes sparse. The last snapshot inside the window becomes the
// banked final result the moment the window closes.
const SNAPSHOT_MIN_MS = 30 * 60 * 1000;

const CSS = `
@keyframes bmlGradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes bmlFloat{0%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-14px) rotate(6deg)}100%{transform:translateY(0) rotate(-6deg)}}
@keyframes bmlShine{0%{transform:translateX(-120%) skewX(-18deg)}100%{transform:translateX(220%) skewX(-18deg)}}
@keyframes bmlPulse{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,.45)}50%{box-shadow:0 0 28px 8px rgba(250,204,21,.28)}}
@keyframes bmlRain{0%{transform:translateY(-10%) rotate(0deg);opacity:0}10%{opacity:.9}100%{transform:translateY(110vh) rotate(360deg);opacity:0}}
.bml-hero{position:relative;overflow:hidden;border-radius:22px;padding:34px 36px;
  background:linear-gradient(120deg,#052e16,#065f46,#0e7490,#4c1d95,#831843,#052e16);background-size:400% 400%;
  animation:bmlGradient 16s ease infinite;border:1px solid rgba(250,204,21,.35);box-shadow:0 20px 60px rgba(0,0,0,.45)}
.bml-hero::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent);width:40%;animation:bmlShine 5s ease-in-out infinite}
.bml-money{position:absolute;font-size:34px;opacity:.28;animation:bmlFloat 5s ease-in-out infinite;pointer-events:none;filter:drop-shadow(0 4px 8px rgba(0,0,0,.4))}
.bml-prize{font-size:64px;font-weight:1000;line-height:1;letter-spacing:-1px;
  background:linear-gradient(180deg,#fef9c3,#facc15 45%,#f59e0b 70%,#fde68a);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
  filter:drop-shadow(0 6px 14px rgba(250,204,21,.35))}
.bml-card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));border:1px solid rgba(148,163,184,.2);border-radius:18px;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.bml-row{display:grid;grid-template-columns:56px 1.4fr 1fr 1fr 130px;align-items:center;gap:10px;padding:14px 16px;border-radius:14px;border:1px solid rgba(148,163,184,.14);background:rgba(2,6,23,.45);transition:transform .15s}
.bml-row:hover{transform:translateX(3px)}
.bml-row.me{border-color:rgba(110,231,249,.6);background:linear-gradient(90deg,rgba(110,231,249,.14),rgba(2,6,23,.45) 60%);box-shadow:0 0 0 1px rgba(110,231,249,.25), 0 8px 24px rgba(110,231,249,.12)}
.bml-row.leader{border-color:rgba(250,204,21,.7);background:linear-gradient(90deg,rgba(250,204,21,.16),rgba(2,6,23,.5) 65%);animation:bmlPulse 2.2s ease-in-out infinite}
.bml-stat{font-size:22px;font-weight:900;line-height:1.05}
.bml-stat.hit{color:#4ade80;text-shadow:0 0 14px rgba(74,222,128,.45)}
.bml-stat.miss{color:#fb7185}
.bml-label{font-size:10.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
.bml-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}
.bml-rain{position:absolute;top:0;font-size:22px;animation:bmlRain linear infinite;pointer-events:none}
.bml-input{background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.35);border-radius:10px;padding:9px 12px;font-size:14px;font-weight:700;color:#e2e8f0;outline:none;color-scheme:dark}
@media(max-width:700px){.bml-row{grid-template-columns:44px 1fr 1fr;row-gap:6px}.bml-row .bml-hide{display:none}.bml-prize{font-size:46px}.bml-hero{padding:24px 20px}}
`;

const FLOATERS = [
  { e: '💵', l: '4%',  t: '12%', d: '0s',   s: 38 }, { e: '💰', l: '90%', t: '18%', d: '1.3s', s: 44 },
  { e: '🛢️', l: '14%', t: '70%', d: '2.1s', s: 30 }, { e: '💸', l: '78%', t: '72%', d: '.7s',  s: 34 },
  { e: '🏆', l: '52%', t: '6%',  d: '1.8s', s: 30 }, { e: '🔧', l: '32%', t: '82%', d: '2.6s', s: 26 },
  { e: '💵', l: '66%', t: '86%', d: '3.2s', s: 28 }, { e: '💎', l: '42%', t: '20%', d: '.4s',  s: 24 },
];

function Confetti() {
  // Only the leader's screen rains money — a little celebration, not a nuisance.
  const bits = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    left: `${(i * 37) % 100}%`, dur: `${6 + (i % 5) * 1.4}s`, delay: `${(i % 7) * -1.1}s`, e: ['💵', '💸', '💰', '✨'][i % 4],
  })), []);
  return <>{bits.map((b, i) => <span key={i} className="bml-rain" style={{ left: b.left, animationDuration: b.dur, animationDelay: b.delay }}>{b.e}</span>)}</>;
}

const MEDAL = ['🥇', '🥈', '🥉'];

export default function BigMoneyLOF({ currentUser, currentRole, advisors = [], data = {}, onBack, onContestChange }) {
  const me = firstName(currentUser);
  const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState({ start: '', end: '', prize: DEFAULT_PRIZE, reducedPrize: DEFAULT_REDUCED_PRIZE, leadAdvisor: DEFAULT_LEAD_ADVISOR, leadBonus: DEFAULT_LEAD_BONUS });
  const bankingRef = useRef(false); // one banking write at a time

  useEffect(() => { trackPage('big-money-lof'); }, []);

  const refresh = useCallback(async () => {
    try {
      const f = await loadBigMoney();
      setFile(f);
      const c = f.contest || {};
      setDraft({ start: c.start || '', end: c.end || '', prize: c.prize != null ? c.prize : DEFAULT_PRIZE, reducedPrize: c.reducedPrize != null ? c.reducedPrize : DEFAULT_REDUCED_PRIZE,
                 leadAdvisor: c.leadAdvisor || DEFAULT_LEAD_ADVISOR, leadBonus: c.leadBonus != null ? c.leadBonus : DEFAULT_LEAD_BONUS });
    } catch { setFile({}); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const status = useMemo(() => contestStatus(file || {}), [file]);
  const board  = useMemo(() => standingsFor(file || {}, advisors, data), [file, advisors, data]);
  const live   = useMemo(() => computeStandings(advisors, data), [advisors, data]);
  const prizes = prizeFor(file);
  const left   = daysLeft(file || {});
  // Team goal decides the payout: store average over goal on both → full prize.
  const storeHit = !!(board.store && board.store.hit);
  const payout = storeHit ? prizes.full : prizes.reduced;
  // Lead advisor layer — visible only to the lead advisor themselves and managers.
  const lead = leadFor(file);
  const leadView = isLeadViewer(file, currentUser, isManager);
  const leadPay = leadPayout(file, board);
  const iAmLead = me === lead.name;

  // Keep the shared snapshot current while live, and bank the final result the
  // first time anyone opens the page after the window closes. Whoever views it
  // does the write — advisors included — so the result never depends on a
  // manager remembering to come back.
  useEffect(() => {
    if (!file || loading) return;
    const now = Date.now();
    const sig = (rows) => JSON.stringify((rows || []).map(r => [r.name, r.hrsRo, r.rate, r.qualified]));
    if (status === STATUS.LIVE) {
      const cur = file.latest;
      const stale = !cur || !cur.takenAt || now - cur.takenAt > SNAPSHOT_MIN_MS;
      const changed = !cur || sig(cur.standings) !== sig(live.rows);
      if (stale && changed) {
        const latest = { takenAt: now, date: todayKey(), goals: live.goals, standings: live.rows, store: live.store };
        // Mirror it locally straight away so a dashboard poll doesn't re-trigger this.
        setFile(f => ({ ...f, latest }));
        updateBigMoney(f => ({ ...f, latest })).catch(() => {});
      }
    } else if (status === STATUS.ENDED && !file.final && !bankingRef.current) {
      // Prefer the last snapshot taken inside the window: by now the dashboard
      // may already be showing a new month, so "live" would be the wrong numbers.
      bankingRef.current = true;
      const src = file.latest && Array.isArray(file.latest.standings) ? file.latest : { takenAt: now, goals: live.goals, standings: live.rows, store: live.store };
      updateBigMoney(f => f.final ? f : ({ ...f, final: { ...src, bankedAt: now } }))
        .then(() => refresh()).catch(() => {}).finally(() => { bankingRef.current = false; });
    }
  }, [file, loading, status, live, refresh]);

  async function saveContest() {
    if (!isManager) return;
    if (!draft.start || !draft.end) { alert('Pick both a start and an end date.'); return; }
    if (draft.end < draft.start) { alert('The end date is before the start date.'); return; }
    setBusy('save');
    try {
      await updateBigMoney(f => {
        const out = { ...f, contest: { start: draft.start, end: draft.end, prize: Number(draft.prize) || DEFAULT_PRIZE, reducedPrize: Number(draft.reducedPrize) || 0,
                                       leadAdvisor: firstName(draft.leadAdvisor) || DEFAULT_LEAD_ADVISOR, leadBonus: Number(draft.leadBonus) || 0,
                                       updatedAt: Date.now(), by: currentUser || '' } };
        // Dates changed → the old banked result no longer applies.
        const prev = f.contest || {};
        if (prev.start !== draft.start || prev.end !== draft.end) { delete out.final; delete out.latest; }
        return out;
      });
      trackAction('big-money-lof-set-dates', { start: draft.start, end: draft.end });
      await refresh();
      onContestChange && onContestChange(await loadBigMoney());
    } catch (e) { alert('Could not save the contest: ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  async function clearContest() {
    if (!isManager) return;
    if (!window.confirm('Turn Big-Money LOF off?\n\nThe tab disappears for advisors and the dates are cleared. The dashboard numbers are untouched.')) return;
    setBusy('clear');
    try {
      await updateBigMoney(f => { const out = { ...f }; delete out.contest; delete out.final; delete out.latest; return out; });
      trackAction('big-money-lof-off');
      await refresh();
      onContestChange && onContestChange(await loadBigMoney());
    } catch (e) { alert('Could not turn the contest off: ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  const myRow = board.rows.find(r => r.name === me) || null;
  const leader = board.rows.find(r => r.leader) || null;
  const iAmLeader = !!(myRow && myRow.leader);
  const anyQualified = board.rows.some(r => r.qualified);

  const statusPill = {
    [STATUS.OFF]:      { bg: 'rgba(148,163,184,.18)', color: '#cbd5e1', text: 'Not scheduled' },
    [STATUS.UPCOMING]: { bg: 'rgba(96,165,250,.2)',   color: '#93c5fd', text: 'Starts soon' },
    [STATUS.LIVE]:     { bg: 'rgba(74,222,128,.2)',   color: '#4ade80', text: '● Live now' },
    [STATUS.ENDED]:    { bg: 'rgba(250,204,21,.2)',   color: '#fde047', text: 'Final results' },
  }[status];

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">💵 Big-Money LOF</div>
          <div className="adv-sub">
            {status === STATUS.OFF ? 'Advisor contest · $50 add-on' : `${fmtContestDate(file.contest.start)} – ${fmtContestDate(file.contest.end)}`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span className="bml-pill" style={{ background: statusPill.bg, color: statusPill.color }}>{statusPill.text}</span>
        <button className="secondary" onClick={onBack} style={{ marginLeft: 10 }}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px', position: 'relative' }}>
        {iAmLeader && status === STATUS.LIVE && <Confetti />}
        <div style={{ maxWidth: 980, margin: '0 auto', display: 'grid', gap: 18 }}>

          {/* Hero */}
          <div className="bml-hero">
            {FLOATERS.map((f, i) => <span key={i} className="bml-money" style={{ left: f.l, top: f.t, animationDelay: f.d, fontSize: f.s }}>{f.e}</span>)}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '.22em', textTransform: 'uppercase', color: '#fde68a', marginBottom: 8 }}>Advisor Contest</div>
                <div style={{ fontSize: 40, fontWeight: 1000, color: '#fff', lineHeight: 1, textShadow: '0 4px 18px rgba(0,0,0,.45)' }}>Big-Money <span style={{ color: '#facc15' }}>LOF</span></div>
                <div style={{ fontSize: 15, color: 'rgba(255,255,255,.85)', marginTop: 12, lineHeight: 1.55, maxWidth: 540 }}>
                  Hit the goal on <b>$50 Add'l Hrs/RO</b> <i>and</i> <b>$50 Add Rate %</b> to qualify. The qualified advisor with the highest
                  <b> $50 Add'l Hrs/RO</b> when the contest closes wins — and it's a team effort: the <b>store average</b> has to clear both goals
                  for the full <b>{money(prizes.full)}</b>. Miss it as a store and the winner takes <b>{money(prizes.reduced)}</b>.
                </div>
                {status !== STATUS.OFF && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                    <span className="bml-pill" style={{ background: 'rgba(0,0,0,.35)', color: '#fff' }}>📅 {fmtContestDate(file.contest.start)} → {fmtContestDate(file.contest.end)}</span>
                    {status === STATUS.LIVE && <span className="bml-pill" style={{ background: 'rgba(74,222,128,.25)', color: '#bbf7d0' }}>⏳ {left === 0 ? 'Last day!' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
                    {status === STATUS.UPCOMING && <span className="bml-pill" style={{ background: 'rgba(96,165,250,.25)', color: '#dbeafe' }}>🚀 Starts {fmtContestDate(file.contest.start)}</span>}
                    {status === STATUS.ENDED && <span className="bml-pill" style={{ background: 'rgba(250,204,21,.25)', color: '#fef9c3' }}>🏁 Contest closed</span>}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'center', padding: '18px 26px', borderRadius: 20, background: 'rgba(0,0,0,.32)', border: '1px solid rgba(250,204,21,.45)', backdropFilter: 'blur(6px)' }}>
                <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.2em', color: '#fde68a', textTransform: 'uppercase' }}>Grand Prize</div>
                <div className="bml-prize">{money(prizes.full)}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#fef3c7', marginTop: 4 }}>💵 CASH 💵</div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: storeHit ? '#bbf7d0' : '#fde68a', marginTop: 8, padding: '4px 10px', borderRadius: 999, background: 'rgba(0,0,0,.35)' }}>
                  {storeHit ? '🤝 Store on goal — full prize live' : `🤝 Store under goal — currently ${money(prizes.reduced)}`}
                </div>
              </div>
            </div>
          </div>

          {/* Winner / leader callout */}
          {status === STATUS.ENDED && (
            <div className="bml-card" style={{ borderColor: 'rgba(250,204,21,.55)', background: 'linear-gradient(135deg,rgba(250,204,21,.16),rgba(245,158,11,.06))', textAlign: 'center', padding: '26px 20px' }}>
              {leader ? (
                <>
                  <div style={{ fontSize: 44 }}>🏆</div>
                  <div style={{ fontSize: 26, fontWeight: 1000, color: '#fde047', marginTop: 4 }}>{leader.display} wins {money(payout)}!</div>
                  <div style={{ color: '#fef3c7', fontSize: 14, marginTop: 6 }}>{num2(leader.hrsRo)} $50 Add'l Hrs/RO · {pct(leader.rate)} add rate</div>
                  <div style={{ color: storeHit ? '#bbf7d0' : '#fde68a', fontSize: 13, marginTop: 8, fontWeight: 800 }}>
                    {storeHit ? '🤝 The store cleared both goals — full prize!' : `🤝 Store average fell short of goal, so the prize is ${money(prizes.reduced)} instead of ${money(prizes.full)}.`}
                  </div>
                  {leadView && (
                    <div style={{ color: '#c4b5fd', fontSize: 13, marginTop: 8, fontWeight: 800 }}>
                      🎖️ Lead advisor {lead.name}: {money(leadPay.total)}{leadPay.wins ? (storeHit ? ` (${money(prizes.full)} win + ${money(lead.bonus)} store bonus)` : ' (won, but the store missed — no bonus)') : (storeHit ? ' store bonus' : ' — store missed, no bonus')}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 40 }}>🤝</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#fde047', marginTop: 4 }}>No advisor met both goals this round</div>
                  <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 6 }}>The prize rolls forward — see your manager for the next window.</div>
                </>
              )}
            </div>
          )}

          {/* Manager controls */}
          {isManager && (
            <div className="bml-card">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div className="bml-label" style={{ marginBottom: 6 }}>Contest starts</div>
                  <input type="date" className="bml-input" value={draft.start} onChange={e => setDraft(d => ({ ...d, start: e.target.value }))} />
                </div>
                <div>
                  <div className="bml-label" style={{ marginBottom: 6 }}>Contest ends</div>
                  <input type="date" className="bml-input" value={draft.end} min={draft.start || undefined} onChange={e => setDraft(d => ({ ...d, end: e.target.value }))} />
                </div>
                <div>
                  <div className="bml-label" style={{ marginBottom: 6 }}>Full prize $</div>
                  <input type="number" inputMode="numeric" className="bml-input" style={{ width: 100 }} value={draft.prize} onChange={e => setDraft(d => ({ ...d, prize: e.target.value }))} />
                </div>
                <div>
                  <div className="bml-label" style={{ marginBottom: 6 }} title="Paid instead when the store average misses either goal">If store misses $</div>
                  <input type="number" inputMode="numeric" className="bml-input" style={{ width: 100 }} value={draft.reducedPrize} onChange={e => setDraft(d => ({ ...d, reducedPrize: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={saveContest} disabled={!!busy} style={{ padding: '10px 18px', fontSize: 13.5 }}>
                  {busy === 'save' ? '⏳ Saving…' : status === STATUS.OFF ? '🚀 Start contest' : '💾 Save dates'}
                </button>
                {status !== STATUS.OFF && (
                  <button className="secondary" onClick={clearContest} disabled={!!busy} style={{ padding: '10px 14px', fontSize: 13, color: '#fca5a5', borderColor: 'rgba(248,113,113,.4)' }}>
                    {busy === 'clear' ? '⏳' : '🚫 Turn off'}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px dashed rgba(148,163,184,.2)' }}>
                <div>
                  <div className="bml-label" style={{ marginBottom: 6 }}>Lead advisor</div>
                  <select className="bml-input" value={draft.leadAdvisor} onChange={e => setDraft(d => ({ ...d, leadAdvisor: e.target.value }))}>
                    {[...new Set([draft.leadAdvisor, ...(advisors || []).map(a => firstName(a.name))].filter(Boolean))].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <div className="bml-label" style={{ marginBottom: 6 }} title="Paid to the lead advisor whenever the store hits both goals, win or not">Lead bonus $</div>
                  <input type="number" inputMode="numeric" className="bml-input" style={{ width: 100 }} value={draft.leadBonus} onChange={e => setDraft(d => ({ ...d, leadBonus: e.target.value }))} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, flex: 1, minWidth: 240 }}>
                  🎖️ Only the lead advisor and managers see this layer. Store hits both goals → lead gets the bonus win or lose; win it too → full prize + bonus ({money(prizes.full + lead.bonus)}).
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 12, lineHeight: 1.6 }}>
                Runs itself off <b>Edit Dashboard → Advisor Performance</b> — each advisor's $50 Add'l Hrs/RO and $50 Add Rate %, judged against the goals set there.
                Full prize needs the <b>store average</b> over goal on both; otherwise the winner gets the reduced amount.
                Advisors see the tab on their Appointment Prep Calendar from the start date; results lock in the day after the end date.
                {!live.goalsSet && <span style={{ color: '#fbbf24', fontWeight: 800 }}> ⚠️ Set BOTH $50 goals in Edit Dashboard or nobody can qualify.</span>}
              </div>
            </div>
          )}

          {/* Team goal — store average decides the payout */}
          {board.store && (
            <div className="bml-card" style={{ borderColor: storeHit ? 'rgba(74,222,128,.55)' : 'rgba(251,191,36,.45)',
                                               background: storeHit ? 'linear-gradient(135deg,rgba(74,222,128,.14),rgba(255,255,255,.02))' : 'linear-gradient(135deg,rgba(251,191,36,.12),rgba(255,255,255,.02))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 40 }}>🤝</div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="bml-label">Team goal · store average</div>
                  <div style={{ fontSize: 20, fontWeight: 1000, color: storeHit ? '#4ade80' : '#fbbf24', marginTop: 2 }}>
                    {storeHit ? `Store is on goal — the winner gets the full ${money(prizes.full)}` : `Store is under goal — the winner gets ${money(prizes.reduced)} unless the team lifts it`}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Both store averages must be at or over goal on the contest's last day. Every advisor moves this number.</div>
                </div>
                <div style={{ display: 'flex', gap: 22 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div className={`bml-stat ${board.store.hitHrs ? 'hit' : 'miss'}`}>{num2(board.store.hrsRo)} {board.store.hitHrs ? '✓' : ''}</div>
                    <div className="bml-label">avg hrs/RO · goal {board.goals.hrs_ro > 0 ? num2(board.goals.hrs_ro) : '—'}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div className={`bml-stat ${board.store.hitRate ? 'hit' : 'miss'}`}>{pct(board.store.rate)} {board.store.hitRate ? '✓' : ''}</div>
                    <div className="bml-label">avg add rate · goal {board.goals.add_rate > 0 ? pct(board.goals.add_rate) : '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Lead advisor bonus — private: lead advisor + managers only */}
          {leadView && lead.bonus > 0 && (
            <div className="bml-card" style={{ borderColor: 'rgba(167,139,250,.55)', background: 'linear-gradient(135deg,rgba(139,92,246,.18),rgba(236,72,153,.06))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 40 }}>🎖️</div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div className="bml-label" style={{ color: '#c4b5fd' }}>Lead advisor bonus · {lead.name}{isManager && !iAmLead ? ' · manager view' : ''}</div>
                  <div style={{ fontSize: 19, fontWeight: 1000, color: '#e9d5ff', marginTop: 2 }}>
                    {iAmLead ? 'You' : lead.name} {iAmLead ? 'get' : 'gets'} <span style={{ color: '#fde047' }}>{money(lead.bonus)}</span> when the store hits both goals — win or not.
                    Win the contest too and it's <span style={{ color: '#fde047' }}>{money(prizes.full + lead.bonus)}</span>.
                  </div>
                  <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 4 }}>Only {iAmLead ? 'you' : lead.name} and managers can see this.</div>
                </div>
                <div style={{ textAlign: 'center', padding: '10px 18px', borderRadius: 14, background: 'rgba(0,0,0,.3)', border: '1px solid rgba(167,139,250,.4)' }}>
                  <div className="bml-label" style={{ color: '#c4b5fd' }}>{status === STATUS.ENDED ? 'Final' : 'On track for'}</div>
                  <div style={{ fontSize: 30, fontWeight: 1000, color: leadPay.total > 0 ? '#fde047' : '#94a3b8', lineHeight: 1.1 }}>{money(leadPay.total)}</div>
                  <div style={{ fontSize: 11, color: '#c4b5fd', marginTop: 2 }}>
                    {leadPay.wins ? '🏆 winning' : '— not winning'} · {storeHit ? '🤝 store on goal' : '🤝 store under goal'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 12 }}>
                {[
                  ['Wins · store hits',   prizes.full + lead.bonus, leadPay.wins && storeHit],
                  ['Wins · store misses', prizes.reduced,           leadPay.wins && !storeHit],
                  ['Loses · store hits',  lead.bonus,               !leadPay.wins && storeHit],
                  ['Loses · store misses', 0,                       !leadPay.wins && !storeHit],
                ].map(([k, v, on]) => (
                  <div key={k} style={{ borderRadius: 10, padding: '8px 10px', background: on ? 'rgba(250,204,21,.16)' : 'rgba(0,0,0,.25)', border: `1px solid ${on ? 'rgba(250,204,21,.6)' : 'rgba(148,163,184,.15)'}` }}>
                    <div className="bml-label" style={{ color: on ? '#fde68a' : '#94a3b8' }}>{k}{on ? ' · now' : ''}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: on ? '#fde047' : '#cbd5e1' }}>{money(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Goals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div className="bml-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ fontSize: 34 }}>🛢️</div>
              <div>
                <div className="bml-label">$50 Add'l Hrs/RO goal</div>
                <div className="bml-stat" style={{ color: '#67e8f9' }}>{board.goals.hrs_ro > 0 ? num2(board.goals.hrs_ro) : '—'}</div>
              </div>
            </div>
            <div className="bml-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ fontSize: 34 }}>📈</div>
              <div>
                <div className="bml-label">$50 Add Rate % goal</div>
                <div className="bml-stat" style={{ color: '#c4b5fd' }}>{board.goals.add_rate > 0 ? pct(board.goals.add_rate) : '—'}</div>
              </div>
            </div>
            {myRow && (
              <div className="bml-card" style={{ display: 'flex', alignItems: 'center', gap: 14, borderColor: iAmLeader ? 'rgba(250,204,21,.6)' : myRow.qualified ? 'rgba(74,222,128,.5)' : 'rgba(148,163,184,.2)' }}>
                <div style={{ fontSize: 34 }}>{iAmLeader ? '🏆' : myRow.qualified ? '✅' : '🎯'}</div>
                <div>
                  <div className="bml-label">Where you stand</div>
                  <div className="bml-stat" style={{ color: iAmLeader ? '#fde047' : myRow.qualified ? '#4ade80' : '#e2e8f0' }}>
                    {iAmLeader ? "You're leading!" : myRow.qualified ? `Qualified · #${myRow.rank}` : 'Not qualified yet'}
                  </div>
                  {!myRow.qualified && (
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                      {!myRow.hitHrs && board.goals.hrs_ro > 0 && <>Need {num2(Math.max(0, board.goals.hrs_ro - myRow.hrsRo))} more hrs/RO. </>}
                      {!myRow.hitRate && board.goals.add_rate > 0 && <>Need {pct(Math.max(0, board.goals.add_rate - myRow.rate))} more add rate.</>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Leaderboard */}
          <div className="bml-card" style={{ padding: '18px 18px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 18, fontWeight: 1000, color: '#fff' }}>🏁 Leaderboard</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {board.banked
                  ? `Final · locked ${new Date(board.takenAt || board.bankedAt).toLocaleDateString()}`
                  : status === STATUS.LIVE ? 'Updates with the dashboard' : status === STATUS.UPCOMING ? 'Preview — counting starts on day one' : 'Preview'}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 11.5, color: '#94a3b8' }}>✅ qualified · 🏆 leading</div>
            </div>

            {loading ? (
              <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>⏳ Loading…</div>
            ) : board.rows.length === 0 ? (
              <div style={{ color: '#64748b', padding: 20, textAlign: 'center' }}>No advisors on the dashboard yet.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="bml-row" style={{ background: 'transparent', border: 'none', padding: '0 16px' }}>
                  <div className="bml-label">Rank</div>
                  <div className="bml-label">Advisor</div>
                  <div className="bml-label">$50 Add'l Hrs/RO</div>
                  <div className="bml-label">$50 Add Rate %</div>
                  <div className="bml-label bml-hide" style={{ textAlign: 'right' }}>Status</div>
                </div>
                {board.rows.map(r => {
                  const mine = r.name === me;
                  return (
                    <div key={r.name} className={`bml-row${mine ? ' me' : ''}${r.leader ? ' leader' : ''}`}>
                      <div style={{ fontSize: r.rank <= 3 && r.qualified ? 28 : 18, fontWeight: 900, color: '#94a3b8', textAlign: 'center' }}>
                        {r.qualified && r.rank <= 3 ? MEDAL[r.rank - 1] : `#${r.rank}`}
                      </div>
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 900, color: mine ? '#67e8f9' : '#f1f5f9' }}>
                          {r.display}{mine && <span style={{ fontSize: 11, color: '#67e8f9', marginLeft: 8, fontWeight: 800 }}>YOU</span>}
                        </div>
                        {r.leader && <div style={{ fontSize: 11.5, color: '#fde047', fontWeight: 800 }}>🏆 Leading for {money(payout)}</div>}
                      </div>
                      <div>
                        <div className={`bml-stat ${r.hitHrs ? 'hit' : 'miss'}`}>{num2(r.hrsRo)} {r.hitHrs ? '✓' : ''}</div>
                        <div className="bml-label">goal {board.goals.hrs_ro > 0 ? num2(board.goals.hrs_ro) : '—'}</div>
                      </div>
                      <div>
                        <div className={`bml-stat ${r.hitRate ? 'hit' : 'miss'}`}>{pct(r.rate)} {r.hitRate ? '✓' : ''}</div>
                        <div className="bml-label">goal {board.goals.add_rate > 0 ? pct(board.goals.add_rate) : '—'}</div>
                      </div>
                      <div className="bml-hide" style={{ textAlign: 'right' }}>
                        {r.leader
                          ? <span className="bml-pill" style={{ background: 'rgba(250,204,21,.22)', color: '#fde047' }}>🏆 Leader</span>
                          : r.qualified
                            ? <span className="bml-pill" style={{ background: 'rgba(74,222,128,.18)', color: '#4ade80' }}>✅ Qualified</span>
                            : <span className="bml-pill" style={{ background: 'rgba(148,163,184,.14)', color: '#94a3b8' }}>Chasing</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!anyQualified && !loading && board.rows.length > 0 && status !== STATUS.ENDED && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>Nobody has hit both goals yet — the {money(prizes.full)} is wide open. 💪</div>
            )}
          </div>

          {/* Rules */}
          <div className="bml-card">
            <div style={{ fontSize: 15, fontWeight: 1000, color: '#fff', marginBottom: 10 }}>📜 How to win</div>
            <ol style={{ margin: 0, paddingLeft: 22, color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.8 }}>
              <li>Meet or beat <b>both</b> goals — <b>$50 Add'l Hrs/RO</b> and <b>$50 Add Rate %</b> — to qualify. One without the other doesn't count.</li>
              <li>Among the qualified advisors, the <b>highest $50 Add'l Hrs/RO</b> when the contest closes is the winner.</li>
              <li><b>Team effort:</b> the winner takes home <b>{money(prizes.full)} cash</b> only if the <b>store average</b> is at or over goal on <b>both</b> numbers. If the store falls short, the winner gets <b>{money(prizes.reduced)}</b>. Everyone's numbers count toward the store average.</li>
              <li>Tied on hrs/RO? The higher <b>$50 Add Rate %</b> takes it.</li>
              <li>Numbers come straight from the dashboard and are judged as of the contest's last day. Dip under a goal and you're out until you're back over it.</li>
              {leadView && lead.bonus > 0 && (
                <li style={{ color: '#e9d5ff' }}><b>🎖️ Lead advisor ({lead.name}):</b> receives <b>{money(lead.bonus)}</b> whenever the store hits both goals, win or not. Winning the contest with the store on goal pays <b>{money(prizes.full + lead.bonus)}</b> total. <span style={{ color: '#a78bfa' }}>(Visible only to the lead advisor and managers.)</span></li>
              )}
            </ol>
          </div>

        </div>
      </div>
    </div>
  );
}
