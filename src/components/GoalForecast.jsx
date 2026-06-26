import React, { useEffect, useMemo, useState, useRef } from 'react';
import { advisorMonthProgress } from '../utils/calculations';
import { safe } from '../utils/formatters';
import { loadGoalForecast, saveGoalForecastMonth } from '../utils/github';

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

// ── PDF.js loader (CDN, shared promise) ──────────────────────────────────────
let _pdfjsPromise = null;
function loadPdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; resolve(window.pdfjsLib); };
    s.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}

// Parse a number token like "2,973.18", "0.00", "(78.44)", "($1,423.60)".
// Parentheses mean negative. Returns null if it isn't a currency value.
function parseCurrency(tok) {
  const t = String(tok).trim();
  if (!/[0-9]/.test(t) || !/[.]/.test(t)) return null; // must have a decimal
  const neg = /^\(.*\)$/.test(t);
  const cleaned = t.replace(/[()$,]/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

// Parse the gross report PDF. For each data row (one that starts with a MM/DD/YY
// date) we read the TOTAL GROSS PROFIT columns at the far right: the LAST currency
// value is PARTS, the SECOND-TO-LAST is LABOR. Returns { 'YYYY-MM-DD': {labor, parts} }.
async function parseGrossReport(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out = {};
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byY = {};
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      (byY[y] = byY[y] || []).push({ x: it.transform[4], text: it.str.trim() });
    }
    for (const items of Object.values(byY)) {
      items.sort((a, b) => a.x - b.x);
      const texts = items.map(i => i.text);
      const dateTok = texts.find(t => /^\d{2}\/\d{2}\/\d{2}$/.test(t));
      if (!dateTok) continue;
      const nums = texts.map(parseCurrency).filter(v => v !== null);
      if (nums.length < 2) continue;
      const parts = nums[nums.length - 1];
      const labor = nums[nums.length - 2];
      const [mm, dd, yy] = dateTok.split('/');
      const key = `${2000 + Number(yy)}-${mm}-${dd}`;
      out[key] = { labor, parts };
    }
  }
  return out;
}

// Compute every derived figure for a stored month ('YYYY-MM' + its data bucket).
// Used by the History view to render completed months read-only.
function computeMonthMetrics(mkStr, monthData) {
  const [y, m] = String(mkStr).split('-').map(Number);
  const year = y, monthIdx = (m || 1) - 1;
  const dates = workingDates(year, monthIdx);
  const forecast = safe(monthData && monthData.forecast, 0);
  const lastYear = safe(monthData && monthData.lastYear, 0);
  const actuals = (monthData && monthData.actuals) || {};
  const totalDays = dates.length;
  const dailyTarget = totalDays > 0 ? forecast / totalDays : 0;
  let runningCum = 0, dayNum = 0;
  const rows = dates.map(dt => {
    dayNum += 1;
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const hasActual = Object.prototype.hasOwnProperty.call(actuals, k);
    const entered = safe(actuals[k], 0);
    const cumTarget = dailyTarget * dayNum;
    let cumActual = null, dailyGross = 0;
    if (hasActual) { dailyGross = entered; runningCum += entered; cumActual = runningCum; }
    return { k, dt, dayNum, hasActual, entered, cumActual, dailyGross, cumTarget };
  });
  const actualTotal = runningCum;
  const enteredDays = rows.filter(r => r.hasActual).length;
  const completedDays = enteredDays || totalDays;
  const runRate = completedDays > 0 ? actualTotal / completedDays : 0;
  const label = new Date(year, monthIdx, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return { year, monthIdx, label, dates, forecast, lastYear, actuals, totalDays, dailyTarget, rows, actualTotal, enteredDays, completedDays, runRate, expectedMTD: forecast, projected: actualTotal };
}

// Read-only detail for one completed/historical month.
function MonthDetail({ mkStr, monthData }) {
  const M = computeMonthMetrics(mkStr, monthData);
  const vsForecast = M.actualTotal - M.forecast;
  const vsLY = M.actualTotal - M.lastYear;
  const card = (label, value, color, sub) => (
    <div style={{ flex: 1, minWidth: 150, background: 'rgba(2,6,23,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#e2e8f0', marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{sub}</div>}
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {card('Final Total', money(M.actualTotal), '#34d399', `${M.enteredDays} of ${M.totalDays} days entered`)}
        {card('Forecast', money(M.forecast), '#6ee7f9', `${vsForecast >= 0 ? '▲ ' : '▼ '}${money(Math.abs(vsForecast))} vs forecast`)}
        {card('Last Year', money(M.lastYear), '#fbbf24', M.lastYear > 0 ? `${vsLY >= 0 ? '▲ ' : '▼ '}${money(Math.abs(vsLY))} vs LY` : '—')}
        {card('Daily Average', money(M.runRate), M.runRate >= M.dailyTarget ? '#6ee7b7' : '#fca5a5', `target ${money(M.dailyTarget)}/day`)}
      </div>

      <ComparisonChart
        rows={M.rows} dailyTarget={M.dailyTarget} lastYear={M.lastYear}
        totalDays={M.totalDays} completedDays={M.completedDays}
        actualMTD={M.actualTotal} expectedMTD={M.expectedMTD} projected={M.projected} forecast={M.forecast}
      />

      {/* Read-only daily table */}
      <div style={{ marginTop: 18, background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 130px 150px 150px 130px', gap: 0, padding: '14px 20px', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(148,163,184,.15)' }}>
          <div>Day</div><div>Date</div>
          <div style={{ textAlign: 'right' }}>Daily Target</div>
          <div style={{ textAlign: 'right' }}>Daily Total ($)</div>
          <div style={{ textAlign: 'right' }}>Month Total (MTD)</div>
          <div style={{ textAlign: 'right' }}>+/-</div>
        </div>
        {M.rows.map(r => {
          const diff = r.cumActual - r.cumTarget;
          return (
            <div key={r.k} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 130px 150px 150px 130px', gap: 0, padding: '8px 20px', alignItems: 'center', fontSize: 14, borderBottom: '1px solid rgba(148,163,184,.06)' }}>
              <div style={{ color: '#64748b', fontWeight: 700 }}>{r.dayNum}</div>
              <div style={{ color: '#cbd5e1' }}>{DOW[r.dt.getDay()]} {r.dt.getMonth() + 1}/{r.dt.getDate()}</div>
              <div style={{ textAlign: 'right', color: '#94a3b8' }}>{money(M.dailyTarget)}</div>
              <div style={{ textAlign: 'right', color: r.hasActual ? '#6ee7b7' : '#475569', fontWeight: 700 }}>{r.hasActual ? money(r.dailyGross) : '—'}</div>
              <div style={{ textAlign: 'right', color: '#cbd5e1', fontWeight: 600 }}>{r.hasActual ? money(r.cumActual) : '—'}</div>
              <div style={{ textAlign: 'right', fontWeight: 700, color: !r.hasActual ? '#475569' : diff >= 0 ? '#6ee7b7' : '#fca5a5' }}>{r.hasActual ? (diff >= 0 ? '▲ ' : '▼ ') + money(Math.abs(diff)) : '—'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Clean cumulative year-over-year comparison chart. Plots three running lines
// across the month's working days: This Year (actual entered), Where You Should
// Be (forecast pace), and Last Year (LY total spread evenly). Pure SVG, scales
// to the container width via viewBox.
function ComparisonChart({ rows, dailyTarget, lastYear, totalDays, completedDays, actualMTD, expectedMTD, projected, forecast }) {
  const W = 1000, H = 380;
  const padL = 74, padR = 26, padT = 24, padB = 54;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(totalDays || rows.length || 1, 1);

  const lyCumAt  = (dayNum) => (lastYear / n) * dayNum;
  const tgtCumAt = (dayNum) => dailyTarget * dayNum;

  const enteredRows = rows.filter(r => r.hasActual);
  const maxActual = enteredRows.length ? Math.max(...enteredRows.map(r => r.cumActual)) : 0;
  const maxVal = Math.max(forecast, lastYear, maxActual, dailyTarget * n, 1) * 1.08;

  const x = (dayNum) => padL + (plotW * (dayNum - 1)) / Math.max(n - 1, 1);
  const y = (val) => padT + plotH - (plotH * Math.max(val, 0)) / maxVal;

  const tgtPts = rows.map(r => `${x(r.dayNum).toFixed(1)},${y(tgtCumAt(r.dayNum)).toFixed(1)}`).join(' ');
  const lyPts  = rows.map(r => `${x(r.dayNum).toFixed(1)},${y(lyCumAt(r.dayNum)).toFixed(1)}`).join(' ');
  const tyPts  = enteredRows.map(r => `${x(r.dayNum).toFixed(1)},${y(r.cumActual).toFixed(1)}`).join(' ');

  const ticks = 5;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => (maxVal / ticks) * i);
  const xLabelRows = rows.filter((r, i) => i % 5 === 0 || i === rows.length - 1);

  const lastTy = enteredRows.length ? enteredRows[enteredRows.length - 1] : null;

  const C = { ty: '#34d399', tgt: '#6ee7f9', ly: '#fbbf24' };
  const Stat = ({ label, value, color, sub }) => (
    <div style={{ flex: 1, minWidth: 150, background: 'rgba(2,6,23,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const LegendDot = ({ color, dashed, children }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}>
      <span style={{ width: 22, height: 0, borderTop: `3px ${dashed ? 'dashed' : 'solid'} ${color}`, display: 'inline-block' }} />
      {children}
    </span>
  );

  return (
    <div style={{ marginTop: 28, background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '.04em' }}>Pace Comparison</div>
        <div style={{ flex: 1 }} />
        <LegendDot color={C.ty}>This Year</LegendDot>
        <LegendDot color={C.tgt} dashed>Where You Should Be</LegendDot>
        <LegendDot color={C.ly} dashed>Last Year</LegendDot>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '14px 0 18px' }}>
        <Stat label="This Year (MTD)" value={money(actualMTD)} color={C.ty} sub={`projected ${money(projected)} month-end`} />
        <Stat label="Where You Should Be" value={money(expectedMTD)} color={C.tgt} sub={`${completedDays} × ${money(dailyTarget)}/day`} />
        <Stat label="Last Year (this month)" value={money(lastYear)} color={C.ly} sub={lastYear > 0 ? `projected ${projected >= lastYear ? '+' : '−'}${money(Math.abs(projected - lastYear))} vs LY` : '—'} />
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        {/* y gridlines + labels */}
        {tickVals.map((tv, i) => (
          <g key={i}>
            <line x1={padL} y1={y(tv)} x2={W - padR} y2={y(tv)} stroke="rgba(148,163,184,.14)" strokeWidth="1" />
            <text x={padL - 10} y={y(tv) + 4} textAnchor="end" fontSize="11" fill="#64748b">{money(tv)}</text>
          </g>
        ))}
        {/* x labels */}
        {xLabelRows.map((r) => (
          <text key={r.k} x={x(r.dayNum)} y={H - padB + 22} textAnchor="middle" fontSize="11" fill="#64748b">{r.dt.getMonth() + 1}/{r.dt.getDate()}</text>
        ))}
        {/* Last Year pace */}
        {lastYear > 0 && <polyline points={lyPts} fill="none" stroke={C.ly} strokeWidth="2" strokeDasharray="6 5" opacity="0.9" />}
        {/* Target pace */}
        {forecast > 0 && <polyline points={tgtPts} fill="none" stroke={C.tgt} strokeWidth="2" strokeDasharray="6 5" opacity="0.95" />}
        {/* This Year actual */}
        {enteredRows.length > 0 && <polyline points={tyPts} fill="none" stroke={C.ty} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />}
        {/* End dot + label for This Year */}
        {lastTy && (
          <g>
            <circle cx={x(lastTy.dayNum)} cy={y(lastTy.cumActual)} r="5" fill={C.ty} stroke="#04201d" strokeWidth="2" />
            <text x={x(lastTy.dayNum)} y={y(lastTy.cumActual) - 12} textAnchor="middle" fontSize="12" fontWeight="800" fill={C.ty}>{money(lastTy.cumActual)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

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
  // Department for the server-backed store. Service and parts live in separate
  // files so one can never overwrite the other, and the numbers are the same on
  // every device. localStorage is kept only as an instant-load cache.
  const dept = storagePrefix === 'partsGoalForecast' ? 'parts' : 'service';

  // Total working days for the month — honors the Goal Gauges override exactly
  // like the dashboard gauges (advisorMonthProgress applies advisorMonthlyWorkdays).
  const progress = advisorMonthProgress(data || {});
  const totalDays = progress.total;
  const completedDays = Math.min(progress.completed, totalDays);

  const dates = useMemo(() => workingDates(now.getFullYear(), now.getMonth()), [mk]);

  // Persisted state: monthly forecast, last-year total, per-date actuals.
  const [forecast, setForecast] = useState(0);
  const [lastYear, setLastYear] = useState(0);
  const [actuals, setActuals] = useState({}); // { 'YYYY-MM-DD': number }
  const [gridOpen, setGridOpen] = useState(false); // daily entry grid collapsed by default
  const [allMonths, setAllMonths] = useState({});  // every saved month (for History)
  const [view, setView] = useState('current');     // 'current' | 'history'
  const [histSel, setHistSel] = useState(null);    // selected history month key
  // Read-only cross-department viewer (service ↔ parts).
  const otherDept = dept === 'parts' ? 'service' : 'parts';
  const otherDeptLabel = otherDept === 'parts' ? 'Parts' : 'Service';
  const [crossOpen, setCrossOpen] = useState(false);
  const [crossMonths, setCrossMonths] = useState({});
  const [crossView, setCrossView] = useState('current');
  const [crossSel, setCrossSel] = useState(null);
  function openCross() {
    setCrossOpen(true); setCrossView('current'); setCrossSel(null);
    loadGoalForecast(otherDept).then(all => setCrossMonths(all || {})).catch(() => setCrossMonths({}));
  }

  // ── PDF report upload ──────────────────────────────────────────────────────
  // service → LABOR column, parts → PARTS column of TOTAL GROSS PROFIT.
  const pdfInputRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [parsePreview, setParsePreview] = useState(null); // [{ dateKey, label, value }]
  const [parseErr, setParseErr] = useState('');
  const colName = dept === 'parts' ? 'Parts' : 'Labor';

  async function handlePdf(file) {
    if (!file) return;
    setParsing(true); setParseErr(''); setParsePreview(null);
    try {
      const parsed = await parseGrossReport(file);
      // Keep only dates in the month being viewed, map to the chosen column.
      const rowsOut = Object.keys(parsed)
        .filter(k => k.slice(0, 7) === mk)
        .sort()
        .map(k => {
          const d = new Date(k + 'T00:00:00');
          const value = dept === 'parts' ? parsed[k].parts : parsed[k].labor;
          return { dateKey: k, label: `${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`, value };
        })
        .filter(r => r.value != null);
      if (rowsOut.length === 0) {
        setParseErr(`No ${monthLabel} rows with a ${colName} total were found in this PDF. Make sure it's the gross report and the dates fall in ${monthLabel}.`);
      } else {
        setParsePreview(rowsOut);
      }
    } catch (e) {
      setParseErr('Could not read the PDF: ' + (e.message || e));
    } finally {
      setParsing(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  }

  function applyParsed() {
    if (!parsePreview) return;
    const next = { ...actuals };
    parsePreview.forEach(r => { next[r.dateKey] = safe(r.value, 0); });
    setActuals(next);
    persist({ actuals: next });
    setParsePreview(null);
    setGridOpen(true);
  }

  const saveTimer = useRef(null);
  const latestRef = useRef({ forecast: 0, lastYear: 0, actuals: {} });

  useEffect(() => {
    let cancelled = false;
    // 1) Instant paint from the local cache (if any) so the page isn't blank.
    try {
      const raw = localStorage.getItem(storageKey(mk));
      if (raw) {
        const parsed = JSON.parse(raw);
        setForecast(safe(parsed.forecast, 0));
        setLastYear(safe(parsed.lastYear, 0));
        setActuals(parsed.actuals || {});
        latestRef.current = { forecast: safe(parsed.forecast, 0), lastYear: safe(parsed.lastYear, 0), actuals: parsed.actuals || {} };
      }
    } catch { /* ignore */ }
    // 2) Authoritative load from the server (per-department file).
    loadGoalForecast(dept).then(all => {
      if (cancelled) return;
      setAllMonths(all || {});
      const bucket = (all && all[mk]) || null;
      if (bucket) {
        const f = safe(bucket.forecast, 0), ly = safe(bucket.lastYear, 0), ac = bucket.actuals || {};
        setForecast(f); setLastYear(ly); setActuals(ac);
        latestRef.current = { forecast: f, lastYear: ly, actuals: ac };
        try { localStorage.setItem(storageKey(mk), JSON.stringify({ forecast: f, lastYear: ly, actuals: ac })); } catch {}
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [mk, dept]);

  // Persist locally immediately (cache) and to the server debounced, so rapid
  // typing doesn't hammer the API. Only this department's file is touched.
  function persist(next) {
    const merged = { forecast, lastYear, actuals, ...next };
    latestRef.current = merged;
    try { localStorage.setItem(storageKey(mk), JSON.stringify(merged)); } catch { /* ignore */ }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveGoalForecastMonth(dept, mk, latestRef.current).catch(() => {});
    }, 900);
  }

  function updateForecast(val) {
    const n = safe(val, 0);
    setForecast(n);
    persist({ forecast: n });
  }

  function updateLastYear(val) {
    const n = safe(val, 0);
    setLastYear(n);
    persist({ lastYear: n });
  }

  function updateActual(dayKey, val) {
    const next = { ...actuals };
    if (val === '' || val == null) delete next[dayKey];
    else next[dayKey] = safe(val, 0);
    setActuals(next);
    persist({ actuals: next });
  }

  const dailyTarget = totalDays > 0 ? forecast / totalDays : 0;

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Each entry is that DAY's labor dollars (the single day's amount). The
  // month-to-date total is summed automatically from every day entered so far.
  let runningCum = 0;
  let dayNum = 0;
  const rows = dates.map((dt) => {
    dayNum += 1;
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const hasActual = Object.prototype.hasOwnProperty.call(actuals, k);
    const entered = safe(actuals[k], 0); // this day's labor $
    const cumTarget = dailyTarget * dayNum;
    const isToday = k === todayKey;
    const isPast = dt < todayDate;
    let cumActual = null;
    let dailyGross = 0;
    if (hasActual) {
      dailyGross = entered;
      runningCum += entered;
      cumActual = runningCum;
    }
    return { k, dt, dayNum, hasActual, entered, cumActual, dailyGross, cumTarget, isToday, isPast };
  });

  // Actual MTD = sum of every daily total entered this month.
  const actualMTD = runningCum;
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

  function printSheet() {
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const stamp = now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const sign = (n) => (n >= 0 ? '+' : '−') + money(Math.abs(n));

    const rowHtml = rows.map(r => {
      const diff = r.cumActual - r.cumTarget;
      const diffCls = !r.hasActual ? 'mut' : diff >= 0 ? 'pos' : 'neg';
      return `<tr${r.isToday ? ' class="today"' : ''}>
        <td class="c">${r.dayNum}</td>
        <td>${DOW[r.dt.getDay()]} ${r.dt.getMonth() + 1}/${r.dt.getDate()}${r.isToday ? ' <b>(Today)</b>' : ''}</td>
        <td class="r">${money(dailyTarget)}</td>
        <td class="r">${r.hasActual ? money(r.dailyGross) : '<span class="mut">—</span>'}</td>
        <td class="r">${r.hasActual ? money(r.cumActual) : '<span class="mut">—</span>'}</td>
        <td class="r ${diffCls}">${r.hasActual ? sign(diff) : '<span class="mut">—</span>'}</td>
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
        ${lastYear > 0 ? `<div class="card"><div class="lbl">Last Year</div><div class="val">${money(lastYear)}</div><div class="note">${hasActuals ? 'proj ' + (projected >= lastYear ? '+' : '−') + money(Math.abs(projected - lastYear)) + ' vs LY' : ''}</div></div>` : ''}
        <div class="card"><div class="lbl">Daily Target</div><div class="val">${money(dailyTarget)}</div></div>
        <div class="card"><div class="lbl">Actual MTD</div><div class="val">${money(actualMTD)}</div><div class="note">${completedDays} days completed</div></div>
        <div class="card"><div class="lbl">Expected MTD</div><div class="val">${money(expectedMTD)}</div><div class="note">where you should be (${completedDays} &times; target)</div></div>
        <div class="card"><div class="lbl">Daily Average</div><div class="val ${!hasActuals ? '' : runRate >= dailyTarget ? 'pos' : 'neg'}">${hasActuals ? money(runRate) : '—'}</div><div class="note">target ${money(dailyTarget)}/day</div></div>
        <div class="card"><div class="lbl">${up ? 'Ahead of Pace' : 'Behind Pace'}</div><div class="val ${up ? 'pos' : 'neg'}">${sign(variance)}</div></div>
        <div class="card"><div class="lbl">Projected Month-End</div><div class="val ${!hasActuals ? '' : projected >= forecast ? 'pos' : 'neg'}">${hasActuals ? money(projected) : '—'}</div><div class="note">${hasActuals && forecast > 0 ? sign(projected - forecast) + ' vs forecast' : ''}</div></div>
      </div>
      <table>
        <thead><tr><th class="c">Day</th><th>Date</th><th class="r">Daily Target</th><th class="r">Daily Total ($)</th><th class="r">Month Total (MTD)</th><th class="r">+/-</th></tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>
      <div class="ftr">Daily Total is the labor dollars you entered for each day. Month Total (MTD) is the running sum of those daily totals. +/- compares the month total against the cumulative daily target through that day.</div>
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
      {(parsePreview || parseErr) && (
        <div onClick={() => { setParsePreview(null); setParseErr(''); }} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.7)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '6vh 16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,.6)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#6ee7b7' }}>📤 Import {colName} Totals — {monthLabel}</div>
              <div style={{ flex: 1 }} />
              <button onClick={() => { setParsePreview(null); setParseErr(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto' }}>
              {parseErr ? (
                <div style={{ color: '#fca5a5', fontSize: 13, lineHeight: 1.5 }}>{parseErr}</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
                    Found <strong style={{ color: '#e2e8f0' }}>{parsePreview.length}</strong> day{parsePreview.length === 1 ? '' : 's'}. Review, then apply — this overwrites those days' entries.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                    {parsePreview.map(r => (
                      <div key={r.dateKey} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                        <span style={{ color: '#cbd5e1' }}>{r.label}</span>
                        <span style={{ color: '#6ee7b7', fontWeight: 700 }}>{money(r.value)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button className="secondary" onClick={() => setParsePreview(null)}>Cancel</button>
                    <button onClick={applyParsed} style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>✓ Apply {parsePreview.length} day{parsePreview.length === 1 ? '' : 's'}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">{title}</div>
          <div className="adv-sub">{monthLabel} · {currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        {!crossOpen && (
          <>
            <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={e => handlePdf(e.target.files && e.target.files[0])} />
            <button className="secondary" onClick={() => pdfInputRef.current && pdfInputRef.current.click()} disabled={parsing} style={{ marginRight: 10 }}>{parsing ? '⏳ Reading…' : '📤 Upload Report PDF'}</button>
          </>
        )}
        {!crossOpen && <button className="secondary" onClick={openCross} style={{ marginRight: 10 }}>👁 View {otherDeptLabel} Numbers</button>}
        {view === 'current' && !crossOpen && <button className="secondary" onClick={printSheet} style={{ marginRight: 10 }}>🖨 Print / PDF</button>}
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      {crossOpen ? (
        <>
          {/* Read-only cross-department view (service ↔ parts) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 40px 0', flexShrink: 0, flexWrap: 'wrap' }}>
            <button className="secondary" onClick={() => setCrossOpen(false)}>← Back to my numbers</button>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>👁 Viewing {otherDeptLabel} Goal Forecast — read-only</div>
            <div style={{ flex: 1 }} />
            {[{ k: 'current', label: monthLabel }, { k: 'history', label: '🗂 History' }].map(t => (
              <button key={t.k} onClick={() => { setCrossView(t.k); setCrossSel(null); }}
                style={{ background: crossView === t.k ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.04)', border: `1px solid ${crossView === t.k ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.1)'}`, color: crossView === t.k ? '#6ee7f9' : '#94a3b8', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
              >{t.label}</button>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 40px 32px' }}>
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              {crossView === 'history' ? (() => {
                const pastKeys = Object.keys(crossMonths || {}).filter(k => k < mk).sort().reverse();
                if (crossSel) {
                  return (
                    <div>
                      <button className="secondary" onClick={() => setCrossSel(null)} style={{ marginBottom: 16 }}>← All months</button>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0', marginBottom: 16 }}>{computeMonthMetrics(crossSel, crossMonths[crossSel]).label}</div>
                      <MonthDetail mkStr={crossSel} monthData={crossMonths[crossSel]} />
                    </div>
                  );
                }
                if (pastKeys.length === 0) return <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>No completed months yet.</div>;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {pastKeys.map(k => {
                      const M = computeMonthMetrics(k, crossMonths[k]);
                      const vsF = M.actualTotal - M.forecast;
                      return (
                        <div key={k} onClick={() => setCrossSel(k)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '14px 20px' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', minWidth: 150 }}>{M.label}</div>
                          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', flex: 1 }}>
                            <div><div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Final Total</div><div style={{ fontSize: 17, fontWeight: 800, color: '#34d399' }}>{money(M.actualTotal)}</div></div>
                            <div><div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Forecast</div><div style={{ fontSize: 17, fontWeight: 800, color: '#6ee7f9' }}>{money(M.forecast)}</div></div>
                            <div><div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>vs Forecast</div><div style={{ fontSize: 17, fontWeight: 800, color: vsF >= 0 ? '#6ee7b7' : '#fca5a5' }}>{vsF >= 0 ? '▲ ' : '▼ '}{money(Math.abs(vsF))}</div></div>
                          </div>
                          <div style={{ color: '#6ee7f9', fontSize: 13, fontWeight: 700 }}>View →</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })() : (
                (crossMonths && crossMonths[mk])
                  ? <MonthDetail mkStr={mk} monthData={crossMonths[mk]} />
                  : <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>No {otherDeptLabel.toLowerCase()} numbers entered for {monthLabel} yet.</div>
              )}
            </div>
          </div>
        </>
      ) : (<>
      {/* Tabs: current month vs history */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 40px 0', flexShrink: 0 }}>
        {[{ k: 'current', label: monthLabel }, { k: 'history', label: '🗂 History' }].map(t => (
          <button
            key={t.k}
            onClick={() => { setView(t.k); setHistSel(null); }}
            style={{
              background: view === t.k ? 'rgba(110,231,249,.18)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${view === t.k ? 'rgba(110,231,249,.5)' : 'rgba(255,255,255,.1)'}`,
              color: view === t.k ? '#6ee7f9' : '#94a3b8',
              borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
            }}
          >{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 40px 32px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>

         {view === 'history' ? (() => {
            const pastKeys = Object.keys(allMonths || {}).filter(k => k < mk).sort().reverse();
            if (histSel) {
              return (
                <div>
                  <button className="secondary" onClick={() => setHistSel(null)} style={{ marginBottom: 16 }}>← All months</button>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0', marginBottom: 16 }}>{computeMonthMetrics(histSel, allMonths[histSel]).label}</div>
                  <MonthDetail mkStr={histSel} monthData={allMonths[histSel]} />
                </div>
              );
            }
            if (pastKeys.length === 0) {
              return <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>No completed months yet. When a month ends it will appear here automatically.</div>;
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pastKeys.map(k => {
                  const M = computeMonthMetrics(k, allMonths[k]);
                  const vsF = M.actualTotal - M.forecast;
                  const vsLY = M.actualTotal - M.lastYear;
                  return (
                    <div key={k} onClick={() => setHistSel(k)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '14px 20px' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', minWidth: 150 }}>{M.label}</div>
                      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', flex: 1 }}>
                        <div><div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Final Total</div><div style={{ fontSize: 17, fontWeight: 800, color: '#34d399' }}>{money(M.actualTotal)}</div></div>
                        <div><div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Forecast</div><div style={{ fontSize: 17, fontWeight: 800, color: '#6ee7f9' }}>{money(M.forecast)}</div></div>
                        <div><div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>vs Forecast</div><div style={{ fontSize: 17, fontWeight: 800, color: vsF >= 0 ? '#6ee7b7' : '#fca5a5' }}>{vsF >= 0 ? '▲ ' : '▼ '}{money(Math.abs(vsF))}</div></div>
                        <div><div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>vs Last Year</div><div style={{ fontSize: 17, fontWeight: 800, color: vsLY >= 0 ? '#6ee7b7' : '#fca5a5' }}>{M.lastYear > 0 ? (vsLY >= 0 ? '▲ ' : '▼ ') + money(Math.abs(vsLY)) : '—'}</div></div>
                      </div>
                      <div style={{ color: '#6ee7f9', fontSize: 13, fontWeight: 700 }}>View →</div>
                    </div>
                  );
                })}
              </div>
            );
          })() : (<>

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
            <div style={{ ...cardStyle, background: 'linear-gradient(135deg,rgba(148,163,184,.14),rgba(100,116,139,.06))', border: '1px solid rgba(148,163,184,.3)' }}>
              <div style={labelStyle}>Last Year (This Month)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 900, color: '#cbd5e1' }}>$</span>
                <input
                  type="number"
                  value={lastYear || ''}
                  placeholder="0"
                  onChange={e => updateLastYear(e.target.value)}
                  style={{
                    background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.3)',
                    borderRadius: 10, padding: '8px 12px', fontSize: 26, fontWeight: 900,
                    color: '#cbd5e1', width: 200, outline: 'none',
                  }}
                />
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                {forecast > 0 && lastYear > 0
                  ? (forecast >= lastYear ? '▲ ' : '▼ ') + money(Math.abs(forecast - lastYear)) + ' forecast vs LY'
                  : 'last year’s final gross'}
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
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                where you should be ({completedDays} × daily target)
              </div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Daily Average</div>
              <div style={{ ...valStyle, color: !hasActuals ? '#e2e8f0' : runRate >= dailyTarget ? '#6ee7b7' : '#fca5a5' }}>{hasActuals ? money(runRate) : '—'}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                {hasActuals ? 'per working day · target ' + money(dailyTarget) : 'avg gross per working day'}
              </div>
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
            {lastYear > 0 && (
              <div style={cardStyle}>
                <div style={labelStyle}>vs Last Year</div>
                <div style={{ ...valStyle, color: !hasActuals ? '#e2e8f0' : projected >= lastYear ? '#6ee7b7' : '#fca5a5' }}>
                  {hasActuals ? (projected >= lastYear ? '▲ ' : '▼ ') + money(Math.abs(projected - lastYear)) : '—'}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                  {hasActuals
                    ? 'projected ' + (projected >= lastYear ? '+' : '−') + (lastYear > 0 ? Math.abs((projected / lastYear - 1) * 100).toFixed(1) : '0') + '% vs LY'
                    : 'LY ' + money(lastYear)}
                </div>
              </div>
            )}
          </div>

          {/* Daily grid (collapsible) */}
          <div style={{ background: 'rgba(15,23,42,.45)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, overflow: 'hidden' }}>
            {/* Toggle bar — click to expand/collapse the daily entry table */}
            <div
              onClick={() => setGridOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', cursor: 'pointer', userSelect: 'none', background: gridOpen ? 'rgba(110,231,249,.06)' : 'transparent' }}
            >
              <span style={{ fontSize: 13, color: gridOpen ? '#6ee7f9' : '#94a3b8', transition: 'transform .15s', transform: gridOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '.04em' }}>Daily Entry — {monthLabel}</div>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: '#64748b' }}>
                MTD <strong style={{ color: '#6ee7b7' }}>{money(actualMTD)}</strong>
                <span style={{ margin: '0 8px', color: '#334155' }}>·</span>
                {gridOpen ? 'Click to hide' : 'Click to enter / view daily numbers'}
              </div>
            </div>

            {gridOpen && (
            <div>
            <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 130px 150px 150px 130px', gap: 0, padding: '14px 20px', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderTop: '1px solid rgba(148,163,184,.15)', borderBottom: '1px solid rgba(148,163,184,.15)' }}>
              <div>Day</div>
              <div>Date</div>
              <div style={{ textAlign: 'right' }}>Daily Target</div>
              <div style={{ textAlign: 'right' }}>Daily Total ($)</div>
              <div style={{ textAlign: 'right' }}>Month Total (MTD)</div>
              <div style={{ textAlign: 'right' }}>+/-</div>
            </div>
            {rows.map((r) => {
              const diff = r.cumActual - r.cumTarget;
              const showDiff = r.hasActual;
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
                  <div style={{ textAlign: 'right', color: '#94a3b8' }}>{money(dailyTarget)}</div>
                  <div style={{ textAlign: 'right' }}>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={r.hasActual ? r.entered : ''}
                      placeholder="$ daily total"
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
                  <div style={{ textAlign: 'right', color: '#cbd5e1', fontWeight: 600 }}>{r.hasActual ? money(r.cumActual) : '—'}</div>
                  <div style={{ textAlign: 'right', fontWeight: 700, color: !showDiff ? '#475569' : diff >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                    {showDiff ? (diff >= 0 ? '▲ ' : '▼ ') + money(Math.abs(diff)) : '—'}
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 12, color: '#475569', padding: '14px 20px', textAlign: 'center' }}>
              Enter each day's total — the Month Total (MTD) and forecast are calculated automatically. Saved to {deptLabel} and synced across devices. Working days come from Goal Gauges (Edit Dashboard).
            </div>
            </div>
            )}
          </div>

          {/* Year-over-year comparison chart */}
          <ComparisonChart
            rows={rows}
            dailyTarget={dailyTarget}
            lastYear={lastYear}
            totalDays={totalDays}
            completedDays={completedDays}
            actualMTD={actualMTD}
            expectedMTD={expectedMTD}
            projected={projected}
            forecast={forecast}
          />

          </>)}

        </div>
      </div>
      </>)}
    </div>
  );
}
