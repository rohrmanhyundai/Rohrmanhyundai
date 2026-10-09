import React, { useState, useEffect, useCallback } from 'react';
import { loadDailyWrench, loadDailyWrenchIndex, requestDailyWrench } from '../utils/github';
import { trackPage, trackAction } from '../utils/activityTracker';
import { BigMoneyAdvisorCharts, CHART_LEGEND } from './BigMoneyProgress';
import { advisorDailyAverage, advisorProjectedHours, advisorsForDisplay } from '../utils/calculations';
import { ownerOf, apptTags } from '../utils/apptMath.mjs';
import { useTwoWeekEfficiency, MiniGauge } from './techEfficiency';
import { SC_CSS, Ring, scoreMetrics, sellPlan, todayCounts } from './scorecard';
import { fetchLiveJson } from '../utils/liveData';

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

// ── Today's appointments: where the pickup is ─────────────────────────────────
// Straight from the facts (the prep calendar's DMS list), not the AI: every car
// walking in today that already has declined work, in appointment order, with
// the services that get that RO to the hrs/RO goal. `shop` adds who owns it.
const TAG_LABEL = { campaign: '⚠ Campaign', sop: '📦 Parts in', diag: '🔍 Diag', warranty: '🛡 Warranty', lof50: '💵 $50 LOF', tow: '🚚 Tow', prepay: '💳 Prepaid', nonhyundai: '🚙 Non-Hyundai' };
function PickupSection({ appts, line, shop }) {
  if (!appts || !appts.total) return null;
  const hrs = (n) => `${Number(n || 0).toFixed(1)} hrs`;
  return (
    <Section icon="📅" title="Today's appointments — where the pickup is"
      right={<span style={{ fontSize: 11.5, color: '#64748b', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>from the Appointment Prep Calendar</span>}>
      <div className="dw-stats" style={{ marginBottom: 14 }}>
        <Stat k="Appointments" v={appts.total} s={`${appts.waiters} waiter${appts.waiters === 1 ? '' : 's'}${appts.lof50 ? ` · ${appts.lof50} $50 LOF` : ''}`} />
        <Stat k="With declined work" v={appts.withDeferred} s={appts.withDeferred ? `${money(appts.deferredAmount)} on those cars` : 'none today'} tone={appts.withDeferred ? 'good' : undefined} />
        <Stat k="Pickup if they sell" v={hrs(appts.goalHours)} s={`${appts.reachGoal} RO${appts.reachGoal === 1 ? '' : 's'} hit the ${appts.hrsRoGoal} hrs/RO goal`} tone={appts.goalHours ? 'good' : undefined} />
        {shop && appts.openPool ? <Stat k="Still unassigned" v={appts.openPool} s="in the open pool" tone="warn" /> : null}
        {!shop && (appts.campaigns || appts.partsInSop) ? <Stat k="Prep before they arrive" v={appts.campaigns + appts.partsInSop} s={[appts.campaigns && `${appts.campaigns} campaign`, appts.partsInSop && `${appts.partsInSop} parts in`].filter(Boolean).join(' · ')} tone="warn" /> : null}
      </div>
      {line ? <div className="dw-quote" style={{ marginBottom: 12 }}>{line}</div> : null}
      {appts.pickup.length ? appts.pickup.map((p, i) => (
        <div className="dw-ro" key={i} style={{ gridTemplateColumns: '86px 1fr auto' }}>
          <div>
            <div className="num">{p.time}</div>
            {p.waiter ? <div style={{ fontSize: 10.5, fontWeight: 900, color: '#fdba74', marginTop: 2 }}>WAITER</div> : null}
          </div>
          <div>
            <div className="what">
              {p.customer} <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {p.vehicle}</span>
              {shop ? <span className="dw-pill" style={{ marginLeft: 8, background: 'rgba(125,211,252,.12)', borderColor: 'rgba(125,211,252,.4)', color: '#7dd3fc' }}>{p.owner}</span> : null}
            </div>
            {p.visit ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>In for: {p.visit}</div> : null}
            {p.sell ? (
              <div style={{ fontSize: 13, marginTop: 4, color: p.sell.reachesGoal ? '#86efac' : '#fde047', fontWeight: 700 }}>
                🎯 Sell {p.sell.services.join(' + ')} · {hrs(p.sell.hours)}{p.sell.reachesGoal ? ` → hits ${appts.hrsRoGoal} hrs/RO` : ` · ${p.sell.shortBy.toFixed(1)} short of goal`}
              </div>
            ) : null}
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>
              Declined: {p.deferred.services.join(', ')} · RO {p.deferred.ro}{p.deferred.deferredBy ? ` · ${p.deferred.deferredBy}` : ''}
              {p.tags.length ? ` · ${p.tags.map(t => TAG_LABEL[t] || t).join(' ')}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#fed7aa' }}>{money(p.deferred.amount)}</div>
            <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{hrs(p.deferred.hours)}</div>
          </div>
        </div>
      )) : <div style={{ fontSize: 13, color: '#94a3b8' }}>No customer on today's book has declined work on file.</div>}
    </Section>
  );
}

// ── Manager: one card per advisor ─────────────────────────────────────────────
// Goal forecast (what today has to produce), today's book, and Big-Money —
// all from the facts, so the numbers are exact. Reports written before this
// existed have no `breakdown` and simply skip the section.
function Bar({ value, goal, color }) {
  const pct = goal > 0 ? Math.max(0, Math.min(100, (value / goal) * 100)) : 0;
  return (
    <div style={{ height: 7, borderRadius: 999, background: 'rgba(148,163,184,.18)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: color }} />
    </div>
  );
}
// Back-on-pace / hold-pace hours for today. Newer reports carry paceToday;
// older ones are worked out from the same facts (expected = MTD − aheadBy).
function paceFor(h) {
  if (!h) return null;
  if (h.paceToday != null) return h.paceToday;
  const t = Number(h.dailyTarget) || 0, ahead = Number(h.aheadBy) || 0, mtd = Number(h.mtd) || 0;
  if (!t) return null;
  if (!h.onPace) return Math.max(0, Math.round((t - ahead) * 10) / 10);
  const elapsed = Math.round((mtd - ahead) / t);
  return Math.round((elapsed > 0 ? mtd / elapsed : t) * 10) / 10;
}

function AdvisorBreakdown({ rows }) {
  if (!rows || !rows.length) return null;
  const k = { fontSize: 12, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: '#64748b' };

  const pct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;
  return (
    <Section icon="👥" title="Advisor breakdown" right={<span style={{ fontSize: 11.5, color: '#64748b', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>goal forecast · today's book · Big-Money</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
        {rows.map(r => {
          const h = r.hours || {};
          const a = r.appts;
          const b = r.bigMoney;
          const covers = h.hasGoal && a && a.goalHours > 0 ? Math.round((a.goalHours / Math.max(0.1, h.neededToday)) * 100) : null;
          return (
            <div key={r.advisor} style={{ background: 'rgba(2,6,23,.45)', border: '1px solid rgba(148,163,184,.2)', borderRadius: 16, padding: '20px 22px', display: 'grid', gap: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 1000, color: '#f8fafc' }}>{r.advisor}</span>
                {h.hasGoal && (
                  <span className="dw-pill" style={{ marginLeft: 'auto', fontSize: 13.5, padding: '4px 12px', color: h.onPace ? '#4ade80' : '#f87171', borderColor: h.onPace ? 'rgba(74,222,128,.5)' : 'rgba(248,113,113,.5)', background: h.onPace ? 'rgba(74,222,128,.1)' : 'rgba(248,113,113,.1)' }}>
                    {h.onPace ? `▲ ${Math.abs(h.aheadBy)} hrs ahead` : `▼ ${Math.abs(h.aheadBy)} hrs behind`}
                  </span>
                )}
              </div>

              {/* Goal forecast */}
              <div>
                <div style={k}>🎯 Goal forecast — needed today</div>
                {h.hasGoal ? (
                  <>
                    {(() => { const pv = paceFor(h); return pv != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, padding: '10px 14px', borderRadius: 12,
                        background: h.onPace ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)', border: `1px solid ${h.onPace ? 'rgba(74,222,128,.5)' : 'rgba(248,113,113,.55)'}` }}>
                        <span style={{ fontSize: 34, fontWeight: 1000, color: h.onPace ? '#86efac' : '#fca5a5', lineHeight: 1 }}>{Number(pv).toFixed(1)}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: h.onPace ? '#bbf7d0' : '#fecaca', lineHeight: 1.3 }}>
                          hrs today<br /><span style={{ fontSize: 12.5, fontWeight: 700, color: '#94a3b8' }}>{h.onPace ? 'to hold pace' : 'to get back on pace'}</span>
                        </span>
                      </div>
                    ) : null; })()}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
                      <span style={{ fontSize: 20, fontWeight: 1000, color: '#e2e8f0' }}>{h.neededToday}</span>
                      <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 700 }}>hrs/day to reach goal · {h.workingDaysLeft} day{h.workingDaysLeft === 1 ? '' : 's'} left</span>
                    </div>
                    <div style={{ fontSize: 14, color: '#cbd5e1', marginTop: 2 }}>MTD <b>{h.mtd}</b> / {h.goal} hrs ({h.percentOfGoal}%) · flat pace {h.dailyTarget}/day</div>
                    <Bar value={h.mtd} goal={h.goal} color={h.onPace ? '#22c55e' : '#f97316'} />
                  </>
                ) : <div style={{ fontSize: 14.5, color: '#64748b', marginTop: 4 }}>No hours goal set for this month.</div>}
              </div>

              {/* Today's book */}
              <div>
                <div style={k}>📅 Today's book</div>
                {a && a.total ? (
                  <div style={{ fontSize: 15, color: '#e2e8f0', marginTop: 4, lineHeight: 1.6 }}>
                    <b>{a.total}</b> appts · {a.waiters} waiter{a.waiters === 1 ? '' : 's'} · <span style={{ color: '#fde047' }}>{a.lof50} $50 LOF</span><br />
                    {a.withDeferred ? <><b style={{ color: '#fdba74' }}>{a.withDeferred}</b> with declined work · {money(a.deferredAmount)} · pickup <b style={{ color: '#86efac' }}>{a.goalHours} hrs</b>{covers != null ? <span style={{ color: covers >= 100 ? '#86efac' : '#94a3b8' }}> ({covers}% of today's need)</span> : null}</> : <span style={{ color: '#64748b' }}>No declined work on today's cars.</span>}
                  </div>
                ) : <div style={{ fontSize: 14.5, color: '#64748b', marginTop: 4 }}>Nothing booked.</div>}
              </div>

              {/* Big-Money */}
              <div>
                <div style={{ ...k, display: 'flex', alignItems: 'center', gap: 6 }}>💵 Big-Money
                  {r.contest ? <span style={{ marginLeft: 'auto', letterSpacing: 0, textTransform: 'none', fontSize: 13.5, color: r.contest.qualified ? '#4ade80' : '#fde047' }}>#{r.contest.rank} of {r.contest.of}{r.contest.qualified ? ' · qualified' : ''}</span> : null}
                </div>
                {b ? (
                  <div style={{ display: 'grid', gap: 7, marginTop: 4 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: '#e2e8f0' }}>
                        <span>Add-on Hrs/Ticket</span><span><b style={{ color: b.hitHrsRo ? '#4ade80' : '#fbbf24' }}>{b.hrsRo.toFixed(2)}</b> / {b.goalHrsRo || '—'}</span>
                      </div>
                      <Bar value={b.hrsRo} goal={b.goalHrsRo} color={b.hitHrsRo ? '#22c55e' : '#f59e0b'} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: '#e2e8f0' }}>
                        <span>Add-on Rate</span><span><b style={{ color: b.hitRate ? '#4ade80' : '#fbbf24' }}>{pct(b.rate)}</b> / {b.goalRate ? pct(b.goalRate) : '—'}</span>
                      </div>
                      <Bar value={b.rate} goal={b.goalRate} color={b.hitRate ? '#22c55e' : '#f59e0b'} />
                    </div>
                    <div style={{ fontSize: 13.5, color: '#94a3b8', lineHeight: 1.55 }}>
                      {b.tickets ? `${b.tickets} tickets · ${b.oilOnly} left oil-only. ` : ''}
                      {b.hitRate && b.hitHrsRo ? <span style={{ color: '#4ade80', fontWeight: 800 }}>Both goals hit.</span> : <>
                        {!b.hitRate && b.addonsNeeded > 0 ? <span style={{ color: '#fde047', fontWeight: 800 }}>{b.addonsNeeded} add-on tickets in a row reach {pct(b.goalRate)}. </span> : null}
                        {!b.hitHrsRo && b.hoursShort > 0 ? <span style={{ color: '#fde047', fontWeight: 800 }}>{b.hoursShort} add-on hrs short of {b.goalHrsRo}/RO.</span> : null}
                      </>}
                    </div>
                  </div>
                ) : <div style={{ fontSize: 14.5, color: '#64748b', marginTop: 4 }}>No $50 add-on numbers yet.</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── One advisor's briefing ───────────────────────────────────────────────────
function AdvisorReport({ report, name, onOpenPrep }) {
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

      <DashboardScorecards names={[name]} facts={f} date={(f.appointments && f.appointments.date) || f.date} onOpenPrep={onOpenPrep} />

      {contest.live ? (
        <Section icon="💵" title="Big-Money LOF">
          <div className="dw-stats" style={{ marginBottom: report.contest ? 14 : 0 }}>
            {contest.me ? (
              <>
                <Stat k="Your rank" v={`#${contest.me.rank}`} s={contest.me.qualified ? 'qualified' : 'not qualified yet'} tone={contest.me.qualified ? 'good' : 'warn'} />
                <Stat k="Add-on Hrs/Ticket" v={contest.me.hrsRo} s={contest.me.hrsRoGap > 0 ? `${contest.me.hrsRoGap} under the ${contest.goals.hrsRo} goal` : `goal ${contest.goals.hrsRo} — hit`} tone={contest.me.hrsRoGap > 0 ? 'warn' : 'good'} />
                <Stat k="$50 Add rate" v={`${Math.round(contest.me.rate * 100)}%`} s={contest.me.rateGap > 0 ? `${Math.round(contest.me.rateGap * 100)} points under goal` : 'goal hit'} tone={contest.me.rateGap > 0 ? 'warn' : 'good'} />
              </>
            ) : (
              <>
                <Stat k="Your rank" v="—" s="no standing on the board yet" tone="warn" />
                <Stat k="Add-on Hrs/Ticket goal" v={contest.goals.hrsRo} />
                <Stat k="$50 Add rate goal" v={`${Math.round(contest.goals.addRate * 100)}%`} />
              </>
            )}
            <Stat k="Days left" v={contest.daysLeft} s={contest.prize ? `${money(contest.prize)} on the line` : ''} />
          </div>
          {report.contest ? <div className="dw-quote">{report.contest}</div> : null}
          <BigMoneyCharts names={[firstUp(name)]} asOf={f.date} label="Your progress toward goal" />
        </Section>
      ) : null}

      <PickupSection appts={f.appointments} line={report.pickupLine} />



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

// ── Big-Money progress charts ────────────────────────────────────────────────
// The contest file (with its daily history) read straight off the site — the
// same charts as the Big-Money page, cut off at the report's date.
function useBigMoneyFile() {
  const [file, setFile] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchLiveJson('big-money-lof.json')
      .then(j => { if (!cancelled) setFile(j); });
    return () => { cancelled = true; };
  }, []);
  return file;
}
const goalsOf = (file) => {
  const g = (file && file.latest && file.latest.goals) || {};
  return { hrs_ro: Number(g.hrs_ro) || 0, add_rate: Number(g.add_rate) || 0 };
};
const firstUp = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
function BigMoneyCharts({ names, asOf, label }) {
  const file = useBigMoneyFile();
  const c = file && file.contest;
  if (!c || !c.start || !c.end || !file.history || !names.length) return null;
  const goals = goalsOf(file);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: '#e2e8f0' }}>📈 {label || 'Progress toward goal'}</span>
        <span style={{ fontSize: 11.5, color: '#64748b' }}>{CHART_LEGEND}</span>
      </div>
      <div style={{ display: 'grid', gap: 16 }}>
        {names.map(n => (
          <div key={n}>
            {names.length > 1 && <div style={{ fontSize: 15, fontWeight: 900, color: '#f1f5f9', marginBottom: 6 }}>{n}</div>}
            <BigMoneyAdvisorCharts file={file} name={n} goals={goals} asOf={asOf} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard scorecard ──────────────────────────────────────────────────────
// The advisor's row off the Shop TV's Advisor Performance table, live from the
// dashboard, dressed up to grab attention: a "goals hit" ring, then one tile per
// number with a progress ring to its goal. Same goals as the TV. A 👑 marks any
// number where they lead the team.
function useDashboardData() {
  const [d, setD] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchLiveJson('data.json')
      .then(j => { if (!cancelled) setD(j && j.data ? j.data : j); });
    return () => { cancelled = true; };
  }, []);
  return d;
}
// What it takes today. Rates are (sold ÷ base) month to date; the base is the
// RO count (or $50 tickets for the add-on numbers). Today adds T more —
// today's booked appointments (or $50 LOF tickets), else their average per
// workday. The DMS uses its own denominators, so these are close estimates.
// Today's book × each tile: the advisor's booked cars whose declined work
// (the deferred snapshot matched at DMS upload) includes that kind of sell.
// Valvoline services are the V-prefixed op codes (VVIFL, VVBFL, VVCFL…).
const OPP_MATCH = {
  align: i => /^ALIGN/i.test(i.code || '') || /ALIGNMENT/i.test(i.desc || ''),
  tires: i => /^TIRE\d/i.test(i.code || '') || /REPLACE .*TIRE/i.test(i.desc || ''),
  valvoline: i => /^V/i.test(i.code || ''),
  asr: () => true,
  hours_per_ro: () => true,
  roh50_add_rate: () => true,
  roh50_hrs_ro: () => true,
};
function useApptDay(date) {
  const [day, setDay] = useState(null);
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    fetchLiveJson(`appointments/${date}.json`)
      .then(j => { if (!cancelled) setDay(j); });
    return () => { cancelled = true; };
  }, [date]);
  return day;
}
function oppsFor(day, advisorFirst, key) {
  const match = OPP_MATCH[key];
  if (!day || !match || !Array.isArray(day.appts)) return [];
  const claims = day.claims || {};
  const lofOnly = key === 'roh50_add_rate' || key === 'roh50_hrs_ro';
  return day.appts
    .filter(a => a.deferred && ownerOf(a, claims) === advisorFirst)
    .filter(a => !lofOnly || apptTags(a).some(t => t.key === 'lof50'))
    .map(a => ({ a, items: (a.deferred.items || []).filter(i => i.code !== 'REC' && match(i)) }))
    .filter(x => x.items.length);
}
const oppHours = (o) => o.items.reduce((n, i) => n + (Number(i.h) || 0) * (Number(i.count) || 1), 0);

function SellPanel({ m, plan, onClose, opps = [], date, advisorFirst, onOpenPrep }) {
  const unit = (k) => (m.unit ? m.unit[k === 1 ? 0 : 1] : 'hrs');
  const baseWord = m.base === 'lof' ? '$50 tickets' : 'ROs';
  const todayWord = m.base === 'lof' ? `${plan.T} $50 LOF${plan.T === 1 ? '' : 's'} today` : `${plan.T} RO${plan.T === 1 ? '' : 's'} today`;
  const good = plan.hit;
  const reachable = plan.kind === 'hours' || plan.need <= plan.T;
  return (
    <div style={{ gridColumn: '1 / -1', borderRadius: 16, padding: '16px 18px', position: 'relative',
      background: good ? 'linear-gradient(120deg,rgba(34,197,94,.18),rgba(56,189,248,.08))' : 'linear-gradient(120deg,rgba(250,204,21,.16),rgba(239,68,68,.10))',
      border: `1px solid ${good ? 'rgba(74,222,128,.55)' : 'rgba(250,204,21,.55)'}`, boxShadow: `0 0 26px -8px ${good ? 'rgba(74,222,128,.8)' : 'rgba(250,204,21,.8)'}` }}>
      <button onClick={onClose} style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}>×</button>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: '#94a3b8' }}>{m.label} · what it takes today</div>
      {good ? (
        <div style={{ fontSize: 22, fontWeight: 1000, color: '#86efac', marginTop: 6 }}>
          ✓ At goal. {plan.kind === 'hours'
            ? <>Cushion today: {plan.cushion.toFixed(1)} hrs over goal across {todayWord}.</>
            : <>You can write {plan.cushion} more {baseWord} with no {unit(1)} and still hold {m.fmt(m.goal)}.</>}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ fontSize: 44, fontWeight: 1000, color: '#fde047', lineHeight: 1, textShadow: '0 0 18px rgba(250,204,21,.6)' }}>
            {plan.kind === 'hours' ? plan.need.toFixed(1) : plan.need}
          </span>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#f8fafc' }}>
            {plan.kind === 'hours' ? `hrs to sell today across ${todayWord.replace(' today', '')}` : `${unit(plan.need)} to sell today`} → {m.fmt(m.goal)}
          </span>
          {!reachable ? <span style={{ fontSize: 14, fontWeight: 800, color: '#fca5a5' }}>More than today's {plan.T} {baseWord} — sell on every one and you reach {m.fmt(plan.all)}.</span> : null}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {plan.ladder.map(x => {
          const ok = x.r >= m.goal - 1e-9;
          return (
            <span key={x.k} style={{ padding: '6px 11px', borderRadius: 999, fontSize: 13.5, fontWeight: 900,
              background: ok ? 'rgba(74,222,128,.18)' : 'rgba(148,163,184,.12)', border: `1px solid ${ok ? 'rgba(74,222,128,.6)' : 'rgba(148,163,184,.3)'}`, color: ok ? '#86efac' : '#e2e8f0' }}>
              {plan.kind === 'hours' ? `+${x.k} hrs` : `Sell ${x.k}`} → {m.fmt(x.r)}{ok ? ' ✓' : ''}
            </span>
          );
        })}
      </div>
      {opps.length ? (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(148,163,184,.2)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 1000, color: '#fde047', textShadow: '0 0 12px rgba(250,204,21,.5)' }}>
              🔥 {opps.length} car{opps.length === 1 ? '' : 's'} on today's book already declined this
            </span>
            {onOpenPrep && date ? (
              <button onClick={() => onOpenPrep(advisorFirst, date)}
                style={{ marginLeft: 'auto', background: 'linear-gradient(180deg,#38bdf8,#0369a1)', border: '1px solid rgba(125,211,252,.7)', color: '#fff', fontWeight: 900, fontSize: 13, borderRadius: 10, padding: '7px 14px', cursor: 'pointer', boxShadow: '0 0 14px -2px rgba(56,189,248,.7)' }}>
                📋 Open today's prep sheet →
              </button>
            ) : null}
          </div>
          <div style={{ display: 'grid', gap: 7 }}>
            {opps.map(({ a, items }) => (
              <div key={a.apptNo || a.customer + a.time} onClick={onOpenPrep && date ? () => onOpenPrep(advisorFirst, date) : undefined}
                style={{ display: 'grid', gridTemplateColumns: '78px 1fr auto', gap: 12, alignItems: 'center', padding: '9px 12px', borderRadius: 11, cursor: onOpenPrep && date ? 'pointer' : 'default',
                  background: 'rgba(2,6,23,.5)', border: '1px solid rgba(250,204,21,.3)' }}>
                <span style={{ fontSize: 13.5, fontWeight: 900, color: '#7dd3fc' }}>{a.time}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#f1f5f9' }}>{a.customer} <span style={{ fontWeight: 700, color: '#94a3b8', fontSize: 12.5 }}>· {a.vehicle}</span></div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {items.map((i, k) => (
                      <span key={k} style={{ fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, background: 'rgba(250,204,21,.12)', border: '1px solid rgba(250,204,21,.4)', color: '#fef08a' }}>
                        {(i.desc || i.code).toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}{i.count > 1 ? ` ×${i.count}` : ''}{i.price ? ` · $${Math.round(i.price)}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#86efac', whiteSpace: 'nowrap' }}>{oppHours({ items }).toFixed(1)} hrs</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#64748b', fontWeight: 700 }}>No car on today's book has declined {m.label.toLowerCase()} work on file — this one comes from fresh recommendations.</div>
      )}
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>
        Based on {plan.N} {baseWord} month to date plus {todayWord}{plan.kind === 'count' && plan.perSell ? ` · each sell ≈ +${(plan.perSell * 100).toFixed(1)} pts` : ''}. The DMS counts on its own base, so treat these as close estimates.
      </div>
    </div>
  );
}

const SELL_IN_RING = new Set(['align', 'tires', 'valvoline']);
function Scorecard({ data, advisor, team, today = {}, day = null, date, onOpenPrep }) {
  const [open, setOpen] = useState(null);
  const me = firstUp(advisor.name);
  const metrics = scoreMetrics(data);
  const val = (a, k) => Number(a && a[k]) || 0;
  const rows = metrics.map(m => {
    const v = val(advisor, m.key);
    const hit = v >= m.goal - 1e-9;
    const best = team.length > 1 && team.every(o => o === advisor || val(o, m.key) < v) && v > 0;
    return { ...m, v, hit, best };
  });
  const hits = rows.filter(r => r.hit).length;
  const share = rows.length ? hits / rows.length : 0;
  const ringCol = share >= 0.75 ? '#4ade80' : share >= 0.45 ? '#facc15' : '#f87171';
  const daily = advisorDailyAverage(advisor, data);
  // Month-end pace: daily average × the month's workdays (same as the dashboard).
  const pace = advisorProjectedHours(advisor, data);
  const lastMonth = Number(advisor.last_month_total) || 0;
  const big = (k, v, sub, color = '#f8fafc') => (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: '#64748b' }}>{k}</div>
      <div style={{ fontSize: 30, fontWeight: 1000, color, lineHeight: 1.1 }}>{v}</div>
      {sub ? <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>{sub}</div> : null}
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', padding: '14px 18px', borderRadius: 16, marginBottom: 14,
        background: 'linear-gradient(120deg,rgba(56,189,248,.14),rgba(168,85,247,.10) 55%,rgba(250,204,21,.08))', border: '1px solid rgba(125,211,252,.3)' }}>
        <Ring frac={share} color={ringCol} size={104} stroke={10}>
          <div style={{ fontSize: 30, fontWeight: 1000, color: ringCol, lineHeight: 1 }}>{hits}<span style={{ fontSize: 16, color: '#94a3b8' }}>/{rows.length}</span></div>
          <div style={{ fontSize: 9.5, fontWeight: 900, color: '#94a3b8', letterSpacing: '.08em' }}>GOALS HIT</div>
        </Ring>
        {big('Daily avg', daily.toFixed(1), 'hrs / workday')}
        {big('MTD hrs', (Number(advisor.mtd_hours) || 0).toFixed(1), `${Number(advisor.ro_count) || 0} ROs`)}
        {big('Pacing', pace.toFixed(1), lastMonth > 0 ? `${pace >= lastMonth ? '▲' : '▼'} ${Math.abs(pace - lastMonth).toFixed(1)} vs last month` : 'hrs this month',
          lastMonth > 0 ? (pace >= lastMonth ? '#4ade80' : '#f87171') : '#f8fafc')}
        {big('Last month', lastMonth.toFixed(1), 'hrs total', '#cbd5e1')}
        <div style={{ flex: 1, minWidth: 160, fontSize: 15, fontWeight: 800, color: '#e2e8f0', lineHeight: 1.45 }}>
          {hits === rows.length ? '🔥 Every goal on the board is hit. Keep it there.'
            : hits === 0 ? '🎯 Nothing green yet — pick one tile and turn it today.'
            : <>🎯 {rows.length - hits} to turn green. Closest: <span style={{ color: '#fde047' }}>{(() => {
                const miss = rows.filter(r => !r.hit).sort((a, b) => (b.v / b.goal) - (a.v / a.goal))[0];
                return miss ? `${miss.label} (${miss.gap(miss.goal - miss.v)} away)` : '';
              })()}</span></>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, gap: 9 }}>
        {rows.map(r => {
          const col = r.hit ? '#4ade80' : r.v / r.goal >= 0.85 ? '#facc15' : '#f87171';
          return (
            <div key={r.key} className={`sc-tile ${r.hit ? 'hit' : 'miss'}`}
              onClick={sellPlan(r, advisor, today) ? () => setOpen(o => (o === r.key ? null : r.key)) : undefined}
              title={sellPlan(r, advisor, today) ? 'Click: how many sells today' : undefined}
              style={{ cursor: sellPlan(r, advisor, today) ? 'pointer' : 'default', outline: open === r.key ? '2px solid #fde047' : 'none', outlineOffset: 2 }}>
              {r.best ? <span className="sc-crown" title="Best on the team">👑</span> : null}
              <div className="lbl">{r.label}</div>
              <Ring frac={r.v / r.goal} color={col} size={78} stroke={7}>
                {(() => {
                  // Alignment / Tires / Valvoline under goal: the circle shows
                  // how many to sell today to be back at goal; at goal, the %.
                  const plan = !r.hit && SELL_IN_RING.has(r.key) ? sellPlan(r, advisor, today) : null;
                  return plan && plan.need > 0 ? (
                    <div title={`Currently ${r.fmt(r.v)} — sell ${plan.need} today to be back at ${r.fmt(r.goal)}`} style={{ lineHeight: 1 }}>
                      <div style={{ fontSize: 22, fontWeight: 1000, color: col }}>{plan.need}</div>
                      <div style={{ fontSize: 8.5, fontWeight: 900, color: '#94a3b8', letterSpacing: '.06em', marginTop: 2 }}>TO SELL</div>
                    </div>
                  ) : <div style={{ fontSize: 17, fontWeight: 1000, color: col }}>{r.fmt(r.v)}</div>;
                })()}
              </Ring>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>goal {r.fmt(r.goal)}</div>
              <div style={{ marginTop: 5, marginBottom: 8, minHeight: 32, fontSize: 12.5, fontWeight: 900, lineHeight: 1.25, color: r.hit ? '#86efac' : '#fca5a5' }}>
                {r.hit ? '✓ HIT' : `▼ ${r.gap(r.goal - r.v)} to go`}
              </div>
              {(() => {
                if (!sellPlan(r, advisor, today)) return null;
                const n = oppsFor(day, me, r.key).length;
                // Pinned to the bottom of the tile (marginTop auto) so every
                // tile's badge sits on the same line whatever wraps above it.
                return n ? (
                  <div title={`${n} car${n === 1 ? '' : 's'} on today's book already declined this`}
                    style={{ marginTop: 'auto', fontSize: 11, fontWeight: 900, color: '#1c1917', background: 'linear-gradient(180deg,#fde047,#f59e0b)', borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap', boxShadow: '0 0 10px rgba(250,204,21,.7)' }}>
                    🔥 {n} ON BOOK
                  </div>
                ) : <div style={{ marginTop: 'auto', fontSize: 10.5, fontWeight: 800, color: '#7dd3fc', padding: '4px 0', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>👆 TAP FOR TODAY</div>;
              })()}
            </div>
          );
        })}
        {open && (() => { const m = rows.find(r => r.key === open); const plan = m && sellPlan(m, advisor, today); return plan ? <SellPanel m={m} plan={plan} onClose={() => setOpen(null)} opps={oppsFor(day, me, m.key)} date={date} advisorFirst={me} onOpenPrep={onOpenPrep} /> : null; })()}
      </div>
    </div>
  );
}
// Today's game — the advisor report's headline numbers (from the report facts),
// as glowing chips on top of the scorecard.
const TS_CSS = `
@keyframes tsPulseR{0%,100%{box-shadow:0 0 0 1px rgba(248,113,113,.35),0 0 16px -6px rgba(248,113,113,.6)}50%{box-shadow:0 0 0 1px rgba(248,113,113,.7),0 0 26px -4px rgba(248,113,113,.85)}}
@keyframes tsPulseG{0%,100%{box-shadow:0 0 0 1px rgba(74,222,128,.35),0 0 16px -6px rgba(74,222,128,.55)}50%{box-shadow:0 0 0 1px rgba(74,222,128,.65),0 0 26px -4px rgba(74,222,128,.8)}}
.ts-chip{position:relative;border-radius:16px;padding:13px 14px 12px;overflow:hidden;border:1px solid rgba(148,163,184,.2);
  background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.015))}
.ts-chip.r{animation:tsPulseR 2.2s ease-in-out infinite;background:linear-gradient(160deg,rgba(239,68,68,.16),rgba(239,68,68,.03))}
.ts-chip.g{animation:tsPulseG 2.6s ease-in-out infinite;background:linear-gradient(160deg,rgba(34,197,94,.16),rgba(34,197,94,.03))}
.ts-chip.a{border-color:rgba(250,204,21,.5);background:linear-gradient(160deg,rgba(250,204,21,.13),rgba(250,204,21,.02))}
.ts-chip.b{border-color:rgba(56,189,248,.45);background:linear-gradient(160deg,rgba(56,189,248,.14),rgba(56,189,248,.02))}
.ts-chip .ic{position:absolute;right:10px;top:8px;font-size:22px;opacity:.9;filter:drop-shadow(0 0 6px rgba(255,255,255,.25))}
.ts-chip .k{font-size:10.5px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:#94a3b8;padding-right:26px}
.ts-chip .v{font-size:30px;font-weight:1000;line-height:1.1;margin-top:4px}
.ts-chip .s{font-size:12px;font-weight:700;color:#94a3b8;margin-top:3px;line-height:1.35}
`;
function TodayStrip({ facts }) {
  const f = facts || {};
  const h = f.hours || {};
  const ro = f.openRos || {};
  const chips = [];
  if (h.hasGoal) {
    const pv = paceFor(h);
    chips.push({ ic: '🎯', k: h.onPace ? 'Hours today · hold pace' : 'Hours today · back on pace', v: pv != null ? Number(pv).toFixed(1) : h.neededToday,
      s: `${h.neededToday}/day to finish on ${h.goal}`, tone: h.onPace ? 'g' : 'r', color: h.onPace ? '#86efac' : '#fca5a5' });
    chips.push({ ic: '📅', k: 'Month to date', v: h.mtd, s: `${h.percentOfGoal}% of goal · ${h.workingDaysLeft} days left`, tone: 'b', color: '#f8fafc', bar: Math.min(1, (Number(h.mtd) || 0) / (Number(h.goal) || 1)) });
    chips.push({ ic: h.onPace ? '🚀' : '⚡', k: 'Pace', v: `${h.onPace ? '+' : ''}${h.aheadBy}`, s: h.onPace ? 'hours ahead of pace' : 'hours behind pace', tone: h.onPace ? 'g' : 'r', color: h.onPace ? '#4ade80' : '#f87171' });
  }
  const old = ro.buckets && ro.buckets.days6plus;
  chips.push({ ic: '🔧', k: 'Open ROs', v: ro.total || 0, s: ro.total ? `oldest ${ro.oldestDays} days · avg ${ro.averageDays}` : 'nothing open', tone: old ? 'a' : 'g', color: old ? '#fde047' : '#4ade80' });
  if (f.partsReady && f.partsReady.length) chips.push({ ic: '📦', k: 'Parts in, ready to book', v: f.partsReady.length, s: 'hours sitting on the shelf', tone: 'g', color: '#4ade80' });
  if (f.deferred && f.deferred.total) chips.push({ ic: '💰', k: 'Declined work, never called', v: money(f.deferred.totalAmount), s: `${f.deferred.neverContacted} customers · ${f.deferred.totalHours} hours`, tone: 'a', color: '#fde047' });
  if (!chips.length) return null;
  return (
    <>
      <style>{TS_CSS}</style>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(chips.length, 6)}, minmax(0, 1fr))`, gap: 10, marginBottom: 14 }}>
        {chips.map(c => (
          <div key={c.k} className={`ts-chip ${c.tone}`}>
            <span className="ic">{c.ic}</span>
            <div className="k">{c.k}</div>
            <div className="v" style={{ color: c.color }}>{c.v}</div>
            {c.bar != null ? (
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(148,163,184,.18)', margin: '6px 0 2px', overflow: 'hidden' }}>
                <div style={{ width: `${c.bar * 100}%`, height: '100%', background: 'linear-gradient(90deg,#38bdf8,#a78bfa)', boxShadow: '0 0 8px #38bdf8' }} />
              </div>
            ) : null}
            <div className="s">{c.s}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// Today's expected volume for the sell planner: booked appointments / $50 LOFs
// when the report has them, else the month's average per workday so far.

function DashboardScorecards({ names, facts, appts = {}, date, onOpenPrep }) {
  const data = useDashboardData();
  const day = useApptDay(date);
  const team = data ? advisorsForDisplay(data).filter(a => !a.hidden) : [];
  const list = names.map(n => team.find(a => firstUp(a.name) === firstUp(n))).filter(Boolean);
  if (!list.length && !facts) return null;
  if (!list.length) {
    return (
      <Section icon="📊" title="Your dashboard scorecard">
        <TodayStrip facts={facts} />
      </Section>
    );
  }
  return (
    <Section icon="📊" title={list.length > 1 ? 'Dashboard scorecards' : 'Your dashboard scorecard'}
      right={<span style={{ fontSize: 11.5, color: '#64748b', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>live from the Shop TV</span>}>
      <style>{SC_CSS}</style>
      {facts ? <TodayStrip facts={facts} /> : null}
      <div style={{ display: 'grid', gap: 22 }}>
        {list.map(a => (
          <div key={a.name}>
            {list.length > 1 && <div style={{ fontSize: 19, fontWeight: 1000, color: '#f8fafc', marginBottom: 8 }}>{firstUp(a.name)}</div>}
            <Scorecard data={data} advisor={a} team={team} day={day} date={date} onOpenPrep={onOpenPrep} today={todayCounts(a, data, (facts && facts.appointments) || appts[firstUp(a.name)], facts && facts.hours)} />
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── One box per technician ───────────────────────────────────────────────────
// This week's flagged hours vs their weekly goal, the hours still needed, and
// an efficiency gauge = average goal % of their last two COMPLETED pay weeks
// (same rule as the tech Performance Report gauges: total ÷ goal per week).
const r1 = (n) => (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
const ceil1 = (n) => (Math.ceil((Number(n) || 0) * 10 - 1e-9) / 10).toFixed(1);
function TechBoxes({ list, asOf }) {
  const eff = useTwoWeekEfficiency(list.map(x => x.name), asOf);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
      {list.map(x => {
        const goal = Number(x.goal) || 0, total = Number(x.total) || 0;
        const need = Math.max(0, goal - total);
        const met = goal > 0 && need <= 0;
        const pct = goal > 0 ? total / goal : 0;
        const col = met ? '#4ade80' : pct >= 0.5 ? '#fde047' : '#fca5a5';
        const e = eff[x.name];
        return (
          <div key={x.name} style={{ background: 'rgba(2,6,23,.45)', border: `1px solid ${col}55`, borderRadius: 14, padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9', letterSpacing: .4 }}>{x.name}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: col, marginTop: 4 }}>
                {r1(total)}<span style={{ fontSize: 15, color: '#94a3b8', fontWeight: 700 }}> / {r1(goal)} hrs</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'rgba(148,163,184,.16)', margin: '8px 0 9px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', background: col }} />
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: met ? '#86efac' : '#fecaca' }}>
                {met ? `✓ Goal met · +${r1(total - goal)} hrs` : `Needs ${ceil1(need)} hrs to goal`}
              </div>
              {x.pacing != null && goal > 0 ? (() => {
                const pace = Number(x.pacing) || 0, ok = pace >= goal;
                return (
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#94a3b8', marginTop: 4 }} title="Where this week lands at the current daily pace">
                    📈 Pacing <span style={{ color: ok ? '#4ade80' : '#fbbf24' }}>{r1(pace)} hrs</span>
                    <span style={{ color: ok ? '#86efac' : '#fca5a5' }}> ({ok ? '+' : '−'}{r1(Math.abs(pace - goal))})</span>
                  </div>
                );
              })() : null}
            </div>
            <div style={{ textAlign: 'center', flexShrink: 0 }} title={e ? `Average goal % over the last ${e.weeks} completed week${e.weeks === 1 ? '' : 's'}` : 'No completed weeks on file yet'}>
              <MiniGauge pct={e ? e.pct : null} />
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, marginTop: -2 }}>2-wk efficiency</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── The manager's shop-wide report ───────────────────────────────────────────
function ManagerReport({ report, onOpenPrep, goalForecast }) {
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

      {/* The live Goal Forecast board — same component and saves as the Goal
          Forecast page, so the morning read is all in one place. */}
      {goalForecast ? <Section icon="📈" title="Goal Forecast">{goalForecast}</Section> : null}

      <DashboardScorecards names={(f.breakdown || []).map(r => r.advisor)} date={(f.appointments && f.appointments.date) || f.date} onOpenPrep={onOpenPrep}
        appts={Object.fromEntries((f.breakdown || []).map(r => [firstUp(r.advisor), r.appts || {}]))} />

      <AdvisorBreakdown rows={f.breakdown} />

      {f.contest && f.contest.live && (f.breakdown || []).length ? (
        <Section icon="💵" title="Big-Money LOF — every advisor">
          <BigMoneyCharts names={(f.breakdown || []).map(r => firstUp(r.advisor))} asOf={f.date} label="Progress toward goal" />
        </Section>
      ) : null}

      {report.technicians ? (
        <Section icon="🔧" title="The shop floor">
          <div className="dw-quote" style={{ marginBottom: t.list && t.list.length ? 14 : 0 }}>{report.technicians}</div>
          {t.list && t.list.length ? <TechBoxes list={t.list} asOf={f.date} /> : null}
        </Section>
      ) : null}

      <PickupSection appts={f.appointments} line={report.appointmentsLine} shop />

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

      {report.closing ? (
        <div className="dw-card" style={{ background: 'linear-gradient(135deg,rgba(250,204,21,.12),rgba(56,189,248,.08))', borderColor: 'rgba(250,204,21,.35)' }}>
          <div className="dw-quote" style={{ borderLeftColor: 'rgba(250,204,21,.7)', color: '#fef3c7' }}>{report.closing}</div>
        </div>
      ) : null}
    </>
  );
}

export default function DailyWrench({ currentUser, currentRole, onBack, onOpenPrep, goalForecast }) {
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

  // The workflow takes a couple of minutes; poll until the file for today
  // appears with a newer timestamp than the one we already have. Keep going for
  // up to 12 minutes so a slow run still opens by itself, no refresh needed.
  async function generate() {
    if (!isManager || busy) return;
    const before = doc && doc.generatedAt;
    setBusy(true); setStatus('📝 Writing this morning\'s reports — usually about 2 minutes…');
    try {
      await requestDailyWrench(currentUser, 'manager pressed Generate');
      trackAction('daily-wrench-generate');
      const key = todayKey();
      const started = Date.now();
      while (Date.now() - started < 12 * 60 * 1000) {
        await new Promise(r => setTimeout(r, 10000));
        const mins = Math.floor((Date.now() - started) / 60000);
        if (mins >= 2) setStatus(`📝 Still writing — ${mins} min so far. It will open here by itself.`);
        const fresh = await loadDailyWrench(key);
        if (fresh && fresh.generatedAt && fresh.generatedAt !== before) {
          setDay(key); setDoc(fresh); setStatus('✅ Fresh reports are up.');
          loadDailyWrenchIndex().then(ix => setIndex(ix || { days: {} })).catch(() => {});
          return;
        }
      }
      setStatus('⏳ This is taking longer than usual. Refresh in a few minutes, or press Generate again.');
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
            doc.manager ? <ManagerReport report={doc.manager} onOpenPrep={onOpenPrep} goalForecast={goalForecast} />
              : <div className="dw-card" style={{ textAlign: 'center', color: '#94a3b8', padding: 30 }}>No shop report in this day's file.</div>
          )}

          {!loading && doc && view !== 'manager' && (
            shown ? <AdvisorReport report={shown} name={shownName} onOpenPrep={onOpenPrep} />
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
