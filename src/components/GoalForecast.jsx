import React, { useEffect, useMemo, useState } from 'react';
import { advisorMonthProgress } from '../utils/calculations';
import { safe } from '../utils/formatters';

const money = (n) => '$' + Math.round(safe(n, 0)).toLocaleString('en-US');
const money1 = (n) => '$' + safe(n, 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// localStorage key for the current month, e.g. goalForecast-2026-06
function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function storageKey(mk) { return `goalForecast-${mk}`; }

// Non-Sunday calendar dates for the given month (matches advisorMonthProgress's
// "working day" definition: every day except Sunday).
function workingDates(year, month) {
  const dim = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let d = 1; d <= dim; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0) out.push(new Date(year, month, d));
  }
  return out;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function GoalForecast({ data, currentUserDisplay, currentUser, onBack }) {
  const now = new Date();
  const mk = monthKey(now);

  // Total working days for the month — honors the Goal Gauges override exactly
  // like the dashboard gauges (advisorMonthProgress applies advisorMonthlyWorkdays).
  const progress = advisorMonthProgress(data || {});
  const totalDays = progress.total;
  const completedDays = Math.min(progress.completed, totalDays);

  const dates = useMemo(() => workingDates(now.getFullYear(), now.getMonth()), [mk]);

  // Persisted state: monthly forecast + per-date actuals (keyed by 'YYYY-MM-DD').
  const [forecast, setForecast] = useState(0);
  const [actuals, setActuals] = useState({}); // { 'YYYY-MM-DD': number }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(mk));
      if (raw) {
        const parsed = JSON.parse(raw);
        setForecast(safe(parsed.forecast, 0));
        setActuals(parsed.actuals || {});
      }
    } catch { /* ignore */ }
  }, [mk]);

  function persist(nextForecast, nextActuals) {
    try {
      localStorage.setItem(storageKey(mk), JSON.stringify({ forecast: nextForecast, actuals: nextActuals }));
    } catch { /* ignore */ }
  }

  function updateForecast(val) {
    const n = safe(val, 0);
    setForecast(n);
    persist(n, actuals);
  }

  function updateActual(dayKey, val) {
    const next = { ...actuals };
    if (val === '' || val == null) delete next[dayKey];
    else next[dayKey] = safe(val, 0);
    setActuals(next);
    persist(forecast, next);
  }

  const dailyTarget = totalDays > 0 ? forecast / totalDays : 0;

  // Cumulative actual = sum of everything entered so far.
  const actualMTD = Object.values(actuals).reduce((s, v) => s + safe(v, 0), 0);
  // Expected-to-date paced automatically off the calendar.
  const expectedMTD = dailyTarget * completedDays;
  const variance = actualMTD - expectedMTD;
  const up = variance >= 0;

  // Projected month-end: run-rate of entered actuals across completed days.
  const daysWithEntries = Object.keys(actuals).length;
  const runRate = daysWithEntries > 0 ? actualMTD / daysWithEntries : 0;
  const projected = runRate * totalDays;

  const pctOfForecast = forecast > 0 ? (actualMTD / forecast) * 100 : 0;

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  // Build the day-by-day rows with running cumulatives.
  let runActual = 0;
  let dayNum = 0;
  const rows = dates.map((dt) => {
    dayNum += 1;
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const hasActual = Object.prototype.hasOwnProperty.call(actuals, k);
    const actual = safe(actuals[k], 0);
    runActual += actual;
    const cumTarget = dailyTarget * dayNum;
    const isToday = k === todayKey;
    const isPast = dt < new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { k, dt, dayNum, hasActual, actual, runActual, cumTarget, isToday, isPast };
  });

  const cardStyle = {
    background: 'rgba(15,23,42,.55)', border: '1px solid rgba(148,163,184,.18)',
    borderRadius: 16, padding: '20px 22px', flex: 1, minWidth: 180,
  };
  const labelStyle = { fontSize: 12, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 };
  const valStyle = { fontSize: 28, fontWeight: 900, color: '#e2e8f0' };

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">Goal Forecast</div>
          <div className="adv-sub">{monthLabel} · {currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Manager Hub</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px 40px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>

          {/* Forecast input + daily target */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 28 }}>
            <div style={{ ...cardStyle, background: 'linear-gradient(135deg,rgba(52,211,153,.16),rgba(16,185,129,.08))', border: '1px solid rgba(52,211,153,.35)' }}>
              <div style={labelStyle}>Month Forecast Gross Profit</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 900, color: '#6ee7b7' }}>$</span>
                <input
                  type="number"
                  value={forecast || ''}
                  placeholder="0"
                  onChange={e => updateForecast(e.target.value)}
                  style={{
                    background: 'rgba(2,6,23,.5)', border: '1px solid rgba(52,211,153,.35)',
                    borderRadius: 10, padding: '8px 12px', fontSize: 26, fontWeight: 900,
                    color: '#6ee7b7', width: 220, outline: 'none',
                  }}
                />
              </div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Daily Target</div>
              <div style={valStyle}>{money(dailyTarget)}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                {totalDays} working days · {completedDays} completed
              </div>
            </div>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
            <div style={cardStyle}>
              <div style={labelStyle}>Actual MTD</div>
              <div style={valStyle}>{money(actualMTD)}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Expected MTD</div>
              <div style={valStyle}>{money(expectedMTD)}</div>
            </div>
            <div style={{ ...cardStyle, border: `1px solid ${up ? 'rgba(52,211,153,.45)' : 'rgba(248,113,113,.45)'}`, background: up ? 'rgba(16,185,129,.08)' : 'rgba(239,68,68,.08)' }}>
              <div style={labelStyle}>{up ? 'Ahead of Pace' : 'Behind Pace'}</div>
              <div style={{ ...valStyle, color: up ? '#6ee7b7' : '#fca5a5' }}>
                {up ? '▲ ' : '▼ '}{money(Math.abs(variance))}
              </div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Projected Month-End</div>
              <div style={valStyle}>{daysWithEntries > 0 ? money(projected) : '—'}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                {forecast > 0 ? pctOfForecast.toFixed(1) + '% of forecast booked' : 'enter a forecast'}
              </div>
            </div>
          </div>

          {/* Daily grid */}
          <div style={{ background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 130px 150px 150px 130px', gap: 0, padding: '14px 20px', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.15)' }}>
              <div>Day</div>
              <div>Date</div>
              <div style={{ textAlign: 'right' }}>Daily Target</div>
              <div style={{ textAlign: 'right' }}>Actual Gross</div>
              <div style={{ textAlign: 'right' }}>Cumulative</div>
              <div style={{ textAlign: 'right' }}>+/-</div>
            </div>
            {rows.map((r) => {
              const diff = r.runActual - r.cumTarget;
              const showDiff = r.hasActual || r.isPast;
              return (
                <div
                  key={r.k}
                  style={{
                    display: 'grid', gridTemplateColumns: '64px 1fr 130px 150px 150px 130px', gap: 0,
                    padding: '8px 20px', alignItems: 'center', fontSize: 14,
                    background: r.isToday ? 'rgba(110,231,249,.08)' : 'transparent',
                    borderLeft: r.isToday ? '3px solid #6ee7f9' : '3px solid transparent',
                    borderBottom: '1px solid rgba(148,163,184,.06)',
                  }}
                >
                  <div style={{ color: '#64748b', fontWeight: 700 }}>{r.dayNum}</div>
                  <div style={{ color: r.isToday ? '#6ee7f9' : '#cbd5e1', fontWeight: r.isToday ? 800 : 500 }}>
                    {DOW[r.dt.getDay()]} {r.dt.getMonth() + 1}/{r.dt.getDate()}
                    {r.isToday && <span style={{ fontSize: 11, marginLeft: 8, color: '#6ee7f9' }}>TODAY</span>}
                  </div>
                  <div style={{ textAlign: 'right', color: '#94a3b8' }}>{money(r.cumTarget - dailyTarget * (r.dayNum - 1))}</div>
                  <div style={{ textAlign: 'right' }}>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={r.hasActual ? r.actual : ''}
                      placeholder="$ enter"
                      onChange={e => updateActual(r.k, e.target.value)}
                      onFocus={e => { e.target.style.borderColor = '#6ee7b7'; e.target.style.background = 'rgba(2,6,23,.7)'; }}
                      onBlur={e => { e.target.style.borderColor = r.hasActual ? 'rgba(52,211,153,.4)' : 'rgba(148,163,184,.35)'; e.target.style.background = 'rgba(2,6,23,.55)'; }}
                      style={{
                        background: 'rgba(2,6,23,.55)',
                        border: `1px solid ${r.hasActual ? 'rgba(52,211,153,.4)' : 'rgba(148,163,184,.35)'}`,
                        borderRadius: 8, padding: '7px 10px', fontSize: 14, fontWeight: 700,
                        color: r.hasActual ? '#6ee7b7' : '#e2e8f0', width: 120, textAlign: 'right',
                        outline: 'none', cursor: 'text',
                      }}
                    />
                  </div>
                  <div style={{ textAlign: 'right', color: '#cbd5e1', fontWeight: 600 }}>{r.hasActual || r.runActual > 0 ? money(r.runActual) : '—'}</div>
                  <div style={{ textAlign: 'right', fontWeight: 700, color: !showDiff ? '#475569' : diff >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                    {showDiff ? (diff >= 0 ? '▲ ' : '▼ ') + money(Math.abs(diff)) : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 12, color: '#475569', marginTop: 16, textAlign: 'center' }}>
            Forecast & daily actuals are saved to this browser. Working days come from Goal Gauges (Edit Dashboard).
          </div>

        </div>
      </div>
    </div>
  );
}
