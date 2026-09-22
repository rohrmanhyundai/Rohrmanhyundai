import React, { useState, useEffect, useCallback } from 'react';
import { loadDailyWrench, loadDailyWrenchIndex, requestDailyWrench } from '../utils/github';
import { trackPage, trackAction } from '../utils/activityTracker';

// ── The Daily Wrench ─────────────────────────────────────────────────────────
// The morning briefing. An advisor opens it and sees their own day: where the
// month stands, what today has to produce, which repair orders are costing
// them hours right now, what parts are sitting on the shelf, where they are in
// the contest — and what they did well.
//
// The words are written overnight by the daily-wrench workflow (9am Eastern,
// or early when a manager asks). The numbers underneath are computed, not
// written, so if the AI call ever fails the page still shows the day's facts
// and says plainly that the write-up is missing.
//
// Managers get their own deeper report — the whole floor, the money forecast,
// a note per advisor — plus a Generate button and every advisor's briefing.

const isManagerRole = (role) => { const r = String(role || '').toLowerCase(); return r === 'admin' || r.includes('manager'); };
const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
const pad = (n) => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const prettyDay = (key) => {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};
const money = (v) => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');

const CSS = `
.dw-wrap{max-width:1080px;margin:0 auto;display:grid;gap:16px}
.dw-hero{position:relative;overflow:hidden;border-radius:20px;padding:26px 28px;
  background:linear-gradient(135deg,rgba(56,189,248,.16),rgba(139,92,246,.14) 55%,rgba(16,185,129,.12));
  border:1px solid rgba(125,211,252,.35)}
.dw-hero:after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 88% -30%,rgba(125,211,252,.25),transparent 55%);pointer-events:none}
.dw-kicker{font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc}
.dw-headline{font-size:27px;font-weight:1000;color:#fff;margin:8px 0 10px;line-height:1.15;letter-spacing:-.01em}
.dw-open{font-size:15.5px;line-height:1.65;color:#dbeafe;max-width:70ch}
.dw-card{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02));
  border:1px solid rgba(148,163,184,.22);border-radius:16px;padding:16px 18px}
.dw-title{font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.dw-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.dw-stat{background:rgba(2,6,23,.45);border:1px solid rgba(148,163,184,.16);border-radius:13px;padding:13px 15px}
.dw-stat .k{font-size:10px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:#64748b}
.dw-stat .v{font-size:25px;font-weight:1000;color:#f8fafc;margin-top:4px;line-height:1.1;letter-spacing:-.02em}
.dw-stat .s{font-size:11.5px;color:#94a3b8;margin-top:3px}
.dw-item{display:grid;grid-template-columns:auto 1fr;gap:11px;align-items:start;padding:11px 0;border-top:1px solid rgba(148,163,184,.12)}
.dw-item:first-of-type{border-top:none}
.dw-item .t{font-size:14.5px;font-weight:800;color:#f1f5f9}
.dw-item .d{font-size:13.5px;color:#cbd5e1;line-height:1.55;margin-top:2px}
.dw-ro{display:grid;grid-template-columns:86px 1fr;gap:12px;align-items:start;padding:11px 0;border-top:1px solid rgba(148,163,184,.12)}
.dw-ro:first-of-type{border-top:none}
.dw-ro .num{font-size:14px;font-weight:900;color:#67e8f9}
.dw-ro .what{font-size:13.5px;color:#f1f5f9;font-weight:600}
.dw-ro .act{font-size:13px;color:#a5b4fc;margin-top:3px}
.dw-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:900;border:1px solid}
.dw-tab{border-radius:999px;padding:7px 15px;font-size:13px;font-weight:900;cursor:pointer;white-space:nowrap;
  border:1px solid rgba(148,163,184,.25);background:rgba(255,255,255,.04);color:#cbd5e1}
.dw-tab.on{background:rgba(125,211,252,.18);border-color:rgba(125,211,252,.65);color:#7dd3fc}
.dw-quote{font-size:15px;line-height:1.65;color:#e2e8f0;border-left:3px solid rgba(125,211,252,.6);padding:2px 0 2px 15px;max-width:72ch}
@media(max-width:700px){.dw-headline{font-size:22px}.dw-ro{grid-template-columns:70px 1fr}}
`;

// A stat tile. `tone` colours the value when something needs noticing.
function Stat({ k, v, s, tone }) {
  const color = tone === 'good' ? '#4ade80' : tone === 'warn' ? '#fbbf24' : tone === 'bad' ? '#f87171' : '#f8fafc';
  return (
    <div className="dw-stat">
      <div className="k">{k}</div>
      <div className="v" style={{ color }}>{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}

function Section({ icon, title, children, right }) {
  return (
    <div className="dw-card">
      <div className="dw-title"><span style={{ fontSize: 15 }}>{icon}</span>{title}<div style={{ flex: 1 }} />{right}</div>
      {children}
    </div>
  );
}

// ── One advisor's briefing ───────────────────────────────────────────────────
function AdvisorReport({ report, name }) {
  if (!report) return null;
  const f = report.facts || {};
  const h = f.hours || {};
  const ro = f.openRos || {};
  const contest = f.contest || {};
  const wins = report.wins && report.wins.length ? report.wins : (f.wins || []).map(w => ({ title: 'Win', detail: w.detail }));

  return (
    <>
      <div className="dw-hero">
        <div className="dw-kicker">🔧 The Daily Wrench · {name}</div>
        <div className="dw-headline">{report.headline || `${name}'s day`}</div>
        {report.opening ? <div className="dw-open">{report.opening}</div> : null}
        {report.moneyLine ? <div className="dw-open" style={{ marginTop: 10, color: '#86efac', fontWeight: 700 }}>{report.moneyLine}</div> : null}
        {report.error ? (
          <div className="dw-open" style={{ color: '#fcd34d' }}>
            The write-up didn't come through this morning, but the numbers below are today's.
          </div>
        ) : null}
      </div>

      {contest.live ? (
        <Section icon="💵" title="Big-Money LOF">
          <div className="dw-stats" style={{ marginBottom: report.contest ? 14 : 0 }}>
            {contest.me ? (
              <>
                <Stat k="Your rank" v={`#${contest.me.rank}`} s={contest.me.qualified ? 'qualified' : 'not qualified yet'} tone={contest.me.qualified ? 'good' : 'warn'} />
                <Stat k="$50 Hrs/RO" v={contest.me.hrsRo} s={contest.me.hrsRoGap > 0 ? `${contest.me.hrsRoGap} under the ${contest.goals.hrsRo} goal` : `goal ${contest.goals.hrsRo} — hit`} tone={contest.me.hrsRoGap > 0 ? 'warn' : 'good'} />
                <Stat k="$50 Add rate" v={`${Math.round(contest.me.rate * 100)}%`} s={contest.me.rateGap > 0 ? `${Math.round(contest.me.rateGap * 100)} points under goal` : 'goal hit'} tone={contest.me.rateGap > 0 ? 'warn' : 'good'} />
              </>
            ) : (
              <>
                <Stat k="Your rank" v="—" s="no standing on the board yet" tone="warn" />
                <Stat k="$50 Hrs/RO goal" v={contest.goals.hrsRo} />
                <Stat k="$50 Add rate goal" v={`${Math.round(contest.goals.addRate * 100)}%`} />
              </>
            )}
            <Stat k="Days left" v={contest.daysLeft} s={contest.prize ? `${money(contest.prize)} on the line` : ''} />
          </div>
          {report.contest ? <div className="dw-quote">{report.contest}</div> : null}
        </Section>
      ) : null}

      <div className="dw-stats">
        {h.hasGoal ? (
          <>
            <Stat k="Hours needed today" v={h.neededToday} s={`to finish on ${h.goal}`} tone={h.neededToday > h.dailyTarget * 1.25 ? 'warn' : 'good'} />
            <Stat k="Month to date" v={h.mtd} s={`${h.percentOfGoal}% of goal · ${h.workingDaysLeft} days left`} />
            <Stat k="Pace" v={`${h.onPace ? '+' : ''}${h.aheadBy}`} s={h.onPace ? 'ahead of pace' : 'behind pace'} tone={h.onPace ? 'good' : 'bad'} />
          </>
        ) : (
          <Stat k="Hours goal" v="—" s="no goal set for this month" />
        )}
        <Stat k="Open ROs" v={ro.total || 0} s={ro.total ? `oldest ${ro.oldestDays} days · avg ${ro.averageDays}` : 'nothing open'} tone={(ro.buckets && ro.buckets.days6plus) ? 'warn' : 'good'} />
        {f.partsReady && f.partsReady.length ? <Stat k="Parts in, ready to book" v={f.partsReady.length} s="hours sitting on the shelf" tone="good" /> : null}
        {f.deferred && f.deferred.total ? (
          <Stat k="Declined work, never called" v={money(f.deferred.totalAmount)} s={`${f.deferred.neverContacted} customers · ${f.deferred.totalHours} hours`} tone="good" />
        ) : null}
      </div>

      {wins.length ? (
        <Section icon="🏆" title="Wins">
          {wins.map((w, i) => (
            <div className="dw-item" key={i}>
              <span style={{ fontSize: 17 }}>✅</span>
              <div><div className="t">{w.title}</div><div className="d">{w.detail}</div></div>
            </div>
          ))}
        </Section>
      ) : null}

      {report.plan && report.plan.length ? (
        <Section icon="🎯" title="Today's plan">
          {report.plan.map((x, i) => (
            <div className="dw-item" key={i}>
              <span className="dw-pill" style={{ background: 'rgba(125,211,252,.14)', borderColor: 'rgba(125,211,252,.45)', color: '#7dd3fc', minWidth: 86, justifyContent: 'center' }}>{x.when}</span>
              <div><div className="t">{x.what}</div><div className="d">{x.why}</div></div>
            </div>
          ))}
        </Section>
      ) : report.focus && report.focus.length ? (
        <Section icon="🎯" title="Where today gets won">
          {report.focus.map((x, i) => (
            <div className="dw-item" key={i}>
              <span style={{ fontSize: 15, fontWeight: 1000, color: '#7dd3fc', minWidth: 18 }}>{i + 1}</span>
              <div><div className="t">{x.title}</div><div className="d">{x.detail}</div></div>
            </div>
          ))}
        </Section>
      ) : null}

      {report.callList && report.callList.length ? (
        <Section icon="📞" title="Call these customers first" right={<span style={{ fontSize: 11.5, color: '#64748b', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>work they already declined — biggest first</span>}>
          {report.callList.map((c, i) => (
            <div className="dw-ro" key={i}>
              <div>
                <div className="num">{c.ro ? `RO ${c.ro}` : ''}</div>
                {c.phone ? <a href={`tel:${c.phone}`} style={{ fontSize: 12, color: '#86efac', textDecoration: 'none' }}>{String(c.phone).replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')}</a> : null}
              </div>
              <div><div className="what">{c.name}</div><div className="act">{c.why}</div></div>
            </div>
          ))}
        </Section>
      ) : null}

      {report.watchlist && report.watchlist.length ? (
        <Section icon="⏱️" title="Repair orders that need you" right={<span style={{ fontSize: 11.5, color: '#64748b', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>oldest and most stuck first</span>}>
          {report.watchlist.map((w, i) => (
            <div className="dw-ro" key={i}>
              <div className="num">RO {w.ro}</div>
              <div><div className="what">{w.what}</div><div className="act">→ {w.action}</div></div>
            </div>
          ))}
        </Section>
      ) : null}

      {f.partsReady && f.partsReady.length ? (
        <Section icon="📦" title="Parts are in — book these">
          {f.partsReady.map((p, i) => (
            <div className="dw-ro" key={i}>
              <div className="num">RO {p.ro}</div>
              <div>
                <div className="what">{p.vehicle}{p.job ? ` · ${p.job}` : ''}</div>
                <div className="act">{p.tech ? `with ${firstWord(p.tech)}` : 'unassigned'}{p.arrived ? ` · parts in ${p.arrived}` : ''}{p.note ? ` · ${p.note}` : ''}</div>
              </div>
            </div>
          ))}
        </Section>
      ) : null}

      {f.stalled && f.stalled.length ? (
        <Section icon="🧱" title="Stalled — somebody is waiting on an answer">
          {f.stalled.map((s, i) => (
            <div className="dw-ro" key={i}>
              <div className="num">RO {s.ro}</div>
              <div>
                <div className="what">{s.vehicle || '—'}</div>
                <div className="act">“{s.lastNote}” — {firstWord(s.lastNoteBy)}{s.daysSinceNote != null ? `, ${s.daysSinceNote} day${s.daysSinceNote === 1 ? '' : 's'} ago` : ''}</div>
              </div>
            </div>
          ))}
        </Section>
      ) : null}

      {report.coaching ? (
        <Section icon="🧭" title="The one thing this month">
          <div className="dw-quote" style={{ borderLeftColor: 'rgba(167,139,250,.7)' }}>{report.coaching}</div>
        </Section>
      ) : null}

      {report.closing ? (
        <div className="dw-card" style={{ background: 'linear-gradient(135deg,rgba(16,185,129,.12),rgba(56,189,248,.08))', borderColor: 'rgba(52,211,153,.35)' }}>
          <div className="dw-quote" style={{ borderLeftColor: 'rgba(52,211,153,.7)', color: '#d1fae5' }}>{report.closing}</div>
        </div>
      ) : null}
    </>
  );
}

// ── The manager's shop-wide report ───────────────────────────────────────────
function ManagerReport({ report }) {
  if (!report) return null;
  const f = report.facts || {};
  const m = f.money || {};
  const t = f.technicians || {};
  const ro = f.shopOpenRos || {};

  return (
    <>
      <div className="dw-hero" style={{ background: 'linear-gradient(135deg,rgba(250,204,21,.14),rgba(139,92,246,.14) 55%,rgba(56,189,248,.12))', borderColor: 'rgba(250,204,21,.35)' }}>
        <div className="dw-kicker" style={{ color: '#fde047' }}>🔧 The Daily Wrench · Manager</div>
        <div className="dw-headline">{report.headline || 'The shop this morning'}</div>
        {report.opening ? <div className="dw-open">{report.opening}</div> : null}
        {report.error ? <div className="dw-open" style={{ color: '#fcd34d' }}>The write-up didn't come through, but the numbers below are today's.</div> : null}
      </div>

      <div className="dw-stats">
        <Stat k="Gross earned" v={money(m.earned)} s={`${m.percentOfForecast}% of ${money(m.forecast)}`} tone={m.percentOfForecast >= 60 ? 'good' : 'warn'} />
        <Stat k="Needed per day" v={money(m.neededPerDay)} s={`${m.workingDaysLeft} working days left`} tone={m.neededPerDay > (m.forecast / m.workingDaysTotal) * 1.4 ? 'bad' : 'good'} />
        <Stat k="Remaining" v={money(m.remaining)} s={m.lastYear ? `last year ${money(m.lastYear)}` : ''} />
        <Stat k="Open ROs" v={ro.total || 0} s={`oldest ${ro.oldestDays} days · ${(ro.buckets && ro.buckets.days6plus) || 0} over 6 days`} tone={(ro.buckets && ro.buckets.days6plus) > 5 ? 'warn' : 'good'} />
        <Stat k="Tech hours" v={t.hoursTotal || 0} s={`of ${t.goalTotal || 0} this week`} />
        {f.deferredShopWide && f.deferredShopWide.total ? (
          <Stat k="Declined work on the table" v={money(f.deferredShopWide.totalAmount)} s={`${f.deferredShopWide.neverContacted} never called`} tone="good" />
        ) : null}
      </div>

      {report.forecast ? <Section icon="📈" title="Where the month lands"><div className="dw-quote">{report.forecast}</div></Section> : null}

      {report.wins && report.wins.length ? (
        <Section icon="🏆" title="Wins">
          {report.wins.map((w, i) => (
            <div className="dw-item" key={i}>
              <span style={{ fontSize: 17 }}>✅</span>
              <div><div className="t">{w.title}</div><div className="d">{w.detail}</div></div>
            </div>
          ))}
        </Section>
      ) : null}

      {report.priorities && report.priorities.length ? (
        <Section icon="🎯" title="Move the month today">
          {report.priorities.map((x, i) => (
            <div className="dw-item" key={i}>
              <span style={{ fontSize: 15, fontWeight: 1000, color: '#fde047', minWidth: 18 }}>{i + 1}</span>
              <div><div className="t">{x.what}</div><div className="d">{x.why}</div></div>
            </div>
          ))}
        </Section>
      ) : null}

      {report.advisorNotes && report.advisorNotes.length ? (
        <Section icon="👥" title="Your advisors today">
          {report.advisorNotes.map((a, i) => {
            const row = (f.advisors || []).find(x => x.advisor === firstWord(a.advisor));
            return (
              <div className="dw-item" key={i}>
                <span className="dw-pill" style={{ background: 'rgba(125,211,252,.14)', borderColor: 'rgba(125,211,252,.45)', color: '#7dd3fc', minWidth: 62, justifyContent: 'center' }}>{a.advisor}</span>
                <div>
                  <div className="d" style={{ marginTop: 0 }}>{a.note}</div>
                  {row ? (
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 5 }}>
                      {row.hours ? `${row.hours.mtd}/${row.hours.goal} hrs (${row.hours.percentOfGoal}%) · needs ${row.hours.neededToday} today · ` : ''}
                      {row.openRos} open{row.oldestDays ? `, oldest ${row.oldestDays}d` : ''}{row.stalled ? ` · ${row.stalled} stalled` : ''}{row.partsReady ? ` · ${row.partsReady} parts in` : ''}{row.deferredValue ? ` · ${money(row.deferredValue)} declined, ${row.deferredUncalled} uncalled` : ''}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </Section>
      ) : null}

      {report.watchlist && report.watchlist.length ? (
        <Section icon="⏱️" title="Repair orders costing the shop">
          {report.watchlist.map((w, i) => (
            <div className="dw-ro" key={i}>
              <div className="num">RO {w.ro}</div>
              <div><div className="what">{w.what}</div><div className="act">→ {w.action}</div></div>
            </div>
          ))}
        </Section>
      ) : null}

      {report.technicians ? (
        <Section icon="🔧" title="The shop floor">
          <div className="dw-quote" style={{ marginBottom: t.list && t.list.length ? 14 : 0 }}>{report.technicians}</div>
          {t.list && t.list.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {t.list.map(x => (
                <span key={x.name} className="dw-pill" style={{
                  background: x.pct >= 100 ? 'rgba(74,222,128,.14)' : x.pct >= 50 ? 'rgba(250,204,21,.12)' : 'rgba(248,113,113,.12)',
                  borderColor: x.pct >= 100 ? 'rgba(74,222,128,.45)' : x.pct >= 50 ? 'rgba(250,204,21,.4)' : 'rgba(248,113,113,.4)',
                  color: x.pct >= 100 ? '#4ade80' : x.pct >= 50 ? '#fde047' : '#fca5a5',
                }}>{x.name} {x.total}/{x.goal}</span>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {report.closing ? (
        <div className="dw-card" style={{ background: 'linear-gradient(135deg,rgba(250,204,21,.12),rgba(56,189,248,.08))', borderColor: 'rgba(250,204,21,.35)' }}>
          <div className="dw-quote" style={{ borderLeftColor: 'rgba(250,204,21,.7)', color: '#fef3c7' }}>{report.closing}</div>
        </div>
      ) : null}
    </>
  );
}

export default function DailyWrench({ currentUser, currentRole, onBack }) {
  const isManager = isManagerRole(currentRole);
  const me = firstWord(currentUser);
  const [day, setDay] = useState(todayKey());
  const [index, setIndex] = useState({ days: {} });
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(isManager ? 'manager' : 'me');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => { trackPage('daily-wrench'); }, []);
  useEffect(() => { loadDailyWrenchIndex().then(i => setIndex(i || { days: {} })).catch(() => {}); }, []);

  const fetchDay = useCallback(async (key) => {
    setLoading(true);
    try { setDoc(await loadDailyWrench(key)); } catch { setDoc(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchDay(day); }, [day, fetchDay]);

  // The workflow takes a minute or so; poll until the file for today appears
  // with a newer timestamp than the one we already have.
  async function generate() {
    if (!isManager || busy) return;
    const before = doc && doc.generatedAt;
    setBusy(true); setStatus('📝 Writing this morning\'s reports — about a minute…');
    try {
      await requestDailyWrench(currentUser, 'manager pressed Generate');
      trackAction('daily-wrench-generate');
      const key = todayKey();
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 6000));
        const fresh = await loadDailyWrench(key);
        if (fresh && fresh.generatedAt && fresh.generatedAt !== before) {
          setDay(key); setDoc(fresh); setStatus('✅ Fresh reports are up.');
          loadDailyWrenchIndex().then(ix => setIndex(ix || { days: {} })).catch(() => {});
          return;
        }
      }
      setStatus('⏳ Still running — it will appear here shortly. Refresh in a minute.');
    } catch (e) {
      setStatus('❌ ' + (e?.message || e));
    } finally { setBusy(false); }
  }

  const days = Object.keys(index.days || {}).sort().reverse().slice(0, 14);
  const advisorNames = doc && doc.advisors ? Object.keys(doc.advisors).sort() : [];
  const mine = doc && doc.advisors ? doc.advisors[me] : null;
  const shown = view === 'manager' ? null : (doc && doc.advisors ? doc.advisors[view === 'me' ? me : view] : null);
  const shownName = view === 'me' ? me : view;

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{CSS}</style>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <div className="adv-title">🔧 The Daily Wrench</div>
          <div className="adv-sub">
            {prettyDay(day)}
            {doc && doc.generatedAt ? ` · written ${new Date(doc.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${doc.by && doc.by !== 'auto' ? ` by ${doc.by}` : ''}` : ''}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {days.length > 1 && (
          <select className="ds-in" value={day} onChange={e => setDay(e.target.value)}
            style={{ background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 9, padding: '7px 10px', fontSize: 13, color: '#e2e8f0' }}>
            {days.map(k => <option key={k} value={k}>{k === todayKey() ? 'Today' : prettyDay(k)}</option>)}
          </select>
        )}
        {isManager && (
          <button onClick={generate} disabled={busy}
            style={{ background: 'linear-gradient(180deg,rgba(250,204,21,.3),rgba(245,158,11,.22))', borderColor: 'rgba(250,204,21,.55)', color: '#fef3c7', fontSize: 13 }}>
            {busy ? '⏳ Writing…' : '📝 Generate report'}
          </button>
        )}
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div className="dw-wrap">
          {status && <div className="dw-card" style={{ padding: '11px 15px', fontSize: 13.5, fontWeight: 700, color: status.startsWith('❌') ? '#f87171' : '#7dd3fc' }}>{status}</div>}

          {isManager && doc && (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button className={`dw-tab${view === 'manager' ? ' on' : ''}`} onClick={() => setView('manager')}>🏢 Shop report</button>
              {mine && <button className={`dw-tab${view === 'me' ? ' on' : ''}`} onClick={() => setView('me')}>{me} (me)</button>}
              {advisorNames.filter(n => n !== me).map(n => (
                <button key={n} className={`dw-tab${view === n ? ' on' : ''}`} onClick={() => setView(n)}>{n}</button>
              ))}
            </div>
          )}

          {loading && <div className="dw-card" style={{ textAlign: 'center', color: '#94a3b8', padding: 34 }}>Loading the morning briefing…</div>}

          {!loading && !doc && (
            <div className="dw-card" style={{ textAlign: 'center', padding: 36 }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🔧</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9', marginBottom: 6 }}>No report for {prettyDay(day)}</div>
              <div style={{ fontSize: 13.5, color: '#94a3b8', lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
                The Daily Wrench is written every morning at 9am.
                {isManager ? ' Need it now? Press Generate report.' : ' It will be here shortly — check back after 9.'}
              </div>
            </div>
          )}

          {!loading && doc && view === 'manager' && isManager && (
            doc.manager ? <ManagerReport report={doc.manager} />
              : <div className="dw-card" style={{ textAlign: 'center', color: '#94a3b8', padding: 30 }}>No shop report in this day's file.</div>
          )}

          {!loading && doc && view !== 'manager' && (
            shown ? <AdvisorReport report={shown} name={shownName} />
              : (
                <div className="dw-card" style={{ textAlign: 'center', padding: 36 }}>
                  <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9', marginBottom: 6 }}>Nothing for {shownName} on {prettyDay(day)}</div>
                  <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Reports are written for advisors on the dashboard roster with a login.</div>
                </div>
              )
          )}
        </div>
      </div>
    </div>
  );
}
