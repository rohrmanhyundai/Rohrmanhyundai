// Big-Money LOF progress charts — shared by the Big-Money page and the Daily
// Wrench. Per advisor: $50 Add Rate % and Add-on Hrs/Ticket from contest start
// to end, dashed goal line, actual line, 2-week trend, zoom.
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { todayKey } from '../utils/bigMoney';

// ── Progress chart ─────────────────────────────────────────────────────────────
// One metric for one advisor across the whole contest window: a dashed goal
// line and the actual numbers, day by day (from `history`, plus today's live
// value). The x-axis always runs start → end, so the empty stretch on the
// right is the time left to close the gap.
const dayNum = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
// Zoom levels (days shown); null = the whole contest.
const ZOOMS = [null, 30, 14, 7];
const ZOOM_LABEL = { null: 'Full', 30: 'Month', 14: '2 Wks', 7: 'Week' };
// Visible window for a zoom level: ends a little past today so the latest
// point isn't jammed against the edge, clamped to the contest.
function zoomWindow(zoom, start, end) {
  const s0 = dayNum(start), e0 = Math.max(dayNum(end), s0 + 1);
  if (!zoom) return [s0, e0];
  const t = Math.min(Math.max(dayNum(todayKey()), s0), e0);
  const pad = Math.max(1, Math.round(zoom * 0.15));
  let hi = Math.min(e0, t + pad), lo = hi - zoom;
  if (lo < s0) { lo = s0; hi = Math.min(e0, s0 + zoom); }
  return [lo, hi];
}

// Trend: least-squares slope over the last 14 days of points (needs 3+ points
// spanning 4+ days), projected two weeks ahead (or to the contest end if
// sooner). Only two weeks: these are contest-to-date averages, which flatten
// as tickets pile up, so a straight line to the end date overshoots.
function trendOf(points, end, cap) {
  if (!points.length || !end) return null;
  const last = points[points.length - 1];
  const ln = dayNum(last.date);
  const recent = points.filter(p => dayNum(p.date) >= ln - 14);
  if (recent.length < 3 || ln - dayNum(recent[0].date) < 4) return null;
  const xs = recent.map(p => dayNum(p.date)), ys = recent.map(p => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (!den) return null;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / den;
  const ahead = Math.min(14, Math.max(0, dayNum(end) - ln));
  if (!ahead) return { slope, perWeek: slope * 7, proj: null, from: last, end: null };
  let proj = last.v + slope * ahead;
  proj = Math.max(0, cap != null ? Math.min(cap, proj) : proj);
  return { slope, perWeek: slope * 7, proj, from: last, end: isoOf(ln + ahead) };
}

export function ProgressChart({ title, points, goal, win, fmt, fmtDelta, end, cap, color = '#22d3ee', onZoom }) {
  const W = 320, H = 150, L = 38, R = 12, T = 14, B = 26;
  const [x0, x1] = win;
  const zoomed = x1 - x0 <= 31;
  const trend = trendOf(points, end, cap);
  const inWin = points.filter(p => { const n = dayNum(p.date); return n >= x0 && n <= x1; });
  const vals = (inWin.length ? inWin : points).map(p => p.v);
  if (trend && trend.end && dayNum(trend.end) <= x1) vals.push(trend.proj);
  // Zoomed in, the y-axis tightens too (still keeping the goal line in view)
  // so day-to-day movement is easy to see.
  const top = Math.max(goal * (zoomed ? 1.08 : 1.15), ...vals, 0.0001);
  const bot = zoomed ? Math.max(0, Math.min(...vals) - (top - Math.min(...vals)) * 0.25) : 0;
  const X = (iso) => L + ((dayNum(iso) - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - bot) / (top - bot || 1)) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const hit = last && goal > 0 && last.v >= goal;
  const today = todayKey();
  const tn = dayNum(today);
  const showToday = tn >= x0 && tn <= x1;
  const md = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };
  // Date ticks between the ends when zoomed in.
  const span = x1 - x0;
  const step = span <= 8 ? 1 : span <= 15 ? 2 : 7;
  const ticks = [];
  if (zoomed) for (let n = x0 + step; n < x1; n += step) ticks.push(isoOf(n));
  const clipId = useMemo(() => 'pc' + Math.random().toString(36).slice(2), []);
  const svgRef = useRef(null);
  // Trackpad pinch / ctrl+wheel zooms; plain scrolling still scrolls the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !onZoom) return;
    const h = (e) => { if (!e.ctrlKey) return; e.preventDefault(); onZoom(e.deltaY < 0 ? 1 : -1); };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [onZoom]);
  return (
    <div style={{ background: 'rgba(2,6,23,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '10px 12px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em' }}>{title}</span>
        {last && <span style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 1000, color: hit ? '#4ade80' : color }}>{fmt(last.v)}</span>}
        <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 800 }}>goal {fmt(goal)}</span>
      </div>
      {trend && (() => {
        const flat = Math.abs(trend.perWeek) < Math.max(goal, 0.0001) * 0.01;
        const up = trend.perWeek > 0;
        const onTrack = goal > 0 && trend.proj != null && trend.proj >= goal;
        const tc = flat ? '#94a3b8' : up ? '#4ade80' : '#fb7185';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4, fontSize: 11.5, fontWeight: 800 }}>
            <span style={{ color: tc, background: `${tc}1f`, border: `1px solid ${tc}55`, borderRadius: 999, padding: '1px 8px' }}
              title="Change per week, from the last two weeks of numbers">
              {flat ? '▬ Flat' : `${up ? '▲' : '▼'} ${up ? '+' : '−'}${fmtDelta(Math.abs(trend.perWeek))}/wk`}
            </span>
            {trend.end && <span style={{ color: onTrack ? '#4ade80' : '#cbd5e1' }} title="Where the last two weeks' trend lands two weeks from now">
              → {fmt(trend.proj)} by {(() => { const [, m, d] = trend.end.split('-').map(Number); return `${m}/${d}`; })()}{onTrack ? ' · at goal ✓' : ''}
            </span>}
          </div>
        );
      })()}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', marginTop: 4, cursor: onZoom ? 'zoom-in' : undefined }}
        onDoubleClick={onZoom ? () => onZoom(zoomed ? 'out' : 'in') : undefined}>
        <defs><clipPath id={clipId}><rect x={L - 5} y={0} width={W - L - R + 10} height={H - B + 2} /></clipPath></defs>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={Y(bot + (top - bot) * f)} y2={Y(bot + (top - bot) * f)} stroke="rgba(148,163,184,.12)" />
            <text x={L - 5} y={Y(bot + (top - bot) * f) + 3.5} fontSize="9" fill="#64748b" textAnchor="end">{fmt(bot + (top - bot) * f)}</text>
          </g>
        ))}
        {ticks.map(d => <line key={d} x1={X(d)} x2={X(d)} y1={H - B} y2={H - B + 3} stroke="rgba(148,163,184,.4)" />)}
        {showToday && <line x1={X(today)} x2={X(today)} y1={T} y2={H - B} stroke="rgba(148,163,184,.35)" strokeDasharray="2 3" />}
        {goal > 0 && <line x1={L} x2={W - R} y1={Y(goal)} y2={Y(goal)} stroke="#fbbf24" strokeWidth="2" strokeDasharray="6 4" />}
        <g clipPath={`url(#${clipId})`}>
          {trend && trend.end && <>
            <line x1={X(trend.from.date)} y1={Y(trend.from.v)} x2={X(trend.end)} y2={Y(trend.proj)} stroke={color} strokeOpacity=".55" strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />
            <circle cx={X(trend.end)} cy={Y(trend.proj)} r="3.6" fill="#0b1220" stroke={color} strokeOpacity=".8" strokeWidth="1.6"><title>{`Trend → ${fmt(trend.proj)} by contest end`}</title></circle>
          </>}
          {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />}
          {points.map((p, i) => {
            const lastPt = i === points.length - 1;
            return (
              <g key={i}>
                <circle cx={X(p.date)} cy={Y(p.v)} r={lastPt ? 4.2 : zoomed ? 3.2 : 2.6} fill={lastPt && hit ? '#4ade80' : color} stroke="#0b1220" strokeWidth="1.2">
                  <title>{`${md(p.date)}: ${fmt(p.v)}`}</title>
                </circle>
                {span <= 15 && X(p.date) > L + 10 && <text x={X(p.date)} y={Y(p.v) - 7} fontSize="8.5" fill="#e2e8f0" textAnchor="middle" fontWeight="700">{fmt(p.v)}</text>}
              </g>
            );
          })}
        </g>
        <text x={L} y={H - 8} fontSize="9.5" fill="#94a3b8">{md(isoOf(x0))}</text>
        {ticks.filter(d => X(d) - L > 22 && W - R - X(d) > 22 && !(showToday && Math.abs(X(d) - X(today)) < 22))
          .map(d => <text key={d} x={X(d)} y={H - 8} fontSize="9" fill="#64748b" textAnchor="middle">{md(d)}</text>)}
        {showToday && X(today) - L > 30 && W - R - X(today) > 30 && <text x={X(today)} y={H - 8} fontSize="9.5" fill="#cbd5e1" textAnchor="middle">today</text>}
        <text x={W - R} y={H - 8} fontSize="9.5" fill="#94a3b8" textAnchor="end">{md(isoOf(x1))}</text>
      </svg>
    </div>
  );
}

// Both charts for one advisor share one zoom so they line up day for day.
export function AdvisorProgress({ start, end, children }) {
  const [zi, setZi] = useState(0);
  const onZoom = useCallback((d) => setZi(i => {
    if (d === 'in') return ZOOMS.length - 1;
    if (d === 'out') return 0;
    return Math.min(ZOOMS.length - 1, Math.max(0, i + d));
  }), []);
  const win = zoomWindow(ZOOMS[zi], start, end);
  const btn = (on) => ({ padding: '3px 9px', fontSize: 11, fontWeight: 800, borderRadius: 999, cursor: 'pointer',
    border: '1px solid ' + (on ? '#22d3ee' : 'rgba(148,163,184,.3)'), background: on ? 'rgba(34,211,238,.18)' : 'transparent', color: on ? '#a5f3fc' : '#94a3b8' });
  return (
    <>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <button type="button" style={btn(false)} disabled={zi === 0} onClick={() => onZoom(-1)} title="Zoom out">−</button>
        {ZOOMS.map((z, i) => <button key={i} type="button" style={btn(i === zi)} onClick={() => setZi(i)}>{ZOOM_LABEL[z]}</button>)}
        <button type="button" style={btn(false)} disabled={zi === ZOOMS.length - 1} onClick={() => onZoom(1)} title="Zoom in">+</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {children(win, onZoom)}
      </div>
    </>
  );
}


// Both charts for one advisor, built from the contest file's daily `history`.
//   liveRow — optional { hrsRo, rate } for today (the Big-Money page passes its
//             live standings so today's dot is current).
//   asOf    — 'YYYY-MM-DD': ignore history after this day (a Daily Wrench
//             report shows the contest as it stood that morning).
export function seriesFor(file, name, key, { liveRow = null, asOf = null } = {}) {
  const c = (file && file.contest) || {};
  const hist = (file && file.history) || {};
  const days = Object.keys(hist).filter(d => d >= c.start && d <= c.end && (!asOf || d <= asOf)).sort();
  const pts = days.map(d => {
    const r = ((hist[d] || {}).standings || []).find(x => x.name === name);
    return r ? { date: d, v: Number(r[key]) || 0 } : null;
  }).filter(Boolean);
  const tk = todayKey();
  if (liveRow && tk >= c.start && tk <= c.end) {
    const i = pts.findIndex(p => p.date === tk);
    const pt = { date: tk, v: Number(liveRow[key]) || 0 };
    if (i >= 0) pts[i] = pt; else pts.push(pt);
  }
  return pts;
}

export function BigMoneyAdvisorCharts({ file, name, goals = {}, liveRow = null, asOf = null }) {
  const c = (file && file.contest) || {};
  if (!c.start || !c.end) return null;
  return (
    <AdvisorProgress start={c.start} end={c.end}>
      {(win, onZoom) => (<>
        <ProgressChart title="$50 Add Rate %" points={seriesFor(file, name, 'rate', { liveRow, asOf })} goal={Number(goals.add_rate) || 0}
          win={win} onZoom={onZoom} end={c.end} cap={1} fmt={(v) => `${Math.round(v * 100)}%`} fmtDelta={(d) => `${(d * 100).toFixed(1)} pts`} color="#22d3ee" />
        <ProgressChart title="Add-on Hrs/Ticket" points={seriesFor(file, name, 'hrsRo', { liveRow, asOf })} goal={Number(goals.hrs_ro) || 0}
          win={win} onZoom={onZoom} end={c.end} fmt={(v) => Number(v).toFixed(2)} fmtDelta={(d) => d.toFixed(2)} color="#a78bfa" />
      </>)}
    </AdvisorProgress>
  );
}

export const CHART_LEGEND = (
  <>
    <span style={{ color: '#fbbf24' }}>- - goal</span> · <span style={{ color: '#22d3ee' }}>── where you are</span> · <span style={{ color: '#94a3b8' }}>┈ 2-week trend</span>
  </>
);
