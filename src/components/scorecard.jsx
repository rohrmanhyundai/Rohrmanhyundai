// Dashboard scorecard pieces shared by The Daily Wrench scorecards and the
// shop TV dashboard (/dashboard/): the metric list and goals, the glowing
// ring, and the "how many to sell today" math — one copy, so both screens
// always show the same numbers.
import React from 'react';
import { advisorDailyAverage, roh50Goals } from '../utils/calculations';

export const SC_CSS = `
@keyframes scGlow{0%,100%{box-shadow:0 0 0 1px rgba(74,222,128,.35),0 0 18px -6px rgba(74,222,128,.55)}50%{box-shadow:0 0 0 1px rgba(74,222,128,.6),0 0 28px -4px rgba(74,222,128,.8)}}
@keyframes scMiss{0%,100%{border-color:rgba(248,113,113,.35)}50%{border-color:rgba(248,113,113,.75)}}
.sc-tile{position:relative;border-radius:14px;padding:12px 6px 10px;display:flex;flex-direction:column;align-items:center;text-align:center;
  background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.015));border:1px solid rgba(148,163,184,.2);overflow:hidden}
.sc-tile.hit{animation:scGlow 2.6s ease-in-out infinite;background:linear-gradient(160deg,rgba(34,197,94,.16),rgba(34,197,94,.03))}
.sc-tile.miss{animation:scMiss 2.2s ease-in-out infinite;background:linear-gradient(160deg,rgba(239,68,68,.12),rgba(239,68,68,.02))}
.sc-tile .lbl{font-size:10.5px;font-weight:900;letter-spacing:.06em;white-space:nowrap;text-transform:uppercase;color:#94a3b8}
.sc-crown{position:absolute;top:34px;right:3px;font-size:14px;filter:drop-shadow(0 0 6px rgba(250,204,21,.8))}
`;

export function Ring({ frac, color, size = 86, stroke = 8, children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '8px 0 6px' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,.16)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

export const SC_P = (v, d = 1) => `${((Number(v) || 0) * 100).toFixed(d)}%`;

export function scoreMetrics(data) {
  const r50 = roh50Goals(data || {});
  return [
    { key: 'hours_per_ro', label: 'Hrs / RO', goal: 1.4, sell: 'hours', base: 'ro', fmt: v => (Number(v) || 0).toFixed(2), gap: d => `${d.toFixed(2)} hrs/RO` },
    { key: 'align', label: 'Alignment', goal: 0.10, sell: 'count', base: 'ro', unit: ['alignment', 'alignments'], fmt: v => SC_P(v), gap: d => `${(d * 100).toFixed(1)} pts` },
    { key: 'tires', label: 'Tires', goal: 0.15, sell: 'count', base: 'ro', unit: ['tire sale', 'tire sales'], fmt: v => SC_P(v), gap: d => `${(d * 100).toFixed(1)} pts` },
    { key: 'valvoline', label: 'Valvoline', goal: 0.25, sell: 'count', base: 'ro', unit: ['Valvoline service', 'Valvoline services'], fmt: v => SC_P(v), gap: d => `${(d * 100).toFixed(1)} pts` },
    { key: 'roh50_hrs_ro', label: '$50 Add-on Hrs', goal: r50.hrs_ro, sell: 'hours', base: 'lof', fmt: v => (Number(v) || 0).toFixed(2), gap: d => `${d.toFixed(2)} hrs` },
    { key: 'roh50_add_rate', label: '$50 Add Rate', goal: r50.add_rate, sell: 'count', base: 'lof', unit: ['add-on ticket', 'add-on tickets'], fmt: v => SC_P(v), gap: d => `${(d * 100).toFixed(1)} pts` },
    { key: 'csi', label: 'CSI', goal: 910, fmt: v => String(Math.round(Number(v) || 0)), gap: d => `${Math.ceil(d)} pts` },
    { key: 'asr', label: 'ASR', goal: 0.21, sell: 'count', base: 'ro', unit: ['ASR sell', 'ASR sells'], fmt: v => SC_P(v), gap: d => `${(d * 100).toFixed(1)} pts` },
    { key: 'elr', label: 'ELR', goal: 0.88, fmt: v => SC_P(v, 0), gap: d => `${(d * 100).toFixed(1)} pts` },
  ].filter(m => m.goal > 0);
}

export function sellPlan(m, advisor, today) {
  const v = Number(advisor[m.key]) || 0;
  const N = m.base === 'lof' ? (Number(advisor.lof_tickets) || 0) : (Number(advisor.ro_count) || 0);
  if (!m.sell || N <= 0) return null;
  const T = Math.max(1, Math.round(m.base === 'lof' ? (today.lof50 || today.lofAvg || 1) : (today.ros || today.roAvg || 1)));
  const have = v * N;                           // sold so far (count or hours)
  const at = (k) => (have + k) / (N + T);       // the rate after k more sells today
  const hit = v >= m.goal - 1e-9;
  if (m.sell === 'hours') {
    const need = Math.max(0, m.goal * (N + T) - have);
    // Steps scaled to the job: quarter, half, three-quarters and all of the
    // hours needed (or of a goal-paced day when they're already there).
    const span = need > 0 ? need : m.goal * T;
    const ladder = [0.25, 0.5, 0.75, 1].map(f => Math.round(span * f * 10) / 10).filter((k, i, a) => k > 0 && a.indexOf(k) === i).map(k => ({ k, r: at(k) }));
    return { kind: 'hours', N, T, hit, need, ladder, cushion: hit ? Math.max(0, have - m.goal * (N + T)) : 0 };
  }
  const need = Math.max(0, Math.ceil(m.goal * (N + T) - have - 1e-9));
  const ladder = Array.from({ length: Math.min(T, Math.max(need, 3)) + 1 }, (_, k) => ({ k, r: at(k) })).slice(1);
  // Goal hit: how many more ROs can go out with no sell and still hold goal.
  const cushion = hit ? Math.max(0, Math.floor(have / m.goal - N + 1e-9)) : 0;
  return { kind: 'count', N, T, hit, need, ladder, cushion, all: at(T), perSell: at(1) - at(0) };
}

export function todayCounts(a, data, ap, hours) {
  const elapsed = Math.max(1, Number(hours && hours.workingDaysElapsed) || 0) ;
  const d = advisorDailyAverage(a, data) > 0 && Number(a.mtd_hours) > 0 ? Number(a.mtd_hours) / advisorDailyAverage(a, data) : elapsed;
  const days = Math.max(1, Math.round(d));
  return {
    ros: ap && ap.total ? ap.total : 0, lof50: ap && ap.lof50 ? ap.lof50 : 0,
    roAvg: (Number(a.ro_count) || 0) / days, lofAvg: (Number(a.lof_tickets) || 0) / days,
  };
}
