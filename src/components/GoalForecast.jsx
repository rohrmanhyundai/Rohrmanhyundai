import React, { useEffect, useMemo, useState, useRef } from 'react';
import { advisorMonthProgress } from '../utils/calculations';
import { safe } from '../utils/formatters';
import { loadGoalForecast, saveGoalForecastMonth } from '../utils/github';

// Full-precision money (to the penny) — used for every actual figure on the report.
const money = (n) => '$' + safe(n, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Compact rounded money — only for chart axis tick labels, to keep them short.
const moneyAxis = (n) => '$' + Math.round(safe(n, 0)).toLocaleString('en-US');

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

// Parse a currency string like "2,973.18", "0.00", "(78.44)", "($1,423.60)" or
// fragments joined together. Parentheses or a leading "-" mean negative.
function parseCurrency(tok) {
  const t = String(tok).trim();
  if (!/\d/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const cleaned = t.replace(/[()$,\s-]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

// Parse the gross report PDF. We locate the TOTAL GROSS PROFIT "LABOR" and
// "PARTS" column headers by x-position, then for each dated row CONCATENATE every
// text fragment within each column's x-band before parsing — pdf.js can split
// "$2,973.18" into several fragments, which is why reading single tokens grabbed
// wrong/partial numbers.
//
// Returns { daily: { 'YYYY-MM-DD': {labor, parts} }, summary: { cpActual, grossActual } | null }.
// `summary` carries the month-to-date pacing figures used by the dashboard Goal
// Gauges: cpActual = Customer Pay (customer-RO LBR GROSS), grossActual = TOTAL
// GROSS PROFIT LABOR. Both are read off the MTD cumulative row — the summary row
// directly above "L Y SALES" — so they update on the same upload as the daily grid.
async function parseGrossReport(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out = {};
  let summary = null;
  // The daily LABOR/PARTS figures live on page 2 of the report (page 1 is a
  // different summary). Parse page 2 only; fall back to page 1 if there's no p2.
  const targetPages = pdf.numPages >= 2 ? [2] : [1];
  for (const p of targetPages) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter(it => it.str && it.str.trim())
      .map(it => ({ x: it.transform[4], y: it.transform[5], text: it.str.trim() }));

    // Right-most exact "LABOR"/"PARTS" tokens are the TOTAL GROSS PROFIT headers
    // (other columns read "LBR GROSS"/"PTS GROSS").
    const headerX = (word) => {
      const hits = items.filter(i => i.text.toUpperCase() === word);
      if (!hits.length) return null;
      return hits.sort((a, b) => b.x - a.x)[0].x;
    };
    const laborX = headerX('LABOR');
    const partsX = headerX('PARTS');
    if (laborX == null || partsX == null) continue; // not a report page

    // Column x-bands. Numbers sit slightly left of their header; the band stops
    // short of the UNAPPLIED column on the left and splits LABOR vs PARTS at mid.
    const gap = Math.abs(partsX - laborX) || 54;
    const mid = (laborX + partsX) / 2;
    const laborLo = laborX - gap * 0.6;
    const partsHi = partsX + gap * 0.6;

    const byY = {};
    for (const it of items) {
      const y = Math.round(it.y);
      (byY[y] = byY[y] || []).push(it);
    }
    const band = (row, lo, hi) => row.filter(t => t.x >= lo && t.x < hi).sort((a, b) => a.x - b.x).map(t => t.text).join('');
    for (const row of Object.values(byY)) {
      const dateTok = row.find(t => /^\d{2}\/\d{2}\/\d{2}$/.test(t.text));
      if (!dateTok) continue;
      const labor = parseCurrency(band(row, laborLo, mid));
      const parts = parseCurrency(band(row, mid, partsHi));
      const [mm, dd, yy] = dateTok.text.split('/');
      const key = `${2000 + Number(yy)}-${mm}-${dd}`;
      out[key] = { labor: labor == null ? 0 : labor, parts: parts == null ? 0 : parts };
    }

    // MTD pacing row for the Goal Gauges. Anchor on the "L Y SALES" label, then
    // take the summary row directly above it (no date token, has a LABOR total).
    // On that row the first currency token is the Customer-RO LBR GROSS (Customer
    // Pay); the LABOR-band value is TOTAL GROSS PROFIT LABOR (Gross Profit).
    const norm = (s) => s.replace(/\s+/g, '').toUpperCase();
    const lyRow = Object.entries(byY).find(([, row]) => row.some(t => norm(t.text) === 'LYSALES'));
    if (lyRow) {
      const lyY = Number(lyRow[0]);
      let mtd = null;
      for (const [y, row] of Object.entries(byY)) {
        const yy = Number(y);
        if (yy <= lyY) continue;
        if (row.some(t => /^\d{2}\/\d{2}\/\d{2}$/.test(t.text))) continue;
        const grossActual = parseCurrency(band(row, laborLo, mid));
        if (grossActual == null) continue;
        if (mtd === null || yy < mtd.y) mtd = { y: yy, row, grossActual };
      }
      if (mtd) {
        const sorted = [...mtd.row].sort((a, b) => a.x - b.x);
        const firstCur = sorted.map(t => t.text).find(t => /\$/.test(t) && parseCurrency(t) != null);
        const cpActual = parseCurrency(firstCur);

        // Per-category LABOR breakdown for the detailed report: the three
        // "LBR GROSS" columns (Customer / Warranty / Internal), UNAPPLIED, and
        // TOTAL LABOR. The MTD breakdown belongs to the grand-total-of-daily row
        // (whose total labor equals the sum of the daily entries = the Goal
        // Forecast's Actual MTD), NOT the bigger row above "L Y SALES" the gauges
        // use. Match it by that sum; the LY breakdown is the "L Y SALES" row.
        const lbrXs = items.filter(i => /^LBR\s*GROSS$/i.test(i.text)).map(i => i.x).sort((a, b) => a - b);
        const unappHdr = items.find(i => /^UNAPPLIED$/i.test(i.text));
        const readLabor = (row) => {
          const [custX, warrX, intX] = lbrXs;
          const v = (lo, hi) => parseCurrency(band(row, lo, hi));
          return {
            cp:        custX != null ? (v(custX - 15, custX + 40) || 0) : 0,
            warranty:  warrX != null ? (v(warrX - 15, warrX + 35) || 0) : 0,
            internal:  intX  != null ? (v(intX - 14, intX + 35) || 0) : 0,
            unapplied: unappHdr ? (v(unappHdr.x - 8, unappHdr.x + 42) || 0) : 0,
            total:     v(laborLo, mid) || 0,
          };
        };
        const dailySum = Object.values(out).reduce((s, r) => s + (r.labor || 0), 0);
        let mtdRow = null, best = Infinity;
        for (const [, row] of Object.entries(byY)) {
          if (row.some(t => /^\d{2}\/\d{2}\/\d{2}$/.test(t.text))) continue;
          const total = parseCurrency(band(row, laborLo, mid));
          if (total == null) continue;
          const diff = Math.abs(total - dailySum);
          if (diff < best) { best = diff; mtdRow = row; }
        }
        const labor = (dailySum > 1 && mtdRow && best < 5)
          ? { mtd: readLabor(mtdRow), ly: readLabor(lyRow[1]) }
          : null;
        summary = { cpActual: cpActual == null ? null : cpActual, grossActual: mtd.grossActual, labor };
      }
    }
  }
  return { daily: out, summary };
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
  // "Where you should be" = the pace target for the days counted so far
  // (dailyTarget × completedDays), NOT the full-month forecast. For a fully
  // entered/completed month completedDays === totalDays, so this equals the
  // forecast — but mid-month it correctly shows the to-date expectation.
  const expectedMTD = dailyTarget * completedDays;
  // For the CURRENT month, project month-end from the run rate (so a cross-dept
  // viewer sees the same projection the owner does). For PAST months the month is
  // done, so the projection is just the final total.
  const projected = mkStr === monthKey() ? runRate * totalDays : actualTotal;
  return { year, monthIdx, label, dates, forecast, lastYear, actuals, totalDays, dailyTarget, rows, actualTotal, enteredDays, completedDays, runRate, expectedMTD, projected };
}

// Read-only detail for one completed/historical month.
function MonthDetail({ mkStr, monthData, editable = false, onEditDay }) {
  const M = computeMonthMetrics(mkStr, monthData);
  const vsForecast = M.actualTotal - M.forecast;
  const vsLY = M.actualTotal - M.lastYear;
  const [open, setOpen] = useState(false); // daily table collapsed until clicked
  const card = (icon, label, value, color, sub) => (
    <MetricCard accent={color} icon={icon} label={label} sub={sub} minWidth={160}>
      <div style={gfBig(color)}>{value}</div>
    </MetricCard>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        {card('🏁', 'Final Total', money(M.actualTotal), '#34d399', `${M.enteredDays} of ${M.totalDays} days entered`)}
        {card('💰', 'Forecast', money(M.forecast), '#38bdf8', `${vsForecast >= 0 ? '▲ ' : '▼ '}${money(Math.abs(vsForecast))} vs forecast`)}
        {card('📆', 'Last Year', money(M.lastYear), '#fbbf24', M.lastYear > 0 ? `${vsLY >= 0 ? '▲ ' : '▼ '}${money(Math.abs(vsLY))} vs LY` : '—')}
        {card('📈', 'Daily Average', money(M.runRate), M.runRate >= M.dailyTarget ? '#34d399' : '#fb7185', `target ${money(M.dailyTarget)}/day`)}
      </div>

      <ComparisonChart
        rows={M.rows} dailyTarget={M.dailyTarget} lastYear={M.lastYear}
        totalDays={M.totalDays} completedDays={M.completedDays}
        actualMTD={M.actualTotal} expectedMTD={M.expectedMTD} projected={M.projected} forecast={M.forecast}
      />

      {/* Read-only daily table (collapsed until clicked) */}
      <div style={{ marginTop: 18, background: 'linear-gradient(160deg, rgba(56,189,248,.10), rgba(15,23,42,.55) 60%)', border: '1px solid rgba(56,189,248,.28)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 30px -18px rgba(56,189,248,.7)' }}>
        <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', cursor: 'pointer', userSelect: 'none', background: open ? 'rgba(56,189,248,.08)' : 'transparent' }}>
          <span style={{ fontSize: 13, color: open ? '#38bdf8' : '#94a3b8', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
          <span style={{ fontSize: 14 }}>📅</span>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '.05em' }}>Daily Entry — {M.label}</div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: '#64748b' }}>{open ? 'Click to hide' : 'Click to view daily numbers'}</div>
        </div>
        {open && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 130px 150px 150px 130px', gap: 0, padding: '14px 20px', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', borderTop: '1px solid rgba(148,163,184,.15)', borderBottom: '1px solid rgba(148,163,184,.15)' }}>
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
                  <div style={{ textAlign: 'right' }}>
                    {editable
                      ? <input type="number" inputMode="decimal" value={r.hasActual ? r.entered : ''} placeholder="$ daily total"
                          onChange={e => onEditDay && onEditDay(r.k, e.target.value)}
                          style={{ background: 'rgba(2,6,23,.55)', border: `1px solid ${r.hasActual ? 'rgba(52,211,153,.4)' : 'rgba(148,163,184,.35)'}`, borderRadius: 8, padding: '7px 10px', fontSize: 14, fontWeight: 700, color: r.hasActual ? '#6ee7b7' : '#e2e8f0', width: 120, textAlign: 'right', outline: 'none' }} />
                      : <span style={{ color: r.hasActual ? '#6ee7b7' : '#475569', fontWeight: 700 }}>{r.hasActual ? money(r.dailyGross) : '—'}</span>}
                  </div>
                  <div style={{ textAlign: 'right', color: '#cbd5e1', fontWeight: 600 }}>{r.hasActual ? money(r.cumActual) : '—'}</div>
                  <div style={{ textAlign: 'right', fontWeight: 700, color: !r.hasActual ? '#475569' : diff >= 0 ? '#6ee7b7' : '#fca5a5' }}>{r.hasActual ? (diff >= 0 ? '▲ ' : '▼ ') + money(Math.abs(diff)) : '—'}</div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// Clean cumulative year-over-year comparison chart. Plots three running lines
// across the month's working days: This Year (actual entered), Where You Should
// Be (forecast pace), and Last Year (LY total spread evenly). Pure SVG, scales
// to the container width via viewBox.
// Vivid, themed summary card (matches the advisor forecast look): gradient wash,
// colored border + glow, accent label/icon, big glowing value.
const gfLbl = { fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase' };
function MetricCard({ accent, icon, label, sub, subColor, children, minWidth = 175, onClick }) {
  return (
    <div onClick={onClick} style={{
      flex: 1, minWidth, borderRadius: 16, padding: '16px 18px', position: 'relative', overflow: 'hidden',
      background: `linear-gradient(150deg, ${accent}26, ${accent}0a 55%, rgba(2,6,23,.55))`,
      border: `1px solid ${accent}55`, boxShadow: `0 10px 30px -14px ${accent}99, inset 0 1px 0 ${accent}26`,
      cursor: onClick ? 'pointer' : undefined,
    }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 92, height: 92, borderRadius: '50%', background: `radial-gradient(circle, ${accent}3a, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <div style={{ ...gfLbl, color: accent }}>{label}</div>
      </div>
      <div style={{ position: 'relative' }}>{children}</div>
      {sub != null && <div style={{ fontSize: 11.5, color: subColor || '#94a3b8', marginTop: 5, fontWeight: 600, position: 'relative' }}>{sub}</div>}
    </div>
  );
}
const gfBig = (color) => ({ fontSize: 27, fontWeight: 900, color, marginTop: 6, letterSpacing: '-.01em', textShadow: `0 0 22px ${color}55` });

// Detailed labor-gross breakdown, opened from the Actual MTD card. Shows each
// labor category's MTD, projected month-end (MTD pace × workdays) and how that
// projection paces vs last year — same look/colors as the Goal Forecast page.
function LaborBreakdownModal({ breakdown, completedDays, totalDays, monthLabel, onClose }) {
  const cats = [
    { key: 'cp',        label: 'Customer Pay Labor', accent: '#38bdf8' },
    { key: 'warranty',  label: 'Warranty Labor',     accent: '#a78bfa' },
    { key: 'internal',  label: 'Internal Labor',     accent: '#fbbf24' },
    { key: 'unapplied', label: 'Unapplied',          accent: '#94a3b8' },
    { key: 'total',     label: 'Total Labor Gross',  accent: '#34d399' },
  ];
  const cd = Math.max(completedDays || 0, 1);
  const td = Math.max(totalDays || cd, cd);
  const rows = cats.map(c => {
    const mtd = safe(breakdown?.mtd?.[c.key], 0);
    const ly = safe(breakdown?.ly?.[c.key], 0);
    const projected = (mtd / cd) * td;
    const delta = projected - ly;
    const pct = ly !== 0 ? (projected / ly - 1) * 100 : 0;
    return { ...c, mtd, ly, projected, delta, pct };
  });
  const parts = rows.filter(r => r.key !== 'total');
  const maxVal = Math.max(1, ...parts.flatMap(r => [Math.abs(r.projected), Math.abs(r.ly)]));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.78)', backdropFilter: 'blur(3px)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 1280, background: 'linear-gradient(160deg,#0c1322,#0a0f1c)', border: '1px solid rgba(148,163,184,.22)', borderRadius: 22, padding: 32, boxShadow: '0 30px 90px rgba(0,0,0,.65)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 27, fontWeight: 900, background: 'linear-gradient(90deg,#eafcff,#7dd3fc 55%,#c4b5fd)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>Labor Gross Breakdown</div>
            <div style={{ fontSize: 14.5, color: '#94a3b8', marginTop: 4 }}>{monthLabel} · projected month-end paced vs last year · {cd} of {td} workdays</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(148,163,184,.25)', color: '#cbd5e1', borderRadius: 12, width: 46, height: 46, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* Category cards */}
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '26px 0 28px' }}>
          {rows.map(r => {
            const up = r.delta >= 0;
            const dColor = up ? '#34d399' : '#fb7185';
            return (
              <MetricCard key={r.key} accent={r.accent} icon={r.key === 'total' ? '🏁' : '🔧'} label={r.label}
                minWidth={r.key === 'total' ? 260 : 210}
                sub={<span style={{ fontSize: 13.5 }}>projected <strong style={{ color: '#e2e8f0' }}>{money(r.projected)}</strong> · <span style={{ color: dColor, fontWeight: 800 }}>{up ? '▲' : '▼'} {money(Math.abs(r.delta))}</span> vs LY{r.ly !== 0 ? ` (${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(1)}%)` : ''}</span>}>
                <div style={{ ...gfBig(r.accent), fontSize: 34 }}>{money(r.mtd)}</div>
              </MetricCard>
            );
          })}
        </div>

        {/* Projected vs Last Year — horizontal bars per category */}
        <div style={{ borderRadius: 18, padding: '22px 26px', background: 'linear-gradient(150deg,rgba(56,189,248,.08),rgba(2,6,23,.4))', border: '1px solid rgba(148,163,184,.16)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '.05em' }}>Projected Month-End vs Last Year</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#94a3b8' }}>
              <span><span style={{ display: 'inline-block', width: 24, height: 9, borderRadius: 4, background: '#38bdf8', verticalAlign: 'middle', marginRight: 6 }} />Projected</span>
              <span><span style={{ display: 'inline-block', width: 24, height: 9, borderRadius: 4, background: 'rgba(148,163,184,.5)', verticalAlign: 'middle', marginRight: 6 }} />Last Year</span>
            </div>
          </div>
          {parts.map(r => {
            const up = r.delta >= 0;
            return (
              <div key={r.key} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 6 }}>
                  <span style={{ color: r.accent, fontWeight: 800 }}>{r.label}</span>
                  <span style={{ color: '#94a3b8' }}>proj <strong style={{ color: '#e2e8f0' }}>{money(r.projected)}</strong> · LY {money(r.ly)}</span>
                </div>
                <div style={{ position: 'relative', height: 28 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, height: 11, borderRadius: 6, width: `${Math.max(1.5, Math.abs(r.projected) / maxVal * 100)}%`, background: `linear-gradient(90deg, ${r.accent}, ${r.accent}bb)`, boxShadow: `0 0 12px ${r.accent}66` }} />
                  <div style={{ position: 'absolute', top: 15, left: 0, height: 11, borderRadius: 6, width: `${Math.max(1.5, Math.abs(r.ly) / maxVal * 100)}%`, background: 'rgba(148,163,184,.45)' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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
  const tyArea = enteredRows.length ? `${x(enteredRows[0].dayNum).toFixed(1)},${y(0).toFixed(1)} ${tyPts} ${x(lastTy.dayNum).toFixed(1)},${y(0).toFixed(1)}` : '';

  const C = { ty: '#34d399', tgt: '#38bdf8', ly: '#fbbf24' };
  const Stat = ({ label, value, color, sub }) => (
    <MetricCard accent={color} icon="" label={label} sub={sub} minWidth={150}>
      <div style={gfBig(color)}>{value}</div>
    </MetricCard>
  );

  const LegendDot = ({ color, dashed, children }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}>
      <span style={{ width: 22, height: 0, borderTop: `3px ${dashed ? 'dashed' : 'solid'} ${color}`, display: 'inline-block' }} />
      {children}
    </span>
  );

  return (
    <div style={{ marginTop: 28, background: `linear-gradient(160deg, ${C.ty}1c, rgba(15,23,42,.62) 55%)`, border: `1px solid ${C.ty}40`, borderRadius: 18, padding: '20px 24px', boxShadow: `0 14px 38px -18px ${C.ty}80` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ width: 4, height: 18, borderRadius: 3, background: `linear-gradient(${C.ty},${C.tgt})` }} />
        <div style={{ fontSize: 14, fontWeight: 900, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '.05em' }}>Pace Comparison</div>
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
        <defs>
          <linearGradient id="gf-ty-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.ty} stopOpacity="0.38" />
            <stop offset="100%" stopColor={C.ty} stopOpacity="0" />
          </linearGradient>
          <filter id="gf-ty-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={C.ty} floodOpacity="0.55" />
          </filter>
        </defs>
        {/* y gridlines + labels */}
        {tickVals.map((tv, i) => (
          <g key={i}>
            <line x1={padL} y1={y(tv)} x2={W - padR} y2={y(tv)} stroke="rgba(148,163,184,.14)" strokeWidth="1" />
            <text x={padL - 10} y={y(tv) + 4} textAnchor="end" fontSize="11" fill="#64748b">{moneyAxis(tv)}</text>
          </g>
        ))}
        {/* x labels */}
        {xLabelRows.map((r) => (
          <text key={r.k} x={x(r.dayNum)} y={H - padB + 22} textAnchor="middle" fontSize="11" fill="#64748b">{r.dt.getMonth() + 1}/{r.dt.getDate()}</text>
        ))}
        {/* This Year gradient fill */}
        {tyArea && <polygon points={tyArea} fill="url(#gf-ty-fill)" />}
        {/* Last Year pace */}
        {lastYear > 0 && <polyline points={lyPts} fill="none" stroke={C.ly} strokeWidth="2.5" strokeDasharray="7 6" opacity="0.9" />}
        {/* Target pace */}
        {forecast > 0 && <polyline points={tgtPts} fill="none" stroke={C.tgt} strokeWidth="2.5" strokeDasharray="7 6" opacity="0.95" />}
        {/* This Year actual */}
        {enteredRows.length > 0 && <polyline points={tyPts} fill="none" stroke={C.ty} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" filter="url(#gf-ty-glow)" />}
        {/* End dot + value pill for This Year */}
        {lastTy && (
          <g>
            <circle cx={x(lastTy.dayNum)} cy={y(lastTy.cumActual)} r="6" fill={C.ty} stroke="#04201d" strokeWidth="2.5" />
            <rect x={x(lastTy.dayNum) - 44} y={y(lastTy.cumActual) - 36} width="88" height="22" rx="11" fill={C.ty} />
            <text x={x(lastTy.dayNum)} y={y(lastTy.cumActual) - 21} textAnchor="middle" fontSize="13" fontWeight="900" fill="#04201d">{money(lastTy.cumActual)}</text>
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
  onGaugeActuals,
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
  const [laborBreakdown, setLaborBreakdown] = useState(null); // { mtd:{cp,warranty,internal,unapplied,total}, ly:{...} } from the last gross-report upload
  const [breakdownOpen, setBreakdownOpen] = useState(false);
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
  const crossPdfInputRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [parsePreview, setParsePreview] = useState(null); // [{ dateKey, label, value }] — shown for the button's dept
  const [parsedDaily, setParsedDaily] = useState(null); // { 'YYYY-MM-DD': {labor, parts} } — used to write BOTH depts
  const [parseSummary, setParseSummary] = useState(null); // { cpActual, grossActual, labor } | null — service MTD pacing for the gauges/breakdown
  const [parseErr, setParseErr] = useState('');
  const [parseDept, setParseDept] = useState(dept); // which dept the preview applies to
  const colName = parseDept === 'parts' ? 'Parts' : 'Labor';

  // targetDept = which forecast to import into ('service'|'parts'). Defaults to
  // the page's own dept; the cross-view passes the OTHER dept so you can import
  // parts numbers from a service login and vice-versa.
  async function handlePdf(file, targetDept = dept) {
    if (!file) return;
    setParsing(true); setParseErr(''); setParsePreview(null); setParsedDaily(null); setParseSummary(null); setParseDept(targetDept);
    const col = targetDept === 'parts' ? 'Parts' : 'Labor';
    try {
      const { daily: parsed, summary } = await parseGrossReport(file);
      const monthDaily = {};
      Object.keys(parsed).filter(k => k.slice(0, 7) === mk).forEach(k => { monthDaily[k] = parsed[k]; });
      // Preview shows the button's own column, but on Apply we fill BOTH the
      // Service (labor) and Parts (parts) forecasts from this one report.
      const rowsOut = Object.keys(monthDaily)
        .sort()
        .map(k => {
          const d = new Date(k + 'T00:00:00');
          const value = targetDept === 'parts' ? monthDaily[k].parts : monthDaily[k].labor;
          return { dateKey: k, label: `${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`, value };
        })
        .filter(r => r.value != null);
      if (rowsOut.length === 0) {
        setParseErr(`No ${monthLabel} rows with a ${col} total were found in this PDF. Make sure it's the gross report and the dates fall in ${monthLabel}.`);
      } else {
        setParsePreview(rowsOut);
        setParsedDaily(monthDaily);
        // Service labor pacing (gauges + breakdown) always comes from the report.
        setParseSummary(summary);
      }
    } catch (e) {
      setParseErr('Could not read the PDF: ' + (e.message || e));
    } finally {
      setParsing(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
      if (crossPdfInputRef.current) crossPdfInputRef.current.value = '';
    }
  }

  // Write a department's daily actuals for this month, merging into its current
  // bucket. The page's OWN dept updates live state; the OTHER dept is loaded,
  // merged and saved to the server + cache so nothing it already has is lost.
  async function writeDeptActuals(targetD, rowsByDate, extra) {
    if (!rowsByDate || (!Object.keys(rowsByDate).length && !extra)) return;
    if (targetD === dept) {
      const next = { ...actuals, ...rowsByDate };
      setActuals(next);
      if (extra && extra.laborBreakdown) setLaborBreakdown(extra.laborBreakdown);
      persist({ actuals: next, ...(extra || {}) });
      setGridOpen(true);
    } else {
      let all = {};
      try { all = await loadGoalForecast(targetD); } catch { all = {}; }
      const bucket = { forecast: 0, lastYear: 0, actuals: {}, ...((all && all[mk]) || {}) };
      const nextActuals = { ...(bucket.actuals || {}), ...rowsByDate };
      const nextBucket = { ...bucket, actuals: nextActuals, ...(extra || {}) };
      saveGoalForecastMonth(targetD, mk, nextBucket).catch(() => {});
      if (targetD === otherDept) setCrossMonths(prev => ({ ...prev, [mk]: nextBucket }));
      try {
        const prefix = targetD === 'parts' ? 'partsGoalForecast' : 'goalForecast';
        const saved = JSON.parse(localStorage.getItem(`${prefix}-${mk}`) || '{}') || {};
        localStorage.setItem(`${prefix}-${mk}`, JSON.stringify({ ...saved, actuals: nextActuals, ...(extra || {}) }));
      } catch {}
    }
  }

  function applyParsed() {
    if (!parsePreview || !parsedDaily) return;
    // One report, both departments: LABOR → Service, PARTS → Parts.
    const svcRows = {}, partsRows = {};
    Object.entries(parsedDaily).forEach(([k, v]) => {
      if (v.labor != null) svcRows[k] = safe(v.labor, 0);
      if (v.parts != null) partsRows[k] = safe(v.parts, 0);
    });
    const lb = (parseSummary && parseSummary.labor) ? parseSummary.labor : null;
    writeDeptActuals('service', svcRows, lb ? { laborBreakdown: lb } : null);
    writeDeptActuals('parts', partsRows, null);

    // Push the service MTD pacing figures to the dashboard Goal Gauges.
    if (parseSummary && onGaugeActuals) {
      const patch = {};
      if (parseSummary.grossActual != null) patch.grossActual = safe(parseSummary.grossActual, 0);
      if (parseSummary.cpActual != null) patch.cpActual = safe(parseSummary.cpActual, 0);
      if (Object.keys(patch).length) onGaugeActuals(patch);
    }
    setParsePreview(null);
    setParsedDaily(null);
    setParseSummary(null);
  }

  const saveTimer = useRef(null);
  const histSaveTimer = useRef(null);
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
        setLaborBreakdown(parsed.laborBreakdown || null);
        latestRef.current = { forecast: safe(parsed.forecast, 0), lastYear: safe(parsed.lastYear, 0), actuals: parsed.actuals || {}, laborBreakdown: parsed.laborBreakdown || null };
      }
    } catch { /* ignore */ }
    // 2) Authoritative load from the server (per-department file).
    loadGoalForecast(dept).then(all => {
      if (cancelled) return;
      setAllMonths(all || {});
      const bucket = (all && all[mk]) || null;
      if (bucket) {
        const f = safe(bucket.forecast, 0), ly = safe(bucket.lastYear, 0), ac = bucket.actuals || {};
        const lb = bucket.laborBreakdown || null;
        setForecast(f); setLastYear(ly); setActuals(ac); setLaborBreakdown(lb);
        latestRef.current = { forecast: f, lastYear: ly, actuals: ac, laborBreakdown: lb };
        try { localStorage.setItem(storageKey(mk), JSON.stringify({ forecast: f, lastYear: ly, actuals: ac, laborBreakdown: lb })); } catch {}
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [mk, dept]);

  // Persist locally immediately (cache) and to the server debounced, so rapid
  // typing doesn't hammer the API. Only this department's file is touched.
  function persist(next) {
    const merged = { forecast, lastYear, actuals, laborBreakdown, ...next };
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

  // Edit a PAST (history) month's daily total — updates that month's bucket in
  // allMonths and saves it (debounced) to this department's file.
  function updateHistActual(histMk, dayKey, val) {
    const prev = allMonths || {};
    const bucket = { forecast: 0, lastYear: 0, actuals: {}, ...(prev[histMk] || {}) };
    const nextActuals = { ...(bucket.actuals || {}) };
    if (val === '' || val == null) delete nextActuals[dayKey];
    else nextActuals[dayKey] = safe(val, 0);
    const nextBucket = { ...bucket, actuals: nextActuals };
    setAllMonths({ ...prev, [histMk]: nextBucket });
    if (histSaveTimer.current) clearTimeout(histSaveTimer.current);
    histSaveTimer.current = setTimeout(() => { saveGoalForecastMonth(dept, histMk, nextBucket).catch(() => {}); }, 900);
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

  // Renders the print/PDF sheet for any department's forecast. P carries every
  // figure so this works for the logged-in user's own numbers AND the read-only
  // cross-department view (service ↔ parts).
  function renderForecastPrint(P) {
    const { monthLabel: ml, deptLabel: dl, userLabel,
      forecast, lastYear, dailyTarget, actualMTD, expectedMTD,
      completedDays, totalDays, runRate, projected, rows } = P;
    const variance = actualMTD - expectedMTD;
    const up = variance >= 0;
    const hasActuals = actualMTD > 0;
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const stamp = now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const sign = (n) => (n >= 0 ? '+' : '−') + money(Math.abs(n));
    const pctPace = expectedMTD > 0 ? Math.round((actualMTD / expectedMTD) * 100) : 0;

    const rowHtml = rows.map(r => {
      const isToday = r.isToday != null ? r.isToday : (r.k === todayKey);
      const diff = r.cumActual - r.cumTarget;
      const diffCls = !r.hasActual ? 'mut' : diff >= 0 ? 'pos' : 'neg';
      return `<tr${isToday ? ' class="today"' : ''}>
        <td class="c">${r.dayNum}</td>
        <td>${DOW[r.dt.getDay()]} ${r.dt.getMonth() + 1}/${r.dt.getDate()}${isToday ? ' <span class="badge">Today</span>' : ''}</td>
        <td class="r mut2">${money(dailyTarget)}</td>
        <td class="r">${r.hasActual ? money(r.dailyGross) : '<span class="mut">—</span>'}</td>
        <td class="r">${r.hasActual ? '<b>' + money(r.cumActual) + '</b>' : '<span class="mut">—</span>'}</td>
        <td class="r ${diffCls}">${r.hasActual ? '<span class="pill">' + sign(diff) + '</span>' : '<span class="mut">—</span>'}</td>
      </tr>`;
    }).join('');

    // ---- Pace comparison chart (light theme, mirrors on-screen ComparisonChart) ----
    const W = 1040, H = 440, padL = 86, padR = 34, padT = 30, padB = 60;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = Math.max(totalDays || rows.length || 1, 1);
    const lyCumAt = (d) => (lastYear / n) * d;
    const tgtCumAt = (d) => dailyTarget * d;
    const enteredRows = rows.filter(r => r.hasActual);
    const maxActual = enteredRows.length ? Math.max(...enteredRows.map(r => r.cumActual)) : 0;
    const maxVal = Math.max(forecast, lastYear, maxActual, dailyTarget * n, 1) * 1.08;
    const cx = (d) => padL + (plotW * (d - 1)) / Math.max(n - 1, 1);
    const cy = (v) => padT + plotH - (plotH * Math.max(v, 0)) / maxVal;
    const tgtPts = rows.map(r => `${cx(r.dayNum).toFixed(1)},${cy(tgtCumAt(r.dayNum)).toFixed(1)}`).join(' ');
    const lyPts = rows.map(r => `${cx(r.dayNum).toFixed(1)},${cy(lyCumAt(r.dayNum)).toFixed(1)}`).join(' ');
    const tyPts = enteredRows.map(r => `${cx(r.dayNum).toFixed(1)},${cy(r.cumActual).toFixed(1)}`).join(' ');
    const tyArea = enteredRows.length ? `${cx(enteredRows[0].dayNum).toFixed(1)},${cy(0).toFixed(1)} ${tyPts} ${cx(enteredRows[enteredRows.length - 1].dayNum).toFixed(1)},${cy(0).toFixed(1)}` : '';
    const ticks = 5;
    const tickVals = Array.from({ length: ticks + 1 }, (_, i) => (maxVal / ticks) * i);
    const xLabelRows = rows.filter((r, i) => i % 5 === 0 || i === rows.length - 1);
    const lastTy = enteredRows.length ? enteredRows[enteredRows.length - 1] : null;
    const C = { ty: '#059669', tgt: '#0284c7', ly: '#d97706' };

    const chartSvg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">
      <defs><linearGradient id="tyfill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${C.ty}" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="${C.ty}" stop-opacity="0"/>
      </linearGradient></defs>
      ${tickVals.map(tv => `<line x1="${padL}" y1="${cy(tv).toFixed(1)}" x2="${W - padR}" y2="${cy(tv).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>
        <text x="${padL - 12}" y="${(cy(tv) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#94a3b8">${moneyAxis(tv)}</text>`).join('')}
      ${xLabelRows.map(r => `<text x="${cx(r.dayNum).toFixed(1)}" y="${H - padB + 24}" text-anchor="middle" font-size="11" fill="#94a3b8">${r.dt.getMonth() + 1}/${r.dt.getDate()}</text>`).join('')}
      ${tyArea ? `<polygon points="${tyArea}" fill="url(#tyfill)"/>` : ''}
      ${lastYear > 0 ? `<polyline points="${lyPts}" fill="none" stroke="${C.ly}" stroke-width="2" stroke-dasharray="6 5"/>` : ''}
      ${forecast > 0 ? `<polyline points="${tgtPts}" fill="none" stroke="${C.tgt}" stroke-width="2" stroke-dasharray="6 5"/>` : ''}
      ${enteredRows.length ? `<polyline points="${tyPts}" fill="none" stroke="${C.ty}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      ${lastTy ? `<circle cx="${cx(lastTy.dayNum).toFixed(1)}" cy="${cy(lastTy.cumActual).toFixed(1)}" r="5" fill="${C.ty}" stroke="#fff" stroke-width="2"/>
        <text x="${cx(lastTy.dayNum).toFixed(1)}" y="${(cy(lastTy.cumActual) - 13).toFixed(1)}" text-anchor="middle" font-size="12.5" font-weight="800" fill="${C.ty}">${money(lastTy.cumActual)}</text>` : ''}
    </svg>`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${esc(ml)}</title>
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 40px; -webkit-font-smoothing: antialiased; }
      .head { display: flex; align-items: flex-start; gap: 16px; padding-bottom: 18px; border-bottom: 2px solid #0f172a; margin-bottom: 26px; }
      .head .accent { width: 5px; align-self: stretch; border-radius: 3px; background: linear-gradient(180deg, #059669, #0284c7); }
      h1 { font-size: 25px; font-weight: 800; margin: 0; letter-spacing: -.01em; }
      .sub { color: #64748b; font-size: 12.5px; margin-top: 5px; }
      .sub b { color: #334155; font-weight: 700; }
      .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
      .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; background: #fff; }
      .card.hero { border-color: transparent; background: #f0fdf4; box-shadow: inset 0 0 0 1px #bbf7d0; }
      .card.hero.down { background: #fef2f2; box-shadow: inset 0 0 0 1px #fecaca; }
      .card .lbl { font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; color: #94a3b8; font-weight: 700; }
      .card .val { font-size: 21px; font-weight: 800; margin-top: 5px; letter-spacing: -.01em; }
      .card .note { font-size: 10.5px; color: #94a3b8; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { text-align: left; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: #94a3b8; border-bottom: 1.5px solid #cbd5e1; padding: 9px 12px; font-weight: 700; }
      td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; }
      tbody tr:nth-child(even) td { background: #fafbfc; }
      th.r, td.r { text-align: right; } th.c, td.c { text-align: center; }
      td.c { color: #cbd5e1; font-variant-numeric: tabular-nums; }
      td.r { font-variant-numeric: tabular-nums; }
      tr.today td { background: #ecfdf5 !important; font-weight: 700; box-shadow: inset 3px 0 0 #059669; }
      .badge { display: inline-block; background: #059669; color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; margin-left: 6px; vertical-align: middle; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 11px; }
      .pos { color: #047857; } .pos .pill, td.r.pos .pill { background: #ecfdf5; }
      .neg { color: #dc2626; } .neg .pill, td.r.neg .pill { background: #fef2f2; }
      .mut { color: #cbd5e1; } .mut2 { color: #94a3b8; }
      .sec { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #334155; margin: 0 0 4px; }
      .legend { display: flex; gap: 22px; margin: 10px 0 6px; font-size: 12px; color: #475569; font-weight: 600; }
      .legend span { display: inline-flex; align-items: center; gap: 8px; }
      .legend i { width: 22px; height: 0; display: inline-block; }
      .chart-wrap { border: 1px solid #e2e8f0; border-radius: 14px; padding: 22px 24px; margin-top: 12px; }
      .chart-page { page-break-before: always; }
      .ftr { margin-top: 20px; font-size: 10.5px; color: #94a3b8; line-height: 1.5; }
      @media print { body { margin: 0; } @page { margin: 14mm; } }
    </style></head><body>
      <div class="head">
        <div class="accent"></div>
        <div>
          <h1>${esc(title)} — ${esc(ml)}</h1>
          <div class="sub">Bob Rohrman Hyundai &middot; <b>${esc(dl)}</b> &middot; ${esc(userLabel)} &middot; Generated ${esc(stamp)}</div>
        </div>
      </div>
      <div class="cards">
        <div class="card"><div class="lbl">Forecast</div><div class="val">${money(forecast)}</div><div class="note">${totalDays} working days</div></div>
        ${lastYear > 0 ? `<div class="card"><div class="lbl">Last Year</div><div class="val">${money(lastYear)}</div><div class="note">${hasActuals ? 'proj ' + (projected >= lastYear ? '+' : '−') + money(Math.abs(projected - lastYear)) + ' vs LY' : ''}</div></div>` : ''}
        <div class="card"><div class="lbl">Daily Target</div><div class="val">${money(dailyTarget)}</div><div class="note">to hit forecast</div></div>
        <div class="card"><div class="lbl">Actual MTD</div><div class="val">${money(actualMTD)}</div><div class="note">${completedDays} days completed</div></div>
        <div class="card"><div class="lbl">Expected MTD</div><div class="val">${money(expectedMTD)}</div><div class="note">where you should be (${completedDays} &times; target)</div></div>
        <div class="card"><div class="lbl">Daily Average</div><div class="val ${!hasActuals ? '' : runRate >= dailyTarget ? 'pos' : 'neg'}">${hasActuals ? money(runRate) : '—'}</div><div class="note">target ${money(dailyTarget)}/day</div></div>
        <div class="card hero ${up ? '' : 'down'}"><div class="lbl">${up ? 'Ahead of Pace' : 'Behind Pace'}</div><div class="val ${up ? 'pos' : 'neg'}">${sign(variance)}</div><div class="note">${hasActuals ? pctPace + '% of expected' : ''}</div></div>
        <div class="card hero ${!hasActuals || projected >= forecast ? '' : 'down'}"><div class="lbl">Projected Month-End</div><div class="val ${!hasActuals ? '' : projected >= forecast ? 'pos' : 'neg'}">${hasActuals ? money(projected) : '—'}</div><div class="note">${hasActuals && forecast > 0 ? sign(projected - forecast) + ' vs forecast' : ''}</div></div>
      </div>
      <table>
        <thead><tr><th class="c">Day</th><th>Date</th><th class="r">Daily Target</th><th class="r">Daily Total ($)</th><th class="r">Month Total (MTD)</th><th class="r">+/-</th></tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>
      <div class="ftr">Daily Total is the labor dollars you entered for each day. Month Total (MTD) is the running sum of those daily totals. +/- compares the month total against the cumulative daily target through that day.</div>

      <div class="chart-page">
        <div class="sec">Pace Comparison</div>
        <div class="sub">Cumulative ${dl === 'Parts Department' ? 'parts' : 'labor'} dollars through ${esc(ml)} — actual vs. target vs. last year.</div>
        <div class="legend">
          <span><i style="border-top:3px solid ${C.ty}"></i>This Year</span>
          <span><i style="border-top:3px dashed ${C.tgt}"></i>Where You Should Be</span>
          ${lastYear > 0 ? `<span><i style="border-top:3px dashed ${C.ly}"></i>Last Year</span>` : ''}
        </div>
        <div class="chart-wrap">${chartSvg}</div>
      </div>
      <script>window.onload = function(){ window.print(); }<\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to print the forecast.'); return; }
    w.document.write(html);
    w.document.close();
  }

  // Print the logged-in user's own department forecast (current month).
  function printSheet() {
    renderForecastPrint({
      monthLabel, deptLabel, userLabel: currentUserDisplay || currentUser || '',
      forecast, lastYear, dailyTarget, actualMTD, expectedMTD,
      completedDays, totalDays, runRate, projected, rows,
    });
  }

  // Print the read-only cross-department forecast (current month) using the same
  // live pacing math as the owner view — same calendar month ⇒ same completedDays.
  function printCross() {
    const M = crossMonths && crossMonths[mk] ? computeMonthMetrics(mk, crossMonths[mk]) : null;
    if (!M) { alert(`No ${otherDeptLabel.toLowerCase()} numbers entered for ${monthLabel} yet.`); return; }
    const xRunRate = completedDays > 0 ? M.actualTotal / completedDays : 0;
    renderForecastPrint({
      monthLabel,
      deptLabel: otherDept === 'parts' ? 'Parts Department' : 'Service Department',
      userLabel: currentUserDisplay || currentUser || '',
      forecast: M.forecast, lastYear: M.lastYear, dailyTarget: M.dailyTarget,
      actualMTD: M.actualTotal, expectedMTD: M.dailyTarget * completedDays,
      completedDays, totalDays: M.totalDays, runRate: xRunRate,
      projected: xRunRate * M.totalDays, rows: M.rows,
    });
  }

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {breakdownOpen && laborBreakdown && (
        <LaborBreakdownModal breakdown={laborBreakdown} completedDays={completedDays} totalDays={totalDays}
          monthLabel={monthLabel} onClose={() => setBreakdownOpen(false)} />
      )}
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
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
                    Found <strong style={{ color: '#e2e8f0' }}>{parsePreview.length}</strong> day{parsePreview.length === 1 ? '' : 's'}. Review both columns, then apply — this overwrites those days' entries.
                  </div>
                  <div style={{ fontSize: 12, color: '#7dd3fc', marginBottom: 12, fontWeight: 700 }}>
                    ⇄ One report, both departments: this fills <strong>Service (labor)</strong> and <strong>Parts (parts)</strong> forecasts at once.
                  </div>
                  {(() => {
                    // Flag days whose report value differs from what's currently
                    // entered for THIS page's department (a reporting adjustment).
                    const pageKey = dept === 'parts' ? 'parts' : 'labor';
                    const isAdj = (dateKey) => {
                      const cur = actuals[dateKey];
                      if (cur == null || cur === '') return false;
                      const d = (parsedDaily && parsedDaily[dateKey]) || {};
                      return Math.abs(safe(cur, 0) - safe(d[pageKey], 0)) > 0.005;
                    };
                    const adjCount = parsePreview.filter(r => isAdj(r.dateKey)).length;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                        {adjCount > 0 && (
                          <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 700, marginBottom: 4 }}>
                            ⚠ {adjCount} day{adjCount === 1 ? '' : 's'} differ{adjCount === 1 ? 's' : ''} from your current {dept === 'parts' ? 'Parts' : 'Service'} entries — applying will correct {adjCount === 1 ? 'it' : 'them'}.
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b', padding: '2px 10px' }}>
                          <span>Day</span>
                          <span style={{ textAlign: 'right' }}>Service (Labor)</span>
                          <span style={{ textAlign: 'right' }}>Parts</span>
                        </div>
                        {parsePreview.map(r => {
                          const d = (parsedDaily && parsedDaily[r.dateKey]) || {};
                          const adj = isAdj(r.dateKey);
                          const cur = actuals[r.dateKey];
                          return (
                            <div key={r.dateKey} style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', alignItems: 'center', fontSize: 13, padding: '5px 10px', background: adj ? 'rgba(251,191,36,.10)' : 'rgba(255,255,255,.03)', border: adj ? '1px solid rgba(251,191,36,.35)' : '1px solid transparent', borderRadius: 6 }}>
                              <span style={{ color: '#cbd5e1' }}>{r.label}{adj && <span style={{ color: '#fbbf24', fontSize: 10.5, marginLeft: 6 }}>was {money(cur)}</span>}</span>
                              <span style={{ color: (adj && dept === 'service') ? '#fbbf24' : '#6ee7b7', fontWeight: 700, textAlign: 'right' }}>{money(d.labor)}</span>
                              <span style={{ color: (adj && dept === 'parts') ? '#fbbf24' : '#c4b5fd', fontWeight: 700, textAlign: 'right' }}>{money(d.parts)}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {parseSummary && (parseSummary.grossActual != null || parseSummary.cpActual != null) && (
                    <div style={{ marginBottom: 16, padding: '10px 12px', background: 'rgba(96,165,250,.08)', border: '1px solid rgba(96,165,250,.25)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#93c5fd', marginBottom: 6 }}>Dashboard Goal Gauges — pacing (MTD)</div>
                      {parseSummary.grossActual != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                          <span style={{ color: '#cbd5e1' }}>Gross Profit Actual</span>
                          <span style={{ color: '#93c5fd', fontWeight: 700 }}>{money(parseSummary.grossActual)}</span>
                        </div>
                      )}
                      {parseSummary.cpActual != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
                          <span style={{ color: '#cbd5e1' }}>Customer Pay Actual</span>
                          <span style={{ color: '#93c5fd', fontWeight: 700 }}>{money(parseSummary.cpActual)}</span>
                        </div>
                      )}
                    </div>
                  )}
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
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>👁 Viewing {otherDeptLabel} Goal Forecast</div>
            <input ref={crossPdfInputRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={e => handlePdf(e.target.files && e.target.files[0], otherDept)} />
            <button className="secondary" onClick={() => crossPdfInputRef.current && crossPdfInputRef.current.click()} disabled={parsing}>{parsing ? '⏳ Reading…' : `📤 Upload ${otherDeptLabel} Report PDF`}</button>
            {crossView === 'current' && <button className="secondary" onClick={printCross}>🖨 Print / PDF</button>}
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
                  <MonthDetail mkStr={histSel} monthData={allMonths[histSel]} editable onEditDay={(k, v) => updateHistActual(histSel, k, v)} />
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
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
            <MetricCard accent="#34d399" icon="💰" label="Month Forecast Gross Profit" minWidth={250}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 900, color: '#6ee7b7' }}>$</span>
                <input type="number" value={forecast || ''} placeholder="0" onChange={e => updateForecast(e.target.value)}
                  style={{ background: 'rgba(2,6,23,.5)', border: '1px solid rgba(52,211,153,.45)', borderRadius: 10, padding: '8px 12px', fontSize: 26, fontWeight: 900, color: '#6ee7b7', width: 200, outline: 'none' }} />
              </div>
            </MetricCard>
            <MetricCard accent="#38bdf8" icon="📆" label="Last Year (This Month)" minWidth={240}
              sub={forecast > 0 && lastYear > 0 ? (forecast >= lastYear ? '▲ ' : '▼ ') + money(Math.abs(forecast - lastYear)) + ' forecast vs LY' : 'last year’s final gross'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 900, color: '#7dd3fc' }}>$</span>
                <input type="number" value={lastYear || ''} placeholder="0" onChange={e => updateLastYear(e.target.value)}
                  style={{ background: 'rgba(2,6,23,.5)', border: '1px solid rgba(56,189,248,.4)', borderRadius: 10, padding: '8px 12px', fontSize: 26, fontWeight: 900, color: '#7dd3fc', width: 190, outline: 'none' }} />
              </div>
            </MetricCard>
            <MetricCard accent="#22d3ee" icon="🎯" label="Daily Target" sub={`${totalDays} working days · ${completedDays} completed`}>
              <div style={gfBig('#67e8f9')}>{money(dailyTarget)}</div>
            </MetricCard>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
            <MetricCard accent="#a78bfa" icon="🔥" label="Actual MTD"
              onClick={laborBreakdown ? () => setBreakdownOpen(true) : undefined}
              sub={laborBreakdown ? '🔍 Click for labor breakdown' : undefined} subColor="#c4b5fd">
              <div style={gfBig('#c4b5fd')}>{money(actualMTD)}</div>
            </MetricCard>
            <MetricCard accent="#38bdf8" icon="📊" label="Expected MTD" sub={`where you should be (${completedDays} × daily target)`}>
              <div style={gfBig('#7dd3fc')}>{money(expectedMTD)}</div>
            </MetricCard>
            <MetricCard accent="#34d399" icon="📈" label="Daily Average"
              sub={hasActuals ? 'per working day · target ' + money(dailyTarget) : 'avg gross per working day'}
              subColor={!hasActuals ? undefined : runRate >= dailyTarget ? '#34d399' : '#fb7185'}>
              <div style={gfBig(!hasActuals ? '#e2e8f0' : runRate >= dailyTarget ? '#34d399' : '#fb7185')}>{hasActuals ? money(runRate) : '—'}</div>
            </MetricCard>
            <MetricCard accent={up ? '#34d399' : '#fb7185'} icon="⚡" label={up ? 'Ahead of Pace' : 'Behind Pace'}>
              <div style={gfBig(up ? '#34d399' : '#fb7185')}>{up ? '▲ ' : '▼ '}{money(Math.abs(variance))}</div>
            </MetricCard>
            <MetricCard accent="#fbbf24" icon="🏁" label="Projected Month-End"
              sub={hasActuals && forecast > 0 ? (projected >= forecast ? '▲ ' : '▼ ') + money(Math.abs(projected - forecast)) + ' vs forecast' : forecast > 0 ? 'current daily pace × ' + totalDays + ' days' : 'enter a forecast'}
              subColor={!hasActuals ? undefined : projected >= forecast ? '#34d399' : '#fb7185'}>
              <div style={gfBig(!hasActuals ? '#e2e8f0' : projected >= forecast ? '#fbbf24' : '#fb7185')}>{hasActuals ? money(projected) : '—'}</div>
            </MetricCard>
            {lastYear > 0 && (
              <MetricCard accent="#f472b6" icon="📉" label="vs Last Year"
                sub={hasActuals ? 'projected ' + (projected >= lastYear ? '+' : '−') + (lastYear > 0 ? Math.abs((projected / lastYear - 1) * 100).toFixed(1) : '0') + '% vs LY' : 'LY ' + money(lastYear)}
                subColor={!hasActuals ? undefined : projected >= lastYear ? '#34d399' : '#fb7185'}>
                <div style={gfBig(!hasActuals ? '#e2e8f0' : projected >= lastYear ? '#34d399' : '#fb7185')}>{hasActuals ? (projected >= lastYear ? '▲ ' : '▼ ') + money(Math.abs(projected - lastYear)) : '—'}</div>
              </MetricCard>
            )}
          </div>

          {/* Daily grid (collapsible) */}
          <div style={{ background: 'linear-gradient(160deg, rgba(56,189,248,.10), rgba(15,23,42,.55) 60%)', border: '1px solid rgba(56,189,248,.28)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 10px 30px -18px rgba(56,189,248,.7)' }}>
            {/* Toggle bar — click to expand/collapse the daily entry table */}
            <div
              onClick={() => setGridOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', cursor: 'pointer', userSelect: 'none', background: gridOpen ? 'rgba(56,189,248,.08)' : 'transparent' }}
            >
              <span style={{ fontSize: 13, color: gridOpen ? '#38bdf8' : '#94a3b8', transition: 'transform .15s', transform: gridOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
              <span style={{ fontSize: 14 }}>📅</span>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#f1f5f9', textTransform: 'uppercase', letterSpacing: '.05em' }}>Daily Entry — {monthLabel}</div>
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
