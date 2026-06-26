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
  const [refresh, setRefresh] = useState(0);

  // Day End Reporting form (always for the logged-in advisor, "me").
  const [deOpenRo, setDeOpenRo] = useState('');
  const [deInvoiced, setDeInvoiced] = useState(null);
  const [deCust, setDeCust] = useState(null);
  const [deNotes, setDeNotes] = useState(null);
  const [deHours, setDeHours] = useState('');
  const [deHrsRo, setDeHrsRo] = useState('');
  const [deSaving, setDeSaving] = useState(false);
  const [deMsg, setDeMsg] = useState('');
  const [dayEndOpen, setDayEndOpen] = useState(false);
  const [deStep, setDeStep] = useState(0);
  const [deAgree, setDeAgree] = useState(false);
  function openDayEnd() {
    setDeOpenRo(''); setDeInvoiced(null); setDeCust(null); setDeNotes(null); setDeHours(''); setDeHrsRo('');
    setDeAgree(false); setDeMsg(''); setDeStep(0); setDayEndOpen(true);
  }

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
  }, [selected, mk, refresh]);

  // Submit the Day End Report into MY own goals file for today (skips Sunday).
  async function submitDayEnd() {
    setDeSaving(true); setDeMsg('');
    try {
      const d = new Date();
      while (d.getDay() === 0) d.setDate(d.getDate() - 1);
      const tmk = monthKey(d);
      const tkey = dKey(d);
      let all = {};
      try { all = await loadAdvisorGoals(me); } catch {}
      const b = (all && all[tmk]) || { hoursGoal: 0, hrsRoGoal: 0, days: {} };
      const days = { ...(b.days || {}) };
      days[tkey] = {
        ...(days[tkey] || {}),
        hours: safe(deHours, 0),
        hrsRo: safe(deHrsRo, 0),
        openRoCount: safe(deOpenRo, 0),
        invoiced: deInvoiced,
        customersUpdated: deCust,
        notesUpdated: deNotes,
        agreed: deAgree,
        agreedBy: me,
        submittedAt: Date.now(),
      };
      const merged = { ...b, days };
      const all2 = await saveAdvisorGoalsMonth(me, tmk, merged);
      setAllMonths(all2 || {});
      // Reflect immediately in the on-screen forecast (don't wait for a reload).
      setSelected(me);
      if (tmk === mk) {
        const norm = { hoursGoal: safe(merged.hoursGoal, 0), hrsRoGoal: safe(merged.hrsRoGoal, 0), days: merged.days || {} };
        bucketRef.current = norm;
        setBucket(norm);
      }
      setDeMsg(`✓ Day-end report saved for ${d.getMonth() + 1}/${d.getDate()}. Hours ${num(safe(deHours, 0), 1)} and Hrs/RO ${num(safe(deHrsRo, 0), 2)} added to your forecast.`);
      setDeOpenRo(''); setDeInvoiced(null); setDeCust(null); setDeNotes(null); setDeHours(''); setDeHrsRo(''); setDeAgree(false);
      setDayEndOpen(false);
      setView('current'); setGridOpen(true);
    } catch (e) {
      setDeMsg('Save failed: ' + (e.message || e));
    } finally {
      setDeSaving(false);
    }
  }

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

  // ── Day End Reporting form ────────────────────────────────────────────────
  const YesNo = ({ value, onChange }) => (
    <div style={{ display: 'flex', gap: 8 }}>
      {[['yes', 'Yes', '#4ade80', 'rgba(74,222,128,'], ['no', 'No', '#f87171', 'rgba(248,113,113,']].map(([v, lbl, col, rgb]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          style={{ background: value === v ? `${rgb}.22)` : 'rgba(255,255,255,.05)', border: `1px solid ${value === v ? `${rgb}.6)` : 'rgba(255,255,255,.12)'}`, color: value === v ? col : '#94a3b8', borderRadius: 8, padding: '8px 22px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>{lbl}</button>
      ))}
    </div>
  );
  // Day End Reporting popup — one question per step.
  const DE_STEPS = [
    { key: 'openRo', kind: 'num', q: 'Open Repair Order Count', placeholder: 'e.g. 12', get: () => deOpenRo, set: setDeOpenRo, color: '#e2e8f0' },
    { key: 'invoiced', kind: 'yn', q: 'Are all available repair orders invoiced?', get: () => deInvoiced, set: setDeInvoiced },
    { key: 'cust', kind: 'yn', q: 'Are all customers updated on status?', get: () => deCust, set: setDeCust },
    { key: 'notes', kind: 'yn', q: 'Do all repair orders have new and updated notes?', get: () => deNotes, set: setDeNotes },
    { key: 'hours', kind: 'num', q: 'End of Day Hours Sold', sub: 'Adds to your forecast for today', placeholder: 'e.g. 14.5', get: () => deHours, set: setDeHours, color: '#6ee7b7' },
    { key: 'hrsro', kind: 'num', q: 'Hrs/RO', sub: 'Adds to your forecast for today', placeholder: 'e.g. 2.4', get: () => deHrsRo, set: setDeHrsRo, color: '#93c5fd' },
    { key: 'agree', kind: 'agree', q: 'Confirm & Submit' },
  ];

  // The attestation statement the advisor must agree to before submitting.
  const AGREE_TEXT = `I certify that the information in this day-end report is accurate and complete to the best of my knowledge. I have reviewed all of my open repair orders, invoiced everything available, updated every customer on their status, and ensured each repair order has current notes as of the end of my business day.`;

  function renderDayEndModal() {
    if (!dayEndOpen) return null;
    const step = DE_STEPS[deStep];
    const val = step.get ? step.get() : null;
    const answered = step.kind === 'yn' ? !!val : step.kind === 'agree' ? deAgree : String(val ?? '').trim() !== '';
    const isLast = deStep === DE_STEPS.length - 1;
    const goNext = () => { if (answered && !isLast) setDeStep(s => s + 1); };
    return (
      <div onClick={() => setDayEndOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 18, width: '100%', maxWidth: 460, boxShadow: '0 18px 60px rgba(0,0,0,.6)', overflow: 'hidden' }}>
          {/* Header + progress */}
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#4ade80' }}>📋 Day End Reporting</div>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: '#64748b' }}>{deStep + 1} of {DE_STEPS.length}</div>
              <button onClick={() => setDayEndOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ marginTop: 10, height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 999 }}>
              <div style={{ width: `${((deStep + 1) / DE_STEPS.length) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#34d399,#6ee7b7)', borderRadius: 999, transition: 'width .2s' }} />
            </div>
          </div>

          {/* Question */}
          <div style={{ padding: '26px 22px 8px', minHeight: 150 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0', lineHeight: 1.35 }}>{step.q}</div>
            {step.sub && <div style={{ fontSize: 12, color: step.color || '#6ee7b7', fontWeight: 700, marginTop: 4 }}>→ {step.sub}</div>}
            <div style={{ marginTop: 20 }}>
              {step.kind === 'agree' ? (
                <>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: '#cbd5e1', background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.25)', borderRadius: 12, padding: '14px 16px' }}>{AGREE_TEXT}</div>
                  <button type="button" onClick={() => setDeAgree(a => !a)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', marginTop: 14, background: deAgree ? 'rgba(74,222,128,.14)' : 'rgba(255,255,255,.04)', border: `1px solid ${deAgree ? 'rgba(74,222,128,.5)' : 'rgba(255,255,255,.14)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: deAgree ? '#4ade80' : 'transparent', border: `2px solid ${deAgree ? '#4ade80' : 'rgba(148,163,184,.6)'}`, color: '#04201d', fontWeight: 900, fontSize: 14 }}>{deAgree ? '✓' : ''}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: deAgree ? '#4ade80' : '#cbd5e1' }}>I agree — {me}</span>
                  </button>
                </>
              ) : step.kind === 'yn' ? (
                <YesNo value={val} onChange={(v) => { step.set(v); setTimeout(() => setDeStep(s => Math.min(s + 1, DE_STEPS.length - 1)), 150); }} />
              ) : (
                <input autoFocus type="number" inputMode="decimal" value={val}
                  placeholder={step.placeholder}
                  onChange={e => step.set(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') goNext(); }}
                  style={{ background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 10, padding: '12px 14px', fontSize: 20, fontWeight: 800, color: step.color || '#e2e8f0', width: '100%', boxSizing: 'border-box', outline: 'none' }} />
              )}
            </div>
            {deMsg && deMsg.startsWith('Save failed') && <div style={{ marginTop: 14, fontSize: 13, color: '#f87171' }}>{deMsg}</div>}
          </div>

          {/* Footer nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px 18px' }}>
            <button onClick={() => setDeStep(s => Math.max(s - 1, 0))} disabled={deStep === 0}
              style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: deStep === 0 ? '#475569' : '#cbd5e1', borderRadius: 8, padding: '9px 16px', cursor: deStep === 0 ? 'default' : 'pointer', fontWeight: 700, fontSize: 13 }}>← Back</button>
            <div style={{ flex: 1 }} />
            {isLast ? (
              <button onClick={submitDayEnd} disabled={deSaving || !answered}
                style={{ background: answered && !deSaving ? 'rgba(74,222,128,.2)' : 'rgba(255,255,255,.06)', border: `1px solid ${answered && !deSaving ? 'rgba(74,222,128,.45)' : 'rgba(255,255,255,.12)'}`, color: answered && !deSaving ? '#4ade80' : '#64748b', borderRadius: 8, padding: '9px 22px', cursor: answered && !deSaving ? 'pointer' : 'default', fontWeight: 800, fontSize: 14 }}>{deSaving ? '⏳ Saving…' : '✓ Submit'}</button>
            ) : (
              <button onClick={goNext} disabled={!answered}
                style={{ background: answered ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.06)', border: `1px solid ${answered ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.12)'}`, color: answered ? '#6ee7f9' : '#64748b', borderRadius: 8, padding: '9px 22px', cursor: answered ? 'pointer' : 'default', fontWeight: 800, fontSize: 14 }}>Next →</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {renderDayEndModal()}
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
        {(roster.includes(me) || isAdmin) && (
          <button onClick={openDayEnd}
            style={{ background: 'rgba(74,222,128,.16)', border: '1px solid rgba(74,222,128,.4)', color: '#4ade80', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>📋 Day End Reporting</button>
        )}
        {!isMine && view === 'current' && <div style={{ alignSelf: 'center', fontSize: 12, color: '#fbbf24', fontWeight: 700, marginLeft: 6 }}>👁 Viewing {selected} — {canEditGoals ? 'you can set goals' : 'read-only'}</div>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 32px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          {deMsg && deMsg.startsWith('✓') && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#4ade80', background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.35)' }}>{deMsg}</div>
          )}
          {loading ? <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0' }}>Loading…</div>
            : view === 'history' ? renderHistory()
              : renderDetail(M, charts, { goals: canEditGoals, days: canEditDaysFor(selected) })}
        </div>
      </div>
    </div>
  );
}
