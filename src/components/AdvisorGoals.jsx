import React, { useEffect, useMemo, useRef, useState } from 'react';
import { safe } from '../utils/formatters';
import { advisorMonthProgress } from '../utils/calculations';
import { loadAdvisorGoals, saveAdvisorGoalsMonth } from '../utils/github';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const num = (n, dec = 1) => safe(n, 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// Non-Sunday working dates for a month.
function workingDates(year, month) {
  const dim = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let d = 1; d <= dim; d++) {
    if (new Date(year, month, d).getDay() !== 0) out.push(new Date(year, month, d));
  }
  return out;
}

const dKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// Derive everything for one month bucket.
function computeMetrics(mkStr, bucket, totalDaysOverride, completedOverride) {
  const [y, m] = String(mkStr).split('-').map(Number);
  const dates = workingDates(y, (m || 1) - 1);
  const totalDays = totalDaysOverride || dates.length;
  const hoursGoal = safe(bucket && bucket.hoursGoal, 0);
  const hrsRoGoal = safe(bucket && bucket.hrsRoGoal, 0);
  const days = (bucket && bucket.days) || {};
  let cumHours = 0;
  let dayNum = 0;
  const rows = dates.map(dt => {
    dayNum += 1;
    const k = dKey(dt);
    const has = Object.prototype.hasOwnProperty.call(days, k);
    const hours = has ? safe(days[k].hours, 0) : null;
    const hrsRo = has ? safe(days[k].hrsRo, 0) : null;
    if (has) cumHours += safe(hours, 0);
    return { k, dt, dayNum, has, hours, hrsRo, cumHours: has ? cumHours : null, goalCum: (hoursGoal / Math.max(totalDays, 1)) * dayNum };
  });
  const enteredDays = rows.filter(r => r.has).length;
  const completedDays = completedOverride != null ? completedOverride : enteredDays;
  const actualHours = cumHours;
  const dailyHoursTarget = hoursGoal / Math.max(totalDays, 1);
  const expectedHours = dailyHoursTarget * completedDays;
  const runRate = completedDays > 0 ? actualHours / completedDays : 0;
  const projectedHours = runRate * totalDays;
  const hrsRoVals = rows.filter(r => r.has).map(r => safe(r.hrsRo, 0));
  const avgHrsRo = hrsRoVals.length ? hrsRoVals.reduce((a, b) => a + b, 0) / hrsRoVals.length : 0;
  const label = new Date(y, (m || 1) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return { label, dates, totalDays, hoursGoal, hrsRoGoal, days, rows, enteredDays, completedDays, actualHours, dailyHoursTarget, expectedHours, projectedHours, avgHrsRo };
}

// ── Goal-vs-Actual line chart (dotted goal, solid actual) ────────────────────
function GoalChart({ title, unit, goalPts, actualPts, maxVal, xLabels, x, y, lastLabel }) {
  return (
    <div style={{ marginTop: 18, background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</div>
        <div style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}><span style={{ width: 22, borderTop: '3px solid #34d399', display: 'inline-block' }} />Actual</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}><span style={{ width: 22, borderTop: '3px dashed #6ee7f9', display: 'inline-block' }} />Goal</span>
      </div>
      <svg viewBox="0 0 1000 320" width="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        {[0, 1, 2, 3, 4].map(i => {
          const tv = (maxVal / 4) * i;
          return (
            <g key={i}>
              <line x1={70} y1={y(tv)} x2={980} y2={y(tv)} stroke="rgba(148,163,184,.14)" />
              <text x={60} y={y(tv) + 4} textAnchor="end" fontSize="11" fill="#64748b">{num(tv, unit === 'hrs/ro' ? 2 : 0)}</text>
            </g>
          );
        })}
        {xLabels.map(r => <text key={r.k} x={x(r.dayNum)} y={296} textAnchor="middle" fontSize="11" fill="#64748b">{r.dt.getMonth() + 1}/{r.dt.getDate()}</text>)}
        {goalPts && <polyline points={goalPts} fill="none" stroke="#6ee7f9" strokeWidth="2" strokeDasharray="6 5" opacity="0.95" />}
        {actualPts && <polyline points={actualPts} fill="none" stroke="#34d399" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />}
        {lastLabel && <text x={lastLabel.x} y={lastLabel.y - 12} textAnchor="middle" fontSize="12" fontWeight="800" fill="#34d399">{lastLabel.text}</text>}
      </svg>
    </div>
  );
}

const cardSt = { flex: 1, minWidth: 150, background: 'rgba(2,6,23,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '12px 16px' };
const lblSt = { fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' };
const inpSt = { background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 8, padding: '7px 10px', fontSize: 14, fontWeight: 700, color: '#e2e8f0', width: 110, textAlign: 'right', outline: 'none' };

export default function AdvisorGoals({ currentUser, currentRole, advisors = [], onBack, backLabel = '← Appointment Prep Calendar' }) {
  const me = (currentUser || '').toUpperCase();
  const isAdmin = currentRole === 'admin' || (currentRole || '').includes('manager');
  const canEditGoals = isAdmin || currentRole === 'lead advisor';
  const roster = advisors.length ? advisors : (me ? [me] : []);
  const now = new Date();
  const mk = monthKey(now);

  const [selected, setSelected] = useState(roster.includes(me) ? me : (roster[0] || me));
  const [view, setView] = useState('current'); // current | history
  const [histSel, setHistSel] = useState(null);
  const [allMonths, setAllMonths] = useState({});
  const [gridOpen, setGridOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const canEditDaysFor = (adv) => isAdmin || me === (adv || '').toUpperCase();
  const isMine = me === (selected || '').toUpperCase();

  // Working-day calendar (shared dashboard setting, like the manager forecast).
  const progress = advisorMonthProgress({});
  const totalDays = progress.total || workingDates(now.getFullYear(), now.getMonth()).length;
  const completedDays = Math.min(progress.completed || 0, totalDays);

  const saveTimer = useRef(null);
  const bucketRef = useRef({ hoursGoal: 0, hrsRoGoal: 0, days: {} });
  const [bucket, setBucket] = useState({ hoursGoal: 0, hrsRoGoal: 0, days: {} });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setView('current'); setHistSel(null);
    loadAdvisorGoals(selected).then(all => {
      if (cancelled) return;
      setAllMonths(all || {});
      const b = (all && all[mk]) || { hoursGoal: 0, hrsRoGoal: 0, days: {} };
      const norm = { hoursGoal: safe(b.hoursGoal, 0), hrsRoGoal: safe(b.hrsRoGoal, 0), days: b.days || {} };
      bucketRef.current = norm;
      setBucket(norm);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, mk]);

  // Debounced, conflict-aware save: reload the latest bucket and only overwrite
  // the parts this user is allowed to change (goals for lead, days for owner).
  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const mine = bucketRef.current;
      let latest = {};
      try { const all = await loadAdvisorGoals(selected); latest = (all && all[mk]) || {}; } catch {}
      const merged = {
        hoursGoal: canEditGoals ? safe(mine.hoursGoal, 0) : safe(latest.hoursGoal, 0),
        hrsRoGoal: canEditGoals ? safe(mine.hrsRoGoal, 0) : safe(latest.hrsRoGoal, 0),
        days: canEditDaysFor(selected) ? mine.days : (latest.days || {}),
      };
      saveAdvisorGoalsMonth(selected, mk, merged).then(all => setAllMonths(all || {})).catch(() => {});
    }, 800);
  }

  function setGoal(field, val) {
    const next = { ...bucketRef.current, [field]: val };
    bucketRef.current = next; setBucket(next); scheduleSave();
  }
  function setDay(dateKey, field, val) {
    const days = { ...(bucketRef.current.days || {}) };
    const cur = { ...(days[dateKey] || {}) };
    if (val === '' || val == null) { delete cur[field]; }
    else cur[field] = safe(val, 0);
    if (Object.keys(cur).length === 0) delete days[dateKey]; else days[dateKey] = cur;
    const next = { ...bucketRef.current, days };
    bucketRef.current = next; setBucket(next); scheduleSave();
  }

  const M = useMemo(() => computeMetrics(mk, bucket, totalDays, completedDays), [mk, bucket, totalDays, completedDays]);

  // Chart geometry helpers.
  function makeCharts(metrics) {
    const W = 1000, padL = 70, padR = 20, padT = 16, padB = 40, plotW = W - padL - padR, plotH = 320 - padT - padB;
    const n = Math.max(metrics.totalDays, 1);
    const x = (dayNum) => padL + (plotW * (dayNum - 1)) / Math.max(n - 1, 1);
    // HOURS cumulative
    const maxH = Math.max(metrics.hoursGoal, metrics.actualHours, metrics.dailyHoursTarget * n, 1) * 1.1;
    const yH = (v) => padT + plotH - (plotH * Math.max(v, 0)) / maxH;
    const hoursGoalPts = metrics.rows.map(r => `${x(r.dayNum).toFixed(1)},${yH(r.goalCum).toFixed(1)}`).join(' ');
    const entered = metrics.rows.filter(r => r.has);
    const hoursActualPts = entered.map(r => `${x(r.dayNum).toFixed(1)},${yH(r.cumHours).toFixed(1)}`).join(' ');
    const lastH = entered.length ? entered[entered.length - 1] : null;
    // HRS/RO daily
    const maxR = Math.max(metrics.hrsRoGoal, ...metrics.rows.filter(r => r.has).map(r => safe(r.hrsRo, 0)), 1) * 1.2;
    const yR = (v) => padT + plotH - (plotH * Math.max(v, 0)) / maxR;
    const roGoalPts = metrics.rows.map(r => `${x(r.dayNum).toFixed(1)},${yR(metrics.hrsRoGoal).toFixed(1)}`).join(' ');
    const roActualPts = entered.map(r => `${x(r.dayNum).toFixed(1)},${yR(safe(r.hrsRo, 0)).toFixed(1)}`).join(' ');
    const lastR = entered.length ? entered[entered.length - 1] : null;
    const xLabels = metrics.rows.filter((r, i) => i % 5 === 0 || i === metrics.rows.length - 1);
    return {
      hours: { goalPts: hoursGoalPts, actualPts: hoursActualPts, maxVal: maxH, x, y: yH, xLabels, lastLabel: lastH && { x: x(lastH.dayNum), y: yH(lastH.cumHours), text: num(lastH.cumHours, 1) } },
      ro: { goalPts: roGoalPts, actualPts: roActualPts, maxVal: maxR, x, y: yR, xLabels, lastLabel: lastR && { x: x(lastR.dayNum), y: yR(safe(lastR.hrsRo, 0)), text: num(safe(lastR.hrsRo, 0), 2) } },
    };
  }

  const charts = makeCharts(M);

  const renderDetail = (metrics, ch, editable) => (
    <>
      {/* Goals + summary */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={cardSt}>
          <div style={lblSt}>Hours Goal</div>
          {editable.goals ? (
            <input type="number" inputMode="decimal" style={{ ...inpSt, color: '#6ee7b7', width: 120, marginTop: 4 }} value={metrics.hoursGoal || ''} placeholder="0" onChange={e => setGoal('hoursGoal', e.target.value)} />
          ) : <div style={{ fontSize: 22, fontWeight: 800, color: '#6ee7b7', marginTop: 3 }}>{num(metrics.hoursGoal, 1)}</div>}
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{num(metrics.dailyHoursTarget, 1)}/day · {metrics.totalDays} days</div>
        </div>
        <div style={cardSt}>
          <div style={lblSt}>Hrs/RO Goal</div>
          {editable.goals ? (
            <input type="number" inputMode="decimal" style={{ ...inpSt, color: '#93c5fd', width: 120, marginTop: 4 }} value={metrics.hrsRoGoal || ''} placeholder="0" onChange={e => setGoal('hrsRoGoal', e.target.value)} />
          ) : <div style={{ fontSize: 22, fontWeight: 800, color: '#93c5fd', marginTop: 3 }}>{num(metrics.hrsRoGoal, 2)}</div>}
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>target ratio</div>
        </div>
        <div style={cardSt}>
          <div style={lblSt}>Hours Actual (MTD)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', marginTop: 3 }}>{num(metrics.actualHours, 1)}</div>
          <div style={{ fontSize: 11, color: metrics.actualHours >= metrics.expectedHours ? '#6ee7b7' : '#fca5a5', marginTop: 4 }}>{metrics.actualHours >= metrics.expectedHours ? '▲' : '▼'} {num(Math.abs(metrics.actualHours - metrics.expectedHours), 1)} vs pace</div>
        </div>
        <div style={cardSt}>
          <div style={lblSt}>Projected Hours</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: metrics.projectedHours >= metrics.hoursGoal ? '#6ee7b7' : '#fca5a5', marginTop: 3 }}>{num(metrics.projectedHours, 1)}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{metrics.hoursGoal > 0 ? `${metrics.projectedHours >= metrics.hoursGoal ? '▲' : '▼'} ${num(Math.abs(metrics.projectedHours - metrics.hoursGoal), 1)} vs goal` : ''}</div>
        </div>
        <div style={cardSt}>
          <div style={lblSt}>Avg Hrs/RO</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: metrics.avgHrsRo >= metrics.hrsRoGoal ? '#6ee7b7' : '#fca5a5', marginTop: 3 }}>{num(metrics.avgHrsRo, 2)}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{metrics.hrsRoGoal > 0 ? `goal ${num(metrics.hrsRoGoal, 2)}` : ''}</div>
        </div>
      </div>

      {/* Daily entry */}
      <div style={{ background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, overflow: 'hidden' }}>
        <div onClick={() => setGridOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', cursor: 'pointer', userSelect: 'none' }}>
          <span style={{ fontSize: 13, color: gridOpen ? '#6ee7f9' : '#94a3b8', transform: gridOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>▶</span>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '.04em' }}>Daily Entry — {metrics.label}</div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: '#64748b' }}>{editable.days ? (gridOpen ? 'Click to hide' : 'Click to add your hours') : (gridOpen ? 'Click to hide' : 'Click to view')}</div>
        </div>
        {gridOpen && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 160px 160px', padding: '12px 20px', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderTop: '1px solid rgba(148,163,184,.15)', borderBottom: '1px solid rgba(148,163,184,.15)' }}>
              <div>Day</div><div>Date</div>
              <div style={{ textAlign: 'right' }}>Hours</div>
              <div style={{ textAlign: 'right' }}>Hrs/RO</div>
            </div>
            {metrics.rows.map(r => (
              <div key={r.k} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 160px 160px', padding: '8px 20px', alignItems: 'center', fontSize: 14, borderBottom: '1px solid rgba(148,163,184,.06)' }}>
                <div style={{ color: '#64748b', fontWeight: 700 }}>{r.dayNum}</div>
                <div style={{ color: '#cbd5e1' }}>{DOW[r.dt.getDay()]} {r.dt.getMonth() + 1}/{r.dt.getDate()}</div>
                <div style={{ textAlign: 'right' }}>
                  {editable.days
                    ? <input type="number" inputMode="decimal" style={{ ...inpSt, width: 120, color: r.has ? '#6ee7b7' : '#e2e8f0' }} value={r.has ? r.hours : ''} placeholder="—" onChange={e => setDay(r.k, 'hours', e.target.value)} />
                    : <span style={{ color: r.has ? '#6ee7b7' : '#475569', fontWeight: 700 }}>{r.has ? num(r.hours, 1) : '—'}</span>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {editable.days
                    ? <input type="number" inputMode="decimal" style={{ ...inpSt, width: 120, color: r.has ? '#93c5fd' : '#e2e8f0' }} value={r.has && r.hrsRo != null ? r.hrsRo : ''} placeholder="—" onChange={e => setDay(r.k, 'hrsRo', e.target.value)} />
                    : <span style={{ color: r.has ? '#93c5fd' : '#475569', fontWeight: 700 }}>{r.has && r.hrsRo != null ? num(r.hrsRo, 2) : '—'}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <GoalChart title={`Hours — ${metrics.label}`} unit="hours" {...ch.hours} />
      <GoalChart title={`Hrs/RO — ${metrics.label}`} unit="hrs/ro" {...ch.ro} />
    </>
  );

  // History list / detail
  const renderHistory = () => {
    const pastKeys = Object.keys(allMonths || {}).filter(k => k < mk).sort().reverse();
    if (histSel) {
      const hm = computeMetrics(histSel, allMonths[histSel]);
      const hc = makeCharts(hm);
      return (
        <div>
          <button className="secondary" onClick={() => setHistSel(null)} style={{ marginBottom: 16 }}>← All months</button>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0', marginBottom: 16 }}>{hm.label}</div>
          {renderDetail(hm, hc, { goals: false, days: false })}
        </div>
      );
    }
    if (!pastKeys.length) return <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>No completed months yet.</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pastKeys.map(k => {
          const hm = computeMetrics(k, allMonths[k]);
          return (
            <div key={k} onClick={() => { setGridOpen(false); setHistSel(k); }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '14px 20px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', minWidth: 150 }}>{hm.label}</div>
              <div><div style={lblSt}>Hours</div><div style={{ fontSize: 17, fontWeight: 800, color: '#6ee7b7' }}>{num(hm.actualHours, 1)} / {num(hm.hoursGoal, 1)}</div></div>
              <div><div style={lblSt}>Avg Hrs/RO</div><div style={{ fontSize: 17, fontWeight: 800, color: '#93c5fd' }}>{num(hm.avgHrsRo, 2)} / {num(hm.hrsRoGoal, 2)}</div></div>
              <div style={{ flex: 1 }} />
              <div style={{ color: '#6ee7f9', fontSize: 13, fontWeight: 700 }}>View →</div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🎯 Goals / Forecasting</div>
          <div className="adv-sub">{selected}{isMine ? ' (Mine)' : ''} · {M.label}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      {/* Advisor roster — click to view anyone (read-only unless yours / you're lead) */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px 0', flexWrap: 'wrap' }}>
        {roster.map(a => (
          <button key={a} onClick={() => { setSelected(a); setGridOpen(false); }}
            style={{ background: selected === a ? 'rgba(167,139,250,.25)' : 'rgba(255,255,255,.04)', border: `1px solid ${selected === a ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.1)'}`, color: selected === a ? '#c4b5fd' : '#94a3b8', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            {a}{me === a ? ' (You)' : ''}
          </button>
        ))}
      </div>

      {/* Month / History tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 20px 0', flexShrink: 0 }}>
        {[{ k: 'current', label: M.label }, { k: 'history', label: '🗂 History' }].map(t => (
          <button key={t.k} onClick={() => { setView(t.k); setHistSel(null); }}
            style={{ background: view === t.k ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.04)', border: `1px solid ${view === t.k ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.1)'}`, color: view === t.k ? '#6ee7f9' : '#94a3b8', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>{t.label}</button>
        ))}
        {!isMine && view === 'current' && <div style={{ alignSelf: 'center', fontSize: 12, color: '#fbbf24', fontWeight: 700, marginLeft: 6 }}>👁 Viewing {selected} — {canEditGoals ? 'you can set goals' : 'read-only'}</div>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 32px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          {loading ? <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0' }}>Loading…</div>
            : view === 'history' ? renderHistory()
              : renderDetail(M, charts, { goals: canEditGoals, days: canEditDaysFor(selected) })}
        </div>
      </div>
    </div>
  );
}
