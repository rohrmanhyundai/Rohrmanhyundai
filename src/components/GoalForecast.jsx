import React, { useEffect, useMemo, useState } from 'react';
import { advisorMonthProgress } from '../utils/calculations';
import { safe } from '../utils/formatters';

const money = (n) => '$' + Math.round(safe(n, 0)).toLocaleString('en-US');
const money1 = (n) => '$' + safe(n, 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// localStorage key for the current month, e.g. goalForecast-2026-06
function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

export default function GoalForecast({
  data, currentUserDisplay, currentUser, onBack,
  title = 'Goal Forecast',
  deptLabel = 'Service Department',
  backLabel = '← Manager Hub',
  storagePrefix = 'goalForecast',
}) {
  const now = new Date();
  const mk = monthKey(now);
  const storageKey = (m) => `${storagePrefix}-${m}`;

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

  // Projected month-end: current daily pace (actual MTD ÷ completed working
  // days) extended across the full month.
  const hasActuals = actualMTD > 0;
  const runRate = completedDays > 0 ? actualMTD / completedDays : 0;
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

  function printSheet() {
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const stamp = now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const sign = (n) => (n >= 0 ? '+' : '−') + money(Math.abs(n));

    const rowHtml = rows.map(r => {
      const diff = r.runActual - r.cumTarget;
      const showDiff = r.hasActual || r.isPast;
      const diffCls = !showDiff ? 'mut' : diff >= 0 ? 'pos' : 'neg';
      return `<tr${r.isToday ? ' class="today"' : ''}>
        <td class="c">${r.dayNum}</td>
        <td>${DOW[r.dt.getDay()]} ${r.dt.getMonth() + 1}/${r.dt.getDate()}${r.isToday ? ' <b>(Today)</b>' : ''}</td>
        <td class="r">${money(dailyTarget)}</td>
        <td class="r">${r.hasActual ? money(r.actual) : '<span class="mut">—</span>'}</td>
        <td class="r">${r.hasActual || r.runActual > 0 ? money(r.runActual) : '<span class="mut">—</span>'}</td>
        <td class="r ${diffCls}">${showDiff ? sign(diff) : '<span class="mut">—</span>'}</td>
      </tr>`;
    }).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${esc(monthLabel)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1e293b; margin: 32px; }
      h1 { font-size: 22px; margin: 0; }
      .sub { color: #64748b; font-size: 13px; margin: 2px 0 20px; }
      .cards { display: flex; gap: 12px; margin-bottom: 22px; }
      .card { flex: 1; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px 14px; }
      .card .lbl { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: #64748b; font-weight: 700; }
      .card .val { font-size: 20px; font-weight: 800; margin-top: 4px; }
      .card .note { font-size: 11px; color: #64748b; margin-top: 3px; }
      table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      th { text-align: left; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #94a3b8; padding: 7px 10px; }
      td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
      th.r, td.r { text-align: right; } th.c, td.c { text-align: center; color: #94a3b8; }
      tr.today td { background: #ecfdf5; font-weight: 700; }
      .pos { color: #15803d; } .neg { color: #b91c1c; } .mut { color: #cbd5e1; }
      .ftr { margin-top: 18px; font-size: 11px; color: #94a3b8; }
      @media print { body { margin: 12px; } @page { margin: 14mm; } }
    </style></head><body>
      <h1>${esc(title)} — ${esc(monthLabel)}</h1>
      <div class="sub">Bob Rohrman Hyundai &middot; ${esc(deptLabel)} &middot; ${esc(currentUserDisplay || currentUser || '')} &middot; Generated ${esc(stamp)}</div>
      <div class="cards">
        <div class="card"><div class="lbl">Forecast</div><div class="val">${money(forecast)}</div><div class="note">${totalDays} working days</div></div>
        <div class="card"><div class="lbl">Daily Target</div><div class="val">${money(dailyTarget)}</div></div>
        <div class="card"><div class="lbl">Actual MTD</div><div class="val">${money(actualMTD)}</div><div class="note">${completedDays} days completed</div></div>
        <div class="card"><div class="lbl">Expected MTD</div><div class="val">${money(expectedMTD)}</div></div>
        <div class="card"><div class="lbl">${up ? 'Ahead of Pace' : 'Behind Pace'}</div><div class="val ${up ? 'pos' : 'neg'}">${sign(variance)}</div></div>
        <div class="card"><div class="lbl">Projected Month-End</div><div class="val ${!hasActuals ? '' : projected >= forecast ? 'pos' : 'neg'}">${hasActuals ? money(projected) : '—'}</div><div class="note">${hasActuals && forecast > 0 ? sign(projected - forecast) + ' vs forecast' : ''}</div></div>
      </div>
      <table>
        <thead><tr><th class="c">Day</th><th>Date</th><th class="r">Daily Target</th><th class="r">Actual Gross</th><th class="r">Cumulative</th><th class="r">+/-</th></tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>
      <div class="ftr">+/- compares cumulative actual against the cumulative daily target through each day.</div>
      <script>window.onload = function(){ window.print(); }<\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to print the forecast.'); return; }
    w.document.write(html);
    w.document.close();
  }

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
          <div className="adv-title">{title}</div>
          <div className="adv-sub">{monthLabel} · {currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={printSheet} style={{ marginRight: 10 }}>🖨 Print / PDF</button>
        <button className="secondary" onClick={onBack}>{backLabel}</button>
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
              <div style={{ ...valStyle, color: !hasActuals ? '#e2e8f0' : projected >= forecast ? '#6ee7b7' : '#fca5a5' }}>{hasActuals ? money(projected) : '—'}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                {hasActuals && forecast > 0
                  ? (projected >= forecast ? '▲ ' : '▼ ') + money(Math.abs(projected - forecast)) + ' vs forecast'
                  : forecast > 0 ? 'current daily pace × ' + totalDays + ' days' : 'enter a forecast'}
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
